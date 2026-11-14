"""Configuration routes reserved for subsequent business development.

Valid requests always return HTTP 501. These handlers do not query/write
databases, save credentials, or invoke LLM/TTS providers.
"""
from typing import Annotated, NoReturn

from fastapi import APIRouter, Path, Query

from app.api.dependencies import UserDep
from app.configuration_schemas import (
    ConfigurationNotImplemented, EnabledStatus, LLMCredentialCreate, LLMCredentialUpdate,
    ProjectLLMConfigSave, RoleProfileCreate, RoleProfileUpdate, TTSConfigCreate, TTSConfigUpdate,
)
from app.core.common import BusinessError

PathId = Annotated[int, Path(gt=0)]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]
ProviderFilter = Annotated[str | None, Query(min_length=1, max_length=64)]
StatusFilter = Annotated[EnabledStatus | None, Query()]

router = APIRouter(prefix="/api/v1", tags=["配置模块（接口预留）"])
RESERVED = {
    "status_code": 501,
    "response_model": ConfigurationNotImplemented,
    "description": "仅预留路径和参数结构；合法请求统一返回 NOT_IMPLEMENTED，不执行数据库操作或厂商调用。",
}


def not_implemented() -> NoReturn:
    raise BusinessError("NOT_IMPLEMENTED", "配置管理接口已预留，暂未实现业务功能", 501)


@router.get("/models", summary="查询可选 LLM 模型（预留）", **RESERVED)
def list_models(user: UserDep, page: Page = 1, page_size: PageSize = 20,
                provider_code: ProviderFilter = None):
    not_implemented()


@router.post("/llm-credentials", summary="新增个人 LLM 密钥（预留）", **RESERVED)
def create_llm_credential(body: LLMCredentialCreate, user: UserDep):
    not_implemented()


@router.get("/llm-credentials", summary="查询个人 LLM 密钥列表（预留）", **RESERVED)
def list_llm_credentials(user: UserDep, page: Page = 1, page_size: PageSize = 20,
                         provider_code: ProviderFilter = None, status: StatusFilter = None):
    not_implemented()


@router.patch("/llm-credentials/{credential_id}", summary="修改个人 LLM 密钥别名与状态（预留）", **RESERVED)
def update_llm_credential(credential_id: PathId, body: LLMCredentialUpdate, user: UserDep):
    not_implemented()


@router.delete("/llm-credentials/{credential_id}", summary="删除个人 LLM 密钥（预留）", **RESERVED)
def delete_llm_credential(credential_id: PathId, user: UserDep):
    not_implemented()


@router.get("/projects/{project_id}/llm-config", summary="查询项目 LLM 配置（预留）", **RESERVED)
def get_project_llm_config(project_id: PathId, user: UserDep):
    not_implemented()


@router.put("/projects/{project_id}/llm-config", summary="保存项目 LLM 配置（预留）", **RESERVED)
def save_project_llm_config(project_id: PathId, body: ProjectLLMConfigSave, user: UserDep):
    not_implemented()


# GET /roles already serves the seeded test role in resources.py. Keep it working.
@router.post("/roles", summary="新增角色配置（预留）", **RESERVED)
def create_role(body: RoleProfileCreate, user: UserDep):
    not_implemented()


@router.get("/roles/{profile_id}", summary="查询角色配置详情（预留）", **RESERVED)
def get_role(profile_id: PathId, user: UserDep):
    not_implemented()


@router.patch("/roles/{profile_id}", summary="修改角色配置（预留）", **RESERVED)
def update_role(profile_id: PathId, body: RoleProfileUpdate, user: UserDep):
    not_implemented()


@router.delete("/roles/{profile_id}", summary="删除角色配置（预留）", **RESERVED)
def delete_role(profile_id: PathId, user: UserDep):
    not_implemented()


@router.get("/tts-configs", summary="查询 TTS 服务配置列表（预留）", **RESERVED)
def list_tts_configs(user: UserDep, page: Page = 1, page_size: PageSize = 20,
                     provider_code: ProviderFilter = None, status: StatusFilter = None):
    not_implemented()


@router.post("/tts-configs", summary="新增 TTS 服务配置（预留）", **RESERVED)
def create_tts_config(body: TTSConfigCreate, user: UserDep):
    not_implemented()


@router.get("/tts-configs/{tts_config_id}", summary="查询 TTS 服务配置详情（预留）", **RESERVED)
def get_tts_config(tts_config_id: PathId, user: UserDep):
    not_implemented()


@router.patch("/tts-configs/{tts_config_id}", summary="修改 TTS 服务配置（预留）", **RESERVED)
def update_tts_config(tts_config_id: PathId, body: TTSConfigUpdate, user: UserDep):
    not_implemented()


@router.delete("/tts-configs/{tts_config_id}", summary="删除 TTS 服务配置（预留）", **RESERVED)
def delete_tts_config(tts_config_id: PathId, user: UserDep):
    not_implemented()


@router.get("/voices", summary="查询可选音色与语音能力（预留）", **RESERVED)
def list_voices(user: UserDep, tts_provider: ProviderFilter = None,
                tts_model: Annotated[str | None, Query(min_length=1, max_length=128)] = None,
                language: Annotated[str | None, Query(min_length=1, max_length=32)] = None):
    not_implemented()
