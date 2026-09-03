/**
 * A ORDEM em que o time trabalha — módulo PURO (a máquina, sem I/O e sem LLM).
 *
 * Pedido do Luis (03/09/2026): *"antes do consenso geral, o cético dos especiais deve ser
 * capaz de voltar pro próprio cérebro de especiais"*. Ou seja, os loops são LOCAIS e fecham
 * antes de a mesa se reunir:
 *
 *     ┌ cérebro de ESPECIAIS  ⇄  cético de especiais ┐   (até 2 voltas, local)
 *     ├ financeiro (leitura A) ⇄ financeiro (leitura B) ┤ (validação dupla, até 2 voltas)
 *     ├ plausibilidade / FTE                          ┤
 *     └ sinal do RAG                                  ┘
 *                              ↓
 *                       CONSENSO GERAL
 *                              ↓
 *              aprovado · reprovado · em_validacao
 *
 * ⚠️ **Por que local antes de geral, e não tudo numa mesa só.** Uma objeção sobre a ESTRELA
 * não tem como ser resolvida por quem olha saving — e uma mesa em que cada agente responde
 * sobre a especialidade do outro é onde a discussão vira consenso mole. Cada especialista
 * fecha a própria dúvida com quem entende dela; a mesa concilia CONCLUSÕES, não rascunhos.
 *
 * ⚠️ **Um loop que não fecha NÃO trava a esteira**: ele entra na mesa marcado como
 * `sem_consenso`, e é isso que manda o projeto ao humano. Loop infinito seria pior que
 * decisão discutível — é a lição das duas vezes em que este repo queimou com gates de chat.
 */
import { type DesfechoConsenso } from './cetico-especiais';
import { type ConferenciaFinanceira } from './financeiro-mega-brain';

export type FaseLocal = 'especiais' | 'financeiro';

export type ResultadoLocal = {
  fase: FaseLocal;
  /** O loop fechou com acordo? `false` → a mesa recebe isto como divergência. */
  fechou: boolean;
  /** Quantas voltas foram gastas — vai ao log dos agentes. */
  voltas: number;
  /** A conclusão em uma linha, para a view individual. */
  conclusao: string;
};

export function resumirEspeciais(d: DesfechoConsenso): ResultadoLocal {
  if (d.tipo === 'reprocessar')
    return { fase: 'especiais', fechou: false, voltas: d.estado.volta, conclusao: `ainda reprocessando: ${d.objecao}` };
  return {
    fase: 'especiais',
    fechou: d.tipo === 'aceito',
    voltas: d.voltas,
    conclusao: `${d.estrela}★ — ${d.racional}`,
  };
}

export function resumirFinanceiro(c: ConferenciaFinanceira): ResultadoLocal {
  if (c.tipo === 'confere')
    return { fase: 'financeiro', fechou: true, voltas: 0, conclusao: c.racional };
  if (c.tipo === 'reprocessar')
    return { fase: 'financeiro', fechou: false, voltas: c.volta, conclusao: c.racional };
  return { fase: 'financeiro', fechou: false, voltas: 2, conclusao: c.racional };
}

/**
 * O consenso GERAL só é considerado alcançado quando **todos** os loops locais fecharam.
 *
 * ⚠️ É um E, não uma média ponderada: um especialista que não fechou a própria dúvida não
 * tem conclusão a conciliar, e conciliar rascunho é como se produz um número que ninguém
 * defende depois.
 */
export function houveConsensoGeral(locais: ResultadoLocal[]): { consenso: boolean; pendentes: string[] } {
  const pendentes = locais.filter((l) => !l.fechou).map((l) => l.fase);
  return { consenso: pendentes.length === 0, pendentes };
}
