/**
 * Cloudflare Worker entry — SPA + API
 *
 * Todas as rotas /api/* são tratadas aqui.
 * O restante cai para os assets estáticos (a SPA React).
 */

import { getCurrentUser } from '@/lib/auth.functions'
import {
  iniciarSubmissao,
  enviarMensagem,
  iniciarSaving,
  iniciarReceita,
  submeterParaValidacao,
  validarProjeto,
} from '@/lib/chat.functions'
import {
  getAreas,
  createArea,
  deleteArea,
  getAdmins,
  addAdmin,
  removeAdmin,
  getProjetos,
  getProjetoDetalhes,
  createUser,
  deleteUser,
  updateUserAreas,
  getConfiguracoes,
  updateConfiguracao,
} from '@/lib/admin.functions'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

// No godeploy não há bindings nativos além das env vars (Record<string,string>).
interface Env {}

// ── helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorJson(message: string, status = 400): Response {
  return json({ error: message }, status)
}

function getEmailFromRequest(request: Request): string | null {
  const headerName = process.env.GODEPLOY_USER_HEADER ?? 'x-godeploy-user-email'
  return (
    request.headers.get(headerName) ??
    (process.env.NODE_ENV !== 'production' ? (process.env.DEV_USER_EMAIL ?? null) : null)
  )
}

async function requireAdmin(request: Request): Promise<{ email: string }> {
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

async function readBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>
}

// ── roteador ─────────────────────────────────────────────────────────────────

async function handleApi(request: Request, url: URL): Promise<Response> {
  const { pathname } = url
  const method = request.method

  try {
    // ── Auth ──
    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = await getCurrentUser(request)
      return json(user)
    }

    // ── Chat (público — qualquer usuário pode submeter) ──
    if (pathname === '/api/chat/iniciar-submissao' && method === 'POST') {
      const body = await readBody(request)
      const result = await iniciarSubmissao(body)
      return json(result)
    }
    if (pathname === '/api/chat/enviar-mensagem' && method === 'POST') {
      const body = await readBody(request)
      const result = await enviarMensagem(body)
      return json(result)
    }
    if (pathname === '/api/chat/iniciar-saving' && method === 'POST') {
      const body = await readBody(request)
      const result = await iniciarSaving(body)
      return json(result)
    }
    if (pathname === '/api/chat/iniciar-receita' && method === 'POST') {
      const body = await readBody(request)
      const result = await iniciarReceita(body)
      return json(result)
    }
    if (pathname === '/api/chat/submeter-validacao' && method === 'POST') {
      const body = await readBody(request)
      const result = await submeterParaValidacao(body)
      return json(result)
    }

    // ── Admin (requer admin) ──
    if (pathname === '/api/admin/validar-projeto' && method === 'POST') {
      await requireAdmin(request)
      const body = await readBody(request)
      const result = await validarProjeto(body)
      return json(result)
    }

    if (pathname === '/api/admin/areas' && method === 'GET') {
      await requireAdmin(request)
      return json(await getAreas())
    }
    if (pathname === '/api/admin/areas' && method === 'POST') {
      const { email } = await requireAdmin(request)
      const body = await readBody<{ nome: string }>(request)
      return json(await createArea(body.nome, email))
    }
    if (pathname.startsWith('/api/admin/areas/') && method === 'DELETE') {
      const { email } = await requireAdmin(request)
      const id = pathname.split('/').pop()!
      return json(await deleteArea(id, email))
    }

    if (pathname === '/api/admin/admins' && method === 'GET') {
      await requireAdmin(request)
      return json(await getAdmins())
    }
    if (pathname === '/api/admin/admins' && method === 'POST') {
      await requireAdmin(request)
      const body = await readBody<{ email: string; nome?: string }>(request)
      return json(await addAdmin(body))
    }
    if (pathname === '/api/admin/admins/remove' && method === 'POST') {
      const { email: adminEmail } = await requireAdmin(request)
      const body = await readBody<{ id: string }>(request)
      return json(await removeAdmin(body.id, adminEmail))
    }

    if (pathname === '/api/admin/projetos' && method === 'GET') {
      await requireAdmin(request)
      return json(await getProjetos())
    }
    if (pathname.startsWith('/api/admin/projetos/') && method === 'GET') {
      await requireAdmin(request)
      const id = pathname.split('/').pop()!
      return json(await getProjetoDetalhes(id))
    }

    if (pathname === '/api/admin/users' && method === 'POST') {
      await requireAdmin(request)
      const body = await readBody(request)
      return json(await createUser(body))
    }
    if (pathname === '/api/admin/users/delete' && method === 'POST') {
      const { email: adminEmail } = await requireAdmin(request)
      const body = await readBody<{ userId: string }>(request)
      return json(await deleteUser(body.userId, adminEmail))
    }
    if (pathname === '/api/admin/users/update-areas' && method === 'POST') {
      await requireAdmin(request)
      const body = await readBody(request)
      return json(await updateUserAreas(body))
    }

    if (pathname === '/api/admin/configuracoes' && method === 'GET') {
      await requireAdmin(request)
      return json(await getConfiguracoes())
    }
    if (pathname === '/api/admin/configuracoes' && method === 'POST') {
      const { email: adminEmail } = await requireAdmin(request)
      const body = await readBody<{ chave: string; valor: unknown }>(request)
      return json(await updateConfiguracao(body.chave, body.valor, adminEmail))
    }

    return errorJson('Rota não encontrada', 404)
  } catch (e) {
    const err = e as Error & { status?: number }
    const status = err.status ?? 500
    console.error(`[worker] ${method} ${pathname}:`, err.message)
    return errorJson(err.message, status)
  }
}

// ── entry point ───────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env & Record<string, string>): Promise<Response> {
    // Injeta as variáveis de ambiente do Cloudflare no process.env para compatibilidade
    // com supabase-js e outros módulos que leem process.env
    if (typeof process !== 'undefined') {
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === 'string') process.env[k] = v
      }
    }

    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, url)
    }

    // No godeploy os assets estáticos são servidos pela própria plataforma:
    // requests de navegação que não casam com um asset caem no fallback SPA
    // (assetConfig.not_found_handling = "single-page-application") e nunca
    // chegam aqui. O worker só é invocado para /api/* e para requests de
    // recurso sem asset correspondente (ex.: /favicon.ico) — devolvemos 404.
    // (Não existe binding env.ASSETS no godeploy.)
    return new Response('Not Found', { status: 404 })
  },
}
