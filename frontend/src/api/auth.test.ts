import { afterEach, describe, expect, it, vi } from 'vitest';

import { authApi, ApiError } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authApi account-service adapter', () => {
  it('maps AUTH_REQUIRED to the frontend unauthenticated contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'AUTH_REQUIRED', message: '请先登录' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )));

    const error = await authApi.me().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it('normalizes the account backend login response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: {
        id: 'account-1', username: 'demo', displayName: '演示用户', role: 'user',
        status: 'active', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', lastLoginAt: null,
      },
      expiresAt: '2026-11-16T00:00:00Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(authApi.login({ username: 'demo', password: 'password' })).resolves.toEqual({
      user: {
        user_id: 'account-1', username: 'demo', display_name: '演示用户',
        status: 'active', created_at: '2026-11-15T00:00:00Z',
      },
      expires_at: '2026-11-16T00:00:00Z',
      csrf_token: null,
    });
  });

  it('sends the backend displayName field when registering', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: {
        id: 'account-2', username: 'new-user', displayName: '新用户', role: 'user',
        status: 'active', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', lastLoginAt: null,
      },
      expiresAt: '2026-11-16T00:00:00Z',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.register({ username: 'new-user', password: 'password', display_name: '新用户' });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      username: 'new-user', password: 'password', displayName: '新用户',
    });
  });

  it('accepts the backend 204 logout response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(authApi.logout()).resolves.toEqual({ logged_out: true });
  });
});
