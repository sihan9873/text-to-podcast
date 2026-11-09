import os
import unittest
from unittest.mock import patch

from app.core.config import Settings


class LocalTTSSettingsTests(unittest.TestCase):
    def test_default_remains_mock(self):
        settings = Settings()
        self.assertEqual(settings.audio_provider, "mock")
        self.assertEqual(settings.tts_base_url, "http://127.0.0.1:8001")

    def test_environment_parsing(self):
        with patch.dict(os.environ, {"AUDIO_PROVIDER": "local_http", "LOCAL_TTS_ENGINE_ID": "mock",
                                     "LOCAL_TTS_CHUNK_CHARS": "80", "LOCAL_TTS_TIMEOUT_SECONDS": "30"}):
            settings = Settings.from_env()
        self.assertEqual(settings.audio_provider, "local_http")
        self.assertEqual(settings.tts_engine_id, "mock")
        self.assertEqual(settings.tts_chunk_chars, 80)
        self.assertEqual(settings.tts_timeout_seconds, 30)

    def test_bad_configuration_rejected(self):
        for change in ({"audio_provider": "unknown"}, {"tts_base_url": "ftp://localhost"},
                       {"tts_base_url": "http://user:secret@localhost"}, {"tts_timeout_seconds": float("nan")},
                       {"tts_timeout_seconds": 0}, {"tts_chunk_chars": 0}, {"tts_sample_rate": 1},
                       {"tts_turn_silence_ms": -1}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                Settings(**change)
