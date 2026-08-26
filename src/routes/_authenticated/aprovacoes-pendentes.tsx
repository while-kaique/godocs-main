/**
 * Aba TEMPORÁRIA — Aprovação de pendentes/pré-aprovados, agrupada por AUTOR.
 *
 * Irmã da `/especiais`, mas sem estrelas: aqui a fila é o fluxo normal que ainda depende do
 * time de RPA para aprovar (pendentes e pré-aprovados), e a coluna é a PESSOA que submeteu.
 * Quem tem vários projetos aparece numa coluna só — e o toggle "só quem tem 2+" isola essas
 * pessoas, para chamar cada uma e validar tudo de uma vez (pedido do Luis).
 *
 * O que herda da `/especiais` sem redigitar: a régua de fila/espera/divisão (`especiais-view`),
 * as ações de triagem (`especiais-acoes` + `POST /api/admin/dashboard/status`), a ficha
 * completa (`ProjetoDetalheDialog`) e a divisão por área (`POST /api/admin/especiais/dono`).
 * O que muda: o eixo da coluna (autor), o escopo (pendentes/pré-aprovados) e o toggle de 2+.
 *
 * Ver `src/lib/aprovacao-pendentes-view.ts` (puro) e `src/lib/aprovacao-pendentes.functions.ts`.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  RotateCcw,
  Users,
  ChevronDown,
  Loader2,
  Search,
  RefreshCw,
  ClipboardList,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HistoricoButton } from '@/components/historico/historico-button';
import { StatusBadge } from '@/components/status-badge';
import { ProjetoDetalheDialog } from '@/components/dashboard/projeto-detalhe-dialog';
import { apiFetch } from '@/lib/api-client';
import { fmtDataBR } from '@/lib/format-date';
import {
  CARTOES_INICIAIS,
  CARTOES_INCREMENTO,
  FILTROS_PENDENTES_VAZIOS,
  agruparPorAutor,
  apenasAutoresComMultiplos,
  areasDosProjetos,
  cargaPorDono,
  casaDono,
  chaveArea,
  contarFiltrosPendentes,
  diasDeEspera,
  aguardaDecisao,
  filaDe,
  filasPresentes,
  ROTULO_FILA,
  rotuloValidador,
  urgenciaDaEspera,
  type ColunaAutor,
  type DonoDeArea,
  type Fila,
  type FiltrosPendentes,
  type ValidadorEspeciais,
} from '@/lib/aprovacao-pendentes-view';
import { casaPeriodo } from '@/lib/dashboard-filtros';
import {
  PERGUNTA_MOTIVO,
  STATUS_GRAVAVEIS_ESPECIAIS,
  acoesDisponiveis,
  campoDoMotivo,
  precisaMotivo,
  rotuloAcao,
  type AcaoTriagem,
} from '@/lib/especiais-acoes';
import { filtrarPorTermo } from '@/components/dashboard/tabela-utils';
import { QuemFezOQue } from '@/components/admin/quem-fez-o-que';
import type { ContribuicaoParticipante } from '@/lib/participantes-contribuicoes';
import { SeletorPeriodo } from '@/components/calendario/calendario';
import { hojeIso } from '@/lib/calendario-datas';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-admin.functions';
import { useTituloPagina } from '@/lib/use-titulo-pagina';
import { SECAO } from '@/lib/titulo-pagina';

// Título da aba: montado no componente (`useTituloPagina`) para levar o nome do projeto
// com a ficha aberta. Ver `src/lib/titulo-pagina.ts`.
export const Route = createFileRoute('/_authenticated/aprovacoes-pendentes')({
  component: AprovacaoPendentes,
});

type Listagem = {
  projetos: ProjetoDashboardResumo[];
  contribuicoes: Record<string, ContribuicaoParticipante[]>;
  donos: DonoDeArea[];
  validadores: ValidadorEspeciais[];
  lidoEm: string;
  espelhoVelho: boolean;
};

const AZUL = 'var(--go-blue)';

function AprovacaoPendentes() {
  const [dados, setDados] = useState<Listagem | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosPendentes>(FILTROS_PENDENTES_VAZIOS);
  // "Mais antigos primeiro" (opção do "Período"): reordena os projetos DENTRO de cada
  // coluna do mais antigo ao mais novo. Fora de `filtros` porque não filtra nada — só ordena.
  const [maisAntigos, setMaisAntigos] = useState(false);
  // Quantos cartões cada coluna mostra. Chaveado pela coluna, zerado a cada filtro novo.
  const [mostrando, setMostrando] = useState<Record<string, number>>({});
  const [divisaoAberta, setDivisaoAberta] = useState(false);
  const [fichaAberta, setFichaAberta] = useState<ProjetoDashboardResumo | null>(null);
  // "Agora" congelado: recalcular a cada render faria o chip de espera pular de faixa.
  const [agoraMs] = useState(() => Date.now());
  // Título da aba: com a ficha aberta vale o nome do projeto que está sendo aprovado.
  useTituloPagina(
    SECAO.aprovacoesPendentes,
    fichaAberta ? (fichaAberta.nome ?? fichaAberta.id) : null,
  );
  // Mapa `id do projeto → o que cada participante fez`. Vem do BANCO, ao lado da
  // listagem (a linha da planilha não tem este texto); `{}` enquanto carrega e para
  // build antiga do servidor, que não manda a chave — o cartão só não desenha o bloco.
  const contribuicoesPorProjeto = dados?.contribuicoes ?? {};

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      setDados(await apiFetch<Listagem>('/api/admin/aprovacao-pendentes'));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os projetos.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const donoPor = useMemo(
    () => new Map((dados?.donos ?? []).map((d) => [chaveArea(d.area), d])),
    [dados],
  );

  const colunas = useMemo(() => {
    if (!dados) return [];
    let visiveis = dados.projetos;
    if (filtros.dono) visiveis = visiveis.filter((p) => casaDono(p, filtros.dono, donoPor));
    if (filtros.fila !== 'todos') visiveis = visiveis.filter((p) => filaDe(p) === filtros.fila);
    if (filtros.periodo) visiveis = visiveis.filter((p) => casaPeriodo(p, filtros.periodo));
    if (filtros.termo.trim()) visiveis = filtrarPorTermo(visiveis, filtros.termo);
    // O toggle "só 2+" roda por ÚLTIMO, sobre o que sobrou: quem tem vários respeita os
    // outros filtros (ver `apenasAutoresComMultiplos`).
    if (filtros.soMultiplos) visiveis = apenasAutoresComMultiplos(visiveis);
    return agruparPorAutor(visiveis, maisAntigos);
  }, [dados, filtros, donoPor, maisAntigos]);

  // Filtro novo = lista nova: zera o "carregar mais" para não mostrar 12 numa coluna que a
  // pessoa acabou de reduzir.
  useEffect(() => {
    setMostrando({});
  }, [filtros]);

  const filas = useMemo(
    () => (dados ? filasPresentes(dados.projetos, filaDe) : []),
    [dados],
  );

  /** Nome de quem valida este projeto (`null` quando ninguém pegou a área ainda). */
  function rotuloDono(p: ProjetoDashboardResumo): string | null {
    const d = donoPor.get(chaveArea(p.area) || 'SEM ÁREA')?.dono_email ?? null;
    return d ? rotuloValidador(d, dados?.validadores ?? []) : null;
  }

  /**
   * Decide o projeto DAQUI — a MESMA escrita do `/dashboard`
   * (`POST /api/admin/dashboard/status` → `definirStatusProjeto`), com a mesma auditoria em
   * `admin_status_log` e a regra de nunca tocar "Atualizado Em".
   *
   * Otimista: o cartão muda de status na hora e volta atrás se a planilha recusar.
   */
  async function decidir(projeto: ProjetoDashboardResumo, acao: AcaoTriagem, motivo: string) {
    const status = STATUS_GRAVAVEIS_ESPECIAIS[acao];
    const campo = campoDoMotivo(acao);
    const anterior = { status: projeto.status, statusChave: projeto.statusChave };
    setSalvando(projeto.id);
    setDados((d) =>
      d
        ? {
            ...d,
            projetos: d.projetos.map((p) =>
              p.id === projeto.id ? { ...p, status, statusChave: status.toLowerCase() } : p,
            ),
          }
        : d,
    );
    try {
      await apiFetch('/api/admin/dashboard/status', {
        projeto_id: projeto.id,
        status,
        ...(campo ? { [campo]: motivo } : {}),
      });
      setErro(null);
    } catch (e) {
      setDados((d) =>
        d
          ? {
              ...d,
              projetos: d.projetos.map((p) => (p.id === projeto.id ? { ...p, ...anterior } : p)),
            }
          : d,
      );
      setErro(
        `"${projeto.nome ?? projeto.id}" continua como estava — a planilha não aceitou a mudança. ${
          e instanceof Error ? e.message : ''
        }`.trim(),
      );
    } finally {
      setSalvando(null);
    }
  }

  async function definirDono(area: string, email: string | null) {
    const validador = (dados?.validadores ?? []).find((v) => v.email === email);
    try {
      await apiFetch('/api/admin/especiais/dono', {
        area,
        dono_email: email,
        dono_nome: validador?.nome ?? undefined,
      });
      await carregar(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a divisão.');
    }
  }

  const total = dados?.projetos.length ?? 0;
  const autoresMultiplos = useMemo(
    () => (dados ? agruparPorAutor(dados.projetos).filter((c) => c.total >= 2).length : 0),
    [dados],
  );
  const visiveis = colunas.reduce((n, c) => n + c.total, 0);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">Aprovação de pendentes</h1>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: 'rgba(154,98,6,0.12)', color: '#9a6206' }}
              >
                Temporária
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
              Os projetos pendentes e pré-aprovados que dependem do time de RPA, uma coluna por
              pessoa. Quem tem mais de um projeto aparece junto, para validar tudo de uma vez.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <HistoricoButton />
            <Button variant="outline" size="sm" onClick={() => setDivisaoAberta(true)}>
              <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Divisão por pessoa
            </Button>
            <Button variant="outline" size="sm" onClick={() => void carregar(true)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Atualizar
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Placa rotulo="Na fila do RPA" valor={total} />
          <Placa
            rotulo="Autores com 2+ projetos"
            valor={autoresMultiplos}
            destaque={autoresMultiplos > 0}
            aoClicar={() => setFiltros((f) => ({ ...f, soMultiplos: !f.soMultiplos }))}
            ativo={filtros.soMultiplos}
          />
          <div className="ml-auto flex items-end pb-1 text-[11.5px] text-muted-foreground">
            {dados && (
              <span className="inline-flex items-center gap-1.5">
                {dados.espelhoVelho && (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                )}
                Planilha sincronizada às {fmtHora(dados.lidoEm)}
                {dados.espelhoVelho && ' (há mais de 20 min)'}
              </span>
            )}
          </div>
        </div>

        {/* Barra de filtros: busca + validador + situação + período + toggle de 2+ (AND). */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={filtros.termo}
              onChange={(e) => setFiltros((f) => ({ ...f, termo: e.target.value }))}
              placeholder="Buscar projeto, autor, área…"
              aria-label="Buscar entre os projetos pendentes"
              className="h-9 w-[260px] rounded-full border bg-card pl-9 pr-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2"
              style={{ ['--tw-ring-color' as string]: AZUL }}
            />
          </div>

          <select
            value={filtros.dono ?? ''}
            onChange={(e) => setFiltros((f) => ({ ...f, dono: e.target.value || null }))}
            aria-label="Filtrar por quem valida"
            className="h-9 rounded-full border bg-card px-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2"
            style={{ ['--tw-ring-color' as string]: AZUL }}
          >
            <option value="">Todos os validadores</option>
            {(dados?.validadores ?? []).map((v) => (
              <option key={v.email} value={v.email}>
                {v.nome?.trim() || v.email}
              </option>
            ))}
            <option value="sem-dono">Sem dono</option>
          </select>

          <select
            value={filtros.fila}
            onChange={(e) => setFiltros((f) => ({ ...f, fila: e.target.value }))}
            aria-label="Filtrar por situação"
            className="h-9 rounded-full border bg-card px-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2"
            style={{ ['--tw-ring-color' as string]: AZUL }}
          >
            <option value="todos">Todas as situações</option>
            {filas.map((f) => (
              <option key={f.chave} value={f.chave}>
                {ROTULO_FILA[f.chave as Fila] ?? f.chave} ({f.total})
              </option>
            ))}
          </select>

          <SeletorPeriodo
            valor={filtros.periodo}
            onChange={(periodo) => setFiltros((f) => ({ ...f, periodo }))}
            maximo={hojeIso()}
            ordenarMaisAntigos={maisAntigos}
            onOrdenarMaisAntigos={setMaisAntigos}
          />

          <button
            type="button"
            aria-pressed={filtros.soMultiplos}
            onClick={() => setFiltros((f) => ({ ...f, soMultiplos: !f.soMultiplos }))}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
            style={{
              background: filtros.soMultiplos ? AZUL : 'var(--card)',
              color: filtros.soMultiplos ? '#fff' : 'var(--foreground)',
              borderColor: filtros.soMultiplos ? AZUL : 'var(--border)',
              ['--tw-ring-color' as string]: AZUL,
            }}
          >
            {filtros.soMultiplos && <Check className="h-3.5 w-3.5" aria-hidden />}
            Só quem tem 2+ projetos
          </button>

          {contarFiltrosPendentes(filtros) > 0 && (
            <button
              type="button"
              onClick={() => setFiltros(FILTROS_PENDENTES_VAZIOS)}
              className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2"
              style={{ ['--tw-ring-color' as string]: AZUL }}
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Limpar
              {contarFiltrosPendentes(filtros) > 1 && ` (${contarFiltrosPendentes(filtros)})`}
            </button>
          )}

          <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">
            {colunas.length} {colunas.length === 1 ? 'pessoa' : 'pessoas'} · {visiveis}{' '}
            {visiveis === 1 ? 'projeto' : 'projetos'}
          </span>
        </div>
      </header>

      {erro && (
        <div
          role="alert"
          className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span className="flex-1">{erro}</span>
          <button
            type="button"
            onClick={() => setErro(null)}
            aria-label="Fechar aviso"
            className="rounded p-0.5 hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {carregando ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Carregando a fila…
        </div>
      ) : total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <ClipboardList className="h-6 w-6" aria-hidden />
          <p className="text-sm">Nenhum projeto pendente ou pré-aprovado na fila do RPA.</p>
        </div>
      ) : visiveis === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <Search className="h-6 w-6" aria-hidden />
          <p className="text-sm">Nenhum projeto casa com os filtros.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto px-6 py-5">
          <div className="flex min-w-max items-start gap-4 pb-40">
            {colunas.map((coluna) => (
              <Coluna
                key={coluna.chave}
                coluna={coluna}
                contribuicoes={contribuicoesPorProjeto}
                rotuloDono={rotuloDono}
                agoraMs={agoraMs}
                onDecidir={decidir}
                onAbrirFicha={setFichaAberta}
                salvando={salvando}
                mostrando={mostrando[coluna.chave] ?? CARTOES_INICIAIS}
                onMostrarMais={() =>
                  setMostrando((m) => ({
                    ...m,
                    [coluna.chave]: (m[coluna.chave] ?? CARTOES_INICIAIS) + CARTOES_INCREMENTO,
                  }))
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Reusa o diálogo da triagem inteiro — a ficha é a linha da planilha. O status salvo
          lá reflete aqui na hora, sem recarregar a lista. */}
      <ProjetoDetalheDialog
        projeto={fichaAberta}
        onFechar={() => setFichaAberta(null)}
        onStatusSalvo={(id, status) =>
          setDados((d) =>
            d
              ? {
                  ...d,
                  projetos: d.projetos.map((p) =>
                    p.id === id ? { ...p, status, statusChave: status.toLowerCase() } : p,
                  ),
                }
              : d,
          )
        }
      />

      {divisaoAberta && dados && (
        <PainelDivisao
          projetos={dados.projetos}
          donoPor={donoPor}
          validadores={dados.validadores}
          onFechar={() => setDivisaoAberta(false)}
          onDefinir={definirDono}
          onFiltrarPor={(email) => {
            setFiltros((f) => ({ ...f, dono: email }));
            setDivisaoAberta(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Placa de número do cabeçalho. Com `aoClicar` vira filtro (é o caso de "Autores com 2+"),
 * e aí o estado ATIVO é dito por borda, fundo E `aria-pressed`, nunca só por cor.
 */
function Placa({
  rotulo,
  valor,
  destaque,
  aoClicar,
  ativo,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
  aoClicar?: () => void;
  ativo?: boolean;
}) {
  const conteudo = (
    <>
      <span
        className="text-[20px] font-semibold leading-none tabular-nums"
        style={{ color: ativo ? '#fff' : destaque && valor > 0 ? AZUL : 'var(--foreground)' }}
      >
        {valor}
      </span>
      <span
        className="mt-1 block text-[11px] leading-none"
        style={{ color: ativo ? 'rgba(255,255,255,0.85)' : 'var(--muted-foreground)' }}
      >
        {rotulo}
      </span>
    </>
  );
  const estilo = {
    background: ativo ? AZUL : 'var(--card)',
    borderColor: ativo ? AZUL : 'var(--border)',
  };
  if (!aoClicar) {
    return (
      <div className="rounded-lg border px-3 py-2" style={estilo}>
        {conteudo}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativo}
      className="rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--go-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
      style={{ ...estilo, ['--tw-ring-color' as string]: AZUL }}
    >
      {conteudo}
    </button>
  );
}

function fmtHora(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Coluna de um autor ──────────────────────────────────────────────────────

function Coluna({
  coluna,
  contribuicoes,
  rotuloDono,
  agoraMs,
  salvando,
  mostrando,
  onMostrarMais,
  onDecidir,
  onAbrirFicha,
}: {
  coluna: ColunaAutor;
  /** O que cada participante fez (do banco — a linha da planilha não tem este texto). */
  contribuicoes: Record<string, ContribuicaoParticipante[]>;
  rotuloDono: (p: ProjetoDashboardResumo) => string | null;
  agoraMs: number;
  salvando: string | null;
  mostrando: number;
  onMostrarMais: () => void;
  onDecidir: (p: ProjetoDashboardResumo, acao: AcaoTriagem, motivo: string) => void;
  onAbrirFicha: (p: ProjetoDashboardResumo) => void;
}) {
  const visiveis = coluna.projetos.slice(0, mostrando);
  const restantes = coluna.projetos.length - visiveis.length;
  return (
    <section className="flex w-[300px] shrink-0 flex-col" aria-label={coluna.nome}>
      {/* Cabeçalho da pessoa: nome + e-mail + quantos projetos ela tem. O número grande é a
          contagem, porque é ele que responde "quem tem vários?". */}
      <div
        className="flex items-baseline justify-between gap-2 border-b-2 pb-2"
        style={{ borderColor: AZUL }}
      >
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold" title={coluna.nome}>
            {coluna.nome}
          </h2>
          {coluna.email && (
            <p className="truncate text-[11px] text-muted-foreground" title={coluna.email}>
              {coluna.email}
            </p>
          )}
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums"
          style={
            coluna.total >= 2
              ? { background: 'rgba(0,89,169,0.12)', color: AZUL }
              : { background: 'var(--muted)', color: 'var(--muted-foreground)' }
          }
        >
          {coluna.total}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {visiveis.map((p) => (
          <Cartao
            key={p.id}
            projeto={p}
            pessoas={contribuicoes[p.id] ?? []}
            dono={rotuloDono(p)}
            agoraMs={agoraMs}
            salvando={salvando === p.id}
            onDecidir={(acao, motivo) => onDecidir(p, acao, motivo)}
            onAbrirFicha={() => onAbrirFicha(p)}
          />
        ))}
        {restantes > 0 && (
          <button
            type="button"
            onClick={onMostrarMais}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            style={{ ['--tw-ring-color' as string]: AZUL }}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            Carregar mais {Math.min(restantes, CARTOES_INCREMENTO)}
            <span className="tabular-nums">({restantes} restantes)</span>
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Cartão de projeto ───────────────────────────────────────────────────────

function Cartao({
  projeto,
  pessoas,
  dono,
  agoraMs,
  salvando,
  onDecidir,
  onAbrirFicha,
}: {
  projeto: ProjetoDashboardResumo;
  /** O que cada participante fez (do banco — a linha da planilha não tem este texto). */
  pessoas: ContribuicaoParticipante[];
  dono: string | null;
  agoraMs: number;
  salvando: boolean;
  onDecidir: (acao: AcaoTriagem, motivo: string) => void;
  onAbrirFicha: () => void;
}) {
  const [acaoAberta, setAcaoAberta] = useState<AcaoTriagem | null>(null);
  const dias = aguardaDecisao(projeto) ? diasDeEspera(projeto, agoraMs) : null;
  const urgencia = urgenciaDaEspera(dias);
  const fila = filaDe(projeto);

  return (
    <article
      // Duplo clique abre a ficha completa (o cartão tem controles dentro). Enter faz o mesmo
      // para quem navega por teclado.
      onDoubleClick={onAbrirFicha}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onAbrirFicha();
      }}
      tabIndex={0}
      role="group"
      aria-label={`${projeto.nome ?? projeto.id} — Enter abre a ficha completa`}
      title="Duplo clique abre a ficha completa"
      className="cursor-default rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{ ['--tw-ring-color' as string]: AZUL }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold leading-snug">{projeto.nome ?? projeto.id}</h3>
        {salvando && (
          <Loader2
            className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        )}
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{projeto.area || '—'}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={projeto.statusChave} />
        {/* Situação (fila): o rótulo de quem depende de quem — sempre com texto, nunca só cor. */}
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-medium"
          style={{ background: 'rgba(0,89,169,0.08)', color: AZUL }}
        >
          {ROTULO_FILA[fila]}
        </span>
        {dias != null && (
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            title={
              projeto.dataSubmissao ? `Submetido em ${fmtDataBR(projeto.dataSubmissao)}` : undefined
            }
            style={
              urgencia === 'critica'
                ? { background: 'rgba(179,38,30,0.12)', color: '#b3261e' }
                : urgencia === 'atencao'
                  ? { background: 'rgba(154,98,6,0.12)', color: '#9a6206' }
                  : { background: 'var(--muted)', color: 'var(--muted-foreground)' }
            }
          >
            {dias}d de espera
          </span>
        )}
        {dono && (
          <span
            className="rounded-full border px-1.5 py-0.5 text-[11px]"
            style={{ borderColor: 'rgba(0,89,169,0.35)', color: AZUL }}
          >
            {dono}
          </span>
        )}
      </div>

      <QuemFezOQue pessoas={pessoas} />

      <AcoesTriagem
        disponiveis={acoesDisponiveis(projeto.statusChave)}
        aberta={acaoAberta}
        onAbrir={setAcaoAberta}
        onDecidir={(acao, motivo) => {
          setAcaoAberta(null);
          onDecidir(acao, motivo);
        }}
      />
    </article>
  );
}

/**
 * As três decisões, no próprio cartão. Aprovar grava direto; reprovar e pedir reenvio abrem
 * o campo de motivo ANTES de gravar (decisão negativa sem texto é um "não" mudo).
 */
function AcoesTriagem({
  disponiveis,
  aberta,
  onAbrir,
  onDecidir,
}: {
  disponiveis: AcaoTriagem[];
  aberta: AcaoTriagem | null;
  onAbrir: (a: AcaoTriagem | null) => void;
  onDecidir: (acao: AcaoTriagem, motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');

  if (aberta && precisaMotivo(aberta)) {
    return (
      <form
        className="mt-2 space-y-2 border-t pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (motivo.trim()) {
            onDecidir(aberta, motivo.trim());
            setMotivo('');
          }
        }}
      >
        <label
          className="block text-[11px] font-medium text-muted-foreground"
          htmlFor={`motivo-${aberta}`}
        >
          {PERGUNTA_MOTIVO[aberta as 'reenviar' | 'reprovar']}
        </label>
        <textarea
          id={`motivo-${aberta}`}
          autoFocus
          rows={3}
          maxLength={4000}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="w-full rounded-md border px-2 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2"
          style={{ ['--tw-ring-color' as string]: AZUL }}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onAbrir(null);
              setMotivo('');
            }}
          >
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!motivo.trim()}>
            {rotuloAcao(aberta)}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
      {disponiveis.includes('aprovar') && (
        <BotaoAcao onClick={() => onDecidir('aprovar', '')} tom="ok">
          <Check className="h-3 w-3" aria-hidden /> Aprovar
        </BotaoAcao>
      )}
      {disponiveis.includes('reenviar') && (
        <BotaoAcao onClick={() => onAbrir('reenviar')} tom="atencao">
          <RotateCcw className="h-3 w-3" aria-hidden /> Pedir reenvio
        </BotaoAcao>
      )}
      {disponiveis.includes('reprovar') && (
        <BotaoAcao onClick={() => onAbrir('reprovar')} tom="critico">
          <Ban className="h-3 w-3" aria-hidden /> Reprovar
        </BotaoAcao>
      )}
    </div>
  );
}

const TOM_ACAO = {
  ok: { cor: '#17714f', fundo: 'rgba(23,113,79,0.10)' },
  atencao: { cor: '#8a6a00', fundo: 'rgba(224,168,0,0.14)' },
  critico: { cor: '#b3261e', fundo: 'rgba(179,38,30,0.10)' },
} as const;

function BotaoAcao({
  onClick,
  tom,
  children,
}: {
  onClick: () => void;
  tom: keyof typeof TOM_ACAO;
  children: React.ReactNode;
}) {
  const { cor, fundo } = TOM_ACAO[tom];
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{ color: cor, background: fundo, ['--tw-ring-color' as string]: AZUL }}
    >
      {children}
    </button>
  );
}

// ─── Divisão da validação por pessoa (mesma da /especiais) ───────────────────

function PainelDivisao({
  projetos,
  donoPor,
  validadores,
  onFechar,
  onDefinir,
  onFiltrarPor,
}: {
  projetos: ProjetoDashboardResumo[];
  donoPor: Map<string, DonoDeArea>;
  validadores: ValidadorEspeciais[];
  onFechar: () => void;
  onDefinir: (area: string, email: string | null) => void;
  onFiltrarPor: (email: string) => void;
}) {
  const areas = areasDosProjetos(projetos);
  const carga = cargaPorDono(projetos, donoPor);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/40 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Divisão da validação por pessoa"
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full max-w-3xl rounded-xl border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Divisão por pessoa</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Cada área inteira fica com um admin, para editar/validar. Projeto novo daquela área
              já entra com dono. (É a mesma divisão da aba de especiais.)
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onFechar}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Fechar
          </Button>
        </div>

        {/* Carga: quem está com quantos. Clicar filtra a tela por essa pessoa. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {validadores.map((v) => (
            <button
              key={v.email}
              type="button"
              onClick={() => onFiltrarPor(v.email)}
              className="rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--go-blue)] focus-visible:outline-none focus-visible:ring-2"
              style={{ ['--tw-ring-color' as string]: AZUL }}
            >
              <span className="block text-[17px] font-semibold leading-none tabular-nums">
                {carga.get(v.email) ?? 0}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {v.nome?.trim() || v.email}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFiltrarPor('sem-dono')}
            className="rounded-lg border border-dashed px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2"
            style={{ ['--tw-ring-color' as string]: AZUL }}
          >
            <span className="block text-[17px] font-semibold leading-none tabular-nums">
              {carga.get(null) ?? 0}
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">Sem dono</span>
          </button>
        </div>

        <div className="mt-4 max-h-[46vh] overflow-auto rounded-lg border">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-muted/60 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Área</th>
                <th className="w-20 px-3 py-2 text-right font-medium">Projetos</th>
                <th className="w-56 px-3 py-2 font-medium">Quem valida</th>
              </tr>
            </thead>
            <tbody>
              {areas.map(({ area, total }) => (
                <tr key={area} className="border-t">
                  <td className="px-3 py-1.5">{area}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{total}</td>
                  <td className="px-3 py-1.5">
                    <select
                      value={donoPor.get(area)?.dono_email ?? ''}
                      onChange={(e) => onDefinir(area, e.target.value || null)}
                      aria-label={`Quem valida a área ${area}`}
                      className="h-8 w-full rounded-md border bg-card px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2"
                      style={{ ['--tw-ring-color' as string]: AZUL }}
                    >
                      <option value="">Sem dono</option>
                      {validadores.map((v) => (
                        <option key={v.email} value={v.email}>
                          {v.nome?.trim() || v.email}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
