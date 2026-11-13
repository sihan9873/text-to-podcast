import { http } from './client';
import type {
  ConfirmScriptRequest,
  ConfirmScriptResponse,
  GenerateScriptRequest,
  Paginated,
  PaginationParams,
  PatchSentenceRequest,
  PatchSentenceResponse,
  SaveScriptRequest,
  ScriptDetail,
  ScriptListItem,
  TaskAccepted,
} from './types';

export interface ScriptListParams extends PaginationParams {
  status?: 'draft' | 'confirmed';
}

export const scriptsApi = {
  /**
   * S-01 生成或重新生成脚本（异步，需幂等键）
   * 生成任务脚本任务不可自动登录，需已登录。
   */
  generate: (projectId: string, body: GenerateScriptRequest, idempotencyKey: string) =>
    http.post<TaskAccepted>(`/projects/${projectId}/script/generate`, body, idempotencyKey),

  /** S-02 查询各版脚本 */
  list: (projectId: string, params?: ScriptListParams) =>
    http.get<Paginated<ScriptListItem>>(`/projects/${projectId}/scripts`, params as Record<string, string | number | undefined>),

  /** S-03 脚本详情 */
  detail: (scriptId: string) => http.get<ScriptDetail>(`/scripts/${scriptId}`),

  /** S-04 保存整份脚本 */
  save: (scriptId: string, body: SaveScriptRequest) =>
    http.put<ScriptDetail>(`/scripts/${scriptId}`, body),

  /** S-05 保存单句修改 */
  patchSentence: (scriptId: string, sentenceId: string, body: PatchSentenceRequest) =>
    http.patch<PatchSentenceResponse>(`/scripts/${scriptId}/sentences/${sentenceId}`, body),

  /** S-06 确认脚本 */
  confirm: (scriptId: string, body: ConfirmScriptRequest) =>
    http.post<ConfirmScriptResponse>(`/scripts/${scriptId}/confirm`, body),

  /** S-07 取消确认 */
  unconfirm: (scriptId: string, body: ConfirmScriptRequest) =>
    http.post<ConfirmScriptResponse>(`/scripts/${scriptId}/unconfirm`, body),
};