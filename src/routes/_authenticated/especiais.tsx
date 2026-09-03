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
  Ban,
  Check,
  RotateCcw,
  Users,
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
import { HistoricoButton } from '@/components/historico/historico-button';
import { StatusBadge } from '@/components/status-badge';
import { ProjetoDetalheDialog } from '@/components/dashboard/projeto-detalhe-dialog';
import { apiFetch } from '@/lib/api-client';
import { fmtDataBR } from '@/lib/format-date';
import {
  CARTOES_INCREMENTO,
  CARTOES_INICIAIS,
  FILAS_DO_RPA,
  FILTROS_ESPECIAIS_VAZIOS,
  MAX_COMPARAR,
  TETO_REENVIO,
  agruparEspeciais,
  areasDosProjetos,
  cargaPorDono,
  chaveArea,
  contarFiltrosEspeciais,
  diasDeEspera,
  donoDoProjeto,
  excedeTetoDeReenvio,
  aguardaDecisao,
  rotuloValidador,
  urgenciaDaEspera,
  type ColunaEspeciais,
  type DonoDeArea,
  type Fila,
  type FiltrosEspeciais,
  type ValidadorEspeciais,
} from '@/lib/especiais-view';
import { casaPeriodo, casaStatus } from '@/lib/dashboard-filtros';
import { STATUS_TRIAGEM } from '@/components/dashboard/status-triagem';
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
import { useTituloPagina } from '@/lib/use-titulo-pagina';
import { SECAO } from '@/lib/titulo-pagina';

// Título da aba: montado no componente (`useTituloPagina`) para levar o nome do projeto
// com a ficha aberta. Ver `src/lib/titulo-pagina.ts`.
export const Route = createFileRoute('/_authenticated/especiais')({
  component: Especiais,
});

type Listagem = {
  projetos: ProjetoDashboardResumo[];
  contribuicoes: Record<string, ContribuicaoParticipante[]>;
  avaliacoes: AvaliacaoEspecial[];
  donos: DonoDeArea[];
  validadores: ValidadorEspeciais[];
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
  'Ganho Imensurável',
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
  // "Mais antigos primeiro" (opção do "Período"): reordena os projetos DENTRO de cada coluna
  // do mais antigo ao mais novo. Fora de `filtros` porque não filtra nada — só ordena.
  const [maisAntigos, setMaisAntigos] = useState(false);
  // Quantos cartões cada coluna mostra. Chaveado pela coluna, e zerado a cada filtro novo.
  const [mostrando, setMostrando] = useState<Record<string, number>>({});
  const [divisaoAberta, setDivisaoAberta] = useState(false);
  // Ficha completa (o MESMO diálogo do /dashboard): abre no duplo clique do cartão.
  const [fichaAberta, setFichaAberta] = useState<ProjetoDashboardResumo | null>(null);
  // "Agora" congelado no carregamento: recalcular a cada render faria o chip de espera mudar
  // de faixa no meio de um clique.
  const [agoraMs] = useState(() => Date.now());
  // Título da aba: com a ficha aberta vale o nome do projeto; fechada, quantos estão
  // selecionados para comparar (é o estado que se perde de vista ao trocar de aba).
  useTituloPagina(
    SECAO.especiais,
    fichaAberta
      ? (fichaAberta.nome ?? fichaAberta.id)
      : selecionados.length > 0
        ? `${selecionados.length} selecionado${selecionados.length > 1 ? 's' : ''}`
        : null,
  );
  // Mapa `id do projeto → o que cada participante fez`. Vem do BANCO, ao lado da
  // listagem (a linha da planilha não tem este texto); `{}` enquanto carrega e para
  // build antiga do servidor, que não manda a chave — o cartão só não desenha o bloco.
  const contribuicoesPorProjeto = dados?.contribuicoes ?? {};

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

  const donoPor = useMemo(
    () => new Map((dados?.donos ?? []).map((d) => [chaveArea(d.area), d])),
    [dados],
  );

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
    if (filtros.dono) {
      visiveis = visiveis.filter((p) => {
        const dono = donoDoProjeto(p, donoPor);
        return filtros.dono === 'sem-dono' ? dono == null : dono === filtros.dono;
      });
    }
    // Status e pré-status são dimensões independentes e somam por E (igual ao /dashboard).
    if (filtros.status !== 'todos') visiveis = visiveis.filter((p) => casaStatus(p, filtros.status));
    if (filtros.periodo) visiveis = visiveis.filter((p) => casaPeriodo(p, filtros.periodo));
    if (filtros.termo.trim()) visiveis = filtrarPorTermo(visiveis, filtros.termo);
    return agruparEspeciais(visiveis, maisAntigos);
  }, [dados, filtros, avaliacaoPor, donoPor, maisAntigos]);

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

  /** Nome de quem valida este projeto (`null` quando ninguém pegou a área ainda). */
  function rotuloDono(p: ProjetoDashboardResumo): string | null {
    const email = donoDoProjeto(p, donoPor);
    return email ? rotuloValidador(email, dados?.validadores ?? []) : null;
  }

  /**
   * Decide o projeto DAQUI — mesma escrita do `/dashboard`
   * (`POST /api/admin/dashboard/status` → `definirStatusProjeto`), então a auditoria em
   * `admin_status_log` e a regra de nunca tocar "Atualizado Em" continuam valendo.
   *
   * Otimista: o cartão muda de status na hora e volta atrás se a planilha recusar — a mesma
   * disciplina do ±1 estrela logo acima.
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
            value={filtros.status}
            onChange={(e) => setFiltros((f) => ({ ...f, status: e.target.value }))}
            aria-label="Filtrar por status"
            className="h-9 rounded-full border bg-card px-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2"
            style={{ ['--tw-ring-color' as string]: AZUL }}
          >
            <option value="todos">Todos os status</option>
            {STATUS_TRIAGEM.map((st) => (
              <option key={st.chave} value={st.chave}>
                {st.label}
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
                contribuicoes={contribuicoesPorProjeto}
                avaliacaoPor={avaliacaoPor}
                rotuloDono={rotuloDono}
                agoraMs={agoraMs}
                onDecidir={decidir}
                onAbrirFicha={setFichaAberta}
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

      {/* Reusa o diálogo da triagem inteiro — a ficha é a linha da planilha, e ter duas
          telas de "todos os dados" seria duas verdades sobre o mesmo projeto. O status
          salvo lá reflete aqui na hora, sem recarregar a lista. */}
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
  contribuicoes,
  avaliacaoPor,
  rotuloDono,
  agoraMs,
  selecionados,
  salvando,
  mostrando,
  onMostrarMais,
  onComparar,
  onNota,
  onDecidir,
  onAbrirFicha,
}: {
  coluna: ColunaEspeciais;
  /** O que cada participante fez (do banco — a linha da planilha não tem este texto). */
  contribuicoes: Record<string, ContribuicaoParticipante[]>;
  avaliacaoPor: Map<string, AvaliacaoEspecial>;
  rotuloDono: (p: ProjetoDashboardResumo) => string | null;
  agoraMs: number;
  selecionados: string[];
  salvando: string | null;
  mostrando: number;
  onMostrarMais: () => void;
  onComparar: (id: string) => void;
  onNota: (p: ProjetoDashboardResumo, nota: number) => void;
  onDecidir: (p: ProjetoDashboardResumo, acao: AcaoTriagem, motivo: string) => void;
  onAbrirFicha: (p: ProjetoDashboardResumo) => void;
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
            pessoas={contribuicoes[p.id] ?? []}
            avaliacao={avaliacaoPor.get(p.id)}
            dono={rotuloDono(p)}
            agoraMs={agoraMs}
            selecionado={selecionados.includes(p.id)}
            podeSelecionar={selecionados.length < MAX_COMPARAR || selecionados.includes(p.id)}
            salvando={salvando === p.id}
            onComparar={() => onComparar(p.id)}
            onNota={(n) => onNota(p, n)}
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
  pessoas,
  avaliacao,
  dono,
  agoraMs,
  selecionado,
  podeSelecionar,
  salvando,
  onComparar,
  onNota,
  onDecidir,
  onAbrirFicha,
}: {
  projeto: ProjetoDashboardResumo;
  /** O que cada participante fez (do banco — a linha da planilha não tem este texto). */
  pessoas: ContribuicaoParticipante[];
  avaliacao: AvaliacaoEspecial | undefined;
  dono: string | null;
  agoraMs: number;
  selecionado: boolean;
  podeSelecionar: boolean;
  salvando: boolean;
  onComparar: () => void;
  onNota: (n: number) => void;
  onDecidir: (acao: AcaoTriagem, motivo: string) => void;
  onAbrirFicha: () => void;
}) {
  const [acaoAberta, setAcaoAberta] = useState<AcaoTriagem | null>(null);
  const nota = projeto.estrelas;
  // Só quem aguarda decisão tem "espera": num aprovado o número viraria idade da submissão.
  const dias = aguardaDecisao(projeto) ? diasDeEspera(projeto, agoraMs) : null;
  const urgencia = urgenciaDaEspera(dias);
  const avisoTeto = avaliacao != null && excedeTetoDeReenvio(projeto, avaliacao.estrelas_recomendada);

  return (
    <article
      // Duplo clique abre a ficha completa. Não é clique simples de propósito: o cartão tem
      // controles dentro (±1 estrela, comparar, decidir) e um clique só abriria a ficha por
      // acidente o tempo todo. Enter no cartão faz o mesmo, para quem navega por teclado.
      onDoubleClick={onAbrirFicha}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onAbrirFicha();
      }}
      tabIndex={0}
      role="group"
      aria-label={`${projeto.nome ?? projeto.id} — Enter abre a ficha completa`}
      title="Duplo clique abre a ficha completa"
      className="cursor-default rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{
        ['--tw-ring-color' as string]: AZUL,
        ...(selecionado ? { borderColor: AZUL, boxShadow: `0 0 0 2px rgba(0,89,169,0.18)` } : {}),
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold leading-snug">{projeto.nome ?? projeto.id}</h3>
        {salvando && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />}
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
        {[projeto.autor, projeto.area].filter(Boolean).join(' · ') || '—'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={projeto.statusChave} />
        {/* Espera: o eixo de urgência do painel da força-tarefa. Nunca só cor — o número de
            dias está escrito, e o título diz desde quando. */}
        {dias != null && (
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            title={projeto.dataSubmissao ? `Submetido em ${fmtDataBR(projeto.dataSubmissao)}` : undefined}
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

      {avaliacao && (
        <RecomendacaoAuditoria
          avaliacao={avaliacao}
          atual={nota}
          avisoTeto={avisoTeto}
          onAplicar={() => onNota(avaliacao.estrelas_recomendada)}
        />
      )}

      <QuemFezOQue pessoas={pessoas} />

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
 * As três decisões, no próprio cartão.
 *
 * Aprovar grava direto (é o caminho sem texto obrigatório). Reprovar e pedir reenvio abrem o
 * campo de motivo ANTES de gravar — e o botão de confirmar fica desabilitado enquanto o texto
 * estiver vazio, porque decisão negativa sem explicação é um "não" mudo para quem submeteu.
 */
function AcoesTriagem({
  disponiveis,
  aberta,
  onAbrir,
  onDecidir,
}: {
  /** As ações que cabem no estado atual — a que o projeto já é não aparece. */
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
        <label className="block text-[11px] font-medium text-muted-foreground" htmlFor={`motivo-${aberta}`}>
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
  avisoTeto,
  onAplicar,
}: {
  avaliacao: AvaliacaoEspecial;
  atual: number | null;
  /** A recomendação passa do teto de 2★ de quem está em reenvio (régua da auditoria). */
  avisoTeto: boolean;
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
      {avisoTeto && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Em reenvio o teto é {TETO_REENVIO}★ até a documentação ser refeita — só passe disso
          com evidência forte.
        </p>
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

// ─── Divisão da validação por pessoa ────────────────────────────────────────

/**
 * Quem valida o quê. A unidade é a **ÁREA** — herdado da força-tarefa do JV pelo motivo dele:
 * contexto não se parte, e projeto novo da área já nasce com dono sem ninguém redistribuir.
 *
 * ⚠️ Aqui a divisão é DEFINIDA à mão, não derivada por algoritmo de carga: quem coordena sabe
 * o que a contagem não sabe (quem conhece o time, quem está de férias). A carga por pessoa
 * aparece ao lado para a divisão torta ficar visível — inclusive a linha **Sem dono**, que é
 * o que some de vista numa lista organizada por pessoa.
 */
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
              Cada área inteira fica com uma pessoa. Projeto novo daquela área já entra com dono.
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
