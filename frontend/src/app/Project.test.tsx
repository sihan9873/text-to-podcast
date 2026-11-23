import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProjectPage from './Project'
import type { ProjectDetail, TaskDetail } from '@/api'

function renderProject(task?: Partial<TaskDetail>, sourceSubmitted = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const project = {
    project_id: '1', title: '接口联调', source_submitted: sourceSubmitted,
    source_text: sourceSubmitted ? '一份已经提交的长文。' : null,
    source_type: 'markdown', source_name: 'notes.md', source_chunk_count: 2,
    source_character_count: 6000, source_estimated_seconds: 1500,
    created_at: '2026-11-23T00:00:00Z', updated_at: '2026-11-23T00:00:00Z',
    active_tasks: [],
  } as unknown as ProjectDetail
  client.setQueryData(['project', '1'], project)
  client.setQueryData(['scripts', '1'], { items: [] })
  client.setQueryData(['script-tasks', '1'], { items: task ? [{ task_id: '3', task_type: 'script', ...task }] : [] })
  client.setQueryData(['audio-versions', '1', 'summary'], { total: 0, items: [] })
  client.setQueryData(['audio-versions', '1', 1], { total: 0, items: [] })
  const markup = renderToStaticMarkup(<QueryClientProvider client={client}>
    <ProjectPage projectId="1" onNavigate={() => {}} />
  </QueryClientProvider>)
  client.clear()
  return markup
}

describe('new project layout with the local generation backend', () => {
  it('shows a failed first script task even when there are no script versions', () => {
    const html = renderProject({ status: 'failed', error_code: 'LLM_TIMEOUT', error_message: '模型响应超时' })
    expect(html).toContain('模型响应超时')
    expect(html).toContain('重新生成脚本')
    expect(html).toContain('脚本版本')
  })

  it('recovers an in-flight script task from task history when active_tasks is empty', () => {
    const html = renderProject({ status: 'running', stage: 'drafting_sections' })
    expect(html).toContain('分节生成脚本')
    expect(html).toContain('任务 3')
    expect(html).not.toContain('还没有脚本版本')
  })

  it('retains document metadata and the TXT/Markdown source input workflow', () => {
    expect(renderProject()).toContain('notes.md')
    expect(renderProject()).toContain('2 个语义片段')
    const html = renderProject(undefined, false)
    expect(html).toContain('.txt,.md,.markdown')
    expect(html).toContain('100,000 字符')
    expect(html).toContain('提交并生成脚本')
  })
})
