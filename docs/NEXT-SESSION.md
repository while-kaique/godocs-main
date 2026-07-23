# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-23 (código) — **`remover-arquivo-e-doc-background` CONCLUÍDA e integrada.**
F1 (remover arquivo já enviado, ✕ + re-upload) + F2 (processar doc em background ao subir arquivos) +
**ajuste "adiantar o background"** (feedback do Luis: a demora era ao clicar em avançar 2.5→3, com
`await bgPromiseRef` travando o botão; o gatilho `camposMinimosDocProntos` foi enxugado para só
escopo+nome da Etapa 1, então o processamento arranca assim que o arquivo é anexado). **576 testes
verdes**, `build` OK, frontend-only (`worker.js` intacto). ✅ Validado na **staging `edf400b4`** →
✅ **deployado em prod `674a3710`** (02:36) → ✅ **PR #211 MERGEADO** no `main` (merge commit `724cd4d`,
02:39). Branch remota deletada; `main` local sincronizado.

_(Antes: 2026-07-17 (código) — Fase 2 ocultar R$ em "Meus Projetos" (PR #210, mergeada+prod); Fase 1
`feat/edicao-etapa1-participantes` — T1–T3+R1/R2 na STAGING, **falta T5** (validação + prod), bloqueado
pelo pré-req das colunas "Participantes 2"/"Contribuidor" no Sheets, ver abaixo.)_

## Plano ativo
**Nenhum plano `aprovado` pendente de código.** `remover-arquivo-e-doc-background` está
**✅ concluído** (mergeado em prod + `main` via PR #211, 2026-07-23).

⚠️ **Reserva registrada (se a demora ao avançar ainda incomodar em uso real):** "adiantar o background"
mitiga mas NÃO elimina o spinner para quem anexa e avança em ~2-3s. Opção mais forte já desenhada e
NÃO implementada: **navegar para a Etapa 3 na hora do clique e mostrar "lendo sua documentação" dentro
do chat** (a espera some da transição e vira o agente trabalhando). Alteraria `handleIniciarAgente`
(submeter.tsx:1206) + um estado de carregamento no `step3-chat`.

_(Executados recentes: [remover-arquivo-e-doc-background](plans/remover-arquivo-e-doc-background.md)
✅ concluído 2026-07-23; [ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ mergeado
(PR #210); [edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md) ✅ executado — resta a
validação T5 em staging/prod, ver "Frente NOVA"/pré-req das colunas abaixo.)_

## Próximo passo (setado)
**Nada pendente na frente de submissão.** As pendências abertas são a **validação T5 da Fase 1**
(Etapa 1 editável — depende do pré-req das colunas no Sheets, abaixo) e, se surgir feedback de uso, a
**reserva "navegar-já"** descrita no Plano ativo. Sem plano aprovado aguardando código — rodar
`/ggsd:plan` numa sessão nova para a próxima frente.

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
