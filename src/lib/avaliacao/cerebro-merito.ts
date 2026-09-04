// Cérebro A — o MÉRITO (T14). Módulo PURO: prompts por dimensão, normalização e consolidação.
//
// D18: nos projetos PADRÃO o que se julga é mérito e valor por PLAUSIBILIDADE com ferramenta, não
// gate. O agente PERGUNTA ("500 h para uma pessoa: como?") em vez de reprovar calado — a saída
// `ajuste` carrega perguntas CONCRETAS ao autor, sanitizadas (nunca o R$ por hora, que é escondido
// do usuário por decisão de produto). Quórum 2 herdado do agregador da mesa: uma preocupação
// isolada só pede ajuste quando é dado duro (horas impossíveis ou valor absurdo).
import { TETO_HORAS_PESSOA, LIMITE_ECONOMIA_ALTA_HORAS } from '@/lib/avaliacao/ferramentas';
import { ocultarValoresMonetarios } from '@/lib/avaliacao/textos';

export type Mensagem = { role: 'system' | 'user' | 'assistant'; content: string };
export type DimensaoMerito = 'plausibilidade_horas' | 'financeiro' | 'precedente' | 'evidencia';
export const DIMENSOES_MERITO: readonly DimensaoMerito[] = ['plausibilidade_horas', 'financeiro', 'precedente', 'evidencia'];

export type AuditoriaValor = { absurdo: boolean; valor_sugerido: number | null; justificativa: string };
export type JulgamentoMerito = {
  dimensao: DimensaoMerito;
  preocupa: boolean;
  argumento: string;
  evidencias: string[];
  pergunta_ao_autor: string | null;
  valor: AuditoriaValor | null;
  fallback: boolean;
};
export type VizinhoTexto = { id: string; nome: string; status: string | null; similaridade: number; resumo: string };

export const ARGUMENTO_MAX = 600;
export const QUORUM_AJUSTE = 2;

const PERSONA: Record<DimensaoMerito, string> = {
  plausibilidade_horas: `Você é o especialista em PLAUSIBILIDADE DE HORAS (dimensão "plausibilidade_horas") da mesa de avaliação do GoDocs. Você julga se as horas declaradas são críveis para as pessoas e cargos descritos: o teto CLT é ${TETO_HORAS_PESSOA} h por pessoa por mês; uma linha acima disso soma várias pessoas/unidades ou está errada. Economia de ${LIMITE_ECONOMIA_ALTA_HORAS} h/mês ou mais exige que o memorial diga o destino das horas liberadas. Você não reprova: quando algo não fecha, formula a PERGUNTA concreta que o autor precisa responder.`,
  financeiro: `Você é o especialista FINANCEIRO (dimensão "financeiro") da mesa de avaliação do GoDocs. Você audita o VALOR: o ganho declarado é coerente com as horas, os cargos, o custo evitado, a receita e os custos do projeto? Quando o valor é absurdo (fora da curva dos cargos, dupla contagem, receita bruta contada como ganho, custo evitado que já está nas horas), diga "absurdo": true e proponha o valor_sugerido defensável.
⚠️ NÃO basta dizer "conservador" ou "parece alto": proponha o NÚMERO e mostre a conta que chega nele (o que você tirou, o que sobrou e por quê). "De X para Y porque as 271 h do contrato já estavam pagas no custo evitado" é uma auditoria; "o valor parece inflado" não é.
⚠️ A sugestão só DESCE ou CONFIRMA. Repetir o valor declarado é resposta válida e esperada: significa "auditei e o número se sustenta". Se o declarado lhe parece BAIXO demais, não sugira nada: registre no argumento e deixe valor_sugerido null — quem aumenta o ganho de um projeto é gente.
Sem certeza do número, deixe valor_sugerido null e explique o que falta para calculá-lo.`,
  precedente: `Você é o especialista em PRECEDENTE (dimensão "precedente") da mesa de avaliação do GoDocs. Você compara este projeto com os vizinhos já decididos por humanos (aprovados e reprovados): o que a triagem aceitou em casos parecidos, o que ela devolveu, e se este projeto repete um escopo já documentado (duplicata). Nunca copie o veredito do vizinho: nomeie a diferença.`,
  evidencia: `Você é o especialista em EVIDÊNCIA (dimensão "evidencia") da mesa de avaliação do GoDocs. Você confere a COERÊNCIA do que o dossiê afirma: descrição, memorial, horas e colunas contam a mesma história? O memorial nomeia o processo, quem fazia e onde o número se confere (sistema, relatório, planilha)? Anexo ou evidência externa é bônus, não requisito: a base legada raramente tem anexo, e a ausência dele sozinha não preocupa. Preocupa a contradição, o memorial vazio ou genérico, o ganho descrito como projeção.`,
};

const REGUA_DE_PREOCUPACAO = `O QUE É (E O QUE NÃO É) MOTIVO DE PREOCUPAÇÃO:
- A base legada foi documentada só pela planilha: quase nenhum projeto tem anexo, documentação compilada ou texto de evidência no dossiê. AUSÊNCIA de anexo ou de evidência externa NÃO é motivo de preocupação por si — a triagem humana aprovou centenas de projetos com esse mesmo material.
- Preocupe-se quando há SINAL CONCRETO no dossiê: número implausível (horas acima do teto por pessoa, valor fora da curva do cargo), contradição interna (memorial diz uma coisa, colunas dizem outra), dupla contagem (custo evitado que já está nas horas, receita bruta contada como ganho), duplicata de escopo já documentado, ganho projetado em vez de medido, ou memorial que não descreve o processo.
- Na dúvida sem sinal concreto, NÃO preocupe: registre a ressalva no argumento e deixe preocupa=false. O time só pede ajuste ao autor quando tem uma pergunta que ele consegue responder e que muda a decisão.
- A seção "Fontes ausentes" do dossiê diz o que o SISTEMA não guardou (documentação, texto dos anexos, versões). Ausência listada ali é do sistema, não do autor: não vira preocupação nem pergunta.
- Projeto ESPECIAL (Especial: sim) não tem memorial financeiro por definição: saving 0, receita 0 e 0 h NÃO são sinal de nada. Audite valor só quando há valor declarado.
- Uma pergunta ao autor é UMA pergunta (uma interrogação, até 220 caracteres), sobre o ponto que mais muda a decisão.`;

const FORMATO = `${REGUA_DE_PREOCUPACAO}

FORMATO DE RESPOSTA — responda APENAS com um objeto JSON:
{
  "preocupa": <bool — há SINAL CONCRETO que impede aprovar como está?>,
  "argumento": "<até 600 caracteres, o seu raciocínio; pode citar R$; ressalvas sem sinal concreto vão aqui, não em preocupa>",
  "evidencias": ["<citação literal do dossiê>", "..."],
  "pergunta_ao_autor": "<UMA pergunta concreta e respondível pelo autor quando preocupa, senão null. PROIBIDO citar R$ por hora ou o valor/hora de qualquer cargo — o autor não vê esse número>",
  "valor": <só a dimensão financeiro: { "absurdo": bool, "valor_sugerido": number|null, "justificativa": "..." }; as outras dimensões devolvem null>
}
Regra do repo: o autor NUNCA vê o valor/hora (R$/hora) dos cargos. A pergunta ao autor fala de horas, pessoas, evidências e periodicidade, nunca de R$ por hora.`;

export function buildPromptMerito(args: {
  dimensao: DimensaoMerito;
  dossieTexto: string;
  vizinhos: VizinhoTexto[];
  ferramentasTexto?: string | null;
  outrosJulgamentos?: JulgamentoMerito[];
  /** Motivo do cético na rodada anterior (entra na réplica como a voz que refutou). */
  replicaDoCetico?: string | null;
}): Mensagem[] {
  const system = [PERSONA[args.dimensao], ...(args.ferramentasTexto ? ['', args.ferramentasTexto] : []), '', FORMATO].join('\n');
  const vizinhosTxt = args.vizinhos.length
    ? args.vizinhos
        .map((v) => `- ${v.nome} (status ${v.status ?? '—'}, similaridade ${v.similaridade.toFixed(2)}): ${v.resumo}`)
        .join('\n')
    : 'Nenhum vizinho decidido por humanos foi encontrado (sem vizinhos).';
  const temReplica = (args.outrosJulgamentos?.length ?? 0) > 0 || !!args.replicaDoCetico;
  const outros = temReplica
    ? [
        '',
        'RÉPLICA (debate): os outros especialistas já opinaram. Responda ao que discorda, com evidência; mude de ideia se o argumento for melhor que o seu.',
        ...(args.outrosJulgamentos ?? []).map(
          (j) => `- ${j.dimensao} (${j.preocupa ? 'PREOCUPA' : 'sem preocupação'}): ${j.argumento}`,
        ),
        ...(args.replicaDoCetico ? [`- cético (REFUTA a aprovação): ${args.replicaDoCetico}`] : []),
      ]
    : [];
  const user = [
    'VIZINHOS JÁ DECIDIDOS POR HUMANOS:',
    vizinhosTxt,
    '',
    'DOSSIÊ DO PROJETO:',
    args.dossieTexto,
    ...outros,
    '',
    `Julgue a dimensão "${args.dimensao}" no formato pedido.`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── sanitização do que vai ao autor ──────────────────────────────────────────

export { ocultarValoresMonetarios } from '@/lib/avaliacao/textos';

function cortar(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function bool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') return /^(true|sim|s|yes|1)$/i.test(v.trim());
  return false;
}

export function normalizarJulgamentoMerito(bruto: unknown, dimensao: DimensaoMerito): JulgamentoMerito | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const argumentoCru = typeof o.argumento === 'string' ? o.argumento.trim() : '';
  const argumento = cortar(argumentoCru || `Sem argumento do agente na dimensão ${dimensao}.`, ARGUMENTO_MAX);
  const evidencias = Array.isArray(o.evidencias)
    ? o.evidencias.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0)
    : [];
  const perguntaCrua = typeof o.pergunta_ao_autor === 'string' ? o.pergunta_ao_autor.trim() : '';
  const pergunta_ao_autor = perguntaCrua ? ocultarValoresMonetarios(perguntaCrua) : null;

  let valor: AuditoriaValor | null = null;
  if (dimensao === 'financeiro' && o.valor && typeof o.valor === 'object') {
    const v = o.valor as Record<string, unknown>;
    const sug = Number(v.valor_sugerido);
    valor = {
      absurdo: bool(v.absurdo),
      valor_sugerido: v.valor_sugerido === null || v.valor_sugerido === undefined || !Number.isFinite(sug) ? null : sug,
      justificativa: typeof v.justificativa === 'string' && v.justificativa.trim() ? v.justificativa.trim() : 'Sem justificativa do agente.',
    };
  }
  return { dimensao, preocupa: bool(o.preocupa), argumento, evidencias, pergunta_ao_autor, valor, fallback: false };
}

/**
 * ⚠️ **A sugestão do financeiro só desce.** O agente pode PROPOR um valor defensável no lugar do
 * declarado, mas nunca um MAIOR — um time que aumenta o ganho declarado da empresa por conta
 * própria é a única coisa que este pipeline não pode fazer, e a sugestão vira número na planilha
 * depois que um humano a aceita.
 *
 * ⚠️ **Sugerir o MESMO valor é resposta válida, não ruído** (decisão do Luis, 03/09): "auditei e
 * o número se sustenta" é exatamente o que se espera na maioria dos projetos, e é informação
 * diferente de "não sei dizer" (`valor_sugerido: null`). Só não pode SUBIR.
 *
 * Rejeita: sugestão sem justificativa (não dá para conferir) e valor não positivo. Rejeitar
 * significa `valor_sugerido: null` com o motivo escrito na justificativa — nunca apagar a
 * auditoria, que continua valendo como leitura.
 *
 * ⚠️ Fora do escopo de propósito: quando NÃO há valor declarado (`declarado == null`, o caso do
 * projeto especial), não há de onde descer e a sugestão é descartada. Auditar valor que não
 * existe foi o defeito que a `aplicarTravaEspecialSemNumero` já pegou pelo outro lado.
 */
export const MOTIVO_SUGESTAO_RECUSADA = {
  sobe: 'sugestão descartada: propunha valor MAIOR que o declarado, e a auditoria só desce',
  invalida: 'sugestão descartada: valor não positivo',
  sem_justificativa: 'sugestão descartada: sem justificativa que permita conferir',
  sem_declarado: 'sugestão descartada: o projeto não declara valor a auditar',
} as const;

export function conservarSugestaoDeValor(
  valor: AuditoriaValor | null,
  declarado: number | null,
): AuditoriaValor | null {
  if (!valor || valor.valor_sugerido == null) return valor;
  const sug = valor.valor_sugerido;
  const recusar = (motivo: string): AuditoriaValor => ({
    ...valor,
    valor_sugerido: null,
    justificativa: `${valor.justificativa} [${motivo}]`,
  });
  if (declarado == null) return recusar(MOTIVO_SUGESTAO_RECUSADA.sem_declarado);
  if (!(sug > 0)) return recusar(MOTIVO_SUGESTAO_RECUSADA.invalida);
  if (sug > declarado) return recusar(MOTIVO_SUGESTAO_RECUSADA.sobe);
  if (valor.justificativa.trim().length < 20) return recusar(MOTIVO_SUGESTAO_RECUSADA.sem_justificativa);
  return valor;
}

export function julgamentoFallback(dimensao: DimensaoMerito, motivo: string): JulgamentoMerito {
  return {
    dimensao,
    preocupa: false,
    argumento: `Fallback: o especialista em ${dimensao} não respondeu (${motivo}). Dimensão não avaliada nesta rodada.`,
    evidencias: [],
    pergunta_ao_autor: null,
    valor: null,
    fallback: true,
  };
}

/** Tokens comparáveis de uma pergunta: sem acento, minúsculas, só palavras com 4+ letras. */
function tokensDe(p: string): Set<string> {
  return new Set(
    p
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4),
  );
}

/** Limiar do coeficiente de sobreposição (interseção ÷ menor conjunto) acima do qual duas perguntas são a MESMA pergunta com outras palavras. Jaccard foi testado e ficava em 0,38 nas duplicatas reais da fumaça. */
export const LIMIAR_PERGUNTA_REPETIDA = 0.5;

/** Remove perguntas repetidas (exatas ou quase: sobreposição ≥ limiar), mantendo a primeira. */
export function dedupePerguntas(perguntas: string[]): string[] {
  const out: string[] = [];
  const vistos: Set<string>[] = [];
  for (const p of perguntas) {
    const t = tokensDe(p);
    const repetida = vistos.some((v) => {
      const inter = [...t].filter((x) => v.has(x)).length;
      const menor = Math.min(t.size, v.size);
      return menor > 0 && inter / menor >= LIMIAR_PERGUNTA_REPETIDA;
    });
    if (!repetida) {
      out.push(p);
      vistos.push(t);
    }
  }
  return out;
}

export type SaidaMerito = {
  veredito: 'aprovar' | 'ajuste' | 'humano';
  julgamentos: JulgamentoMerito[];
  preocupacoes: DimensaoMerito[];
  perguntas_ao_autor: string[];
  valor: AuditoriaValor | null;
  ressalvas: string[];
  sinais: { temEvidenciaCitada: boolean; temVizinhos: boolean };
};

const DADO_DURO = new Set<DimensaoMerito>(['plausibilidade_horas']);

export function consolidarMerito(julgamentos: JulgamentoMerito[], ctx: { temVizinhos: boolean }): SaidaMerito {
  const ordem = (d: DimensaoMerito) => DIMENSOES_MERITO.indexOf(d);
  const validos = julgamentos.filter((j) => !j.fallback).sort((a, b) => ordem(a.dimensao) - ordem(b.dimensao));
  const preocupantes = validos.filter((j) => j.preocupa);
  const preocupacoes = preocupantes.map((j) => j.dimensao);
  const perguntas_ao_autor = dedupePerguntas(preocupantes.map((j) => j.pergunta_ao_autor).filter((p): p is string => !!p));
  const financeiro = validos.find((j) => j.dimensao === 'financeiro');
  const valor = financeiro?.valor ?? null;
  const sinais = { temEvidenciaCitada: validos.some((j) => j.evidencias.length > 0), temVizinhos: ctx.temVizinhos };
  const ressalvas: string[] = [];

  if (validos.length === 0) {
    return {
      veredito: 'humano',
      julgamentos,
      preocupacoes,
      perguntas_ao_autor,
      valor,
      ressalvas: [
        julgamentos.length === 0
          ? 'Nenhum julgamento disponível: sem julgamento não se aprova, encaminhar ao humano.'
          : 'Nenhum julgamento válido (todos em fallback): sem julgamento não se aprova, encaminhar ao humano.',
      ],
      sinais,
    };
  }

  let veredito: SaidaMerito['veredito'];
  if (preocupantes.length === 0) {
    veredito = 'aprovar';
  } else if (preocupantes.length >= QUORUM_AJUSTE) {
    // Quórum de preocupações MOLES (evidência, precedente, financeiro sem valor absurdo) não basta
    // sozinho: medido na rodada 2 do retroativo, 13 dos 26 ajustes vinham só delas, em projetos que a
    // triagem humana aprovou. Ajuste com 2 preocupações exige pelo menos um DADO DURO; com 3 ou mais
    // preocupações o quórum vale por si.
    const temDadoDuro = preocupantes.some((j) => DADO_DURO.has(j.dimensao) || (j.dimensao === 'financeiro' && j.valor?.absurdo === true));
    if (temDadoDuro || preocupantes.length >= QUORUM_AJUSTE + 1) {
      veredito = perguntas_ao_autor.length ? 'ajuste' : 'humano';
    } else {
      veredito = 'aprovar';
      for (const j of preocupantes) ressalvas.push(`Ressalva em ${j.dimensao}: ${j.argumento}`);
    }
  } else {
    const unica = preocupantes[0];
    const dadoDuro = DADO_DURO.has(unica.dimensao) || (unica.dimensao === 'financeiro' && unica.valor?.absurdo === true);
    if (dadoDuro) {
      veredito = unica.pergunta_ao_autor ? 'ajuste' : 'humano';
    } else {
      veredito = 'aprovar';
      ressalvas.push(`Ressalva em ${unica.dimensao}: ${unica.argumento}`);
    }
  }
  return { veredito, julgamentos, preocupacoes, perguntas_ao_autor, valor, ressalvas, sinais };
}
