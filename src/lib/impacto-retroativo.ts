/**
 * RETROATIVO DO IMPACTO — traduz uma linha da planilha para a régua da v2 (`impacto.ts`).
 * Módulo PURO: nada de rede, nada de banco. Quem move dado é o runner.
 *
 * Por que existe: as 581 linhas que já estão na aba foram escritas sob a régua da v1, onde
 * "Ganho Total" era `Saving Reais + 10%×Receita` e o pontual entrava pelo valor cheio. A v2
 * mudou a CONTA (pesos 100/50/10, custo para rodar abatendo 100%, mensalização por BLOCO,
 * pontual ÷4) e criou a coluna `Impacto Líquido Mensal`, que hoje está **zerada em 100% das
 * linhas** — é ela que o Gomoon vai consumir. Sem retroativo, a série histórica inteira
 * continua falando v1 e o número novo nasce sem passado.
 *
 * ⚠️ **FAIL-CLOSED por LINHA, nunca por corrida.** Uma célula de frequência que o vocabulário
 * não reconhece ("Misto", vazio com valor em cima) NÃO vira um chute: a linha sai como
 * `nao_convertido` com o motivo nomeado, mantém o valor que já tinha, e a corrida segue. É a
 * mesma disciplina de `reconciliar-financeiro.ts` ("não adivinha → aborta"), com a diferença
 * de que aqui abortar tudo por causa de 2 linhas seria pior do que reportá-las.
 *
 * ⚠️ **Frequência só importa quando há valor.** Bloco zerado com a célula em "—" é o caso
 * NORMAL (537 das 581 linhas não têm saving efetivado), e recusá-lo transformaria a regra
 * fail-closed numa recusa da base inteira. Zero dividido por qualquer divisor é zero.
 */
import {
  impactoBruto,
  impactoLiquido,
  impactoLiquidoMensal,
  mensalizar,
  type Frequencia,
  type GanhosProjeto,
} from './impacto';

/** As colunas que o retroativo LÊ. Nomear aqui é o contrato com a planilha. */
export const COLUNAS_ENTRADA = {
  savingAntes: 'Saving Efetivado',
  savingAgora: 'Saving Efetivado Agora',
  freqSaving: 'Freq. Saving Efetivado',
  ceHoras: 'Custo Evitado Horas Reais',
  ceNaoContratado: 'Custo Evitado Não Contratado',
  freqCe: 'Freq. Custo Evitado',
  receita: 'Receita Incremental',
  freqReceita: 'Freq. Receita',
  custoRodar: 'Custo para Rodar',
  freqCustoRodar: 'Freq. Custo para Rodar',
} as const;

/** As 3 colunas que ele ESCREVE. */
export const COLUNAS_SAIDA = {
  bruto: 'Impacto Bruto',
  liquido: 'Impacto Líquido',
  liquidoMensal: 'Impacto Líquido Mensal',
} as const;

export type LinhaPlanilha = Record<string, string | number | null | undefined>;

/**
 * Número em pt-BR. Vazio/"—"/lixo → 0. ⚠️ Mesma leitura do `padronizarLinha` do sync: se as
 * duas divergissem, o retroativo recomputaria em cima de um número diferente do que a
 * planilha exibe.
 */
export function numeroBR(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[^0-9,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const VOCABULARIO: Record<string, Frequencia> = {
  mensal: 'mensal',
  pontual: 'pontual',
  trimestral: 'trimestral',
  semestral: 'semestral',
};

/**
 * Frequência de um bloco. `valor === 0` → devolve `'mensal'` (divisor 1) **sem olhar a
 * célula**: com zero em cima, a frequência não muda resultado nenhum e cobrá-la recusaria
 * a maioria da base. Com valor e célula irreconhecível → `null` (o chamador reprova a linha).
 */
export function interpretarFrequencia(celula: unknown, valor: number): Frequencia | null {
  if (valor === 0) return 'mensal';
  const chave = String(celula ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return VOCABULARIO[chave] ?? null;
}

export type ConversaoOk = { ok: true; ganhos: GanhosProjeto };
export type ConversaoErro = { ok: false; motivo: string };

/**
 * Linha da planilha → `GanhosProjeto` da v2.
 *
 * ⚠️ **O saving é a DIFERENÇA** (`antes − agora`), clampada em 0 — é a régua da v2 (uma
 * despesa que caiu de 20k para 5k economiza 15k, não 20k). Nas 581 linhas legadas a coluna
 * "Agora" está vazia, então `antes − 0 = antes` e o legado passa intacto por esta conta.
 */
export function converterLinha(row: LinhaPlanilha): ConversaoOk | ConversaoErro {
  const C = COLUNAS_ENTRADA;
  const savingAntes = numeroBR(row[C.savingAntes]);
  const savingAgora = numeroBR(row[C.savingAgora]);
  const saving = Math.max(0, savingAntes - savingAgora);
  const ceHoras = numeroBR(row[C.ceHoras]);
  const ceNao = numeroBR(row[C.ceNaoContratado]);
  const receita = numeroBR(row[C.receita]);
  const custo = numeroBR(row[C.custoRodar]);

  const freqs: Array<[Frequencia | null, string, number]> = [
    [interpretarFrequencia(row[C.freqSaving], saving), C.freqSaving, saving],
    [interpretarFrequencia(row[C.freqCe], ceHoras + ceNao), C.freqCe, ceHoras + ceNao],
    [interpretarFrequencia(row[C.freqReceita], receita), C.freqReceita, receita],
    [interpretarFrequencia(row[C.freqCustoRodar], custo), C.freqCustoRodar, custo],
  ];
  const ruim = freqs.find(([f]) => f === null);
  if (ruim) {
    return {
      ok: false,
      motivo: `"${ruim[1]}" = ${JSON.stringify(String(row[ruim[1] as keyof typeof row] ?? ''))} não é frequência conhecida, e o bloco vale ${ruim[2]}`,
    };
  }
  const [fSaving, fCe, fReceita, fCusto] = freqs.map(([f]) => f as Frequencia);

  return {
    ok: true,
    ganhos: {
      savingEfetivado: { valor: saving, frequencia: fSaving },
      custoEvitado: { horas: ceHoras, naoContratado: ceNao, frequencia: fCe },
      receita: { valor: receita, frequencia: fReceita },
      custoRodar: [{ valor: custo, frequencia: fCusto }],
    },
  };
}

export type ImpactoDaLinha = {
  bruto: number;
  liquido: number;
  liquidoMensal: number;
};

/**
 * Três desfechos, e o do meio é o que impede o retroativo de DESTRUIR a base:
 *
 *  · `recalculada`  — a linha tem componentes; os 3 números saem da régua v2.
 *  · `preservada`   — a linha NÃO tem nenhum componente em R$, mas TEM o agregado da v1.
 *    São as 55 linhas do import legado, que trouxeram as HORAS mas nunca o "Horas em
 *    Reais": recomputar dos componentes as zeraria (−R$ 65 mil de impacto que existe e
 *    está aprovado). Bruto e líquido ficam como estão; só o **mensal** é derivado, pela
 *    frequência das horas — é o mesmo tratamento que a régua `legado` do Gomoon já dava,
 *    e é melhor que deixar a coluna nova em zero para elas.
 *  · `nao_convertida` — frequência que o vocabulário não reconhece com valor em cima.
 *    Preserva os 3 números e NOMEIA a célula; é dado a corrigir na planilha, não a chutar.
 */
export type LinhaRecalculada =
  | ({
      id: string;
      ok: true;
      desfecho: 'recalculada' | 'preservada';
      antes: ImpactoDaLinha;
      depois: ImpactoDaLinha;
      mudou: boolean;
    } & { ganhos: GanhosProjeto | null })
  | { id: string; ok: false; desfecho: 'nao_convertida'; motivo: string; antes: ImpactoDaLinha };

/** Epsilon de dinheiro do repo: abaixo de 1 centavo é ruído de ponto flutuante. */
export const EPSILON_REAIS = 0.01;

export function recalcularLinha(row: LinhaPlanilha, id: string): LinhaRecalculada {
  const C = COLUNAS_ENTRADA;
  const antes: ImpactoDaLinha = {
    bruto: numeroBR(row[COLUNAS_SAIDA.bruto]),
    liquido: numeroBR(row[COLUNAS_SAIDA.liquido]),
    liquidoMensal: numeroBR(row[COLUNAS_SAIDA.liquidoMensal]),
  };
  // ── Linha legada SEM componentes, mas COM agregado: preserva e só normaliza no tempo.
  // Vem ANTES da conversão de propósito — sem componentes, a checagem de frequência não
  // teria o que reprovar (todos os blocos valem 0) e a linha sairia "recalculada" com 3
  // zeros, apagando um impacto real e aprovado.
  const semComponentes =
    numeroBR(row[C.savingAntes]) === 0 &&
    numeroBR(row[C.ceHoras]) === 0 &&
    numeroBR(row[C.ceNaoContratado]) === 0 &&
    numeroBR(row[C.receita]) === 0;
  if (semComponentes && (antes.bruto !== 0 || antes.liquido !== 0)) {
    // A frequência das HORAS é a do processo (a coluna que a v1 chamava "Tipo de Saving");
    // desconhecida → mensal, que é o divisor 1: preservar é o objetivo, e um divisor
    // chutado alteraria o número em vez de só transportá-lo.
    const freq = interpretarFrequencia(row[C.freqCe], 1) ?? 'mensal';
    return {
      id,
      ok: true,
      desfecho: 'preservada',
      antes,
      depois: {
        bruto: antes.bruto,
        liquido: antes.liquido,
        liquidoMensal: mensalizar(antes.liquido, freq),
      },
      mudou: Math.abs(mensalizar(antes.liquido, freq) - antes.liquidoMensal) > EPSILON_REAIS,
      ganhos: null,
    };
  }

  const conv = converterLinha(row);
  if (!conv.ok) return { id, ok: false, desfecho: 'nao_convertida', motivo: conv.motivo, antes };
  const depois: ImpactoDaLinha = {
    bruto: impactoBruto(conv.ganhos),
    liquido: impactoLiquido(conv.ganhos),
    liquidoMensal: impactoLiquidoMensal(conv.ganhos),
  };
  const mudou =
    Math.abs(depois.bruto - antes.bruto) > EPSILON_REAIS ||
    Math.abs(depois.liquido - antes.liquido) > EPSILON_REAIS ||
    Math.abs(depois.liquidoMensal - antes.liquidoMensal) > EPSILON_REAIS;
  return { id, ok: true, desfecho: 'recalculada', antes, depois, mudou, ganhos: conv.ganhos };
}

export type ResumoRetroativo = {
  linhas: number;
  recalculadas: number;
  preservadas: number;
  mudaram: number;
  nao_convertidas: Array<{ id: string; motivo: string }>;
  totais: { antes: ImpactoDaLinha; depois: ImpactoDaLinha };
};

/** Consolida a corrida — os totais são a conferência humana antes de deixar gravar. */
export function resumir(linhas: LinhaRecalculada[]): ResumoRetroativo {
  const zero = (): ImpactoDaLinha => ({ bruto: 0, liquido: 0, liquidoMensal: 0 });
  const totais = { antes: zero(), depois: zero() };
  const nao: Array<{ id: string; motivo: string }> = [];
  let recalculadas = 0;
  let preservadas = 0;
  let mudaram = 0;
  for (const l of linhas) {
    totais.antes.bruto += l.antes.bruto;
    totais.antes.liquido += l.antes.liquido;
    totais.antes.liquidoMensal += l.antes.liquidoMensal;
    if (l.ok) {
      if (l.desfecho === 'preservada') preservadas += 1;
      else recalculadas += 1;
      if (l.mudou) mudaram += 1;
      totais.depois.bruto += l.depois.bruto;
      totais.depois.liquido += l.depois.liquido;
      totais.depois.liquidoMensal += l.depois.liquidoMensal;
    } else {
      nao.push({ id: l.id, motivo: l.motivo });
      // Linha não convertida PRESERVA o valor que já tinha — por isso entra no "depois"
      // com o número de antes. Somar zero aqui faria o relatório anunciar uma queda que
      // a gravação não vai executar.
      totais.depois.bruto += l.antes.bruto;
      totais.depois.liquido += l.antes.liquido;
      totais.depois.liquidoMensal += l.antes.liquidoMensal;
    }
  }
  return { linhas: linhas.length, recalculadas, preservadas, mudaram, nao_convertidas: nao, totais };
}
