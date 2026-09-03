/**
 * AGLUTINAÇÃO (item 5.3) — "este projeto novo é, na verdade, uma FEATURE de um projeto que já
 * existe". Módulo PURO: seleciona os pares candidatos e aplica as travas. Quem busca vizinho é
 * o corpus vetorial; quem julga o par é o LLM; quem DECIDE é gente.
 *
 * ⚠️ **O agente NUNCA aglutina nada.** Ele PERCEBE e INDICA; a sugestão vive numa tabela
 * INTERNA e só vira vínculo (`ID Pai`/`ID Feature` na planilha) quando um humano aceita no
 * painel. A razão é a mesma de sempre neste repo: um palpite escrito na planilha é
 * indistinguível de um fato declarado para quem lê depois — e quem lê depois inclui o Gomoon.
 * O aceite/rejeite é também o único jeito de MEDIR se o agente acerta.
 *
 * ⚠️ **Quem é o PAI é decisão DETERMINÍSTICA, não do LLM: o mais ANTIGO.** Feature vem depois
 * do produto. Deixar o LLM escolher a direção abriria a porta para o projeto grande virar
 * feature do pequeno — e, pior, para a direção mudar entre duas execuções sobre os mesmos dois
 * projetos. Sem data nos dois lados, o par simplesmente não é sugerido.
 */

/** Piso de similaridade para um par ser sequer considerado. */
export const PISO_SIMILARIDADE_AGLUTINACAO = 0.55;

/**
 * Quantos candidatos por projeto vão ao LLM. Poucos de propósito: o julgamento é caro e a
 * pergunta é binária ("é feature de UM destes?"), não um ranking.
 */
export const K_CANDIDATOS = 5;

/** Confiança mínima do LLM para a sugestão ser MOSTRADA. Abaixo disso vira ruído no painel. */
export const PISO_CONFIANCA = 0.6;

export type ProjetoAglutinavel = {
  id: string;
  nome: string;
  descricao?: string | null;
  /** Epoch ms da submissão — é o que define quem é PAI. Sem ele o par não é sugerido. */
  dataMs?: number | null;
  /** Já declarado como feature de outro (coluna `ID Pai` preenchida) → fora, como FILHO. */
  jaVinculado?: boolean;
  vetor?: number[] | null;
};

export type ParCandidato = {
  filhoId: string;
  paiId: string;
  similaridade: number;
};

/**
 * Direção do par pelo relógio. Empate exato (mesma data, ou o mesmo projeto duplicado no mesmo
 * dia) → `null`: com dois candidatos a pai igualmente antigos, escolher é chutar.
 */
export function escolherDirecao(
  a: ProjetoAglutinavel,
  b: ProjetoAglutinavel,
): { paiId: string; filhoId: string } | null {
  if (a.id === b.id) return null;
  if (typeof a.dataMs !== 'number' || typeof b.dataMs !== 'number') return null;
  if (a.dataMs === b.dataMs) return null;
  return a.dataMs < b.dataMs
    ? { paiId: a.id, filhoId: b.id }
    : { paiId: b.id, filhoId: a.id };
}

export type VizinhoSimilar = { id: string; similaridade: number };

/**
 * Pares candidatos de UM projeto contra seus vizinhos semânticos.
 *
 * Travas, todas por construção:
 *  · nunca ele mesmo;
 *  · nunca abaixo do piso de similaridade;
 *  · nunca um par em que o FILHO já é feature de alguém (evita corrente e re-sugestão);
 *  · nunca um par sem direção decidível pelo relógio;
 *  · no máximo `K_CANDIDATOS`, do mais parecido para o menos.
 */
export function candidatosDe(
  projeto: ProjetoAglutinavel,
  vizinhos: VizinhoSimilar[],
  universo: Map<string, ProjetoAglutinavel>,
  opts: { piso?: number; k?: number } = {},
): ParCandidato[] {
  const piso = opts.piso ?? PISO_SIMILARIDADE_AGLUTINACAO;
  const k = opts.k ?? K_CANDIDATOS;
  const saida: ParCandidato[] = [];
  for (const v of [...vizinhos].sort((a, b) => b.similaridade - a.similaridade)) {
    if (saida.length >= k) break;
    if (v.id === projeto.id) continue;
    if (v.similaridade < piso) continue;
    const outro = universo.get(v.id);
    if (!outro) continue;
    const dir = escolherDirecao(projeto, outro);
    if (!dir) continue;
    // O FILHO já declarado como feature de alguém não é re-sugerido; o PAI pode ser
    // qualquer um (um produto pode receber várias features).
    const filho = universo.get(dir.filhoId);
    if (filho?.jaVinculado) continue;
    saida.push({ filhoId: dir.filhoId, paiId: dir.paiId, similaridade: v.similaridade });
  }
  return saida;
}

export type VereditoAglutinacao = {
  eh_feature: boolean;
  pai_id: string | null;
  confianca: number;
  porque: string;
};

export type Sugestao = {
  filhoId: string;
  paiId: string;
  similaridade: number;
  confianca: number;
  justificativa: string;
};

/**
 * Veredito do LLM + os candidatos → sugestão, ou nada. É aqui que o "não" é o default:
 * qualquer dúvida (não é feature · pai fora da lista de candidatos · confiança abaixo do
 * piso · justificativa vazia) resulta em NENHUMA sugestão.
 *
 * ⚠️ O `pai_id` é conferido contra os candidatos ENVIADOS. Sem isso, um LLM que alucina um id
 * plausível criaria vínculo para um projeto que ninguém comparou.
 */
export function aplicarVeredito(
  candidatos: ParCandidato[],
  veredito: VereditoAglutinacao | null,
  opts: { pisoConfianca?: number } = {},
): Sugestao | null {
  const piso = opts.pisoConfianca ?? PISO_CONFIANCA;
  if (!veredito || !veredito.eh_feature) return null;
  if (!veredito.pai_id) return null;
  if (!(veredito.confianca >= piso)) return null;
  const justificativa = String(veredito.porque ?? '').trim();
  if (!justificativa) return null;
  const par = candidatos.find((c) => c.paiId.toLowerCase() === veredito.pai_id!.trim().toLowerCase());
  if (!par) return null;
  return {
    filhoId: par.filhoId,
    paiId: par.paiId,
    similaridade: par.similaridade,
    confianca: veredito.confianca,
    justificativa,
  };
}

/**
 * Uma sugestão por FILHO — a de maior confiança (empate: maior similaridade). Um projeto é
 * feature de UM produto; oferecer dois pais transformaria a validação humana numa escolha
 * múltipla sem critério.
 *
 * ⚠️ Também poda CICLOS de 1 passo (A filho de B e B filho de A no mesmo lote), mantendo o par
 * mais confiante. Ciclo mais longo não é podado aqui de propósito: quem aceita é gente, e o
 * painel mostra o par — inventar uma detecção de ciclo transitivo antes de existir um caso
 * seria complexidade sem defeito conhecido.
 */
export function consolidarSugestoes(sugestoes: Sugestao[]): Sugestao[] {
  const melhorPorFilho = new Map<string, Sugestao>();
  for (const s of sugestoes) {
    const atual = melhorPorFilho.get(s.filhoId);
    if (
      !atual ||
      s.confianca > atual.confianca ||
      (s.confianca === atual.confianca && s.similaridade > atual.similaridade)
    ) {
      melhorPorFilho.set(s.filhoId, s);
    }
  }
  const saida: Sugestao[] = [];
  for (const s of melhorPorFilho.values()) {
    const inverso = melhorPorFilho.get(s.paiId);
    if (inverso && inverso.paiId === s.filhoId) {
      const vence =
        s.confianca > inverso.confianca ||
        (s.confianca === inverso.confianca && s.similaridade >= inverso.similaridade);
      if (!vence) continue;
    }
    saida.push(s);
  }
  return saida.sort((a, b) => b.confianca - a.confianca || b.similaridade - a.similaridade);
}
