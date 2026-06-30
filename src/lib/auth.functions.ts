import { getAdminByEmail } from '@/integrations/db/client.server'

export type CurrentUser = {
  email: string
  name: string
  isAdmin: boolean
}

/**
 * Deriva um nome legível a partir do local-part do e-mail, como fallback quando
 * o gateway Godeploy não injeta um header de nome. Ex.: "kaique.breno@gocase.com"
 * → "Kaique Breno". Versão pura/síncrona do conceito de `derivarNome` em
 * `ajuda.functions.ts` (que consulta o banco) — aqui é só para o /api/auth/me.
 */
export function derivarNomeDeEmail(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0] ?? ''
  const nome = local
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
  return nome || (email ?? '')
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

  // Nome da conta logada: o gateway Godeploy pode injetar um header de nome
  // (configurável via GODEPLOY_NAME_HEADER). Se ausente/vazio, derivamos do
  // e-mail. process.env só lido aqui (lazy) — nunca em escopo de módulo.
  const nameHeader = process.env.GODEPLOY_NAME_HEADER ?? 'x-godeploy-user-name'
  const nameFromHeader = request.headers.get(nameHeader)?.trim()
  const name = nameFromHeader || derivarNomeDeEmail(email)

  return { email, name, isAdmin: await isAdmin(email) }
}
