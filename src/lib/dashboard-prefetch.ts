/**
 * Prefetch da listagem do dashboard — tira o RTT do auth do caminho crítico.
 *
 * O problema era fila indiana: o `beforeLoad` de `/_authenticated` esperava
 * `/api/auth/me` e só DEPOIS o componente montava e pedia a planilha (~2 s). As duas
 * chamadas são independentes — o servidor exige admin em `/api/admin/*` de qualquer
 * jeito (`requireAdmin`), então pedir a listagem antes de saber o veredito do auth é
 * seguro: um não-admin recebe 403 e o prefetch é descartado.
 *
 * Estado de módulo (uma promise em voo). O consumo é de uma vez só: quem pega a promise
 * é dono dela, e uma navegação nova refaz o pedido em vez de servir dado velho.
 */
import { apiFetch } from '@/lib/api-client';

export const ROTA_LISTAGEM_DASHBOARD = '/api/admin/dashboard/projetos';

type Fetcher = () => Promise<unknown>;

/**
 * Promise pendente (com o instante em que foi disparada). Resolve em `null` quando o fetch
 * falhou (403, rede, edge).
 */
let pendente: { p: Promise<unknown>; at: number } | null = null;

/**
 * Idade máxima de um prefetch guardado. Sem teto, um prefetch disparado numa navegação
 * ABORTADA (o `beforeLoad` dispara antes do auth resolver) ficaria retido pela vida da aba
 * e uma visita posterior pintaria a triagem com um snapshot de horas atrás, sem tocar o
 * servidor. Passado o teto, o consumidor faz o fetch normal.
 */
export const PREFETCH_MAX_MS = 15_000;

/**
 * Dispara o prefetch se ainda não houver um em voo. Nunca lança e nunca gera
 * "unhandled rejection": o erro é engolido e vira `null` para o consumidor, que então
 * faz o fetch normal e mostra a mensagem de erro real.
 */
export function iniciarPrefetchDashboard(fetcher?: Fetcher): void {
  if (pendente) return;
  const f: Fetcher = fetcher ?? (() => apiFetch(ROTA_LISTAGEM_DASHBOARD));
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(f());
  } catch {
    // Fetcher que lança de forma síncrona: nada a prefetchar.
    return;
  }
  const engolido = p.catch(() => null);
  const slot = { p: engolido, at: Date.now() };
  pendente = slot;
  // Erro NÃO fica cacheado: se falhou, solta o slot para que uma navegação seguinte
  // possa tentar de novo em vez de herdar um `null` velho.
  void engolido.then((v) => {
    if (v === null && pendente === slot) pendente = null;
  });
}

/**
 * Entrega a promise pendente e a CONSOME (a 2ª chamada devolve `null`, sinalizando ao
 * chamador que ele deve fazer o fetch normal). Resolve em `null` se o prefetch falhou.
 */
export function consumirPrefetchDashboard<T>(): Promise<T | null> | null {
  if (!pendente) return null;
  const slot = pendente;
  pendente = null;
  if (Date.now() - slot.at > PREFETCH_MAX_MS) return null; // velho demais: pede de novo
  return slot.p as Promise<T | null>;
}

/** Esvazia o estado (troca de usuário, logout, testes). */
export function limparPrefetchDashboard(): void {
  pendente = null;
}
