# Plano — Fluidez: streamar as perguntas do agente (C) + fechar a alavanca real (F + proxy)
**Status:** 🟡 código executado (C: T1–T5 codados, suíte verde, revisor conforme; falta T6 staging→prod→merge) — 01/09/2026

## Execução (01/09/2026 — /ggsd:code)
- **Fatia C codada e verde.** Worktree `~/godocs-wt-streamar-perguntas`, branch **`feat/streamar-perguntas`** (off `origin/main` `0487664`). Mudança **server-only, ~32 linhas em `src/lib/agents/orchestrator.ts`**:
  - **T1** (`streamAtivo`, ~linha 1597): passou a incluir `question`/`options`, **preservando** o invariante `complete && fase!=="doc_preview"` (o `complete` de doc_preview segue silencioso).
  - **T2** (extração, ~linha 1600): novo `streamField` escolhe o campo da prosa por type — `question` para `type:options`, `content` para os demais — **reusando** `extractPartialJsonStringField` (sem helper novo).
- **T3/T4/T5 = no-ops confirmados (correção de state-drift do plano, ↓ blast p/ BAIXO):** o cliente monta a bolha viva do CHUNK cru já fatiado no servidor (`submeter.tsx:2418`), não de um campo do JSON; o envelope já mapeia `type:options`→`content=question` (`chat.functions.ts:509`); `step3-chat.tsx:2288` só desenha botões quando `lastMsg.options` existe (vem no envelope, pós-stream). `llm.ts` intocado — turnos de pergunta **já** usavam `llmChatStream` (`orchestrator.ts:1573`), a PR só liga o forward dos deltas. Fronteira respeitada: **só** orchestrator.ts + teste + worker.js.
- **Verificação:** test-writer confirmou o red (question/options não streamavam); implementado até verde. **Suíte 2295 verde** (159 files, +2 casos). `tsc` adiciona **0** erros (7 pré-existentes no `origin/main`, nenhum em orchestrator.ts). `worker.js` rebuildado. Faixa medida **`padrao`** → revisor de conformidade = **`conforme` (0.95, sem achados)**; sem revisor de qualidade (padrao).
- **NÃO deployado, NÃO commitado no main.** ⚠️ **Colisão de staging:** o `edf400b4` está com a **fatia-c (G+B+H)** aguardando validação do Luis; deployar esta branch a SUBSTITUIRIA. Sequenciar antes do T6.

**Status original:** ✅ aprovado (Luis, 2026-08-31)

**Objetivo:** o agente "fala" gradualmente também nos turnos de PERGUNTA (hoje só o memorial/preview streama), com risco baixo e sem tocar gate nenhum — e deixar destacada a alavanca que realmente derruba a latência sentida (veredito do `reasoning_effort=low`).

## Contexto — por que este recorte
A META é fluxo contínuo (~2-3s por etapa; "10 min do CEO é caro"). Depois de mapear o código (2 exploradores isolados, 31/08):
- **A dor dominante é o TTFB mudo (~15-20s do `sol` "pensando" calado no proxy)** — não o número de gates. O lever nosso é (F) `reasoning_effort=low` (já na staging, 20s→3s, falta veredito de qualidade). **Isso é a alavanca; C é polimento que anda junto dela.**
- **`prodStatus` (E) é BECO SEM SAÍDA — CONFIRMADO EM CÓDIGO:** `validarEtapa1` (`submeter/constants.ts:401`) bloqueia a Etapa 1 quando `prodStatus!=="sim"`, então **todo projeto no chat já é `"sim"`** — constante, sem valor discriminante. O gate de ganho projetado **já assume isso** (a pergunta cita "você declarou que está em produção") e arma por **pista textual de projeção**, não por `prodStatus`. Threadá-lo **desligaria o gate para todos** e removeria a proteção contra número projetado (caso Eduardo Santana: `prodStatus="sim"` E receita projetada). **E fica fora — não é bug, é o gate funcionando.**
- **I (agente auxiliar) em STANDBY** (decisão do Luis, 31/08): viável e com desenho limpo (ver Fronteiras), mas blast ALTO e ganho marginal incerto até F+C estarem no fluxo.

## Tarefas
> Fatia de **código = C**. F e o pedido ao Gabriel são trilhas humanas/medição em paralelo (não são código), listadas porque são a prioridade de fluidez.

### Código (C — streamar perguntas)
- **T1 — Estender a decisão de streamar para `type:question`/`options`.** Ponto único: `src/lib/agents/orchestrator.ts:1597` (`streamAtivo = tm[1]==="preview" || (tm[1]==="complete" && fase!=="doc_preview")`). Incluir `question`/`options` **preservando** `fase!=="doc_preview"` (nunca streamar o `complete` de doc_preview — invariante). (guarda: teste que prova delta em turno de pergunta do LLM; `tests/orchestrator-stream.test.ts:64-85` hoje asserta `deltas.toEqual([])` para question e **inverte** — atualizar via test-writer red→green.)
- **T2 — Extrair o campo certo por `type`.** `type:question` guarda o texto em `content`; `type:options` guarda em `question` (`types.ts:256-273`). O extrator em `orchestrator.ts:1600` lê só `content`. Escolher o campo por `type` — **reusar** `extractPartialJsonStringField(rawAcc, "question")` (já testado em `tests/llm-stream.test.ts:144`), não criar helper novo. (guarda: teste de que `options` streama o texto de `question`, não bolha vazia.)
- **T3 — Cliente: bolha viva com o campo certo + reconciliação intacta.** `submeter.tsx:2409-2508` (e os espelhos saving/receita ~2588/2747): o `onDelta` cria a bolha com `content`; se `options` for streamado, a bolha nasceria vazia lendo só `content` — ler o campo por type. A reconciliação por envelope (`submeter.tsx:2498-2503`, troca a última bolha pelo resultado canônico pós-gates) **não muda**. (guarda: `tests/submeter-stream-callsites.test.ts` segue verde; smoke visual na staging.)
- **T4 — Verificar as 2 lacunas do explorador (não assumir):**
  - `llm.ts` (`streamTimeouts`/`callOpenAIStream`): confirmar que uma **pergunta curta** (que fecha antes do 1º conteúdo) **não** cai no fallback indevidamente (janela de primeiro-conteúdo 60s/30s). (guarda: teste de fake-timer com pergunta curta streamada, sem fallback.)
  - `step3-chat.tsx`: confirmar que, com `options` streamado, o texto parcial aparece **antes** dos botões (que vêm só do envelope) **sem quebrar o layout**. (guarda: smoke na staging + render test se viável.)
- **T5 — Invariantes que seguem travados (não regridem):** perguntas de **gate determinístico** (`reask`) fazem short-circuit e **não** streamam (`chat.functions.ts:1796`, `reask ?? runOrchestrator`) — nada a mudar; o swap preview/pergunta-de-gate já é reconciliado pelo envelope; o fallback de dois relógios preservado. (guarda: `tests/orchestrator-stream.test.ts` que prova `streamMock not.toHaveBeenCalled` em reask segue verde.)
- **T6 — `worker.js` + suíte + revisores + staging→prod.** `npm run test` → `npm run build:worker` (se worker mudar) → §9 revisores (conformidade/qualidade) sobre o diff → staging `edf400b4` → validar no navegador (perguntas aparecem token a token) → prod `674a3710` → merge no `main` (regra 13/14, conta `LuisEduardo100`).

### Trilha da alavanca real (F) — NÃO é código desta fatia
- **T-F — Veredito do `reasoning_effort=low` (F).** Luis submete 2-3 savings reais na staging (`LLM_REASONING_EFFORT=low` já setado); eu comparo `low` × sem `low` (qualidade do memorial + nº de perguntas por `getAppLogs`). Decisão: manter o secret (ganho de 20s→3s) ou apagar. (guarda: comparação registrada; secret decidido.)

## Critérios de aceitação
1. Num turno de **pergunta gerada pelo LLM** (question/options), o texto aparece **token a token** no chat, como já ocorre no memorial.
2. Perguntas de **gate determinístico** continuam **instantâneas** (sem stream) — nada regrediu.
3. O `complete` de **doc_preview** **nunca** streama (compilação pesada segue silenciosa).
4. Nenhuma mudança em gate, ordem de coleta, número/redação das perguntas, ou nos números do memorial.
5. Suíte verde; staging validada no navegador antes de prod.

## Fronteiras (não exceder)
- **E (prodStatus) FORA** — beco sem saída que quebraria o gate. Não threadar `prodStatus` ao backend.
- **D (memorial streama e um gate o troca por pergunta) FORA** — pré-existente, sensível (mexe em quando o preview aparece × quando os gates rodam). Fatia própria se o Luis pedir.
- **Consolidar gates (metade de E) FORA** — territorio anti-loop; fatia própria.
- **I (agente auxiliar / 1ª pergunta durante compilação) EM STANDBY.** Quando voltar, a restrição é a ferro: o auxiliar só pode escrever `coletado`/blob em **chave própria** (padrão vivo `coletado_inicial` + `CHAVES_PROTEGIDAS_DOC`, `doc-async.ts`), **nunca** `saving`/`receita`, campos de gate (jornada/teto/alocação/ganho_real/sobreposição), nem uma mensagem `assistant` fora de banda — isso desligaria as travas e recriaria o loop de 38 perguntas.
- **A ordem dos gates e o anti-loop não se tocam** nesta fatia.

### Blast-radius
Arquivos (C): `orchestrator.ts:1590-1600` (decisão + extração) · `types.ts:256-273` (campo por type) · `submeter.tsx:2409-2508` + espelhos saving/receita · `step3-chat.tsx` (render options streamado) · `llm.ts` (só verificação das lacunas, sem mudança esperada) · testes `orchestrator-stream`/`llm-stream`/`submeter-stream-callsites`.
Dependentes: cliente `apiStream` (agnóstico ao type, não quebra) · `worker.ts` (envelope canônico intacto).
Invariantes: nunca streamar complete de doc_preview · reask não streama · reconciliação por envelope · fallback de dois relógios · gates leem estado vivo (não tocado).
Branch sugerida: worktree próprio a partir de `origin/main` (C é ortogonal ao reorder; não entrelaçar com a validação de prod da fatia C). Confiança: **média** (0.79 — o repo não tem `docs/INDEX.md`/`invariants.md` formais; invariantes conferidos inline no CLAUDE.md + testes; 2 lacunas viram T4). O `/ggsd:code` faz a varredura profunda.
