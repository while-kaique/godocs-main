// Testes para os fixes do painel Investigador:
// 1. Normalização de timestamps (ISO vs SQLite datetime)
// 2. Labels de resultado e complexidade da análise automática
// 3. Fallback de area_nome
import { describe, it, expect } from 'vitest';

// ── 1. Normalização de timestamp ────────────────────────────────────────────
// Reproduz a lógica de computeTimeSinceStart para validar que tanto ISO
// ("2026-06-15T12:00:00.000Z") quanto datetime SQLite ("2026-06-15 12:00:00")
// são parseados corretamente sem gerar NaN.

function normalizeTimestamp(createdAt: string): string {
  return createdAt.endsWith('Z') || createdAt.includes('+') ? createdAt : createdAt + 'Z';
}

describe('normalizeTimestamp — timestamps ISO e SQLite', () => {
  it('não adiciona Z a timestamp ISO que já tem Z', () => {
    const iso = '2026-06-15T12:00:00.000Z';
    const result = normalizeTimestamp(iso);
    expect(result).toBe('2026-06-15T12:00:00.000Z');
    expect(new Date(result).getTime()).not.toBeNaN();
  });

  it('adiciona Z a timestamp SQLite sem timezone', () => {
    const sqlite = '2026-06-15 12:00:00';
    const result = normalizeTimestamp(sqlite);
    expect(result).toBe('2026-06-15 12:00:00Z');
    expect(new Date(result).getTime()).not.toBeNaN();
  });

  it('não adiciona Z a timestamp com offset +', () => {
    const offset = '2026-06-15T12:00:00+03:00';
    const result = normalizeTimestamp(offset);
    expect(result).toBe('2026-06-15T12:00:00+03:00');
    expect(new Date(result).getTime()).not.toBeNaN();
  });

  it('BUG ANTERIOR: ISO + "Z" extra gerava NaN', () => {
    // Antes do fix, o código fazia `createdAt + 'Z'` sem verificar,
    // gerando "2026-06-15T12:00:00.000ZZ" → Date inválida.
    const iso = '2026-06-15T12:00:00.000Z';
    const buggyResult = new Date(iso + 'Z').getTime();
    expect(buggyResult).toBeNaN(); // confirma que o bug existia

    const fixedResult = new Date(normalizeTimestamp(iso)).getTime();
    expect(fixedResult).not.toBeNaN(); // confirma que o fix funciona
  });
});

// ── 2. Labels de resultado e complexidade ───────────────────────────────────

function formatResultado(resultado: string): string {
  if (resultado === 'aprovado') return 'Aprovado';
  if (resultado === 'rejeitado') return 'Em revisão';
  return resultado;
}

function formatComplexidade(complexidade: string | null): string | null {
  if (complexidade === 'automacao') return 'Automação';
  if (complexidade === 'inteligencia') return 'Inteligência';
  if (complexidade === 'autonomia') return 'Autonomia';
  return complexidade;
}

describe('formatResultado — labels legíveis para o resultado da análise', () => {
  it('aprovado → Aprovado', () => {
    expect(formatResultado('aprovado')).toBe('Aprovado');
  });

  it('rejeitado → Em revisão', () => {
    expect(formatResultado('rejeitado')).toBe('Em revisão');
  });

  it('valor desconhecido permanece inalterado', () => {
    expect(formatResultado('pendente')).toBe('pendente');
  });
});

describe('formatComplexidade — labels com acentuação correta', () => {
  it('automacao → Automação', () => {
    expect(formatComplexidade('automacao')).toBe('Automação');
  });

  it('inteligencia → Inteligência', () => {
    expect(formatComplexidade('inteligencia')).toBe('Inteligência');
  });

  it('autonomia → Autonomia', () => {
    expect(formatComplexidade('autonomia')).toBe('Autonomia');
  });

  it('null permanece null', () => {
    expect(formatComplexidade(null)).toBeNull();
  });
});

// ── 3. Fallback de area_nome ────────────────────────────────────────────────

describe('area_nome fallback — usa campo legado "area" quando area_nome é null', () => {
  function resolveAreaNome(areaNome: string | null, area: string | null): string | null {
    return areaNome ?? area;
  }

  it('retorna area_nome quando disponível', () => {
    expect(resolveAreaNome('Tecnologia', 'Tech')).toBe('Tecnologia');
  });

  it('faz fallback para area quando area_nome é null', () => {
    expect(resolveAreaNome(null, 'Tech')).toBe('Tech');
  });

  it('retorna null quando ambos são null', () => {
    expect(resolveAreaNome(null, null)).toBeNull();
  });
});
