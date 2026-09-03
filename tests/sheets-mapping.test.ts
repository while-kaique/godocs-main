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
  chaveColuna,
  chavesForaDoCabecalho,
} from '@/lib/google/sheets';
import { custoEvitadoRecorrenciaLabel } from '@/lib/google/sync';

const okResp = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

// Layout "real" reordenado (espelha a planilha após o remanejamento manual):
// Horas em Reais / Custo Evitado / Justificativa / Custo Mensal ou Pontual ficam
// ANTES de Saving Reais / Tipo de Saving / Memorial.
const LIVE_HEADERS = [
  'ID Projeto',
  'Custo Evitado Horas',
  'Custo Evitado Horas Reais',
  'Saving Efetivado',
  'Evidência Saving Efetivado',
  'Freq. Saving Efetivado',
  'Impacto Bruto',
  'Freq. Custo Evitado',
  'Memorial de Saving',
  'Status',
  'Observações',
  'Atualizado Em',
];

describe('orderValuesByHeaders (puro)', () => {
  it('alinha valores pela ORDEM do cabeçalho real, não pela ordem de inserção', () => {
    const values = {
      'Impacto Bruto': 420,
      'ID Projeto': 'p1',
      'Saving Efetivado': 150,
      'Custo Evitado Horas': 10,
      'Custo Evitado Horas Reais': 300,
    };
    const row = orderValuesByHeaders(LIVE_HEADERS, values);
    expect(row[LIVE_HEADERS.indexOf('Saving Efetivado')]).toBe(150);
    expect(row[LIVE_HEADERS.indexOf('Impacto Bruto')]).toBe(420);
    expect(row[LIVE_HEADERS.indexOf('Custo Evitado Horas Reais')]).toBe(300);
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
      'Custo Evitado Horas': 10,
      'Custo Evitado Horas Reais': 300,
      'Saving Efetivado': 150,
      'Freq. Saving Efetivado': 'Mensal',
      'Impacto Bruto': 420,
      'Freq. Custo Evitado': 'mensal',
      'Status': 'Pendente',
    });

    const appendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes(':append'))!;
    const body = JSON.parse((appendCall[1] as RequestInit).body as string);
    const row = body.values[0] as (string | number)[];

    expect(row[LIVE_HEADERS.indexOf('Saving Efetivado')]).toBe(150);
    expect(row[LIVE_HEADERS.indexOf('Impacto Bruto')]).toBe(420);
    expect(row[LIVE_HEADERS.indexOf('Freq. Custo Evitado')]).toBe('mensal');
    expect(row[LIVE_HEADERS.indexOf('Custo Evitado Horas Reais')]).toBe(300);
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

// Cabeçalho REAL de prod/staging (conferido em 04 e 05/08/2026): a coluna da
// justificativa do líder está SEM ACENTO no "Lider", e o código escreve "Líder".
// Antes do match tolerante, a chave não casava e o valor era descartado com aviso —
// o parecer do gestor não aparecia em lugar nenhum.
const HEADERS_SEM_ACENTO = [
  'ID Projeto',
  'Status',
  'Aprovação do Líder',
  'Justificativa Aprovação do Lider',
];

describe('casamento de coluna tolerante a acento/caixa (05/08/2026)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaveColuna normaliza acento, caixa e espaço — sem confundir nomes distintos', () => {
    expect(chaveColuna('Justificativa Aprovação do Líder')).toBe(
      chaveColuna('  justificativa aprovacao do  LIDER '),
    );
    expect(chaveColuna('Coautor')).not.toBe(chaveColuna('Participante'));
  });

  it('update grava na coluna sem acento quando o código manda o nome acentuado', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? 'GET') === 'POST') return okResp({});
      if (u.includes('1%3A1')) return okResp({ values: [HEADERS_SEM_ACENTO] });
      return okResp({ values: [['ID Projeto'], ['p1']] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await updateRowByProjectId('p1', {
      'Aprovação do Líder': 'Pré-aprovado',
      'Justificativa Aprovação do Líder': 'Pré-aprovado por Lucas em 05/08/2026',
    });

    const batch = fetchMock.mock.calls.find((c) => String(c[0]).includes('batchUpdate'))!;
    const body = JSON.parse((batch[1] as RequestInit).body as string);
    const porRange = Object.fromEntries(
      (body.data as { range: string; values: string[][] }[]).map((d) => [d.range, d.values[0][0]]),
    );
    const colJust = colLetter(HEADERS_SEM_ACENTO.indexOf('Justificativa Aprovação do Lider'));
    const colEstado = colLetter(HEADERS_SEM_ACENTO.indexOf('Aprovação do Líder'));
    expect(porRange[`'GoDocs'!${colEstado}2`]).toBe('Pré-aprovado');
    expect(porRange[`'GoDocs'!${colJust}2`]).toBe('Pré-aprovado por Lucas em 05/08/2026');
  });

  it('append também alinha o valor à coluna sem acento', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return okResp({});
      if (String(url).includes('1%3A1')) return okResp({ values: [HEADERS_SEM_ACENTO] });
      return okResp({ values: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await appendRow({ 'ID Projeto': 'p1', 'Justificativa Aprovação do Líder': 'Aguardando Lucas' });

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes(':append'))!;
    const row = JSON.parse((call[1] as RequestInit).body as string).values[0] as string[];
    expect(row[HEADERS_SEM_ACENTO.indexOf('Justificativa Aprovação do Lider')]).toBe(
      'Aguardando Lucas',
    );
  });

  it('coluna que NÃO existe segue ignorada (o aviso não some) e nada casa por acidente', () => {
    expect(chavesForaDoCabecalho(HEADERS_SEM_ACENTO, { 'Motivo Reenvio': 'x' })).toEqual([
      'Motivo Reenvio',
    ]);
    expect(chavesForaDoCabecalho(HEADERS_SEM_ACENTO, { 'Justificativa Aprovação do Líder': 'x' })).toEqual([]);
  });

  it('AMBÍGUO não casa: dois cabeçalhos que normalizam igual só aceitam match exato', () => {
    const headers = ['Área', 'AREA', 'Status'];
    // "Área"/"AREA" normalizam para a mesma chave → o índice tolerante descarta as duas.
    const row = orderValuesByHeaders(headers, { 'área': 'x', Status: 'ok' });
    expect(row).toEqual(['', '', 'ok']);
    // Já o nome EXATO continua funcionando.
    expect(orderValuesByHeaders(headers, { 'AREA': 'y' })[1]).toBe('y');
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
    // "Impacto Bruto" deve ler 420 (coluna real T), não 300 (Horas em Reais, posição antiga P)
    expect(rows[0]['Impacto Bruto']).toBe('420');
    expect(rows[0]['Freq. Custo Evitado']).toBe('mensal');
    expect(rows[0]['Saving Efetivado']).toBe('150');
  });
});
