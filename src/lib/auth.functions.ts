import { getAdminByEmail } from '@/integrations/db/client.server'

export type CurrentUser = {
  email: string
  isAdmin: boolean
}

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
  const admin = await getAdminByEmail(email)
  console.log(`[auth.functions] email="${email}", admin encontrado=${!!admin}`)
  return { email, isAdmin: !!admin }
}
