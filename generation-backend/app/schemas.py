from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

T = TypeVar("T")

# JSON IDs are positive integers; reject booleans and floating-point values.
Id = Annotated[int, Field(gt=0, strict=True)]


class Envelope(BaseModel, Generic[T]):
    code: str = "OK"
    message: str = "success"
    data: T
    request_id: str
    timestamp: str


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectCreate(Input):
    title: str = Field(min_length=1, max_length=100)

    @field_validator("title")
    @classmethod
    def title_nonblank(cls, value):
        if not value.strip():
            raise ValueError("标题不能全为空白")
        return value.strip()


class SourceSubmit(Input):
    text: str = Field(min_length=1, max_length=100_000)
    source_type: Literal["text", "txt", "markdown"] = "text"
    source_name: str | None = Field(default=None, max_length=255)
    segmentation_mode: Literal["auto", "paragraph", "duration"] = "auto"
    target_minutes: int = Field(default=5, ge=1, le=15)
    chars_per_minute: int = Field(default=240, ge=120, le=300)

    @field_validator("text")
    @classmethod
    def normalize(cls, value):
        if not value.strip():
            raise ValueError("原文不能全为空白")
        return value.replace("\r\n", "\n").replace("\r", "\n")

    @field_validator("source_name")
    @classmethod
    def normalize_source_name(cls, value):
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if any(char in value for char in ("/", "\\", "\0")):
            raise ValueError("文件名不能包含路径")
        return value


class RoleChoice(Input):
    profile_id: Id
    role_key: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_]+$")


class ScriptGenerate(Input):
    roles: list[RoleChoice] = Field(min_length=1, max_length=8)
    target_minutes: int = Field(default=10, ge=1, le=20)
    style: str = Field(default="自然、清晰、连贯", min_length=1, max_length=200)

    @field_validator("roles")
    @classmethod
    def unique_keys(cls, values):
        if len({v.role_key for v in values}) != len(values):
            raise ValueError("角色标识不能重复")
        return values

    @field_validator("style")
    @classmethod
    def normalize_style(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("主持风格不能为空")
        return value


class ConfirmScript(Input):
    expected_script_version: int = Field(ge=1)
    expected_edit_revision: int = Field(ge=1)


class AudioGenerate(ConfirmScript):
    script_id: Id


class TaskAccepted(BaseModel):
    task_id: Id
    task_type: Literal["script", "audio"]
    audio_action: Literal["full"] | None
    status: Literal["queued", "running", "succeeded", "failed"]
    script_id: Id | None
    audio_version_id: Id | None
    candidate_id: None = None
    status_url: str


class RoleView(BaseModel):
    role_id: Id
    profile_id: Id
    role_key: str
    name: str
    description: str | None
    voice_config: dict


class SentenceView(BaseModel):
    sentence_id: Id
    sequence: int
    role_id: Id
    text: str
    speed: float | None
    extra_params: dict


class ScriptView(BaseModel):
    script_id: Id
    project_id: Id
    version: int
    edit_revision: int
    title: str
    summary: str | None
    status: Literal["draft", "confirmed"]
    confirmed_at: str | None
    confirmed_by: Id | None
    confirmed_revision: int | None
    editable: bool
    roles: list[RoleView]
    sentences: list[SentenceView]
    created_at: str
    updated_at: str
