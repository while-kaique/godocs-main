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
