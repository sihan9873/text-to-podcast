from dataclasses import replace
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from tts_service.app import create_app
from tts_service.engine import EngineError
from tts_service.qwen import QwenConfig
from tts_service.qwen_base import Qwen3BaseEngine


class Model:
    prompts = 0
    calls = 0

    def create_voice_clone_prompt(self, **kwargs):
        self.prompts += 1
        assert kwargs['x_vector_only_mode'] is False
        return object()

    def generate_voice_clone(self, **kwargs):
        self.calls += 1
        return [[0.1] * 240], 24000


class FakeBase(Qwen3BaseEngine):
    def _availability(self):
        return None

    def _reference(self, key, digest):
        return ([0.1], 24000)

    def _load_model(self):
        return Model()


class CloneTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'config.json').write_text(json.dumps({'tts_model_type': 'base', 'tts_model_size': '0b6'}))
        (self.root / 'model.safetensors').write_bytes(b'test-placeholder-not-a-model')
        self.engine = FakeBase(QwenConfig(self.root), self.root)

    def payload(self):
        return {'text': '测试文本。', 'voice_id': 'clone_1', 'reference_key': 'a' * 64 + '.wav',
                'reference_sha256': 'a' * 64, 'reference_text': '录音原话。', 'model_revision': self.engine.revision()}

    def test_lazy_model_prompt_reuse_and_voice_isolation(self):
        assert not self.engine.info().loaded
        assert self.engine.info().supports_cloning
        first = self.engine.clone(**self.payload())
        self.engine.clone(**self.payload())
        assert first.wav_bytes.startswith(b'RIFF')
        assert self.engine._model.prompts == 1 and self.engine._model.calls == 2
        self.engine.clone(**{**self.payload(), 'voice_id': 'clone_2'})
        assert self.engine._model.prompts == 2

    def test_reject_changed_model_empty_transcript_and_busy(self):
        for changes in ({'model_revision': 'b' * 64}, {'reference_text': ' '}, {'text': ' '}, {'text': '中' * 121}):
            with self.assertRaises(EngineError):
                self.engine.clone(**{**self.payload(), **changes})
        self.engine._lock.acquire()
        with self.assertRaises(EngineError) as caught:
            self.engine.clone(**self.payload())
        self.assertEqual(caught.exception.code, 'engine_busy')
        self.engine._lock.release()

    def test_paths_and_audio_hash_are_validated(self):
        engine = Qwen3BaseEngine(QwenConfig(self.root), self.root)
        for key, digest in [('../private.wav', 'a' * 64), ('a' * 64 + '.wav', 'a' * 64)]:
            with self.assertRaises(EngineError):
                engine._reference(key, digest)
        (self.root / ('a' * 64 + '.wav')).write_bytes(b'changed')
        with self.assertRaises(EngineError) as caught:
            engine._reference('a' * 64 + '.wav', 'a' * 64)
        self.assertEqual(caught.exception.code, 'reference_changed')

    def test_endpoint_requires_internal_token_and_preserves_old_contract(self):
        with patch.dict('os.environ', {'TTS_INTERNAL_TOKEN': 'internal-test-only'}):
            with TestClient(create_app({'qwen3-base': self.engine})) as client:
                assert client.post('/v1/clone', json=self.payload()).status_code == 401
                response = client.post('/v1/clone', json=self.payload(), headers={'Authorization': 'Bearer internal-test-only'})
                assert response.status_code == 200, response.text
                assert response.headers['content-type'] == 'audio/wav'
                assert client.post('/v1/synthesize', json={'engine_id': 'qwen3-base', 'voice_id': 'clone_1', 'text': '内容'}).status_code == 422

    def test_customvoice_and_missing_model_are_rejected_offline(self):
        engine = Qwen3BaseEngine(QwenConfig(self.root), self.root)
        (self.root / 'config.json').write_text(json.dumps({'tts_model_type': 'custom_voice', 'tts_model_size': '0b6'}))
        assert engine._local_config() is None
        assert not engine.info().installed

    def test_model_replacement_requires_restart_and_cache_is_bounded(self):
        for i in range(1, 11):
            self.engine.clone(**{**self.payload(), 'voice_id': f'clone_{i}'})
        self.assertEqual(len(self.engine._prompts), 8)
        (self.root / 'model.safetensors').write_bytes(b'replaced-model-placeholder')
        with self.assertRaises(EngineError) as caught:
            self.engine.clone(**self.payload())
        self.assertEqual(caught.exception.code, 'model_changed')


if __name__ == '__main__':
    unittest.main()
