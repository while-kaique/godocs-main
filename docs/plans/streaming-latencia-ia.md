# Plano — Eliminar a latência das respostas da IA (streaming ponta a ponta)

> Status: **Fase 1 EM PRODUÇÃO + MERGEADA no `main`** (24/08/2026) — prod `674a3710` v276 com `LLM_STREAMING=1`, PR #276 (`4424030`), staging `edf400b4` também no ar. `main` = prod = staging. A entrega foi **só o streaming (parte 1)**; as partes 2 e 3 caíram (ver ⚠️ abaixo).
> ⚠️ **Correções ao plano após probes no proxy real (21/08):** o proxy é um **Codex subscription** — `response_format`/`json_schema` é SILENCIOSAMENTE IGNORADO, então a **parte 2 (Structured Outputs, §2/§4.2) está MORTA no proxy hoje** (o loop de retry/regex do orchestrator FICA como está) e **não existe gpt-4.x** (só gpt-5.6-{sol,terra,luna}/5.5/5.4/5.4-mini), então o braço gpt-4.x + Predicted Outputs da **Fase 2 (§9) está morto**. A **parte 3 (prompt-cache, §4.7) foi DEFERIDA** (ganho não-mensurável no backend Codex + risco nos prompts calibrados; o streaming já levou o TTFB a ~3s). O que FOI entregue: só o streaming (parte 1). Detalhe do que sobreviveu e o que caiu em cada seção está anotado inline abaixo (⛔/✅ por seção). **Trilha paralela viva:** o time do proxy (João Gabriel, 21/08) confirmou que o fix de Structured Outputs é VIÁVEL do lado deles (o gateway traduz Chat Completions → Responses API e descarta `response_format`; basta mapear para `text.format`) — quando isso subir, a gente liga o `response_format` de verdade e aposenta boa parte do loop de retry, mantendo o parser defensivo até provar em prod (ver §2).
> Origem: diagnóstico do caso **RA Monitor / Luis Liveri** (`eef2ba7414d5ed3540b017063f804add`) — submissão de 20min22s, **6min47s só de espera de IA**, 3 picos >60s que estouraram o timeout do proxy e caíram no fallback (`gpt-5.4-mini`), sem erro.

## 0. O que foi entregue (24/08/2026)

Só a **parte 1 (streaming SSE)**. Onde aterrissou: `src/lib/llm.ts` (`llmChatStream` + stall-timeout preservando o fallback de dois relógios + `extractPartialJsonStringField`), `src/lib/agents/orchestrator.ts` (`runOrchestrator` com `onDelta`, streama prosa só em `type`∈{preview,complete}, nunca no `complete` de `doc_preview`), `src/lib/chat.functions.ts` (`enviarMensagem`/`iniciar{Submissao,Saving,Receita}` threadam `onDelta`; gate que assume NÃO streama), `src/worker.ts` (SSE `delta`/`envelope`/`error` nas 4 rotas de conversa, atrás da flag `LLM_STREAMING`, default OFF), `src/lib/api-client.ts` (`apiStream` transparente ao transporte), `submeter.tsx`/`step3-chat.tsx` (bolha viva por delta + reconciliação com o envelope canônico). Testes: `tests/llm-stream`, `tests/orchestrator-stream`, `tests/api-stream` (+24 casos).

**Validação na staging (24/08, probe SSE com a sessão do Luis):** SSE confirmado nas 4 rotas; prosa streama token a token onde deve (doc preview 462 deltas, pergunta-saving 623, **memorial 931 deltas / TTFB 18s vs 66s de tela branca**, complete 32); silencioso por design onde deve (`doc_preview→complete` = ~64s de compilação pesada segue sem stream — a ÚNICA espera em branco que sobra). Logs: **todas as `/api/chat/*` = "ok", zero exceções**; 12 gerações no modelo real do proxy; **1 caiu no fallback gpt-5.4-mini** (memorial, 1ª tentativa) porque o modelo pesado do Codex "pensa" >25s (`STREAM_GAP_TIMEOUT_MS`) antes do 1º content e o gap-timer abortava — **NÃO é regressão** (o memorial já caía ~50% no fallback pelo timeout de 60s antigo). ✅ **CORRIGIDO 24/08/2026** (§9): o GAP de 25s deixou de valer ANTES do 1º conteúdo — agora até o 1º delta de conteúdo vale só o relógio de PRIMEIRO CONTEÚDO (`STREAM_FIRST_CONTENT_TIMEOUT_MS` 60s / `STREAM_FIRST_CONTENT_FALLBACK_MS` 30s), então o "raciocínio" longo do Codex não cai mais no fallback por estol falso. (Complementar, ainda aberto: o fix de Structured Outputs do proxy.)

## 1. Problema (com precisão)

O gargalo **não** é o proxy nem a rede. É que:

1. **Lemos a resposta inteira antes de mostrar qualquer coisa.** `llm.ts` faz `await res.json()` e devolve o `content` completo; a UI (`submeter.tsx` → `apiFetch`) faz `await response.text()` → `JSON.parse` e só então pinta UMA mensagem pronta. O submetente encara tela em branco por 60–88s.
2. **O timeout de 60s é NOSSO `AbortController`, não um limite do Cloudflare.** Workers **não têm limite de wall-clock** enquanto o cliente está conectado, e esperar o subrequest do LLM custa **~0 de CPU**. Um stream de 88s é plenamente suportado — nós que cortamos em 60s.
3. Como o timeout é **régua de TAMANHO** (já documentado no CLAUDE.md), **~58% dos turnos pesados caem no fallback só por serem longos**, arrastando a metade pesada do produto pro `gpt-5.4-mini` independente do `LLM_MODEL` configurado.

**Alvo:** os turnos `preview`/`complete` (`saving_preview`, `receita_preview`, `doc_preview`) e a geração inicial da doc — as gerações longas, exatamente as que estouram os 60s.

## 2. Escopo desta entrega (Fase 1 — Grupo A)

Tudo roda em **gpt-5.x, sem trocar modelo**. Baixo risco. Ataca latência PERCEBIDA + fallback falso + retries desperdiçados. **Não** reduz o tempo bruto de geração (isso é Fase 2).

1. ✅ **ENTREGUE — Streaming SSE ponta a ponta pelo Worker** + timeout por **stall** (primeiro-byte / gap entre chunks) no lugar do timeout por tempo total. — a espinha.
2. ⛔ **MORTA NO PROXY — Structured Outputs** (`response_format: json_schema`, strict) — mataria o loop de retry de JSON inválido/truncado do orchestrator. O proxy (Codex subscription) IGNORA `response_format` silenciosamente (probe 21/08), então o loop de retry/regex do orchestrator **FICA**. Fix viável do lado do time do proxy (ver §2 e §11); enquanto não subir, nada muda aqui.
3. ⏸️ **DEFERIDA — Prompt caching automático** — reordenar os prompts para prefixo byte-estável. Benefício não-mensurável no backend Codex e o streaming já levou o TTFB a ~3s; risco alto de mexer nos prompts calibrados. Adiada.

**Fora desta entrega e AGORA MORTA (ver §9):** a Fase 2 dependia de gpt-4.x + Predicted Outputs, e **o proxy não expõe gpt-4.x** (só gpt-5.x). O que sobra de vivo da §9 (split paralelo doc/memorial, roteamento por peso) não depende de troca de modelo e pode ser revisitado sem experimento de modelo.

## 3. Decisão de arquitetura central — "prosa em stream + envelope JSON no fim"

O bloqueador nº 1 (do mapa do código): a resposta é **um JSON estruturado único** (`{type,content,coletado,saving,receita,options,fase}`) e **gates determinísticos reescrevem esse objeto DEPOIS do LLM** (um `preview` pode virar `question`). Não dá pra streamar o JSON cru e comitar na UI antes dos gates rodarem.

Solução: **separar a prosa livre do envelope estrutural.**

- A **prosa** (`content` de `question`/`preview`/`complete` — memorial, texto da pergunta) é auto-contida (o backend já **re-extrai** o memorial do `content`, prova de que é self-contained). → **streama token a token**.
- Os **campos estruturais** (`type`, `fase`, `options[]`, echo de `saving`/`receita`, decisões de gate) precisam do objeto fechado e dos gates pós-LLM. → resolvem **no fim**, como um evento final "envelope".

Formato do turno (o modelo emite prosa primeiro, envelope estruturado como "rabo" JSON final; ver §5 para o contrato). A UI pinta a prosa na hora e **reconcilia** com o envelope ao término do stream (aplica `fase`, `options`, troca de formulário, animações).

**Política de quando streamar** (bloqueador nº 2 — gates preemptam o LLM):
- Turno em que um **gate determinístico assume** (`reask !== null`, ou pré-empção `devePreemptarPorProjecao`, ou gate pós-orchestrator que substitui `resultado`): resposta **não-streamada**, imediata, via `json()` como hoje — já é rápida, muitas vezes **sem chamar o LLM**.
- Turno em que **o LLM redige a resposta** (`reask === null` e nenhum gate pós assume): **streama**.
- Isso exige decidir "streamable-vs-não" **antes de abrir o stream** (ver §4, `chat.functions.ts`).

**Gates pós-LLM (bloqueador nº 3):** eles podem transformar `preview→question`. Regra: os gates pós-orchestrator rodam contra o **texto completo do modelo** (acumulado no fim do stream) **antes** de emitir o envelope. Se um gate assumir, o envelope carrega o `type`/`content` do gate (a prosa já streamada é descartada/substituída na UI — aceitável porque, quando um gate assume, a prosa do LLM não deveria ter sido mostrada; mitigação: só liberar streaming de prosa nos turnos `preview`/`complete`, onde os gates de reescrita são raros, e manter `question`/`options` curtos sem stream se o risco de reescrita for alto — decidir por fase no §6).

## 4. Mudanças por arquivo (com âncoras do mapa atual)

> Regra 1 do projeto: `.functions.ts`/`worker.ts` mexidos → `npm run build:worker` e commitar `worker.js`. Regra 8: trabalhar em **worktree**. Regra 13: **staging antes de prod**.

### 4.1 `src/lib/llm.ts` (`llmChat`, ~L48–213)
- Novo caminho **streaming**: enviar `stream: true` + `stream_options: {include_usage: true}` no body do POST `/chat/completions`.
- Trocar `await res.json()` por consumo do `res.body` (ReadableStream) e **repassar** os deltas para o chamador (nova assinatura: `llmChatStream(...)` retornando um `AsyncIterable`/`ReadableStream` de deltas, mantendo `llmChat` não-stream para os turnos não-streamados e para o analisador).
- **Timeout por stall**: substituir o `AbortController` de tempo total por: (a) timeout de **primeiro byte** (ex. 15–20s), (b) timeout de **gap entre chunks** (ex. 20–25s sem chunk). Abortar só nesses casos.
- **Preservar o fallback de dois relógios** (proxy → `api.openai.com`/`LLM_FALLBACK`/`LLM_FALLBACK_MODEL`): se o stream estola antes do primeiro byte (ou erra), refazer a MESMA chamada **também em streaming** no fallback. Manter `gatewayRetries` e o retry de parâmetro não suportado (400 `unsupported_parameter/value`).
- ⚠️ `stream_options` pode não chegar se o stream for cancelado — **não pendurar estado no chunk de usage**.
- ⚠️ Confirmar que o **gateway GoGroup encaminha** `stream:true` e `stream_options` (testar no proxy real).

### 4.2 `src/lib/agents/orchestrator.ts` (`runOrchestrator`, parse ~L1551–1616) — ✅ ENTREGUE (streaming) / ⛔ Structured Outputs MORTA no proxy
- ✅ Consumir o stream do `llmChat`: acumular a **prosa** e, no fim, parsear o **envelope** estruturado. Feito via `onDelta` (9º arg posicional); streama prosa só quando `type`∈{preview,complete}. **O gate do type usa REGEX de valor completo** `/"type":"(...)"/` — ler type parcial ("prev") travava `streamAtivo=false` pra sempre (bug pego em teste). Retry/regex-recovery intactos.
- ⛔ **Structured Outputs**: enviar `response_format: {type:"json_schema", json_schema:{...strict...}}` **NÃO funciona no proxy hoje** — ele é Codex subscription e IGNORA o campo (probe 21/08: 200 com texto livre). O loop de reparse (`maxRetries=2`) e a recuperação por regex **FICAM**. Extração incremental da prosa por parser hand-rolled `extractPartialJsonStringField` (sem dep `partial-json`, por causa do `node_modules` symlinkado + bundle do worker).
- 🔜 **Fix VIÁVEL do lado do time do proxy (João Gabriel, 21/08):** o gateway não é passthrough — traduz Chat Completions → Responses API em `chatToResponses.ts` e o `response_format` cai num `[k]:unknown` e é descartado. Fix deles = mapear `response_format {type:json_schema,json_schema:{name,schema,strict}}` → `text:{format:{type:json_schema,name,schema,strict}}` (Responses API), garantia via constrained decoding do provider. **Passos combinados ANTES de a gente codar:** (1) um curl no `/responses` da assinatura Codex com `text.format` (com e sem stream) para confirmar que o backend honra; (2) mapear o campo no `chatToResponses.ts`; (3) **no MESMO PR deles, tratar `refusal` e geração INCOMPLETA no `responsesToChat.ts`** — senão JSON truncado (nossas gerações são longas) vira `finish_reason:stop` = sucesso quebrado, PIOR que hoje; (4) conferir `tools`+`text.format` juntos (o gateway sempre injeta tools upstream); plan B deles = validate-schema+retry dentro do gateway. **Do nosso lado, quando isso estiver em prod:** ligar `response_format` de verdade e aposentar boa parte do loop de retry — mantendo o parser defensivo até provar em prod.
- ✅ Prosa × envelope: adotamos a **opção A** (prosa dentro do campo `content`, extração incremental), com parser próprio no lugar do `partial-json`.

### 4.3 `src/lib/chat.functions.ts` (`enviarMensagem` ~L1210–2337, `iniciarSubmissao`, `iniciarSaving`)
- **Decidir streamable-vs-não ANTES de abrir o stream**: rodar a cadeia de gates de resposta (`reask`, L1334–1658) e a pré-empção (`devePreemptarPorProjecao`, L1669) primeiro. Se algum assume → devolver `json()` como hoje (sem stream).
- Se `reask === null` → abrir o stream: encaminhar a prosa ao Worker; ao término, rodar os **gates pós-orchestrator** (L1873–2160) sobre o texto completo, re-mesclar campos backend-only (L1710–1750), rede do memorial (L1756), anti-zero (L1792), e então emitir o **envelope** final.
- `compilarDocumentacao` (L2249, pesado) e a persistência de mensagens (L2263–2280) continuam no fim, antes do envelope.
- Manter `runBackground`/`waitUntil` para a análise pós-submit.

### 4.4 `src/worker.ts` (rotas `/api/chat/*`, ~L378–399, helper `json()` L127–136)
- Nova resposta **SSE** para os turnos streamados: `new Response(stream, { headers: { "content-type":"text/event-stream", "cache-control":"no-cache", "x-accel-buffering":"no" }})`.
- ⚠️ Usar `Response(upstream.body)` cru / `TransformStream` com `TextEncoder` — **não** usar helpers de framework que bufferizam SSE (ex. Hono `stream()`).
- Manter `json()` para os turnos não-streamados (gates que assumem).

### 4.5 `src/lib/api-client.ts` (`apiFetch`, ~L19–33)
- Novo helper `apiStream(path, body, {onDelta, onEnvelope})`: `fetch` → ler `response.body` como SSE (reader loop + `TextDecoder`), chamar `onDelta(prosa)` por chunk e `onEnvelope(obj)` no evento final.
- `apiFetch` (one-shot JSON) permanece para tudo o mais e para os turnos não-streamados.

### 4.6 `src/routes/submeter.tsx` (`handleSendMessage` ~L2110–2190)
- Estado incremental da mensagem do assistente: criar a bolha vazia ao iniciar o stream, ir concatenando `onDelta`, e no `onEnvelope` aplicar a **cauda estrutural** (`type`/`isPreview`/`isComplete`/`fase`/`options`) — reconciliando com as animações de transição de fase (3s) e trocas de formulário já existentes.
- Loading: manter o spinner só até o **primeiro delta**; depois, cursor de digitação.

### 4.7 Prompts (prompt caching)
- Reordenar `buildDocPrompt`/`buildSavingPrompt`/`buildReceitaPrompt`/`buildSavingCustoEvitadoPrompt` e o system prompt para **prefixo byte-estável** (esqueleto `MEMORIAL_ESQUELETO`, instruções, exemplos, taxonomias FIXAS primeiro; interpolações por projeto/`buildRespostasFormulario` por ÚLTIMO). Sem mudar o conteúdo — só a ordem.
- Regra 3 do projeto: prompt alterado → atualizar `src/lib/testes/prompt-registry.ts` e `prompt-inspector.tsx`.

## 5. Contrato do stream (SSE)

- `content-type: text/event-stream`. Cada evento uma linha `data: {...}\n\n`.
- Eventos:
  - `{"t":"delta","c":"<pedaço de prosa>"}` — repetido, prosa incremental.
  - `{"t":"envelope","r":<OrchestratorResult completo>}` — único, ao fim; carrega `type`/`fase`/`options`/`coletado`/`saving`/`receita` já passados pelos gates pós-LLM. O `content` final é canônico (a UI substitui a prosa acumulada por ele se divergir).
  - `{"t":"error","m":"..."}` — falha; a UI mostra a mensagem tranquilizadora atual do orchestrator (estado `coletado/saving/receita` intacto).

## 6. Gates × streaming (regra de segurança)

- Só streamar prosa nos turnos que o LLM redige (`reask===null` && sem pré-empção). Nos demais, `json()` imediato.
- Como um gate pós-LLM ainda pode reescrever `preview→question`, a UI trata a prosa streamada como **provisória** até o `envelope`. Mitigação de UX: na Fase 1, **habilitar streaming primeiro só para `doc_preview`/`saving_preview`/`receita_preview` e a geração inicial da doc** (maior ganho, menor chance de reescrita por gate). Turnos `question`/`options` curtos podem entrar depois.

## 7. Testes (regra 2 do projeto)

- Reaproveitar/estender `tests/llm-fallback.test.ts` (o fallback de dois relógios não pode regredir; agora com stall-timeout).
- Novos: parse incremental (partial-json → `content` estável), decisão streamable-vs-não (gate assume → não streama), schema strict round-trip (envelope válido), stall-timeout (primeiro-byte e gap disparam abort/fallback).
- E2E no **staging** (regra 13): rodar cenários de saving/receita/doc apontados pro `edf400b4` e medir TTFT + taxa de fallback antes/depois via `api_logs` (o mesmo `duration_ms`/`status_code` usados no diagnóstico).

## 8. Rollout

1. Worktree (regra 8) → `npm run test && npm run build && npm run build:worker` (regra 1).
2. Deploy **staging** `edf400b4` → validar no navegador (ver a prosa fluir) + medir.
3. **Feature flag** (env, lido dentro de função — regra "nunca `process.env` em escopo de módulo") para ligar/desligar streaming sem redeploy, e para restringir aos tipos do §6.
4. Só então **prod** `674a3710`; e (regra 14) **mergear no `main` na hora**.
5. Medir em prod: TTFT p50/p90 e **% de turnos no fallback por tamanho** (meta: de ~58% → ~0).

## 9. Fase 2 — ⛔ O braço de modelo MORREU (proxy sem gpt-4.x); sobra o que não troca modelo

⚠️ **O experimento gpt-5.x vs gpt-4.x + Predicted Outputs está MORTO:** o proxy (Codex subscription) só expõe gpt-5.6-{sol,terra,luna}/5.5/5.4/5.4-mini — **não há gpt-4.1/4o** (gpt-4.1 dá 400/502), e Predicted Outputs é exclusivo de gpt-4.1/4o. Enquanto o produto rodar pelo proxy, não há caminho gpt-4.x para rotear os turnos pesados.

O que continua VIVO da Fase 2 (não depende de trocar de modelo, revisitar sob dados, NÃO codar agora):
- **Split paralelo**: gerar doc técnica e memorial financeiro em 2 chamadas concorrentes (~metade do wall).
- **Roteamento por peso**: turnos leves seguem como estão (0% de fallback hoje); só os pesados vão pro caminho rápido.
- ✅ **FEITO (24/08/2026) — Afrouxar o GAP pré-conteúdo:** o estol do streaming passou a ter DUAS fases (`callOpenAIStream`, `llm.ts`). Até o 1º delta de CONTEÚDO vale só o relógio de PRIMEIRO CONTEÚDO (`STREAM_FIRST_CONTENT_TIMEOUT_MS` 60s proxy / `STREAM_FIRST_CONTENT_FALLBACK_MS` 30s fallback), que cobre o "raciocínio" do modelo; o `STREAM_GAP_TIMEOUT_MS` (25s) só passa a valer DEPOIS do 1º conteúdo. Chunks sem conteúdo (role/keepalive) não resetam o relógio de primeiro-conteúdo nem armam o GAP. Fallback de dois relógios preservado. Testes de fake-timer em `tests/llm-stream.test.ts`. (Complementar, ainda aberta: o fix de Structured Outputs do proxy, §4.2, que encurtaria a geração.)
- Harness: comparar por cenário TTFT, wall total e um LLM-juiz de qualidade do memorial/doc (reaproveitar `scripts/e2e/validate-llm.mjs`).

**~~Predicted Outputs~~ (morto no proxy):** só gpt-4.1/4o (NÃO gpt-5.x); registrado aqui só para não reabrir a ideia sem antes ter gpt-4.x disponível.

## 10. Riscos & gotchas

- Helpers de framework bufferizam SSE; `wrangler dev` pode não streamar como o deploy real → testar **deployado**.
- `stream_options`/usage pode não chegar em cancelamento.
- Edge OAuth do Godeploy adiciona ~750ms fixos por request (não removível aqui).
- Regra 7/12: atualizar CLAUDE.md e as specs (`spec-docs/`) no MESMO PR (a nota "não há streaming / timeout = régua de tamanho" muda).
- Regra 1: commitar `worker.js`.
- **Smart Placement** (Grupo C): ganho desprezível (dezenas de ms vs 60–90s) — só ligar oportunamente e medir; fora da Fase 1.

## 11. Fontes (pesquisa)

- Cloudflare Workers limits (sem wall-clock; subrequest ~0 CPU): https://developers.cloudflare.com/workers/platform/limits/
- Stream OpenAI via Worker: https://developers.cloudflare.com/workers/examples/openai-sdk-streaming/
- TransformStream: https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/
- Hono SSE buffering: https://github.com/orgs/honojs/discussions/2409
- OpenAI streaming events: https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Predicted Outputs: https://developers.openai.com/api/docs/guides/predicted-outputs
- Prompt caching (OpenAI): https://developers.openai.com/api/docs/guides/prompt-caching
- Prompt caching (Anthropic): https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching
- AI SDK streamObject: https://ai-sdk.dev/v5/docs/reference/ai-sdk-core/stream-object
- AI SDK fallback não é failover runtime: https://github.com/vercel/ai/issues/9950
- partial-json: https://www.npmjs.com/package/partial-json
- Smart Placement: https://developers.cloudflare.com/workers/platform/smart-placement/

## 12. Veículo & versões

- **Entregue:** `fetch` cru com `stream:true` + parser incremental **hand-rolled** (`extractPartialJsonStringField`) no lugar do `partial-json` — o `node_modules` symlinkado do worktree + o bundle do worker tornavam a dep frágil, e só precisávamos extrair UM campo string (`content`). Preserva o fallback de dois relógios que já tínhamos. **Não** adotamos o Vercel AI SDK (seu `fallbackProvider` é só resolução de nome, não failover em runtime).
- Workers: sem `process.env` em escopo de módulo — a flag `LLM_STREAMING` é lida por `streamingLigado()`, lazy, dentro de função.
