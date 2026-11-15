from typing import Annotated, Literal

from fastapi import APIRouter, Path, Request, Response
from pydantic import Field, StringConstraints, field_validator
from sqlalchemy import select

from app.api.dependencies import IdempotencyDep, SessionDep, UserDep
from app.core.common import BusinessError, envelope
from app.db.database import transaction
from app.db.models import VoiceProfile
from app.schemas import Id, Input
from app.services import voices

router = APIRouter(prefix="/api/v1", tags=["声音克隆"])
PathId = Annotated[int, Path(gt=0)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Transcript = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class VoiceCreate(Input):
    name: Name
    reference_asset_id: Id
    reference_text: Transcript
    language: Literal["Chinese", "English"] = "Chinese"
    authorized: bool = Field(strict=True)

    @field_validator("authorized")
    @classmethod
    def consent(cls, value):
        if not value:
            raise ValueError("请确认已获得声音使用授权")
        return value


class VoiceUpdate(Input):
    name: Name | None = None
    status: Literal["enabled", "disabled"] | None = None


class Preview(Input):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


@router.post("/voice-references", status_code=201)
async def upload(request: Request, session: SessionDep, user: UserDep):
    # Raw WAV/MP3 upload avoids multipart parsers and buffers at most 10 MiB.
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > voices.MAX_UPLOAD:
            raise BusinessError("UPLOAD_TOO_LARGE", "录音不能超过 10 MiB", 413)
        content.extend(chunk)
    return envelope(request, voices.upload_reference(session, user, bytes(content), request.app.state.settings))


@router.post("/voice-profiles", status_code=201)
def create(body: VoiceCreate, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, voices.create_voice(session, user, body))


@router.get("/voice-profiles")
def list_voices(request: Request, session: SessionDep, user: UserDep):
    values = session.scalars(select(VoiceProfile).where(VoiceProfile.user_id == user).order_by(VoiceProfile.id.desc())).all()
    return envelope(request, {"items": [voices.voice_view(session, p) for p in values]})


@router.get("/voice-profiles/{profile_id}")
def detail(profile_id: PathId, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, voices.voice_view(session, voices.owned_voice(session, user, profile_id)))


@router.patch("/voice-profiles/{profile_id}")
def update(profile_id: PathId, body: VoiceUpdate, request: Request, session: SessionDep, user: UserDep):
    with transaction(session):
        profile = voices.owned_voice(session, user, profile_id)
        for field, value in body.model_dump(exclude_unset=True).items():
            if value is None:
                raise BusinessError("INVALID_INPUT", "名称和状态不能为 null", 422)
            setattr(profile, field, value)
        session.flush()
        return envelope(request, voices.voice_view(session, profile))


@router.post("/voice-profiles/{profile_id}/preview", status_code=202)
def preview(profile_id: PathId, body: Preview, request: Request, response: Response,
            session: SessionDep, user: UserDep, key: IdempotencyDep):
    result, response.status_code = voices.submit_preview(session, user, profile_id, body, key, request.app.state.settings)
    return envelope(request, result)
