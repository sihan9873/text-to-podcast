import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from llm_service.app import GenerateRequest, MODEL_ID, QwenGenerator, Role, ServiceError, generation_messages, parse_script


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

    def test_prompt_separates_role_metadata_from_sentence_schema(self):
        request = GenerateRequest(model_id=MODEL_ID, source_text="Transformer 使用多头注意力。",
            roles=[{"role_key": "role_1", "name": "主持人", "description": "本地语音"}], system_prompt="根据素材创作")
        messages = generation_messages(request)
        self.assertEqual([m["role"] for m in messages], ["system", "user"])
        self.assertIn('role_1', messages[-1]["content"])
        self.assertIn(request.source_text, messages[-1]["content"])
        self.assertNotIn('"name":', messages[-1]["content"])
        self.assertNotIn("活动免费", "".join(m["content"] for m in messages))

    def test_role_metadata_is_not_accepted_as_spoken_text(self):
        raw = json.dumps({"title": "标题", "summary": "摘要", "sentences": [
            {"role_key": "role_1", "name": "主持人", "description": "本地语音"}]})
        with self.assertRaises(ServiceError) as caught:
            parse_script(raw, [Role(role_key="role_1", name="主持人")])
        self.assertEqual(caught.exception.code, "invalid_response")
        self.assertIn("text", caught.exception.message)

    def test_invalid_request(self):
        for source in (" ", "a" * 5001):
            with self.assertRaises(ValueError):
                GenerateRequest(model_id=MODEL_ID, source_text=source, roles=[{"role_key": "a", "name": "A"}], system_prompt="脚本")


if __name__ == "__main__":
    unittest.main()


class MultiModelTests(unittest.TestCase):
    def test_large_model_request_and_sharded_installation(self):
        import tempfile
        from llm_service.app import LARGE_MODEL_ID
        request = GenerateRequest(model_id=LARGE_MODEL_ID, source_text="写一期科学播客", roles=[{"role_key": "a", "name": "A"}], system_prompt="脚本")
        self.assertEqual(request.model_id, LARGE_MODEL_ID)
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {"LLM_4B_MODEL_PATH": folder}):
                engine = QwenGenerator(LARGE_MODEL_ID)
            for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "model-00001-of-00002.safetensors"):
                (Path(folder) / name).write_text("{}")
            (Path(folder) / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"a": "model-00001-of-00002.safetensors", "b": "model-00002-of-00002.safetensors"}}))
            self.assertFalse(engine.info()["installed"])
            (Path(folder) / "model-00002-of-00002.safetensors").write_text("weights")
            self.assertTrue(engine.info()["installed"])
            self.assertEqual(engine.info()["model_id"], LARGE_MODEL_ID)
