from typing import Any, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Request
from pydantic import Field
from .schemas import StrictModel
from .contracts import Envelope, envelope
from .database import Database
from .dependencies import get_current_user, get_database
from .errors import ApiError
from .project_repository import ProjectRepository

class CreateProject(StrictModel):
    title: str = Field(min_length=1, max_length=100)
    input_type: Literal['text']
    raw_text: str

class ProjectOut(StrictModel):
    project_id: UUID
    title: str
    source_text: str
    status: Literal['draft','script_generating','script_review','script_ready','audio_generating','audio_review','audio_ready','exporting','completed','failed']
    script_version: int
    config_version: int
    created_at: str
    updated_at: str

class ProjectService:
    def __init__(self, repository: ProjectRepository):
        self.repository = repository

    def create(self, user_id: str, payload: CreateProject):
        title = payload.title.strip()
        text = payload.raw_text.replace('\r\n','\n').replace('\r','\n').strip()
        text = ''.join(char for char in text if char in '\n\t' or (ord(char) >= 32 and not 127 <= ord(char) <= 159)).strip()
        if len(text) > 20000:
            raise ApiError(413, 'TEXT_TOO_LONG', '原文不能超过 20000 字符')
        if not title:
            raise ApiError(400, 'INVALID_INPUT', '标题不能为空')
        if not text:
            raise ApiError(400, 'TEXT_EMPTY', '原文不能为空')
        return self.repository.create(user_id, title, text)

    def get_owned(self, user_id: str, project_id: str):
        project = self.repository.get_owned(user_id, project_id)
        if project is None:
            raise ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在')
        return project

def get_project_service(database: Database = Depends(get_database)) -> ProjectService:
    return ProjectService(ProjectRepository(database))

router = APIRouter(prefix='/projects', tags=['projects'])

@router.post('', status_code=201, response_model=Envelope[ProjectOut])
def create_project(payload: CreateProject, request: Request,
                   user: dict[str, Any] = Depends(get_current_user),
                   service: ProjectService = Depends(get_project_service)):
    return envelope(request, service.create(user['id'], payload))

@router.get('/{project_id}', response_model=Envelope[ProjectOut])
def get_project(project_id: UUID, request: Request,
                user: dict[str, Any] = Depends(get_current_user),
                service: ProjectService = Depends(get_project_service)):
    return envelope(request, service.get_owned(user['id'], str(project_id)))
