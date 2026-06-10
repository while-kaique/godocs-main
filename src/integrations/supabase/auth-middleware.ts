// Helpers de autenticação para uso no worker (src/worker.ts).
// Sem dependência de TanStack Start.

import { supabaseAdmin } from './client.server'

export type UserContext = {
  email: string
  isAdmin: boolean
}

export function getEmailFromRequest(request: Request): string | null {
  const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-user-email'
  return (
    request.headers.get(headerName) ??
    (process.env.NODE_ENV !== 'production' ? (process.env.DEV_USER_EMAIL ?? null) : null)
  )
}

export async function requireAdminContext(request: Request): Promise<{ email: string }> {
  const email = getEmailFromRequest(request)
  if (!email) throw Object.assign(new Error('Não autorizado'), { status: 401 })
  const { data } = await supabaseAdmin
    .from('admins')
    .select('email')
    .eq('email', email)
    .maybeSingle()
  if (!data) throw Object.assign(new Error('Acesso negado. Apenas administradores.'), { status: 403 })
  return { email }
}
