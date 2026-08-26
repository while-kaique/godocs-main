/**
 * Re-auditoria das estrelas dos especiais — módulo PURO (a matemática do desvio).
 *
 * A pergunta que este módulo responde é: **a nota que a triagem deu a este projeto combina com as
 * notas que a triagem deu aos projetos parecidos com ele?** Quem responde é a vizinhança
 * semântica do índice vetorial: se seis irmãos de função levaram 1★ e este levou 4★, ou a nota
 * dele está inflada ou a dos irmãos está deflada — de qualquer jeito, é um caso para olho humano.
 *
 * ⚠️ **Isto NUNCA escreve nota nenhuma.** A coluna "Estrelas" é da triagem, só clique humano a
 * escreve, e é decisão fechada. Este módulo produz RELATÓRIO — o mesmo motivo pelo qual o
 * classificador não reavalia projeto que já tem nota humana: uma segunda opinião automática ao
 * lado da nota de gente é ruído, não informação, a menos que alguém peça por ela.
 *
 * ⚠️ **O rótulo dos vizinhos tem de ser HUMANO.** Comparar a nota de gente contra a mediana das
 * recomendações do próprio agente é o feedback loop puro: o agente calibra pelas notas humanas e
 * a auditoria "confirma" o agente com as saídas dele. Por isso `filtrarComparaveis` derruba
 * qualquer vizinho cujo `fonte_rotulo` não seja `'humana'` — e por isso a consulta ao Pinecone
 * usa o filtro de metadata `tem_nota_humana` (é o que justifica o índice, decisão 4).
 */
import type { Vizinho } from '@/lib/especial-corpus';

/**
 * Diferença a partir da qual a nota vira caso de revisão. 2 estrelas numa curva em que **3★ já é
 * o top 4% de 644 projetos** é distância grande: 1★ × 3★ não é desacordo de gosto, é outra faixa.
 * Abaixo disso o ruído da própria régua explica a diferença e o relatório viraria lista de tudo.
 */
export const LIMIAR_DELTA = 2;

/**
 * Mínimo de vizinhos comparáveis para a mediana significar alguma coisa. Com 1 ou 2 vizinhos a
 * "referência" é a nota de um projeto só — apontar inflação a partir disso é chute com cara de
 * número. Sem base suficiente o veredito é `sem_base`, que é uma resposta honesta.
 */
export const MIN_VIZINHOS_COMPARAVEIS = 3;

export type Veredito = 'coerente' | 'inflada' | 'deflada' | 'sem_base';

export type DesvioEstrela = {
  veredito: Veredito;
  /** Mediana ponderada das notas HUMANAS dos vizinhos. `null` quando não há base. */
  referencia: number | null;
  /** `nota humana − referência`. Positivo = acima dos pares (inflada). `null` sem base. */
  delta: number | null;
  /** Quantos vizinhos entraram na conta (só os de rótulo humano). */
  base: number;
};

/**
 * Só os vizinhos que servem de comparação: rótulo HUMANO (ver o cabeçalho do arquivo) e nota
 * numérica. Ordem preservada — quem chama já veio ordenado por similaridade.
 */
export function filtrarComparaveis(vizinhos: Vizinho[]): Vizinho[] {
  return vizinhos.filter(
    (v) => v.fonte_rotulo === 'humana' && Number.isFinite(v.estrela_efetiva),
  );
}

/**
 * Mediana PONDERADA pela similaridade: o vizinho mais parecido pesa mais que o vizinho de
 * fronteira. Mediana e não média porque uma âncora extrema (um 10★ na lista) puxaria a média e
 * transformaria toda a vizinhança dele em "deflada" — a mediana absorve o outlier.
 *
 * Devolve `null` para lista vazia ou pesos todos ≤ 0.
 */
export function medianaPonderada(pontos: { valor: number; peso: number }[]): number | null {
  const validos = pontos.filter((p) => Number.isFinite(p.valor) && p.peso > 0);
  if (validos.length === 0) return null;
  const ordenados = [...validos].sort((a, b) => a.valor - b.valor);
  const total = ordenados.reduce((s, p) => s + p.peso, 0);
  let acumulado = 0;
  for (const p of ordenados) {
    acumulado += p.peso;
    if (acumulado >= total / 2) return p.valor;
  }
  return ordenados[ordenados.length - 1].valor;
}

/**
 * Compara a nota humana de um projeto com a mediana ponderada dos vizinhos de rótulo humano.
 *
 * `sem_base` quando faltam vizinhos comparáveis — é o caso do especial pioneiro na sua função, e
 * ele não pode virar "coerente" por omissão (diria que a nota foi conferida quando não foi).
 */
export function avaliarDesvio(
  estrelaHumana: number | null,
  vizinhos: Vizinho[],
  opts: { limiar?: number; minVizinhos?: number } = {},
): DesvioEstrela {
  const limiar = opts.limiar ?? LIMIAR_DELTA;
  const min = opts.minVizinhos ?? MIN_VIZINHOS_COMPARAVEIS;
  const comparaveis = filtrarComparaveis(vizinhos);

  if (estrelaHumana == null || comparaveis.length < min) {
    return { veredito: 'sem_base', referencia: null, delta: null, base: comparaveis.length };
  }

  const referencia = medianaPonderada(
    comparaveis.map((v) => ({ valor: v.estrela_efetiva, peso: v.similaridade })),
  );
  if (referencia == null) {
    return { veredito: 'sem_base', referencia: null, delta: null, base: comparaveis.length };
  }

  const delta = Number((estrelaHumana - referencia).toFixed(2));
  const veredito: Veredito =
    delta >= limiar ? 'inflada' : delta <= -limiar ? 'deflada' : 'coerente';
  return { veredito, referencia, delta, base: comparaveis.length };
}

// ─── Relatório ────────────────────────────────────────────────────────────────

export type LinhaReauditoria = {
  projeto_id: string;
  nome: string | null;
  area: string | null;
  estrela_humana: number;
  desvio: DesvioEstrela;
  /** Os vizinhos que sustentam o veredito — é o que torna o relatório conferível à mão. */
  vizinhos: { nome: string | null; estrela: number; similaridade: number }[];
};

export type ResumoReauditoria = {
  analisados: number;
  inflada: number;
  deflada: number;
  coerente: number;
  sem_base: number;
};

/** Conta os vereditos. Separado de quem lê banco/rede para ser testável direto. */
export function resumirReauditoria(linhas: LinhaReauditoria[]): ResumoReauditoria {
  const resumo: ResumoReauditoria = {
    analisados: linhas.length,
    inflada: 0,
    deflada: 0,
    coerente: 0,
    sem_base: 0,
  };
  for (const l of linhas) resumo[l.desvio.veredito]++;
  return resumo;
}

/**
 * Ordena o relatório pelo que a triagem deve olhar primeiro: maior desvio absoluto no topo.
 * `sem_base` vai para o fim — não é achado, é ausência de comparação.
 */
export function ordenarPorGravidade(linhas: LinhaReauditoria[]): LinhaReauditoria[] {
  return [...linhas].sort((a, b) => {
    const da = a.desvio.delta == null ? -1 : Math.abs(a.desvio.delta);
    const db = b.desvio.delta == null ? -1 : Math.abs(b.desvio.delta);
    return db - da;
  });
}
