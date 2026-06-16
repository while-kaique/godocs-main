import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Search,
  AlertTriangle,
  Clock,
  MessageSquare,
  Activity,
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

function isActiveNow(p: ProjetoInvestigador): boolean {
  if (p.status !== 'rascunho') return false
  const ref = p.ultimo_log_api
  if (!ref) return false
  const lastApiCall = new Date(ref + (ref.endsWith('Z') ? '' : 'Z')).getTime()
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  return lastApiCall > fiveMinAgo
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
  const [stats, setStats] = useState<InvestigadorStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState<ProjetoDetalhes | null>(null)
  const [detalhesLoading, setDetalhesLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        apiFetch<ProjetoInvestigador[]>('/api/admin/investigador/projetos'),
        apiFetch<InvestigadorStats>('/api/admin/investigador/stats'),
      ])
      setProjetos(p ?? [])
      setStats(s ?? null)
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

  const loadDetalhes = useCallback(async (id: string) => {
    setSelectedId(id)
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

  // Filtragem
  const filtered = projetos.filter((p) => {
    if (filtro === 'ativos' && !isActiveNow(p)) return false
    if (filtro === 'com_erros' && !p.tem_erro) return false
    if (filtro === 'lentos' && (p.max_duracao_api_ms == null || p.max_duracao_api_ms <= 5000)) return false
    if (busca) {
      const q = busca.toLowerCase()
      const match =
        (p.nome ?? '').toLowerCase().includes(q) ||
        p.responsavel_nome.toLowerCase().includes(q) ||
        p.responsavel_email.toLowerCase().includes(q) ||
        (p.area_nome ?? '').toLowerCase().includes(q)
      if (!match) return false
    }
    return true
  })

  const ativos = projetos.filter(isActiveNow).length

  // Tempo médio de conclusão (apenas projetos completos)
  const completedDurations = projetos
    .filter((p) => p.chat_completo && p.tempo_desde_inicio_min != null)
    .map((p) => p.tempo_desde_inicio_min!)
  const avgCompletionMin = completedDurations.length > 0
    ? Math.round(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
    : null

  if (selectedId) {
    return (
      <DetalheView
        detalhes={detalhes}
        loading={detalhesLoading}
        onBack={() => {
          setSelectedId(null)
          setDetalhes(null)
        }}
        onRefresh={() => loadDetalhes(selectedId)}
      />
    )
  }

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
                Monitore projetos em tempo real
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
          <StatCard label="Preenchendo agora" value={ativos} icon={<Activity className="h-4 w-4" />} color="#16a34a" highlight={ativos > 0} />
          <StatCard label="Total projetos" value={projetos.length} icon={<MessageSquare className="h-4 w-4" />} color="var(--go-blue)" />
          <StatCard label="Chamadas API" value={stats.total_chamadas} icon={<Zap className="h-4 w-4" />} color="#ca8a04" />
          <StatCard label="Erros API" value={stats.total_erros} icon={<XCircle className="h-4 w-4" />} color="#dc2626" highlight={stats.total_erros > 0} />
          <StatCard label="Tempo médio" value={formatTimeSince(avgCompletionMin)} icon={<Timer className="h-4 w-4" />} color="#7c3aed" />
        </div>
      )}

      {/* Filtros + busca */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-0.5 rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/8 bg-white p-0.5">
          {([
            ['todos', 'Todos', null],
            ['ativos', 'Ativos agora', ativos],
            ['com_erros', 'Com erros', projetos.filter((p) => p.tem_erro).length],
            ['lentos', 'Lentos (>5s)', projetos.filter((p) => (p.max_duracao_api_ms ?? 0) > 5000).length],
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

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--go-text-primary)]/30" />
          <input
            type="text"
            placeholder="Buscar por nome, responsável, e-mail ou área..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/10 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-shadow focus:border-[var(--go-blue)]/25 focus:shadow-[0_0_0_3px_rgba(0,89,169,0.06)]"
          />
        </div>

        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 rounded-[var(--go-radius-sm)] border border-[var(--go-blue)]/10 bg-white px-3 py-2 text-xs text-[var(--go-text-primary)]/50 hover:text-[var(--go-blue)] hover:border-[var(--go-blue)]/25 transition-all"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {/* Lista de projetos */}
      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--go-text-primary)]/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando projetos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[var(--go-radius-md)] border border-dashed border-[var(--go-blue)]/15 bg-white/50 p-8 text-center text-sm text-[var(--go-text-primary)]/40">
            <Filter className="mx-auto mb-2 h-5 w-5" />
            Nenhum projeto encontrado com os filtros atuais.
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((p) => (
              <ProjetoCard key={p.id} projeto={p} onClick={() => loadDetalhes(p.id)} />
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

function ProjetoCard({ projeto: p, onClick }: { projeto: ProjetoInvestigador; onClick: () => void }) {
  const active = isActiveNow(p)
  const group = getPhaseGroup(p.fase_atual)
  const style = PHASE_STYLES[group]

  return (
    <button
      onClick={onClick}
      className={`group relative w-full text-left overflow-hidden rounded-[var(--go-radius-md)] border border-[var(--go-blue)]/8 bg-white pl-0 pr-4 py-3 transition-all hover:border-[var(--go-blue)]/18 hover:shadow-[var(--go-shadow-sm)]`}
    >
      {/* Phase accent stripe */}
      <div className={`absolute top-0 left-0 h-full w-1 ${style.border.replace('border-l-', 'bg-')}`} />

      <div className="flex items-center gap-3 pl-4">
        {/* Indicador de ativo */}
        <div className="flex-shrink-0">
          {active ? (
            <div className="h-2.5 w-2.5 rounded-full bg-[#16a34a] animate-pulse ring-4 ring-[#16a34a]/10" title="Preenchendo agora" />
          ) : (
            <div className={`h-2 w-2 rounded-full ${style.dot}`} style={{ opacity: 0.35 }} />
          )}
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-[var(--go-text-primary)] truncate group-hover:text-[var(--go-blue)] transition-colors">
              {p.nome ?? 'Projeto sem nome'}
            </span>
            {p.fase_atual !== 'completo' && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${FASE_BADGE[p.fase_atual] ?? PHASE_STYLES.idle.badge}`}>
                {FASE_LABELS[p.fase_atual] ?? p.fase_atual}
              </span>
            )}
            {p.status && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[p.status] ?? 'bg-[var(--go-blue)]/5 text-[var(--go-blue)]/70'}`}>
                {STATUS_LABELS[p.status] ?? p.status}
              </span>
            )}
            {p.tem_erro && (
              <span className="flex items-center gap-0.5 rounded-full bg-[#dc2626]/8 px-2 py-0.5 text-[10px] text-[#dc2626] font-semibold">
                <AlertTriangle className="h-3 w-3" />
                {p.total_erros_api} erro{p.total_erros_api !== 1 ? 's' : ''}
              </span>
            )}
            {p.max_duracao_api_ms != null && p.max_duracao_api_ms > 5000 && (
              <span className="flex items-center gap-0.5 rounded-full bg-[#ca8a04]/8 px-2 py-0.5 text-[10px] text-[#ca8a04] font-semibold">
                <Clock className="h-3 w-3" />
                Lento
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
          <div className="text-center" title="Mensagens (usuário / IA)">
            <div className="font-semibold text-[var(--go-text-primary)]/80 tabular-nums text-[13px]">{p.total_mensagens_usuario}/{p.total_mensagens_ia}</div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">msgs</div>
          </div>
          <div className="text-center" title="Tempo desde início">
            <div className={`font-semibold tabular-nums text-[13px] ${
              p.fase_atual === 'completo' ? 'text-[#16a34a]'
                : p.fase_atual === 'saving' || p.fase_atual === 'receita' ? 'text-[#ea580c]'
                : p.fase_atual === 'documentacao' ? 'text-[var(--go-blue)]'
                : 'text-[var(--go-text-primary)]/80'
            }`}>{formatTimeSince(p.tempo_desde_inicio_min)}</div>
            <div className="text-[10px] text-[var(--go-text-primary)]/30 font-medium">duração</div>
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

// ── Detalhe de um projeto ────────────────────────────────────────────────────

function DetalheView({
  detalhes,
  loading,
  onBack,
  onRefresh,
}: {
  detalhes: ProjetoDetalhes | null
  loading: boolean
  onBack: () => void
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'chat' | 'api_logs' | 'dados'>('chat')
  const [dadosOpen, setDadosOpen] = useState(false)

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
              <MiniStat label="Duração" value={formatTimeSince(d.tempo_desde_inicio_min)} />
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

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-1 rounded-[var(--go-radius-sm)] bg-[var(--go-blue)]/4 p-1">
        {([
          ['chat', 'Chat', d.chat_messages.length],
          ['api_logs', 'Logs de API', d.api_logs.length],
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
        {tab === 'chat' && <ChatTab messages={d.chat_messages} />}
        {tab === 'api_logs' && <ApiLogsTab logs={d.api_logs} />}
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

// ── Tab: Histórico do chat ───────────────────────────────────────────────────

function ChatTab({ messages }: { messages: ChatMsg[] }) {
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Group messages by phase and insert dividers
  const groupedMessages = useMemo(() => {
    if (messages.length === 0) return []

    const result: Array<{ type: 'divider'; phase: PhaseGroup; label: string } | { type: 'message'; msg: ChatMsg; phase: PhaseGroup }> = []
    let currentPhase: PhaseGroup | null = null

    for (const msg of messages) {
      // DOC messages don't change the phase context
      if (msg.role === 'doc') {
        result.push({ type: 'message', msg, phase: currentPhase ?? 'doc' })
        continue
      }

      const phase: PhaseGroup = msg.role === 'assistant' ? detectMsgPhase(msg) : (currentPhase ?? 'doc')

      // Insert phase divider when phase changes
      if (msg.role === 'assistant' && phase !== currentPhase) {
        currentPhase = phase
        const style = PHASE_STYLES[phase]
        result.push({ type: 'divider', phase, label: style.label })
      }

      if (msg.role === 'user' && currentPhase === null) {
        currentPhase = 'doc'
      }

      result.push({ type: 'message', msg, phase: currentPhase ?? 'doc' })
    }

    return result
  }, [messages])

  if (messages.length === 0) {
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
        {groupedMessages.map((item, i) => {
          if (item.type === 'divider') {
            return <PhaseDivider key={`div-${i}`} phase={item.phase} label={item.label} />
          }
          return <ChatBubble key={item.msg.id} msg={item.msg} phase={item.phase} />
        })}
        <div ref={chatEndRef} />
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
