/**
 * Corpus + configuração do RAG de projetos NORMAIS (time autônomo de avaliação, fatia B) — PURO.
 *
 * A memória do juiz de normais são os projetos que a triagem HUMANA já APROVOU (aprende do
 * veredito humano, nunca das próprias saídas — o mesmo princípio anti-feedback-loop da peça dos
 * especiais). Um projeto perto de muitos aprovados é sinal a favor; sem vizinhos aprovados, o
 * agregador fica em dúvida e manda para a fila humana.
 *
 * Puro de propósito: a seleção do corpus e a leitura da flag são testáveis sem tocar banco/rede.
 */
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';
import type { ExemplarEspecial } from '@/lib/especial-corpus';

/**
 * Rótulo positivo dos exemplares do corpus de normais. Todo exemplar é um projeto APROVADO pela
 * triagem, então o "rótulo" é uniforme: 1 = aprovado. É esse número que faz `selecionarVizinhos`
 * (de `especial-corpus.ts`) tratar o exemplar como rotulado; o sinal do RAG usa a SIMILARIDADE,
 * não o valor — ele só marca "este vizinho é um aprovado".
 */
export const ROTULO_APROVADO = 1;

/** Valores que LIGAM o modo sombra da avaliação de normais. Qualquer outra coisa = OFF. */
const VALORES_LIGADO = new Set(['on', 'sombra', '1', 'true', 'sim']);

/**
 * Interpreta a flag `AVALIACAO_NORMAIS`. **DEFAULT OFF** — o invariante mais importante: ausente,
 * vazia, `off`/`0`/`false`/`nao` ou qualquer valor desconhecido → `false`. Só liga com um valor
 * explícito da allowlist. Pura (a leitura LAZY do env fica no orquestrador).
 */
export function avaliacaoNormaisAtiva(raw: string | null | undefined): boolean {
  return VALORES_LIGADO.has((raw ?? '').trim().toLowerCase());
}

/**
 * Filtra o corpus de exemplares: projetos NORMAIS (não especiais) que a triagem APROVOU
 * (`statusChave === 'aprovado'`). É o veredito HUMANO que ancora o RAG.
 */
export function selecionarAprovadosNormais(
  resumos: ProjetoDashboardResumo[],
): ProjetoDashboardResumo[] {
  return resumos.filter(
    (p) => !p.especial && (p.statusChave ?? '').trim().toLowerCase() === 'aprovado',
  );
}

/**
 * Monta os exemplares (`ExemplarEspecial`) para `selecionarVizinhos`, a partir dos aprovados e do
 * mapa de embeddings. Projeto sem vetor no mapa é pulado (não há como medir vizinhança). Todo
 * exemplar leva `estrela_humana = ROTULO_APROVADO` (marcador positivo) e nada de recomendação.
 */
export function montarCorpusNormais(
  aprovados: { id: string; nome: string | null; area: string | null }[],
  embeddings: Map<string, number[]>,
): ExemplarEspecial[] {
  const corpus: ExemplarEspecial[] = [];
  for (const p of aprovados) {
    const vetor = embeddings.get(p.id);
    if (!vetor) continue;
    corpus.push({
      projeto_id: p.id,
      nome: p.nome,
      area: p.area,
      estrela_humana: ROTULO_APROVADO,
      estrela_recomendada: null,
      leitura: null,
      vetor,
    });
  }
  return corpus;
}
