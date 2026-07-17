# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-17 (código) — **implementada** a Fase 1 (Etapa 1 editável na edição), branch
`feat/edicao-etapa1-participantes`. **T1** (UI/rota da Etapa 1 na edição, 4 pontos) + **T2** (validação
relaxada p/ legado via `validarEtapa1` pura extraída) + **T3** (persistência participante-only, já correta,
com teste de guarda). **T4** (não resetar doc do especial) **registrado como LIMITAÇÃO** — exigiria mudança
server-side e a doc do especial é determinística (regenera idêntica). 561 testes verdes; `npm run build`
compila; sem `build:worker` (nada server-side). Verificação de conformidade: `diverge-baixa` (0.9). **Falta o
T5** — validar em staging antes de prod (regra 13). NÃO commitado em prod/staging ainda; só na branch.

## Plano ativo
**→ [docs/plans/edicao-etapa1-participantes.md](plans/edicao-etapa1-participantes.md)** · Status: ✅ executado
(T1–T3 + refinamento R1/R2). Só resta a validação T5 (navegador/staging) + prod — não é um novo `/ggsd:plan`.

## Próximo passo (setado)
**Concluir a validação em STAGING (regra 13, T5) e então prod.**
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
