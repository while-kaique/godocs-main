/**
 * CÉTICO do cérebro de ESPECIAIS + máquina de CONSENSO — módulo PURO.
 *
 * O classificador propõe uma estrela; este cético tenta DERRUBAR a proposta, e a máquina
 * abaixo decide se o par convergiu ou se o cérebro precisa REPROCESSAR com a objeção em mãos.
 *
 * ⚠️ **Assimetria deliberada, e ela é a razão de o cético existir**: ele só ataca para BAIXO.
 * Não existe "o cético endossou" nem "o cético subiu a nota" — um adversarial que pode elogiar
 * vira mais um voto a favor, e a mesa perde exatamente a função de rede anti-bajulação.
 *
 * ⚠️ **Mas o alvo do ataque é o ESCAPE, não a faixa do agente.** Atacar tudo foi o erro medido
 * do painel de agentes (o revisor lendo a curva errada refutou 17 de 17): a faixa 1–5 é
 * determinística e verificável na doc, e reabri-la a cada volta só gera ruído. O que merece
 * adversário é o salto para 6–10, que é raro, caro de errar e decidido por comitê humano.
 *
 * ⚠️ **PISO ESTRUTURAL**: o cético não pode derrubar abaixo do nível que a régua 1–5 já
 * sustenta com evidência. Sem esse piso, uma objeção ao ESCAPE zerava o projeto inteiro — foi
 * o que aconteceu com o «[VERSTA] Robô orçamento» (8★ humano) fechando em 0★ com uma volta.
 */
import {
  ESCAPE_MINIMO,
  MIN_EVIDENCIA,
  GATILHOS_ESCAPE,
  rebaixarEscapeSemLastro,
  type SinaisEscape,
} from '@/lib/especiais-regua-v2';

export type ObjecaoCetico = {
  /** `true` = a proposta não se sustenta como está. */
  refuta: boolean;
  /** Para onde o cético acha que a nota deveria ir. Nunca ACIMA da proposta. */
  estrela_sugerida: number;
  /** O que exatamente não se sustenta — vai ao cérebro na volta seguinte. */
  objecao: string;
  /** Qual gatilho do escape falhou (só quando a proposta era escape). */
  gatilho_que_falhou: string | null;
};

/**
 * O cético determinístico: checa o LASTRO do escape antes de qualquer LLM.
 *
 * Boa parte das refutações não precisa de julgamento — precisa de conferência. Um escape sem
 * os dois gatilhos afirmados, ou sem evidência citada, cai por regra. Só o que passa por aqui
 * merece a chamada de LLM (que é o cético argumentativo, no `.functions`).
 */
export function ceticoDeterministico(input: {
  estrela: number;
  sinais: SinaisEscape;
  /** Nota que a faixa 1–5 sustenta sozinha, com evidência. É o PISO. */
  piso_estrutural?: number | null;
}): ObjecaoCetico {
  const piso = Math.max(0, Math.min(5, input.piso_estrutural ?? 0));
  const { estrela, ajuste } = rebaixarEscapeSemLastro(input.estrela, input.sinais);
  if (!ajuste) return { refuta: false, estrela_sugerida: input.estrela, objecao: '', gatilho_que_falhou: null };
  const falhou = ajuste.includes('gatilho 1')
    ? GATILHOS_ESCAPE[0]
    : ajuste.includes('gatilho 2')
      ? GATILHOS_ESCAPE[1]
      : `evidência citada com pelo menos ${MIN_EVIDENCIA} caracteres`;
  return {
    refuta: true,
    // ⚠️ Nunca abaixo do piso: a objeção é ao SALTO, não ao trabalho da faixa do agente.
    estrela_sugerida: Math.max(piso, estrela),
    objecao: ajuste,
    gatilho_que_falhou: falhou,
  };
}

// ─── Máquina de CONSENSO (o loop cérebro ⇄ cético) ───────────────────────────

export type EstadoConsenso = {
  volta: number;
  estrela: number;
  /** O piso que a faixa 1–5 sustenta — não muda entre voltas. */
  piso: number;
  /** Histórico das objeções, para o cérebro não repetir a mesma resposta. */
  objecoes: string[];
};

/**
 * Teto de voltas. **2**, e o número tem motivo: com 1 o cético vira carimbo (o cérebro nunca
 * responde), e a partir de 3 a conversa deixa de convergir e passa a oscilar — foi o que a
 * medição do painel mostrou. Duas voltas é o que cabe entre "ouviu a objeção" e "ficou
 * negociando".
 */
export const MAX_VOLTAS = 2;

export type DesfechoConsenso =
  | { tipo: 'aceito'; estrela: number; voltas: number; racional: string }
  | { tipo: 'reprocessar'; estado: EstadoConsenso; objecao: string }
  | { tipo: 'sem_consenso'; estrela: number; voltas: number; racional: string };

/**
 * Uma volta do consenso.
 *
 * ⚠️ **MONOTÔNICA**: a estrela só desce ou fica. Sem isso o par oscila (o cérebro sobe, o
 * cético desce, e nunca fecha) — é a mesma trava dos gates de chat deste repo, que já
 * queimaram duas vezes com loops.
 *
 * ⚠️ **Esgotadas as voltas, o desfecho é `sem_consenso` — não é "o cético venceu"**. A nota
 * fica na do cético (a menor), mas MARCADA: sem consenso significa que um humano precisa
 * olhar, e é diferente de uma nota em que os dois concordaram.
 */
export function avancarConsenso(
  estado: EstadoConsenso,
  objecao: ObjecaoCetico,
): DesfechoConsenso {
  if (!objecao.refuta) {
    return {
      tipo: 'aceito',
      estrela: estado.estrela,
      voltas: estado.volta,
      racional:
        estado.volta === 0
          ? 'o cético não achou o que refutar na primeira leitura'
          : `o cérebro respondeu à objeção e o cético não insistiu (${estado.volta} volta${estado.volta > 1 ? 's' : ''})`,
    };
  }
  const alvo = Math.max(estado.piso, Math.min(estado.estrela, objecao.estrela_sugerida));
  if (estado.volta >= MAX_VOLTAS) {
    return {
      tipo: 'sem_consenso',
      estrela: alvo,
      voltas: estado.volta,
      racional: `depois de ${MAX_VOLTAS} voltas o cético manteve a objeção: ${objecao.objecao}`,
    };
  }
  return {
    tipo: 'reprocessar',
    estado: {
      volta: estado.volta + 1,
      estrela: alvo,
      piso: estado.piso,
      objecoes: [...estado.objecoes, objecao.objecao],
    },
    objecao: objecao.objecao,
  };
}

/**
 * O bloco que vai ao cérebro na REPROCESSAGEM. Não é "tente de novo": é a objeção nomeada,
 * com o que precisa ser mostrado para o escape se sustentar.
 */
export function nudgeReprocessamento(estado: EstadoConsenso, objecao: ObjecaoCetico): string {
  return [
    `⚠️ O CÉTICO REFUTOU sua proposta (volta ${estado.volta} de ${MAX_VOLTAS}).`,
    `Objeção: ${objecao.objecao}`,
    objecao.gatilho_que_falhou ? `O que faltou: ${objecao.gatilho_que_falhou}` : '',
    '',
    'Reavalie com isto em mãos. Duas saídas honestas, e nenhuma é insistir na mesma resposta:',
    `1. A evidência EXISTE na documentação e você não a citou — cite o trecho, textual, e mantenha a nota.`,
    `2. A evidência NÃO existe — então a nota é ${Math.max(estado.piso, 5)}★, e isso não desmerece o projeto: a faixa do agente já reconhece o que ele assume.`,
  ]
    .filter(Boolean)
    .join('\n');
}
