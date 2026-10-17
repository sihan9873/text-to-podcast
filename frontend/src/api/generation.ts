// src/api/generation.ts

import {
  request,
  businessError,
  ApiError,
} from "./request";
import type {
  GenerationTask,
  PreviewTask,
  FullGenerationTask,
} from "@/types/generation";
import type { VoiceConfig } from "@/types/voice";
import type { AudioVersion } from "@/types/audio";

/* ============================================================
 * 请求 / 响应类型
 * ============================================================ */

/** 接口 6：创建试听任务（FR06） */
export interface CreatePreviewRequest {
  projectId: string;
  /** 可选：基于某个脚本版本；不传则使用默认短文本 */
  scriptVersionId?: string;
  voiceConfig: VoiceConfig;
  /** 可选：自定义试听文本，默认由后端选取 */
  previewText?: string;
}

export interface CreatePreviewResponse {
  task: PreviewTask;
}

/** 接口 7：查询生成任务状态（试听/全文共用） */
export interface GetTaskResponse {
  task: GenerationTask;
}

/** 接口 8：创建全文生成任务（FR07） */
export interface CreateFullGenerationRequest {
  projectId: string;
  scriptVersionId: string;
  voiceConfig: VoiceConfig;
}

export interface CreateFullGenerationResponse {
  task: FullGenerationTask;
  /** 立即创建的占位音频版本，status: "generating" */
  audioVersion: AudioVersion;
}

/** 接口 11：重试失败的音频版本 */
export interface RetryAudioVersionResponse {
  task: FullGenerationTask;
  /** 新创建的音频版本，status: "generating"，旧失败记录保留 */
  audioVersion: AudioVersion;
}

/* ============================================================
 * API 函数
 * ============================================================ */

/**
 * 接口 6：创建试听任务（POST /generation/preview）
 * 试听不创建 AudioVersion，完成后只返回临时 previewAudioUrl。
 */
export function createPreview(
  req: CreatePreviewRequest,
  signal?: AbortSignal
): Promise<CreatePreviewResponse> {
  return request<CreatePreviewResponse>("/generation/preview", {
    method: "POST",
    body: req,
    signal,
  });
}

/**
 * 接口 8：创建全文生成任务（POST /generation/full）
 * 后端校验 scriptVersion.status === "confirmed"，否则 409 SCRIPT_NOT_CONFIRMED。
 * 后端读取服务端已保存的 content，不使用前端未保存内容。
 * 创建任务时立即创建占位 AudioVersion（status: "generating"）。
 */
export function createFullGeneration(
  req: CreateFullGenerationRequest,
  signal?: AbortSignal
): Promise<CreateFullGenerationResponse> {
  return request<CreateFullGenerationResponse>("/generation/full", {
    method: "POST",
    body: req,
    signal,
  });
}

/**
 * 接口 7：查询生成任务状态（GET /generation/tasks/:taskId）
 */
export function getTask(
  taskId: string,
  signal?: AbortSignal
): Promise<GetTaskResponse> {
  return request<GetTaskResponse>(
    `/generation/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET", signal }
  );
}

/**
 * 接口 11：重试失败的音频版本
 * POST /audio-versions/:audioVersionId/retry
 * 规则：
 * - 只能重试 failed 的音频版本。
 * - 复用原 voiceConfig 快照与 scriptVersionId。
 * - 保留旧失败记录，创建新的 AudioVersion + 新任务。
 */
export function retryAudioVersion(
  audioVersionId: string,
  signal?: AbortSignal
): Promise<RetryAudioVersionResponse> {
  return request<RetryAudioVersionResponse>(
    `/audio-versions/${encodeURIComponent(audioVersionId)}/retry`,
    { method: "POST", body: {}, signal }
  );
}

/* ============================================================
 * 轮询辅助
 * ============================================================ */

export interface PollTaskOptions {
  /** 轮询间隔（毫秒），默认 1500 */
  intervalMs?: number;
  /** 最大轮询时长（毫秒），默认 5 分钟 */
  timeoutMs?: number;
  /** 每次拿到任务后的回调 */
  onTick?: (task: GenerationTask) => void;
  /** 外部取消信号 */
  signal?: AbortSignal;
}

/**
 * 轮询任务直到 completed / failed。
 * 错误分类：
 * - ABORTED       用户主动取消
 * - POLL_TIMEOUT  轮询超时
 * - TASK_FAILED   后端生成失败
 * - NETWORK_ERROR 网络故障
 * - HTTP_xxx      后端返回的 HTTP 错误
 * - MISSING_RESULT 任务 completed 但结果字段缺失
 */
export async function pollTask(
  taskId: string,
  options: PollTaskOptions = {}
): Promise<GenerationTask> {
  const {
    intervalMs = 1500,
    timeoutMs = 5 * 60 * 1000,
    onTick,
    signal,
  } = options;

  const start = Date.now();

  // 内部 controller 统一处理外部取消与超时
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 循环直到 completed / failed
    for (;;) {
      const { task } = await getTask(taskId, controller.signal);
      onTick?.(task);

      if (task.status === "completed") {
        assertResultPresent(task);
        return task;
      }

      if (task.status === "failed") {
        throw businessError(
          "TASK_FAILED",
          task.errorMessage ?? "生成任务失败",
          task
        );
      }

      if (Date.now() - start > timeoutMs) {
        throw new ApiError(0, {
          code: "POLL_TIMEOUT",
          message: "生成任务超时",
        });
      }

      await sleep(intervalMs, controller.signal);
    }
  } catch (err) {
    // 外部取消优先
    if (signal?.aborted) {
      throw new ApiError(0, {
        code: "ABORTED",
        message: "轮询已取消",
      });
    }
    // 内部超时触发 abort
    if (err instanceof ApiError && err.code === "ABORTED") {
      throw new ApiError(0, {
        code: "POLL_TIMEOUT",
        message: "生成任务超时",
      });
    }
    // 非 ApiError 的 abort 异常（来自 sleep）
    if (err instanceof Error && err.message === "aborted") {
      throw new ApiError(0, {
        code: "POLL_TIMEOUT",
        message: "生成任务超时",
      });
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** 校验 completed 任务确实带有结果字段 */
function assertResultPresent(task: GenerationTask): void {
  if (task.type === "preview") {
    if (!task.previewAudioUrl) {
      throw businessError(
        "MISSING_RESULT",
        "试听任务已完成，但缺少 previewAudioUrl",
        task
      );
    }
    return;
  }
  // full
  if (!task.audioVersionId) {
    throw businessError(
      "MISSING_RESULT",
      "全文任务已完成，但缺少 audioVersionId",
      task
    );
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const id = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
