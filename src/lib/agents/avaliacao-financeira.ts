/**
 * Especialista FINANCEIRO do time autônomo de avaliação (fatia B) — PURO e determinístico.
 *
 * Olha o saving/receita já estruturados (não o texto do memorial) e vota sobre a COERÊNCIA
 * financeira: materialidade alta (decisão humana), saving/receita marcados sem ganho, e a
 * suspeita de DUPLA CONTAGEM custo evitado × receita (o buraco do Sucesso.AI, em que o mesmo
 * dinheiro entrava dos dois lados). Devolve `{veredito, confianca, motivo, sinais}` — um voto
 * que o AGREGADOR (agregador-avaliacao.ts) concilia com o FTE e o sinal do RAG.
 *
 * Irmão de `avaliarPlausibilidadeFTE`/`decidirStatusSubmissao`: pura, testável, sem LLM.
 * A `confianca` aqui é "quão seguro dá para AUTO-DECIDIR sem humano": alta no 'ok', baixa no
 * 'atencao' (há red flag), média no 'inconclusivo' (não há dado financeiro para julgar).
 */

/** Teto de materialidade (R$/mês) acima do qual a decisão é sempre humana (mesma régua do analyzer). */
export const TETO_MATERIALIDADE_FINANCEIRO = 5000;

export type VeredictoFinanceiro = 'ok' | 'atencao' | 'inconclusivo';

export type ResultadoFinanceiro = {
  veredito: VeredictoFinanceiro;
  /** 0..1 — confiança de que dá para auto-decidir sem humano (ok alto, atencao baixo). */
  confianca: number;
  /** Motivo legível ao humano — null quando 'ok' limpo (sem nada a apontar). */
  motivo: string | null;
  /** Sinais individuais detectados (auditoria). */
  sinais: string[];
};

/** Número finito ou 0 — normaliza null/undefined/NaN. */
function num(v: number | null | undefined): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/** R$ pt-BR curto para os motivos legíveis. */
function reais(v: number): string {
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
}

/**
 * Avalia a coerência financeira da submissão. PURA.
 *
 * "Tem dados financeiros" = marcou saving/receita OU há algum valor positivo (custo evitado,
 * receita, economia líquida, materialidade). Sem nada disso → 'inconclusivo' (não há o que
 * julgar; o agregador trata como confiança média). Com dados, aplica as checagens; qualquer
 * red flag → 'atencao'; nenhuma → 'ok'.
 */
export function avaliarFinanceiro(input: {
  temSaving?: boolean | null;
  temReceita?: boolean | null;
  economiaReaisMes?: number | null;
  economiaHorasMes?: number | null;
  custoEvitadoReais?: number | null;
  valorReceitaMensal?: number | null;
  materialidade?: number | null;
  teto?: number | null;
}): ResultadoFinanceiro {
  const teto =
    typeof input.teto === 'number' && isFinite(input.teto) && input.teto > 0
      ? input.teto
      : TETO_MATERIALIDADE_FINANCEIRO;

  const economiaReais = num(input.economiaReaisMes);
  const custoEvitado = num(input.custoEvitadoReais);
  const receita = num(input.valorReceitaMensal);
  const materialidade = num(input.materialidade);
  const temSaving = !!input.temSaving;
  const temReceita = !!input.temReceita;

  const temDados =
    temSaving ||
    temReceita ||
    economiaReais > 0 ||
    custoEvitado > 0 ||
    receita > 0 ||
    materialidade > 0;

  if (!temDados) {
    return {
      veredito: 'inconclusivo',
      confianca: 0.5,
      motivo: 'Sem dados financeiros para avaliar — nem saving nem receita declarados.',
      sinais: ['sem dados financeiros'],
    };
  }

  const sinais: string[] = [];

  if (materialidade > teto) {
    sinais.push(
      `Materialidade de ${reais(materialidade)}/mês acima do teto de ${reais(teto)}/mês — decisão humana.`,
    );
  }
  if (temSaving && economiaReais <= 0) {
    sinais.push('Saving marcado mas sem ganho líquido positivo (economia mensal ≤ 0).');
  }
  if (temReceita && receita <= 0) {
    sinais.push('Receita marcada mas sem valor incremental positivo.');
  }
  // Dupla contagem: custo evitado E receita ambos positivos e praticamente iguais → o mesmo
  // dinheiro pode estar contado dos dois lados (o caso Sucesso.AI). Tolerância de 1%.
  if (custoEvitado > 0 && receita > 0) {
    const maxv = Math.max(custoEvitado, receita);
    if (maxv > 0 && Math.abs(custoEvitado - receita) / maxv <= 0.01) {
      sinais.push(
        'Possível dupla contagem: custo evitado ≈ receita incremental (o mesmo dinheiro pode estar contado dos dois lados).',
      );
    }
  }

  const veredito: VeredictoFinanceiro = sinais.length > 0 ? 'atencao' : 'ok';
  const confianca = veredito === 'ok' ? 0.9 : 0.3;
  const motivo = sinais.length > 0 ? sinais.join(' ') : null;

  return { veredito, confianca, motivo, sinais };
}
