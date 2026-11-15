"""Persisted roles and deployment-backed voice capabilities."""
from typing import Annotated

from fastapi import APIRouter, Path, Query, Request
from sqlalchemy import select

from app.api.dependencies import SessionDep, UserDep
from app.configuration_schemas import RoleProfileCreate, RoleProfileUpdate
from app.core.common import BusinessError, envelope, iso
from app.db.database import transaction
from app.db.models import LLMModel, RoleProfile, VoiceProfile, VoiceVersion
from app.integrations.local_tts import LocalTTSAudioGenerator, audio_config
from app.services.voices import clone_reference

router = APIRouter(prefix="/api/v1", tags=["角色与音色"])
PathId = Annotated[int, Path(gt=0)]


@router.get("/capabilities")
def capabilities(request: Request, user: UserDep):
    settings = request.app.state.settings
    return envelope(request, {"audio_preview": False, "sentence_audio": False,
        "voice_cloning": settings.audio_provider == "local_http" and settings.tts_engine_id == "qwen3-base"})


def owned_role(session, user, profile_id):
    profile = session.get(RoleProfile, profile_id)
    if profile is None or profile.user_id != user:
        raise BusinessError("RESOURCE_NOT_FOUND", "角色不存在", 404)
    return profile


def role_view(role):
    return {"profile_id": role.id, "name": role.name, "description": role.description, **role.voice_config,
            "status": role.status, "created_at": iso(role.created_at), "updated_at": iso(role.updated_at)}


def voice_items(session, user, settings):
    base = {"language": "Chinese", "styles": [], "default_style": None,
            "speed": {"supported": False, "min": 1.0, "max": 1.0, "default": 1.0}, "extra_parameter_schema": {}}
    if settings.audio_provider == "mock":
        return [{**base, "voice_id": "test-tone", "name": "模拟测试音（非真人语音）", "tts_provider": "mock", "tts_model": "mock-audio-v1"}]
    engine_id = settings.tts_engine_id
    if engine_id == "qwen3-base":
        rows = session.execute(select(VoiceVersion, VoiceProfile).join(VoiceProfile).where(
            VoiceProfile.user_id == user, VoiceProfile.status == "enabled")).all()
        return [{**base, "voice_id": f"clone_{v.id}", "name": p.name + "（克隆）", "tts_provider": "local_http",
                 "tts_model": engine_id, "language": v.language} for v, p in rows]
    client = LocalTTSAudioGenerator(audio_config(settings))
    voices = client._request(f"/v1/voices?engine_id={engine_id}")
    names = list(dict.fromkeys([*voices["voices"], *voices.get("aliases", {})]))
    return [{**base, "voice_id": v, "name": v, "tts_provider": "local_http", "tts_model": engine_id} for v in names]


def validate_voice(session, user, config, settings):
    if set(config) - {"tts_provider", "tts_model", "voice_id", "style", "speed", "extra_params", "tts_config_id"}:
        raise BusinessError("INVALID_AUDIO_PARAMS", "声音配置包含不支持的字段", 422)
    if config.get("style") or config.get("extra_params") or config.get("speed", 1.0) != 1.0 or config.get("tts_config_id") is not None:
        raise BusinessError("INVALID_AUDIO_PARAMS", "当前引擎只支持默认语速，无额外风格参数", 422)
    match = next((v for v in voice_items(session, user, settings) if all(config.get(k) == v[k] for k in ("tts_provider", "tts_model", "voice_id"))), None)
    if match is None:
        raise BusinessError("INVALID_VOICE", "音色不属于当前部署或当前用户", 422)
    if config.get("tts_model") == "qwen3-base":
        clone_reference(session, user, config["voice_id"], settings)


@router.get("/voices")
def voices(request: Request, session: SessionDep, user: UserDep, tts_provider: str | None = None,
           tts_model: str | None = None, language: str | None = None):
    items = voice_items(session, user, request.app.state.settings)
    items = [v for v in items if all(value is None or v[key] == value for key, value in
                                   (("tts_provider", tts_provider), ("tts_model", tts_model), ("language", language)))]
    return envelope(request, {"voices": items})


@router.post("/roles", status_code=201)
def create(body: RoleProfileCreate, request: Request, session: SessionDep, user: UserDep):
    with transaction(session):
        data = body.model_dump()
        name, description = data.pop("name"), data.pop("description")
        validate_voice(session, user, data, request.app.state.settings)
        role = RoleProfile(user_id=user, name=name, description=description, voice_config=data)
        session.add(role)
        session.flush()
        return envelope(request, role_view(role))


@router.get("/roles/{profile_id}")
def detail(profile_id: PathId, request: Request, session: SessionDep, user: UserDep):
    return envelope(request, role_view(owned_role(session, user, profile_id)))


@router.patch("/roles/{profile_id}")
def update(profile_id: PathId, body: RoleProfileUpdate, request: Request, session: SessionDep, user: UserDep):
    with transaction(session):
        role = owned_role(session, user, profile_id)
        data = body.model_dump(exclude_unset=True)
        for key in ("name", "description", "status"):
            if key in data:
                value = data.pop(key)
                if key != "description" and value is None:
                    raise BusinessError("INVALID_INPUT", "名称和状态不能为 null", 422)
                setattr(role, key, value)
        config = {**role.voice_config, **data}
        if data or role.status == "enabled":
            validate_voice(session, user, config, request.app.state.settings)
        role.voice_config = config
        session.flush()
        return envelope(request, role_view(role))


@router.delete("/roles/{profile_id}")
def delete(profile_id: PathId, request: Request, session: SessionDep, user: UserDep):
    with transaction(session):
        role = owned_role(session, user, profile_id)
        role.status = "disabled"  # Preserve existing script foreign keys and snapshots.
        return envelope(request, {"deleted": True})


@router.get("/models")
def models(request: Request, session: SessionDep, user: UserDep, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    values = session.scalars(select(LLMModel).where(LLMModel.enabled.is_(True))).all()
    items = [{"model_id": m.id, "name": m.name, "provider_code": m.provider_code, "model_code": m.model_code,
              "available": True, "supports_user_key": False, "platform_credential_available": True,
              "default_params": m.params, "parameter_schema": {}} for m in values]
    return envelope(request, {"items": items[(page-1)*page_size:page*page_size], "page": page, "page_size": page_size, "total": len(items)})
