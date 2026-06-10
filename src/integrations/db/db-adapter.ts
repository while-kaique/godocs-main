// Interface do adaptador de banco de dados
// Compatível com env.DB do Godeploy e com o wrapper better-sqlite3 em dev

/** Interface compatível com env.DB do Godeploy */
export interface GoDeployDB {
  /** SELECT queries — retorna { columns: string[], rows: unknown[][], rowsRead: number } */
  query(sql: string, params?: unknown[]): { columns: string[]; rows: unknown[][]; rowsRead: number };
  /** INSERT/UPDATE/DELETE — retorna { rowsWritten: number } */
  exec(sql: string, params?: unknown[]): { rowsWritten: number };
}
