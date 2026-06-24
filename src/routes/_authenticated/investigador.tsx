import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Search,
  AlertTriangle,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Zap,
  XCircle,
  CheckCircle2,
  Timer,
  Loader2,
  Filter,
  RefreshCw,
  FileText,
  Bot,
  CircleDot,
  ChevronUp,
  Shield,
  TrendingUp,
  Sparkles,
  Copy,
  Check,
  Eye,
  ArrowUpRight,
  ArrowDownLeft,
  SlidersHorizontal,
  X,
  Calendar,
  ArrowRight,
  Plus,
  Minus,
  Equal,
  GitCompare,
} from 'lucide-react'

export const Route = createFileRoute('/_authenticated/investigador')({
  head: () => ({ meta: [{ title: 'Investigador · GoDocs Admin' }] }),
  component: Investigador,
})

// ── Tipos ────────────────────────────────────────────────────────────────────

type ProjetoInvestigador = {
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
  fase_atual: string
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
  total_edicoes: number
  created_at: string | null
  updated_at: string | null
  submitted_at: string | null
}

type FormEvent = {
  id: string
  tipo: string
  fase: string | null
  dados: Record<string, unknown> | null
  created_at: string | null
}

type Versao = {
  versao_num: number
  acao: string
  created_at: string | null
  snapshot_projeto: unknown
  snapshot_doc: unknown | null
  snapshot_chat: ChatMsg[] | null
}

type EdicaoInvestigador = {
  projeto_id: string
  versao_num: number
  nome: string | null
  responsavel_nome: string
  responsavel_email: string
  area_nome: string | null
  ferramenta: string
  created_at: string | null
  janela_inicio: string | null
  total_mensagens: number
  total_mensagens_usuario: number
  total_mensagens_ia: number
  total_erros_api: number
  media_duracao_api_ms: number | null
  tem_erro: boolean
  status: string | null
  ganho_total_mensal: number | null
}

type ChatMsg = {
  id: string
  role: string
  content: string
  options: unknown
  selected_option: number | null
  created_at: string | null
  parsed_fase?: string | null
  parsed_type?: string | null
}

type ApiLog = {
  id: string
  projeto_id: string | null
  endpoint: string
  method: string
  duration_ms: number | null
  status_code: number
  error: string | null
  request_size: number | null
  response_size: number | null
  created_at: string | null
}

type ProjetoDetalhes = ProjetoInvestigador & {
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
  chat_messages: ChatMsg[]
  versions: Versao[]
  form_events: FormEvent[]
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
  api_logs: ApiLog[]
}

type InvestigadorStats = {
  total_chamadas: number
  total_erros: number
  taxa_erro_pct: number
  media_duracao_ms: number
  chamadas_lentas: number
  endpoints: Array<{
    endpoint: string
    total: number
    erros: number
    media_duracao_ms: number
  }>
}

type Filtro = 'todos' | 'ativos' | 'com_erros' | 'lentos'

type FiltrosAvancados = {
  status: string[]
  fase: string[]
  area: string[]
  ferramenta: string[]
  complexidade: string[]
  dataInicio: string | null
  dataFim: string | null
  chatCompleto: 'todos' | 'completo' | 'em_andamento'
}

const FILTROS_AVANCADOS_DEFAULT: FiltrosAvancados = {
  status: [],
  fase: [],
  area: [],
  ferramenta: [],
  complexidade: [],
  dataInicio: null,
  dataFim: null,
  chatCompleto: 'todos',
}

const COMPLEXIDADE_LABELS: Record<string, string> = {
  automacao: 'Automação',
  inteligencia: 'Inteligência',
  autonomia: 'Autonomia',
}

// ── Constantes de UI ─────────────────────────────────────────────────────────

const FASE_LABELS: Record<string, string> = {
  aguardando_inicio: 'Aguardando início',
  doc: 'Documentação',
  doc_preview: 'Preview da doc',
  saving: 'Saving',
  saving_preview: 'Preview saving',
  receita: 'Receita',
  receita_preview: 'Preview receita',
  completo: 'Completo',
}

// Phase groups for visual theming — each group shares a color lane
type PhaseGroup = 'idle' | 'doc' | 'saving' | 'receita' | 'done'

function getPhaseGroup(fase: string): PhaseGroup {
  if (fase === 'aguardando_inicio') return 'idle'
  if (fase === 'doc' || fase === 'doc_preview') return 'doc'
  if (fase === 'saving' || fase === 'saving_preview') return 'saving'
  if (fase === 'receita' || fase === 'receita_preview') return 'receita'
  if (fase === 'completo') return 'done'
  return 'idle'
}

// Colors per phase group — using GoGroup tokens + complementary palette
const PHASE_STYLES: Record<
  PhaseGroup,
  {
    badge: string
    border: string
    bg: string
    divider: string
    dot: string
    label: string
  }
> = {
  idle: {
    badge: 'bg-[#f0ebe6] text-[#8b8b9a]',
    border: 'border-l-[#c4bfb8]',
    bg: 'bg-[#f0ebe6]/40',
    divider: 'bg-[#c4bfb8]',
    dot: 'bg-[#c4bfb8]',
    label: 'Aguardando',
  },
  doc: {
    badge: 'bg-[#C7E9FD] text-[#0059A9]',
    border: 'border-l-[#0059A9]',
    bg: 'bg-[#C7E9FD]/25',
    divider: 'bg-[#0059A9]',
    dot: 'bg-[#0059A9]',
    label: 'Documentação',
  },
  saving: {
    badge: 'bg-[#D7DB00]/20 text-[#6b6d00]',
    border: 'border-l-[#D7DB00]',
    bg: 'bg-[#D7DB00]/8',
    divider: 'bg-[#D7DB00]',
    dot: 'bg-[#D7DB00]',
    label: 'Saving',
  },
  receita: {
    badge: 'bg-[#0d9488]/10 text-[#0d9488]',
    border: 'border-l-[#0d9488]',
    bg: 'bg-[#0d9488]/8',
    divider: 'bg-[#0d9488]',
    dot: 'bg-[#0d9488]',
    label: 'Receita',
  },
  done: {
    badge: 'bg-[#16a34a]/10 text-[#16a34a]',
    border: 'border-l-[#16a34a]',
    bg: 'bg-[#16a34a]/8',
    divider: 'bg-[#16a34a]',
    dot: 'bg-[#16a34a]',
    label: 'Completo',
  },
}

// Badge classes for the project list cards
const FASE_BADGE: Record<string, string> = {
  aguardando_inicio: PHASE_STYLES.idle.badge,
  doc: PHASE_STYLES.doc.badge,
  doc_preview: PHASE_STYLES.doc.badge,
  saving: PHASE_STYLES.saving.badge,
  saving_preview: PHASE_STYLES.saving.badge,
  receita: PHASE_STYLES.receita.badge,
  receita_preview: PHASE_STYLES.receita.badge,
  completo: PHASE_STYLES.done.badge,
}

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  em_validacao: 'Em validação',
  validado: 'Validado',
  rejeitado: 'Reenvio Pendente',
  aprovado: 'Aprovado',
}

const STATUS_STYLES: Record<string, string> = {
  rascunho: 'bg-[var(--go-blue)]/5 text-[var(--go-blue)]/50',
  em_validacao: 'bg-[#f59e0b]/10 text-[#b45309]',
  validado: 'bg-[#0d9488]/10 text-[#0d9488]',
  rejeitado: 'bg-[#dc2626]/8 text-[#dc2626]',
  aprovado: 'bg-[#16a34a]/10 text-[#16a34a]',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimeSince(min: number | null): string {
  if (min == null) return '—'
  if (min < 1) return '< 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return `${h}h ${m}min`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

// Rascunho nunca submetido e inativo há mais de 1h = abandonado (travou/desistiu).
const ABANDONO_MIN = 60

/** Minutos desde um carimbo (ISO com Z/offset ou datetime SQLite). null se inválido. */
function minutesSince(iso: string | null): number | null {
  if (!iso) return null
  const norm = iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z'
  const t = new Date(norm).getTime()
  if (isNaN(t)) return null
  return Math.round((Date.now() - t) / 60_000)
}

/** Projeto submetido (passou por submeter-validacao). */
function isSubmetido(p: ProjetoInvestigador): boolean {
  return !!p.submitted_at
}

/** Rascunho nunca submetido e parado há > ABANDONO_MIN — caso de diagnóstico. */
function isAbandonado(p: ProjetoInvestigador): boolean {
  if (p.submitted_at) return false
  const ref = p.ultima_atividade ?? p.ultimo_log_api ?? p.created_at
  const min = minutesSince(ref)
  return min != null && min > ABANDONO_MIN
}

type AbaInvestigador = 'submetidos' | 'edicoes' | 'abandonados'

/** Carimbo → epoch ms (aceita ISO com Z/offset ou datetime SQLite). NaN se inválido. */
function tsToEpoch(iso: string | null | undefined): number {
  if (!iso) return NaN
  const norm = iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z'
  return new Date(norm).getTime()
}

/** ts dentro da janela (lower, upper]? lower exclusivo, upper inclusivo; nulls = sem limite. */
function inWindow(ts: string | null, lower: string | null, upper: string | null): boolean {
  const t = tsToEpoch(ts)
  if (isNaN(t)) return false
  const lo = tsToEpoch(lower)
  const hi = tsToEpoch(upper)
  if (!isNaN(lo) && t <= lo) return false
  if (!isNaN(hi) && t > hi) return false
  return true
}

/** Detect the phase of an assistant message by parsing its JSON content */
function detectMsgPhase(msg: ChatMsg): PhaseGroup {
  if (msg.parsed_fase) return getPhaseGroup(msg.parsed_fase)
  if (msg.role === 'assistant') {
    try {
      const parsed = JSON.parse(msg.content) as { fase?: string; fase_origem?: string; type?: string }
      const fase = parsed.fase_origem ?? parsed.fase
      if (fase) {
        // Fallback para dados antigos sem fase_origem: mensagens "complete"
        // de transição pertencem à fase anterior, não à fase de destino.
        if (!parsed.fase_origem && parsed.type === 'complete' && parsed.fase) {
          if (parsed.fase === 'saving') return 'doc'
          if (parsed.fase === 'receita') return 'saving'
          if (parsed.fase === 'completo') return 'receita'
        }
        return getPhaseGroup(fase)
      }
    } catch {
      // ignore
    }
  }
  return 'doc' // default for messages without phase info
}

// ── Componente principal ─────────────────────────────────────────────────────

function Investigador() {
  const [projetos, setProjetos] = useState<ProjetoInvestigador[]>([])
  const [edicoes, setEdicoes] = useState<EdicaoInvestigador[]>([])
  const [stats, setStats] = useState<InvestigadorStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<AbaInvestigador>('submetidos')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [filtrosAv, setFiltrosAv] = useState<FiltrosAvancados>(FILTROS_AVANCADOS_DEFAULT)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusVersao, setFocusVersao] = useState<number | null>(null)
  const [detalhes, setDetalhes] = useState<ProjetoDetalhes | null>(null)
  const [detalhesLoading, setDetalhesLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [p, s, e] = await Promise.all([
        apiFetch<ProjetoInvestigador[]>('/api/admin/investigador/projetos'),
        apiFetch<InvestigadorStats>('/api/admin/investigador/stats'),
        apiFetch<EdicaoInvestigador[]>('/api/admin/investigador/edicoes'),
      ])
      setProjetos(p ?? [])
      setStats(s ?? null)
      setEdicoes(e ?? [])
      setLastRefresh(new Date())
    } catch {
      // silencioso — mantém dados anteriores
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    intervalRef.current = setInterval(fetchData, 8000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchData])

  // versao = reenvio específico (aba Edições) ou null (submissão original / abandonado)
  const loadDetalhes = useCallback(async (id: string, versao: number | null = null) => {
    setSelectedId(id)
    setFocusVersao(versao)
    setDetalhesLoading(true)
    try {
      const d = await apiFetch<ProjetoDetalhes>(`/api/admin/investigador/projetos/${id}`)
      setDetalhes(d)
    } catch {
      setDetalhes(null)
    } finally {
      setDetalhesLoading(false)
    }
  }, [])

  const ehEdicoes = aba === 'edicoes'

  // Projetos da aba atual (Submetidos × Abandonados). Edições têm lista própria.
  const projetosDaAba = projetos.filter((p) =>
    aba === 'submetidos' ? isSubmetido(p) : aba === 'abandonados' ? isAbandonado(p) : false,
  )

  // Filtragem (Submetidos/Abandonados)
  const filtered = projetosDaAba.filter((p) => {
    // Filtros rápidos
    if (filtro === 'com_erros' && !p.tem_erro) return false
    if (filtro === 'lentos' && (p.max_duracao_api_ms == null || p.max_duracao_api_ms <= 5000)) return false
    // Busca textual
    if (busca) {
      const q = busca.toLowerCase()
      const match =
        (p.nome ?? '').toLowerCase().includes(q) ||
        p.responsavel_nome.toLowerCase().includes(q) ||
        p.responsavel_email.toLowerCase().includes(q) ||
        (p.area_nome ?? '').toLowerCase().includes(q)
      if (!match) return false
    }
    // Filtros avançados
    if (filtrosAv.status.length > 0 && !filtrosAv.status.includes(p.status ?? '')) return false
    if (filtrosAv.fase.length > 0 && !filtrosAv.fase.includes(p.fase_atual)) return false
    if (filtrosAv.area.length > 0 && !filtrosAv.area.includes(p.area_nome ?? '')) return false
    if (filtrosAv.ferramenta.length > 0 && !filtrosAv.ferramenta.includes(p.ferramenta)) return false
    if (filtrosAv.complexidade.length > 0 && !filtrosAv.complexidade.includes(p.complexidade ?? '')) return false
    if (filtrosAv.dataInicio && p.created_at && p.created_at < filtrosAv.dataInicio) return false
    if (filtrosAv.dataFim && p.created_at && p.created_at > filtrosAv.dataFim + 'T23:59:59') return false
    if (filtrosAv.chatCompleto === 'completo' && !p.chat_completo) return false
    if (filtrosAv.chatCompleto === 'em_andamento' && p.chat_completo) return false
    return true
  })

  // Edições filtradas por busca textual (aba Edições)
  const edicoesFiltradas = edicoes.filter((e) => {
    if (filtro === 'com_erros' && !e.tem_erro) return false
    if (filtro === 'lentos' && (e.media_duracao_api_ms == null || e.media_duracao_api_ms <= 5000)) return false
    if (!busca) return true
    const q = busca.toLowerCase()
    return (
      (e.nome ?? '').toLowerCase().includes(q) ||
      e.responsavel_nome.toLowerCase().includes(q) ||
      e.responsavel_email.toLowerCase().includes(q) ||
      (e.area_nome ?? '').toLowerCase().includes(q)
    )
  })

  // Contagens por aba
  const countSubmetidos = projetos.filter(isSubmetido).length
  const countAbandonados = projetos.filter(isAbandonado).length
  const countEdicoes = edicoes.length

  // Valores dinâmicos para filtros (extraídos dos projetos carregados)
  const areasUnicas = useMemo(() => [...new Set(projetos.map((p) => p.area_nome).filter(Boolean))].sort() as string[], [projetos])
  const ferramentasUnicas = useMemo(() => [...new Set(projetos.map((p) => p.ferramenta).filter(Boolean))].sort() as string[], [projetos])

  if (selectedId) {
    return (
      <DetalheView
        detalhes={detalhes}
        loading={detalhesLoading}
        focusVersao={focusVersao}
        onBack={() => {
          setSelectedId(null)
          setDetalhes(null)
          setFocusVersao(null)
        }}
        onRefresh={() => loadDetalhes(selectedId, focusVersao)}
      />
    )
  }

  const ABAS: [AbaInvestigador, string, number][] = [
    ['submetidos', 'Submetidos', countSubmetidos],
    ['edicoes', 'Edições', countEdicoes],
    ['abandonados', 'Abandonados', countAbandonados],
  ]

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[var(--go-radius-sm)] bg-[var(--go-blue)] shadow-[var(--go-shadow-sm)]">
              <Search className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[var(--go-text-primary)]">
                Investigador
              </h1>
              <p className="text-[13px] text-[var(--go-text-primary)]/45">
                Submissões, edições e abandonos
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-[var(--go-blue)]/4 px-3 py-1.5 text-xs text-[var(--go-text-primary)]/50">
          <div className="h-1.5 w-1.5 rounded-full bg-[#16a34a] animate-pulse" />
          <span className="font-mono text-[11px] tabular-nums">
            {lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Stats globais */}
      {stats && (
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <StatCard label="Submetidos" value={countSubmetidos} icon={<CheckCircle2 className="h-4 w-4" />} color="#16a34a" />
          <StatCard label="Edições" value={countEdicoes} icon={<RefreshCw className="h-4 w-4" />} color="var(--go-blue)" />
          <StatCard label="Abandonados" value={countAbandonados} icon={<AlertTriangle className="h-4 w-4" />} color="#ea580c" highlight={countAbandonados > 0} />
          <StatCard label="Erros API" value={stats.total_erros} icon={<XCircle className="h-4 w-4" />} color="#dc2626" highlight={stats.total_erros > 0} />
          <StatCard label="Tempo médio" value="—" icon={<Timer className="h-4 w-4" />} color="#7c3aed" />
        </div>
      )}

      {/* Abas */}
      <div className="mt-5 flex items-center gap-1 rounded-[var(--go-radius-sm)] bg-[var(--go-blue)]/4 p-1">
        {ABAS.map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => { setAba(key); setFiltro('todos') }}
            className={`relative flex-1 rounded-[6px] px-4 py-2 text-[13px] font-medium transition-all ${
              aba === key
                ? 'bg-white text-[var(--go-blue)] shadow-[var(--go-shadow-sm)]'
                : 'text-[var(--go-text-primary)]/40 hover:text-[var(--go-text-primary)]/65'
            }`}
          >
            {label}
            <span className={`ml-1.5 text-[11px] tabular-nums ${aba === key ? 'text-[var(--go-blue)]/45' : 'text-[var(--go-text-primary)]/20'}`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Filtros + busca */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-0.5 rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/8 bg-white p-0.5">
          {([
            ['todos', 'Todos', null],
            ['com_erros', 'Com erros', ehEdicoes ? edicoes.filter((e) => e.tem_erro).length : projetosDaAba.filter((p) => p.tem_erro).length],
            ['lentos', 'Lentos (>5s)', ehEdicoes ? edicoes.filter((e) => (e.media_duracao_api_ms ?? 0) > 5000).length : projetosDaAba.filter((p) => (p.max_duracao_api_ms ?? 0) > 5000).length],
          ] as [Filtro, string, number | null][]).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setFiltro(key)}
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-all ${
                filtro === key
                  ? 'bg-[var(--go-blue)] text-white shadow-sm'
                  : 'text-[var(--go-text-primary)]/50 hover:text-[var(--go-text-primary)] hover:bg-[var(--go-blue)]/5'
              }`}
            >
              {label}
              {count != null && count > 0 && (
                <span
                  className={`ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                    filtro === key ? 'bg-white/25 text-white' : 'bg-[var(--go-blue)]/10 text-[var(--go-blue)]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--go-text-primary)]/30" />
          <input
            type="text"
            placeholder="Buscar por nome, responsável, e-mail ou área..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/10 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-shadow focus:border-[var(--go-blue)]/25 focus:shadow-[0_0_0_3px_rgba(0,89,169,0.06)]"
          />
        </div>

        {!ehEdicoes && (
          <FiltroPopover filtros={filtrosAv} onChange={setFiltrosAv} areas={areasUnicas} ferramentas={ferramentasUnicas} />
        )}

        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/10 bg-white px-3 py-2 text-xs text-[var(--go-text-primary)]/50 hover:text-[var(--go-blue)] hover:border-[var(--go-blue)]/25 transition-all"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>
      {/* Chips de filtros avançados ativos */}
      {!ehEdicoes && <FiltroChips filtros={filtrosAv} onChange={setFiltrosAv} />}

      {/* Lista */}
      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--go-text-primary)]/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : ehEdicoes ? (
          edicoesFiltradas.length === 0 ? (
            <div className="rounded-[var(--go-radius-md)] border border-dashed border-[var(--go-blue)]/15 bg-white/50 p-8 text-center text-sm text-[var(--go-text-primary)]/40">
              <RefreshCw className="mx-auto mb-2 h-5 w-5" />
              Nenhuma edição registrada ainda.
            </div>
          ) : (
            <div className="space-y-1.5">
              {edicoesFiltradas.map((e) => (
                <EdicaoCard key={`${e.projeto_id}-${e.versao_num}`} edicao={e} onClick={() => loadDetalhes(e.projeto_id, e.versao_num)} />
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="rounded-[var(--go-radius-md)] border border-dashed border-[var(--go-blue)]/15 bg-white/50 p-8 text-center text-sm text-[var(--go-text-primary)]/40">
            <Filter className="mx-auto mb-2 h-5 w-5" />
            {aba === 'abandonados'
              ? 'Nenhum projeto abandonado (rascunho parado há mais de 1h) encontrado.'
              : 'Nenhum projeto encontrado com os filtros atuais.'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((p) => (
              <ProjetoCard key={p.id} projeto={p} aba={aba} onClick={() => loadDetalhes(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Componentes auxiliares ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
  highlight,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  color: string
  highlight?: boolean
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[var(--go-radius-md)] border bg-white p-3.5 transition-all ${
        highlight ? 'shadow-[var(--go-shadow-sm)]' : 'border-[var(--go-blue)]/8'
      }`}
      style={highlight ? { borderColor: `${color}30` } : undefined}
    >
      {/* Subtle gradient accent */}
      <div
        className="absolute top-0 right-0 h-12 w-12 rounded-full opacity-[0.06] blur-xl"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: `${color}99` }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tracking-tight text-[var(--go-text-primary)] tabular-nums">{value}</div>
    </div>
  )
}

function ProjetoCard({ projeto: p, aba, onClick }: { projeto: ProjetoInvestigador; aba: AbaInvestigador; onClick: () => void }) {
  const group = getPhaseGroup(p.fase_atual)
  const style = PHASE_STYLES[group]
  const ehAbandonado = aba === 'abandonados'
  const inativoMin = minutesSince(p.ultima_atividade ?? p.ultimo_log_api ?? p.created_at)

  return (
    <button
      onClick={onClick}
      className={`group relative w-full text-left overflow-hidden rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/8 bg-white pl-0 pr-4 py-3 transition-all hover:border-[var(--go-blue)]/18 hover:shadow-[var(--go-shadow-sm)]`}
    >
      {/* Phase accent stripe */}
      <div className={`absolute top-0 left-0 h-full w-1 ${style.border.replace('border-l-', 'bg-')}`} />

      <div className="flex items-center gap-3 pl-4">
        {/* Indicador de fase */}
        <div className="flex-shrink-0">
          <div className={`h-2 w-2 rounded-full ${style.dot}`} style={{ opacity: 0.35 }} />
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-[var(--go-text-primary)] truncate group-hover:text-[var(--go-blue)] transition-colors">
              {p.nome ?? 'Projeto sem nome'}
            </span>
            {/* Fase: em abandonados, mostra onde parou */}
            {(ehAbandonado || p.fase_atual !== 'completo') && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${FASE_BADGE[p.fase_atual] ?? PHASE_STYLES.idle.badge}`}>
                {ehAbandonado ? `Parou em: ${FASE_LABELS[p.fase_atual] ?? p.fase_atual}` : (FASE_LABELS[p.fase_atual] ?? p.fase_atual)}
              </span>
            )}
            {!ehAbandonado && p.status && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[p.status] ?? 'bg-[var(--go-blue)]/5 text-[var(--go-blue)]/70'}`}>
                {STATUS_LABELS[p.status] ?? p.status}
              </span>
            )}
            {!ehAbandonado && p.total_edicoes > 0 && (
              <span className="flex items-center gap-0.5 rounded-full bg-[var(--go-blue)]/8 px-2 py-0.5 text-[10px] text-[var(--go-blue)] font-semibold">
                <RefreshCw className="h-3 w-3" />
                {p.total_edicoes} edição{p.total_edicoes !== 1 ? 'ões' : ''}
              </span>
            )}
            {p.tem_erro && (
              <span className="flex items-center gap-0.5 rounded-full bg-[#dc2626]/8 px-2 py-0.5 text-[10px] text-[#dc2626] font-semibold">
                <AlertTriangle className="h-3 w-3" />
                {p.total_erros_api} erro{p.total_erros_api !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--go-text-primary)]/40">
            {p.responsavel_nome} · {p.area_nome ?? 'Sem área'} · {p.ferramenta}
          </div>
        </div>

        {/* Métricas rápidas */}
        <div className="flex items-center gap-4 text-xs flex-shrink-0">
          <div className="text-center" title="Início do formulário">
            <div className="font-semibold text-[var(--go-text-primary)]/80 tabular-nums text-[13px]">{formatDateTime(p.created_at)}</div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">início</div>
          </div>
          {ehAbandonado ? (
            <div className="text-center" title="Tempo sem atividade">
              <div className="font-semibold tabular-nums text-[13px] text-[#ea580c]">{formatTimeSince(inativoMin)}</div>
              <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">inativo há</div>
            </div>
          ) : (
            <div className="text-center" title="Enviado em">
              <div className="font-semibold tabular-nums text-[13px] text-[#16a34a]">{formatDateTime(p.submitted_at)}</div>
              <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">enviado</div>
            </div>
          )}
          <div className="text-center" title="Mensagens (usuário / IA)">
            <div className="font-semibold text-[var(--go-text-primary)]/80 tabular-nums text-[13px]">{p.total_mensagens_usuario}/{p.total_mensagens_ia}</div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">msgs</div>
          </div>
          <div className="text-center" title="Tempo médio de resposta da API">
            <div className={`font-semibold tabular-nums text-[13px] ${(p.media_duracao_api_ms ?? 0) > 5000 ? 'text-[#dc2626]' : 'text-[var(--go-text-primary)]/80'}`}>
              {formatDuration(p.media_duracao_api_ms)}
            </div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">API</div>
          </div>
          <ChevronRight className="h-4 w-4 text-[var(--go-text-primary)]/15 group-hover:text-[var(--go-blue)]/40 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </button>
  )
}

// ── Card de uma edição (reenvio) — aba "Edições" ─────────────────────────────

function EdicaoCard({ edicao: e, onClick }: { edicao: EdicaoInvestigador; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative w-full text-left overflow-hidden rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/8 bg-white pl-0 pr-4 py-3 transition-all hover:border-[var(--go-blue)]/18 hover:shadow-[var(--go-shadow-sm)]"
    >
      <div className="absolute top-0 left-0 h-full w-1 bg-[var(--go-blue)]" />
      <div className="flex items-center gap-3 pl-4">
        <div className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--go-blue)]/8 text-[var(--go-blue)]">
          <RefreshCw className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-[var(--go-text-primary)] truncate group-hover:text-[var(--go-blue)] transition-colors">
              {e.nome ?? 'Projeto sem nome'}
            </span>
            <span className="rounded-full bg-[var(--go-blue)]/8 px-2 py-0.5 text-[10px] font-semibold text-[var(--go-blue)]">
              Edição v{e.versao_num}
            </span>
            {e.tem_erro && (
              <span className="flex items-center gap-0.5 rounded-full bg-[#dc2626]/8 px-2 py-0.5 text-[10px] text-[#dc2626] font-semibold">
                <AlertTriangle className="h-3 w-3" />
                {e.total_erros_api} erro{e.total_erros_api !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--go-text-primary)]/40">
            {e.responsavel_nome} · {e.area_nome ?? 'Sem área'} · {e.ferramenta}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs flex-shrink-0">
          <div className="text-center" title="Editado em">
            <div className="font-semibold text-[var(--go-text-primary)]/80 tabular-nums text-[13px]">{formatDateTime(e.created_at)}</div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">editado</div>
          </div>
          <div className="text-center" title="Mensagens (usuário / IA) na edição">
            <div className="font-semibold text-[var(--go-text-primary)]/80 tabular-nums text-[13px]">{e.total_mensagens_usuario}/{e.total_mensagens_ia}</div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">msgs</div>
          </div>
          <div className="text-center" title="Tempo médio de resposta da API na edição">
            <div className={`font-semibold tabular-nums text-[13px] ${(e.media_duracao_api_ms ?? 0) > 5000 ? 'text-[#dc2626]' : 'text-[var(--go-text-primary)]/80'}`}>
              {formatDuration(e.media_duracao_api_ms)}
            </div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">API</div>
          </div>
          <ChevronRight className="h-4 w-4 text-[var(--go-text-primary)]/15 group-hover:text-[var(--go-blue)]/40 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </button>
  )
}

// ── Detalhe de um projeto ────────────────────────────────────────────────────

function DetalheView({
  detalhes,
  loading,
  focusVersao,
  onBack,
  onRefresh,
}: {
  detalhes: ProjetoDetalhes | null
  loading: boolean
  focusVersao: number | null
  onBack: () => void
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'chat' | 'api_logs' | 'dados'>('chat')
  const [dadosOpen, setDadosOpen] = useState(false)
  // Versão selecionada: número do reenvio/original, ou 'atual' (chat ao vivo).
  // `null` = usar o default derivado (focusVersao, ou a submissão original).
  const [versaoOverride, setVersaoOverride] = useState<number | 'atual' | null>(null)

  // Ao trocar de projeto/foco, descarta a escolha manual anterior.
  useEffect(() => {
    setVersaoOverride(null)
  }, [detalhes?.id, focusVersao])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16 text-[var(--go-text-primary)]/40">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando detalhes...
      </div>
    )
  }

  if (!detalhes) {
    return (
      <div className="p-8 text-center text-[var(--go-text-primary)]/40">
        <p>Projeto não encontrado.</p>
        <button onClick={onBack} className="mt-4 text-sm text-[var(--go-blue)] underline">
          Voltar
        </button>
      </div>
    )
  }

  const d = detalhes
  const group = getPhaseGroup(d.fase_atual)
  const phaseStyle = PHASE_STYLES[group]

  // ── Versões e seleção ──────────────────────────────────────────────────────
  const versoesAsc = [...d.versions].sort((a, b) => a.versao_num - b.versao_num)
  const temVersoes = versoesAsc.length > 0
  const versaoOriginal = versoesAsc.find((v) => v.acao === 'submit_inicial')
  // Default: foco explícito (aba Edições) → senão a submissão original → senão ao vivo.
  const selDefault: number | 'atual' =
    focusVersao != null ? focusVersao : versaoOriginal ? versaoOriginal.versao_num : 'atual'
  const sel: number | 'atual' = versaoOverride ?? selDefault

  // Resolve o que exibir conforme a seleção: chat (snapshot ou ao vivo), eventos e
  // logs fatiados pela janela de tempo daquela versão.
  let chatView = d.chat_messages
  let eventosView = d.form_events
  let logsView = d.api_logs
  let snapshotIndisponivel = false
  if (sel === 'atual') {
    // Ao vivo: tudo após a última versão registrada (ou tudo, se não há versões).
    const ultima = versoesAsc[versoesAsc.length - 1]
    const lower = ultima ? ultima.created_at : null
    eventosView = d.form_events.filter((e) => inWindow(e.created_at, lower, null))
    logsView = d.api_logs.filter((l) => inWindow(l.created_at, lower, null))
    chatView = d.chat_messages
  } else {
    const idx = versoesAsc.findIndex((v) => v.versao_num === sel)
    const v = idx >= 0 ? versoesAsc[idx] : undefined
    const lower = idx > 0 ? versoesAsc[idx - 1].created_at : d.created_at
    const upper = v?.created_at ?? null
    eventosView = d.form_events.filter((e) => inWindow(e.created_at, lower, upper))
    logsView = d.api_logs.filter((l) => inWindow(l.created_at, lower, upper))
    // Conversa congelada da versão; cai para o chat atual se o snapshot não existir
    // (versões anteriores à introdução do snapshot_chat — forward-only).
    if (v?.snapshot_chat) {
      chatView = v.snapshot_chat
    } else {
      chatView = d.chat_messages
      snapshotIndisponivel = true
    }
  }

  const rotuloVersao = (v: Versao) => (v.acao === 'submit_inicial' ? 'Original' : `Edição v${v.versao_num}`)

  // Versão selecionada é um reenvio? → habilita o painel de comparação (antes/depois).
  const selVersao = typeof sel === 'number' ? versoesAsc.find((v) => v.versao_num === sel) : undefined
  const ehReenvioSelecionado = selVersao?.acao === 'reenvio'

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      {/* Header com profundidade */}
      <div className="relative overflow-hidden rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/8 bg-white p-5">
        {/* Faixa decorativa */}
        <div className={`absolute top-0 left-0 h-full w-1 ${phaseStyle.border.replace('border-l-', 'bg-')}`} />

        <div className="flex items-start gap-3 pl-3">
          <button
            onClick={onBack}
            className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/10 bg-[var(--go-cream)]/50 text-[var(--go-text-primary)]/40 hover:text-[var(--go-blue)] hover:border-[var(--go-blue)]/25 hover:bg-[var(--go-blue)]/5 transition-all"
            title="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg font-bold tracking-tight text-[var(--go-text-primary)]">
                {d.nome ?? 'Projeto sem nome'}
              </h1>
              <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${phaseStyle.badge}`}>
                {FASE_LABELS[d.fase_atual] ?? d.fase_atual}
              </span>
              {d.status && (
                <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[d.status] ?? 'bg-[var(--go-blue)]/5 text-[var(--go-blue)]/70'}`}>
                  {STATUS_LABELS[d.status] ?? d.status}
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-[var(--go-text-primary)]/45">
              {d.responsavel_nome} ({d.responsavel_email}) · {d.area_nome ?? 'Sem área'} · {d.ferramenta}
            </p>

            {/* Métricas inline dentro do header */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MiniStat label="Msgs" value={`${d.total_mensagens_usuario}u / ${d.total_mensagens_ia}ia`} />
              <MiniStat label="API média" value={formatDuration(d.media_duracao_api_ms)} warn={(d.media_duracao_api_ms ?? 0) > 5000} />
              <MiniStat label="Erros" value={String(d.total_erros_api)} warn={d.total_erros_api > 0} />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setDadosOpen(!dadosOpen)}
              className="flex items-center gap-1.5 rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/10 bg-[var(--go-cream)]/50 px-3 py-1.5 text-xs text-[var(--go-text-primary)]/50 hover:text-[var(--go-blue)] hover:border-[var(--go-blue)]/25 transition-all"
            >
              <FileText className="h-3 w-3" />
              Dados
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${dadosOpen ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/10 bg-[var(--go-cream)]/50 px-3 py-1.5 text-xs text-[var(--go-text-primary)]/50 hover:text-[var(--go-blue)] hover:border-[var(--go-blue)]/25 transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Dados colapsáveis das etapas */}
      {dadosOpen && (
        <div
          className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2"
          style={{ animation: 'go-slide-down 0.2s ease' }}
        >
          <div className="rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/8 bg-white p-4">
            <h3 className="text-[11px] font-semibold text-[var(--go-blue)]/50 uppercase tracking-wider mb-2">
              Etapa 1 — Envio
            </h3>
            <div className="space-y-1 text-sm">
              <KV label="Escopo" value={d.step1.escopo} />
              <KV label="Ferramenta" value={d.step1.ferramenta} />
              <KV label="Área" value={d.step1.area_nome} />
              <KV label="Serviço externo" value={d.step1.servico_externo} />
              <KV label="Membros" value={d.step1.membros.length > 0 ? d.step1.membros.join(', ') : null} />
            </div>
          </div>
          <div className="rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/8 bg-white p-4">
            <h3 className="text-[11px] font-semibold text-[var(--go-blue)]/50 uppercase tracking-wider mb-2">
              Etapa 2 — Projeto
            </h3>
            <div className="space-y-1 text-sm">
              <KV label="Nome" value={d.step2.nome} />
              <KV label="Tipos" value={d.step2.tipos_projeto?.join(', ')} />
              <KV label="Data criação" value={d.step2.data_criacao_projeto} />
              <KV label="Descrição" value={d.step2.descricao_breve} />
            </div>
          </div>
        </div>
      )}

      {/* Seletor de versão — quando o projeto tem submissão original + edições */}
      {temVersoes && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--go-text-primary)]/35 mr-1">Versão:</span>
          {versoesAsc.map((v) => (
            <button
              key={v.versao_num}
              onClick={() => setVersaoOverride(v.versao_num)}
              title={formatDateTime(v.created_at)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-all ${
                sel === v.versao_num
                  ? 'bg-[var(--go-blue)] text-white border-[var(--go-blue)] shadow-sm'
                  : 'bg-white text-[var(--go-text-primary)]/60 border-[var(--go-blue)]/10 hover:border-[var(--go-blue)]/25'
              }`}
            >
              {rotuloVersao(v)}
            </button>
          ))}
          <button
            onClick={() => setVersaoOverride('atual')}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-all ${
              sel === 'atual'
                ? 'bg-[var(--go-blue)] text-white border-[var(--go-blue)] shadow-sm'
                : 'bg-white text-[var(--go-text-primary)]/60 border-[var(--go-blue)]/10 hover:border-[var(--go-blue)]/25'
            }`}
          >
            Atual (ao vivo)
          </button>
        </div>
      )}

      {/* Aviso: snapshot da conversa indisponível para esta versão (forward-only) */}
      {snapshotIndisponivel && (
        <div className="mt-2 flex items-center gap-1.5 rounded-[var(--go-radius-sm)] bg-[#f59e0b]/8 px-3 py-1.5 text-[11px] text-[#b45309]">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          Conversa congelada desta versão indisponível (anterior ao snapshot) — exibindo o chat atual.
        </div>
      )}

      {/* Comparação antes/depois — só quando a versão selecionada é um reenvio */}
      {ehReenvioSelecionado && <ComparacaoEdicao versoes={versoesAsc} sel={sel as number} />}

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-1 rounded-[var(--go-radius-sm)] bg-[var(--go-blue)]/4 p-1">
        {([
          ['chat', 'Chat', chatView.length],
          ['api_logs', 'Logs de API', logsView.length],
          ['dados', 'Análise & Docs', null],
        ] as [string, string, number | null][]).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`relative flex-1 rounded-[6px] px-4 py-2 text-[13px] font-medium transition-all ${
              tab === key
                ? 'bg-white text-[var(--go-blue)] shadow-[var(--go-shadow-sm)]'
                : 'text-[var(--go-text-primary)]/40 hover:text-[var(--go-text-primary)]/65'
            }`}
          >
            {label}
            {count != null && (
              <span className={`ml-1.5 text-[11px] tabular-nums ${tab === key ? 'text-[var(--go-blue)]/45' : 'text-[var(--go-text-primary)]/20'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'chat' && <ChatTab messages={chatView} eventos={eventosView} />}
        {tab === 'api_logs' && <ApiLogsTab logs={logsView} />}
        {tab === 'dados' && <DadosTab documentacao={d.documentacao} analise={d.analise} />}
      </div>
    </div>
  )
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
      warn ? 'bg-[#dc2626]/6' : 'bg-[var(--go-blue)]/4'
    }`}>
      <span className={`text-[11px] ${warn ? 'text-[#dc2626]/50' : 'text-[var(--go-text-primary)]/35'}`}>{label}</span>
      <span className={`font-semibold tabular-nums text-[12px] ${warn ? 'text-[#dc2626]' : 'text-[var(--go-text-primary)]/80'}`}>{value}</span>
    </div>
  )
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--go-text-primary)]/35 text-xs w-28 flex-shrink-0">{label}:</span>
      <span className="text-[var(--go-text-primary)]">
        {value || <span className="text-[var(--go-text-primary)]/20 italic">—</span>}
      </span>
    </div>
  )
}

// ── Comparação de edição (diff antes → depois entre versões) ─────────────────

type SnapRecord = Record<string, unknown>
type DiffStatus = 'alterado' | 'adicionado' | 'removido' | 'igual'
type CampoDiff = {
  key: string
  label: string
  antes: string | null
  depois: string | null
  status: DiffStatus
  long: boolean
}

/** Um valor formatado é "vazio" quando não há nada a mostrar (null, em branco ou "—"). */
function diffVazio(s: string | null | undefined): boolean {
  return s == null || s.trim() === '' || s.trim() === '—'
}

function diffNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

// Formatadores por tipo de campo — recebem o snapshot inteiro (alguns dependem de
// outro campo, ex.: o sufixo "/mês" do saving depende de tipo_saving).
function vReais(v: unknown, sufixo = ''): string | null {
  return typeof v === 'number' && !isNaN(v) ? `${fmtReais(v)}${sufixo}` : null
}
function vTexto(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function vSimNao(v: unknown): string | null {
  if (v === 'sim') return 'Sim'
  if (v === 'nao' || v === 'não') return 'Não'
  return null
}
function vTipoSaving(v: unknown): string | null {
  if (v === 'mensal') return 'Mensal'
  if (v === 'pontual') return 'Pontual'
  return null
}
function vEspecial(v: unknown): string | null {
  if (v == null) return null
  return v === 1 || v === true || v === 'sim' ? 'Sim' : 'Não'
}
function vLista(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return (v as unknown[]).map(String).join(', ')
}
function vStatus(v: unknown): string | null {
  const s = vTexto(v)
  return s ? (STATUS_LABELS[s] ?? s) : null
}
function vCustoItens(v: unknown): string | null {
  let arr: unknown = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch {
      return vTexto(v)
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null
  const linhas = (arr as EventoCustoItem[])
    .filter((it) => it && it.nome != null)
    .map((it) => `• ${it.nome} — ${fmtReais(it.valor)} (${it.recorrencia ?? '—'})`)
  return linhas.length > 0 ? linhas.join('\n') : null
}

// Campos comparados, na ordem de exibição. `long` = texto extenso (abre antes/depois).
const CAMPOS_DIFF: Array<{ key: string; label: string; get: (s: SnapRecord) => string | null; long?: boolean }> = [
  { key: 'nome', label: 'Nome', get: (s) => vTexto(s.nome) },
  { key: 'area', label: 'Área', get: (s) => vTexto(s.area) },
  { key: 'ferramenta', label: 'Ferramenta', get: (s) => vTexto(s.ferramenta) },
  { key: 'tipos_projeto', label: 'Tipos de projeto', get: (s) => vLista(s.tipos_projeto) },
  { key: 'especial', label: 'Projeto especial', get: (s) => vEspecial(s.especial) },
  { key: 'descricao_breve', label: 'Descrição', get: (s) => vTexto(s.descricao_breve), long: true },
  { key: 'tipo_saving', label: 'Tipo de saving', get: (s) => vTipoSaving(s.tipo_saving) },
  {
    key: 'saving_horas',
    label: 'Economia em horas',
    get: (s) =>
      typeof s.saving_horas === 'number' && !isNaN(s.saving_horas)
        ? `${diffNum(s.saving_horas)} h${s.tipo_saving === 'mensal' ? '/mês' : ''}`
        : null,
  },
  { key: 'saving_reais', label: 'Saving', get: (s) => vReais(s.saving_reais, s.tipo_saving === 'mensal' ? '/mês' : '') },
  { key: 'ganho_total_mensal', label: 'Ganho total', get: (s) => vReais(s.ganho_total_mensal, '/mês') },
  { key: 'custo_externo_mensal', label: 'Custo externo', get: (s) => vReais(s.custo_externo_mensal, '/mês') },
  { key: 'alguem_fazia', label: 'Alguém fazia antes', get: (s) => vSimNao(s.alguem_fazia) },
  { key: 'custo_evitado', label: 'Tem custo evitado', get: (s) => vSimNao(s.custo_evitado) },
  { key: 'custo_evitado_justificativa', label: 'Justificativa do custo evitado', get: (s) => vTexto(s.custo_evitado_justificativa), long: true },
  { key: 'custo_evitado_itens', label: 'Itens de custo evitado', get: (s) => vCustoItens(s.custo_evitado_itens), long: true },
  { key: 'memorial_calculo', label: 'Memorial de cálculo', get: (s) => vTexto(s.memorial_calculo), long: true },
  { key: 'status', label: 'Status interno', get: (s) => vStatus(s.status) },
]

/** Aceita o snapshot já parseado (objeto) ou string JSON; null se ausente/vazio. */
function parseSnap(raw: unknown): SnapRecord | null {
  if (!raw) return null
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof obj !== 'object' || obj === null || Object.keys(obj as object).length === 0) return null
  return obj as SnapRecord
}

function computarDiff(prev: SnapRecord, atual: SnapRecord): CampoDiff[] {
  const out: CampoDiff[] = []
  for (const c of CAMPOS_DIFF) {
    const antes = c.get(prev)
    const depois = c.get(atual)
    const aVazio = diffVazio(antes)
    const dVazio = diffVazio(depois)
    if (aVazio && dVazio) continue // ambos sem valor → irrelevante para a auditoria
    let status: DiffStatus
    if (aVazio) status = 'adicionado'
    else if (dVazio) status = 'removido'
    else if (antes === depois) status = 'igual'
    else status = 'alterado'
    out.push({ key: c.key, label: c.label, antes, depois, status, long: !!c.long })
  }
  return out
}

// Encoding por estado de mudança — cor + ícone + rótulo (nunca só cor, p/ acessibilidade).
const DIFF_STYLE: Record<
  DiffStatus,
  { label: string; cor: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }
> = {
  alterado: { label: 'Alterado', cor: '#0059A9', Icon: ArrowRight },
  adicionado: { label: 'Adicionado', cor: '#6b6d00', Icon: Plus },
  removido: { label: 'Removido', cor: '#dc2626', Icon: Minus },
  igual: { label: 'Sem mudança', cor: '#8b8b7a', Icon: Equal },
}

/** Bloco de texto longo (antes/depois) — prosa, não monoespaçada, com rolagem. */
function BlocoTexto({ titulo, texto, tom }: { titulo: string; texto: string | null; tom: 'antes' | 'depois' }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--go-text-primary)]/35">{titulo}</div>
      <pre
        className={`max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--go-radius-sm)] border p-2.5 text-[11.5px] leading-relaxed ${
          tom === 'depois'
            ? 'border-[var(--go-blue)]/15 bg-[var(--go-blue)]/4 text-[var(--go-text-primary)]/80'
            : 'border-[var(--go-blue)]/8 bg-[var(--go-cream)]/50 text-[var(--go-text-primary)]/55'
        }`}
        style={{ scrollbarWidth: 'thin', fontFamily: 'inherit' }}
      >
        {texto && texto.trim() !== '' ? texto : '—'}
      </pre>
    </div>
  )
}

/** Uma linha de mudança (alterado/adicionado/removido). Campos longos abrem antes×depois. */
function LinhaDiff({ campo }: { campo: CampoDiff }) {
  const [aberto, setAberto] = useState(false)
  const st = DIFF_STYLE[campo.status]

  if (campo.long) {
    const resumo =
      campo.status === 'adicionado' ? 'Texto adicionado' : campo.status === 'removido' ? 'Texto removido' : 'Texto alterado'
    return (
      <div className="py-0.5">
        <button
          onClick={() => setAberto((o) => !o)}
          aria-expanded={aberto}
          className="group flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--go-blue)]/3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)]/25"
        >
          <span className="w-44 flex-shrink-0 text-[12px] text-[var(--go-text-primary)]/45">{campo.label}</span>
          <span className="flex-1 text-[12px] font-medium" style={{ color: st.cor }}>
            {resumo}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--go-text-primary)]/30 transition-transform ${aberto ? 'rotate-180' : ''}`}
          />
        </button>
        {aberto && (
          <div
            className="mt-1.5 grid grid-cols-1 gap-2 px-1.5 lg:grid-cols-2"
            style={{ animation: 'go-slide-down 0.18s ease' }}
          >
            <BlocoTexto titulo="Antes" texto={campo.antes} tom="antes" />
            <BlocoTexto titulo="Depois" texto={campo.depois} tom="depois" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1.5 py-1">
      <span className="w-44 flex-shrink-0 text-[12px] text-[var(--go-text-primary)]/45">{campo.label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {campo.status === 'adicionado' ? (
          <span className="text-[12px] italic text-[var(--go-text-primary)]/30">vazio</span>
        ) : (
          <span
            className={`text-[12px] text-[var(--go-text-primary)]/45 ${campo.status === 'removido' ? 'line-through' : ''}`}
          >
            {campo.antes}
          </span>
        )}
        <ArrowRight className="h-3 w-3 flex-shrink-0 text-[var(--go-text-primary)]/25" />
        {campo.status === 'removido' ? (
          <span className="text-[12px] font-medium" style={{ color: st.cor }}>
            removido
          </span>
        ) : (
          <span className="text-[13px] font-semibold" style={{ color: st.cor }}>
            {campo.depois}
          </span>
        )}
      </div>
    </div>
  )
}

/** Cabeçalho + linhas de um grupo de mudança (Alterado / Adicionado / Removido). */
function GrupoDiff({ status, campos }: { status: DiffStatus; campos: CampoDiff[] }) {
  if (campos.length === 0) return null
  const st = DIFF_STYLE[status]
  const Icon = st.Icon
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-1.5">
        <Icon className="h-3.5 w-3.5" style={{ color: st.cor }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: st.cor }}>
          {st.label}
        </span>
        <span className="text-[11px] font-medium tabular-nums text-[var(--go-text-primary)]/30">· {campos.length}</span>
      </div>
      <div className="space-y-0.5">
        {campos.map((c) => (
          <LinhaDiff key={c.key} campo={c} />
        ))}
      </div>
    </div>
  )
}

/**
 * Painel "Comparação desta edição": para um reenvio, compara o snapshot da versão
 * selecionada com o da versão imediatamente anterior e classifica cada campo em
 * Alterado / Adicionado / Removido / Sem mudança. Snapshot ausente → aviso gracioso.
 */
function ComparacaoEdicao({ versoes, sel }: { versoes: Versao[]; sel: number }) {
  const [mostrarIguais, setMostrarIguais] = useState(false)

  const idx = versoes.findIndex((v) => v.versao_num === sel)
  const atualV = idx >= 0 ? versoes[idx] : undefined
  const prevV = idx > 0 ? versoes[idx - 1] : undefined

  const { prevSnap, atualSnap, diffs } = useMemo(() => {
    const a = parseSnap(atualV?.snapshot_projeto)
    const p = parseSnap(prevV?.snapshot_projeto)
    return { prevSnap: p, atualSnap: a, diffs: p && a ? computarDiff(p, a) : [] }
  }, [atualV?.snapshot_projeto, prevV?.snapshot_projeto])

  const rotulo = (v?: Versao) => (!v ? '—' : v.acao === 'submit_inicial' ? 'Original' : `Edição v${v.versao_num}`)

  // Fallback gracioso: versão muito antiga sem snapshot de uma das pontas.
  if (!atualV || !prevV || !atualSnap || !prevSnap) {
    return (
      <div className="mt-3 flex items-start gap-1.5 rounded-[var(--go-radius-sm)] bg-[#f59e0b]/8 px-3 py-2 text-[11px] text-[#b45309]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        Comparação indisponível — o snapshot desta edição ou da versão anterior não foi registrado (versão anterior ao
        histórico de snapshots).
      </div>
    )
  }

  const alterados = diffs.filter((d) => d.status === 'alterado')
  const adicionados = diffs.filter((d) => d.status === 'adicionado')
  const removidos = diffs.filter((d) => d.status === 'removido')
  const iguais = diffs.filter((d) => d.status === 'igual')
  const mudancas = alterados.length + adicionados.length + removidos.length

  const resumo: Array<{ status: DiffStatus; n: number; texto: string }> = [
    { status: 'alterado', n: alterados.length, texto: 'alterados' },
    { status: 'adicionado', n: adicionados.length, texto: 'adicionados' },
    { status: 'removido', n: removidos.length, texto: 'removidos' },
    { status: 'igual', n: iguais.length, texto: 'iguais' },
  ]

  return (
    <div className="mt-3 overflow-hidden rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/10 bg-white">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2.5 border-b border-[var(--go-blue)]/6 px-4 py-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[var(--go-radius-sm)] bg-[var(--go-blue)]/8 text-[var(--go-blue)]">
          <GitCompare className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-bold leading-tight text-[var(--go-text-primary)]">Comparação desta edição</h3>
          <p className="text-[11px] text-[var(--go-text-primary)]/40">O que mudou em relação à versão anterior</p>
        </div>
        <div
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-[var(--go-blue)]/5 px-2.5 py-1 text-[11px] font-medium text-[var(--go-blue)]"
          title={`${rotulo(prevV)}: ${formatDateTime(prevV.created_at)}\n${rotulo(atualV)}: ${formatDateTime(atualV.created_at)}`}
        >
          <span>{rotulo(prevV)}</span>
          <ArrowRight className="h-3 w-3" />
          <span className="font-semibold">{rotulo(atualV)}</span>
        </div>
      </div>

      <div className="p-4">
        {/* Resumo (thesis): contagem por tipo de mudança */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {resumo
            .filter((r) => r.n > 0)
            .map((r) => {
              const st = DIFF_STYLE[r.status]
              const Icon = st.Icon
              return (
                <span
                  key={r.status}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ color: st.cor, backgroundColor: `${st.cor}14` }}
                >
                  <Icon className="h-3 w-3" />
                  <span className="tabular-nums">{r.n}</span>
                  <span className="font-medium">{r.texto}</span>
                </span>
              )
            })}
        </div>

        {/* Mudanças */}
        {mudancas === 0 ? (
          <div className="rounded-[var(--go-radius-sm)] bg-[var(--go-cream)]/50 px-3 py-2.5 text-[12px] text-[var(--go-text-primary)]/45">
            Nenhum campo monitorado mudou nesta edição — o reenvio manteve os mesmos valores.
          </div>
        ) : (
          <div className="space-y-3">
            <GrupoDiff status="alterado" campos={alterados} />
            <GrupoDiff status="adicionado" campos={adicionados} />
            <GrupoDiff status="removido" campos={removidos} />
          </div>
        )}

        {/* Sem mudança — recolhido por padrão (quieto) */}
        {iguais.length > 0 && (
          <div className="mt-3 border-t border-[var(--go-blue)]/6 pt-2">
            <button
              onClick={() => setMostrarIguais((o) => !o)}
              aria-expanded={mostrarIguais}
              className="flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--go-blue)]/3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)]/25"
            >
              <Equal className="h-3.5 w-3.5 text-[var(--go-text-primary)]/30" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--go-text-primary)]/40">
                Sem mudança
              </span>
              <span className="text-[11px] tabular-nums text-[var(--go-text-primary)]/25">· {iguais.length}</span>
              <ChevronDown
                className={`ml-auto h-3.5 w-3.5 text-[var(--go-text-primary)]/25 transition-transform ${mostrarIguais ? 'rotate-180' : ''}`}
              />
            </button>
            {mostrarIguais && (
              <div className="mt-1 space-y-0.5" style={{ animation: 'go-slide-down 0.18s ease' }}>
                {iguais.map((c) => (
                  <div key={c.key} className="flex flex-wrap items-baseline gap-x-2 px-1.5 py-0.5">
                    <span className="w-44 flex-shrink-0 text-[12px] text-[var(--go-text-primary)]/35">{c.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--go-text-primary)]/55">
                      {c.long ? 'Texto longo, sem alteração' : c.depois}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Histórico do chat ───────────────────────────────────────────────────

/** Mapeia a fase de um evento de formulário para o grupo visual de fase. */
function eventFaseToGroup(fase: string | null): PhaseGroup | null {
  if (!fase) return null
  if (fase === 'doc') return 'doc'
  if (fase === 'saving') return 'saving'
  if (fase === 'receita') return 'receita'
  if (fase === 'completo' || fase === 'done') return 'done'
  return null
}

type TimelineItem =
  | { type: 'divider'; phase: PhaseGroup; label: string; key: string }
  | { type: 'message'; msg: ChatMsg; phase: PhaseGroup; key: string }
  | { type: 'event'; event: FormEvent; phase: PhaseGroup; key: string }

function ChatTab({ messages, eventos }: { messages: ChatMsg[]; eventos: FormEvent[] }) {
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Timeline unificado: mensagens do chat + eventos determinísticos do formulário,
  // ordenados por created_at. Em empate de carimbo, o evento vem antes da mensagem
  // (o evento precede a resposta da IA que ele disparou). Tanto mensagens da IA
  // quanto eventos com fase definem os divisores de fase.
  const timeline = useMemo<TimelineItem[]>(() => {
    const combined: Array<
      | { kind: 'message'; msg: ChatMsg; ts: number }
      | { kind: 'event'; event: FormEvent; ts: number }
    > = []
    for (const m of messages) combined.push({ kind: 'message', msg: m, ts: tsToEpoch(m.created_at) })
    for (const e of eventos) combined.push({ kind: 'event', event: e, ts: tsToEpoch(e.created_at) })
    combined.sort((a, b) => {
      const av = isNaN(a.ts) ? 0 : a.ts
      const bv = isNaN(b.ts) ? 0 : b.ts
      if (av !== bv) return av - bv
      const ap = a.kind === 'event' ? 0 : 1
      const bp = b.kind === 'event' ? 0 : 1
      return ap - bp
    })

    const result: TimelineItem[] = []
    let currentPhase: PhaseGroup | null = null
    let idx = 0

    for (const it of combined) {
      if (it.kind === 'event') {
        const ev = it.event
        const evPhase = eventFaseToGroup(ev.fase)
        if (evPhase && evPhase !== currentPhase) {
          currentPhase = evPhase
          result.push({ type: 'divider', phase: evPhase, label: PHASE_STYLES[evPhase].label, key: `dive-${idx}` })
        }
        result.push({ type: 'event', event: ev, phase: currentPhase ?? 'doc', key: `ev-${ev.id}` })
        idx++
        continue
      }

      const msg = it.msg
      // DOC messages don't change the phase context
      if (msg.role === 'doc') {
        result.push({ type: 'message', msg, phase: currentPhase ?? 'doc', key: `m-${msg.id}` })
        idx++
        continue
      }

      const phase: PhaseGroup = msg.role === 'assistant' ? detectMsgPhase(msg) : (currentPhase ?? 'doc')
      if (msg.role === 'assistant' && phase !== currentPhase) {
        currentPhase = phase
        result.push({ type: 'divider', phase, label: PHASE_STYLES[phase].label, key: `divm-${idx}` })
      }
      if (msg.role === 'user' && currentPhase === null) currentPhase = 'doc'
      result.push({ type: 'message', msg, phase: currentPhase ?? 'doc', key: `m-${msg.id}` })
      idx++
    }

    return result
  }, [messages, eventos])

  if (messages.length === 0 && eventos.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--go-text-primary)]/30">
        <MessageSquare className="mx-auto mb-2 h-5 w-5" />
        Nenhuma mensagem de chat ainda.
      </div>
    )
  }

  return (
    <div className="max-h-[650px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
      <div className="space-y-1 py-2">
        {timeline.map((item) => {
          if (item.type === 'divider') return <PhaseDivider key={item.key} phase={item.phase} label={item.label} />
          if (item.type === 'event') return <EventBubble key={item.key} event={item.event} />
          return <ChatBubble key={item.key} msg={item.msg} phase={item.phase} />
        })}
        <div ref={chatEndRef} />
      </div>
    </div>
  )
}

// ── Bolha de evento determinístico do formulário ─────────────────────────────

function fmtReais(n: unknown): string {
  if (typeof n !== 'number' || isNaN(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function tipoSavingLabel(t: unknown): string {
  return t === 'pontual' ? 'pontual' : t === 'mensal' ? 'mensal' : '—'
}

type EventoLinha = { cargo?: string; horas_antes?: number; horas_depois?: number }
type EventoCustoItem = { nome?: string; valor?: number; recorrencia?: string }

/** Renderiza um evento do formulário como um cartão central, discreto e legível —
 * mostra os valores que o usuário marcou (saving mensal, horas, receita…) e, em
 * reentradas, o marcador "voltou e editou". */
function EventBubble({ event }: { event: FormEvent }) {
  const d = (event.dados ?? {}) as Record<string, unknown>
  const voltou = d.voltou === true
  const isAlerta = event.tipo === 'divergencia_memorial'

  // Título + etapa do "voltou" por tipo de evento
  const CONFIG: Record<string, { titulo: string; etapa: string }> = {
    submissao: { titulo: 'Formulário enviado (etapas 1 e 2)', etapa: 'Etapa inicial' },
    saving: { titulo: 'Saving informado', etapa: 'Etapa de Saving' },
    receita: { titulo: 'Receita informada', etapa: 'Etapa de Receita' },
    metadados: { titulo: 'Dados atualizados', etapa: 'Etapas anteriores' },
    tipos: { titulo: 'Tipo de projeto definido', etapa: 'Tipo de projeto' },
    submit: { titulo: 'Projeto submetido', etapa: 'Submissão' },
    divergencia_memorial: { titulo: 'Memorial × valor gravado divergem', etapa: 'Submissão' },
  }
  const cfg = CONFIG[event.tipo] ?? { titulo: event.tipo, etapa: 'Etapa' }

  // Constrói os pares label → valor a exibir, por tipo
  const rows: Array<{ label: string; value: string }> = []
  const chips: string[] = []

  if (event.tipo === 'submissao') {
    if (d.escopo) rows.push({ label: 'Escopo', value: String(d.escopo) })
    if (d.ferramenta) rows.push({ label: 'Ferramenta', value: String(d.ferramenta) })
    if (Array.isArray(d.tipos_projeto) && d.tipos_projeto.length > 0) rows.push({ label: 'Tipos', value: (d.tipos_projeto as string[]).join(', ') })
    if (d.servico_externo) rows.push({ label: 'Serviço externo', value: String(d.servico_externo) })
    if (Array.isArray(d.membros) && d.membros.length > 0) rows.push({ label: 'Membros', value: (d.membros as string[]).join(', ') })
    if (Array.isArray(d.arquivos) && d.arquivos.length > 0) rows.push({ label: 'Arquivos', value: (d.arquivos as string[]).join(', ') })
    if (d.especial === true) rows.push({ label: 'Especial', value: 'Sim' })
  } else if (event.tipo === 'saving') {
    rows.push({ label: 'Tipo', value: tipoSavingLabel(d.tipo_saving) })
    if (typeof d.economia_horas_mes === 'number') rows.push({ label: 'Economia (horas)', value: `${d.economia_horas_mes} h/mês` })
    if (typeof d.economia_reais_mes === 'number') rows.push({ label: 'Saving', value: `${fmtReais(d.economia_reais_mes)}/mês` })
    if (typeof d.custo_externo_mensal === 'number' && d.custo_externo_mensal > 0) rows.push({ label: 'Custo externo', value: `${fmtReais(d.custo_externo_mensal)}/mês` })
    if (typeof d.custo_evitado_mensal === 'number' && d.custo_evitado_mensal > 0) rows.push({ label: 'Custo evitado', value: `${fmtReais(d.custo_evitado_mensal)}/mês` })
    if (d.alguem_fazia) rows.push({ label: 'Alguém fazia antes', value: d.alguem_fazia === 'sim' ? 'Sim' : 'Não' })
    if (Array.isArray(d.linhas)) {
      for (const l of d.linhas as EventoLinha[]) {
        if (l && l.cargo != null) chips.push(`${l.cargo}: ${l.horas_antes ?? 0}h → ${l.horas_depois ?? 0}h`)
      }
    }
    if (Array.isArray(d.custo_evitado_itens)) {
      for (const it of d.custo_evitado_itens as EventoCustoItem[]) {
        if (it && it.nome != null) chips.push(`Evitado: ${it.nome} (${fmtReais(it.valor)}, ${it.recorrencia ?? '—'})`)
      }
    }
  } else if (event.tipo === 'receita') {
    rows.push({ label: 'Tipo', value: tipoSavingLabel(d.tipo_saving) })
    if (typeof d.valor_ganho_mensal === 'number') rows.push({ label: 'Receita', value: `${fmtReais(d.valor_ganho_mensal)}/mês` })
    if (d.racional) rows.push({ label: 'Racional', value: String(d.racional) })
  } else if (event.tipo === 'metadados') {
    if (d.reset_doc === true) rows.push({ label: 'Documentação', value: 'Reiniciada' })
    const campos = (d.campos ?? {}) as Record<string, unknown>
    const CAMPO_LABELS: Record<string, string> = {
      nome: 'Nome', area: 'Área', ferramenta: 'Ferramenta', membros: 'Membros',
      data_criacao: 'Data', descricao_breve: 'Descrição', contexto_especial: 'Contexto especial',
    }
    for (const [k, label] of Object.entries(CAMPO_LABELS)) {
      const v = campos[k]
      if (v == null) continue
      rows.push({ label, value: Array.isArray(v) ? (v as string[]).join(', ') : String(v) })
    }
    if (Array.isArray(d.arquivos) && d.arquivos.length > 0) rows.push({ label: 'Novos arquivos', value: (d.arquivos as string[]).join(', ') })
  } else if (event.tipo === 'tipos') {
    if (Array.isArray(d.tipos_projeto)) rows.push({ label: 'Tipos', value: (d.tipos_projeto as string[]).join(', ') })
  } else if (event.tipo === 'submit') {
    if (d.status) rows.push({ label: 'Status', value: String(d.status) })
    if (typeof d.ganho_total_mensal === 'number') rows.push({ label: 'Ganho total', value: `${fmtReais(d.ganho_total_mensal)}/mês` })
    if (d.reenvio === true) rows.push({ label: 'Tipo', value: 'Reenvio' })
  } else if (event.tipo === 'divergencia_memorial') {
    if (d.total_texto != null) rows.push({ label: 'No memorial (texto)', value: `${d.total_texto} h` })
    if (d.total_gravado != null) rows.push({ label: 'Gravado (planilha)', value: `${d.total_gravado} h` })
  }

  return (
    <div className="flex justify-center px-6 py-1">
      <div className={`w-full max-w-[88%] rounded-[var(--go-radius-sm)] border px-3 py-2 ${isAlerta ? 'border-[#dc2626]/40 bg-[#fef2f2]' : 'border-[var(--go-blue)]/10 bg-[var(--go-cream)]/50'}`}>
        {voltou && (
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-[#b45309]">
            <ArrowLeft className="h-3 w-3" />
            Voltou e editou — {cfg.etapa}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {isAlerta
            ? <AlertTriangle className="h-3 w-3 flex-shrink-0 text-[#dc2626]" />
            : <SlidersHorizontal className="h-3 w-3 flex-shrink-0 text-[var(--go-blue)]/45" />}
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${isAlerta ? 'text-[#dc2626]' : 'text-[var(--go-text-primary)]/45'}`}>
            {cfg.titulo}
          </span>
        </div>
        {rows.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {rows.map((r, i) => (
              <span key={i} className="text-[12px] text-[var(--go-text-primary)]/70">
                <span className="text-[var(--go-text-primary)]/40">{r.label}:</span>{' '}
                <span className="font-medium">{r.value}</span>
              </span>
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((c, i) => (
              <span key={i} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[var(--go-text-primary)]/65 border border-[var(--go-blue)]/10">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PhaseDivider({ phase, label }: { phase: PhaseGroup; label: string }) {
  const style = PHASE_STYLES[phase]
  return (
    <div className="flex items-center gap-3 py-3">
      <div className={`h-[2px] flex-1 ${style.divider}`} style={{ opacity: 0.15 }} />
      <div className="flex items-center gap-1.5">
        <div className={`h-2 w-2 rounded-full ${style.dot}`} />
        <span className={`text-[11px] font-bold uppercase tracking-widest ${style.badge} rounded-full px-2.5 py-0.5`}>
          {label}
        </span>
      </div>
      <div className={`h-[2px] flex-1 ${style.divider}`} style={{ opacity: 0.15 }} />
    </div>
  )
}

function ChatBubble({ msg, phase }: { msg: ChatMsg; phase: PhaseGroup }) {
  const [docExpanded, setDocExpanded] = useState(false)
  const isUser = msg.role === 'user'
  const isDoc = msg.role === 'doc'

  let displayContent = msg.content
  let typeTag: string | null = null
  let isMarkdown = false

  if (msg.role === 'assistant') {
    try {
      const parsed = JSON.parse(msg.content) as {
        fase?: string
        type?: string
        content?: string
        question?: string
      }
      typeTag = parsed.type ?? null
      displayContent = parsed.content ?? parsed.question ?? msg.content
      isMarkdown = true
    } catch {
      // não-JSON — mostra cru
    }
  }

  const phaseStyle = PHASE_STYLES[phase]

  // DOC message — minimal collapsed block
  if (isDoc) {
    return (
      <div className="mx-6 rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/6 bg-[var(--go-cream)]/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <FileText className="h-3 w-3 text-[var(--go-text-primary)]/25 flex-shrink-0" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--go-text-primary)]/30">
            Material extraído
          </span>
          <span className="text-[10px] text-[var(--go-text-primary)]/20 font-mono">
            {(msg.content.length / 1024).toFixed(1)}kb
          </span>
          {msg.content.length > 200 && (
            <button
              onClick={() => setDocExpanded(!docExpanded)}
              className="ml-auto text-[10px] font-medium text-[var(--go-blue)]/50 hover:text-[var(--go-blue)] transition-colors"
            >
              {docExpanded ? 'Recolher' : 'Expandir'}
            </button>
          )}
        </div>
        {docExpanded && (
          <pre
            className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--go-text-primary)]/40 font-mono max-h-[300px] overflow-y-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            {msg.content}
          </pre>
        )}
      </div>
    )
  }

  // User message — right side, distinct shape
  if (isUser) {
    return (
      <div className="flex justify-end pl-16">
        <div className="max-w-[85%] rounded-[var(--go-radius-md)] rounded-br-[4px] bg-[var(--go-blue)] px-4 py-2.5 text-white shadow-[var(--go-shadow-sm)]">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
            {displayContent}
          </p>
          <div className="mt-1 text-[10px] text-white/40 text-right">
            {formatTime(msg.created_at)}
          </div>
        </div>
      </div>
    )
  }

  // IA message — left side, colored left border by phase
  return (
    <div className="flex pr-16">
      <div
        className={`max-w-[85%] rounded-[var(--go-radius-md)] rounded-bl-[4px] border-l-[3px] ${phaseStyle.border} bg-white px-4 py-3 shadow-[var(--go-shadow-sm)]`}
      >
        {/* Compact header */}
        <div className="flex items-center gap-1.5 mb-2">
          <Bot className="h-3 w-3 text-[var(--go-text-primary)]/30" />
          <span className="text-[10px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider">
            Agente
          </span>
          {typeTag && (
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${phaseStyle.badge}`}>
              {typeTag}
            </span>
          )}
          <span className="text-[10px] text-[var(--go-text-primary)]/20 ml-auto tabular-nums">
            {formatTime(msg.created_at)}
          </span>
        </div>

        {isMarkdown ? (
          <MiniMarkdown text={displayContent} />
        ) : (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[var(--go-text-primary)]">
            {displayContent}
          </p>
        )}

        {/* Options */}
        {Array.isArray(msg.options) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(msg.options as string[]).map((opt, i) => (
              <span
                key={i}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  msg.selected_option === i
                    ? 'border-[var(--go-blue)] bg-[var(--go-blue)]/8 text-[var(--go-blue)] font-semibold'
                    : 'border-[var(--go-blue)]/10 text-[var(--go-text-primary)]/40'
                }`}
              >
                {opt}
                {msg.selected_option === i && (
                  <CheckCircle2 className="ml-1 inline h-3 w-3" />
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Renderizador de markdown compacto para o investigador. */
function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let listBuffer: string[] = []
  let key = 0

  function flushList() {
    if (listBuffer.length === 0) return
    elements.push(
      <ul key={key++} className="space-y-0.5 pl-0.5 my-1.5">
        {listBuffer.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--go-text-primary)]/80">
            <CircleDot className="mt-[5px] h-2.5 w-2.5 shrink-0 text-[var(--go-blue)]/25" />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>,
    )
    listBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    // H1
    if (/^# (?!#)/.test(line)) {
      flushList()
      elements.push(
        <h3 key={key++} className="text-[13px] font-bold text-[var(--go-text-primary)] mt-2.5 mb-0.5">
          {renderInline(line.replace(/^# /, ''))}
        </h3>,
      )
      continue
    }
    // H2
    if (line.startsWith('## ')) {
      flushList()
      elements.push(
        <div key={key++} className="mt-2.5 mb-1 flex items-center gap-2 border-b border-[var(--go-blue)]/8 pb-1">
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--go-blue)]/30" />
          <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--go-text-primary)]/45">
            {renderInline(line.replace(/^## /, ''))}
          </h4>
        </div>,
      )
      continue
    }
    // H3
    if (line.startsWith('### ')) {
      flushList()
      elements.push(
        <h5 key={key++} className="text-[13px] font-semibold text-[var(--go-text-primary)]/70 mt-2 mb-0.5">
          {renderInline(line.replace(/^### /, ''))}
        </h5>,
      )
      continue
    }
    // List items
    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      listBuffer.push(line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''))
      continue
    }
    // Indented list items
    if (/^\s+[-*]\s/.test(line)) {
      listBuffer.push(line.replace(/^\s+[-*]\s+/, ''))
      continue
    }
    // Empty line
    if (line.trim() === '') {
      flushList()
      continue
    }
    // Paragraph
    flushList()
    elements.push(
      <p key={key++} className="text-[13px] leading-relaxed my-0.5 text-[var(--go-text-primary)]/80">
        {renderInline(line)}
      </p>,
    )
  }

  flushList()
  return <>{elements}</>
}

/** Renderiza inline markdown: **bold**, *italic*, `code` */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /\*\*(.+?)\*\*|(?<!\*)\*([^*]+?)\*(?!\*)|\`([^`]+?)\`/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let k = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={k++}>{text.slice(lastIndex, match.index)}</span>)
    }
    if (match[1] !== undefined) {
      parts.push(
        <strong key={k++} className="font-semibold text-[var(--go-text-primary)]">
          {match[1]}
        </strong>,
      )
    } else if (match[2] !== undefined) {
      parts.push(
        <em key={k++} className="italic text-[var(--go-text-primary)]/65">
          {match[2]}
        </em>,
      )
    } else if (match[3] !== undefined) {
      parts.push(
        <code key={k++} className="rounded px-1 py-0.5 text-[12px] bg-[var(--go-blue)]/5 text-[var(--go-blue)] font-mono">
          {match[3]}
        </code>,
      )
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(<span key={k++}>{text.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : text
}

// ── Tab: Logs de API ─────────────────────────────────────────────────────────

// ── Componente: Seção de checkboxes dentro do popover de filtros ────────────

function FiltroSecao({
  titulo,
  opcoes,
  selecionados,
  onChange,
}: {
  titulo: string
  opcoes: { value: string; label: string }[]
  selecionados: string[]
  onChange: (next: string[]) => void
}) {
  if (opcoes.length === 0) return null
  const toggle = (v: string) => {
    onChange(selecionados.includes(v) ? selecionados.filter((s) => s !== v) : [...selecionados, v])
  }
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider mb-1.5">{titulo}</div>
      <div className="flex flex-wrap gap-1">
        {opcoes.map((o) => {
          const active = selecionados.includes(o.value)
          return (
            <button
              key={o.value}
              onClick={() => toggle(o.value)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-all ${
                active
                  ? 'bg-[var(--go-blue)] text-white border-[var(--go-blue)] shadow-sm'
                  : 'bg-white text-[var(--go-text-primary)]/60 border-[var(--go-blue)]/10 hover:border-[var(--go-blue)]/25 hover:text-[var(--go-text-primary)]'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Componente: Popover de filtros avançados ─────────────────────────────────

function FiltroPopover({
  filtros,
  onChange,
  areas,
  ferramentas,
}: {
  filtros: FiltrosAvancados
  onChange: (f: FiltrosAvancados) => void
  areas: string[]
  ferramentas: string[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const totalAtivos = filtros.status.length + filtros.fase.length + filtros.area.length +
    filtros.ferramenta.length + filtros.complexidade.length +
    (filtros.dataInicio ? 1 : 0) + (filtros.dataFim ? 1 : 0) +
    (filtros.chatCompleto !== 'todos' ? 1 : 0)

  const update = (patch: Partial<FiltrosAvancados>) => onChange({ ...filtros, ...patch })

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-[var(--go-radius-sm)] border px-3 py-2 text-xs font-medium transition-all ${
          totalAtivos > 0
            ? 'bg-[var(--go-blue)] text-white border-[var(--go-blue)] shadow-sm'
            : 'bg-white text-[var(--go-text-primary)]/50 border-[var(--go-blue)]/10 hover:text-[var(--go-blue)] hover:border-[var(--go-blue)]/25'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filtros
        {totalAtivos > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/25 px-1 text-[10px] font-bold">
            {totalAtivos}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[420px] rounded-[var(--go-radius)] border border-[var(--go-blue)]/10 bg-white shadow-xl shadow-black/8 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--go-blue)]/6 px-4 py-2.5">
            <span className="text-sm font-semibold text-[var(--go-text-primary)]">Filtros avançados</span>
            {totalAtivos > 0 && (
              <button
                onClick={() => onChange(FILTROS_AVANCADOS_DEFAULT)}
                className="text-[11px] text-[#dc2626] hover:text-[#dc2626]/80 font-medium"
              >
                Limpar tudo
              </button>
            )}
          </div>

          {/* Body */}
          <div className="max-h-[420px] overflow-y-auto p-4 space-y-4">
            <FiltroSecao
              titulo="Status"
              opcoes={Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              selecionados={filtros.status}
              onChange={(s) => update({ status: s })}
            />

            <FiltroSecao
              titulo="Fase"
              opcoes={Object.entries(FASE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              selecionados={filtros.fase}
              onChange={(f) => update({ fase: f })}
            />

            <FiltroSecao
              titulo="Área"
              opcoes={areas.map((a) => ({ value: a, label: a }))}
              selecionados={filtros.area}
              onChange={(a) => update({ area: a })}
            />

            <FiltroSecao
              titulo="Ferramenta"
              opcoes={ferramentas.map((f) => ({ value: f, label: f }))}
              selecionados={filtros.ferramenta}
              onChange={(f) => update({ ferramenta: f })}
            />

            <FiltroSecao
              titulo="Complexidade"
              opcoes={Object.entries(COMPLEXIDADE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              selecionados={filtros.complexidade}
              onChange={(c) => update({ complexidade: c })}
            />

            {/* Período */}
            <div>
              <div className="text-[10px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider mb-1.5">Data de Início</div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Calendar className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--go-text-primary)]/25" />
                  <input
                    type="date"
                    value={filtros.dataInicio ?? ''}
                    onChange={(e) => update({ dataInicio: e.target.value || null })}
                    className="w-full rounded-[6px] border border-[var(--go-blue)]/10 bg-white py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[var(--go-blue)]/25"
                    placeholder="De"
                  />
                </div>
                <span className="text-[var(--go-text-primary)]/20 text-xs">até</span>
                <div className="relative flex-1">
                  <Calendar className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--go-text-primary)]/25" />
                  <input
                    type="date"
                    value={filtros.dataFim ?? ''}
                    onChange={(e) => update({ dataFim: e.target.value || null })}
                    className="w-full rounded-[6px] border border-[var(--go-blue)]/10 bg-white py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[var(--go-blue)]/25"
                  />
                </div>
              </div>
            </div>

            {/* Chat completo */}
            <div>
              <div className="text-[10px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider mb-1.5">Formulário</div>
              <div className="flex gap-1">
                {([['todos', 'Todos'], ['completo', 'Completo'], ['em_andamento', 'Em andamento']] as const).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => update({ chatCompleto: v })}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-all ${
                      filtros.chatCompleto === v
                        ? 'bg-[var(--go-blue)] text-white border-[var(--go-blue)] shadow-sm'
                        : 'bg-white text-[var(--go-text-primary)]/60 border-[var(--go-blue)]/10 hover:border-[var(--go-blue)]/25'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente: Chips de filtros ativos ──────────────────────────────────────

function FiltroChips({
  filtros,
  onChange,
}: {
  filtros: FiltrosAvancados
  onChange: (f: FiltrosAvancados) => void
}) {
  const chips: { key: string; label: string; remove: () => void }[] = []

  filtros.status.forEach((s) =>
    chips.push({ key: `status-${s}`, label: `Status: ${STATUS_LABELS[s] ?? s}`, remove: () => onChange({ ...filtros, status: filtros.status.filter((x) => x !== s) }) })
  )
  filtros.fase.forEach((f) =>
    chips.push({ key: `fase-${f}`, label: `Fase: ${FASE_LABELS[f] ?? f}`, remove: () => onChange({ ...filtros, fase: filtros.fase.filter((x) => x !== f) }) })
  )
  filtros.area.forEach((a) =>
    chips.push({ key: `area-${a}`, label: `Área: ${a}`, remove: () => onChange({ ...filtros, area: filtros.area.filter((x) => x !== a) }) })
  )
  filtros.ferramenta.forEach((f) =>
    chips.push({ key: `ferr-${f}`, label: `Ferramenta: ${f}`, remove: () => onChange({ ...filtros, ferramenta: filtros.ferramenta.filter((x) => x !== f) }) })
  )
  filtros.complexidade.forEach((c) =>
    chips.push({ key: `comp-${c}`, label: `Complexidade: ${COMPLEXIDADE_LABELS[c] ?? c}`, remove: () => onChange({ ...filtros, complexidade: filtros.complexidade.filter((x) => x !== c) }) })
  )
  if (filtros.dataInicio)
    chips.push({ key: 'di', label: `De: ${filtros.dataInicio}`, remove: () => onChange({ ...filtros, dataInicio: null }) })
  if (filtros.dataFim)
    chips.push({ key: 'df', label: `Até: ${filtros.dataFim}`, remove: () => onChange({ ...filtros, dataFim: null }) })
  if (filtros.chatCompleto !== 'todos')
    chips.push({
      key: 'chat',
      label: filtros.chatCompleto === 'completo' ? 'Formulário completo' : 'Em andamento',
      remove: () => onChange({ ...filtros, chatCompleto: 'todos' }),
    })

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--go-blue)]/6 pl-2.5 pr-1 py-0.5 text-[11px] font-medium text-[var(--go-blue)]"
        >
          {c.label}
          <button
            onClick={c.remove}
            className="rounded-full p-0.5 hover:bg-[var(--go-blue)]/15 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        onClick={() => onChange(FILTROS_AVANCADOS_DEFAULT)}
        className="text-[11px] text-[#dc2626]/70 hover:text-[#dc2626] font-medium ml-1"
      >
        Limpar tudo
      </button>
    </div>
  )
}

// ── Componente: Visualizador de JSON com cópia e colapso inteligente ────────

function JsonBodyViewer({ label, body, icon }: { label: string; body: string | null; icon: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(true)
  const [copied, setCopied] = useState(false)

  if (!body) {
    return (
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-[var(--go-text-primary)]/30 uppercase tracking-wider mb-1 flex items-center gap-1">
          {icon} {label}
        </div>
        <div className="text-xs text-[var(--go-text-primary)]/20 italic">Sem dados</div>
      </div>
    )
  }

  // Tenta formatar como JSON bonito
  let formatted = body
  let isJson = false
  try {
    const parsed = JSON.parse(body)
    formatted = JSON.stringify(parsed, null, 2)
    isJson = true
  } catch { /* não é JSON, exibe raw */ }

  const lineCount = formatted.split('\n').length
  const isLarge = formatted.length > 3000 || lineCount > 60
  const displayText = collapsed && isLarge ? formatted.slice(0, 2000) + '\n\n…' : formatted

  const handleCopy = () => {
    navigator.clipboard.writeText(formatted)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-semibold text-[var(--go-text-primary)]/30 uppercase tracking-wider flex items-center gap-1">
          {icon} {label}
          {isJson && (
            <span className="ml-1 rounded bg-[var(--go-blue)]/6 px-1.5 py-0.5 text-[9px] text-[var(--go-blue)] font-medium">
              JSON
            </span>
          )}
          <span className="text-[var(--go-text-primary)]/20 font-normal normal-case">
            ({(body.length / 1024).toFixed(1)} KB{lineCount > 1 ? ` · ${lineCount} linhas` : ''})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isLarge && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-[var(--go-blue)] hover:text-[var(--go-blue)]/80 font-medium flex items-center gap-0.5 transition-colors"
            >
              {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
              {collapsed ? 'Expandir tudo' : 'Colapsar'}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="text-[var(--go-text-primary)]/30 hover:text-[var(--go-blue)] transition-colors p-0.5"
            title="Copiar"
          >
            {copied ? <Check className="h-3 w-3 text-[#16a34a]" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>
      <pre className="overflow-auto rounded-[var(--go-radius-sm)] bg-[var(--go-cream)]/50 border border-[var(--go-blue)]/5 p-2.5 text-[11px] leading-[1.55] font-mono text-[var(--go-text-primary)]/65 max-h-[400px] whitespace-pre-wrap break-all select-text">
        {displayText}
      </pre>
    </div>
  )
}

// ── Linha expandível de API Log ─────────────────────────────────────────────

function ApiLogRow({ log }: { log: ApiLog }) {
  const [expanded, setExpanded] = useState(false)
  const [bodyData, setBodyData] = useState<{ request_body: string | null; response_body: string | null } | null>(null)
  const [loading, setLoading] = useState(false)

  const isError = log.status_code >= 400
  const isSlow = (log.duration_ms ?? 0) > 5000

  const handleToggle = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (!bodyData) {
      setLoading(true)
      try {
        const data = await apiFetch<{ request_body: string | null; response_body: string | null }>(
          `/api/admin/investigador/log/${log.id}`
        )
        setBodyData(data)
      } catch {
        setBodyData({ request_body: null, response_body: null })
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <>
      <tr
        onClick={handleToggle}
        className={`border-b border-[var(--go-blue)]/4 cursor-pointer transition-colors group ${
          isError
            ? 'bg-[#dc2626]/3 hover:bg-[#dc2626]/6'
            : isSlow
              ? 'bg-[#ca8a04]/3 hover:bg-[#ca8a04]/6'
              : 'hover:bg-[var(--go-blue)]/3'
        } ${expanded ? '!border-b-0' : ''}`}
      >
        <td className="py-2 px-3 w-5">
          <div className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>
            <ChevronRight className="h-3.5 w-3.5 text-[var(--go-text-primary)]/25 group-hover:text-[var(--go-blue)]" />
          </div>
        </td>
        <td className="py-2 px-3 text-xs text-[var(--go-text-primary)]/40 whitespace-nowrap tabular-nums">
          {formatDateTime(log.created_at)}
        </td>
        <td className="py-2 px-3 font-mono text-xs text-[var(--go-text-primary)]/70">
          {log.endpoint.replace('/api/chat/', '')}
        </td>
        <td className={`py-2 px-3 text-xs text-right font-mono tabular-nums ${isSlow ? 'text-[#dc2626] font-bold' : 'text-[var(--go-text-primary)]/50'}`}>
          {formatDuration(log.duration_ms)}
        </td>
        <td className="py-2 px-3 text-right">
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              isError ? 'bg-[#dc2626]/8 text-[#dc2626]' : 'bg-[#16a34a]/8 text-[#16a34a]'
            }`}
          >
            {isError ? <XCircle className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
            {log.status_code}
          </span>
        </td>
        <td className="py-2 px-3 text-right text-xs text-[var(--go-text-primary)]/35 font-mono tabular-nums">
          {log.request_size != null ? `${(log.request_size / 1024).toFixed(1)}k` : '—'} /{' '}
          {log.response_size != null ? `${(log.response_size / 1024).toFixed(1)}k` : '—'}
        </td>
        <td className="py-2 px-3 text-xs text-[#dc2626] max-w-[200px] truncate" title={log.error ?? ''}>
          {log.error ?? <span className="text-[var(--go-text-primary)]/15">—</span>}
        </td>
      </tr>
      {expanded && (
        <tr className={`border-b border-[var(--go-blue)]/4 ${isError ? 'bg-[#dc2626]/2' : isSlow ? 'bg-[#ca8a04]/2' : 'bg-[var(--go-blue)]/2'}`}>
          <td colSpan={7} className="p-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--go-text-primary)]/30">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando body…
              </div>
            ) : bodyData && !bodyData.request_body && !bodyData.response_body ? (
              <div className="text-center py-4 text-xs text-[var(--go-text-primary)]/25 italic">
                <Eye className="mx-auto mb-1 h-4 w-4" />
                Corpo não disponível para este log (registrado antes da funcionalidade).
              </div>
            ) : bodyData ? (
              <div className="flex gap-3 flex-col lg:flex-row">
                <JsonBodyViewer
                  label="Request"
                  body={bodyData.request_body}
                  icon={<ArrowUpRight className="h-3 w-3 text-[var(--go-blue)]" />}
                />
                <JsonBodyViewer
                  label="Response"
                  body={bodyData.response_body}
                  icon={<ArrowDownLeft className="h-3 w-3 text-[#16a34a]" />}
                />
              </div>
            ) : null}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Tab: API Logs ───────────────────────────────────────────────────────────

function ApiLogsTab({ logs }: { logs: ApiLog[] }) {
  if (logs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--go-text-primary)]/30">
        <Zap className="mx-auto mb-2 h-5 w-5" />
        Nenhum log de API registrado.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/8 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--go-blue)]/8 text-left">
            <th className="py-2.5 px-3 w-5"></th>
            <th className="py-2.5 px-3 text-[11px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider">Quando</th>
            <th className="py-2.5 px-3 text-[11px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider">Endpoint</th>
            <th className="py-2.5 px-3 text-[11px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider text-right">Duração</th>
            <th className="py-2.5 px-3 text-[11px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider text-right">Status</th>
            <th className="py-2.5 px-3 text-[11px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider text-right">Req/Res</th>
            <th className="py-2.5 px-3 text-[11px] font-semibold text-[var(--go-text-primary)]/35 uppercase tracking-wider">Erro</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <ApiLogRow key={log.id} log={log} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab: Documentação / Análise ──────────────────────────────────────────────

function DadosTab({
  documentacao,
  analise,
}: {
  documentacao: unknown | null
  analise: ProjetoDetalhes['analise']
}) {
  const [justificativaExpandida, setJustificativaExpandida] = useState(false)
  const [criteriosExpandidos, setCriteriosExpandidos] = useState(false)

  const allCriterios = analise
    ? [...analise.criterios_hardcoded, ...analise.criterios_dinamicos]
    : []
  const cumpridos = allCriterios.filter((c) => c.pontos === 1)
  const descumpridos = allCriterios.filter((c) => c.pontos === 0)
  const pct = analise && analise.pontuacao_maxima > 0
    ? Math.round((analise.pontuacao_total / analise.pontuacao_maxima) * 100)
    : 0

  const complexidadeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    automacao: { label: 'Automação', icon: <Zap className="h-3.5 w-3.5" />, color: '#ca8a04' },
    inteligencia: { label: 'Inteligência', icon: <Sparkles className="h-3.5 w-3.5" />, color: '#7c3aed' },
    autonomia: { label: 'Autonomia', icon: <TrendingUp className="h-3.5 w-3.5" />, color: '#0d9488' },
  }

  return (
    <div className="space-y-4">
      {analise && (
        <>
          {/* ── Hero card: resultado + score + complexidade ─────────── */}
          <div
            className="relative overflow-hidden rounded-[var(--go-radius-md)] border bg-white"
            style={{
              borderColor: analise.resultado === 'aprovado' ? '#16a34a25' : '#f59e0b25',
            }}
          >
            {/* Faixa de cor sutil no topo */}
            <div
              className="h-1"
              style={{
                background: analise.resultado === 'aprovado'
                  ? 'linear-gradient(90deg, #16a34a, #22d3ee)'
                  : 'linear-gradient(90deg, #f59e0b, #f97316)',
              }}
            />

            <div className="p-5">
              <div className="flex items-start gap-5">
                {/* Score ring */}
                <div className="flex-shrink-0">
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <svg className="absolute inset-0 h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                      <circle
                        cx="40" cy="40" r="34"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="6"
                        className="text-[var(--go-blue)]/6"
                      />
                      <circle
                        cx="40" cy="40" r="34"
                        fill="none"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 34}`}
                        strokeDashoffset={`${2 * Math.PI * 34 * (1 - pct / 100)}`}
                        style={{
                          stroke: analise.resultado === 'aprovado' ? '#16a34a' : '#f59e0b',
                          transition: 'stroke-dashoffset 0.6s ease',
                        }}
                      />
                    </svg>
                    <div className="text-center">
                      <span className="text-lg font-bold text-[var(--go-text-primary)] tabular-nums leading-none">
                        {analise.pontuacao_total}
                      </span>
                      <span className="text-[11px] text-[var(--go-text-primary)]/30 font-medium">/{analise.pontuacao_maxima}</span>
                    </div>
                  </div>
                </div>

                {/* Resultado + complexidade */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${
                      analise.resultado === 'aprovado'
                        ? 'bg-[#16a34a]/10 text-[#16a34a]'
                        : 'bg-[#f59e0b]/10 text-[#b45309]'
                    }`}>
                      {analise.resultado === 'aprovado' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      {analise.resultado === 'aprovado' ? 'Aprovado' : analise.resultado === 'rejeitado' ? 'Em revisão' : analise.resultado}
                    </span>

                    {analise.complexidade && complexidadeConfig[analise.complexidade] && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                        style={{
                          backgroundColor: `${complexidadeConfig[analise.complexidade].color}12`,
                          color: complexidadeConfig[analise.complexidade].color,
                        }}
                      >
                        {complexidadeConfig[analise.complexidade].icon}
                        {complexidadeConfig[analise.complexidade].label}
                      </span>
                    )}
                  </div>

                  {/* Justificativa da complexidade */}
                  {analise.complexidade_justificativa && (
                    <p className="text-[12px] leading-relaxed text-[var(--go-text-primary)]/45 mb-2">
                      {analise.complexidade_justificativa}
                    </p>
                  )}

                  {/* Resumo */}
                  {analise.resumo && (
                    <div className="text-[13px] leading-relaxed text-[var(--go-text-primary)]/70">
                      <MiniMarkdown text={analise.resumo} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Critérios individuais ───────────────────────────────── */}
          {allCriterios.length > 0 && (
            <div className="rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/8 bg-white">
              <button
                onClick={() => setCriteriosExpandidos(!criteriosExpandidos)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-[var(--go-blue)]/2"
              >
                <div className="flex items-center gap-2.5">
                  <Shield className="h-4 w-4 text-[var(--go-blue)]/40" />
                  <span className="text-[13px] font-semibold text-[var(--go-text-primary)]">
                    Critérios avaliados
                  </span>
                  <span className="text-[12px] text-[var(--go-text-primary)]/40 tabular-nums">
                    {cumpridos.length} de {allCriterios.length} cumpridos
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Mini bar */}
                  <div className="hidden sm:flex items-center gap-1 w-28">
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--go-blue)]/6 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${allCriterios.length > 0 ? (cumpridos.length / allCriterios.length) * 100 : 0}%`,
                          backgroundColor: descumpridos.length === 0 ? '#16a34a' : cumpridos.length >= descumpridos.length ? '#16a34a' : '#f59e0b',
                        }}
                      />
                    </div>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-[var(--go-text-primary)]/25 transition-transform duration-200 ${criteriosExpandidos ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {criteriosExpandidos && (
                <div className="border-t border-[var(--go-blue)]/6 px-5 py-4" style={{ animation: 'go-slide-down 0.2s ease' }}>
                  <div className="space-y-2">
                    {/* Descumpridos primeiro */}
                    {descumpridos.map((c, i) => (
                      <CriterioItem key={`desc-${i}`} criterio={c} />
                    ))}
                    {descumpridos.length > 0 && cumpridos.length > 0 && (
                      <div className="flex items-center gap-3 py-1.5">
                        <div className="h-px flex-1 bg-[var(--go-blue)]/6" />
                        <span className="text-[10px] font-medium text-[var(--go-text-primary)]/25 uppercase tracking-wider">Cumpridos</span>
                        <div className="h-px flex-1 bg-[var(--go-blue)]/6" />
                      </div>
                    )}
                    {cumpridos.map((c, i) => (
                      <CriterioItem key={`cump-${i}`} criterio={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Parecer completo da IA ──────────────────────────────── */}
          {analise.justificativa && (
            <div className="rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/8 bg-white">
              <button
                onClick={() => setJustificativaExpandida(!justificativaExpandida)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-[var(--go-blue)]/2"
              >
                <div className="flex items-center gap-2.5">
                  <Bot className="h-4 w-4 text-[var(--go-blue)]/40" />
                  <span className="text-[13px] font-semibold text-[var(--go-text-primary)]">
                    Parecer completo da IA
                  </span>
                </div>
                <ChevronDown className={`h-4 w-4 text-[var(--go-text-primary)]/25 transition-transform duration-200 ${justificativaExpandida ? 'rotate-180' : ''}`} />
              </button>

              {justificativaExpandida && (
                <div className="border-t border-[var(--go-blue)]/6 px-5 py-4" style={{ animation: 'go-slide-down 0.2s ease' }}>
                  <MiniMarkdown text={analise.justificativa} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Documentação gerada ──────────────────────────────────── */}
      <div className="rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/8 bg-white p-5">
        <h3 className="text-[11px] font-semibold text-[var(--go-blue)]/50 uppercase tracking-wider mb-3 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" />
          Documentação gerada
        </h3>
        {documentacao ? (
          <pre className="overflow-x-auto text-[12px] bg-[var(--go-cream)]/40 border border-[var(--go-blue)]/6 rounded-[var(--go-radius-sm)] p-4 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[var(--go-text-primary)]/60 leading-relaxed" style={{ scrollbarWidth: 'thin' }}>
            {JSON.stringify(documentacao, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-[var(--go-text-primary)]/30">Documentação ainda não gerada.</p>
        )}
      </div>
    </div>
  )
}

/** Renderiza um critério individual com indicador visual e justificativa. */
function CriterioItem({ criterio }: { criterio: { criterio: string; pontos: number; justificativa: string } }) {
  const ok = criterio.pontos === 1
  return (
    <div className="flex items-start gap-3 group">
      {/* Indicator dot */}
      <div className={`mt-[7px] flex-shrink-0 h-2 w-2 rounded-full ${
        ok ? 'bg-[#16a34a]' : 'bg-[#dc2626]'
      }`} />
      <div className="min-w-0 flex-1">
        <span className={`text-[13px] font-medium ${ok ? 'text-[var(--go-text-primary)]' : 'text-[#b91c1c]'}`}>
          {criterio.criterio}
        </span>
        {criterio.justificativa && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--go-text-primary)]/50">
            {criterio.justificativa}
          </p>
        )}
      </div>
      {/* Inline status chip */}
      <div className="flex-shrink-0 mt-0.5">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-[#16a34a]/60" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-[#dc2626]/60" />
        )}
      </div>
    </div>
  )
}
