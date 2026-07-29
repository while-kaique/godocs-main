// T3 — prefetch do dashboard: a leitura da planilha começa JUNTO com o /api/auth/me,
// não depois. O módulo só guarda a promise em voo — quem monta a tela CONSOME essa
// promise se ela existir, senão faz o fetch normal.
//
// Guardas do plano: consome uma vez (2ª chamada devolve null); não dispara 2º fetch
// enquanto há uma pendente; erro (403 de não-admin) NÃO pendura o consumidor nem fica
// cacheado; nenhuma unhandled rejection.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  iniciarPrefetchDashboard,
  consumirPrefetchDashboard,
  limparPrefetchDashboard,
  PREFETCH_MAX_MS,
} from '@/lib/dashboard-prefetch';

type Payload = { projetos: { id: string }[] };

const DADO: Payload = { projetos: [{ id: 'legado-148' }] };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function drenar() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const naoTratadas: unknown[] = [];
const capturar = (e: unknown) => naoTratadas.push(e);

beforeEach(() => {
  limparPrefetchDashboard();
  naoTratadas.length = 0;
  process.on('unhandledRejection', capturar);
});

afterEach(() => {
  process.off('unhandledRejection', capturar);
  limparPrefetchDashboard();
});

describe('T3 — prefetch do dashboard', () => {
  it('consumir devolve o dado da promise em voo', async () => {
    const fetcher = vi.fn(async () => DADO);
    iniciarPrefetchDashboard(fetcher);

    const pendente = consumirPrefetchDashboard<Payload>();
    expect(pendente).not.toBeNull();
    await expect(pendente!).resolves.toEqual(DADO);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('não dispara um 2º fetch enquanto há um em voo', async () => {
    const d = deferred<Payload>();
    const fetcher = vi.fn(() => d.promise);

    iniciarPrefetchDashboard(fetcher);
    iniciarPrefetchDashboard(fetcher);
    iniciarPrefetchDashboard(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);

    d.resolve(DADO);
    await expect(consumirPrefetchDashboard<Payload>()!).resolves.toEqual(DADO);
  });

  it('CONSOME: a 2ª chamada devolve null (o chamador faz o fetch normal)', async () => {
    const fetcher = vi.fn(async () => DADO);
    iniciarPrefetchDashboard(fetcher);

    await expect(consumirPrefetchDashboard<Payload>()!).resolves.toEqual(DADO);
    expect(consumirPrefetchDashboard<Payload>()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sem prefetch em voo, consumir devolve null', () => {
    expect(consumirPrefetchDashboard<Payload>()).toBeNull();
  });

  it('fetcher que rejeita (403 de não-admin) resolve em null, sem unhandled rejection', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('403 forbidden');
    });
    iniciarPrefetchDashboard(fetcher);
    await drenar();

    const pendente = consumirPrefetchDashboard<Payload>();
    if (pendente) await expect(pendente).resolves.toBeNull();

    await drenar();
    expect(naoTratadas).toEqual([]);
  });

  it('erro NÃO fica cacheado: o iniciar seguinte dispara fetch novo', async () => {
    const ruim = vi.fn(async () => {
      throw new Error('403 forbidden');
    });
    iniciarPrefetchDashboard(ruim);
    await drenar();

    const bom = vi.fn(async () => DADO);
    iniciarPrefetchDashboard(bom);

    expect(bom).toHaveBeenCalledTimes(1);
    await expect(consumirPrefetchDashboard<Payload>()!).resolves.toEqual(DADO);
    expect(ruim).toHaveBeenCalledTimes(1);
    expect(naoTratadas).toEqual([]);
  });

  it('limpar esvazia o estado (nada pendente para consumir)', async () => {
    const d = deferred<Payload>();
    const fetcher = vi.fn(() => d.promise);
    iniciarPrefetchDashboard(fetcher);

    limparPrefetchDashboard();
    expect(consumirPrefetchDashboard<Payload>()).toBeNull();

    // e um iniciar depois do limpar volta a buscar
    const outro = vi.fn(async () => DADO);
    iniciarPrefetchDashboard(outro);
    expect(outro).toHaveBeenCalledTimes(1);

    d.resolve(DADO);
    await drenar();
    expect(naoTratadas).toEqual([]);
  });
});

// Correção do revisor de qualidade (2026-07-28): sem teto de idade, um prefetch de
// navegação ABORTADA ficava retido pela vida da aba e pintava a triagem com dado velho.
describe('T3 — prefetch tem teto de idade', () => {
  it('prefetch velho é descartado: o consumidor faz o fetch normal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      limparPrefetchDashboard();
      const fetcher = vi.fn(async () => DADO);
      iniciarPrefetchDashboard(fetcher);
      vi.setSystemTime(Date.now() + PREFETCH_MAX_MS + 1);
      expect(consumirPrefetchDashboard<Payload>()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
