# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-17 (código) — **implementada** a Fase 2 (ocultar o R$ dos cards de "Meus
Projetos"), branch `feat/ocultar-valor-meus-projetos`. **T1** `mapItem` devolve `ganho_total_mensal: null`
(não trafega ao client) + teste unitário `meus-projetos-ganho-oculto.test.ts`. **T2** badge + `fmtGanho`
removidos. **T3** 562 testes verdes, `build`+`build:worker` OK, `worker.js` recomitado. Conformidade
(contexto fresco): **conforme (0.97)**. **T4 ✅ DEPLOYADO** staging (`edf400b4`) + **prod (`674a3710`)**
em 2026-07-17. **Falta só:** abrir PR p/ o `main` (regra 10: `git pull origin main` + rebuild antes).

_(Antes desta: 2026-07-17 (código) — Fase 1 implementada, branch `feat/edicao-etapa1-participantes`, T1–T3
+ R1/R2 feitos e deployados na STAGING; T4 = limitação. **Falta só o T5** — validação no navegador da
staging + prod; bloqueado pelo pré-req das colunas "Participantes 2"/"Contribuidor" no Sheets, ver abaixo.)_

## Plano ativo
**→ [docs/plans/remover-arquivo-e-doc-background.md](plans/remover-arquivo-e-doc-background.md)** · Status: ✅ aprovado (Luis, 2026-07-22)

_(Executados recentes: [ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ executado
2026-07-17 (falta T4 staging→prod); [edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md)
✅ executado — resta a validação T5 em staging/prod, ver "Frente NOVA"/pré-req das colunas abaixo.)_

## Próximo passo (setado)
**Abrir o PR da branch `feat/ocultar-valor-meus-projetos` para o `main`.** Já DEPLOYADO em staging+prod
(2026-07-17); resta só integrar ao `main`. Antes do PR (regra 10): `git fetch origin` + incorporar
`origin/main` (merge/rebase) + rebuildar `worker.js`/`dist` após o merge. PR como `LuisEduardo100`
(conta WRITER — ver memória `gh-pr-conta-writer`), restaurar a conta depois. Branch já commitada.

### Pendência paralela (Fase 1, não é código) — validação STAGING (regra 13, T5) e então prod
✅ **Staging DEPLOYADO 2026-07-17: SPA com T1–T3 (@14:58) + refinamento R1/R2 (@15:20)** no app `edf400b4`
(R1: edição abre na Etapa 1; R2: dados do projeto read-only, só participantes/papéis editáveis). Falta a
**validação no navegador** (Luis, hard-refresh) + o **pré-req das colunas**:
1. ⚠️ **Pré-requisito operacional (Luis):** criar as colunas **"Participantes 2"** e **"Contribuidor"** no
   cabeçalho das abas **STAGING** e **GoDocs (prod)** — sem elas a IDA ignora com aviso e os papéis
   Participante/Contribuidor nunca chegam ao Sheets (perda real). **Coautor** já grava ("Participantes").
   _(Status ao pausar: aguardando o Luis confirmar se já criou as colunas na aba STAGING.)_
2. No navegador logado da staging: hard-refresh em `/editar/$id` → conferir os **3 passos** (aparece "1 ENVIO"),
   navegar à Etapa 1, editar participantes/papéis, voltar à 2 e reenviar.
3. Conferir as **3 colunas** de papel no Sheets (aba STAGING), que a linha **não duplica** (UPDATE in-place por
   ID) e o reflexo no site após o sync.
4. Só então deploy em **prod `674a3710`** (mesmo fluxo: `deploy-godeploy.sh "<UPLOAD_TOKEN>"` → `updateApp`).

## Como retomar
1. Ler este handoff + `ROADMAP.md` + `docs/plans/edicao-etapa1-participantes.md` (seção "Resultado da sessão").
2. Ler, no `CLAUDE.md`, "Ambiente de Staging" (regra 13) + "Sync Google" (papéis dos participantes).
3. Conferir o pré-requisito das colunas com o Luis; então rodar o fluxo de staging (passo 2 acima).

**Pendências (não bloqueiam código, bloqueiam T5):** colunas "Participantes 2"/"Contribuidor" no header do Sheets.
**Perguntas em aberto:** ver `docs/open-questions.md` (nenhuma).

**Frente NOVA capturada (ADR-028, a planejar):** ocultar o valor R$ dos cards de "Meus Projetos" — plano-rascunho
em [docs/plans/ocultar-valor-meus-projetos.md](plans/ocultar-valor-meus-projetos.md). Ponto exato mapeado
(`meus-projetos.tsx:708-712`). Rodar `/ggsd:plan` numa sessão nova para aprovar antes de codar.
