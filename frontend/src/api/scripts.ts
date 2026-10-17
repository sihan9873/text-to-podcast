// src/api/scripts.ts

import { request, ApiError } from "./request";
import type { ScriptVersion } from "@/types/script";

/* ============================================================
 * 请求 / 响应类型
 * ============================================================ */

/**
 * 接口 1：创建脚本版本。
 * 规则：始终创建"新版本"，不覆盖已有版本。
 * 例如 V1 已确认，用户修改后创建 V2，V1 保留，V2 是独立记录。
 */
export interface CreateScriptRequest {
  name: string;
  /** 完整 TXT 正文，不拆分句子 */
  content: string;
}

export interface CreateScriptResponse {
  scriptVersion: ScriptVersion;
}

export interface ListScriptsResponse {
  scriptVersions: ScriptVersion[];
}

export interface GetScriptResponse {
  scriptVersion: ScriptVersion;
}

/**
 * 接口 4：更新脚本内容（仅 draft 状态可编辑）。
 * 规则：已 confirmed 的脚本不可修改，后端返回 409 SCRIPT_LOCKED。
 */
export interface UpdateScriptRequest {
  name?: string;
  /** 完整 TXT 正文 */
  content?: string;
}

export interface UpdateScriptResponse {
  scriptVersion: ScriptVersion;
}

export interface ConfirmScriptResponse {
  scriptVersion: ScriptVersion;
}

/* ============================================================
 * API 函数
 * ============================================================ */

/**
 * 接口 1：创建脚本版本（POST /projects/:projectId/scripts）
 * 后端自动生成 id / version / status="draft" / createdAt / updatedAt。
 */
export function createScript(
  projectId: string,
  req: CreateScriptRequest,
  signal?: AbortSignal
): Promise<CreateScriptResponse> {
  return request<CreateScriptResponse>(
    `/projects/${encodeURIComponent(projectId)}/scripts`,
    { method: "POST", body: req, signal }
  );
}

/**
 * 接口 2：查询脚本版本列表（GET /projects/:projectId/scripts）
 */
export function listScripts(
  projectId: string,
  signal?: AbortSignal
): Promise<ListScriptsResponse> {
  return request<ListScriptsResponse>(
    `/projects/${encodeURIComponent(projectId)}/scripts`,
    { method: "GET", signal }
  );
}

/**
 * 接口 3：查询单个脚本版本（GET /scripts/:scriptId）
 */
export function getScript(
  scriptId: string,
  signal?: AbortSignal
): Promise<GetScriptResponse> {
  return request<GetScriptResponse>(
    `/scripts/${encodeURIComponent(scriptId)}`,
    { method: "GET", signal }
  );
}

/**
 * 接口 4：更新脚本内容（PUT /scripts/:scriptId）
 * 仅 draft 可编辑；confirmed 后端返回 409 SCRIPT_LOCKED。
 * 前端应校验至少传入一个字段，避免空更新。
 */
export function updateScript(
  scriptId: string,
  req: UpdateScriptRequest,
  signal?: AbortSignal
): Promise<UpdateScriptResponse> {
  if (req.name === undefined && req.content === undefined) {
    return Promise.reject(
      new ApiError(400, {
        code: "EMPTY_UPDATE",
        message: "至少需要传入 name 或 content 之一",
      })
    );
  }
  return request<UpdateScriptResponse>(
    `/scripts/${encodeURIComponent(scriptId)}`,
    { method: "PUT", body: req, signal }
  );
}

/**
 * 接口 5：确认脚本版本（POST /scripts/:scriptId/confirm）
 * 确认后脚本不可修改，是 FR07 全文生成的前置条件。
 */
export function confirmScript(
  scriptId: string,
  signal?: AbortSignal
): Promise<ConfirmScriptResponse> {
  return request<ConfirmScriptResponse>(
    `/scripts/${encodeURIComponent(scriptId)}/confirm`,
    { method: "POST", body: {}, signal }
  );
}