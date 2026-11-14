"""显式开启的真实模型测试；首次加载可能需要数分钟及大量 RAM/VRAM。"""

import os
from pathlib import Path
import unittest


@unittest.skipUnless(os.environ.get("TTS_RUN_QWEN_INTEGRATION") == "1", "需明确批准后显式设置 TTS_RUN_QWEN_INTEGRATION=1")
class QwenIntegrationTests(unittest.TestCase):
    def test_two_chinese_voices(self):
        from tts_service.app import validate_audio
        from tts_service.qwen import Qwen3Engine, QwenConfig

        engine = Qwen3Engine(QwenConfig.from_env())
        folder = Path("outputs/qwen-smoke")
        folder.mkdir(parents=True, exist_ok=True)
        for voice, text in (("vivian", "欢迎收听今天的科技播客。"), ("uncle_fu", "今天我们聊聊人工智能。")):
            result = engine.synthesize(text, voice)
            validate_audio(result, voice)
            self.assertGreater(len(result.wav_bytes), 44)
            # 不覆盖已有用户输出。
            import uuid
            with (folder / f"{voice}_{uuid.uuid4().hex}.wav").open("xb") as output:
                output.write(result.wav_bytes)


try:
    import pytest
except ImportError:
    pass
else:
    QwenIntegrationTests = pytest.mark.integration(QwenIntegrationTests)
