# ROADMAP — GoDocs

> Onde estamos e para onde vamos. Atualizar o status a cada avanço.
> Legenda: ⬜ não iniciado · 🟡 em andamento · ✅ concluído · ⛔ bloqueado
>
> Contexto: projeto já em produção (`https://godocs.devgogroup.com/`). O GGSD foi adotado em 2026-07-17
> para dar estrutura às **próximas** mudanças; o histórico anterior está no git, no `CLAUDE.md` e em `spec-docs/`.

**Fase atual:** Fase 5 — **critério de projeto** (plano ✅ aprovado, **codado** em
`feat/criterios-projeto-classificacao`, no staging, ainda **não validado nem em prod**). Fase 4 (loadings do
`/dashboard`) ✅ **CONCLUÍDA** (PR #215, `main` `ad64895`); Fase 3 (dashboard = triagem) ✅ mergeada (PR #214).
`aceitar-zip-submissao` ✅ mergeada (PR #213). **Avulso 30/07:** **Coautor único por projeto** ✅ codado
(`feat/coautor-unico`) e **validado no staging** — falta prod + PR.
**Avulso 30/07 (parte 2):** achado e **corrigido** um **loop de reconciliação que estourava a cota do
Google Sheets** (`cb8d677`) — fazia submissão nova não chegar à planilha e ser purgada do SQLite após 1h;
prod nunca teve o bug, mas a staging degradava o Sheets de prod (mesma cota GCP). Staging redeployada.
**Próximo:** re-rodar o cenário `criterio-claro-nao` na staging para fechar a validação do caminho
`claro_nao → "Reprovado"`; então limpar os runs E2E, deployar **prod `674a3710`** com
`staging/criterios-coautor` (critério + coautor + fix) e abrir o PR com `/ggsd:ship`.
⚠️ **Ao deployar staging, conferir qual branch está no ar** — o `updateApp` substitui a app inteira (em 30/07
um deploy vindo do `main` apagou as perguntas da Etapa 2 que só existem na branch do critério).
**⚠️ Dois planos aprovados em paralelo:** este e `perguntas-agente-recorrencia-evidencia`; a ordem é escolha do Luis.
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

**Próximo:** abrir o PR da `feat/dashboard-admin-sheets` (staging e prod já deployados).

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

## Backlog
- ⬜ Tela de gestão de admins (endpoints `/api/admin/admins` existem, ninguém consome; link "Configurações"
  da sidebar aponta para `/configuracoes`, rota inexistente). Hoje só via `ADMIN_EMAILS`.
- ⬜ 🐞 `GET /api/admin/investigador/projetos` **quebrado em prod** (503 Cloudflare 1102): N+1 em
  `investigador.functions.ts:225-226` chama `getChatMessages` para todos os 605 projetos. Merece plano próprio.
