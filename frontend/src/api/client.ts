import type { ApiEnvelope } from './types';

const API_BASE = '/api';

export class ApiError extends Error {
  public code: string;
  public status: number;
  public requestId?: string;
  constructor(
    code: string,
    message: string,
    status: number,
    requestId?: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.name = 'ApiError';
  }
}

// CSRF token 由登录/当前用户接口返回，缓存在模块内
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** 幂等键，异步请求必传 */
  idempotencyKey?: string;
  /** multipart 上传时传 FormData */
  formData?: FormData;
  /** 需要返回原始 Response（如音频流） */
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    });
  }
  return url.toString();
}

function uuid(): string {
  // 优先使用浏览器原生 crypto.randomUUID
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function newIdempotencyKey(): string {
  return uuid();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, idempotencyKey, formData, raw } = options;

  const headers: Record<string, string> = {};

  // 写请求带 CSRF Token
  if (method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  let payload: BodyInit | undefined;
  if (formData) {
    payload = formData; // 浏览器自动设置 multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: payload,
    credentials: 'include', // 携带 Cookie
  });
  // Business requests can discover an expired session after the guard loaded.
  // Auth endpoints report their own errors without interrupting the form.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    setCsrfToken(null);
    window.dispatchEvent(new Event('auth:unauthenticated'));
  }

  if (raw) {
    if (!res.ok) {
      // 尽量解析 JSON 错误
      const err = await safeParseError(res);
      throw err;
    }
    return res as unknown as T;
  }

  // 音频接口成功时可能不是 JSON，但这里 raw=false 的调用都应是 JSON
  const text = await res.text();
  let json: ApiEnvelope<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
  } catch {
    // 非 JSON
  }

  if (!res.ok || (json && json.code !== 'OK')) {
    if (json) {
      throw new ApiError(json.code, json.message, res.status, json.request_id);
    }
    throw new ApiError('INTERNAL_ERROR', res.statusText || '请求失败', res.status);
  }

  // 同步成功返回 data
  return (json ? json.data : null) as T;
}

async function safeParseError(res: Response): Promise<ApiError> {
  try {
    const text = await res.text();
    const json = text ? (JSON.parse(text) as ApiEnvelope<null>) : null;
    if (json) {
      return new ApiError(json.code, json.message, res.status, json.request_id);
    }
  } catch {
    /* ignore */
  }
  return new ApiError('INTERNAL_ERROR', res.statusText || '请求失败', res.status);
}

export const http = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', formData }),
  raw: (path: string, query?: RequestOptions['query']) =>
    request<Response>(path, { method: 'GET', query, raw: true }),
};
