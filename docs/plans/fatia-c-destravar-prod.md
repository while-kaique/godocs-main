# Plano — Fatia C: destravar prod (bug G + veredito F + rótulo B)
**Status:** 🟡 executado parcial (código G+B, 2026-08-31) — commit `4905faa` na branch `feat/fatia-c-reorder-wizard` (worktree `~/godocs-wt-fatia-c`). **G + B codados e testados** (suíte 2353 verde, build OK, frontend-only). **Falta (não é código):** F (veredito `reasoning_effort=low`, medição na staging — T-F1) · T-D1 (deploy staging + Luis valida G/B no navegador + smoke do loader de receita com streaming OFF) · T-D2 (prod + merge + docs + 3 revisores sobre o diff da branch + apagar `SUBMISSAO_BLOQUEIO_EXCECAO_EMAILS` pós-01/09). Revisão §9.A conformidade = `diverge-baixa` (não-bloqueante).

**Objetivo:** corrigir o bug visual que bloqueia a ida da reordenação do wizard (fatia C) para produção — o cabeçalho "Documentação Técnica" aparecendo sobre o memorial de saving —, decidir o veredito do `reasoning_effort=low` (manter ou apagar o secret) e rotular o loading do chat ("gerando o memorial…"), para então subir a reordenação à prod com segurança.

> Origem: teste do Luis na staging (31/08), captura em [fatia-c-polish-agente-latencia.md](fatia-c-polish-agente-latencia.md). Escopo desta sessão escolhido pelo Luis: **G + F + B** (destravar prod). Os itens **D/E/C/A** (frente sensível — mexem nos gates que protegem os números) ficam **FORA** e serão planejados à parte.
> Base: branch `feat/fatia-c-reorder-wizard`, worktree **`~/godocs-wt-fatia-c`** (HEAD `a3d6acb`, suíte 2346 verde). Toda a reordenação é **flag-gated** (`REORDER_DOC_FINAL`, default OFF = byte-idêntico).

### Tarefas

**G — bug do cabeçalho doc × memorial (bloqueia prod; corrigir primeiro)**
- **T-G1 —** No worktree, confirmar QUAL condição faz `transitionToDocRefino` (`submeter.tsx:2471-2474`) avaliar `false` quando a aprovação do financeiro retorna `newFase === "doc"` (candidatos do explorador: `chatFase` não estar exatamente em `saving_preview`/`receita_preview` no turno do "Aprovado", ou algum caso do ramo `else` `2583-2597`). (guarda: reproduzir o descompasso — teste que captura o estado do turno de aprovação no reorder, OU instrumentação temporária que loga `chatFase` + `result.fase` no clique "Aprovado").
- **T-G2 —** Garantir que a **limpeza das mensagens + a virada de fase sejam atômicas sempre que a fase transita para `"doc"` no fluxo reordenado**, não só sob a guarda estreita (reusar o padrão já correto de `submeter.tsx:2538-2539`; o `else` `2596` é o produtor do bug). Atrás de `reorderAtivo`/`REORDER_DOC_FINAL` (flag OFF byte-idêntico). (guarda: teste que prova que o cabeçalho `"Documentação Técnica"` NUNCA coexiste com o memorial de saving em `chatMessages` — i.e., ao virar `chatFase` para `"doc"` a lista de mensagens está limpa).

**B — rótulo "gerando o memorial…" no loader (barato, seguro)**
- **T-B1 —** Rotular o loader do chat no **caminho determinístico do formulário** (o único em que o front sabe que vem o memorial): estender `handleReceitaFormSubmit` → `iniciar-receita` (`submeter.tsx:2833-2900`) para setar um `chatLoadingSteps` de memorial, como `iniciar-saving` já faz no reorder (`submeter.tsx:2676`, `LOADING_STEPS_SAVING`); conferir/uniformizar o rótulo do saving. **Reusar** `CyclingText` + `chatLoadingSteps`/`LOADING_STEPS_*` (`submeter.tsx:204-217`) — sem componente novo. ⚠️ **Invocar a skill `frontend-design` antes de codar** (regra 11). PT-BR acentuado (regra 4); reduced-motion herdado do `go-bounce` (`styles.css:209-218`); estado nunca só por cor (texto + pontos). (guarda: teste/smoke do loader rotulado no submit do form de saving e de receita; conferir no navegador da staging). ⚠️ **Fora de escopo:** rotular o loader do chat **conversacional** — ali o tipo do turno só chega no envelope final (`api-client.ts:140-147`), o front não antecipa; é o item C, planejado à parte.

**F — veredito do `reasoning_effort=low` (medição/decisão, sem código)**
- **T-F1 —** Na staging, comparar **1 saving com `LLM_REASONING_EFFORT=low` e 1 sem**: qualidade do memorial + nº de perguntas (redundância/tagarelice). Decidir **manter** (se só melhora TTFB sem degradar) ou **apagar** o secret (e buscar a latência pelo lado do proxy — item A, fora de escopo). (guarda: comparação registrada + decisão anotada no handoff; os números do memorial são determinísticos e NÃO dependem do effort — a comparação é sobre prosa/quantidade de perguntas).

**Deploy (regra 13 → 14)**
- **T-D1 —** `npm run test && npm run build && npm run build:worker`; deploy **staging** (`edf400b4`); Luis valida no navegador: G corrigido (cabeçalho bate com o conteúdo no fim do fluxo reordenado) + B (loader rotulado). Confirmar F na mesma passada.
- **T-D2 —** Prod (`674a3710`) + **merge no `main`** (regra 14, conta `LuisEduardo100`) + atualizar `CLAUDE.md`/specs. ⚠️ **Remover o secret `SUBMISSAO_BLOQUEIO_EXCECAO_EMAILS`** da staging se a janela de bloqueio já acabou (01/09). ⚠️ Rodar os **3 revisores** sobre o diff acumulado da branch antes do `/ggsd:ship` (a fatia C e os fixes de travamento não foram re-revisados formalmente).

### Critérios de aceitação
1. No fluxo reordenado (`REORDER_DOC_FINAL=1`), ao aprovar o memorial financeiro e transitar para o refino da doc, o cabeçalho `"Documentação Técnica"` **nunca** aparece sobre o memorial de saving — ou a lista de mensagens está limpa quando a fase vira `"doc"`, ou o cabeçalho só muda quando o conteúdo já é o da doc. Provado por teste.
2. Com a flag OFF, o comportamento é **byte-idêntico** ao de hoje (nenhum efeito colateral da correção fora do reorder).
3. O loader do chat, no submit do formulário de saving **e** de receita, mostra um rótulo de memorial ("gerando o memorial…" ou equivalente) em vez dos 3 pontinhos genéricos; a11y preservada (reduced-motion, texto + pontos).
4. O veredito do `reasoning_effort=low` está registrado (manter/apagar), com a comparação que o embasa.
5. Suíte verde (baseline 2346); `worker.js` rebuildado; staging validada pelo Luis antes de prod.

### Fronteiras (não exceder)
- **FORA:** os itens **D** (memorial streama e um gate o substitui por pergunta), **E** (perguntas redundantes / threadar `prodStatus` da Etapa 1 / consolidar gates), **C** (streamar as perguntas do chat conversacional), **A** (latência via proxy/heartbeat). São a frente **sensível** (mexem nos gates que protegem os números do memorial) e serão planejadas em sessão própria.
- **NÃO** mexer nos gates determinísticos de saving (jornada, teto 220h, ≥44h, alocação, ganho projetado, sobreposição, ponteiro) nem no anti-loop.
- **NÃO** mexer no contrato do envelope SSE nem na lógica de quando streamar (`orchestrator.ts:~1644`).
- B fica **restrito ao caminho do formulário determinístico** — não tentar antecipar o tipo no chat conversacional.

### Blast-radius
**G (do explorador, confiança 0.62 — a condição exata que escapa da guarda NÃO foi confirmada em runtime; T-G1 a fixa).**
- Arquivos: `src/routes/submeter.tsx` (`2471-2474` guarda `transitionToDocRefino`; `2528-2580` ramo correto que limpa+vira fase; `2583-2597` ramo `else` que vira fase sem limpar = produtor do bug; `3337` `fase={chatFase}`) · `src/lib/submeter/step3-chat.tsx` (`2262-2264`, `2311-2324`, `2345` — cabeçalho `agentLabel`/`agentStatus` derivados só do prop `fase`).
- Dependentes: `src/lib/chat.functions.ts:2844-2881` (`iniciar-refino-doc`, 1º turno da doc) · `src/lib/agents/orchestrator.ts:1444-1477` (`proximaFase` decide `saving_preview`/`receita_preview`→`doc` no reorder — a guarda do front tem de cobrir exatamente os casos que retornam `"doc"`). ⚠️ Não confundir com `FinalReview` (`step3-chat.tsx:690-800`), que reusa o título "Documentação Técnica" num card, não no cabeçalho.
- Invariantes: virar `chatFase` e trocar o conteúdo do chat devem ser **atômicos** (o cabeçalho nunca descreve fase diferente do que está em `chatMessages`) · flag OFF byte-idêntico (`orchestrator.ts:1497-1500`).

**B (do explorador, confiança 0.79 — BAIXO).**
- Arquivos: `src/lib/submeter/step3-chat.tsx` (`2624-2668` loader principal; `2593-2622` loader `finalizando`; `70` `CyclingText`) · `src/routes/submeter.tsx` (`204-217` `LOADING_STEPS_*`; `2426` precedente `doc_preview→LOADING_STEPS_COMPILAR`; `2668-2811` submit saving; `2833-2900` submit receita) · `src/lib/api-client.ts:120-168` (SSE — prova que o tipo só chega no envelope).
- Dependentes: `submeter.tsx` é o único chamador de `Step3Chat` (`3330-3332`); `CyclingText` reusado em 3468/3490/3510/3526.
- Reuso: **reusar** `CyclingText`/`chatLoadingSteps` (padrão já existente `LOADING_STEPS_COMPILAR`/`LOADING_STEPS_SAVING`), **sem** componente novo.
- Invariantes: a11y (reduced-motion global; estado nunca só por cor) · PT-BR acentuado · rótulo amarrado ao submit do form vale nas duas pontas da flag `LLM_STREAMING` (amarrado a `onDelta`/`finalizando` só valeria com streaming ON).

**Confiança global: média** — B é sólido (BAIXO); G tem a mecânica visual inequívoca (o `else` vira a fase sem limpar), mas a **condição exata** que faz a guarda escapar não foi confirmada em runtime — a sessão de código a fixa na T-G1 (blast-radius de G: **MÉDIO**). `docs/INDEX.md`/`invariants.md` ausentes no worktree → confiança limitada por regra.
