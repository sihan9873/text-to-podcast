"""Reserved configuration API inputs; no persistence or provider calls yet."""
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, Field, SecretStr, StringConstraints

from app.schemas import Envelope, Id, Input

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
ProviderCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
ModelCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
EnabledStatus = Literal["enabled", "disabled"]


class ConfigurationNotImplemented(Envelope[None]):
    code: Literal["NOT_IMPLEMENTED"] = "NOT_IMPLEMENTED"
    message: str = "配置管理接口已预留，暂未实现业务功能"
    data: None = None


class LLMCredentialCreate(Input):
    provider_code: ProviderCode
    name: Name
    api_key: SecretStr = Field(min_length=1, max_length=8192)


class LLMCredentialUpdate(Input):
    name: Name | None = None
    status: EnabledStatus | None = None


class ProjectLLMConfigSave(Input):
    model_id: Id
    credential_source: Literal["platform", "user"]
    credential_id: Id | None
    params: dict = Field(default_factory=dict)


class RoleProfileCreate(Input):
    name: Name
    description: str | None = None
    tts_provider: ProviderCode
    tts_model: ModelCode
    voice_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    tts_config_id: Id | None = None
    style: str | None = None
    speed: float = Field(default=1.0, gt=0)
    extra_params: dict = Field(default_factory=dict)


class RoleProfileUpdate(Input):
    name: Name | None = None
    description: str | None = None
    tts_provider: ProviderCode | None = None
    tts_model: ModelCode | None = None
    voice_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None
    tts_config_id: Id | None = None
    style: str | None = None
    speed: float | None = Field(default=None, gt=0)
    extra_params: dict | None = None
    status: EnabledStatus | None = None


class TTSConfigCreate(Input):
    name: Name
    provider_code: ProviderCode
    model_code: ModelCode
    base_url: AnyHttpUrl | None = None
    api_key: SecretStr | None = Field(default=None, min_length=1, max_length=8192)
    timeout_seconds: float = Field(default=60, gt=0, le=600)
    params: dict = Field(default_factory=dict)


class TTSConfigUpdate(Input):
    name: Name | None = None
    provider_code: ProviderCode | None = None
    model_code: ModelCode | None = None
    base_url: AnyHttpUrl | None = None
    api_key: SecretStr | None = Field(default=None, min_length=1, max_length=8192)
    timeout_seconds: float | None = Field(default=None, gt=0, le=600)
    params: dict | None = None
    status: EnabledStatus | None = None
