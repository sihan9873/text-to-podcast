import { http, setCsrfToken } from './client';
import type {
  LoginRequest,
  LogoutResponse,
  RegisterRequest,
  RegisterResponse,
  SessionResponse,
} from './types';

export const authApi = {
  /** U-01 注册 */
  register: (body: RegisterRequest) =>
    http.post<RegisterResponse>('/auth/register', body),

  /** U-02 登录（成功后缓存 csrf_token） */
  async login(body: LoginRequest): Promise<SessionResponse> {
    const data = await http.post<SessionResponse>('/auth/login', body);
    setCsrfToken(data.csrf_token);
    return data;
  },

  /** U-03 当前用户（可用于刷新 csrf_token） */
  async me(): Promise<SessionResponse> {
    const data = await http.get<SessionResponse>('/auth/me');
    setCsrfToken(data.csrf_token);
    return data;
  },

  /** U-04 退出 */
  async logout(): Promise<LogoutResponse> {
    const data = await http.post<LogoutResponse>('/auth/logout');
    setCsrfToken(null);
    return data;
  },
};