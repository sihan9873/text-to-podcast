import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScriptTaskFailure, isScriptTaskRunning } from './ScriptTaskFailure';

describe('script task terminal state', () => {
  it('keeps a visible actionable failure when active_tasks has cleared', () => {
    const html = renderToStaticMarkup(<ScriptTaskFailure task={{ task_id: '3', status: 'failed', error_code: 'LLM_INVALID_RESPONSE', error_message: '模型输出角色不符合要求' }} onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('模型输出角色不符合要求');
    expect(html).toContain('LLM_INVALID_RESPONSE');
    expect(html).toContain('重新生成脚本');
  });
  it('shows a useful fallback for older tasks without details', () => {
    expect(renderToStaticMarkup(<ScriptTaskFailure task={{ task_id: '1', status: 'failed', error_code: null, error_message: null }} onRetry={() => {}} />)).toContain('请查看 Worker 和 LLM 日志');
  });
  it.each(['queued', 'running', 'succeeded'] as const)('does not show an old failure for %s', status => {
    expect(renderToStaticMarkup(<ScriptTaskFailure task={{ task_id: '1', status, error_code: null, error_message: null }} onRetry={() => {}} />)).toBe('');
    expect(isScriptTaskRunning({ status })).toBe(status !== 'succeeded');
  });
});
