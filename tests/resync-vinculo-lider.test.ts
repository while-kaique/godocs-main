// Regressão: `resyncGoogle` (reparo administrativo que regrava a linha inteira da
// planilha a partir do banco) não recebeu a disciplina de estágio/undefined dos
// escritores primários, e num projeto-FEATURE (vínculo pai↔filho, aprovação de 2
// líderes em sequência) isso corrompia duas colunas:
//
//  BUG 1 — coluna "Aprovação do Líder" é do ESTÁGIO 1. Quando o estágio 1 é ISENTO
//  (autor é liderança), as ÚNICAS linhas em `projeto_aprovacoes` são do estágio 2 —
//  e, sem filtrar `estagio === 1`, o resync escrevia o parecer do 2º líder na coluna
//  do 1º. Os 3 escritores primários (`abrirPreAprovacao`, `decidirAprovacao`,
//  `dispensarPreAprovacao`) já filtram `estagio === 1`; o resync ficou de fora.
//
//  BUG 2 — coluna "ID Pai" (vínculo de FEATURE na linha do filho) NÃO está em
//  SAFE_UPDATE_FIELDS, então nada a restaura pelo sync reverso. O resync chama
//  `syncSubmitToGoogle({modo:'edicao'})` SEM passar `idPai`, e o `ouTraco(undefined)`
//  incondicional gravava "—" a cada resync, zerando o vínculo para sempre. O fix
//  passa `idPai: projeto.projeto_pai_id ?? null` (RESTAURA o vínculo do banco).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

// Espia os escritores da planilha sem tocar o Google Sheets. Mantém o resto do módulo
// real (nowFortaleza/derivarClassificacaoSheet, usados no import de chat.functions).
vi.mock('@/lib/google/sync', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/sync')>();
  return {
    ...actual,
    syncSubmitToGoogle: vi.fn().mockResolvedValue(undefined),
    syncUpdateToGoogle: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  setDb,
  insertProjeto,
  upsertDocumentacao,
  abrirAprovacoesPendentes,
} from '@/integrations/db/client.server';
import { resyncGoogle } from '@/lib/chat.functions';
import { syncSubmitToGoogle } from '@/lib/google/sync';

const mockSubmit = syncSubmitToGoogle as unknown as ReturnType<typeof vi.fn>;
const paramsDoSubmit = () => mockSubmit.mock.calls[0][0] as Record<string, unknown>;

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

// Cria um projeto com doc mínima de saving (o que o resync precisa para regravar a linha).
async function criarProjetoComDoc(opts: { projeto_pai_id?: string | null }) {
  const projeto = await insertProjeto({
    responsavel_nome: 'Autor',
    responsavel_email: 'autor@gocase.com',
    ferramenta: 'n8n',
    nome: 'Feature X',
    membros: [],
    tipos_projeto: ['saving'],
    especial: false,
    status: 'em_validacao',
    projeto_pai_id: opts.projeto_pai_id ?? null,
  });
  await upsertDocumentacao(projeto.id, {
    saving: { economia_horas_mes: 10, economia_reais_mes: 100, linhas: [], memorial_calculo: 'M' },
  });
  return projeto;
}

describe('resyncGoogle — projeto-feature (vínculo + aprovação sequencial)', () => {
  // `_schemaReady` no client.server é por-arquivo e só inicializa o schema no PRIMEIRO
  // setDb — daí um único banco para o arquivo (cada teste cria projetos com id próprio,
  // sem colisão de linhas em projeto_aprovacoes).
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmit.mockResolvedValue(undefined);
  });

  it('BUG 1: estágio 1 ISENTO — NÃO escreve o parecer do estágio 2 na coluna do líder', async () => {
    const projeto = await criarProjetoComDoc({});
    // Feature com estágio 1 isento (autor liderança): só existe linha PENDENTE do estágio 2
    // (líder do dono do PAI). Sem o filtro, ela vazaria para "Aprovação do Líder".
    await abrirAprovacoesPendentes(projeto.id, 1, 'autor@gocase.com', [
      { email: 'lider.do.pai@gocase.com', nome: 'Líder do Pai' },
    ], { estagio: 2, limparAntes: false });

    await resyncGoogle({ projeto_id: projeto.id });

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    // filaLider fica VAZIA após filtrar estagio===1 → `undefined` = "não encoste".
    expect(paramsDoSubmit().aprovacaoLider).toBeUndefined();
    expect(paramsDoSubmit().justificativaAprovacaoLider).toBeUndefined();
  });

  it('CONTROLE: com fila de estágio 1 pendente, o parecer do líder É espelhado', async () => {
    const projeto = await criarProjetoComDoc({});
    await abrirAprovacoesPendentes(projeto.id, 1, 'autor@gocase.com', [
      { email: 'lider.direto@gocase.com', nome: 'Líder Direto' },
    ]);

    await resyncGoogle({ projeto_id: projeto.id });

    // Prova que o filtro não zera tudo: o estágio 1 real gera rótulo/justificativa.
    expect(paramsDoSubmit().aprovacaoLider).toBeTruthy();
    expect(paramsDoSubmit().justificativaAprovacaoLider).toBeTruthy();
  });

  it('BUG 2: resync RESTAURA "ID Pai" do banco (não zera para "—")', async () => {
    const projeto = await criarProjetoComDoc({ projeto_pai_id: 'PAI-ABC123' });

    await resyncGoogle({ projeto_id: projeto.id });

    // idPai vem do banco (não `undefined`, que zeraria via ouTraco). Restauração ativa.
    expect(paramsDoSubmit().idPai).toBe('PAI-ABC123');
  });

  it('BUG 2: projeto SEM pai → idPai = null (grava "—", nunca undefined)', async () => {
    const projeto = await criarProjetoComDoc({});

    await resyncGoogle({ projeto_id: projeto.id });

    expect(paramsDoSubmit().idPai).toBeNull();
  });
});
