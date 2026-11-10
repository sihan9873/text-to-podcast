from app.db.database import transaction
from app.db.models import LLMModel, RoleProfile, User
from sqlalchemy import select

MODEL_ID = 1
ROLE_ID = 1


def seed(database, settings):
    with database.sessions() as session, transaction(session):
        if session.get(User, settings.development_user_id) is None:
            session.add(User(id=settings.development_user_id, username="development_user"))
            session.flush()
        if session.get(LLMModel, MODEL_ID) is None:
            session.add(LLMModel(id=MODEL_ID, name="固定测试脚本服务", provider_code="mock", model_code="mock-script-v1", params={"simulated": True}))
        if settings.llm_provider == "local_http":
            # 保留原有 Mock 行及历史项目，只增量注册当前部署模型。
            session.flush()
            local_model = session.scalar(select(LLMModel).where(LLMModel.provider_code == "local_http",
                LLMModel.model_code == settings.llm_model_id))
            if local_model is None:
                session.add(LLMModel(name=settings.llm_model_id, provider_code="local_http",
                    model_code=settings.llm_model_id, params={"simulated": False}))
        if session.get(RoleProfile, ROLE_ID) is None:
            session.add(RoleProfile(id=ROLE_ID, user_id=settings.development_user_id, name="测试主持人",
                description="用于框架联调的固定测试角色", voice_config={"tts_provider": "mock", "tts_model": "mock-audio-v1", "voice_id": "test-tone", "style": None, "speed": 1.0, "extra_params": {}}))
        # 增量添加本地服务角色，绝不覆盖既有用户角色或已保存的脚本快照。
        if settings.audio_provider == "local_http":
            profiles = session.scalars(select(RoleProfile).where(RoleProfile.user_id == settings.development_user_id)).all()
            for alias, label in (("host_a", "A"), ("host_b", "B")):
                if any(r.voice_config.get("tts_provider") == "local_http"
                       and r.voice_config.get("tts_model") == settings.tts_engine_id
                       and r.voice_config.get("voice_id") == alias for r in profiles):
                    continue
                session.add(RoleProfile(user_id=settings.development_user_id, name=f"本地TTS主持人{label}",
                    description=f"本地TTS服务音色别名 {alias}；具体音色以服务配置为准",
                    voice_config={"tts_provider": "local_http", "tts_model": settings.tts_engine_id,
                                  "voice_id": alias, "style": None, "speed": 1.0, "extra_params": {}}))
