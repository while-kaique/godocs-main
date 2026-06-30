# Ambiente de Staging

Runbook do ambiente de **staging** do GoDocs — um app Godeploy isolado para validar mudanças
**antes** de produção. É a base da **regra 13 do `CLAUDE.md` (staging primeiro)**: nenhuma mudança de
código vai pra produção sem passar pela staging.

> Planejamento e decisões de fundo: [../spec-docs/SPEC_STAGING.md](../spec-docs/SPEC_STAGING.md).

## Os dois ambientes

| | Produção | Staging |
|---|---|---|
| App Godeploy | `674a3710` (`godocs`) | **`edf400b4`** (`godocs-staging`) |
| URL | https://godocs.devgogroup.com/ | https://godocs-staging.devgogroup.com/ |
| Planilha | aba `GoDocs` | **mesma planilha**, aba `STAGING` |
| Drive | pasta de prod (`1e_Fk8...`) | pasta própria (`19lFuQ7Q...`, dona `rpa_ia`) |
| Google Chat | webhook do time | **mudo** (sem webhook) |
| SQLite (`env.DB`) | DB de prod | DB próprio (isolado por-app) |
| `GODOCS_ENV` | ausente → `production` | `staging` (mostra a faixa visual) |

O **mesmo código** (worker.js + SPA) roda nos dois apps. O único discriminador em runtime é a env
`GODOCS_ENV`, lida no worker por request.

## Modelo de isolamento

Decisão do dono (mais leve que a proposta original da SPEC, que previa planilha/Drive/Chat 100%
separados):

- **Sheets** — staging compartilha a MESMA planilha de prod, mas lê/escreve só na **aba `STAGING`**.
  A aba é o isolamento, não o arquivo. (`GOOGLE_SHEETS_ID` = prod, `GOOGLE_SHEETS_TAB=STAGING`.)
- **Drive** — pasta própria de staging (uploads não se misturam com os de prod).
- **Chat** — webhooks NÃO setados → `sendChatNotification` no-opa → staging não notifica o time.
- **SQLite** — cada app Godeploy tem seu `env.DB`; isolado de graça. O schema auto-migra
  (`initSchema`, `CREATE TABLE IF NOT EXISTS` + migrações) na primeira request.

**Dados de staging são simulados — nunca reais.**

## Guard anti-vazamento (`src/lib/env.ts`)

Como prod roda nos **defaults hardcoded** de Sheet/Drive (não tem `GOOGLE_SHEETS_ID`/
`GOOGLE_DRIVE_FOLDER_ID` nos secrets), o maior risco em staging seria a env de override faltar e o
app cair no recurso de **produção**. O guard impede isso:

- `getGodocsEnv()` / `isStaging()` — leem `GODOCS_ENV` (default `production`).
- `assertNaoEhDefaultDeProd(idResolvido, idPadraoProd, rotulo)` — em **staging**, se o valor resolvido
  for o default de prod (env faltando), **lança erro** em vez de escrever em produção. Em **produção**
  é no-op (caminho idêntico ao de hoje).
- Chamado em `src/lib/google/sheets.ts` (protege a **aba** — recusa cair em `GoDocs`) e
  `src/lib/google/drive.ts` (protege a **pasta**).

A faixa visual "STAGING" (`src/components/staging-banner.tsx`, montada no `__root.tsx`) consulta
`GET /api/config` → `{env}` e só renderiza quando `env === 'staging'`.

## Deploy no staging

Mesmo fluxo do [deploy.md](deploy.md), porém mirando o app de staging:

```bash
# 1. Build (no worktree da sua branch)
npm run test && npm run build && npm run build:worker

# 2. Upload — getUploadToken (MCP) → curl com worker.js + dist/
curl -X POST "$UPLOAD_URL" \
  -F "worker.js=@./worker.js" \
  -F "index.html=@./dist/index.html" \
  $(for f in dist/assets/*; do echo -F "\"assets/$(basename "$f")=@./$f\""; done)

# 3. updateApp (MCP) — appId edf400b4 (STAGING, NÃO 674a3710):
#    uploadId: <id do passo 2>
#    entrypoint: "worker.js"
#    assetConfig: { "not_found_handling": "single-page-application" }
#    assets: gerar dinamicamente do dist/ real (regra 9):
echo -n '["index.html"'; for f in dist/assets/*; do echo -n ',"assets/'"$(basename "$f")"'"'; done; echo ']'
```

Os secrets de staging já incluem `GODOCS_ENV=staging`, `GOOGLE_SHEETS_TAB=STAGING` e
`GOOGLE_DRIVE_FOLDER_ID` próprio — só se deploya **código**, não é preciso re-setar secret a cada deploy.

> ⚠️ Confunda os `appId` e você deploya código não-validado direto em produção. STAGING = `edf400b4`.

## Provisionamento dos recursos Google

Script idempotente que cria a aba `STAGING` (cabeçalho copiado de `GoDocs` via Service Account) e a
pasta de Drive de staging (via OAuth `rpa_ia`, o dono certo pro upload):

```bash
node --env-file=.env scripts/staging/provision-google.mjs
# imprime GOOGLE_SHEETS_TAB e GOOGLE_DRIVE_FOLDER_ID p/ os secrets do app
```

## Secrets do app de staging

22 no total: **17 compartilhados** com prod (LLM_*, GOOGLE_SA_*, GOOGLE_OAUTH_*, OCR_*, BREVO,
ADMIN_EMAILS, etc.) + **5 overrides** (`GODOCS_ENV=staging`, `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_TAB`,
`GOOGLE_DRIVE_FOLDER_ID`, `APP_BASE_URL`). **Não** setados de propósito: `GOOGLE_CHAT_WEBHOOK_URL`,
`GOOGLE_CHAT_WEBHOOK_URL_AJUDA` (Chat mudo) e `GOOGLE_DRIVE_FOLDER_ID_AJUDA` (cai na pasta de staging).

## Testar com o harness E2E

```bash
# rodar do godocs-main (que tem .env); GOOGLE_SHEETS_TAB=STAGING é OBRIGATÓRIO
E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING \
  E2E_ONLY=saving-puro npm run e2e:run -- <runId>

E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING \
  npm run e2e:cleanup -- <runId>
```

⚠️ Sem `GOOGLE_SHEETS_TAB=STAGING`, o validate/cleanup leem/limpam a aba de **prod** (default `GoDocs`).
O cleanup só apaga linhas cujo `ID Projeto` casa com os IDs do run (tag-escopado) — não toca prod.

## Crons

- `sync-sheets-to-sqlite` (`0 * * * *`) — **ativo**
- `sync-areas` (`0 6 * * *`) — **ativo**
- `reanalisar-pendentes` (`* * * * *`) — **PAUSADO** (LLM por minuto = custo). Ligar via
  `setCronJobEnabled` só pra testar reconciliação de Complexidade e desligar depois.

## Pendente (a cargo do admin do repo)

A **trava dura** ainda não existe (Luis é READ em `while-kaique/godocs-main`; quem aplica é o admin —
Kaique). Enquanto isso, a **regra 13 do `CLAUDE.md` é a trava** (convenção seguida pelo Claude):

- CI no GitHub Actions: `npm ci` + `test` + `build` + `build:worker` + gate
  `git diff --exit-code worker.js` (pega `worker.js` desatualizado).
- `deploy.mjs --env=staging|prod` (remover o token hardcoded de `upload-deploy.mjs`).
- PR template + label `staging-validated` como required check.
- Branch protection na `main`: PR + CI verde + 1 review + gate "validado em staging".

## Verificação rápida

- `curl .../api/config` → staging retorna `{"env":"staging"}`; prod **não tem a rota** (`404`).
- Submeter na staging → linha aparece na aba `STAGING` e **NÃO** na `GoDocs`; arquivo na pasta de
  Drive de staging; **nenhuma** notificação no Chat do time.
