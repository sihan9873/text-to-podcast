import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from llm_service.app import GenerateRequest, MODEL_ID, QwenGenerator, Role, ServiceError, parse_script


class ServiceTests(unittest.TestCase):
    def test_import_does_not_import_models(self):
        subprocess.run([sys.executable, "-c", "import sys; from llm_service.app import app; assert 'torch' not in sys.modules; assert 'transformers' not in sys.modules"], check=True)

    def test_unavailable_model_never_downloads(self):
        with patch.dict(os.environ, {"LLM_MODEL_PATH": "/tmp/nonexistent-podcast-llm-model"}):
            engine = QwenGenerator()
        self.assertFalse(engine.info()["installed"])
        self.assertIsNone(engine.model)
        with self.assertRaises(ServiceError) as caught:
            engine._load()
        self.assertEqual(caught.exception.code, "model_unavailable")

    def test_script_parser_rejects_incomplete_or_wrong_roles(self):
        roles = [Role(role_key="a", name="A"), Role(role_key="b", name="B")]
        script = {"title": "早餐", "summary": "早餐介绍", "sentences": [
            {"role_key": "a", "text": "你好"}, {"role_key": "b", "text": "早上好"}]}
        self.assertEqual(parse_script("```json\n" + json.dumps(script) + "\n```", roles), script)
        partial = {**script, "sentences": script["sentences"][:1]}
        self.assertEqual(parse_script(json.dumps(partial), roles, require_all_roles=False), partial)
        for value in (json.dumps(script)[:-2], "前言" + json.dumps(script),
                      json.dumps(partial),
                      json.dumps({**script, "unexpected": 1})):
            with self.assertRaises(ServiceError):
                parse_script(value, roles)

    def test_busy_engine(self):
        engine = QwenGenerator()
        engine.lock.acquire()
        try:
            with self.assertRaises(ServiceError) as caught:
                engine.generate(None)
            self.assertEqual(caught.exception.code, "engine_busy")
        finally:
            engine.lock.release()

    def test_invalid_request(self):
        for source in (" ", "a" * 5001):
            with self.assertRaises(ValueError):
                GenerateRequest(model_id=MODEL_ID, source_text=source, roles=[{"role_key": "a", "name": "A"}], system_prompt="脚本")


if __name__ == "__main__":
    unittest.main()
