# Plano — Base TeamGuide: liderança + furo de áreas + paginação (F0 da pré-aprovação do líder)
**Status:** ✅ **executado e commitado** (2026-08-03, `c9991be`) — e a sessão seguinte já entregou **F1 + F2**
no mesmo commit. Falta só validar na staging → prod → PR (ver `spec-docs/SPEC_APROVACAO_LIDER.md` §7).

> **F3 entregue em 05/08/2026 (`f6110a2` + `ec2cfe4`, 1078 testes) — o aviso diário ao líder.** A DM saiu do
> nosso lado (D17): o GoDocs manda **1 POST/dia às 09h BRT** (`0 12 * * 1-5` UTC) com a RELAÇÃO
> líder↔liderados-pendentes e o **bot do Gomoon** entrega. Agregada `getPendenciasPorLider` +
> `src/lib/gomoon-lideres.functions.ts` + cron `/api/cron/notificar-lideres` + manual
> `/api/admin/notificar-lideres` (`{"dry":true}` não envia). **Validado na staging:** 202 → `entregue`, o
> líder real do payload **não** recebeu (proteção do `ambiente:"staging"`), POST repetido → `ja_entregue`.
> Contrato dos 2 lados + decisões em `docs/integracao-gomoon-chat.md` §11–12. Falta `GOMOON_TOKEN` + cron
> **na prod**.

> **Fecho da tarde de 03/08 (`1296e12` + `e4780cb`), fora do escopo original do plano F0:** entrou a **D12**
> (rótulo próprio para os 3 casos sem fila — liderança grava **`Pré-aprovado (liderança)`**, via a função
> pura `rotuloIsencaoSheet`) e a **DM foi LIGADA na staging** a pedido do Luis, para o teste real com o
> líder dele (secrets `GOOGLE_CHAT_DM_ENABLED=true`/`CHAT_SA_*`/`GOOGLE_CHAT_DM_SUBJECT` no `edf400b4`;
> prod segue no-op). Aprendizado de credencial: **só a SA `planilha-jg@` tem a DWD de Chat** — a `godocs@`
> do Sheets devolve `401 unauthorized_client`, então a fallback `GOOGLE_SA_*` do `chat-dm.ts` não serve.
> 848 testes verdes. O que resta do plano é **validação humana**, não código.

> **Nota da sessão de 03/08 (F1+F2):** o Luis pediu a implementação direta, **sem rodar os revisores de
> contexto fresco** — os 3 marcadores de gate ficaram ausentes e o commit saiu com a suíte verde (845 testes)
> como única trava. Decisão dele, registrada aqui para não parecer gate furado.
> Nesta rodada entrou também a **D11** (liderança é isenta de pré-aprovação), que não existia no plano F0.

> **T1–T6 implementados**; 824 testes verdes (baseline 805); `worker.js` rebuildado.
> **Não commitado** porque a sessão fechou **suja**: os 3 revisores de contexto fresco
> (`verificador-conformidade`, `revisor-qualidade`, `revisor-reuso`) foram disparados mas a
> janela acabou antes dos vereditos — `.claude/.review-status` e `.claude/.quality-status`
> seguem em `pendente`, e os gates barram o commit. **Retomar = re-rodar os 3 revisores,
> gravar os vereditos e commitar** (nada de código a escrever).
>
> **Achado que quase passou:** os testes autorados às cegas usavam ids **string**; a API real
> devolve ids **numéricos** — todo `map.get(String(id))` errava em silêncio e tudo voltava
> `null`. Só o **smoke contra a API real** pegou. Fix: `normalizarTimes()` na fronteira +
> 2 guardas de regressão com ids numéricos.
>
> **Validado ao vivo (read-only, `TG_API_TOKEN` do `.env` da raiz):** `luis.albuquerque@` →
> Lucas Gonçalves Queiroz (área RPA) · `rafael@` → **sem líder** (D6), área "N1" · 432 pessoas
> no índice com **exatamente 1** sem líder (bate com a spec) · as pessoas do bug 3.2 resolvem
> (BIZOPS · OPERAÇÕES · TIME JOAQUIM QUINDERE · N1 - LUIS LIVERI).

_Status anterior:_ ✅ aprovado (Luis, 2026-08-03)

**Objetivo:** deixar `src/lib/areas/teamguide.server.ts` capaz de responder **quem é o líder direto de um e-mail** (insumo da F1 de pré-aprovação) e, no caminho, fechar os 2 bugs achados na integração atual — a **paginação morta** e o **"ÁREA NÃO IDENTIFICADA" que atinge 10 pessoas**.

> Contexto e decisões (D1–D10): `spec-docs/SPEC_APROVACAO_LIDER.md` (na branch `worktree-plano-aprovacao-lider-teamguide`, commit `81da73d`). Esta é a **fatia F0** de lá — nada de UI, tabela ou DM nesta sessão.

### Tarefas

- **T1 — Paginação real (`pageNumber`/`pageSize`, teto 100).** O `fetchMembersByText` usa `?page=N`, que a API **ignora** (no OpenAPI `page` é objeto `{pageNumber,pageSize}`) → toda listagem lê só os 25 primeiros e o `break` de página parcial nunca dispara. Trocar por `pageNumber`/`pageSize=100` e parar por **página parcial OU página sem ids novos** (defesa contra param ignorado — foi exatamente o modo de falha).
  _(guarda: teste com fetch dublado que devolve SEMPRE a mesma página → o loop encerra em vez de girar até o limite; e um caso de 2 páginas + parcial que acumula os dois lotes)_

- **T2 — Fallback de área para nós de diretoria/passthrough.** `buildAreaIndex` cobre 121/129 times; os 8 descobertos são as raízes (`Gogroup`, `N1`, `N1 - GUILHERME NOBREGA`, `N1 - LUIS LIVERI`) e os passthrough (`BIZOPS`, `MKT | PRODUTO | B2B GOCASE`, `OPERAÇÕES`, `TIME JOAQUIM QUINDERE`) — quem está alocado **no** nó guarda-chuva cai no vazio (**10 pessoas**). Adicionar 2ª camada no `areaByTeamId`: nó ainda descoberto → **nome do próprio nó** (D5), aplicada **depois** da camada de área normal.
  _(guarda: teste prova que quem está no nó passthrough e na raiz resolve para o nome do nó, e que os já cobertos **não mudam**)_

- **T3 — `deriveAreaFromEmail` sobre `GET /employees/emails/{email}`.** Remover a busca por **nome** (tokens do local-part, que erra em homônimo e em e-mail fora do padrão `nome.sobrenome@`) e resolver pelo e-mail exato + índice de membros por `contactEmail`. Manter assinatura e o `null` de saída (o chamador segue decidindo o aviso).
  _(guarda: teste de e-mail existente, inexistente, case-insensitive e pessoa fora dos domínios mapeados — os 5 casos do teste atual seguem verdes com a implementação nova)_

- **T4 — `buildLiderancaIndex()` + `getLideresDe()` / `getLideradosDe()`.** Derivar líder↔liderado de `/teams` (tem `leader` + `teamParent`) + membros: **líder de P = líder do time de P; se P é o líder daquele time, sobe pro pai e repete** (D7 — os endpoints `/employees/{id}/leaders`, `/leaders/{id}/led` e `/employees/{id}/teams` dão **403** com o `TG_API_TOKEN`; não tentar de novo). Multi-time devolve **todos** os líderes (D4). Cache por isolate, como o cache de token.
  _(guarda: testes sobre a fixture — Rafael/CEO sem líder (D6); pessoa que **é** líder do próprio time sobe pro pai (caso Adyla→Simony); multi-time devolve 2 líderes; ciclo na árvore não trava)_

- **T5 — Corrigir o D9 da `spec-docs/SPEC_APROVACAO_LIDER.md`.** A credencial de Chat já está no `.env` (`CHAT_SA_*` + `GOOGLE_CHAT_DM_SUBJECT` + `GOOGLE_CHAT_DM_ENABLED=false`) e foi **validada em 03/08/2026** (troca de JWT por `access_token` com `sub=rpa_ia@gocase.com` e os 2 escopos de Chat retornou OK, sem enviar mensagem). Logo a **F2 não está mais bloqueada** pela DWD: o código preferirá `CHAT_SA_*` com fallback `GOOGLE_SA_*` (padrão do `GMAIL_SA_*`), e a DWD da SA `godocs@` passa a ser faxina (apagar 2 linhas do `.env`), não pré-requisito.
  _(guarda: revisão de texto — sem código; o D9 e o §6/P1 param de dizer "bloqueia a F2")_

- **T6 — `npm run test` verde** (regra 2 do `CLAUDE.md`). `teamguide.server.ts` é server-side importado pelo worker → **se o bundle mudar, rodar `npm run build:worker` e commitar o `worker.js`** (regra 1). Conferir no fim.

### Critérios de aceitação

1. `tests/areas-teamguide.test.ts` (+ novo `tests/teamguide-lideranca.test.ts`) verdes, cobrindo: paginação que para em página repetida, os 10 casos de área hoje descobertos, os 5 casos atuais de `deriveAreaFromEmail` e os 4 de liderança (CEO sem líder, líder-do-próprio-time, multi-time, ciclo).
2. `getLideresDe('luis.albuquerque@gocase.com')` devolve **Lucas Gonçalves Queiroz**; `getLideresDe('rafael@gocase.com')` devolve **lista vazia** (não erro, não exceção).
3. Nenhuma das 422 pessoas que hoje resolvem área muda de área (o fallback só age onde antes era `null`).
4. `npm run test` verde e, se o bundle do worker mudar, `worker.js` rebuildado e commitado.
5. O D9 e o §6 da `SPEC_APROVACAO_LIDER.md` refletem que a F2 não está bloqueada pela DWD.

### Fronteiras (não exceder)

- **FORA:** tabela `projeto_aprovacoes`, aba "Aprovações do meu time", rotas `/api/aprovacoes/*`, coluna `Aprovação do Líder` no Sheets — tudo isso é **F1**.
- **FORA:** `src/lib/google/chat-dm.ts` e qualquer envio de DM — é **F2** (e o gate `GOOGLE_CHAT_DM_ENABLED` fica `false`).
- **FORA:** mexer na regra de quem é raiz/passthrough (`DOMAIN_LEADERS`/`PASSTHROUGH_LEADERS`) — o fallback do T2 age **depois** dela, sem redefini-la.
- **FORA:** deploy. Staging/prod entram na sessão seguinte (regra 13), não aqui.
- **FORA:** pedir a DWD da SA `godocs@` (P1) — é pendência humana, não código.

### Blast-radius

**Arquivos:** `src/lib/areas/teamguide.server.ts` (único de produção) · `tests/areas-teamguide.test.ts` · `tests/teamguide-lideranca.test.ts` (novo) · `spec-docs/SPEC_APROVACAO_LIDER.md` (T5, texto).

**Dependentes:** `src/lib/chat.functions.ts:2575` (`deriveAreaFromEmail` dentro de **`submeterParaValidacao`** — ⚠️ **caminho quente da submissão**; hoje o `try/catch` preserva a área anterior em exceção e grava "ÁREA NÃO IDENTIFICADA" em `null`, comportamento a **preservar**) · `src/lib/areas.functions.ts` (`deriveAreasFromTeamGuide` — cron diário + botão do admin) · `src/lib/participantes.functions.ts` (`listarPessoasTeamGuide` — autocomplete da Etapa 1).

**Invariantes:** `docs/invariants.md` **não existe** neste projeto → sem INV-XX formal. Os invariantes efetivos vêm do `CLAUDE.md`: **nunca ler `process.env` em escopo de módulo** (o `getToken()` atual já faz certo — manter lazy), **`worker.js` commitado** se o bundle mudar (regra 1), **testes após qualquer modificação** (regra 2), **PT-BR com acentos** (regra 4), **spec atualizada no MESMO PR** (regra 12). Mais um não-escrito: a **cota da API TeamGuide é compartilhada** — `buildLiderancaIndex` é ~6 chamadas, então **cachear** e nunca chamar por item dentro de listagem.

**Confiança: média.** Sem `docs/INDEX.md`/`invariants.md`, o mapa de dependentes acima saiu de grep direto (4 call-sites, todos lidos) — mas a **varredura completa é papel do `/ggsd:code`**, em especial nos consumidores indiretos do caminho de submissão.

### Nota de ambiente (não é parte da fatia)

Os hooks do GGSD (`gate-d.sh`/`plan-gate.sh`) resolvem o projeto pela **raiz do repo**, não pelo worktree. Como o worktree fica *dentro* de `/home/notebook/godocs-main/.claude/worktrees/`, o caminho relativo vira `.claude/worktrees/…/docs/…` e **não casa a allowlist `docs/**`** → toda escrita é recusada lá. Por isso os docs vivos do GGSD (este plano, o `INDEX.md`, o `NEXT-SESSION.md`) ficam na **raiz**, e a flag `.claude/.planning-mode` também. O **código** da F0 segue indo para worktree (regra 8 do `CLAUDE.md`) — e ali o `plan-gate` só libera porque este plano, na raiz, estará `aprovado`.
