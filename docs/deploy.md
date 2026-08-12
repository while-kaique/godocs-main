# Deploy

O GoDocs roda no **Godeploy**: SPA estática (`dist/`) + Cloudflare Worker (`worker.js`) + datasource SQLite (`env.DB`).

## Build

```bash
npm run build          # SPA estática em dist/ (Vite)
npm run build:worker   # worker.js (esbuild, commitado no git)
```

O `dist/` é gitignored e rebuildado no deploy. O `worker.js` é commitado — rebuildar sempre que mexer no backend.

## Regras de upload (Godeploy)

### Suba o `dist/` INTEIRO (recursivo), não só `assets/`
O upload deve incluir **todo** o conteúdo de `dist/`, não apenas `dist/assets/*`. O Vite
copia os arquivos de `public/` para a **raiz** do `dist/` (`favicon.svg`, e futuros
`robots.txt`, etc.) — eles ficam **fora** de `dist/assets/`. Se o comando só varrer
`dist/assets/*`, esses arquivos nunca sobem: com o SPA fallback ligado, `/favicon.svg`
não encontrado devolve o `index.html` (HTML), o browser não usa como ícone e o **favicon
some**. _(bug real jul/2026.)_

⚠️ **Nunca mantenha a lista de arquivos à mão.** Use o script `scripts/deploy-godeploy.sh`,
que deriva upload **e** manifest do `dist/` real (ver "Deploy via script" abaixo).

### Paths sem prefixo `dist/`
Os arquivos de `dist/` devem ser enviados **SEM** o prefixo `dist/` no path:

```
✅ Correto:  -F "index.html=@./dist/index.html"  -F "favicon.svg=@./dist/favicon.svg"  -F "assets/foo.js=@./dist/assets/foo.js"
❌ Errado:   -F "dist/index.html=@./dist/index.html"
```

### Deploy via script (recomendado)
```bash
# 1. Build
npm run test && npm run build && npm run build:worker

# 2. MCP getUploadToken -> pegue uploadUrl (e uploadId)
# 3. Upload + manifest (varre dist/ recursivo, favicon incluído):
scripts/deploy-godeploy.sh "<UPLOAD_URL>"
#    -> imprime ASSETS_JSON=[...] com TODOS os arquivos do dist/

# 4. MCP updateApp: appId (STAGING edf400b4 ANTES; PROD 674a3710 depois — regra 13),
#    uploadId do passo 2, entrypoint "worker.js",
#    assetConfig { "not_found_handling": "single-page-application" },
#    assets = o ASSETS_JSON do passo 3.
```

### SPA fallback obrigatório
Sempre incluir na configuração do app:
```json
{ "assetConfig": { "not_found_handling": "single-page-application" } }
```
Sem isso, rotas como `/submeter`, `/dashboard` retornam "Not Found".

## Polyfill de `process.env`

O Godeploy **não expõe** `process` global (sem `nodejs_compat`). O `worker.ts` faz polyfill no início de cada request:

```typescript
globalThis.process = { env: { ...env_vars } }
```

Por isso, leituras de `process.env.X` em **escopo de módulo** retornam `undefined` — sempre ler dentro de funções.

## Checklist pré-deploy

### 1. Rebuildar worker
```bash
npm run build:worker
```

### 2. Rodar testes
```bash
npm run test
```

### 3. Build do frontend
```bash
npm run build
```

### 4. Comitar worker.js atualizado
```bash
git add worker.js
git commit -m "build: rebuild worker.js"
```

## Env vars

| Var | Obrigatória | Descrição |
|---|---|---|
| `LLM_PROVIDER` | Sim | `openai` (default) ou `anthropic` |
| `LLM_API_KEY` | Sim | Chave da API do provider |
| `LLM_MODEL` | Sim | Modelo principal (default: `gpt-4.1`) |
| `LLM_MODEL_FAST` | Não | Modelo rápido para turnos do orquestrador |
| `DATABASE_PATH` | Não | SQLite em dev (default: `./godocs.db`); prod usa `env.DB` |
| `GODEPLOY_USER_HEADER` | Não | Header de auth (default: `x-godeploy-user-email`) |
| `DEV_USER_EMAIL` | Não | Email simulado em dev |
| `N8N_WEBHOOK_URL_SUBMIT` | Sim | Webhook n8n para submissões |
| `N8N_WEBHOOK_URL_UPDATE` | Não | Webhook n8n para observações |
| `GOOGLE_CHAT_WEBHOOK_URL` | Não | Notificações Google Chat |
| `OCR_WORKER_URL` | Sim | URL do Cloudflare OCR Worker |
| `OCR_WORKER_TOKEN` | Sim | Token do OCR Worker |
| `TG_API_TOKEN` | Sim | API TeamGuide (sync áreas) |
| `BREVO_API_KEY` | Não | Email via Brevo (aprovação/rejeição) |
| `EMAIL_FROM` | Não | Remetente dos emails |

## Dev local

O `vite-plugin-dev-api.ts` serve `/api/*` localmente:
- Cria wrapper `better-sqlite3` implementando `GoDeployDB`
- Lê `.env` e popula `process.env`
- Redireciona requests `/api/*` para `worker.ts` via `ssrLoadModule`
- Banco local: `godocs.db` (auto-criado, WAL mode, foreign keys ON)
