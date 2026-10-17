// src/api/audio.ts

import { request } from "./request";
import type { QueryParams } from "./request";
import type { AudioVersion, AudioStatus } from "@/types/audio";

/* ============================================================
 * 请求 / 响应类型
 * ============================================================ */

/** 接口 9：查询音频版本列表的过滤参数 */
export interface ListAudioVersionsQuery {
  scriptVersionId?: string;
  status?: AudioStatus;
}

export interface ListAudioVersionsResponse {
  audioVersions: AudioVersion[];
}

export interface GetAudioVersionResponse {
  audioVersion: AudioVersion;
}

/* ============================================================
 * API 函数
 * ============================================================ */

/**
 * 接口 9：查询项目下的音频版本列表
 * GET /projects/:projectId/audio-versions
 * 支持按 scriptVersionId / status 过滤。
 */
export function listAudioVersions(
  projectId: string,
  query?: ListAudioVersionsQuery,
  signal?: AbortSignal
): Promise<ListAudioVersionsResponse> {
  return request<ListAudioVersionsResponse>(
    `/projects/${encodeURIComponent(projectId)}/audio-versions`,
    {
      method: "GET",
      query: query as QueryParams,
      signal,
    }
  );
}

/**
 * 接口 10：查询单个音频版本详情
 * GET /audio-versions/:audioVersionId
 * 返回的 audioUrl 指向完整 MP3 文件。
 */
export function getAudioVersion(
  audioVersionId: string,
  signal?: AbortSignal
): Promise<GetAudioVersionResponse> {
  return request<GetAudioVersionResponse>(
    `/audio-versions/${encodeURIComponent(audioVersionId)}`,
    { method: "GET", signal }
  );
}