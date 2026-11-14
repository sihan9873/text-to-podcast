from sqlalchemy import select

from app.core.common import BusinessError, iso
from app.db.models import AudioVersion, Project, Script, ScriptRole, ScriptSentence, Task


def owned_project(session, project_id, user_id, lock=False):
    query = select(Project).where(Project.id == project_id, Project.user_id == user_id)
    project = session.scalar(query.with_for_update() if lock else query)
    if project is None:
        raise BusinessError("RESOURCE_NOT_FOUND", "项目不存在", 404)
    return project


def owned_script(session, script_id, user_id):
    script = session.get(Script, script_id)
    if script is None:
        raise BusinessError("RESOURCE_NOT_FOUND", "脚本不存在", 404)
    owned_project(session, script.project_id, user_id)
    return script


def script_view(session, script):
    roles = session.scalars(select(ScriptRole).where(ScriptRole.script_id == script.id).order_by(ScriptRole.role_key)).all()
    sentences = session.scalars(select(ScriptSentence).where(ScriptSentence.script_id == script.id).order_by(ScriptSentence.sequence)).all()
    return {"script_id": script.id, "project_id": script.project_id, "version": script.version,
        "edit_revision": script.edit_revision, "title": script.title, "summary": script.summary,
        "status": script.status, "confirmed_at": iso(script.confirmed_at), "confirmed_by": script.confirmed_by,
        "confirmed_revision": script.confirmed_revision, "editable": script.status == "draft",
        "roles": [{"role_id": r.id, "profile_id": r.profile_id, "role_key": r.role_key, "name": r.name,
                   "description": r.description, "voice_config": r.voice_config} for r in roles],
        "sentences": [{"sentence_id": s.id, "sequence": s.sequence, "role_id": s.role_id,
                       "text": s.text, "speed": s.speed, "extra_params": s.extra_params} for s in sentences],
        "created_at": iso(script.created_at), "updated_at": iso(script.updated_at)}


def accepted(task):
    return {"task_id": task.id, "task_type": task.task_type, "audio_action": task.audio_action,
        "status": task.status, "script_id": task.script_id, "audio_version_id": task.audio_version_id,
        "candidate_id": None, "status_url": f"/api/v1/tasks/{task.id}"}


def task_view(task):
    return {"task_id": task.id, "project_id": task.project_id, "task_type": task.task_type,
        "audio_action": task.audio_action, "script_id": task.script_id, "audio_version_id": task.audio_version_id,
        "audio_sentence_id": None, "retry_of_task_id": None,
        "status": task.status, "stage": task.stage, "progress": task.progress,
        "total_sentences": task.total_sentences, "completed_sentences": task.completed_sentences,
        "failed_sentences": task.failed_sentences, "result": task.result_json,
        "result_asset_id": task.result_asset_id, "error_code": task.error_code,
        "error_message": task.error_message, "can_retry": False,
        "created_at": iso(task.created_at), "updated_at": iso(task.updated_at),
        "started_at": iso(task.started_at), "finished_at": iso(task.finished_at)}


def project_view(session, project):
    current = session.get(Script, project.current_script_id) if project.current_script_id else None
    confirmed = session.get(Script, project.confirmed_script_id) if project.confirmed_script_id else None
    latest = session.scalar(select(AudioVersion).where(AudioVersion.project_id == project.id).order_by(AudioVersion.version.desc()).limit(1))
    active = session.scalars(select(Task).where(Task.project_id == project.id, Task.status.in_(["queued", "running"]))).all()
    def brief(script):
        return {"script_id": script.id, "version": script.version, "edit_revision": script.edit_revision,
                "status": script.status} if script else None
    confirmation = brief(confirmed)
    if confirmation:
        confirmation["confirmed_at"] = iso(confirmed.confirmed_at)
    return {"project_id": project.id, "title": project.title, "source_text": project.source_text,
        "source_type": project.source_type, "source_name": project.source_name,
        "source_asset_id": None, "source_hash": project.source_hash,
        "source_submitted": project.source_submitted_at is not None, "source_submitted_at": iso(project.source_submitted_at),
        "source_character_count": project.source_character_count,
        "source_estimated_seconds": project.source_estimated_seconds,
        "source_chunk_count": project.source_chunk_count,
        "segmentation_mode": project.segmentation_mode,
        "target_minutes": project.target_minutes,
        "chars_per_minute": project.chars_per_minute,
        "llm_config": {"project_id": project.id, "model_id": project.llm_model_id, "credential_source": "platform",
                       "credential_id": None, "params": {}, "available": True, "unavailable_reason": None},
        "current_script": brief(current), "confirmed_script": confirmation,
        "latest_audio": {"audio_version_id": latest.id, "version": latest.version, "status": latest.status,
                         "selection_revision": latest.selection_revision, "current_asset_id": latest.current_asset_id} if latest else None,
        "active_tasks": [{"task_id": t.id, "task_type": t.task_type, "audio_action": t.audio_action,
                          "stage": t.stage, "status_url": f"/api/v1/tasks/{t.id}"} for t in active],
        "created_at": iso(project.created_at), "updated_at": iso(project.updated_at)}
