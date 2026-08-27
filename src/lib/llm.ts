// Camada de abstração de LLM — suporta OpenAI e Anthropic via variáveis de ambiente
// Troca de provider: só alterar LLM_PROVIDER no .env
const log = (...args: unknown[]) => console.log("[llm]", ...args);
const errLog = (...args: unknown[]) => console.error("[llm]", ...args);

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMOptions = {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  // Sobrescreve o modelo (LLM_MODEL) para esta chamada. Usado para rotear turnos
  // simples de conversa para um modelo mais rápido/barato (ver LLM_MODEL_FAST).
  model?: string;
  // `reasoning_effort` do modelo (gpt-5.x). OPT-IN: só é injetado no body quando
  // presente — ausente = comportamento de sempre (o backend/proxy usa o default).
  // ⚠️ NUNCA passar `minimal` (o gateway devolve 502 determinístico) — quem seta
  // deve filtrar por `sanitizeEffort` antes. Ver roteamento por fase no orchestrator.
  reasoningEffort?: string;
  // Timeout por tentativa (AbortController) OVERRIDE. Ausente = o default do modo
  // (LLM_TIMEOUT_PROXY_MS). Usado pelo COMPILADOR da doc, que quer um relógio FOLGADO:
  // geração longa (doc grande) não pode ser cortada como se fosse erro.
  timeoutMs?: number;
  // Compilador da doc: NÃO cair no modelo leve escondido (LLM_FALLBACK/gpt-5.4-mini).
  // Com `true`, em erro/timeout do proxy o MESMO modelo é retentado no proxio (backoff),
  // e se esgotar LANÇA — o chamador defere a recompilação; a doc nunca sai no mini.
  // ⚠️ Só afeta quem SETA (compilador). Chat/saving/memorial não passam → fallback intacto.
  semFallbackModelo?: boolean;
  // Quantas vezes retentar o MESMO modelo em erro de gateway/rede/timeout quando
  // `semFallbackModelo` (mapeia para o gatewayRetries do callOpenAI, backoff de 2s). Default 2.
  retriesModelo?: number;
};

// Guard puro anti-`minimal`: valida `reasoning_effort` contra a allowlist e devolve
// `undefined` (= não enviar) para vazio/desconhecido/`minimal`. ⚠️ `minimal` faz o
// gateway responder 502 (medido, 6/6) — pior que um 400 de parâmetro, porque consome
// os retries de gateway e cai no fallback. Este guard blinda o body mesmo que um
// secret venha errado. Loga 1× por valor rejeitado (não por chamada).
const EFFORT_ALLOWLIST = new Set(["low", "medium", "high", "xhigh", "max"]);
const effortRejeitadoLogado = new Set<string>();
export function sanitizeEffort(value?: string): string | undefined {
  if (value && EFFORT_ALLOWLIST.has(value)) return value;
  if (value && !effortRejeitadoLogado.has(value)) {
    effortRejeitadoLogado.add(value);
    errLog(`reasoning_effort inválido ignorado: "${value}" (allowlist: ${[...EFFORT_ALLOWLIST].join(", ")})`);
  }
  return undefined;
}

// Timeout por tentativa de chamada ao LLM (AbortController). ⚠️ A chamada NÃO é streaming,
// então este relógio mede o tempo de gerar a RESPOSTA INTEIRA — não o primeiro byte.
//
// ⚠️ Eram 25s para os dois lados, e isso fazia o fallback ser a REGRA, não a exceção: numa
// hora de produção medida em 11/08/2026, **29 de 50 chamadas (58%)** abortaram nos 25s. E não
// por instabilidade — por tamanho: `atualizar-metadados` 100%, fase `doc` 100%, compilação da
// doc 67%, memorial de saving 50%; os turnos curtos (`saving_preview`) 0%. Um memorial de
// ~3.800 caracteres não sai em 25s pelo proxy.
//
// Consequência silenciosa: no fallback o modelo passa a ser o `LLM_FALLBACK_MODEL`
// (gpt-5.4-mini), então a metade pesada do produto — documentação e memorial — rodava no
// modelo do fallback mesmo com outro modelo configurado em `LLM_MODEL`. Trocar `LLM_MODEL`
// não surtia efeito justamente onde mais importa.
//
// Hoje os dois lados têm relógios PRÓPRIOS:
//   - PROXY (60s): dá tempo de uma geração longa terminar no modelo escolhido. Aguardar
//     `fetch` não consome CPU no Worker; o custo é a espera de quem está na tela — e ela
//     hoje JÁ é maior, porque a pessoa paga os 25s do proxy MAIS a geração no fallback.
//   - FALLBACK (25s): a `api.openai.com` direta é rápida (é o proxy que é lento) e os
//     memoriais do fallback fechavam dentro dos 25s. Manter curto evita o pior caso de
//     esperar 60s duas vezes quando o proxy está realmente pendurado.
const LLM_TIMEOUT_PROXY_MS = 60_000;
const LLM_TIMEOUT_FALLBACK_MS = 25_000;

// Modelo usado no FALLBACK (OpenAI direto, fora do proxy). gpt-5.4-mini por padrão
// (NÃO 5.5). Override opcional via env LLM_FALLBACK_MODEL (lido em runtime).
const DEFAULT_FALLBACK_MODEL = "gpt-5.4-mini";

// ── STREAMING (SSE) ──────────────────────────────────────────────────────────
// Timeouts do caminho de streaming. ⚠️ Aqui o relógio NÃO é mais uma régua de
// TAMANHO (como era no não-streaming): medimos o tempo até o PRIMEIRO CONTEÚDO e o GAP
// entre chunks, nunca o tempo total. Um stream de 88s tem centenas de chunks com gaps
// pequenos, então jamais dispara — o que MATA a patologia dos 58% de fallback "por
// geração longa".
//
// Régua tirada de medição no proxy real (21/08/2026): num memorial de ~700 palavras
// gerado pelo gpt-5.6-sol (o modelo pesado de prod), o TTFB foi ~2,2s e o MAIOR gap entre
// chunks foi 2,2s (942 chunks, 26s no total). gpt-5.5 e gpt-5.4-mini foram ainda mais rápidos.
//
// ⚠️ DUAS FASES DISTINTAS (24/08/2026): o modelo pesado do Codex "pensa" >25s ANTES do 1º
// token de conteúdo — se o GAP de 25s valesse nessa fase, o gap-timer abortaria o modelo
// bom e jogaria o memorial no fallback gpt-5.4-mini (visto na validação de staging). Então:
//   - ATÉ o 1º delta de CONTEÚDO: vale só o relógio de PRIMEIRO CONTEÚDO (60s proxy / 30s
//     fallback), que cobre headers + "raciocínio" do modelo. O GAP de 25s NÃO se aplica aqui.
//     Chunks sem conteúdo (role/keepalive) não resetam esse relógio nem armam o GAP.
//   - DEPOIS do 1º conteúdo: vale o GAP de 25s (~10× o pior gap medido), resetado a cada
//     chunk — pega o proxy que morre NO MEIO sem cortar uma geração longa saudável.
// O fallback (OpenAI direto) tem primeiro-conteúdo mais curto (30s), no espírito dos "dois
// relógios". Os 3 valores são configuráveis por env (lidos LAZY em `streamTimeouts()` — nunca
// em escopo de módulo, porque `process` não existe no bootstrap do Worker).
const STREAM_FIRST_CONTENT_PROXY_DEFAULT_MS = 60_000;
const STREAM_FIRST_CONTENT_FALLBACK_DEFAULT_MS = 30_000;
const STREAM_GAP_DEFAULT_MS = 25_000;

// Lê um inteiro positivo de ms de uma env; volta ao default se ausente/inválida. LAZY (dentro
// de função) por causa do Worker — ver aviso acima e a regra do CLAUDE.md.
function envPositiveMs(name: string, def: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Timeouts do streaming resolvidos em runtime (proxy / fallback).
function streamTimeouts(): {
  firstContentProxyMs: number;
  firstContentFallbackMs: number;
  gapMs: number;
} {
  return {
    firstContentProxyMs: envPositiveMs(
      "STREAM_FIRST_CONTENT_TIMEOUT_MS",
      STREAM_FIRST_CONTENT_PROXY_DEFAULT_MS,
    ),
    firstContentFallbackMs: envPositiveMs(
      "STREAM_FIRST_CONTENT_FALLBACK_MS",
      STREAM_FIRST_CONTENT_FALLBACK_DEFAULT_MS,
    ),
    gapMs: envPositiveMs("STREAM_GAP_TIMEOUT_MS", STREAM_GAP_DEFAULT_MS),
  };
}

export async function llmChat(messages: LLMMessage[], opts: LLMOptions = {}): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? "openai";
  const model = opts.model ?? process.env.LLM_MODEL ?? "gpt-4.1";

  // Modo proxy: quando LLM_BASE_URL está definida, roteamos para o nosso API proxy
  // (gateway OpenAI/Anthropic-compatível) e autenticamos com API_PROXY_TOKEN. Sem
  // LLM_BASE_URL, o comportamento é o de sempre — chamada direta com LLM_API_KEY.
  // (O gate na base URL evita que TER só o token quebre as chamadas diretas.)
  const baseUrl = process.env.LLM_BASE_URL?.trim() || undefined;
  const proxyToken = process.env.API_PROXY_TOKEN?.trim() || undefined;
  const usingProxy = !!(baseUrl && proxyToken);
  const apiKey = usingProxy ? proxyToken! : process.env.LLM_API_KEY;

  const keyPreview = apiKey ? `${apiKey.slice(0, 12)}... (${apiKey.length} chars)` : "✗ AUSENTE";
  log(
    `provider=${provider}, model=${model}, base=${baseUrl ?? "(direto)"}, apiKey=${keyPreview}, msgs=${messages.length}`,
  );

  if (!apiKey) {
    throw new Error(
      baseUrl
        ? "API_PROXY_TOKEN não configurado (modo proxy via LLM_BASE_URL)"
        : "LLM_API_KEY não configurada no .env",
    );
  }

  if (provider === "anthropic") {
    return callAnthropic(messages, { ...opts, model, apiKey, baseUrl });
  }

  if (provider !== "openai") {
    throw new Error(`Provider desconhecido: ${provider}. Use "openai" ou "anthropic".`);
  }

  // FALLBACK do LLM (só no modo proxy + provider openai): quando o proxy demora
  // (> LLM_TIMEOUT_PROXY_MS, abortamos) ou retorna erro de gateway, refazemos a MESMA
  // chamada direto na OpenAI (sem proxy) com uma chave dedicada (LLM_FALLBACK) e um modelo
  // leve (gpt-5.4-mini). Assim o usuário não vê o erro nem fica preso no "tente novamente".
  // - Com fallback disponível, o proxy NÃO retenta gateway (gatewayRetries:0) → falha
  //   rápido e cai no fallback (em vez de esperar 3× o timeout antes do plano B).
  // - Sem fallback, mantém a resiliência de antes (2 retries de gateway no proxy).
  // ⚠️ O fallback é PLANO B, não caminho normal: ele troca o modelo por baixo
  // (LLM_FALLBACK_MODEL). Se os logs voltarem a mostrar fallback na maioria dos turnos, o
  // problema é o timeout do proxy estar curto para o tamanho da geração — não "instabilidade".
  const fallbackKey = usingProxy ? process.env.LLM_FALLBACK?.trim() || undefined : undefined;

  // COMPILADOR da doc (semFallbackModelo): garante a doc SEMPRE no modelo escolhido (luna),
  // sem o mini escondido. Distingue LENTIDÃO de ERRO — o timeout FOLGADO (opts.timeoutMs) deixa
  // a geração longa terminar; erro real (502/rede/timeout) retenta o MESMO modelo no proxy
  // (gatewayRetries, backoff 2s) e, esgotado, LANÇA (o chamador defere). NUNCA vai ao mini/OpenAI
  // direto. Fica ANTES do try/catch do fallback — quem não seta a flag mantém o fallback de sempre.
  if (opts.semFallbackModelo) {
    return await callOpenAI(messages, {
      ...opts,
      model,
      apiKey,
      baseUrl,
      timeoutMs: opts.timeoutMs ?? LLM_TIMEOUT_PROXY_MS,
      gatewayRetries: opts.retriesModelo ?? 2,
    });
  }

  // `model` resolvido (opts.model ?? env) tem de VENCER o spread de opts — senão um
  // opts.model undefined (ex: LLM_MODEL_FAST não configurado) sobrescreveria o modelo
  // com undefined e a API responderia "you must provide a model parameter".
  try {
    return await callOpenAI(messages, {
      ...opts,
      model,
      apiKey,
      baseUrl,
      timeoutMs: LLM_TIMEOUT_PROXY_MS,
      gatewayRetries: fallbackKey ? 0 : 2,
    });
  } catch (proxyErr) {
    if (!fallbackKey) throw proxyErr;
    const fallbackModel = process.env.LLM_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
    const reason = proxyErr instanceof Error ? proxyErr.message.slice(0, 100) : String(proxyErr);
    errLog(`Proxy falhou/demorou (${reason}) — fallback p/ OpenAI direto, modelo=${fallbackModel}`);
    return await callOpenAI(messages, {
      ...opts,
      model: fallbackModel,
      apiKey: fallbackKey,
      baseUrl: undefined, // direto na api.openai.com (sem proxy)
      timeoutMs: LLM_TIMEOUT_FALLBACK_MS,
      gatewayRetries: 2,
    });
  }
}

// Versão STREAMING de llmChat. Recebe um callback `onRawDelta` que é chamado com cada
// pedaço de texto CRU do modelo (o `choices[0].delta.content` da SSE da OpenAI) à medida
// que chega. Devolve o texto CRU COMPLETO no fim — mesmo tipo de retorno de llmChat, para
// o chamador (orchestrator) parsear o JSON como sempre. A extração da "prosa" de dentro
// do JSON (partial-JSON do campo `content`/`question`) é responsabilidade do chamador —
// esta camada é agnóstica ao formato do OrchestratorResult.
//
// Preserva o FALLBACK de dois relógios (proxy → OpenAI direto). ⚠️ Regra anti-prosa-dupla:
// uma vez que QUALQUER conteúdo tenha sido emitido via onRawDelta, NÃO cai mais no fallback
// nem retenta — devolve o que veio (o chamador lida com JSON truncado pela rede de retry
// dele). Só falha "limpa" (antes do 1º byte de conteúdo) aciona o fallback.
export async function llmChatStream(
  messages: LLMMessage[],
  opts: LLMOptions & { onRawDelta?: (chunk: string) => void } = {},
): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? "openai";
  const model = opts.model ?? process.env.LLM_MODEL ?? "gpt-4.1";
  const baseUrl = process.env.LLM_BASE_URL?.trim() || undefined;
  const proxyToken = process.env.API_PROXY_TOKEN?.trim() || undefined;
  const usingProxy = !!(baseUrl && proxyToken);
  const apiKey = usingProxy ? proxyToken! : process.env.LLM_API_KEY;

  log(`[stream] provider=${provider}, model=${model}, base=${baseUrl ?? "(direto)"}, msgs=${messages.length}`);

  if (!apiKey) {
    throw new Error(
      baseUrl
        ? "API_PROXY_TOKEN não configurado (modo proxy via LLM_BASE_URL)"
        : "LLM_API_KEY não configurada no .env",
    );
  }

  // Anthropic ainda não streama de verdade nesta camada: gera tudo e emite de uma vez.
  // (Prod usa OpenAI/proxy; este ramo é rede de segurança.)
  if (provider === "anthropic") {
    const full = await callAnthropic(messages, { ...opts, model, apiKey, baseUrl });
    opts.onRawDelta?.(full);
    return full;
  }

  if (provider !== "openai") {
    throw new Error(`Provider desconhecido: ${provider}. Use "openai" ou "anthropic".`);
  }

  const fallbackKey = usingProxy ? process.env.LLM_FALLBACK?.trim() || undefined : undefined;
  const t = streamTimeouts();

  try {
    return await callOpenAIStream(messages, {
      ...opts,
      model,
      apiKey,
      baseUrl,
      firstContentMs: t.firstContentProxyMs,
      gapMs: t.gapMs,
      gatewayRetries: fallbackKey ? 0 : 2,
      onRawDelta: opts.onRawDelta,
    });
  } catch (proxyErr) {
    if (!fallbackKey) throw proxyErr;
    const fallbackModel = process.env.LLM_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
    const reason = proxyErr instanceof Error ? proxyErr.message.slice(0, 100) : String(proxyErr);
    errLog(`[stream] Proxy falhou/demorou (${reason}) — fallback p/ OpenAI direto, modelo=${fallbackModel}`);
    return await callOpenAIStream(messages, {
      ...opts,
      model: fallbackModel,
      apiKey: fallbackKey,
      baseUrl: undefined,
      firstContentMs: t.firstContentFallbackMs,
      gapMs: t.gapMs,
      gatewayRetries: 2,
      onRawDelta: opts.onRawDelta,
    });
  }
}

// Cache de parâmetros que cada modelo rejeita (ex: gpt-5.5 não aceita temperature).
// Evita pagar um round-trip 400 em TODA chamada — só a primeira "aprende".
const unsupportedByModel = new Map<string, Set<string>>();

async function callOpenAI(
  messages: LLMMessage[],
  opts: {
    model: string;
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    baseUrl?: string;
    // Timeout por tentativa (AbortController). Ausente = sem timeout.
    timeoutMs?: number;
    // Quantas vezes retentar em erro de gateway/rede/timeout (com backoff de 2s).
    // 0 = falha rápido na 1ª (usado quando há fallback a jusante). Default 2.
    gatewayRetries?: number;
    reasoningEffort?: string;
  },
): Promise<string> {
  // Endpoint: proxy (LLM_BASE_URL) ou OpenAI direto. Aceita base com ou sem barra final.
  const endpoint = `${(opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  // Modelos novos (gpt-5+) usam max_completion_tokens em vez de max_tokens.
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_completion_tokens: opts.maxTokens ?? 2048,
  };

  // OPT-IN: só injeta `reasoning_effort` quando o chamador o passou. Ausente = body
  // idêntico ao de sempre. Quem seta (orchestrator) já filtrou por `sanitizeEffort`.
  if (opts.reasoningEffort) {
    body.reasoning_effort = opts.reasoningEffort;
  }

  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  // Remove de cara os parâmetros que já sabemos que este modelo rejeita.
  const known = unsupportedByModel.get(opts.model);
  if (known) for (const p of known) delete body[p];

  // Tenta a chamada; se o modelo rejeitar um parâmetro (não suportado ou valor
  // inválido), remove-o, memoriza e tenta de novo NA HORA (não conta como retry de
  // gateway — é ajuste instantâneo). Erros de gateway transitórios (502/503/520/522/
  // 524), falha de rede e TIMEOUT (proxy pendurado > timeoutMs) entram no backoff de
  // 2s e consomem uma das `gatewayRetries`. Esgotadas, propaga o erro (→ fallback).
  const isGatewayError = (status: number) =>
    status === 502 || status === 503 || status === 520 || status === 522 || status === 524;

  let gatewayRetriesLeft = opts.gatewayRetries ?? 2;
  let lastErr: Error | null = null;

  while (true) {
    let res: Response;
    try {
      // Timeout por tentativa: aborta o fetch se o proxy não responder a tempo.
      const controller = new AbortController();
      const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (netErr) {
      // Falha de REDE ou TIMEOUT (AbortError): conexão caiu/reset/DNS, ou o proxy
      // demorou demais e abortamos. É transitório → backoff e retenta enquanto houver
      // gatewayRetries; senão propaga (cai no fallback direto, se configurado).
      const aborted = netErr instanceof Error && netErr.name === "AbortError";
      lastErr = aborted
        ? new Error(`timeout após ${opts.timeoutMs}ms (proxy não respondeu)`)
        : netErr instanceof Error
          ? netErr
          : new Error(String(netErr));
      errLog(
        `Falha de ${aborted ? "TIMEOUT" : "rede"} na chamada OpenAI: ${lastErr.message.slice(0, 80)}`,
      );
      if (gatewayRetriesLeft <= 0) throw lastErr;
      gatewayRetriesLeft--;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as { choices: { message: { content: string } }[] };
      const content = data.choices[0].message.content;
      log(`OpenAI respondeu: ${content.slice(0, 120)}${content.length > 120 ? "..." : ""}`);
      return content;
    }

    const errText = await res.text();
    const dropped = res.status === 400 ? dropUnsupportedParam(body, errText) : null;
    if (dropped) {
      // Memoriza para não repetir o erro nas próximas chamadas deste modelo. Retry
      // imediato (sem backoff, sem consumir gatewayRetries) — é ajuste de parâmetro.
      const set = unsupportedByModel.get(opts.model) ?? new Set<string>();
      set.add(dropped);
      unsupportedByModel.set(opts.model, set);
      log(
        `Parâmetro '${dropped}' não suportado por ${opts.model} — removido (memorizado p/ próximas)`,
      );
      continue;
    }

    errLog(`OpenAI HTTP ${res.status}:`, errText);
    // Resposta HTML (ex: página de erro do Cloudflare 520/522) — não expõe o HTML.
    const errSummary = errText.trimStart().startsWith("<")
      ? `gateway indisponível (HTTP ${res.status}) — tente novamente em instantes`
      : errText;
    lastErr = new Error(`OpenAI error ${res.status}: ${errSummary}`);

    if (!isGatewayError(res.status)) throw lastErr; // erro definitivo, não retenta
    if (gatewayRetriesLeft <= 0) throw lastErr; // esgotou os retries → propaga (fallback)
    gatewayRetriesLeft--;
    log(`Erro de gateway (HTTP ${res.status}) — retry após 2s (${gatewayRetriesLeft} restantes)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Versão STREAMING de callOpenAI. Mesma estrutura de retry/gateway/param-drop, mas em vez
// de `await res.json()` consome a SSE da OpenAI e acumula `choices[0].delta.content`,
// chamando onRawDelta a cada pedaço. Timeout por STALL, em DUAS FASES (não por tempo total):
//   - PRIMEIRO CONTEÚDO: aborta se o 1º delta de CONTEÚDO não chegar em firstContentMs.
//     Cobre headers + o "raciocínio" do modelo antes do 1º token. ⚠️ Chunks sem conteúdo
//     (role/keepalive) NÃO resetam esse relógio nem armam o GAP — o modelo pesado do Codex
//     pensa >25s antes do 1º token e não pode ser cortado por um gap de 25s.
//   - GAP: só DEPOIS do 1º conteúdo — aborta se passar gapMs SEM chunk. Resetado a cada chunk.
// ⚠️ Anti-prosa-dupla: uma vez emitido qualquer conteúdo, uma falha/stall NÃO propaga como
// erro (não cairia no fallback) — resolvemos com o que já veio. Só falha ANTES do 1º
// conteúdo (primeiro-conteúdo, gateway 5xx, rede) propaga → retry/fallback.
async function callOpenAIStream(
  messages: LLMMessage[],
  opts: {
    model: string;
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
    baseUrl?: string;
    firstContentMs: number;
    gapMs: number;
    gatewayRetries?: number;
    onRawDelta?: (chunk: string) => void;
    reasoningEffort?: string;
  },
): Promise<string> {
  const endpoint = `${(opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_completion_tokens: opts.maxTokens ?? 2048,
    stream: true,
  };

  // OPT-IN: idem ao caminho não-streaming (ver callOpenAI). Ausente = body de sempre.
  if (opts.reasoningEffort) {
    body.reasoning_effort = opts.reasoningEffort;
  }

  const known = unsupportedByModel.get(opts.model);
  if (known) for (const p of known) delete body[p];

  const isGatewayError = (status: number) =>
    status === 502 || status === 503 || status === 520 || status === 522 || status === 524;

  let gatewayRetriesLeft = opts.gatewayRetries ?? 2;
  let lastErr: Error | null = null;

  while (true) {
    // Estado do stall por tentativa. `emitted` marca que já mandamos conteúdo ao cliente.
    let emitted = false;
    let full = "";
    const controller = new AbortController();
    // stallKind distingue "first_content" (nada de conteúdo chegou → erro/fallback) de "gap"
    // (conteúdo fluiu e travou → encerra com o parcial, sem re-streamar).
    let stallKind: "first_content" | "gap" | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const armFirstContent = () => {
      timer = setTimeout(() => {
        stallKind = "first_content";
        controller.abort();
      }, opts.firstContentMs);
    };
    const armGap = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        stallKind = "gap";
        controller.abort();
      }, opts.gapMs);
    };
    const disarm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    let res: Response;
    try {
      armFirstContent();
      res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (netErr) {
      disarm();
      const aborted = netErr instanceof Error && netErr.name === "AbortError";
      lastErr = aborted
        ? new Error(`timeout de ${opts.firstContentMs}ms sem primeiro conteúdo (proxy não respondeu)`)
        : netErr instanceof Error
          ? netErr
          : new Error(String(netErr));
      errLog(`[stream] Falha de ${aborted ? "PRIMEIRO CONTEÚDO" : "rede"}: ${lastErr.message.slice(0, 80)}`);
      if (gatewayRetriesLeft <= 0) throw lastErr;
      gatewayRetriesLeft--;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (!res.ok) {
      disarm();
      const errText = await res.text();
      const dropped = res.status === 400 ? dropUnsupportedParam(body, errText) : null;
      if (dropped) {
        const set = unsupportedByModel.get(opts.model) ?? new Set<string>();
        set.add(dropped);
        unsupportedByModel.set(opts.model, set);
        log(`[stream] Parâmetro '${dropped}' não suportado por ${opts.model} — removido`);
        continue;
      }
      errLog(`[stream] OpenAI HTTP ${res.status}:`, errText.slice(0, 200));
      const errSummary = errText.trimStart().startsWith("<")
        ? `gateway indisponível (HTTP ${res.status}) — tente novamente em instantes`
        : errText;
      lastErr = new Error(`OpenAI error ${res.status}: ${errSummary}`);
      if (!isGatewayError(res.status)) throw lastErr;
      if (gatewayRetriesLeft <= 0) throw lastErr;
      gatewayRetriesLeft--;
      log(`[stream] Erro de gateway (HTTP ${res.status}) — retry após 2s (${gatewayRetriesLeft} restantes)`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (!res.body) {
      disarm();
      lastErr = new Error("resposta de streaming sem corpo");
      if (gatewayRetriesLeft <= 0) throw lastErr;
      gatewayRetriesLeft--;
      continue;
    }

    // Corpo OK: consome a SSE. A partir daqui, uma vez `emitted`, nunca propagamos erro.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSSE(sseBuffer);
        sseBuffer = rest;
        for (const ev of events) {
          const piece = parseOpenAIDelta(ev);
          if (piece) {
            full += piece;
            emitted = true;
            try {
              opts.onRawDelta?.(piece);
            } catch (cbErr) {
              errLog(`[stream] onRawDelta lançou (ignorado): ${(cbErr as Error).message?.slice(0, 60)}`);
            }
          }
        }
        // Relógios em DUAS fases: ATÉ o 1º conteúdo vale o relógio de PRIMEIRO CONTEÚDO
        // (armado antes do fetch) — chunks sem conteúdo (role/keepalive) NÃO o resetam nem
        // armam o GAP. DEPOIS do 1º conteúdo, qualquer chunk reseta o GAP (silêncio
        // prolongado = estol real do proxy no meio da geração).
        if (emitted) armGap();
      }
      disarm();
      return full;
    } catch (streamErr) {
      disarm();
      // Já emitimos algo? Então o stream estava vivo — encerra com o parcial (a rede de
      // retry do orchestrator lida com JSON truncado). NÃO re-streama.
      if (emitted) {
        const why = stallKind === "gap" ? `gap > ${opts.gapMs}ms` : (streamErr as Error).message?.slice(0, 60);
        errLog(`[stream] stream interrompido após emitir conteúdo (${why}) — devolvendo parcial`);
        return full;
      }
      // Nada emitido: trata como falha limpa → retry/fallback. (A abort aqui é o relógio
      // de PRIMEIRO CONTEÚDO estourando — o GAP nunca é armado antes do 1º conteúdo.)
      const aborted = streamErr instanceof Error && streamErr.name === "AbortError";
      lastErr = aborted
        ? new Error(`stream estolou antes do 1º conteúdo (${stallKind ?? "abort"})`)
        : streamErr instanceof Error
          ? streamErr
          : new Error(String(streamErr));
      errLog(`[stream] Falha antes do 1º conteúdo: ${lastErr.message.slice(0, 80)}`);
      if (gatewayRetriesLeft <= 0) throw lastErr;
      gatewayRetriesLeft--;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
  }
}

// Divide o buffer SSE acumulado em eventos completos (separados por "\n\n"), devolvendo o
// resto ainda incompleto. Não perde bytes entre reads.
export function splitSSE(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts, rest };
}

// De um evento SSE ("data: {...}" possivelmente multi-linha) extrai o texto do delta da
// OpenAI (`choices[0].delta.content`). Ignora "[DONE]" e chunks sem conteúdo (ex: o chunk
// de role, ou o de usage, que aliás o proxy nem manda). Devolve "" se não houver texto.
export function parseOpenAIDelta(event: string): string {
  let out = "";
  for (const line of event.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const j = JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] };
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === "string") out += d;
    } catch {
      // chunk parcial/ruído — ignora (o buffer só entrega eventos completos, mas seja tolerante)
    }
  }
  return out;
}

// Extrai INCREMENTALMENTE o valor DECODIFICADO de um campo string de TOPO de um JSON que
// ainda está chegando. Ex.: de `{"type":"preview","content":"Olá\nmun` com field="content"
// devolve `Olá\nmun`. Devolve null se o campo ainda não começou. Tolera truncamento no meio
// da string ou de um escape. Não valida o JSON inteiro — é para uso em streaming.
export function extractPartialJsonStringField(raw: string, field: string): string | null {
  const keyPattern = new RegExp(`"${field}"\\s*:\\s*"`);
  const m = keyPattern.exec(raw);
  if (!m) return null;
  let i = m.index + m[0].length; // 1º caractere DENTRO da string
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) break; // truncado no meio do escape
      if (next === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4) break; // \uXXXX truncado
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) out += String.fromCharCode(code);
        i += 6;
        continue;
      }
      const map: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        b: "\b",
        f: "\f",
        "/": "/",
        '"': '"',
        "\\": "\\",
      };
      out += map[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === '"') break; // fim da string
    out += ch;
    i++;
  }
  return out;
}

/**
 * Se o erro 400 indicar parâmetro ou valor não suportado pelo modelo, remove o
 * parâmetro do body (caindo no default do modelo) e devolve seu nome para retry.
 * Cobre:
 *  - unsupported_parameter: ex. max_tokens não aceito (gpt-5+)
 *  - unsupported_value: ex. temperature só aceita o default (gpt-5.5)
 */
export function dropUnsupportedParam(
  body: Record<string, unknown>,
  errText: string,
): string | null {
  let parsed: { error?: { code?: string; param?: string; message?: string } };
  try {
    parsed = JSON.parse(errText);
  } catch {
    return null;
  }
  const err = parsed.error;
  if (!err) return null;
  const msg = err.message ?? "";
  const isUnsupported =
    err.code === "unsupported_parameter" ||
    err.code === "unsupported_value" ||
    /unsupported (parameter|value)/i.test(msg) ||
    /only the default .* (value )?is supported/i.test(msg);
  const param = err.param;
  if (!isUnsupported || !param || !(param in body)) return null;
  delete body[param];
  return param;
}

async function callAnthropic(
  messages: LLMMessage[],
  opts: {
    model: string;
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
    baseUrl?: string;
  },
): Promise<string> {
  const endpoint = `${(opts.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "")}/messages`;
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: chatMessages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
  };

  if (systemMsg) body.system = systemMsg;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { content: { text: string }[] };
  return data.content[0].text;
}
