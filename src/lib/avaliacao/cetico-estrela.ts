/**
 * CÉTICO DA ESTRELA — o segundo cético da mesa (03/09/2026).
 *
 * O cético que já existia (`buildPromptCetico`, `time.ts`) ataca o MÉRITO: "esta aprovação se
 * sustenta?". Ninguém atacava a NOTA. E as duas falhas não se parecem: o mérito erra deixando
 * passar um ganho inflado; a estrela erra **na altura** — um 4★ que é 2★, um escape que é
 * entusiasmo. Um cético só, com um prompt só, não cobre as duas: pedir a ele que ataque nota E
 * mérito no mesmo turno é o caminho conhecido para ele não atacar nenhum dos dois direito.
 *
 * ⚠️ **Ele só REBAIXA.** A nota sugerida nunca sobe acima da proposta — é a mesma disciplina de
 * `normalizarClassificacao` e de `escapeValido`: um falso 8★ vira âncora congelada (D9) e
 * contamina a nota de todo mundo que vier depois. Promover é a única coisa que este time não
 * faz sozinho.
 *
 * ⚠️ **Refutar exige sinal CONCRETO do dossiê**, com a mesma régua do cético do mérito: "não é
 * auditável", "não há anexo" e "falta evidência independente" NÃO valem — a base legada foi
 * documentada só pela planilha, e a triagem humana aprovou centenas assim.
 */
import { escapeValido, ehEscape, GATILHOS_ESCAPE, normalizarNota, TETO_AGENTE } from '@/lib/estrelas-regua';
import type { ChaveGatilhoEscape } from '@/lib/estrelas-regua';
import type { SaidaEstrela, Mensagem, VizinhoTexto } from '@/lib/avaliacao/cerebro-estrela';

/**
 * Quanto a nota pode CAIR numa volta do debate da estrela (réplica do cérebro ao cético).
 *
 * ⚠️ **Medido na rodada de 11/09/2026 (96 réplicas):** 21 caíram 2 níveis ou mais — 5★→1★,
 * 4★→1★, 3★→0★ — com UMA objeção. Uma objeção derruba um degrau (o critério aplicado era alto
 * demais); ela não move um projeto de «assume» para «informa». Comparado com a nota humana nos
 * 71 casos comparáveis: erro médio 1,31 → 1,23, ±1 de 42 para 43, e os dois colapsos mais feios
 * (GoHunter 5★ humano: 4→1; Automação de Boletos 5★ humano: 5→1) somem. É a mesma disciplina de
 * `AJUSTE_MAX_PAINEL` nas lentes: cinco chamadas do modelo não são cinco medidas da mesma
 * coisa, e consolidar sem teto AMPLIFICA a variação.
 */
export const QUEDA_MAX_POR_VOLTA_ESTRELA = 1;

export type ResultadoCeticoEstrela = {
  /** `true` = a nota proposta não se sustenta como está. */
  refuta: boolean;
  /** Para onde o cético acha que a nota deveria ir. NUNCA acima da proposta. */
  nota_sugerida: number;
  /** Uma frase concreta, com a evidência citada do dossiê. */
  motivo: string | null;
  /** As condições-limite que ele detectou. */
  sinais: string[];
  /** `true` quando o modelo não respondeu e caímos no default seguro. */
  fallback: boolean;
  /**
   * Quando a nota proposta trazia ESCAPE 6–10: qual dos dois gatilhos o cético derrubou, com
   * citação. `null` = ele não atacou gatilho nenhum — e aí o escape FICA (ver
   * `reconciliarReplicaEstrela`): a entrada na faixa é régua declarada (dois gatilhos citados), e
   * o que a tira é a refutação de um gatilho, não um "alto demais" genérico.
   */
  gatilho_refutado: ChaveGatilhoEscape | null;
};

export function buildPromptCeticoEstrela(args: {
  dossieTexto: string;
  estrela: SaidaEstrela;
  vizinhos: VizinhoTexto[];
}): Mensagem[] {
  const system = `Você é o CÉTICO DA ESTRELA do time de avaliação do GoDocs. Um outro cético já ataca o mérito (aprovar ou não). O seu alvo é OUTRO: a ALTURA DA NOTA. Sua tarefa é tentar derrubar a nota proposta, não conferi-la.

O QUE VOCÊ PROCURA:
- Nota alta demais para o que o projeto de fato assume: o racional descreve um projeto que INFORMA e a nota diz que ele DECIDE; o critério aplicado não bate com o que o dossiê mostra.
- Escape (6 a 10) por entusiasmo: "revoluciona", "muda tudo", "é a base de tudo" sem que exista atividade NOVA em curso e sem que o jeito antigo tenha deixado de existir.
- Nota que ignora um vizinho quase idêntico já decidido por gente, para cima ou para baixo, sem nomear a diferença.
- Desqualificador do piso que o cérebro passou por cima (fora de uso, ressubmissão, só o autor usa).

⚠️ SE HÁ ESCAPE INDICADO: a única forma de tirá-lo é derrubar UM dos dois gatilhos, nomeando-o em "gatilho_refutado" com a citação do dossiê que o desmente. Ter existido uma versão MANUAL de parte do trabalho NÃO derruba "nao_existiria": esse gatilho pergunta pela atividade NOVA (volume, horário, alcance, produto) que só existe por causa do projeto. Sem gatilho nomeado, o escape fica de pé e a sua refutação vale só para a altura dentro de 0–5.

O QUE NÃO É MOTIVO: "não é auditável", "não há anexo", "falta evidência independente". A base legada foi documentada só pela planilha e a triagem humana aprovou centenas com esse material. Refutar sem sinal nomeado é ruído que trava o time.

⚠️ VOCÊ SÓ REBAIXA. "nota_sugerida" nunca pode ser MAIOR que a nota proposta. Se você acha que o projeto merece mais, não refute: diga que não refuta e registre isso em "sinais". Quem promove é gente.

FORMATO DE RESPOSTA — responda APENAS com um objeto JSON:
{ "sinais": ["<condição-limite detectada>", "..."], "motivo": "<uma frase concreta com a evidência citada do dossiê, ou null>", "refuta": <bool>, "nota_sugerida": <inteiro 0 a 10, nunca acima da proposta>, "gatilho_refutado": <"nao_existiria" | "sem_volta" | null — só quando há escape indicado e você derruba UM gatilho com citação> }`;

  const viz = args.vizinhos.length
    ? args.vizinhos.map((v) => `- ${v.nome} (nota ${v.nota}, similaridade ${v.similaridade.toFixed(2)}): ${v.resumo}`).join('\n')
    : '(sem vizinhos recuperados)';

  const esc = args.estrela.escape.indicado
    ? [
        '',
        `ESCAPE INDICADO: sim (válido: ${args.estrela.escape.valido ? 'sim' : 'NÃO'}).`,
        ...GATILHOS_ESCAPE.map(
          (g) => `  ${g.texto}\n    citação: ${args.estrela.escape.evidencias[g.chave] ?? '(nenhuma)'}`,
        ),
      ].join('\n')
    : '';

  const user = [
    'DOSSIÊ DO PROJETO:',
    args.dossieTexto,
    '',
    `NOTA PROPOSTA: ${args.estrela.nota}★ — critério aplicado: ${args.estrela.criterio_aplicado}`,
    `RACIONAL: ${args.estrela.racional}`,
    esc,
    '',
    'VIZINHOS JÁ DECIDIDOS:',
    viz,
    '',
    'Tente derrubar a ALTURA desta nota. Responda no formato pedido.',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Normaliza a saída crua. ⚠️ **Clampa `nota_sugerida` no teto da nota PROPOSTA** — é aqui que o
 * "só rebaixa" deixa de depender do prompt. Sem nota utilizável, cai na proposta (não refuta por
 * acidente).
 */
export function normalizarCeticoEstrela(bruto: unknown, notaProposta: number): ResultadoCeticoEstrela | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const refutaCru =
    o.refuta === true || (typeof o.refuta === 'string' && /^(true|sim|s|yes|1)$/i.test(o.refuta.trim()));
  const motivo = typeof o.motivo === 'string' && o.motivo.trim() ? o.motivo.trim() : null;
  const sinais = Array.isArray(o.sinais)
    ? o.sinais.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const crua = normalizarNota(o.nota_sugerida);
  const sugerida = crua == null ? notaProposta : Math.min(notaProposta, crua);

  // ⚠️ Refutação sem motivo NOMEADO não conta — a mesma régua do cético do mérito. E refutar
  // sem baixar a nota é contradição: não há o que o time faça com isso.
  const refuta = refutaCru && !!motivo && sugerida < notaProposta;
  const gCru = typeof o.gatilho_refutado === 'string' ? o.gatilho_refutado.trim() : '';
  const gatilho_refutado = refuta && GATILHOS_ESCAPE.some((g) => g.chave === gCru) ? (gCru as ChaveGatilhoEscape) : null;
  return { refuta, nota_sugerida: refuta ? sugerida : notaProposta, motivo, sinais, fallback: false, gatilho_refutado };
}

/**
 * RECONCILIA a réplica do cérebro da estrela com a 1ª avaliação — trava DETERMINÍSTICA, depois
 * do debate. PURA.
 *
 * Duas regras, as duas medidas na rodada de 11/09/2026:
 *  1. **Queda máxima de `QUEDA_MAX_POR_VOLTA_ESTRELA` por volta.** A réplica pode baixar a nota,
 *     mas um degrau por objeção; se o modelo desabou mais, fica `r1.nota − 1` com o racional da
 *     réplica e uma nota dizendo que o teto de queda agiu.
 *  2. **Escape válido só cai por GATILHO refutado.** Se a 1ª avaliação entrou na faixa 6–10 com
 *     os dois gatilhos citados (`escapeValido`) e o cético não nomeou o gatilho que derrubou, a
 *     réplica não tira o escape: a nota volta ao teto do agente com o escape de pé. Medido: 15
 *     escapes válidos na 1ª volta, 10 perdidos na réplica — no «Gocreators» (6★ pelo comitê) a
 *     objeção era "a gestão anterior existia em planilha", que não é nenhum dos dois gatilhos.
 *     Onde o cético NOMEIA o gatilho (o «Torre de Controle Supply», 1★ humano, caiu por
 *     "nao_existiria" com citação), a réplica vale como está.
 *
 * ⚠️ Não mexe em `avaliada`, `piso_impacto` nem na promoção: só na altura e no escape.
 */
export function reconciliarReplicaEstrela(r1: SaidaEstrela, r2: SaidaEstrela, cetico: ResultadoCeticoEstrela): SaidaEstrela {
  if (!r1.avaliada || !r2.avaliada) return r2;
  // 3. **A réplica NÃO sobe.** O cético só rebaixa; responder a uma objeção subindo a nota ou
  //    inventando um escape que a 1ª avaliação não tinha é contradição, não convencimento. Medido
  //    na 2ª passada de 11/09: «AVD Central v2» (4★ humano) foi 3★ → 5★+escape na réplica e o
  //    «CTR Machine Admaker» (4★ humano) 5★ → 5★+escape. O escape só existe se a 1ª volta o trouxe.
  const semSubida: SaidaEstrela =
    r2.nota > r1.nota || (r2.escape.valido && !r1.escape.valido)
      ? {
          ...r2,
          nota: Math.min(r2.nota, r1.nota),
          escape: r1.escape.valido ? r2.escape : { indicado: false, valido: false, evidencias: r2.escape.evidencias },
          racional: `${r2.racional} [Trava: a réplica não sobe — a 1ª avaliação deu ${r1.nota}★${r1.escape.valido ? ' com escape' : ' sem escape'} e o cético só rebaixa.]`,
        }
      : r2;
  const escapeFica = r1.escape.valido && escapeValido({ sugestao: TETO_AGENTE + 1, evidencias: r1.escape.evidencias }) && !cetico.gatilho_refutado;
  if (escapeFica) {
    return {
      ...semSubida,
      nota: Math.max(semSubida.nota, TETO_AGENTE),
      escape: r1.escape,
      racional: `${semSubida.racional} [Trava: o escape 6–10 da 1ª avaliação fica de pé — o cético não refutou nenhum dos dois gatilhos citados.]`,
    };
  }
  const piso = r1.nota - QUEDA_MAX_POR_VOLTA_ESTRELA;
  if (semSubida.nota >= piso) return semSubida;
  return {
    ...semSubida,
    nota: piso,
    racional: `${semSubida.racional} [Trava: a réplica desceu de ${r1.nota}★ para ${r2.nota}★; uma volta do debate baixa no máximo ${QUEDA_MAX_POR_VOLTA_ESTRELA} nível, então fica ${piso}★.]`,
  };
}

/**
 * Depois da 2ª volta do cético: se ele NOMEOU o gatilho derrubado (com citação) contra um escape
 * que a trava manteve de pé, o escape cai e a nota volta ao teto do agente. PURA.
 *
 * ⚠️ É o complemento da regra 2 acima — o escape só cai por gatilho nomeado, mas o cético tem
 * DUAS chances de nomeá-lo. Medido: no «Boletos Itaú via Proxy Bancária» (2★ humano) o cético da
 * 1ª volta não nomeou e o da 2ª nomeou `nao_existiria` com a citação "a automação não ampliou um
 * volume novo".
 */
export function derrubarEscapePorGatilho(estrela: SaidaEstrela, cetico: ResultadoCeticoEstrela): SaidaEstrela {
  if (!estrela.escape.valido || !cetico.refuta || !cetico.gatilho_refutado) return estrela;
  return {
    ...estrela,
    nota: Math.min(estrela.nota, TETO_AGENTE),
    escape: { indicado: false, valido: false, evidencias: estrela.escape.evidencias },
    racional: `${estrela.racional} [Trava: o cético derrubou o gatilho "${cetico.gatilho_refutado}" com citação — o escape cai e a nota fica em ${TETO_AGENTE}★.]`,
  };
}

/** Default seguro quando o modelo não responde: não refuta, mantém a nota. */
export function ceticoEstrelaFallback(notaProposta: number): ResultadoCeticoEstrela {
  return { refuta: false, nota_sugerida: notaProposta, motivo: null, sinais: [], fallback: true, gatilho_refutado: null };
}

/**
 * Trava DETERMINÍSTICA, aplicada antes de qualquer LLM: **escape indicado sem as duas citações
 * é refutado sempre**, e a nota cai para o teto do agente.
 *
 * ⚠️ Existe porque o cérebro da estrela pode indicar escape e não citar — e nesse caso não há
 * julgamento a fazer: `escapeValido` já é a fonte única da regra. Deixar isso para o LLM seria
 * pedir opinião sobre algo que a régua decide.
 */
export function travaEscapeSemCitacao(estrela: SaidaEstrela): ResultadoCeticoEstrela | null {
  if (!estrela.escape.indicado || !ehEscape(estrela.nota)) return null;
  if (escapeValido({ sugestao: estrela.nota, evidencias: estrela.escape.evidencias })) return null;
  const faltou = GATILHOS_ESCAPE.find((g) => !String(estrela.escape.evidencias[g.chave] ?? '').trim());
  return {
    refuta: true,
    nota_sugerida: TETO_AGENTE,
    motivo: `Escape indicado sem citação da documentação para "${faltou?.texto ?? 'um dos gatilhos'}".`,
    sinais: ['escape sem lastro documental'],
    fallback: false,
    gatilho_refutado: faltou?.chave ?? null,
  };
}
