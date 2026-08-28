import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock da camada LLM — sem rede nos testes. `sanitizeEffort` como identidade (padrão do repo).
vi.mock('@/lib/llm', () => ({
  llmChat: vi.fn(),
  sanitizeEffort: (v?: string) => v,
}));

import { llmChat } from '@/lib/llm';
import {
  fallbackDeterministico,
  buildPromptEspecialista,
  normalizarJulgamento,
  type EntradaEspecialista,
  type DimensaoAvaliacao,
} from '@/lib/agents/especialista-avaliacao';
import {
  especialistasMesaLlmLigados,
  julgarComEspecialista,
} from '@/lib/agents/especialista-avaliacao.functions';

const llmChatMock = vi.mocked(llmChat);

// ─── Fixture reutilizável ──────────────────────────────────────────────────────

function entradaFixture(
  dimensao: DimensaoAvaliacao = 'financeiro',
  over: Partial<EntradaEspecialista> = {},
): EntradaEspecialista {
  return {
    dimensao,
    texto: {
      nome: 'Robô de Faturamento',
      area: 'Financeiro',
      descricao: 'Automatiza a emissão de notas.',
      o_que_faz: 'Emite e concilia notas fiscais.',
      memorial: 'Saving de 418h/mês para 2 pessoas.',
      doc: 'Documentação técnica do robô.',
    },
    voto: {
      preocupa: true,
      confianca: 0.3,
      motivo: 'Materialidade de R$ 8.000/mês acima do teto.',
      sinais: ['s1'],
    },
    vizinhos: ['Projeto vizinho A aprovado', 'Projeto vizinho B aprovado'],
    outrosVotos: [
      { dimensao: 'fte', preocupa: true, argumento: 'FTE alto para 2 pessoas.' },
      { dimensao: 'financeiro', preocupa: true, argumento: 'Acima do teto de materialidade.' },
    ],
    ...over,
  };
}

// ─── (1) fallbackDeterministico ────────────────────────────────────────────────

describe('fallbackDeterministico', () => {
  it('espelha o voto determinístico (preocupa/confianca/sinais) e marca origem', () => {
    const entrada = entradaFixture('financeiro');
    const j = fallbackDeterministico(entrada);
    expect(j.dimensao).toBe('financeiro');
    expect(j.preocupa).toBe(true);
    expect(j.confianca).toBe(0.3);
    expect(j.sinais).toEqual(['s1']);
    expect(j.origem).toBe('deterministico');
    expect(j.argumento.length).toBeGreaterThan(0);
    // usa o motivo do voto quando presente
    expect(j.argumento).toContain('Materialidade de R$ 8.000/mês acima do teto.');
  });

  it('com motivo null ainda devolve argumento não-vazio (texto padrão)', () => {
    const entrada = entradaFixture('fte', {
      voto: { preocupa: false, confianca: 0.5, motivo: null, sinais: [] },
    });
    const j = fallbackDeterministico(entrada);
    expect(j.argumento.length).toBeGreaterThan(0);
    expect(j.origem).toBe('deterministico');
  });
});

// ─── (2) normalizarJulgamento — happy path ─────────────────────────────────────

describe('normalizarJulgamento — happy path', () => {
  it('objeto válido vira julgamento origem llm com a dimensão da entrada', () => {
    const entrada = entradaFixture('rag');
    const j = normalizarJulgamento(
      { preocupa: true, argumento: 'parecer do LLM', confianca: 0.7, sinais: ['a', 'b'] },
      entrada,
    );
    expect(j).toEqual({
      dimensao: 'rag',
      preocupa: true,
      argumento: 'parecer do LLM',
      confianca: 0.7,
      sinais: ['a', 'b'],
      origem: 'llm',
    });
  });
});

// ─── (3) normalizarJulgamento — fail-closed ────────────────────────────────────

describe('normalizarJulgamento — fail-closed', () => {
  const entrada = entradaFixture('cetico');
  const fb = fallbackDeterministico(entrada);

  it('null → fallback determinístico', () => {
    expect(normalizarJulgamento(null, entrada)).toEqual(fb);
  });
  it('undefined → fallback determinístico', () => {
    expect(normalizarJulgamento(undefined, entrada)).toEqual(fb);
  });
  it("string '' → fallback determinístico", () => {
    expect(normalizarJulgamento('', entrada)).toEqual(fb);
  });
  it('objeto {} sem campos → fallback determinístico', () => {
    expect(normalizarJulgamento({}, entrada)).toEqual(fb);
  });
  it('objeto sem argumento → fallback determinístico', () => {
    expect(
      normalizarJulgamento({ preocupa: true, confianca: 0.9, sinais: [] }, entrada),
    ).toEqual(fb);
  });
});

// ─── (4) normalizarJulgamento — clampa confiança ───────────────────────────────

describe('normalizarJulgamento — clampa confiança', () => {
  const entrada = entradaFixture('financeiro'); // voto.confianca = 0.3

  it('confianca 1.5 → 1', () => {
    const j = normalizarJulgamento(
      { preocupa: true, argumento: 'x', confianca: 1.5, sinais: [] },
      entrada,
    );
    expect(j.confianca).toBe(1);
  });
  it('confianca -0.4 → 0', () => {
    const j = normalizarJulgamento(
      { preocupa: true, argumento: 'x', confianca: -0.4, sinais: [] },
      entrada,
    );
    expect(j.confianca).toBe(0);
  });
  it("confianca 'abc' → cai no valor do voto determinístico (não NaN)", () => {
    const j = normalizarJulgamento(
      { preocupa: true, argumento: 'x', confianca: 'abc', sinais: [] },
      entrada,
    );
    expect(Number.isNaN(j.confianca)).toBe(false);
    expect(j.confianca).toBe(0.3);
  });
  it('confianca NaN → cai no valor do voto determinístico (não NaN)', () => {
    const j = normalizarJulgamento(
      { preocupa: true, argumento: 'x', confianca: NaN, sinais: [] },
      entrada,
    );
    expect(Number.isNaN(j.confianca)).toBe(false);
    expect(j.confianca).toBe(0.3);
  });
});

// ─── (5) buildPromptEspecialista ───────────────────────────────────────────────

describe('buildPromptEspecialista', () => {
  it('cético: inclui nome do projeto, motivo do voto e marca adversarial de refutar', () => {
    const entrada = entradaFixture('cetico');
    const prompt = buildPromptEspecialista(entrada);
    const texto = prompt.map((m) => m.content).join(' ');
    expect(texto).toContain('Robô de Faturamento');
    expect(texto).toContain('Materialidade de R$ 8.000/mês acima do teto.');
    // persona do cético = DERRUBAR/refutar uma aprovação
    expect(texto.toLowerCase()).toMatch(/refut|derrub|contra|advers|cétic|cetic/);
  });

  it('financeiro: inclui o texto do projeto e o voto', () => {
    const entrada = entradaFixture('financeiro');
    const prompt = buildPromptEspecialista(entrada);
    const texto = prompt.map((m) => m.content).join(' ');
    expect(texto).toContain('Robô de Faturamento');
    expect(texto).toContain('Materialidade de R$ 8.000/mês acima do teto.');
  });
});

// ─── (6/7) julgarComEspecialista ───────────────────────────────────────────────

describe('julgarComEspecialista', () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it('LLM ok: parseia o JSON e devolve origem llm', async () => {
    llmChatMock.mockResolvedValue(
      JSON.stringify({ preocupa: false, argumento: 'ok raciocinado', confianca: 0.8, sinais: [] }),
    );
    const entrada = entradaFixture('financeiro');
    const j = await julgarComEspecialista(entrada);
    expect(j.origem).toBe('llm');
    expect(j.argumento).toBe('ok raciocinado');
    expect(j.preocupa).toBe(false);
    expect(j.confianca).toBe(0.8);
  });

  it('LLM rejeita (timeout): não lança e cai no fallback determinístico', async () => {
    llmChatMock.mockRejectedValue(new Error('timeout'));
    const entrada = entradaFixture('rag');
    const j = await julgarComEspecialista(entrada);
    expect(j).toEqual(fallbackDeterministico(entrada));
    expect(j.origem).toBe('deterministico');
  });

  it('LLM devolve lixo não-json: cai no fallback determinístico', async () => {
    llmChatMock.mockResolvedValue('lixo não-json');
    const entrada = entradaFixture('cetico');
    const j = await julgarComEspecialista(entrada);
    expect(j).toEqual(fallbackDeterministico(entrada));
    expect(j.origem).toBe('deterministico');
  });
});

// ─── (8) especialistasMesaLlmLigados — env-gate ────────────────────────────────

describe('especialistasMesaLlmLigados', () => {
  const ANTES = process.env.AVALIACAO_MESA_LLM;
  afterEach(() => {
    if (ANTES === undefined) delete process.env.AVALIACAO_MESA_LLM;
    else process.env.AVALIACAO_MESA_LLM = ANTES;
  });

  it('ausente → false', () => {
    delete process.env.AVALIACAO_MESA_LLM;
    expect(especialistasMesaLlmLigados()).toBe(false);
  });
  it("'1' → true", () => {
    process.env.AVALIACAO_MESA_LLM = '1';
    expect(especialistasMesaLlmLigados()).toBe(true);
  });
  it("'true' → true", () => {
    process.env.AVALIACAO_MESA_LLM = 'true';
    expect(especialistasMesaLlmLigados()).toBe(true);
  });
  it("'on' → true", () => {
    process.env.AVALIACAO_MESA_LLM = 'on';
    expect(especialistasMesaLlmLigados()).toBe(true);
  });
  it("'sim' → true", () => {
    process.env.AVALIACAO_MESA_LLM = 'sim';
    expect(especialistasMesaLlmLigados()).toBe(true);
  });
  it("'0' → false", () => {
    process.env.AVALIACAO_MESA_LLM = '0';
    expect(especialistasMesaLlmLigados()).toBe(false);
  });
  it("'off' → false", () => {
    process.env.AVALIACAO_MESA_LLM = 'off';
    expect(especialistasMesaLlmLigados()).toBe(false);
  });
});
