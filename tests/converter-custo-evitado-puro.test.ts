// Conversão para CUSTO EVITADO PURO — remove as horas do estado de saving.
//
// Origem (Portal de Reembolsos / Gobeaute, 25/08/2026): a submissão declarou 271h/mês
// de agentes de CX E o contrato da terceirizada que pagava justamente essas horas —
// R$ 3.777,74 + R$ 8.844 = R$ 12.621,74, o mesmo dinheiro contado dos dois lados. A
// triagem corrigiu a planilha à mão, mas o `reconciliar-financeiro` não conseguia
// alinhar o banco: ele recalcula o total a partir das `linhas`, que continuavam lá.
import { describe, it, expect } from 'vitest';
import { converterSavingParaCustoEvitado } from '@/lib/converter-custo-evitado-puro';
import { savingVazio } from '@/lib/agents/types';
import type { SavingColetado } from '@/lib/agents/types';

// Estado como estava no banco do caso de origem.
function savingDoPortalDeReembolsos(): SavingColetado {
  return {
    ...savingVazio(),
    tipo_saving: 'mensal',
    linhas: [
      {
        cargo: 'Assistente',
        horas_antes: 271,
        horas_depois: 0,
        valor_hora: 13.94,
        economia_horas_mes: 271,
        economia_reais_mes: 3777.74,
      },
    ],
    economia_horas_mes: 271,
    economia_reais_mes: 12621.74,
    custo_evitado_reais: 8844,
    custo_evitado_tipo: 'mensal',
    horas_carga_real: 271,
    horas_escala: 0,
  };
}

describe('converterSavingParaCustoEvitado', () => {
  it('remove as horas e deixa o ganho 100% no custo evitado', () => {
    const novo = converterSavingParaCustoEvitado(savingDoPortalDeReembolsos());
    expect(novo.linhas).toEqual([]);
    expect(novo.economia_horas_mes).toBe(0);
    // R$ 3.777,74 de horas somem; sobra o contrato eliminado.
    expect(novo.economia_reais_mes).toBeCloseTo(8844, 2);
    expect(novo.custo_evitado_reais).toBe(8844);
  });

  it('zera o split carga real × escala (não tem referente sem horas)', () => {
    const novo = converterSavingParaCustoEvitado(savingDoPortalDeReembolsos());
    expect(novo.horas_carga_real).toBeNull();
    expect(novo.horas_escala).toBeNull();
  });

  it('abate o custo externo e o custo do projeto do líquido', () => {
    const saving = { ...savingDoPortalDeReembolsos(), custo_projeto_reais: 1000 };
    const novo = converterSavingParaCustoEvitado(saving, 344);
    // 8844 − 344 (externo) − 1000 (custo do projeto)
    expect(novo.economia_reais_mes).toBeCloseTo(7500, 2);
    expect(novo.custo_externo_mensal).toBe(344);
  });

  it('é idempotente — converter de novo não muda nada', () => {
    const uma = converterSavingParaCustoEvitado(savingDoPortalDeReembolsos());
    const duas = converterSavingParaCustoEvitado(uma);
    expect(duas.economia_reais_mes).toBe(uma.economia_reais_mes);
    expect(duas.economia_horas_mes).toBe(0);
    expect(duas.linhas).toEqual([]);
  });

  it('preserva o resto do estado do saving (tipo, custo evitado, descrição)', () => {
    const antes = savingDoPortalDeReembolsos();
    antes.custo_evitado_descricao = '• Contrato Scooto — R$ 8844,00 (mensal). Duas posições.';
    const novo = converterSavingParaCustoEvitado(antes);
    expect(novo.tipo_saving).toBe('mensal');
    expect(novo.custo_evitado_tipo).toBe('mensal');
    expect(novo.custo_evitado_descricao).toBe(antes.custo_evitado_descricao);
  });

  // ⚠️ A regressão que motivou a rotina: com as `linhas` no lugar, o recálculo
  // normal (o que o reconciliar-financeiro faz) devolve o número velho.
  it('sem a conversão, o total volta a somar horas + contrato', async () => {
    const { recomputarSavingFinanceiro } = await import('@/lib/agents/saving-calc');
    const semConverter = recomputarSavingFinanceiro(savingDoPortalDeReembolsos(), 0);
    expect(semConverter.economia_reais_mes).toBeCloseTo(12621.74, 2);
  });
});
