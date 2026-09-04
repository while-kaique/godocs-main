/**
 * CORREÇÕES humanas — o que a triagem mudou, e **por quê** — módulo PURO.
 *
 * ## Por que existe
 * O sistema já sabia o "antes → depois" de cada nota (o `definirEstrelasEspecial` lê a estrela
 * anterior antes de escrever) e o RAG já prefere a nota HUMANA à recomendada como âncora. Então
 * corrigir o PIAPP de 5 para 8 já fazia o próximo projeto parecido receber "PIAPP = 8" como
 * vizinho.
 *
 * O que faltava era o PORQUÊ, e a diferença entre ter e não ter é a diferença entre duas coisas
 * muito distintas:
 *
 * - **sem o motivo**, o agente aprende "concorde com o humano". Ele decora que projeto parecido
 *   com o PIAPP vale 8. Isso é gabarito, não critério, e é o viés que o dono do produto vetou
 *   explicitamente;
 * - **com o motivo**, ele aprende "subi porque OUTROS PROJETOS RODAM EM CIMA DELE, e você tinha
 *   lido isso como alcance em vez de plataforma". Isso generaliza para um projeto que não se
 *   parece nada com o PIAPP e tem a mesma propriedade.
 *
 * ⚠️ **A correção entra como EXEMPLO COMPARÁVEL, nunca como alvo.** Nada aqui ajusta nota
 * automaticamente. O agente vê o que a gente mudou e por quê, do mesmo jeito que vê um vizinho.
 *
 * ## Por que serve para o financeiro também
 * A forma é a mesma: um número, o número novo, e a razão. Muda só de onde a correção vem — a
 * estrela é um clique no app, o valor é corrigido na planilha pela triagem. Por isso `tipo` é
 * campo, e não dois módulos.
 */

export type TipoCorrecao = 'estrela' | 'valor';

export type Correcao = {
  tipo: TipoCorrecao;
  projeto_id: string;
  projeto_nome: string | null;
  /** O que estava lá antes da mão humana. `null` quando não havia nada. */
  de: number | null;
  /** O que a pessoa cravou. */
  para: number;
  /** O que o AGENTE tinha recomendado, quando havia recomendação. */
  recomendado: number | null;
  /** A razão escrita por quem corrigiu. É o que transforma gabarito em critério. */
  motivo: string | null;
  quando: string | null;
};

/** Teto do motivo. Duas frases: é uma anotação de triagem, não um parecer. */
export const MOTIVO_MAX = 400;

/**
 * A correção vale como lição quando MUDA alguma coisa e diz por quê.
 *
 * ⚠️ Correção sem motivo NÃO vira exemplar de primeira classe: ela continua valendo como âncora
 * de magnitude (o RAG já faz isso), mas não entra no prompt como lição. Sem a razão, tudo que
 * ela ensina é "a nota é essa porque sim", que é exatamente o decorar-gabarito.
 */
export function ensinaAlgo(c: Correcao): boolean {
  if (!c.motivo || c.motivo.trim().length < 10) return false;
  const referencia = c.recomendado ?? c.de;
  return referencia != null && referencia !== c.para;
}

/** Uma linha por correção, para o bloco de exemplos do prompt. */
export function descreverCorrecao(c: Correcao): string {
  const dir = c.recomendado != null && c.para > c.recomendado ? 'SUBIU' : 'BAIXOU';
  const origem = c.recomendado != null ? `o agente recomendou ${c.recomendado}` : `estava ${c.de}`;
  const unidade = c.tipo === 'estrela' ? '★' : '';
  return `• «${c.projeto_nome ?? c.projeto_id}»: ${origem}, a triagem ${dir} para ${c.para}${unidade} — motivo: ${c.motivo}`;
}

/**
 * O bloco de lições para o prompt.
 *
 * ⚠️ O texto diz ao agente o que fazer com isso, e o que NÃO fazer: são correções de OUTROS
 * projetos, e servem para reconhecer o critério que ele deixou passar, não para copiar a nota.
 */
export function blocoCorrecoes(correcoes: Correcao[], teto = 6): string {
  const uteis = correcoes.filter(ensinaAlgo).slice(0, teto);
  if (uteis.length === 0) return '';
  return [
    'CORREÇÕES QUE A TRIAGEM JÁ FEZ (o que a gente mudou na sua recomendação, e por quê):',
    ...uteis.map(descreverCorrecao),
    '⚠️ Estas são correções em OUTROS projetos. Use-as para reconhecer o CRITÉRIO que passou',
    'batido, nunca para copiar a nota: um projeto que não se parece com nenhum deles pode ter a',
    'mesma propriedade, e um que se parece pode não ter.',
  ].join('\n');
}

// ─── Leitura do que já foi corrigido ──────────────────────────────────────────

/** Linha crua de `admin_activity_log`, só o que a correção precisa. */
export type LinhaAtividade = {
  acao: string;
  projeto_id: string | null;
  projeto_nome: string | null;
  meta_json: string | null;
  created_at: string | null;
};

/**
 * Extrai as correções das linhas do log de atividade.
 *
 * ⚠️ PURO de propósito: o log é a fonte, e ela é append-only, então a correção fica registrada
 * com a data em que foi feita e ninguém a reescreve. Aqui só se traduz.
 *
 * ⚠️ Uma correção por PROJETO, a mais recente. Se a triagem mexeu três vezes no mesmo cartão, o
 * que ensina é onde ela parou, não o caminho — e repetir o mesmo projeto no bloco de exemplos
 * gastaria as poucas linhas que ele tem.
 */
export function correcoesDoLog(linhas: LinhaAtividade[]): Correcao[] {
  const porProjeto = new Map<string, Correcao>();
  for (const l of linhas) {
    if (l.acao !== 'estrelas' || !l.projeto_id) continue;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(l.meta_json ?? '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    const para = Number(meta.estrelas);
    if (!Number.isFinite(para)) continue;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const c: Correcao = {
      tipo: 'estrela',
      projeto_id: l.projeto_id,
      projeto_nome: l.projeto_nome,
      de: num(meta.estrelas_anterior),
      para,
      recomendado: num(meta.recomendado_pelo_agente),
      motivo: typeof meta.motivo === 'string' && meta.motivo.trim() ? meta.motivo.trim() : null,
      quando: l.created_at,
    };
    // O log vem do mais novo para o mais antigo: o primeiro que aparece é o que vale.
    if (!porProjeto.has(l.projeto_id)) porProjeto.set(l.projeto_id, c);
  }
  return [...porProjeto.values()];
}

/**
 * As correções que valem a pena mostrar, mais recentes primeiro.
 *
 * ⚠️ Exclui a do PRÓPRIO projeto que está sendo julgado: mostrar ao agente a nota que a triagem
 * já cravou naquele cartão não é ensinar critério, é entregar a resposta.
 */
export function licoesPara(correcoes: Correcao[], projetoId: string): Correcao[] {
  return correcoes
    .filter((c) => c.projeto_id !== projetoId && ensinaAlgo(c))
    .sort((a, b) => String(b.quando ?? '').localeCompare(String(a.quando ?? '')));
}
