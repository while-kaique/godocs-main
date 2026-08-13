// Sync reverso Sheets → SQLite. DB real (better-sqlite3 in-memory, igual ao
// adapter async do Godeploy); só a LEITURA da planilha é mockada (rede).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

// Mock só readAllRows — o resto (DB) é real.
vi.mock('@/lib/google/sheets', () => ({ readAllRows: vi.fn() }));

import { readAllRows } from '@/lib/google/sheets';
import {
  setDb,
  getProjetoById,
  insertProjetoRaw,
  abrirAprovacoesPendentes,
  getAprovacoesDoProjeto,
} from '@/integrations/db/client.server';
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

  it('distribui participantes por papel nas 3 colunas (membros = união + membros_papeis)', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-PAPEIS',
        'Nome Completo': 'Dona',
        Email: 'dona@gocase.com',
        Projeto: 'Projeto com Papéis',
        Ferramenta: 'n8n',
        Participantes: 'coex@gocase.com', // coexecutor/"Coautor" (coluna retrocompatível)
        'Participantes 2': 'plan@gocase.com', // planejador/"Participante" (ex-"Planejador")
        Contribuidor: 'contrib@gocase.com, contrib2@gocase.com',
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('legado-papeis');
    expect((JSON.parse(p!.membros as string) as string[]).sort()).toEqual(
      ['coex@gocase.com', 'contrib2@gocase.com', 'contrib@gocase.com', 'plan@gocase.com'],
    );
    expect(JSON.parse(p!.membros_papeis as string)).toEqual({
      'coex@gocase.com': 'coexecutor',
      'plan@gocase.com': 'planejador',
      'contrib@gocase.com': 'contribuidor',
      'contrib2@gocase.com': 'contribuidor',
    });
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
    // ⚠️ `mockRejectedValue` (todas as tentativas), não `…Once`: desde 11/08/2026 a leitura
    // tem RETRY — falhar uma vez agora RECUPERA na 2ª (é o ponto do retry: com as telas
    // lendo o espelho, uma leitura perdida deixaria todo mundo com dado velho por um ciclo).
    mockedRead.mockRejectedValue(new Error('429 rate limit'));
    const r = await syncSheetsToSqlite();
    expect(r.erros).toBe(1);
    expect(r.detalhes[0]).toContain('429');
    expect(r.ok).toBe(false);
    mockedRead.mockReset();
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

  it('"Especial? = Sim" no Sheet NÃO re-força especial quando o SQLite já converteu p/ saving (anti-clobber da conversão in-app)', async () => {
    // Caso Hugo (legado-038): o usuário editou um legado especial → saving no app.
    // atualizarTipos zerou especial e gravou tipos=['saving'] no SQLite; mas a célula
    // "Especial?" da planilha só vira "Não" no SUBMIT. Se este cron rodar ANTES do
    // submit, a "Sim" (stale) NÃO pode re-forçar especial=1 — isso atropelava a
    // conversão em andamento (reconstruía a doc especial e apagava o saving).
    await insertProjetoRaw({
      id: 'legado-conv',
      nome: 'Base Custos',
      responsavel_nome: 'Hugo',
      responsavel_email: 'hugo@gobeaute.com.br',
      ferramenta: 'n8n',
      status: 'em_validacao',
      especial: false, // já convertido no app
      contexto_especial: null,
      tipo_projeto: 'saving',
      tipos_projeto: ['saving'],
      updated_at: new Date().toISOString(),
    });
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'LEGADO-CONV',
        'Nome Completo': 'Hugo',
        Email: 'hugo@gobeaute.com.br',
        Projeto: 'Base Custos',
        Ferramenta: 'n8n',
        'Especial?': 'Sim', // planilha ainda diz "Sim" (só vira "Não" no submit)
        'Tipos Projeto': 'especial',
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('legado-conv');
    expect(p?.especial).toBe(0); // NÃO re-forçado
    expect(JSON.parse(p!.tipos_projeto as string)).toEqual(['saving']); // conversão preservada
  });

  it('"Especial? = Sim" AINDA re-força especial quando o SQLite NÃO é financeiro (guard é estreito)', async () => {
    // Prova que o anti-clobber só protege conversões financeiras: um SQLite não-especial
    // por deriva (especial=0 mas tipos=['especial']) volta a ser especial pela planilha.
    await insertProjetoRaw({
      id: 'esp-drift',
      nome: 'Projeto Deriva',
      responsavel_nome: 'Alguém',
      responsavel_email: 'drift@gocase.com',
      ferramenta: 'Claude',
      status: 'em_validacao',
      especial: false,
      contexto_especial: null,
      tipo_projeto: 'especial',
      tipos_projeto: ['especial'], // não-financeiro → guard não protege
      updated_at: new Date().toISOString(),
    });
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'ESP-DRIFT',
        'Nome Completo': 'Alguém',
        Email: 'drift@gocase.com',
        Projeto: 'Projeto Deriva',
        Ferramenta: 'Claude',
        'Especial?': 'Sim',
      },
    ]);
    await syncSheetsToSqlite();
    const p = await getProjetoById('esp-drift');
    expect(p?.especial).toBe(1); // re-forçado (sentido Sim → especial intacto)
    expect(JSON.parse(p!.tipos_projeto as string)).toEqual(['especial']);
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
    // Idem: a leitura tem retry, então a falha precisa valer para todas as tentativas.
    mockedRead.mockRejectedValue(new Error('500 boom'));
    const r = await syncOwnerRowsFromSheet('dono@gocase.com');
    expect(r.erros).toBe(1);
    mockedRead.mockReset();
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

describe('reconhecimento de "Descontinuado" (Sheets → SQLite)', () => {
  // Reusa o DB module-global. IDs DESC-* não colidem com os blocos acima.

  it('cria legado marcado "Descontinuado" com a flag ligada', async () => {
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'DESC-1',
        'Nome Completo': 'Dona',
        Email: 'desc@gocase.com',
        Projeto: 'Projeto Descontinuado',
        Ferramenta: 'n8n',
        Status: 'Descontinuado',
      },
    ]);
    const r = await syncSheetsToSqlite();
    expect(r.criados).toBeGreaterThanOrEqual(1);
    expect((await getProjetoById('desc-1'))?.descontinuado).toBe(1);
  });

  it('promove projeto ativo a descontinuado quando a planilha marca "Descontinuado" (mão única)', async () => {
    await insertProjetoRaw({
      id: 'desc-promote',
      nome: 'Ativo',
      responsavel_nome: 'Alguém',
      responsavel_email: 'promote@gocase.com',
      ferramenta: 'n8n',
      status: 'em_validacao',
      descontinuado: 0,
      updated_at: new Date().toISOString(),
    });
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'DESC-PROMOTE',
        'Nome Completo': 'Alguém',
        Email: 'promote@gocase.com',
        Projeto: 'Ativo',
        Ferramenta: 'n8n',
        Status: 'Descontinuado',
      },
    ]);
    const r = await syncSheetsToSqlite();
    expect(r.atualizados).toBeGreaterThanOrEqual(1);
    expect((await getProjetoById('desc-promote'))?.descontinuado).toBe(1);
  });

  it('NÃO reativa pela planilha — Status "Pendente" (IDA sempre grava isso) mantém a flag', async () => {
    // Reativar é ação do app (limpa a flag). Como a IDA grava sempre "Pendente" (regra
    // TEMPORÁRIA), "Pendente" é ambíguo e não pode desmarcar um descontinuado.
    await insertProjetoRaw({
      id: 'desc-keep',
      nome: 'Descontinuado',
      responsavel_nome: 'Alguém',
      responsavel_email: 'keepdesc@gocase.com',
      ferramenta: 'n8n',
      status: 'em_validacao',
      descontinuado: 1,
      updated_at: new Date().toISOString(),
    });
    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'DESC-KEEP',
        'Nome Completo': 'Alguém',
        Email: 'keepdesc@gocase.com',
        Projeto: 'Descontinuado',
        Ferramenta: 'n8n',
        Status: 'Pendente',
      },
    ]);
    await syncSheetsToSqlite();
    expect((await getProjetoById('desc-keep'))?.descontinuado).toBe(1);
  });
});

// Critério de aceitação 6 do plano da pré-aprovação do líder: a decisão do líder é
// AUTORIZAÇÃO, e a planilha é só espelho dela. Digitar o veredito na célula à mão não
// pode virar pré-aprovação no app — por isso `Aprovação do Líder` /
// `Justificativa Aprovação do Líder` ficam FORA de `SAFE_UPDATE_FIELDS` e a tabela
// `projeto_aprovacoes` é interna (o sync reverso não a conhece).
describe('pré-aprovação do líder NÃO volta da planilha (autorização, não dado)', () => {
  it('digitar "Pré-aprovado" na célula deixa a fila pendente e o projeto intocado', async () => {
    await insertProjetoRaw({
      id: 'aprov-manual',
      nome: 'Projeto com fila aberta',
      responsavel_nome: 'Liderado',
      responsavel_email: 'liderado@gocase.com',
      ferramenta: 'n8n',
      status: 'em_validacao',
      updated_at: new Date().toISOString(),
    });
    await abrirAprovacoesPendentes('aprov-manual', 1, 'liderado@gocase.com', [
      { email: 'lider@gocase.com', nome: 'Líder' },
    ]);

    mockedRead.mockResolvedValue([
      {
        'ID Projeto': 'APROV-MANUAL',
        'Nome Completo': 'Liderado',
        Email: 'liderado@gocase.com',
        Projeto: 'Projeto com fila aberta',
        Ferramenta: 'n8n',
        Status: 'Pendente',
        // Alguém "aprovando" na mão, direto na planilha.
        'Aprovação do Líder': 'Pré-aprovado',
        'Justificativa Aprovação do Líder': 'Aprovado por mim mesmo',
      },
    ]);

    await syncSheetsToSqlite();

    const linhas = await getAprovacoesDoProjeto('aprov-manual');
    expect(linhas).toHaveLength(1);
    expect(linhas[0].veredito).toBe('pendente');
    expect(linhas[0].decidido_por).toBeNull();
    expect(linhas[0].decidido_em).toBeNull();
    // E nenhuma coluna do projeto virou depósito do texto do veredito.
    const p = await getProjetoById('aprov-manual');
    expect(JSON.stringify(p)).not.toContain('Aprovado por mim mesmo');
    expect(JSON.stringify(p)).not.toContain('Pré-aprovado');
  });
});

// ─── Robustez da corrida (fatia "SQLite como fonte de leitura", 11/08/2026) ────
//
// Com as TELAS lendo o espelho, uma leitura perdida deixa todo mundo vendo dado velho até a
// próxima corrida — daí o retry — e o "sync morreu em silêncio" precisa ficar registrado.
describe('leitura da planilha com retry + registro da corrida', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    const { initSchema } = await import('@/integrations/db/schema');
    const adapter = asyncAdapter(db);
    await initSchema(adapter);
    await setDb(adapter);
  });

  beforeEach(() => {
    mockedRead.mockReset();
  });

  it('falha transiente na 1ª tentativa e sucesso na 2ª → a corrida termina OK', async () => {
    mockedRead
      .mockRejectedValueOnce(new Error('429 quota exceeded'))
      .mockResolvedValueOnce([
        {
          'ID Projeto': 'RETRY-1',
          Projeto: 'Projeto do retry',
          'Nome Completo': 'Alguém',
          Email: 'alguem@gocase.com',
          Ferramenta: 'n8n',
          Status: 'Pendente',
        },
      ]);

    const r = await syncSheetsToSqlite('cron');
    expect(r.ok).toBe(true);
    expect(mockedRead).toHaveBeenCalledTimes(2);
    expect(r.espelhados).toBe(1);
    const { getUltimaSyncRunOk } = await import('@/integrations/db/client.server');
    expect((await getUltimaSyncRunOk())?.gatilho).toBe('cron');
  });

  it('todas as tentativas falham → ok=false, nada removido e a falha REGISTRADA', async () => {
    mockedRead.mockRejectedValue(new Error('503 Service Unavailable'));

    const r = await syncSheetsToSqlite('cron');
    expect(r.ok).toBe(false);
    expect(r.removidos).toBe(0);
    expect(mockedRead).toHaveBeenCalledTimes(3);

    const { getUltimaSyncRun } = await import('@/integrations/db/client.server');
    const run = await getUltimaSyncRun();
    expect(run?.ok).toBe(0);
    expect(run?.detalhe).toContain('503');
  });

  it('a corrida NÃO consulta o banco projeto por projeto (sem N+1 na listagem de linhas)', async () => {
    const { getDb } = await import('@/integrations/db/client.server');
    const real = getDb();
    let selectsPorId = 0;
    await setDb({
      query: async (sql: string, params: unknown[] = []) => {
        // O padrão do N+1 antigo era um SELECT * FROM projetos WHERE id = ? por linha.
        if (/FROM projetos\s+WHERE id = \?/i.test(sql)) selectsPorId++;
        return real.query(sql, params);
      },
      exec: async (sql: string, params: unknown[] = []) => real.exec(sql, params),
    });

    mockedRead.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        'ID Projeto': `LOTE-${i}`,
        Projeto: `Projeto ${i}`,
        'Nome Completo': 'Alguém',
        Email: 'alguem@gocase.com',
        Ferramenta: 'n8n',
        Status: 'Pendente',
      })),
    );
    await syncSheetsToSqlite('cron'); // 1ª: cria os 12 legados
    selectsPorId = 0;
    await syncSheetsToSqlite('cron'); // 2ª: só diff — é aqui que o N+1 aparecia
    expect(selectsPorId).toBe(0);

    await setDb(real);
  });
});
