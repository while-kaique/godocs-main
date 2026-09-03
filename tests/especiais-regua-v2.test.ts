import { describe, it, expect } from 'vitest';
import {
  descreverRegua, rebaixarEscapeSemLastro, guardaChuvaSatisfazGatilho,
  NIVEIS_AGENTE, NIVEIS_ESCAPE, GATILHOS_ESCAPE, MIN_EVIDENCIA, MIN_FEATURES_GUARDA_CHUVA,
} from '@/lib/especiais-regua-v2';

const lastro = { atividade_nova: true, irreversivel: true, evidencia: 'x'.repeat(MIN_EVIDENCIA) };

describe('a régua 0-10 validada em 02/09/2026', () => {
  it('cada nível tem VERBO e critério — nenhum se define pela posição', () => {
    // A régua anterior era circular ("10 = topo absoluto"), e por isso em 734 projetos
    // NUNCA houve um 6★ nem um 9★: não havia como decidir entre 5 e 7 sem impressão.
    for (const n of [...NIVEIS_AGENTE, ...NIVEIS_ESCAPE]) {
      expect(n.verbo).toBeTruthy();
      expect(n.criterio.length).toBeGreaterThan(60);
      expect(n.criterio.toLowerCase()).not.toContain('topo absoluto');
    }
    expect(NIVEIS_AGENTE.map((n) => n.estrela)).toEqual([1, 2, 3, 4, 5]);
    expect(NIVEIS_ESCAPE.map((n) => n.estrela)).toEqual([6, 7, 8, 9, 10]);
  });

  it('o prompt carrega os 2 gatilhos do escape', () => {
    const t = descreverRegua();
    for (const g of GATILHOS_ESCAPE) expect(t).toContain(g);
  });
});

describe('guard do escape — só rebaixa, nunca promove', () => {
  it('escape com os 2 gatilhos e evidência citada PASSA', () => {
    expect(rebaixarEscapeSemLastro(8, lastro).estrela).toBe(8);
  });

  it('faltando um gatilho, a nota é 5 — não 6', () => {
    expect(rebaixarEscapeSemLastro(8, { ...lastro, atividade_nova: false }).estrela).toBe(5);
    expect(rebaixarEscapeSemLastro(8, { ...lastro, irreversivel: false }).estrela).toBe(5);
  });

  it('⚠️ sem evidência CITADA o escape não vale (é o freio do entusiasmo)', () => {
    expect(rebaixarEscapeSemLastro(10, { ...lastro, evidencia: 'é muito importante' }).estrela).toBe(5);
  });

  it('não mexe na faixa do agente', () => {
    expect(rebaixarEscapeSemLastro(4, { atividade_nova: false, irreversivel: false }).estrela).toBe(4);
  });

  it('nunca PROMOVE: lastro perfeito não sobe um 3 para o escape', () => {
    expect(rebaixarEscapeSemLastro(3, lastro).estrela).toBe(3);
  });
});

describe('guarda-chuva (vem da aglutinação)', () => {
  it('2+ features satisfazem o gatilho 1, com evidência verificável na planilha', () => {
    const r = guardaChuvaSatisfazGatilho({ features: ['legado-243', 'legado-244'] });
    expect(r.satisfaz).toBe(true);
    expect(r.evidencia).toContain('legado-243');
  });

  it('⚠️ 1 feature NÃO basta — um filho é um incremento, não um padrão', () => {
    expect(guardaChuvaSatisfazGatilho({ features: ['legado-243'] }).satisfaz).toBe(false);
    expect(MIN_FEATURES_GUARDA_CHUVA).toBe(2);
  });
});
