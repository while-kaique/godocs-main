/**
 * Cloudflare Worker entry — SPA + API
 *
 * Todas as rotas /api/* são tratadas aqui.
 * O restante cai para os assets estáticos (a SPA React).
 */

import { getCurrentUser, isAdmin } from '@/lib/auth.functions'
import {
  iniciarSubmissao,
  enviarMensagem,
  iniciarSaving,
  iniciarReceita,
  atualizarTipos,
  atualizarMetadados,
  analisarProjetoFn,
  submeterParaValidacao,
  validarProjeto,
  resyncGoogle,
  reconciliarComplexidade,
  retroativoCustosPontuais,
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
  getUsuarios,
} from '@/lib/admin.functions'
import { getAreasPublicas, sincronizarAreas } from '@/lib/areas.functions'
import { getSugestoesParticipantes } from '@/lib/participantes.functions'
import { syncSheetsToSqlite } from '@/lib/google/sync-reverse'
import {
  getProjetosInvestigador,
  getProjetoInvestigadorDetalhes,
  getInvestigadorStats,
  getEdicoesInvestigador,
} from '@/lib/investigador.functions'
import { setDb, insertApiLog, getApiLogById, cleanupOldApiLogs, deleteProjetosTesteE2E, excluirProjetoCascade } from '@/integrations/db/client.server'
import { listarMeusProjetos, getMeuProjeto, getHistoricoMeuProjeto, contarPendentes, excluirRascunho, definirEditoresDelegados } from '@/lib/meus-projetos.functions'
import { assessDocsBackfill } from '@/lib/docs-backfill'
import {
  getPreviewDisparo,
  salvarTemplate,
  enviarEmailTeste,
  iniciarDisparo,
  processarChunkLote,
  getProgressoLote,
  cancelarDisparo,
  normalizarAudiencia,
} from '@/lib/email-legados.functions'
import { runBackground } from '@/lib/background'
import { criarChamadoAjuda } from '@/lib/ajuda.functions'
import { getGodocsEnv } from '@/lib/env'
import type { GoDeployDB } from '@/integrations/db/db-adapter'

// Env do Godeploy — inclui DB (SQLite embutido) e env vars como strings
interface Env {
  DB: GoDeployDB;
  [key: string]: unknown;
}

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
  if (!(await isAdmin(email))) throw Object.assign(new Error('Acesso negado. Apenas administradores.'), { status: 403 })
  return { email }
}

async function readBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>
}

// ── roteador ─────────────────────────────────────────────────────────────────

// Contexto mínimo do Worker — só precisamos de waitUntil para rodar a análise
// automática em background (sobrevive ao fechamento da aba pelo usuário).
interface ExecCtx { waitUntil(promise: Promise<unknown>): void }

// Dispara a análise do projeto sem propagar erros (background, best-effort).
function analisarEmBackground(projetoId: string): Promise<unknown> {
  return analisarProjetoFn({ projeto_id: projetoId }).catch((e) =>
    console.error('[worker] análise automática em background falhou:', e),
  )
}

async function handleApi(request: Request, url: URL, ctx?: ExecCtx): Promise<Response> {
  const { pathname } = url
  const method = request.method

  try {
    // ── Auth ──
    if (pathname === '/api/auth/me' && method === 'GET') {
      console.log('[worker] /api/auth/me chamado')
      const user = await getCurrentUser(request)
      console.log('[worker] /api/auth/me resultado:', JSON.stringify(user))
      return json(user)
    }

    // ── Config pública (rótulo do ambiente) — usado pela faixa de staging ──
    // Só expõe `env` (production/staging); nunca secrets. O bundle do SPA é
    // idêntico nos dois apps, então o cliente descobre o ambiente por aqui.
    if (pathname === '/api/config' && method === 'GET') {
      return json({ env: getGodocsEnv() })
    }

    // ── Áreas (público — usado pelo seletor da etapa 1) ──
    if (pathname === '/api/areas' && method === 'GET') {
      return json(await getAreasPublicas())
    }

    // ── Sugestões de participantes (autocomplete da etapa 1; lista da TeamGuide) ──
    if (pathname === '/api/participantes/sugestoes' && method === 'GET') {
      return json(await getSugestoesParticipantes())
    }

    // ── Cron: sincroniza áreas da TeamGuide (chamado pela plataforma Godeploy) ──
    // O gateway carimba o header X-Godeploy-Cron; exigimos sua presença para que
    // a rota não seja disparável externamente.
    if (pathname === '/api/cron/sync-areas' && method === 'POST') {
      if (!request.headers.get('x-godeploy-cron')) {
        return errorJson('Rota exclusiva de cron.', 403)
      }
      // Limpa logs de API com mais de 30 dias (em segundo plano, via waitUntil)
      runBackground(cleanupOldApiLogs(30))
      return json(await sincronizarAreas())
    }

    // ── Cron: sync reverso Sheets → SQLite (planilha = fonte de verdade) ──
    // Importa legados que só existem na planilha e reflete edições manuais nos
    // campos seguros. Agendado de hora em hora pela plataforma Godeploy.
    if (pathname === '/api/cron/sync-sheets-to-sqlite' && method === 'POST') {
      if (!request.headers.get('x-godeploy-cron')) {
        return errorJson('Rota exclusiva de cron.', 403)
      }
      return json(await syncSheetsToSqlite())
    }

    // ── Cron: reconcilia a coluna "Complexidade" da planilha ──
    // A análise roda em background (waitUntil) e às vezes é cancelada antes de
    // gravar a Complexidade no Sheets. Este cron repõe o que faltou (resync) ou
    // re-roda o analisador para os que nunca foram analisados. Idempotente.
    if (pathname === '/api/cron/reanalisar-pendentes' && method === 'POST') {
      if (!request.headers.get('x-godeploy-cron')) {
        return errorJson('Rota exclusiva de cron.', 403)
      }
      return json(await reconciliarComplexidade())
    }

    // ── Meus Projetos (filtrado pelo email do header — anti-IDOR) ──
    if (pathname === '/api/meus-projetos' && method === 'GET') {
      const email = getEmailFromRequest(request)
      if (!email) return errorJson('Não autorizado.', 401)
      return json(await listarMeusProjetos(email))
    }
    // Contagem de pendentes (legados sem "Atualizado Em") — selo da home. ANTES do
    // GET genérico abaixo, senão "pendentes" seria tratado como id de projeto.
    if (pathname === '/api/meus-projetos/pendentes' && method === 'GET') {
      const email = getEmailFromRequest(request)
      if (!email) return errorJson('Não autorizado.', 401)
      const sync = url.searchParams.get('sync') === '1'
      return json(await contarPendentes(email, { sync }))
    }
    // Excluir um RASCUNHO (ownership + só status 'rascunho').
    if (pathname.startsWith('/api/meus-projetos/') && method === 'DELETE') {
      const email = getEmailFromRequest(request)
      if (!email) return errorJson('Não autorizado.', 401)
      const id = pathname.replace('/api/meus-projetos/', '').split('/')[0]
      return json(await excluirRascunho(email, id))
    }
    // Distribuir o poder de edição: define os editores delegados (participantes que
    // podem editar/reenviar como o dono). Gate de ownership/cascata na função.
    // ANTES do GET genérico abaixo (mas é POST, então sem colisão real de método).
    if (pathname.startsWith('/api/meus-projetos/') && pathname.endsWith('/editores') && method === 'POST') {
      const email = getEmailFromRequest(request)
      if (!email) return errorJson('Não autorizado.', 401)
      const id = pathname.replace('/api/meus-projetos/', '').split('/')[0]
      const body = await readBody<{ editores?: unknown }>(request)
      return json(await definirEditoresDelegados(email, id, body?.editores))
    }
    if (pathname.startsWith('/api/meus-projetos/') && method === 'GET') {
      const email = getEmailFromRequest(request)
      if (!email) return errorJson('Não autorizado.', 401)
      const id = pathname.replace('/api/meus-projetos/', '').split('/')[0]
      return json(await getMeuProjeto(id, email))
    }
    // Histórico de chat de um rascunho — usado na retomada cross-device.
    if (pathname.startsWith('/api/chat/historico/') && method === 'GET') {
      const email = getEmailFromRequest(request)
      if (!email) return errorJson('Não autorizado.', 401)
      const id = pathname.replace('/api/chat/historico/', '').split('/')[0]
      return json(await getHistoricoMeuProjeto(id, email))
    }

    // ── Widget de Ajuda & Suporte (autenticado, NÃO admin) ──
    // Fora do prefixo /api/chat/ de propósito: é um caminho dedicado que NÃO passa
    // pelo dispatcher de chat nem grava api_logs. Qualquer usuário logado pode pedir
    // ajuda. Erros de validação do schema sobem como 400 (ver criarChamadoAjuda).
    if (pathname === '/api/ajuda' && method === 'POST') {
      const email = getEmailFromRequest(request)
      if (!email) return errorJson('Não autorizado.', 401)
      const body = await readBody(request)
      return json(await criarChamadoAjuda(email, body))
    }

    // ── Chat (público — qualquer usuário pode submeter) ──
    // Todas as rotas /api/chat/* são logadas na tabela api_logs para o Investigador.
    if (pathname.startsWith('/api/chat/') && method === 'POST') {
      const body = await readBody<Record<string, unknown>>(request)
      const reqJson = JSON.stringify(body)
      const requestSize = reqJson.length
      const projetoId = (body.projeto_id as string) ?? null
      const start = Date.now()
      let statusCode = 200
      let errorMsg: string | null = null
      let responseSize = 0
      try {
        let result: unknown
        if (pathname === '/api/chat/iniciar-submissao') result = await iniciarSubmissao(body)
        else if (pathname === '/api/chat/enviar-mensagem') result = await enviarMensagem(body)
        else if (pathname === '/api/chat/iniciar-saving') result = await iniciarSaving(body)
        else if (pathname === '/api/chat/iniciar-receita') result = await iniciarReceita(body)
        else if (pathname === '/api/chat/atualizar-tipos') result = await atualizarTipos(body)
        else if (pathname === '/api/chat/atualizar-metadados') result = await atualizarMetadados(body)
        else if (pathname === '/api/chat/analisar') result = await analisarProjetoFn(body)
        else if (pathname === '/api/chat/submeter-validacao') result = await submeterParaValidacao(body, getEmailFromRequest(request))
        else return errorJson('Rota não encontrada', 404)

        // Análise automática (analisador) roda no SERVIDOR, em background, logo após
        // a submissão. Roda também para ESPECIAIS — neles o analisador NÃO decide
        // status (validação é humana), mas agrega complexidade + parecer (incl. o
        // veredito "é mesmo especial?"). Antes a tela de sucesso esperava a análise
        // (gerava ansiedade); agora a pessoa vê "Projeto Enviado!" e o resultado
        // aparece depois em "Meus Projetos". O waitUntil mantém o Worker vivo até
        // concluir mesmo sem o cliente conectado.
        if (pathname === '/api/chat/submeter-validacao') {
          const pid = (body.projeto_id as string) ?? null
          if (pid) {
            const p = analisarEmBackground(pid)
            if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p)
          }
        }

        const resJson = JSON.stringify(result)
        responseSize = resJson.length
        // Para iniciar-submissao, o projeto_id vem no resultado (ainda não existia no body)
        const logProjetoId = projetoId ?? (result as { projeto_id?: string })?.projeto_id ?? null
        await insertApiLog({
          projeto_id: logProjetoId,
          endpoint: pathname,
          method,
          duration_ms: Date.now() - start,
          status_code: statusCode,
          request_size: requestSize,
          response_size: responseSize,
          request_body: reqJson,
          response_body: resJson,
        }).catch(() => {})
        return new Response(resJson, { status: 200, headers: { 'Content-Type': 'application/json' } })
      } catch (e) {
        const err = e as Error & { status?: number }
        statusCode = err.status ?? 500
        errorMsg = err.message
        await insertApiLog({
          projeto_id: projetoId,
          endpoint: pathname,
          method,
          duration_ms: Date.now() - start,
          status_code: statusCode,
          error: errorMsg,
          request_size: requestSize,
          response_size: 0,
          request_body: reqJson,
          response_body: null,
        }).catch(() => {})
        return errorJson(err.message, statusCode)
      }
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
    if (pathname === '/api/admin/areas/sync' && method === 'POST') {
      await requireAdmin(request)
      return json(await sincronizarAreas())
    }
    if (pathname === '/api/admin/areas' && method === 'POST') {
      const { email } = await requireAdmin(request)
      const body = await readBody<{ nome: string }>(request)
      return json(await createArea(body.nome, email))
    }
    if (pathname === '/api/admin/areas/remove' && method === 'POST') {
      const { email } = await requireAdmin(request)
      const body = await readBody<{ id: string }>(request)
      return json(await deleteArea(body.id, email))
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

    if (pathname === '/api/admin/usuarios' && method === 'GET') {
      await requireAdmin(request)
      return json(await getUsuarios())
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

    // ── Investigador (requer admin) ──
    if (pathname === '/api/admin/investigador/projetos' && method === 'GET') {
      await requireAdmin(request)
      return json(await getProjetosInvestigador())
    }
    if (pathname === '/api/admin/investigador/stats' && method === 'GET') {
      await requireAdmin(request)
      return json(await getInvestigadorStats())
    }
    if (pathname === '/api/admin/investigador/edicoes' && method === 'GET') {
      await requireAdmin(request)
      return json(await getEdicoesInvestigador())
    }

    // ── Backfill de docs ao Drive: AVALIAÇÃO (read-only) ──
    // Conta quantos documentos de projetos recentes (não-legado) são recuperáveis
    // do api_logs (recuperável × parcial × perdido) antes de executar o backfill.
    if (pathname === '/api/admin/docs-backfill/assess' && method === 'GET') {
      await requireAdmin(request)
      return json(await assessDocsBackfill())
    }
    if (pathname.startsWith('/api/admin/investigador/projetos/') && method === 'GET') {
      await requireAdmin(request)
      const id = pathname.split('/').pop()!
      return json(await getProjetoInvestigadorDetalhes(id))
    }
    // Corpo de um log de API específico (carregado sob demanda)
    if (pathname.startsWith('/api/admin/investigador/log/') && method === 'GET') {
      await requireAdmin(request)
      const logId = pathname.split('/').pop()!
      const log = await getApiLogById(logId)
      if (!log) return errorJson('Log não encontrado', 404)
      return json({
        id: log.id,
        request_body: log.request_body,
        response_body: log.response_body,
      })
    }

    // ── Re-sync Google (TEMPORÁRIO, admin) ──
    // Re-dispara o sync Sheets+Chat de um projeto já submetido, SEM reanálise de
    // IA. GET para facilitar o disparo pelo navegador logado. REMOVER depois.
    if (pathname === '/api/admin/resync-google' && method === 'GET') {
      await requireAdmin(request)
      const projetoId = url.searchParams.get('projeto_id')
      if (!projetoId) return errorJson('Informe ?projeto_id=...', 400)
      return json(await resyncGoogle({ projeto_id: projetoId }))
    }

    // ── Retroativo: custo evitado/projeto PONTUAL sem ÷12 (admin) ──
    // Recomputa projetos submetidos ANTES da remoção do ÷12 (SPEC_CORRECOES 01/07/2026):
    // custo evitado/projeto pontual passa a entrar pelo valor CHEIO. Body { dry?: boolean }
    // — dry (DEFAULT true) só relata o que mudaria; { "dry": false } aplica (SQLite +
    // colunas afetadas do Sheets, SEM notificar o Chat). Idempotente (só toca quem tem
    // item pontual e cujo valor de fato muda).
    if (pathname === '/api/admin/retroativo-custos-pontuais' && method === 'POST') {
      await requireAdmin(request)
      const body = await readBody<{ dry?: boolean }>(request)
      return json(await retroativoCustosPontuais(body))
    }

    // ── Sync reverso manual (admin) ──
    // Dispara o sync Sheets → SQLite sob demanda (mesmo trabalho do cron), útil
    // para validar antes de confiar no agendamento horário.
    if (pathname === '/api/admin/sync-sheets-now' && method === 'POST') {
      await requireAdmin(request)
      return json(await syncSheetsToSqlite())
    }

    // ── Disparo de e-mails por segmento (admin) ──
    // Segmentos: 'legado' (legados pendentes, SQLite) · 'reenvio' (Status "Reenvio Pendente"
    // no Sheets, com motivo) · 'todos' (broadcast a qualquer dono no Sheets). Cada segmento
    // tem sua lista de destinatários e seu template. Prefixo /email-legados mantido (legado).
    // Preview: destinatários do segmento (dedup por e-mail), contagem e template.
    if (pathname === '/api/admin/email-legados/preview' && method === 'GET') {
      await requireAdmin(request)
      const audiencia = normalizarAudiencia(url.searchParams.get('audiencia'))
      return json(await getPreviewDisparo(audiencia))
    }
    // Salva o texto editável (assunto + corpo) do e-mail do segmento.
    if (pathname === '/api/admin/email-legados/template' && method === 'POST') {
      const { email: adminEmail } = await requireAdmin(request)
      const body = await readBody<{ audiencia?: string; assunto: string; corpo: string }>(request)
      await salvarTemplate(normalizarAudiencia(body.audiencia), { assunto: body.assunto, corpo: body.corpo }, adminEmail)
      return json({ ok: true })
    }
    // Envia um e-mail de teste só para o próprio admin (com dados de exemplo do segmento).
    if (pathname === '/api/admin/email-legados/teste' && method === 'POST') {
      const { email: adminEmail } = await requireAdmin(request)
      const body = await readBody<{ audiencia?: string }>(request)
      await enviarEmailTeste(adminEmail, normalizarAudiencia(body.audiencia))
      return json({ ok: true })
    }
    // Dispara o lote do segmento: salva o template (se enviado), cria o lote congelando o
    // payload (destinatários + template) e retorna { loteId, total }. O front chama
    // .../chunk/:loteId em sequência até concluir (o runtime mata tarefas longas).
    if (pathname === '/api/admin/email-legados/enviar' && method === 'POST') {
      const { email: adminEmail } = await requireAdmin(request)
      const body = await readBody<{ audiencia?: string; assunto?: string; corpo?: string; emails?: string[] }>(request)
      const audiencia = normalizarAudiencia(body.audiencia)
      if (body.assunto && body.corpo) {
        await salvarTemplate(audiencia, { assunto: body.assunto, corpo: body.corpo }, adminEmail)
      }
      const emails = Array.isArray(body.emails) ? body.emails : undefined
      const { loteId, total } = await iniciarDisparo(adminEmail, audiencia, emails)
      return json({ ok: true, loteId, total })
    }
    // Processa o próximo lote de e-mails (chunk) e devolve o progresso atualizado.
    if (pathname.startsWith('/api/admin/email-legados/chunk/') && method === 'POST') {
      const { email: adminEmail } = await requireAdmin(request)
      const loteId = pathname.split('/').pop()!
      const progresso = await processarChunkLote(adminEmail, loteId)
      if (!progresso) return errorJson('Lote não encontrado', 404)
      return json(progresso)
    }
    // Progresso de um lote de disparo (polling/retomada do front).
    if (pathname.startsWith('/api/admin/email-legados/progresso/') && method === 'GET') {
      await requireAdmin(request)
      const loteId = pathname.split('/').pop()!
      const progresso = await getProgressoLote(loteId)
      if (!progresso) return errorJson('Lote não encontrado', 404)
      return json(progresso)
    }
    // Cancela um lote em andamento (o loop para no próximo e-mail).
    if (pathname.startsWith('/api/admin/email-legados/cancelar/') && method === 'POST') {
      await requireAdmin(request)
      const loteId = pathname.split('/').pop()!
      await cancelarDisparo(loteId)
      return json({ ok: true })
    }

    // ── Limpeza de projetos de TESTE E2E (admin) ──
    // Remove do SQLite todos os projetos com nome "[E2E-..." (cascata limpa o resto).
    // Usado pelo harness de validação (scripts/e2e/cleanup.mjs) DEPOIS de remover as
    // linhas da planilha — ordem importa: se o SQLite for limpo antes, o sync reverso
    // por dono (listarMeusProjetos) ressuscita do Sheets. Remover com o harness.
    if (pathname === '/api/admin/e2e-cleanup' && method === 'POST') {
      await requireAdmin(request)
      const ids = await deleteProjetosTesteE2E()
      return json({ ok: true, deletados: ids.length, ids })
    }

    // Exclui um projeto por id (cascade) — admin. Usado para remover órfãos do SQLite
    // que não existem no Sheets (fonte da verdade), evitando que apareçam sem status
    // em "Meus Projetos". NÃO recria: o sync só cria a partir de linhas da planilha.
    if (pathname === '/api/admin/excluir-projeto' && method === 'POST') {
      await requireAdmin(request)
      const body = await readBody<{ id?: string }>(request)
      const id = (body.id ?? '').trim()
      if (!id) return errorJson('id obrigatório', 400)
      await excluirProjetoCascade(id)
      return json({ ok: true, id })
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
  async fetch(request: Request, env: Env, ctx?: ExecCtx): Promise<Response> {
    // O godeploy não expõe o global `process` (não há nodejs_compat). Garantimos
    // `process.env` e injetamos as env vars do worker, para os módulos que leem
    // via process.env (supabase, llm, brevo, ocr, etc.). Sem isto, qualquer
    // process.env.X em runtime estoura "process is not defined".
    const g = globalThis as unknown as {
      process?: { env: Record<string, string> }
      __waitUntil?: (p: Promise<unknown>) => void
    }
    if (!g.process) g.process = { env: {} }
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') g.process.env[k] = v
    }

    // Expõe o waitUntil do runtime para o trabalho fire-and-forget (sync Google,
    // limpeza de logs). Sem isto, promises não-aguardadas são canceladas quando a
    // Response retorna — e o sync para Sheets/Chat morre no meio. Ver lib/background.ts.
    if (ctx && typeof ctx.waitUntil === 'function') {
      g.__waitUntil = (p: Promise<unknown>) => ctx.waitUntil(p)
    }

    // Injeta o banco SQLite do Godeploy (env.DB) no client.
    // setDb é async (roda initSchema na primeira chamada) — aguardamos antes de
    // rotear qualquer request para garantir que as tabelas existam.
    if (env.DB) {
      await setDb(env.DB)
    }

    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, url, ctx)
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
