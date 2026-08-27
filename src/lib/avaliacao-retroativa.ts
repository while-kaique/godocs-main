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
 *   • `sem_base`    — sem veredito humano assentado, ou a mesa isentou/não recomendou.
 */

export type ResultadoComparacao = 'acerto' | 'conservador' | 'erro_grave' | 'sem_base';

/**
 * Compara a recomendação da mesa com o veredito HUMANO. PURA. `veredito` null/undefined/`isento`
 * → `sem_base` (não há recomendação binária a conferir). Só `aprovado`/`reprovado` (normalizados)
 * são veredito humano assentado; qualquer outro Status (pendente, em avaliação, vazio) → `sem_base`.
 */
export function compararComHumano(
  veredito: 'aprovar' | 'em_validacao' | 'isento' | null | undefined,
  statusHumano: string | null | undefined,
): ResultadoComparacao {
  if (veredito == null || veredito === 'isento') return 'sem_base';

  const status = String(statusHumano ?? '').trim().toLowerCase();

  if (status === 'aprovado') {
    return veredito === 'aprovar' ? 'acerto' : 'conservador';
  }
  if (status === 'reprovado') {
    return veredito === 'aprovar' ? 'erro_grave' : 'acerto';
  }
  return 'sem_base';
}

export type Acuracia = {
  total: number;
  acerto: number;
  conservador: number;
  erro_grave: number;
  sem_base: number;
  /** total − sem_base (os que têm gabarito humano para comparar). */
  comparaveis: number;
  /** acerto / comparaveis (0 quando não há comparáveis). */
  taxa_acerto: number;
  /** erro_grave / comparaveis (0 quando não há comparáveis) — a taxa que precisa ser ~0. */
  taxa_erro_grave: number;
};

/** Agrega uma lista de comparações em contagens + taxas sobre os comparáveis (sem divisão por 0). */
export function agregarAcuracia(resultados: ResultadoComparacao[]): Acuracia {
  const acc: Acuracia = {
    total: resultados.length,
    acerto: 0,
    conservador: 0,
    erro_grave: 0,
    sem_base: 0,
    comparaveis: 0,
    taxa_acerto: 0,
    taxa_erro_grave: 0,
  };
  for (const r of resultados) {
    if (r === 'acerto') acc.acerto++;
    else if (r === 'conservador') acc.conservador++;
    else if (r === 'erro_grave') acc.erro_grave++;
    else acc.sem_base++;
  }
  acc.comparaveis = acc.total - acc.sem_base;
  if (acc.comparaveis > 0) {
    acc.taxa_acerto = acc.acerto / acc.comparaveis;
    acc.taxa_erro_grave = acc.erro_grave / acc.comparaveis;
  }
  return acc;
}
