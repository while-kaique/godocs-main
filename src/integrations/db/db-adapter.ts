// Interface do adaptador de banco de dados
// Compatível com env.DB do Godeploy e com o wrapper better-sqlite3 em dev
//
// O env.DB do Godeploy é ASSÍNCRONO (query/exec retornam Promise). O wrapper
// better-sqlite3 do dev é síncrono. O tipo aceita ambos (T | Promise<T>); a
// camada client.server sempre dá `await` (no-op sobre valor síncrono).

export type QueryResult = { columns: string[]; rows: unknown[][]; rowsRead: number };
export type ExecResult = { rowsWritten: number };

/** Interface compatível com env.DB do Godeploy */
export interface GoDeployDB {
  /** SELECT queries — retorna { columns, rows, rowsRead } */
  query(sql: string, params?: unknown[]): QueryResult | Promise<QueryResult>;
  /** INSERT/UPDATE/DELETE — retorna { rowsWritten } */
  exec(sql: string, params?: unknown[]): ExecResult | Promise<ExecResult>;
}
