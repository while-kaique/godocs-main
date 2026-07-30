# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-30 (código, avulsa — fora do plano ativo) — pedido direto do Luis:
**Coautor único por projeto**. Cada projeto tem **1 autor** (o submissor/dono, que não escolhe papel) e
**no máximo 1 Coautor** (`coexecutor`); Participante e Contribuidor seguem **sem limite**. Implementação
**100% cliente** (nada de schema, sync ou colunas do Sheets — `derivarColunasPapeis` continua aceitando
lista por causa dos legados): helpers puros `PAPEL_COAUTOR`/`coautoresSelecionados()`/`limitarCoautorUnico()`
em `src/lib/submeter/constants.ts`; `validarEtapa1` bloqueia 2+ Coautores nos dois modos (submissão nova e
edição); no seletor (`ParticipantesPapeisInput`) a opção **Coautor SAI da lista** dos demais quando alguém já
a tem (`papeisDisponiveis` — a 1ª versão mostrava a opção *desabilitada* com "(já definido)" e o **Luis pediu
para removê-la da view**); nota informativa abaixo do campo explica a ausência; o **seed da edição**
(`applySeed`, `submeter.tsx`) aplica `limitarCoautorUnico` — legado importado do Sheets pode trazer vários
e-mails na coluna "Participantes", então mantém o 1º e **limpa o papel dos demais** para o usuário
reclassificar (em vez de travar a edição num estado que ele não criou). Branch **`feat/coautor-unico`**
(`da91207` + `0ff9f6b`, sobre `main` `ad64895`), 8 testes novos em `tests/validacao-etapa1.test.ts`,
**667 verdes**; `CLAUDE.md` + `spec-docs/SPEC_FEATURES_NOVAS.md` atualizados. **✅ VALIDADO pelo Luis no
staging.** ⚠️ **Armadilha real desta sessão, que não pode repetir:** o **staging estava rodando a branch
NÃO-mergeada `feat/criterios-projeto-classificacao`** (as perguntas-chave da Etapa 2), e o primeiro deploy —
buildado de `origin/main` — **apagou aquelas perguntas da tela** (o `updateApp` substitui a app INTEIRA).
Corrigido com a branch de integração **`staging/criterios-coautor`** (= `feat/criterios-projeto-classificacao`
+ merge do coautor; conflito só em duas linhas de `import`), **761 testes verdes**, `build` + `build:worker`
OK, **staging redeployado** com as duas frentes. **Prod (`674a3710`) NÃO foi tocado em nenhum momento.**
**Regra que vale daqui pra frente: antes de deployar no staging, descobrir QUAL branch está no ar e mergear a
sua sobre ela.**

_(Antes desta:)_ **Última sessão:** 2026-07-29 (planejamento) — nova frente, pedida pelo Luis: **apertar o critério de
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
Status: ✅ aprovado (Luis, 2026-07-29) e **CODADO** na branch `feat/criterios-projeto-classificacao`
(T1–T8, até `9ce9b09`/`28cdb01`) — **no staging, ainda NÃO validado pelo Luis nem em prod**; era essa branch
que estava no ar quando o deploy de 30/07 a sobrescreveu (ver "Última sessão").
Critério de projeto: perguntas-chave na Etapa 2 + classificação em 3 níveis no analisador + reprovação com
motivo nas colunas novas. **Barrar submissão segue FORA em definitivo** (a reprovação é pós-envio).

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
**PRIMEIRO — pergunta aberta ao Luis, sem resposta ainda (30/07):** o staging hoje carrega **duas** frentes
(Coautor único, já validado + critério de projeto, ainda **não** validado por ele). Decidir com ele:
**(1)** subir a prod **só o Coautor único** (`feat/coautor-unico` rebaseada no `main`) e abrir o PR dela,
deixando o critério de projeto só no staging; ou **(2)** esperar a validação do critério de projeto e subir as
duas juntas. **Não subir prod antes dessa resposta.** Quando vier, o caminho do Coautor é: rebase no `main`
→ `npm run test && build && build:worker` → **deploy prod `674a3710`** → `/ggsd:ship` (PR).
⚠️ Ao deployar staging de novo, cheque antes qual branch está no ar (foi o erro desta sessão) e use uma branch
de integração; worktrees vivos: `.claude/worktrees/coautor-unico` e `.claude/worktrees/staging-criterios-coautor`
(este com `node_modules` por **symlink** para o outro).

**DEPOIS — Executar o plano [criterios-projeto-classificacao](plans/criterios-projeto-classificacao.md)** com
`/ggsd:code`, T1 → T7. Worktree novo a partir de **`origin/main` (`ad64895`)** — a branch atual
`docs/plano-loadings-dashboard-admin` é **só de docs e está ATRÁS do main** (o `/dashboard` de triagem e o
`dashboard-admin.functions.ts` **não existem** nela; só no `main`).

**Antes de escrever a primeira linha, nesta ordem:**
1. **Conferir a grafia exata** dos 3 cabeçalhos novos (`Classificação`, `Motivo Reprovado`, `Motivo Reenvio`)
   nas abas **`GoDocs`** e **`STAGING`** — o Luis já criou as colunas, mas o mapeamento é **por nome** e um
   acento diferente faz a coluna ser **ignorada com aviso**, silenciosamente. As duas abas já divergem em
   posição de coluna.
2. Ler o plano ativo inteiro + a seção **"Decisões fechadas que NÃO podem ser corrigidas por engano"**
   (`spec-docs/`, regra 12).
3. Invocar a skill **`frontend-design`** antes da UI da Etapa 2 e do modal de triagem (regra 11).

**Ordem sugerida de execução:** T4 (colunas/sync — desbloqueia a verificação) → T1 (Etapa 2) → T3 (analisador
+ `normalizarClassificacao`) → T2 (memorial/agente) → T5 (`/dashboard`) → T6 (motivo visível ao autor — **é
julgamento do Claude, confirmar com o Luis se mantém**) → T7 (régua de 1 página pro Rafa).

**2 pontos de atenção que o Luis já conhece e não devem ser "corrigidos" por engano:**
- **Não** encerrar a regra TEMPORÁRIA do `Pendente` (decisão D1: a única exceção é `claro_nao → Reprovado`).
- **Não** mexer no `CHECK` de `projetos.status` (exigiria rebuild da tabela); o discriminador da reprovação é a
  coluna nova `classificacao_avaliacao`.
- ⚠️ A régua do Rafa tinha **gate humano** no plano de 28/07 ("nenhum código encosta na régua antes do OK
  dele"). O Luis mandou codar; a régua sai no mesmo PR (T7) e **deve ser calibrada com o Rafa antes do deploy
  em produção** — reprovar projeto é visível ao autor.

✅ **T6 dos loadings encerrado em 2026-07-28:** branch já estava 0 atrás do `origin/main`; 658 testes + `build`
+ `build:worker` verdes (`worker.js` inalterado); **staging `edf400b4`** validada no navegador pelo Luis;
**prod `674a3710`** com os mesmos artefatos (`index-D76hNGpt.js` conferido no `index.html` de prod via
`E2E_COOKIE`); **PR #215 mergeado** → `main` = `ad64895`, espelhando prod.
⚠️ Gotchas do deploy que custaram tempo: `scripts/deploy-godeploy.sh` recebe o **TOKEN** como 1º argumento (URL
com `?token=` → **401**) e o `uploadId` é **single-use** (novo `getUploadToken` entre staging e prod).
Nesta sessão `gh pr create`/`gh pr merge` **funcionaram** — o bloqueio local do classificador não se repetiu.

⚠️ **PR #214 (dashboard de triagem) foi MERGEADO** no `main` (`e878bc1`) nesta sessão; o worktree
`dashboard-admin-sheets` e a branch local foram removidos.
