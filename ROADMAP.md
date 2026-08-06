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

**04/08 (noite):** o Lucas reprovou a 1ª versão da pergunta do "não" e pediu 3 mudanças, já no ar na staging
(`28a033a`): pergunta+exemplo POR CHAVE do "não", saving incoerente como PRÉ-REQUISITO (sem botão verde) e
**3 botões** (Pré-aprovar verde · Pedir ajuste âmbar · Reprovar vermelho), com `ajuste` separado de
`reprovado` no veredito e no Sheets. Falta ele validar essa rodada.

**05/08 (D17):** o **envio da DM saiu do GoDocs** — quem entrega é o **bot do Gomoon**, a partir de 1 POST/dia
(6h BRT) com a relação líder↔liderados pendentes. Contrato fechado em **`docs/integracao-gomoon-chat.md`**
(pronto para mandar ao time deles); `chat-dm.ts` + o disparo na submissão + o cartão **removidos** (936 testes
verdes). A **F3** (agregada + cron + POST) **não está codada** e depende do endpoint/token deles (P4 da spec).
Efeito colateral bom: a staging voltou a ser **100% muda**.

**05/08 (D18) — parecer do líder chegava mutilado na planilha: CORRIGIDO** ✅ (commit `3aac5f5`, **945 testes**). O cabeçalho de prod/staging tem `Justificativa Aprovação do **Lider**` (sem acento) e o match por nome EXATO descartava a justificativa inteira; agora o casamento é **exato → normalizado** (`chaveColuna`/`resolverColunaLetra`) no update **e** no append, e a coluna guarda **tudo** o que o líder respondeu (perguntas por extenso + sim/não + texto livre rotulado). **Cai o bloqueio de ida a prod pelo acento** — sem renomear nada. Falta **validar na STAGING** (`edf400b4`, regra 13).

**05/08 (D18/D19) — validado na staging e o parecer virou tela** ✅ A coluna AF **recebe o parecer completo** (confirmado pelo Luis na staging). Em seguida, **D19** (commit `e61bace`, **1025 testes**): o parecer do líder passou a aparecer **dividido na ficha de triagem do `/dashboard`** — chip de estado, quem decidiu + quando, **1 linha por pergunta do checklist com o sim/não**, texto livre citado com o rótulo da D18 e selo **"Respondeu 'não' no checklist"**. Fonte é a **LINHA DA PLANILHA** (zero leitura nova, invariante do dashboard intacta); `chaveColuna` mudou para o módulo PURO `src/lib/coluna-chave.ts` porque a tela roda no CLIENTE e precisa casar `…do Lider`. **Deployado na staging** (14:46, cron pós-deploy `200 ok`) — falta **conferir no navegador**.

Somada a ela, a coluna **"Pré-status"** na TABELA (commit `b456626`, **1028 testes**), com o chip compartilhado — a triagem vê o parecer sem abrir ficha por ficha.

**05/08 (D20) — a isenção de pré-aprovação passa a ser pelo CARGO** ✅ A régua D11 ("é `leader` de um time ativo") isentava **analista com nó próprio na árvore** da TeamGuide — a Fablícia Lima saía `Pré-aprovado (liderança)` sem ninguém olhar (21 das 64 pendentes). Agora isenta **coordenador para cima** (supervisor NÃO), na fonte única `src/lib/cargo-lideranca.ts` (commit `0040fef`, **1049 testes**). Aba "Relação Líder-Liderado" de prod regravada com 2 tabelas (**quem recebe × quem não entra na fila**): 52 projetos em fila, 29 líderes, 10 isentos por cargo. ⚠️ **Não deployado** — staging/prod seguem na régua antiga.

**05/08 (D17/F3) — o aviso diário ao líder saiu do papel e foi VALIDADO na staging** ✅ (commits `f6110a2` + `ec2cfe4`, **1078 testes**, staging `edf400b4` redeployada 15:51). A API do Gomoon **já estava em produção** (resposta do João Victor ao contrato v1) e implementou o nosso formato de entrada sem mudar nada; o **Bot Gomoon é admin-installed** no Workspace, então o risco que podia travar o projeto (DM proativa) **não existe**. Nosso lado: agregada `getPendenciasPorLider` (`GROUP BY` líder×liderado direto na **fila**, não numa 2ª consulta à TeamGuide) → builder PURO `montarPayloadLideresPendentes` + `notificarLideresPendentes` (`src/lib/gomoon-lideres.functions.ts`) → cron `POST /api/cron/notificar-lideres` + manual `POST /api/admin/notificar-lideres` (`{"dry":true}` monta e não envia — o cron não dispara na staging). **Horário passou de 6h para 09h BRT** (`0 12 * * 1-5` UTC): o Gomoon entrega na hora que recebe o POST, e às 6h o líder acordava com notificação. Validação ao vivo: **202** → log `entregue` com `destinatarioEfetivo` = João (o líder real do payload **não** recebeu — a proteção do `ambiente:"staging"` funcionou) → POST repetido devolve `ja_entregue`, **sem 2ª DM**. ⚠️ Bug pego na validação: `APP_BASE_URL` **não é origem limpa** (na staging vale `…/meus-projetos`) e o link saía `…/meus-projetos/aprovacoes` — 404 vindo da DM; `origemDe()` corrige, com teste. Secret `GOMOON_TOKEN` na staging + `.env`; **falta na prod**, junto com o cron.

**06/08 (D21) — quem REDIGE as 2 DMs é o GoDocs** ✅ (commit `35fa358`, **1107 testes**). O Luis escreveu os 2 corpos de mensagem (anúncio da feature + aviso ao líder) e perguntou o que o Gomoon teria de mudar para recebê-los. Decisão: **nós renderizamos** — o texto viaja **pronto** em `lideres[].mensagem.texto` e o template deles fica como **fallback** (contrato **v2**, `docs/integracao-gomoon-chat.md` §13–§14). Motivo: o `total` é a SOMA dos liderados, os bullets têm ordem, o plural muda a frase e a data é BRT — do lado deles isso seria um mini-engine de template e a cópia em 2 repos. O **anúncio** ganhou **endpoint próprio** (`/api/godocs/anuncio`) com chave **SEM data** (1× por pessoa para sempre; no payload diário viraria DM de anúncio todo dia) + `anunciarPreAprovacao` + `POST /api/admin/anunciar-pre-aprovacao` com **`dry` por default** (única rota do repo em que um POST sem body falaria com a empresa inteira). Fonte única PURA `src/lib/gomoon-mensagens.ts`. Duas promessas do texto corrigidas contra o código, com teste: não existe menu "GoDocs → Pré-aprovações" (a entrada é a **faixa da home**) e o autor **não é avisado** de ajuste pedido (virou "fica visível em Meus Projetos"). ⚠️ **Nada deployado** — e o **endpoint do anúncio ainda não existe do lado do Gomoon**.

**06/08 (D22) — a D21 foi deployada e DISPARADA na staging, e o markup estava na superfície errada** ✅ (commits `33e6049` + `31cccb3`, **1109 testes**, staging `edf400b4` redeployada 12:10). O João Victor avisou que o lado dele estava pronto; disparamos os 2 (**202, `falhas: []`** nos dois). A DM chegou com o markup **cru na tela** (`*Você tem projeto…*`) — e **não era falta de formatação nossa nem bug dele**: o contrato v2 não fixava a **superfície de entrega**. O Google Chat tem 2 sintaxes que não se conversam (mensagem de texto → `*negrito*`; **cartão `TextParagraph` → `<b>`**) e o Gomoon entrega em **cartão**. Correção: as 2 mensagens passaram a HTML de cartão, e o aviso ao líder **perdeu a linha de título e a do link** — o print mostrou que o **cabeçalho do cartão** e o **botão "Abrir a fila"** já diziam a mesma coisa (o `url` **continua** no payload: é dele que o botão sai). Regra escrita no §13 do contrato + **D22** na spec: **a sintaxe segue a superfície**; se a entrega deixar de ser cartão, `gomoon-mensagens.ts` volta ao asterisco no MESMO deploy. ⚠️ O anúncio precisou de **`ANUNCIO_VERSAO` `v1`→`v2`**: a chave sem data tornou o `v1` **no-op eterno** depois de entregue ao destinatário de teste — **`v2` é a versão que vai para prod, e ninguém da empresa recebeu o `v1`**; o valor está **pinado no teste de propósito** (bump fala com a empresa inteira, não é número de build). O aviso diário re-disparado no mesmo dia devolve `ja_entregues: 1` (correto, §4) — para revalidar hoje, o João precisa limpar a chave do dia. ⚠️ **Só staging** — prod segue sem token, sem cron e sem a feature.

**06/08 (D26) — o aviso ao líder virou IMEDIATO e a feature FOI PARA PRODUÇÃO** ✅ (commits `ae1835b` + `6af2636`, **1111 testes**, staging `edf400b4` e prod `674a3710` deployadas ~12:20 BRT). O Luis mandou subir — e o **anúncio global já tinha saído em produção pelo João Victor** (~12:00 BRT, `ambiente:"producao"`, entregue ao Lucas), então a empresa já sabe da feature. A premissa da D17 estava **errada**: a **§9 do doc v3** diz *"entregamos a DM na hora em que recebemos o POST"* — a integração **nunca foi diária**, a cadência era o **nosso** cron. Agora `notificarLideresDoProjeto` dispara no fim de `submeterParaValidacao` via `runBackground`, com **chave por PROJETO** (`godocs:<email>:<projetoId>`) — a chave diária faria a **2ª submissão do dia** do mesmo líder voltar `ja_entregue` e a DM sumir em silêncio (§8). Manda o **backlog** do líder (não só o projeto que chegou), tem **guard `[E2E-…]` explícito**, nunca manda `lideres: []` e **nunca lança** (D3). **Nada mudou do lado do Gomoon.** Validado na staging (dry-run + envio real **202, 0 falhas**, log `entregue`) e em prod (dry-run **`ambiente:"producao"`**, fila vazia — sem backfill, as DMs começam na 1ª submissão real). O prefixo `[STAGING]` **é escrito pelo Gomoon** e prod não tem `GODOCS_ENV` — teste prende as 2 pontas. `GOMOON_TOKEN` **nos 2 apps**; o snapshot diário segue codado mas **sem cron**. ⚠️ Falta exercitar o **wiring do submit** numa submissão de verdade.

**06/08 — PR [#235](https://github.com/while-kaique/godocs-main/pull/235) aberto** ✅ `origin/main` estava parado (branch 0 atrás, nada a mesclar); push dos 3 commits + PR pela conta `LuisEduardo100`. ⚠️ **"Às 14h começa o disparo" não existe**: com a D26 o aviso sai **na submissão**, sem cron nem janela — já no ar desde ~12:20. Pendente a escolha do Luis: só acompanhar, **ou** ligar TAMBÉM um resumo diário às 14h (`0 17 * * 1-5` UTC, código pronto, chaves independentes) — lembrando que o Lucas pediu **menos** ruído (D25).

**06/08 — aba "Aprovações Pendentes por Líder" na planilha de PROD** ✅ (commits `43e425f` + `84ff92a`, **1101 testes**). Pedido do Luis: *"quem está há mais de 5 dias esperando aprovação"*. `scripts/dryrun-lider/relatorio-espera.ts` (+ `espera.config.ts`), irmão do `relatorio-sheet.ts`: aba dedicada, limpa-e-regrava, `ESPERA_WRITE=1` para escrever, **mesma régua de fila da produção** (D20, isenção por cargo), corte por `ESPERA_LIMITE_DIAS` (default 5). **1ª versão cortada por ele no mesmo dia** (*"muita informação"*): de 3 tabelas/11 colunas/121 linhas para **1 tabela de 5 colunas**/34 linhas — Líder · E-mail · Projetos pendentes · **Dias pendentes** (a lista por projeto) · Mais antigo (dias). Retrato: **73 pendentes → 56 na fila de 31 líderes · 41 projetos acima de 5 dias com 26 líderes · máxima 128 dias**. ⚠️ O relógio é `Data Submissão` (em legado a fila nunca abriu — é a idade da pendência) e o **estado ficou de fora** porque `Aprovação do Líder` está vazia nos 73 (prod entrou **sem backfill**).

**06/08 — a aba ganhou a coluna "Quem está esperando (dias)"** ✅ (commit `13da550`, 1101 testes). Pedido do Luis: a coluna é a **conferência** do relatório (*"pra pesquisar o projeto da pessoa e ver se você acertou"*), então as duas listas saem da **MESMA** ordenação — ordenando em separado, dias e pessoas sairiam trocados e ele conferiria a pessoa errada. Escrita confirmada por **leitura de volta** (HTTP 200, 6 colunas). ⚠️ Na conferência, autor repetido na linha = 2 projetos dele, e o mesmo autor sob 2 líderes = pessoa em 2 times (**D4**, o 1º que decide resolve). Pendente a oferta de incluir o **nome do projeto** junto da pessoa.

**06/08 (D27) — projeto ESPECIAL não é pendência do líder** 🟡 (commit `5e40491`, **1102 testes**, staging `edf400b4` deployada 16:32 — **PROD AINDA NÃO**). Decisão do Luis: especial **não tem memorial financeiro**, então a 3ª pergunta do checklist do gestor não teria o que julgar, e o destino dele sempre foi a validação humana da RPA. `abrirPreAprovacao` não abre fila (motivo/justificativa próprios — D12), com o guard **antes da TeamGuide** (é flag do projeto, não depende de rede) e rede de segurança no SQL das 3 consultas que definem "pendente" — payload da DM, tela do líder e o **contador** da faixa da home (que ganhou o `JOIN`, senão diria "3 pendentes" e abriria fila de 2). Relação regravada: **73 pendentes → 35 na fila / 27 líderes**, com **29 especiais** fora (antes eram 64).

**06/08 — 🚨 PROD FICOU SEM A FEATURE** (não é regressão nossa): às **13:24 BRT** um deploy de outra frente subiu o `main` (que **não tem** `aprovacoes.functions.ts`) em cima da D26 e **apagou a pré-aprovação de produção** — `getApp(674a3710)` marca `version 227`/`16:24:11 UTC` com a descrição dos fixes do analisador, e `GET /api/aprovacoes/pendentes` responde **404**. ⚠️ `/aprovacoes` ainda ABRE (fallback SPA + bundle antigo em cache) — a tela não prova nada, **o teste é a rota de API**. Custo já materializado: o **Gustavo Castro** submeteu 17 min depois (13:41) e a líder **Vitória Azevedo** não foi avisada (o Gomoon só tem o `anuncio` dela; zero aviso) — o projeto **não** é especial e o autor **não** é isento, a fila simplesmente não existia. O merge do `origin/main` (regra 10) preservou os fixes da outra frente no build pronto. **Só o merge do PR #235 fecha esse buraco em definitivo.**

**06/08 (mais recente) — ✅ prod RESTAURADA por outra frente (`version 228`, `17:08 UTC` = 14:08 BRT) + 🔧 fix da coluna do líder.** O sintoma reportado ("novos submetidos com a linha sem status") era **exatamente** o build sem feature acima — **não** mapeamento de coluna: o cabeçalho de prod tem 53 colunas, `AE`/`AF` existem e **não há chave ambígua**. ⚠️ O `—` na AF das linhas de 03–05/08 foi **preenchimento MANUAL**, não o sistema. No caminho apareceu um bug real: **`resyncGoogle` apagava o parecer do líder** (chamava `syncSubmitToGoogle` sem as 2 chaves → `ouTraco(undefined)` gravava `—` por cima do estado+checklist+comentário já dados). Corrigido em `fix/pre-pendente-sempre-e-traco` (`dcfd26c`): nessas colunas **`undefined` ≠ `null`** — `null` → `—` (célula nunca nasce vazia, incl. append de RECUPERAÇÃO); `undefined` → coluna **omitida do update**. **1118 testes** (+6) · **validado na staging com E2E real** (linha nasceu `Pré-pendente` + `Aguardando Lucas Goncalves Queiroz`). **Decisões do Luis:** `Pré-pendente` **só quando a fila abre** (D12/D20/D27 de pé) e **SEM retroativo** — *"só com os novos submetidos"*, o backfill dos 35 **não** deve ser rodado sem nova decisão dele. ⚠️ **Prod NÃO foi tocada** (ele avisou que estava mexendo no GoDocs em paralelo).

**Próximo:** 🔴 **mesclar `fix/pre-pendente-sempre-e-traco` na `worktree-plano-aprovacao-lider-teamguide` (PR #235) e deployar prod quando a outra frente liberar** — sem isso, o próximo deploy da branch da feature **repete o buraco** (4º atropelo da mesma natureza). ⚠️ O **backfill/disparo retroativo abaixo está SUSPENSO** pela decisão "sem retroativo" desta sessão — só retomar se o Luis pedir. _Contexto do plano anterior:_ **aplicar o deploy em PROD para RESTAURAR a feature e então retomar o DISPARO RETROATIVO** (passo a passo no topo do `docs/NEXT-SESSION.md`): **(1)** deploy em **prod** (restaura a feature + D27; build pronto, 1112 testes, staging já validada) — obrigatoriamente ANTES do backfill, senão os 29 especiais entram na fila; ⚠️ **re-derivar a lista** com `scripts/dryrun-lider/ids-fila.ts` antes do passo 2 (eram 73 pendentes/35 na fila; com o projeto do Gustavo já são 74); **(2)** popular a fila de prod com os 35 projetos (hoje **vazia**, não há importação retroativa; `POST /api/admin/aprovacoes/reabrir`, fail-closed); **(3)** dry-run para o Luis conferir os 27 líderes; **(4)** disparo real — ⚠️ **27 líderes REAIS recebem DM**, confirmar antes. _Em seguida:_ **o Luis conferir a aba "Aprovações Pendentes por Líder"** e **provar o disparo ponta a ponta numa submissão real** — acompanhar a 1ª submissão de prod pelo `GET` no endpoint do Gomoon (`?email=`), que é o único pedaço da D26 nunca exercitado. O **PR #235 já está aberto** (nada a fazer com `/ggsd:ship` até ele mandar mesclar). ⚠️ 3 perguntas ao João Victor seguem abertas (§16 de `docs/integracao-gomoon-chat.md`): descarte de item em retry quando chega POST novo, volume de N POSTs, e confirmar que **ele** dispara o anúncio à mão (nada no GoDocs chama `/api/godocs/anuncio`).
paralelo, segue de pé: **o Luis escolher como proteger a staging de ser atropelada** (3× em 04/08 — ver o topo do
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
