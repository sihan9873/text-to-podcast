import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { http, setCsrfToken } from './client';
import { authApi } from './auth';

const account = { id: '7', username: 'alice', displayName: 'Alice', role: 'user', status: 'active', createdAt: '2026-11-14' };
const fetchMock = vi.fn();
beforeEach(() => {
  setCsrfToken(null);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' }, dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('account and generation service contracts', () => {
  it('normalizes the real account session without inventing a CSRF token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: account, expiresAt: '2026-11-15' })));
    const session = await authApi.login({ username: 'alice', password: 'test-password' });
    expect(session.user.user_id).toBe('7');
    expect(session.user.display_name).toBe('Alice');
    expect(session.expires_at).toBe('2026-11-15');
    expect(session.csrf_token).toBe('');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });
  it('maps registration fields and handles logout 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: account, expiresAt: 'later' }), { status: 201 }));
    await authApi.register({ username: 'alice', password: 'test-password', display_name: 'Alice' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: 'alice', password: 'test-password', displayName: 'Alice' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await authApi.logout()).toEqual({ logged_out: true });
  });
  it('encodes integer business IDs and preserves opaque voice IDs', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'OK', data: { task_id: 8, audio_version_id: 9 } })));
    const result = await http.post<{ task_id: string }>('/projects/1/audio/generate', { script_id: '12', roles: [{ profile_id: '3', voice_id: 'clone_4' }] }, 'same-request');
    expect(result.task_id).toBe('8');
    const options = fetchMock.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ script_id: 12, roles: [{ profile_id: 3, voice_id: 'clone_4' }] });
    expect(options.headers['Idempotency-Key']).toBe('same-request');
  });
  it('does not mistake an account 401 for a successful session', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'AUTH_REQUIRED', message: '请先登录' }), { status: 401 }));
    await expect(authApi.me()).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
  });
});
