# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-28 (código) — **`/dashboard` do admin virou a tela de triagem sobre a PLANILHA**,
branch `feat/dashboard-admin-sheets`, commit `5ef927a`. A tela lia o **SQLite** (`getProjetos` →
`getProjetosWithArea`) e por isso mostrava **rascunho** e um **status que não é fonte de verdade** (o sync
reverso exclui `status` de propósito). Agora lê `readAllRows()`. Entregue: busca instantânea
(projeto/autor/e-mail/ID/área, sem acento, tokens em AND, atalho `/`), **filas de status com contagem ao
vivo**, ordenação, paginação 25/50/100, **ficha em overlay** com a linha inteira agrupada (coluna
desconhecida cai em "Outras colunas") e **mudança de status gravando no Sheets** + auditoria
`admin_status_log`. **620 testes verdes** (29 novos), `build` + `build:worker` OK, `worker.js` recomitado,
spec `spec-docs/SPEC_DASHBOARD_ADMIN.md` (D1–D8) + `CLAUDE.md`/`docs/` atualizados. Também **removido o
aviso do BUG ABERTO de edição de legado** do `CLAUDE.md` — o Luis confirmou que já foi resolvido.

_(Antes desta: 2026-07-22/23 — `aceitar-zip-submissao` executada, mergeada (PR #213) e em prod.)_

**Última sessão (2026-07-28, planejamento):** nova frente — **as perguntas do agente**. O pedido original
era um "agente porteiro" que barrasse submissões fora de critério (caso da **nuvem de palavras**); foi
**descartado** na conversa do Luis com o Rafa: os critérios ainda não estão fechados, e barrar sem critério
troca um problema por um pior. O alvo virou **cortar a redundância das perguntas** e embutir os 3 critérios
do Rafa (recorrência · contrafactual · rastreabilidade) nas perguntas que já existem. O **T1 foi executado
nesta sessão** (o Luis liberou o `E2E_COOKIE`): **24 conversas reais de prod** medidas em
[`analise-perguntas-agente.md`](analise-perguntas-agente.md) — **154 perguntas / 6,4 por submissão**, 62% na
fase saving, **34% vindas dos 4 gates**, 13 perguntas **depois** do preview. Dois achados que a leitura de
código não pegava: **A1** — o gate da alocação **só aceita "mais saída" e rejeita "menos custo"** (caso
`e57b287a`: usuário informou **redução de 3 auxiliares** → 5 reperguntas; `60b97477`: **corte de hora
extra** → 4), com o juiz do preview mandando recusar _"mesmo que o usuário diga aprovado"_ **sem contador
anti-loop**; **A2** — os gates **ignoram materialidade** (`897df986` economiza **0,05h/mês** e recebe o gate
das 220h/fim de semana), contra a regra que o próprio prompt já tem. **Nenhum código alterado.**

**Última sessão (2026-07-28, operação + planejamento):** fechou o **T8 do dashboard** e abriu a frente dos
**loadings**. (a) `feat/dashboard-admin-sheets` deployada no **staging `edf400b4`**, validada no navegador pelo
Luis e depois em **prod `674a3710`** — mesmos artefatos/hashes nos dois; branch no remoto (`990250e`); **o PR
não foi aberto** porque o `gh pr create` é bloqueado pelo classificador de permissões local (corpo pronto,
conta `gh` em `LuisEduardo100`). (b) **Admin concedido via secret `ADMIN_EMAILS`** (rotaciona sem redeploy):
`bruno.bezerra@gocase.com` em prod **e** staging, `luiza.rios@gocase.com` em prod; `.env` sincronizado.
⚠️ Registrado que **admin não é granular** — dá acesso a TODAS as telas do grupo `_authenticated`
(dashboard, investigador, email-legados, areas, usuarios, testes) + override de edição. (c) O relato "**só 1
descontinuado**" **não era bug**: a tela lê 100% do Sheets. Medido via Service Account — aba **GoDocs**
478 Aprovado / 40 Pendente / 15 Reenvio Pendente / **11 Descontinuado** (544 linhas com ID); aba **STAGING**
287 / 32 / 23 / **1** (343 linhas), ou seja a staging é uma **cópia antiga**. De quebra: a coluna "Status"
está em **posições diferentes** nas duas abas (índice 29 vs 30) e o mapeamento por nome absorveu.
⚠️ **Dado novo para a decisão do dropdown:** `Reprovado` e `Em validação` **não existem em nenhuma das 887
linhas** — os 4 valores reais são Aprovado · Pendente · Reenvio Pendente · Descontinuado. (d) Planejada e
**aprovada** a frente dos loadings (ver Plano ativo). **Nenhum código alterado nesta sessão.**

## Plano ativo
**→ [docs/plans/perguntas-agente-recorrencia-evidencia.md](plans/perguntas-agente-recorrencia-evidencia.md)** ·
Status: ✅ **aprovado (Luis, 2026-07-28)** — T1 executado; pronto para `/ggsd:code` (ordem: **A1** taxonomia de
impacto + anti-loop no juiz do preview · **A2** materialidade nos gates · **T2** régua do Rafa em paralelo ·
**T4** fluxo de coleta). **Barrar submissão está FORA em definitivo.**

_[loadings-dashboard-admin](plans/loadings-dashboard-admin.md) saiu de ativo: **✅ executado** (commit
`3b93c65` em `feat/loadings-dashboard-admin`), resta só o **T6 operacional** — staging → prod → PR._

### Sessão de código 2026-07-28 (loadings do /dashboard) — o que ficou
Codados T1–T5: **SWR** em `lerPlanilha` (cache vencido volta na hora + revalidação em `runBackground`,
single-flight preservado, `revalidando` no payload) · **auth em `sessionStorage`** (`src/lib/auth-cache.ts`,
TTL 5 min, revalidação em background) · **prefetch** da planilha em paralelo ao `/api/auth/me`
(`src/lib/dashboard-prefetch.ts`) · **skeleton** (`components/dashboard/skeleton-linhas.tsx`) com filas
visíveis e chip "Atualizando em segundo plano". **658 testes verdes** (+38), `worker.js` recomitado, spec
**D9/D10** + `CLAUDE.md` (gotchas 3 e 7).
O revisor de qualidade em contexto fresco pegou **1 ALTA já corrigida**: a correção da linha no cache era
apagada pela revalidação em voo → o status recém-decidido voltava atrás por até 60 s. Corrigido com patch
por projeto reaplicado nas leituras iniciadas antes da escrita + guarda de época/sequência; `?refresh=1`
não herda leitura em voo; `STALE_MAX_MS` (10× TTL) volta a bloquear se o Sheets falhar; prefetch com teto
de 15 s. Conformidade: `diverge-baixa` (nada fora das Fronteiras).
⚠️ **`CLAUDE.md` está em ~45k chars** (limite recomendado 40k, já estava 44,2k no `main`) — vale uma sessão
de enxugamento.

Melhorar os **loadings do `/dashboard`** (pedido do Luis em 2026-07-28, escopo escolhido por ele): SWR no
servidor · cache de auth em `sessionStorage` · leitura em paralelo com o auth · skeleton. **Cache em SQLite
ficou FORA por decisão dele** (não reintroduzir SQLite no caminho de leitura). Sai de um worktree sobre a
branch `feat/dashboard-admin-sheets` (os arquivos não existem no `main` ainda).

**⚠️ Frente PARALELA, não sobrescrita —
[perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** · Status:
✅ **aprovado (Luis, 2026-07-28)** — T1 já executado; **pronto para `/ggsd:code`**. Escopo ampliado por ele
no fim da sessão: além das perguntas, entra o **fluxo de coleta** (T4 — onde cada informação deve ser
colhida: formulário × conversa × já sabido), e **barrar submissão está FORA em definitivo** (se voltar,
exige plano próprio). Ordem de ataque: **A1** (taxonomia de impacto + anti-loop no juiz do preview) e **A2**
(materialidade nos gates) primeiro — não dependem da régua do Rafa; **T2** (régua) em paralelo, para ele levar. Não é bloqueada por este plano nem o
bloqueia — as duas coexistem (ADR-026). **A fase de código recusa executar qualquer plano em rascunho** (RF-03).

_(Antes desta:)_ **Nenhum plano `aprovado` pendente de código.** [`dashboard-admin-sheets`](plans/dashboard-admin-sheets.md)
está **✅ executado** (T1–T7). **Falta o T8, que não é código:** deploy no **STAGING `edf400b4`** → validar
no navegador → **PROD `674a3710`** → PR (regras 13 e 10). Nova frente de código → `/ggsd:plan` primeiro.

_(Executados recentes: [aceitar-zip-submissao](plans/aceitar-zip-submissao.md) ✅ mergeado+prod;
[ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ mergeado (PR #210);
[edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md) ✅ executado — resta a validação T5,
ver pré-req das colunas abaixo.)_

## Próximo passo (setado)
**T6 do plano dos loadings (operacional, não é código):** na branch `feat/loadings-dashboard-admin`
(worktree `.claude/worktrees/loadings-dashboard-admin`, commit `3b93c65`) → `git fetch origin` + incorporar
`origin/main` → `npm run test && npm run build && npm run build:worker` → deploy no **STAGING `edf400b4`**
(`scripts/deploy-godeploy.sh`, lista de assets derivada do `dist/` real) → **validar no navegador** (reload não
deve mostrar "Verificando permissões"; skeleton em vez de spinner; as duas chamadas em paralelo na aba Network;
mudar um status e conferir que ele NÃO volta atrás depois de ~1 min) → **PROD `674a3710`** → PR (regras 13 e 10).
Depois disso, a frente das **perguntas do agente** (plano ativo) com `/ggsd:code`.

⚠️ **PR #214 (dashboard de triagem) foi MERGEADO** no `main` (`e878bc1`) nesta sessão; o worktree
`dashboard-admin-sheets` e a branch local foram removidos.
