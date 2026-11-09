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
    text: str = Field(min_length=1, max_length=5000)

    @field_validator("text")
    @classmethod
    def normalize(cls, value):
        if not value.strip():
            raise ValueError("原文不能全为空白")
        return value.replace("\r\n", "\n").replace("\r", "\n")


class RoleChoice(Input):
    profile_id: Id
    role_key: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_]+$")


class ScriptGenerate(Input):
    roles: list[RoleChoice] = Field(min_length=1, max_length=8)

    @field_validator("roles")
    @classmethod
    def unique_keys(cls, values):
        if len({v.role_key for v in values}) != len(values):
            raise ValueError("角色标识不能重复")
        return values


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
