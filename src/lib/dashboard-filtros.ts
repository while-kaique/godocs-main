/**
 * Filtros da triagem — módulo PURO (sem React), do lado do CLIENTE.
 *
 * A listagem já vem inteira do espelho e a filtragem sempre foi em memória (ver o
 * cabeçalho de `routes/_authenticated/dashboard.tsx`): responder na tecla é o ponto, e
 * ir ao servidor a cada clique seria mais lento sem ser mais correto.
 *
 * ⚠️ **Os filtros SOMAM (AND) entre si**, e é isso que o pedido do Luis chama de "todos +
 * especiais", "pendentes + especiais": cada dimensão recorta o resultado da anterior.
 * `aplicarFiltros` é a FONTE ÚNICA dessa composição — a tela não deve refiltrar por fora,
 * senão a contagem exibida e a lista deixam de concordar.
 *
 * Toda dimensão sai de campo que a listagem JÁ carrega (`ProjetoDashboardResumo`): nada
 * aqui exige coluna nova no espelho nem leitura extra da planilha.
 */
import type { ProjetoDashboardResumo } from "@/lib/dashboard-resumo";
import { pilulaDe } from "@/components/dashboard/status-triagem";
import { msDeIso, type Intervalo } from "@/lib/calendario-datas";
import { ORDEM_ESTADO_PARECER, chaveDoEstado, type EstadoParecer } from "@/lib/aprovacoes-parecer";

/** Recorte por natureza do projeto. `sem` = só os padrão (o inverso de `apenas`). */
export type FiltroEspecial = "todos" | "apenas" | "sem";

/**
 * Recorte por tipo de ganho declarado. A régua é o VALOR gravado na planilha, não o rótulo
 * de "Tipos Projeto": um projeto marcado como saving que terminou com R$ 0 de saving não
 * pertence à fila de quem está conferindo saving.
 */
export type FiltroGanho = "todos" | "saving" | "receita";

export const TODAS_AS_AREAS = "todas";
export const TODOS_OS_PARECERES = "todos";

/**
 * Recorte pela **pré-aprovação do líder** — a coluna "Pré-status" da tabela. A régua é
 * `chaveDoEstado` (fonte única do parser do parecer), então "Pré-aprovado" na planilha,
 * "pre aprovado" e a variação sem acento caem todas no mesmo balde, e o filtro concorda
 * com o chip que a linha mostra.
 *
 * ⚠️ **Isenção NÃO é pré-aprovação.** "Pré-aprovado (liderança)" (D12 — quem é coordenador
 * para cima) cai em `sem_parecer`, porque nenhum líder olhou o projeto: filtrar
 * "Pré-aprovado" e receber os isentos daria a impressão de que a fila andou.
 */
export type FiltroParecer = typeof TODOS_OS_PARECERES | EstadoParecer;

export type FiltrosDashboard = {
  /** Chave da pílula de status (`pilulaDe`) ou `'todos'`. */
  status: string;
  especial: FiltroEspecial;
  ganho: FiltroGanho;
  /** Nome exato da área, ou `TODAS_AS_AREAS`. */
  area: string;
  /** Estado da pré-aprovação do líder, ou `TODOS_OS_PARECERES`. */
  parecer: FiltroParecer;
  /** Janela de "Data Submissão", inclusiva nas duas pontas. `null` = sem recorte. */
  periodo: Intervalo | null;
  /**
   * Faixa da nota da triagem (coluna "Estrelas"), inclusiva nas duas pontas. `null` em uma
   * ponta = ponta aberta, então `min:1` sozinho já é "1 estrela ou mais" — o pedido do Luis
   * de "filtrar de 1 a N". A escala não tem teto (ver `dashboard-resumo`).
   */
  estrelasMin: number | null;
  estrelasMax: number | null;
};

export const FILTROS_VAZIOS: FiltrosDashboard = {
  status: "todos",
  especial: "todos",
  ganho: "todos",
  area: TODAS_AS_AREAS,
  parecer: TODOS_OS_PARECERES,
  periodo: null,
  estrelasMin: null,
  estrelasMax: null,
};

/** Um valor só conta como ganho quando é positivo (célula vazia e 0 não entram na fila). */
function temValor(v: number | null): boolean {
  return v != null && v > 0;
}

export function casaEspecial(p: ProjetoDashboardResumo, filtro: FiltroEspecial): boolean {
  if (filtro === "apenas") return p.especial;
  if (filtro === "sem") return !p.especial;
  return true;
}

export function casaGanho(p: ProjetoDashboardResumo, filtro: FiltroGanho): boolean {
  if (filtro === "saving") return temValor(p.savingReais);
  if (filtro === "receita") return temValor(p.receitaMensal);
  return true;
}

/**
 * A data submetida cai na janela?
 *
 * ⚠️ Compara em **UTC**: `dataOrdenacao` vem de `parseDataFlexivel`, que reconstrói a data
 * pt-BR da planilha em UTC (é assim que o sync a escreve). Comparar contra um `new Date`
 * local deslocaria o dia em Brasília e faria o projeto enviado hoje sumir do filtro "Hoje".
 *
 * Projeto SEM data fica de fora de qualquer janela — não se afirma que ele está no período.
 */
export function casaPeriodo(p: ProjetoDashboardResumo, periodo: Intervalo | null): boolean {
  if (!periodo) return true;
  if (p.dataOrdenacao == null) return false;
  const de = msDeIso(periodo.inicio);
  // A ponta final é INCLUSIVA: a linha carimbada às 14h do dia do fim precisa entrar.
  const ate = msDeIso(periodo.fim) + 86_400_000 - 1;
  return p.dataOrdenacao >= de && p.dataOrdenacao <= ate;
}

export function casaArea(p: ProjetoDashboardResumo, area: string): boolean {
  return area === TODAS_AS_AREAS || p.area === area;
}

export function casaParecer(p: ProjetoDashboardResumo, filtro: FiltroParecer): boolean {
  return filtro === TODOS_OS_PARECERES || chaveDoEstado(p.aprovacaoLider) === filtro;
}

/**
 * A nota cai na faixa? Célula VAZIA conta como **0**: quem filtra "1 ou mais" quer os
 * avaliados, e quem filtra "0 a 0" quer justamente a fila do que ainda não recebeu nota —
 * tratar vazio como "fora de qualquer faixa" deixaria essa fila inalcançável.
 */
export function casaEstrelas(
  p: ProjetoDashboardResumo,
  min: number | null,
  max: number | null,
): boolean {
  if (min == null && max == null) return true;
  const n = p.estrelas ?? 0;
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

/**
 * Como a faixa de estrelas se LÊ no gatilho do filtro — fonte única do texto (a pílula, o
 * `aria-label` e a descrição dentro do painel não podem chamar o mesmo recorte por nomes
 * diferentes). Curto de propósito: mora numa pílula ao lado de outras cinco.
 */
export function rotuloFaixaEstrelas(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Estrelas";
  if (min === 0 && max === 0) return "Sem nota";
  if (min != null && max == null) return min === 0 ? "Qualquer nota" : `${min}+`;
  if (min == null && max != null) return `até ${max}`;
  if (min === max) return `${min}`;
  return `${min}–${max}`;
}

/** A mesma faixa em frase — é o que o painel mostra sob a fileira de estrelas. */
export function descreverFaixaEstrelas(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Qualquer nota, inclusive sem nota.";
  if (min === 0 && max === 0) return "Só os que ainda não receberam nota.";
  if (min != null && max == null) {
    return min === 0
      ? "Qualquer nota, inclusive sem nota."
      : `${min} ${min === 1 ? "estrela" : "estrelas"} ou mais.`;
  }
  if (min == null && max != null) return `Até ${max} ${max === 1 ? "estrela" : "estrelas"}.`;
  if (min === max) return `Exatamente ${min} ${min === 1 ? "estrela" : "estrelas"}.`;
  return `De ${min} a ${max} estrelas.`;
}

export function casaStatus(p: ProjetoDashboardResumo, status: string): boolean {
  const pilula = pilulaDe(p.statusChave);
  // Descontinuados saem da FILA: não aparecem em "Todos" nem em nenhuma outra pílula —
  // só quando a pílula "Descontinuado" é escolhida de propósito (clicar para visualizar).
  if (pilula === "descontinuado") return status === "descontinuado";
  return status === "todos" || pilula === status;
}

/**
 * Dimensões do recorte — o vocabulário que `casaFiltrosExceto` entende.
 */
export type DimensaoFiltro =
  | "status"
  | "especial"
  | "ganho"
  | "area"
  | "parecer"
  | "periodo"
  | "estrelas";

/**
 * O projeto passa por TODAS as dimensões, menos uma.
 *
 * É a régua de **quem conta o próprio campo**: a faixa de pílulas ignora `status` (senão
 * escolher "Pendente" colapsaria a faixa em 1) e o campo de pré-status ignora `parecer`
 * (senão escolher um estado apagaria os outros do campo). Fonte única para não haver duas
 * listas de dimensões que precisem ser mantidas em sincronia à mão.
 */
export function casaFiltrosExceto(
  p: ProjetoDashboardResumo,
  f: FiltrosDashboard,
  exceto: DimensaoFiltro,
): boolean {
  return (
    (exceto === "status" || casaStatus(p, f.status)) &&
    (exceto === "especial" || casaEspecial(p, f.especial)) &&
    (exceto === "ganho" || casaGanho(p, f.ganho)) &&
    (exceto === "area" || casaArea(p, f.area)) &&
    (exceto === "parecer" || casaParecer(p, f.parecer)) &&
    (exceto === "periodo" || casaPeriodo(p, f.periodo)) &&
    (exceto === "estrelas" || casaEstrelas(p, f.estrelasMin, f.estrelasMax))
  );
}

/** Composição AND de todas as dimensões — a fonte única de "o que a tela mostra". */
export function aplicarFiltros(
  projetos: ProjetoDashboardResumo[],
  f: FiltrosDashboard,
): ProjetoDashboardResumo[] {
  return projetos.filter(
    (p) =>
      casaStatus(p, f.status) &&
      casaEspecial(p, f.especial) &&
      casaGanho(p, f.ganho) &&
      casaArea(p, f.area) &&
      casaParecer(p, f.parecer) &&
      casaPeriodo(p, f.periodo) &&
      casaEstrelas(p, f.estrelasMin, f.estrelasMax),
  );
}

/**
 * Quantas dimensões estão recortando a lista — o número do botão "Limpar filtros".
 * O status fica de FORA: ele já é a faixa de pílulas, com contagem própria e sempre visível.
 */
export function contarFiltrosAtivos(f: FiltrosDashboard): number {
  return (
    (f.especial !== "todos" ? 1 : 0) +
    (f.ganho !== "todos" ? 1 : 0) +
    (f.area !== TODAS_AS_AREAS ? 1 : 0) +
    (f.parecer !== TODOS_OS_PARECERES ? 1 : 0) +
    (f.periodo ? 1 : 0) +
    // A faixa de estrelas é UMA dimensão, mesmo com as duas pontas preenchidas.
    (f.estrelasMin != null || f.estrelasMax != null ? 1 : 0)
  );
}

/**
 * Áreas presentes na listagem, em ordem alfabética pt-BR. É a lista do `<select>`: mostrar
 * o catálogo inteiro da TeamGuide encheria o campo de área sem nenhum projeto.
 */
export function areasDisponiveis(projetos: ProjetoDashboardResumo[]): string[] {
  const set = new Set<string>();
  for (const p of projetos) if (p.area) set.add(p.area);
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Estados de parecer presentes **no recorte atual**, na ordem de leitura
 * (`ORDEM_ESTADO_PARECER`) e com a contagem de cada um — é a lista do `<select>` de pré-status.
 *
 * ⚠️ **A contagem respeita os DEMAIS filtros** (natureza · ganho · área · período · estrelas ·
 * fila de status), exatamente como a das pílulas: contando sobre a planilha inteira, o campo
 * dizia "Pré-pendente (26)" e abria uma lista de 3 quando havia outro filtro ligado — a
 * "contagem errada" relatada. A régua é `casaFiltrosExceto(..., 'parecer')`, e o "exceto" é o
 * que impede o campo de se esvaziar ao escolher um estado (o mesmo motivo pelo qual a faixa de
 * pílulas ignora a própria dimensão de status).
 *
 * ⚠️ O estado **selecionado nunca desaparece** do campo, mesmo com 0 no recorte: um `<select>`
 * cujo `value` não existe entre as `<option>` renderiza em branco e a pessoa perde a noção do
 * que está filtrando (e de como desfazer).
 */
export function pareceresDisponiveis(
  projetos: ProjetoDashboardResumo[],
  f: FiltrosDashboard = FILTROS_VAZIOS,
): { estado: EstadoParecer; total: number }[] {
  const contagem = new Map<EstadoParecer, number>();
  for (const p of projetos) {
    if (!casaFiltrosExceto(p, f, "parecer")) continue;
    const k = chaveDoEstado(p.aprovacaoLider);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  const selecionado = f.parecer !== TODOS_OS_PARECERES ? f.parecer : null;
  return ORDEM_ESTADO_PARECER.filter(
    (e) => contagem.has(e) || e === selecionado,
  ).map((e) => ({ estado: e, total: contagem.get(e) ?? 0 }));
}

/**
 * Contagem por pílula de status **respeitando os demais filtros** — é o que faz "Pendentes"
 * mostrar 12 quando "Especiais" está ligado, em vez de repetir o total de pendentes da
 * planilha. Sem isso, clicar numa pílula com contagem 40 poderia abrir uma lista de 3.
 */
export function contarPorPilula(
  projetos: ProjetoDashboardResumo[],
  f: FiltrosDashboard,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of projetos) {
    // Ignora a PRÓPRIA dimensão de status (senão a faixa colapsaria na fila escolhida) —
    // mesma régua do campo de pré-status, agora numa fonte única.
    if (!casaFiltrosExceto(p, f, "status")) continue;
    const k = pilulaDe(p.statusChave);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Total que a pílula "Todos" mostra — o mesmo recorte, sem o status. */
export function totalSemStatus(projetos: ProjetoDashboardResumo[], f: FiltrosDashboard): number {
  // "Todos" é a fila — sem os descontinuados (que têm pílula própria). Sem esta exclusão o
  // total contaria projetos que a pílula "Todos" agora esconde (casaStatus), e o número não
  // bateria com a lista.
  return Object.entries(contarPorPilula(projetos, f)).reduce(
    (a, [k, v]) => (k === "descontinuado" ? a : a + v),
    0,
  );
}
