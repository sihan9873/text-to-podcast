"""无权重测试：替代 SDK；验证适配器参数、离线加载与失败恢复。"""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from tts_service.app import validate_audio
from tts_service.engine import EngineError
from tts_service.qwen import Qwen3Engine, QwenConfig, _pcm_wav


class QwenTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name)
        config = {"tts_model_type": "custom_voice", "tts_model_size": "0b6",
                  "talker_config": {"spk_id": {"vivian": 1, "uncle_fu": 2}}}
        (self.path / "config.json").write_text(json.dumps(config))
        self.engine = Qwen3Engine(QwenConfig(self.path, device="cpu", dtype="float32"))

    def test_local_discovery_and_missing_weights(self):
        with patch("tts_service.qwen.importlib.util.find_spec", return_value=object()):
            self.assertFalse(self.engine.info().installed)
            self.assertIn("不完整", self.engine.info().availability_reason)
        self.assertEqual(self.engine.list_voices(), ["uncle_fu", "vivian"])
        self.assertFalse(self.engine.info().loaded)

    def test_base_is_rejected(self):
        (self.path / "config.json").write_text('{"tts_model_type":"base"}')
        self.assertEqual(self.engine.list_voices(), [])
        self.assertFalse(self.engine.info().installed)

    def test_invalid_configuration(self):
        for change in ({"device": "mps"}, {"device": "cuda"}, {"device": "cpu", "dtype": "float16"},
                       {"dtype": "nonsense"}, {"max_new_tokens": 0}, {"max_text_chars": 1001}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                QwenConfig(self.path, **change)

    def test_lazy_load_reused_and_generation_parameters(self):
        model = Mock()
        model.generate_custom_voice.return_value = ([[0.0, 0.2, -0.2]], 24000)
        with patch.object(self.engine, "_availability", return_value=None), patch.object(self.engine, "_load_model", return_value=model) as load:
            self.engine.info()
            self.engine.list_voices()
            load.assert_not_called()
            for voice in ("vivian", "uncle_fu"):
                result = self.engine.synthesize("你好。", voice)
                validate_audio(result, voice)
            load.assert_called_once()
            model.generate_custom_voice.assert_called_with(text="你好。", speaker="uncle_fu", language="Chinese", non_streaming_mode=True, max_new_tokens=1024)
            self.assertTrue(self.engine.info().loaded)

    def test_reject_input_before_loading(self):
        for args, code in [(("", "vivian"), "invalid_text"), (("中" * 121, "vivian"), "invalid_text"),
                           (("好", "missing"), "unknown_voice"), (("好", "vivian", 1.5), "unsupported_feature")]:
            with self.subTest(args=args), self.assertRaises(EngineError) as caught:
                self.engine.synthesize(*args)
            self.assertEqual(caught.exception.code, code)
        self.assertIsNone(self.engine._model)

    def test_busy_and_failed_load_can_retry(self):
        self.engine._lock.acquire()
        with self.assertRaises(EngineError) as caught:
            self.engine.synthesize("你好", "vivian")
        self.assertEqual(caught.exception.code, "engine_busy")
        self.engine._lock.release()
        with patch.object(self.engine, "_availability", return_value=None), patch.object(self.engine, "_load_model", side_effect=RuntimeError("secret")):
            for _ in range(2):
                with self.assertRaises(EngineError) as caught:
                    self.engine.synthesize("你好", "vivian")
                self.assertEqual(caught.exception.code, "model_load_failed")
                self.assertIsNone(self.engine._model)
                self.assertFalse(self.engine._lock.locked())

    def test_out_of_memory_and_generation_failure(self):
        class OutOfMemoryError(RuntimeError):
            pass

        for failure, code in ((MemoryError(), "out_of_memory"), (OutOfMemoryError(), "out_of_memory"), (RuntimeError(), "synthesis_failed")):
            self.engine._model = Mock()
            self.engine._model.generate_custom_voice.side_effect = failure
            with self.subTest(code=code), self.assertRaises(EngineError) as caught:
                self.engine.synthesize("你好", "vivian")
            self.assertEqual(caught.exception.code, code)
            self.assertFalse(self.engine._lock.locked())

    def test_pcm_rejects_invalid_data(self):
        for samples, rate in (([[]], 24000), ([[float("nan")]], 24000), ([[float("inf")]], 24000), ([], 24000), ([[0]], 0)):
            with self.subTest(samples=samples), self.assertRaises(EngineError):
                _pcm_wav(samples, rate, "vivian")

    def test_sdk_loader_uses_local_path_and_offline_flags(self):
        torch = Mock()
        sdk = Mock()
        sdk.Qwen3TTSModel.from_pretrained.return_value.get_supported_speakers.return_value = ["vivian", "uncle_fu"]
        with patch.dict("sys.modules", {"torch": torch, "qwen_tts": sdk}), patch.dict(os.environ):
            self.engine._load_model()
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(os.environ["HF_HUB_DISABLE_TELEMETRY"], "1")
        kwargs = sdk.Qwen3TTSModel.from_pretrained.call_args
        self.assertEqual(kwargs.args, (str(self.path),))
        self.assertTrue(kwargs.kwargs["local_files_only"])
        self.assertEqual(kwargs.kwargs["attn_implementation"], "sdpa")

    def test_unavailable_cuda_does_not_load_weights(self):
        engine = Qwen3Engine(QwenConfig(self.path))
        torch = Mock()
        torch.cuda.is_available.return_value = False
        sdk = Mock()
        with patch.dict("sys.modules", {"torch": torch, "qwen_tts": sdk}), patch.dict(os.environ):
            with self.assertRaises(EngineError) as caught:
                engine._load_model()
            self.assertEqual(caught.exception.code, "unsupported_device")
            sdk.Qwen3TTSModel.from_pretrained.assert_not_called()

    def test_configured_service_aliases_and_boundaries(self):
        from fastapi.testclient import TestClient
        from tts_service.configured import configured_app

        model = Mock()
        model.generate_custom_voice.return_value = ([[0.0, 0.2, -0.2]], 24000)
        with patch.dict(os.environ, {"TTS_ENABLE_QWEN": "1", "TTS_QWEN_MODEL_PATH": str(self.path),
                                    "TTS_QWEN_DEVICE": "cpu", "TTS_QWEN_DTYPE": "float32"}), \
             patch.object(Qwen3Engine, "_availability", return_value=None), \
             patch.object(Qwen3Engine, "_load_model", return_value=model) as load, \
             TestClient(configured_app()) as client:
            self.assertEqual(client.get("/health").status_code, 200)
            voices = client.get("/v1/voices?engine_id=qwen3-customvoice").json()
            self.assertEqual(voices["aliases"], {"host_a": "vivian", "host_b": "uncle_fu"})
            load.assert_not_called()
            payload = {"engine_id": "qwen3-customvoice", "text": "你好。", "voice_id": "host_a"}
            self.assertEqual(client.post("/v1/synthesize", json={**payload, "text": "中" * 121}).status_code, 422)
            load.assert_not_called()
            for alias, voice in (("host_a", "vivian"), ("host_b", "uncle_fu")):
                result = client.post("/v1/synthesize", json={**payload, "voice_id": alias})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(model.generate_custom_voice.call_args.kwargs["speaker"], voice)
            load.assert_called_once()


if __name__ == "__main__":
    unittest.main()
