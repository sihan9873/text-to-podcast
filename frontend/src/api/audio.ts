import { http, newIdempotencyKey } from './client';
import type {
  AudioRequest,
  AudioSentencesResponse,
  AudioVersionDetail,
  AudioVersionListItem,
  CandidatesResponse,
  CandidateStatus,
  DecisionRequest,
  KeepOriginalResponse,
  Paginated,
  PaginationParams,
  RegenerateRequest,
  TaskAccepted,
  UseCandidateCurrentResponse,
} from './types';

export interface AudioVersionListParams extends PaginationParams {
  script_id?: string;
  status?: 'queued' | 'running' | 'ready' | 'failed';
}

export interface CandidateListParams extends PaginationParams {
  status?: CandidateStatus;
}

export const audioApi = {
  /** A-01 试听（异步，需幂等键） */
  preview: (projectId: string, body: AudioRequest, idempotencyKey = newIdempotencyKey()) =>
    http.post<TaskAccepted>(`/projects/${projectId}/audio/preview`, body, idempotencyKey),

  /** A-02 完整生成（异步，需幂等键） */
  generate: (projectId: string, body: AudioRequest, idempotencyKey = newIdempotencyKey()) =>
    http.post<TaskAccepted>(`/projects/${projectId}/audio/generate`, body, idempotencyKey),

  /** A-03 正式音频版本列表 */
  listVersions: (projectId: string, params?: AudioVersionListParams) =>
    http.get<Paginated<AudioVersionListItem>>(`/projects/${projectId}/audio-versions`, params as Record<string, string | number | undefined>),

  /** A-04 正式音频详情 */
  versionDetail: (audioVersionId: string) =>
    http.get<AudioVersionDetail>(`/audio-versions/${audioVersionId}`),

  /** A-05 逐句进度与播放清单 */
  sentences: (audioVersionId: string) =>
    http.get<AudioSentencesResponse>(`/audio-versions/${audioVersionId}/sentences`),

  /** A-06 重新生成指定句子候选（异步，需幂等键） */
  regenerateSentence: (
    audioSentenceId: string,
    body: RegenerateRequest,
    idempotencyKey = newIdempotencyKey(),
  ) => http.post<TaskAccepted>(`/audio-sentences/${audioSentenceId}/regenerate`, body, idempotencyKey),

  /** A-07 查询候选 */
  candidates: (audioSentenceId: string, params?: CandidateListParams) =>
    http.get<CandidatesResponse>(`/audio-sentences/${audioSentenceId}/candidates`, params as Record<string, string | number | undefined>),

  /**
   * A-08 选择保留原片段或采用候选
   * keep_original 返回 200 KeepOriginalResponse
   * use_candidate 返回 202 TaskAccepted
   * 重复 use_candidate 已采用返回 200 UseCandidateCurrentResponse
   */
  decide: async (
    candidateId: string,
    body: DecisionRequest,
    idempotencyKey = newIdempotencyKey(),
  ): Promise<KeepOriginalResponse | TaskAccepted | UseCandidateCurrentResponse> => {
    return http.post<KeepOriginalResponse | TaskAccepted | UseCandidateCurrentResponse>(
      `/audio-candidates/${candidateId}/decision`,
      body,
      idempotencyKey,
    );
  },

  /** A-09 播放（返回原始 Response，支持 Range） */
  play: (assetId: string) =>
    http.raw(`/audio-assets/${assetId}/play`),

  /** A-10 下载完整 MP3（返回原始 Response） */
  download: (assetId: string) =>
    http.raw(`/audio-assets/${assetId}/download`),
};

/**
 * A-09/A-10 便捷：生成可放入 <audio src> 的 URL
 * 注意：因需要 Cookie 鉴权，实际播放应使用 fetch 拿 blob 或确保同源 Cookie 生效。
 * 同站部署下可直接使用：
 */
export function audioStreamUrl(assetId: string): string {
  return `/api/audio-assets/${assetId}/play`;
}

export function audioDownloadUrl(assetId: string): string {
  return `/api/audio-assets/${assetId}/download`;
}

/** A-09 播放（blob 方式，适合需要自定义 headers 的场景） */
export async function fetchAudioBlob(assetId: string): Promise<Blob> {
  const res = await audioApi.play(assetId);
  if (!res.ok) throw new Error(`播放失败: ${res.status}`);
  return res.blob();
}

/** A-10 下载（触发浏览器下载） */
export async function downloadAudio(assetId: string, filename = '播客音频.mp3'): Promise<void> {
  const res = await audioApi.download(assetId);
  if (!res.ok) throw new Error(`下载失败: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
