import { afterEach, describe, expect, it } from 'vitest';
import {
  docMecanicoLLMOpts,
  docCompiladorLLMOpts,
  docCompiladorSubmitLLMOpts,
} from '@/lib/agents/doc-modelo';

// Fatia C — o COMPILADOR da doc deve rodar sempre no modelo escolhido, sem o mini escondido.
// docCompiladorLLMOpts estende docMecanicoLLMOpts com `semFallbackModelo` + timeout FOLGADO +
// retries, MAS só no modo assíncrono (DOC_COMPILE_ASYNC on) — no default fica byte-idêntico.
describe('docCompiladorLLMOpts — preserva o modelo na compilação (só no modo async)', () => {
  afterEach(() => {
    delete process.env.DOC_COMPILE_ASYNC;
    delete process.env.DOC_COMPILE_PRESERVAR_MODELO;
    delete process.env.DOC_COMPILE_TIMEOUT_MS;
    delete process.env.DOC_COMPILE_RETRIES;
    delete process.env.DOC_MECANICO_MODEL;
    delete process.env.DOC_MECANICO_EFFORT;
  });

  it('DOC_COMPILE_ASYNC off (default) → idêntico a docMecanicoLLMOpts (sem semFallbackModelo/timeout)', () => {
    delete process.env.DOC_COMPILE_ASYNC;
    const opts = docCompiladorLLMOpts();
    expect(opts).toEqual(docMecanicoLLMOpts()); // {} quando nada configurado
    expect('semFallbackModelo' in opts).toBe(false);
    expect('timeoutMs' in opts).toBe(false);
  });

  it('DOC_COMPILE_ASYNC=1 → adiciona semFallbackModelo + timeout folgado (180000) + retries (3)', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    const opts = docCompiladorLLMOpts();
    expect(opts.semFallbackModelo).toBe(true);
    expect(opts.timeoutMs).toBe(180000);
    expect(opts.retriesModelo).toBe(3);
  });

  it('DOC_COMPILE_ASYNC=1 + PRESERVAR_MODELO=0 (kill-switch) → volta ao comportamento de hoje', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    process.env.DOC_COMPILE_PRESERVAR_MODELO = '0';
    const opts = docCompiladorLLMOpts();
    expect('semFallbackModelo' in opts).toBe(false);
    expect(opts).toEqual(docMecanicoLLMOpts());
  });

  it('respeita DOC_COMPILE_TIMEOUT_MS/RETRIES quando setados', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    process.env.DOC_COMPILE_TIMEOUT_MS = '90000';
    process.env.DOC_COMPILE_RETRIES = '5';
    const opts = docCompiladorLLMOpts();
    expect(opts.timeoutMs).toBe(90000);
    expect(opts.retriesModelo).toBe(5);
    expect(opts.semFallbackModelo).toBe(true);
  });

  it('combina com o modelo escolhido (DOC_MECANICO_MODEL=luna)', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    process.env.DOC_MECANICO_MODEL = 'luna';
    const opts = docCompiladorLLMOpts();
    expect(opts.model).toBe('luna');
    expect(opts.semFallbackModelo).toBe(true);
  });
});

describe('docCompiladorSubmitLLMOpts — perfil FAIL-FAST do submit (não pendura o clique)', () => {
  afterEach(() => {
    delete process.env.DOC_COMPILE_ASYNC;
    delete process.env.DOC_COMPILE_PRESERVAR_MODELO;
    delete process.env.DOC_COMPILE_SUBMIT_TIMEOUT_MS;
    delete process.env.DOC_MECANICO_MODEL;
  });

  it('DOC_COMPILE_ASYNC off → idêntico a docMecanicoLLMOpts (comportamento de hoje)', () => {
    expect(docCompiladorSubmitLLMOpts()).toEqual(docMecanicoLLMOpts());
  });

  it('DOC_COMPILE_ASYNC=1 → semFallbackModelo + retriesModelo=0 (SEM retries) + timeout 120s', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    const opts = docCompiladorSubmitLLMOpts();
    expect(opts.semFallbackModelo).toBe(true);
    expect(opts.retriesModelo).toBe(0); // fail-fast: 1 tentativa só, sem multiplicar o timeout
    expect(opts.timeoutMs).toBe(120000);
  });

  it('nunca herda os retries do perfil folgado (submit ≠ background)', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    process.env.DOC_COMPILE_RETRIES = '3';
    expect(docCompiladorSubmitLLMOpts().retriesModelo).toBe(0);
    expect(docCompiladorLLMOpts().retriesModelo).toBe(3);
  });

  it('respeita DOC_COMPILE_SUBMIT_TIMEOUT_MS e o kill-switch', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    process.env.DOC_COMPILE_SUBMIT_TIMEOUT_MS = '45000';
    expect(docCompiladorSubmitLLMOpts().timeoutMs).toBe(45000);
    process.env.DOC_COMPILE_PRESERVAR_MODELO = '0';
    expect('semFallbackModelo' in docCompiladorSubmitLLMOpts()).toBe(false);
  });
});
