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
**→ nenhum plano de código ativo.** O plano [edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md)
está **executado** (T1–T3). O próximo passo é **operacional/validação** (T5 staging), não um novo `/ggsd:plan`.

## Próximo passo (setado)
**Validar o round-trip em STAGING (regra 13, T5)** e então prod:
1. ⚠️ **Pré-requisito operacional (Luis):** criar as colunas **"Participantes 2"** e **"Contribuidor"** no
   cabeçalho das abas **GoDocs (prod)** e **STAGING** — sem elas a IDA ignora com aviso e os papéis
   Participante/Contribuidor nunca chegam ao Sheets (perda real).
2. `npm run test && npm run build && npm run build:worker` → deploy no **staging `edf400b4`** (fluxo do
   "Deploy rápido"). _(Nada server-side mudou nesta sessão, mas o deploy de staging leva o SPA novo.)_
3. Editar participantes/papéis de um projeto de teste **e** de um "legado" simulado; conferir as **3 colunas**
   de papel no Sheets, que a linha **não duplica** (UPDATE in-place por ID) e o reflexo no site após o sync.
4. Só então deploy em **prod `674a3710`**.

## Como retomar
1. Ler este handoff + `ROADMAP.md` + `docs/plans/edicao-etapa1-participantes.md` (seção "Resultado da sessão").
2. Ler, no `CLAUDE.md`, "Ambiente de Staging" (regra 13) + "Sync Google" (papéis dos participantes).
3. Conferir o pré-requisito das colunas com o Luis; então rodar o fluxo de staging (passo 2 acima).

**Pendências (não bloqueiam código, bloqueiam T5):** colunas "Participantes 2"/"Contribuidor" no header do Sheets.
**Perguntas em aberto:** ver `docs/open-questions.md` (nenhuma).
