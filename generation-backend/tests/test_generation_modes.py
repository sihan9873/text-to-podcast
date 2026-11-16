"""Mode semantics and presenter/model selection regressions."""
import pytest
from sqlalchemy import select

from app.core.common import BusinessError
from app.core.config import Settings
from app.db.seed import ensure_presenters
from app.db.models import RoleProfile
from app.integrations.local_llm import (
    VerbatimScriptGenerator, CoherentLongDocumentScriptGenerator,
    LocalLLMScriptGenerator, script_generator_for_snapshot,
)
from test_coherent_long_document import CONFIG, FakeClient, snapshot
from test_framework import env, create_project


@pytest.mark.parametrize("source", ["甲。乙！\n丙？", "没有标点的长原文" * 1200, "  第一段。\n\n第二段！  ", "甲乙", "甲。" * 50000, "甲。" + " " * 500 + "乙"])
def test_verbatim_reconstructs_source_exactly(source):
    data = snapshot(source)
    data["generation_mode"] = "verbatim"
    result = script_generator_for_snapshot(data).generate(data)
    assert "".join(s.text for s in result.sentences) == source
    assert all(s.text.strip() and len(s.text) <= 1000 for s in result.sentences)
    assert len(result.sentences) <= 5000
    assert {s.role_key for s in result.sentences} == {"host", "guest"}


def test_verbatim_rejects_insufficient_speech():
    with pytest.raises(BusinessError):
        VerbatimScriptGenerator().generate(snapshot("甲"))


def test_summary_always_uses_summary_pipeline():
    data = snapshot("短文也可以概括。")
    data["generation_mode"] = "summary"
    assert isinstance(script_generator_for_snapshot(data), CoherentLongDocumentScriptGenerator)
    data["generation_mode"] = "prompt"
    assert isinstance(script_generator_for_snapshot(data), LocalLLMScriptGenerator)
    client = FakeClient()
    LocalLLMScriptGenerator(CONFIG, client=client).generate(data)
    assert "用户提示词" in client.calls[0]["prompt"]


def test_presets_backfilled_idempotently(env):
    settings = Settings(audio_provider="local_http")
    with env.db.sessions() as session:
        for _ in range(2):
            ensure_presenters(session, 1, settings)
            session.flush()
        roles = session.scalars(select(RoleProfile).where(RoleProfile.user_id == 1)).all()
        for voice in ("host_a", "host_b"):
            assert sum(r.voice_config.get("tts_model") == settings.tts_engine_id and r.voice_config.get("voice_id") == voice for r in roles) == 1


def test_selected_model_and_mode_are_snapshotted(env):
    pid = create_project(env)
    response = env.client.post(f"/api/v1/projects/{pid}/script/generate", headers={"Idempotency-Key": "4b"},
        json={"roles": [{"profile_id": 1, "role_key": "host"}], "model_id": 3, "generation_mode": "summary"})
    assert response.status_code == 202, response.text
    from app.db.models import Task
    with env.db.sessions() as session:
        task = session.get(Task, response.json()["data"]["task_id"])
        assert task.input_snapshot["generation_mode"] == "summary"
        assert task.input_snapshot["llm_config"]["model_id"] == "Qwen/Qwen3-4B-Instruct-2507"
        assert task.input_snapshot["llm_config"]["provider"] == "local_http"


def test_verbatim_worker_publish_confirm_and_audio_snapshot(env):
    from app.worker import Worker
    from app.integrations.mock import MockAudioGenerator
    from app.db.models import Task
    pid = create_project(env, text=False)
    source = "第一段原文，不允许改写。\n第二段保留数字123与标点！\n" * 250
    assert env.client.put(f"/api/v1/projects/{pid}/source", json={"text": source}).status_code == 200
    stored = env.client.get(f"/api/v1/projects/{pid}").json()["data"]["source_text"]
    response = env.client.post(f"/api/v1/projects/{pid}/script/generate", headers={"Idempotency-Key": "verbatim"},
        json={"roles": [{"profile_id": 1, "role_key": "a"}, {"profile_id": 4, "role_key": "b"}], "generation_mode": "verbatim"})
    assert response.status_code == 202, response.text
    worker = Worker(env.db, env.settings, audio_generator=MockAudioGenerator(0))
    assert worker.run_once()
    task = env.client.get(f'/api/v1/tasks/{response.json()["data"]["task_id"]}').json()["data"]
    assert task["status"] == "succeeded", task
    sid = task["result"]["script_id"]
    script = env.client.get(f"/api/v1/scripts/{sid}").json()["data"]
    assert "".join(s["text"] for s in script["sentences"]) == stored
    revision = {"expected_script_version": 1, "expected_edit_revision": 1}
    roles = [{k: v for k, v in r.items() if k != "profile_id"} for r in script["roles"]]
    saved = env.client.put(f"/api/v1/scripts/{sid}", json={**revision, "roles": roles, **{k: script[k] for k in ("title", "summary", "sentences")}})
    assert saved.status_code == 200, saved.text
    revision["expected_edit_revision"] = 2
    assert env.client.post(f"/api/v1/scripts/{sid}/confirm", json=revision).status_code == 200
    response = env.client.post(f"/api/v1/projects/{pid}/audio/generate", headers={"Idempotency-Key": "audio"}, json={"script_id": sid, **revision})
    assert response.status_code == 202, response.text
    with env.db.sessions() as session:
        task = session.get(Task, response.json()["data"]["task_id"])
        assert task.input_snapshot["generation_mode"] == "verbatim"


def test_verbatim_rejects_unrepresentable_whitespace():
    with pytest.raises(BusinessError, match="连续空白"):
        VerbatimScriptGenerator().generate(snapshot("甲。" + " " * 3000 + "乙"))
