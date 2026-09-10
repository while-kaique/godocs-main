/**
 * A CATEGORIA DE GANHO diz qual campo é exigível, e o dossiê tem de DECLARAR isso.
 *
 * Dois achados do dono do produto no mesmo turno (10/09/2026), os dois medidos nos pareceres reais
 * do recorte pré-aprovado em prod:
 *   • *"a duvida do agente financeiro é sobre o valor 40 vs 80. Sendo que nao sao valores errados,
 *     um é bruto e o outro é liquido. Os dois estao certos"* — **2 dos 4** pareceres de "divergência
 *     de valor" eram exatamente o fator 2 do peso das horas (33,10 × 16,55 · 96,52 × 193,03);
 *   • **13 dos 24** pareceres reprovariam por "faltam as horas mensais e o número de pessoas", e
 *     **8 desses** são de projeto com `Ganho imensurável` DECLARADO — onde o formulário não pede
 *     horas. Os outros 5 declaram `Custo evitado` com as horas já preenchidas (78h, 29h, 20h, 6h).
 *
 * Ou seja: o agente não errava de raciocínio, lia um dossiê que cobrava o impossível.
 */
import { describe, it, expect } from 'vitest';
import { linhaDoQueSeCobra, linhaImpactoBrutoLiquido } from '@/lib/avaliacao/dossie';

const fin = (o: Partial<{ saving_horas: number | null; custo_evitado_reais: number | null; receita_mensal: number | null }> = {}) => ({
  saving_horas: null,
  custo_evitado_reais: null,
  receita_mensal: null,
  ...o,
});

describe('linhaDoQueSeCobra', () => {
  it('⚠️ ganho imensurável PROÍBE cobrar horas e valor', () => {
    const t = linhaDoQueSeCobra(['Ganho imensurável'], fin());
    expect(t).toMatch(/NÃO pede horas nem valor/);
    expect(t).toMatch(/NÃO peça horas mensais/);
    expect(t).toMatch(/ausência dos dois é a resposta certa/);
  });

  it('custo evitado manda conferir as horas liberadas antes de dizer que faltam', () => {
    const t = linhaDoQueSeCobra(['Custo evitado'], fin({ saving_horas: 78 }));
    expect(t).toMatch(/nunca nasceu/i);
    expect(t).toMatch(/78 h/);
    expect(t).toMatch(/NÃO se cobra extrato/);
  });

  it('imensurável COM outra categoria não proíbe tudo, mas avisa da parte sem número', () => {
    const t = linhaDoQueSeCobra(['Custo evitado', 'Ganho imensurável'], fin({ saving_horas: 29 }));
    expect(t).not.toMatch(/NÃO peça horas mensais/);
    expect(t).toMatch(/parte IMENSURÁVEL/);
  });

  it('saving efetivado e receita têm exigência PRÓPRIA, e não a do vizinho', () => {
    expect(linhaDoQueSeCobra(['Saving efetivado'], fin())).toMatch(/existia e parou/);
    expect(linhaDoQueSeCobra(['Receita incremental'], fin())).toMatch(/base do número/);
  });

  it('sem categoria declarada não inventa exigência', () => {
    expect(linhaDoQueSeCobra([], fin())).toBe('');
  });
});

describe('linhaImpactoBrutoLiquido', () => {
  it('⚠️ diz que os DOIS estão certos e qual vale', () => {
    const t = linhaImpactoBrutoLiquido(80.85, 40.43);
    expect(t).toMatch(/os dois estão CORRETOS/);
    expect(t).toMatch(/NÃO é contradição/);
    expect(t).toMatch(/LÍQUIDO MENSAL/);
    // ⚠️ o número sai no MESMO `fmt` do resto do dossiê (ponto decimal, sem milhar): campo igual
    // com formatação diferente é ruído que o agente pode ler como duas grandezas.
    expect(t).toMatch(/80\.85/);
    expect(t).toMatch(/40\.43/);
  });

  it('sem nenhum dos dois, não desenha a linha', () => {
    expect(linhaImpactoBrutoLiquido(null, null)).toBeNull();
  });
});
