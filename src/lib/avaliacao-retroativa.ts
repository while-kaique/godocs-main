/**
 * RETROATIVO do time autônomo de avaliação (fatia C) — PURO.
 *
 * A régua que mede a QUALIDADE da mesa contra o gabarito humano: dado o veredito recomendado pela
 * mesa e o Status que a triagem HUMANA já assentou (aprovado/reprovado), classifica o acerto. É o
 * que permite, em modo sombra, medir "quão bem a mesa teria batido com o humano" ANTES de confiar
 * nela para decidir sozinha — sem tocar em status nenhum.
 *
 * Baldes:
 *   • `acerto`      — a mesa e o humano concordam (aprovar↔aprovado, ou em_validacao↔reprovado: a
 *                     mesa corretamente NÃO auto-aprovaria o que o humano reprovou).
 *   • `conservador` — a mesa mandaria ao humano (em_validacao) algo que o humano aprovou: cautela,
 *                     não erro (custa uma triagem, não um número errado no ar).
 *   • `erro_grave`  — a mesa auto-aprovaria (aprovar) o que o humano REPROVOU: o caso das 500h, o
 *                     erro que a fatia inteira existe para eliminar.
 *   • `reprovacao_indevida` — a mesa REPROVARIA o que o humano aprovou: o erro ESPELHADO do
 *                     `erro_grave`, que nasceu com o desfecho `reprovar` (D4). É o pior para o
 *                     AUTOR do projeto — devolve trabalho a quem estava certo — e por isso tem
 *                     classe e taxa PRÓPRIAS: diluído em `acerto` (era onde cairia, porque o
 *                     comparador só conhecia "não aprovou") ele desapareceria do relatório.
 *   • `sem_base`    — sem veredito humano assentado, ou a mesa isentou/não recomendou.
 */

export type ResultadoComparacao =
  | 'acerto'
  | 'conservador'
  | 'erro_grave'
  | 'reprovacao_indevida'
  | 'sem_base';

/**
 * Compara a recomendação da mesa com o veredito HUMANO. PURA. `veredito` null/undefined/`isento`
 * → `sem_base` (não há recomendação binária a conferir). Só `aprovado`/`reprovado` (normalizados)
 * são veredito humano assentado; qualquer outro Status (pendente, em avaliação, vazio) → `sem_base`.
 *
 * Os SEIS cruzamentos, explícitos (⚠️ nenhum cai em fall-through — é a lição do
 * `Dispensado → Pré-reprovado`: rótulo desconhecido caindo num `else` afirma coisa falsa):
 *
 * | humano    | mesa `aprovar` | mesa `em_validacao` | mesa `reprovar`       |
 * |-----------|----------------|---------------------|-----------------------|
 * | aprovado  | acerto         | conservador         | reprovacao_indevida   |
 * | reprovado | erro_grave     | acerto              | acerto                |
 */
export function compararComHumano(
  veredito: 'aprovar' | 'em_validacao' | 'reprovar' | 'isento' | null | undefined,
  statusHumano: string | null | undefined,
): ResultadoComparacao {
  if (veredito == null || veredito === 'isento') return 'sem_base';

  const status = String(statusHumano ?? '').trim().toLowerCase();

  if (status === 'aprovado') {
    if (veredito === 'aprovar') return 'acerto';
    // ⚠️ `reprovar` aqui NÃO é "cautela": é o erro espelhado. Antes de o desfecho existir, este
    // ramo devolvia `conservador` para tudo que não fosse `aprovar` — e uma reprovação indevida
    // entraria no relatório como prudência.
    if (veredito === 'reprovar') return 'reprovacao_indevida';
    return 'conservador';
  }
  if (status === 'reprovado') {
    if (veredito === 'aprovar') return 'erro_grave';
    // `reprovar` e `em_validacao` batem com o humano: nenhum dos dois auto-aprova o reprovado.
    return 'acerto';
  }
  return 'sem_base';
}

export type Acuracia = {
  total: number;
  acerto: number;
  conservador: number;
  erro_grave: number;
  /** O time reprovaria o que o humano aprovou — o erro espelhado, com taxa própria. */
  reprovacao_indevida: number;
  sem_base: number;
  /** total − sem_base (os que têm gabarito humano para comparar). */
  comparaveis: number;
  /** acerto / comparaveis (0 quando não há comparáveis). */
  taxa_acerto: number;
  /** erro_grave / comparaveis (0 quando não há comparáveis) — a taxa que precisa ser ~0. */
  taxa_erro_grave: number;
  /** reprovacao_indevida / comparaveis — a taxa que NÃO se dilui em `acerto` (RF-247). */
  taxa_reprovacao_indevida: number;
};

/** Agrega uma lista de comparações em contagens + taxas sobre os comparáveis (sem divisão por 0). */
export function agregarAcuracia(resultados: ResultadoComparacao[]): Acuracia {
  const acc: Acuracia = {
    total: resultados.length,
    acerto: 0,
    conservador: 0,
    erro_grave: 0,
    reprovacao_indevida: 0,
    sem_base: 0,
    comparaveis: 0,
    taxa_acerto: 0,
    taxa_erro_grave: 0,
    taxa_reprovacao_indevida: 0,
  };
  for (const r of resultados) {
    if (r === 'acerto') acc.acerto++;
    else if (r === 'conservador') acc.conservador++;
    else if (r === 'erro_grave') acc.erro_grave++;
    else if (r === 'reprovacao_indevida') acc.reprovacao_indevida++;
    else acc.sem_base++;
  }
  acc.comparaveis = acc.total - acc.sem_base;
  if (acc.comparaveis > 0) {
    acc.taxa_acerto = acc.acerto / acc.comparaveis;
    acc.taxa_erro_grave = acc.erro_grave / acc.comparaveis;
    acc.taxa_reprovacao_indevida = acc.reprovacao_indevida / acc.comparaveis;
  }
  return acc;
}
