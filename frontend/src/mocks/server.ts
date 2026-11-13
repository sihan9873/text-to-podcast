import { mockAuth, isMockAuthenticated, unauthenticated } from './auth.ts';
import { HttpResponse } from 'msw';
import { voices } from './voices.ts';
import type { TaskDetail, TaskAccepted, CredentialItem, SaveScriptRequest, GenerateScriptRequest, SaveLlmConfigRequest, CreateRoleRequest } from '../api/types';
import { projects, scripts, versions, sentences, candidates, tasks, roles, makeProject, makeScript, makeAudio, now, id, playUrl } from './store.ts';

const ok = (data: unknown, status = 200) => HttpResponse.json({ code: 'OK', message: 'success', data, request_id: id('req'), timestamp: now() }, { status });
const fail = (message: string, status = 400, code = status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 401 ? 'UNAUTHENTICATED' : 'VALIDATION_ERROR') => HttpResponse.json({ code, message, data: null, request_id: id('req'), timestamp: now() }, { status });
const credentials: CredentialItem[] = [];

const pending = new Map<string, { start: number; finish: () => void }>();
const dedup = new Map<string, unknown>();
function accepted(task: TaskDetail): TaskAccepted { return { task_id: task.task_id, task_type: task.task_type, audio_action: task.audio_action, status: task.status, script_id: task.script_id, audio_version_id: task.audio_version_id, candidate_id: (task.result?.candidate_id as string) ?? null, status_url: `/api/tasks/${task.task_id}` }; }
function advance() {
  for (const task of tasks) {
    const job = pending.get(task.task_id); if (!job) continue;
    const elapsed = Date.now() - job.start;
    task.status = elapsed < 500 ? 'queued' : 'running'; task.stage = task.stage === 'merging' ? 'merging' : elapsed < 500 ? 'queued' : 'processing'; task.progress = Math.min(95, Math.floor(elapsed / 30));
    if (elapsed >= 3000) { job.finish(); Object.assign(task, { status: 'succeeded', stage: 'completed', progress: 100, finished_at: now(), updated_at: now(), completed_sentences: task.total_sentences }); pending.delete(task.task_id); }
  }
}
function queue(projectId: string, values: Partial<TaskDetail>, finish: (task: TaskDetail) => void) {
  const task: TaskDetail = { task_id: id('task'), project_id: projectId, task_type: 'audio', audio_action: null, script_id: null, audio_version_id: null, audio_sentence_id: null, retry_of_task_id: null, status: 'queued', stage: 'queued', progress: 0, total_sentences: 0, completed_sentences: 0, failed_sentences: 0, result: null, error_code: null, error_message: null, can_retry: false, result_asset_id: null, created_at: now(), updated_at: now(), started_at: now(), finished_at: null, ...values };
  tasks.unshift(task); pending.set(task.task_id, { start: Date.now(), finish: () => finish(task) }); return accepted(task);
}
function page<T>(items: T[], url: URL) {
  const p = Math.max(1, Number(url.searchParams.get('page')) || 1); const size = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size')) || 20));
  return { items: items.slice((p - 1) * size, p * size), page: p, page_size: size, total: items.length };
}
function wav(asset = '') {
  const frequency = 220 + [...asset].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 440;
  const rate = 8000, count = rate * 4; const data = new ArrayBuffer(44 + count * 2); const view = new DataView(data);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * frequency * i / rate) * 1800 * Math.min(1, i / 400, (count - i) / 400), true);
  return data;
}
export async function dispatch(request: Request): Promise<Response> {
  advance();
  const url = new URL(request.url); const path = url.pathname.replace('/api/', '').split('/'); const [resource, key, action, child] = path; const method = request.method;
  const text = method !== 'GET' && request.headers.get('content-type')?.includes('application/json') ? await request.text() : '';
  const body = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (resource === 'auth') return mockAuth(key, method, body);
  if (!isMockAuthenticated()) return unauthenticated();
  const idem = request.headers.get('Idempotency-Key'); const dedupKey = `${method}:${url.pathname}:${idem}`;
  if (idem && dedup.has(dedupKey)) return ok(dedup.get(dedupKey), 202);
  const accept = (data: TaskAccepted) => { if (idem) dedup.set(dedupKey, data); return ok(data, 202); };
  if (resource === 'models') return ok(page([{ model_id: 'model_demo', provider_code: 'mock', model_code: 'demo-chat', name: '演示对话模型', supports_user_key: true, platform_credential_available: true, default_params: { temperature: 0.7 }, parameter_schema: {} }], url));
  if (resource === 'voices') return ok({ voices: voices.filter(v => (['tts_provider', 'tts_model', 'language'] as const).every(k => !url.searchParams.has(k) || v[k] === url.searchParams.get(k))) });
  if (resource === 'roles' || resource === 'llm-credentials') {
    const collection = resource === 'roles' ? roles : credentials; const field = resource === 'roles' ? 'profile_id' : 'credential_id';
    if (!key && method === 'GET') return ok(page(collection.filter(item => Object.entries(Object.fromEntries(url.searchParams)).every(([k, v]) => !['status', 'provider_code'].includes(k) || Reflect.get(item, k) === v)), url));
    if (!key && method === 'POST') {
      if (!body.name) return fail('名称不能为空');
      if (resource === 'roles') { const role = { ...roles[0], ...body as unknown as CreateRoleRequest, profile_id: id('role'), created_at: now(), updated_at: now() }; roles.push(role); return ok(role, 201); }
      const credential: CredentialItem = { credential_id: id('credential'), provider_code: String(body.provider_code), name: String(body.name), masked_value: 'sk-****demo', status: 'enabled', created_at: now(), updated_at: now() }; credentials.push(credential); return ok(credential, 201);
    }
    const index = collection.findIndex(item => Reflect.get(item, field) === key); if (index < 0) return fail('配置不存在', 404);
    if (method === 'DELETE') { collection.splice(index, 1); return ok({ credential_id: key, status: 'deleted' }); }
    if (method === 'PATCH') { Object.assign(collection[index], Object.fromEntries(Object.entries(body).filter(([k]) => !['api_key', field].includes(k))), { updated_at: now() }); return ok(collection[index]); }
  }
  if (resource === 'projects') {
    if (!key && method === 'GET') return ok(page(projects.filter(p => p.title.includes(url.searchParams.get('keyword') ?? '')).map(p => ({ ...p, current_script_id: p.current_script?.script_id ?? null, confirmed_script_id: p.confirmed_script?.script_id ?? null, latest_audio_version_id: p.latest_audio?.audio_version_id ?? null })), url));
    if (!key && method === 'POST') return typeof body.title === 'string' && body.title.trim() ? ok(makeProject(body.title.trim()), 201) : fail('项目标题不能为空');
    const project = projects.find(p => p.project_id === key); if (!project) return fail('项目不存在', 404);
    if (!action) return ok({ ...project, active_tasks: tasks.filter(t => t.project_id === key && ['queued', 'running'].includes(t.status)).map(t => ({ ...accepted(t), stage: t.stage })) });
    if (action === 'llm-config') { if (method === 'PUT') Object.assign(project.llm_config, body as unknown as SaveLlmConfigRequest); return ok(project.llm_config); }
    if (action === 'source') {
      if (project.source_submitted) return fail('原文已提交并锁定', 409);
      let text = body.text; if (child === 'upload') { const form = await request.formData(); const file = form.get('file'); if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.txt')) return fail('请上传 TXT 文件'); text = await file.text(); }
      if (typeof text !== 'string' || !text.trim()) return fail('原文不能为空');
      Object.assign(project, { source_text: text.trim(), source_type: child === 'upload' ? 'txt' : 'text', source_submitted: true, source_submitted_at: now(), source_hash: id('hash'), updated_at: now() }); return ok(project);
    }
    if (action === 'scripts') return ok(page(scripts.filter(s => s.project_id === key && (!url.searchParams.has('status') || s.status === url.searchParams.get('status'))).map(s => ({ ...s, sentence_count: s.sentences.length })), url));
    if (action === 'tasks') return ok(page(tasks.filter(t => t.project_id === key && ['status', 'task_type', 'audio_action', 'audio_version_id'].every(k => !url.searchParams.has(k) || Reflect.get(t, k) === url.searchParams.get(k))), url));
    if (action === 'audio-versions') return ok(page(versions.filter(v => v.project_id === key && ['script_id', 'status'].every(k => !url.searchParams.has(k) || Reflect.get(v, k) === url.searchParams.get(k))), url));
    if (action === 'script' && child === 'generate') {
      if (!project.source_submitted) return fail('请先提交原文', 409);
      const selected = (body as unknown as GenerateScriptRequest).roles;
      if (!selected?.length || selected.some(r => !roles.some(p => p.profile_id === r.profile_id))) return fail('请选择有效角色');
      return accept(queue(key, { task_type: 'script' }, task => { const script = makeScript(project, selected); task.script_id = script.script_id; task.result = { script_id: script.script_id }; }));
    }
    if (action === 'audio') {
      const script = scripts.find(s => s.script_id === body.script_id && s.project_id === key); if (!script) return fail('脚本不存在', 404);
      if (script.version !== body.expected_script_version || script.edit_revision !== body.expected_edit_revision) return fail('脚本已修改，请刷新', 409);
      if (script.status !== 'confirmed') return fail('请先确认脚本', 409);
      if (child === 'preview') return accept(queue(key, { audio_action: 'preview', script_id: script.script_id }, task => { task.result = { play_url: playUrl('preview') }; }));
      const version = makeAudio(script, 'queued');
      return accept(queue(key, { audio_action: 'full', script_id: script.script_id, audio_version_id: version.audio_version_id, total_sentences: script.sentences.length }, task => { completeAudio(version.audio_version_id); task.result = { audio_version_id: version.audio_version_id }; }));
    }
  }
  if (resource === 'scripts') {
    const script = scripts.find(s => s.script_id === key); if (!script) return fail('脚本不存在', 404);
    if (method === 'GET') return ok(script);
    if (script.version !== body.expected_script_version || script.edit_revision !== body.expected_edit_revision) return fail('版本冲突，请刷新后重试', 409, 'REVISION_CONFLICT');
    if (action === 'confirm' || action === 'unconfirm') {
      if (action === 'confirm' && scripts.some(other => other.project_id === script.project_id && other.script_id !== key && other.status === 'confirmed')) return fail('该项目已有其他已确认脚本', 409, 'ANOTHER_SCRIPT_CONFIRMED');
      const confirmed = action === 'confirm'; Object.assign(script, { status: confirmed ? 'confirmed' : 'draft', editable: !confirmed, confirmed_at: confirmed ? now() : null, confirmed_by: confirmed ? 'user_demo' : null, confirmed_revision: confirmed ? script.edit_revision : null });
      const project = projects.find(p => p.project_id === script.project_id)!;
      script.updated_at = now(); project.updated_at = script.updated_at;
      if (confirmed) project.confirmed_script = { ...script, confirmed_at: script.confirmed_at! };
      else if (project.confirmed_script?.script_id === key) project.confirmed_script = null;
      return ok(script);
    }
    if (!script.editable) return fail('请取消确认后再编辑', 409, 'SCRIPT_LOCKED');
    if (action === 'sentences') { const sentence = script.sentences.find(s => s.sentence_id === child); if (!sentence) return fail('句子不存在', 404); const { expected_script_version: _version, expected_edit_revision: _revision, ...changes } = body; Object.assign(sentence, changes); script.edit_revision++; return ok({ ...script, sentence }); }
    const changes = body as unknown as SaveScriptRequest;
    if (!changes.title?.trim() || !changes.sentences?.length || !Array.isArray(changes.roles)) return fail('标题、句子和角色不能为空');
    if (changes.roles.length !== script.roles.length || new Set(changes.roles.map(r => r.role_id)).size !== changes.roles.length || changes.roles.some(r => !r.name?.trim() || !script.roles.some(original => original.role_id === r.role_id && original.role_key === r.role_key))) return fail('角色名称不能为空，角色 ID 和标识不可修改', 422, 'INVALID_ROLE');
    for (const role of changes.roles) {
      const config = role.voice_config;
      const voice = voices.find(v => v.tts_provider === config?.tts_provider && v.tts_model === config?.tts_model && v.voice_id === config?.voice_id);
      if (!voice) return fail(`角色「${role.name}」的音色不存在`, 422, 'INVALID_VOICE');
      if ((config.style && !voice.styles.includes(config.style)) || !Number.isFinite(config.speed) || (voice.speed.supported ? config.speed < voice.speed.min || config.speed > voice.speed.max : config.speed !== voice.speed.default)) return fail(`角色「${role.name}」的风格或语速不受支持`, 422, 'INVALID_AUDIO_PARAMS');
      for (const [key, value] of Object.entries(config.extra_params ?? {})) {
        const schema = voice.extra_parameter_schema[key] as { type?: string; enum?: unknown[]; minimum?: number; maximum?: number } | undefined;
        if (!schema || (schema.enum && !schema.enum.includes(value)) || (schema.type === 'boolean' && typeof value !== 'boolean') || (schema.type === 'string' && typeof value !== 'string') || (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)))) return fail(`角色「${role.name}」的参数 ${key} 无效`, 422, 'INVALID_AUDIO_PARAMS');
      }
    }
    if (changes.sentences.some(s => !s.text.trim() || !changes.roles.some(r => r.role_id === s.role_id))) return fail('句子内容或角色无效', 422, 'INVALID_ROLE');
    const updatedRoles = changes.roles.map(role => ({ ...role, profile_id: script.roles.find(original => original.role_id === role.role_id)?.profile_id ?? null }));
    Object.assign(script, { title: changes.title.trim(), summary: changes.summary, roles: structuredClone(updatedRoles), sentences: structuredClone(changes.sentences), edit_revision: script.edit_revision + 1, updated_at: now() });
    projects.find(p => p.project_id === script.project_id)!.updated_at = script.updated_at;
    return ok(script);
  }
  if (resource === 'tasks') {
    const task = tasks.find(t => t.task_id === key); if (!task) return fail('任务不存在', 404);
    if (action === 'retry') { if (!task.can_retry || !task.audio_version_id) return fail('任务不可重试', 409); return accept(queue(task.project_id, { audio_action: task.audio_action, audio_version_id: task.audio_version_id, script_id: task.script_id, retry_of_task_id: key, total_sentences: task.total_sentences }, retry => { completeAudio(task.audio_version_id!); retry.result = { audio_version_id: task.audio_version_id }; })); }
    return ok(task);
  }
  if (resource === 'audio-versions') {
    const version = versions.find(v => v.audio_version_id === key); if (!version) return fail('音频版本不存在', 404);
    const items = sentences[key];
    if (action === 'sentences') return ok({ audio_version_id: key, version: version.version, selection_revision: version.selection_revision, total_sentences: items.length, completed_sentences: items.filter(s => s.status === 'succeeded').length, failed_sentences: items.filter(s => s.status === 'failed').length, sentences: items });
    return ok({ ...version, source_script_changed: scripts.find(s => s.script_id === version.script_id)?.edit_revision !== version.script_edit_revision });
  }
  if (resource === 'audio-sentences') {
    const entry = Object.entries(sentences).find(([, items]) => items.some(s => s.audio_sentence_id === key)); if (!entry) return fail('音频句子不存在', 404);
    const version = versions.find(v => v.audio_version_id === entry[0])!; const sentence = entry[1].find(s => s.audio_sentence_id === key)!; const list = candidates[key] ??= [];
    if (action === 'candidates') return ok({ ...page(list.filter(c => !url.searchParams.has('status') || c.status === url.searchParams.get('status')), url), audio_sentence_id: key, audio_version_id: version.audio_version_id, current_asset_id: sentence.current_asset_id, current_play_url: sentence.play_url, selection_revision: version.selection_revision });
    if (body.expected_selection_revision !== version.selection_revision) return fail('音频版本已变化，请刷新', 409);
    const candidate = { candidate_id: id('candidate'), task_id: '', status: 'pending' as const, base_asset_id: sentence.current_asset_id!, base_selection_revision: version.selection_revision, asset_id: null, play_url: null, duration_ms: null, is_current: false, is_stale: false, created_at: now(), decided_at: null };
    list.unshift(candidate);
    const result = queue(version.project_id, { audio_action: 'regenerate', audio_version_id: version.audio_version_id, audio_sentence_id: key, result: { candidate_id: candidate.candidate_id } }, () => { Object.assign(candidate, { status: 'ready', asset_id: id('asset'), play_url: playUrl(candidate.asset_id ?? 'candidate'), duration_ms: 4000 }); sentence.has_ready_candidates = true; }); candidate.task_id = result.task_id; result.candidate_id = candidate.candidate_id; return accept(result);
  }
  if (resource === 'audio-candidates') {
    const entry = Object.entries(candidates).find(([, list]) => list.some(c => c.candidate_id === key)); if (!entry) return fail('候选不存在', 404);
    const candidate = entry[1].find(c => c.candidate_id === key)!; const items = Object.entries(sentences).find(([, list]) => list.some(s => s.audio_sentence_id === entry[0]))!; const version = versions.find(v => v.audio_version_id === items[0])!; const sentence = items[1].find(s => s.audio_sentence_id === entry[0])!;
    const current = () => ({ candidate_id: key, audio_version_id: version.audio_version_id, selection_revision: version.selection_revision, current_asset_id: sentence.current_asset_id });
    if (candidate.status === 'accepted' && candidate.is_current && body.choice === 'use_candidate') return ok(current());
    const merging = tasks.find(t => t.audio_version_id === version.audio_version_id && t.stage === 'merging' && ['queued', 'running'].includes(t.status));
    if (merging) return merging.result?.candidate_id === key && body.choice === 'use_candidate' ? ok(accepted(merging), 202) : fail('音频正在合并，请等待完成', 409, 'TASK_ALREADY_RUNNING');
    if (body.expected_selection_revision !== version.selection_revision || candidate.is_stale) return fail('候选版本已过期，请刷新', 409, 'REVISION_CONFLICT');
    if (candidate.status === 'discarded' && body.choice === 'keep_original') return ok({ ...current(), status: 'discarded' });
    if (candidate.status !== 'ready' || !candidate.asset_id) return fail('候选当前不可操作', 409);
    if (body.choice === 'keep_original') {
      candidate.status = 'discarded'; candidate.decided_at = now();
      sentence.has_ready_candidates = entry[1].some(c => c.status === 'ready' && !c.is_stale);
      return ok({ ...current(), status: 'discarded' });
    }
    if (body.choice !== 'use_candidate') return fail('无效的候选操作');
    const result = queue(version.project_id, { audio_action: 'regenerate', script_id: version.script_id, audio_version_id: version.audio_version_id, audio_sentence_id: sentence.audio_sentence_id, stage: 'merging', result: { candidate_id: key } }, task => {
      candidate.status = 'accepted'; candidate.is_current = true; candidate.decided_at = now();
      sentence.current_asset_id = candidate.asset_id; sentence.play_url = playUrl(candidate.asset_id!); sentence.duration_ms = candidate.duration_ms;
      version.selection_revision++; version.current_asset_id = id('merged'); version.play_url = playUrl(version.current_asset_id); version.download_url = `/api/audio-assets/${version.current_asset_id}/download`; version.updated_at = now();
      for (const item of items[1]) {
        for (const other of candidates[item.audio_sentence_id] ?? []) {
          if (other !== candidate) { other.is_stale = true; other.is_current = other.asset_id === item.current_asset_id; }
        }
        item.has_ready_candidates = (candidates[item.audio_sentence_id] ?? []).some(c => c.status === 'ready' && !c.is_stale);
      }
      task.result_asset_id = version.current_asset_id;
      task.result = { ...current(), candidate_id: key, play_url: version.play_url };
    });
    result.candidate_id = key;
    return accept(result);
  }
  if (resource === 'audio-assets') {
    const data = wav(key); const range = request.headers.get('range'); const match = range?.match(/^bytes=(\d+)-(\d*)$/); const start = match ? Number(match[1]) : 0; const end = match && match[2] ? Math.min(Number(match[2]), data.byteLength - 1) : data.byteLength - 1;
    if (start >= data.byteLength || end < start) return new HttpResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${data.byteLength}` } });
    return new HttpResponse(data.slice(start, end + 1), { status: match ? 206 : 200, headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(match ? { 'Content-Range': `bytes ${start}-${end}/${data.byteLength}` } : {}), ...(action === 'download' ? { 'Content-Disposition': 'attachment; filename="textcast-demo.wav"' } : {}) } });
  }
  return fail(`未实现的模拟接口：${method} ${url.pathname}`, 404);
}
function completeAudio(versionId: string) {
  const version = versions.find(v => v.audio_version_id === versionId)!;
  Object.assign(version, { status: 'ready', current_asset_id: id('asset'), updated_at: now() }); version.play_url = playUrl(version.current_asset_id!); version.download_url = `/api/audio-assets/${version.current_asset_id}/download`;
  for (const sentence of sentences[versionId]) Object.assign(sentence, { status: 'succeeded', error_message: null });
}
