// `updateRowByProjectId` precisa INFORMAR se a linha existia (hoje ela dá um
// `return` silencioso quando o ID não está na coluna "ID Projeto", e a IDA da
// edição some sem rastro). Requisito duro: a informação sai da leitura que JÁ
// é feita — nenhuma leitura adicional do Sheets.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/auth', () => ({ getAccessToken: vi.fn().mockResolvedValue('tok-123') }));

import { updateRowByProjectId } from '@/lib/google/sheets';

const okResp = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

const LIVE_HEADERS = ['ID Projeto', 'Custo Evitado Horas', 'Status', 'Observações', 'Atualizado Em'];

/** 1:1 → cabeçalho; GET → coluna do ID; batchUpdate → ok. */
function makeFetchMock(idColumnValues: string[][]) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && u.includes('batchUpdate')) return okResp({});
    if (u.includes('1%3A1')) return okResp({ values: [LIVE_HEADERS] });
    return okResp({ values: idColumnValues });
  });
}

/** A assinatura hoje é `Promise<void>`; o comportamento pedido é `Promise<boolean>`. */
async function update(id: string, updates: Record<string, unknown>): Promise<boolean> {
  return (await updateRowByProjectId(id, updates as never)) as unknown as boolean;
}

describe('B1 — updateRowByProjectId informa se achou a linha', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('resolve para TRUE quando o "ID Projeto" existe e a linha foi atualizada', async () => {
    const fetchMock = makeFetchMock([['ID Projeto'], ['outro-id'], ['p1']]);
    vi.stubGlobal('fetch', fetchMock);

    const achou = await update('p1', { Status: 'Pendente' });

    expect(achou).toBe(true);
    // e realmente gravou
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('batchUpdate'))).toBe(true);
  });

  it('resolve para FALSE quando o "ID Projeto" NÃO está na planilha (sem gravar nada)', async () => {
    const fetchMock = makeFetchMock([['ID Projeto'], ['outro-id'], ['mais-outro']]);
    vi.stubGlobal('fetch', fetchMock);

    const achou = await update('p1', { Status: 'Pendente' });

    expect(achou).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('batchUpdate'))).toBe(false);
  });

  it('NÃO faz leitura adicional do Sheets — no máximo 2 leituras (cabeçalho + coluna do ID)', async () => {
    for (const idColumn of [
      [['ID Projeto'], ['p1']],
      [['ID Projeto'], ['outro-id']],
    ]) {
      vi.restoreAllMocks();
      const fetchMock = makeFetchMock(idColumn);
      vi.stubGlobal('fetch', fetchMock);

      await update('p1', { Status: 'Pendente' });

      const leituras = fetchMock.mock.calls.filter(
        (c) => (((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET'),
      );
      expect(leituras.length).toBeLessThanOrEqual(2);
    }
  });
});
