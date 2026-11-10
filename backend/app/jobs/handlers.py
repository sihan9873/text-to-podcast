from copy import deepcopy

from sqlalchemy import func, select

from app.core.common import BusinessError, utcnow
from app.db.database import transaction
from app.db.models import Asset, AudioVersion, Project, Script, ScriptRole, ScriptSentence, Task
from app.integrations.contracts import GeneratedScript


def locked_task(session, job):
    project = session.scalar(select(Project).where(Project.id == job["project_id"]).with_for_update())
    task = session.scalar(select(Task).where(Task.id == job["id"], Task.status == "running",
        Task.lease_token == job["token"], Task.lease_expires_at > utcnow()).with_for_update())
    if task is None or project is None or project.active_task_id != task.id:
        raise BusinessError("TASK_STATE_CONFLICT", "任务已失效，拒绝发布过期结果")
    return task, project


def complete(task, project, result):
    task.status, task.stage, task.progress = "succeeded", "completed", 100
    task.result_json, task.finished_at = result, utcnow()
    task.lease_expires_at = None
    project.active_task_id = None
    project.updated_at = utcnow()


def publish_script(database, job, generated):
    generated = GeneratedScript.model_validate(generated)
    roles = job["snapshot"]["roles"]
    keys = {r["role_key"] for r in roles}
    if (any(not line.text.strip() or line.role_key not in keys for line in generated.sentences)
        or {line.role_key for line in generated.sentences} != keys
        or sum(len(line.text) for line in generated.sentences) > 5000):
        raise BusinessError("LLM_INVALID_RESPONSE", "生成结果不满足台词、角色或长度约束")
    with database.sessions() as session, transaction(session):
        task, project = locked_task(session, job)
        version = (session.scalar(select(func.max(Script.version)).where(Script.project_id == project.id)) or 0) + 1
        script = Script(project_id=project.id, version=version, title=generated.title,
            summary=generated.summary, llm_snapshot=deepcopy(job["snapshot"]))
        session.add(script)
        session.flush()
        mapping = {}
        for r in roles:
            item = ScriptRole(script_id=script.id, **deepcopy(r))
            session.add(item)
            session.flush()
            mapping[r["role_key"]] = item.id
        session.add_all([ScriptSentence(script_id=script.id, role_id=mapping[line.role_key], sequence=i + 1,
            text=line.text, speed=None, extra_params={}) for i, line in enumerate(generated.sentences)])
        project.current_script_id, task.script_id = script.id, script.id
        complete(task, project, {"script_id": script.id, "version": version,
            "edit_revision": 1, "sentence_count": len(generated.sentences),
            "generation": {"provider": job["snapshot"].get("llm_config", {}).get("provider", "mock"),
                "model_id": job["snapshot"].get("model", {}).get("model_code"),
                "simulated": job["snapshot"].get("simulated", True)}})


def publish_audio(database, storage, job, generated):
    if generated.duration_ms <= 0:
        raise BusinessError("INVALID_AUDIO_RESULT", "音频时长无效")
    key, size, sha = storage.save_mp3(generated.content)
    try:
        with database.sessions() as session, transaction(session):
            task, project = locked_task(session, job)
            audio = session.get(AudioVersion, task.audio_version_id)
            if audio is None or audio.status != "running":
                raise BusinessError("TASK_STATE_CONFLICT", "音频版本状态不匹配")
            asset = Asset(user_id=task.user_id, object_key=key, size_bytes=size,
                duration_ms=generated.duration_ms, sha256=sha, metadata_json=deepcopy(generated.metadata))
            session.add(asset)
            session.flush()
            audio.status, audio.selection_revision, audio.current_asset_id = "ready", 1, asset.id
            audio.config_snapshot = {**audio.config_snapshot, "execution": deepcopy(generated.metadata)}
            task.result_asset_id = asset.id
            task.completed_sentences = task.total_sentences
            complete(task, project, {"audio_version_id": audio.id, "version": audio.version,
                "selection_revision": 1, "asset_id": asset.id,
                "play_url": f"/api/v1/audio-assets/{asset.id}/play",
                "download_url": f"/api/v1/audio-assets/{asset.id}/download",
                "metadata": deepcopy(generated.metadata)})
    except BaseException:
        storage.path(key).unlink(missing_ok=True)
        raise
