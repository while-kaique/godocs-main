/**
 * Ajuste FINO da nota do run 1 pelas lentes — módulo PURO.
 *
 * ## Por que ajuste, e não um segundo juiz
 * Medido em 03/09/2026: com o painel decidindo sozinho, o PIAPP saiu **2, 5, 3, 7, 8 e 3** em seis
 * chamadas idênticas. As lentes variavam pouco; o resultado é que explodia, porque a nota
 * consolidada caía num degrau e um eixo oscilando 2 movia a nota final em 5 estrelas.
 *
 * Cinco chamadas de LLM não são cinco medidas do mesmo número. Consolidar por mínimo e máximo
 * (que é o desenho certo para não achatar tudo no meio) **amplifica** a variação em vez de
 * diluí-la. Um juiz instável não se calibra: a diferença entre duas rodadas deixa de dizer se a
 * régua melhorou.
 *
 * Então a nota do classificador de 1 agente é a BASE, e as lentes ajustam em cima dela. O ganho de
 * ter cinco olhares não estava em produzir outro número: está em **enxergar por eixo** e em
 * explicar melhor, que é o que a triagem lê.
 */
import { TETO_AGENTE, ehEscape, type Confianca } from '@/lib/estrelas-regua';

/**
 * O quanto as lentes podem mover a nota do run 1, para cima ou para baixo.
 *
 * ⚠️ É 1 de propósito. Acima disso não é calibragem, é substituir o juiz por outro — e foi
 * exatamente o que a medição acima reprovou. Um degrau por rodada é o que permite comparar run a
 * run e saber se a mudança veio da régua ou do ruído.
 */
export const AJUSTE_MAX_PAINEL = 1;

export type AjustePainel = {
  nota: number;
  base: number;
  delta: number;
  /** Uma linha dizendo o que moveu a nota — vai para a leitura e para o relatório da rodada. */
  motivo: string;
};

export type SinalDoPainel = {
  /** A nota que as lentes sustentam por conta própria. */
  nota_lentes: number;
  /** Item do piso nomeado por alguma lente dona dele, ou null. */
  piso: string | null;
  /** A nota de CADA lente. É o que diz se elas concordam entre si — ver a regra 3 abaixo. */
  notas_das_lentes: readonly number[];
};

/**
 * Aplica o ajuste. Três regras, nesta ordem:
 *
 * 1. **Piso nomeado zera**, e zera de qualquer altura. É a única exceção ao limite de um degrau,
 *    porque o piso não é "um pouco menos": é a afirmação de que o projeto não pontua.
 * 2. **A faixa de escape é do run 1.** Se a base entrou em 6-10 com as duas citações conferidas,
 *    as lentes não a tiram de lá: elas julgam eixo isolado e nenhuma sozinha responde à pergunta
 *    do escape. E se a base NÃO entrou, elas também não colocam.
 * 3. **As lentes SÓ SOBEM.** Para baixo existe apenas o piso, que exige citação do dossiê. Ver o
 *    bloco no corpo da função, com as duas alternativas medidas e descartadas.
 *
 * 4. **Fora disso, no máximo um degrau** na direção que as lentes apontam.
 */
export function ajustarNotaComPainel(base: number, sinal: SinalDoPainel): AjustePainel {
  if (sinal.piso) {
    return { nota: 0, base, delta: 0 - base, motivo: `zerado pelo piso (${sinal.piso})` };
  }
  if (ehEscape(base)) {
    return { nota: base, base, delta: 0, motivo: 'faixa 6-10 vem do escape, com as duas citações' };
  }
  const querido = sinal.nota_lentes;
  if (querido === base) return { nota: base, base, delta: 0, motivo: 'as lentes concordam com a base' };

  // ⚠️ **AS LENTES SÓ SOBEM. Descer é do PISO, e só dele.**
  //
  // A base lê o dossiê inteiro e diz em que CAIXA da régua o projeto está. A lente lê UM eixo, e a
  // régua é disjuntiva: a nota vem de UM eixo. Então uma lente baixa não desmente a caixa, ela só
  // informa que aquele eixo é fraco — e tirar o projeto da caixa por isso é pôr o claro no lugar
  // errado, que é o defeito que esta regra existe para matar.
  //
  // Medido: o «[VERSTA] Robô orçamento» (planilha 8) teve base 5 nas runs 7 E 8, e nas duas o time
  // o entregou como 4. Não foi ruído: o texto dizia "controla 100% do orçamento, roda 24/7, sem
  // aprovação manual", que é a definição literal do 5, debaixo de um 4. Na run 7 os 9 projetos com
  // base 5 desceram, os 9.
  //
  // ⚠️ Duas tentativas de conserto MAIS FRACAS foram medidas e descartadas, não retentar sem dado
  // novo: (a) "só desce se as lentes discordam" segurava o «Gohelp» em 5 com as lentes em 2,1,4,2,
  // onde nenhuma chega perto; (b) "só desce se nenhuma alcança a base" não salva o VERSTA na run 8
  // (lá o eixo que o sustentava caiu de 5 para 2) e ainda piora a aderência — erro 0,894 contra
  // 0,868, exato 51% contra 52%. Esta regra dá erro 0,868 e exato 53%, com 5★ indo de 8 para 19.
  //
  // ⚠️ O preço, declarado: quando a base é otimista e TODAS as lentes discordam, nada a corrige a
  // não ser o piso. Aceito de propósito — a base é o juiz que viu o projeto inteiro, e um falso 4
  // que vira 5 custa uma olhada da triagem, enquanto o inverso apaga um projeto bom da fila.
  if (querido < base) {
    return { nota: base, base, delta: 0, motivo: 'as lentes não derrubam a nota do dossiê inteiro; para baixo, só o piso' };
  }

  const direcao = querido > base ? 1 : -1;
  const delta = direcao * Math.min(AJUSTE_MAX_PAINEL, Math.abs(querido - base));
  const nota = Math.max(0, Math.min(TETO_AGENTE, base + delta));
  const verbo = delta > 0 ? 'sobe' : 'desce';
  const limitado = Math.abs(querido - base) > AJUSTE_MAX_PAINEL;
  return {
    nota,
    base,
    delta: nota - base,
    motivo: limitado
      ? `${verbo} ${Math.abs(nota - base)} (as lentes sustentavam ${querido}, e o ajuste por rodada é de um degrau)`
      : `${verbo} ${Math.abs(nota - base)} pelas lentes`,
  };
}

// ─── Confiança vinda do CONSENSO ─────────────────────────────────────────────

/**
 * Amplitude entre as lentes que já indica projeto ambíguo por natureza.
 *
 * ⚠️ Com 5 eixos numa escala de 0 a 5, uma amplitude de 3 quer dizer que um eixo viu quase o
 * topo e outro viu quase o piso do MESMO projeto. Isso é informação honesta, não erro: projeto
 * que sustenta 5 em alcance e 0 em risco é ambíguo de verdade. O que não se pode é devolver
 * essa nota com a mesma cara de uma em que os cinco olharam e concordaram.
 */
export const DISPERSAO_AMBIGUA = 3;

const ORDEM: Confianca[] = ['alta', 'media', 'baixa'];

/** Desce UM degrau. Nunca sobe: consenso não cria certeza, só a desmente. */
function rebaixar(c: Confianca): Confianca {
  return ORDEM[Math.min(ORDEM.length - 1, ORDEM.indexOf(c) + 1)];
}

/**
 * Ajusta a confiança pelo que os agentes de fato concordaram.
 *
 * Dois sinais, ambos OBSERVADOS, nenhum auto-declarado pelo modelo (medido no T1: ele se disse
 * "alta" em 456 de 484, então perguntar a confiança a ele não mede nada):
 *
 * 1. **as 5 lentes divergiram entre si** — amplitude ≥ `DISPERSAO_AMBIGUA`;
 * 2. **a base e as lentes discordaram** — o ajuste precisou mexer na nota. É o sinal mais forte
 *    que existe aqui, porque são dois julgamentos independentes sobre o mesmo dossiê.
 *
 * ⚠️ Só REBAIXA. Consenso não prova que a nota está certa (cinco agentes podem errar juntos, e
 * erram, quando o dossiê é ruim); o que ele faz é desmentir a certeza quando não existe.
 */
export function confiancaPorConsenso(
  base: Confianca,
  sinais: { notasDasLentes: number[]; deltaAjuste: number },
): Confianca {
  let c = base;
  const notas = sinais.notasDasLentes;
  if (notas.length >= 2 && Math.max(...notas) - Math.min(...notas) >= DISPERSAO_AMBIGUA) c = rebaixar(c);
  if (sinais.deltaAjuste !== 0) c = rebaixar(c);
  return c;
}
