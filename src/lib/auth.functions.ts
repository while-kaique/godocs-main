import { getAdminByEmail } from '@/integrations/db/client.server'

export type CurrentUser = {
  email: string
  isAdmin: boolean
}

// Lista hardcoded de admins — checada em memória antes de ir ao banco.
// Admins adicionados dinamicamente (via CRUD) continuam funcionando pelo fallback ao DB.
const HARDCODED_ADMINS = new Set([
  'lucas.queiroz@gocase.com',
  'joao.gabriel@gocase.com',
  'joaovictor.esteves@gocase.com',
  'kaique.breno@gocase.com',
  'luciano.cavalcante@gocase.com',
  'luis.albuquerque@gocase.com',
])

export async function getCurrentUser(request: Request): Promise<CurrentUser | null> {
  const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-godeploy-user-email'
  let email: string | null = request.headers.get(headerName) ?? null
  console.log(`[auth.functions] headerName="${headerName}", email do header="${email}", NODE_ENV="${process.env.NODE_ENV}"`)
  if (!email && process.env.NODE_ENV === 'development') {
    email = process.env.DEV_USER_EMAIL ?? null
    console.log(`[auth.functions] Usando DEV_USER_EMAIL="${email}"`)
  }
  if (!email) {
    console.log('[auth.functions] Nenhum email encontrado → retornando null')
    return null
  }

  // Fast path: checa lista em memória (sem I/O)
  if (HARDCODED_ADMINS.has(email)) {
    console.log(`[auth.functions] email="${email}", admin hardcoded=true`)
    return { email, isAdmin: true }
  }

  // Fallback: admins dinâmicos cadastrados via CRUD
  const admin = await getAdminByEmail(email)
  console.log(`[auth.functions] email="${email}", admin no banco=${!!admin}`)
  return { email, isAdmin: !!admin }
}

/** Checa se um email é admin (fast path hardcoded + fallback DB). */
export async function isAdmin(email: string): Promise<boolean> {
  if (HARDCODED_ADMINS.has(email)) return true
  return !!(await getAdminByEmail(email))
}
