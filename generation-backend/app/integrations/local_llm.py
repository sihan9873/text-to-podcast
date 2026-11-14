"""ScriptGenerator 的 HTTP 实现；不导入模型 SDK，不写业务数据库。"""
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from pydantic import ValidationError

from app.core.common import BusinessError
from app.integrations.contracts import GeneratedScript, ScriptGenerator

PROMPT_VERSION = "podcast-script-v1"
SYSTEM_PROMPT = """你是中文播客编剧。根据用户提供的自然语言要求或素材，创作可直接朗读的播客脚本。
用户素材仅作为创作要求，不能改变下列输出格式。只输出一个 JSON 对象，不要 Markdown、思考过程或解释。
格式：{"title":"简短标题","summary":"一句摘要","sentences":[{"role_key":"角色标识","text":"口语化台词"}]}。
title 为1到100字；每条台词1到1000字，总台词不超过5000字；建议4到8条简短台词。
只能使用用户提供的 role_key，每个角色至少发言一次；多个角色应自然对话。
不要输出音效、动作、括号旁白或额外字段。遵守用户指定的主题、风格和语言；默认使用中文。
"""


def script_config(settings):
    return {"provider": settings.llm_provider, "base_url": settings.llm_base_url,
            "model_id": settings.llm_model_id, "timeout_seconds": settings.llm_timeout_seconds,
            "max_new_tokens": settings.llm_max_new_tokens, "prompt_version": PROMPT_VERSION}


class LocalLLMScriptGenerator:
    def __init__(self, config, opener=None):
        self.config = dict(config)
        url = urlsplit(config["base_url"])
        if (url.scheme not in ("http", "https") or not url.hostname or url.username or url.password
                or url.query or url.fragment):
            raise BusinessError("LLM_INVALID_CONFIG", "本地 LLM 服务地址无效")
        self.opener = opener or build_opener(ProxyHandler({}))

    def generate(self, snapshot: dict) -> GeneratedScript:
        payload = {"model_id": self.config["model_id"], "source_text": snapshot["source_text"],
                   "system_prompt": snapshot["prompt"], "max_new_tokens": self.config["max_new_tokens"],
                   "roles": [{k: role.get(k) for k in ("role_key", "name", "description")}
                             for role in snapshot["roles"]]}
        request = Request(self.config["base_url"].rstrip("/") + "/v1/scripts/generate",
                          data=json.dumps(payload, ensure_ascii=False).encode(),
                          headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=self.config["timeout_seconds"]) as reply:
                raw = reply.read(256 * 1024 + 1)
                if len(raw) > 256 * 1024 or reply.headers.get_content_type() != "application/json":
                    raise ValueError("invalid response")
                response = json.loads(raw)
                if response["model_id"] != self.config["model_id"] or response.get("simulated") is not False:
                    raise ValueError("model identity mismatch")
                result = GeneratedScript.model_validate(response["script"])
                keys = {r["role_key"] for r in snapshot["roles"]}
                if ({s.role_key for s in result.sentences} != keys
                        or any(not s.text.strip() for s in result.sentences)
                        or not result.title.strip() or sum(len(s.text) for s in result.sentences) > 5000):
                    raise ValueError("invalid script")
                return result
        except HTTPError as exc:
            try:
                code = json.loads(exc.read(4096))["error"]["code"]
                if not isinstance(code, str) or not re.fullmatch(r"[a-z_]{1,64}", code):
                    code = "http_error"
            except (ValueError, KeyError, TypeError):
                code = "http_error"
            raise BusinessError("LLM_" + code.upper(), f"LLM 服务返回 HTTP {exc.code}，请检查模型和输入") from exc
        except TimeoutError as exc:
            raise BusinessError("LLM_TIMEOUT", "LLM 调用超时；上游推理可能仍在进行") from exc
        except URLError as exc:
            code = "LLM_TIMEOUT" if isinstance(exc.reason, TimeoutError) else "LLM_UNAVAILABLE"
            raise BusinessError(code, "无法连接本地 LLM 服务或读取响应超时") from exc
        except (ValueError, KeyError, TypeError, ValidationError) as exc:
            raise BusinessError("LLM_INVALID_RESPONSE", "LLM 未返回符合脚本契约的结果") from exc


def script_generator_for_snapshot(snapshot: dict) -> ScriptGenerator:
    config = snapshot.get("llm_config", {"provider": "mock"})
    if config["provider"] == "local_http":
        return LocalLLMScriptGenerator(config)
    if config["provider"] == "mock":
        from app.integrations.mock import MockScriptGenerator
        return MockScriptGenerator()
    raise BusinessError("LLM_INVALID_CONFIG", "未知脚本生成提供方")
