/**
 * O custo do `initSchema` — a causa do "primeira vez que entro no dashboard demora".
 *
 * ## O que foi medido (14/09/2026)
 * `/dashboard` abria em ~21 s na primeira vez e ~0,45 s na segunda. O mesmo pico aparecia em
 * `/api/auth/me`, que não faz trabalho nenhum **mas toca o banco**; `/favicon.svg`, que nem
 * passa pelo worker, nunca passou de 0,9 s. Não era a planilha (o dashboard não a lê em
 * request desde 11/08), não era volume e não era cold start de JS.
 *
 * Era esta função: ~150 idas ao banco EM SÉRIE (70 statements do schema + 70 `ALTER TABLE` +
 * seeds), rodadas no primeiro acesso de **cada isolate novo**. Com o round-trip do datasource
 * do Godeploy na casa dos 100-150 ms, dá 15 a 22 segundos.
 *
 * Estes testes prendem as duas metades do conserto: o atalho REALMENTE evita as idas, e ele
 * **nunca** pula uma migração de verdade.
 */
import { describe, it, expect } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { initSchema } from "@/integrations/db/schema";
import type { GoDeployDB } from "@/integrations/db/db-adapter";

/** Adapter que CONTA as idas ao banco — é a unidade que custa 100-150 ms em produção. */
function adapterContado(db: BetterSqlite3.Database) {
  const conta = { query: 0, exec: 0 };
  const adapter: GoDeployDB = {
    async query(sql: string, params: unknown[] = []) {
      conta.query += 1;
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])), rowsRead: rows.length };
    },
    async exec(sql: string, params: unknown[] = []) {
      conta.exec += 1;
      if (params.length > 0) {
        const r = db.prepare(sql).run(...params);
        return { rowsWritten: r.changes };
      }
      db.exec(sql);
      return { rowsWritten: 0 };
    },
  };
  return { adapter, conta };
}

describe("o segundo isolate não paga o schema de novo", () => {
  it("⚠️ a 1ª vez faz ~150 idas ao banco; a 2ª faz UMA", async () => {
    const db = new BetterSqlite3(":memory:");
    const { adapter, conta } = adapterContado(db);

    await initSchema(adapter);
    const primeira = conta.query + conta.exec;
    // A ordem de grandeza é o ponto: são as ~150 que viram 15-22 s em produção.
    expect(primeira).toBeGreaterThan(100);

    conta.query = 0;
    conta.exec = 0;
    await initSchema(adapter);
    const segunda = conta.query + conta.exec;
    expect(segunda, "o 2º init deveria ser UMA consulta de verificação").toBe(1);
  });

  it("e o banco continua completo depois do atalho", async () => {
    const db = new BetterSqlite3(":memory:");
    const { adapter } = adapterContado(db);
    await initSchema(adapter);
    await initSchema(adapter);
    // Uma coluna de cada geração: schema base, migração antiga, migração de hoje.
    const colunas = (db.prepare("PRAGMA table_info(projetos)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(colunas).toContain("status");
    expect(colunas).toContain("editores_delegados");
    expect(colunas).toContain("ajuste_realizado_em");
    expect(colunas).toContain("saving_efetivado_valor_antes");
  });
});

describe("o atalho nunca pula uma migração de verdade", () => {
  it("⚠️ banco NOVO roda o init completo (a marca não existe)", async () => {
    const db = new BetterSqlite3(":memory:");
    const { adapter, conta } = adapterContado(db);
    await initSchema(adapter);
    expect(conta.exec).toBeGreaterThan(100);
  });

  it("⚠️ marca de OUTRA versão do schema força o init completo", async () => {
    // É o caso do deploy: o código mudou, então a impressão digital muda e o primeiro
    // isolate que roda o código novo aplica tudo. Ninguém precisa bumpar número à mão.
    const db = new BetterSqlite3(":memory:");
    const { adapter, conta } = adapterContado(db);
    await initSchema(adapter);

    db.prepare("UPDATE schema_estado SET valor = 'versao-antiga' WHERE chave = 'impressao'").run();
    conta.exec = 0;
    conta.query = 0;
    await initSchema(adapter);
    expect(conta.exec, "com a impressão diferente, tudo tem de rodar de novo").toBeGreaterThan(100);
  });

  it("⚠️ init que FALHA no meio não grava a marca", async () => {
    // Marca gravada cedo demais transformaria uma migração pela metade em "está tudo certo"
    // para sempre — e a coluna faltando só apareceria como erro em produção.
    const db = new BetterSqlite3(":memory:");
    let quantas = 0;
    const adapter: GoDeployDB = {
      async query() {
        return { columns: [], rows: [], rowsRead: 0 };
      },
      async exec(sql: string, params: unknown[] = []) {
        quantas += 1;
        // Explode no meio do schema, ANTES de chegar na gravação da marca.
        if (quantas === 20) throw new Error("banco caiu no meio da migração");
        if (params.length > 0) {
          db.prepare(sql).run(...params);
          return { rowsWritten: 1 };
        }
        db.exec(sql);
        return { rowsWritten: 0 };
      },
    };

    await expect(initSchema(adapter)).rejects.toThrow("banco caiu no meio");
    const marca = db
      .prepare("SELECT valor FROM schema_estado WHERE chave = 'impressao'")
      .all() as unknown[];
    expect(marca, "a marca não pode existir depois de um init que falhou").toEqual([]);
  });

  it("⚠️ leitura da marca que FALHA cai no init completo, nunca no atalho", async () => {
    // Fail-open para o lado CARO: o erro que não se pode cometer é pular a migração.
    const db = new BetterSqlite3(":memory:");
    const { adapter, conta } = adapterContado(db);
    await initSchema(adapter);

    const comLeituraQuebrada: GoDeployDB = {
      async query() {
        throw new Error("leitura fora do ar");
      },
      exec: adapter.exec.bind(adapter),
    };
    conta.exec = 0;
    await initSchema(comLeituraQuebrada);
    expect(conta.exec).toBeGreaterThan(100);
  });
});
