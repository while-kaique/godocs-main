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
import type { SaidaEstrela, Mensagem, VizinhoTexto } from '@/lib/avaliacao/cerebro-estrela';

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

O QUE NÃO É MOTIVO: "não é auditável", "não há anexo", "falta evidência independente". A base legada foi documentada só pela planilha e a triagem humana aprovou centenas com esse material. Refutar sem sinal nomeado é ruído que trava o time.

⚠️ VOCÊ SÓ REBAIXA. "nota_sugerida" nunca pode ser MAIOR que a nota proposta. Se você acha que o projeto merece mais, não refute: diga que não refuta e registre isso em "sinais". Quem promove é gente.

FORMATO DE RESPOSTA — responda APENAS com um objeto JSON:
{ "refuta": <bool>, "nota_sugerida": <inteiro 0 a 10, nunca acima da proposta>, "motivo": "<uma frase concreta com a evidência citada do dossiê, ou null>", "sinais": ["<condição-limite detectada>", "..."] }`;

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
  return { refuta, nota_sugerida: refuta ? sugerida : notaProposta, motivo, sinais, fallback: false };
}

/** Default seguro quando o modelo não responde: não refuta, mantém a nota. */
export function ceticoEstrelaFallback(notaProposta: number): ResultadoCeticoEstrela {
  return { refuta: false, nota_sugerida: notaProposta, motivo: null, sinais: [], fallback: true };
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
  };
}
