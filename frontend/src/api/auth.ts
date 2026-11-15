import { ApiError, setCsrfToken } from './client';
import type {
  LoginRequest,
  LogoutResponse,
  RegisterRequest,
  RegisterResponse,
  SessionResponse,
  UserInfo,
} from './types';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new ApiError('INVALID_RESPONSE', '账号服务响应格式不正确', 502);
}

function normalizeUser(value: unknown): UserInfo {
  if (!isObject(value)) invalidResponse();
  const userId = value.user_id ?? value.id;
  const displayName = value.display_name ?? value.displayName ?? null;
  const createdAt = value.created_at ?? value.createdAt;
  if (
    (typeof userId !== 'string' && typeof userId !== 'number')
    || typeof value.username !== 'string'
    || (displayName !== null && typeof displayName !== 'string')
    || (value.status !== 'active' && value.status !== 'disabled')
    || typeof createdAt !== 'string'
  ) invalidResponse();
  return {
    user_id: String(userId),
    username: value.username,
    display_name: displayName,
    status: value.status,
    created_at: createdAt,
  };
}

function normalizeSession(value: unknown): SessionResponse {
  if (!isObject(value) || !('user' in value)) invalidResponse();
  const expiresAt = value.expires_at ?? value.expiresAt ?? null;
  const csrfToken = value.csrf_token ?? null;
  if (expiresAt !== null && typeof expiresAt !== 'string') invalidResponse();
  if (csrfToken !== null && typeof csrfToken !== 'string') invalidResponse();
  return {
    user: normalizeUser(value.user),
    expires_at: expiresAt,
    csrf_token: csrfToken,
  };
}

async function authRequest(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const options: RequestInit = {
    method,
    credentials: 'include',
  };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`/api/auth${path}`, options);
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('INVALID_RESPONSE', '账号服务未返回有效 JSON', response.status);
    }
  }

  const envelope = isObject(payload) && typeof payload.code === 'string' && 'data' in payload;
  const code = isObject(payload) && typeof payload.code === 'string' ? payload.code : null;
  if (!response.ok || (envelope && code !== 'OK')) {
    const normalizedCode = code === 'AUTH_REQUIRED' ? 'UNAUTHENTICATED' : (code ?? 'INTERNAL_ERROR');
    const message = isObject(payload) && typeof payload.message === 'string'
      ? payload.message
      : (response.statusText || '请求失败');
    const requestId = isObject(payload) && typeof payload.request_id === 'string'
      ? payload.request_id
      : (response.headers.get('X-Request-ID') ?? undefined);
    throw new ApiError(normalizedCode, message, response.status, requestId);
  }
  return envelope ? (payload as JsonObject).data : payload;
}

export const authApi = {
  async register(body: RegisterRequest): Promise<RegisterResponse> {
    const data = await authRequest('/register', 'POST', {
      username: body.username,
      password: body.password,
      displayName: body.display_name?.trim() || body.username,
    });
    if (isObject(data) && 'user' in data) return normalizeUser(data.user);
    return normalizeUser(data);
  },

  async login(body: LoginRequest): Promise<SessionResponse> {
    const data = normalizeSession(await authRequest('/login', 'POST', body));
    setCsrfToken(data.csrf_token);
    return data;
  },

  async me(): Promise<SessionResponse> {
    const data = normalizeSession(await authRequest('/me'));
    setCsrfToken(data.csrf_token);
    return data;
  },

  async logout(): Promise<LogoutResponse> {
    const data = await authRequest('/logout', 'POST');
    setCsrfToken(null);
    if (isObject(data) && typeof data.logged_out === 'boolean') return { logged_out: data.logged_out };
    return { logged_out: true };
  },
};
