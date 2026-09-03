# NEXT-SESSION

## Plano ativo
`docs/plans/regua-estrelas-e-time-unificado.md` — **§11 "Time AUTÔNOMO de triagem"** (direção do Luis,
03/09/2026): dossiê + agentes com ferramentas + debate com teto + consenso com 3 saídas + retroativo
iterativo por amostragem. Tarefas **T11–T20** (§11.3), ordem T11 → T12 → T13/T14 → T16 → T15 → T17 → T18 →
T19 → T20 → T10. **Pronto para `/ggsd:code`.**

## Estado (03/09/2026)
- Branch `feat/avaliadores-unificados`, worktree `~/godocs-wt-avaliadores`, base `origin/main` `51f3fd2`.
  ⚠️ O shell reseta o cwd para `~/godocs-main` (outra frente, `feat/godocs-v2`): **todo comando começa com
  `cd ~/godocs-wt-avaliadores`**.
- Suíte 2396 verde. Régua FECHADA em `0c4978f` e conferida contra o texto do Luis (D20).
- Feito: T1 (validação cega), T2 (`estrelas-regua.ts`), 5.4 (`categorizacao-projeto.ts`). Aberto: T3–T10 e
  T11–T20.
- Pendência não commitada do painel irmão (`w14:p2`): variante `e` em `scripts/regua-t1/aplicar.ts`
  (diagnóstico). Não vazar para a régua; commitar ou descartar é indiferente.

## Decisões que não se reabrem
- **D20**: nenhum critério da régua muda; o agente raciocina em cima (gate determinístico, leitura
  raciocinada). Tirar `apenas_mensuravel` do piso e tirar ML do gate do 4★ foram **rejeitados**.
- D13 aprovação autônoma, humano é exceção · D14 raciocínio livre, fecho medido · D15 debate ≤ 2 rodadas ·
  D16 escape com dossiê de comitê · D17 sem logs de chat · D18 padrões = plausibilidade com ferramenta ·
  D19 aprendizado sobre régua/prompt por mão humana.

## Perguntas ainda abertas para o Luis (§11.5)
- (c) metas de liberação da tabela 11.4 · (d) onde o texto ao autor aterrissa na v2 · (e) auditoria humana
  de ~50 projetos não avaliados para o gabarito.

## Próximo passo
`/ggsd:code` começando por **T11 (dossiê)**, que todos os outros consomem. Retroativo sempre em `dry`, sombra
em tudo, prod e staging v1 intocados.
