# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

> **▶ PRÓXIMO PASSO:** validar no **staging** (`https://godocs-staging.devgogroup.com/`) o fluxo refinado do
> critério de projeto — submeter um projeto novo e conferir (a) o **agente pedindo o ponteiro movido + onde
> verificar** no chat, e (b) o seletor **pessoa/time** em "quem reclama" na Etapa 2 — e os 3 cenários dos
> critérios de aceitação; **depois** prod `674a3710` → PR, com a régua calibrada com o Rafa.

**Última sessão:** 2026-07-29 (código, 2ª rodada) — **refinamento pós-staging do critério de projeto**
(pedido do Luis depois de ver a Etapa 2 na staging), branch `feat/criterios-projeto-classificacao`, commit
`b6485e4`, **726 testes verdes**, staging `edf400b4` redeployado. Duas mudanças de **onde** a informação é
coletada (D5 da spec revisado + D5b novo):
- **O ponteiro movido saiu do formulário e virou trabalho do AGENTE.** Os cards "moveu o ponteiro de quê?" e
  o campo "onde isso pode ser verificado?" foram removidos da Etapa 2; entrou a seção obrigatória **`[1.4]`
  "Ponteiro movido e onde verificar"** no `MEMORIAL_ESQUELETO` (3 modos) + condução no `orchestrator.ts`: o
  agente pergunta **1×** qual ponteiro moveu (`type:"options"`) e **1×** onde alguém abre e confere,
  **constrói o racional junto com a pessoa**, e se ela não souber onde conferir **registra isso e segue**
  (→ zona cinzenta, **nunca** reprovação automática); não pergunta se a doc aprovada já responde.
  ⚠️ `ponteiro_movido`/`ponteiro_evidencia` são colunas **LEGADO** — nada mais as escreve; **não
  reintroduzir os cards de ponteiro na Etapa 2**.
- **"Se desligar isso hoje, quem reclama?" virou seleção da Team Guide**, com filtro **dinâmico**: pessoa
  (autocomplete nome/e-mail, mesma lista da Etapa 1 — cache de módulo, sem refetch) **ou** time/área inteiro
  (`GET /api/areas`), para não marcar pessoa por pessoa quando o impacto é do time todo. Novo
  `AfetadosInput` + coluna `contrafactual_afetados` (`"pessoa:a@x;b@y"` | `"time:Fiscal;CX"`) com
  serialização pura testada. Só **"E o que piora?"** segue texto livre (premissa que assumi: o texto do
  "o que piora" continua, porque é o sinal do contrafactual — se o Luis quiser cortar, é 1 linha).
- **Reuso:** o posicionamento do dropdown por portal foi extraído para o hook **`useDropdownAnchor`**,
  compartilhado agora pelos autocompletes das Etapas 1 e 2 (eram ~40 linhas duplicadas).
⚠️ **Ainda não validado no navegador** — o fluxo do agente pedindo o ponteiro só aparece no chat.
⚠️ **Prod (`674a3710`) e PR não foram tocados** nesta rodada, por decisão de fechamento de sessão.
### Análise de fechamento (29/07, sem código) — onde cada informação deve ser colhida
O Luis perguntou se o **"o que piora"** deveria ser determinístico na Etapa 2 ou ir para o agente. Conclusão:
**manter determinístico**, porque a régua é assimétrica — no **ponteiro** o valor está na **argumentação**
("no sistema" não é resposta; alguém tem de empurrar → agente), no **contrafactual** o valor está na
**presença** (frase que o analisador e a triagem leem inteira → form garante que existe). Depender de prompt
para o critério que reprova já falhou 2× neste repo (Seção 2.4 dos ≥44h; loop do split carga×escala). Além
disso "quem reclama" + "o que piora" são o MESMO pensamento — separar quebra o par e gasta turno contra a
métrica de 6,4 perguntas/submissão.

**Duas pendências que saíram dessa análise (nenhuma codada):**
1. **O agente não recebe o contrafactual.** Verificado: o `orchestrator.ts` só vê `descricao_breve` + a doc
   (as ocorrências de "contrafactual" lá são do *saving contrafactual*, outro conceito). Fraqueza da escolha
   acima: texto livre em form atrai linha preguiçosa e **ninguém cobra**. Arranjo proposto — **o form garante
   que existe, o agente garante que presta**: injetar `contrafactual_afetados`/`contrafactual_reclamacao` no
   contexto do memorial e aprofundar **1× SÓ se vago**, calando quando concreto (~1 campo no ctx + 3 linhas
   de prompt).
2. **RECORRÊNCIA — o 1º critério da régua — não é perguntada em lugar nenhum.** Nem form, nem agente: o
   analisador **infere** do "Execução/trigger" da doc + do "já está em produção?" da Etapa 1. É justamente o
   critério que reprova a **nuvem de palavras**, e é o único dos três por inferência — doc bem escrita fura.
   **Recomendação:** pergunta determinística de **1 clique** na Etapa 2 ("com que frequência roda hoje:
   agendado · por evento · sob demanda · rodou uma vez") — é **fato, não julgamento**, e fecha a régua.

⚠️ **`CLAUDE.md` desta branch está em ~44,6k chars** (limite recomendado 40k) — vale um enxugamento em PR
próprio; a seção do critério de projeto já foi escrita condensada.

_(Antes desta:)_ **2026-07-29 (código, 1ª rodada)** — **executado o plano do critério de projeto** (T1–T7), branch
`feat/criterios-projeto-classificacao` (worktree `.claude/worktrees/criterios-projeto`, criada de
`origin/main` `ad64895` + merge). Entregue: **(T1)** 2 perguntas determinísticas na Etapa 2 — *"moveu o
ponteiro de quê?"* (cards multi: Custo · Receita · KPI · **Nenhum/ainda não sei**, que **passa**), *"onde
isso pode ser verificado?"* (rastreabilidade, obrigatória só com ponteiro concreto) e *"se desligar hoje,
quem reclama?"*; **(T2)** seção obrigatória **"Processo alterado"** no `MEMORIAL_ESQUELETO` (3 modos) +
instrução anti-redundância nos prompts (não pergunta quando a doc já traz a magnitude, máx. 1 pergunta);
**(T3)** o analisador classifica **claro sim / zona cinzenta / claro não** com justificativa SEMPRE, via as
funções PURAS `normalizarClassificacao` (nunca reprova sem motivo · especial nunca reprova · >R$5k → zona
cinzenta · fallback da justificativa) e `decidirStatusSubmissao` (status interno **e** rótulo do Sheets no
mesmo lugar); **(T4)** 3 colunas por NOME (`Classificação` · `Motivo Reprovado` · **`Motivo Reenvio`, que o
sistema NUNCA escreve**) + 6 colunas SQLite + o cron de reconciliação repondo `Classificação` vazia;
**(T5)** modal de triagem do `/dashboard` grava os motivos em coluna própria, **sem tocar `Observações`**;
**(T6)** o **autor vê o motivo** (aviso "Projeto reprovado" no card de Meus Projetos + bloco em
`/projeto/$id`); **(T7)** régua de 1 página para o Rafa + `spec-docs/SPEC_CRITERIOS_PROJETO.md` (D1–D10).
**723 testes verdes** (+65), `build` + `build:worker` OK (`worker.js` recomitado), `CLAUDE.md`/`docs/`
atualizados (entrando enxugando: o bullet de carga×escala e o de alocação de ganhos foram condensados).
De quebra, **reuso em vez de duplicação**: o card de checkbox foi extraído da Etapa 2.5 para
`CardCheckboxGroup` e agora serve às duas telas.
⚠️ **Os 3 cabeçalhos foram conferidos na planilha** em 29/07: `GoDocs` já tinha as colunas; a aba `STAGING`
**não** tinha e o Luis as criou na hora (as duas abas agora com 51 colunas, grafia idêntica).
⚠️ **Revisores de contexto fresco NÃO rodaram** — decisão do Luis nesta sessão (as instruções da sessão
restringem subagentes); a revisão do diff (30 arquivos) acontece na validação em staging.

_(Antes desta:)_ **2026-07-29 (planejamento)** — nova frente, pedida pelo Luis: **apertar o critério de
projeto** (o pedido do Rafa, caso da **nuvem de palavras**). Plano ✅ **aprovado** em
[`docs/plans/criterios-projeto-classificacao.md`](plans/criterios-projeto-classificacao.md). Escopo: (a) **2
perguntas determinísticas na Etapa 2** — "moveu sensivelmente o ponteiro de custo/receita/KPI?" + "onde isso
pode ser verificado?" (rastreabilidade, que hoje **não existe** em lugar nenhum) e "se desligar hoje, quem
reclama e o que piora?" (contrafactual); (b) **"que processo mudou e quanto?"** vira seção obrigatória do
`MEMORIAL_ESQUELETO`, perguntada pelo **agente** só quando a doc não traz a magnitude; (c) o **analisador
classifica** em **claro sim / claro não / zona cinzenta**, **sempre** explicando o porquê, com
`normalizarClassificacao()` puro (nunca reprova sem motivo; especial nunca reprova automático; >R$5k → zona
cinzenta); (d) `claro não` grava **`Reprovado`** na coluna Status — **única exceção** à regra TEMPORÁRIA do
"Pendente", que continua valendo para todo o resto; (e) 3 colunas **já criadas pelo Luis** na planilha
(`Classificação` sempre preenchida · `Motivo Reprovado` · `Motivo Reenvio`, esta **só humana**); (f) modal de
triagem do `/dashboard` grava os motivos em coluna própria, **sem tocar em `Observações`** (que o disparo de
e-mails usa). **Barrar submissão continua FORA em definitivo** — a reprovação é pós-envio, no analisador.
Achado que economiza trabalho: **`Reprovado` já existe** em `STATUS_GRAVAVEIS` e no `StatusBadge` (PR #214), e
**`usa_ai_proxy` é o padrão exato a clonar** para as perguntas novas da Etapa 2. **Nenhum código alterado.**

_(Antes desta:)_ **2026-07-28 (código)** — **`/dashboard` do admin virou a tela de triagem sobre a PLANILHA**,
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
**→ [docs/plans/criterios-projeto-classificacao.md](plans/criterios-projeto-classificacao.md)** ·
Status: ✅ **executado (2026-07-29)** — código completo (T1–T7) **+ refinamento R1/R2 pós-staging** (ponteiro
movido migrado para o agente · "quem reclama" por seleção pessoa/time da Team Guide), commit `b6485e4`, 726
testes verdes, staging redeployado. **O que falta não é código:** **validar no staging `edf400b4`** (os 3
cenários da régua **+ o fluxo novo**: o agente pedindo o ponteiro no chat e o seletor pessoa/time na Etapa 2)
→ **prod `674a3710`** → PR, e **calibrar a régua com o Rafa** antes de produção (reprovar projeto é visível
ao autor). **Barrar submissão segue FORA em definitivo**; **não reintroduzir os cards de ponteiro na Etapa 2**.

**⚠️ Frente PARALELA, não sobrescrita — [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** ·
Status: ✅ **aprovado (Luis, 2026-07-28)**, T1 executado, **ainda pendente de código**: **A1** (o gate da
alocação precisa aceitar "menos custo", não só "mais saída" — + anti-loop no juiz do preview) · **A2**
(materialidade nos gates) · **T4** (fluxo de coleta). Coexiste com o plano ativo (ADR-026) e é **adjacente**:
a taxonomia de impacto escrita no T3 do plano ativo deve ser reaproveitável pelo A1. O **T2** (régua do Rafa)
foi **absorvido** pelo T7 do plano ativo — não fazer duas vezes.

_[loadings-dashboard-admin](plans/loadings-dashboard-admin.md) saiu de ativo: **✅ CONCLUÍDO** — T1–T5 no commit
`3b93c65` e o **T6 fechado em 2026-07-28**: staging validada → **prod `674a3710`** → **PR #215 mergeado**
(`main` = `ad64895`). Nada pendente nessa frente._

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
**Validar `feat/criterios-projeto-classificacao` no STAGING (`edf400b4`) e depois promover** — regra 13.
Nesta ordem:
1. **Calibrar a régua com o Rafa** — [`docs/criterios-projeto-recorrencia-evidencia.md`](criterios-projeto-recorrencia-evidencia.md).
   É o gate humano que o plano de 28/07 exigia; reprovar projeto é visível ao autor. Pode rodar em paralelo
   com o staging, mas **não** vai a prod sem o OK dele.
2. ✅ **FEITO (29/07/2026, 13:55) — deploy no staging `edf400b4`** com o bundle `index-IxZZkvb_.js`
   (conferido no `index.html` servido; `/favicon.svg` = 200 `image/svg+xml`). Prod NÃO foi tocado.
   Falta só o Luis validar no navegador: Etapa 2 (as 2 perguntas + "Nenhum" avançando) → 3 submissões dos
   critérios de aceitação na aba `STAGING` → seção "Processo alterado" no memorial → motivo no `/dashboard`
   com `Observações` intacta → aviso do motivo em Meus Projetos e `/projeto/$id`.
   _(Runbook original, se precisar redeployar:)_ **deploy no staging `edf400b4`** (fluxo do "Deploy rápido"; ⚠️ o `scripts/deploy-godeploy.sh` recebe o
   **TOKEN**, não a URL, e o `uploadId` é **single-use** — novo `getUploadToken` entre staging e prod).
3. **Validar os 3 cenários** dos critérios de aceitação, na aba `STAGING`: (a) submissão tipo "nuvem de
   palavras" → `Classificação = "Claro não — …"`, `Status = Reprovado`, `Motivo Reprovado` preenchido;
   (b) saving recorrente com indicador nomeado → `Claro sim` + `Status = Pendente` (nada mudou para ele);
   (c) ganho real sem fonte verificável → `Zona cinzenta` + `Em validação`. Conferir que **nenhuma outra
   coluna mudou** e que `Observações` fica intacta ao gravar motivo pelo `/dashboard`.
4. **Prod `674a3710`** + `gh pr create` (conta **`LuisEduardo100`**, que tem WRITE; `rpaiagogroup` é READ).

**Pendências conhecidas (não bloqueiam o staging):**
- **Harness E2E** (`scripts/e2e/`) valida A→AS e ainda **não** cobre as 3 colunas novas.
- Projetos **legados** ficam com `Classificação = "—"` até serem reanalisados — **sem backfill** (decisão
  implícita: o cron só repõe o que o SQLite tem).
- Frente **paralela** [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md):
  **A1** (o gate da alocação precisa aceitar "menos custo" — a taxonomia de impacto do T3 é reaproveitável)
  e **A2** (materialidade nos gates) seguem pendentes de código.
- ⚠️ `CLAUDE.md` em **~45,7k chars** (limite recomendado 40k; entrou +0,6k líquido nesta sessão, já com dois
  bullets condensados). Continua valendo uma sessão de enxugamento.

✅ **T6 dos loadings encerrado em 2026-07-28:** branch já estava 0 atrás do `origin/main`; 658 testes + `build`
+ `build:worker` verdes (`worker.js` inalterado); **staging `edf400b4`** validada no navegador pelo Luis;
**prod `674a3710`** com os mesmos artefatos (`index-D76hNGpt.js` conferido no `index.html` de prod via
`E2E_COOKIE`); **PR #215 mergeado** → `main` = `ad64895`, espelhando prod.
⚠️ Gotchas do deploy que custaram tempo: `scripts/deploy-godeploy.sh` recebe o **TOKEN** como 1º argumento (URL
com `?token=` → **401**) e o `uploadId` é **single-use** (novo `getUploadToken` entre staging e prod).
Nesta sessão `gh pr create`/`gh pr merge` **funcionaram** — o bloqueio local do classificador não se repetiu.

⚠️ **PR #214 (dashboard de triagem) foi MERGEADO** no `main` (`e878bc1`) nesta sessão; o worktree
`dashboard-admin-sheets` e a branch local foram removidos.
