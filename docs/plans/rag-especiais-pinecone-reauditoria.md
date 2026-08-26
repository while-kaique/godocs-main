# Plano — RAG de especiais no Pinecone + re-auditoria de estrelas

**Status:** **CÓDIGO FEITO (T2–T6)** na branch `feat/pinecone-especiais`, 26/08/2026 — 1833 testes verdes (+46), `worker.js` rebuildado. **Falta rodar T1 no ambiente** (criar o índice pela rota de setup, com a `PINECONE_API_KEY` que já está nos secrets de prod e staging), o backfill e a validação em staging → prod (regra 13). As 7 decisões foram fechadas em 26/08/2026 (confiança **ALTA**). **Pinecone é a plataforma oficial de busca vetorial deste pipeline**; a decisão está tomada e não deve ser relitigada a cada sessão.

**Objetivo:** Migrar a recuperação vetorial do agente classificador de especiais (peça 4) do cosseno-em-JS/SQLite para o **Pinecone (REST)**, vetorizando **nome + o que faz + por que é especial + descrição + documentação**, e usar o índice para (a) recomendar estrela de especiais **novos** e (b) **re-auditar** os já submetidos (com nota humana) detectando inflação/deflação.

## Por que Pinecone (a justificativa, para não reabrir a discussão)

O cosseno-em-JS **funciona hoje** e não é o que causou o erro de classificação de prod (o GoPrice foi o TEXTO do embedding — ver `a1fe406`). Mas ele tem três defeitos estruturais que o Pinecone **resolve**, em vez de adiar:

1. **Teto de RPC do Godeploy.** `getEmbeddingsEspeciais()` carrega a tabela INTEIRA por classificação. Com `text-embedding-3-large` (3072d) são ~16 KB por vetor em base64 → o limite de **32 MiB** de serialização RPC bate em **~1.900 especiais**. É o mesmo teto que já derrubou o `/edicoes` (snapshots do Investigador). Cache no isolate seria remendo; sair da tabela é conserto.
2. **Padronização.** Vetor como base64 de `Float32Array` numa coluna TEXT + cosseno escrito à mão é artesanal. Plataforma oficial é legível para quem chegar depois e é uma coisa só para a Gogroup operar.
3. **Filtro por metadata no servidor** (só vizinhos com nota HUMANA, só a mesma função) é idiomático no índice e só é trivial em JS enquanto o corpus couber na memória.

⚠️ **O que o Pinecone NÃO compra:** precisão hoje. Por isso a **ordem** importa (ver abaixo): o `a1fe406` vai primeiro e **em PR separado** — se a nota mudar, é preciso saber qual dos dois mexeu.

## Contexto — o que já existe (peça 4, EM PROD)

- `src/lib/embeddings.ts` — chamada de embedding (sempre direto na OpenAI; Codex 404 em `/embeddings`; envs LAZY).
- `src/lib/especial-corpus.ts` — recuperação PURA: `selecionarVizinhos(alvoVetor, corpus, opts)` + cosseno em JS + top-K sobre a tabela `especial_embedding` (vetor em base64 de Float32Array; `texto_hash` evita re-embeddar). ⚠️ **É módulo PURO, e é por isso que a migração é uma função só** — trocar a origem do `corpus` não toca o resto.
- `src/lib/agents/especial-classificador.ts` — o agente que recomenda a estrela 0–10.
- `src/lib/especial-classificador.functions.ts` — orquestração server-side + rotas (backfill/cron/single).
- `src/lib/especiais-regua.ts` — prompt/rubrica + `CURVA_BASE` (FONTE ÚNICA).
- Tabelas internas: `especial_embedding`, `especial_avaliacao` (recomendação, origem `agente-classificador`).
- Rotas existentes: `/api/admin/especiais/classificar-pendentes` (dry-default), `/api/admin/especiais/classificar`, cron `/api/cron/classificar-especiais`. Background pós-submissão em `processarPosSubmissao` (`worker.ts`, só `especial===1`).
- **Melhoria A+B (`feat/rag-especial-qualidade`, `a1fe406`, NÃO deployada):** embedding lidera com a função descritiva (nome → `o_que_faz` → por que é especial → descrição → doc) e corta área/ferramenta/tipo; modelo sobe para `text-embedding-3-large`; guard `aplicarGuardVizinhoDivergente`. **Corrige bug MEDIDO em prod** (GoPrice 0–1★ contra «Agente precificador» 4★).

## Decisões — FECHADAS (26/08/2026)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Pinecone só store, ou store + busca? | **Store + busca.** Index serverless, `query` por topK. Embeddings continuam gerados na OpenAI. **NÃO usar Pinecone Assistant** — é outro produto; o que serve é o index de vetores. |
| 2 | Dimensão do index | **3072** (`text-embedding-3-large`, do `a1fe406`). ⚠️ A dimensão é **IMUTÁVEL** no index → **o modelo tem de estar cravado antes do T1**. É por isso que o `a1fe406` vem primeiro. |
| 3 | Namespace | **`prod` × `staging` separados.** Dados de staging são simulados e não podem contaminar a re-auditoria de prod. |
| 4 | Metadata no vetor | `projeto_id`, `estrela_humana`, `estrela_recomendada`, `area`, `texto_hash`, `modelo` + flag **`tem_nota_humana`** — é ela que permite filtrar por vizinho com rótulo humano (o anti-feedback-loop de `rotuloExemplar`), e é o filtro que justifica o índice. |
| 5 | Texto a embeddar | **Já decidido pelo `a1fe406`** — nome → `o_que_faz` → por que é especial → descrição → doc; área/ferramenta/tipo FORA (baixa entropia, e área aproximava por setor e separava irmãos de função). Teto `TETO_TEXTO_EMBEDDING` = 6000 chars, campos líderes primeiro. **Não relitigar.** |
| 6 | Coexistência com o SQLite | **SQLite segue FONTE DA VERDADE + fallback**; Pinecone é índice de LEITURA. Pinecone fora do ar → degrada (sem vizinhos), nunca quebra a submissão. ⚠️ Fallback que nunca roda apodrece calado: precisa de teste que exercite o caminho degradado. |
| 7 | Re-auditoria | **Rota admin `/api/admin/especiais/reauditar` (dry-default)**: varre os especiais COM nota humana, recupera k vizinhos (excluindo o próprio), compara a nota humana com a mediana ponderada dos vizinhos e reporta `\|delta\| >= 2` como provável inflação/deflação. **SEM tocar a coluna Estrelas.** |

## Ordem de execução (não juntar os passos num PR só)

1. **`a1fe406` sozinho** (`feat/rag-especial-qualidade`) → staging → prod. Bug medido, já codado, já testado. **Crava o modelo de embedding**, que o T1 precisa.
2. **Pinecone** (T1–T5) — PR separado.
3. **Re-auditoria** (T6) por cima do índice pronto.

### Tarefas

- **T1 — ⛔ falta rodar no ambiente.** O código do setup existe (`garantirIndice`, rota `POST /api/admin/especiais/pinecone/indice`); criar o índice é uma chamada com `{"criar":true}` em cada app. Serverless, **3072**, `cosine`, namespaces `prod`/`staging` derivados do `GODOCS_ENV`. ⚠️ Índice com outra dimensão é **reprovado** pela rota em vez de usado (consultar 3072 num índice de 1536 devolve 400, e silenciar isso daria "sem vizinhos" para sempre).
- **T2 — ✅ `src/lib/pinecone.ts`** — cliente REST puro (describe/create/upsert/query/delete), envs LAZY, só `fetch`, host do índice cacheado por isolate, nada lança. (guarda: `tests/pinecone-cliente.test.ts`, fetch mockado)
- **T3 — ✅ reaproveitado.** O `textoParaEmbedding` do `a1fe406` não foi tocado; o embedding continua saindo de `embeddings.ts` direto na OpenAI.
- **T4 — ✅ `recuperarVizinhos`** (`especial-classificador.functions.ts`): Pinecone primeiro, cosseno-em-JS do SQLite como fallback. O corpus do fallback é um **thunk preguiçoso** — com o índice no ar a tabela de vetores **não é lida**, que é o ponto da migração. (guarda: `tests/pinecone-especiais.test.ts`, com o caminho degradado exercitado)
- **T5 — ✅ `sincronizarPineconeEspeciais`** + `POST /api/admin/especiais/pinecone/backfill` (dry-default). Varre em **páginas** (`getEmbeddingsEspeciaisPagina`) — ler `especial_embedding` inteira aqui seria o mesmo teto de 32 MiB que motivou o índice.
- **T6 — ✅ `especiais-reauditoria.ts`** (puro: mediana ponderada, `LIMIAR_DELTA=2`, `MIN_VIZINHOS_COMPARAVEIS=3`) + `reauditarEspeciais` + `POST /api/admin/especiais/reauditar`.
- **T7 — ⛔ aberta.** Staging → validar → prod (regra 13) + PR (regra 7).

### O que ficou diferente do plano (e por quê)

- **A re-auditoria não tem `dry`** — a decisão 7 dizia "dry-default", mas **não existe caminho de escrita** para secar: escrever a nota é da triagem (só clique humano), e gravar uma "segunda opinião" ao lado da nota de gente em `especial_avaliacao` competiria com ela no cartão — exatamente o que o classificador já evita ao **não** reclassificar quem tem nota humana. A rota é read-only e o teste prova que nenhum writer é chamado.
- **A re-auditoria EXIGE o Pinecone** (sem fallback). O que faz a comparação valer é o filtro `tem_nota_humana` resolvido no servidor; comparar a nota de gente contra a mediana das recomendações do próprio agente é o feedback loop puro. Sem índice ela responde `ok:false` com o motivo — melhor que um relatório que parece certo.
- **`upsertVetores` DESCARTA vetor de outra dimensão** (achado da execução, não do plano): o SQLite
  guarda o histórico de todos os modelos, e um único vetor 1536d velho fazia o Pinecone devolver 400
  no LOTE INTEIRO — o 1º backfill da staging deu **49 vetores → 0 upsertados**. Agora descarta e
  CONTA (`descartados_dim`). ⚠️ **Reembedding (`classificar-pendentes` com `forcar`) vem ANTES do
  backfill depois de qualquer troca de modelo.**
- **Dois helpers novos no banco** (`getEmbeddingEspecial`, `getEmbeddingsEspeciaisPagina`): sem eles, o caminho quente e o backfill continuariam puxando a tabela inteira e o teto de RPC só teria mudado de lugar.

## Execução — o que a staging mostrou (26/08/2026)

Índice `godocs-especiais` criado (serverless, 3072, cosine, host `…aped-4627-b74a`), namespace
`staging`. Sequência que funcionou: **reembeddar → backfill → re-auditar**.

- **Recuperação via Pinecone confirmada ponta a ponta:** `classificar-pendentes` devolveu
  `origem_vizinhos: "pinecone"` com **6 vizinhos**; 49 embeddings regerados em 3072d.
- **Backfill:** 49/49 upsertados, `sem_vetor: 0`.
- **Re-auditoria:** 48 analisados → **29 coerentes · 11 infladas · 8 defladas · 0 sem_base**.

⚠️ **A régua acusa as âncoras.** O achado nº 1 foi o **PIAPP** (flagship 10★ conhecida) contra
referência **0**. A recuperação estava certa — os 6 vizinhos eram plataformas de IA (Gobeaute
Prompt Studio, Prisma, Hitmaker, Argos, Tropa, CTR Machine), similaridade 0,68–0,72, notas
0/5/0/0/2/0. Uma flagship é por definição distante dos pares; separar "é a âncora" de "está
inflada" é trabalho humano, e é por isso que cada linha carrega os `vizinhos`. Calibrar a régua
exige medir concordância contra as **644 notas humanas** — exercício próprio, fora desta fatia.

⚠️ Nota lateral: com `text-embedding-3-large` **nada** ficou abaixo do `PISO_SIMILARIDADE` de 0,2
(o mínimo observado foi **0,653**). O piso virou letra morta na prática — mexer nele altera também
o CLASSIFICADOR (constante compartilhada), então fica registrado, não alterado.

## Critérios de aceitação

1. O classificador recupera vizinhos via Pinecone (com fallback SQLite) e a recomendação continua indo para `especial_avaliacao`, **nunca** na coluna Estrelas.
2. Backfill indexa os especiais existentes; namespaces prod/staging isolados.
3. Relatório de re-auditoria (dry) aponta especiais com nota provavelmente inflada/deflada contra vizinhos e âncoras.
4. Embeddings continuam indo direto na OpenAI; nada de `process.env` em escopo de módulo; anti-feedback-loop preservado (rótulo preferido = nota humana).

## Fronteiras (não exceder)

- **A "equipe de agentes / graph engineering" (um especialista por área que converge nas estrelas ou sinaliza não-consenso) fica FORA desta fatia.** Esta fatia só prepara a base (índice vetorial rico + re-auditoria). O multi-agente é fase posterior, plano próprio.
  - ⚠️ **Quando esse plano nascer:** a topologia proposta (MASTER → especialistas por área → loop com revisor adversarial, teto de 3 voltas, marca "inconsistência") é essencialmente **o pipeline da força-tarefa do JV que já gerou o `especiais-seed.ts`** (7 avaliadores por cluster → **calibrador que reescala na curva real** → revisor adversarial sobre toda nota ≥3; resultado 0★:8 · 1★:43 · 2★:40 · 3★:6 · 4★:2). Dois avisos: **(a)** o **nó calibrador não pode faltar** — cada agente extra num loop empurra a nota para CIMA, e sem reescalar na `CURVA_BASE` (≥3★ = top 4% de 644) três voltas viram inflação; **(b)** rotear por **ÁREA é o eixo errado** — é exatamente o que o `a1fe406` mediu e cortou do embedding (área aproxima por setor e separa irmãos de função). Roteie por **função**. E as 644 notas humanas da planilha são um **test set pronto**: meça concordância antes de acreditar no pipeline.
- Não mudar o comportamento da coluna Estrelas (só clique humano escreve nela).
- Não trocar o produto por Pinecone Assistant.

## Blast-radius

Arquivos: `src/lib/embeddings.ts`, `src/lib/especial-corpus.ts`, `src/lib/agents/especial-classificador.ts`, `src/lib/especial-classificador.functions.ts`, novo cliente Pinecone, `worker.ts` (rotas), schema (novas rotas / nenhuma tabela nova obrigatória) · Dependentes: telas `/especiais`, cron de classificação · Invariantes: coluna Estrelas só por clique humano · anti-feedback-loop · embeddings só OpenAI · sem `process.env` em escopo de módulo · staging antes de prod · **Confiança: ALTA** (código varrido em 26/08/2026: `embeddings.ts`, `especial-corpus.ts`, `especial-classificador.ts`, `.functions.ts`, `especiais-regua.ts`, `especiais-seed.ts`, rotas do `worker.ts` e o diff do `a1fe406`).
