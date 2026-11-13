import type { ProjectDetail, ScriptDetail, AudioVersionDetail, AudioSentenceItem, CandidateItem, TaskDetail, RoleProfileItem } from '../api/types';

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const playUrl = (asset: string) => `/api/audio-assets/${asset}/play`;
export const roles: RoleProfileItem[] = ['知夏', '林川', '旁白'].map((name, i) => ({ profile_id: `role_${i + 1}`, name, description: ['温暖自然的女主持', '沉稳清晰的男嘉宾', '适合知识解说的中性旁白'][i], tts_provider: 'mock', tts_model: 'demo-tts', voice_id: `voice_${i + 1}`, style: 'natural', speed: 1, extra_params: {}, status: 'enabled', created_at: now(), updated_at: now() }));
export const projects: ProjectDetail[] = [];
export const scripts: ScriptDetail[] = [];
export const versions: AudioVersionDetail[] = [];
export const sentences: Record<string, AudioSentenceItem[]> = {};
export const candidates: Record<string, CandidateItem[]> = {};
export const tasks: TaskDetail[] = [];
export function makeProject(title: string): ProjectDetail {
  const project_id = id('project');
  const project: ProjectDetail = { project_id, title, source_text: null, source_type: null, source_asset_id: null, source_hash: null, source_submitted: false, source_submitted_at: null, llm_config: { project_id, model_id: 'model_demo', credential_source: 'platform', credential_id: null, params: { temperature: 0.7 }, available: true, unavailable_reason: null }, current_script: null, confirmed_script: null, latest_audio: null, active_tasks: [], created_at: now(), updated_at: now() };
  projects.unshift(project); return project;
}
export function makeScript(project: ProjectDetail, selected = roles.slice(0, 2).map((r, i) => ({ profile_id: r.profile_id, role_key: i ? 'guest' : 'host' }))): ScriptDetail {
  const script_id = id('script');
  const cast = selected.map((r) => { const profile = roles.find(p => p.profile_id === r.profile_id)!; return { role_id: id('speaker'), profile_id: profile.profile_id, role_key: r.role_key, name: profile.name, description: profile.description, voice_config: { tts_provider: profile.tts_provider, tts_model: profile.tts_model, voice_id: profile.voice_id, style: profile.style, speed: profile.speed, extra_params: structuredClone(profile.extra_params) } }; });
  const lines = [`欢迎收听 TextCast，今天我们聊聊《${project.title}》。`, '我们先从一个日常生活中的问题开始。', ...(project.source_text ?? '').split(/(?<=[。！？])|\n/).filter(s => s.trim()), '听起来，关键是从一个小小的行动开始。', '没错。希望今天的分享能给你带来新的启发，我们下期再见。'];
  const script: ScriptDetail = { script_id, project_id: project.project_id, version: scripts.filter(s => s.project_id === project.project_id).length + 1, edit_revision: 1, title: project.title, summary: '双人对谈：从生活场景出发，将原文整理为轻松易懂的播客。', status: 'draft', confirmed_at: null, confirmed_by: null, confirmed_revision: null, editable: true, roles: cast, sentences: lines.map((text, i) => ({ sentence_id: id('sentence'), sequence: i + 1, role_id: cast[i % cast.length].role_id, text, speed: null, extra_params: {} })), created_at: now(), updated_at: now() };
  scripts.unshift(script); project.current_script = script; project.updated_at = now(); return script;
}
export function makeAudio(script: ScriptDetail, status: AudioVersionDetail['status'] = 'ready') {
  const audio_version_id = id('audio'); const asset = id('asset');
  const version: AudioVersionDetail = { audio_version_id, project_id: script.project_id, version: versions.filter(v => v.project_id === script.project_id).length + 1, script_id: script.script_id, script_version: script.version, script_edit_revision: script.edit_revision, status, selection_revision: 1, current_asset_id: status === 'ready' ? asset : null, duration_ms: 4000 * script.sentences.length, size_bytes: 64044 * script.sentences.length, download_url: `/api/audio-assets/${asset}/download`, play_url: playUrl(asset), script_snapshot: structuredClone(script) as unknown as Record<string, unknown>, config_snapshot: {}, source_script_changed: false, active_tasks: [], created_at: now(), updated_at: now() };
  sentences[audio_version_id] = script.sentences.map(s => ({ audio_sentence_id: id('audio_sentence'), source_sentence_id: s.sentence_id, sequence: s.sequence, text: s.text, role: script.roles.find(r => r.role_id === s.role_id)!, current_params: {}, status: status === 'ready' ? 'succeeded' : status === 'failed' ? 'failed' : 'queued', current_asset_id: asset, play_url: playUrl(asset), duration_ms: 4000, error_message: status === 'failed' ? '模拟：语音服务暂时不可用，请重试。' : null, has_ready_candidates: false }));
  versions.unshift(version); projects.find(p => p.project_id === script.project_id)!.latest_audio = version; return version;
}
const demos = [
  ['把时间留给重要的事', '注意力是我们最珍贵的资源。每天先选出一件最重要的事，再为它留出不被打扰的时间。\n休息不是浪费时间。适当散步、睡眠和运动，可以帮助我们保持更长久的创造力。'],
  ['城市里的绿色生活', '绿色生活可以从通勤开始。短途步行、中途骑行、长途选择公共交通，让城市少一点拥堵。\n随身带水杯、减少一次性包装，也是一种简单而有效的选择。'],
  ['给好奇心一点空间', '学习并不只发生在课堂。提出一个好问题、观察一个小现象，都可能成为新的起点。\n记录自己的疑问，再通过阅读和实践寻找答案。'],
  ['周末读书会 · 待提交原文', null],
] as const;
demos.forEach(([title, source], index) => {
  const project = makeProject(title); project.project_id = `project_demo_${index + 1}`; project.llm_config.project_id = project.project_id;
  if (!source) return;
  Object.assign(project, { source_text: source, source_type: 'text', source_hash: `demo_${index}`, source_submitted: true, source_submitted_at: now() });
  const script = makeScript(project);
  if (index < 2) { Object.assign(script, { status: 'confirmed', editable: false, confirmed_at: now(), confirmed_by: 'user_demo', confirmed_revision: 1 }); project.confirmed_script = { ...script, confirmed_at: script.confirmed_at! }; const version = makeAudio(script, index === 1 ? 'failed' : 'ready'); if (index === 1) tasks.push({ task_id: id('task'), project_id: project.project_id, task_type: 'audio', audio_action: 'full', script_id: script.script_id, audio_version_id: version.audio_version_id, audio_sentence_id: null, retry_of_task_id: null, status: 'failed', stage: 'synthesis', progress: 50, total_sentences: script.sentences.length, completed_sentences: 0, failed_sentences: script.sentences.length, result: null, error_code: 'TTS_UNAVAILABLE', error_message: '模拟语音服务超时，可点击重试', can_retry: true, result_asset_id: null, created_at: now(), updated_at: now(), started_at: now(), finished_at: now() }); }
});

// One project includes both a published script and a new editable revision.
const revision = makeScript(projects.find(p => p.project_id === 'project_demo_1')!);
revision.title = '把时间留给重要的事 · 对谈修订版';
revision.summary = '加入主持人提问与行动建议，演示同一项目中已确认版本和新草稿并存。';
revision.roles[0].voice_config.style = 'cheerful';
revision.roles[0].voice_config.extra_params = { volume: 0.8, emotion: 'happy' };
revision.roles[1].voice_config.speed = 0.95;

// Provide ready takes so the audio page can demonstrate acceptance immediately.
for (const version of versions.filter(v => v.status === 'ready')) {
  const sentence = sentences[version.audio_version_id][0];
  candidates[sentence.audio_sentence_id] = [1, 2].map(index => {
    const asset = `candidate_demo_${index}`;
    return { candidate_id: id('candidate'), task_id: id('task'), status: 'ready', base_asset_id: sentence.current_asset_id!, base_selection_revision: version.selection_revision, asset_id: asset, play_url: playUrl(asset), duration_ms: 4000, is_current: false, is_stale: false, created_at: now(), decided_at: null };
  });
  sentence.has_ready_candidates = true;
}
