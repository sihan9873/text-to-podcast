import { http } from './client';
import type {
  CreateCredentialRequest,
  CreateRoleRequest,
  CredentialItem,
  DeleteCredentialResponse,
  LlmConfig,
  LlmModelItem,
  Paginated,
  PaginationParams,
  RoleProfileItem,
  SaveLlmConfigRequest,
  UpdateCredentialRequest,
  UpdateRoleRequest,
  VoicesParams,
  VoicesResponse,
} from './types';

export interface ModelListParams extends PaginationParams {
  provider_code?: string;
}

export interface CredentialListParams extends PaginationParams {
  provider_code?: string;
  status?: 'enabled' | 'disabled';
}

export interface RoleListParams extends PaginationParams {
  status?: 'enabled' | 'disabled';
}

export const configApi = {
  /** C-01 可选 LLM 模型 */
  models: (params?: ModelListParams) =>
    http.get<Paginated<LlmModelItem>>('/models', params as Record<string, string | number | undefined>),

  /** C-02 新增个人 LLM 密钥 */
  createCredential: (body: CreateCredentialRequest) =>
    http.post<CredentialItem>('/llm-credentials', body),

  /** C-03 个人密钥列表 */
  listCredentials: (params?: CredentialListParams) =>
    http.get<Paginated<CredentialItem>>('/llm-credentials', params as Record<string, string | number | undefined>),

  /** C-04 修改个人密钥信息 */
  updateCredential: (credentialId: string, body: UpdateCredentialRequest) =>
    http.patch<CredentialItem>(`/llm-credentials/${credentialId}`, body),

  /** C-05 删除个人密钥 */
  deleteCredential: (credentialId: string) =>
    http.delete<DeleteCredentialResponse>(`/llm-credentials/${credentialId}`),

  /** C-06 角色模板列表 */
  roles: (params?: RoleListParams) =>
    http.get<Paginated<RoleProfileItem>>('/roles', params as Record<string, string | number | undefined>),

  /** C-07 新建角色模板 */
  createRole: (body: CreateRoleRequest) => http.post<RoleProfileItem>('/roles', body),

  /** C-08 修改角色模板 */
  updateRole: (profileId: string, body: UpdateRoleRequest) =>
    http.patch<RoleProfileItem>(`/roles/${profileId}`, body),

  /** C-09 删除角色模板 */
  deleteRole: (profileId: string) =>
    http.delete<DeleteCredentialResponse>(`/roles/${profileId}`),

  /** C-10 查询项目 LLM 配置 */
  getLlmConfig: (projectId: string) =>
    http.get<LlmConfig>(`/projects/${projectId}/llm-config`),

  /** C-11 保存项目 LLM 配置 */
  saveLlmConfig: (projectId: string, body: SaveLlmConfigRequest) =>
    http.put<LlmConfig>(`/projects/${projectId}/llm-config`, body),

  /** C-12 可选音色与语音能力 */
  voices: (params?: VoicesParams) =>
    http.get<VoicesResponse>('/voices', params as Record<string, string | undefined>),
};