// Cérebro A — o MÉRITO (T14). Módulo PURO: prompts por dimensão, normalização e consolidação.
//
// D18: nos projetos PADRÃO o que se julga é mérito e valor por PLAUSIBILIDADE com ferramenta, não
// gate. O agente PERGUNTA ("500 h para uma pessoa: como?") em vez de reprovar calado — a saída
// `ajuste` carrega perguntas CONCRETAS ao autor, sanitizadas (nunca o R$ por hora, que é escondido
// do usuário por decisão de produto). Quórum 2 herdado do agregador da mesa: uma preocupação
// isolada só pede ajuste quando é dado duro (horas impossíveis ou valor absurdo).
import { TETO_HORAS_PESSOA, LIMITE_ECONOMIA_ALTA_HORAS } from '@/lib/avaliacao/ferramentas';

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
  financeiro: `Você é o especialista FINANCEIRO (dimensão "financeiro") da mesa de avaliação do GoDocs. Você audita o VALOR: o ganho declarado é coerente com as horas, os cargos, o custo evitado, a receita e os custos do projeto? Quando o valor é absurdo (fora da curva dos cargos, dupla contagem, receita bruta contada como ganho, custo evitado que já está nas horas), diga "absurdo": true e proponha o valor_sugerido defensável com a justificativa. Sem certeza, deixe valor_sugerido null e explique.`,
  precedente: `Você é o especialista em PRECEDENTE (dimensão "precedente") da mesa de avaliação do GoDocs. Você compara este projeto com os vizinhos já decididos por humanos (aprovados e reprovados): o que a triagem aceitou em casos parecidos, o que ela devolveu, e se este projeto repete um escopo já documentado (duplicata). Nunca copie o veredito do vizinho: nomeie a diferença.`,
  evidencia: `Você é o especialista em EVIDÊNCIA (dimensão "evidencia") da mesa de avaliação do GoDocs. Você confere se o que o memorial afirma tem base verificável: anexo citado, evidência de medição, sistema/relatório onde o número se confere, coerência entre descrição, documentação e números. Afirmação sem evidência não é falsa, mas é pergunta.`,
};

const FORMATO = `FORMATO DE RESPOSTA — responda APENAS com um objeto JSON:
{
  "preocupa": <bool — há algo que impede aprovar como está?>,
  "argumento": "<até 600 caracteres, o seu raciocínio; pode citar R$>",
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
}): Mensagem[] {
  const system = [PERSONA[args.dimensao], ...(args.ferramentasTexto ? ['', args.ferramentasTexto] : []), '', FORMATO].join('\n');
  const vizinhosTxt = args.vizinhos.length
    ? args.vizinhos
        .map((v) => `- ${v.nome} (status ${v.status ?? '—'}, similaridade ${v.similaridade.toFixed(2)}): ${v.resumo}`)
        .join('\n')
    : 'Nenhum vizinho decidido por humanos foi encontrado (sem vizinhos).';
  const outros = args.outrosJulgamentos?.length
    ? [
        '',
        'RÉPLICA (debate): os outros especialistas já opinaram. Responda ao que discorda, com evidência; mude de ideia se o argumento for melhor que o seu.',
        ...args.outrosJulgamentos.map(
          (j) => `- ${j.dimensao} (${j.preocupa ? 'PREOCUPA' : 'sem preocupação'}): ${j.argumento}`,
        ),
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

/** Troca valores monetários e R$/hora por "[valor]". O autor nunca vê o valor/hora dos cargos. */
export function ocultarValoresMonetarios(texto: string): string {
  return texto
    .replace(/R\$\s?[\d.]+(?:,\d+)?(?:\s*\/\s*hora)?/gi, '[valor]')
    .replace(/\b\d{1,3}(?:\.\d{3})*,\d{2}\s*\/\s*hora\b/gi, '[valor]')
    .replace(/R\$/g, '[valor]');
}

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
  const perguntas_ao_autor = [...new Set(preocupantes.map((j) => j.pergunta_ao_autor).filter((p): p is string => !!p))];
  const financeiro = validos.find((j) => j.dimensao === 'financeiro');
  const valor = financeiro?.valor ?? null;
  const sinais = { temEvidenciaCitada: validos.some((j) => j.evidencias.length > 0), temVizinhos: ctx.temVizinhos };
  const ressalvas: string[] = [];

  if (julgamentos.length === 0) {
    return {
      veredito: 'humano',
      julgamentos,
      preocupacoes,
      perguntas_ao_autor,
      valor,
      ressalvas: ['Nenhum julgamento disponível: sem julgamento não se aprova, encaminhar ao humano.'],
      sinais,
    };
  }

  let veredito: SaidaMerito['veredito'];
  if (preocupantes.length === 0) {
    veredito = 'aprovar';
  } else if (preocupantes.length >= QUORUM_AJUSTE) {
    veredito = perguntas_ao_autor.length ? 'ajuste' : 'humano';
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
