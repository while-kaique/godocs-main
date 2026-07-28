// T1 — stale-while-revalidate na leitura da planilha do dashboard do admin.
//
// A planilha custa ~2s (2,65 MB). O comportamento pedido: cache VENCIDO devolve o dado
// VELHO na hora e relê em background (nenhum admin espera por expiração de TTL); isolate
// frio e `refresh=1` continuam bloqueando; N chamadas concorrentes disparam UMA releitura;
// falha da revalidação não derruba a request nem envenena o cache.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  readAllRows: vi.fn(),
  updateRowByProjectId: vi.fn(),
}));

vi.mock('@/integrations/db/client.server', () => ({
  insertAdminStatusLog: vi.fn(),
  getAdminStatusLogs: vi.fn(async () => []),
}));

// O fire-and-forget do worker passa por runBackground (ctx.waitUntil). Mockado para o
// teste poder AGUARDAR a promise de background e para a rejeição nunca vazar.
const bg: Promise<unknown>[] = [];
vi.mock('@/lib/background', () => ({
  runBackground: vi.fn((p: Promise<unknown>) => {
    bg.push(Promise.resolve(p).catch(() => undefined));
  }),
}));

import { readAllRows } from '@/lib/google/sheets';
import {
  listarProjetosDashboard,
  invalidarCacheDashboard,
} from '@/lib/dashboard-admin.functions';

const mockReadAllRows = vi.mocked(readAllRows);

const TTL_MS = 60_000;
const T0 = new Date('2026-07-28T12:00:00.000Z').getTime();

function linha(id: string) {
  return {
    'ID Projeto': id,
    Projeto: `Projeto ${id}`,
    'Nome Completo': 'Helén Sá',
    Email: 'helen@gocase.com',
    Status: 'Pendente',
    'Data Submissão': '12/05/2026',
  } as Record<string, string>;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deixa microtasks pendentes rodarem (o background do SWR resolve em microtask). */
async function drenar() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await Promise.all(bg);
}

/**
 * Falha RÁPIDO e com mensagem clara se a chamada bloquear — é exatamente o que o SWR
 * precisa deixar de fazer com cache vencido. (Timers reais: só `Date` é falseado.)
 */
function semBloquear<T>(p: Promise<T>, ms = 300): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(
        () =>
          rej(
            new Error(
              'a chamada BLOQUEOU esperando a releitura — o cache vencido deveria voltar na hora',
            ),
          ),
        ms,
      ),
    ),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  bg.length = 0;
  invalidarCacheDashboard();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T1 — stale-while-revalidate do cache da planilha', () => {
  it('isolate frio (sem cache) BLOQUEIA na leitura e não sinaliza revalidação', async () => {
    mockReadAllRows.mockResolvedValue([linha('velho')] as never);

    const r = await listarProjetosDashboard();

    expect(r.doCache).toBe(false);
    expect(r.revalidando).toBe(false);
    expect(r.projetos.map((p) => p.id)).toEqual(['velho']);
    expect(mockReadAllRows).toHaveBeenCalledTimes(1);
  });

  it('cache fresco (<60s) serve do cache sem reler e sem revalidar', async () => {
    mockReadAllRows.mockResolvedValue([linha('velho')] as never);
    await listarProjetosDashboard();

    vi.setSystemTime(T0 + TTL_MS - 1);
    const r = await listarProjetosDashboard();

    expect(r.doCache).toBe(true);
    expect(r.revalidando).toBe(false);
    expect(mockReadAllRows).toHaveBeenCalledTimes(1);
  });

  it('cache VENCIDO devolve o dado velho IMEDIATAMENTE, sem esperar a releitura', async () => {
    mockReadAllRows.mockResolvedValueOnce([linha('velho')] as never);
    await listarProjetosDashboard();

    // A releitura fica PENDURADA: se a implementação esperar por ela, o teste estoura.
    const releitura = deferred<Record<string, string>[]>();
    mockReadAllRows.mockReturnValueOnce(releitura.promise as never);

    vi.setSystemTime(T0 + TTL_MS + 1);
    const r = await semBloquear(listarProjetosDashboard());

    expect(r.projetos.map((p) => p.id)).toEqual(['velho']); // dado ANTIGO servido na hora
    expect(r.doCache).toBe(true);
    expect(r.revalidando).toBe(true);
    expect(mockReadAllRows).toHaveBeenCalledTimes(2); // a releitura JÁ foi disparada

    // Terminada a releitura, o cache passa a servir o dado novo, sem revalidar de novo.
    releitura.resolve([linha('novo')]);
    await drenar();

    const depois = await semBloquear(listarProjetosDashboard());
    expect(depois.projetos.map((p) => p.id)).toEqual(['novo']);
    expect(depois.doCache).toBe(true);
    expect(depois.revalidando).toBe(false);
    expect(mockReadAllRows).toHaveBeenCalledTimes(2);
  });

  it('single-flight: N chamadas concorrentes com cache vencido = UMA releitura', async () => {
    mockReadAllRows.mockResolvedValueOnce([linha('velho')] as never);
    await listarProjetosDashboard();

    const releitura = deferred<Record<string, string>[]>();
    mockReadAllRows.mockReturnValue(releitura.promise as never);

    vi.setSystemTime(T0 + TTL_MS + 1);
    const rs = await semBloquear(
      Promise.all([
        listarProjetosDashboard(),
        listarProjetosDashboard(),
        listarProjetosDashboard(),
        listarProjetosDashboard(),
      ]),
    );

    for (const r of rs) {
      expect(r.projetos.map((p) => p.id)).toEqual(['velho']);
      expect(r.revalidando).toBe(true);
    }
    // 1 leitura inicial + 1 releitura — nunca 4.
    expect(mockReadAllRows).toHaveBeenCalledTimes(2);

    releitura.resolve([linha('novo')]);
    await drenar();
  });

  it('refresh=true BLOQUEIA e devolve dado novo (o botão "Atualizar" fura o cache)', async () => {
    mockReadAllRows.mockResolvedValueOnce([linha('velho')] as never);
    await listarProjetosDashboard();

    mockReadAllRows.mockResolvedValueOnce([linha('novo')] as never);
    const r = await listarProjetosDashboard(true);

    expect(r.doCache).toBe(false);
    expect(r.revalidando).toBe(false);
    expect(r.projetos.map((p) => p.id)).toEqual(['novo']);
    expect(mockReadAllRows).toHaveBeenCalledTimes(2);
  });

  it('falha na revalidação não rejeita a request nem envenena o cache', async () => {
    mockReadAllRows.mockResolvedValueOnce([linha('velho')] as never);
    await listarProjetosDashboard();

    mockReadAllRows.mockRejectedValueOnce(new Error('Sheets 503'));
    vi.setSystemTime(T0 + TTL_MS + 1);

    const r = await semBloquear(listarProjetosDashboard());
    expect(r.projetos.map((p) => p.id)).toEqual(['velho']);
    expect(r.doCache).toBe(true);
    expect(r.revalidando).toBe(true);
    await drenar();

    // Cache velho intacto: a chamada seguinte ainda serve o dado antigo e TENTA de novo.
    const releitura = deferred<Record<string, string>[]>();
    mockReadAllRows.mockReturnValueOnce(releitura.promise as never);

    const segunda = await semBloquear(listarProjetosDashboard());
    expect(segunda.projetos.map((p) => p.id)).toEqual(['velho']);
    expect(segunda.revalidando).toBe(true);
    expect(mockReadAllRows).toHaveBeenCalledTimes(3);

    releitura.resolve([linha('novo')]);
    await drenar();
    const terceira = await semBloquear(listarProjetosDashboard());
    expect(terceira.projetos.map((p) => p.id)).toEqual(['novo']);
  });
});

