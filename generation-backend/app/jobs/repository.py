from copy import deepcopy
from datetime import timedelta
import hashlib
import json

from sqlalchemy import func, select, update

from app.core.common import BusinessError, new_token, utcnow
from app.db.database import transaction
from app.db.models import AudioVersion, LLMModel, Project, RoleProfile, Script, SourceChunk, Task
from app.integrations.local_llm import SYSTEM_PROMPT, script_config
from app.integrations.local_tts import audio_config
from app.services.views import accepted, owned_project, script_view


def submit(session, user_id, project_id, task_type, body, key, settings):
    # Defaults are excluded so adding an optional preference does not invalidate
    # idempotency keys stored by an older compatible release.
    signature = json.dumps({"project_id": project_id, "type": task_type,
                            "body": body.model_dump(mode="json", exclude_defaults=True)}, sort_keys=True)
    request_hash = hashlib.sha256(signature.encode()).hexdigest()
    with transaction(session):
        project = owned_project(session, project_id, user_id, lock=True)
        existing = session.scalar(select(Task).where(Task.user_id == user_id, Task.idempotency_key == key))
        if existing:
            if existing.request_hash != request_hash:
                raise BusinessError("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求")
            return accepted(existing), 200 if existing.status in ("succeeded", "failed") else 202
        if project.active_task_id:
            raise BusinessError("TASK_ALREADY_RUNNING", "项目已有生成任务，请通过项目详情查询")
        active_count = session.scalar(select(func.count()).select_from(Task).where(Task.status.in_(["queued", "running"])))
        if active_count >= settings.max_pending_tasks:
            raise BusinessError("QUEUE_FULL", "任务队列已满，请稍后提交", 429)
        if project.source_submitted_at is None:
            raise BusinessError("SOURCE_NOT_SUBMITTED", "请先确认提交原文")
        source_chunks = session.scalars(
            select(SourceChunk).where(SourceChunk.project_id == project.id).order_by(SourceChunk.sequence)
        ).all()
        snapshot = {
            "source_text": project.source_text,
            "source_hash": project.source_hash,
            "source_type": project.source_type,
            "segmentation_mode": project.segmentation_mode,
            "source_chunks": [{
                "chunk_id": chunk.id,
                "sequence": chunk.sequence,
                "text": chunk.text,
                "character_count": chunk.character_count,
                "estimated_seconds": chunk.estimated_seconds,
            } for chunk in source_chunks],
            "simulated": True,
        }
        script = None
        audio = None
        if task_type == "script":
            model = session.get(LLMModel, project.llm_model_id)
            if model is None or not model.enabled:
                raise BusinessError("MODEL_UNAVAILABLE", "项目模型不可用")
            snapshot["model"] = {"model_id": model.id, "provider_code": model.provider_code,
                                  "model_code": model.model_code, "params": deepcopy(model.params)}
            snapshot["prompt"] = (SYSTEM_PROMPT if settings.llm_provider == "local_http"
                                  else "mock-script-v1：返回预置测试脚本，不调用真实模型")
            snapshot["llm_config"] = script_config(settings)
            snapshot["simulated"] = settings.llm_provider == "mock"
            snapshot["generation_preferences"] = {
                "target_minutes": body.target_minutes,
                "target_characters": min(5_000, body.target_minutes * 240),
                "style": body.style.strip(),
            }
            snapshot["roles"] = []
            for role in body.roles:
                profile = session.get(RoleProfile, role.profile_id)
                if profile is None or profile.user_id != user_id or profile.status != "enabled":
                    raise BusinessError("INVALID_ROLE", "角色配置不存在或不可使用", 422)
                snapshot["roles"].append({"profile_id": profile.id, "role_key": role.role_key, "name": profile.name,
                    "description": profile.description, "voice_config": deepcopy(profile.voice_config)})
        else:
            script = session.scalar(select(Script).where(Script.id == body.script_id, Script.project_id == project.id).with_for_update())
            if script is None:
                raise BusinessError("RESOURCE_NOT_FOUND", "脚本不存在", 404)
            if script.version != body.expected_script_version or script.edit_revision != body.expected_edit_revision:
                raise BusinessError("REVISION_CONFLICT", "脚本版本或内部修订不匹配")
            if script.status != "confirmed" or project.confirmed_script_id != script.id or script.confirmed_revision != script.edit_revision:
                raise BusinessError("SCRIPT_NOT_CONFIRMED", "请先确认该脚本")
            snapshot["script"] = script_view(session, script)
            snapshot["audio_config"] = audio_config(settings)
            snapshot["simulated"] = snapshot["audio_config"]["simulated"]
            version = (session.scalar(select(func.max(AudioVersion.version)).where(AudioVersion.project_id == project.id)) or 0) + 1
            audio = AudioVersion(project_id=project.id, script_id=script.id, version=version,
                script_edit_revision=script.edit_revision, script_snapshot=deepcopy(snapshot["script"]),
                config_snapshot={"roles": deepcopy(snapshot["script"]["roles"]),
                                 **deepcopy(snapshot["audio_config"])})
            session.add(audio)
            session.flush()
        task = Task(user_id=user_id, project_id=project.id, task_type=task_type,
            audio_action="full" if task_type == "audio" else None,
            script_id=script.id if script else None, audio_version_id=audio.id if audio else None,
            input_snapshot=snapshot, idempotency_key=key, request_hash=request_hash,
            total_sentences=len(snapshot["script"]["sentences"]) if script else 0)
        session.add(task)
        session.flush()
        # 同事务绑定活动任务，API返回前已经持久化，Worker扫描不会丢单。
        changed = session.execute(update(Project).where(Project.id == project.id, Project.active_task_id.is_(None))
                                  .values(active_task_id=task.id, updated_at=utcnow())).rowcount
        if changed != 1:
            raise BusinessError("TASK_ALREADY_RUNNING", "项目已有生成任务")
        return accepted(task), 202


def claim(database, settings):
    with database.sessions() as session, transaction(session):
        task = session.scalar(select(Task).where(Task.status == "queued").order_by(Task.created_at, Task.id)
                              .limit(1).with_for_update(skip_locked=True))
        if task is None:
            return None
        token = new_token()
        now = utcnow()
        changed = session.execute(update(Task).where(Task.id == task.id, Task.status == "queued")
            .values(status="running", stage="calling_llm" if task.task_type == "script" else "synthesizing",
                    progress=5, lease_token=token, heartbeat_at=now, started_at=now,
                    lease_expires_at=now + timedelta(seconds=settings.lease_seconds), updated_at=now)).rowcount
        if changed != 1:
            return None
        if task.audio_version_id:
            session.execute(update(AudioVersion).where(AudioVersion.id == task.audio_version_id).values(status="running"))
        return {"id": task.id, "token": token, "task_type": task.task_type,
                "snapshot": deepcopy(task.input_snapshot), "user_id": task.user_id, "project_id": task.project_id}


def heartbeat(database, task_id, token, settings):
    with database.sessions() as session, transaction(session):
        now = utcnow()
        session.execute(update(Task).where(Task.id == task_id, Task.status == "running", Task.lease_token == token)
            .values(heartbeat_at=now, lease_expires_at=now + timedelta(seconds=settings.lease_seconds)))


def progress(database, task_id, token, stage, percent):
    """Publish coarse pipeline progress without exposing model prompts or text."""
    with database.sessions() as session, transaction(session):
        changed = session.execute(update(Task).where(
            Task.id == task_id, Task.status == "running", Task.lease_token == token,
        ).values(stage=stage, progress=max(5, min(95, int(percent))), updated_at=utcnow())).rowcount
        return changed == 1


def fail(database, task_id, token, code, message):
    with database.sessions() as session, transaction(session):
        task = session.scalar(select(Task).where(Task.id == task_id, Task.status == "running", Task.lease_token == token).with_for_update())
        if task is None:
            return False
        task.status, task.stage = "failed", "failed"
        task.error_code, task.error_message, task.finished_at = code, message, utcnow()
        task.lease_expires_at = None
        if task.audio_version_id:
            session.execute(update(AudioVersion).where(AudioVersion.id == task.audio_version_id).values(status="failed"))
        session.execute(update(Project).where(Project.id == task.project_id, Project.active_task_id == task.id)
                        .values(active_task_id=None, updated_at=utcnow()))
        return True


def recover_expired(database):
    with database.sessions() as session:
        expired = session.execute(select(Task.id, Task.lease_token).where(Task.status == "running", Task.lease_expires_at < utcnow())).all()
    recovered = 0
    for task_id, token in expired:
        # 再检查到期条件，避免扫描后心跳已经续租却误报失败。
        with database.sessions() as session, transaction(session):
            task = session.scalar(select(Task).where(Task.id == task_id, Task.status == "running",
                Task.lease_token == token, Task.lease_expires_at < utcnow()).with_for_update())
            if task is None:
                continue
            task.status, task.stage = "failed", "failed"
            task.error_code, task.error_message = "WORKER_INTERRUPTED", "后台执行中断，请使用新幂等键重新提交当前阶段"
            task.finished_at, task.lease_expires_at = utcnow(), None
            if task.audio_version_id:
                session.execute(update(AudioVersion).where(AudioVersion.id == task.audio_version_id).values(status="failed"))
            session.execute(update(Project).where(Project.id == task.project_id, Project.active_task_id == task.id)
                            .values(active_task_id=None, updated_at=utcnow()))
            recovered += 1
    return recovered
