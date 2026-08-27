# Plano — Frente 2: time autônomo de avaliação (juiz melhor que o humano)

**Status:** ✅ aprovado — fatia B (RAG por corpus de aprovados + especialista Financeiro + Agregador/Juiz com confiança) (Luis, 27/08/2026)
> Origem: o GoDocs deveria julgar sozinho (aprovado/reprovado/em avaliação) e mandar à fila humana do RPA só a **minoria** dos casos-limite. Caso concreto de falha: **saving de 500h/mês (=12 FTE) foi APROVADO** — implausível, deveria ter sido enfileirado. Objetivo do dono (Luis, 27/08/2026).
> **Independente da Frente 1** (latência). Metodologia GGSD.

## 0. Diagnóstico — por que 500h passou (arquivo:linha)

- O avaliador de verdade é **um agente solitário**, `analyzer.ts` — uma chamada LLM que decide qualidade + complexidade + elegibilidade de uma vez (`analyzer.ts:651-774`, `675-681`). Ele é instruído a **"tender a aprovar"** ("simplicidade não reprova", `analyzer.ts:276`; `docs/agents.md:153`).
- Os gates de plausibilidade (**teto 220h/pessoa**, **≥44h**, **por pessoa**) vivem na **fase de coleta (chat)** e são **prompt-driven no LLM**, não gates numéricos duros (`orchestrator.ts:1098-1116`, `:683`, `:1295`). O escape multi-pessoa (`orchestrator.ts:1102`) deixa o LLM aceitar total alto se atribuído a "muitas pessoas/unidades".
- Na **decisão final** (`analisarProjetoFn`, `chat.functions.ts:3142-3170`) só há **2 gates determinísticos**: `claro_nao` → reprova, e materialidade > R$5k → fila humana. **Não existe checagem de FTE/absurdo.**
- `normalizarClassificacao` (pura, `analyzer.ts:553-603`) só **rebaixa** (`claro_nao`→`zona_cinzenta`); **nunca** promove reprovação/enfileiramento. Um número implausível que "fechou" no chat entra e é aprovado pela narrativa.

## 1. Ativos que dá pra reusar

- **RAG por embeddings já maduro** (peça 4 do Kaique): `embeddings.ts` (`text-embedding-3-small`, **direto na OpenAI** — proxy não expõe `/embeddings`, `embeddings.ts:1-19`; base64 Float32; cosseno puro), `especial-corpus.ts` (`selecionarVizinhos`/`textoParaEmbedding`/`montarBlocoFewShot`, **todos PUROS**), `especial-classificador.functions.ts` (memória vetorial → recuperação → agente → gravação, re-embeda só o que mudou por hash). ⚠️ Rótulo preferido = **veredito HUMANO** (anti-feedback-loop, `especial-corpus.ts:10-13`).
- **Esqueleto de orquestração assíncrona já em produção**: `processarPosSubmissao` (`worker.ts:198-203`) roda análise ∥ classificação-especial via `Promise.allSettled`, disparado em `ctx.waitUntil` (`worker.ts:566-570`); cron de rede `reanalisar-pendentes` (`worker.ts:287`). É o "orquestrador que não trava" que você quer — a Response volta antes do background terminar.
- **Corpus de aprovados**: `projetos` (canônico), `analises` (histórico de veredito), `sheet_espelho` (verdade da triagem humana). Aprovado pela triagem = exemplar positivo; reprovado = negativo.

## 2. Limites reais do ambiente (Cloudflare Worker / Godeploy)

- Sem processamento síncrono longo; padrão = `ctx.waitUntil`/`runBackground` (`background.ts`), envs **lazy** (sem `process` em escopo de módulo).
- Proxy LLM ~60s por chamada → **um agente é single-shot**; um *loop* de vários agentes discutindo **não cabe num request**.
- Sem filas/durable objects — o padrão é **cron idempotente que converge** (bounded por `limite`/`cap`, como `classificar-especiais`).

## 3. Objetivo + critérios de aceite (EARS)

- **QUANDO** a avaliação final detecta saving implausível (ex.: `horas_totais/220 = FTE` excede as pessoas realmente declaradas por um fator), **O SISTEMA DEVE** enfileirar para revisão humana (`em_validacao` → fila RPA), **nunca** aprovar automático.
- **SE** o projeto é **especial** ou de **fluxo de liderança**, **ENTÃO** o gate de absurdo **NÃO** reprova/enfileira automático (herda a isenção existente, `analyzer.ts:584-590`).
- **QUANDO** julga um projeto normal, **O SISTEMA DEVE** poder usar os **vizinhos aprovados** (corpus) como sinal, aprendendo do **veredito HUMANO** (não das próprias saídas).
- **O SISTEMA DEVE** continuar mandando à fila humana só a **minoria** (casos-limite), aprovando/reprovando o resto sozinho.
- **Invariantes preservados:** nunca reprovar sem motivo legível ao autor (`analyzer.ts:580-583`); triagem humana sempre sobrepõe; não colidir com a peça do Kaique (tabelas/corpus separados).

## 4. Abordagens (trade-offs + recomendação: A → B → C)

**A — "Endurecer o juiz solitário" (RECOMENDADA AGORA).**
(1) Função **pura** nova de plausibilidade/FTE em `analyzer.ts` (irmã de `normalizarClassificacao`/`decidirStatusSubmissao`, perto de `:519-647`): calcula `fte = totalHoras/220` e confronta com pessoas declaradas (`membros`/`saving.linhas`); implausível → força `zona_cinzenta`/`em_validacao` + motivo. Consumida em `analisarProjeto` (`:735-763`) e como gate em `analisarProjetoFn` (`chat.functions.ts:3150-3170`), ao lado do de materialidade. (2) Opcional: few-shot de vizinhos aprovados (RAG de normais) no prompt do analisador.
- **Prós:** fecha o buraco das 500h **já**, blast-radius mínimo, reusa 100% das funções puras testadas, cabe nos 60s. **Contras:** é um juiz melhor, não um "time"; sem debate.

**B — "Time paralelo, um turno cada".**
Vários agentes single-shot **em paralelo** (`Promise.allSettled`, como `worker.ts:199`): plausibilidade/FTE, elegibilidade (o analyzer atual), RAG-por-corpus, materialidade. **Agregador puro** (irmão de `decidirStatusSubmissao`) combina votos → aprovado/reprovado/`em_validacao`. Tabela `projeto_embedding`/`projeto_avaliacao` **separadas** das `especial_*`; cron irmão `reavaliar-normais`.
- **Prós:** "time autônomo de verdade" que julga sozinho e só manda a minoria pro RPA; espelha o padrão já em produção; consenso vira regra pura auditável. **Contras:** N chamadas LLM/submissão (custo/latência de background); tabelas novas.

**C — "Deliberação multi-turno persistida" (converge com o Kaique).**
Debate como máquina de estados persistida; cron pega a próxima rodada até consenso ou `nao_consenso` → RPA. Reusa `confianca`/`contestada` (`especial-classificador.ts:173-191`) como protocolo de consenso comum a normais + especiais; provavelmente exige **Pinecone** (cosseno-em-JS não escala). É a "fase posterior" já anotada (`docs/plans/rag-especiais-pinecone-reauditoria.md:44`).
- **Prós:** o orquestrador completo (consenso + taxa de confiança + flag de não-consenso). **Contras:** maior complexidade/blast-radius; convergência em minutos; exige Pinecone.

> **Recomendação:** **A agora** (mata o caso das 500h com risco baixíssimo) → **B** em seguida (o time paralelo + RAG de normais) → **C** unificando com a fase posterior do Kaique.

## 5. Interface com a peça do Kaique (não atropelar)

- Peça 4 **nunca grava "Estrelas"** — só sugere em `especial_avaliacao`; nota final é clique humano (`especial-classificador.ts:1-16`).
- Frente 2 usa **tabelas separadas** (`projeto_embedding`/`projeto_avaliacao`), **corpus próprio** (normais têm memorial financeiro; especiais são qualitativos), reusa só o **código puro** (`embeddings.ts`, `especial-corpus.ts`), **não** o `classificarEspecial` (prompt é da estrela).
- Worker: julgamento de normais = **3ª promise** no `Promise.allSettled` de `processarPosSubmissao` + cron irmão; **NO-OP para especiais** (`especial === 1` já separa os fluxos). O gate de absurdo herda a isenção de especial/liderança.
- O consenso multi-agente (loop do Kaique) é o ponto de extensão de `confianca`/`contestada` — plugar em C, não agora.

## 6. Tasks (fatia A primeiro)

- **T1** — Função pura `avaliarPlausibilidadeFTE` em `analyzer.ts` + testes (invariantes: especial/liderança isentos; nunca reprova, só enfileira; fator configurável). RED primeiro (test-writer).
- **T2** — Consumir em `analisarProjeto` (`:735-763`) e gate em `analisarProjetoFn` (`chat.functions.ts:3150-3170`) → `em_validacao` + motivo legível.
- **T3** — (opcional A2) tabela `projeto_embedding` + cron irmão + few-shot de vizinhos aprovados no prompt do analisador (aprende do veredito humano).
- **T4** — Testes + suíte verde + smoke; casos: 500h enfileira; especial não; projeto normal plausível segue.
- **T5** — `build:worker`, staging (`edf400b4`), validar com um projeto absurdo simulado → prod + merge `main` + CLAUDE.md/spec.
- **T6** — (fase B) quebrar em agentes paralelos + agregador puro. (fase C) deliberação — depois, com o Kaique.

## 7. Rollout / gates

Worktree próprio `~/godocs-wt-agentes-avaliacao` (fora da raiz). Env-gated onde der (fator do FTE, ligar/desligar RAG). **Staging antes de prod**; validar com projeto absurdo antes de confiar. Não colidir com o worktree do Kaique nem com o `~/godocs-wt-rollup-jg` ativo.

## 8. Progresso — fatia B

- ✅ **Fatia A** (detector FTE) — EM CIMA dela a fatia B foi construída (o FTE virou o especialista "Plausibilidade").
- 🟡 **Fatia B — PARTE 1 (27/08, checkpoint verde, NÃO fechada):** schema (`projeto_embedding` + `projeto_avaliacao`, tabelas SEPARADAS das `especial_*`), DB layer, especialista **Financeiro** PURO (`avaliarFinanceiro`) e **Agregador/juiz** PURO (`avaliarSinalRag` + `agregarVotos` — confiança baixa/divergência → `em_validacao`, nunca decide negativo, especial/liderança isentos). Testes red→verde (24 casos), suíte **1944 verde**. Detalhe e PRÓXIMO PASSO no ponteiro `## Plano ativo` do `docs/NEXT-SESSION.md`.
- ✅ **Fatia B — PARTE 2 (27/08, código VERDE):** corpus/config PURO `avaliacao-corpus.ts` (`avaliacaoNormaisAtiva` DEFAULT OFF, `selecionarAprovadosNormais`, `montarCorpusNormais`) + orquestrador `avaliacao-normais.functions.ts` (modo SOMBRA, env-gate LAZY; RAG ao vivo via `embeddings.ts`→`projeto_embedding`→`selecionarVizinhos` + FTE + Financeiro → `agregarVotos` → `upsertAvaliacaoNormal`, NUNCA muda status) + 3ª promise no `processarPosSubmissao` + cron `/api/cron/avaliar-normais` + admin routes + `build:worker`. Suíte **1959 verde**. ⚠️ §9 revisores FALHARAM por rate-limit (429), não por código — re-rodar antes do ship.
- ⬜ **Fatia C** (cético + deliberação multi-turno + retroativo) — DEPOIS, com o Kaique.
