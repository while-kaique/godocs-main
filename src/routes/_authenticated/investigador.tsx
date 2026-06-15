import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback, useRef } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Search,
  AlertTriangle,
  Clock,
  MessageSquare,
  Activity,
  ChevronRight,
  ArrowLeft,
  Zap,
  XCircle,
  CheckCircle2,
  Timer,
  Loader2,
  Filter,
  RefreshCw,
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
    resumo: string | null
    complexidade: string | null
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

const FASE_COLORS: Record<string, string> = {
  aguardando_inicio: 'bg-gray-100 text-gray-600',
  doc: 'bg-blue-100 text-blue-700',
  doc_preview: 'bg-blue-50 text-blue-600',
  saving: 'bg-lime-100 text-lime-700',
  saving_preview: 'bg-lime-50 text-lime-600',
  receita: 'bg-emerald-100 text-emerald-700',
  receita_preview: 'bg-emerald-50 text-emerald-600',
  completo: 'bg-green-100 text-green-700',
}

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  em_validacao: 'Em validação',
  validado: 'Validado',
  rejeitado: 'Rejeitado',
  aprovado: 'Aprovado',
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

function isActiveNow(p: ProjetoInvestigador): boolean {
  // Só rascunhos podem estar "sendo preenchidos"
  if (p.status !== 'rascunho') return false
  // Usa o último log de API como sinal real de atividade (chamadas ao /api/chat/*)
  const ref = p.ultimo_log_api
  if (!ref) return false
  const lastApiCall = new Date(ref + (ref.endsWith('Z') ? '' : 'Z')).getTime()
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  return lastApiCall > fiveMinAgo
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
    <div className="mx-auto max-w-6xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Search className="h-7 w-7 text-primary" />
            Investigador
          </h1>
          <p className="mt-1 text-muted-foreground">
            Monitore projetos em tempo real — preenchimento, chat e performance da API.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Atualização automática
          </div>
          <span>
            Última: {lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Stats globais */}
      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Preenchendo agora" value={ativos} icon={<Activity className="h-4 w-4 text-green-600" />} highlight={ativos > 0} />
          <StatCard label="Total projetos" value={projetos.length} icon={<MessageSquare className="h-4 w-4 text-blue-600" />} />
          <StatCard label="Chamadas API" value={stats.total_chamadas} icon={<Zap className="h-4 w-4 text-yellow-600" />} />
          <StatCard label="Erros API" value={stats.total_erros} icon={<XCircle className="h-4 w-4 text-red-600" />} highlight={stats.total_erros > 0} />
          <StatCard label="Tempo médio" value={formatDuration(stats.media_duracao_ms)} icon={<Timer className="h-4 w-4 text-purple-600" />} />
        </div>
      )}

      {/* Filtros + busca */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {([
            ['todos', 'Todos', null],
            ['ativos', 'Ativos agora', ativos],
            ['com_erros', 'Com erros', projetos.filter((p) => p.tem_erro).length],
            ['lentos', 'Lentos (>5s)', projetos.filter((p) => (p.max_duracao_api_ms ?? 0) > 5000).length],
          ] as [Filtro, string, number | null][]).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setFiltro(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filtro === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {label}
              {count != null && count > 0 && (
                <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">{count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome, responsável, e-mail ou área..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {/* Lista de projetos */}
      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando projetos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            <Filter className="mx-auto mb-2 h-5 w-5" />
            Nenhum projeto encontrado com os filtros atuais.
          </div>
        ) : (
          <div className="space-y-2">
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
  highlight,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-3 ${highlight ? 'border-primary/30 bg-primary/5' : 'border-border'}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  )
}

function ProjetoCard({ projeto: p, onClick }: { projeto: ProjetoInvestigador; onClick: () => void }) {
  const active = isActiveNow(p)

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card px-4 py-3 transition-all hover:border-primary/30 hover:shadow-sm"
    >
      <div className="flex items-center gap-3">
        {/* Indicador de ativo */}
        <div className="flex-shrink-0">
          {active ? (
            <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" title="Preenchendo agora" />
          ) : (
            <div className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          )}
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{p.nome ?? 'Projeto sem nome'}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${FASE_COLORS[p.fase_atual] ?? 'bg-gray-100 text-gray-600'}`}>
              {FASE_LABELS[p.fase_atual] ?? p.fase_atual}
            </span>
            {p.status && p.status !== 'rascunho' && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {STATUS_LABELS[p.status] ?? p.status}
              </span>
            )}
            {p.tem_erro && (
              <span className="flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700">
                <AlertTriangle className="h-3 w-3" />
                {p.total_erros_api} erro{p.total_erros_api !== 1 ? 's' : ''}
              </span>
            )}
            {p.max_duracao_api_ms != null && p.max_duracao_api_ms > 5000 && (
              <span className="flex items-center gap-0.5 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] text-yellow-700">
                <Clock className="h-3 w-3" />
                Lento
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {p.responsavel_nome} · {p.area_nome ?? 'Sem área'} · {p.ferramenta}
          </div>
        </div>

        {/* Métricas rápidas */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
          <div className="text-center" title="Mensagens (usuário / IA)">
            <div className="font-medium text-foreground">{p.total_mensagens_usuario}/{p.total_mensagens_ia}</div>
            <div className="text-[10px]">msgs</div>
          </div>
          <div className="text-center" title="Tempo desde início">
            <div className="font-medium text-foreground">{formatTimeSince(p.tempo_desde_inicio_min)}</div>
            <div className="text-[10px]">duração</div>
          </div>
          <div className="text-center" title="Tempo médio de resposta da API">
            <div className={`font-medium ${(p.media_duracao_api_ms ?? 0) > 5000 ? 'text-red-600' : 'text-foreground'}`}>
              {formatDuration(p.media_duracao_api_ms)}
            </div>
            <div className="text-[10px]">API média</div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando detalhes...
      </div>
    )
  }

  if (!detalhes) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>Projeto não encontrado.</p>
        <button onClick={onBack} className="mt-4 text-sm text-primary underline">
          Voltar
        </button>
      </div>
    )
  }

  const d = detalhes

  return (
    <div className="mx-auto max-w-6xl p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{d.nome ?? 'Projeto sem nome'}</h1>
          <p className="text-sm text-muted-foreground">
            {d.responsavel_nome} ({d.responsavel_email}) · {d.area_nome ?? 'Sem área'} · {d.ferramenta}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {/* Métricas do projeto */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
        <MiniStat label="Fase atual" value={FASE_LABELS[d.fase_atual] ?? d.fase_atual} color={FASE_COLORS[d.fase_atual]} />
        <MiniStat label="Status" value={STATUS_LABELS[d.status ?? 'rascunho'] ?? d.status ?? '—'} />
        <MiniStat label="Msgs (usr/ia)" value={`${d.total_mensagens_usuario} / ${d.total_mensagens_ia}`} />
        <MiniStat label="Duração total" value={formatTimeSince(d.tempo_desde_inicio_min)} />
        <MiniStat label="API média" value={formatDuration(d.media_duracao_api_ms)} warn={(d.media_duracao_api_ms ?? 0) > 5000} />
        <MiniStat label="Erros API" value={String(d.total_erros_api)} warn={d.total_erros_api > 0} />
      </div>

      {/* Dados das etapas */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Etapa 1 — Envio</h3>
          <div className="space-y-1 text-sm">
            <KV label="Escopo" value={d.step1.escopo} />
            <KV label="Ferramenta" value={d.step1.ferramenta} />
            <KV label="Área" value={d.step1.area_nome} />
            <KV label="Serviço externo" value={d.step1.servico_externo} />
            <KV label="Membros" value={d.step1.membros.length > 0 ? d.step1.membros.join(', ') : null} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Etapa 2 — Projeto</h3>
          <div className="space-y-1 text-sm">
            <KV label="Nome" value={d.step2.nome} />
            <KV label="Tipos" value={d.step2.tipos_projeto?.join(', ')} />
            <KV label="Data criação" value={d.step2.data_criacao_projeto} />
            <KV label="Descrição" value={d.step2.descricao_breve} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex items-center gap-1 border-b border-border">
        {([
          ['chat', 'Histórico do chat', d.chat_messages.length],
          ['api_logs', 'Logs de API', d.api_logs.length],
          ['dados', 'Documentação / Análise', null],
        ] as [string, string, number | null][]).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {count != null && <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>}
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

function MiniStat({ label, value, color, warn }: { label: string; value: string; color?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${warn ? 'text-red-600' : ''}`}>
        {color ? (
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${color}`}>{value}</span>
        ) : (
          value
        )}
      </div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground text-xs w-28 flex-shrink-0">{label}:</span>
      <span className="text-foreground">{value || <span className="text-muted-foreground/50 italic">—</span>}</span>
    </div>
  )
}

// ── Tab: Histórico do chat ───────────────────────────────────────────────────

function ChatTab({ messages }: { messages: ChatMsg[] }) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Nenhuma mensagem de chat ainda.</p>
  }

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
      {messages.map((msg) => (
        <ChatBubble key={msg.id} msg={msg} />
      ))}
    </div>
  )
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const [docExpanded, setDocExpanded] = useState(false)
  const isUser = msg.role === 'user'
  const isDoc = msg.role === 'doc'

  let displayContent = msg.content
  let faseTag: string | null = null
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
      faseTag = parsed.fase ?? null
      typeTag = parsed.type ?? null
      displayContent = parsed.content ?? parsed.question ?? msg.content
      isMarkdown = true
    } catch {
      // não-JSON — mostra cru
    }
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        isUser
          ? 'border-blue-200 bg-blue-50/70 ml-8'
          : isDoc
            ? 'border-amber-200/60 bg-amber-50/40'
            : 'border-border bg-card mr-8'
      }`}
    >
      {/* Header com badges */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            isUser
              ? 'bg-blue-200 text-blue-800'
              : isDoc
                ? 'bg-amber-200 text-amber-800'
                : 'bg-gray-200 text-gray-700'
          }`}
        >
          {isUser ? 'USUÁRIO' : isDoc ? 'DOC' : 'IA'}
        </span>
        {faseTag && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${FASE_COLORS[faseTag] ?? 'bg-gray-100 text-gray-600'}`}>
            {FASE_LABELS[faseTag] ?? faseTag}
          </span>
        )}
        {typeTag && (
          <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">
            {typeTag}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {formatDateTime(msg.created_at)}
        </span>
      </div>

      {/* Conteúdo */}
      {isDoc ? (
        // Bloco DOC: colapsável, monospace
        <div>
          <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground font-mono max-h-[80px] overflow-hidden"
            style={docExpanded ? { maxHeight: 'none' } : undefined}
          >
            {msg.content}
          </pre>
          {msg.content.length > 200 && (
            <button
              onClick={() => setDocExpanded(!docExpanded)}
              className="mt-1 text-[10px] text-amber-700 hover:underline font-medium"
            >
              {docExpanded ? '▲ Recolher' : `▼ Expandir (${(msg.content.length / 1024).toFixed(1)}kb)`}
            </button>
          )}
        </div>
      ) : isMarkdown ? (
        // IA: renderiza markdown
        <MiniMarkdown text={displayContent} />
      ) : (
        // Usuário: texto simples
        <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
          {displayContent}
        </p>
      )}

      {/* Opções */}
      {msg.options && Array.isArray(msg.options) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(msg.options as string[]).map((opt, i) => (
            <span
              key={i}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                msg.selected_option === i
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {opt}
              {msg.selected_option === i && ' ✓'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Renderizador de markdown compacto e neutro para o investigador. */
function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let listBuffer: string[] = []
  let key = 0

  function flushList() {
    if (listBuffer.length === 0) return
    elements.push(
      <ul key={key++} className="space-y-0.5 pl-0.5 my-1">
        {listBuffer.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed">
            <span className="mt-[7px] block h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    )
    listBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    // H1
    if (/^# (?!#)/.test(line)) {
      flushList()
      elements.push(
        <h3 key={key++} className="text-xs font-bold text-foreground mt-2 mb-0.5">
          {renderInline(line.replace(/^# /, ''))}
        </h3>
      )
      continue
    }
    // H2
    if (line.startsWith('## ')) {
      flushList()
      elements.push(
        <div key={key++} className="mt-2 mb-0.5 flex items-center gap-1.5 border-b border-border/50 pb-1">
          <div className="h-1 w-1 rounded-full bg-primary/50" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {renderInline(line.replace(/^## /, ''))}
          </h4>
        </div>
      )
      continue
    }
    // H3
    if (line.startsWith('### ')) {
      flushList()
      elements.push(
        <h5 key={key++} className="text-xs font-semibold text-foreground/80 mt-1.5 mb-0.5">
          {renderInline(line.replace(/^### /, ''))}
        </h5>
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
      <p key={key++} className="text-xs leading-relaxed my-0.5">
        {renderInline(line)}
      </p>
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
      parts.push(<strong key={k++} className="font-semibold text-foreground">{match[1]}</strong>)
    } else if (match[2] !== undefined) {
      parts.push(<em key={k++} className="italic opacity-85">{match[2]}</em>)
    } else if (match[3] !== undefined) {
      parts.push(
        <code key={k++} className="rounded px-1 py-0.5 text-[10.5px] bg-muted font-mono">
          {match[3]}
        </code>
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

function ApiLogsTab({ logs }: { logs: ApiLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Nenhum log de API registrado.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Quando</th>
            <th className="py-2 pr-3 font-medium">Endpoint</th>
            <th className="py-2 pr-3 font-medium text-right">Duração</th>
            <th className="py-2 pr-3 font-medium text-right">Status</th>
            <th className="py-2 pr-3 font-medium text-right">Req/Res</th>
            <th className="py-2 font-medium">Erro</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => {
            const isError = log.status_code >= 400
            const isSlow = (log.duration_ms ?? 0) > 5000
            return (
              <tr
                key={log.id}
                className={`border-b border-border/50 ${isError ? 'bg-red-50' : isSlow ? 'bg-yellow-50' : ''}`}
              >
                <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                  {formatDateTime(log.created_at)}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs">
                  {log.endpoint.replace('/api/chat/', '')}
                </td>
                <td className={`py-1.5 pr-3 text-xs text-right font-mono ${isSlow ? 'text-red-600 font-bold' : ''}`}>
                  {formatDuration(log.duration_ms)}
                </td>
                <td className="py-1.5 pr-3 text-right">
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {isError ? <XCircle className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
                    {log.status_code}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground font-mono">
                  {log.request_size != null ? `${(log.request_size / 1024).toFixed(1)}k` : '—'} /{' '}
                  {log.response_size != null ? `${(log.response_size / 1024).toFixed(1)}k` : '—'}
                </td>
                <td className="py-1.5 text-xs text-red-600 max-w-[200px] truncate" title={log.error ?? ''}>
                  {log.error ?? '—'}
                </td>
              </tr>
            )
          })}
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
  return (
    <div className="space-y-4">
      {analise && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Análise automática
          </h3>
          <div className="space-y-1 text-sm">
            <KV label="Resultado" value={analise.resultado} />
            <KV label="Pontuação" value={`${analise.pontuacao_total} / ${analise.pontuacao_maxima}`} />
            <KV label="Complexidade" value={analise.complexidade} />
            {analise.resumo && (
              <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
                {analise.resumo}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Documentação gerada
        </h3>
        {documentacao ? (
          <pre className="overflow-x-auto text-xs bg-muted/50 rounded-lg p-3 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words">
            {JSON.stringify(documentacao, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Documentação ainda não gerada.</p>
        )}
      </div>
    </div>
  )
}
