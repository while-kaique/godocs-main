import { getAdminByEmail } from '@/integrations/db/client.server'

export type CurrentUser = {
  email: string
  isAdmin: boolean
}

export async function getCurrentUser(request: Request): Promise<CurrentUser | null> {
  const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-user-email'
  let email: string | null = request.headers.get(headerName) ?? null
  if (!email && process.env.NODE_ENV === 'development') {
    email = process.env.DEV_USER_EMAIL ?? null
  }
  if (!email) return null
  const admin = getAdminByEmail(email)
  return { email, isAdmin: !!admin }
}
