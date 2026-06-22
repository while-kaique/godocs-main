import { getAdminByEmail } from '@/integrations/db/client.server'

export type CurrentUser = {
  email: string
  isAdmin: boolean
}

// Fonte de admins (sem hardcode no código):
//  1. ADMIN_EMAILS — lista separada por vírgula na env (bootstrap canônico, gerenciável
//     no Godeploy sem redeploy; também é o salvo-vidas contra lockout se a tabela esvaziar).
//  2. tabela `admins` — admins adicionados dinamicamente via CRUD (painel admin).
// isAdmin() é a ÚNICA porta de verdade (env ∪ banco) e DEVE ser usada por TODOS os
// checks de admin do sistema — não checar `getAdminByEmail` direto (era a causa da
// inconsistência: alguns caminhos viam só o banco, outros a lista hardcoded).
function envAdmins(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Único ponto de verdade de admin: env ADMIN_EMAILS ∪ tabela `admins`. */
export async function isAdmin(email: string | null | undefined): Promise<boolean> {
  const alvo = (email ?? '').trim().toLowerCase()
  if (!alvo) return false
  if (envAdmins().has(alvo)) return true
  return !!(await getAdminByEmail((email ?? '').trim()))
}

export async function getCurrentUser(request: Request): Promise<CurrentUser | null> {
  const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-godeploy-user-email'
  let email: string | null = request.headers.get(headerName) ?? null
  if (!email && process.env.NODE_ENV === 'development') {
    email = process.env.DEV_USER_EMAIL ?? null
  }
  if (!email) return null
  return { email, isAdmin: await isAdmin(email) }
}
