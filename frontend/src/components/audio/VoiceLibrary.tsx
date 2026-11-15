import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppButton } from '@/components/common/AppButton';
import { voicesApi, type VoiceProfile } from '@/api/voices';
import { pollTask, newIdempotencyKey } from '@/api';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const isDemo = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK !== 'false';

export function VoiceLibrary() {
  const queryClient = useQueryClient();
  const { data, isPending, error: loadError } = useQuery({ queryKey: ['voice-profiles'], queryFn: voicesApi.list });
  const [name, setName] = React.useState('');
  const [text, setText] = React.useState('');
  const [language, setLanguage] = React.useState<'Chinese' | 'English'>('Chinese');
  const [file, setFile] = React.useState<File | null>(null);
  const [authorized, setAuthorized] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const assetRef = React.useRef<{ file: File; id: string } | null>(null);
  const busyRef = React.useRef(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current || !file || !authorized) return;
    if (!name.trim() || !text.trim()) { setError('请填写声音名称与录音原文'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('录音不能超过 10 MiB'); return; }
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (assetRef.current?.file !== file) {
        const uploaded = await voicesApi.upload(file);
        assetRef.current = { file, id: uploaded.asset_id };
      }
      await voicesApi.create({ name: name.trim(), reference_asset_id: assetRef.current!.id,
        reference_text: text.trim(), language, authorized: true });
      setName(''); setText(''); setFile(null); setAuthorized(false); assetRef.current = null;
      if (fileInput.current) fileInput.current.value = '';
      setNotice('声音已保存。试听满意后，在角色模板中选择该声音，再生成脚本。');
      await Promise.all(['voice-profiles', 'voices'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <details className="rounded-xl border border-border bg-card p-5" open>
    <summary className="cursor-pointer font-semibold">我的克隆声音</summary>
    <p className="my-3 text-sm text-muted-foreground">上传 3–30 秒、单人清晰说话的 WAV 或 MP3，并准确填写录音中的原话。声音仅供当前账号使用。</p>
    {isDemo && <p role="status" className="mb-3 text-sm text-muted-foreground">演示模式不保存录音或合成克隆语音。连接真实语音服务后可使用。</p>}
    {!isDemo && <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">声音名称<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} className={inputClass} disabled={busy} /></label>
      <label className="space-y-1 text-sm">参考录音（最大 10 MiB）<input ref={fileInput} required type="file" accept="audio/wav,audio/mpeg,.wav,.mp3" onChange={e => { setFile(e.target.files?.[0] ?? null); assetRef.current = null; }} className={inputClass} disabled={busy} /></label>
      <label className="space-y-1 text-sm sm:col-span-2">录音原文<textarea required maxLength={2000} rows={3} value={text} onChange={e => setText(e.target.value)} className={inputClass} disabled={busy} /></label>
      <label className="space-y-1 text-sm">录音语言<select className={inputClass} value={language} disabled={busy} onChange={e => setLanguage(e.target.value as 'Chinese' | 'English')}><option value="Chinese">中文</option><option value="English">英文</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" required checked={authorized} onChange={e => setAuthorized(e.target.checked)} disabled={busy} />这是本人的声音，或已获得说话人授权</label>
      <AppButton type="submit" disabled={busy || !file || !authorized}>{busy ? '正在保存…' : '保存声音'}</AppButton>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {isPending ? <p className="mt-4 text-sm">正在加载声音…</p> : loadError ? <p role="alert" className="mt-4 text-sm text-destructive">声音库加载失败：{loadError.message}</p> :
      <ul className="mt-4 space-y-3">{(data?.items ?? []).map(voice => <VoiceRow key={voice.voice_profile_id} voice={voice} />)}
        {!data?.items.length && <li className="text-sm text-muted-foreground">还没有保存的声音。</li>}</ul>}
  </details>;
}

function VoiceRow({ voice }: { voice: VoiceProfile }) {
  const queryClient = useQueryClient();
  const [text, setText] = React.useState('欢迎收听今天的播客，这是我的声音试听。');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState('');
  const [url, setUrl] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const pendingKey = React.useRef<{ text: string; key: string } | null>(null);
  const busyRef = React.useRef(false);
  React.useEffect(() => () => abort.current?.abort(), []);

  async function preview() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setUrl(null);
    abort.current?.abort(); abort.current = new AbortController();
    try {
      if (pendingKey.current?.text !== text) pendingKey.current = { text, key: newIdempotencyKey() };
      const accepted = await voicesApi.preview(voice.voice_profile_id, text, pendingKey.current!.key);
      const task = await pollTask(accepted.task_id, { signal: abort.current.signal, onUpdate: t => setStatus(t.status === 'queued' ? '排队中…' : '正在合成…') });
      pendingKey.current = null;
      if (task.status !== 'succeeded') throw new Error(task.error_message ?? '试听失败');
      const playUrl = task.result?.play_url;
      if (typeof playUrl !== 'string') throw new Error('试听没有返回音频');
      setUrl(playUrl); setStatus('试听已生成');
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) { setError(e instanceof Error ? e.message : '试听失败'); setStatus(''); } }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function toggle() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await voicesApi.update(voice.voice_profile_id, { status: voice.status === 'enabled' ? 'disabled' : 'enabled' });
      await Promise.all(['voice-profiles', 'voices'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <li className="space-y-3 rounded-lg border border-border p-4">
    <div className="flex items-center justify-between gap-3"><span className="font-medium">{voice.name} <span className="text-xs text-muted-foreground">{(voice.duration_ms / 1000).toFixed(1)} 秒 · {voice.status === 'enabled' ? '可用' : '已停用'}</span></span>
      <AppButton variant="outline" disabled={busy} onClick={toggle}>{voice.status === 'enabled' ? '停用' : '启用'}</AppButton></div>
    <label className="block space-y-1 text-sm">试听文本<input value={text} maxLength={120} onChange={e => setText(e.target.value)} className={inputClass} disabled={busy} /></label>
    <AppButton onClick={preview} disabled={busy || !text.trim() || voice.status !== 'enabled'}>{busy ? '处理中…' : '合成试听'}</AppButton>
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {url && <audio controls src={url} className="w-full" />}
  </li>;
}
