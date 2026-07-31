// SWR × escrita de status — achados do revisor de qualidade (contexto fresco, 28/07/2026).
//
// A revalidação em background criou corridas que o TTL bloqueante não tinha:
// (1) `definirStatusProjeto` corrige a linha no cache, mas uma releitura que COMEÇOU antes
//     da escrita traz a célula antiga e, ao instalar, apagava a correção — o status que o
//     admin acabou de decidir "voltava atrás" por até 60 s (a garantia do D5 ficava falsa);
// (2) `?refresh=1` passou a herdar a revalidação em voo, então o botão "Atualizar" podia
//     devolver um snapshot ANTERIOR à edição manual da planilha;
// (3) sem teto de idade, um Sheets fora do ar deixava a triagem decidindo sobre dado de
//     horas atrás, com a tela dizendo apenas "atualizando".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const bg: Promise<unknown>[] = [];

vi.mock('@/lib/google/sheets', () => ({
  readAllRows: vi.fn(),
  updateRowByProjectId: vi.fn(async () => undefined),
}));
vi.mock('@/lib/background', () => ({
  runBackground: (p: Promise<unknown>) => {
    bg.push(Promise.resolve(p).catch(() => undefined));
  },
}));
vi.mock('@/integrations/db/client.server', () => ({
  insertAdminStatusLog: vi.fn(async () => undefined),
  getAdminStatusLogs: vi.fn(async () => []),
}));

import { readAllRows, updateRowByProjectId } from '@/lib/google/sheets';
import {
  listarProjetosDashboard,
  definirStatusProjeto,
  invalidarCacheDashboard,
} from '@/lib/dashboard-admin.functions';

const mockRead = vi.mocked(readAllRows);
const mockUpdate = vi.mocked(updateRowByProjectId);

const T0 = new Date('2026-07-28T12:00:00.000Z').getTime();

function linha(status: string) {
  return {
    'ID Projeto': 'legado-148',
    Projeto: 'Portal de Reembolsos',
    'Nome Completo': 'Helén Sá',
    Email: 'helen@gocase.com',
    Status: status,
    'Data Submissão': '12/05/2026',
  } as Record<string, string>;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

async function drenar() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await Promise.all(bg);
}

beforeEach(() => {
  vi.clearAllMocks();
  bg.length = 0;
  invalidarCacheDashboard();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  mockUpdate.mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a decisão do admin não volta atrás', () => {
  it('releitura iniciada ANTES da escrita não apaga o status gravado', async () => {
    mockRead.mockResolvedValueOnce([linha('Pendente')] as never);
    await listarProjetosDashboard();

    vi.setSystemTime(T0 + 61_000);
    const releitura = deferred<Record<string, string>[]>();
    mockRead.mockReturnValueOnce(releitura.promise as never);
    const stale = await listarProjetosDashboard(); // serve o velho + revalida
    expect(stale.revalidando).toBe(true);

    // O admin decide o status enquanto a releitura está em voo.
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Aprovado' },
      'admin@gocase.com',
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // A releitura termina trazendo a célula ANTIGA (foi lida antes da escrita aterrissar).
    releitura.resolve([linha('Pendente')]);
    await drenar();

    const depois = await listarProjetosDashboard();
    expect(depois.projetos[0]?.status).toBe('Aprovado');
  });
});

describe('?refresh=1 continua garantindo dado fresco', () => {
  it('não herda a revalidação que começou antes do clique', async () => {
    mockRead.mockResolvedValueOnce([linha('Pendente')] as never);
    await listarProjetosDashboard();

    vi.setSystemTime(T0 + 61_000);
    const velha = deferred<Record<string, string>[]>();
    mockRead.mockReturnValueOnce(velha.promise as never);
    await listarProjetosDashboard(); // revalidação em voo

    // Alguém edita a planilha à mão e aperta "Atualizar".
    mockRead.mockResolvedValueOnce([linha('Reprovado')] as never);
    const pedido = listarProjetosDashboard(true);
    velha.resolve([linha('Pendente')]);
    const fresco = await pedido;

    expect(fresco.doCache).toBe(false);
    expect(fresco.projetos[0]?.status).toBe('Reprovado');
    await drenar();
    // A leitura velha, que terminou depois, não pode reinstalar o dado anterior.
    const seguinte = await listarProjetosDashboard();
    expect(seguinte.projetos[0]?.status).toBe('Reprovado');
  });
});

describe('teto de idade do dado velho', () => {
  it('cache velho demais volta a BLOQUEAR em vez de servir stale eterno', async () => {
    mockRead.mockResolvedValueOnce([linha('Pendente')] as never);
    await listarProjetosDashboard();

    vi.setSystemTime(T0 + 11 * 60_000); // acima de STALE_MAX_MS (10 × TTL)
    mockRead.mockResolvedValueOnce([linha('Aprovado')] as never);
    const r = await listarProjetosDashboard();

    expect(r.doCache).toBe(false);
    expect(r.projetos[0]?.status).toBe('Aprovado');
  });
});
