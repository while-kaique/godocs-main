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
};

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
