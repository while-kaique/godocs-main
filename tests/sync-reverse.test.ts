// Sync reverso Sheets → SQLite. DB real (better-sqlite3 in-memory, igual ao
// adapter async do Godeploy); só a LEITURA da planilha é mockada (rede).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

// Mock só readAllRows — o resto (DB) é real.
vi.mock('@/lib/google/sheets', () => ({ readAllRows: vi.fn() }));

import { readAllRows } from '@/lib/google/sheets';
import { setDb, getProjetoById, insertProjetoRaw } from '@/integrations/db/client.server';
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

  it('"Especial? = Não" no Sheet desmarca o flag, deriva tipos e limpa contexto (anti-especial-sticky)', async () => {
    // Caso AVD Central v2 (Helen): SQLite ficou preso em especial=1 após uma
    // edição especial→saving feita antes do fix; o Sheet (fonte da verdade) já
    // diz "Não". O sync reverso deve reconciliar: especial=0, tipos=['saving'],
    // contexto_especial=null (mesmo o Sheet trazendo "—", que o loop SAFE pula).
    await insertProjetoRaw({
      id: 'esp-flip',
      nome: 'AVD Central v2',
      responsavel_nome: 'Helen',
      responsavel_email: 'helen@gocase.com',
      ferramenta: 'Claude',
      status: 'em_validacao',
      especial: true,
      contexto_especial: 'Contexto antigo de projeto especial',
      tipo_projeto: 'especial',
      tipos_projeto: ['especial'],
      updated_at: new Date().toISOString(), // recente: não é tocado pela reconciliação
    });
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'ESP-FLIP',
        'Nome Completo': 'Helen',
        Email: 'helen@gocase.com',
        Projeto: 'AVD Central v2',
        Ferramenta: 'Claude',
        'Especial?': 'Não',
        'Tipos Projeto': 'saving',
        'Contexto do Projeto Especial': '—',
      },
    ]);
    const r = await syncSheetsToSqlite();
    expect(r.atualizados).toBe(1);

    const p = await getProjetoById('esp-flip');
    expect(p?.especial).toBe(0);
    expect(p?.contexto_especial).toBeNull();
    expect(p?.tipo_projeto).toBe('saving');
    expect(JSON.parse(p!.tipos_projeto as string)).toEqual(['saving']);
  });

  it('"Especial?" vazia no Sheet NÃO mexe no flag especial (vazio não apaga)', async () => {
    await insertProjetoRaw({
      id: 'esp-keep',
      nome: 'Projeto Especial',
      responsavel_nome: 'Alguém',
      responsavel_email: 'alguem@gocase.com',
      ferramenta: 'Claude',
      status: 'em_validacao',
      especial: true,
      contexto_especial: 'mantém este contexto',
      tipo_projeto: 'especial',
      tipos_projeto: ['especial'],
      updated_at: new Date().toISOString(),
    });
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'ESP-KEEP',
        'Nome Completo': 'Alguém',
        Email: 'alguem@gocase.com',
        Projeto: 'Projeto Especial',
        Ferramenta: 'Claude',
        // sem "Especial?" → não deve forçar especial=0
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('esp-keep');
    expect(p?.especial).toBe(1);
    expect(p?.contexto_especial).toBe('mantém este contexto');
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

describe('reconciliação de EXCLUSÃO (Sheets é a fonte da verdade do que aparece)', () => {
  // Reusa o mesmo DB module-global dos blocos acima. IDs DEL-*/FRESH-*/REASSIGNED
  // não colidem com LEGADO-*/OWN-*. Carimbos são gravados em minúsculo p/ casar com
  // getProjetoById (match case-sensitive), como os ids reais do app.
  const ANTIGO = '2020-01-01T00:00:00.000Z';
  const agoraIso = () => new Date().toISOString();

  async function semear(id: string, status: string, submitted_at: string, updated_at: string) {
    await insertProjetoRaw({
      id,
      responsavel_nome: 'Teste',
      responsavel_email: 'recon@gocase.com',
      ferramenta: 'n8n',
      status,
      submitted_at,
      updated_at,
    });
  }

  // Linha de planilha presente, só para a leitura não vir vazia (passa a guarda).
  const LINHA_PRESENTE = {
    'ID Projeto': 'LEGADO-999',
    'Nome Completo': 'Fulano',
    Email: 'novodono@gocase.com',
    Projeto: 'Projeto Legado X',
    Ferramenta: 'n8n',
  };

  it('remove submetido ausente da planilha (cascata); mantém rascunho e submissão recente', async () => {
    await semear('del-old', 'em_validacao', ANTIGO, ANTIGO); // submetido antigo, sumiu do Sheets
    await semear('draft-old', 'rascunho', ANTIGO, ANTIGO); // rascunho: SQLite é a fonte → protegido
    await semear('fresh-submit', 'em_validacao', agoraIso(), agoraIso()); // recém-submetido → carência

    mockedRead.mockResolvedValue([LINHA_PRESENTE]);
    const r = await syncSheetsToSqlite();

    expect(await getProjetoById('del-old')).toBeFalsy(); // removido (ausente do Sheets)
    expect(await getProjetoById('draft-old')).toBeTruthy(); // rascunho intocado
    expect(await getProjetoById('fresh-submit')).toBeTruthy(); // carência protege o append em curso
    expect(r.removidos).toBeGreaterThanOrEqual(1);
  });

  it('planilha sem IDs válidos NÃO apaga nada (guarda contra leitura suspeita)', async () => {
    await semear('del-old-2', 'em_validacao', ANTIGO, ANTIGO);
    mockedRead.mockResolvedValue([{ 'Nome Completo': 'Sem ID' }]); // nenhuma linha com ID
    const r = await syncSheetsToSqlite();
    expect(await getProjetoById('del-old-2')).toBeTruthy(); // guarda: planilha vazia não remove
    expect(r.removidos).toBe(0);
  });

  it('syncOwnerRowsFromSheet remove projeto do dono que sumiu da planilha', async () => {
    await insertProjetoRaw({
      id: 'own-del',
      responsavel_nome: 'Dono',
      responsavel_email: 'dono@gocase.com',
      ferramenta: 'n8n',
      status: 'em_validacao',
      submitted_at: ANTIGO,
      updated_at: ANTIGO,
    });
    // Planilha tem outra linha do dono (own-1), mas NÃO own-del.
    mockedRead.mockResolvedValue([
      { 'ID Projeto': 'OWN-1', 'Nome Completo': 'Dono', Email: 'dono@gocase.com', Projeto: 'P', Ferramenta: 'n8n' },
    ]);
    const r = await syncOwnerRowsFromSheet('dono@gocase.com');
    expect(await getProjetoById('own-del')).toBeFalsy();
    expect(r.removidos).toBeGreaterThanOrEqual(1);
  });

  it('projeto que apenas trocou de dono na planilha NÃO é apagado (usa ids do Sheet inteiro)', async () => {
    await insertProjetoRaw({
      id: 'reassigned',
      responsavel_nome: 'Old',
      responsavel_email: 'oldowner@gocase.com',
      ferramenta: 'n8n',
      status: 'em_validacao',
      submitted_at: ANTIGO,
      updated_at: ANTIGO,
    });
    // Na planilha o projeto AINDA existe, só que agora pertence a outra pessoa.
    mockedRead.mockResolvedValue([
      { 'ID Projeto': 'REASSIGNED', 'Nome Completo': 'New', Email: 'newowner@gocase.com', Projeto: 'P', Ferramenta: 'n8n' },
    ]);
    const r = await syncOwnerRowsFromSheet('oldowner@gocase.com');
    expect(await getProjetoById('reassigned')).toBeTruthy(); // existe no Sheet (outro dono) → mantido
    expect(r.removidos).toBe(0);
  });

  it('remove órfão com submitted_at pt-BR (dd/mm) — não confunde com data futura', async () => {
    // submitted_at "12/05/2026" = 12 de MAIO (pt-BR). O Date.parse antigo lia como
    // MM/DD → 5 de dezembro de 2026 (FUTURO) → carência eterna → órfão nunca saía
    // (status cinza permanente). Com a janela em 30/06/2026, 12 de maio é passado →
    // deve ser removido. (caso legado-148 / Helen)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'));
    try {
      await semear('del-ptbr', 'em_validacao', '12/05/2026', '12/05/2026');
      mockedRead.mockResolvedValue([LINHA_PRESENTE]);
      const r = await syncSheetsToSqlite();
      expect(await getProjetoById('del-ptbr')).toBeFalsy(); // removido (passado, ausente do Sheet)
      expect(r.removidos).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
