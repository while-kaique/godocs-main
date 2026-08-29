# NEXT-SESSION

## Plano ativo
`docs/plans/mesa-avaliacao-parecer-raciocinado.md` — mesa de avaliação de eco-de-gate a auditor raciocinado (escopo B, time LLM em SOMBRA). **Em execução via /ggsd:code.** T1+T2 concluídos; **T3 em andamento (RED em voo).**

## O que esta sessão fez (28/08)
- Abriu a sessão de código do **T3 — deliberação multi-rodada + histórico APPEND**. Baseline **verde (2267)** confirmada no worktree `~/godocs-wt-mesa-parecer` (branch `feat/mesa-parecer-raciocinado`).
- **§5 blast-radius (contido):** `MAX_RODADAS_DELIBERACAO` (default) só é lido pelos 2 call-sites de `avancarDeliberacao` (opener rodada 1 em `avaliacao-normais.functions.ts:431` e cron advancer `:739`); `upsertDeliberacao` (`client.server.ts:3116`) só tem esses 2 callers. Descoberta-chave: o "sem `SELECT historico` em lote (32 MiB RPC)" vale só para leituras em LOTE — `getDeliberacao(projetoId)` single já traz historico, mas o APPEND será feito **no SQL** (JSON1) para não reler nada.
- **Distinção reset×append (o plano implica, não soletra):** o **opener (rodada 1) mantém RESET** (overwrite atual); só o **cron advancer** faz APPEND. Solução: flag opcional `apendarHistorico?` em `upsertDeliberacao` (default = comportamento de hoje, byte-idêntico).
- **RED delegado ao test-writer (§7.1, contexto fresco)** — 2 arquivos NOVOS: `tests/deliberacao-multi-rodada.test.ts` (MAX=5; sem consenso segue `deliberando` até r4, `nao_consenso` só na r5) + `tests/deliberacao-historico-append.test.ts` (DB em memória: rodada 1 sem append + rodadas 2/3 com `apendarHistorico:true` → 3 entradas com `confianca`, rodada 1 preservada). **Handoff feito ANTES do veredito chegar** (janela de contexto a 92%).

## Próximo passo
**Retomar o T3 (via /ggsd:code):** (1) confirmar o veredito RED do test-writer (arquivos podem já estar untracked no worktree); (2) implementar até verde as **4 mudanças**:
- `src/lib/deliberacao.ts`: `MAX_RODADAS_DELIBERACAO` 2→**5**.
- `src/integrations/db/client.server.ts` `upsertDeliberacao`: flag opcional `apendarHistorico?: boolean`. `true` → ON CONFLICT usa `historico = json_insert(COALESCE(historico, json_array()), '$[#]', json(json_extract(excluded.historico,'$[0]')))` (append 1 entrada/rodada, sem SELECT). `false`/ausente → `historico = excluded.historico` (reset atual).
- `src/lib/avaliacao-normais.functions.ts`: opener (`:449`) mantém reset + enriquece a entrada com `confianca`; cron advancer (`:753`) passa `apendarHistorico:true` + `confianca` na entrada.
- `tests/deliberacao.test.ts`: atualizar os 3 asserts do comportamento ANTIGO (linha 15 `toBe(2)`→`toBe(5)`; os 2 testes "r2 nao_consenso" das linhas ~158/178 para caminhar até r5). **Não é enfraquecer — a regra mudou.**
- Depois: §8.1 medir faixa + §9 revisores; `npm run build:worker`; então T4→T7.

## Pendências / avisos
- Revisão §9 do **T2 já passou** (conforme 0.9 / sugestoes 0.86) — os marcadores `.review-status=conforme`/`.quality-status=sugestoes` são de T2, não barram. Esta sessão **não gravou código de produção** (só doc de handoff) → nada novo a revisar.
- **Alerta T4:** materialidade da mesa = `saving + receita/10` (NÃO tocar `analyzer.ts:847`, gate real). Reconferir a fonte do ÷10 (`ganhoTotalMensal`, `chat.functions.ts:3919`).
- **Alerta T5:** `voto.motivo` no prompt não pode carregar tarifa valor/hora oculta; sem R$ cru no payload.
- Ordem restante: **T3 (em curso)** → T4 → T5 (fiar agentes LLM) → T6 (UI rodadas: parar `montarAvaliacaoSombra` de descartar historico) → T7 (retroativo = rede) → build:worker/staging/prod/PR (`LuisEduardo100`).
