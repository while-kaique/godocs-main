// T2 — cache do auth em sessionStorage (helpers PUROS, storage injetado).
//
// Objetivo: reload ou navegação entre telas admin na mesma aba não volta a "Verificando
// permissões". O gate real é server-side (requireAdmin), então o cache do cliente só
// decide o que pintar — e QUALQUER problema (TTL, JSON corrompido, quota, ausência de
// storage) tem de degradar para "sem cache", NUNCA lançar.
import { describe, it, expect, beforeEach } from 'vitest';

import {
  AUTH_CACHE_KEY,
  AUTH_CACHE_MS,
  lerAuthCache,
  gravarAuthCache,
  limparAuthCache,
} from '@/lib/auth-cache';

type Usuario = { email: string; name: string; isAdmin: boolean };

const USER: Usuario = {
  email: 'luis.albuquerque@gocase.com',
  name: 'Luis Albuquerque',
  isAdmin: true,
};

const T0 = new Date('2026-07-28T12:00:00.000Z').getTime();

/** sessionStorage de mentira, em memória (o teste roda em `node`, sem jsdom). */
function fakeStorage(over: Partial<Storage> = {}): Storage {
  const mapa = new Map<string, string>();
  const s: Storage = {
    get length() {
      return mapa.size;
    },
    clear: () => mapa.clear(),
    getItem: (k: string) => (mapa.has(k) ? mapa.get(k)! : null),
    key: (i: number) => Array.from(mapa.keys())[i] ?? null,
    removeItem: (k: string) => void mapa.delete(k),
    setItem: (k: string, v: string) => void mapa.set(k, String(v)),
  };
  return Object.assign(s, over);
}

let storage: Storage;

beforeEach(() => {
  storage = fakeStorage();
});

describe('constantes do cache de auth', () => {
  it('chave versionada e TTL de 5 minutos', () => {
    expect(AUTH_CACHE_KEY).toBe('godocs:auth-v1');
    expect(AUTH_CACHE_MS).toBe(5 * 60 * 1000);
  });
});

describe('gravar/ler', () => {
  it('grava e devolve o usuário de volta', () => {
    gravarAuthCache(USER, T0, storage);
    expect(lerAuthCache<Usuario>(T0, storage)).toEqual(USER);
    expect(storage.getItem(AUTH_CACHE_KEY)).toBeTruthy();
  });

  it('serve dentro do TTL e devolve null depois de vencido', () => {
    gravarAuthCache(USER, T0, storage);

    expect(lerAuthCache<Usuario>(T0 + AUTH_CACHE_MS - 1, storage)).toEqual(USER);
    expect(lerAuthCache<Usuario>(T0 + AUTH_CACHE_MS + 1, storage)).toBeNull();
  });

  it('carimbo no futuro (relógio bagunçado) não vira cache eterno de permissão', () => {
    gravarAuthCache(USER, T0, storage);
    // ler "antes" de gravar: idade negativa continua dentro do TTL, mas nunca deve lançar
    expect(() => lerAuthCache<Usuario>(T0 - 10 * AUTH_CACHE_MS, storage)).not.toThrow();
  });

  it('sem nada gravado devolve null', () => {
    expect(lerAuthCache<Usuario>(T0, storage)).toBeNull();
  });
});

describe('degradação (nunca lança)', () => {
  it('JSON corrompido na chave devolve null sem lançar', () => {
    storage.setItem(AUTH_CACHE_KEY, '{isso não é json');
    expect(() => lerAuthCache<Usuario>(T0, storage)).not.toThrow();
    expect(lerAuthCache<Usuario>(T0, storage)).toBeNull();
  });

  it('entrada sem o formato esperado ({user, at}) devolve null', () => {
    storage.setItem(AUTH_CACHE_KEY, JSON.stringify({ qualquer: 'coisa' }));
    expect(lerAuthCache<Usuario>(T0, storage)).toBeNull();
  });

  it('storage ausente (fora do browser) → null na leitura e silêncio na gravação', () => {
    expect(lerAuthCache<Usuario>(T0, null)).toBeNull();
    expect(lerAuthCache<Usuario>(T0, undefined)).toBeNull();
    expect(() => gravarAuthCache(USER, T0, null)).not.toThrow();
    expect(() => limparAuthCache(null)).not.toThrow();
  });

  it('setItem que lança (quota cheia / modo privado) degrada sem lançar', () => {
    const cheio = fakeStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => gravarAuthCache(USER, T0, cheio)).not.toThrow();
    expect(lerAuthCache<Usuario>(T0, cheio)).toBeNull();
  });

  it('getItem que lança degrada para null', () => {
    const quebrado = fakeStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(() => lerAuthCache<Usuario>(T0, quebrado)).not.toThrow();
    expect(lerAuthCache<Usuario>(T0, quebrado)).toBeNull();
  });
});

describe('limparAuthCache', () => {
  it('remove a chave (logout / permissão revogada)', () => {
    gravarAuthCache(USER, T0, storage);
    limparAuthCache(storage);

    expect(storage.getItem(AUTH_CACHE_KEY)).toBeNull();
    expect(lerAuthCache<Usuario>(T0, storage)).toBeNull();
  });

  it('removeItem que lança não propaga', () => {
    const quebrado = fakeStorage({
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(() => limparAuthCache(quebrado)).not.toThrow();
  });
});
