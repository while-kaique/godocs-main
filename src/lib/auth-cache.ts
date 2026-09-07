/**
 * Cache do usuário autenticado no CLIENTE, em `sessionStorage`.
 *
 * Por que existe: o `beforeLoad` de `/_authenticated` bloqueia a tela inteira em
 * "Verificando permissões..." enquanto espera `/api/auth/me`. O cache em memória do
 * módulo morre a cada **reload**, então recarregar uma tela admin voltava para a tela de
 * espera mesmo tendo acabado de autenticar.
 *
 * Por que `sessionStorage` e não `localStorage`: dado de permissão não deve sobreviver ao
 * fechamento do navegador. O custo é um fetch por aba nova — aceitável.
 *
 * Por que é seguro: o gate REAL é server-side (`requireAdmin` em toda `/api/admin/*`).
 * Este cache só decide o que a SPA pinta enquanto revalida; alguém que forjasse a chave
 * veria o layout do admin e receberia 403 em cada chamada de dados.
 *
 * Helpers puros (storage injetável) para serem testáveis sem DOM.
 */

export const AUTH_CACHE_KEY = 'godocs:auth-v1';
/** Mesmo TTL do cache em memória: 5 min é curto o bastante para não fixar permissão velha. */
export const AUTH_CACHE_MS = 5 * 60 * 1000;

/**
 * ⚠️ **O corpo mora em `cache-sessao.ts`**, que é o mesmo mecanismo com a chave e o TTL como
 * parâmetro. Este arquivo continua existindo porque o NOME importa: quem lê `lerAuthCache` sabe
 * o que está lendo, e o cabeçalho acima guarda o porquê de o cache de PERMISSÃO ser seguro.
 */
import { gravarCacheSessao, lerCacheSessao, limparCacheSessao } from '@/lib/cache-sessao';

/** Lê o usuário cacheado. Nunca lança; entrada vencida é removida no caminho. */
export function lerAuthCache<T>(agora = Date.now(), storage?: Storage | null): T | null {
  return lerCacheSessao<T>(AUTH_CACHE_KEY, AUTH_CACHE_MS, agora, storage);
}

/** Grava o usuário. Falha de gravação (quota, storage bloqueado) degrada em silêncio. */
export function gravarAuthCache<T>(user: T, agora = Date.now(), storage?: Storage | null): void {
  gravarCacheSessao(AUTH_CACHE_KEY, user, agora, storage);
}

/** Remove a entrada (usado quando o auth falha ou o usuário perde o acesso). */
export function limparAuthCache(storage?: Storage | null): void {
  limparCacheSessao(AUTH_CACHE_KEY, storage);
}
