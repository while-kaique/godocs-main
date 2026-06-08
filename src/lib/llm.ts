// Camada de abstração de LLM — suporta OpenAI e Anthropic via variáveis de ambiente
// Troca de provider: só alterar LLM_PROVIDER no .env
const log = (...args: unknown[]) => console.log('[llm]', ...args);
const errLog = (...args: unknown[]) => console.error('[llm]', ...args);

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LLMOptions = {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
};

export async function llmChat(
  messages: LLMMessage[],
  opts: LLMOptions = {}
): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? 'openai';
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? 'gpt-4.1';

  const keyPreview = apiKey ? `${apiKey.slice(0, 12)}... (${apiKey.length} chars)` : '✗ AUSENTE';
  log(`provider=${provider}, model=${model}, apiKey=${keyPreview}, msgs=${messages.length}`);

  if (!apiKey) throw new Error('LLM_API_KEY não configurada no .env');

  if (provider === 'openai') {
    return callOpenAI(messages, { model, apiKey, ...opts });
  }

  if (provider === 'anthropic') {
    return callAnthropic(messages, { model, apiKey, ...opts });
  }

  throw new Error(`Provider desconhecido: ${provider}. Use "openai" ou "anthropic".`);
}

async function callOpenAI(
  messages: LLMMessage[],
  opts: { model: string; apiKey: string; temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
  };

  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    errLog(`OpenAI HTTP ${res.status}:`, body);
    throw new Error(`OpenAI error ${res.status}: ${body}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const content = data.choices[0].message.content;
  log(`OpenAI respondeu: ${content.slice(0, 120)}${content.length > 120 ? '...' : ''}`);
  return content;
}

async function callAnthropic(
  messages: LLMMessage[],
  opts: { model: string; apiKey: string; temperature?: number; maxTokens?: number }
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === 'system')?.content;
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: chatMessages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
  };

  if (systemMsg) body.system = systemMsg;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err}`);
  }

  const data = await res.json() as { content: { text: string }[] };
  return data.content[0].text;
}
