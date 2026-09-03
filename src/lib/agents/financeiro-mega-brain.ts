/**
 * FINANCEIRO como MEGA BRAIN — módulo PURO.
 *
 * ⚠️ **O que mudou, e por quê.** O especialista financeiro devolvia um rótulo
 * (`ok`/`atencao`) e um motivo do tipo *"conservador"*. Isso não decide nada: o Luis leu e
 * perguntou **"tá, mas e aí? diminui para quanto?"**. Um parecer que aponta um problema e não
 * diz o tamanho dele obriga um humano a refazer a conta — que é justamente o trabalho que o
 * agente deveria poupar.
 *
 * Agora ele produz um NÚMERO: o **impacto ajustado**, com o desconto NOMEADO e a conta
 * visível. A leitura que o produto quer é encadeada:
 *
 *     fórmula v1 → R$ 1,00 mi
 *     fórmula v2 → R$ 0,80 mi   (mudou a régua: CE a 50%, mensalização por bloco)
 *     agentes    → R$ 0,60 mi   (mudou a LEITURA: o que os agentes não sustentam)
 *
 * ⚠️ **Ele NÃO reescreve a planilha.** O impacto oficial continua saindo de `impacto.ts` —
 * determinístico, auditável, sem LLM. O ajuste é uma SEGUNDA leitura, com nome e motivo, para
 * a gestão saber quanto do número declarado se sustenta. Misturar as duas faria o número
 * oficial depender de um agente, e ninguém conseguiria reproduzir um total depois.
 *
 * ⚠️ **Só DESCONTA, nunca acrescenta.** Um agente que pode aumentar impacto é um agente que
 * pode ser convencido a aumentar impacto.
 */

export type MotivoDesconto =
  | 'sem_lastro_de_horas'
  | 'dupla_contagem'
  | 'ganho_projetado'
  | 'fonte_nao_verificavel'
  | 'materialidade_sem_evidencia';

/** Quanto cada achado desconta, e por quê. ⚠️ Declarado: não é o agente que escolhe o número. */
export const DESCONTO: Record<MotivoDesconto, { fator: number; porque: string }> = {
  // O memorial afirma horas que as linhas não sustentam. Metade porque o trabalho existe,
  // só não no tamanho declarado.
  sem_lastro_de_horas: { fator: 0.5, porque: 'as horas declaradas não batem com o que as linhas sustentam' },
  // O mesmo dinheiro aparece em dois blocos. Desconta o bloco inteiro: contar metade de uma
  // duplicidade continua sendo contar duas vezes.
  dupla_contagem: { fator: 0, porque: 'o mesmo dinheiro foi contado em dois lugares' },
  // Ganho que ainda não aconteceu não é ganho. Vai a zero — é a premissa nº 1 do GoDocs.
  ganho_projetado: { fator: 0, porque: 'o ganho é projetado, e o GoDocs só documenta o que já foi medido' },
  // Existe o número, não existe onde conferir. Metade: plausível, não verificável.
  fonte_nao_verificavel: { fator: 0.5, porque: 'o número não tem onde ser conferido' },
  // Valor alto sem nada que o sustente. Metade, e vai para a fila humana de qualquer jeito.
  materialidade_sem_evidencia: { fator: 0.5, porque: 'o valor é alto e a evidência não acompanha' },
};

export type AchadoFinanceiro = { motivo: MotivoDesconto; bloco: 'saving' | 'custo_evitado' | 'receita' | 'total'; detalhe: string };

export type LeituraFinanceira = {
  /** O que a fórmula diz (impacto líquido mensal). Nunca é alterado. */
  declarado: number;
  /** O que o time sustenta. `declarado` quando não há achado. */
  ajustado: number;
  /** A conta, linha a linha — é isto que responde "diminui para quanto, e por quê". */
  memoria: Array<{ de: number; para: number; porque: string }>;
  /** Vazio = o agente sustenta o número declarado. */
  achados: AchadoFinanceiro[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Aplica os descontos DECLARADOS, na ordem em que os achados chegam, e devolve a memória de
 * cálculo. Sem achado, `ajustado === declarado` — e isso também é um parecer: significa "o
 * time sustenta este número", que é informação, não ausência dela.
 */
export function lerImpacto(declarado: number, achados: AchadoFinanceiro[]): LeituraFinanceira {
  let atual = Math.max(0, declarado);
  const memoria: LeituraFinanceira['memoria'] = [];
  for (const a of achados) {
    const { fator, porque } = DESCONTO[a.motivo];
    const proximo = r2(atual * fator);
    memoria.push({ de: r2(atual), para: proximo, porque: `${porque} (${a.bloco}: ${a.detalhe})` });
    atual = proximo;
  }
  return { declarado: r2(Math.max(0, declarado)), ajustado: r2(atual), memoria, achados };
}

/**
 * A frase que a gestão lê. Sem traços, sem jargão, com os dois números e o motivo.
 * ⚠️ Nunca "conservador": o adjetivo era o problema.
 */
export function explicarLeitura(l: LeituraFinanceira, moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })): string {
  if (l.achados.length === 0)
    return `O time sustenta o impacto declarado de ${moeda(l.declarado)} por mês. Nenhum bloco ficou sem lastro.`;
  const passos = l.memoria.map((m) => `${moeda(m.de)} para ${moeda(m.para)}, porque ${m.porque}`);
  return `O impacto declarado é ${moeda(l.declarado)} por mês e o time sustenta ${moeda(l.ajustado)}. ${passos.join('. ')}.`;
}
