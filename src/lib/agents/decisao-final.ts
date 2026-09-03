/**
 * DECISÃO FINAL do time de agentes — módulo PURO.
 *
 * Consolida os votos numa das **TRÊS** saídas que o produto reconhece (decisão do Luis,
 * 03/09/2026): **aprovado · reprovado · em_validacao**.
 *
 * ⚠️ **"Ajuste pedido" NÃO existe mais.** Ele era uma quarta via que parecia gentil e custava
 * caro: o autor recebia uma lista de reparos, refazia, e voltava para a mesma fila. Se a
 * criticidade do time não chega a reprovar, o projeto passa; se chega, reprova e o motivo é
 * dito por inteiro. O meio-termo virava fila.
 *
 * ⚠️ **`em_validacao` NÃO é o desfecho de "o agente ficou em dúvida" por preguiça** — é o
 * desfecho de duas situações nomeadas: o projeto é ESPECIAL (a estrela é decisão de comitê) ou
 * os agentes NÃO ENTRARAM EM CONSENSO. Qualquer outra dúvida tem de virar aprovação ou
 * reprovação, porque fila que ninguém abre é pior que decisão discutível.
 *
 * ⚠️ **Reprovar exige MOTIVO NOMEADO.** A régua é a mesma que já protege o analisador ("nunca
 * reprova sem motivo"): sem um apontamento concreto de algum especialista, o desfecho cai para
 * `em_validacao`. Reprovação sem motivo é a única falha aqui que destrói confiança de vez.
 */
import type { VeredictoAgregado } from './agregador-avaliacao';

export type StatusFinal = 'aprovado' | 'reprovado' | 'em_validacao';

export type ApontamentoGrave = {
  /** Quem apontou — aparece na view individual. */
  agente: string;
  /** O que está errado, em uma frase. */
  achado: string;
  /** 0..1 — o quanto o especialista confia neste achado. */
  confianca: number;
};

/**
 * Confiança mínima para um apontamento sustentar uma REPROVAÇÃO. Alta de propósito: reprovar
 * é a única saída que devolve trabalho ao autor, e um achado morno não paga esse custo.
 */
export const CONFIANCA_PARA_REPROVAR = 0.8;

export type EntradaDecisao = {
  veredito: VeredictoAgregado;
  /** Consenso entre os agentes: `false` manda ao humano, independentemente do resto. */
  consenso: boolean;
  especial: boolean;
  /** Apontamentos que, se graves e confiáveis, sustentam a reprovação. */
  apontamentos: ApontamentoGrave[];
  /** Classificação de elegibilidade do analisador ('claro_nao' = não é projeto). */
  classificacao?: 'claro_sim' | 'zona_cinzenta' | 'claro_nao' | null;
};

export type Decisao = {
  status: StatusFinal;
  /** Por que ESTE desfecho, em uma linha — a base do texto que o autor lê. */
  racional: string;
  /** Os achados que sustentam a decisão (vazio quando aprova). */
  sustentacao: ApontamentoGrave[];
};

export function decidirComTime(e: EntradaDecisao): Decisao {
  const graves = e.apontamentos.filter((a) => a.confianca >= CONFIANCA_PARA_REPROVAR);

  // 1. Especial nunca é decidido por agente — a estrela é de comitê.
  if (e.especial) {
    return {
      status: 'em_validacao',
      racional: 'projeto especial: a estrela é decisão de comitê humano, não do time de agentes',
      sustentacao: [],
    };
  }

  // 2. Sem consenso entre os agentes → humano. É a razão de existir a fila.
  if (!e.consenso) {
    return {
      status: 'em_validacao',
      racional: 'os agentes não chegaram a consenso',
      sustentacao: e.apontamentos,
    };
  }

  // 3. Reprovação: exige "não é projeto" OU um achado grave e confiável. Nunca sem motivo.
  if (e.classificacao === 'claro_nao' || graves.length > 0) {
    if (graves.length === 0 && e.classificacao === 'claro_nao') {
      // O analisador reprovou por critério mas ninguém sustentou com um achado concreto:
      // é exatamente o caso em que a régua manda NÃO reprovar sozinho.
      return {
        status: 'em_validacao',
        racional: 'a classificação diz que não é projeto, mas nenhum especialista sustentou o porquê',
        sustentacao: [],
      };
    }
    return {
      status: 'reprovado',
      racional:
        graves.length === 1
          ? graves[0].achado
          : `${graves.length} problemas que impedem a aprovação`,
      sustentacao: graves,
    };
  }

  // 4. O agregador pediu humano (materialidade alta, divergência…).
  if (e.veredito === 'em_validacao' || e.veredito === 'isento') {
    return { status: 'em_validacao', racional: 'a mesa pediu conferência humana', sustentacao: e.apontamentos };
  }

  return { status: 'aprovado', racional: 'os agentes concordaram e nada grave foi apontado', sustentacao: [] };
}
