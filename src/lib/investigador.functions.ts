/**
 * Funções de negócio do Investigador — painel admin para monitorar
 * projetos em preenchimento e já submetidos, com logs de API e métricas.
 */

import {
  getProjetosWithArea,
  getChatMessages,
  getDocumentacao,
  getApiLogsByProjeto,
  getApiLogsRecent,
  getLatestAnalise,
  parseJson,
  type ProjetoRow,
  type ChatMessageRow,
  type ApiLogRow,
} from '@/integrations/db/client.server'

// ── Tipos ────────────────────────────────────────────────────────────────────

type FaseAtual =
  | 'aguardando_inicio'
  | 'doc'
  | 'doc_preview'
  | 'saving'
  | 'saving_preview'
  | 'receita'
  | 'receita_preview'
  | 'completo'

export type ProjetoInvestigador = {
  id: string
  nome: string | null
  responsavel_nome: string
  responsavel_email: string
  area_nome: string | null
  ferramenta: string
  escopo: string | null
  status: string | null
  tipos_projeto: string[] | null
  descricao_breve: string | null
  complexidade: string | null
  fase_atual: FaseAtual
  total_mensagens: number
  total_mensagens_usuario: number
  total_mensagens_ia: number
  tempo_desde_inicio_min: number | null
  ultima_atividade: string | null
  tem_erro: boolean
  total_erros_api: number
  media_duracao_api_ms: number | null
  max_duracao_api_ms: number | null
  ultimo_log_api: string | null
  chat_completo: boolean
  created_at: string | null
  updated_at: string | null
  submitted_at: string | null
}

export type ProjetoInvestigadorDetalhes = ProjetoInvestigador & {
  step1: {
    escopo: string | null
    ferramenta: string
    area_nome: string | null
    membros: string[]
    servico_externo: string | null
  }
  step2: {
    nome: string | null
    tipos_projeto: string[] | null
    data_criacao_projeto: string | null
    descricao_breve: string | null
  }
  chat_messages: Array<{
    id: string
    role: string
    content: string
    options: unknown
    selected_option: number | null
    created_at: string | null
    parsed_fase?: string | null
    parsed_type?: string | null
  }>
  documentacao: unknown | null
  analise: {
    resultado: string
    pontuacao_total: number
    pontuacao_maxima: number
    resumo: string | null
    complexidade: string | null
  } | null
  api_logs: ApiLogRow[]
}

// ── Helpers internos ─────────────────────────────────────────────────────────

function inferFaseAtual(messages: ChatMessageRow[]): FaseAtual {
  // Percorre as mensagens de trás para frente buscando a última fase reportada
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    try {
      const parsed = JSON.parse(msg.content) as { fase?: string; type?: string }
      if (parsed.fase) return parsed.fase as FaseAtual
    } catch {
      // conteúdo não-JSON — ignora
    }
  }
  // Se tem mensagens mas nenhuma fase detectada
  if (messages.length > 0) return 'doc'
  return 'aguardando_inicio'
}

function computeTimeSinceStart(createdAt: string | null): number | null {
  if (!createdAt) return null
  const start = new Date(createdAt + 'Z').getTime()
  if (isNaN(start)) return null
  return Math.round((Date.now() - start) / 60_000) // minutos
}

function getUltimaAtividade(messages: ChatMessageRow[], updatedAt: string | null): string | null {
  if (messages.length > 0) {
    const last = messages[messages.length - 1].created_at
    if (last) return last
  }
  return updatedAt
}

/** Retorna o created_at do log de API mais recente (logs já vêm DESC). */
function getUltimoLogApi(logs: ApiLogRow[]): string | null {
  return logs.length > 0 ? logs[0].created_at : null
}

// ── Funções exportadas ───────────────────────────────────────────────────────

/**
 * Lista enriquecida de todos os projetos para o painel Investigador.
 * Inclui fase atual, métricas de chat, métricas de API.
 */
export async function getProjetosInvestigador() {
  const projetos = await getProjetosWithArea()
  const recentLogs = await getApiLogsRecent(5000)

  // Agrupa logs por projeto_id para evitar N+1
  const logsByProjeto = new Map<string, ApiLogRow[]>()
  for (const log of recentLogs) {
    if (!log.projeto_id) continue
    const arr = logsByProjeto.get(log.projeto_id) ?? []
    arr.push(log)
    logsByProjeto.set(log.projeto_id, arr)
  }

  const result: ProjetoInvestigador[] = []

  for (const p of projetos) {
    const messages = await getChatMessages(p.id)
    const logs = logsByProjeto.get(p.id) ?? []

    const faseAtual = inferFaseAtual(messages)
    const totalMsgsUser = messages.filter((m) => m.role === 'user').length
    const totalMsgsIA = messages.filter((m) => m.role === 'assistant').length

    const errosApi = logs.filter((l) => l.status_code >= 400)
    const duracoes = logs.filter((l) => l.duration_ms != null).map((l) => l.duration_ms!)
    const mediaDuracao = duracoes.length > 0 ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : null
    const maxDuracao = duracoes.length > 0 ? Math.max(...duracoes) : null

    result.push({
      id: p.id,
      nome: p.nome,
      responsavel_nome: p.responsavel_nome,
      responsavel_email: p.responsavel_email,
      area_nome: p.area_nome ?? p.area,
      ferramenta: p.ferramenta,
      escopo: p.escopo,
      status: p.status,
      tipos_projeto: parseJson<string[]>(p.tipos_projeto),
      descricao_breve: p.descricao_breve,
      complexidade: (p as ProjetoRow & { complexidade?: string }).complexidade ?? null,
      fase_atual: faseAtual,
      total_mensagens: messages.length,
      total_mensagens_usuario: totalMsgsUser,
      total_mensagens_ia: totalMsgsIA,
      tempo_desde_inicio_min: computeTimeSinceStart(p.created_at),
      ultima_atividade: getUltimaAtividade(messages, p.updated_at),
      tem_erro: errosApi.length > 0,
      total_erros_api: errosApi.length,
      media_duracao_api_ms: mediaDuracao,
      max_duracao_api_ms: maxDuracao,
      ultimo_log_api: getUltimoLogApi(logs),
      chat_completo: !!(p.chat_completo),
      created_at: p.created_at,
      updated_at: p.updated_at,
      submitted_at: p.submitted_at,
    })
  }

  return result
}

/**
 * Detalhes completos de um projeto para o painel de investigação.
 */
export async function getProjetoInvestigadorDetalhes(id: string) {
  const projetos = await getProjetosWithArea()
  const p = projetos.find((proj) => proj.id === id)
  if (!p) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 })

  const messages = await getChatMessages(id)
  const doc = await getDocumentacao(id)
  const analise = await getLatestAnalise(id)
  const logs = await getApiLogsByProjeto(id)

  const faseAtual = inferFaseAtual(messages)
  const totalMsgsUser = messages.filter((m) => m.role === 'user').length
  const totalMsgsIA = messages.filter((m) => m.role === 'assistant').length
  const errosApi = logs.filter((l) => l.status_code >= 400)
  const duracoes = logs.filter((l) => l.duration_ms != null).map((l) => l.duration_ms!)
  const mediaDuracao = duracoes.length > 0 ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : null
  const maxDuracao = duracoes.length > 0 ? Math.max(...duracoes) : null

  const enrichedMessages = messages.map((m) => {
    let parsedFase: string | null = null
    let parsedType: string | null = null
    if (m.role === 'assistant') {
      try {
        const parsed = JSON.parse(m.content) as { fase?: string; type?: string }
        parsedFase = parsed.fase ?? null
        parsedType = parsed.type ?? null
      } catch {
        // não-JSON
      }
    }
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      options: parseJson(m.options),
      selected_option: m.selected_option,
      created_at: m.created_at,
      parsed_fase: parsedFase,
      parsed_type: parsedType,
    }
  })

  const result: ProjetoInvestigadorDetalhes = {
    id: p.id,
    nome: p.nome,
    responsavel_nome: p.responsavel_nome,
    responsavel_email: p.responsavel_email,
    area_nome: p.area_nome,
    ferramenta: p.ferramenta,
    escopo: p.escopo,
    status: p.status,
    tipos_projeto: parseJson<string[]>(p.tipos_projeto),
    descricao_breve: p.descricao_breve,
    complexidade: (p as ProjetoRow & { complexidade?: string }).complexidade ?? null,
    fase_atual: faseAtual,
    total_mensagens: messages.length,
    total_mensagens_usuario: totalMsgsUser,
    total_mensagens_ia: totalMsgsIA,
    tempo_desde_inicio_min: computeTimeSinceStart(p.created_at),
    ultima_atividade: getUltimaAtividade(messages, p.updated_at),
    tem_erro: errosApi.length > 0,
    total_erros_api: errosApi.length,
    media_duracao_api_ms: mediaDuracao,
    max_duracao_api_ms: maxDuracao,
    ultimo_log_api: getUltimoLogApi(logs),
    chat_completo: !!(p.chat_completo),
    created_at: p.created_at,
    updated_at: p.updated_at,
    submitted_at: p.submitted_at,
    step1: {
      escopo: p.escopo,
      ferramenta: p.ferramenta,
      area_nome: p.area_nome ?? p.area,
      membros: parseJson<string[]>(p.membros) ?? [],
      servico_externo: p.servico_externo ?? null,
    },
    step2: {
      nome: p.nome,
      tipos_projeto: parseJson<string[]>(p.tipos_projeto),
      data_criacao_projeto: p.data_criacao_projeto,
      descricao_breve: p.descricao_breve,
    },
    chat_messages: enrichedMessages,
    documentacao: doc ? parseJson(doc.conteudo) : null,
    analise: analise
      ? {
          resultado: analise.resultado,
          pontuacao_total: analise.pontuacao_total,
          pontuacao_maxima: analise.pontuacao_maxima,
          resumo: analise.resumo,
          complexidade: (p as ProjetoRow & { complexidade?: string }).complexidade ?? null,
        }
      : null,
    api_logs: logs,
  }

  return result
}

/**
 * Estatísticas gerais de API para o painel do investigador.
 */
export async function getInvestigadorStats() {
  const logs = await getApiLogsRecent(5000)

  const total = logs.length
  const erros = logs.filter((l) => l.status_code >= 400).length
  const duracoes = logs.filter((l) => l.duration_ms != null).map((l) => l.duration_ms!)
  const mediaDuracao = duracoes.length > 0 ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : 0
  const lentos = duracoes.filter((d) => d > 5000).length

  // Agrupa por endpoint
  const byEndpoint = new Map<string, { total: number; erros: number; duracao_total: number; count_duracao: number }>()
  for (const log of logs) {
    const ep = log.endpoint
    const entry = byEndpoint.get(ep) ?? { total: 0, erros: 0, duracao_total: 0, count_duracao: 0 }
    entry.total++
    if (log.status_code >= 400) entry.erros++
    if (log.duration_ms != null) {
      entry.duracao_total += log.duration_ms
      entry.count_duracao++
    }
    byEndpoint.set(ep, entry)
  }

  const endpoints = Array.from(byEndpoint.entries()).map(([endpoint, stats]) => ({
    endpoint,
    total: stats.total,
    erros: stats.erros,
    media_duracao_ms: stats.count_duracao > 0 ? Math.round(stats.duracao_total / stats.count_duracao) : 0,
  }))

  return {
    total_chamadas: total,
    total_erros: erros,
    taxa_erro_pct: total > 0 ? Math.round((erros / total) * 100 * 10) / 10 : 0,
    media_duracao_ms: mediaDuracao,
    chamadas_lentas: lentos,
    endpoints,
  }
}
