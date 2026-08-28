# Plano — Mesa de avaliação: de eco-de-gate a auditor raciocinado

**Status:** ✅ aprovado (Luis, 28/08/2026) — escopo **B (time LLM completo)**; gates determinísticos viram **voto** (não piso), retroativo é a rede; materialidade **só na sombra**.

**Objetivo:** transformar a "mesa de avaliação em sombra" (hoje 100% determinística, que só ecoa os gates) num **auditor que raciocina sobre os dados reais do projeto** — parecer argumentado sobre o **ganho total** (não a receita crua), confiança = qualidade real da concordância, loop de até 5 rodadas buscando consenso, e histórico de rodadas exposto na ficha. Tudo **em SOMBRA** (`AVALIACAO_NORMAIS`, nunca muda status).

> Origem: Luis (28/08, ficha do "Quiz de Vendas Apice" `4790ee…`, sombra=`Validar 30%`/divergência). A mesa hoje só ECOA o gate; ele quer um AUDITOR de verdade que ajude a decidir aprovar/reprovar nos casos de divergência. Memória: `mesa-avaliacao-qualidade-parecer`, `fatia-c-agentes-avaliacao-time`.

---

## ⚠️ Onde o código vive (crítico para a sessão de código)
A mesa **está no `origin/main`** (PRs #303/#305), **NÃO** na branch de trabalho atual (`docs/rag-especiais-pinecone-plan`, anterior à feature). A sessão de código **DEVE partir de um worktree novo do `main`** (regra 8), fora da raiz (ex.: `~/godocs-wt-mesa-parecer`). Ler qualquer arquivo da mesa por `git show origin/main:<arquivo>` até o worktree existir.

## Diagnóstico confirmado no código (origin/main)
1. **Mesa é 100% determinística, ZERO LLM.** Os "especialistas" são funções puras: FTE (`analyzer.ts`), Financeiro (`avaliacao-financeira.ts`), sinal RAG por vizinhos (`agregador-avaliacao.ts`), Cético (`cetico-avaliacao.ts`), Agregador (`agregarVotos`, `min` dos votos), Deliberação (`deliberacao.ts`, reducer). **Nenhuma raciocina sobre o texto** — daí "ecoa o gate".
2. **Confiança é degrau fixo, não convergência.** RAG: `confianca = apoio ? 0.85 : n===0 ? 0.4 : 0.55` (`agregador-avaliacao.ts:~58`). Agregado = `Math.min(confFte, confFin, confRag)` (elo mais fraco). Cético lastro = `sinais.length * 0.3`. O "30%" = 0.85 − 1 sinal do cético. Não mede qualidade.
3. **Materialidade usa RECEITA CRUA, não ganho total — VERIFICADO.** `analyzer.ts:847-849`: `materialidade = economia_reais_mes + valor_ganho_mensal`. E `valor_ganho_mensal` é a **receita crua declarada** (ex. 51k), NÃO o ÷10. O **ganho total** é `saving + receita/10` (`chat.functions.ts:3919-3921` → 5,1k, a coluna "Ganho Total"). ⚠️ **Essa mesma `materialidade` alimenta o gate REAL do analyzer** (`decidirStatusSubmissao`, >R$5k → `em_validacao`/"Pendente") — não é só sombra. O parecer que o Luis viu citando "R$51.000 > R$5.000" é o `redator-justificativa` do **analyzer real**, não da mesa.
4. **Rodadas capadas em 2** (`MAX_RODADAS_DELIBERACAO = 2`, `deliberacao.ts`). Cada rodada só re-roda o reducer determinístico — **não injeta raciocínio novo**, então mais rodadas convergem ao mesmo resultado. Loop só é útil se cada rodada trouxer argumento NOVO (um turno de LLM).

## Restrição de plataforma (Cloudflare Worker / Godeploy)
- ~60s por chamada de LLM; **debate multi-agente NÃO cabe num request**. O padrão já existente e correto: **deliberação persistida avançada por CRON** (1 rodada por invocação, idempotente, bounded). "5 rodadas" = subir o teto + o cron rodar o auditor até consenso de qualidade.
- Embeddings SEMPRE direto na OpenAI (proxy não expõe `/embeddings`). Envs LAZY. Comentário no `SCHEMA_SQL` sem `;`. NUNCA selecionar blobs em massa (teto 32 MiB RPC).

---

## Abordagens (trade-offs + recomendação)

**A — Auditor LLM de turno único + correções de confiança/materialidade (MENOR).**
Um agente LLM ("auditor") rodando **1× por submissão** (background), vendo descrição + saída do analyzer + doc técnica + memorial + votos dos especialistas determinísticos + vizinhos RAG, e produzindo um **parecer argumentado** sobre se o **ganho total** justifica auto-aprovar ou enviar ao humano, com auto-confiança. Confiança da mesa = **concordância** auditor↔especialistas (não o degrau). Materialidade corrigida para ganho total (só na mesa/sombra). Parecer exposto na ficha.
- **Prós:** entrega o que o Luis SENTE (parecer que raciocina) com 1 chamada de LLM; blast-radius contido; sombra (não toca produção). **Contras:** não é debate multi-rodada real (o C fica parcial).

**B — Auditor LLM multi-rodada (debate real via cron), 5 rodadas, parada por qualidade (COMPLETO — o que o Luis descreve).**
Auditor roda **1× por rodada** (cron-avançado), vendo o parecer da rodada anterior + a objeção do cético, refinando até **consenso de qualidade** ou 5 rodadas. Persiste parecer + confiança **por rodada** (histórico). Confiança = trajetória de convergência. Materialidade sobre ganho total. Rodadas + histórico na ficha.
- **Prós:** "time de auditoria processando de verdade" (A+B+C+D+E). **Contras:** maior blast-radius; várias chamadas de LLM/projeto; schema para histórico por rodada; UI de rodadas; mais custo de cron.

**C — Fatiar: fixes puros primeiro (materialidade + confiança-real), depois o auditor LLM.**
Fatia 1 sem LLM (materialidade→ganho total na mesa + confiança por concordância/dispersão + subir MAX_RODADAS). Fatia 2 = auditor LLM. Fatia 3 = UI de rodadas.
- **Prós:** incremental, cada fatia entrega. **Contras:** ⚠️ a fatia 1 **NÃO resolve a queixa principal** — a mesa continua ecoando (sem raciocínio) até a fatia 2. O Luis não sentiria a mudança.

> **DECISÃO DO LUIS (28/08): escopo B — o time LLM completo.** Cada especialista vira um **agente LLM crítico** (não um auditor único), deliberando por rodadas. Recusou a fatia A (turno único) e a C (fixes puros): quer "cada agente rodando com LLM e sendo bem crítico".

## Decisões travadas (28/08)
1. **Escopo = B (time LLM completo).** Cada agente (Plausibilidade/FTE, Financeiro, Precedente/RAG, Cético) roda com LLM e é genuinamente crítico; deliberação multi-rodada até 5.
2. **Gates determinísticos = VOTO, não piso.** O LLM tem autonomia; o cálculo determinístico (FTE, materialidade, dupla contagem) entra como **um dos sinais que o agente pondera**, não como trava dura. ⚠️ **Risco aceito (o caso 500h pode, em tese, ser "raciocinado" por cima).** Mitigação **obrigatória**: (a) tudo segue em **SOMBRA** — a mesa nunca decide status, só recomenda; (b) o **retroativo** (`avaliacao-retroativa`) é a REDE — mede `erro_grave` (mesa auto-aprovaria o que o humano REPROVOU) contra o veredito humano, e é o gate de confiança **antes** de o Luis considerar tirar da sombra. O cálculo determinístico **não é deletado** — continua rodando e é entregue ao agente como voto/input.
3. **Materialidade sobre ganho total = só na mesa/sombra.** A mesa raciocina sobre o ganho total (÷10, 5,1k). **NÃO** tocar `analyzer.ts:847` (gate real) — produção intacta.

---

## Tarefas (escopo B — time LLM; sub-fatiar na sessão de código, RED→verde por peça)
> ✅ **T0 (mapeamento) CONCLUÍDO** pelo explorador — no Blast-radius abaixo (confiança 0.88).
> ⚠️ Cada agente LLM ESTENDE o padrão de `redator-justificativa.functions.ts` (llmChat leve, `sanitizeEffort`, **fail-safe determinístico que NUNCA lança**, gate LAZY). O TEXTO do projeto (doc/memorial/descrição/vizinhos) já é montado por `montarEntradaSemanticaNormal`/`carregarContextoPainel` (hoje só p/ embedding) → reusar. **Sem R$ cru em nenhum prompt/parecer** (payload da sombra esconde valor/hora).
- **T1 — Agentes especialistas LLM (críticos).** Um por dimensão (`src/lib/agents/especialista-*-avaliacao.ts` + prompt): **Plausibilidade/FTE**, **Financeiro**, **Precedente/RAG**, **Cético** (adversarial de verdade). Cada um recebe o texto + o **voto determinístico da sua dimensão como input** (Decisão 2: sinal, não trava) + vizinhos, e devolve `{julgamento, argumento, confianca, sinais}`. RED primeiro (test-writer), LLM mockado. ⚠️ Fail-safe: erro/timeout do agente → cai no voto determinístico daquela dimensão (não derruba a mesa).
- **T2 — Agregador/chair sobre os votos LLM.** `agregarVotos` passa a conciliar os julgamentos dos agentes LLM + os determinísticos como votos. **Confiança = concordância real** entre os agentes ao longo da rodada (dispersão/consenso), substituindo o degrau 0.85. Invariantes: nunca `aprovar` negativo automático; especial/liderança isentos.
- **T3 — Deliberação multi-rodada (até 5).** `MAX_RODADAS_DELIBERACAO` 2→5; o reducer passa a reagir a **argumento novo** — a cada rodada (cron) os agentes VEEM os pareceres/objeções da rodada anterior e refinam; para por **consenso de qualidade** ou esgota 5 → humano. ⚠️ **Persistir histórico por rodada:** hoje `upsertDeliberacao` **sobrescreve** o `historico` com só a rodada corrente e o mapper o **descarta** — mudar para **append** (parecer + confiança de cada rodada) sem `SELECT historico` em lote.
- **T4 — Materialidade sobre ganho total (mesa).** Corrigir `computarVotos` (`avaliacao-normais.functions.ts:290-307`) para `saving + receita/10` antes de alimentar o Financeiro. NÃO tocar `analyzer.ts:847` (Decisão 3). Reconferir a fonte do ÷10 (`ganhoTotalMensal`, `chat.functions.ts:3919`). (guarda: receita 51k → materialidade 5,1k na mesa)
- **T5 — Orquestração + persistência.** Fiar os agentes LLM em `avaliarComContexto`/`avancarDeliberacoesPendentes` (background, env-gate LAZY, sombra). Parecer final em `projeto_avaliacao.motivo` (já renderizado); pareceres por rodada no `historico` acumulado. ⚠️ N chamadas LLM/rodada × até 5 rodadas em background — aceito (sombra, cron-bounded). (guarda: nada muda status; `AVALIACAO_NORMAIS` OFF = NO-OP total; suíte verde)
- **T6 — UI: parecer + rodadas na ficha.** Parecer raciocinado já entra por `mesa.motivo` (`projeto-detalhe-dialog.tsx:419-423`); **expor a lista de rodadas** — parar o mapper `montarAvaliacaoSombra` de descartar `historico` + tipo `AvaliacaoSombra.deliberacao.historico[]` + render. Skill `frontend-design`. (guarda: PT-BR com acento; estado nunca só por cor)
- **T7 — Retroativo é a REDE (Decisão 2).** Confirmar que o retroativo roda a mesa NOVA (agentes LLM) contra o veredito humano e mede `erro_grave`; é o gate de confiança antes de qualquer conversa de tirar da sombra. `build:worker`, suíte verde, §8.1/§9 revisores, staging (`edf400b4`) → validar num projeto de receita real + um absurdo (500h) → prod (`674a3710`) → PR (`LuisEduardo100`) + CLAUDE.md/spec.
- **T6 —** `build:worker`, suíte verde, §8.1/§9 revisores, staging (`edf400b4`) → validar num projeto de receita real → prod (`674a3710`) → PR (`LuisEduardo100`) + CLAUDE.md/spec.

## Critérios de aceitação
1. Cada dimensão (Plausibilidade/FTE, Financeiro, Precedente/RAG, Cético) produz um **julgamento raciocinado por LLM** — o Cético refuta de verdade — e o parecer final na ficha **argumenta** sobre os dados do projeto, citando o **ganho total** (5,1k), não a receita crua (51k).
2. A confiança da mesa **varia com a concordância real** entre os agentes ao longo das rodadas — deixa de ser o degrau fixo 0.85.
3. A deliberação roda **até 5 rodadas** com argumento novo por rodada, e a ficha mostra o **histórico de rodadas**.
4. **Nada muda o status de produção** (sombra); `AVALIACAO_NORMAIS` OFF → NO-OP total. O retroativo mede `erro_grave` da mesa NOVA contra o veredito humano.
5. Invariantes preservados: nunca aprova negativo automático; especial/liderança isentos; triagem humana sobrepõe; embeddings direto na OpenAI; envs LAZY; sem `;` em comentário de schema; sem R$ cru em prompt/payload; agente LLM nunca lança (fail-safe → voto determinístico).

## Fronteiras (não exceder)
- **Não tocar o gate REAL do analyzer** (`analyzer.ts:847`, materialidade que decide "Pendente" em produção) — Decisão 3: materialidade só na mesa.
- Não mexer no fluxo de especiais (peça 4 do Kaique) — tabelas/corpus separados.
- **Não deletar o cálculo determinístico** — ele continua rodando e entra como VOTO/input do agente (Decisão 2). O que muda é que deixa de ser piso duro.
- Nada sai da SOMBRA nesta entrega — tirar a mesa da sombra é decisão futura do Luis, condicionada ao retroativo.

## Blast-radius (mapeado pelo explorador — confiança 0.88, MÉDIO)
- **Arquivos:** `src/lib/agents/auditor-avaliacao.ts` (novo, espelhando `redator-justificativa.functions.ts:37-63` — único LLM da mesa hoje) · `avaliacao-normais.functions.ts` (`computarVotos:253-341` carrega doc/saving/receita/FTE/RAG; materialidade `:290-307`; `montarEntradaSemanticaNormal:115-130` + `carregarContextoPainel:135-158` já montam o TEXTO p/ o auditor; `avaliarComContexto:393-467` grava; cron `avancarDeliberacoesPendentes:282-370`) · `deliberacao.ts` (`avancarDeliberacao`, `MAX_RODADAS=2`, `grauConfianca`) · `avaliacao-financeira.ts:16` (teto 5000) · `agregador-avaliacao.ts` (`avaliarSinalRag` degrau 0.85). **Persistência:** `projeto_avaliacao.motivo` (TEXT, já existe e já renderizado → parecer entra SEM novo schema na fatia A); `deliberacao_avaliacao.historico` (gravado mas **SOBRESCRITO** a cada rodada e **descartado no mapper** → só a fatia B mexe). **UI:** `projeto-detalhe-dialog.tsx:82-105,365-455` (tipo `AvaliacaoSombra` + painel; `mesa.motivo` renderiza texto livre em `:419-423`) · `dashboard-admin.functions.ts:319-366` (`montarAvaliacaoSombra` — expõe payload, DESCARTA histórico) · `avaliacao-sombra-rotulos.ts` · `chip-sombra.tsx`.
- **Dependentes:** `avaliacao-retroativa.functions.ts:22-23,123-132` (reusa `computarVotosDoProjeto`/`carregarContextoPainel`/puros → mudar assinatura quebra a medição retroativa + backfill) · `worker.ts:218,365-389,655,916-941` (3ª promise do `processarPosSubmissao` + crons `deliberar-avaliacoes`/`avaliar-normais` + rotas admin) · `dashboard-admin.functions.ts:122-140` + `chip-sombra.tsx` (coluna "Sombra" da listagem, lote de 90, teto 100 vars). Testes: `agregador-avaliacao`/`deliberacao`/`cetico-avaliacao`/`avaliacao-financeira`.
- **Invariantes:** modo SOMBRA (tabelas INTERNAS, nada muda `decidirStatusSubmissao`) · `AVALIACAO_NORMAIS` env-gate LAZY (OFF=NO-OP total) · especial/liderança isentos · nunca aprova negativo automático · **sem R$ cru no payload** (`serializarVotos:344-358` esconde valor/hora — o parecer LLM não pode vazar) · **LLM nunca lança no background** (fail-safe determinístico, como o redator) · embeddings direto OpenAI · sem `;` em comentário de schema · não `SELECT historico` em lote (32 MiB RPC).
- **Confiança:** **MÉDIA→ALTA** — diagnóstico, restrição de plataforma e mapa de persistência/UI verificados no código. Lacunas menores p/ a sessão de código: cadência exata dos crons (`wrangler.toml`); corpo de `agregarVotos`/`avaliarCetico` se mexer na agregação; reconferir a fonte do ÷10 antes de trocar a materialidade.
