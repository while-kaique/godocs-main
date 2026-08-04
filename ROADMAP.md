# ROADMAP — GoDocs

> Onde estamos e para onde vamos. Atualizar o status a cada avanço.
> Legenda: ⬜ não iniciado · 🟡 em andamento · ✅ concluído · ⛔ bloqueado
>
> Contexto: projeto já em produção (`https://godocs.devgogroup.com/`). O GGSD foi adotado em 2026-07-17
> para dar estrutura às **próximas** mudanças; o histórico anterior está no git, no `CLAUDE.md` e em `spec-docs/`.

**Fase atual:** **nenhuma em aberto** — Fase 5 (**critério de projeto**) ✅ **CONCLUÍDA** em 2026-07-30:
staging validada, prod `674a3710` deployado e **PR #216 mergeado** (`main` `39deaf9`). Fase 4 (loadings do
`/dashboard`) ✅ (PR #215); Fase 3 (dashboard = triagem) ✅ (PR #214); `aceitar-zip-submissao` ✅ (PR #213).
O **Coautor único por projeto** e o fix do **loop de reconciliação que estourava a cota do Sheets** (`cb8d677`)
foram a produção **dentro do PR #216**.

**Pendência HUMANA da Fase 5:** avisar o **Rafa** (a reprovação é visível ao autor — D10) e **calibrar a régua
com ele** usando casos reais, agora pós-deploy.

**Fase 6 — perguntas do agente, fatia A1 🟡 (plano ✅ APROVADO em 2026-07-30, código não começou):**
**taxonomia de destino do ganho + anti-loop no juiz do preview**. A régua do critério entrou (Fase 5), mas a
**poda** das perguntas antigas não: o gate da alocação ainda **recusa "menos custo"** (o caso real da redução
de 3 auxiliares levou 5 reperguntas, por causa de 3 textos de prompt que exigem _"nomeado **E** entregar A
MAIS"_) e o juiz do preview reinterroga sem limite. Plano em
`docs/plans/taxonomia-destino-ganho-e-anti-loop.md`.
⚠️ **A jornada preguiçosa saiu do escopo** — decisão do Luis em 2026-07-30: o gate da jornada **fica como
está**, mesmo disparando sem consequência em 15 de 24 conversas. Reavaliar depois de re-medir o baseline
pós-#216. O limiar de 176h **não é mais pendência** (a decisão foi tomada).
⚠️ **`respostaAlocacaoVaga` não se mexe** — o defeito é 100% de prompt; o predicado já aceita "redução de 3
auxiliares".
✅ **A1 CONCLUÍDA em 2026-07-30** (`b390c62`, `fix/gate-alocacao-taxonomia-e-materialidade`, 797 verdes):
`TAXONOMIA_DESTINO_GANHO` como fonte única dos 5 destinos + anti-loop determinístico no juiz do preview.
**T7 fechado:** staging `edf400b4` validada ponta a ponta com o cenário-âncora (agente pergunta **1×**,
"3 vagas não repostas / mesma entrega com time menor" **aceita de primeira**, sem reinterrogação no preview,
seção gravada, coluna AK preenchida, 160h/R$2.230,40) → prod `674a3710` deployado → **PR #217 mergeado**.
⚠️ Registrado na execução: o piso `respostaAlocacaoVaga` ainda marca como vaga a resposta que **mistura**
destino válido com filler ("o time menor dá conta com essa otimização") — custo de **1 repergunta**, e
alinhá-lo é **fatia própria** (fronteira deste plano).
⚠️ **Achado novo do T7 (fatia própria):** com contexto suficiente na doc, o agente **auto-preenche** a
Seção 2.4 **sem perguntar** e **inventa** o destino ("menos prazo/menos retrabalho" que ninguém disse) — o
atalho heurístico do gate libera porque a seção nomeia *algum* destino. Rede restante: validação humana.
**Próximo (03/08):** 🟡 **T5 do fix "Motivo Reenvio → —"** — branch `fix/motivo-reenvio-traco` (`a6e19f1`,
805 testes verdes, `worker.js` rebuildado) espera a **frente paralela** liberar para mergear `origin/main`,
rebuildar e fazer **staging `edf400b4` → prod `674a3710` → PR**. Plano:
[docs/plans/motivo-reenvio-traco-padrao.md](docs/plans/motivo-reenvio-traco-padrao.md).

_Antes disso:_ **nada de código por ora** — o **A2 foi DESCARTADO** (decisão do Luis, 30/07: mesmo diagnóstico
da jornada preguiçosa já recusada, ganho de 1–2 perguntas baratas e risco de enfraquecer o teto das 220h).
Fatias vivas para quando voltar a codar: **auto-preenchimento da Seção 2.4** (agente inventa o destino) e o
**piso `respostaAlocacaoVaga`**.

⚠️ **Ao deployar staging, conferir qual branch está no ar** — o `updateApp` substitui a app inteira (em 30/07
um deploy vindo do `main` apagou as perguntas da Etapa 2 que só existiam na branch do critério).
⚠️ **O harness E2E aponta pra PROD por default** quando não acha o `.env` (worktree não tem um): exportar
`E2E_BASE_URL`/`E2E_COOKIE` e conferir a linha "🚀 E2E run … contra <URL>" antes de deixar rodar.

**Próximo (31/07):** **varrer Drive × planilha** para achar outros projetos purgados como o da **Nyara**
("Consulta fiscal - IE e IM", submetido 29/07 15:00, doc no Drive mas linha nunca apendada → purgado do
SQLite pela `reconciliarExclusoes`) **e decidir a recuperação dela**. Nenhuma frente de **código** aberta
(decisão do Luis, 30/07; staging/prod/`main` sincronizados, PRs #217/#218; **A2 descartado**) — o candidato
mais forte a virar plano é o **gate anti-dupla-contagem `custo evitado × receita`** (buraco que produziu a
dupla contagem de R$ 161.913,78 no Sucesso.AI, corrigida à mão em 31/07). Humano: as 2 pendências com o
Bruno e calibrar a régua com o Rafa.
Em paralelo, humano: avisar o Rafa e
calibrar a régua com ele. Frentes candidatas, nenhuma planejada:
causa-raiz do analisador morrendo no `waitUntil` (hoje mitigado pelo cron de 1 min, que pressiona a cota do
Sheets) · poda do `CLAUDE.md` (~48k, teto 40k) · repovoar a aba `STAGING` com dado sintético.
**Paralelo (Fase 1):** validar o round-trip em **staging** (regra 13, T5) — após o Luis criar as colunas "Participantes 2"/"Contribuidor" no Sheets

---

## Fase 1 — Etapa 1 na tela de edição 🟡
Permitir que o dono/editor delegado edite os **participantes e papéis** (Coautor · Participante · Contribuidor)
ao editar um projeto — inclusive projetos submetidos no modelo antigo — sem quebrar submissão/edição nem o sync
com o Sheets (fonte da verdade).
- ✅ Planejar (plano aprovado em `docs/plans/edicao-etapa1-participantes.md`).
- ✅ Especificar (EARS RF-100…107 no `SPEC.md §4`).
- ✅ Implementar (T1–T3; T4 = limitação registrada) — 561 testes verdes, build compila, conformidade verificada.
- 🟡 Validar em **staging** antes de prod (T5) — bloqueado pelo pré-requisito das colunas no Sheets (Luis).
- **DoD:** dono/delegado edita participantes+papéis na edição; reenvio persiste `membros`/`membros_papeis`
  e escreve as 3 colunas de papel no Sheets sem duplicar linha nem regredir ownership; testes verdes; validado
  em staging.

## Fase 2 — "Meus Projetos" não exibe o valor R$ ao dono ✅
Tirar o badge de valor R$ dos cards de "Meus Projetos" (esconder p/ todos, client-only) e parar de
serializar `ganho_total_mensal` ao client (defesa em profundidade) — fecha a brecha do INV-02. Cálculo,
SQLite e Sheets inalterados; admin segue vendo no investigador.
- ✅ Planejar (`docs/plans/ocultar-valor-meus-projetos.md` — aprovado 2026-07-17).
- ✅ Especificar (EARS RF-108…111 no `SPEC.md §4` + reforço INV-02).
- ✅ Implementar (T1 server `null` + teste · T2 remover badge · T3 `build:worker`) — branch
  `feat/ocultar-valor-meus-projetos`, 562 testes verdes, conformidade conforme (0.97).
- ✅ Deploy staging (`edf400b4`) → **prod (`674a3710`)** em 2026-07-17 (T4, regra 13) — mesmo artefato byte-idêntico.
- **DoD:** nenhum R$ no card p/ qualquer usuário; API devolve `ganho_total_mensal: null`; investigador
  intacto; cálculo/Sheets inalterados; testes verdes; validado em staging antes de prod.

## Fase 3 — Dashboard do admin = triagem sobre a planilha 🟡
Tirar a validação da planilha e trazê-la para o app: `/dashboard` lia o **SQLite** (mostrava rascunho e um
status que não é fonte de verdade) e passa a ler `readAllRows()`, com busca instantânea, filas de status,
paginação, ficha com todas as colunas e **mudança de status gravando no Sheets** + auditoria.
- ✅ Planejar (`docs/plans/dashboard-admin-sheets.md` — aprovado 2026-07-28; escopo escolhido pelo Luis:
  write-back de status incluído + tabela densa).
- ✅ Implementar (T1 backend com cache single-flight · T2 `admin_status_log` · T3 3 rotas `requireAdmin` ·
  T4 tela reescrita · T5 `StatusBadge`/sync reverso · T6 29 testes · T7 spec+docs) — branch
  `feat/dashboard-admin-sheets`, commit `5ef927a`, 620 testes verdes, `worker.js` recomitado.
- ✅ **T8 (quase todo) — deploy staging (`edf400b4`) → validado no navegador pelo Luis → prod (`674a3710`)**
  em 2026-07-28, com os MESMOS artefatos/hashes nos dois. Branch enviada ao remoto (`990250e`).
- 🟡 **Falta só abrir o PR** — `gh pr create` foi bloqueado pelo **classificador de permissões local**
  (não é falta de permissão no GitHub); corpo pronto, conta `gh` em `LuisEduardo100`.
- ⬜ Confirmar os valores do **dropdown da coluna "Status"** e ajustar `STATUS_GRAVAVEIS` se preciso.
  **Medido em 2026-07-28:** `Reprovado` e `Em validação` **não existem em nenhuma das 887 linhas** das abas
  `GoDocs` + `STAGING`; os 4 valores reais em uso são Aprovado · Pendente · Reenvio Pendente · Descontinuado.
  Decisão de produto do Luis.
- **DoD:** nenhum rascunho na lista; status sempre o do Sheets; busca por projeto/autor responde na tecla;
  filas com contagem correta; ficha mostra todas as colunas preenchidas; mudar status grava "Status"
  (+"Observações") sem duplicar linha, **sem tocar "Atualizado Em"**, e audita quem mudou; validado em
  staging antes de prod.

**D16 (pedido do Luis, 04/08 noite, `da32167`+`2c40eef`):** pré-aprovar com **qualquer "não"** no checklist
**exige explicação** — o clique em "Pré-aprovar" abre uma caixa em vez de gravar, e o texto entra no mesmo
campo `comentario` → coluna `Justificativa Aprovação do Líder`. Régua na fonte única
(`exigeJustificativa`/`temNaoNoChecklist`) e **cobrada no servidor** (400). O "não" segue **sem ser veto**.
Staging redeployada 04/08 17:21 (934 testes). ⚠️ O aviso antecipado sobre o "não" foi **removido** a pedido
dele (poluía a tela) — quem informa é a caixa, no clique.

**Próximo:** **o Luis escolher como proteger a staging de ser atropelada** (3× em 04/08 — ver o topo do
`docs/NEXT-SESSION.md`: combinar com o Kaique · app de staging separado · redeployar quando cair) e, em
paralelo, **o Lucas validar a fila de 3 itens na staging com a própria conta** (04/08 — a fila foi
populada com 2 projetos mockados justamente para ele ver a tela com mais de um pendente, e desde 04/08 à
tarde ela é um **slider de 1 projeto por vez**, D15). Depois disso:
**limpar os 2 mockados** e **validar com a DIRETORIA se a pré-aprovação vai para produção** (decisão do
Luis, 03/08 noite — nada sobe, nem para prod nem para o repo, antes disso). A staging `edf400b4` está no ar
com a rodada 6 + o `main` do Kaique mergeado + o slider da fila (04/08, 931 testes). Pré-requisito do Luis quando destravar:
criar **`Aprovação do Líder`** e **`Justificativa Aprovação do Líder`** no cabeçalho das abas `GoDocs` e
`STAGING`.

## Fase 3.5 — Pré-aprovação do líder (TeamGuide) 🟡
Spec `spec-docs/SPEC_APROVACAO_LIDER.md` (D1–**D16**). **F0 + F1 + F2 ✅ codadas, commitadas e na staging**
(2026-08-03, `c9991be`): paginação real (`pageNumber`/`pageSize`), fallback de área para os nós de
diretoria/passthrough (as 10 pessoas em "ÁREA NÃO IDENTIFICADA"), `deriveAreaFromEmail` por e-mail exato,
índice de liderança (432 pessoas / 1 sem líder), tabela interna `projeto_aprovacoes`, rotas
`/api/aprovacoes/*`, tela **`/aprovacoes`** (faixa na home só p/ quem lidera) + selo no card do autor,
coluna `Aprovação do Líder` no Sheets e a DM (`google/chat-dm.ts`) atrás do gate `GOOGLE_CHAT_DM_ENABLED`.
**D11 (decisão do Luis, 03/08):** quem **já é liderança** (é `leader` de um time ativo na TeamGuide) fica
**isento** — só o liderado de fato entra em fila, e quem aprova é o **líder direto**.
**D12 (decisão do Luis, 03/08):** os 3 casos sem fila ganharam **rótulo próprio** na coluna — liderança →
**`Pré-aprovado (liderança)`**, sem líder → `Sem líder na TeamGuide`, TeamGuide fora → `Aprovação
indisponível (integração)` (antes os 3 gravavam `—` e a auditoria não distinguia isenção de falha).
- ✅ **Staging pronta para o teste real** (2026-08-03 15:39): redeploy com a D12 + **DM LIGADA** nela
  (`GOOGLE_CHAT_DM_ENABLED=true`, `CHAT_SA_*`, `GOOGLE_CHAT_DM_SUBJECT`) — cadeia validada ao vivo e DM
  recebida pelo Lucas. ⚠️ Staging **deixou de ser silenciosa**: submeter lá notifica pessoa real.
**D13 (ressalvas do Lucas, 03/08 noite, `1d3aeb2`):** nomenclatura **pré-aprovação** em toda a UI e na
planilha (`Pré-aprovado`/`Ajuste pedido`), **card auto-suficiente** (dono · participantes com papel · saving
em R$ + horas · descrição · memorial expansível) e **checklist de 3 perguntas sim/não** (move KPI · sentiria
falta · saving coerente) obrigatório no servidor nos 2 vereditos — textos em `src/lib/aprovacoes-checklist.ts`
(módulo puro, fonte única). **`/aprovacoes?como=<e-mail>`** = pré-visualização só de admin (o `decidido_por`
grava o admin). ⚠️ O líder vê **R$** de saving — exceção consciente ao "cliente não vê R$", a confirmar.
- ✅ **Staging redeployada com a D13** (2026-08-03 16:26, 856 testes verdes) — fila real: projeto "n8n audit"
  do Luis esperando o Lucas.
**D14 + rodada 6 (03/08 noite, `dc53193`/`76ffe84`/`6e93636`):** a coluna **`Aprovação do Líder`** passou a
guardar **só o estado** (`Pré-aprovado`/`Pré-pendente`/`Pré-reprovado`, filtrável) e o detalhe — quem decidiu,
quando, as 3 respostas do checklist e o comentário — foi para a coluna nova **`Justificativa Aprovação do
Líder`**. Tela: 7 cards de número no mesmo nível, header só título + tooltip, **"Resumo do projeto" vindo do
memorial (`[1.2]`)** em vez da análise automática.
- 🛑 **TRAVADO para prod (decisão do Luis, 03/08 noite):** a ida a produção **será validada com a
  DIRETORIA** antes. A branch está commitada (25 commits), **sem push e sem PR**; a staging segue no ar
  para a demonstração.
- ⬜ Validar com a diretoria → prod `674a3710` → PR.
  **Pendência humana:** a coluna no cabeçalho do Sheets (P2) e, para ligar a DM **em prod**, os secrets
  `CHAT_SA_*` + `GOOGLE_CHAT_DM_ENABLED=true` (prod hoje: DM no-op).
- **DoD:** liderado submete → fila abre e a coluna mostra "Pendente com X"; liderança submete →
  "Pré-aprovado (liderança)" e nenhuma fila/DM; `/aprovacoes` aprova e pede ajuste (comentário obrigatório); autor vê o selo; a
  submissão **nunca** falha por causa da pré-aprovação; validado em staging antes de prod.

## Fase 4 — Loadings do `/dashboard` do admin 🟡
Tirar a espera percebida da tela de triagem. Medido: leitura do Sheets **1.450–2.360 ms** / payload **2,65 MB**,
mas a causa é **serialização** — o `beforeLoad` bloqueia em "Verificando permissões" e só depois o `useEffect`
lê a planilha; o cache do servidor é in-memory sem revalidação em background, e o de auth também.
- ✅ Planejar (`docs/plans/loadings-dashboard-admin.md` — aprovado 2026-07-28; escopo escolhido pelo Luis:
  itens 1+2+3+4, **cache em SQLite FORA**).
- ⬜ Implementar T1 (SWR no servidor, cobre também a ficha) · T2 (auth em `sessionStorage`) · T3 (paralelizar
  auth × planilha) · T4 (skeleton) · T5 (testes + `build:worker`) · T6 (spec + staging → prod).
- **DoD:** cache vencido responde na hora com revalidação em background; reload/navegação entre telas admin
  não mostra "Verificando permissões"; as duas requisições saem em paralelo no 1º acesso; skeleton interativo
  no lugar do spinner; planilha segue fonte única e "Atualizado Em" intacta; testes verdes; staging antes de prod.
- **Fronteira:** sem cache em SQLite — o 1º acesso após isolate frio segue custando ~2,5 s (agora com skeleton).

## Fase 5 — Critério de projeto: "isto é projeto?" ✅
Pedido da gestão (Rafa) após submissões que não deveriam ter entrado — o caso-símbolo é a **nuvem de
palavras** gerada uma vez para uma apresentação. Régua de 3 critérios (**recorrência · contrafactual ·
rastreabilidade**; o impacto não precisa ser receita) julgando **elegibilidade**, separada da pontuação de
qualidade. **Barrar submissão está FORA em definitivo** — a reprovação é pós-envio.
- ✅ Planejar (`docs/plans/criterios-projeto-classificacao.md` — aprovado 2026-07-29) e **codar T1–T8**
  (`feat/criterios-projeto-classificacao`, integrada em `staging/criterios-coautor`).
- ✅ Validado na staging: o lado do **agente** (as 2 seções novas do memorial + o contrafactual da Etapa 2) e
  a **escrita das colunas** (`Classificação` sempre preenchida).
- ✅ **Régua calibrada e PROVADA ao vivo** (só prompt, `analyzer.ts`): o cenário `criterio-claro-nao` fecha em
  Status **"Reprovado"** + `Classificação` _"Claro não — a recorrência falha… o contrafactual também falha… a
  rastreabilidade do artefato existe, mas não compensa a falta do par"_ + `Motivo Reprovado` legível. O
  **entregável** deixou de valer como rastreabilidade e a **falha simultânea** virou exceção declarada ao
  "na dúvida → zona_cinzenta". `normalizarClassificacao` intacta (segue só rebaixando — D9).
- ✅ **Guarda de falso-positivo passou:** `saving-puro`/`custo-evitado-puro`/`complexidade-autonomia` →
  **Claro sim**; `receita-pura` → **zona cinzenta**; nenhum legítimo virou `claro_nao`.
- ✅ **`resyncGoogle` recupera linha ausente** por append (sem leitura extra do Sheets).
- ✅ T6 staging → **prod `674a3710`** → **PR #216 mergeado**. 783 testes verdes.
- 🐞 Achado **pré-existente** (não é regressão): `saving-multicargo` estoura 40 turnos no loop de repergunta da
  Seção 2.4 quando o respondedor não tem o dado — falha idêntica no código de prod.
- ⬜ **Pendência humana:** avisar o Rafa + calibrar a régua com ele.
- **DoD:** o cenário fecha com Status **"Reprovado"** + `Classificação` "Claro não…" + `Motivo Reprovado`
  legível pelo autor; nenhum outro cenário muda de classificação; os guards de `normalizarClassificacao`
  intactos (sem motivo → zona cinzenta · especial nunca reprova · > R$ 5k → zona cinzenta); nenhuma leitura
  adicional do Sheets.
- **Fronteira:** nada de **promoção determinística** para `claro_nao` — a normalização só **rebaixa** (D9);
  a calibração é de **prompt**. A régua vai a prod recém-calibrada, sem rodada com o Rafa.

## Backlog
- ⬜ Tela de gestão de admins (endpoints `/api/admin/admins` existem, ninguém consome; link "Configurações"
  da sidebar aponta para `/configuracoes`, rota inexistente). Hoje só via `ADMIN_EMAILS`.
- ⬜ 🐞 `GET /api/admin/investigador/projetos` **quebrado em prod** (503 Cloudflare 1102): N+1 em
  `investigador.functions.ts:225-226` chama `getChatMessages` para todos os 605 projetos. Merece plano próprio.
