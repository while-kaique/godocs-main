// Plugin Vite que serve as rotas /api/* localmente durante o desenvolvimento.
// Em produção, essas rotas são tratadas pelo Cloudflare Worker (worker.ts).
// Aqui, carregamos worker.ts via ssrLoadModule para reutilizar toda a lógica.

import type { Plugin } from 'vite'
import fs from 'fs'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

export function devApiPlugin(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      carregarEnv()

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

          const fakeEnv = {
            // ASSETS não é usado nas rotas /api/ — retorna 404 como fallback
            ASSETS: { fetch: () => Promise.resolve(new Response('Not found', { status: 404 })) },
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
