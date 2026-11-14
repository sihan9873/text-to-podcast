import hashlib

from sqlalchemy import func, select

from app.core.common import BusinessError, iso, utcnow
from app.db.database import transaction
from app.db.models import Project
from app.db.seed import MODEL_ID
from app.services.views import owned_project, project_view


def create_project(session, user_id, title):
    with transaction(session):
        project = Project(user_id=user_id, title=title, llm_model_id=MODEL_ID)
        session.add(project)
        session.flush()
        return {"project_id": project.id, "title": project.title, "source_submitted": False,
                "created_at": iso(project.created_at), "updated_at": iso(project.updated_at)}


def submit_source(session, user_id, project_id, text):
    with transaction(session):
        project = owned_project(session, project_id, user_id, lock=True)
        if project.source_submitted_at is not None:
            raise BusinessError("SOURCE_LOCKED", "原文已经提交，不允许修改或替换")
        project.source_text, project.source_type = text, "text"
        project.source_hash = hashlib.sha256(text.encode()).hexdigest()
        project.source_submitted_at = utcnow()
        session.flush()
        return {"project_id": project.id, "source_text": text, "source_type": "text", "source_asset_id": None,
                "source_hash": project.source_hash, "source_submitted": True,
                "source_submitted_at": iso(project.source_submitted_at)}


def list_projects(session, user_id, page, page_size, keyword=None):
    conditions = [Project.user_id == user_id]
    if keyword:
        conditions.append(Project.title.contains(keyword, autoescape=True))
    total = session.scalar(select(func.count()).select_from(Project).where(*conditions))
    values = session.scalars(select(Project).where(*conditions).order_by(Project.created_at.desc(), Project.id.desc())
                             .offset((page - 1) * page_size).limit(page_size)).all()
    items = []
    for p in values:
        detail = project_view(session, p)
        items.append({"project_id": p.id, "title": p.title, "source_submitted": detail["source_submitted"],
            "current_script_id": p.current_script_id, "confirmed_script_id": p.confirmed_script_id,
            "latest_audio_version_id": detail["latest_audio"]["audio_version_id"] if detail["latest_audio"] else None,
            "created_at": iso(p.created_at), "updated_at": iso(p.updated_at)})
    return {"items": items, "page": page, "page_size": page_size, "total": total}
