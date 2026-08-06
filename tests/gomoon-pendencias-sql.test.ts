// A AGREGADA que alimenta o snapshot diário do Gomoon (`getPendenciasPorLider`),
// contra um SQLite de verdade — o filtro é a parte que mais tem como sair errada.
//
// O que este teste segura:
//  • projeto de TESTE do harness (`[E2E-…]`) NUNCA entra no payload. O mute de Chat
//    saiu do `abrirPreAprovacao` (D17), então excluí-los virou responsabilidade de
//    quem monta o payload — se este filtro cair, o líder recebe DM de teste.
//  • rascunho e projeto DESCONTINUADO ficam de fora.
//  • linha já DECIDIDA sai da relação (o líder não é cobrado de novo).
//  • pessoa em 2+ times gera 1 par por líder (D4) — os dois são avisados.
import { describe, it, expect, beforeAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';
import {
  setDb,
  insertProjeto,
  updateProjeto,
  abrirAprovacoesPendentes,
  decidirAprovacoesDoProjeto,
  getPendenciasPorLider,
} from '@/integrations/db/client.server';

function asyncAdapter(db: BetterSqlite3.Database): GoDeployDB {
  return {
    async query(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])), rowsRead: rows.length };
    },
    async exec(sql: string, params: unknown[] = []) {
      if (params.length > 0) return { rowsWritten: db.prepare(sql).run(...params).changes };
      db.exec(sql);
      return { rowsWritten: 0 };
    },
  };
}

const LUCAS = { email: 'lucas.queiroz@gocase.com', nome: 'Lucas Queiroz' };
const KELLY = { email: 'kelly@gocase.com', nome: 'Kelly Santos' };

async function criarSubmetido(over: Record<string, unknown> = {}) {
  const p = await insertProjeto({
    responsavel_nome: 'Ana Souza',
    responsavel_email: 'ana@gocase.com',
    ferramenta: 'n8n',
    nome: 'Automação de cadastro',
    status: 'em_validacao',
    ...over,
  });
  return p;
}

describe('getPendenciasPorLider — a relação que vai para o Gomoon', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  it('agrupa por (líder, liderado) e conta os projetos pendentes', async () => {
    const a = await criarSubmetido();
    const b = await criarSubmetido({ nome: 'Outra automação' });
    await abrirAprovacoesPendentes(a.id, 1, 'ana@gocase.com', [LUCAS]);
    await abrirAprovacoesPendentes(b.id, 1, 'ana@gocase.com', [LUCAS]);

    const linhas = await getPendenciasPorLider();
    const par = linhas.find(
      (l) => l.lider_email === LUCAS.email && l.liderado_email === 'ana@gocase.com',
    );
    expect(par).toBeDefined();
    expect(par!.projetos_pendentes).toBe(2);
    expect(par!.lider_nome).toBe('Lucas Queiroz');
    expect(par!.liderado_nome).toBe('Ana Souza');
  });

  it('⚠️ projeto de teste do harness ([E2E-…]) fica FORA do payload', async () => {
    const p = await criarSubmetido({
      nome: '[E2E-abc123] Automação de teste',
      responsavel_email: 'e2e@gocase.com',
      responsavel_nome: 'Robô E2E',
    });
    await abrirAprovacoesPendentes(p.id, 1, 'e2e@gocase.com', [LUCAS]);

    const linhas = await getPendenciasPorLider();
    expect(linhas.some((l) => l.liderado_email === 'e2e@gocase.com')).toBe(false);
  });

  it('rascunho nunca entra em fila', async () => {
    const p = await criarSubmetido({
      status: 'rascunho',
      responsavel_email: 'rascunho@gocase.com',
    });
    await abrirAprovacoesPendentes(p.id, 1, 'rascunho@gocase.com', [LUCAS]);

    const linhas = await getPendenciasPorLider();
    expect(linhas.some((l) => l.liderado_email === 'rascunho@gocase.com')).toBe(false);
  });

  it('projeto DESCONTINUADO não cobra mais parecer', async () => {
    const p = await criarSubmetido({ responsavel_email: 'desc@gocase.com' });
    await abrirAprovacoesPendentes(p.id, 1, 'desc@gocase.com', [LUCAS]);
    await updateProjeto(p.id, { descontinuado: 1 });

    const linhas = await getPendenciasPorLider();
    expect(linhas.some((l) => l.liderado_email === 'desc@gocase.com')).toBe(false);
  });

  it('linha já decidida sai da relação', async () => {
    const p = await criarSubmetido({ responsavel_email: 'decidido@gocase.com' });
    await abrirAprovacoesPendentes(p.id, 1, 'decidido@gocase.com', [LUCAS]);
    await decidirAprovacoesDoProjeto(p.id, 'aprovado', null, LUCAS.email, {
      move_kpi: 'sim',
      sente_falta: 'sim',
      saving_coerente: 'sim',
    });

    const linhas = await getPendenciasPorLider();
    expect(linhas.some((l) => l.liderado_email === 'decidido@gocase.com')).toBe(false);
  });

  it('autor em 2+ times gera um par por líder (D4 — os dois são avisados)', async () => {
    const p = await criarSubmetido({ responsavel_email: 'doistimes@gocase.com' });
    await abrirAprovacoesPendentes(p.id, 1, 'doistimes@gocase.com', [LUCAS, KELLY]);

    const linhas = (await getPendenciasPorLider()).filter(
      (l) => l.liderado_email === 'doistimes@gocase.com',
    );
    expect(linhas.map((l) => l.lider_email).sort()).toEqual([KELLY.email, LUCAS.email].sort());
    expect(linhas.every((l) => l.projetos_pendentes === 1)).toBe(true);
  });
});
