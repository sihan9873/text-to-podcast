"""无需模型、CUDA 或网络；兼容 pytest 与标准库 unittest。"""

from dataclasses import replace
import io
import subprocess
import sys
import unittest
import wave

from fastapi.testclient import TestClient

from tts_service.app import create_app
from tts_service.engine import AudioResult, EngineError
from tts_service.mock import MockEngine


PAYLOAD = {"text": "欢迎收听今天的科技播客。", "engine_id": "mock", "voice_id": "host_a"}


class TTSTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(), raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def test_health_without_any_engine(self):
        with TestClient(create_app({})) as client:
            self.assertEqual(client.get("/health").json(), {"status": "ok"})
            self.assertEqual(client.get("/v1/engines").json(), {"engines": []})

    def test_import_and_health_do_not_import_models(self):
        subprocess.run([sys.executable, "-c", """
import sys
from fastapi.testclient import TestClient
from tts_service.app import app
with TestClient(app) as client:
    assert client.get('/health').status_code == 200
    assert client.get('/v1/engines').status_code == 200
    assert client.get('/v1/voices?engine_id=mock').status_code == 200
assert not any(name in sys.modules for name in ('torch', 'qwen_tts', 'transformers'))
"""], check=True)

    def test_discovery(self):
        info = self.client.get("/v1/engines").json()["engines"][0]
        self.assertEqual(info["engine_id"], "mock")
        self.assertTrue(info["installed"])
        self.assertTrue(info["loaded"])
        self.assertEqual(info["supported_devices"], ["cpu"])
        self.assertFalse(info["supports_speed"])
        self.assertFalse(info["supports_cloning"])
        voices = self.client.get("/v1/voices?engine_id=mock").json()
        self.assertEqual(voices["aliases"], {"host_a": "tone_low", "host_b": "tone_high"})

    def test_synthesis_is_decodable_deterministic_and_voice_specific(self):
        first = self.client.post("/v1/synthesize", json=PAYLOAD)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers["content-type"], "audio/wav")
        self.assertEqual(first.content, self.client.post("/v1/synthesize", json=PAYLOAD).content)
        self.assertNotEqual(first.content, self.client.post("/v1/synthesize", json={**PAYLOAD, "voice_id": "host_b"}).content)
        self.assertEqual(first.content, self.client.post("/v1/synthesize", json={**PAYLOAD, "voice_id": "tone_low"}).content)
        with wave.open(io.BytesIO(first.content), "rb") as audio:
            self.assertEqual((audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.getnframes()), (16000, 1, 2, 4000))
            self.assertEqual(len(audio.readframes(4000)), 8000)

    def test_invalid_requests(self):
        changes = [
            {"text": ""}, {"text": " \n\t"}, {"text": "中" * 1001}, {"text": 123},
            {"text": None}, {"voice_id": "missing"}, {"speed": 0}, {"speed": -1},
            {"speed": "1.0"}, {"speed": True}, {"speed": 1.2}, {"output_type": "mp3"},
            {"reference_audio": "private.wav"}, {"device": "cuda"}, {"engine_id": ""},
        ]
        for change in changes:
            with self.subTest(change=change):
                response = self.client.post("/v1/synthesize", json={**PAYLOAD, **change})
                self.assertEqual(response.status_code, 422)
                self.assertIn("code", response.json()["error"])
        self.assertEqual(self.client.get("/v1/voices").status_code, 422)
        self.assertEqual(self.client.post("/v1/synthesize", json={}).status_code, 422)
        for body in ('{"speed": NaN}', '{"speed": Infinity}', '{bad json'):
            response = self.client.post("/v1/synthesize", content=body, headers={"Content-Type": "application/json"})
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_unknown_engine(self):
        for response in (
            self.client.get("/v1/voices?engine_id=qwen3-customvoice"),
            self.client.post("/v1/synthesize", json={**PAYLOAD, "engine_id": "qwen3-customvoice"}),
        ):
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json()["error"]["code"], "unknown_engine")

    def test_lazy_engine_and_configured_aliases(self):
        class LazyEngine(MockEngine):
            loaded = False

            def info(self):
                return replace(super().info(), engine_id="other", loaded=self.loaded)

            def synthesize(self, text, voice_id, speed=1.0):
                self.loaded = True
                assert text == PAYLOAD["text"]
                return super().synthesize(text, voice_id, speed)

        engine = LazyEngine()
        with TestClient(create_app({"other": engine}, {"other": {"host_a": "tone_high"}})) as client:
            client.get("/health")
            client.get("/v1/engines")
            client.get("/v1/voices?engine_id=other")
            self.assertFalse(engine.loaded)
            response = client.post("/v1/synthesize", json={**PAYLOAD, "engine_id": "other"})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(engine.loaded)

    def test_engine_failures_and_invalid_audio(self):
        valid = MockEngine().synthesize("测试", "tone_low")
        cases = [
            (EngineError("model_load_failed", "模型加载失败。"), 503, "model_load_failed"),
            (MemoryError(), 503, "out_of_memory"),
            (RuntimeError("private path"), 500, "synthesis_failed"),
            (AudioResult(b"not wav", 16000, "tone_low"), 500, "invalid_audio"),
            (replace(valid, sample_rate=24000), 500, "invalid_audio"),
            (replace(valid, voice_id="tone_high"), 500, "invalid_audio"),
            (replace(valid, wav_bytes=valid.wav_bytes[:-10]), 500, "invalid_audio"),
        ]
        for outcome, status, code in cases:
            class BrokenEngine(MockEngine):
                def synthesize(self, *args):
                    if isinstance(outcome, Exception):
                        raise outcome
                    return outcome

            with self.subTest(code=code), TestClient(create_app({"mock": BrokenEngine()})) as client:
                response = client.post("/v1/synthesize", json=PAYLOAD)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()["error"]["code"], code)
                self.assertNotIn("private path", response.text)

    def test_unavailable_engine(self):
        class UnavailableEngine(MockEngine):
            def info(self):
                return replace(super().info(), installed=False, loaded=False)

            def synthesize(self, *args):
                raise AssertionError("不可用引擎不应被调用")

        with TestClient(create_app({"mock": UnavailableEngine()})) as client:
            self.assertEqual(client.get("/health").status_code, 200)
            self.assertFalse(client.get("/v1/engines").json()["engines"][0]["installed"])
            for response in (client.get("/v1/voices?engine_id=mock"), client.post("/v1/synthesize", json=PAYLOAD)):
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["error"]["code"], "engine_unavailable")

    def test_openapi_describes_wav(self):
        schema = self.client.get("/openapi.json").json()
        content = schema["paths"]["/v1/synthesize"]["post"]["responses"]["200"]["content"]
        self.assertIn("audio/wav", content)


if __name__ == "__main__":
    unittest.main()
