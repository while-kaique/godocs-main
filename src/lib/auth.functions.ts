import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

export type CurrentUser = {
  email: string;
  isAdmin: boolean;
};

export const getCurrentUserFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CurrentUser | null> => {
    const request = getRequest();
    const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-user-email';

    let email = request?.headers?.get(headerName) ?? null;

    // Fallback local de desenvolvimento
    if (!email && process.env.NODE_ENV === 'development') {
      email = process.env.DEV_USER_EMAIL ?? null;
    }

    if (!email) return null;

    const { data } = await supabaseAdmin
      .from('admins')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    return { email, isAdmin: !!data };
  }
);
