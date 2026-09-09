// QUANDO o grupo do Google Chat é avisado pelo TIME DE AGENTES, e o que o card diz.
// Módulo PURO — FONTE ÚNICA do "quando" e dos textos (não redigitar em call site nenhum).
//
// ⚠️ **Substitui a D30.** Até 09/09/2026 o gatilho do alerta era a **pré-aprovação do líder**
// (`notificacao-chat.ts`): fila aberta calava e a mensagem saía quando o líder clicava em
// "Pré-aprovar". Decisão do Luis: *"ao inves de ter disparo a cada pre-aprovação de lider, faz
// sentido ter disparo a cada aprovação do agente, com sua justificativa"*. O raciocínio é sólido: a
// pré-aprovação diz que **alguém olhou**, o parecer do agente diz se o projeto **se sustenta** — e
// chega antes.
//
// ⚠️ **Consequência aceita, e ela é real:** o grupo passa a ouvir falar de projeto que nenhum humano
// validou ainda, e projeto cujo desfecho do agente não dispara (ver abaixo) **nunca** é anunciado
// ali — ele vive na fila do `/dashboard`, que é onde se age. Deixou de valer que "tudo que aparece
// no grupo já teve um humano por trás".

/** As três saídas da mesa/time que chegam aqui. */
export type DesfechoAgente = 'aprovar' | 'reprovar' | 'em_validacao';

export type SinalDoAgente = {
  veredito: DesfechoAgente | string;
  /** O time colocou o projeto na faixa de escape 6-10? (`consenso.escape`) */
  escape?: boolean | null;
};

/**
 * O grupo é avisado deste desfecho? PURA.
 *
 * ⚠️ **É binário por decisão do Luis** — *"o fluxo vai seguir so com aprovar e reprovar, é 0 ou 1,
 * 1 ou 0"* —, **com UMA exceção nomeada: a faixa 6-10**. Ele descreveu o caso: *"o agente fala
 * 6-10 e o projeto recebe flag de 6-10, mas humano vai la e bota 6 a 10 estrelas"* — o grupo precisa
 * ficar ciente de quais projetos exigem estrela humana de verdade, e essa é a única forma de
 * `em_validacao` que carrega essa informação.
 *
 * ⚠️ **O resto do `em_validacao` CALA, e isso é medido:** a confiança do agente em prod (09/09/2026)
 * é **311 baixa · 224 média · 106 alta** em 641 projetos avaliados, ou seja o desfecho "manda para
 * conferência humana" é o dominante. Se ele disparasse, o grupo viraria um fluxo de "precisa olhar"
 * e o card perderia a função de sinal — é a mesma razão pela qual o `buildUpdateMessage` (o
 * `🚨 Análise Pendente` por submissão) foi REMOVIDO deste repo.
 */
export function deveAvisarPorAgente(s: SinalDoAgente): boolean {
  if (s.veredito === 'aprovar' || s.veredito === 'reprovar') return true;
  if (s.veredito === 'em_validacao') return s.escape === true;
  // Veredito desconhecido (enum ampliado sem passar por aqui) → NÃO avisa.
  // ⚠️ Default oposto ao da D30 de propósito: lá o desconhecido notificava, porque o risco era um
  // projeto ficar invisível esperando parecer que nunca chega. Aqui o risco é o inverso — inundar o
  // grupo —, e quem não é anunciado continua visível na fila do `/dashboard`.
  return false;
}

/** O subtítulo do card: o desfecho em uma linha. FONTE ÚNICA. */
export function subtituloDoAgente(s: SinalDoAgente): string {
  if (s.veredito === 'aprovar') return '✅ Aprovado pelo time de agentes';
  if (s.veredito === 'reprovar') return '⛔ Reprovado pelo time de agentes';
  // Só chega aqui a faixa de escape (ver `deveAvisarPorAgente`).
  return '⭐ Faixa 6-10 · precisa de estrela humana';
}

/** O rótulo da linha visível do parecer. */
export function rotuloDesfechoAgente(s: SinalDoAgente): string {
  if (s.veredito === 'aprovar') return 'Aprovado';
  if (s.veredito === 'reprovar') return 'Reprovado';
  return 'Vai para estrela humana (faixa 6-10)';
}

/**
 * Quando não há parecer de líder E não há nota de isenção, o card diz ISTO.
 *
 * ⚠️ Nasceu com a troca de gatilho: a linha do parecer é a primeira coisa visível do card, e no
 * momento do parecer do agente ela está vazia quase sempre (o líder ainda não decidiu). Deixar "—"
 * ali sugere que ninguém vai opinar; a frase diz o que é: ainda não opinou.
 */
export const NOTA_LIDER_PENDENTE = 'O líder ainda não opinou.';

/** Teto do resumo do consenso no card. Card do Chat não rola bem, e isto é o "exibir mais". */
export const RESUMO_CONSENSO_MAX = 700;
/** Quantas frases do consenso entram. Acima disso o card deixa de ser card. */
export const RESUMO_CONSENSO_LINHAS = 4;

/**
 * O consenso do time, compactado para o card. PURA.
 *
 * ⚠️ **Não reescreve o raciocínio** — recorta. O texto vem do próprio consenso do time (é o que ele
 * produz ao fechar), e reescrevê-lo aqui criaria uma segunda voz dizendo por que o projeto foi
 * aprovado, que é exatamente o que o card não pode ter.
 * ⚠️ **Sem traço nenhum** (pedido do Luis, e regra do repo): `—`, `–` e o hífen usado como conector
 * viram vírgula ou ponto. Traço em card de Chat lido no celular vira ruído visual.
 * ⚠️ Linha vazia e repetida saem: o `motivos` do consenso vem como uma frase por especialista, e
 * dois especialistas concordando repetem a mesma dúvida.
 */
export function resumirConsenso(bruto: string | string[] | null | undefined): string {
  const cru = Array.isArray(bruto) ? bruto.join('\n') : String(bruto ?? '');
  const linhas: string[] = [];
  for (const l of cru.split(/\r?\n/)) {
    const limpo = l
      .trim()
      // Traço como CONECTOR (cercado de espaço) vira vírgula; o hífen de palavra composta fica.
      .replace(/\s+[—–-]\s+/g, ', ')
      .replace(/^[—–-]\s*/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!limpo) continue;
    if (linhas.includes(limpo)) continue;
    linhas.push(limpo);
    if (linhas.length >= RESUMO_CONSENSO_LINHAS) break;
  }
  const texto = linhas.join('\n');
  return texto.length > RESUMO_CONSENSO_MAX
    ? `${texto.slice(0, RESUMO_CONSENSO_MAX - 1)}…`
    : texto;
}

/**
 * A reserva do aviso deu direito de avisar? PURA.
 *
 * `linhas > 0` → ganhou a corrida, avisa. `0` → já foi avisado, cala.
 *
 * ⚠️ **`null` (o adaptador não reportou linhas) → AVISA**, o mesmo default invertido do
 * `deveNotificarDecisao`. Os dois erros não são simétricos: tratar o desconhecido como "já avisado"
 * deixaria o grupo **em silêncio para sempre** e ninguém descobriria (a feature inteira ficaria
 * inerte com cara de funcionando), enquanto avisar no desconhecido custa, no pior caso, um card
 * repetido numa rerodada.
 * ⚠️ E o desconhecido **não passa calado**: quem chama reporta a falha `idempotencia_indeterminada`
 * (ver `agentes-falhas.ts`), porque um adaptador silencioso aqui é justamente o que transformaria um
 * backfill de 641 projetos em 641 cards.
 */
export function deveAvisarDoAgente(linhasReservadas: number | null | undefined): boolean {
  if (linhasReservadas == null) return true;
  return linhasReservadas > 0;
}
