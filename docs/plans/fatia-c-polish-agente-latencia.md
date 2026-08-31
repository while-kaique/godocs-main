# Plano — Fatia C: polish do fluxo + qualidade/latência do agente (pós-teste do Luis na staging)
**Status:** rascunho — captura do feedback do Luis (31/08, testando a fatia C na staging). **Aguarda /ggsd:plan** para virar plano executável. NADA codado desta lista.

## Contexto — o que JÁ está pronto e na STAGING (não refazer)
A **fatia C (reordenar o wizard)** está CODADA, testada (suíte 2346 verde) e **deployada na staging `edf400b4`**, atrás da flag `REORDER_DOC_FINAL`. Funciona: a doc sai do caminho crítico (compila em bg desde o anexo), o usuário responde saving/receita primeiro, o refino da doc vem no fim. Commits na branch **`feat/fatia-c-reorder-wizard`** (base `origin/main` `0487664`):
- `719c3eb` — reorder core (`proximaFase`, `iniciarSubmissao` reorder, `iniciar-refino-doc`, frontend).
- `886c9a2` — **isenção de bloqueio por e-mail** (`SUBMISSAO_BLOQUEIO_EXCECAO_EMAILS`, allowlist env) — feito para o Luis testar durante a janela de bloqueio.
- `a5f048a` + `a3d6acb` — **fixes de travamento** (extrator+doc 100% em background via `extrairCompilarPersistir`; form de saving fecha no envio mostrando progresso streamando).

Docs vivos commitados em `docs/…` (`ac7a0d5`). **Ainda NÃO em prod, NÃO mergeado no main.**

### Secrets ATIVOS na staging `edf400b4` (setados nesta sessão)
- `REORDER_DOC_FINAL=1`, `DOC_COMPILE_ASYNC=1` — ligam a reordenação + bg-compile.
- `LLM_STREAMING` — já estava on.
- `SUBMISSAO_BLOQUEIO_EXCECAO_EMAILS=luis.albuquerque@gocase.com` — libera a submissão do Luis na janela de bloqueio. ⚠️ **Remover quando a janela acabar (01/09) ou quando não precisar mais testar.**
- `LLM_REASONING_EFFORT=low` — **EXPERIMENTO** de latência (ver Issue A/F). ⚠️ Precisa de veredito: manter ou apagar.

### O que o Luis GOSTOU (preservar)
- Clique de avançar ficou **instantâneo** (extrator em bg). ✅
- O memorial **gerando gradualmente** (streaming token a token) — "achei massa". ✅ **É streaming REAL** (SSE, não efeito cosmético).

## Issues levantados pelo Luis no teste da staging (31/08) — a META é fluxo contínuo, ≤2-3s por etapa
> Contexto do peso: "temos pessoas importantes submetendo, como o CEO — 10 min dele é caro." Se apegar à META FINAL (fluxo sem travamento), não a metinha.

### A — Resposta do agente ainda lenta (os "3 pontinhos" / TTFB)
Os "..." são o modelo **forte (`sol`) "pensando" MUDO no proxy** antes do 1º token (~15-20s). `LLM_REASONING_EFFORT=low` derruba p/ ~3s (setado na staging). **Levers:** (1) nosso — `reasoning_effort=low` (risco: ver F); (2) proxy/Gabriel — **heartbeat SSE + streamar os tokens de raciocínio** (é a raiz: proxy mudo no reasoning). Memórias: `proxy-ai-arquitetura-gargalo`, `deploy-roteamento-fase-prod`.

### B — Loading precisa de RÓTULO ("gerando o memorial…")
Os "3 pontinhos" genéricos não dizem se vem uma pergunta curta ou o memorial longo. Luis quer saber que é **o agente gerando a documentação/memorial**, pra não achar que vai receber "só mais uma pergunta". **Fix fácil e seguro:** loading rotulado no chat quando o próximo turno é geração de memorial (preview/complete). Cuidado: nem sempre sabemos o `type` antes da chamada.

### C — Streamar TODAS as mensagens (como ChatGPT/Claude), não só o memorial
Hoje o `llmChatStream` streama a prosa (`content`) **só** em `type∈{preview,complete}`; **question/options ficam bufferizados** (§6 do plano de streaming — curtas + sujeitas a reescrita por gate). Luis quer o efeito gradual em **tudo que tiver ganho de tempo real**. **Investigar:** estender o streaming aos turnos de PERGUNTA gerados pelo LLM. ⚠️ Perguntas de GATE são determinísticas (sem LLM) → aparecem instantâneas, nada a streamar. ⚠️ Risco: se um gate reescreve a pergunta do LLM, há um SWAP visível (o front já reconcilia via envelope). Ponto de código: `orchestrator.ts:~1644` (`streamAtivo = tm[1]==="preview" || (tm[1]==="complete" && fase!=="doc_preview")`) — é aqui que se decide streamar; e `llm.ts` `callOpenAIStream`.

### D — BUG (jarring): o memorial STREAMA e depois um gate o SUBSTITUI por uma pergunta
"Vi o memorial sendo gerado e ele ainda me fez outra pergunta." Raiz: os **gates rodam POST-orquestrador** sobre o preview/complete e podem **substituir** o resultado por uma pergunta (o `reask`). O LLM gera o memorial → streama → um gate (ganho projetado/ponteiro/sobreposição…) detecta e troca por pergunta. **É PRÉ-EXISTENTE (já é assim em prod), não é a reordenação.** ⚠️ **SENSÍVEL:** os gates existem pra impedir número errado (o de ganho projetado barra "ganho previsto" virar "medido"). **Direção a estudar:** não streamar um preview que um gate pode derrubar (buffer até os gates passarem), OU rodar a detecção dos gates ANTES de mostrar o memorial. Trade-off: perde o streaming do preview.

### E — Perguntas REDUNDANTES/repetitivas e em sequência lenta
Screenshots: ponteiro/fonte → ganho projetado → "há quanto tempo em produção" — **um gate por turno, cada um um round-trip lento**. Dois problemas:
- **O gate de ganho projetado RE-PERGUNTA se "já acontece ou é expectativa"** — sendo que na **Etapa 1** o usuário JÁ declarou que está em produção. **Buraco conhecido:** `prodStatus` da Etapa 1 é **só frontend, nunca chega ao backend nem a prompt** (ver CLAUDE.md). **Fix:** threadar o `prodStatus` da Etapa 1 → o gate de ganho projetado não re-pergunta o que já foi respondido. ⚠️ CLAUDE.md diz que `prodStatus` é frontend-only "por decisão" — confirmar com o Luis antes de threadar.
- **Gates não se juntam** — cada um é um turno. Estudar consolidar os que dá (ponteiro + tempo). ⚠️ Anti-loop e a ordem dos gates são delicados (o repo já queimou com loop de 38 perguntas).

### F — `reasoning_effort=low` pode estar PIORANDO o agente (isolar)
Os gates são determinísticos (independem do effort), MAS a **prosa e o "juntar/pular perguntas"** dependem do raciocínio. O `low` pode estar deixando o agente mais tagarela/redundante. **Medir:** submeter 1 saving com `low` e 1 sem, comparar qualidade do memorial + nº de perguntas. Se `low` degrada → apagar o secret e buscar a latência pelo lado do proxy (A).

### G — BUG da REORDENAÇÃO: o agente de "Documentação Técnica" entra junto do memorial
Screenshot 8: o **cabeçalho diz "Documentação Técnica / Analisando e coletando informações…"** enquanto o conteúdo mostra o **memorial de SAVING** ("Ferramenta externa: N/A… Economia total: 257h… Tipo: pontual") + "Aprovado" + "Memorial pronto!". Os dois agentes (doc refino × saving/memorial) **se misturaram visualmente** no fim do fluxo reordenado. ⚠️ **ISTO É BUG DA FATIA C** (o header/`chatFase` ou a transição para o refino da doc se confundiu). **BLOQUEIA o T8 (prod)** — tem de ser corrigido antes de subir a reordenação pra produção. Investigar: `submeter.tsx` — o rótulo do cabeçalho por fase (`Análise de Saving` × `Documentação Técnica`) vs o `chatFase` real durante `transitionToDocRefino`/o refino; e como a fase é setada quando `iniciar-refino-doc` retorna.

## Recorte sugerido para a PRÓXIMA sessão (prioridade)
1. **G (bug do header doc×memorial)** — é da fatia C e **bloqueia prod**. Corrigir primeiro.
2. **F (veredito do `reasoning_effort=low`)** — medir; manter ou apagar o secret. Barato.
3. **B (rótulo "gerando o memorial…")** — barato, seguro.
4. Frente própria (planejar com /ggsd:plan, SENSÍVEL): **D** (memorial→pergunta), **E** (redundância/prodStatus + consolidar gates), **C** (streamar perguntas), **A** (latência via proxy se o `low` não bastar). ⚠️ D e E mexem nos GATES que protegem os números — não reescrever no susto; cada mudança com teste + validação de qualidade na staging.

## Fronteiras / invariantes que NÃO podem regredir
- Os **gates determinísticos** protegem os números do memorial (ganho projetado, teto 220h, ≥44h, sobreposição, ponteiro). Qualquer mexida neles precisa preservar a proteção (ver CLAUDE.md, seção Memorial). Anti-loop é lei (o repo já queimou 2×).
- Os números do memorial são **determinísticos** (`recomputarSavingFinanceiro`) — o `reasoning_effort` NÃO os afeta; afeta a prosa/julgamento.
- A reordenação toda é **flag-gated** (`REORDER_DOC_FINAL`, default OFF = byte-idêntico). Prod só liga quando G estiver resolvido e o Luis validar.
- Regra 13 (staging antes de prod) e 14 (merge no main na hora do prod) valem para o T8.

## Estado dos gates GGSD desta sessão
review=diverge-baixa (não-bloqueio) · quality=limpo · suite=verde (2346). A fatia C passou a revisão; os fixes de travamento e a isenção de bloqueio foram além (não re-revisados formalmente — a próxima sessão que for pra prod deve rodar os revisores sobre o diff acumulado da branch).
