// Banco de verdade para teste: better-sqlite3 em memória por trás da MESMA interface
// assíncrona do `env.DB` do Godeploy (`query`/`exec` que devolvem Promise e exigem params).
//
// Existe porque o espelho da planilha vive no SQLite: mockar a camada de dados inteira
// para testá-lo daria um fake maior que o código testado — e não pegaria o que importa
// (upsert por conflito, `IN (...)`, JSON de volta). Só a REDE (Google Sheets) é mockada.
//
// ⚠️ `tests/sync-reverse.test.ts` tem uma cópia deste adapter, anterior a este helper. Não
// foi unificada de propósito nesta fatia (é um teste grande e verde — a troca seria churn
// sem ganho); helper novo nasce aqui, e quem tocar naquele arquivo migra.
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

export function adapterAsync(db: BetterSqlite3.Database): GoDeployDB {
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

/**
 * Cria um banco em memória com o schema real aplicado e o injeta como o banco do app.
 *
 * ⚠️ O `initSchema` é chamado DIRETO, não pelo `setDb`: o `setDb` guarda um booleano
 * `_schemaReady` por instância de módulo (de propósito — ver o comentário dele sobre I/O
 * atrelado ao request no Cloudflare), então do 2º `criarDbMemoria()` do mesmo arquivo em
 * diante ele pularia a criação e todo teste depois do primeiro morria com
 * "no such table". Cada banco novo precisa do schema aplicado no próprio banco.
 */
export async function criarDbMemoria(): Promise<BetterSqlite3.Database> {
  const [{ setDb }, { initSchema }] = await Promise.all([
    import('@/integrations/db/client.server'),
    import('@/integrations/db/schema'),
  ]);
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  const adapter = adapterAsync(db);
  await initSchema(adapter);
  await setDb(adapter);
  return db;
}
