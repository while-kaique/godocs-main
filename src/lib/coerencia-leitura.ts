/**
 * Verificação de COERÊNCIA entre o porquê escrito e a nota recomendada — módulo PURO.
 *
 * ## Por que existe
 * O time já tem quatro etapas de verificação (as 5 lentes, a consolidação, o revisor
 * adversarial e o consenso) e **nenhuma delas confere se o texto e o número dizem a mesma
 * coisa**. O revisor ataca a ALTURA da nota; o consenso mede divergência entre eixos. A
 * contradição entre o argumento e o veredito passa por todas elas sem ser tocada.
 *
 * Medido nas rodadas de 04/09/2026, sobre as leituras gravadas:
 *
 * | rodada | texto contradiz a nota |
 * |---|---|
 * | run 1, agente sozinho | 19 de 646 (3%) |
 * | run 3, agente + RAG | 38 de 182 (21%) |
 * | run 4, TIME | 25 de 58 (43%) |
 * | run 5, TIME | 223 de 573 (39%) |
 *
 * O time piorou a coerência em 13 vezes. E é o defeito que mais custa confiança: quem lê "nota
 * 4" e logo abaixo "fica em 5★" para de acreditar no resto, inclusive nas notas certas.
 *
 * ⚠️ **Isto é verificação em CÓDIGO de propósito.** É barato, é determinístico e roda sempre;
 * gastar uma chamada de LLM para perguntar "seu texto bate com sua nota?" seria trocar uma
 * certeza por um palpite. A régua deste repo já custou quatro lições no mesmo sentido nesta
 * mesma sessão: escape, piso, sugestão de alta do auditor e formato de resposta.
 */

/** Formas em que um texto crava uma nota: "fica em 5", "recebe 3 estrelas", "4★". */
const NUMERO_CRAVADO =
  /(?:fica em|recebe|merece|recomendo|avalio em|classifico como|nota)\s*\**\s*(\d{1,2})\s*(?:★|estrelas?)?|\b(\d{1,2})\s*★/gi;

/**
 * Afirmações de que OUTROS dependem deste projeto — a prova do "caso da plataforma".
 *
 * ⚠️ Lista DECLARADA, e não uma impressão do modelo. Medido na run 5: **60 projetos** têm essas
 * afirmações no texto e ficaram com nota 5 ou menos, ou seja, o agente escreveu a prova do
 * escape e não escapou. É o caso PIAPP, e ele é quinze vezes maior do que a varredura do corpus
 * conseguia enxergar (que achava 4).
 */
export const PISTAS_DEPENDENTE = [
  'sustenta',
  'usado por',
  'usada por',
  'consumido por',
  'consumida por',
  'dependem dele',
  'depende dele',
  'construídos em cima',
  'construído em cima',
  'construídas sobre',
  'outros projetos rodam',
  'outros projetos operam',
] as const;

export type Incoerencia =
  | { tipo: 'numero_divergente'; nota: number; noTexto: number }
  | { tipo: 'dependente_sem_escape'; pista: string; nomeado: string };

/** Números que o texto crava, sem repetir. */
function numerosCravados(leitura: string): number[] {
  const achados = new Set<number>();
  for (const m of leitura.matchAll(NUMERO_CRAVADO)) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && n >= 0 && n <= 10) achados.add(n);
  }
  return [...achados];
}

/**
 * O que está incoerente entre o texto e a nota. Lista vazia = coerente.
 *
 * ⚠️ `dependente_sem_escape` **não** é erro por si: um projeto pode sustentar outro e ainda
 * assim não entrar na faixa, e a régua até prevê isso ("poderá ser usado por" não vale). O que
 * ele marca é que a afirmação ficou SEM RESPOSTA — o texto levanta a prova do escape e não diz
 * se ela basta. Quem resolve é o passo de verificação, não este módulo.
 */
export function verificarCoerencia(
  leitura: string,
  nota: number,
  tetoAgente: number,
  nomesDaBase: readonly string[] = [],
): Incoerencia[] {
  const texto = String(leitura ?? '');
  const out: Incoerencia[] = [];
  for (const n of numerosCravados(texto)) {
    if (n !== nota) out.push({ tipo: 'numero_divergente', nota, noTexto: n });
  }
  if (nota <= tetoAgente) {
    const baixo = texto.toLowerCase();
    const pista = PISTAS_DEPENDENTE.find((p) => baixo.includes(p));
    // ⚠️ **A FRASE NÃO BASTA: o dependente tem de ser NOMEADO.**
    //
    // A régua é explícita ("não vale dependente sem nome"), e ter dependente também não é, por
    // si, critério de escape: um projeto pode sustentar outro e legitimamente ficar em 3. A
    // primeira versão marcava qualquer texto com "sustenta" ou "usado por" e acusou **75 de 188
    // projetos (40%)** na run 7. Marca que pega 40% da base não é marca, é ruído: se quase
    // metade vai ao comitê, o comitê deixa de olhar.
    //
    // Agora a pista só vale quando o texto NOMEIA outro projeto que existe na base. Isso é
    // verificável, e é a mesma prova que o "caso da plataforma" pede.
    const nomeado = pista ? acharNomeDaBase(texto, nomesDaBase) : null;
    if (pista && nomeado) out.push({ tipo: 'dependente_sem_escape', pista, nomeado });
  }
  return out;
}

/**
 * Procura, no texto, o nome de OUTRO projeto da base.
 *
 * ⚠️ Fronteira de palavra e nome distintivo, pelos dois erros que eu mesmo cometi montando o
 * grafo de dependências: sem fronteira, "RA Monitor" casa dentro de "pa**ra monitor**ar" (13
 * falsos positivos em 14); sem piso de tamanho, "Controle" casa em 64 projetos porque é palavra
 * comum, não nome.
 */
function acharNomeDaBase(texto: string, nomes: readonly string[]): string | null {
  const alvo = texto.toLowerCase();
  for (const bruto of nomes) {
    const n = String(bruto ?? '')
      .toLowerCase()
      .replace(/^\[[^\]]*\]\s*/, '')
      .trim();
    if (n.length < 5) continue;
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(alvo)) return bruto;
  }
  return null;
}

/**
 * Remove do texto as frases que cravam um número diferente da nota.
 *
 * ⚠️ Corta a FRASE inteira, não só o número: "Fica em 5★ porque roda sozinho" com o "5" apagado
 * viraria "Fica em ★ porque roda sozinho", que é pior que a contradição. O resto do argumento
 * sobrevive, e o que se perde é a sentença que discordava do veredito.
 */
export function removerNumerosDivergentes(leitura: string, nota: number): string {
  const frases = String(leitura ?? '').split(/(?<=[.!?])\s+/);
  const limpas = frases.filter((f) => !numerosCravados(f).some((n) => n !== nota));
  const texto = limpas.join(' ').replace(/\s+/g, ' ').trim();
  // Nunca devolver vazio: sem texto nenhum a triagem fica pior do que com a contradição.
  return texto || String(leitura ?? '').trim();
}
