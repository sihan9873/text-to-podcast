"""FastAPI HTTP 边界；仅依赖 TTSEngine，不导入模型 SDK。"""

from dataclasses import asdict
import io
import logging
from typing import Annotated, Mapping
import wave

from fastapi import FastAPI, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.exceptions import HTTPException

from .engine import AudioResult, EngineError, TTSEngine
from .mock import MockEngine

logger = logging.getLogger(__name__)
MAX_TEXT_LENGTH = 1000
DEFAULT_ALIASES = {"mock": {"host_a": "tone_low", "host_b": "tone_high"}}


class SynthesisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    engine_id: str = Field(min_length=1, max_length=100)
    voice_id: str = Field(min_length=1, max_length=100)
    speed: float = Field(default=1.0, gt=0, allow_inf_nan=False)
    output_type: str = "wav"

    @field_validator("text")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("文本不能为空白。")
        return value  # 保留原文本和标点


def error_response(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, **extra}})


def validate_audio(result: AudioResult, voice_id: str) -> None:
    try:
        with wave.open(io.BytesIO(result.wav_bytes), "rb") as audio:
            frames = audio.getnframes()
            if (
                frames <= 0
                or audio.getframerate() != result.sample_rate
                or result.voice_id != voice_id
                or audio.getcomptype() != "NONE"
                or len(audio.readframes(frames)) != frames * audio.getnchannels() * audio.getsampwidth()
            ):
                raise ValueError("WAV 元数据或帧长度不匹配")
    except (wave.Error, EOFError, ValueError, TypeError) as exc:
        raise EngineError("invalid_audio", "引擎未返回完整、非空的 PCM WAV。", 500) from exc


def create_app(
    engines: Mapping[str, TTSEngine] | None = None,
    voice_aliases: Mapping[str, Mapping[str, str]] | None = None,
) -> FastAPI:
    """注入引擎与别名配置；空注册表也可启动并响应健康检查。"""
    registry = dict(engines) if engines is not None else {"mock": MockEngine()}
    aliases = {
        key: dict(value)
        for key, value in (DEFAULT_ALIASES if voice_aliases is None else voice_aliases).items()
    }
    app = FastAPI(title="Local TTS Service", version="0.2.0")

    @app.exception_handler(EngineError)
    async def engine_error(_request, exc: EngineError):
        return error_response(exc.status_code, exc.code, str(exc))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, exc: RequestValidationError):
        # 不回传原始文本、参考数据或不可 JSON 序列化的异常上下文。
        details = [{"loc": list(e["loc"]), "type": e["type"], "message": e["msg"]} for e in exc.errors()]
        return error_response(422, "validation_error", "请求字段无效。", details=details)

    @app.exception_handler(HTTPException)
    async def http_error(_request, exc: HTTPException):
        return error_response(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def unexpected_error(_request, _exc):
        logger.error("TTS 服务发生未分类异常。")
        return error_response(500, "internal_error", "服务内部错误。")

    def get_engine(engine_id: str) -> TTSEngine:
        if engine_id not in registry:
            raise EngineError("unknown_engine", f"未注册引擎：{engine_id}", 404)
        engine = registry[engine_id]
        info = engine.info()
        if not info.installed:
            raise EngineError("engine_unavailable", info.availability_reason or "引擎依赖或模型尚未准备好。")
        return engine

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/v1/engines")
    def list_engines():
        return {"engines": [asdict(engine.info()) for engine in registry.values()]}

    @app.get("/v1/voices")
    def list_voices(engine_id: Annotated[str, Query(min_length=1, max_length=100)]):
        engine = get_engine(engine_id)
        voices = engine.list_voices()
        return {
            "engine_id": engine_id,
            "voices": voices,
            "aliases": {alias: voice for alias, voice in aliases.get(engine_id, {}).items() if voice in voices},
        }

    @app.post(
        "/v1/synthesize",
        response_class=Response,
        responses={
            200: {"description": "完整 PCM WAV", "content": {"audio/wav": {}}},
            **{status: {"description": description, "content": {"application/json": {}}}
               for status, description in [(404, "未注册引擎"), (422, "无效请求或不支持的功能"),
                                           (500, "推理失败或音频无效"), (503, "引擎不可用、加载失败、设备不可用、内存不足或忙碌")]},
        },
    )
    def synthesize(request: SynthesisRequest):
        engine = get_engine(request.engine_id)
        info = engine.info()
        if len(request.text) > info.max_text_length:
            raise EngineError("invalid_text", f"该引擎最多支持 {info.max_text_length} 字符。", 422)
        if request.output_type != "wav":
            raise EngineError("unsupported_feature", "当前仅支持 WAV 输出。", 422)
        if request.speed != 1.0 and not info.supports_speed:
            raise EngineError("unsupported_feature", "该引擎不支持语速控制。", 422)
        voice_id = aliases.get(request.engine_id, {}).get(request.voice_id, request.voice_id)
        if voice_id not in engine.list_voices():
            raise EngineError("unknown_voice", "该引擎不支持指定音色。", 422)
        try:
            result = engine.synthesize(request.text, voice_id, request.speed)
        except MemoryError as exc:
            raise EngineError("out_of_memory", "推理内存不足，请减少负载后重试。") from exc
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError("synthesis_failed", "引擎推理失败。", 500) from exc
        validate_audio(result, voice_id)
        return Response(result.wav_bytes, media_type="audio/wav")

    return app


app = create_app()
