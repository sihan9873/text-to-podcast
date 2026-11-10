"""HTTP 协议和数据库 Worker 集成，不使用真实模型。"""
from dataclasses import replace
from email.message import Message
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from sqlalchemy import select

from app.bootstrap import initialize
from app.core.common import BusinessError
from app.core.config import Settings
from app.db.database import Database
from app.db.models import LLMModel, Project, Script, Task
from app.db.seed import ROLE_ID
from app.integrations.local_llm import LocalLLMScriptGenerator, SYSTEM_PROMPT
from app.jobs.repository import submit
from app.schemas import ScriptGenerate
from app.services.projects import create_project, submit_source
from app.worker import Worker


SCRIPT = {"title": "早餐建议", "summary": "介绍早餐", "sentences": [{"role_key": "host", "text": "今天聊聊早餐。"}]}


class Reply(io.BytesIO):
    def __init__(self, value):
        super().__init__(json.dumps(value, ensure_ascii=False).encode())
        self.headers = Message()
        self.headers["Content-Type"] = "application/json"


class FakeLLM:
    def __init__(self, result=None, error=None):
        self.calls = []
        self.result, self.error = result, error

    def open(self, request, timeout):
        self.calls.append(json.loads(request.data))
        if self.error:
            raise self.error
        return Reply(self.result if self.result is not None else {
            "model_id": "Qwen/Qwen2.5-0.5B-Instruct", "simulated": False, "script": SCRIPT})


class LocalLLMTests(unittest.TestCase):
    def test_settings_reject_bad_values(self):
        for values in ({"llm_provider": "bad"}, {"llm_base_url": "http://user:pass@localhost"},
                       {"llm_timeout_seconds": float("nan")}, {"llm_max_new_tokens": 0}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                Settings(**values)

    def test_adapter_preserves_request_and_validates_response(self):
        from app.integrations.local_llm import script_config
        upstream = FakeLLM()
        config = script_config(Settings(llm_provider="local_http"))
        roles = [{"role_key": "host", "name": "主持人", "description": "亲切", "voice_config": {"private": "not sent"}}]
        result = LocalLLMScriptGenerator(config, upstream).generate({"source_text": "聊聊早餐", "roles": roles, "prompt": SYSTEM_PROMPT})
        self.assertEqual(result.title, "早餐建议")
        self.assertEqual(upstream.calls[0]["source_text"], "聊聊早餐")
        self.assertNotIn("voice_config", upstream.calls[0]["roles"][0])
        for response in ({"model_id": config["model_id"], "simulated": True, "script": SCRIPT},
                         {"model_id": "different", "simulated": False, "script": SCRIPT},
                         {"model_id": config["model_id"], "simulated": False, "script": {**SCRIPT, "sentences": []}}):
            with self.assertRaises(BusinessError) as caught:
                LocalLLMScriptGenerator(config, FakeLLM(response)).generate({"source_text": "早餐", "roles": roles, "prompt": SYSTEM_PROMPT})
            self.assertEqual(caught.exception.code, "LLM_INVALID_RESPONSE")

    def test_errors_do_not_fallback(self):
        from app.integrations.local_llm import script_config
        snapshot = {"source_text": "早餐", "roles": [{"role_key": "host", "name": "主持人"}], "prompt": SYSTEM_PROMPT}
        for error, code in ((URLError(TimeoutError()), "LLM_TIMEOUT"), (URLError(OSError()), "LLM_UNAVAILABLE"),
                            (HTTPError("http://localhost", 503, "busy", {}, io.BytesIO(b'{"error":{"code":"engine_busy"}}')), "LLM_ENGINE_BUSY")):
            with self.subTest(code=code), self.assertRaises(BusinessError) as caught:
                LocalLLMScriptGenerator(script_config(Settings()), FakeLLM(error=error)).generate(snapshot)
            self.assertEqual(caught.exception.code, code)

    def test_worker_freezes_configuration_and_publishes_or_fails(self):
        for fail in (False, True):
            with self.subTest(fail=fail), TemporaryDirectory() as folder:
                settings = Settings(database_url=f"sqlite:///{folder}/db.sqlite3", storage_dir=Path(folder) / "assets", llm_provider="local_http")
                initialize(settings)
                initialize(settings)
                database = Database(settings.database_url)
                try:
                    with database.sessions() as session:
                        models = session.scalars(select(LLMModel).where(LLMModel.provider_code == "local_http")).all()
                        self.assertEqual(len(models), 1)
                        session.rollback()
                        pid = create_project(session, 1, "早餐", settings)["project_id"]
                        submit_source(session, 1, pid, "生成一段早餐建议播客")
                        accepted, _ = submit(session, 1, pid, "script", ScriptGenerate(roles=[{"profile_id": ROLE_ID, "role_key": "host"}]), "llm-test", settings)
                    worker = Worker(database, replace(settings, llm_base_url="http://changed.invalid"))
                    upstream = FakeLLM(error=URLError(OSError())) if fail else FakeLLM()
                    with patch("app.integrations.local_llm.build_opener", return_value=upstream):
                        self.assertTrue(worker.run_once())
                    with database.sessions() as session:
                        task = session.get(Task, accepted["task_id"])
                        self.assertFalse(task.input_snapshot["simulated"])
                        self.assertEqual(task.input_snapshot["llm_config"]["base_url"], settings.llm_base_url)
                        scripts = session.scalars(select(Script)).all()
                        self.assertIsNone(session.get(Project, pid).active_task_id)
                        if fail:
                            self.assertEqual(task.status, "failed")
                            self.assertEqual(task.error_code, "LLM_UNAVAILABLE")
                            self.assertEqual(scripts, [])
                        else:
                            self.assertEqual(task.status, "succeeded")
                            self.assertFalse(scripts[0].llm_snapshot["simulated"])
                finally:
                    database.engine.dispose()


if __name__ == "__main__":
    unittest.main()
