"""本地 HTTP TTS 适配器测试；不需要数据库、GPU 或模型权重。"""

from copy import deepcopy
from email.message import Message
import io
import json
import shutil
import struct
import unittest
from urllib.error import HTTPError, URLError
import wave

from app.core.common import BusinessError
from app.integrations.local_tts import LocalTTSAudioGenerator, split_text


def config():
    return {"provider": "local_http", "base_url": "http://127.0.0.1:8001", "engine_id": "mock",
            "timeout_seconds": 1, "chunk_chars": 8, "sample_rate": 24000, "turn_silence_ms": 250,
            "ffmpeg_binary": "ffmpeg", "encode_timeout_seconds": 20}


def snapshot():
    def role(identifier, voice):
        return {"role_id": identifier, "voice_config": {"tts_provider": "local_http", "tts_model": "mock",
                                                        "voice_id": voice, "speed": 1.0, "extra_params": {}}}
    return {"script_simulated": True, "script": {"roles": [role(11, "host_a"), role(22, "host_b")],
            "sentences": [
                {"sentence_id": 2, "sequence": 2, "role_id": 22, "text": "这是第二位主持人。", "speed": None, "extra_params": {}},
                {"sentence_id": 1, "sequence": 1, "role_id": 11, "text": "你好，欢迎收听。我们开始。", "speed": None, "extra_params": {}},
            ]}}


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(struct.pack("<h", 1000) * 4000)
    return output.getvalue()


class Reply(io.BytesIO):
    def __init__(self, content, content_type="application/json"):
        super().__init__(content)
        self.headers = Message()
        self.headers["Content-Type"] = content_type


class FakeTTS:
    def __init__(self, fail_at=None, damaged=False):
        self.calls = []
        self.fail_at, self.damaged = fail_at, damaged

    def open(self, request, timeout):
        if request.full_url.endswith("/v1/engines"):
            return Reply(json.dumps({"engines": [{"engine_id": "mock", "installed": True,
                          "supports_speed": False, "max_text_length": 7}]}).encode())
        if "/v1/voices?" in request.full_url:
            return Reply(b'{"voices":["low","high"],"aliases":{"host_a":"low","host_b":"high"}}')
        payload = json.loads(request.data)
        self.calls.append(payload)
        if self.fail_at == len(self.calls):
            raise HTTPError(request.full_url, 503, "busy", {}, io.BytesIO(b'{"error":{"code":"engine_busy","message":"secret path"}}'))
        return Reply(b"not a wav" if self.damaged else wav_bytes(), "audio/wav")


class LocalTTSTests(unittest.TestCase):
    def test_chunking_retains_text(self):
        text = "第一句。 第二句很长，没有更多句号但也不能遗漏！\n下一句。"
        for limit in (1, 7, 120):
            if limit == 1:  # 不允许纯空白独立片段。
                with self.assertRaises(BusinessError):
                    split_text(text, limit)
                continue
            chunks = split_text(text, limit)
            self.assertEqual("".join(chunks), text)
            self.assertTrue(all(len(chunk) <= limit for chunk in chunks))

    @unittest.skipUnless(shutil.which("ffmpeg"), "需要 FFmpeg（不需要模型）")
    def test_order_chunking_resampling_and_mp3_decode(self):
        upstream = FakeTTS()
        generator = LocalTTSAudioGenerator(config(), upstream)
        original = snapshot()
        before = deepcopy(original)
        result = generator.generate(original)
        self.assertEqual(original, before)
        self.assertEqual("".join(p["text"] for p in upstream.calls if p["voice_id"] == "host_a"), before["script"]["sentences"][1]["text"])
        self.assertEqual("".join(p["text"] for p in upstream.calls if p["voice_id"] == "host_b"), before["script"]["sentences"][0]["text"])
        self.assertEqual([p["voice_id"] for p in upstream.calls], sorted([p["voice_id"] for p in upstream.calls]))
        self.assertTrue(all(len(p["text"]) <= 7 for p in upstream.calls))
        self.assertTrue(result.content.startswith(b"ID3") or result.content.startswith(b"\xff"))
        self.assertTrue(result.metadata["simulated"])
        self.assertFalse(result.metadata["real_speech"])
        self.assertEqual(result.metadata["sample_rate"], 24000)
        self.assertEqual(result.metadata["sentence_count"], 2)
        self.assertEqual(result.metadata["chunk_count"], len(upstream.calls))
        expected_ms = len(upstream.calls) * 250 + 250
        self.assertGreaterEqual(result.duration_ms, expected_ms)
        self.assertLess(result.duration_ms - expected_ms, 150)

    @unittest.skipUnless(shutil.which("ffmpeg"), "需要 FFmpeg")
    def test_unsupported_role_speed_and_parameters_fail_before_synthesis(self):
        for field, value in (("tts_provider", "mock"), ("tts_model", "different"),
                             ("voice_id", "missing"), ("speed", 1.2), ("style", "happy"),
                             ("extra_params", {"reference_audio": "private.wav"})):
            data = snapshot()
            data["script"]["roles"][0]["voice_config"][field] = value
            upstream = FakeTTS()
            with self.subTest(field=field), self.assertRaises(BusinessError):
                LocalTTSAudioGenerator(config(), upstream).generate(data)
            self.assertEqual(upstream.calls, [])

    @unittest.skipUnless(shutil.which("ffmpeg"), "需要 FFmpeg")
    def test_upstream_error_propagates_without_mock_fallback(self):
        upstream = FakeTTS(fail_at=2)
        with self.assertRaises(BusinessError) as caught:
            LocalTTSAudioGenerator(config(), upstream).generate(snapshot())
        self.assertEqual(caught.exception.code, "TTS_ENGINE_BUSY")
        self.assertNotIn("secret", caught.exception.message)
        self.assertEqual(len(upstream.calls), 2)

    @unittest.skipUnless(shutil.which("ffmpeg"), "需要 FFmpeg")
    def test_damaged_wav_is_not_published(self):
        with self.assertRaises(BusinessError) as caught:
            LocalTTSAudioGenerator(config(), FakeTTS(damaged=True)).generate(snapshot())
        self.assertEqual(caught.exception.code, "TTS_INVALID_AUDIO")

    def test_timeout_and_connection_errors_have_distinct_codes(self):
        class Broken:
            def __init__(self, reason):
                self.reason = reason
            def open(self, *_args, **_kwargs):
                raise URLError(self.reason)
        for reason, expected in ((TimeoutError(), "TTS_TIMEOUT"), (OSError(), "TTS_UNAVAILABLE")):
            with self.subTest(code=expected), self.assertRaises(BusinessError) as caught:
                LocalTTSAudioGenerator(config(), Broken(reason))._request("/v1/engines")
            self.assertEqual(caught.exception.code, expected)

    def test_missing_encoder_is_explicit(self):
        options = {**config(), "ffmpeg_binary": "missing-ffmpeg-for-test"}
        with self.assertRaises(BusinessError) as caught:
            LocalTTSAudioGenerator(options, FakeTTS()).generate(snapshot())
        self.assertEqual(caught.exception.code, "TTS_ENCODER_UNAVAILABLE")

    def test_credentials_in_url_rejected(self):
        with self.assertRaises(BusinessError):
            LocalTTSAudioGenerator({**config(), "base_url": "http://user:password@localhost:8001"})


if __name__ == "__main__":
    unittest.main()
