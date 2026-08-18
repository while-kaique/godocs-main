/**
 * Comparador de projetos ESPECIAIS — módulo PURO (agrupamento por nota + âncoras).
 *
 * ## O problema que esta view resolve
 * A coluna "Estrelas" é um número sem denominador: 1, 2 e 3 não têm definição escrita, só o
 * número é gravado (nenhuma justificativa) e comparar dois especiais exige abrir duas
 * documentações longas. O resultado apareceu na discussão GoBrands × PIAPP (18/08/2026): um
 * projeto saiu de 8 estrelas para "será que vale alguma?" — não por erro de julgamento, mas
 * porque a escala não existe fora da cabeça de quem tria naquele dia.
 *
 * ## A régua: ÂNCORA, não rubrica absoluta
 * Gente é ruim em nota absoluta e boa em comparação. Por isso a unidade desta tela não é
 * "quantas estrelas isto vale?" e sim "isto é maior ou menor que o PIAPP?". Cada nível pode
 * ter uma ou mais **referências** (os "flagships") fixadas no topo da coluna, com a frase que
 * diz o que aquele nível significa. A nota de um projeto novo passa a ser posicionamento
 * contra âncoras visíveis — e a frase da âncora é a definição do nível, escrita por quem tria.
 *
 * ⚠️ A referência é um projeto REAL da base, nunca um texto solto: é o que impede a régua de
 * virar teoria e o que dá à próxima pessoa (e, na fase seguinte, ao agente) um caso concreto
 * com que comparar.
 */
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

/** Uma âncora: o projeto-referência de um nível + a frase que define o nível. */
export type ReferenciaEspecial = {
  projeto_id: string;
  /** Nível que este projeto ancora. Casa com a nota gravada na planilha. */
  nota: number;
  /** A régua em uma frase ("dashboard que atende várias áreas e move um KPI"). */
  motivo: string | null;
  definido_por: string | null;
  definido_em: string | null;
};

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
  /** A frase da régua, herdada da 1ª âncora do nível. `null` = nível ainda sem definição. */
  regua: string | null;
  /** Âncoras do nível, no topo da coluna. */
  ancoras: ProjetoDashboardResumo[];
  /** Os demais projetos do nível. */
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

/**
 * Monta as colunas: uma por nível, âncoras no topo.
 *
 * ⚠️ Uma âncora é mostrada na coluna da NOTA DO PROJETO, não na `nota` da referência: quem
 * regrava a estrela de um projeto-âncora na ficha do `/dashboard` moveria o cartão para uma
 * coluna e a régua para outra, e a tela afirmaria que o nível 3 é definido por um projeto que
 * está no nível 2. A `nota` da referência serve de intenção declarada — a divergência aparece
 * como aviso no cartão, em vez de sumir.
 */
export function agruparEspeciais(
  projetos: ProjetoDashboardResumo[],
  referencias: ReferenciaEspecial[],
): ColunaEspeciais[] {
  const especiais = apenasEspeciais(projetos);
  const ancoraDe = new Map(referencias.map((r) => [r.projeto_id, r]));

  const notas = new Set<number>(NOTAS_BASE);
  for (const p of especiais) if (p.estrelas != null && p.estrelas > 0) notas.add(p.estrelas);
  for (const r of referencias) notas.add(r.nota);

  const chaves: (number | null)[] = [null, ...[...notas].sort((a, b) => a - b)];

  return chaves.map((nota) => {
    const doNivel = especiais.filter((p) =>
      nota == null ? p.estrelas == null : p.estrelas === nota,
    );
    const ancoras = doNivel.filter((p) => ancoraDe.has(p.id)).sort(porDataDesc);
    const resto = doNivel.filter((p) => !ancoraDe.has(p.id)).sort(porDataDesc);
    // A régua do nível vem da 1ª âncora que tenha frase — âncora sem motivo não apaga a
    // definição que outra escreveu.
    const regua = ancoras.map((a) => ancoraDe.get(a.id)?.motivo).find((m) => m) ?? null;
    return {
      chave: nota == null ? SEM_NOTA : String(nota),
      nota,
      rotulo: rotuloNota(nota),
      regua,
      ancoras,
      projetos: resto,
      total: doNivel.length,
    };
  });
}

/**
 * O que o modo comparar deve mostrar: os selecionados + a âncora do nível de cada um, para a
 * comparação nunca ser só "projeto novo × projeto novo". Sem duplicar e respeitando o teto.
 */
export function alvosDaComparacao(
  selecionados: string[],
  colunas: ColunaEspeciais[],
): string[] {
  const out: string[] = [];
  for (const id of selecionados.slice(0, MAX_COMPARAR)) if (!out.includes(id)) out.push(id);
  for (const id of selecionados.slice(0, MAX_COMPARAR)) {
    const coluna = colunas.find((c) => c.ancoras.some((a) => a.id === id) || c.projetos.some((p) => p.id === id));
    const ancora = coluna?.ancoras[0];
    if (ancora && !out.includes(ancora.id)) out.push(ancora.id);
  }
  return out;
}

/** Marca a divergência "âncora do nível 3 com nota 2 gravada" (ver `agruparEspeciais`). */
export function ancoraForaDoNivel(
  projeto: ProjetoDashboardResumo,
  referencia: ReferenciaEspecial | undefined,
): boolean {
  if (!referencia) return false;
  return (projeto.estrelas ?? null) !== referencia.nota;
}
