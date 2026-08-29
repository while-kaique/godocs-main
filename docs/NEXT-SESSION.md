# NEXT-SESSION

## Plano ativo
`docs/plans/mesa-avaliacao-parecer-raciocinado.md` — mesa de avaliação de eco-de-gate a auditor raciocinado (escopo B, time LLM em SOMBRA). **Em execução via /ggsd:code.** T1–T7 concluídos e commitados; falta a revisão §9 fechar + o deploy do Luis.

## O que esta sessão fez (29/08) — T5, T6 e T7 fechados no código
- **T5 (fiação da mesa LLM)** em `src/lib/avaliacao-normais.functions.ts`, gated por `especialistasMesaLlmLigados()` (`AVALIACAO_MESA_LLM`, DEFAULT OFF):
  - `computarVotos`: quando LIGADO, monta `TextoProjeto` (via `montarEntradaSemanticaNormal`, `?? ''`) + `vizinhosTexto` (`nome — area`), roda `montarEntradasEspecialistas` (ponte T5) → `Promise.all(julgarComEspecialista)` (nunca lança) → `conciliarJulgamentos` como `conciliado` EFETIVO; `ceticoRefuta` = cético LLM `.preocupa`. OFF → determinístico byte-idêntico.
  - `VotosPainel` += `julgamentos?`/`ceticoRefuta`. `serializarVotos` EXPORTADO + grava julgamentos ENXUTOS (`dimensao/preocupa/confianca/origem`, sem `argumento`/R$; chave só quando há julgamentos → OFF byte-idêntico).
  - `avaliarComContexto` e `avancarDeliberacoesPendentes`: `ceticoRefuta` efetivo no sinal da deliberação + histórico grava o PARECER argumentado quando LIGADO; redator determinístico é PULADO no modo LLM (`&& !modoLlm`).
- **T6 (rodadas na ficha)**: `montarAvaliacaoSombra` deixou de descartar `historico` + novo `parseHistoricoDeliberacao` (fail-soft) em `dashboard-admin.functions.ts`; tipo `avaliacaoSombra.deliberacao.historico[]`; render das rodadas em `projeto-detalhe-dialog.tsx` (só quando ≥2 rodadas). Lote passa `undefined→[]` (mantém o invariante de NÃO `SELECT historico` em lote — 32 MiB RPC).
- **T7 (retroativo = rede)**: confirmado POR CONSTRUÇÃO — `avaliacao-retroativa.functions.ts` já roda `computarVotosDoProjeto` → mede a MESA NOVA (LLM) contra o veredito humano. Só o comentário-cabeçalho foi tornado explícito.
- Testes novos: `tests/mesa-fiada-serializacao.test.ts` (4) + `tests/mesa-historico-rodadas.test.ts` (5). **Suíte cheia 2293 verde**; `tsc` só os 7 erros pré-existentes (chat.functions/submeter/especiais-painel). `worker.js` rebuildado (regra 1).

## Próximo passo
**§9 FECHADA E LIMPA** (conformidade=`conforme` 0.92 · qualidade=`limpo` 0.86; 1 observação BAIXA não-bloqueante: render das rodadas só com ≥2 — decisão de UX consciente, deixada como está). Próximo é o **deploy**: **staging (`edf400b4`) → validar num projeto de receita real + um absurdo (500h) com `AVALIACAO_MESA_LLM` ligado SÓ na staging → prod (`674a3710`) → PR (`LuisEduardo100`)** + atualizar CLAUDE.md/spec. `/ggsd:ship` está liberado pela §9.

## Pendências / avisos
- **§9 do T5–T7 — QUALIDADE=`limpo` (0.86, zero achados), CONFORMIDADE ainda em background** ao fechar a sessão. Colher o veredito de conformidade antes do ship (o `/ggsd:ship` barra até `.review-status` fechar).
- **Byte-idêntico obrigatório com `AVALIACAO_MESA_LLM` OFF** — prod roda `AVALIACAO_NORMAIS` ON em sombra determinística; a fiação não pode alterar isso (testado em `mesa-fiada-serializacao`).
- **Custo aceito**: com a mesa LLM ligada são N chamadas LLM/rodada × até 5 rodadas em background (sombra, cron-bounded) — Decisão 2 do plano.
- **T6 no lote**: a ficha aberta pelo LOTE do /dashboard NÃO mostra as rodadas (historico não vem no lote); só a ficha individual (`getProjetoDashboard`) as traz. Decisão consciente (32 MiB RPC).
- Ordem restante: **§9 → staging/prod/PR → CLAUDE.md/spec**.
