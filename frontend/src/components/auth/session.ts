import { useQuery } from '@tanstack/react-query';
import { authApi, ApiError, setCsrfToken, type SessionResponse } from '@/api';
export function safeRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || (value.includes(String.fromCharCode(92)) || [...value].some(char => char.charCodeAt(0) < 32))) return '/projects';
  const pathname = value.split(/[?#]/)[0].replace(/\/+$/, '');
  return ['/login', '/register', '/signup'].includes(pathname) ? '/projects' : value;
}
export async function loadSession(): Promise<SessionResponse | null> {
  try {
    return await authApi.me();
  } catch (error) {
    // Both real AUTH_REQUIRED and mock UNAUTHENTICATED mean signed out.
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function useSessionQuery() {
  return useQuery<SessionResponse | null>({ queryKey: ['session'], queryFn: loadSession,
    staleTime: 5 * 60 * 1000, retry: false });
}
