/**
 * SIMILARIDADE LÉXICA para a aglutinação — módulo PURO, sem rede e sem chave.
 *
 * ⚠️ Por que NÃO embedding aqui (03/09/2026). Embedding aproxima por TEMA, e tema é
 * justamente o falso positivo que o juiz da aglutinação existe para recusar: dois
 * dashboards de margem, um da Gocase e um da Gobeaute, são vizinhos semânticos quase
 * perfeitos e NÃO têm relação de pai e filho. O sinal de "feature de" é outro — é o NOME DO
 * PRODUTO reaparecendo: «GoStream — Checklist Proposta» ⊂ «GoStream», «AVD Central v2» ⊂
 * «AVD Central». Isso é casamento léxico com peso por RARIDADE, e ele tem três vantagens
 * sobre o vetor neste problema: custa zero, não depende de chave de terceiro (a
 * `LLM_FALLBACK` estava revogada), e é EXPLICÁVEL — o painel mostra qual palavra casou.
 *
 * O caminho vetorial continua disponível para uma 2ª passada (pegaria a feature que foi
 * RENOMEADA e não carrega mais o nome do produto). Não é o primeiro corte.
 *
 * A régua: TF-IDF sobre o corpus dos próprios projetos. Token que aparece em quase todo
 * projeto ("relatório", "automação", "gocase") pesa ~0; token que aparece em 2 ou 3 pesa
 * quase tudo. É o mesmo princípio do `≥8 chars` da sobreposição receita×custo evitado —
 * lá o proxy de raridade era o tamanho da palavra, aqui é a frequência medida.
 */

/** Palavras que NUNCA discriminam projeto neste corpus — pesariam como ruído. */
export const RUIDO = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'um', 'uma', 'que', 'ao', 'aos', 'the', 'of',
  'projeto', 'projetos', 'automacao', 'automatizacao', 'automatico', 'automatizado',
  'sistema', 'processo', 'ferramenta', 'app', 'aplicativo', 'plataforma',
  'relatorio', 'relatorios', 'dashboard', 'painel', 'controle', 'gestao', 'analise',
  'novo', 'nova', 'geral', 'diario', 'diaria', 'mensal', 'time', 'equipe',
]);

export function normalizar(texto: string): string {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Tokens úteis: ≥3 chars, sem ruído, sem número solto. */
export function tokenizar(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !RUIDO.has(t) && !/^\d+$/.test(t));
}

/** IDF sobre o corpus: `ln(N / df)`. Token em todo projeto → ~0; em 2 → alto. */
export function calcularIdf(documentos: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of documentos) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(1, documentos.length);
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(n / d));
  return idf;
}

export type TextoProjeto = {
  nome: string;
  descricao?: string | null;
  /** O que a documentação diz que o projeto faz. É o sinal mais rico — e o menos enganoso. */
  documentacao?: string | null;
};

/** Teto de caracteres da documentação que entra no vocabulário do par. */
export const TETO_DOC = 4000;

/**
 * Tokens de um projeto com PESO, sobre as TRÊS fontes: nome, descrição e documentação.
 *
 * ⚠️ **O nome NÃO decide sozinho** (decisão do Luis, 03/09/2026: *"não faça a aglutinação por
 * nome, considere documentação, nome, descrição e análise LLM"*). Ele pesa 3× porque é onde a
 * família costuma aparecer, mas a documentação é o corpo do sinal — e é ela que pega a feature
 * que foi REBATIZADA e não carrega mais o nome do produto, que é o caso que um casamento de
 * nome nunca veria.
 */
export function tokensPesados(p: TextoProjeto): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokenizar(p.nome)) m.set(t, (m.get(t) ?? 0) + 3);
  for (const t of tokenizar(p.descricao ?? '')) m.set(t, (m.get(t) ?? 0) + 1);
  for (const t of tokenizar((p.documentacao ?? '').slice(0, TETO_DOC))) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Cosseno TF-IDF entre dois projetos. 0 = nada em comum; 1 = mesmo texto. */
export function similaridade(
  a: Map<string, number>,
  b: Map<string, number>,
  idf: Map<string, number>,
): number {
  let produto = 0;
  let na = 0;
  let nb = 0;
  for (const [t, w] of a) {
    const v = w * (idf.get(t) ?? 0);
    na += v * v;
    const wb = b.get(t);
    if (wb) produto += v * wb * (idf.get(t) ?? 0);
  }
  for (const [t, w] of b) {
    const v = w * (idf.get(t) ?? 0);
    nb += v * v;
  }
  if (na === 0 || nb === 0) return 0;
  return produto / Math.sqrt(na * nb);
}

/**
 * Os tokens raros que os DOIS têm — é o que o painel mostra como "por que casou".
 * Ordenado do mais raro para o mais comum, no máximo 4.
 */
export function tokensEmComum(
  a: Map<string, number>,
  b: Map<string, number>,
  idf: Map<string, number>,
  max = 4,
): string[] {
  return [...a.keys()]
    .filter((t) => b.has(t))
    .sort((x, y) => (idf.get(y) ?? 0) - (idf.get(x) ?? 0))
    .slice(0, max);
}

/**
 * O ÚNICO sinal estrutural que sobreviveu à medição: o nome de um projeto CONTÉM o outro
 * («GoStream» dentro de «GoStream - Checklist Proposta»). É a assinatura de família, e é
 * preciso — 25 pares em 156.520 na base da staging.
 *
 * ⚠️ **Um "marcador de versão" (v2 · fase 2 · 2.0) NÃO entrou, e a medição é o motivo**
 * (03/09/2026). A ideia era: nome com «v2» + token raro em comum = evolução do outro. Medido
 * em 156.520 pares, ele disparava **935 vezes** contra 25 do nome contido, e apertar a
 * raridade não salvava — em `idf ≥ 5` (token em ≤3 projetos) ainda restavam 51 pares, quase
 * todos lixo do tipo «Live Machine» ⟷ «Slow Moving Gocase v2». A razão é simples: o marcador
 * diz que AQUELE projeto é uma versão de ALGO, não que seja versão DESTE. Quem carrega a
 * relação é o token raro compartilhado — e isso o TF-IDF já mede sozinho. Não reintroduzir.
 *
 * ⚠️ **O nome curto precisa ser DISTINTIVO, não só comprido** (medido 03/09/2026). A 1ª
 * versão pedia só `≥6 caracteres` — e a base tem um projeto chamado literalmente
 * **«Controle»**, que se encaixa dentro de «Controle de Estoque», «Torre de Controle
 * Gobeaute», «CONTROLE PEDIDOS B2B» e mais 7. Dez falsos positivos de um nome só. Agora o
 * nome curto tem de conter ao menos um token RARO (`idf ≥ IDF_NOME_DISTINTIVO`): «gostream»
 * e «treble» passam, «controle» não. É a mesma régua de raridade do resto do módulo — o
 * mesmo princípio do `≥8 chars` da sobreposição receita×custo evitado, com a raridade
 * MEDIDA em vez de aproximada pelo tamanho.
 */
export const IDF_NOME_DISTINTIVO = 4;

export function nomeContido(
  a: TextoProjeto,
  b: TextoProjeto,
  idf: Map<string, number>,
): boolean {
  const limpo = (n: string) => normalizar(n).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const na = limpo(a.nome);
  const nb = limpo(b.nome);
  const curto = na.length <= nb.length ? na : nb;
  const longo = na.length <= nb.length ? nb : na;
  if (curto.length < 6 || curto === longo || !longo.includes(curto)) return false;
  return tokenizar(curto).some((t) => (idf.get(t) ?? 0) >= IDF_NOME_DISTINTIVO);
}

/**
 * ⚠️ Nome contido é um **BÔNUS**, não um piso (decisão do Luis, 03/09/2026). Na 1ª versão ele
 * levava o par direto a 0,75, ou seja: dois projetos cujos textos não têm NADA em comum viravam
 * candidatos só porque um nome cabia dentro do outro. Isso é aglutinar por nome. Agora ele
 * SOMA a uma similaridade que já existe — reforça o par que o conteúdo já sugeriu, e não
 * consegue criar par sozinho (um par de similaridade 0 continua em 0,15, abaixo do piso).
 */
export const BONUS_NOME_CONTIDO = 0.15;

/** Similaridade final do par: conteúdo + o bônus, teto em 1. */
export function similaridadeFinal(base: number, contido: boolean): number {
  return Math.min(1, base + (contido ? BONUS_NOME_CONTIDO : 0));
}
