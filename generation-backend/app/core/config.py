from dataclasses import dataclass
import math
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_url: str = f"sqlite:///{(ROOT / 'data' / 'backend.sqlite3').as_posix()}"
    storage_dir: Path = ROOT / "data" / "assets"
    development_user_id: int = 1
    poll_seconds: float = 0.5
    lease_seconds: int = 60
    max_pending_tasks: int = 100
    cors_origin: str = "http://localhost:5173"
    audio_provider: str = "mock"
    tts_base_url: str = "http://127.0.0.1:8001"
    tts_engine_id: str = "qwen3-customvoice"
    tts_timeout_seconds: float = 300.0
    tts_chunk_chars: int = 120
    tts_sample_rate: int = 24000
    tts_turn_silence_ms: int = 250
    ffmpeg_binary: str = "ffmpeg"
    audio_encode_timeout_seconds: float = 60.0
    llm_provider: str = "mock"
    llm_base_url: str = "http://127.0.0.1:8002"
    llm_model_id: str = "Qwen/Qwen2.5-0.5B-Instruct"
    llm_timeout_seconds: float = 300.0
    llm_max_new_tokens: int = 1536

    @classmethod
    def from_env(cls):
        load_dotenv(ROOT / ".env", override=False)
        return cls(
            database_url=os.getenv("DATABASE_URL", cls.database_url),
            storage_dir=Path(os.getenv("STORAGE_DIR", str(cls.storage_dir))).resolve(),
            development_user_id=int(os.getenv("DEVELOPMENT_USER_ID", str(cls.development_user_id))),
            poll_seconds=float(os.getenv("WORKER_POLL_SECONDS", "0.5")),
            lease_seconds=int(os.getenv("WORKER_LEASE_SECONDS", "60")),
            max_pending_tasks=int(os.getenv("MAX_PENDING_TASKS", "100")),
            cors_origin=os.getenv("CORS_ORIGIN", "http://localhost:5173"),
            audio_provider=os.getenv("AUDIO_PROVIDER", "mock"),
            tts_base_url=os.getenv("LOCAL_TTS_BASE_URL", "http://127.0.0.1:8001"),
            tts_engine_id=os.getenv("LOCAL_TTS_ENGINE_ID", "qwen3-customvoice"),
            tts_timeout_seconds=float(os.getenv("LOCAL_TTS_TIMEOUT_SECONDS", "300")),
            tts_chunk_chars=int(os.getenv("LOCAL_TTS_CHUNK_CHARS", "120")),
            tts_sample_rate=int(os.getenv("LOCAL_TTS_SAMPLE_RATE", "24000")),
            tts_turn_silence_ms=int(os.getenv("LOCAL_TTS_TURN_SILENCE_MS", "250")),
            ffmpeg_binary=os.getenv("FFMPEG_BINARY", "ffmpeg"),
            audio_encode_timeout_seconds=float(os.getenv("AUDIO_ENCODE_TIMEOUT_SECONDS", "60")),
            llm_provider=os.getenv("LLM_PROVIDER", "mock"),
            llm_base_url=os.getenv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:8002"),
            llm_model_id=os.getenv("LOCAL_LLM_MODEL_ID", "Qwen/Qwen2.5-0.5B-Instruct"),
            llm_timeout_seconds=float(os.getenv("LOCAL_LLM_TIMEOUT_SECONDS", "300")),
            llm_max_new_tokens=int(os.getenv("LOCAL_LLM_MAX_NEW_TOKENS", "1536")),
        )

    def __post_init__(self):
        if self.llm_provider not in ("mock", "local_http"):
            raise ValueError("LLM_PROVIDER 必须为 mock 或 local_http")
        llm_url = urlsplit(self.llm_base_url)
        if (llm_url.scheme not in ("http", "https") or not llm_url.hostname or llm_url.username
                or llm_url.password or llm_url.query or llm_url.fragment):
            raise ValueError("LOCAL_LLM_BASE_URL 必须为不含凭据、查询参数和 fragment 的 HTTP(S) 地址")
        if not self.llm_model_id.strip() or len(self.llm_model_id) > 128:
            raise ValueError("LOCAL_LLM_MODEL_ID 无效")
        if not math.isfinite(self.llm_timeout_seconds) or not 0 < self.llm_timeout_seconds <= 600:
            raise ValueError("LOCAL_LLM_TIMEOUT_SECONDS 必须为 0–600 秒内的有限正数")
        if not 128 <= self.llm_max_new_tokens <= 2048:
            raise ValueError("LOCAL_LLM_MAX_NEW_TOKENS 必须为128到2048")
        if self.development_user_id < 1:
            raise ValueError("DEVELOPMENT_USER_ID 必须为正整数")
        if self.poll_seconds <= 0 or self.lease_seconds < 5 or self.max_pending_tasks < 1:
            raise ValueError("轮询间隔必须为正，租约至少5秒，队列容量至少1")
        if self.audio_provider not in ("mock", "local_http"):
            raise ValueError("AUDIO_PROVIDER 必须为 mock 或 local_http")
        url = urlsplit(self.tts_base_url)
        if (url.scheme not in ("http", "https") or not url.hostname or url.username or url.password
                or url.query or url.fragment):
            raise ValueError("LOCAL_TTS_BASE_URL 必须是不含凭据、查询参数和 fragment 的 HTTP(S) 地址")
        if not self.tts_engine_id or len(self.tts_engine_id) > 100:
            raise ValueError("LOCAL_TTS_ENGINE_ID 无效")
        if not 1 <= self.tts_chunk_chars <= 1000 or not 8000 <= self.tts_sample_rate <= 48000 or not 0 <= self.tts_turn_silence_ms <= 5000:
            raise ValueError("TTS 分块、采样率或间隔配置无效")
        for value in (self.tts_timeout_seconds, self.audio_encode_timeout_seconds):
            if not math.isfinite(value) or not 0 < value <= 600:
                raise ValueError("TTS 和编码超时必须为 0–600 秒内的有限正数")
