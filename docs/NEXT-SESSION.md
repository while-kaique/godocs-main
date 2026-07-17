# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-17 (código) — **implementada** a Fase 2 (ocultar o R$ dos cards de "Meus
Projetos"), branch `feat/ocultar-valor-meus-projetos`. **T1** `mapItem` devolve `ganho_total_mensal: null`
(não trafega ao client) + teste unitário `meus-projetos-ganho-oculto.test.ts`. **T2** badge + `fmtGanho`
removidos. **T3** 562 testes verdes, `build`+`build:worker` OK, `worker.js` recomitado. Conformidade
(contexto fresco): **conforme (0.97)**. **Falta só T4** — validar em staging → prod (regra 13).

_(Antes desta: 2026-07-17 (código) — Fase 1 implementada, branch `feat/edicao-etapa1-participantes`, T1–T3
+ R1/R2 feitos e deployados na STAGING; T4 = limitação. **Falta só o T5** — validação no navegador da
staging + prod; bloqueado pelo pré-req das colunas "Participantes 2"/"Contribuidor" no Sheets, ver abaixo.)_

## Plano ativo
**Nenhum plano `aprovado` pendente de código.** A Fase 2 (`ocultar-valor-meus-projetos`) está
**executada** (T1–T3, branch `feat/ocultar-valor-meus-projetos`) — falta só o **deploy** (T4, não é
`/ggsd:plan`/`/ggsd:code`). Próxima frente de código nova → `/ggsd:plan` primeiro.

_(Executados recentes: [ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ executado
2026-07-17 (falta T4 staging→prod); [edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md)
✅ executado — resta a validação T5 em staging/prod, ver "Frente NOVA"/pré-req das colunas abaixo.)_

## Próximo passo (setado)
**Deploy da branch `feat/ocultar-valor-meus-projetos` na STAGING (`edf400b4`) → validar → prod (regra 13).**
Fluxo: `git checkout feat/ocultar-valor-meus-projetos` → `npm run test && npm run build && npm run build:worker`
→ `scripts/deploy-godeploy.sh "<UPLOAD_TOKEN>"` → `updateApp` no **`edf400b4`** → no navegador logado da
staging (hard-refresh em `/meus-projetos`): **card sem badge de R$** e **Network sem o número**
(`/api/meus-projetos` traz `ganho_total_mensal: null`) → só então **prod `674a3710`**. Antes do PR/merge:
`git pull origin main` + rebuild `worker.js`/`dist` (regra 10). Branch já commitada (código + docs desta sessão).

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
