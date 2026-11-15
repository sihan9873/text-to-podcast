import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCsrfToken, setCsrfToken } from '@/api/client';
import { loadSession } from './session';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
  setCsrfToken('old-session-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('session loading used by application guards', () => {
  it.each(['AUTH_REQUIRED', 'UNAUTHENTICATED'])('treats 401 %s as signed out', async code => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code, message: '请先登录' }), { status: 401 }));
    await expect(loadSession()).resolves.toBeNull();
    expect(getCsrfToken()).toBeNull();
  });

  it('loads the real account session after login or refresh', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: {
      id: '7', username: 'admin', displayName: '管理员', role: 'admin', status: 'active',
    } })));
    await expect(loadSession()).resolves.toMatchObject({ user: { user_id: '7', username: 'admin' } });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5173/api/auth/me', expect.objectContaining({ credentials: 'include' }));
  });

  it('preserves server failures instead of treating them as signed out', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: '服务暂不可用' }), { status: 500 }));
    await expect(loadSession()).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('preserves network failures', async () => {
    const error = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(error);
    await expect(loadSession()).rejects.toBe(error);
  });
});
