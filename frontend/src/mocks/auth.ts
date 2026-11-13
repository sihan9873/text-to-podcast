import { HttpResponse } from 'msw';
import type { UserInfo } from '../api/types';
const storageKey = 'textcast.mock.auth.v1';
type Account = { user: UserInfo; passwordHash: string };
let accounts: Account[] = [];
let currentUser: UserInfo | null = null;
try { const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); if (saved) { accounts = saved.accounts; currentUser = saved.currentUser; } } catch { /* Storage may be unavailable. */ }
const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ accounts, currentUser })); } catch { /* Keep this session in memory. */ } };
const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const response = (data: unknown, status = 200, code = 'OK', message = 'success') => HttpResponse.json({ code, message, data, request_id: crypto.randomUUID(), timestamp: new Date().toISOString() }, { status });
const failure = (status: number, code: string, message: string) => response(null, status, code, message);
export const isMockAuthenticated = () => currentUser !== null;
export const unauthenticated = () => failure(401, 'UNAUTHENTICATED', '请先登录');
export async function mockAuth(action: string, method: string, body: Record<string, unknown>) {
  if (action === 'me' && method === 'GET') return currentUser ? response({ user: currentUser, expires_at: new Date(Date.now() + 86400000).toISOString(), csrf_token: 'mock-csrf-token' }) : unauthenticated();
  if (action === 'logout' && method === 'POST') { currentUser = null; save(); return response({ logged_out: true }); }
  if (!['register', 'login'].includes(action) || method !== 'POST') return failure(404, 'NOT_FOUND', '认证接口不存在');
  const { username, password, display_name } = body;
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 128 || (display_name != null && (typeof display_name !== 'string' || display_name.length > 100))) return failure(422, 'INVALID_INPUT', '请检查用户名、密码和昵称格式');
  const existing = accounts.find(a => a.user.username === username);
  const passwordHash = await hash(password);
  if (action === 'register') {
    if (existing || username === 'demo') return failure(409, 'USERNAME_EXISTS', '该用户名已被注册');
    const user: UserInfo = { user_id: `user_${crypto.randomUUID()}`, username, display_name: typeof display_name === 'string' ? display_name : null, status: 'active', created_at: new Date().toISOString() };
    accounts.push({ user, passwordHash }); save(); return response(user, 201);
  }
  const demo = username === 'demo' && password === 'TextCast123';
  if (!demo && (!existing || existing.passwordHash !== passwordHash)) return failure(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
  currentUser = demo ? { user_id: 'user_demo', username: 'demo', display_name: '播客创作者', status: 'active', created_at: new Date().toISOString() } : existing!.user;
  save(); return response({ user: currentUser, expires_at: new Date(Date.now() + 86400000).toISOString(), csrf_token: 'mock-csrf-token' });
}
