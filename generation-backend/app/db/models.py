from datetime import datetime

from sqlalchemy import (Boolean, CheckConstraint, Computed, DateTime, ForeignKey, Index,
                        Integer, JSON, String, Text, UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.common import utcnow


class Base(DeclarativeBase):
    __table_args__ = {"sqlite_autoincrement": True}


class Record:
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class User(Record, Base):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="active")


class LLMModel(Record, Base):
    __tablename__ = "llm_models"
    name: Mapped[str] = mapped_column(String(100))
    provider_code: Mapped[str] = mapped_column(String(64))
    model_code: Mapped[str] = mapped_column(String(128))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class RoleProfile(Record, Base):
    __tablename__ = "role_profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    voice_config: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="enabled")


class Project(Record, Base):
    __tablename__ = "projects"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(100))
    source_text: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str | None] = mapped_column(String(16))
    source_hash: Mapped[str | None] = mapped_column(String(64))
    source_submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    llm_model_id: Mapped[int] = mapped_column(ForeignKey("llm_models.id"))
    current_script_id: Mapped[int | None] = mapped_column(ForeignKey("scripts.id", use_alter=True, name="fk_project_current_script"))
    confirmed_script_id: Mapped[int | None] = mapped_column(ForeignKey("scripts.id", use_alter=True, name="fk_project_confirmed_script"))
    active_task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", use_alter=True, name="fk_project_active_task"))


class Script(Record, Base):
    __tablename__ = "scripts"
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    edit_revision: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(100))
    summary: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="draft")
    llm_snapshot: Mapped[dict] = mapped_column(JSON)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    confirmed_revision: Mapped[int | None] = mapped_column(Integer)
    confirmed_project_key: Mapped[int | None] = mapped_column(Integer,
        Computed("CASE WHEN status = 'confirmed' THEN project_id ELSE NULL END", persisted=True), unique=True)
    __table_args__ = (UniqueConstraint("project_id", "version"),
                      CheckConstraint("status IN ('draft','confirmed')"), {"sqlite_autoincrement": True})


class ScriptRole(Record, Base):
    __tablename__ = "script_roles"
    script_id: Mapped[int] = mapped_column(ForeignKey("scripts.id"))
    profile_id: Mapped[int] = mapped_column(ForeignKey("role_profiles.id"))
    role_key: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    voice_config: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("script_id", "role_key"), UniqueConstraint("script_id", "id"), {"sqlite_autoincrement": True})


class ScriptSentence(Record, Base):
    __tablename__ = "script_sentences"
    script_id: Mapped[int] = mapped_column(ForeignKey("scripts.id"))
    role_id: Mapped[int] = mapped_column(ForeignKey("script_roles.id"))
    sequence: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    speed: Mapped[float | None]
    extra_params: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("script_id", "sequence"), CheckConstraint("sequence > 0"), {"sqlite_autoincrement": True})


class Task(Record, Base):
    __tablename__ = "tasks"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    task_type: Mapped[str] = mapped_column(String(16))
    audio_action: Mapped[str | None] = mapped_column(String(16))
    script_id: Mapped[int | None] = mapped_column(ForeignKey("scripts.id"))
    audio_version_id: Mapped[int | None] = mapped_column(ForeignKey("audio_versions.id", use_alter=True, name="fk_task_audio_version"))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    stage: Mapped[str] = mapped_column(String(32), default="queued")
    progress: Mapped[int | None] = mapped_column(Integer, default=0)
    total_sentences: Mapped[int] = mapped_column(Integer, default=0)
    completed_sentences: Mapped[int] = mapped_column(Integer, default=0)
    failed_sentences: Mapped[int] = mapped_column(Integer, default=0)
    input_snapshot: Mapped[dict] = mapped_column(JSON)
    result_json: Mapped[dict | None] = mapped_column(JSON)
    result_asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"))
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(String(1000))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    lease_token: Mapped[str | None] = mapped_column(String(36))
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key"),
                      Index("ix_tasks_queue", "status", "created_at", "id"),
                      CheckConstraint("status IN ('queued','running','succeeded','failed')"), {"sqlite_autoincrement": True})


class Asset(Record, Base):
    __tablename__ = "assets"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    object_key: Mapped[str] = mapped_column(String(255), unique=True)
    kind: Mapped[str] = mapped_column(String(24), default="full_audio")
    size_bytes: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    metadata_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="ready")


class AudioVersion(Record, Base):
    __tablename__ = "audio_versions"
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    script_id: Mapped[int] = mapped_column(ForeignKey("scripts.id"))
    version: Mapped[int] = mapped_column(Integer)
    script_edit_revision: Mapped[int] = mapped_column(Integer)
    script_snapshot: Mapped[dict] = mapped_column(JSON)
    config_snapshot: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    selection_revision: Mapped[int] = mapped_column(Integer, default=0)
    current_asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"))
    __table_args__ = (UniqueConstraint("project_id", "version"), {"sqlite_autoincrement": True})
