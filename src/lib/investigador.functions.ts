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
  getReenvioCounts,
  getAllReenvios,
  getVersionsByProjeto,
  getFormEventsByProjeto,
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
  ultima_atividade: string | null
  tem_erro: boolean
  total_erros_api: number
  media_duracao_api_ms: number | null
  max_duracao_api_ms: number | null
  ultimo_log_api: string | null
  chat_completo: boolean
  // Nº de reenvios (edições) registrados — usado pela aba "Edições" e pelo badge.
  total_edicoes: number
  created_at: string | null
  updated_at: string | null
  submitted_at: string | null
}

export type ChatMsgEnriquecida = {
  id: string
  role: string
  content: string
  options: unknown
  selected_option: number | null
  created_at: string | null
  parsed_fase?: string | null
  parsed_type?: string | null
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
  chat_messages: ChatMsgEnriquecida[]
  // Versões (submissão original + reenvios), cada uma com seu snapshot imutável —
  // inclui a conversa congelada (snapshot_chat) quando disponível (forward-only).
  versions: Array<{
    versao_num: number
    acao: string
    created_at: string | null
    snapshot_projeto: unknown
    snapshot_doc: unknown | null
    snapshot_chat: ChatMsgEnriquecida[] | null
  }>
  // Eventos determinísticos do formulário (valores marcados, "voltar etapa").
  form_events: Array<{
    id: string
    tipo: string
    fase: string | null
    dados: unknown
    created_at: string | null
  }>
  documentacao: unknown | null
  analise: {
    resultado: string
    pontuacao_total: number
    pontuacao_maxima: number
    justificativa: string
    resumo: string | null
    complexidade: string | null
    complexidade_justificativa: string | null
    criterios_hardcoded: Array<{ criterio: string; pontos: number; justificativa: string }>
    criterios_dinamicos: Array<{ criterio: string; pontos: number; justificativa: string }>
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

/** Enriquece mensagens (chat ao vivo OU snapshot de versão) com fase/tipo parseados.
 * Usado tanto para os chat_messages atuais quanto para o snapshot_chat de cada versão. */
function enrichChatMessages(
  messages: Array<{
    id: string
    role: string
    content: string
    options: string | null
    selected_option: number | null
    created_at: string | null
  }>,
): ChatMsgEnriquecida[] {
  return messages.map((m) => {
    let parsedFase: string | null = null
    let parsedType: string | null = null
    if (m.role === 'assistant') {
      try {
        const parsed = JSON.parse(m.content) as { fase?: string; fase_origem?: string; type?: string }
        // Usa fase_origem (se presente) para agrupar mensagens de transição na fase
        // correta (ex: complete de doc_preview não cai no grupo saving).
        parsedFase = parsed.fase_origem ?? parsed.fase ?? null
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

/** Converte um carimbo (ISO com Z/offset OU datetime SQLite "YYYY-MM-DD HH:MM:SS")
 * em epoch ms, para comparar janelas de tempo de forma robusta. NaN se inválido. */
function toEpoch(ts: string | null | undefined): number {
  if (!ts) return NaN
  const norm = ts.endsWith('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z'
  return new Date(norm).getTime()
}

// ── Funções exportadas ───────────────────────────────────────────────────────

/**
 * Lista enriquecida de todos os projetos para o painel Investigador.
 * Inclui fase atual, métricas de chat, métricas de API.
 */
export async function getProjetosInvestigador() {
  const projetos = await getProjetosWithArea()
  const recentLogs = await getApiLogsRecent(5000)
  const reenvioCounts = await getReenvioCounts()

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
      ultima_atividade: getUltimaAtividade(messages, p.updated_at),
      tem_erro: errosApi.length > 0,
      total_erros_api: errosApi.length,
      media_duracao_api_ms: mediaDuracao,
      max_duracao_api_ms: maxDuracao,
      ultimo_log_api: getUltimoLogApi(logs),
      chat_completo: !!(p.chat_completo),
      total_edicoes: reenvioCounts.get(p.id) ?? 0,
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
  const versoesRaw = await getVersionsByProjeto(id)
  const formEventsRaw = await getFormEventsByProjeto(id)

  const faseAtual = inferFaseAtual(messages)
  const totalMsgsUser = messages.filter((m) => m.role === 'user').length
  const totalMsgsIA = messages.filter((m) => m.role === 'assistant').length
  const errosApi = logs.filter((l) => l.status_code >= 400)
  const duracoes = logs.filter((l) => l.duration_ms != null).map((l) => l.duration_ms!)
  const mediaDuracao = duracoes.length > 0 ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : null
  const maxDuracao = duracoes.length > 0 ? Math.max(...duracoes) : null

  const enrichedMessages = enrichChatMessages(messages)

  // Versões com snapshot — a conversa congelada (snapshot_chat) é enriquecida igual
  // ao chat ao vivo; versões antigas (sem snapshot) ficam com snapshot_chat null.
  const versions = versoesRaw.map((v) => {
    const chatSnap = parseJson<ChatMessageRow[]>(v.snapshot_chat)
    return {
      versao_num: v.versao_num,
      acao: v.acao,
      created_at: v.created_at,
      snapshot_projeto: parseJson(v.snapshot_projeto),
      snapshot_doc: parseJson(v.snapshot_doc),
      snapshot_chat: chatSnap ? enrichChatMessages(chatSnap) : null,
    }
  })

  const form_events = formEventsRaw.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    fase: e.fase,
    dados: parseJson(e.dados),
    created_at: e.created_at,
  }))

  const result: ProjetoInvestigadorDetalhes = {
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
    ultima_atividade: getUltimaAtividade(messages, p.updated_at),
    tem_erro: errosApi.length > 0,
    total_erros_api: errosApi.length,
    media_duracao_api_ms: mediaDuracao,
    max_duracao_api_ms: maxDuracao,
    ultimo_log_api: getUltimoLogApi(logs),
    chat_completo: !!(p.chat_completo),
    total_edicoes: versions.filter((v) => v.acao === 'reenvio').length,
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
    versions,
    form_events,
    documentacao: doc ? parseJson(doc.conteudo) : null,
    analise: analise
      ? {
          resultado: analise.resultado,
          pontuacao_total: analise.pontuacao_total,
          pontuacao_maxima: analise.pontuacao_maxima,
          justificativa: analise.justificativa,
          resumo: analise.resumo,
          complexidade: (p as ProjetoRow & { complexidade?: string }).complexidade ?? null,
          complexidade_justificativa: analise.complexidade_justificativa ?? null,
          criterios_hardcoded: parseJson<Array<{ criterio: string; pontos: number; justificativa: string }>>(analise.criterios_hardcoded) ?? [],
          criterios_dinamicos: parseJson<Array<{ criterio: string; pontos: number; justificativa: string }>>(analise.criterios_dinamicos) ?? [],
        }
      : null,
    api_logs: logs,
  }

  return result
}

// ── Edições (reenvios) — alimenta a aba "Edições" ────────────────────────────

export type EdicaoInvestigador = {
  projeto_id: string
  versao_num: number
  nome: string | null
  responsavel_nome: string
  responsavel_email: string
  area_nome: string | null
  ferramenta: string
  created_at: string | null // quando a edição foi submetida
  janela_inicio: string | null // limite inferior da janela (versão anterior / criação)
  total_mensagens: number
  total_mensagens_usuario: number
  total_mensagens_ia: number
  total_erros_api: number
  media_duracao_api_ms: number | null
  tem_erro: boolean
  status: string | null
  ganho_total_mensal: number | null
}

/**
 * Lista de todas as edições (reenvios), uma linha por reenvio, com as métricas
 * daquela edição: mensagens vêm do snapshot_chat congelado; erros/duração de API
 * são fatiados pela janela de tempo [versão anterior, esta versão].
 */
export async function getEdicoesInvestigador(): Promise<EdicaoInvestigador[]> {
  const reenvios = await getAllReenvios()
  const recentLogs = await getApiLogsRecent(5000)

  const logsByProjeto = new Map<string, ApiLogRow[]>()
  for (const log of recentLogs) {
    if (!log.projeto_id) continue
    const arr = logsByProjeto.get(log.projeto_id) ?? []
    arr.push(log)
    logsByProjeto.set(log.projeto_id, arr)
  }

  return reenvios.map((v) => {
    const chatSnap = parseJson<ChatMessageRow[]>(v.snapshot_chat) ?? []
    const totalUser = chatSnap.filter((m) => m.role === 'user').length
    const totalIA = chatSnap.filter((m) => m.role === 'assistant').length

    const janelaInicio = v.prev_created_at ?? v.projeto_created_at ?? null
    const ini = toEpoch(janelaInicio)
    const fim = toEpoch(v.created_at)
    const logs = (logsByProjeto.get(v.projeto_id) ?? []).filter((l) => {
      const t = toEpoch(l.created_at)
      if (isNaN(t)) return false
      const apos = isNaN(ini) || t > ini
      const ate = isNaN(fim) || t <= fim
      return apos && ate
    })
    const errosApi = logs.filter((l) => l.status_code >= 400)
    const duracoes = logs.filter((l) => l.duration_ms != null).map((l) => l.duration_ms!)
    const mediaDuracao = duracoes.length > 0 ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : null

    const snap = parseJson<Record<string, unknown>>(v.snapshot_projeto) ?? {}
    return {
      projeto_id: v.projeto_id,
      versao_num: v.versao_num,
      nome: v.nome,
      responsavel_nome: v.responsavel_nome,
      responsavel_email: v.responsavel_email,
      area_nome: v.area_nome ?? v.area,
      ferramenta: v.ferramenta,
      created_at: v.created_at,
      janela_inicio: janelaInicio,
      total_mensagens: chatSnap.length,
      total_mensagens_usuario: totalUser,
      total_mensagens_ia: totalIA,
      total_erros_api: errosApi.length,
      media_duracao_api_ms: mediaDuracao,
      tem_erro: errosApi.length > 0,
      status: (snap.status as string | null) ?? null,
      ganho_total_mensal: (snap.ganho_total_mensal as number | null) ?? null,
    }
  })
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
