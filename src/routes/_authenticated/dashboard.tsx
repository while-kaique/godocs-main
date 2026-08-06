/**
 * Dashboard do admin — a esteira de triagem.
 *
 * De onde vêm os dados: `GET /api/admin/dashboard/projetos`, que lê a PLANILHA
 * (`readAllRows`), não o SQLite. Foi a correção de fundo desta tela: lendo o banco, ela
 * mostrava rascunho (estado interno que nunca vai à planilha) e um "Status" que não é
 * fonte de verdade. Ver `src/lib/dashboard-admin.functions.ts`.
 *
 * Por que filtrar e paginar no cliente: a planilha tem centenas de linhas, e o servidor
 * já manda um índice de busca normalizado por projeto. Filtrar em memória responde na
 * tecla; ir ao servidor a cada letra seria mais lento e não mais correto.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { ChipEstadoParecer } from '@/components/dashboard/parecer-lider';
import { ProjetoDetalheDialog } from '@/components/dashboard/projeto-detalhe-dialog';
import { SkeletonLinhas } from '@/components/dashboard/skeleton-linhas';
import { STATUS_TRIAGEM, pilulaDe, corDaRegua } from '@/components/dashboard/status-triagem';
import {
  filtrarPorTermo,
  compararProjetos,
  paginasVisiveis,
  type Ordem,
  type Direcao,
} from '@/components/dashboard/tabela-utils';
import { apiFetch } from '@/lib/api-client';
import { consumirPrefetchDashboard } from '@/lib/dashboard-prefetch';
import { fmtDataBR } from '@/lib/format-date';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-admin.functions';

export const Route = createFileRoute('/_authenticated/dashboard')({
  head: () => ({ meta: [{ title: 'Triagem de projetos · GoDocs Admin' }] }),
  component: Dashboard,
});

type Listagem = {
  projetos: ProjetoDashboardResumo[];
  contagem: Record<string, number>;
  total: number;
  lidoEm: string;
  doCache: boolean;
  revalidando: boolean;
};

const TAMANHOS = [25, 50, 100] as const;

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

function fmtGanho(v: number | null) {
  return v == null ? '—' : moeda.format(v);
}

function Dashboard() {
  const [dados, setDados] = useState<Listagem | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [filtro, setFiltro] = useState<string>('todos');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('data');
  const [direcao, setDirecao] = useState<Direcao>('desc');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState<number>(25);
  const [aberto, setAberto] = useState<ProjetoDashboardResumo | null>(null);

  const inputBusca = useRef<HTMLInputElement>(null);

  async function carregar(refresh = false) {
    if (refresh) setAtualizando(true);
    else setCarregando(true);
    setErro(null);
    try {
      // O `beforeLoad` do layout admin já disparou esta leitura em paralelo com o auth
      // (ver `dashboard-prefetch.ts`). Se a promise existe, consome; senão, pede agora.
      const prefetchado = refresh ? null : consumirPrefetchDashboard<Listagem>();
      const d =
        (prefetchado ? await prefetchado : null) ??
        (await apiFetch<Listagem>(
          `/api/admin/dashboard/projetos${refresh ? '?refresh=1' : ''}`,
        ));
      setDados(d);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  // Debounce curto: o filtro é local, então 120 ms já basta para não recalcular a lista
  // a cada tecla em listas grandes, sem a busca parecer travada.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca), 120);
    return () => clearTimeout(t);
  }, [busca]);

  // "/" foca a busca (atalho de quem passa o dia varrendo a lista); Esc limpa.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      const digitando =
        !!alvo &&
        (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);
      if (e.key === '/' && !digitando) {
        e.preventDefault();
        inputBusca.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setPagina(1);
  }, [filtro, buscaAplicada, porPagina]);

  const projetos = dados?.projetos ?? [];

  // Contagem por pílula (agrega os rótulos legados no equivalente atual).
  const contagemPilula = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of projetos) {
      const k = pilulaDe(p.statusChave);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }, [projetos]);

  const filtrados = useMemo(() => {
    const porStatus =
      filtro === 'todos' ? projetos : projetos.filter((p) => pilulaDe(p.statusChave) === filtro);
    const buscados = filtrarPorTermo(porStatus, buscaAplicada);
    const sinal = direcao === 'asc' ? 1 : -1;
    return [...buscados].sort((a, b) => compararProjetos(a, b, ordem) * sinal);
  }, [projetos, filtro, buscaAplicada, ordem, direcao]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const visiveis = filtrados.slice(inicio, inicio + porPagina);

  function alternarOrdem(nova: Ordem) {
    if (ordem === nova) {
      setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdem(nova);
      setDirecao(nova === 'nome' || nova === 'autor' ? 'asc' : 'desc');
    }
  }

  // Reflete na tela a mudança que já foi gravada na planilha, sem reler tudo.
  function aplicarStatusSalvo(id: string, status: string, observacoes: string | undefined) {
    setDados((d) =>
      d
        ? {
            ...d,
            projetos: d.projetos.map((p) =>
              p.id === id
                ? {
                    ...p,
                    status,
                    statusChave: status.toLowerCase(),
                    observacoes: observacoes !== undefined ? observacoes : p.observacoes,
                  }
                : p,
            ),
          }
        : d,
    );
    setAberto((a) => (a && a.id === id ? { ...a, status, statusChave: status.toLowerCase() } : a));
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
            Triagem de projetos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tudo que está na planilha, do jeito que a validação vê. Clique num projeto para abrir
            a ficha e decidir o status.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dados && (
            <span className="text-xs text-muted-foreground">
              Planilha lida às{' '}
              {new Date(dados.lidoEm).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {/* SWR: a lista já está na tela e a planilha está sendo relida no servidor.
              Ícone + texto (nunca só cor) e sem bloquear nada. */}
          {dados?.revalidando && !atualizando && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <RefreshCw className="h-3 w-3 animate-spin motion-reduce:animate-none" />
              Atualizando em segundo plano
            </span>
          )}
          <Button variant="outline" onClick={() => carregar(true)} disabled={atualizando}>
            {atualizando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Atualizar
          </Button>
        </div>
      </header>

      {erro && (
        <div className="mt-6 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Não foi possível ler a planilha.</p>
            <p className="mt-0.5 opacity-90">{erro}</p>
          </div>
        </div>
      )}

      {/* Filtros por status — são também a contagem de cada fila da triagem.
          Estado ativo tem ícone + borda + fundo, nunca só cor. */}
      <div className="mt-6 flex flex-wrap gap-2">
        <PilulaFiltro
          ativa={filtro === 'todos'}
          cor="var(--go-blue)"
          rotulo="Todos"
          contagem={carregando ? null : projetos.length}
          onClick={() => setFiltro('todos')}
        />
        {STATUS_TRIAGEM.map((s) => {
          const n = contagemPilula[s.chave] ?? 0;
          // Enquanto carrega, TODAS as filas aparecem com contagem "—": a faixa já tem a
          // silhueta final e o clique funciona (o filtro é local). Depois, fila vazia só
          // aparece se estiver selecionada — a faixa fica legível.
          if (!carregando && n === 0 && filtro !== s.chave) return null;
          const Icone = s.icon;
          return (
            <PilulaFiltro
              key={s.chave}
              ativa={filtro === s.chave}
              cor={s.cor}
              rotulo={s.curto}
              contagem={carregando ? null : n}
              icone={<Icone className="h-3.5 w-3.5" />}
              onClick={() => setFiltro(s.chave)}
            />
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputBusca}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setBusca('')}
            placeholder="Buscar por projeto, autor, e-mail, área ou ID…   ( / )"
            aria-label="Buscar projetos"
            className="h-10 w-full rounded-full border border-input bg-card pl-9 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            style={{ ['--tw-ring-color' as string]: 'var(--go-blue)' }}
          />
          {busca && (
            <button
              type="button"
              onClick={() => {
                setBusca('');
                inputBusca.current?.focus();
              }}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* Também é o anúncio de carregamento: as linhas-fantasma são `aria-hidden`,
            então quem usa leitor de tela ouve o estado por aqui. */}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {carregando ? (
            'Lendo a planilha…'
          ) : (
            <>
              <strong className="font-semibold tabular-nums text-foreground">
                {filtrados.length}
              </strong>{' '}
              {filtrados.length === 1 ? 'projeto' : 'projetos'}
              {filtrados.length !== projetos.length && ` de ${projetos.length}`}
            </>
          )}
        </p>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Por página
          <select
            value={porPagina}
            onChange={(e) => setPorPagina(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {TAMANHOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <Th onClick={() => alternarOrdem('nome')} ativa={ordem === 'nome'} direcao={direcao}>
                  Projeto
                </Th>
                <Th
                  onClick={() => alternarOrdem('autor')}
                  ativa={ordem === 'autor'}
                  direcao={direcao}
                >
                  Autor
                </Th>
                <Th className="hidden lg:table-cell">Área</Th>
                <Th>Status</Th>
                {/* Pré-aprovação do líder ao lado do Status, para a triagem já chegar
                    ciente do parecer sem abrir a ficha (pedido do Luis, 05/08/2026). */}
                <Th className="hidden md:table-cell">Pré-status</Th>
                <Th className="hidden xl:table-cell">Complexidade</Th>
                <Th
                  className="text-right"
                  onClick={() => alternarOrdem('ganho')}
                  ativa={ordem === 'ganho'}
                  direcao={direcao}
                >
                  Ganho total
                </Th>
                <Th
                  className="hidden sm:table-cell"
                  onClick={() => alternarOrdem('data')}
                  ativa={ordem === 'data'}
                  direcao={direcao}
                >
                  Enviado
                </Th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <SkeletonLinhas />
              ) : visiveis.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-sm text-muted-foreground">
                    {projetos.length === 0
                      ? 'A planilha não devolveu nenhum projeto.'
                      : 'Nenhum projeto casa com esse filtro. Limpe a busca ou escolha outra fila.'}
                  </td>
                </tr>
              ) : (
                visiveis.map((p) => (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Abrir ficha de ${p.nome ?? p.id}`}
                    onClick={() => setAberto(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAberto(p);
                      }
                    }}
                    className="group cursor-pointer border-b border-border/70 outline-none transition-colors last:border-0 hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
                    style={{ ['--tw-ring-color' as string]: 'var(--go-blue)' }}
                  >
                    {/* Régua de triagem: a cor do status na borda esquerda deixa a
                        composição da fila legível sem ler texto. */}
                    <td className="relative py-2.5 pl-5 pr-3">
                      <span
                        aria-hidden
                        className="absolute left-0 top-0 h-full w-[3px]"
                        style={{ background: corDaRegua(p.statusChave) }}
                      />
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[320px] truncate text-[13.5px] font-semibold">
                          {p.nome ?? 'Projeto sem nome'}
                        </span>
                        {p.especial && (
                          <Sparkles
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: '#8a7d00' }}
                            aria-label="Projeto especial"
                          />
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] uppercase text-muted-foreground">
                        {p.id}
                        {p.tipos ? (
                          <span className="ml-2 font-sans normal-case">{p.tipos}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="max-w-[180px] truncate text-[13px]">{p.autor ?? '—'}</div>
                      <div className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                        {p.email ?? ''}
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 text-[12.5px] lg:table-cell">
                      <span className="block max-w-[160px] truncate">{p.area ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={p.statusChave} />
                    </td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      {p.aprovacaoLider ? (
                        <ChipEstadoParecer estado={p.aprovacaoLider} compacto />
                      ) : (
                        // Projeto sem fila nenhuma (legado, isento): "—" quieto em vez de
                        // um chip "Sem parecer" repetido em centenas de linhas.
                        <span className="text-[12.5px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 text-[12.5px] xl:table-cell">
                      {p.complexidade ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[13px] font-medium tabular-nums">
                      {fmtGanho(p.ganhoTotal)}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-[12.5px] text-muted-foreground sm:table-cell">
                      {p.dataSubmissao ? fmtDataBR(p.dataSubmissao) : '—'}
                    </td>
                    <td className="pr-3 text-muted-foreground">
                      <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filtrados.length > 0 && (
        <nav
          className="mt-4 flex flex-wrap items-center justify-between gap-3"
          aria-label="Paginação"
        >
          <p className="text-xs tabular-nums text-muted-foreground">
            {inicio + 1}–{Math.min(inicio + porPagina, filtrados.length)} de {filtrados.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={paginaSegura <= 1}
            >
              <ChevronLeft /> Anterior
            </Button>
            {paginasVisiveis(paginaSegura, totalPaginas).map((n, i) =>
              n === null ? (
                <span key={`gap-${i}`} className="px-1 text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPagina(n)}
                  aria-current={n === paginaSegura ? 'page' : undefined}
                  className="h-8 min-w-8 rounded-md px-2 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  style={
                    n === paginaSegura
                      ? { background: 'var(--go-blue)', color: '#fff' }
                      : { border: '1px solid var(--border)' }
                  }
                >
                  {n}
                </button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={paginaSegura >= totalPaginas}
            >
              Próxima <ChevronRight />
            </Button>
          </div>
        </nav>
      )}

      <ProjetoDetalheDialog
        projeto={aberto}
        onFechar={() => setAberto(null)}
        onStatusSalvo={aplicarStatusSalvo}
      />
    </div>
  );
}

function PilulaFiltro({
  ativa,
  cor,
  rotulo,
  contagem,
  icone,
  onClick,
}: {
  ativa: boolean;
  cor: string;
  rotulo: string;
  /** `null` = ainda carregando: mostra "—" em vez de um 0 que parece fila vazia. */
  contagem: number | null;
  icone?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
      style={{
        background: ativa ? cor : 'var(--card)',
        color: ativa ? '#fff' : 'var(--foreground)',
        border: `1px solid ${ativa ? cor : 'var(--border)'}`,
        ['--tw-ring-color' as string]: cor,
      }}
    >
      {icone}
      {rotulo}
      <span
        className="rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
        style={{
          background: ativa ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.05)',
          color: ativa ? '#fff' : 'var(--muted-foreground)',
        }}
      >
        {contagem ?? '—'}
      </span>
    </button>
  );
}

function Th({
  children,
  className = '',
  onClick,
  ativa,
  direcao,
}: {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  ativa?: boolean;
  direcao?: Direcao;
}) {
  const base = `px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground ${className}`;
  if (!onClick) return <th className={base}>{children}</th>;
  return (
    <th
      className={base}
      aria-sort={ativa ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
        {ativa ? (
          direcao === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}
