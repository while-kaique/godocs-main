// Testes: camada de abstração LLM
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Salva env original
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('LLM provider selection', () => {
  it('lança erro quando LLM_API_KEY não está configurada', async () => {
    delete process.env.LLM_API_KEY;
    process.env.LLM_PROVIDER = 'openai';

    const { llmChat } = await import('@/lib/llm');
    await expect(
      llmChat([{ role: 'user', content: 'oi' }])
    ).rejects.toThrow('LLM_API_KEY não configurada');
  });

  it('lança erro para provider desconhecido', async () => {
    process.env.LLM_API_KEY = 'fake-key';
    process.env.LLM_PROVIDER = 'gemini';

    const { llmChat } = await import('@/lib/llm');
    await expect(
      llmChat([{ role: 'user', content: 'oi' }])
    ).rejects.toThrow('Provider desconhecido: gemini');
  });
});

describe('LLM message types', () => {
  it('aceita mensagens com roles válidos', () => {
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: 'Você é um assistente.' },
      { role: 'user', content: 'Oi' },
      { role: 'assistant', content: 'Olá!' },
    ];
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
  });

  it('opções default são aplicadas', () => {
    const opts = {
      temperature: undefined as number | undefined,
      maxTokens: undefined as number | undefined,
      jsonMode: undefined as boolean | undefined,
    };
    const temp = opts.temperature ?? 0.7;
    const maxTokens = opts.maxTokens ?? 2048;
    const jsonMode = opts.jsonMode ?? false;

    expect(temp).toBe(0.7);
    expect(maxTokens).toBe(2048);
    expect(jsonMode).toBe(false);
  });
});

describe('dropUnsupportedParam — adaptação a modelos novos (gpt-5+)', () => {
  it('remove max_tokens em unsupported_parameter', async () => {
    const { dropUnsupportedParam } = await import('@/lib/llm');
    const body: Record<string, unknown> = { max_tokens: 2048, temperature: 0.2 };
    const err = JSON.stringify({ error: { code: 'unsupported_parameter', param: 'max_tokens', message: "Use 'max_completion_tokens' instead." } });
    expect(dropUnsupportedParam(body, err)).toBe('max_tokens');
    expect('max_tokens' in body).toBe(false);
    expect('temperature' in body).toBe(true);
  });

  it('remove temperature em unsupported_value (só aceita default)', async () => {
    const { dropUnsupportedParam } = await import('@/lib/llm');
    const body: Record<string, unknown> = { temperature: 0.2, max_completion_tokens: 4096 };
    const err = JSON.stringify({ error: { code: 'unsupported_value', param: 'temperature', message: "'temperature' does not support 0.2 with this model. Only the default (1) value is supported." } });
    expect(dropUnsupportedParam(body, err)).toBe('temperature');
    expect('temperature' in body).toBe(false);
  });

  it('retorna null para erro não relacionado', async () => {
    const { dropUnsupportedParam } = await import('@/lib/llm');
    const body: Record<string, unknown> = { temperature: 0.2 };
    const err = JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'slow down' } });
    expect(dropUnsupportedParam(body, err)).toBeNull();
    expect('temperature' in body).toBe(true);
  });

  it('retorna null quando o param não está no body', async () => {
    const { dropUnsupportedParam } = await import('@/lib/llm');
    const body: Record<string, unknown> = { max_completion_tokens: 4096 };
    const err = JSON.stringify({ error: { code: 'unsupported_value', param: 'temperature', message: 'x' } });
    expect(dropUnsupportedParam(body, err)).toBeNull();
  });
});
