import { safeRedirect, useSessionQuery } from './session';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { setCsrfToken } from '@/api';
import { AppButton } from '@/components/common/AppButton';

function SessionLoading() { return <div role="status" className="flex min-h-screen items-center justify-center text-muted-foreground">正在检查登录状态…</div>; }
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSessionQuery(); const location = useLocation();
  if (session.isPending) return <SessionLoading />;
  if (session.isError) return <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4"><p>会话加载失败，请稍后重试。</p><AppButton onClick={() => session.refetch()}>重试</AppButton></div>;
  if (!session.data) return <Navigate replace to={`/login?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />;
  return children;
}
export function RequireGuest({ children }: { children: ReactNode }) {
  const session = useSessionQuery(); const location = useLocation();
  if (session.isPending) return <SessionLoading />;
  if (session.data) return <Navigate replace to={safeRedirect(new URLSearchParams(location.search).get('redirect'))} />;
  return children;
}
export function AuthSessionEvents() {
  const queryClient = useQueryClient(); const navigate = useNavigate();
  useEffect(() => {
    const expired = () => {
      setCsrfToken(null);
      void queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(['session'], null);
      if (!['/login', '/register', '/signup'].includes(window.location.pathname)) navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`, { replace: true });
    };
    window.addEventListener('auth:unauthenticated', expired);
    return () => window.removeEventListener('auth:unauthenticated', expired);
  }, [queryClient, navigate]);
  return null;
}
