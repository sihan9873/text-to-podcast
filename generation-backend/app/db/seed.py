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
        if session.get(RoleProfile, ROLE_ID) is None:
            session.add(RoleProfile(id=ROLE_ID, user_id=settings.development_user_id, name="测试主持人",
                description="用于框架联调的固定测试角色", voice_config={"tts_provider": "mock", "tts_model": "mock-audio-v1", "voice_id": "test-tone", "style": None, "speed": 1.0, "extra_params": {}}))
        for role_id, name, voice_id in LOCAL_TTS_ROLES:
            if session.get(RoleProfile, role_id) is None:
                session.add(RoleProfile(id=role_id, user_id=settings.development_user_id, name=name,
                    description="本地 TTS 联调角色", voice_config={"tts_provider": "local_http",
                    "tts_model": "mock", "voice_id": voice_id, "style": None, "speed": 1.0, "extra_params": {}}))
