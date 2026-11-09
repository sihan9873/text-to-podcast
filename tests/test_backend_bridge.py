"""当前 TTS ASGI 服务 → 组员后端适配器 → 可解码 MP3；不需要网络监听或模型。"""

from email.message import Message
import io
import json
from pathlib import Path
import shutil
import sys
import unittest
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tts"))
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient
from tts_service.app import create_app
from app.integrations.local_tts import LocalTTSAudioGenerator


@unittest.skipUnless(shutil.which("ffmpeg"), "需要 FFmpeg")
class BackendBridgeTests(unittest.TestCase):
    def test_actual_mock_service_to_backend_mp3(self):
        class Reply(io.BytesIO):
            pass

        with TestClient(create_app()) as client:
            class ASGIOpener:
                def open(self, request, timeout):
                    response = client.request(request.get_method(), request.full_url, content=request.data, headers=dict(request.header_items()))
                    if response.status_code >= 400:
                        raise HTTPError(request.full_url, response.status_code, "error", {}, io.BytesIO(response.content))
                    reply = Reply(response.content)
                    reply.headers = Message()
                    reply.headers["Content-Type"] = response.headers["content-type"]
                    return reply

            generator = LocalTTSAudioGenerator({"base_url": "http://testserver", "engine_id": "mock",
                "timeout_seconds": 5, "chunk_chars": 120, "sample_rate": 24000,
                "turn_silence_ms": 250, "ffmpeg_binary": "ffmpeg", "encode_timeout_seconds": 20}, ASGIOpener())
            result = generator.generate({"script": {"roles": [
                {"role_id": 1, "voice_config": {"tts_provider": "local_http", "tts_model": "mock", "voice_id": "host_a"}},
                {"role_id": 2, "voice_config": {"tts_provider": "local_http", "tts_model": "mock", "voice_id": "host_b"}},
            ], "sentences": [
                {"sequence": 1, "role_id": 1, "text": "欢迎收听。"},
                {"sequence": 2, "role_id": 2, "text": "我们开始今天的讨论。"},
            ]}})
            self.assertGreater(len(result.content), 1000)
            self.assertTrue(result.metadata["simulated"])
            self.assertEqual(result.metadata["chunk_count"], 2)
            self.assertGreaterEqual(result.duration_ms, 750)
            self.assertLess(result.duration_ms, 900)
            json.dumps(result.metadata)
