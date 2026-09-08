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

type Entrada<T> = { user: T; at: number };

function storagePadrao(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    // Navegador com storage bloqueado (modo restrito / iframe sem permissão).
    return null;
  }
}

/**
 * Lê o usuário cacheado. Devolve `null` — nunca lança — quando não há storage, a chave
 * está ausente/corrompida, o formato não é o esperado ou a entrada passou do TTL.
 * Entrada vencida é removida no caminho, para não ficar lixo na aba.
 */
export function lerAuthCache<T>(agora = Date.now(), storage?: Storage | null): T | null {
  const s = storage === undefined ? storagePadrao() : storage;
  if (!s) return null;
  let cru: string | null = null;
  try {
    cru = s.getItem(AUTH_CACHE_KEY);
  } catch {
    return null;
  }
  if (!cru) return null;
  let entrada: Entrada<T> | null = null;
  try {
    entrada = JSON.parse(cru) as Entrada<T>;
  } catch {
    return null; // JSON corrompido (aba antiga, extensão, edição manual)
  }
  if (!entrada || typeof entrada !== 'object' || typeof entrada.at !== 'number') return null;
  if (entrada.user == null) return null;
  if (agora - entrada.at >= AUTH_CACHE_MS) {
    limparAuthCache(s);
    return null;
  }
  return entrada.user;
}

/** Grava o usuário. Falha de gravação (quota, storage bloqueado) degrada em silêncio. */
export function gravarAuthCache<T>(user: T, agora = Date.now(), storage?: Storage | null): void {
  const s = storage === undefined ? storagePadrao() : storage;
  if (!s) return;
  try {
    const entrada: Entrada<T> = { user, at: agora };
    s.setItem(AUTH_CACHE_KEY, JSON.stringify(entrada));
  } catch {
    // Sem cache é só mais lento, não é erro de produto.
  }
}

/** Remove a entrada (usado quando o auth falha ou o usuário perde o acesso). */
export function limparAuthCache(storage?: Storage | null): void {
  const s = storage === undefined ? storagePadrao() : storage;
  if (!s) return;
  try {
    s.removeItem(AUTH_CACHE_KEY);
  } catch {
    // idem
  }
}
