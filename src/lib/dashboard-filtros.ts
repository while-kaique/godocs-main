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
};

export const FILTROS_VAZIOS: FiltrosDashboard = {
  status: "todos",
  especial: "todos",
  ganho: "todos",
  area: TODAS_AS_AREAS,
  parecer: TODOS_OS_PARECERES,
  periodo: null,
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

export function casaStatus(p: ProjetoDashboardResumo, status: string): boolean {
  return status === "todos" || pilulaDe(p.statusChave) === status;
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
      casaPeriodo(p, f.periodo),
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
    (f.periodo ? 1 : 0)
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
 * Estados de parecer PRESENTES na listagem, na ordem de leitura (`ORDEM_ESTADO_PARECER`) e
 * com a contagem de cada um — é a lista do `<select>` de pré-status. Mesma régua do filtro
 * de área: opção que não casa com projeto nenhum não entra no campo.
 */
export function pareceresDisponiveis(
  projetos: ProjetoDashboardResumo[],
): { estado: EstadoParecer; total: number }[] {
  const contagem = new Map<EstadoParecer, number>();
  for (const p of projetos) {
    const k = chaveDoEstado(p.aprovacaoLider);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  return ORDEM_ESTADO_PARECER.filter((e) => contagem.has(e)).map((e) => ({
    estado: e,
    total: contagem.get(e)!,
  }));
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
    if (!casaEspecial(p, f.especial)) continue;
    if (!casaGanho(p, f.ganho)) continue;
    if (!casaArea(p, f.area)) continue;
    if (!casaParecer(p, f.parecer)) continue;
    if (!casaPeriodo(p, f.periodo)) continue;
    const k = pilulaDe(p.statusChave);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Total que a pílula "Todos" mostra — o mesmo recorte, sem o status. */
export function totalSemStatus(projetos: ProjetoDashboardResumo[], f: FiltrosDashboard): number {
  return Object.values(contarPorPilula(projetos, f)).reduce((a, b) => a + b, 0);
}
