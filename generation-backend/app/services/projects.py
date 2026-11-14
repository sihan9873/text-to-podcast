import hashlib

from sqlalchemy import func, select

from app.core.common import BusinessError, iso, utcnow
from app.db.database import transaction
from app.db.models import Project, SourceChunk
from app.db.seed import MODEL_ID
from app.services.views import owned_project, project_view
from app.services.source_segmentation import segment_source


def create_project(session, user_id, title):
    with transaction(session):
        project = Project(user_id=user_id, title=title, llm_model_id=MODEL_ID)
        session.add(project)
        session.flush()
        return {"project_id": project.id, "title": project.title, "source_submitted": False,
                "created_at": iso(project.created_at), "updated_at": iso(project.updated_at)}


def _plan(body):
    try:
        return segment_source(body.text, body.source_type, body.segmentation_mode,
                              body.target_minutes, body.chars_per_minute)
    except ValueError as exc:
        raise BusinessError("INVALID_SOURCE", str(exc), 422) from exc


def _source_response(project, plan, include_chunks=True, source_name=None):
    value = {
        "project_id": project.id,
        "source_text": plan["source_text"],
        "source_type": plan["source_type"],
        "source_name": project.source_name if source_name is None else source_name,
        "source_asset_id": None,
        "source_hash": project.source_hash,
        "source_submitted": project.source_submitted_at is not None,
        "source_submitted_at": iso(project.source_submitted_at),
        "character_count": plan["character_count"],
        "spoken_character_count": plan["spoken_character_count"],
        "estimated_seconds": plan["estimated_seconds"],
        "segmentation_mode": plan["segmentation_mode"],
        "target_minutes": plan["target_minutes"],
        "chars_per_minute": plan["chars_per_minute"],
        "chunk_count": plan["chunk_count"],
    }
    if include_chunks:
        value["chunks"] = plan["chunks"]
    return value


def preview_source(session, user_id, project_id, body):
    project = owned_project(session, project_id, user_id)
    if project.source_submitted_at is not None:
        raise BusinessError("SOURCE_LOCKED", "原文已经提交，不允许修改或替换")
    plan = _plan(body)
    return _source_response(project, plan, source_name=body.source_name)


def submit_source(session, user_id, project_id, body):
    plan = _plan(body)
    with transaction(session):
        project = owned_project(session, project_id, user_id, lock=True)
        if project.source_submitted_at is not None:
            raise BusinessError("SOURCE_LOCKED", "原文已经提交，不允许修改或替换")
        project.source_text = plan["source_text"]
        project.source_type = plan["source_type"]
        project.source_name = body.source_name
        project.source_hash = hashlib.sha256(plan["source_text"].encode()).hexdigest()
        project.source_character_count = plan["character_count"]
        project.source_estimated_seconds = plan["estimated_seconds"]
        project.source_chunk_count = plan["chunk_count"]
        project.segmentation_mode = plan["segmentation_mode"]
        project.target_minutes = plan["target_minutes"]
        project.chars_per_minute = plan["chars_per_minute"]
        project.source_submitted_at = utcnow()
        session.add_all([
            SourceChunk(
                project_id=project.id,
                sequence=item["sequence"],
                text=item["text"],
                character_count=item["character_count"],
                estimated_seconds=item["estimated_seconds"],
                boundary_type=item["boundary_type"],
            )
            for item in plan["chunks"]
        ])
        session.flush()
        return _source_response(project, plan)


def source_chunks(session, user_id, project_id):
    project = owned_project(session, project_id, user_id)
    if project.source_submitted_at is None:
        raise BusinessError("SOURCE_NOT_SUBMITTED", "请先确认提交原文")
    chunks = session.scalars(
        select(SourceChunk).where(SourceChunk.project_id == project.id).order_by(SourceChunk.sequence)
    ).all()
    return {
        "project_id": project.id,
        "source_hash": project.source_hash,
        "source_type": project.source_type,
        "source_name": project.source_name,
        "segmentation_mode": project.segmentation_mode,
        "target_minutes": project.target_minutes,
        "chars_per_minute": project.chars_per_minute,
        "chunk_count": len(chunks),
        "items": [{
            "chunk_id": chunk.id,
            "sequence": chunk.sequence,
            "text": chunk.text,
            "character_count": chunk.character_count,
            "estimated_seconds": chunk.estimated_seconds,
            "boundary_type": chunk.boundary_type,
        } for chunk in chunks],
    }


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
