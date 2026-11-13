import { http, newIdempotencyKey } from './client';
import type { Paginated, TaskAccepted, TaskDetail, TaskListParams } from './types';

export const tasksApi = {
  /** T-01 任务详情 */
  detail: (taskId: string) => http.get<TaskDetail>(`/tasks/${taskId}`),

  /** T-02 项目任务列表 */
  listByProject: (projectId: string, params?: TaskListParams) =>
    http.get<Paginated<TaskDetail>>(`/projects/${projectId}/tasks`, params as Record<string, string | number | undefined>),

  /** T-03 重试失败任务（异步，需幂等键） */
  retry: (taskId: string, idempotencyKey = newIdempotencyKey()) =>
    http.post<TaskAccepted>(`/tasks/${taskId}/retry`, undefined, idempotencyKey),
};

/**
 * 轮询任务直到终态（成功/失败）
 * 默认 2 秒间隔，符合文档建议。
 */
export async function pollTask(
  taskId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    onUpdate?: (task: TaskDetail) => void;
    signal?: AbortSignal;
  } = {},
): Promise<TaskDetail> {
  const { intervalMs = 2000, timeoutMs = 10 * 60 * 1000, onUpdate, signal } = options;
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const task = await tasksApi.detail(taskId);
    onUpdate?.(task);
    if (task.status === 'succeeded' || task.status === 'failed') {
      return task;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('任务轮询超时');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}