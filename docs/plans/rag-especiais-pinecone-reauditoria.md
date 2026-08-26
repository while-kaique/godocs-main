# Plano — RAG de especiais no Pinecone + re-auditoria de estrelas

**Status:** rascunho

**Objetivo:** Migrar a recuperação vetorial do agente classificador de especiais (peça 4) do cosseno-em-JS/SQLite para o **Pinecone (REST)**, vetorizando **nome + descrição + documentação imposta** de cada especial, e usar o índice para (a) recomendar estrela de especiais **novos** e (b) **re-auditar** os já submetidos (com nota humana) detectando inflação/deflação.

> ⚠️ **Rascunho capturado sob contexto esgotado.** A exploração profunda (blast-radius real, contratos das funções, formato do texto a embeddar) **NÃO foi feita** nesta sessão — a janela estava ~100%. A sessão de código (contexto fresco) deve rodar a varredura completa antes de implementar. **Confiança: BAIXA.**

## Contexto — o que já existe (peça 4, EM PROD)
- `src/lib/embeddings.ts` — chamada de embedding (sempre direto na OpenAI; Codex 404 em `/embeddings`; `text-embedding-3-small`, envs LAZY).
- `src/lib/especial-corpus.ts` — recuperação PURA: cosseno em JS + top-K sobre a tabela `especial_embedding` (vetor em base64 de Float32Array; `texto_hash` evita re-embeddar).
- `src/lib/agents/especial-classificador.ts` — o agente que recomenda a estrela 0–10.
- `src/lib/especial-classificador.functions.ts` — orquestração server-side + rotas (backfill/cron/single).
- `src/lib/especiais-regua.ts` — prompt/rubrica (fonte única).
- Tabelas internas: `especial_embedding`, `especial_avaliacao` (recomendação, origem `agente-classificador`).
- Rotas existentes: `/api/admin/especiais/classificar-pendentes` (dry-default), `/api/admin/especiais/classificar`, cron `/api/cron/classificar-especiais`. Background pós-submissão em `processarPosSubmissao` (`worker.ts`, só `especial===1`).
- **Melhoria A+B já codada (não deployada):** worktree `~/godocs-wt-rag-especial`, branch `feat/rag-especial-qualidade`, commit `a1fe406` (embedding lidera com função descritiva + `-large`; guard de vizinho divergente). ⚠️ Decidir se essa melhoria entra ANTES da migração Pinecone, junto, ou é descartada/reaproveitada.

## Decisões em aberto (resolver no início da sessão de código / novo /ggsd:plan)
1. **Pinecone só como store de vetores, ou como store + busca?** (recomendado: index serverless, `query` por topK; os embeddings continuam gerados na OpenAI). NÃO usar Pinecone Assistant (as telas dos docs) — é outro produto; o que serve é o index de vetores.
2. **Dimensão do index** = dimensão do modelo de embedding (`-small`=1536, `-large`=3072). Fixar o modelo ANTES de criar o index (dimensão é imutável no index).
3. **Namespace**: separar `prod` × `staging` (ou usar índices distintos) — os dados de staging são simulados e não podem contaminar a re-auditoria de prod.
4. **Metadata no vetor**: id do projeto, nota humana (Estrelas), área, se é âncora/flagship, hash do texto. É o que permite filtrar vizinhos e comparar contra âncoras.
5. **Texto a embeddar**: montar de nome + descrição + documentação imposta — definir a função de composição (ordem, truncamento por limite de tokens do embedding).
6. **Coexistência com o SQLite**: `especial_embedding` vira cache/fallback ou é aposentada? (fallback é mais seguro — Pinecone fora → degrada, não quebra a submissão.)
7. **Re-auditoria**: nova rota admin `/api/admin/especiais/reauditar` (dry-default) que varre os especiais COM nota humana, compara contra vizinhos+âncoras e emite um relatório de "provável inflada/deflada" — SEM tocar a coluna Estrelas.

### Tarefas (provisórias — refinar com blast-radius real)
- **T1 —** Criar o índice no Pinecone (serverless, dimensão do modelo escolhido, namespaces prod/staging). Doc de setup. (guarda: `query` de smoke retorna vazio sem erro)
- **T2 —** Cliente Pinecone REST puro em `src/lib/` (upsert/query/delete), envs LAZY, `fetch` (roda no Worker). (guarda: teste com fetch mockado)
- **T3 —** Função de composição do texto (nome+descrição+doc imposta) + geração do embedding (OpenAI direto). (guarda: teste puro do texto montado)
- **T4 —** Recuperação: `especial-corpus.ts` passa a consultar o Pinecone (topK + filtro por metadata), mantendo o SQLite como fallback. (guarda: teste de recuperação com Pinecone mockado)
- **T5 —** Backfill: upsert de TODOS os especiais existentes no Pinecone (rota admin dry-default). (guarda: contagem upsertada == nº de especiais)
- **T6 —** Re-auditoria: rota admin que compara nota humana × vizinhos/âncoras e emite relatório de inflação/deflação, SEM escrever na coluna Estrelas. (guarda: dry mode não muta nada)
- **T7 —** Staging → validar → prod (regra 13) + PR (regra 14).

### Critérios de aceitação
1. O classificador de especiais recupera vizinhos via Pinecone (com fallback SQLite) e a recomendação continua indo para `especial_avaliacao`, nunca na coluna Estrelas.
2. Backfill indexa os especiais existentes; namespaces prod/staging isolados.
3. Existe um relatório de re-auditoria (dry) que aponta especiais com nota provavelmente inflada/deflada, comparando contra vizinhos e âncoras.
4. Embeddings continuam indo direto na OpenAI; nada de `process.env` em escopo de módulo; anti-feedback-loop preservado (rótulo preferido = nota humana).

### Fronteiras (não exceder)
- **A "equipe de agentes / graph engineering" (um especialista por área que converge nas estrelas ou sinaliza não-consenso) fica FORA desta fatia.** Esta fatia só prepara a base (índice vetorial rico + re-auditoria). O multi-agente é fase posterior, plano próprio.
- Não mudar o comportamento da coluna Estrelas (só clique humano escreve nela).
- Não trocar o produto por Pinecone Assistant.

### Blast-radius
Arquivos (prováveis): `src/lib/embeddings.ts`, `src/lib/especial-corpus.ts`, `src/lib/agents/especial-classificador.ts`, `src/lib/especial-classificador.functions.ts`, novo cliente Pinecone, `worker.ts` (rotas), schema (novas rotas/nenhuma tabela nova obrigatória) · Dependentes: telas `/especiais`, cron de classificação · Invariantes: coluna Estrelas só por clique humano · anti-feedback-loop · embeddings só OpenAI · sem `process.env` em escopo de módulo · staging antes de prod · **Confiança: BAIXA** (exploração profunda adiada por contexto esgotado; a sessão de código faz a varredura completa).
