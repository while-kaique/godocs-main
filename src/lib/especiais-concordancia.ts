/**
 * Concordância entre a nota RECOMENDADA e a nota HUMANA — módulo PURO (T1 do painel de agentes).
 *
 * ## A pergunta que este módulo responde
 * «O juiz automático acerta a nota que a triagem daria?» As notas da coluna "Estrelas" são
 * **test set pronto** (644 linhas na base, 100 delas vazias) e nunca foram usadas como tal: o
 * classificador de hoje foi calibrado por prompt e por vizinhos, e ninguém mediu o resultado
 * contra o gabarito humano. ⚠️ **Sem este número não existe "melhorou" — existe opinião**, e é
 * por isso que o T1 vem antes de qualquer avaliador novo do painel.
 *
 * ## Por que estas cinco métricas, e não uma
 * - **MAE** (erro absoluto médio): a distância típica da nota. É o primeiro corte da comparação
 *   baseline × painel.
 * - **% dentro de ±1**: numa escala de 11 pontos julgada por gente, ±1 é desacordo de gosto. Só
 *   o MAE esconde o juiz que erra pouco em quase tudo e erra MUITO em poucos casos.
 * - **Viés** (erro COM sinal): diz para que lado o juiz erra. Positivo = mais generoso que a
 *   triagem. É o sintoma nº 1 de inflação, o defeito que a própria régua diz ser do juiz e não da
 *   base — e um juiz que erra +1 em tudo tem MAE idêntico ao que erra −1 em tudo.
 * - **Matriz por FAIXA**: onde o erro mora. Confundir 0 com 1 é ruído; confundir 1 com 4 troca o
 *   tier da pessoa (a estrela é o único pagamento do especial).
 * - **Erro por nota humana** (`erro_por_nota`): o viés ABERTO por faixa do gabarito. ⚠️ É o que
 *   impede a leitura mais enganosa deste harness — ver o comentário do campo.

 * ## O test set real são ~48 especiais, não 644
 * A `CURVA_BASE` conta 644 LINHAS da aba (financeiros incluídos, 100 sem nota). Auditado **e**
 * especial é um subconjunto pequeno: a 1ª corrida achou **48** com nota humana. É pouco para
 * cravar a 2ª casa decimal, e é por isso que o T7 compara os DOIS juízes no MESMO conjunto — a
 * comparação é pareada, então o tamanho da amostra não a invalida.
 *
 * ⚠️ As faixas saem dos `TIERS` da régua (**fonte única**) + a faixa do zero, que não é tier
 * nenhum. Não redigitar bronze/prata/ouro/diamante aqui.
 *
 * ⚠️ Este módulo é só ARITMÉTICA. Não lê banco, não chama LLM e **não escreve nota** — a coluna
 * "Estrelas" é de clique humano, invariante do projeto inteiro.
 */
import {
  CURVA_BASE,
  NOTA_MAX,
  TIERS,
  TOTAL_AUDITADO,
  percentilAcimaDe,
} from '@/lib/especiais-regua';

/** Um par medido: a nota que a triagem deu × a nota que o juiz recomendou para o MESMO projeto. */
export type ParNota = {
  projeto_id: string;
  nome: string | null;
  area: string | null;
  /** A nota da coluna "Estrelas" — o gabarito. */
  humana: number;
  /** A nota do juiz sob medição (o agente único no T1, o painel no T7). */
  recomendada: number;
};

export type Faixa = { chave: string; rotulo: string; de: number; ate: number };

/**
 * As faixas da matriz. `zero` existe porque 0★ NÃO é tier (os tiers da régua começam no 1) e
 * misturar "não pontua" com bronze apagaria o corte mais frequente da base: 426 dos 544
 * projetos auditados são 0.
 */
export const FAIXAS: Faixa[] = [
  { chave: 'zero', rotulo: 'Zero', de: 0, ate: 0 },
  ...TIERS.map((t) => ({
    chave: t.chave as string,
    rotulo: t.rotulo as string,
    de: t.de as number,
    ate: t.ate as number,
  })),
];

/**
 * Os dois cortes de generosidade que a régua NOMEIA (≥3 = top 4%, ≥5 = top 1%). Comparar a
 * rodada com a base em qualquer outro ponto seria inventar régua.
 */
export const LIMIARES_GENEROSIDADE = [3, 5] as const;

/** Faixa de uma nota. Nota fora da escala cai na ponta mais próxima (não vira faixa fantasma). */
export function faixaDe(nota: number): string {
  if (!Number.isFinite(nota) || nota <= 0) return FAIXAS[0].chave;
  const achada = FAIXAS.find((f) => nota >= f.de && nota <= f.ate);
  return (achada ?? FAIXAS[FAIXAS.length - 1]).chave;
}

function arred(v: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : arred((n / total) * 100, 1);
}

export type ComparacaoLimiar = {
  limiar: number;
  /** % da RODADA em `limiar` ou acima. */
  corrida_pct: number;
  /** % da BASE real em `limiar` ou acima (a `CURVA_BASE`). */
  base_pct: number;
  /** A rodada é mais generosa que a base neste corte. */
  mais_generosa: boolean;
};

export type LinhaDistribuicao = {
  nota: number;
  corrida: number;
  corrida_pct: number;
  base_pct: number;
};

export type ErroPorNota = {
  /** A nota HUMANA (o gabarito) desta linha. */
  humana: number;
  n: number;
  mae: number;
  /** Viés dentro da faixa: positivo = o juiz inflou os projetos que a triagem deu esta nota. */
  vies: number;
};

export type MetricasConcordancia = {
  pares: number;
  /** `null` sem pares — 0 leria como "acertou tudo". */
  mae: number | null;
  /** Erro COM sinal: positivo = o juiz é mais generoso que a triagem. */
  vies: number | null;
  exatas_pct: number | null;
  dentro_de_1_pct: number | null;
  /** `matriz[faixaHumana][faixaRecomendada] = quantos`. Todas as faixas presentes, inclusive 0. */
  matriz: Record<string, Record<string, number>>;
  /**
   * O viés ABERTO por nota humana. ⚠️ **Sem isto o viés agregado mente**: na primeira corrida
   * real (48 especiais, 26/08/2026) o agregado deu −0,06 — leitura de juiz calibrado — enquanto
   * por faixa era **+1,94 nos zeros e −7 no 7★**. O juiz não estava calibrado: ele COMPRIME tudo
   * para o meio (1–3), e os dois erros se cancelam na média.
   */
  erro_por_nota: ErroPorNota[];
  distribuicao: LinhaDistribuicao[];
  generosidade: ComparacaoLimiar[];
  /** Atalho: a rodada estourou a curva em ALGUM dos cortes nomeados pela régua. */
  mais_generosa: boolean;
};

function matrizVazia(): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  for (const linha of FAIXAS) {
    m[linha.chave] = {};
    for (const col of FAIXAS) m[linha.chave][col.chave] = 0;
  }
  return m;
}

/**
 * As métricas de uma rodada. Lista vazia devolve `null` nas médias de propósito: "sem medição" e
 * "erro zero" não podem sair iguais no payload da rota.
 */
export function medirConcordancia(pares: ParNota[]): MetricasConcordancia {
  const n = pares.length;
  const matriz = matrizVazia();
  const porNota = new Map<number, number>();
  const porHumana = new Map<number, { n: number; abs: number; sinal: number }>();
  let somaAbs = 0;
  let somaSinal = 0;
  let exatas = 0;
  let dentro = 0;

  for (const p of pares) {
    const d = p.recomendada - p.humana;
    somaAbs += Math.abs(d);
    somaSinal += d;
    if (d === 0) exatas++;
    if (Math.abs(d) <= 1) dentro++;
    matriz[faixaDe(p.humana)][faixaDe(p.recomendada)]++;
    porNota.set(p.recomendada, (porNota.get(p.recomendada) ?? 0) + 1);
    const acc = porHumana.get(p.humana) ?? { n: 0, abs: 0, sinal: 0 };
    porHumana.set(p.humana, { n: acc.n + 1, abs: acc.abs + Math.abs(d), sinal: acc.sinal + d });
  }

  const erro_por_nota: ErroPorNota[] = [...porHumana.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([humana, v]) => ({
      humana,
      n: v.n,
      mae: arred(v.abs / v.n),
      vies: arred(v.sinal / v.n),
    }));

  const notas = new Set<number>([...porNota.keys()]);
  for (const k of Object.keys(CURVA_BASE)) {
    if (k !== 'vazio') notas.add(Number(k));
  }
  const distribuicao: LinhaDistribuicao[] = [...notas]
    .filter((nota) => Number.isFinite(nota) && nota >= 0 && nota <= NOTA_MAX)
    .sort((a, b) => a - b)
    .map((nota) => ({
      nota,
      corrida: porNota.get(nota) ?? 0,
      corrida_pct: pct(porNota.get(nota) ?? 0, n),
      base_pct: pct(CURVA_BASE[String(nota)] ?? 0, TOTAL_AUDITADO),
    }));

  const generosidade: ComparacaoLimiar[] = LIMIARES_GENEROSIDADE.map((limiar) => {
    const acima = pares.filter((p) => p.recomendada >= limiar).length;
    const corrida_pct = pct(acima, n);
    const base_pct = arred(percentilAcimaDe(limiar), 1);
    return { limiar, corrida_pct, base_pct, mais_generosa: n > 0 && corrida_pct > base_pct };
  });

  return {
    pares: n,
    mae: n === 0 ? null : arred(somaAbs / n),
    vies: n === 0 ? null : arred(somaSinal / n),
    exatas_pct: n === 0 ? null : pct(exatas, n),
    dentro_de_1_pct: n === 0 ? null : pct(dentro, n),
    matriz,
    erro_por_nota,
    distribuicao,
    generosidade,
    mais_generosa: generosidade.some((g) => g.mais_generosa),
  };
}

export type ComparacaoConcordancia = {
  mae_menor: boolean;
  dentro_de_1_maior: boolean;
  /** O critério de aceitação nº 1 do plano: MAE menor **E** % dentro de ±1 maior. */
  bate_baseline: boolean;
  delta_mae: number | null;
  delta_dentro_de_1: number | null;
};

/**
 * Compara duas rodadas medidas no MESMO harness — é a trava de subida do painel (T7): sem MAE
 * menor **e** % dentro de ±1 maior, o painel não vira o padrão. Rodada sem pares nunca "bate"
 * (medição ausente não é vitória).
 */
export function compararConcordancia(
  baseline: MetricasConcordancia,
  candidato: MetricasConcordancia,
): ComparacaoConcordancia {
  const temAmbos =
    baseline.mae != null &&
    candidato.mae != null &&
    baseline.dentro_de_1_pct != null &&
    candidato.dentro_de_1_pct != null;
  if (!temAmbos) {
    return {
      mae_menor: false,
      dentro_de_1_maior: false,
      bate_baseline: false,
      delta_mae: null,
      delta_dentro_de_1: null,
    };
  }
  const mae_menor = (candidato.mae as number) < (baseline.mae as number);
  const dentro_de_1_maior =
    (candidato.dentro_de_1_pct as number) > (baseline.dentro_de_1_pct as number);
  return {
    mae_menor,
    dentro_de_1_maior,
    bate_baseline: mae_menor && dentro_de_1_maior,
    delta_mae: arred((candidato.mae as number) - (baseline.mae as number)),
    delta_dentro_de_1: arred(
      (candidato.dentro_de_1_pct as number) - (baseline.dentro_de_1_pct as number),
      1,
    ),
  };
}
