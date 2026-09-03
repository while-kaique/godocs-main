import { describe, it, expect } from 'vitest';
import {
  descreverRegua, rebaixarEscapeSemLastro, guardaChuvaSustentaEscape,
  NIVEIS_AGENTE, ESCAPE_CRITERIO, ESCAPE_VERBO, ESCAPE_DECISOR,
  MIN_EVIDENCIA, MIN_FEATURES_GUARDA_CHUVA,
} from '@/lib/especiais-regua-v2';
import * as regua from '@/lib/especiais-regua-v2';

const lastro = { evidencia: 'x'.repeat(MIN_EVIDENCIA) };

describe('a régua 0-10 fechada em 03/09/2026', () => {
  it('a faixa do agente vai de 0 a 5, cada nível com VERBO, critério e EXEMPLOS reais', () => {
    // A régua anterior era circular ("10 = topo absoluto"), e por isso em 734 projetos
    // NUNCA houve um 6★ nem um 9★: não havia como decidir entre 5 e 7 sem impressão.
    expect(NIVEIS_AGENTE.map((n) => n.estrela)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const n of NIVEIS_AGENTE) {
      expect(n.verbo).toBeTruthy();
      expect(n.criterio.length).toBeGreaterThan(60);
      expect(n.criterio.toLowerCase()).not.toContain('topo absoluto');
      // Exemplo real é a âncora que faz o agente RECONHECER o nível em vez de estimá-lo.
      expect(n.exemplos.length).toBeGreaterThan(0);
    }
  });

  it('0★ é um NÍVEL nomeado, não uma lista de derrubadores', () => {
    const zero = NIVEIS_AGENTE[0];
    expect(zero.estrela).toBe(0);
    expect(zero.verbo).toBe('Experimenta');
  });

  it('⚠️ 6-10 é UM critério só — nada de definição por nível', () => {
    // Decisão do Luis (03/09): cinco definições vizinhas viram cinco maneiras de errar,
    // e a distinção entre um 7 e um 8 é COMPARATIVA, não descritiva. Se alguém
    // reintroduzir NIVEIS_ESCAPE, este teste é o que avisa.
    const mod = regua as unknown as Record<string, unknown>;
    expect(mod.NIVEIS_ESCAPE).toBeUndefined();
    expect(mod.GATILHOS_ESCAPE).toBeUndefined();
    expect(ESCAPE_VERBO).toBe('Muda o Jogo');
  });

  it('o prompt carrega o critério do escape E diz que quem fecha a nota é humano', () => {
    const t = descreverRegua();
    expect(t).toContain(ESCAPE_CRITERIO);
    expect(t).toContain(ESCAPE_DECISOR);
    for (const n of NIVEIS_AGENTE) expect(t).toContain(n.verbo);
    // os exemplos precisam chegar ao prompt: são eles que ancoram o nível
    expect(t).toContain('Godash');
    expect(t).toContain('CTR Machine');
  });
});

describe('guard do escape — só rebaixa, nunca promove', () => {
  it('escape com evidência citada PASSA', () => {
    expect(rebaixarEscapeSemLastro(8, lastro).estrela).toBe(8);
  });

  it('⚠️ sem evidência CITADA o escape não vale (é o freio do entusiasmo)', () => {
    expect(rebaixarEscapeSemLastro(10, { evidencia: 'é muito importante' }).estrela).toBe(5);
  });

  it('não mexe na faixa do agente', () => {
    expect(rebaixarEscapeSemLastro(4, { evidencia: null }).estrela).toBe(4);
    expect(rebaixarEscapeSemLastro(0, { evidencia: null }).estrela).toBe(0);
  });

  it('nunca PROMOVE: lastro perfeito não sobe um 3 para o escape', () => {
    expect(rebaixarEscapeSemLastro(3, lastro).estrela).toBe(3);
  });
});

describe('guarda-chuva (vem da aglutinação)', () => {
  it('2+ features dão lastro ao escape, com evidência verificável na planilha', () => {
    const r = guardaChuvaSustentaEscape({ features: ['legado-243', 'legado-244'] });
    expect(r.satisfaz).toBe(true);
    expect(r.evidencia).toContain('legado-243');
  });

  it('⚠️ 1 feature NÃO basta — um filho é um incremento, não um padrão', () => {
    expect(guardaChuvaSustentaEscape({ features: ['legado-243'] }).satisfaz).toBe(false);
    expect(MIN_FEATURES_GUARDA_CHUVA).toBe(2);
  });
});
