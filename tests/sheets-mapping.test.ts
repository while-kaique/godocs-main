// Mapeamento de colunas do Google Sheets POR NOME (robusto a reordenação manual).
// Mocka auth (token) e fetch (rede). Cobre a regressão da linha 268: colunas
// movidas na planilha faziam o append/leitura posicional gravar/ler deslocado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/auth', () => ({ getAccessToken: vi.fn().mockResolvedValue('tok-123') }));

import {
  orderValuesByHeaders,
  appendRow,
  updateRowByProjectId,
  readAllRows,
  colLetter,
} from '@/lib/google/sheets';
import { custoEvitadoRecorrenciaLabel } from '@/lib/google/sync';

const okResp = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

// Layout "real" reordenado (espelha a planilha após o remanejamento manual):
// Horas em Reais / Custo Evitado / Justificativa / Custo Mensal ou Pontual ficam
// ANTES de Saving Reais / Tipo de Saving / Memorial.
const LIVE_HEADERS = [
  'ID Projeto',
  'Saving Horas',
  'Horas em Reais',
  'Custo Evitado',
  'Justificativa Custo Evitado',
  'Custo Mensal ou Pontual',
  'Saving Reais',
  'Tipo de Saving',
  'Memorial de Saving',
  'Status',
  'Observações',
  'Atualizado Em',
];

describe('orderValuesByHeaders (puro)', () => {
  it('alinha valores pela ORDEM do cabeçalho real, não pela ordem de inserção', () => {
    const values = {
      'Saving Reais': 420,
      'ID Projeto': 'p1',
      'Custo Evitado': 150,
      'Saving Horas': 10,
      'Horas em Reais': 300,
    };
    const row = orderValuesByHeaders(LIVE_HEADERS, values);
    expect(row[LIVE_HEADERS.indexOf('Custo Evitado')]).toBe(150);
    expect(row[LIVE_HEADERS.indexOf('Saving Reais')]).toBe(420);
    expect(row[LIVE_HEADERS.indexOf('Horas em Reais')]).toBe(300);
    expect(row[LIVE_HEADERS.indexOf('Memorial de Saving')]).toBe('');
  });
});

describe('custoEvitadoRecorrenciaLabel (puro)', () => {
  it('"—" quando a pessoa não marcou custo evitado', () => {
    expect(custoEvitadoRecorrenciaLabel('nao', null)).toBe('—');
    expect(custoEvitadoRecorrenciaLabel(null, '[]')).toBe('—');
  });
  it('reflete a recorrência marcada (mensal/pontual)', () => {
    expect(custoEvitadoRecorrenciaLabel('sim', JSON.stringify([{ recorrencia: 'mensal' }]))).toBe('Mensal');
    expect(custoEvitadoRecorrenciaLabel('sim', JSON.stringify([{ recorrencia: 'pontual' }]))).toBe('Pontual');
  });
  it('"Misto" quando há itens com recorrências diferentes', () => {
    const itens = JSON.stringify([{ recorrencia: 'mensal' }, { recorrencia: 'pontual' }]);
    expect(custoEvitadoRecorrenciaLabel('sim', itens)).toBe('Misto');
  });
  it('JSON inválido não quebra', () => {
    expect(custoEvitadoRecorrenciaLabel('sim', 'not-json')).toBe('—');
  });
});

// Dispatcher de fetch: 1:1 (header) → headers; GET → coluna do ID; append/batch → ok.
function makeFetchMock(idColumnValues: string[][]) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && u.includes(':append')) return okResp({});
    if (method === 'POST' && u.includes('batchUpdate')) return okResp({});
    if (u.includes('1%3A1')) return okResp({ values: [LIVE_HEADERS] });
    return okResp({ values: idColumnValues }); // leitura da coluna do ID
  });
}

describe('appendRow (por nome)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('grava cada valor na coluna certa MESMO com o cabeçalho reordenado', async () => {
    const fetchMock = makeFetchMock([]);
    vi.stubGlobal('fetch', fetchMock);

    await appendRow({
      'ID Projeto': 'p1',
      'Saving Horas': 10,
      'Horas em Reais': 300,
      'Custo Evitado': 150,
      'Custo Mensal ou Pontual': 'Mensal',
      'Saving Reais': 420,
      'Tipo de Saving': 'mensal',
      'Status': 'Pendente',
    });

    const appendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes(':append'))!;
    const body = JSON.parse((appendCall[1] as RequestInit).body as string);
    const row = body.values[0] as (string | number)[];

    expect(row[LIVE_HEADERS.indexOf('Custo Evitado')]).toBe(150);
    expect(row[LIVE_HEADERS.indexOf('Saving Reais')]).toBe(420);
    expect(row[LIVE_HEADERS.indexOf('Tipo de Saving')]).toBe('mensal');
    expect(row[LIVE_HEADERS.indexOf('Horas em Reais')]).toBe(300);
    expect(String(appendCall[0])).toContain(`A%3A${colLetter(LIVE_HEADERS.length - 1)}`);
  });
});

describe('updateRowByProjectId (por nome)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('resolve as letras das colunas pelo cabeçalho real e atualiza a linha do ID', async () => {
    const idColumn = [['ID Projeto'], ['outro-id'], ['p1']];
    const fetchMock = makeFetchMock(idColumn);
    vi.stubGlobal('fetch', fetchMock);

    await updateRowByProjectId('p1', { Status: 'Pendente', Observações: 'parecer' });

    const batchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('batchUpdate'))!;
    const body = JSON.parse((batchCall[1] as RequestInit).body as string);
    const ranges = (body.data as { range: string }[]).map((d) => d.range);

    const statusCol = colLetter(LIVE_HEADERS.indexOf('Status'));
    const obsCol = colLetter(LIVE_HEADERS.indexOf('Observações'));
    expect(ranges).toContain(`'GoDocs'!${statusCol}3`);
    expect(ranges).toContain(`'GoDocs'!${obsCol}3`);
  });
});

describe('readAllRows (por nome)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaveia cada célula pelo NOME real do cabeçalho (não pela posição antiga)', async () => {
    // Linha de dados alinhada ao LIVE_HEADERS reordenado.
    const dataRow = ['p1', '10', '300', '150', 'Notion (R$ 150, mensal)', 'Mensal', '420', 'mensal', 'memo', 'Pendente', 'obs', '01/01/2026'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResp({ values: [LIVE_HEADERS, dataRow] })));

    const rows = await readAllRows();
    expect(rows).toHaveLength(1);
    // "Saving Reais" deve ler 420 (coluna real T), não 300 (Horas em Reais, posição antiga P)
    expect(rows[0]['Saving Reais']).toBe('420');
    expect(rows[0]['Tipo de Saving']).toBe('mensal');
    expect(rows[0]['Custo Evitado']).toBe('150');
  });
});
