"""与模型无关的同步接口。适配器应在首次 synthesize 时加载权重。

适配器负责将 SDK 的加载、OOM 等异常转换为 EngineError，禁止自动下载。
list_voices 和 info 不应触发模型加载。音色别名在服务边界解析。
"""

from dataclasses import dataclass
from typing import Protocol


class EngineError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 503):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class EngineInfo:
    engine_id: str
    installed: bool
    loaded: bool
    supported_devices: tuple[str, ...]
    device: str
    supports_speed: bool = False
    supports_cloning: bool = False
    availability_reason: str | None = None
    max_text_length: int = 1000


@dataclass(frozen=True)
class AudioResult:
    wav_bytes: bytes
    sample_rate: int
    voice_id: str


class TTSEngine(Protocol):
    def info(self) -> EngineInfo: ...

    def list_voices(self) -> list[str]: ...

    def synthesize(
        self, text: str, voice_id: str, speed: float = 1.0
    ) -> AudioResult: ...
