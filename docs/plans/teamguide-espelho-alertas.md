# Plano — Espelho durável da TeamGuide + alertas de erro proativos
**Status:** ✅ aprovado (Luis, 2026-09-02)

**Objetivo:** Tirar a integração TeamGuide do caminho crítico — todas as leituras passam a ler de um **espelho SQLite** (a TeamGuide só o ATUALIZA por cron), tornando-as **fail-safe** — e adicionar um **sistema de alerta proativo** no Google Chat de Ajuda (incl. aviso de **expiração do token** ~14 dias antes), para descobrir problemas antes do cliente.

---

## Contexto
Incidente 01–02/09/2026: o `TG_API_TOKEN` (JWT de 90d) expirou e **derrubou a submissão de líderes** (`getCargoDe`/`ehLideranca` re-lançam o 401; `podeFluxoDireto` nos 3 `iniciar*` não tem catch local → aborta). Hoje **todas** as leituras batem ao vivo na `api.teamguide.app` com cache só em memória por isolate (TTL 10min); sem token válido, não há snapshot de reserva. Ver memória `teamguide-token-expira-90-dias`.

**Decisões do Luis (já tomadas):** (1) espelho durável; (2) escopo **TUDO de uma vez** (todas as leituras do espelho); (3) alertas no **mesmo Chat de Ajuda** (`GOOGLE_CHAT_WEBHOOK_URL_AJUDA`, já setado); (4) base para um **agente de autocura futuro** (não implementar agora).

---

## Arquitetura (molde: `sheet-espelho.ts`)
- **Espelho = 2 coleções cruas normalizadas** (todos os índices — área, liderança, lista de pessoas — são PUROS sobre elas, não persistir índices):
  - `times`: `TGTeam[]` → `{ id:string, name, teamParent:string|null, leader:{id:string,name}|null, deleted? }` (⚠️ ids **em string na fronteira** — invariante `normalizarTimes`).
  - `pessoas`: união refs+members → `{ id:string, nome, email:lower|null, cargo:string|null, teamsIds:string[] }`.
- **Fonte única de I/O na TeamGuide passa a ser o SYNC** (`tgGet` só ali); as funções de leitura leem do espelho.
- **Espelho é DERIVADO/INTERNO**: fora de `SAFE_UPDATE_FIELDS`, sync reverso não toca, pode apagar e reconstruir.

---

## Tarefas

- **T1 — Schema + acessores.** Em `schema.ts` (⚠️ sem `;` em comentário; `CREATE TABLE IF NOT EXISTS`): `teamguide_espelho(chave TEXT PK, dados TEXT, hash TEXT, atualizado_em INTEGER)` (linhas `chave='times'|'pessoas'`), `teamguide_sync_runs` (espelhar `sync_runs`: `id,gatilho,ok,total,duracao_ms,detalhe,iniciado_em`+índice) e `alerta_estado(chave TEXT PK, ultimo_em INTEGER, contagem INTEGER)` (dedup/cooldown). Acessores em `client.server.ts` (upsert/get por chave, insert/get runs, get/upsert alerta_estado). _(guarda: `initSchema` carrega sem quebrar; teste que as 3 tabelas existem e que `SCHEMA_SQL.split(';')` não parte nenhum CREATE.)_
- **T2 — `src/lib/teamguide-espelho.ts` (mirror + sync).** `sincronizarTeamGuide(gatilho)`: ÚNICO chamador de `tgGet` (busca `/teams`, `/employees/refs`, `/teams/{id}/members`), normaliza p/ os 2 arrays, **upsert hash-gated** (só grava se o hash mudou), `registrarCorridaTG` (nunca lança), e **no catch → dispara alerta** (T4). `lerEspelhoTimes()`/`lerEspelhoPessoas()` (parse do JSON). `statusTeamGuideEspelho()` (idade/última-ok). ⚠️ **leitura que falha ou vem vazia NÃO espelha nem apaga** (conjunto vazio = suspeito). _(guarda: teste de normalização de ids→string; hash-skip não reescreve linha igual; sync com fetch falho preserva o espelho anterior e não lança pro chamador.)_
- **T3 — Refatorar `teamguide.server.ts` p/ ler do espelho + FAIL-SAFE.** As 9 funções (`getCargoDe`, `ehLideranca`, `deriveAreaFromEmail`, `deriveAreasFromTeamGuide`, `buildLiderancaIndex`, `getLideresDe`, `getLideradosDe`, `listarPessoasTeamGuide`, `getNomeDe`) passam a montar seus índices a partir de `lerEspelhoTimes/Pessoas` (reusando `buildAreaIndex`/`construirIndiceLideranca` puros) e **cada uma envolve o acesso em try/catch → default seguro** (`null`/`[]`/`false`). `tgGet` sai daqui (vai pro T2). **Bootstrap/auto-cura**: espelho vazio/estagnado → `runBackground(sincronizarTeamGuide('sob-demanda'))` single-flight (flag de módulo), sem bloquear a leitura (que devolve default seguro até o espelho encher). _(guarda: os testes existentes `teamguide-lideranca`/`areas-teamguide`/`participantes-sugestoes` passam alimentados pelo espelho; NOVO teste: TeamGuide indisponível → `getCargoDe`/`ehLideranca` devolvem `null`/`false`, NÃO lançam.)_
- **T4 — `src/lib/alertas.functions.ts` (alerta proativo + cooldown).** `alertarErroIntegracao(fonte, titulo, detalhe?)`: dedup por `alerta_estado` (chave=`fonte`; envia só se `agora - ultimo_em > COOLDOWN` — ~30min —, senão incrementa `contagem` em silêncio) → formata `🔴 *[SISTEMA]* <fonte>: <titulo>` (texto markdown; inclui "(Nª ocorrência desde …)") → `sendChatNotification(msg, { webhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA })` via `runBackground`. ⚠️ **env LAZY dentro da função**; **webhook EXPLÍCITO** (sem env → pula, nunca cai no default do grupo de projetos); **NUNCA lança**. _(guarda: teste cooldown suprime repetição; teste que o webhook é o de AJUDA; teste que ausência de env NÃO chama `sendChatNotification`.)_
- **T5 — Alerta de expiração do token.** Pura `diasParaExpirarTokenTG(token?)`: decodifica só o payload do JWT (`exp`, sem verificar assinatura) e devolve dias restantes (ou `null` se ilegível). No cron (T6), se `< 14` → `alertarErroIntegracao('teamguide-token', 'expira em N dias (DD/MM)')` (cooldown do T4 evita spam diário). _(guarda: teste puro com JWT fixo expirado/expirando/válido.)_
- **T6 — Cron + endpoint de saúde.** Rota `POST /api/cron/sync-teamguide` (guard `x-godeploy-cron` → 403) → `sincronizarTeamGuide('cron')` + check do T5. `GET /api/admin/integracoes-status` (`requireAdmin`) → `{ teamguide: statusTeamGuideEspelho(), tokenDiasRestantes }`. _(guarda: teste do guard 403 sem header; `build:worker` ok.)_
- **T7 — Confirmar o destravamento do hot-path.** Com T3, `podeFluxoDireto`→`ehLideranca` já lê do espelho e devolve `false` em falha → líder cai no fluxo NORMAL em vez de abortar. Atualizar o comentário `chat.functions.ts:702` p/ refletir a verdade. _(guarda: teste — espelho vazio + TeamGuide down → `podeFluxoDireto` = `false` e `iniciarSubmissao` não lança.)_
- **T8 — Fechamento técnico.** `npm run test` verde; `npm run build && npm run build:worker` e **commitar `worker.js`** (regra 1); atualizar `CLAUDE.md` (seção nova "Espelho da TeamGuide + alertas") e `spec-docs/` (regra 12); memória `teamguide-token-expira-90-dias` marcada como mitigada. _(guarda: suíte verde + `grep` de conflito vazio.)_

---

## Critérios de aceitação
1. Com a TeamGuide/token indisponível, **nenhuma** das 9 leituras lança; submissão de líder **não** é bloqueada (cai no fluxo normal). Verificável por teste que simula fetch 401.
2. Todas as leituras (cargo, liderança, área, participantes, nome) devolvem o dado do **espelho** quando ele está populado; a TeamGuide só é tocada pelo **sync**.
3. Uma falha de sync da TeamGuide dispara **1** mensagem `🔴 [SISTEMA]` no Chat de Ajuda (não N); repetições dentro do cooldown são contadas, não reenviadas.
4. Token a < 14 dias de expirar → alerta proativo (hoje dispararia, pois expira ~10/09).
5. `GET /api/admin/integracoes-status` mostra idade do espelho e dias restantes do token.
6. Suíte verde; `worker.js` rebuildado e commitado; sem prompts de IA alterados.

## Fronteiras (não exceder)
- **FORA:** alertas de LLM/Gomoon (o helper `alertarErroIntegracao` é genérico, mas só a TeamGuide — e, se sair barato, a falha de `sync_runs` do Sheets — são fiadas agora). **Agente de autocura** (só deixar a base: espelho + auto-cura + alerta). Tela rica de "saúde" no `/dashboard` (só o endpoint agora). Rotação do webhook de Ajuda (op do Luis). Troca do token pela string longa `U3FvBA` (op do Luis, independente).
- **Op de PLATAFORMA (não é código, faço no deploy):** `createCronJob` p/ `POST /api/cron/sync-teamguide` na **staging** e na **prod** (cadência sugerida **`*/30`**, a árvore muda devagar).

## Blast-radius
Arquivos: `schema.ts`, `client.server.ts`, **novo** `teamguide-espelho.ts`, **novo** `alertas.functions.ts`, `areas/teamguide.server.ts` (refactor grande), `worker.ts` (2 rotas), `chat.functions.ts` (só comentário :702). · Dependentes: 7 importadores de `teamguide.server.ts` (`auth.functions`, `analyzer`, `participantes.functions`, `chat.functions`, `aprovacoes.functions`, `areas.functions`, `worker`) + ~8 testes (`teamguide-lideranca`, `areas-teamguide`, `participantes-sugestoes`, `aprovacoes-lider`, `dispensa-fila-lider`, `notificacao-chat`, `aprovacoes-notifica-chat`, `dashboard-parecer-lider`). · Invariantes: env lazy (nunca em escopo de módulo); `sendChatNotification`/sync/alerta **nunca lançam**; webhook de Ajuda EXPLÍCITO (não cair no default); leitura vazia/falha nunca apaga o espelho; ids→string na fronteira; D3 `abrirPreAprovacao` segue coberto; D20 isenção pelo **cargo** (persistir `position`); `getNomeDe` continua fail-safe; guard `x-godeploy-cron`; `runBackground`/`waitUntil`; sem `;` em comentário do schema; `worker.js` commitado; staging antes de prod. · Confiança: **média** (sem `docs/INDEX.md`/`invariants.md` — RF-35; a varredura profunda de dependentes fica pro `/ggsd:code`).

## Spec (verdade funcional)
Muda a verdade funcional (novo comportamento de resiliência: leituras fail-safe + capacidade de alerta). Este repo **não usa EARS/`SPEC.md`** — a spec vive em `spec-docs/*.md` + `CLAUDE.md` (regra 12), atualizados no MESMO PR do `/ggsd:code` (T8). Sem artefato EARS a criar aqui.
