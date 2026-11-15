"""Minimum persisted workflow used by the current web frontend."""
from copy import deepcopy
from typing import Annotated

from fastapi import APIRouter, Path, Query, Request
from pydantic import Field
from sqlalchemy import func, select

from app.api.dependencies import SessionDep, UserDep
from app.core.common import BusinessError, envelope, iso
from app.db.database import transaction
from app.db.models import Asset, AudioVersion, Script, ScriptRole, ScriptSentence, Task
from app.schemas import ConfirmScript, Id, Input
from app.services.views import owned_project, owned_script, script_view, task_view
from app.api.role_management import validate_voice

router = APIRouter(prefix="/api/v1", tags=["工作流"])
PathId = Annotated[int, Path(gt=0)]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


class SavedRole(Input):
    role_id: Id
    role_key: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    voice_config: dict


class SavedSentence(Input):
    sentence_id: Id
    sequence: int = Field(ge=1)
    role_id: Id
    text: str = Field(min_length=1, max_length=1000)
    speed: float | None = None
    extra_params: dict = Field(default_factory=dict)


class SaveScript(ConfirmScript):
    title: str = Field(min_length=1, max_length=100)
    summary: str | None = Field(default=None, max_length=2000)
    roles: list[SavedRole] = Field(min_length=1, max_length=8)
    sentences: list[SavedSentence] = Field(min_length=1, max_length=5000)


def revision_script(session, user, script_id, body):
    script = owned_script(session, script_id, user)
    project = owned_project(session, script.project_id, user, lock=True)
    script = session.scalar(select(Script).where(Script.id == script_id).with_for_update().execution_options(populate_existing=True))
    if project.active_task_id:
        raise BusinessError("TASK_ALREADY_RUNNING", "请等待生成任务完成")
    if script.version != body.expected_script_version or script.edit_revision != body.expected_edit_revision:
        raise BusinessError("REVISION_CONFLICT", "脚本已变化，请刷新后重试")
    return script, project


@router.get("/projects/{project_id}/scripts")
def list_scripts(project_id: PathId, request: Request, session: SessionDep, user: UserDep,
                 page: Page = 1, page_size: PageSize = 20, status: str | None = None):
    owned_project(session, project_id, user)
    conditions = [Script.project_id == project_id]
    if status:
        conditions.append(Script.status == status)
    total = session.scalar(select(func.count()).select_from(Script).where(*conditions))
    values = session.scalars(select(Script).where(*conditions).order_by(Script.version.desc()).offset((page-1)*page_size).limit(page_size)).all()
    items = []
    for script in values:
        view = script_view(session, script)
        items.append({k: v for k, v in view.items() if k not in ("roles", "sentences", "editable")})
        items[-1]["sentence_count"] = len(view["sentences"])
    return envelope(request, {"items": items, "page": page, "page_size": page_size, "total": total})


@router.put("/scripts/{script_id}")
def save(script_id: PathId, body: SaveScript, request: Request, session: SessionDep, user: UserDep):
    with transaction(session):
        script, _ = revision_script(session, user, script_id, body)
        if script.status != "draft":
            raise BusinessError("SCRIPT_LOCKED", "已确认脚本需先取消确认")
        roles = session.scalars(select(ScriptRole).where(ScriptRole.script_id == script.id)).all()
        sentences = session.scalars(select(ScriptSentence).where(ScriptSentence.script_id == script.id)).all()
        role_map, sentence_map = {r.id: r for r in roles}, {s.id: s for s in sentences}
        if (len(body.roles) != len(role_map) or {r.role_id for r in body.roles} != set(role_map)
            or len(body.sentences) != len(sentence_map) or {s.sentence_id for s in body.sentences} != set(sentence_map)
            or {s.sequence for s in body.sentences} != set(range(1, len(sentences)+1))
            or sum(len(s.text) for s in body.sentences) > 5000 or not body.title.strip()):
            raise BusinessError("INVALID_INPUT", "请保持角色、句子与顺序完整，台词总长不超过 5000 字", 422)
        for role in body.roles:
            original = role_map[role.role_id]
            if role.role_key != original.role_key or not role.name.strip():
                raise BusinessError("INVALID_ROLE", "角色标识不可改变", 422)
            validate_voice(session, user, role.voice_config, request.app.state.settings)
            original.name, original.description, original.voice_config = role.name.strip(), role.description, deepcopy(role.voice_config)
        # The UI currently keeps sentence order fixed; avoiding transient unique conflicts.
        for item in body.sentences:
            original = sentence_map[item.sentence_id]
            if item.sequence != original.sequence or item.role_id not in role_map or not item.text.strip() or item.extra_params or item.speed not in (None, 1.0):
                raise BusinessError("INVALID_AUDIO_PARAMS", "台词、角色、语速或顺序无效", 422)
            original.text, original.role_id, original.speed = item.text, item.role_id, item.speed
        script.title, script.summary = body.title.strip(), body.summary
        script.edit_revision += 1
        session.flush()
        return envelope(request, script_view(session, script))


@router.post("/scripts/{script_id}/unconfirm")
def unconfirm(script_id: PathId, body: ConfirmScript, request: Request, session: SessionDep, user: UserDep):
    with transaction(session):
        script, project = revision_script(session, user, script_id, body)
        script.status, script.confirmed_at, script.confirmed_by, script.confirmed_revision = "draft", None, None, None
        if project.confirmed_script_id == script.id:
            project.confirmed_script_id = None
        session.flush()
        result = script_view(session, script)
        return envelope(request, {k: result[k] for k in ("script_id", "version", "edit_revision", "status", "confirmed_at", "confirmed_by", "confirmed_revision")})


@router.get("/projects/{project_id}/tasks")
def list_tasks(project_id: PathId, request: Request, session: SessionDep, user: UserDep,
               page: Page = 1, page_size: PageSize = 20, status: str | None = None,
               task_type: str | None = None, audio_version_id: int | None = None):
    owned_project(session, project_id, user)
    conditions = [Task.project_id == project_id, Task.user_id == user]
    for field, value in ((Task.status, status), (Task.task_type, task_type), (Task.audio_version_id, audio_version_id)):
        if value is not None:
            conditions.append(field == value)
    total = session.scalar(select(func.count()).select_from(Task).where(*conditions))
    values = session.scalars(select(Task).where(*conditions).order_by(Task.id.desc()).offset((page-1)*page_size).limit(page_size)).all()
    return envelope(request, {"items": [task_view(t) for t in values], "page": page, "page_size": page_size, "total": total})


def audio_view(session, audio, detail=False):
    asset = session.get(Asset, audio.current_asset_id) if audio.current_asset_id else None
    script = session.get(Script, audio.script_id)
    result = {"audio_version_id": audio.id, "project_id": audio.project_id, "version": audio.version,
        "script_id": audio.script_id, "script_version": audio.script_snapshot["version"],
        "script_edit_revision": audio.script_edit_revision, "status": audio.status,
        "selection_revision": audio.selection_revision, "current_asset_id": audio.current_asset_id,
        "duration_ms": asset.duration_ms if asset else None, "size_bytes": asset.size_bytes if asset else None,
        "play_url": f"/api/v1/audio-assets/{asset.id}/play" if asset else None,
        "download_url": f"/api/v1/audio-assets/{asset.id}/download" if asset else None,
        "created_at": iso(audio.created_at), "updated_at": iso(audio.updated_at)}
    if detail:
        # Internal reference text and paths are not exposed in version metadata.
        result.update(script_snapshot=audio.script_snapshot, config_snapshot=audio.config_snapshot,
            source_script_changed=script.edit_revision != audio.script_edit_revision, active_tasks=[], supports_sentence_audio=False,
            metadata=asset.metadata_json if asset else None)
    return result


@router.get("/projects/{project_id}/audio-versions")
def list_audio(project_id: PathId, request: Request, session: SessionDep, user: UserDep,
               page: Page = 1, page_size: PageSize = 20, script_id: int | None = None):
    owned_project(session, project_id, user)
    conditions = [AudioVersion.project_id == project_id]
    if script_id is not None:
        conditions.append(AudioVersion.script_id == script_id)
    total = session.scalar(select(func.count()).select_from(AudioVersion).where(*conditions))
    values = session.scalars(select(AudioVersion).where(*conditions).order_by(AudioVersion.version.desc()).offset((page-1)*page_size).limit(page_size)).all()
    return envelope(request, {"items": [audio_view(session, a) for a in values], "page": page, "page_size": page_size, "total": total})


def owned_audio(session, user, audio_id):
    audio = session.get(AudioVersion, audio_id)
    if audio is None:
        raise BusinessError("RESOURCE_NOT_FOUND", "音频版本不存在", 404)
    owned_project(session, audio.project_id, user)
    return audio


@router.get("/audio-versions/{audio_id}")
def audio_detail(audio_id: PathId, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, audio_view(session, owned_audio(session, user, audio_id), True))


@router.get("/audio-versions/{audio_id}/sentences")
def audio_sentences(audio_id: PathId, request: Request, session: SessionDep, user: UserDep):
    audio = owned_audio(session, user, audio_id)
    return envelope(request, {"audio_version_id": audio.id, "version": audio.version, "selection_revision": audio.selection_revision,
        "total_sentences": len(audio.script_snapshot["sentences"]), "completed_sentences": len(audio.script_snapshot["sentences"]) if audio.status == "ready" else 0,
        "failed_sentences": 0, "sentences": [], "supports_sentence_audio": False})
