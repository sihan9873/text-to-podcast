import hashlib
import io
import json
import math
import struct
import wave

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.api.dependencies import current_user
from app.bootstrap import initialize
from app.core.config import Settings
from app.db.models import Asset, Task, User
from app.integrations.local_tts import LocalTTSAudioGenerator
from app.integrations.mock import MockScriptGenerator
from app.main import create_app
from app.worker import Worker


def recording(seconds=4, silent=False):
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(b"".join(struct.pack("<h", 0 if silent else round(2000 * math.sin(i / 10))) for i in range(seconds * 24000)))
    return out.getvalue()


@pytest.fixture
def env(tmp_path, monkeypatch):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}", storage_dir=tmp_path / "assets",
        voice_reference_dir=tmp_path / "references", audio_provider="local_http", tts_engine_id="qwen3-base")
    initialize(settings)
    app = create_app(settings)
    monkeypatch.setenv("TTS_INTERNAL_TOKEN", "test-internal-key")
    calls = []
    def upstream(self, path, payload=None, audio=False):
        calls.append((path, payload))
        if path == "/v1/engines":
            return {"engines": [{"engine_id": "qwen3-base", "installed": True, "supports_cloning": True,
                "supports_speed": False, "max_text_length": 120, "model_revision": "a" * 64}]}
        assert path == "/v1/clone" and audio
        assert payload["voice_id"].startswith("clone_") and payload["reference_text"] == "这是录音中的原话。"
        assert payload["model_revision"] == "a" * 64 and "voice_version_id" not in payload
        return recording(1)
    monkeypatch.setattr(LocalTTSAudioGenerator, "_request", upstream)
    with TestClient(app) as client:
        yield app, client, Worker(app.state.database, settings, script_generator=MockScriptGenerator(0)), calls


def create_voice(client, name="我的声音"):
    upload = client.post("/api/v1/voice-references", content=recording(), headers={"Content-Type": "application/octet-stream"})
    assert upload.status_code == 201, upload.text
    asset = upload.json()["data"]["asset_id"]
    created = client.post("/api/v1/voice-profiles", json={"name": name, "reference_asset_id": asset,
        "reference_text": "这是录音中的原话。", "authorized": True})
    assert created.status_code == 201, created.text
    return created.json()["data"]


def test_private_upload_preview_and_full_podcast(env):
    app, c, worker, calls = env
    voice = create_voice(c)
    listing = c.get("/api/v1/voices").json()["data"]["voices"]
    assert listing[0]["voice_id"] == voice["voice_id"]
    assert "reference_key" not in json.dumps(c.get("/api/v1/voice-profiles").json())
    preview = c.post(f"/api/v1/voice-profiles/{voice['voice_profile_id']}/preview", json={"text": "新的试听文本。"}, headers={"Idempotency-Key": "preview1"})
    assert preview.status_code == 202, preview.text
    tid = preview.json()["data"]["task_id"]
    assert c.post(f"/api/v1/voice-profiles/{voice['voice_profile_id']}/preview", json={"text": "新的试听文本。"}, headers={"Idempotency-Key": "preview1"}).json()["data"]["task_id"] == tid
    assert worker.run_once()
    task = c.get(f"/api/v1/tasks/{tid}").json()["data"]
    assert task["status"] == "succeeded", task
    assert task["project_id"] is None
    assert c.get(task["result"]["play_url"]).headers["content-type"] == "audio/mpeg"
    role = c.post("/api/v1/roles", json={"name": "克隆主持人", "tts_provider": "local_http", "tts_model": "qwen3-base", "voice_id": voice["voice_id"]})
    assert role.status_code == 201, role.text
    guest_voice = create_voice(c, "嘉宾声音")
    guest = c.post("/api/v1/roles", json={"name": "克隆嘉宾", "tts_provider": "local_http", "tts_model": "qwen3-base", "voice_id": guest_voice["voice_id"]})
    assert guest.status_code == 201, guest.text
    pid = c.post("/api/v1/projects", json={"title": "克隆播客"}).json()["data"]["project_id"]
    c.put(f"/api/v1/projects/{pid}/source", json={"text": "测试原文。"})
    result = c.post(f"/api/v1/projects/{pid}/script/generate", json={"roles": [
        {"profile_id": role.json()["data"]["profile_id"], "role_key": "host"},
        {"profile_id": guest.json()["data"]["profile_id"], "role_key": "guest"}]}, headers={"Idempotency-Key": "script1"})
    assert result.status_code == 202, result.text
    assert worker.run_once()
    sid = c.get(f"/api/v1/tasks/{result.json()['data']['task_id']}").json()["data"]["result"]["script_id"]
    assert c.get(f"/api/v1/projects/{pid}/scripts").json()["data"]["total"] == 1
    assert c.post(f"/api/v1/scripts/{sid}/confirm", json={"expected_script_version": 1, "expected_edit_revision": 1}).status_code == 200
    submitted = c.post(f"/api/v1/projects/{pid}/audio/generate", json={"script_id": sid, "expected_script_version": 1, "expected_edit_revision": 1}, headers={"Idempotency-Key": "audio1"})
    assert submitted.status_code == 202, submitted.text
    assert worker.run_once()
    result = c.get(f"/api/v1/tasks/{submitted.json()['data']['task_id']}").json()["data"]
    assert result["status"] == "succeeded", result
    audio_id = result["audio_version_id"]
    audio = c.get(f"/api/v1/audio-versions/{audio_id}").json()["data"]
    assert set(audio["metadata"]["voice_versions"]) == {voice["voice_version_id"], guest_voice["voice_version_id"]}
    assert audio["supports_sentence_audio"] is False
    assert c.get(audio["download_url"]).status_code == 200
    with app.state.database.sessions() as session:
        snapshots = [t.input_snapshot for t in session.scalars(select(Task)).all()]
        assert "test-internal-key" not in json.dumps(snapshots)
    assert any(path == "/v1/clone" for path, _ in calls)
    # Editing a confirmed script is rejected; editing a new revision preserves old audio.
    script = c.get(f"/api/v1/scripts/{sid}").json()["data"]
    changes = {"expected_script_version": 1, "expected_edit_revision": 1, "title": "修改后的标题", "summary": script["summary"],
        "roles": [{k: v for k, v in r.items() if k != "profile_id"} for r in script["roles"]], "sentences": script["sentences"]}
    assert c.put(f"/api/v1/scripts/{sid}", json=changes).status_code == 409
    assert c.post(f"/api/v1/scripts/{sid}/unconfirm", json={"expected_script_version": 1, "expected_edit_revision": 1}).status_code == 200
    saved = c.put(f"/api/v1/scripts/{sid}", json=changes)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["edit_revision"] == 2
    assert c.get(f"/api/v1/audio-versions/{audio_id}").json()["data"]["source_script_changed"] is True
    assert c.get(audio["download_url"]).status_code == 200


def test_bad_recordings_and_authorization(env):
    _, c, _, _ = env
    for data in (b"", b"bad", recording(1), recording(4, silent=True), recording(31)):
        assert c.post("/api/v1/voice-references", content=data).status_code == 422
    assert c.post("/api/v1/voice-profiles", json={"name": "x", "reference_asset_id": 1,
        "reference_text": "文本", "authorized": False}).status_code == 422
    assert c.post("/api/v1/voice-profiles", json={"name": "x", "reference_asset_id": 1,
        "reference_text": "文本", "authorized": 1}).status_code == 422
    assert c.post("/api/v1/voice-references", content=recording(), headers={"Origin": "https://evil.example"}).status_code == 403


def test_cross_user_isolation_and_disable(env):
    app, c, _, _ = env
    voice = create_voice(c)
    with app.state.database.sessions() as session:
        user = User(username="second")
        session.add(user)
        session.commit()
        uid = user.id
    app.dependency_overrides[current_user] = lambda: uid
    assert c.get("/api/v1/voice-profiles").json()["data"]["items"] == []
    assert c.get(f"/api/v1/voice-profiles/{voice['voice_profile_id']}").status_code == 404
    assert c.post("/api/v1/roles", json={"name": "窃用", "tts_provider": "local_http", "tts_model": "qwen3-base", "voice_id": voice["voice_id"]}).status_code == 422
    app.dependency_overrides.clear()
    c.patch(f"/api/v1/voice-profiles/{voice['voice_profile_id']}", json={"status": "disabled"})
    assert c.get("/api/v1/voices").json()["data"]["voices"] == []
    assert c.post(f"/api/v1/voice-profiles/{voice['voice_profile_id']}/preview", json={"text": "试听"}, headers={"Idempotency-Key": "disabled"}).status_code == 422


def test_missing_reference_and_preview_failure_do_not_publish(env, monkeypatch):
    app, c, worker, _ = env
    voice = create_voice(c)
    preview = c.post(f"/api/v1/voice-profiles/{voice['voice_profile_id']}/preview", json={"text": "试听"}, headers={"Idempotency-Key": "fail"})
    from app.core.common import BusinessError
    def fail(*_args, **_kwargs):
        raise BusinessError("TTS_OUT_OF_MEMORY", "资源不足", 503)
    monkeypatch.setattr(LocalTTSAudioGenerator, "generate", fail)
    assert worker.run_once()
    task = c.get(f"/api/v1/tasks/{preview.json()['data']['task_id']}").json()["data"]
    assert task["status"] == "failed" and task["result_asset_id"] is None
    for path in app.state.settings.voice_reference_dir.glob("*.wav"):
        path.unlink()
    assert c.post(f"/api/v1/voice-profiles/{voice['voice_profile_id']}/preview", json={"text": "试听"}, headers={"Idempotency-Key": "missing"}).status_code == 422


def test_schema_subject_constraints_and_original_status_check(env):
    app, _, _, _ = env
    with app.state.database.engine.connect() as conn:
        sql = conn.execute(text("SELECT sql FROM sqlite_master WHERE name='tasks'")).scalar()
        assert "ck_task_status" in sql and "ck_task_subject" in sql


def test_expired_preview_cannot_publish_and_restart_retains_voice(env):
    from datetime import timedelta
    from app.core.common import BusinessError, utcnow
    from app.integrations.contracts import GeneratedAudio
    from app.jobs import repository
    from app.jobs.handlers import publish_audio
    app, c, worker, _ = env
    voice = create_voice(c)
    accepted = c.post(f"/api/v1/voice-profiles/{voice['voice_profile_id']}/preview", json={"text": "试听"}, headers={"Idempotency-Key": "expire"})
    job = repository.claim(app.state.database, app.state.settings)
    with app.state.database.sessions() as session:
        task = session.get(Task, job["id"])
        task.lease_expires_at = utcnow() - timedelta(seconds=1)
        session.commit()
    assert repository.recover_expired(app.state.database) == 1
    # A stale result must remove its already-written MP3 rather than publish it.
    from app.integrations.mock import FIXTURES
    with pytest.raises(BusinessError):
        publish_audio(app.state.database, worker.storage, job, GeneratedAudio((FIXTURES / "test_audio.mp3").read_bytes(), 1000, {}))
    assert not list(app.state.settings.storage_dir.glob("*.mp3"))
    tid = accepted.json()["data"]["task_id"]
    assert c.get(f"/api/v1/tasks/{tid}").json()["data"]["error_code"] == "WORKER_INTERRUPTED"
    second = create_app(app.state.settings)
    with TestClient(second) as client:
        assert client.get("/api/v1/voice-profiles").json()["data"]["items"][0]["voice_version_id"] == voice["voice_version_id"]


def test_automatic_long_document_generation_keeps_cloned_voice_snapshot(env, monkeypatch):
    """Exercise the upstream long-document pipeline together with private cloning."""
    from dataclasses import replace
    from app.integrations.contracts import GeneratedScript
    from app.integrations.local_llm import LocalLLMClient
    from app.jobs import repository

    app, client, _, tts_calls = env
    settings = replace(app.state.settings, llm_provider="local_http")
    app.state.settings = settings
    worker = Worker(app.state.database, settings)
    voice = create_voice(client)
    role = client.post("/api/v1/roles", json={"name": "长文主持人", "tts_provider": "local_http",
        "tts_model": "qwen3-base", "voice_id": voice["voice_id"]}).json()["data"]
    pid = client.post("/api/v1/projects", json={"title": "长文本与克隆联调"}).json()["data"]["project_id"]
    source = "\n\n".join(character * 1800 for character in "甲乙丙丁")
    submitted = client.put(f"/api/v1/projects/{pid}/source", json={"text": source})
    assert submitted.status_code == 200, submitted.text
    saved = submitted.json()["data"]
    assert saved["source_text"] == source and saved["segmentation_mode"] == "auto"
    assert [c["text"] for c in saved["chunks"]] == [character * 1800 for character in "甲乙丙丁"]
    assert saved["chunk_count"] == 4

    llm_calls, stages = [], []
    def generate(self, source_text, system_prompt, roles, **options):
        llm_calls.append((source_text, system_prompt, roles, options))
        return GeneratedScript(title="完整节目", summary="全文事实与章节关系", sentences=[
            {"role_key": r["role_key"], "text": "连贯的正文台词。"} for r in roles])
    original_progress = repository.progress
    def progress(database, task_id, token, stage, percent, completed_sentences=None):
        stages.append(stage)
        return original_progress(database, task_id, token, stage, percent, completed_sentences)
    monkeypatch.setattr(LocalLLMClient, "generate", generate)
    monkeypatch.setattr(repository, "progress", progress)

    request = {"roles": [{"profile_id": role["profile_id"], "role_key": "host"}],
               "target_minutes": 5, "style": "自然、连贯"}
    accepted = client.post(f"/api/v1/projects/{pid}/script/generate", json=request, headers={"Idempotency-Key": "long-script"})
    assert accepted.status_code == 202, accepted.text
    assert worker.run_once()
    result = client.get(f"/api/v1/tasks/{accepted.json()['data']['task_id']}").json()["data"]
    assert result["status"] == "succeeded", result
    assert set(stages) == {"analyzing_source", "planning_script", "drafting_sections", "refining_script"}
    assert all(0 < len(source_text) <= 5000 for source_text, _, _, _ in llm_calls)
    assert llm_calls[-1][3]["require_all_roles"] is True
    sid = result["result"]["script_id"]
    script = client.get(f"/api/v1/scripts/{sid}").json()["data"]
    assert script["roles"][0]["voice_config"]["voice_id"] == voice["voice_id"]
    with app.state.database.sessions() as session:
        task = session.get(Task, accepted.json()["data"]["task_id"])
        assert task.input_snapshot["generation_preferences"]["target_minutes"] == 5
        assert task.input_snapshot["source_hash"] == saved["source_hash"]
        assert [c["sequence"] for c in task.input_snapshot["source_chunks"]] == [1, 2, 3, 4]
    revision = {"expected_script_version": 1, "expected_edit_revision": 1}
    assert client.post(f"/api/v1/scripts/{sid}/confirm", json=revision).status_code == 200
    audio = client.post(f"/api/v1/projects/{pid}/audio/generate", json={"script_id": sid, **revision},
        headers={"Idempotency-Key": "long-cloned-audio"})
    assert audio.status_code == 202, audio.text
    assert worker.run_once()
    result = client.get(f"/api/v1/tasks/{audio.json()['data']['task_id']}").json()["data"]
    assert result["status"] == "succeeded", result
    assert client.get(result["result"]["download_url"]).status_code == 200
    assert any(path == "/v1/clone" and payload["voice_id"] == voice["voice_id"] for path, payload in tts_calls)
