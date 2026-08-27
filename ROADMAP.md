# ROADMAP — GoDocs

> Onde estamos e para onde vamos. Atualizar o status a cada avanço.
> Legenda: ⬜ não iniciado · 🟡 em andamento · ✅ concluído · ⛔ bloqueado
>
> Contexto: projeto já em produção (`https://godocs.devgogroup.com/`). O GGSD foi adotado em 2026-07-17
> para dar estrutura às **próximas** mudanças; o histórico anterior está no git, no `CLAUDE.md` e em `spec-docs/`.

**Plano ativo — Frente 2: time autônomo de avaliação, FATIA B 🟡 (PARTE 1+2 CÓDIGO VERDE em 2026-08-27, NÃO fechada):**
RAG por corpus de aprovados + especialista Financeiro + Agregador/juiz com confiança (confiança baixa/divergência → `em_validacao`,
nunca decide negativo; especial/liderança isentos). Tudo env-gated, DEFAULT OFF (modo SOMBRA — grava recomendação, NÃO muda status).
PARTE 1: schema (`projeto_embedding`+`projeto_avaliacao`, separadas das `especial_*`), DB layer, `avaliarFinanceiro` +
`avaliarSinalRag`/`agregarVotos` (puros). PARTE 2: corpus `avaliacao-corpus.ts` + orquestrador `avaliacao-normais.functions.ts`
(RAG ao vivo via `embeddings.ts`→`projeto_embedding`→`selecionarVizinhos`; FTE+Financeiro→`agregarVotos`→`upsertAvaliacaoNormal`) +
3ª promise no `processarPosSubmissao` + cron `/api/cron/avaliar-normais` + admin routes + `worker.js`. Suíte **1959 verde**.
Branch `feat/agentes-avaliacao-teamB`. **Próximo:** §9 revisores sobre o diff completo (liberar os gates) → staging `edf400b4` com
`AVALIACAO_NORMAIS` ligado em sombra → validação do Luis. **Fatia C** (cético + deliberação + retroativo) DEPOIS. Detalhe no
`## Plano ativo` do `docs/NEXT-SESSION.md` e em `docs/plans/agentes-avaliacao-autonomos.md`.

**Plano ativo — API histórica de saving/receita p/ João Gabriel (squad Intelli), FASE 3 NÚCLEO 🟡 (código pronto+verde em 2026-08-26, NÃO deployado):**
agregador puro (`rollup-financeiro.ts`) + tabela durável `rollup_saving_receita` + backfill mensal (`rollup-backfill.ts`) + rota admin
`POST /api/admin/rollup-backfill`. Grão (mês de `submitted_at`, área, `tipo_saving`); saving e receita CRUS/SEPARADOS, nunca somados,
nunca ÷10; só aprovados; sem total geral. Branch `feat/rollup-historico-jg` (`ecd3c0e`, base RED `2881707`), suíte **1824 verde**.
⚠️ Revisão GGSD (§9) NÃO rodou — `/ggsd:ship` barra até rodar. **Próximo:** revisores §9 → staging `edf400b4` (`rollup-backfill` + conferir
`lerRollupMensal` × /dashboard) → prod `674a3710` → PR via `LuisEduardo100`. Depois: snapshot semanal + push outbound (dry-run até `JG_INGEST_URL`).
Detalhes na memória `api-historica-saving-receita-jg` + `~/.claude/plans/flickering-fluttering-rabin.md`.

**Plano anterior — Latência da IA: roteamento por FASE 🟡 (CÓDIGO T1–T4 FEITO + revisado em 2026-08-25):**
rotear turnos mecânicos (`doc`/`doc_preview`) para `gpt-5.6-luna` + `reasoning_effort=low`, mantendo
memorial/doc-compile/analisador no `sol` (Opção A). Tudo env-gated, default = hoje. Base: investigação
do proxy-ai (24–25/08, medições reais — `luna+low` TTFB 3,2s vs `sol/medium` 19,6s). Código em `llm.ts`
(`reasoningEffort?`/`sanitizeEffort`/injeção opt-in) + `orchestrator.ts` (cálculo por fase). Suíte 1711
verde, worker rebuildado; revisão GGSD conformidade=`conforme`, qualidade=`sugestoes`. Plano em
`docs/plans/latencia-ia-roteamento-por-fase.md`.
**Próximo:** T5 — medir na staging (`edf400b4`, secrets `LLM_MODEL_FAST=gpt-5.6-luna`+`LLM_REASONING_EFFORT_FAST=low`)
→ T6 docs (CLAUDE.md/SPEC) → T7 prod `674a3710` + merge no `main`.

**Fase atual:** **nenhuma em aberto** — Fase 5 (**critério de projeto**) ✅ **CONCLUÍDA** em 2026-07-30:
staging validada, prod `674a3710` deployado e **PR #216 mergeado** (`main` `39deaf9`). Fase 4 (loadings do
`/dashboard`) ✅ (PR #215); Fase 3 (dashboard = triagem) ✅ (PR #214); `aceitar-zip-submissao` ✅ (PR #213).
O **Coautor único por projeto** e o fix do **loop de reconciliação que estourava a cota do Sheets** (`cb8d677`)
foram a produção **dentro do PR #216**.

**Pendência HUMANA da Fase 5:** avisar o **Rafa** (a reprovação é visível ao autor — D10) e **calibrar a régua
com ele** usando casos reais, agora pós-deploy.

**Triagem do `/dashboard` — 4ª entrega ✅ EM PROD (2026-08-17, noite):** **estrelas sem teto** na ficha
(o `Math.min(nota,5)` rebaixava nota 8 ao salvar), **filtro por FAIXA de estrelas** + coluna ordenável, e o
**lote de fichas registrado EM VOO** (o clique num projeto recém-buscado abria uma 2ª requisição pela mesma
ficha). Branch `feat/estrelas-n-e-filtro` (`0e10d10`), **PR #263 aberto**, staging + prod deployados,
1528 testes verdes. ⚠️ Coluna nova em `COLUNAS_RESUMO` exige bumpar `VERSAO_RECORTE_RESUMO` (entra no
`hashLinha` do espelho) — foi o que forçou o re-espelhamento único (`espelhados=643`).
Rodada 2 (`2cd3437`, também em prod): filtro de estrelas virou **pílula + painel ancorado** (reusa o
`Popover` do calendário) e a **contagem do pré-status passou a respeitar os demais filtros** (fonte única
`casaFiltrosExceto`) — 1535 testes verdes.
**Próximo:** o Luis validar em prod → **mergear o PR #263**.

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

## Fase 3 — Dashboard do admin = triagem sobre a planilha ✅
- 🟡 **Filtros combináveis + calendário próprio (17/08, branch `feat/dashboard-filtros-calendario`)** —
  natureza (especiais) · ganho (saving/receita) · área · período, todos somando em AND com a fila de status;
  contagens das pílulas passam a ser do recorte. Calendário de um mês só (1º clique = início, 2º = fim) com
  atalhos, reusado como campo de data da Etapa 2. Filtros e calendário **aprovados
  pelo Luis** na staging (17/08).
- 🟡 **Payload da listagem −38% + nota "Estrelas" editável (17/08, staging v159)** — a lentidão em
  prod era VOLUME, não leitura da planilha: 563,6 → 346,1 KB (`observacoes` sozinho eram 160 KB,
  28%, e a tabela nunca os desenhou). Coluna manual "Estrelas" (Q) passa a ser editável na ficha.
  Falta o Luis confirmar na staging → prod + PR.
- ✅ **Ficha em LOTE + auth fora do caminho crítico — EM PRODUÇÃO (17/08, v251)**: abrir ficha era
  1 requisição por projeto e a entrada no `/dashboard` esperava o `/api/auth/me`; nenhum dos dois
  lia a planilha, era contagem de requisições (~750 ms cada).
- ✅ **PR [#262](https://github.com/while-kaique/godocs-main/pull/262) aberto** (MERGEABLE/CLEAN,
  13 commits) — **falta só o merge**, autorizado pelo Luis mas **barrado por outage do GitHub**
  (API em 503; git puro funcionando). Retry em segundo plano; senão, `gh pr merge 262 --merge`.
- ✅ **Filtros + calendário + payload + Estrelas EM PRODUÇÃO em 17/08 (v249)**, junto com o card de edição do Kaique (PR #261) — o
  merge do `origin/main` foi feito ANTES do empacotamento, senão o deploy o teria apagado.
  **Falta só o push + PR da branch `feat/dashboard-filtros-calendario`.**
- ✅ **Filtro de pré-status do líder (17/08)** — 5ª dimensão dos filtros; rótulos passam a sair de
  `ROTULO_ESTADO_PARECER` (fonte única com o chip da tabela) e a ISENÇÃO "(liderança)" fica fora
  de "Pré-aprovado" de propósito. Na staging; falta o OK → prod + PR.
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

**06/08 (mais recente) — ✅ MERGE FEITO (PR #235) + 403 do líder CORRIGIDO (D28) + `fix/pre-pendente` integrado.** O 403 que barrava o `/ggsd:ship` foi reportado por um líder REAL (Estevão Vidal, print com "Acesso negado.") e virou fix: 3ª porta de leitura em `getMeuProjeto` para quem tem linha em `projeto_aprovacoes` — só leitura, `podeEditar` intocado. Junto entraram a **D27**/**D28** na spec + `CLAUDE.md`, a contradição do cron da F3 e o teste do critério 6; a sugestão de tirar `abrirPreAprovacao` do caminho quente foi **recusada com motivo** (§11.6 da spec: mover ela atrasa o append da planilha).

**06/08 (mais recente) — ✅ SINCRONIZADO E NO AR:** `main` = staging `edf400b4` (18:00 UTC) = prod `674a3710` (18:04 UTC). Antes do deploy foram integradas as 2 branches que estavam fora da `main` (PR #237 — uma delas **já no ar**, que o deploy teria apagado) e resgatados os 2 planos que só existiam na raiz (PR #238); a raiz foi fast-forwardada (143 commits atrás). Validação sem browser: o erro amigável de validação (código que só existe no build novo) responde **400** nos dois apps, onde prod dava **500 com ZodError cru**; e o preview de admin mostra que o **Estevão** tem exatamente o projeto do print na fila — a linha em `projeto_aprovacoes` é a única condição da porta nova (D28).

**06/08 (sessão de PLANEJAMENTO) — 🟡 plano APROVADO: dispensar a fila do líder quando o analisador reprova.** Medição em prod antes de decidir (595 linhas; 32 com parecer): **0** projetos com `Status = Reprovado`, **0** com `claro_nao` na fila e **18/32 (56%) sem `Classificação` nenhuma** (analisador cancelado). Por isso o **gate sequencial** ("analisar antes de convocar o líder") foi **DESCARTADO** — seria inerte em mais da metade dos casos e acoplaria o caminho da submissão à parte mais instável do pipeline. O que foi aprovado é o desenho mínimo: quando a análise decide `claro_nao`, as linhas **pendentes** da fila viram **`'dispensado'`** (`decidido_por='sistema'`) e o projeto sai do backlog das DMs do Gomoon, do relatório de espera e da tela `/aprovacoes`; a coluna grava **`Dispensado`** — nunca `Pré-reprovado`, que afirmaria falsamente que o líder reprovou (é o risco nº 1 do plano: o fall-through atual de `rotuloAprovacaoSheet`). Parecer humano **vence** a dispensa; `reabrirPreAprovacoes` passa a reabrir fila dispensada sem `forcar` (remédio para a triagem que reverte a reprovação). Plano: [docs/plans/dispensa-fila-lider-reprovado.md](docs/plans/dispensa-fila-lider-reprovado.md) · **nenhum código alterado nesta sessão** · branch/worktree já criados (`fix/dispensa-fila-lider-reprovado`). Achado colateral **fora do escopo**: os 56% sem `Classificação` (o cron `reanalisar-pendentes` repõe Complexidade/Observações, não a Classificação).

**06/08 (sessão de CÓDIGO) — ⏸️ ABERTA E PARADA ANTES DE PRODUZIR CÓDIGO.** Baseline verde (1135), blast-radius varrido e **zero linha de produção**: a janela de contexto encheu com o `test-writer` ainda escrevendo o teste red, e implementar sem ele seria furar a própria trava anti-sicofância. O que ficou pronto para a próxima: as **4** consultas SQL de "pendente" já fazem o projeto dispensado sumir da fila/DM/contador (**critério 1 de graça**); o `Veredito` local de `routes/aprovacoes.tsx` **não** muda; e apareceu um dependente que o plano não previu — `MeuProjetoItem['aprovacao']` é tipado mais estreito que `Veredito`, então **a UI do card do autor entra obrigatoriamente** (o TS quebra sem ela) e o fall-through atual diria **"Aguardando o líder"** sobre um projeto já reprovado. **Decisão do Luis:** mostrar *"Pré-aprovação dispensada — o projeto foi reprovado na análise"*. Plano visual fechado (cinza-ardósia + borda tracejada + `CircleSlash`, sem hue nova). Nada commitado — sessão SUJA por construção (`.review-status`/`.quality-status` = `pendente`).

**✅ O teste RED ficou pronto** (o subagente terminou depois do fechamento): `tests/dispensa-fila-lider.test.ts` (13 casos) + `tests/sync-dispensa-lider-update.test.ts` (3), **`red-confirmado`, confiança 0,92** — `2 failed | 82 passed (84)` arquivos, `14 failed | 1137 passed (1151)` testes, **baseline intacta** e todas as falhas por asserção. O red mais eloquente é o risco nº 1 do plano em texto: a planilha dizendo *"Pré-reprovado por Lucas Gonçalves Queiroz (sistema)"* sobre quem nunca abriu o projeto.

**06/08 (sessão de CÓDIGO) — ✅ IMPLEMENTADA: a fila do líder é dispensada quando o analisador reprova.**
T1–T8 entregues no worktree `dispensa-fila-lider`; **1155 testes verdes** (baseline 1151), `worker.js`
rebuildado, spec **§12/D29** + linha no `CLAUDE.md`. O teste red pré-existente foi usado como estava —
**nada refeito, nada enfraquecido**. ⚠️ **Falta só a T9** (staging `edf400b4` → validar → prod `674a3710` → PR).

**O achado que muda a leitura do plano: o "Risco nº 1" tinha 3 telas, não 1.** O plano previa o
fall-through de `rotuloAprovacaoSheet` (a planilha dizendo `Pré-reprovado` sobre quem nunca abriu o
projeto). A varredura achou a 2ª — o card do autor dizendo *"Aguardando o líder"* — e o **revisor de
qualidade de contexto fresco** achou a 3ª, que escapou do meu grep: `/projeto/$id` exibia **"✓ Parecer
registrado"** ao líder de uma fila dispensada (o padrão era `veredito ?? "pendente") === "pendente"`, que
o grep de `veredito ===` não casa). As 3 foram tratadas com rótulo + ícone. **Lição que virou invariante
na D29:** *ampliar o enum `veredito` obriga a varrer os LEITORES, não só os escritores.*

**Mais 2 defeitos meus pegos pela revisão de contexto fresco:** (1) o `try` único de
`dispensarPreAprovacao` fazia *"gravou mas a re-leitura falhou"* virar *"não fez nada"* — SQLite com a
fila fechada e planilha travada em `Pré-pendente`, **sem nada que reconcilie essas 2 colunas depois**;
separado, com teste de duplo-fault. (2) Eu escrevi uma **contradição na própria spec** (invariante 3 × 4);
corrigida. Ambos provam o valor do gate: nenhum apareceria numa auto-crítica no meu próprio contexto.

**De quebra:** a união `Veredito` estava **copiada em 3 arquivos** e velha desde 04/08 (faltava `'ajuste'`).
Unificada — fechou **2 dos 7** erros de `tsc` pré-existentes do repo (sobram 5, todos alheios à fatia).
**Adiado com motivo (ADR-028):** extrair `Veredito` para módulo PURO (padrão `coluna-chave.ts`); hoje o
`import type` é apagado e o bundle do cliente foi conferido limpo. **Lacuna registrada:** `analisarProjetoFn`
não tem teste algum neste repo, então o `try/catch` do hook (T4) é redundância não coberta — as 2 pontas
estão presas um nível abaixo. **Fora do escopo, de propósito:** os 56% sem `Classificação`; e a triagem que
reprova **à mão** no `/dashboard` **não** dispensa a fila (só o analisador dispensa) — está na D29.


**07/08 — ✅ AS 2 FRENTES ESTÃO NO AR (staging 13:00 UTC · prod 13:47 UTC) e o repo sincronizado.** Deploy **conjunto** obrigatório (o `updateApp` substitui a app inteira): a dispensa da fila do líder (D29) + a ferramenta editável. As 2 branches nasciam do MESMO `df4b20c` — sem regra 10 a cumprir; conflito só nos 2 docs (resolvidos **unindo os lados**) e no `worker.js` (resolvido pelo **rebuild**); o `chat.functions.ts`, tocado pelas duas, auto-mergeou. **1161 testes verdes**, `worker.js` = 993.081 bytes, PR **#242**. ⚠️ **A validação foi ESTRUTURAL, não funcional** — o `E2E_COOKIE` do `.env` **expirou** (302 → login nos 2 apps), então provei o build pelo `getApp`: `worker.js` byte-a-byte o local e o `index.html` servido apontando para o mesmo entry do `dist/` (o hash do Vite **é** o conteúdo). Runtime segue sem prova: o Luis valida a ferramenta no navegador, e a D29 só se observa quando o analisador reprovar alguém de verdade (havia **0** `claro_nao` em prod). ✅ Antes de tocar prod, **provei que prod era exatamente a `main`** (build de `df4b20c` → `index-Dgj_1Kpn.js`, idêntico ao servido) — a checagem que evita o 6º atropelo.

**07/08 — 🟡 Ferramenta EDITÁVEL na Etapa 1 da edição (codada, falta staging).** Pedido do Luis: na edição só dava pra mexer em participantes, e ele quer poder trocar a **ferramenta** (caso real **Vercel → GoDeploy**). Branch `feat/editar-ferramenta-na-edicao` (`e678bf0`): o card "somente leitura" ficou só com **Escopo + Status** (⚠️ revoga em parte o R2 de 17/07 — emenda no plano), o `<select>` mostra a ferramenta de legado que está fora da lista, "Outros" sem nome passa a bloquear nos 2 modos, e `atualizarMetadados` passou a persistir `servico_externo` (escopo externo alimenta o prompt do orquestrador). **1141 testes verdes**; falta **staging `edf400b4`** + validação no navegador, depois PR e prod.

**13/08 — 🟡 Ficha de triagem do `/dashboard` abre sem espera (codada, falta staging).** Com o espelho no ar a **listagem** ficou rápida, mas **abrir uma linha** ainda esperava ~1 s — e não era a planilha nem o SQLite (a ficha é um `SELECT` por PRIMARY KEY): o dialog só pedia a ficha **depois do clique**, e aqui toda requisição carrega **~750 ms de overhead FIXO do edge** (o mesmo número do `/favicon.svg`). É a lição do code-splitting aplicada a **dado**: o que importa é a CONTAGEM de requisições. Fix na própria `feat/espelho-e-perf-navegacao` (`14d94e0`): `Promise.all` nas 2 leituras independentes do servidor + **prefetch por INTENÇÃO** no `hover`/`focus` da linha (150 ms, a régua do `defaultPreloadDelay`) com cache de **30 s** por id — erro nunca cacheado, invalidação ao gravar, timer único, tudo em memória (a decisão de 28/07 sobre localStorage segue intacta). ⚠️ Introduz I/O no hover **de propósito**: é seguro porque a rota do detalhe lê o **espelho**, não o Sheets — se ela voltar a ler a planilha, o prefetch sai no MESMO commit. **1443 testes verdes** (baseline 1428), `worker.js` rebuildado. Falta **staging `edf400b4`** → validar abrindo fichas → prod `674a3710`.

**13/08 — ✅ A FICHA INSTANTÂNEA ESTÁ NO AR (staging `edf400b4` v156 às 13:24 UTC · prod `674a3710` às 13:29 UTC).** Build com **1443 testes verdes**, `origin/main` já incorporado, `worker.js` 1.010,7 kb. Sinal de runtime verde nos dois apps na corrida de cron seguinte ao deploy: `[sync-reverse] … erros=0` em ~1,4 s (staging `total=578`, prod `total=626`), zero exceções, SPA 200. ⚠️ **A validação de navegador (T7) foi DISPENSADA pelo Luis** (*"Deployar a prod agora"*): ninguém confirmou **de olho** que a ficha abre sem spinner — o provado é que o worker novo está no ar e saudável. Se abrir uma linha ainda demorar ~1 s, o alvo é `src/lib/dashboard-detalhe-cache.ts`.

**13/08 — ✅ Aba "Especiais Pendentes +15 dias" na planilha de prod.** Fila de trabalho para a triagem aprovar os ESPECIAIS **do mais antigo para o mais novo** — pedido do Luis: *"é só pra eu poder me guiar na hora de aprovar os projetos… galera tá reclamando aqui"*. Especial é a **única fila sem rede** (não abre fila de líder — D27 — e pula o memorial financeiro: a validação humana da RPA é a única porta), e nada denunciava um parado. Script `scripts/dryrun-lider/relatorio-especiais.ts`, irmão do `relatorio-espera.ts` (aba dedicada, dry-run por default, `ESPECIAIS_WRITE=1` para escrever). 1ª corrida: 65 especiais · **30 pendentes** · **19 acima de 15 dias**, o mais antigo com **53 dias**.

**Próximo:** 🔴 **`git push` da `feat/espelho-e-perf-navegacao` + PR** — a última pendência grave do repo: o espelho, a perf do Kaique e a ficha instantânea estão **EM PRODUÇÃO**, mas a branch **nunca saiu da máquina**, então o `main` não tem nada disso e **qualquer deploy a partir do `main` derruba os três de uma vez**. ⚠️ Rodar os **3 revisores** antes (nunca rodaram sobre o espelho — o `/ggsd:ship` barra até rodarem) e **avisar o Kaique** de que os commits dele vão DENTRO deste PR. _Em paralelo, segue de pé:_ 🟢 **renovar o `E2E_COOKIE`** do `.env` (vencido — bloqueia o harness E2E inteiro, não só a validação deste deploy) e **validar no navegador** o que subiu. _Em paralelo, segue de pé:_ 🟡 **olho humano de LÍDER — 2 confirmações, 1 clique cada:** o Estevão (ou o Lucas) reabrir "Ler a documentação completa" e ver a doc; e acompanhar a próxima submissão real de um liderado para **provar o wiring do aviso** (único pedaço da D26 nunca exercitado ponta a ponta), conferindo no `GET` do endpoint do Gomoon. 🟡 **O Luis validar no navegador** a ferramenta editável na staging (trocar a ferramenta em `/editar/<id>`, reenviar, conferir a coluna "Ferramenta" na aba `STAGING`; testar um legado e um projeto de escopo externo). _Depois:_ decidir sobre o **backfill dos 35** (SUSPENSO pela decisão "só com os novos submetidos") · 3 perguntas ao João Victor (§16 de `docs/integracao-gomoon-chat.md`). 🆕 **Pedido novo do Lucas (não planejado):** o card da fila precisa mostrar o que a pessoa marcou em **"Alguém já fazia?"** (`alguem_fazia` hoje não vai no payload do card) — mudança de payload + UI, começar por `/ggsd:plan`; 2 perguntas de escopo para ele no `docs/NEXT-SESSION.md`.
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

✅ **D30 (decisão do Luis, 11/08) — o alerta do grupo do Google Chat passa a ser disparado pela
PRÉ-APROVAÇÃO, não pela submissão/edição. EM PRODUÇÃO desde 12/08 (version 237).** Plano em
[docs/plans/chat-notifica-so-pre-aprovacao.md](docs/plans/chat-notifica-so-pre-aprovacao.md);
**T1–T7 ✅ codadas em 12/08** na branch `feat/chat-notifica-so-pre-aprovacao` (1242 testes verdes,
`worker.js` rebuildado, `CLAUDE.md` + spec **D30** atualizados) — **⛔ nada no ar**. Régua: fila aberta → cala na submissão e dispara no veredito `aprovado`; `ajuste`/`reprovado`
não notificam; quem **nunca** terá parecer (especial · autor liderança · sem líder · TeamGuide fora) notifica
na submissão **com a linha do porquê** (silenciar sumiria com o projeto do grupo); o alerta do **especial**
fica enxuto; e a 2ª mensagem por submissão (`Análise Pendente`, do `syncUpdateToGoogle`) é **suprimida** —
passa a ser **1 mensagem por projeto**. ✅ **Os 3 revisores de contexto fresco voltaram e nenhum barra o
envio** (conformidade `diverge-baixa` · qualidade `sugestoes` · reuso `possivel-duplicacao`): 4 achados
corrigidos no commit `d7447eb` — o mais grave era o alerta lendo saving de fonte **stale** (`documentacao.conteudo`,
que o submit corrige só em memória), o que anunciaria **R$ 0,00** num projeto de custo evitado — e **6 ficaram
em aberto**. ⚠️ Os marcadores no disco do worktree, porém, **seguem em `pendente`** e barram o
`git push`/`/ggsd:ship` — a sessão de código re-roda os 2 revisores (o veredito vale para o diff que eles viram).

🟡 **12/08 — o achado nº 1 (mensagem DUPLICADA no grupo) virou fatia própria, com plano aprovado:**
[docs/plans/chat-uma-mensagem-por-decisao.md](docs/plans/chat-uma-mensagem-por-decisao.md) (T1–T6, tático,
MESMA branch). Decisão do Luis: corrigir **antes** de deployar. O gate de `decidirAprovacao` é
**check-then-act** (SELECT da linha `pendente` → UPDATE), então duplo clique / retry / 2 líderes da mesma
fila (**D4**) notificam **2×**; o `UPDATE` já serializa e falta o `rowsWritten` chegar ao gatilho. ⚠️ **"não
sei" ≠ "zero"**: nenhum caminho de produção lê `rowsWritten` hoje, então `null` **notifica** — um `> 0` cru
sobre `undefined` trocaria a duplicata por **silêncio permanente**.

✅ **12/08 — AS 2 FATIAS ESTÃO EM PRODUÇÃO.** T8 fechada no mesmo deploy: staging `edf400b4` version 141
(13:51 UTC, runtime validado 13:56) → **prod `674a3710` version 237, 14:32 UTC**. 1258 testes verdes,
`worker.js` rebuildado **idêntico ao commitado**, runtime provado pelo cron das 14:33:03 (3909 ms = cold start
do bundle novo, `200`/`ok`/`exceptions: []`). ⚠️ Antes de deployar ficou provado que **prod era o `main` puro** —
a branch NÃO-mergeada do Kaique (`origin/feat/faq-page`) **não estava no ar** (zero ocorrências de `faq` nos
4489 assets acumulados) e o entry buildado `index-Cqk-K4Ph.js` **bateu** com o que a prod já servia.

**Próximo:** **PR** da branch `feat/chat-notifica-so-pre-aprovacao` (`/ggsd:ship` — a fatia fechou; a branch
segue **local, não pushada**). ⚠️ E acompanhar a **1ª pré-aprovação REAL de líder em prod**: é o único
momento em que o **conteúdo** da mensagem se confere (a staging não tem webhook, então nada era enviado lá).

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

## Fase — Comparador de projetos ESPECIAIS por ÂNCORA (`/especiais`) 🟡

**Por quê:** discussão GoBrands × PIAPP (18/08/2026) — o projeto saiu de 8 estrelas para "será
que vale alguma?" numa conversa só, porque a coluna "Estrelas" é um número sem denominador
(1/2/3 sem definição escrita, nenhuma justificativa gravada, comparar dois especiais exige abrir
duas documentações).

**Decisão:** a régua é **ÂNCORA, não rubrica absoluta** — cada nível tem no topo o projeto REAL
que o define + a frase da régua. A pergunta vira "isto é maior ou menor que o PIAPP?".

- [x] Módulo PURO `especiais-view.ts` + 14 testes (agrupamento, âncoras, alvos da comparação)
- [x] Servidor `especiais.functions.ts` + tabela INTERNA `especial_referencia` + 4 rotas admin
- [x] Tela `/especiais` (colunas por nível, prateleira da régua, ±1 estrela, comparar lado a lado)
- [x] Spec (`SPEC_FEATURES_NOVAS.md`) + CLAUDE.md
- [ ] Deploy STAGING (`edf400b4`) + validação visual do Luis
- [ ] Prod (`674a3710`) + PR
- [ ] **Peça 4 — agente classificador** (propõe a caixa comparando com as âncoras; NUNCA grava a
      nota). Prompt pronto em `docs/NEXT-SESSION.md`.
- [ ] **Em aberto (peça 1):** a estrela mede impacto para a empresa ou mérito do projeto? Foi a
      ambiguidade exata do GoBrands.
