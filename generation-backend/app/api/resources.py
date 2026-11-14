from typing import Annotated

from fastapi import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.api.dependencies import SessionDep, UserDep
from app.core.common import BusinessError, envelope, iso
from app.db.models import Asset, RoleProfile

PathId = Annotated[int, Path(gt=0)]

router = APIRouter(prefix="/api/v1")


@router.get("/roles", tags=["配置模块"], summary="固定测试角色", response_model=dict)
def roles(request: Request, session: SessionDep, user: UserDep,
          page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    conditions = [RoleProfile.user_id == user, RoleProfile.status == "enabled"]
    values = session.scalars(select(RoleProfile).where(*conditions).order_by(RoleProfile.created_at, RoleProfile.id)
                             .offset((page - 1) * page_size).limit(page_size)).all()
    total = session.scalar(select(func.count()).select_from(RoleProfile).where(*conditions))
    items = [{"profile_id": r.id, "name": r.name, "description": r.description, **r.voice_config,
              "status": r.status, "created_at": iso(r.created_at), "updated_at": iso(r.updated_at)} for r in values]
    return envelope(request, {"items": items, "page": page, "page_size": page_size, "total": total})


def file_response(asset_id, request, session, user, download):
    asset = session.get(Asset, asset_id)
    if asset is None or asset.user_id != user or asset.status != "ready" or asset.kind != "full_audio":
        raise BusinessError("RESOURCE_NOT_FOUND", "音频不存在", 404)
    path = request.app.state.storage.readable(asset.object_key)
    if path.stat().st_size != asset.size_bytes:
        raise BusinessError("AUDIO_FILE_MISSING", "音频文件不完整", 404)
    return FileResponse(path, media_type="audio/mpeg", filename=f"测试播客_{asset.id}.mp3",
                        content_disposition_type="attachment" if download else "inline")


@router.get("/audio-assets/{asset_id}/download", tags=["语音模块"], summary="下载完整测试MP3", response_class=FileResponse)
def download(asset_id: PathId, request: Request, session: SessionDep, user: UserDep):
    return file_response(asset_id, request, session, user, True)


@router.get("/audio-assets/{asset_id}/play", tags=["语音模块"], summary="播放完整测试MP3", response_class=FileResponse)
def play(asset_id: PathId, request: Request, session: SessionDep, user: UserDep):
    return file_response(asset_id, request, session, user, False)
