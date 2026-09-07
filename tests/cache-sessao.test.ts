import { describe, it, expect } from 'vitest';
import { lerCacheSessao, gravarCacheSessao, limparCacheSessao } from '@/lib/cache-sessao';

/** sessionStorage de mentira, com botão de quebrar — é assim que o navegador restrito age. */
function storageFake(quebrado = false): Storage {
  const m = new Map<string, string>();
  const boom = () => {
    throw new Error('storage bloqueado');
  };
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (quebrado ? boom() : (m.get(k) ?? null)),
    setItem: (k: string, v: string) => {
      if (quebrado) boom();
      m.set(k, v);
    },
    removeItem: (k: string) => {
      if (quebrado) boom();
      m.delete(k);
    },
  } as Storage;
}

describe('cache de sessão: ida e volta', () => {
  it('devolve o que guardou, dentro do TTL', () => {
    const s = storageFake();
    gravarCacheSessao('k', [{ slug: 'a' }], 1000, s);
    expect(lerCacheSessao('k', 5000, 2000, s)).toEqual([{ slug: 'a' }]);
  });

  it('vencido devolve null E limpa a entrada, para não virar lixo na aba', () => {
    const s = storageFake();
    gravarCacheSessao('k', 'x', 1000, s);
    expect(lerCacheSessao('k', 5000, 9000, s)).toBeNull();
    expect(s.getItem('k')).toBeNull();
  });

  it('chaves diferentes não se enxergam', () => {
    const s = storageFake();
    gravarCacheSessao('a', 1, 0, s);
    expect(lerCacheSessao('b', 5000, 0, s)).toBeNull();
  });
});

/**
 * ⚠️ Nada aqui pode lançar: um navegador em modo restrito, uma extensão ou uma aba antiga com
 * JSON de outro formato transformariam "sem cache" (só mais lento) em "tela branca".
 */
describe('cache de sessão: degrada, nunca quebra', () => {
  it('storage bloqueado não lança, em nenhuma das 3 operações', () => {
    const s = storageFake(true);
    expect(() => gravarCacheSessao('k', 1, 0, s)).not.toThrow();
    expect(lerCacheSessao('k', 5000, 0, s)).toBeNull();
    expect(() => limparCacheSessao('k', s)).not.toThrow();
  });

  it('sem storage nenhum (SSR, ambiente sem DOM) devolve null', () => {
    expect(lerCacheSessao('k', 5000, 0, null)).toBeNull();
    expect(() => gravarCacheSessao('k', 1, 0, null)).not.toThrow();
  });

  it('JSON corrompido de aba antiga devolve null em vez de estourar', () => {
    const s = storageFake();
    s.setItem('k', '{isto não é json');
    expect(lerCacheSessao('k', 5000, 0, s)).toBeNull();
  });

  it('entrada em formato desconhecido devolve null', () => {
    const s = storageFake();
    s.setItem('k', JSON.stringify({ user: 'formato antigo' }));
    expect(lerCacheSessao('k', 5000, 0, s)).toBeNull();
  });

  it('valor nulo guardado não vira cache válido', () => {
    const s = storageFake();
    s.setItem('k', JSON.stringify({ v: null, at: 0 }));
    expect(lerCacheSessao('k', 5000, 0, s)).toBeNull();
  });
});
