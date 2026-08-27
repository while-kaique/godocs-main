import { afterEach, describe, expect, it } from 'vitest';
import { docMecanicoLLMOpts } from '@/lib/agents/doc-modelo';

// Frente 1 — roteamento de modelo leve para a doc MECÂNICA (opt-in, envs LAZY).
describe('docMecanicoLLMOpts — roteamento opt-in do modelo da doc', () => {
  afterEach(() => {
    delete process.env.DOC_MECANICO_MODEL;
    delete process.env.DOC_MECANICO_EFFORT;
  });

  it('sem envs → objeto vazio (comportamento idêntico ao de hoje)', () => {
    delete process.env.DOC_MECANICO_MODEL;
    delete process.env.DOC_MECANICO_EFFORT;
    expect(docMecanicoLLMOpts()).toEqual({});
  });

  it('envs vazias (string vazia) → objeto vazio', () => {
    process.env.DOC_MECANICO_MODEL = '';
    process.env.DOC_MECANICO_EFFORT = '';
    expect(docMecanicoLLMOpts()).toEqual({});
  });

  it('DOC_MECANICO_MODEL definido → inclui model', () => {
    process.env.DOC_MECANICO_MODEL = 'gpt-5.6-luna';
    expect(docMecanicoLLMOpts().model).toBe('gpt-5.6-luna');
  });

  it('DOC_MECANICO_EFFORT=low → inclui reasoningEffort', () => {
    process.env.DOC_MECANICO_EFFORT = 'low';
    expect(docMecanicoLLMOpts().reasoningEffort).toBe('low');
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
    'DOC_MECANICO_EFFORT=%s é aceito na allowlist',
    (effort) => {
      process.env.DOC_MECANICO_EFFORT = effort;
      expect(docMecanicoLLMOpts().reasoningEffort).toBe(effort);
    },
  );

  it('DOC_MECANICO_EFFORT=minimal → reasoningEffort OMITIDO (minimal derruba o gateway)', () => {
    process.env.DOC_MECANICO_EFFORT = 'minimal';
    const opts = docMecanicoLLMOpts();
    expect('reasoningEffort' in opts).toBe(false);
  });

  it('DOC_MECANICO_EFFORT desconhecido → reasoningEffort OMITIDO', () => {
    process.env.DOC_MECANICO_EFFORT = 'turbo';
    const opts = docMecanicoLLMOpts();
    expect('reasoningEffort' in opts).toBe(false);
  });

  it('model e effort são independentes — só model', () => {
    process.env.DOC_MECANICO_MODEL = 'gpt-5.6-luna';
    delete process.env.DOC_MECANICO_EFFORT;
    const opts = docMecanicoLLMOpts();
    expect(opts.model).toBe('gpt-5.6-luna');
    expect('reasoningEffort' in opts).toBe(false);
  });

  it('model e effort são independentes — só effort', () => {
    delete process.env.DOC_MECANICO_MODEL;
    process.env.DOC_MECANICO_EFFORT = 'low';
    const opts = docMecanicoLLMOpts();
    expect(opts.reasoningEffort).toBe('low');
    expect('model' in opts).toBe(false);
  });

  it('envs LAZY — muda entre chamadas na mesma execução', () => {
    delete process.env.DOC_MECANICO_MODEL;
    expect(docMecanicoLLMOpts()).toEqual({});
    process.env.DOC_MECANICO_MODEL = 'gpt-5.6-luna';
    expect(docMecanicoLLMOpts().model).toBe('gpt-5.6-luna');
  });
});
