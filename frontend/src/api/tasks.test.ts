import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollTask, tasksApi } from './tasks';
import type { TaskDetail } from './types';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() });
const task = (status: TaskDetail['status']) => ({ task_id: '2', status } as TaskDetail);

describe('task polling', () => {
  it('continues waiting beyond ten minutes while the backend is running', async () => {
    vi.useFakeTimers();
    const detail = vi.spyOn(tasksApi, 'detail')
      .mockResolvedValueOnce(task('running')).mockResolvedValueOnce(task('running'))
      .mockResolvedValueOnce(task('succeeded'));
    const pending = pollTask('2', { intervalMs: 6 * 60 * 1000 });
    await vi.advanceTimersByTimeAsync(12 * 60 * 1000);
    expect((await pending).status).toBe('succeeded');
    expect(detail).toHaveBeenCalledTimes(3);
  });
  it('reports an explicit waiting limit without claiming generation failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(tasksApi, 'detail').mockResolvedValue(task('running'));
    const pending = expect(pollTask('2', { intervalMs: 2000, timeoutMs: 1000 }))
      .rejects.toThrow('后台任务可能仍在运行');
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
  });
  it('returns an actual backend failure and stops after navigation is aborted', async () => {
    const detail = vi.spyOn(tasksApi, 'detail').mockResolvedValue(task('failed'));
    expect((await pollTask('2')).status).toBe('failed');
    const controller = new AbortController(); controller.abort();
    await expect(pollTask('2', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(detail).toHaveBeenCalledTimes(1);
  });
});
