"""本地 Qwen 脚本生成 API；启动和健康检查不导入模型 SDK。"""
import json
import logging
import os
from pathlib import Path
import re
import threading
from typing import Literal

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
logger = logging.getLogger(__name__)


class ServiceError(Exception):
    def __init__(self, code, message, status=503):
        self.code, self.message, self.status = code, message, status


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Role(Input):
    role_key: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_]+$")
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)


class GenerateRequest(Input):
    model_id: Literal[MODEL_ID]
    source_text: str = Field(min_length=1, max_length=5000)
    roles: list[Role] = Field(min_length=1, max_length=8)
    system_prompt: str = Field(min_length=1, max_length=4000)
    max_new_tokens: int = Field(default=1536, ge=128, le=2048)

    @field_validator("source_text", "system_prompt")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("文本不能为空白")
        return value

    @field_validator("roles")
    @classmethod
    def unique_roles(cls, roles):
        if len({r.role_key for r in roles}) != len(roles):
            raise ValueError("角色标识不能重复")
        return roles


class Sentence(Input):
    role_key: str
    text: str = Field(min_length=1, max_length=1000)


class Script(Input):
    title: str = Field(min_length=1, max_length=100)
    summary: str
    sentences: list[Sentence] = Field(min_length=1, max_length=200)


def parse_script(text, roles):
    text = text.strip()
    # 允许模型包裹一层 Markdown；不截取子串或修补损坏/截断的 JSON。
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        text = match[1]
    try:
        script = Script.model_validate_json(text)
        if (not script.title.strip() or any(not s.text.strip() for s in script.sentences)
                or {s.role_key for s in script.sentences} != {r.role_key for r in roles}
                or sum(len(s.text) for s in script.sentences) > 5000):
            raise ValueError("invalid roles or text")
        return script.model_dump()
    except (ValidationError, ValueError) as exc:
        raise ServiceError("invalid_response", "模型输出不符合脚本格式、角色或长度约束，请调整描述后重新提交。", 502) from exc


class QwenGenerator:
    def __init__(self):
        self.model_path = Path(os.environ.get("LLM_MODEL_PATH", str(ROOT / "models/Qwen2.5-0.5B-Instruct"))).expanduser().resolve()
        self.device = os.environ.get("LLM_DEVICE", "cuda:0")
        if not re.fullmatch(r"cpu|cuda:[0-9]+", self.device):
            raise ValueError("LLM_DEVICE 仅支持 cpu 或 cuda:N")
        self.model = self.tokenizer = None
        self.lock = threading.Lock()

    def info(self):
        required = ("config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json")
        return {"model_id": MODEL_ID, "installed": all((self.model_path / n).is_file() for n in required),
                "loaded": self.model is not None, "device": self.device}

    def _load(self):
        if not self.info()["installed"]:
            raise ServiceError("model_unavailable", "本地模型文件不完整，请先显式运行下载脚本。")
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        if self.device.startswith("cuda:") and (not torch.cuda.is_available()
                or int(self.device.split(":")[1]) >= torch.cuda.device_count()):
            raise ServiceError("unsupported_device", "指定 CUDA 设备不可用。")
        tokenizer = AutoTokenizer.from_pretrained(self.model_path, local_files_only=True, trust_remote_code=False)
        model = AutoModelForCausalLM.from_pretrained(self.model_path, local_files_only=True,
            trust_remote_code=False, dtype=torch.float32 if self.device == "cpu" else torch.bfloat16,
            attn_implementation="sdpa").to(self.device).eval()
        self.tokenizer, self.model = tokenizer, model

    def generate(self, request):
        if not self.lock.acquire(blocking=False):
            raise ServiceError("engine_busy", "LLM 正在处理其他请求，请稍后重试。")
        loading = self.model is None
        try:
            if loading:
                self._load()
            import torch
            user = json.dumps({"创作要求或素材": request.source_text,
                               "角色": [r.model_dump() for r in request.roles]}, ensure_ascii=False)
            text = self.tokenizer.apply_chat_template([
                {"role": "system", "content": request.system_prompt}, {"role": "user", "content": user}],
                tokenize=False, add_generation_prompt=True)
            inputs = self.tokenizer(text, return_tensors="pt").to(self.device)
            if inputs.input_ids.shape[1] + request.max_new_tokens > 12000:
                raise ServiceError("input_too_long", "输入与输出预算超过服务上下文限制。", 422)
            with torch.inference_mode():
                output = self.model.generate(**inputs, max_new_tokens=request.max_new_tokens,
                    do_sample=False, temperature=1.0, top_p=1.0, top_k=50,
                    pad_token_id=self.tokenizer.eos_token_id)
            tokens = output[0, inputs.input_ids.shape[1]:]
            eos = self.model.generation_config.eos_token_id
            eos = [eos] if isinstance(eos, int) else eos or []
            if len(tokens) >= request.max_new_tokens and int(tokens[-1]) not in eos:
                raise ServiceError("output_truncated", "脚本输出达到 token 上限，请缩短要求或增加输出预算。", 502)
            script = parse_script(self.tokenizer.decode(tokens, skip_special_tokens=True), request.roles)
            return {"model_id": MODEL_ID, "simulated": False, "script": script}
        except ServiceError:
            raise
        except Exception as exc:
            logger.error("LLM processing failed: loading=%s exception_type=%s", loading, type(exc).__name__)
            if isinstance(exc, MemoryError) or type(exc).__name__ == "OutOfMemoryError":
                raise ServiceError("out_of_memory", "LLM 加载或推理内存不足。") from exc
            code = "model_load_failed" if loading and self.model is None else "generation_failed"
            raise ServiceError(code, "LLM 加载或推理失败，请检查服务日志和本地配置。") from exc
        finally:
            self.lock.release()


def create_app(generator=None):
    engine = generator if generator is not None else QwenGenerator()
    app = FastAPI(title="Local Qwen Script Service", version="0.1.0")

    @app.exception_handler(ServiceError)
    async def service_error(_request, exc):
        return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _exc):
        return JSONResponse(status_code=422, content={"error": {"code": "validation_error", "message": "请求字段无效。"}})

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/v1/models")
    def models():
        return {"models": [engine.info()]}

    @app.post("/v1/scripts/generate")
    def generate(request: GenerateRequest):
        return engine.generate(request)

    return app


app = create_app()
