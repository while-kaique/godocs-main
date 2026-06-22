// Sync reverso Sheets → SQLite. DB real (better-sqlite3 in-memory, igual ao
// adapter async do Godeploy); só a LEITURA da planilha é mockada (rede).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

// Mock só readAllRows — o resto (DB) é real.
vi.mock('@/lib/google/sheets', () => ({ readAllRows: vi.fn() }));

import { readAllRows } from '@/lib/google/sheets';
import { setDb, getProjetoById } from '@/integrations/db/client.server';
import { syncSheetsToSqlite, syncOwnerRowsFromSheet } from '@/lib/google/sync-reverse';

const mockedRead = readAllRows as unknown as ReturnType<typeof vi.fn>;

function asyncAdapter(db: BetterSqlite3.Database): GoDeployDB {
  return {
    async query(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])), rowsRead: rows.length };
    },
    async exec(sql: string, params: unknown[] = []) {
      if (params.length > 0) {
        const r = db.prepare(sql).run(...params);
        return { rowsWritten: r.changes };
      }
      db.exec(sql);
      return { rowsWritten: 0 };
    },
  };
}

describe('syncSheetsToSqlite (Sheets → SQLite)', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  it('cria legado que só existe na planilha (parsing pt-BR, status, membros)', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-999',
        'Nome Completo': 'Fulano de Tal',
        Email: 'fulano@gocase.com',
        Projeto: 'Projeto Legado X',
        Ferramenta: 'n8n',
        Status: 'Aprovado',
        'Saving Horas': '30',
        'Saving Reais': '418,2',
        'Custo Externo Mensal': 'R$ 1.234,56',
        'Tipos Projeto': 'saving',
        Participantes: 'a@gocase.com, b@gocase.com',
        'Memorial de Saving': '30h × R$13,94 = R$418,20',
      },
    ]);

    const r = await syncSheetsToSqlite();
    expect(r.criados).toBe(1);
    expect(r.atualizados).toBe(0);

    const p = await getProjetoById('legado-999'); // id normalizado p/ minúsculo
    expect(p?.responsavel_email).toBe('fulano@gocase.com');
    expect(p?.nome).toBe('Projeto Legado X');
    expect(p?.status).toBe('aprovado');
    expect(p?.saving_horas).toBe(30);
    expect(p?.saving_reais).toBeCloseTo(418.2, 2);
    expect(p?.custo_externo_mensal).toBeCloseTo(1234.56, 2);
    expect(JSON.parse(p!.membros as string)).toEqual(['a@gocase.com', 'b@gocase.com']);
  });

  it('ignora quando nada mudou (idempotente)', async () => {
    // Mesmo conteúdo da criação anterior.
    const r = await syncSheetsToSqlite();
    expect(r.criados).toBe(0);
    expect(r.atualizados).toBe(0);
    expect(r.ignorados).toBe(1);
  });

  it('atualiza campo seguro editado manualmente na planilha', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-999',
        'Nome Completo': 'Fulano de Tal',
        Email: 'fulano@gocase.com',
        Projeto: 'Projeto Legado X',
        Ferramenta: 'n8n',
        Status: 'Aprovado',
        Observações: 'Parecer revisado manualmente.',
        'Saving Reais': '500',
      },
    ]);
    const r = await syncSheetsToSqlite();
    expect(r.atualizados).toBe(1);

    const p = await getProjetoById('legado-999');
    expect(p?.observacoes).toBe('Parecer revisado manualmente.');
    expect(p?.saving_reais).toBe(500);
  });

  it('NÃO sobrescreve status existente (regra TEMPORÁRIA "Pendente")', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-999',
        'Nome Completo': 'Fulano de Tal',
        Email: 'fulano@gocase.com',
        Projeto: 'Projeto Legado X',
        Ferramenta: 'n8n',
        Status: 'Pendente', // planilha rebaixaria, mas não deve tocar o status interno
        Observações: 'Parecer revisado manualmente.',
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('legado-999');
    expect(p?.status).toBe('aprovado'); // permanece o status interno correto
  });

  it('célula vazia não apaga dado existente', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-999',
        'Nome Completo': 'Fulano de Tal',
        Email: 'fulano@gocase.com',
        Projeto: 'Projeto Legado X',
        Ferramenta: 'n8n',
        // sem Observações → não deve zerar o que já existe
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('legado-999');
    expect(p?.observacoes).toBe('Parecer revisado manualmente.');
  });

  it('SINCRONIZA ownership do Sheets (Email→dono, Nome→responsável, Participantes→membros)', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-999',
        'Nome Completo': 'Novo Dono',
        Email: 'novodono@gocase.com',
        Projeto: 'Projeto Legado X',
        Ferramenta: 'n8n',
        Participantes: 'c@gocase.com, d@gocase.com',
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('legado-999');
    expect(p?.responsavel_email).toBe('novodono@gocase.com');
    expect(p?.responsavel_nome).toBe('Novo Dono');
    expect(JSON.parse(p!.membros as string)).toEqual(['c@gocase.com', 'd@gocase.com']);
  });

  it('Participantes vazio NÃO apaga membros existentes (vazio não apaga)', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-999',
        'Nome Completo': 'Novo Dono',
        Email: 'novodono@gocase.com',
        Projeto: 'Projeto Legado X',
        Ferramenta: 'n8n',
        // sem Participantes → mantém [c, d]
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('legado-999');
    expect(JSON.parse(p!.membros as string)).toEqual(['c@gocase.com', 'd@gocase.com']);
  });

  it('mapeia "Reenvio Pendente" → rejeitado e ponto decimal "10.5"', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-1000',
        'Nome Completo': 'Ciclano',
        Email: 'ciclano@gocase.com',
        Projeto: 'Outro Legado',
        Ferramenta: 'python',
        Status: 'Reenvio Pendente',
        'Saving Horas': '10.5',
      },
    ]);
    const r = await syncSheetsToSqlite();
    expect(r.criados).toBe(1);
    const p = await getProjetoById('legado-1000');
    expect(p?.status).toBe('rejeitado');
    expect(p?.saving_horas).toBeCloseTo(10.5, 2);
  });

  it('linha sem ID Projeto é ignorada', async () => {
    mockedRead.mockResolvedValue([{ 'Nome Completo': 'Sem ID', Email: 'x@gocase.com' }]);
    const r = await syncSheetsToSqlite();
    expect(r.total).toBe(0);
    expect(r.criados).toBe(0);
  });

  it('falha de leitura da planilha não propaga (retorna erro contabilizado)', async () => {
    mockedRead.mockRejectedValueOnce(new Error('429 rate limit'));
    const r = await syncSheetsToSqlite();
    expect(r.erros).toBe(1);
    expect(r.detalhes[0]).toContain('429');
  });
});

describe('syncOwnerRowsFromSheet (sync sob demanda por dono)', () => {
  // Reusa o DB (com schema) já configurado pelo describe anterior — o
  // _schemaReady é module-global, então um db novo aqui ficaria sem tabelas.
  // IDs OWN-*/OUTRO-* não colidem com os LEGADO-* do bloco acima.

  it('cria só as linhas onde o usuário é responsável (Email) — case-insensitive', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'OWN-1',
        'Nome Completo': 'Dono',
        Email: 'Dono@Gocase.com', // caixa diferente do login → deve casar
        Projeto: 'Projeto do Dono',
        Ferramenta: 'n8n',
        Status: 'Aprovado',
      },
      {
        'ID Projeto': 'OUTRO-1',
        'Nome Completo': 'Alheio',
        Email: 'alheio@gocase.com',
        Projeto: 'Projeto Alheio',
        Ferramenta: 'python',
        Status: 'Aprovado',
      },
    ]);

    const r = await syncOwnerRowsFromSheet('dono@gocase.com');
    expect(r.criados).toBe(1);
    expect(r.total).toBe(1);

    expect((await getProjetoById('own-1'))?.nome).toBe('Projeto do Dono');
    expect(await getProjetoById('outro-1')).toBeFalsy(); // alheio NÃO foi importado
  });

  it('casa também quando o usuário é participante (col Participantes)', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'OWN-2',
        'Nome Completo': 'Responsável',
        Email: 'chefe@gocase.com',
        Participantes: 'membro@gocase.com, outro@gocase.com',
        Projeto: 'Projeto em Equipe',
        Ferramenta: 'n8n',
        Status: 'Pendente',
      },
    ]);

    const r = await syncOwnerRowsFromSheet('membro@gocase.com');
    expect(r.criados).toBe(1);
    expect((await getProjetoById('own-2'))?.nome).toBe('Projeto em Equipe');
  });

  it('atualiza campo seguro de um projeto já existente do dono', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'OWN-1',
        'Nome Completo': 'Dono',
        Email: 'dono@gocase.com',
        Projeto: 'Projeto do Dono — renomeado',
        Ferramenta: 'n8n',
        Status: 'Aprovado',
      },
    ]);
    const r = await syncOwnerRowsFromSheet('dono@gocase.com');
    expect(r.atualizados).toBe(1);
    expect((await getProjetoById('own-1'))?.nome).toBe('Projeto do Dono — renomeado');
  });

  it('email vazio não faz nada', async () => {
    const r = await syncOwnerRowsFromSheet('');
    expect(r.total).toBe(0);
  });

  it('falha de leitura não propaga', async () => {
    mockedRead.mockRejectedValueOnce(new Error('500 boom'));
    const r = await syncOwnerRowsFromSheet('dono@gocase.com');
    expect(r.erros).toBe(1);
  });
});
