# SPEC — Ambiente de Staging + fluxo "nada vai pra main sem passar pela staging"

> **Status: ✅ AMBIENTE NO AR (30/06/2026) · ⏳ trava dura pendente.** App `godocs-staging`
> (`edf400b4`, https://godocs-staging.devgogroup.com/) criado, isolado e **verificado por E2E**
> (cenário `saving-puro` submeteu e caiu só na aba `STAGING`, sem vazar pra prod). Guard, banner,
> endpoint `/api/config`, secrets e crons prontos. **Falta** a camada de fluxo/trava (Parte 4: CI,
> branch protection, `deploy.mjs`, PR template) — **a cargo do admin do repo (Kaique)**; até lá, a
> **regra 13 do `CLAUDE.md`** (staging primeiro) é a trava por convenção.
>
> **Onde aterrissou:** `src/lib/env.ts` (guard), `sheets.ts`/`drive.ts` (chamam o guard),
> `worker.ts` (`GET /api/config`), `src/components/staging-banner.tsx` + `__root.tsx` (faixa),
> `scripts/staging/provision-google.mjs` (recursos Google), `tests/env-staging.test.ts`,
> `docs/staging.md` (runbook), `CLAUDE.md` (regra 13 + seção "Ambiente de Staging"). Branch
> `feat/staging-ambiente-fluxo`.
>
> **⚠️ Decisão fechada REVISADA (D2 → mais leve, 30/06/2026):** o isolamento NÃO usa planilha/Drive/
> Chat 100% separados. Staging **compartilha a planilha de prod** numa **aba `STAGING`** própria
> (a aba é o isolamento), **pasta de Drive própria**, **Chat mudo** (sem webhook) e **SQLite próprio**
> (por-app). Foi a escolha do dono ("só pra testar, dados simulados"). O resto da SPEC abaixo descreve
> o plano original (separação total) — mantido como referência; o que está NO AR segue o modelo leve.
>
> Decisões de fundo (D1, D3, D4) seguem válidas. D2 revisada acima.

## Context / problema

Hoje o GoDocs tem **um único ambiente** (`godocs.devgogroup.com`, app Godeploy `674a3710`) e
**nenhuma trava**: qualquer merge na `main` vai direto pra produção, sem teste prévio num ambiente
real. Várias sessões/pessoas mexem no repo ao mesmo tempo (CLAUDE.md regra 8), o deploy é manual e o
`worker.js` é commitado à mão — combinação que já gerou regressões em produção (tela branca por
asset desalinhado, `worker.js` desatualizado, vazamento de receita/coluna, 500 em legado).

**Objetivo:** criar uma **staging totalmente isolada** (que nunca toca dados de produção nem
notifica o time) e um **fluxo obrigatório** em que toda mudança vive na staging e é validada antes
de poder ser promovida pra `main`/produção.

## Decisões fechadas (que NÃO devem ser "corrigidas" por engano)

- **D1 — Promoção por branch `staging` dedicada.** `feat/*` (worktree) → PR → `staging` → deploy
  staging → valida → PR `staging`→`main` → deploy prod. Dois merges por mudança é intencional (é o
  gate).
- **D2 — Isolamento TOTAL.** Staging com Sheet, espaço de Google Chat, pasta de Drive e datasource
  SQLite **próprios**. O harness E2E passa a rodar contra a staging (não mais contra prod).
- **D3 — Trava DURA.** Branch protection na `main` (PR + CI verde + 1 review + gate "validado em
  staging") + CI no GitHub Actions.
- **D4 — Deploy manual/scriptado** (variante do fluxo atual apontando pro app de staging). CI
  headless que deploya sozinho fica **fase 2** (depende de o Godeploy expor deploy via HTTP/token —
  a confirmar; hoje `updateApp` é via MCP).

## Decisões em aberto (definir na implementação)

- Custo de IA na staging: apontar `LLM_MODEL`/`LLM_MODEL_FAST` para modelo mais barato? (opcional)
- Cron `reanalisar-pendentes` (LLM a cada minuto): **criar desabilitado** na staging, ligar só pra
  testar reconciliação de complexidade. (proposto)
- Gate "validado em staging": label `staging-validated` como required check + checklist no PR
  template. (proposto — depende de admin no repo)

---

## Arquitetura

```
                 GitHub (while-kaique/godocs-main)
   feat/* (worktree) ──PR──► staging ──PR──► main
                              │                │
                    deploy manual        deploy manual
                              ▼                ▼
                    godocs-staging        godocs (674a3710)
                    (NOVO app Godeploy)   PRODUÇÃO
                              │                │
        ┌─────────────────────┘                └─────────────────────┐
   Recursos STAGING (isolados)              Recursos PROD (intocados)
   • Sheet "GoDocs — STAGING" (cópia)       • Sheet 1xS2zIMu…
   • Espaço Google Chat de testes           • Espaço do time
   • Pasta Drive de staging                 • Pasta 1e_Fk8…
   • Datasource SQLite próprio (env.DB)     • DB de prod
   • E2E roda AQUI                          • (E2E sai daqui)
```

Staging = **app Godeploy separado** (`godocs-staging`, visibilidade `authenticated`, mesmo edge
OAuth). Mesmo código, secrets diferentes. Datasource SQLite é por-app → isolado de graça.

---

## Parte 1 — Pré-requisitos no Google Workspace (manuais, conta `rpa_ia@gocase.com`)

> Precisam existir **antes** do 1º deploy de staging, senão o guard (Parte 3) barra o boot.

1. **Sheet de staging**: duplicar a planilha de prod (estrutura A→AS, mesmo cabeçalho da aba
   `GoDocs`) → "GoDocs — STAGING". Compartilhar com o `GOOGLE_SA_CLIENT_EMAIL` (Service Account)
   como editor. Anotar `spreadsheetId` + nome da aba.
2. **Pasta de Drive de staging**: criar pasta, dona/compartilhada com o usuário OAuth de upload (o
   mesmo `rpa_ia@gocase.com` dos `GOOGLE_OAUTH_*`). Anotar `folderId`.
3. **Espaço de Google Chat de staging**: criar espaço de testes + webhook. Anotar a URL. (Opcional
   um separado pro widget de Ajuda; sem ele a staging fica muda no Ajuda, ok.)

---

## Parte 2 — App Godeploy de staging + secrets + crons

**Criar app** (`createApp`): slug `godocs-staging`, entrypoint `worker.js`, visibilidade
`authenticated`, SPA fallback (`assetConfig.not_found_handling = "single-page-application"`),
datasource SQLite próprio. URL esperada `godocs-staging.devgogroup.com`.

**Secrets** (`setAppSecret`) — partindo dos ~21 de prod, em dois grupos:

| Grupo | Secrets | Valor na staging |
|---|---|---|
| **Override (staging-específico)** | `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_TAB`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_CHAT_WEBHOOK_URL`, `GOOGLE_CHAT_WEBHOOK_URL_AJUDA`, `GOOGLE_DRIVE_FOLDER_ID_AJUDA`, `APP_BASE_URL`, **`GODOCS_ENV=staging`** (novo) | apontam pros recursos da Parte 1 |
| **Compartilhado (reusa prod)** | `LLM_*` (incl. `LLM_BASE_URL`/`API_PROXY_TOKEN`/`LLM_FALLBACK`), `OCR_*`, `TG_API_TOKEN`, `GOOGLE_SA_*`, `GOOGLE_OAUTH_*`, `BREVO_API_KEY`, `EMAIL_FROM`, `GODEPLOY_USER_HEADER`, `ADMIN_EMAILS` | iguais aos de prod |

Notas:
- `N8N_WEBHOOK_URL_*` **não existe** nos secrets de prod (o `docs/deploy.md` está desatualizado; o
  sync hoje é direto Sheets/Chat). Não replicar.
- Custo de IA: opcionalmente um modelo mais barato em `LLM_MODEL`/`LLM_MODEL_FAST`.

**Crons** (`createCronJob` no app de staging):
- `0 * * * *` → `POST /api/cron/sync-sheets-to-sqlite` (habilitado)
- `0 6 * * *` → `POST /api/cron/sync-areas` (habilitado)
- `* * * * *` → `POST /api/cron/reanalisar-pendentes` — **criar DESABILITADO** (LLM por minuto).

---

## Parte 3 — Mudanças de código (defesa contra vazamento + sinalização visual)

Pequenas, gated por `GODOCS_ENV` — **não alteram comportamento de produção**.

### 3.1 Guard "staging nunca usa default de prod" (o mais importante)
Risco real: `src/lib/google/sheets.ts:5,11` e `src/lib/google/drive.ts:14,19` caem nos IDs de
**produção hardcoded** se a env faltar → em staging = escrever no Sheet/Drive reais.

- Helper único (ex. `src/lib/env.ts`): `getGodocsEnv()` (default `'production'`), `isStaging()`,
  `assertNaoEhDefaultDeProd(idResolvido, idPadraoProd, rotulo)`.
- Em `sheets.ts`/`drive.ts`: se `isStaging()` e o ID resolvido == default de prod (env não setada),
  **lançar erro claro** ("STAGING sem GOOGLE_SHEETS_ID — recusando escrever no Sheet de produção").
  Em produção o caminho é idêntico ao de hoje.
- Ler `process.env` **sempre dentro de função** (CLAUDE.md — `process` não existe em escopo de módulo
  no Godeploy).

### 3.2 Banner visual "AMBIENTE DE STAGING"
- Expor `GODOCS_ENV` num endpoint de config (reusar `src/lib/config.server.ts` + rota no `worker.ts`)
  — só o rótulo, sem vazar secret.
- Faixa fixa no topo (em `src/routes/__root.tsx`, perto do `AjudaWidget`) visível só quando
  `env === 'staging'`. Skill `frontend-design` + identidade GoGroup; estado por rótulo+ícone (não só
  cor), PT-BR com acento, `prefers-reduced-motion`.

### 3.3 (Já coberto) Chat mudo por omissão
`sendChatNotification` já faz `warn + no-op` sem webhook (`src/lib/google/chat.ts:21`). Só garantir
que o secret aponte pro espaço de staging (ou ficar vazio = mudo). Sem mudança de código.

---

## Parte 4 — Fluxo de trabalho + trava na main (GitHub)

### 4.1 Branches
- `main` = produção (protegida). `staging` = ambiente de staging (branch longa a partir da `main`).
  `feat/*`/`fix/*` = trabalho em worktree (CLAUDE.md regra 8).
- Ciclo: `feat/x` → **PR para `staging`** → CI verde → merge → **deploy manual na `godocs-staging`** →
  **validar no navegador/E2E** → **PR `staging`→`main`** (checklist marcado) → merge → **deploy prod**.

### 4.2 CI — `.github/workflows/ci.yml` (roda em PR para `staging` e `main`)
1. `npm ci` · 2. `npm run test` · 3. `npm run build` · 4. `npm run build:worker` ·
5. **Gate anti-`worker.js`-desatualizado**: `git diff --exit-code worker.js` após o rebuild (falha
   se o `worker.js` commitado não bate — pega o footgun nº 1 da regra 1).

### 4.3 Branch protection na `main` (⚠️ exige ADMIN no repo)
- Proibir push direto; exigir PR.
- Exigir status check do CI (`ci.yml`) verde.
- Exigir 1 review aprovado.
- Exigir o gate "validado em staging" (4.4).
- (Opcional) exigir branch atualizada com a base antes do merge (casa com regra 10).

> **Dependência crítica:** `gh` reporta `viewerPermission: READ` p/ `luis.albuquerque` em
> `while-kaique/godocs-main` (dono = Kaique) → **quem aplica a branch protection é o admin do repo**.
> A SPEC entrega o ruleset pronto; a trava real depende dessa coordenação (ou de conceder admin ao
> Luis). Sem admin, cai na "trava leve" (template + CLAUDE.md) até resolver.

### 4.4 Gate "validado em staging"
- **PR template** (`.github/pull_request_template.md`) com checklist obrigatório:
  `[ ] Deployado em godocs-staging` · `[ ] Validei o fluxo afetado em staging` ·
  `[ ] worker.js rebuildado e commitado` · `[ ] spec-docs/CLAUDE.md atualizados (regra 12/7)`.
- **Label `staging-validated`** como required check via Action minúscula que falha enquanto a label
  não estiver no PR para `main`. Quem valida em staging aplica a label. (Sem admin → vira convenção.)

### 4.5 Deploy manual scriptado (os dois ambientes)
- Generalizar `upload-deploy.mjs` → `deploy.mjs --env=staging|prod`. Cada ambiente tem seu `appId` e
  **busca o upload token via `getUploadToken` na hora** — **não** commitar token (o atual está
  hardcoded → remover).
- Lista de assets **gerada do `dist/` real** a cada build (regra 9) — nunca reaproveitar.
- Sequência por ambiente: `npm run test && npm run build && npm run build:worker` → upload →
  `updateApp` (MCP) com `assetConfig` SPA + assets dinâmicos.
- Documentar em `docs/staging.md` (novo) e referenciar no `docs/deploy.md`.

---

## Parte 5 — E2E e documentação

- **E2E aponta pra staging**: hoje `scripts/e2e/` roda contra prod (`E2E_COOKIE` de prod, mute via
  `[E2E-]`). Passar a usar URL/cookie da `godocs-staging`. Com isolamento total, o guard de Chat mudo
  `ehProjetoTesteE2E` deixa de ser necessário em staging — manter por ora, revisar quando E2E sair
  de prod.
- **Docs**: criar `docs/staging.md` (runbook); atualizar `docs/deploy.md` (remover N8N, somar
  `GODOCS_ENV`); **nova regra no CLAUDE.md** ("toda mudança passa por staging antes da main"); manter
  esta SPEC atualizada (regra 12).

---

## Itens de segurança a tratar em paralelo (achados no levantamento)

- **PAT do GitHub em texto puro** no `.git/config` (URL do remote `origin`). **Rotacionar** o token e
  reconfigurar o remote sem credencial embutida (credential helper / `gh auth`).
- **Upload token hardcoded e commitado** em `upload-deploy.mjs`. Remover na refatoração para
  `deploy.mjs` (buscar via `getUploadToken`) e considerar invalidar o token exposto.

---

## Ordem de execução sugerida
1. Parte 1 (recursos Google) + Parte 2 (app + secrets + crons). — infra
2. Parte 3 (guard + banner + endpoint de config) num PR → testar local → deploy staging. — código
3. Branch `staging`; Parte 4.2 (CI) + 4.5 (deploy.mjs) + 4.4 (PR template/label). — fluxo
4. Parte 4.3 (branch protection) **com o admin do repo**. — trava
5. Parte 5 (E2E aponta staging + docs/CLAUDE.md). — fechamento

---

## Verificação (como provar que funciona)
- **Isolamento:** submeter na `godocs-staging` e confirmar linha **no Sheet de STAGING e NÃO no de
  prod**; arquivo na pasta de Drive de staging; **nenhuma** notificação no espaço do time.
- **Guard:** subir a staging **sem** `GOOGLE_SHEETS_ID` → app **recusa** (erro claro) em vez de
  escrever no Sheet de prod; setar e confirmar que volta a funcionar.
- **Banner:** `godocs-staging.devgogroup.com` mostra a faixa "STAGING"; prod **não** mostra.
- **CI:** PR com `worker.js` desatualizado de propósito → CI **vermelho** no gate do diff; rebuildar
  → **verde**.
- **Trava:** push direto na `main` → **rejeitado**; PR `staging`→`main` sem label `staging-validated`
  → merge **bloqueado**; label + CI verde + review → **liberado**.
- **E2E:** `npm run e2e:run`/`validate` apontando pra staging fecha verde sem tocar prod.
