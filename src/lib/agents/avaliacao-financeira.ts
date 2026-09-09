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
 *
 * ⚠️ **Havia TETO e não havia PISO** (achado A2 do plano de calibragem, 08/09/2026): um projeto de
 * R$ 18,16/mês voltava `ok` com confiança 0,9, e foi por esse eixo que o dono do produto reprovou
 * 137 projetos à mão em 04/09. O piso entra por `abaixoDoPisoDeImpacto` (régua declarada em
 * `materialidade-piso.ts`, nunca literal solto aqui) e vira **sinal próprio** + o campo
 * `abaixoDoPiso`, que é o que o agregador lê para emitir `reprovar` MECANICAMENTE.
 */
import {
  abaixoDoPisoDeImpacto,
  motivoPisoComEstrela,
  motivoPisoDeImpacto,
  reprovaPeloPiso,
  PISO_IMPACTO_MENSAL,
} from '@/lib/materialidade-piso';

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
  /**
   * O impacto mensal declarado é POSITIVO e menor que o piso (`PISO_IMPACTO_MENSAL`)?
   *
   * ⚠️ Campo MECÂNICO, e é o único sinal deste módulo que o agregador transforma em `reprovar`.
   * ⚠️ Ausência de número (0/null) devolve `false` — projeto especial e ganho imensurável não
   * prometem valor, e reprovar por ausência reprovaria as duas famílias inteiras.
   */
  abaixoDoPiso: boolean;
  /**
   * A régua COMPOSTA: impacto abaixo do piso **E** nota **ZERO** (`reprovaPeloPiso` — a régua é
   * estritamente `< 1`). É ESTE campo
   * que o agregador transforma em `reprovar` — não o `abaixoDoPiso`, que é só o sinal do dinheiro.
   *
   * ⚠️ Medido: os 137 que o dono do produto reprovou à mão tinham **todos 0★** — e por isso a
   * régua é `< 1`, não `<= 1` (o teto errado derrubava 6 projetos aprovados de 1★). O piso sozinho
   * derrubaria 10 projetos APROVADOS com 2★–4★, quase todos de processo, onde o valor não está no
   * dinheiro. `false` para qualquer nota ≥ 1 — ver `reprovaPeloPiso`.
   */
  reprovavel: boolean;
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
  /**
   * Nota do projeto (humana, ou a recomendada pelo agente na falta dela). Qualquer nota **≥ 1**
   * poupa a reprovação por impacto; ausência de nota NÃO poupa. Campo OPCIONAL: sem ele o comportamento é o de
   * antes do gate composto.
   */
  estrela?: number | null;
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
      abaixoDoPiso: false,
      reprovavel: false,
    };
  }

  const sinais: string[] = [];

  // PISO de impacto: a régua mecânica de D4. Fica ANTES do teto porque são os dois extremos da
  // mesma pergunta ("este número justifica um projeto?") e nenhum projeto pode disparar os dois.
  const abaixoDoPiso = abaixoDoPisoDeImpacto(materialidade, PISO_IMPACTO_MENSAL);
  const reprovavel = reprovaPeloPiso({ impactoMensal: materialidade, estrela: input.estrela });
  if (abaixoDoPiso) {
    // O sinal do dinheiro aparece sempre que o número é irrelevante; o texto da REPROVAÇÃO só
    // quando a nota também é baixa (senão o parecer afirmaria um desfecho que não vai acontecer).
    sinais.push(
      reprovavel
        ? motivoPisoComEstrela(materialidade, input.estrela, PISO_IMPACTO_MENSAL)
        : motivoPisoDeImpacto(materialidade, PISO_IMPACTO_MENSAL),
    );
  }
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

  return { veredito, confianca, motivo, sinais, abaixoDoPiso, reprovavel };
}
