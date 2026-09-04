import { describe, it, expect } from 'vitest';
import { ajustarNotaComPainel, AJUSTE_MAX_PAINEL } from '@/lib/especiais-ajuste';
import { TETO_AGENTE } from '@/lib/estrelas-regua';

/**
 * ⚠️ Medido em 03/09/2026: com o painel decidindo sozinho, o PIAPP saiu 2, 5, 3, 7, 8 e 3 em seis
 * chamadas idênticas. As lentes variavam pouco; o resultado é que explodia. Estes testes travam a
 * propriedade que resolve isso: o time AJUSTA a nota do run 1, não a substitui.
 */
describe('ajuste fino da nota do run 1', () => {
  const semPiso = (nota: number) => ({ nota_lentes: nota, piso: null });

  it('nunca move mais que um degrau, por mais longe que as lentes estejam', () => {
    for (let base = 0; base <= TETO_AGENTE; base++) {
      for (let lentes = 0; lentes <= TETO_AGENTE; lentes++) {
        const r = ajustarNotaComPainel(base, semPiso(lentes));
        expect(Math.abs(r.nota - base), `base ${base} lentes ${lentes}`).toBeLessThanOrEqual(AJUSTE_MAX_PAINEL);
      }
    }
  });

  it('move na direção das lentes, e concordância não mexe em nada', () => {
    expect(ajustarNotaComPainel(2, semPiso(5)).nota).toBe(3);
    expect(ajustarNotaComPainel(4, semPiso(0)).nota).toBe(3);
    expect(ajustarNotaComPainel(3, semPiso(3)).nota).toBe(3);
  });

  // A faixa alta é a peça que o run 1 já acerta: exige duas citações e nenhuma lente sozinha
  // responde à pergunta do escape. Nem tira de lá, nem coloca lá.
  it('a faixa 6-10 vem do run 1 e as lentes não a movem', () => {
    for (const base of [6, 7, 8, 9, 10]) {
      expect(ajustarNotaComPainel(base, semPiso(0)).nota).toBe(base);
      expect(ajustarNotaComPainel(base, semPiso(5)).nota).toBe(base);
    }
    // e não empurram uma base de 5 para dentro da faixa
    expect(ajustarNotaComPainel(TETO_AGENTE, semPiso(TETO_AGENTE)).nota).toBe(TETO_AGENTE);
    expect(ajustarNotaComPainel(TETO_AGENTE, semPiso(0)).nota).toBeLessThanOrEqual(TETO_AGENTE);
  });

  // Única exceção ao degrau: o piso não é "um pouco menos", é "não pontua".
  it('piso nomeado zera de qualquer altura, e diz qual foi', () => {
    const r = ajustarNotaComPainel(5, { nota_lentes: 5, piso: 'fora_de_uso' });
    expect(r.nota).toBe(0);
    expect(r.motivo).toContain('fora_de_uso');
  });

  it('o motivo diz quando o ajuste foi LIMITADO, para o relatório não parecer concordância', () => {
    const r = ajustarNotaComPainel(1, semPiso(5));
    expect(r.nota).toBe(2);
    expect(r.motivo).toContain('sustentavam 5');
  });

  it('nunca sai da escala', () => {
    expect(ajustarNotaComPainel(0, semPiso(0)).nota).toBe(0);
    expect(ajustarNotaComPainel(0, semPiso(5)).nota).toBe(1);
  });
});
