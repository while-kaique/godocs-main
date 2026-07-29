# ROADMAP — GoDocs

> Onde estamos e para onde vamos. Atualizar o status a cada avanço.
> Legenda: ⬜ não iniciado · 🟡 em andamento · ✅ concluído · ⛔ bloqueado
>
> Contexto: projeto já em produção (`https://godocs.devgogroup.com/`). O GGSD foi adotado em 2026-07-17
> para dar estrutura às **próximas** mudanças; o histórico anterior está no git, no `CLAUDE.md` e em `spec-docs/`.

**Fase atual:** Fase 5 — **critério de projeto** (código ✅ completo em 2026-07-29, na branch
`feat/criterios-projeto-classificacao`). As Fases 3 e 4 estão ✅ **mergeadas e em prod** (PRs #214 e #215).
**Próximo:** **codar o gate determinístico do `[1.3]`/`[1.4]`** (T8 do plano — **decidido em 2026-07-29**
com a evidência das 7 conversas na staging: o agente passa em 3 dos 5 comportamentos, mas o modo **receita**
fecha sem o `[1.3]` e o **custo evitado** grava só metade do `[1.4]`). Em seguida, **destravar a validação do
analisador**, hoje **bloqueada**: na staging a análise morre antes de gravar (timeout de 25s no proxy →
fallback → `waitUntil` cancelado) e o cron `reanalisar-pendentes` **não dispara**, então `Classificação`/
`Reprovado`/`Motivo Reprovado` seguem **sem evidência** — os critérios de aceitação 1 a 4 do plano dependem
disso e **não se vai a prod sem eles**. Só então **prod `674a3710`** → PR — **calibrando a régua com o Rafa
antes de produção** (reprovar projeto é visível ao autor).

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

**Próximo:** abrir o PR da `feat/dashboard-admin-sheets` (staging e prod já deployados).

## Fase 4 — Loadings do `/dashboard` do admin ✅
Tirar a espera percebida da tela de triagem. Medido: leitura do Sheets **1.450–2.360 ms** / payload **2,65 MB**,
mas a causa é **serialização** — o `beforeLoad` bloqueia em "Verificando permissões" e só depois o `useEffect`
lê a planilha; o cache do servidor é in-memory sem revalidação em background, e o de auth também.
- ✅ Planejar (`docs/plans/loadings-dashboard-admin.md` — aprovado 2026-07-28; escopo escolhido pelo Luis:
  itens 1+2+3+4, **cache em SQLite FORA**).
- ✅ Implementado T1–T5 (commit `3b93c65`) e **T6 fechado em 2026-07-28**: staging validada → prod
  `674a3710` → **PR #215 mergeado** (`main` = `ad64895`). Nada pendente.
- **DoD:** cache vencido responde na hora com revalidação em background; reload/navegação entre telas admin
  não mostra "Verificando permissões"; as duas requisições saem em paralelo no 1º acesso; skeleton interativo
  no lugar do spinner; planilha segue fonte única e "Atualizado Em" intacta; testes verdes; staging antes de prod.
- **Fronteira:** sem cache em SQLite — o 1º acesso após isolate frio segue custando ~2,5 s (agora com skeleton).

## Fase 5 — Critério de projeto: elegibilidade, classificação e reprovação com motivo 🟡
Pedido da gestão (Rafa, caso da **nuvem de palavras**): apertar o que conta como projeto pela régua
**recorrência · contrafactual · rastreabilidade** — sem barrar o formulário.
- ✅ Planejar (`docs/plans/criterios-projeto-classificacao.md` — aprovado 2026-07-29).
- ✅ Implementar T1–T7 (2026-07-29): perguntas da Etapa 2 · seção "Processo alterado" no memorial ·
  classificação em 3 níveis + `normalizarClassificacao`/`decidirStatusSubmissao` (puras) · 3 colunas do
  Sheets + espelho SQLite + reconciliação · motivos na triagem do `/dashboard` · motivo visível ao autor ·
  régua de 1 página + `spec-docs/SPEC_CRITERIOS_PROJETO.md`. **723 testes verdes.**
- ✅ **Refinamento pós-staging (2026-07-29, pedido do Luis):** o **ponteiro movido + onde verificar SAÍRAM do
  formulário** e passaram para o **agente** (seção obrigatória `[1.4]` "Ponteiro movido e onde verificar" nos 3
  modos do `MEMORIAL_ESQUELETO` — pergunta 1× qual ponteiro, 1× onde se confere, constrói o racional COM a
  pessoa, aceita "não sei onde conferir" → zona cinzenta, nunca reprovação automática); e **"quem reclama"
  virou seleção da Team Guide** com filtro dinâmico **pessoa OU time/área inteiro** (`AfetadosInput`, coluna
  `contrafactual_afetados`), só "o que piora" segue texto livre. **726 testes verdes**, staging redeployado.
- ✅ **Contexto do formulário chega ao agente (2026-07-29, commit `53e8ef8`):** o `[1.4]` era **cego ao
  contrafactual** — os campos da Etapa 2 nem eram lidos do banco para o agente. `buildRespostasFormulario`
  virou a **fonte única** do bloco de formulário nos 4 prompts; `buildDetalhesAprovados` idem para a doc
  herdada pelas fases financeiras (+ `dependencias`/`configurar_antes`/`atencao`, de onde sai a fonte do
  `[1.4]`); o `[1.4]` passou a deduzir o ponteiro em vez de perguntar. **739 testes verdes.**
  ⚠️ Decidido: **"quem reclama" NÃO muda de tela** — a Etapa 2 é o único ponto por onde todos os projetos
  passam (depois dela o fluxo abre em saving/receita/especial).
- ⬜ **Calibrar a régua com o Rafa** (gate humano — reprovar projeto é visível ao autor).
- 🟡 Validar no **staging `edf400b4`** pelos **8 cenários** de `docs/roteiro-validacao-criterios.md` (que
  também fixam a regra de decisão do gate do `[1.4]`) → **prod `674a3710`** → PR.
- **DoD:** "nuvem de palavras" sai `Reprovado` com motivo; saving recorrente com indicador segue `Pendente`
  sem mudança; ganho sem fonte vira `Zona cinzenta`/`Em validação`; a coluna `Classificação` nunca fica
  vazia; ninguém é reprovado sem motivo; especial nunca reprova automático; `Observações` e `Motivo Reenvio`
  intactas pelo sistema; contagem de perguntas por submissão não piora.
- **Fronteira:** barrar submissão no formulário fica **FORA em definitivo**; a régua de complexidade e a
  rota de projeto especial não foram tocadas; legados não recebem backfill de `Classificação`.

**Próximo:** validar no staging o fluxo refinado (ponteiro no agente + seletor pessoa/time) e calibrar a
régua com o Rafa.

## Backlog
- ⬜ Tela de gestão de admins (endpoints `/api/admin/admins` existem, ninguém consome; link "Configurações"
  da sidebar aponta para `/configuracoes`, rota inexistente). Hoje só via `ADMIN_EMAILS`.
- ⬜ 🐞 `GET /api/admin/investigador/projetos` **quebrado em prod** (503 Cloudflare 1102): N+1 em
  `investigador.functions.ts:225-226` chama `getChatMessages` para todos os 605 projetos. Merece plano próprio.
