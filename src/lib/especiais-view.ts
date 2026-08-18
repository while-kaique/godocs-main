/**
 * Comparador de projetos ESPECIAIS — agrupamento por NÍVEL de estrela (módulo PURO).
 *
 * ## O problema
 * A coluna "Estrelas" é um número sem denominador: 1, 2 e 3 não têm definição escrita e
 * comparar dois especiais exige abrir duas documentações longas. Foi o que apareceu na
 * discussão GoBrands × PIAPP (18/08/2026): um projeto saiu de 8 estrelas para "será que vale
 * alguma?" numa conversa só.
 *
 * ## Quem responde a isso agora
 * A **recomendação da auditoria** (`especiais-regua.ts` + `especial_avaliacao`): cada projeto
 * chega com nota sugerida, confiança e a leitura que diz por que a faixa, por que não sobe e o
 * que faria subir. A tela agrupa por nível e mostra a régua da ESCALA no cabeçalho da coluna
 * (definição da faixa + quão rara ela é na base).
 *
 * ⚠️ A **"régua deste nível"** — prateleira com um projeto-âncora fixado por nível — foi
 * REMOVIDA em 18/08/2026, no mesmo dia em que nasceu: ela existia para dar contra o que
 * comparar enquanto não havia avaliação automática, e o agente ocupou esse lugar com um texto
 * por projeto. Manter as duas deixaria duas réguas concorrentes na mesma tela. A tabela
 * `especial_referencia` fica de pé, sem leitor (remover é arquivar, jamais DROP).
 */
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

/**
 * Colunas que a tela SEMPRE mostra, mesmo vazias — a régua tem de ser visível inteira, senão
 * "não existe projeto de 4" é lido como "4 não existe". Notas acima disso ganham coluna só
 * quando há projeto ou âncora nelas (a escala é aberta: há 7, 8 e 10 na planilha).
 */
export const NOTAS_BASE = [0, 1, 2, 3, 4, 5] as const;

/** Chave da coluna dos que ninguém pontuou ainda — `null` ≠ 0 (ver o resumo da listagem). */
export const SEM_NOTA = 'sem-nota';

/** Teto do modo comparar: 3 cartões lado a lado ainda cabem sem virar carrossel. */
export const MAX_COMPARAR = 3;

export type ColunaEspeciais = {
  /** `'sem-nota'` ou a nota como string — serve de `key` e de alvo do "mover para". */
  chave: string;
  /** `null` = coluna dos sem nota. */
  nota: number | null;
  rotulo: string;
  /** Os projetos do nível, do mais recente para o mais antigo. */
  projetos: ProjetoDashboardResumo[];
  total: number;
};

/** Rótulo curto da coluna. */
export function rotuloNota(nota: number | null): string {
  if (nota == null) return 'Sem nota';
  if (nota === 0) return 'Zero';
  return `${nota} ${nota === 1 ? 'estrela' : 'estrelas'}`;
}

/** Só os especiais entram nesta tela — os financeiros têm o R$ como régua. */
export function apenasEspeciais(projetos: ProjetoDashboardResumo[]): ProjetoDashboardResumo[] {
  return projetos.filter((p) => p.especial);
}

/** Mais recente primeiro; sem data vai para o fim (mesma regra da listagem). */
function porDataDesc(a: ProjetoDashboardResumo, b: ProjetoDashboardResumo): number {
  if (a.dataOrdenacao == null && b.dataOrdenacao == null) {
    return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  }
  if (a.dataOrdenacao == null) return 1;
  if (b.dataOrdenacao == null) return -1;
  return b.dataOrdenacao - a.dataOrdenacao;
}

/** Monta as colunas: uma por nível, com os projetos daquele nível. */
export function agruparEspeciais(projetos: ProjetoDashboardResumo[]): ColunaEspeciais[] {
  const especiais = apenasEspeciais(projetos);

  const notas = new Set<number>(NOTAS_BASE);
  for (const p of especiais) if (p.estrelas != null && p.estrelas > 0) notas.add(p.estrelas);

  const chaves: (number | null)[] = [null, ...[...notas].sort((a, b) => a - b)];

  return chaves.map((nota) => {
    const doNivel = especiais
      .filter((p) => (nota == null ? p.estrelas == null : p.estrelas === nota))
      .sort(porDataDesc);
    return {
      chave: nota == null ? SEM_NOTA : String(nota),
      nota,
      rotulo: rotuloNota(nota),
      projetos: doNivel,
      total: doNivel.length,
    };
  });
}

// ─── Filtros e paginação da coluna ───────────────────────────────────────────

/**
 * Quantos cartões uma coluna mostra de cara, e quantos entram a cada "Carregar mais".
 *
 * Por que 7: a coluna tem de caber na tela sem virar rolagem infinita — com a base inteira,
 * o nível 1 sozinho passa de 40 cartões e a comparação entre colunas (o ponto da tela) some.
 * O incremento é menor que o inicial de propósito: quem clica está procurando UM projeto, não
 * lendo a coluna inteira.
 */
export const CARTOES_INICIAIS = 7;
export const CARTOES_INCREMENTO = 5;

export type FiltrosEspeciais = {
  /** Texto livre — casa nome, autor, e-mail, id, área e ferramenta (índice do resumo). */
  termo: string;
  /** Janela de Data Submissão, ou `null` para todas. */
  periodo: { inicio: string; fim: string } | null;
  /** Só onde a auditoria discorda da nota gravada. */
  soDivergentes: boolean;
};

export const FILTROS_ESPECIAIS_VAZIOS: FiltrosEspeciais = {
  termo: '',
  periodo: null,
  soDivergentes: false,
};

/** Quantos filtros estão ativos — o número no gatilho do painel. */
export function contarFiltrosEspeciais(f: FiltrosEspeciais): number {
  return (f.termo.trim() ? 1 : 0) + (f.periodo ? 1 : 0) + (f.soDivergentes ? 1 : 0);
}
