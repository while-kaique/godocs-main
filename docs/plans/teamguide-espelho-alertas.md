# Plano — Espelho durável da TeamGuide + alertas de erro proativos
**Status:** ✅ aprovado (Luis, 2026-09-02) · **executado** (código em `feat/teamguide-espelho-alertas`, 2026-09-02)

**Objetivo:** Tirar a integração TeamGuide do caminho crítico — todas as leituras passam a ler de um **espelho SQLite** (a TeamGuide só o ATUALIZA por cron), tornando-as **fail-safe** — e adicionar um **sistema de alerta proativo** no Google Chat de Ajuda (incl. aviso de **expiração do token** ~14 dias antes), para descobrir problemas antes do cliente.

---

## Contexto
Incidente 01–02/09/2026: o `TG_API_TOKEN` (JWT de 90d) expirou e **derrubou a submissão de líderes** (`getCargoDe`/`ehLideranca` re-lançam o 401; `podeFluxoDireto` nos 3 `iniciar*` não tem catch local → aborta). Hoje **todas** as leituras batem ao vivo na `api.teamguide.app` com cache só em memória por isolate (TTL 10min); sem token válido, não há snapshot de reserva. Ver memória `teamguide-token-expira-90-dias`.

**Decisões do Luis (já tomadas):** (1) espelho durável; (2) escopo **TUDO de uma vez** (todas as leituras do espelho); (3) alertas no **mesmo Chat de Ajuda** (`GOOGLE_CHAT_WEBHOOK_URL_AJUDA`, já setado); (4) base para um **agente de autocura futuro** (não implementar agora).

---

## Arquitetura (molde: `sheet-espelho.ts`)
- **Espelho = 2 coleções cruas normalizadas** (todos os índices — área, liderança, lista de pessoas — são PUROS sobre elas, não persistir índices):
  - `times`: `TGTeam[]` → `{ id:string, name, teamParent:string|null, leader:{id:string,name}|null, deleted? }` (⚠️ ids **em string na fronteira** — invariante `normalizarTimes`).
  - `pessoas`: união refs+members → `{ id:string, nome, email:lower|null, cargo:string|null, teamsIds:string[] }` (cargo dos refs, teamsIds dos members).
- **Fonte única de I/O na TeamGuide passa a ser o SYNC** (`tgGet` só ali); as funções de leitura leem do espelho.
- **Espelho é DERIVADO/INTERNO**: fora de `SAFE_UPDATE_FIELDS`, sync reverso não toca, pode apagar e reconstruir.

---

## O que foi entregue (execução)
- **T1 — Schema + acessores.** `teamguide_espelho(chave PK, dados, hash, atualizado_em)`, `teamguide_sync_runs`, `alerta_estado(chave PK, ultimo_em, contagem)` em `schema.ts` (sem `;` em comentário). Acessores em `client.server.ts`.
- **T2 — `src/lib/teamguide-espelho.ts`.** `sincronizarTeamGuide(gatilho)` (ÚNICO chamador de `tgGet`; nunca lança; falha/vazio preserva o espelho e dispara alerta), `lerEspelhoTimes/Pessoas`, `statusTeamGuideEspelho`, `garantirEspelhoTeamGuide` (auto-cura single-flight), `espelhoTeamGuideDisponivel`. Derivação PURA extraída para **`src/lib/areas/teamguide-derivacao.ts`** (evita ciclo de import).
- **T3 — Refactor `teamguide.server.ts` fail-safe.** As 9 funções leem um snapshot do espelho (TTL 60s/isolate) + try/catch → default seguro; `tgGet`/fetch saíram para o sync.
- **T4 — `src/lib/alertas.functions.ts`.** `alertarErroIntegracao(fonte, titulo, detalhe?)`: cooldown 30min por fonte (`alerta_estado`), webhook de AJUDA EXPLÍCITO, env lazy, nunca lança.
- **T5 — `src/lib/teamguide-token.ts`.** `diasParaExpirarTokenTG` (decodifica só o payload do JWT).
- **T6 — worker.ts.** `POST /api/cron/sync-teamguide` (guard `x-godeploy-cron`, sync + check de token <14d) e `GET /api/admin/integracoes-status` (requireAdmin).
- **T7 — Preservação de comportamento (autorizada pelo Luis).** `podeFluxoDireto` comentário; `submeterParaValidacao` preserva a área gravada (`?? projeto.area ??`); `abrirPreAprovacao` preserva o motivo `teamguide_indisponivel` via `espelhoTeamGuideDisponivel`.
- **T8 — Fechamento.** Suíte verde (2339), tsc +0 (7 pré-existentes do main), `worker.js` commitado. Docs (CLAUDE.md + esta) no PR.

---

## Critérios de aceitação
1. TeamGuide/token indisponível → **nenhuma** das 9 leituras lança; submissão de líder não bloqueia. ✅ `tests/teamguide-failsafe.test.ts`.
2. Leituras vêm do **espelho** quando populado; TeamGuide só pelo sync. ✅
3. Falha de sync dispara **1** `🔴 [SISTEMA]` (cooldown conta repetições). ✅ `tests/alertas.test.ts`.
4. Token < 14 dias → alerta proativo. ✅ `tests/teamguide-token.test.ts` + cron.
5. `GET /api/admin/integracoes-status` mostra idade do espelho e dias do token. ✅
6. Suíte verde; `worker.js` rebuildado. ✅

## Fronteiras (não exceder)
- **FORA:** alertas de LLM/Gomoon; agente de autocura; tela rica de saúde no `/dashboard`; rotação do webhook; troca do token (ops do Luis).
- **Op de PLATAFORMA (deploy):** `createCronJob` p/ `POST /api/cron/sync-teamguide` na staging e prod (`*/30`).

## Blast-radius (confirmado por explorador, confiança 0.85)
20 arquivos, faixa **profunda**. 3 callers throw-dependentes tratados (preservação): `podeFluxoDireto` (o incidente — fail-safe conserta), `deriveAreaFromEmail`/`submeterParaValidacao` (preserva área), `abrirPreAprovacao` (preserva motivo). `tgGet` não vaza. 3 testes de fetch migrados p/ espelho.
