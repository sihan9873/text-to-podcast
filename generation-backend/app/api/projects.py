from typing import Annotated

from fastapi import Path

from fastapi import APIRouter, Query, Request

from app.api.dependencies import SessionDep, UserDep
from app.core.common import envelope
from app.schemas import Envelope, ProjectCreate, SourceSubmit
from app.services import projects
from app.services.views import owned_project, project_view

PathId = Annotated[int, Path(gt=0)]

router = APIRouter(prefix="/api/v1/projects", tags=["项目模块"])


@router.post("", status_code=201, response_model=Envelope[dict], summary="创建项目")
def create(body: ProjectCreate, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, projects.create_project(session, user, body.title))


@router.get("", response_model=Envelope[dict], summary="项目列表")
def listing(request: Request, session: SessionDep, user: UserDep,
            page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
            keyword: str | None = Query(None, max_length=100)):
    return envelope(request, projects.list_projects(session, user, page, page_size, keyword))


@router.get("/{project_id}", response_model=Envelope[dict], summary="项目详情与任务恢复")
def detail(project_id: PathId, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, project_view(session, owned_project(session, project_id, user)))


@router.put("/{project_id}/source", response_model=Envelope[dict], summary="确认提交并锁定原文")
def source(project_id: PathId, body: SourceSubmit, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, projects.submit_source(session, user, project_id, body.text))
