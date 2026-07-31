/**
 * Lógica pura da tabela de triagem (busca, ordenação, janela de páginas).
 *
 * Vive fora do componente para ser testável sem montar React — é a parte da tela onde
 * um erro passa desapercebido (um projeto que não aparece na busca não avisa que
 * sumiu).
 */
import type { ProjetoDashboardResumo } from '@/lib/dashboard-admin.functions';

export type Ordem = 'data' | 'nome' | 'autor' | 'ganho';
export type Direcao = 'asc' | 'desc';

/** Normaliza o termo com a MESMA regra do índice montado no servidor (`chaveBusca`). */
export function normalizarTermo(termo: string): string {
  return termo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Busca por tokens em AND: "helen reembolso" acha o projeto de reembolso da Helen, em
 * qualquer ordem. O índice (`p.busca`) já cobre nome do projeto, autor, e-mail, ID,
 * área e ferramenta.
 */
export function filtrarPorTermo(
  projetos: ProjetoDashboardResumo[],
  termo: string,
): ProjetoDashboardResumo[] {
  const termos = normalizarTermo(termo).split(/\s+/).filter(Boolean);
  if (!termos.length) return projetos;
  return projetos.filter((p) => termos.every((t) => p.busca.includes(t)));
}

/** Comparador ascendente; o componente inverte o sinal para descendente. */
export function compararProjetos(
  a: ProjetoDashboardResumo,
  b: ProjetoDashboardResumo,
  ordem: Ordem,
): number {
  switch (ordem) {
    case 'nome':
      return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
    case 'autor':
      return (a.autor ?? '').localeCompare(b.autor ?? '', 'pt-BR');
    case 'ganho':
      // Sem valor fica abaixo de zero: um projeto sem ganho não pode competir com um
      // de R$ 0 registrado.
      return (a.ganhoTotal ?? -1) - (b.ganhoTotal ?? -1);
    case 'data':
    default:
      return (a.dataOrdenacao ?? 0) - (b.dataOrdenacao ?? 0);
  }
}

/** Janela de páginas com elipses: `1 … 4 5 6 … 12`. `null` = elipse. */
export function paginasVisiveis(atual: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, total, atual, atual - 1, atual + 1]);
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let anterior = 0;
  for (const n of nums) {
    if (anterior && n - anterior > 1) out.push(null);
    out.push(n);
    anterior = n;
  }
  return out;
}
