/**
 * CATEGORIZADOR EM LOTE — classifica o eixo TIPO (item 5.4) de vários projetos por chamada.
 *
 * Por que existe, separado do `analyzer.ts`: o analisador roda numa submissão por vez, com a
 * documentação inteira em mãos. Aqui o problema é outro — 581 linhas JÁ na planilha, das quais
 * o que existe é nome + descrição + ferramenta (a `documentacao` das linhas legadas nunca
 * chegou ao SQLite da staging). Uma chamada por projeto seriam 581 idas ao proxy; em lotes de
 * ~20 são ~30, no modelo LEVE (`LLM_MODEL_FAST` + `reasoning_effort=low`), que é exatamente a
 * rota que o CLAUDE.md reserva para tarefa MECÂNICA.
 *
 * A régua (lista, precedência, definições) NÃO mora aqui — mora em `@/lib/categoria-projeto`,
 * a mesma que o analisador usa. Duas réguas dariam duas taxonomias.
 *
 * ⚠️ Structured Outputs segue MORTA no proxy (o backend ignora `response_format`), então a
 * saída é interpretada por parser tolerante + `resolverTipoProjeto` por linha: item que o LLM
 * pulou ou classificou como lixo cai no palpite determinístico, e daí para `null`. Lote que
 * volta ininteligível NÃO derruba a corrida — devolve todos os itens sem tipo, e o chamador
 * tenta de novo ou segue.
 */
import { llmChat } from '@/lib/llm';
import {
  DEFINICAO_TIPO,
  ROTULO_TIPO,
  TIPOS_PROJETO,
  resolverTipoProjeto,
  type OrigemTipo,
  type TipoProjeto,
} from '@/lib/categoria-projeto';

export type ProjetoParaCategorizar = {
  id: string;
  nome: string;
  descricao?: string | null;
  ferramenta?: string | null;
};

export type TipoAtribuido = {
  id: string;
  tipo: TipoProjeto | null;
  origem: OrigemTipo;
  justificativa: string | null;
};

/** Tamanho do lote. 20 cabe folgado no contexto e mantém ~30 chamadas para 581 linhas. */
export const TAMANHO_LOTE = 20;

/** Recorta o texto de cada projeto — descrição longa × 20 estoura o lote sem ganhar precisão. */
const TETO_DESCRICAO = 600;

export function montarPromptCategorizacao(lote: ProjetoParaCategorizar[]): string {
  const catalogo = TIPOS_PROJETO.map(
    (t, i) => `${i + 1}. "${t}" (${ROTULO_TIPO[t]}) — ${DEFINICAO_TIPO[t]}`,
  ).join('\n');
  const itens = lote
    .map((p, i) => {
      const desc = (p.descricao ?? '').trim().slice(0, TETO_DESCRICAO);
      return [
        `### ${i + 1}. id: ${p.id}`,
        `nome: ${p.nome}`,
        desc ? `descrição: ${desc}` : 'descrição: (vazia)',
        p.ferramenta ? `ferramenta: ${p.ferramenta}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return `Você classifica projetos de automação por TIPO — o que o projeto É (o artefato entregue).

Escolha EXATAMENTE um tipo por projeto, e use esta ORDEM DE PRECEDÊNCIA: o primeiro que se aplicar vence (um projeto que tem agente E painel é "agente").

${catalogo}

REGRAS:
- NÃO classifique pela FERRAMENTA. Feito com Claude não é "agente"; feito em n8n não é obrigatoriamente "automacao" (n8n servindo um formulário para gente preencher é "app"). O que decide é o artefato que a pessoa usa no fim.
- "agente" exige IA interpretando em tempo de execução. Menu de respostas fixas é "automacao".
- "dashboard" é LEITURA (consolida e mostra); "app" é onde a pessoa ENTRA E OPERA (cadastra, aprova, edita).
- Se a descrição não disser o suficiente para decidir, responda "indefinido" — NÃO chute. Indefinido é uma resposta válida e preferível a um tipo errado.

Responda SOMENTE um JSON, sem texto antes ou depois, no formato:
{"itens":[{"id":"<o id exato que recebeu>","tipo":"agente|sistema|app|dashboard|automacao|indefinido","porque":"<no máximo 12 palavras>"}]}

Um objeto por projeto, na mesma ordem, usando o id EXATO de cada um.

PROJETOS:

${itens}`;
}

/** Extrai o 1º objeto JSON de uma resposta que pode vir com cerca de texto/```json. */
export function extrairJson(texto: string): unknown | null {
  const limpo = String(texto ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const ini = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    return JSON.parse(limpo.slice(ini, fim + 1));
  } catch {
    return null;
  }
}

/**
 * Resposta do LLM + o lote enviado → um `TipoAtribuido` por projeto, SEMPRE na ordem e no
 * tamanho do lote. Item ausente na resposta não some: cai no palpite determinístico.
 *
 * ⚠️ O casamento é pelo `id`, nunca pela POSIÇÃO — o LLM reordena, funde e pula itens, e
 * casar por índice atribuiria o tipo de um projeto a outro (a falha silenciosa cara).
 */
export function interpretarResposta(
  texto: string,
  lote: ProjetoParaCategorizar[],
): TipoAtribuido[] {
  const json = extrairJson(texto) as { itens?: Array<{ id?: unknown; tipo?: unknown; porque?: unknown }> } | null;
  const porId = new Map<string, { tipo?: unknown; porque?: unknown }>();
  for (const item of json?.itens ?? []) {
    const id = String(item?.id ?? '').trim();
    if (id) porId.set(id.toLowerCase(), item);
  }
  return lote.map((p) => {
    const bruto = porId.get(p.id.toLowerCase());
    const r = resolverTipoProjeto({
      // "indefinido" não é tipo válido → `normalizarTipo` devolve null e a rede assume.
      sugestaoLLM: bruto?.tipo,
      texto: [p.nome, p.descricao].filter(Boolean).join(' \n '),
      // Legado não tem o sinal de IA em runtime; sem ele o guard de coerência não age
      // (null nunca rebaixa — a mesma disciplina do freio anti-falso-autonomia).
      ia_efetiva: null,
    });
    return {
      id: p.id,
      tipo: r.tipo,
      origem: r.origem,
      justificativa: bruto?.porque ? String(bruto.porque).slice(0, 200) : null,
    };
  });
}

/**
 * Classifica UM lote. Nunca lança: erro de proxy devolve o lote inteiro pelo caminho
 * determinístico (com `origem` dizendo de onde veio), para uma corrida de 30 chamadas não
 * morrer por causa de uma.
 */
export async function categorizarLote(lote: ProjetoParaCategorizar[]): Promise<TipoAtribuido[]> {
  if (lote.length === 0) return [];
  try {
    const resposta = await llmChat(
      [{ role: 'user', content: montarPromptCategorizacao(lote) }],
      {
        jsonMode: true,
        // Tarefa MECÂNICA → modelo leve + esforço baixo (a rota do roteamento por fase).
        model: process.env.LLM_MODEL_FAST || undefined,
        reasoningEffort: process.env.LLM_REASONING_EFFORT_FAST || 'low',
        maxTokens: 4000,
      },
    );
    return interpretarResposta(resposta, lote);
  } catch {
    return interpretarResposta('', lote);
  }
}
