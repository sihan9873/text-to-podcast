import type { TaskDetail } from '@/api';
import { AppButton } from '@/components/common/AppButton';

type TaskState = Pick<TaskDetail, 'task_id' | 'status' | 'error_code' | 'error_message'>;

export function isScriptTaskRunning(task: Pick<TaskDetail, 'status'> | undefined): boolean {
  return task?.status === 'queued' || task?.status === 'running';
}

export function ScriptTaskFailure({ task, onRetry }: { task?: TaskState; onRetry: () => void }) {
  if (task?.status !== 'failed') return null;
  return (
    <div role="alert" className="mt-4 space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">脚本生成失败 · 任务 {task.task_id}</p>
      <p className="break-words">{task.error_message || '生成服务未提供失败详情，请查看 Worker 和 LLM 日志。'}</p>
      {task.error_code && <p className="font-mono text-xs text-muted-foreground">{task.error_code}</p>}
      <p className="text-xs text-muted-foreground">原文和已有脚本已保留。可以调整生成参数后重新提交。</p>
      <AppButton size="sm" variant="outline" onClick={onRetry}>重新生成脚本</AppButton>
    </div>
  );
}
