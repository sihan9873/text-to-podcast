from app.db.database import transaction
from app.db.models import LLMModel, RoleProfile, User

MODEL_ID = 1
ROLE_ID = 1
LOCAL_TTS_ROLES = (
    (2, "本地 TTS 主持人 A", "host_a"),
    (3, "本地 TTS 主持人 B", "host_b"),
)


def seed(database, settings):
    with database.sessions() as session, transaction(session):
        if session.get(User, settings.development_user_id) is None:
            session.add(User(id=settings.development_user_id, username="development_user"))
            session.flush()
        if session.get(LLMModel, MODEL_ID) is None:
            session.add(LLMModel(id=MODEL_ID, name="固定测试脚本服务", provider_code="mock", model_code="mock-script-v1", params={"simulated": True}))
        for model_id, code in ((2, "Qwen/Qwen2.5-0.5B-Instruct"), (3, "Qwen/Qwen3-4B-Instruct-2507")):
            if session.get(LLMModel, model_id) is None:
                session.add(LLMModel(id=model_id, name=code.split("/")[-1], provider_code="local_http", model_code=code, params={}))
        if session.get(RoleProfile, ROLE_ID) is None:
            session.add(RoleProfile(id=ROLE_ID, user_id=settings.development_user_id, name="测试主持人",
                description="用于框架联调的固定测试角色", voice_config={"tts_provider": "mock", "tts_model": "mock-audio-v1", "voice_id": "test-tone", "style": None, "speed": 1.0, "extra_params": {}}))
        for role_id, name, voice_id in LOCAL_TTS_ROLES:
            if session.get(RoleProfile, role_id) is None:
                session.add(RoleProfile(id=role_id, user_id=settings.development_user_id, name=name,
                    description="本地 TTS 联调角色", voice_config={"tts_provider": "local_http",
                    "tts_model": "mock", "voice_id": voice_id, "style": None, "speed": 1.0, "extra_params": {}}))
        session.flush()
        from sqlalchemy import select
        for user_id in session.scalars(select(User.id)).all():
            ensure_presenters(session, user_id, settings)


def ensure_presenters(session, user_id, settings):
    """Backfill two presets for both new and existing accounts, preserving custom roles."""
    from sqlalchemy import select
    if settings.audio_provider == "local_http" and settings.tts_engine_id == "qwen3-base":
        return  # Base only accepts the user's own reference voices.
    existing = session.scalars(select(RoleProfile).where(RoleProfile.user_id == user_id)).all()
    provider = "local_http" if settings.audio_provider == "local_http" else "mock"
    model = settings.tts_engine_id if provider == "local_http" else "mock-audio-v1"
    for label, voice in (("A", "host_a"), ("B", "host_b")):
        if any(r.voice_config.get("tts_provider") == provider and r.voice_config.get("tts_model") == model
               and r.voice_config.get("voice_id") == voice for r in existing):
            continue
        session.add(RoleProfile(user_id=user_id, name=f"预设主持人 {label}",
            description="清晰自然的播客主持人" if label == "A" else "沉稳的播客搭档",
            voice_config={"tts_provider": provider, "tts_model": model, "voice_id": voice,
                          "style": None, "speed": 1.0, "extra_params": {}}))
