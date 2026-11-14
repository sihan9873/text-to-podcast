"""标准库实现的确定性测试音调，不生成可理解的语音。"""

import io
import math
import struct
import wave

from .engine import AudioResult, EngineError, EngineInfo


class MockEngine:
    sample_rate = 16000

    def info(self) -> EngineInfo:
        return EngineInfo("mock", True, True, ("cpu",), "cpu")

    def list_voices(self) -> list[str]:
        return ["tone_low", "tone_high"]

    def synthesize(
        self, text: str, voice_id: str, speed: float = 1.0
    ) -> AudioResult:
        if not text.strip():
            raise EngineError("invalid_text", "文本不能为空。", 422)
        if voice_id not in self.list_voices():
            raise EngineError("unknown_voice", "未知音色。", 422)
        if speed != 1.0:
            raise EngineError("unsupported_feature", "Mock 不支持语速控制。", 422)
        frequency = 440 if voice_id == "tone_low" else 660
        frames = b"".join(
            struct.pack("<h", round(4000 * math.sin(2 * math.pi * frequency * i / self.sample_rate)))
            for i in range(self.sample_rate // 4)
        )
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(self.sample_rate)
            audio.writeframes(frames)
        return AudioResult(output.getvalue(), self.sample_rate, voice_id)
