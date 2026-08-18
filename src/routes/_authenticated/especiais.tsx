/**
 * Comparador de projetos ESPECIAIS — a régua da nota, por ÂNCORA.
 *
 * Por que esta tela existe (discussão GoBrands × PIAPP, 18/08/2026): a coluna "Estrelas" é um
 * número sem denominador. Quem tria não tem contra o que comparar, então a mesma nota quer
 * dizer coisas diferentes em semanas diferentes — e um projeto de grande impacto para UMA área
 * pode oscilar de 8 estrelas a "será que vale alguma?" numa conversa só.
 *
 * A ideia da tela: **a primeira fileira do quadro é uma prateleira de referência.** Cada nível
 * mostra, fixado no topo e sobre fundo creme, o projeto REAL que o define, com a frase da régua
 * escrita pela triagem. Os candidatos ficam embaixo, na mesma coluna. A pergunta deixa de ser
 * "quantas estrelas isto vale?" e passa a ser "isto é maior ou menor que o PIAPP?", que é a
 * comparação que gente sabe fazer.
 *
 * Ver `src/lib/especiais-view.ts` (agrupamento puro) e `src/lib/especiais.functions.ts`.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Search,
  Minus,
  Plus,
  RefreshCw,
  Star,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { apiFetch } from '@/lib/api-client';
import { fmtDataBR } from '@/lib/format-date';
import {
  CARTOES_INCREMENTO,
  CARTOES_INICIAIS,
  FILTROS_ESPECIAIS_VAZIOS,
  MAX_COMPARAR,
  agruparEspeciais,
  contarFiltrosEspeciais,
  type ColunaEspeciais,
  type FiltrosEspeciais,
} from '@/lib/especiais-view';
import { casaPeriodo } from '@/lib/dashboard-filtros';
import { filtrarPorTermo } from '@/components/dashboard/tabela-utils';
import { SeletorPeriodo } from '@/components/calendario/calendario';
import { hojeIso } from '@/lib/calendario-datas';
import {
  ROTULO_CONFIANCA,
  definicaoDe,
  deltaRecomendacao,
  raridadeDe,
  rotuloDelta,
  tierDe,
  type AvaliacaoEspecial,
} from '@/lib/especiais-regua';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-admin.functions';

export const Route = createFileRoute('/_authenticated/especiais')({
  head: () => ({ meta: [{ title: 'Comparador de especiais · GoDocs Admin' }] }),
  component: Especiais,
});

type Listagem = {
  projetos: ProjetoDashboardResumo[];
  avaliacoes: AvaliacaoEspecial[];
  lidoEm: string;
  espelhoVelho: boolean;
};

/** Ficha completa (a linha da planilha) — reusa o lote da triagem, sem endpoint novo. */
type Ficha = { id: string; campos: Record<string, string> };

/** Sanidade da célula, espelhando o servidor (replicado para o bundle do cliente não puxar
 *  módulo server-only — mesma razão da ficha do `/dashboard`). */
const MAX_ESTRELAS_GRAVAVEL = 100;

const OURO = '#f5c518';
const OURO_BORDA = '#e0a800';
const AZUL = 'var(--go-blue)';

/** O que a comparação mostra de cada projeto, na ordem em que a dúvida costuma aparecer. */
const CAMPOS_COMPARACAO = [
  'Área',
  'Nome Completo',
  'Ferramenta',
  'Descrição',
  'Contexto do Projeto Especial',
] as const;

function Especiais() {
  const [dados, setDados] = useState<Listagem | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  // Os filtros somam entre si (AND). "Só divergentes" mora aqui dentro porque é um filtro
  // como os outros — fora da barra, ele virava um modo escondido ao lado do botão Atualizar.
  const [filtros, setFiltros] = useState<FiltrosEspeciais>(FILTROS_ESPECIAIS_VAZIOS);
  // Quantos cartões cada coluna mostra. Chaveado pela coluna, e zerado a cada filtro novo.
  const [mostrando, setMostrando] = useState<Record<string, number>>({});

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      setDados(await apiFetch<Listagem>('/api/admin/especiais'));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os projetos especiais.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const avaliacaoPor = useMemo(
    () => new Map((dados?.avaliacoes ?? []).map((a) => [a.projeto_id, a])),
    [dados],
  );

  const colunas = useMemo(() => {
    if (!dados) return [];
    let visiveis = dados.projetos;
    if (filtros.soDivergentes) {
      visiveis = visiveis.filter(
        (p) => deltaRecomendacao(p.estrelas, avaliacaoPor.get(p.id)) != null,
      );
    }
    if (filtros.periodo) visiveis = visiveis.filter((p) => casaPeriodo(p, filtros.periodo));
    if (filtros.termo.trim()) visiveis = filtrarPorTermo(visiveis, filtros.termo);
    return agruparEspeciais(visiveis);
  }, [dados, filtros, avaliacaoPor]);

  // Filtro novo = lista nova: manter o "carregar mais" antigo mostraria 12 cartões numa coluna
  // que a pessoa acabou de reduzir a 3.
  useEffect(() => {
    setMostrando({});
  }, [filtros]);
  /** Move o cartão de coluna = regrava a nota na planilha. Otimista: a coluna muda na hora e
   *  volta atrás se a escrita falhar (a alternativa é a tela congelar a cada clique). */
  async function mudarNota(projeto: ProjetoDashboardResumo, nova: number) {
    if (nova < 0 || nova > MAX_ESTRELAS_GRAVAVEL) return;
    const anterior = projeto.estrelas;
    setSalvando(projeto.id);
    setDados((d) =>
      d
        ? { ...d, projetos: d.projetos.map((p) => (p.id === projeto.id ? { ...p, estrelas: nova } : p)) }
        : d,
    );
    try {
      await apiFetch('/api/admin/especiais/estrelas', { projeto_id: projeto.id, estrelas: nova });
      setErro(null);
    } catch (e) {
      setDados((d) =>
        d
          ? {
              ...d,
              projetos: d.projetos.map((p) =>
                p.id === projeto.id ? { ...p, estrelas: anterior } : p,
              ),
            }
          : d,
      );
      setErro(
        `A nota de "${projeto.nome ?? projeto.id}" não foi gravada na planilha. ${
          e instanceof Error ? e.message : ''
        }`.trim(),
      );
    } finally {
      setSalvando(null);
    }
  }

  function alternarComparacao(id: string) {
    setSelecionados((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COMPARAR ? s : [...s, id],
    );
  }

  const totalEspeciais = dados?.projetos.length ?? 0;
  const divergentes = (dados?.projetos ?? []).filter(
    (p) => deltaRecomendacao(p.estrelas, avaliacaoPor.get(p.id)) != null,
  ).length;
  const comRecomendacao = (dados?.projetos ?? []).filter((p) => avaliacaoPor.has(p.id)).length;
  const semNota = (dados?.projetos ?? []).filter((p) => p.estrelas == null).length;
  const visiveis = colunas.reduce((n, c) => n + c.total, 0);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Comparador de especiais</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
              A nota de um especial é comparação, não chute: cada nível traz a definição da
              faixa e cada projeto, a leitura da auditoria que sustenta a recomendação.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void carregar(true)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Atualizar
          </Button>
        </div>

        {/* Os números em placas, não em linha de texto: são 4 quantidades que a pessoa
            compara entre si (quantos existem × quantos já têm recomendação × quantos
            divergem), e em prosa elas se perdem umas nas outras. */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Placa rotulo="Especiais" valor={totalEspeciais} />
          <Placa rotulo="Com recomendação" valor={comRecomendacao} />
          <Placa
            rotulo="Divergem da nota"
            valor={divergentes}
            destaque={divergentes > 0}
            aoClicar={() => setFiltros((f) => ({ ...f, soDivergentes: !f.soDivergentes }))}
            ativo={filtros.soDivergentes}
          />
          <Placa rotulo="Sem nota" valor={semNota} />
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

        {/* Barra de filtros: busca + período + divergentes, no mesmo idioma de pílulas do
            /dashboard. Some junto o "limpar", que só aparece quando há o que limpar. */}
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
              aria-label="Buscar entre os projetos especiais"
              className="h-9 w-[260px] rounded-full border bg-card pl-9 pr-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2"
              style={{ ['--tw-ring-color' as string]: AZUL }}
            />
          </div>

          <SeletorPeriodo
            valor={filtros.periodo}
            onChange={(periodo) => setFiltros((f) => ({ ...f, periodo }))}
            maximo={hojeIso()}
          />

          <button
            type="button"
            aria-pressed={filtros.soDivergentes}
            onClick={() => setFiltros((f) => ({ ...f, soDivergentes: !f.soDivergentes }))}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
            style={{
              background: filtros.soDivergentes ? AZUL : 'var(--card)',
              color: filtros.soDivergentes ? '#fff' : 'var(--foreground)',
              borderColor: filtros.soDivergentes ? AZUL : 'var(--border)',
              ['--tw-ring-color' as string]: AZUL,
            }}
          >
            {filtros.soDivergentes && <Check className="h-3.5 w-3.5" aria-hidden />}
            Só divergentes
          </button>

          {contarFiltrosEspeciais(filtros) > 0 && (
            <button
              type="button"
              onClick={() => setFiltros(FILTROS_ESPECIAIS_VAZIOS)}
              className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2"
              style={{ ['--tw-ring-color' as string]: AZUL }}
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Limpar
              {contarFiltrosEspeciais(filtros) > 1 && ` (${contarFiltrosEspeciais(filtros)})`}
            </button>
          )}

          <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">
            {visiveis} {visiveis === 1 ? 'projeto' : 'projetos'} na visão
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
          Carregando os especiais…
        </div>
      ) : totalEspeciais === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <Star className="h-6 w-6" aria-hidden />
          <p className="text-sm">Nenhum projeto especial na planilha ainda.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto px-6 py-5">
          <div className="flex min-w-max items-start gap-4 pb-40">
            {colunas.map((coluna) => (
              <Coluna
                key={coluna.chave}
                coluna={coluna}
                avaliacaoPor={avaliacaoPor}
                selecionados={selecionados}
                salvando={salvando}
                mostrando={mostrando[coluna.chave] ?? CARTOES_INICIAIS}
                onMostrarMais={() =>
                  setMostrando((m) => ({
                    ...m,
                    [coluna.chave]: (m[coluna.chave] ?? CARTOES_INICIAIS) + CARTOES_INCREMENTO,
                  }))
                }
                onComparar={alternarComparacao}
                onNota={mudarNota}
              />
            ))}
          </div>
        </div>
      )}

      {selecionados.length > 0 && (
        <PainelComparacao
          selecionados={selecionados}
          colunas={colunas}
          onFechar={() => setSelecionados([])}
          onRemover={(id) => setSelecionados((s) => s.filter((x) => x !== id))}
        />
      )}
    </div>
  );
}

/**
 * Placa de número do cabeçalho. Quando recebe `aoClicar` vira filtro (é o caso de
 * "Divergem da nota") — e aí o estado ATIVO é dito por borda, fundo E o `aria-pressed`,
 * nunca só por cor.
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
      <span className="mt-1 block text-[11px] leading-none" style={{ color: ativo ? 'rgba(255,255,255,0.85)' : 'var(--muted-foreground)' }}>
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

// ─── Coluna de um nível ──────────────────────────────────────────────────────

function Coluna({
  coluna,
  avaliacaoPor,
  selecionados,
  salvando,
  mostrando,
  onMostrarMais,
  onComparar,
  onNota,
}: {
  coluna: ColunaEspeciais;
  avaliacaoPor: Map<string, AvaliacaoEspecial>;
  selecionados: string[];
  salvando: string | null;
  mostrando: number;
  onMostrarMais: () => void;
  onComparar: (id: string) => void;
  onNota: (p: ProjetoDashboardResumo, nota: number) => void;
}) {
  const visiveis = coluna.projetos.slice(0, mostrando);
  const restantes = coluna.projetos.length - visiveis.length;
  return (
    <section className="flex w-[290px] shrink-0 flex-col" aria-label={coluna.rotulo}>
      {/* Cabeçalho do nível: a nota em número grande, porque contar estrela acima de 5
          ninguém conta (mesma decisão da ficha de triagem). */}
      <div
        className="flex items-baseline justify-between gap-2 border-b-2 pb-2"
        style={{ borderColor: AZUL }}
      >
        <h2 className="flex items-baseline gap-1.5 text-[15px] font-semibold">
          {coluna.nota == null ? (
            <span className="text-muted-foreground">Sem nota</span>
          ) : (
            <>
              <span className="text-[22px] leading-none tabular-nums" style={{ color: AZUL }}>
                {coluna.nota}
              </span>
              <Star className="h-3.5 w-3.5" style={{ color: OURO_BORDA }} fill={OURO} aria-hidden />
            </>
          )}
        </h2>
        <span className="text-[12px] tabular-nums text-muted-foreground">{coluna.total}</span>
      </div>

      {/* A régua da ESCALA: o que este nível significa e quão raro ele é na base. É o texto
          da rubrica (fonte única em `especiais-regua.ts`), não um exemplo escolhido a dedo —
          o exemplo concreto de cada projeto vem na leitura da auditoria, dentro do cartão. */}
      {coluna.nota != null && (
        <div className="mt-1.5 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {tierDe(coluna.nota) && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: 'rgba(224,168,0,0.14)', color: '#8a6a00' }}
              >
                {tierDe(coluna.nota)!.rotulo}
              </span>
            )}
            {raridadeDe(coluna.nota) && (
              <span className="text-[10.5px] text-muted-foreground">{raridadeDe(coluna.nota)}</span>
            )}
          </div>
          {definicaoDe(coluna.nota) && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {definicaoDe(coluna.nota)}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {visiveis.map((p) => (
          <Cartao
            key={p.id}
            projeto={p}
            avaliacao={avaliacaoPor.get(p.id)}
            selecionado={selecionados.includes(p.id)}
            podeSelecionar={selecionados.length < MAX_COMPARAR || selecionados.includes(p.id)}
            salvando={salvando === p.id}
            onComparar={() => onComparar(p.id)}
            onNota={(n) => onNota(p, n)}
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
        {coluna.projetos.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-[12px] text-muted-foreground">
            Nível vazio
          </p>
        )}
      </div>
    </section>
  );
}

// ─── Cartão de projeto ───────────────────────────────────────────────────────

function Cartao({
  projeto,
  avaliacao,
  selecionado,
  podeSelecionar,
  salvando,
  onComparar,
  onNota,
}: {
  projeto: ProjetoDashboardResumo;
  avaliacao: AvaliacaoEspecial | undefined;
  selecionado: boolean;
  podeSelecionar: boolean;
  salvando: boolean;
  onComparar: () => void;
  onNota: (n: number) => void;
}) {
  const nota = projeto.estrelas;

  return (
    <article
      className="rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow motion-reduce:transition-none"
      style={selecionado ? { borderColor: AZUL, boxShadow: `0 0 0 2px rgba(0,89,169,0.18)` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold leading-snug">{projeto.nome ?? projeto.id}</h3>
        {salvando && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />}
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
        {[projeto.autor, projeto.area].filter(Boolean).join(' · ') || '—'}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <StatusBadge status={projeto.statusChave} />
        {projeto.dataSubmissao && (
          <span className="text-[11px] text-muted-foreground">{fmtDataBR(projeto.dataSubmissao)}</span>
        )}
      </div>

      {avaliacao && (
        <RecomendacaoAuditoria
          avaliacao={avaliacao}
          atual={nota}
          onAplicar={() => onNota(avaliacao.estrelas_recomendada)}
        />
      )}

      {/* Nota: passos de ±1 porque o gesto desta tela é REPOSICIONAR (o cartão muda de
          coluna), não pontuar do zero — a fileira de estrelas inteira vive na ficha. */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex items-center gap-1">
          <BotaoNota rotulo={`Tirar uma estrela de ${projeto.nome ?? projeto.id}`} onClick={() => onNota(Math.max(0, (nota ?? 0) - 1))} disabled={(nota ?? 0) <= 0}>
            <Minus className="h-3 w-3" aria-hidden />
          </BotaoNota>
          <span className="inline-flex min-w-[54px] items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums"
            style={{ background: 'rgba(224,168,0,0.14)', color: '#8a6a00' }}>
            {nota == null ? 'sem nota' : (
              <>
                {nota}
                <Star className="h-3 w-3" style={{ color: OURO_BORDA }} fill={OURO} aria-hidden />
              </>
            )}
          </span>
          <BotaoNota rotulo={`Dar mais uma estrela a ${projeto.nome ?? projeto.id}`} onClick={() => onNota((nota ?? 0) + 1)}>
            <Plus className="h-3 w-3" aria-hidden />
          </BotaoNota>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px]">
          <input
            type="checkbox"
            checked={selecionado}
            disabled={!podeSelecionar}
            onChange={onComparar}
            className="h-3.5 w-3.5 accent-[var(--go-blue)]"
          />
          Comparar
        </label>
      </div>

    </article>
  );
}

/**
 * A recomendação da auditoria dentro do cartão.
 *
 * ⚠️ **Ela nunca vira a nota sozinha** — o "Aplicar" é o clique de gente que grava. A leitura
 * fica junto porque a nota sem o porquê não é auditável: é o texto que diz por que a faixa, por
 * que não sobe e o que faria subir.
 *
 * O selo de confiança e o "contestada" mudam o peso do que se lê: contestada quer dizer que o
 * passe adversarial derrubou ou mexeu na nota — o oposto de "duvidosa", é a que passou pelo
 * crivo mais duro.
 */
function RecomendacaoAuditoria({
  avaliacao,
  atual,
  onAplicar,
}: {
  avaliacao: AvaliacaoEspecial;
  atual: number | null;
  onAplicar: () => void;
}) {
  const delta = deltaRecomendacao(atual, avaliacao);
  const rotulo = rotuloDelta(delta);
  return (
    <div className="mt-2 rounded-md border px-2 py-1.5" style={{ borderColor: 'rgba(0,89,169,0.18)', background: 'rgba(0,89,169,0.04)' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: AZUL }}>
          Auditoria recomenda
        </span>
        <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold tabular-nums">
          {avaliacao.estrelas_recomendada}
          <Star className="h-3 w-3" style={{ color: OURO_BORDA }} fill={OURO} aria-hidden />
        </span>
        {rotulo && (
          <span className="rounded px-1 py-0.5 text-[10.5px] font-semibold tabular-nums"
            style={{ background: delta! > 0 ? 'rgba(23,113,79,0.12)' : 'rgba(179,38,30,0.10)', color: delta! > 0 ? '#17714f' : '#b3261e' }}>
            {rotulo}
          </span>
        )}
        <span className="text-[10.5px] text-muted-foreground">
          {ROTULO_CONFIANCA[avaliacao.confianca]}
        </span>
        {avaliacao.contestada && (
          <span className="text-[10.5px] text-muted-foreground" title="A nota passou pelo revisor adversarial">
            · revista
          </span>
        )}
      </div>
      {avaliacao.leitura && (
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{avaliacao.leitura}</p>
      )}
      {delta != null && (
        <button
          type="button"
          onClick={onAplicar}
          className="mt-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
          style={{ color: AZUL, ['--tw-ring-color' as string]: AZUL }}
        >
          Aplicar {avaliacao.estrelas_recomendada} {avaliacao.estrelas_recomendada === 1 ? 'estrela' : 'estrelas'}
        </button>
      )}
    </div>
  );
}

function BotaoNota({
  rotulo,
  onClick,
  disabled,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={rotulo}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{ borderColor: 'var(--border)', ['--tw-ring-color' as string]: AZUL }}
    >
      {children}
    </button>
  );
}

// ─── Comparação lado a lado ──────────────────────────────────────────────────

/**
 * Painel inferior com as fichas lado a lado. Reusa o **lote da triagem**
 * (`/api/admin/dashboard/projetos/lote`): uma requisição para todos os selecionados, porque
 * aqui cada requisição custa ~750 ms de overhead fixo do edge.
 */
function PainelComparacao({
  selecionados,
  colunas,
  onFechar,
  onRemover,
}: {
  selecionados: string[];
  colunas: ColunaEspeciais[];
  onFechar: () => void;
  onRemover: (id: string) => void;
}) {
  const [fichas, setFichas] = useState<Record<string, Ficha>>({});
  const [carregando, setCarregando] = useState(false);
  const ids = selecionados;
  const chave = ids.join(',');

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    apiFetch<Record<string, Ficha>>('/api/admin/dashboard/projetos/lote', { ids })
      .then((r) => vivo && setFichas(r))
      .catch(() => vivo && setFichas({}))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
    // `chave` é a identidade da lista — o array `ids` é recriado a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const projetoDe = (id: string) => colunas.flatMap((c) => c.projetos).find((p) => p.id === id);

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-30 max-h-[62vh] overflow-auto border-t bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.08)]"
      aria-label="Comparação de projetos especiais"
    >
      <div className="flex items-center justify-between border-b px-5 py-2.5">
        <h2 className="text-[13px] font-semibold">
          Comparando {selecionados.length} {selecionados.length === 1 ? 'projeto' : 'projetos'}
        </h2>
        <Button variant="ghost" size="sm" onClick={onFechar}>
          <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Fechar
        </Button>
      </div>
      {carregando ? (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Abrindo as fichas…
        </div>
      ) : (
        <div className="flex gap-4 px-5 py-4">
          {ids.map((id) => {
            const p = projetoDe(id);
            const campos = fichas[id]?.campos ?? {};
            return (
              <div key={id} className="w-[320px] shrink-0 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[13px] font-semibold leading-snug">{p?.nome ?? id}</h3>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                    style={{ background: 'rgba(224,168,0,0.14)', color: '#8a6a00' }}>
                    {p?.estrelas ?? '—'}
                    <Star className="h-3 w-3" style={{ color: OURO_BORDA }} fill={OURO} aria-hidden />
                  </span>
                </div>
                {(
                  <button type="button" onClick={() => onRemover(id)}
                    className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
                    style={{ ['--tw-ring-color' as string]: AZUL }}>
                    Tirar da comparação
                  </button>
                )}
                <dl className="mt-2 space-y-2">
                  {CAMPOS_COMPARACAO.map((campo) => (
                    <div key={campo}>
                      <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {campo}
                      </dt>
                      <dd className="whitespace-pre-wrap text-[12px] leading-snug">
                        {campos[campo] ?? '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
