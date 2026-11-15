from typing import Annotated

from fastapi import Path

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import func, select

from app.api.dependencies import IdempotencyDep, SessionDep, UserDep
from app.core.common import BusinessError, envelope, iso
from app.db.models import Script, ScriptSentence, Task
from app.jobs.repository import submit
from app.schemas import AudioGenerate, ConfirmScript, Envelope, ScriptGenerate, ScriptView, TaskAccepted
from app.services.scripts import confirm_script
from app.services.views import owned_project, owned_script, script_view, task_view

PathId = Annotated[int, Path(gt=0)]

router = APIRouter(prefix="/api/v1")


@router.post("/projects/{project_id}/script/generate", status_code=202, response_model=Envelope[TaskAccepted], tags=["脚本模块"], summary="提交模拟脚本任务（10秒）")
def generate_script(project_id: PathId, body: ScriptGenerate, request: Request, response: Response,
                    session: SessionDep, user: UserDep, key: IdempotencyDep):
    data, response.status_code = submit(session, user, project_id, "script", body, key, request.app.state.settings)
    response.headers["Location"] = data["status_url"]
    response.headers["Retry-After"] = "1"
    return envelope(request, data, "模拟脚本任务")


@router.get("/scripts/{script_id}", response_model=Envelope[ScriptView], tags=["脚本模块"], summary="脚本详情")
def get_script(script_id: PathId, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, script_view(session, owned_script(session, script_id, user)))


@router.get("/projects/{project_id}/scripts", response_model=Envelope[dict], tags=["脚本模块"], summary="查询项目脚本版本")
def list_scripts(project_id: PathId, request: Request, session: SessionDep, user: UserDep,
                 page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                 status: str | None = Query(None, pattern="^(draft|confirmed)$")):
    owned_project(session, project_id, user)
    conditions = [Script.project_id == project_id]
    if status:
        conditions.append(Script.status == status)

    total = session.scalar(select(func.count()).select_from(Script).where(*conditions)) or 0
    sentence_counts = (select(ScriptSentence.script_id, func.count(ScriptSentence.id).label("sentence_count"))
                       .group_by(ScriptSentence.script_id).subquery())
    rows = session.execute(
        select(Script, func.coalesce(sentence_counts.c.sentence_count, 0))
        .outerjoin(sentence_counts, sentence_counts.c.script_id == Script.id)
        .where(*conditions)
        .order_by(Script.version.desc(), Script.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return envelope(request, {
        "items": [{
            "script_id": script.id,
            "project_id": script.project_id,
            "version": script.version,
            "edit_revision": script.edit_revision,
            "title": script.title,
            "summary": script.summary,
            "status": script.status,
            "sentence_count": sentence_count,
            "confirmed_at": iso(script.confirmed_at),
            "created_at": iso(script.created_at),
            "updated_at": iso(script.updated_at),
        } for script, sentence_count in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
    })


@router.post("/scripts/{script_id}/confirm", response_model=Envelope[dict], tags=["脚本模块"], summary="确认脚本")
def confirm(script_id: PathId, body: ConfirmScript, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, confirm_script(session, user, script_id, body))


@router.post("/projects/{project_id}/audio/generate", status_code=202, response_model=Envelope[TaskAccepted], tags=["语音模块"], summary="提交模拟音频任务（10秒）")
def generate_audio(project_id: PathId, body: AudioGenerate, request: Request, response: Response,
                   session: SessionDep, user: UserDep, key: IdempotencyDep):
    data, response.status_code = submit(session, user, project_id, "audio", body, key, request.app.state.settings)
    response.headers["Location"] = data["status_url"]
    response.headers["Retry-After"] = "1"
    return envelope(request, data, "模拟音频任务：返回固定测试音，非正文朗读")


@router.get("/tasks/{task_id}", response_model=Envelope[dict], tags=["任务模块"], summary="查询任务状态")
def get_task(task_id: PathId, request: Request, session: SessionDep, user: UserDep):
    task = session.get(Task, task_id)
    if task is None or task.user_id != user:
        raise BusinessError("RESOURCE_NOT_FOUND", "任务不存在", 404)
    owned_project(session, task.project_id, user)
    return envelope(request, task_view(task))


@router.get("/projects/{project_id}/tasks", response_model=Envelope[dict], tags=["任务模块"], summary="查询项目任务历史")
def list_tasks(project_id: PathId, request: Request, session: SessionDep, user: UserDep,
               page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
               task_type: str | None = Query(None, pattern="^(script|audio)$"),
               status: str | None = Query(None, pattern="^(queued|running|succeeded|failed)$"),
               audio_action: str | None = Query(None, pattern="^(full)$"),
               audio_version_id: int | None = Query(None, gt=0)):
    owned_project(session, project_id, user)
    conditions = [Task.project_id == project_id, Task.user_id == user]
    if task_type:
        conditions.append(Task.task_type == task_type)
    if status:
        conditions.append(Task.status == status)
    if audio_action:
        conditions.append(Task.audio_action == audio_action)
    if audio_version_id:
        conditions.append(Task.audio_version_id == audio_version_id)
    total = session.scalar(select(func.count()).select_from(Task).where(*conditions)) or 0
    tasks = session.scalars(select(Task).where(*conditions)
        .order_by(Task.created_at.desc(), Task.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).all()
    return envelope(request, {
        "items": [task_view(task) for task in tasks],
        "page": page,
        "page_size": page_size,
        "total": total,
    })
