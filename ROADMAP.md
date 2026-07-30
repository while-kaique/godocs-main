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

**Fase 6 (candidata, escopo fechado em 2026-07-30, ainda SEM plano):** **perguntas do agente — fatia A1 +
jornada preguiçosa**. A régua do critério entrou (Fase 5), mas a **poda** das perguntas antigas não: o gate
da alocação ainda **recusa "menos custo"** (o caso real da redução de 3 auxiliares levou 5 reperguntas) e o
gate da jornada dispara sem consequência em 15 de 24 conversas. Detalhe e decisões em
`docs/NEXT-SESSION.md` ("Sessão de 2026-07-30 (parte 6)").
**Próximo:** `/ggsd:plan` dessa fatia — sem plano aprovado, o `plan-gate` recusa qualquer edição de código.

⚠️ **Ao deployar staging, conferir qual branch está no ar** — o `updateApp` substitui a app inteira (em 30/07
um deploy vindo do `main` apagou as perguntas da Etapa 2 que só existiam na branch do critério).
⚠️ **O harness E2E aponta pra PROD por default** quando não acha o `.env` (worktree não tem um): exportar
`E2E_BASE_URL`/`E2E_COOKIE` e conferir a linha "🚀 E2E run … contra <URL>" antes de deixar rodar.

**Próximo:** avisar o Rafa e calibrar a régua com ele (humano). Frentes candidatas, nenhuma planejada:
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
