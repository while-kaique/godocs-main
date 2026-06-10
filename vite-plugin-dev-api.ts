// Plugin Vite que serve as rotas /api/* localmente durante o desenvolvimento.
// Em produção, essas rotas são tratadas pelo Cloudflare Worker (worker.ts).
// Aqui, carregamos worker.ts via ssrLoadModule para reutilizar toda a lógica.
// O banco SQLite é emulado localmente via better-sqlite3, com um wrapper
// que implementa a mesma interface GoDeployDB (env.DB) do Godeploy.

import type { Plugin } from 'vite'
import fs from 'fs'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import BetterSqlite3 from 'better-sqlite3'
import type { GoDeployDB } from './src/integrations/db/db-adapter'

// ─── Wrapper better-sqlite3 → interface GoDeployDB ─────────────────────────

let _devDb: BetterSqlite3.Database | undefined;

function getDevDb(): BetterSqlite3.Database {
  if (!_devDb) {
    const dbPath = process.env.DATABASE_PATH || path.resolve('godocs.db');
    _devDb = new BetterSqlite3(dbPath);
    _devDb.pragma('journal_mode = WAL');
    _devDb.pragma('foreign_keys = ON');
  }
  return _devDb;
}

function createDevDbAdapter(): GoDeployDB {
  const db = getDevDb();

  return {
    query(sql: string, params?: unknown[]) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...(params ?? [])) as Record<string, unknown>[];

      if (rows.length === 0) {
        // Tenta extrair os nomes das colunas do statement
        const columns = stmt.columns().map((c) => c.name);
        return { columns, rows: [], rowsRead: 0 };
      }

      const columns = Object.keys(rows[0]);
      const arrayRows = rows.map((row) => columns.map((col) => row[col]));
      return { columns, rows: arrayRows, rowsRead: rows.length };
    },

    exec(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        const result = db.prepare(sql).run(...params);
        return { rowsWritten: result.changes };
      }
      // Sem params — pode ser DDL (CREATE TABLE, etc.)
      db.exec(sql);
      return { rowsWritten: 0 };
    },
  };
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export function devApiPlugin(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      carregarEnv()

      // Cria o adapter uma vez para toda a sessão dev
      const devDbAdapter = createDevDbAdapter()

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/')) return next()

        try {
          const host = req.headers.host ?? 'localhost'
          const url = new URL(req.url, `http://${host}`)

          const bodyBuf = await lerBody(req)
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(req.headers)) {
            headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
          }

          const reqInit: RequestInit = {
            method: req.method ?? 'GET',
            headers,
          }
          if (bodyBuf.length > 0) {
            // Node.js 18+ precisa de duplex para bodies que não são strings
            ;(reqInit as Record<string, unknown>).body = bodyBuf
            ;(reqInit as Record<string, unknown>).duplex = 'half'
          }

          const request = new Request(url.toString(), reqInit)

          // Carrega worker.ts pelo pipeline do Vite (resolve aliases @/, TypeScript, etc.)
          const workerMod = await server.ssrLoadModule('/src/worker.ts')
          const handler = workerMod.default as {
            fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response>
          }

          const fakeEnv: Record<string, unknown> = {
            // Injeta o adapter SQLite local como env.DB (mesma interface do Godeploy)
            DB: devDbAdapter,
            // ASSETS não é usado nas rotas /api/ — retorna 404 como fallback
            ASSETS: { fetch: () => Promise.resolve(new Response('Not found', { status: 404 })) },
          }

          // Injeta env vars do process.env no fakeEnv (simula o comportamento do Godeploy)
          for (const [k, v] of Object.entries(process.env)) {
            if (typeof v === 'string' && !(k in fakeEnv)) {
              fakeEnv[k] = v
            }
          }

          const response = await handler.fetch(request, fakeEnv, {})

          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))

          const body = await response.arrayBuffer()
          res.end(Buffer.from(body))
        } catch (err) {
          console.error('[dev-api]', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}

function carregarEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return

  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const raw = trimmed.slice(eq + 1).trim()
    // Remove aspas envolventes ("..." ou '...')
    const value = raw.replace(/^(["'])(.*)\1$/, '$2')
    if (key && !process.env[key]) process.env[key] = value
  }
}

async function lerBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
