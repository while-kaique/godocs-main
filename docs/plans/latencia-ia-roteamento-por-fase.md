# Plano — Latência da IA: roteamento de modelo + `reasoning_effort` POR FASE
**Status:** 🟡 em execução (código T1–T4 feito 25/08; T5 staging + T6 docs + T7 prod pendentes)

**Progresso (25/08, sessão /ggsd:code):** T1–T4 CODADOS e verdes. `src/lib/llm.ts` ganhou
`reasoningEffort?` em `LLMOptions` + injeção opt-in de `reasoning_effort` no body de
`callOpenAI`/`callOpenAIStream` + guard puro exportado `sanitizeEffort` (allowlist, rejeita
`minimal`). `src/lib/agents/orchestrator.ts:~1545` trocou o `fastModel` grosseiro por cálculo POR
FASE (lazy, runtime): `doc`/`doc_preview` → `LLM_MODEL_FAST`+`sanitizeEffort(LLM_REASONING_EFFORT_FAST)`;
demais fases → model `undefined` (sol) + `sanitizeEffort(LLM_REASONING_EFFORT)`. Testes red autorados
em contexto fresco (`tests/llm-reasoning-effort.test.ts`, `tests/llm-reasoning-routing.test.ts`, 16 casos)
→ verdes; 2 mocks existentes migrados p/ `importOriginal` (o orchestrator passou a importar
`sanitizeEffort`) — sem enfraquecer assert. Suíte 1711 verde, tsc só com os 5 erros pré-existentes,
worker.js rebuildado. ⚠️ Revisão GGSD (§9.A conformidade + §9.B qualidade) DISPARADA mas ainda em voo
no fim da sessão — marcadores `pendente`; `/ggsd:ship` vai barrar até rodarem. **Pendentes:** T5
(staging: secrets `LLM_MODEL_FAST=gpt-5.6-luna`+`LLM_REASONING_EFFORT_FAST=low`, medir TTFB por fase),
T6 (docs: CLAUDE.md seção LLM + SPEC_FEATURES_NOVAS.md), T7 (prod + merge no main).

**Status original:** ✅ aprovado (Luis, 2026-08-25)

**Objetivo:** cortar a latência percebida do chat de submissão roteando os turnos MECÂNICOS
do orquestrador (fases `doc`/`doc_preview`) para um modelo leve (`gpt-5.6-luna`) com
`reasoning_effort=low`, **mantendo o memorial/doc-compile/analisador no `gpt-5.6-sol`**, tudo
**env-gated com default = comportamento de hoje**.

## Contexto (por que isto, e o que já se sabe)
Investigação a fundo do proxy-ai (24–25/08) + sondas empíricas contra o proxy real fecharam o
diagnóstico (memórias `proxy-ai-arquitetura-gargalo`, `investigacao-proxy-ai-latencia-erros`;
relatório em `scratchpad/RELATORIO-proxy.md` de outra sessão):

- **Raiz da latência/fallback:** o `gpt-5.6-sol` fica **mudo no fio durante o "pensar"**. TTFB
  medido no turno pesado: `sol/medium` **~19,6s** de silêncio antes do 1º token.
- **Medições (sondas reais):** `luna + low` no turno pesado → **TTFB 3,2s** (~6× mais rápido);
  `sol + low` → ~13,7s (corta ~30%, variância alta). ⚠️ **`reasoning_effort: minimal` → HTTP 502
  determinístico (6/6)** — usar **`low`, nunca `minimal`**.
- **Direção aprovada pelo Luis (25/08, multiselect):** roteamento POR FASE (não o secret grosseiro
  `LLM_MODEL_FAST` de hoje, que é tudo-ou-nada e mandaria o memorial pro luna) + prototipar/medir
  na staging. Streaming já religado em prod — **não mexer**.

**Decisão desta sessão (Luis, 25/08 — Opção A conservadora):** a fase `saving`/`receita` mistura,
numa fase só, as perguntas mecânicas do agente E a geração do MEMORIAL — e a `fase` (único sinal
disponível ANTES da chamada) não separa as duas. Então **saving/receita/memorial ficam 100% no
`sol`**; luna+low só nas fases `doc`/`doc_preview`. Isso é seguro porque:
- os **gates determinísticos** (jornada, teto, alocação, ganho-real, critério) já respondem a maioria
  dos turnos mecânicos de saving/receita **sem chamar o LLM** (`chat.functions.ts:1783` — `reask ??
  runOrchestrator(...)`, short-circuit do `??`);
- o histórico do repo tem 3 regressões de "prompt não segura" (Gostream, ganho projetado,
  SmartOnline) — degradar o modelo do memorial é justo o risco a não correr.

### Tarefas
- **T1 — Campo `reasoningEffort?` em `LLMOptions` + injeção no body** (`src/lib/llm.ts`). Adicionar
  `reasoningEffort?: string` a `LLMOptions` (linha ~11) e, quando setado, escrever
  `reasoning_effort` **no topo do body** de `callOpenAI` (~275) e `callOpenAIStream` (~402). Só
  injeta quando presente (opt-in) → quem não passa fica idêntico a hoje. O proxy já lê
  `req.reasoning_effort`; o fallback direto (`api.openai.com`, gpt-5.x) também aceita.
  (guarda: teste unitário — body contém `reasoning_effort` quando `opts.reasoningEffort` setado, e
  **omite** quando ausente; nos DOIS caminhos, proxy e stream)
- **T2 — Guard `sanitizeEffort()` anti-`minimal`** (`src/lib/llm.ts`). Helper puro que valida o
  valor contra allowlist `{low, medium, high, xhigh, max}` e **rejeita `minimal`/vazio/desconhecido**
  devolvendo `undefined` (não envia) + log 1×. Blinda o 502 mesmo que um secret venha errado.
  (Nota: `unsupportedByModel` em `llm.ts:287` já remove params REJEITADOS por 400 — mas `minimal`
  dá **502** = erro de gateway que consome retries e cai no fallback, então precisa do guard ANTES.)
  (guarda: teste — `sanitizeEffort('minimal')` e `sanitizeEffort('x')` → `undefined`; `'low'` → `'low'`)
- **T3 — Roteamento por fase no orquestrador** (`src/lib/agents/orchestrator.ts:1539-1604`).
  Substituir o `const fastModel = process.env.LLM_MODEL_FAST || undefined` (linha 1545, hoje
  aplicado a TODAS as fases) por cálculo POR FASE, lido em runtime (lazy, dentro de
  `runOrchestrator` — nunca em escopo de módulo):
  - `faseMecanica = fase === "doc" || fase === "doc_preview"`
  - `modeloTurno = faseMecanica ? (process.env.LLM_MODEL_FAST || undefined) : undefined`
    (undefined → `llmChat`/`llmChatStream` caem no `LLM_MODEL` = `sol`)
  - `effortTurno = faseMecanica ? sanitizeEffort(process.env.LLM_REASONING_EFFORT_FAST)
    : sanitizeEffort(process.env.LLM_REASONING_EFFORT)`
  Passar `model: modeloTurno, reasoningEffort: effortTurno` para **os dois** call-sites: o streaming
  (linha 1568) e o não-streaming (linha 1598). `atualizar-metadados` já entra pela fase `doc`
  (`chat.functions.ts:3052`), então é coberto de graça.
  (guarda: teste do orquestrador com env mockada — fase `doc`/`doc_preview` escolhe
  `LLM_MODEL_FAST`+`LLM_REASONING_EFFORT_FAST`; fase `saving`/`receita`/`*_preview` escolhe modelo
  `undefined` (sol) + `LLM_REASONING_EFFORT`; **todas as envs ausentes → model `undefined` + sem
  `reasoning_effort` = IDÊNTICO a hoje**)
- **T4 — `npm run test` verde + rebuild do `worker.js`** (regras 1 e 2). Mudança server-side →
  `npm run build:worker` e commitar o `worker.js`.
  (guarda: suíte verde; `git status` mostra `worker.js` modificado e commitado)
- **T5 — Medição na STAGING (prototipar/medir, aprovado pelo Luis)** — deploy no `edf400b4` (regra 13),
  setar secrets `LLM_MODEL_FAST=gpt-5.6-luna` + `LLM_REASONING_EFFORT_FAST=low` (deixar
  `LLM_REASONING_EFFORT` **unset** = medium no saving/receita), rodar sonda SSE medindo **TTFB por
  fase** contra a staging e comparar com baseline (`sol/medium`).
  (guarda: TTFB da fase `doc` cai visivelmente vs baseline; nenhuma `/api/chat/*` cai em 502; memorial
  segue no `sol` — confirmar por `getAppLogs`)
- **T6 — Docs antes do PR** (regras 7 e 12) — atualizar a seção **LLM** do `CLAUDE.md` (a nota "NUNCA
  manda reasoning_effort → tudo em medium" e "só o orquestrador rota p/ fastModel, grosseiro" mudam)
  + entrada em `spec-docs/SPEC_FEATURES_NOVAS.md` (roteamento por fase, envs, decisão Opção A).
- **T7 — Prod + merge no `main`** (regras 13 e 14) — só depois da medição na staging: deploy `674a3710`
  com os secrets, validar no ar (`getApp` manifest + sinal de runtime nos logs) e mergear no `main`
  (conta writer `LuisEduardo100`).

### Critérios de aceitação
1. Com **todas as envs de LLM ausentes**, o comportamento é **byte-idêntico ao de hoje** (nenhum
   `reasoning_effort` no body; modelo = `LLM_MODEL` em todas as fases) — provado por teste.
2. Com `LLM_MODEL_FAST=gpt-5.6-luna` + `LLM_REASONING_EFFORT_FAST=low`: fases `doc`/`doc_preview`
   chamam o modelo leve com `reasoning_effort=low`; fases `saving`/`receita`/`*_preview` continuam
   no `sol` **sem** `reasoning_effort` (a menos que `LLM_REASONING_EFFORT` seja setado).
3. `reasoning_effort=minimal` **nunca** é enviado (guard), independente do valor do secret.
4. Suíte verde, `worker.js` rebuildado e commitado.
5. Medição na staging mostra corte de TTFB na fase `doc` sem 502 e sem tocar o modelo do memorial.

### Fronteiras (não exceder)
- **NÃO** rotear `saving`/`receita`/memorial para o luna (decisão Opção A — memorial fica no `sol`).
- **NÃO** baixar o `reasoning_effort` de saving/receita por padrão — o knob `LLM_REASONING_EFFORT`
  existe (default unset), mas ligá-lo é experimento de staging/decisão futura, não parte da entrega.
- **NÃO** tocar `extractor.ts`, `validator.ts`, `doc-compiler.ts`, `analyzer.ts` (seguem no `sol`,
  sem effort). Rotear o extrator/validador para luna+low é **follow-up** possível, fora desta fatia.
- **NÃO** usar `minimal` (502).
- **FORA (lado do proxy, do Gabriel):** heartbeat SSE durante reasoning (a cura da raiz do
  "Network connection lost"); honrar `response_format`/Structured Outputs; `cached_tokens`. São
  patches do repo do Gabriel — no máximo redigir a mensagem/diff para ele, em sessão à parte.
- **NÃO** mexer nos timeouts de streaming (`STREAM_*`) nem no streaming (já em prod).

### Blast-radius
Arquivos: `src/lib/llm.ts` (LLMOptions + body de `callOpenAI`/`callOpenAIStream` + guard
`sanitizeEffort`) · `src/lib/agents/orchestrator.ts` (~1539-1604, cálculo por fase + 2 call-sites) ·
`worker.js` (rebuild) · docs (`CLAUDE.md`, `SPEC_FEATURES_NOVAS.md`).
Dependentes: todos os chamadores de `llmChat`/`llmChatStream` — mudança é **ADITIVA** (campo opcional
novo), nenhum quebra; só o orquestrador seta o campo novo.
Invariantes: **(1) default OFF = idêntico a hoje** (envs ausentes → sem effort + modelo sol); **(2)
nunca `process.env` em escopo de módulo** (envs lidas dentro de `runOrchestrator`, em request);
**(3) memorial permanece no `sol`**; **(4) nunca enviar `minimal`**; **(5) `worker.js` commitado**
(regra 1); **(6) staging antes de prod** (regra 13) e **merge no `main`** (regra 14).
Confiança: **alta** — li `llm.ts`, `orchestrator.ts:1539-1604` e o fluxo de gate em
`chat.functions.ts:1783`; há medição empírica. ⚠️ **Não há `docs/INDEX.md`/`docs/invariants.md`**
(RF-35) → o `/ggsd:code` faz a varredura completa de dependentes (grep por `LLM_MODEL_FAST`,
`reasoning`, chamadores de `llmChat*`) antes de codar.
