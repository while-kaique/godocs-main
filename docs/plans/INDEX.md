# Planos — índice

> Índice dos planos de sessão (ADR-026, refinado pelo ADR-034). Cada plano vive em seu **arquivo próprio**
> `docs/plans/<slug>.md`; este índice é o mapa rasteável. O `docs/NEXT-SESSION.md` é o **ponteiro enxuto** que
> aponta o plano **ativo**. Planos paralelos (tópicos/branches distintos) coexistem aqui sem se sobrescrever.

## Como cultivar (instrucional — sem hook)
- O **`/ggsd:plan`** cria `docs/plans/<slug>.md` (`Status: rascunho → aprovado (quem, data)`), adiciona/atualiza
  a linha aqui e marca o **ativo** (◀), e atualiza o ponteiro no `NEXT-SESSION.md`.
- O **`/ggsd:code`** segue o ponteiro até o arquivo do plano e só coda se o `Status` lá for `✅ aprovado` (RF-03).
- O **`/ggsd:handoff`** marca o plano `executado`/arquiva, atualiza esta tabela e **move o ponteiro** para o
  próximo plano ativo (ou "nenhum — próximo é planejar X"). Nunca deixa um plano `aprovado` órfão.
- **Slug** em kebab-case, **sem prefixo de data** (o git guarda a data/histórico — RF-17). Ex.: `cadastro-contatos`.

## Planos
| Plano | Status | Resumo (1 linha) |
|---|---|---|
| [edicao-etapa1-participantes](edicao-etapa1-participantes.md) | executado (2026-07-17) | Etapa 1 (participantes + papéis) editável na edição — T1–T3 + R1/R2 feitos+staging, T4 limitação, T5 validação/prod pendente |
| [ocultar-valor-meus-projetos](ocultar-valor-meus-projetos.md) ◀ ativo | ✅ aprovado (2026-07-17) | Tirar o badge de valor R$ dos cards de "Meus Projetos" — esconder p/ todos + não serializar (INV-02) |
