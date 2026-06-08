import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { supabaseAdmin } from './client.server';

export type UserContext = {
  email: string;
  isAdmin: boolean;
};

// Middleware que lê o email autenticado pelo Godeploy edge (Google OAuth)
// O header é configurado via GODEPLOY_USER_HEADER no .env
export const requireEdgeAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error('Unauthorized: No request headers available');
    }

    const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-user-email';
    const email =
      request.headers.get(headerName) ??
      (process.env.NODE_ENV === 'development' ? process.env.DEV_USER_EMAIL ?? null : null);

    if (!email) {
      throw new Error('Unauthorized: Missing user email header from edge auth');
    }

    const { data } = await supabaseAdmin
      .from('admins')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    return next({
      context: {
        email,
        isAdmin: !!data,
      } satisfies UserContext,
    });
  }
);

// Middleware que exige que o usuário seja admin
export const requireAdmin = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error('Unauthorized: No request headers available');
    }

    const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-user-email';
    const email =
      request.headers.get(headerName) ??
      (process.env.NODE_ENV === 'development' ? process.env.DEV_USER_EMAIL ?? null : null);

    if (!email) {
      throw new Error('Unauthorized: Missing user email header from edge auth');
    }

    const { data } = await supabaseAdmin
      .from('admins')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (!data) {
      throw new Error('Forbidden: Admin access required');
    }

    return next({
      context: {
        email,
        isAdmin: true,
      } satisfies UserContext,
    });
  }
);
