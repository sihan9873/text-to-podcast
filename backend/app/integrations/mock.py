"""可替换的模拟服务：默认各等待 10 秒，不调用 LLM 或真实 TTS。"""
import json
from pathlib import Path
import time

from app.integrations.contracts import GeneratedAudio, GeneratedScript

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


class MockScriptGenerator:
    def __init__(self, delay_seconds=10):
        self.delay_seconds = delay_seconds

    def generate(self, snapshot):
        time.sleep(self.delay_seconds)  # 正常启动时为 time.sleep(10)，仅自动测试注入0。
        template = json.loads((FIXTURES / "test_script.json").read_text(encoding="utf-8"))
        lines = template["sentences"]
        roles = snapshot["roles"]
        # 固定测试台词，只按请求分配角色，绝不冒充根据原文生成。
        template["sentences"] = [
            {"role_key": roles[i % len(roles)]["role_key"], "text": lines[i % len(lines)]["text"]}
            for i in range(max(len(lines), len(roles)))
        ]
        return GeneratedScript.model_validate(template)


class MockAudioGenerator:
    def __init__(self, delay_seconds=10):
        self.delay_seconds = delay_seconds

    def generate(self, snapshot):
        time.sleep(self.delay_seconds)  # 正常启动时为 time.sleep(10)。
        content = (FIXTURES / "test_audio.mp3").read_bytes()
        info = json.loads((FIXTURES / "test_audio.metadata.json").read_text(encoding="utf-8"))
        return GeneratedAudio(content, info["duration_ms"], {
            **info, "simulated": True, "real_speech": False,
            "message": "固定的三秒测试音，不是脚本正文朗读，也未实际执行分句TTS或音频拼接。",
            "sentence_count": len(snapshot["script"]["sentences"]),
        })
