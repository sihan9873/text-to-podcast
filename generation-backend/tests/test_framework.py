from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.bootstrap import initialize
from app.core.common import BusinessError, utcnow
from app.core.config import Settings
from app.db.database import transaction
from app.db.models import Asset, Project, Script, Task, User
from app.db.seed import ROLE_ID
from app.integrations import mock
from app.integrations.contracts import GeneratedScript
from app.jobs import repository
from app.jobs.handlers import publish_script
from app.main import create_app
from app.worker import Worker


@pytest.fixture
def env(tmp_path):
    settings = Settings(database_url=f"sqlite:///{(tmp_path / 'test.sqlite3').as_posix()}", storage_dir=tmp_path / "assets")
    initialize(settings)
    app = create_app(settings)
    worker = Worker(app.state.database, settings, mock.MockScriptGenerator(0), mock.MockAudioGenerator(0))
    with TestClient(app) as client:
        yield SimpleNamespace(settings=settings, app=app, db=app.state.database, worker=worker, client=client)


def create_project(e, text=True):
    r = e.client.post("/api/v1/projects", json={"title": "闭环测试"})
    assert r.status_code == 201, r.text
    pid = r.json()["data"]["project_id"]
    if text:
        r = e.client.put(f"/api/v1/projects/{pid}/source", json={"text": "用于联调的原文，不调用真实模型。"})
        assert r.status_code == 200, r.text
    return pid


def submit_script(e, pid, key="script-1", role_key="host"):
    return e.client.post(f"/api/v1/projects/{pid}/script/generate", headers={"Idempotency-Key": key},
        json={"roles": [{"profile_id": ROLE_ID, "role_key": role_key}]})


def generate_script(e, pid, confirm=False):
    r = submit_script(e, pid)
    assert r.status_code == 202, r.text
    tid = r.json()["data"]["task_id"]
    assert e.worker.run_once()
    task = e.client.get(f"/api/v1/tasks/{tid}").json()["data"]
    assert task["status"] == "succeeded", task
    sid = task["result"]["script_id"]
    if confirm:
        r = e.client.post(f"/api/v1/scripts/{sid}/confirm", json={"expected_script_version": 1, "expected_edit_revision": 1})
        assert r.status_code == 200, r.text
    return sid


def submit_audio(e, pid, sid, key="audio-1"):
    return e.client.post(f"/api/v1/projects/{pid}/audio/generate", headers={"Idempotency-Key": key},
        json={"script_id": sid, "expected_script_version": 1, "expected_edit_revision": 1})


def test_complete_flow_download_and_range(env):
    e = env
    assert e.client.get("/api/v1/health/ready").status_code == 200
    pid = create_project(e)
    sid = generate_script(e, pid)
    detail = e.client.get(f"/api/v1/scripts/{sid}").json()["data"]
    assert [x["sequence"] for x in detail["sentences"]] == [1, 2, 3]
    assert "模拟" in detail["title"]
    assert submit_audio(e, pid, sid).json()["code"] == "SCRIPT_NOT_CONFIRMED"
    e.client.post(f"/api/v1/scripts/{sid}/confirm", json={"expected_script_version": 1, "expected_edit_revision": 1})
    submitted = submit_audio(e, pid, sid)
    assert submitted.status_code == 202, submitted.text
    tid = submitted.json()["data"]["task_id"]
    assert e.client.get(f"/api/v1/tasks/{tid}").json()["data"]["status"] == "queued"
    assert e.worker.run_once()
    task = e.client.get(f"/api/v1/tasks/{tid}").json()["data"]
    assert task["status"] == "succeeded", task
    assert task["completed_sentences"] == task["total_sentences"] == 3
    audio = e.client.get(task["result"]["download_url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/mpeg"
    assert "attachment" in audio.headers["content-disposition"]
    assert audio.content == (mock.FIXTURES / "test_audio.mp3").read_bytes()
    ranged = e.client.get(task["result"]["play_url"], headers={"Range": "bytes=0-15"})
    assert ranged.status_code == 206
    assert ranged.content == audio.content[:16]
    assert ranged.headers["content-range"].startswith("bytes 0-15/")
    project = e.client.get(f"/api/v1/projects/{pid}").json()["data"]
    assert project["active_tasks"] == []
    assert project["latest_audio"]["status"] == "ready"


def test_source_is_immutable_and_nonblank(env):
    pid = create_project(env, text=False)
    assert env.client.put(f"/api/v1/projects/{pid}/source", json={"text": "  "}).status_code == 422
    assert env.client.put(f"/api/v1/projects/{pid}/source", json={"text": "原文\r\n下一行"}).status_code == 200
    r = env.client.put(f"/api/v1/projects/{pid}/source", json={"text": "替换"})
    assert r.status_code == 409 and r.json()["code"] == "SOURCE_LOCKED"
    assert env.client.get(f"/api/v1/projects/{pid}").json()["data"]["source_text"] == "原文\n下一行"


def test_idempotency_and_conflicting_generation(env):
    pid = create_project(env)
    first = submit_script(env, pid)
    again = submit_script(env, pid)
    assert first.json()["data"]["task_id"] == again.json()["data"]["task_id"]
    assert submit_script(env, pid, role_key="guest").json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert submit_script(env, pid, key="different").json()["code"] == "TASK_ALREADY_RUNNING"
    env.worker.run_once()
    assert submit_script(env, pid).status_code == 200
    with env.db.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Task)) == 1
        assert session.scalar(select(func.count()).select_from(Script)) == 1


def test_simultaneous_idempotency(env):
    pid = create_project(env)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit_script(env, pid), range(2)))
    assert all(r.status_code == 202 for r in results), [r.text for r in results]
    assert len({r.json()["data"]["task_id"] for r in results}) == 1


def test_claim_only_once(env):
    pid = create_project(env)
    submit_script(env, pid)
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(lambda _: repository.claim(env.db, env.settings), range(2)))
    assert sum(job is not None for job in jobs) == 1


def test_no_source_and_invalid_role(env):
    pid = create_project(env, text=False)
    assert submit_script(env, pid).json()["code"] == "SOURCE_NOT_SUBMITTED"
    env.client.put(f"/api/v1/projects/{pid}/source", json={"text": "已提交"})
    r = env.client.post(f"/api/v1/projects/{pid}/script/generate", headers={"Idempotency-Key": "missing-role"},
        json={"roles": [{"profile_id": 999999, "role_key": "host"}]})
    assert r.status_code == 422 and r.json()["code"] == "INVALID_ROLE"
    with env.db.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Task)) == 0


def test_revision_and_confirmation_idempotency(env):
    pid = create_project(env)
    sid = generate_script(env, pid)
    r = env.client.post(f"/api/v1/scripts/{sid}/confirm", json={"expected_script_version": 1, "expected_edit_revision": 2})
    assert r.json()["code"] == "REVISION_CONFLICT"
    body = {"expected_script_version": 1, "expected_edit_revision": 1}
    a = env.client.post(f"/api/v1/scripts/{sid}/confirm", json=body).json()["data"]
    b = env.client.post(f"/api/v1/scripts/{sid}/confirm", json=body).json()["data"]
    assert a["confirmed_at"] == b["confirmed_at"]
    assert submit_script(env, pid, key="new-script").status_code == 202
    env.worker.run_once()
    second_id = env.client.get(f"/api/v1/projects/{pid}").json()["data"]["current_script"]["script_id"]
    r = env.client.post(f"/api/v1/scripts/{second_id}/confirm", json={"expected_script_version": 2, "expected_edit_revision": 1})
    assert r.json()["code"] == "ANOTHER_SCRIPT_CONFIRMED"


def test_provider_failure_does_not_publish_script(env):
    class Broken:
        def generate(self, snapshot):
            raise RuntimeError("sensitive upstream detail must not be returned")
    pid = create_project(env)
    r = submit_script(env, pid)
    env.worker.script_generator = Broken()
    env.worker.run_once()
    task = env.client.get(r.json()["data"]["status_url"]).json()["data"]
    assert task["status"] == "failed"
    assert "sensitive" not in task["error_message"]
    with env.db.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Script)) == 0
        assert session.get(Project, pid).active_task_id is None
    assert submit_script(env, pid, key="retry-new-key").status_code == 202


def test_audio_failure_keeps_script_and_no_asset(env):
    class BrokenAudio:
        def generate(self, snapshot):
            raise RuntimeError("audio unavailable")
    pid = create_project(env)
    sid = generate_script(env, pid, confirm=True)
    submitted = submit_audio(env, pid, sid)
    env.worker.audio_generator = BrokenAudio()
    env.worker.run_once()
    task = env.client.get(submitted.json()["data"]["status_url"]).json()["data"]
    assert task["status"] == "failed" and task["result"] is None
    with env.db.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Script)) == 1
        assert session.get(Script, sid).status == "confirmed"
        assert session.scalar(select(func.count()).select_from(Asset)) == 0


def test_expired_task_recovery_and_stale_publish(env):
    pid = create_project(env)
    submitted = submit_script(env, pid)
    job = repository.claim(env.db, env.settings)
    assert repository.recover_expired(env.db) == 0
    with env.db.sessions() as session, transaction(session):
        session.get(Task, job["id"]).lease_expires_at = utcnow() - timedelta(seconds=1)
    assert repository.recover_expired(env.db) == 1
    with pytest.raises(BusinessError):
        publish_script(env.db, job, mock.MockScriptGenerator(0).generate(job["snapshot"]))
    assert env.client.get(submitted.json()["data"]["status_url"]).json()["data"]["error_code"] == "WORKER_INTERRUPTED"
    assert submit_script(env, pid, key="after-crash").status_code == 202


def test_queued_task_survives_api_restart(env):
    pid = create_project(env)
    submitted = submit_script(env, pid)
    second_app = create_app(env.settings)
    with TestClient(second_app) as client:
        task = client.get(submitted.json()["data"]["status_url"]).json()["data"]
        assert task["status"] == "queued"
    assert env.worker.run_once()


def test_other_user_resources_are_hidden(env):
    with env.db.sessions() as session, transaction(session):
        other_user = User(username="other_user")
        session.add(other_user)
        session.flush()
        other = other_user.id
    other_app = create_app(Settings(database_url=env.settings.database_url,
        storage_dir=env.settings.storage_dir, development_user_id=other))
    with TestClient(other_app) as client:
        pid = client.post("/api/v1/projects", json={"title": "private"}).json()["data"]["project_id"]
    assert env.client.get(f"/api/v1/projects/{pid}").status_code == 404
    assert env.client.put(f"/api/v1/projects/{pid}/source", json={"text": "try"}).status_code == 404
    assert env.client.get("/api/v1/projects").json()["data"]["total"] == 0


def test_missing_audio_file_is_not_success(env):
    pid = create_project(env)
    sid = generate_script(env, pid, confirm=True)
    r = submit_audio(env, pid, sid)
    env.worker.run_once()
    result = env.client.get(r.json()["data"]["status_url"]).json()["data"]["result"]
    with env.db.sessions() as session:
        asset = session.get(Asset, result["asset_id"])
        env.worker.storage.path(asset.object_key).unlink()
    assert env.client.get(result["download_url"]).json()["code"] == "AUDIO_FILE_MISSING"


def test_default_mock_services_wait_ten_seconds(monkeypatch):
    calls = []
    monkeypatch.setattr(mock, "time", SimpleNamespace(sleep=calls.append))
    result = mock.MockScriptGenerator().generate({"roles": [{"role_key": "host"}]})
    audio = mock.MockAudioGenerator().generate({"script": {"sentences": result.sentences}})
    assert calls == [10, 10]
    assert audio.content.startswith(b"ID3") or audio.content.startswith(b"\xff")
    assert audio.metadata["real_speech"] is False


def test_validation_uses_uniform_errors(env):
    r = env.client.post("/api/v1/projects", json={"title": "", "unknown": True})
    assert r.status_code == 422
    assert set(r.json()) == {"code", "message", "data", "request_id", "timestamp"}
    assert r.json()["request_id"] == r.headers["x-request-id"]


def test_integer_ids_are_generated_and_never_reused(env):
    from app.db.models import Base
    from sqlalchemy import Integer, inspect
    from sqlalchemy.schema import CreateTable
    from sqlalchemy.dialects.mysql import dialect

    first = create_project(env, text=False)
    second = create_project(env, text=False)
    assert type(first) is int and second == first + 1
    with env.db.sessions() as session, transaction(session):
        session.delete(session.get(Project, second))
    assert create_project(env, text=False) > second
    for table in Base.metadata.tables.values():
        assert isinstance(table.c.id.type, Integer)
        assert 'AUTO_INCREMENT' in str(CreateTable(table).compile(dialect=dialect()))
        for fk in table.foreign_keys:
            assert isinstance(fk.parent.type, Integer)
        actual = inspect(env.db.engine).get_columns(table.name)
        assert isinstance(next(c for c in actual if c['name'] == 'id')['type'], Integer)


@pytest.mark.parametrize('invalid', [0, -1, '00000000-0000-4000-8000-000000000001', 'abc'])
def test_path_ids_reject_invalid_values(env, invalid):
    for route in ['projects', 'scripts', 'tasks']:
        assert env.client.get(f'/api/v1/{route}/{invalid}').status_code == 422
    assert env.client.get(f'/api/v1/audio-assets/{invalid}/download').status_code == 422


@pytest.mark.parametrize('invalid', [0, -1, True, 1.5, '1'])
def test_body_ids_require_positive_json_integer(env, invalid):
    pid = create_project(env)
    r = env.client.post(f'/api/v1/projects/{pid}/script/generate',
        headers={'Idempotency-Key': 'invalid-integer'},
        json={'roles': [{'profile_id': invalid, 'role_key': 'host'}]})
    assert r.status_code == 422
