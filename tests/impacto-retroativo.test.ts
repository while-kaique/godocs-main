import { describe, it, expect } from 'vitest';
import {
  numeroBR,
  interpretarFrequencia,
  converterLinha,
  recalcularLinha,
  resumir,
  COLUNAS_ENTRADA as C,
  COLUNAS_SAIDA as S,
} from '@/lib/impacto-retroativo';

/** Linha mínima: tudo zerado, para cada teste ligar só o bloco que lhe interessa. */
const linha = (over: Record<string, string | number> = {}) => ({
  [C.savingAntes]: 0,
  [C.savingAgora]: 0,
  [C.freqSaving]: '—',
  [C.ceHoras]: 0,
  [C.ceNaoContratado]: 0,
  [C.freqCe]: '—',
  [C.receita]: 0,
  [C.freqReceita]: '—',
  [C.custoRodar]: 0,
  [C.freqCustoRodar]: '—',
  [S.bruto]: 0,
  [S.liquido]: 0,
  [S.liquidoMensal]: 0,
  ...over,
});

describe('numeroBR — a mesma leitura do padronizarLinha', () => {
  it('lê pt-BR, trata "—"/vazio/lixo como 0', () => {
    expect(numeroBR('1.234,56')).toBeCloseTo(1234.56);
    expect(numeroBR('R$ 8.000,00')).toBeCloseTo(8000);
    expect(numeroBR('—')).toBe(0);
    expect(numeroBR('')).toBe(0);
    expect(numeroBR(null)).toBe(0);
    expect(numeroBR(4200)).toBe(4200);
  });
});

describe('interpretarFrequencia', () => {
  it('aceita o vocabulário com acento/caixa livre', () => {
    expect(interpretarFrequencia('Mensal', 100)).toBe('mensal');
    expect(interpretarFrequencia(' PONTUAL ', 100)).toBe('pontual');
    expect(interpretarFrequencia('semestral', 100)).toBe('semestral');
  });

  it('com valor ZERO não olha a célula — bloco vazio é o caso normal, não erro', () => {
    // 537 das 581 linhas têm "—" aqui. Cobrar frequência de bloco zerado recusaria a base.
    expect(interpretarFrequencia('—', 0)).toBe('mensal');
    expect(interpretarFrequencia('Misto', 0)).toBe('mensal');
    expect(interpretarFrequencia(undefined, 0)).toBe('mensal');
  });

  it('com valor e célula irreconhecível devolve null — nunca chuta', () => {
    expect(interpretarFrequencia('Misto', 20800)).toBeNull();
    expect(interpretarFrequencia('—', 54000)).toBeNull();
    expect(interpretarFrequencia('anual', 1000)).toBeNull();
  });
});

describe('converterLinha', () => {
  it('o saving é a DIFERENÇA antes − agora, clampada em 0', () => {
    const r = converterLinha(linha({ [C.savingAntes]: 20000, [C.savingAgora]: 5000, [C.freqSaving]: 'mensal' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ganhos.savingEfetivado?.valor).toBe(15000);
  });

  it('legado (coluna "Agora" vazia) passa intacto: antes − 0 = antes', () => {
    const r = converterLinha(linha({ [C.savingAntes]: 8000, [C.freqSaving]: 'Mensal' }));
    if (r.ok) expect(r.ganhos.savingEfetivado?.valor).toBe(8000);
  });

  it('"agora" maior que "antes" não vira saving NEGATIVO', () => {
    const r = converterLinha(linha({ [C.savingAntes]: 1000, [C.savingAgora]: 4000, [C.freqSaving]: 'mensal' }));
    if (r.ok) expect(r.ganhos.savingEfetivado?.valor).toBe(0);
  });

  it('nomeia a COLUNA e o VALOR quando a frequência não é reconhecível', () => {
    const r = converterLinha(linha({ [C.receita]: 54000, [C.freqReceita]: '—' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain(C.freqReceita);
      expect(r.motivo).toContain('54000');
    }
  });
});

describe('recalcularLinha — os 3 desfechos', () => {
  it('recalculada: aplica os pesos da v2 (custo evitado entra por METADE)', () => {
    const r = recalcularLinha(
      linha({ [C.ceHoras]: 20570.95, [C.freqCe]: 'mensal', [S.bruto]: 20570.95, [S.liquido]: 20570.95 }),
      'legado-221',
    );
    expect(r.ok && r.desfecho).toBe('recalculada');
    if (r.ok) {
      expect(r.depois.bruto).toBeCloseTo(20570.95, 2);
      expect(r.depois.liquido).toBeCloseTo(10285.48, 2);
      expect(r.depois.liquidoMensal).toBeCloseTo(10285.48, 2);
    }
  });

  it('⚠️ PRESERVADA: legado com agregado e SEM componente em R$ não é zerado', () => {
    // As 55 linhas do import que trouxeram as HORAS mas nunca o "Horas em Reais".
    // Recomputar dos componentes daria 0 e apagaria R$ 65 mil de impacto aprovado.
    const r = recalcularLinha(
      linha({ [C.freqCe]: 'mensal', [S.bruto]: 599.42, [S.liquido]: 599.42 }),
      'LEGADO-036',
    );
    expect(r.ok && r.desfecho).toBe('preservada');
    if (r.ok) {
      expect(r.depois.bruto).toBe(599.42);
      expect(r.depois.liquido).toBe(599.42);
      expect(r.depois.liquidoMensal).toBeCloseTo(599.42, 2); // mensal → divisor 1
    }
  });

  it('preservada com processo PONTUAL normaliza no tempo (÷4), sem mexer no líquido', () => {
    const r = recalcularLinha(linha({ [C.freqCe]: 'pontual', [S.bruto]: 4000, [S.liquido]: 4000 }), 'LEGADO-x');
    if (r.ok) {
      expect(r.depois.liquido).toBe(4000);
      expect(r.depois.liquidoMensal).toBe(1000);
    }
  });

  it('linha totalmente vazia (rascunho/sem número) NÃO vira "preservada"', () => {
    const r = recalcularLinha(linha(), 'vazio');
    expect(r.ok && r.desfecho).toBe('recalculada');
    if (r.ok) expect(r.depois.liquidoMensal).toBe(0);
  });

  it('nao_convertida mantém os 3 números que já estavam lá', () => {
    const r = recalcularLinha(
      linha({ [C.receita]: 73000, [C.freqReceita]: '—', [S.bruto]: 73000, [S.liquido]: 7300 }),
      'LEGADO-185',
    );
    expect(r.ok).toBe(false);
    expect(r.antes.liquido).toBe(7300);
  });
});

describe('resumir', () => {
  it('a linha não convertida entra no total DEPOIS com o valor de antes', () => {
    // Somar zero anunciaria uma queda que a gravação não vai executar.
    const naoConvertida = recalcularLinha(
      linha({ [C.receita]: 73000, [C.freqReceita]: '—', [S.liquido]: 7300 }),
      'x',
    );
    const r = resumir([naoConvertida]);
    expect(r.nao_convertidas).toHaveLength(1);
    expect(r.totais.depois.liquido).toBe(7300);
    expect(r.totais.antes.liquido).toBe(7300);
  });

  it('separa recalculadas de preservadas na contagem', () => {
    const a = recalcularLinha(linha({ [C.ceHoras]: 1000, [C.freqCe]: 'mensal' }), 'a');
    const b = recalcularLinha(linha({ [C.freqCe]: 'mensal', [S.liquido]: 500, [S.bruto]: 500 }), 'b');
    const r = resumir([a, b]);
    expect(r.recalculadas).toBe(1);
    expect(r.preservadas).toBe(1);
  });
});
