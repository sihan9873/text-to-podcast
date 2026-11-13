import { useQuery } from '@tanstack/react-query';
import { authApi, ApiError, setCsrfToken, type SessionResponse } from '@/api';
export function safeRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || (value.includes(String.fromCharCode(92)) || [...value].some(char => char.charCodeAt(0) < 32))) return '/projects';
  const pathname = value.split(/[?#]/)[0].replace(/\/+$/, '');
  return ['/login', '/register', '/signup'].includes(pathname) ? '/projects' : value;
}
export function useSessionQuery() {
  return useQuery<SessionResponse | null>({ queryKey: ['session'], queryFn: async () => {
    try { return await authApi.me(); }
    catch (error) { if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') { setCsrfToken(null); return null; } throw error; }
  }, staleTime: 5 * 60 * 1000, retry: false });
}
