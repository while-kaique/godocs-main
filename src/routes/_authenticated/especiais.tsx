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
  Loader2,
  Minus,
  Pin,
  PinOff,
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
  MAX_COMPARAR,
  agruparEspeciais,
  alvosDaComparacao,
  ancoraForaDoNivel,
  type ColunaEspeciais,
  type ReferenciaEspecial,
} from '@/lib/especiais-view';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-admin.functions';

export const Route = createFileRoute('/_authenticated/especiais')({
  head: () => ({ meta: [{ title: 'Comparador de especiais · GoDocs Admin' }] }),
  component: Especiais,
});

type Listagem = {
  projetos: ProjetoDashboardResumo[];
  referencias: ReferenciaEspecial[];
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
  const [editandoRegua, setEditandoRegua] = useState<string | null>(null);

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

  const colunas = useMemo(
    () => (dados ? agruparEspeciais(dados.projetos, dados.referencias) : []),
    [dados],
  );
  const referenciaPor = useMemo(
    () => new Map((dados?.referencias ?? []).map((r) => [r.projeto_id, r])),
    [dados],
  );

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

  async function salvarRegua(projeto: ProjetoDashboardResumo, motivo: string) {
    setSalvando(projeto.id);
    try {
      await apiFetch('/api/admin/especiais/referencia', {
        projeto_id: projeto.id,
        nota: projeto.estrelas ?? 0,
        motivo,
      });
      setEditandoRegua(null);
      await carregar(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a régua.');
    } finally {
      setSalvando(null);
    }
  }

  async function removerRegua(projetoId: string) {
    setSalvando(projetoId);
    try {
      await apiFetch('/api/admin/especiais/referencia/remover', { projeto_id: projetoId });
      await carregar(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível tirar a referência.');
    } finally {
      setSalvando(null);
    }
  }

  function alternarComparacao(id: string) {
    setSelecionados((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COMPARAR ? s : [...s, id],
    );
  }

  const niveisComRegua = colunas.filter((c) => c.ancoras.length > 0).length;
  const totalEspeciais = dados?.projetos.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Comparador de especiais</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
              A nota de um especial é uma comparação, não um chute: cada nível tem no topo o
              projeto que o define. Antes de pontuar um projeto novo, olhe a régua do nível ao
              lado.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void carregar(true)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Atualizar
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          <span>
            <strong className="font-semibold text-foreground">{totalEspeciais}</strong> projetos
            especiais
          </span>
          <span>
            régua definida em{' '}
            <strong className="font-semibold text-foreground">{niveisComRegua}</strong> de{' '}
            {colunas.length} níveis
          </span>
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
                referenciaPor={referenciaPor}
                selecionados={selecionados}
                salvando={salvando}
                editandoRegua={editandoRegua}
                onComparar={alternarComparacao}
                onNota={mudarNota}
                onAbrirRegua={setEditandoRegua}
                onSalvarRegua={salvarRegua}
                onRemoverRegua={removerRegua}
              />
            ))}
          </div>
        </div>
      )}

      {selecionados.length > 0 && (
        <PainelComparacao
          ids={alvosDaComparacao(selecionados, colunas)}
          selecionados={selecionados}
          colunas={colunas}
          onFechar={() => setSelecionados([])}
          onRemover={(id) => setSelecionados((s) => s.filter((x) => x !== id))}
        />
      )}
    </div>
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
  referenciaPor,
  selecionados,
  salvando,
  editandoRegua,
  onComparar,
  onNota,
  onAbrirRegua,
  onSalvarRegua,
  onRemoverRegua,
}: {
  coluna: ColunaEspeciais;
  referenciaPor: Map<string, ReferenciaEspecial>;
  selecionados: string[];
  salvando: string | null;
  editandoRegua: string | null;
  onComparar: (id: string) => void;
  onNota: (p: ProjetoDashboardResumo, nota: number) => void;
  onAbrirRegua: (id: string | null) => void;
  onSalvarRegua: (p: ProjetoDashboardResumo, motivo: string) => void;
  onRemoverRegua: (id: string) => void;
}) {
  const cartao = (p: ProjetoDashboardResumo, ehAncora: boolean) => (
    <Cartao
      key={p.id}
      projeto={p}
      ancora={ehAncora ? referenciaPor.get(p.id) : undefined}
      selecionado={selecionados.includes(p.id)}
      podeSelecionar={selecionados.length < MAX_COMPARAR || selecionados.includes(p.id)}
      salvando={salvando === p.id}
      editandoRegua={editandoRegua === p.id}
      onComparar={() => onComparar(p.id)}
      onNota={(n) => onNota(p, n)}
      onAbrirRegua={() => onAbrirRegua(p.id)}
      onCancelarRegua={() => onAbrirRegua(null)}
      onSalvarRegua={(motivo) => onSalvarRegua(p, motivo)}
      onRemoverRegua={() => onRemoverRegua(p.id)}
    />
  );

  return (
    <section className="flex w-[290px] shrink-0 flex-col" aria-label={coluna.rotulo}>
      {/* Cabeçalho do nível: a nota em número grande, porque contar estrela acima de 5
          ninguém conta (mesma decisão da ficha de triagem). */}
      <div className="flex items-baseline justify-between gap-2 border-b-2 pb-2" style={{ borderColor: AZUL }}>
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

      {/* A PRATELEIRA DA RÉGUA: fundo creme, sempre presente (nível sem referência não some,
          fica pedindo uma) — é ela que transforma a coluna numa comparação. */}
      <div
        className="mt-3 rounded-lg border p-2"
        style={{ background: 'var(--go-cream)', borderColor: 'rgba(0,89,169,0.22)' }}
      >
        <p className="mb-2 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: AZUL }}>
          <Pin className="h-3 w-3" aria-hidden /> Régua deste nível
        </p>
        {coluna.ancoras.length > 0 ? (
          <div className="space-y-2">{coluna.ancoras.map((p) => cartao(p, true))}</div>
        ) : (
          <p className="px-1 pb-1 text-[12px] text-muted-foreground">
            Nenhum projeto define este nível ainda. Escolha um cartão abaixo e fixe como régua.
          </p>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {coluna.projetos.map((p) => cartao(p, false))}
        {coluna.projetos.length === 0 && coluna.ancoras.length === 0 && (
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
  ancora,
  selecionado,
  podeSelecionar,
  salvando,
  editandoRegua,
  onComparar,
  onNota,
  onAbrirRegua,
  onCancelarRegua,
  onSalvarRegua,
  onRemoverRegua,
}: {
  projeto: ProjetoDashboardResumo;
  ancora: ReferenciaEspecial | undefined;
  selecionado: boolean;
  podeSelecionar: boolean;
  salvando: boolean;
  editandoRegua: boolean;
  onComparar: () => void;
  onNota: (n: number) => void;
  onAbrirRegua: () => void;
  onCancelarRegua: () => void;
  onSalvarRegua: (motivo: string) => void;
  onRemoverRegua: () => void;
}) {
  const nota = projeto.estrelas;
  const divergente = ancoraForaDoNivel(projeto, ancora);

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

      {ancora && (
        <p className="mt-2 rounded border-l-2 py-0.5 pl-2 text-[11.5px] italic leading-snug" style={{ borderColor: AZUL }}>
          {ancora.motivo ?? 'Referência sem frase — escreva o que define este nível.'}
        </p>
      )}
      {divergente && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Fixado como régua do nível {ancora?.nota}, mas está com {nota ?? 'nenhuma'} estrela.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <StatusBadge status={projeto.statusChave} />
        {projeto.dataSubmissao && (
          <span className="text-[11px] text-muted-foreground">{fmtDataBR(projeto.dataSubmissao)}</span>
        )}
      </div>

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

      {editandoRegua ? (
        <FormRegua
          inicial={ancora?.motivo ?? ''}
          onCancelar={onCancelarRegua}
          onSalvar={onSalvarRegua}
        />
      ) : (
        <div className="mt-2 flex justify-end">
          {ancora ? (
            <button type="button" onClick={onRemoverRegua} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2" style={{ ['--tw-ring-color' as string]: AZUL }}>
              <PinOff className="h-3 w-3" aria-hidden /> Tirar a régua
            </button>
          ) : (
            <button type="button" onClick={onAbrirRegua} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2" style={{ ['--tw-ring-color' as string]: AZUL }}>
              <Pin className="h-3 w-3" aria-hidden /> Fixar como régua
            </button>
          )}
        </div>
      )}
    </article>
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

function FormRegua({
  inicial,
  onCancelar,
  onSalvar,
}: {
  inicial: string;
  onCancelar: () => void;
  onSalvar: (motivo: string) => void;
}) {
  const [texto, setTexto] = useState(inicial);
  return (
    <form
      className="mt-2 space-y-2 border-t pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSalvar(texto.trim());
      }}
    >
      <label className="block text-[11px] font-medium text-muted-foreground" htmlFor="regua-motivo">
        O que define este nível?
      </label>
      <textarea
        id="regua-motivo"
        autoFocus
        rows={3}
        maxLength={280}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Ex.: dashboard que várias áreas usam na rotina e que move um KPI conferível."
        className="w-full rounded-md border px-2 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2"
        style={{ ['--tw-ring-color' as string]: AZUL }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" size="sm">
          Fixar como régua
        </Button>
      </div>
    </form>
  );
}

// ─── Comparação lado a lado ──────────────────────────────────────────────────

/**
 * Painel inferior com as fichas lado a lado. Reusa o **lote da triagem**
 * (`/api/admin/dashboard/projetos/lote`): uma requisição para todos os selecionados, porque
 * aqui cada requisição custa ~750 ms de overhead fixo do edge.
 *
 * A âncora do nível de cada selecionado entra automaticamente (ver `alvosDaComparacao`) — sem
 * isso a comparação seria "projeto novo × projeto novo", que é justamente o que não resolve.
 */
function PainelComparacao({
  ids,
  selecionados,
  colunas,
  onFechar,
  onRemover,
}: {
  ids: string[];
  selecionados: string[];
  colunas: ColunaEspeciais[];
  onFechar: () => void;
  onRemover: (id: string) => void;
}) {
  const [fichas, setFichas] = useState<Record<string, Ficha>>({});
  const [carregando, setCarregando] = useState(false);
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

  const projetoDe = (id: string) =>
    colunas.flatMap((c) => [...c.ancoras, ...c.projetos]).find((p) => p.id === id);

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-30 max-h-[62vh] overflow-auto border-t bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.08)]"
      aria-label="Comparação de projetos especiais"
    >
      <div className="flex items-center justify-between border-b px-5 py-2.5">
        <h2 className="text-[13px] font-semibold">
          Comparando {selecionados.length} {selecionados.length === 1 ? 'projeto' : 'projetos'}
          <span className="ml-2 font-normal text-muted-foreground">
            com a régua do nível de cada um
          </span>
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
            const ehAncora = colunas.some((c) => c.ancoras.some((a) => a.id === id));
            const campos = fichas[id]?.campos ?? {};
            return (
              <div key={id} className="w-[320px] shrink-0 rounded-lg border p-3"
                style={ehAncora ? { background: 'var(--go-cream)', borderColor: 'rgba(0,89,169,0.22)' } : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {ehAncora && (
                      <span className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: AZUL }}>
                        <Pin className="h-3 w-3" aria-hidden /> Régua do nível
                      </span>
                    )}
                    <h3 className="text-[13px] font-semibold leading-snug">{p?.nome ?? id}</h3>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                    style={{ background: 'rgba(224,168,0,0.14)', color: '#8a6a00' }}>
                    {p?.estrelas ?? '—'}
                    <Star className="h-3 w-3" style={{ color: OURO_BORDA }} fill={OURO} aria-hidden />
                  </span>
                </div>
                {selecionados.includes(id) && (
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
