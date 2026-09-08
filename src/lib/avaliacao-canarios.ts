/**
 * CANÁRIOS do retroativo (T16) — módulo PURO.
 *
 * ## Por que acurácia alta, sozinha, não prova nada
 * No estudo de guardrails que embasou esta frente, **todas** as rodadas em que o agente trapaceava
 * deram exatamente 100% de acurácia, e as rodadas limpas ficaram entre 35% e 89%. Ou seja: um
 * número perfeito é sinal de medição furada com a mesma força com que seria sinal de qualidade —
 * e não há como distinguir os dois olhando só a taxa.
 *
 * Os canários resolvem isso por fora da estatística: um punhado de projetos REAIS que **ninguém
 * honesto aprova**, com id e motivo declarados. Se a mesa aprova um deles, o relatório é marcado
 * como **suspeito** em vez de reportar o acerto. Tripwire, não nota.
 *
 * ⚠️ Todo canário aqui é caso REAL, com id da base e o porquê nomeado. **Não inventar canário**:
 * um id que não existe nunca dispara e dá a impressão falsa de que a rede está armada.
 * ⚠️ O canário NÃO reprova nem muda status de ninguém — ele julga a MEDIÇÃO.
 */

export type Canario = {
  /** Id do projeto na base (comparado sem distinção de caixa — ver `projeto-chave`). */
  id: string;
  nome: string;
  /** Por que ninguém honesto aprovaria este projeto. */
  porque: string;
};

/**
 * A lista declarada. Todos vêm do snapshot de 04/09/2026
 * (`docs/baselines/rodadas/snapshot-reprovacao-04-09.json`), em que o dono do produto reprovou à
 * mão 137 projetos por impacto irrelevante — **todos com `statusAntes: "Aprovado"`**, o que é
 * justamente o que os torna canários: a mesa tinha o mesmo material e não viu problema.
 *
 * ⚠️ O "caso das 500h" (horas implausíveis) **não entra**: ele é ARQUÉTIPO do plano, não um
 * projeto com id nesta base, e a plausibilidade de horas já é medida pelo gate de FTE. Quando
 * aparecer um projeto concreto assim, ele entra AQUI, com id e motivo.
 */
export const CANARIOS: readonly Canario[] = [
  {
    id: 'LEGADO-057',
    nome: 'Meta Base - Estoque',
    porque:
      'impacto declarado de R$ 18,16/mês: copia a base de estoque do Metabase para uma planilha, sem dizer quem usa o dado',
  },
  {
    id: '5fe2a466ee718321e221646b2223ba3d',
    nome: 'Envio de contratos para assinatura automático',
    porque: 'impacto declarado de R$ 0,88/mês, o menor da base inteira',
  },
  {
    id: '50991805dcb3147e6a4b360ed4cf18a8',
    nome: 'Alertas de Pagamento Urgente',
    porque: 'impacto declarado de R$ 0,89/mês',
  },
  {
    id: 'ed370d51237e5a04350552de092da859',
    nome: 'Cascateamento Automático',
    porque: 'impacto declarado de R$ 2,56/mês',
  },
];

const POR_ID = new Map(CANARIOS.map((c) => [c.id.toLowerCase(), c]));

/** O projeto é canário? Compara sem distinção de caixa (legado grava id em MAIÚSCULA). */
export function ehCanario(projetoId: string | null | undefined): boolean {
  return POR_ID.has(String(projetoId ?? '').trim().toLowerCase());
}

export type CanarioViolado = Canario & { veredito: string | null };

export type ResultadoCanarios = {
  /** Quantos canários entraram nesta corrida (0 = a rede não foi exercitada). */
  avaliados: number;
  /** Os que a mesa aprovaria. */
  violados: CanarioViolado[];
  /** ⚠️ `true` invalida a leitura da acurácia desta corrida. */
  suspeito: boolean;
  /** Frase para o relatório — vazia quando não há nada a dizer. */
  alerta: string | null;
};

/**
 * Confere os canários numa corrida do retroativo. PURA.
 *
 * ⚠️ Só `aprovar` viola. `em_validacao` (mandar ao humano) e `reprovar` são desfechos aceitáveis
 * num canário — o que não pode acontecer é a mesa dizer "aprova" para um projeto de R$ 0,88/mês.
 */
export function conferirCanarios(
  itens: { projeto_id: string; veredito_agregado: string | null }[],
): ResultadoCanarios {
  const avaliados = itens.filter((i) => ehCanario(i.projeto_id));
  const violados: CanarioViolado[] = [];
  for (const i of avaliados) {
    if (String(i.veredito_agregado ?? '').trim().toLowerCase() !== 'aprovar') continue;
    const c = POR_ID.get(String(i.projeto_id).trim().toLowerCase())!;
    violados.push({ ...c, veredito: i.veredito_agregado });
  }
  const suspeito = violados.length > 0;
  return {
    avaliados: avaliados.length,
    violados,
    suspeito,
    alerta: suspeito
      ? `Relatório SUSPEITO: a mesa aprovaria ${violados.length} caso-canário (${violados
          .map((v) => `${v.nome}, ${v.porque}`)
          .join('; ')}). Não leia a acurácia desta corrida como qualidade.`
      : null,
  };
}
