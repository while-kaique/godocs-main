/**
 * Cache de LEITURA no cliente, em `sessionStorage`, com TTL — núcleo genérico.
 *
 * ## Por que existe
 * Neste app **cada requisição custa ~750 ms de overhead FIXO do edge** (o gate de OAuth),
 * independente do trabalho que ela faz. Então tela que só pinta um bloco depois de um fetch
 * aparece com atraso visível, e o atraso VARIA (cold start do worker) — o que é pior que ser
 * lento sempre, porque a pessoa não aprende a esperar.
 *
 * Para dado que muda pouco e não é sigiloso, guardar a última resposta na aba resolve: a
 * segunda visita pinta na hora e revalida por baixo.
 *
 * ## Por que `sessionStorage` e não `localStorage`
 * Some ao fechar o navegador. O custo é um fetch por aba nova, e isso é aceitável — enquanto
 * `localStorage` transformaria "dado velho por 15 min" em "dado velho por semanas".
 *
 * ⚠️ **Não use isto para decidir permissão nem para dado sigiloso.** O gate real é sempre
 * server-side; este cache decide o que a tela PINTA enquanto revalida.
 *
 * ⚠️ Nada aqui lança: storage bloqueado (modo restrito, iframe), JSON corrompido de aba antiga
 * ou cota estourada degradam para "sem cache", que é só mais lento.
 *
 * Extraído de `auth-cache.ts`, que passou a delegar: eram a mesma máquina, e a segunda cópia
 * divergiria na primeira vez que alguém melhorasse uma.
 */

type Entrada<T> = { v: T; at: number };

function storagePadrao(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function lerCacheSessao<T>(
  chave: string,
  ttlMs: number,
  agora = Date.now(),
  storage?: Storage | null,
): T | null {
  const s = storage === undefined ? storagePadrao() : storage;
  if (!s) return null;
  let cru: string | null = null;
  try {
    cru = s.getItem(chave);
  } catch {
    return null;
  }
  if (!cru) return null;
  let entrada: Entrada<T> | null = null;
  try {
    entrada = JSON.parse(cru) as Entrada<T>;
  } catch {
    return null;
  }
  if (!entrada || typeof entrada !== 'object' || typeof entrada.at !== 'number') return null;
  if (entrada.v == null) return null;
  if (agora - entrada.at >= ttlMs) {
    limparCacheSessao(chave, s);
    return null;
  }
  return entrada.v;
}

export function gravarCacheSessao<T>(
  chave: string,
  valor: T,
  agora = Date.now(),
  storage?: Storage | null,
): void {
  const s = storage === undefined ? storagePadrao() : storage;
  if (!s) return;
  try {
    s.setItem(chave, JSON.stringify({ v: valor, at: agora } satisfies Entrada<T>));
  } catch {
    // Sem cache é só mais lento, não é erro de produto.
  }
}

export function limparCacheSessao(chave: string, storage?: Storage | null): void {
  const s = storage === undefined ? storagePadrao() : storage;
  if (!s) return;
  try {
    s.removeItem(chave);
  } catch {
    // idem
  }
}
