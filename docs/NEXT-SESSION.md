# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-17 — adotado o GGSD (estrutura leve, `CLAUDE.md`/`spec-docs/` preservados; SPEC.md
fino), rodando na raiz + branch `feat/edicao-etapa1-participantes`. **Planejada E especificada** a Fase 1
(Etapa 1 editável): código mapeado contra o real (3 varreduras + leituras), plano **aprovado**
(`docs/plans/edicao-etapa1-participantes.md`) e **8 requisitos EARS** cristalizados no `SPEC.md §4`
(RF-100…107). Falta **implementar** (sessão de código).

## Plano ativo
**→ [docs/plans/edicao-etapa1-participantes.md](plans/edicao-etapa1-participantes.md)** · Status: ✅ aprovado (Luis, 2026-07-17)

## Próximo passo (setado)
**Implementar** o plano aprovado via `/ggsd:code` (sessão de código, contexto fresco), seguindo RF-100…107:
T1 destravar UI/rota da Etapa 1 na edição (4 pontos), T2 validação relaxada p/ legado, T3 blindar persistência
participante-only + testes, T4 (opcional) não resetar doc do especial em edição participante-only, T5 round-trip
validado em **staging** antes de prod (regra 13). ⚠️ Pré-requisito operacional (Luis): colunas
**"Participantes 2"** e **"Contribuidor"** precisam existir no cabeçalho das abas GoDocs (prod) e STAGING.

## Como retomar
1. Ler este handoff + `ROADMAP.md` + `docs/decisions/README.md`.
2. Ler `SPEC.md` (§2 papéis, §5 invariantes) e, no `CLAUDE.md`, as seções "Sync Google" e "Ownership".
3. Abrir o plano `docs/plans/edicao-etapa1-participantes.md` e rodar `/ggsd:code`.

**Pendências (não bloqueiam):** —
**Perguntas em aberto:** ver `docs/open-questions.md`.
