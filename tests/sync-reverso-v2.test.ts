import { describe, it, expect } from 'vitest';
import {
  lerGanhosV2DaLinha, recalcularImpactos, impactosDaLinha, impactosDivergem,
  categoriasDaCelula, frequenciaDaCelula, numeroDaCelula,
} from '@/lib/google/sync-reverso-v2';

// A linha REAL da «Torre de Controle Supply Gogroup» em 11/09/2026 (só os campos que importam).
const TORRE = {
  'ID Projeto': 'a557f78db43bb57038d6d694038ac029',
  'Tipos de Ganho': 'saving', // vocabulário LEGADO da v1 — não vira categoria
  'Custo Evitado Horas': '451,00',
  'Custo Evitado Horas Reais': '14.928,10',
  'Custo Evitado Não Contratado': '0,00',
  'Freq. Custo Evitado': 'mensal',
  'Racional Custo Evitado': 'Ninguém fazia esta tarefa manualmente',
  'Saving Efetivado': '0,00', 'Saving Efetivado Agora': '0,00', 'Receita Incremental': '0,00',
  'Custo para Rodar': '0,00',
  'Impacto Bruto': '14928,1', 'Impacto Líquido': '7464,05', 'Impacto Líquido Mensal': '7464,05',
};

describe('sync reverso v2 — leitura dos blocos', () => {
  it('parse pt-BR, travessão e R$', () => {
    expect(numeroDaCelula('R$ 1.234,56')).toBe(1234.56);
    expect(numeroDaCelula('—')).toBeNull();
    expect(numeroDaCelula('10.5')).toBe(10.5);
  });

  it('frequência: só as 4 do enum; "mensal + pontual" fica com a primeira; fora do enum → null', () => {
    expect(frequenciaDaCelula('Pontual')).toBe('pontual');
    expect(frequenciaDaCelula('mensal + pontual')).toBe('mensal');
    expect(frequenciaDaCelula('anual')).toBeNull();
    expect(frequenciaDaCelula('—')).toBeNull();
  });

  it('categorias: título dos cards ou chave; token desconhecido invalida a célula (legado "saving" não vira categoria)', () => {
    expect(categoriasDaCelula('Saving efetivado, Custo evitado')).toEqual(['saving_efetivado', 'custo_evitado']);
    expect(categoriasDaCelula('receita_incremental')).toEqual(['receita_incremental']);
    expect(categoriasDaCelula('saving')).toBeNull();
    expect(categoriasDaCelula('saving, Custo evitado')).toBeNull();
  });

  it('Torre de Controle: copia o bloco de custo evitado, infere a categoria pelos números e recalcula igual à planilha', () => {
    const le = lerGanhosV2DaLinha(TORRE, {});
    expect(le.colunas.custo_evitado_frequencia).toBe('mensal');
    expect(le.colunas.custo_evitado_horas_valor).toBe(14928.1);
    expect(le.colunas.ganho_categorias).toBeUndefined(); // "saving" legado não vira categoria gravada
    expect(le.origemCategorias).toBe('inferida');
    const rec = recalcularImpactos(le.ganhos!)!;
    expect(rec).toEqual({ bruto: 14928.1, liquido: 7464.05, liquidoMensal: 7464.05 });
    expect(impactosDivergem(rec, impactosDaLinha(TORRE)!)).toBe(false);
  });

  it('⚠️ mudar a frequência para PONTUAL na planilha move só o Impacto Líquido Mensal (÷4)', () => {
    const le = lerGanhosV2DaLinha({ ...TORRE, 'Freq. Custo Evitado': 'pontual' }, {});
    const rec = recalcularImpactos(le.ganhos!)!;
    expect(rec).toEqual({ bruto: 14928.1, liquido: 7464.05, liquidoMensal: 1866.01 });
    expect(impactosDivergem(rec, impactosDaLinha(TORRE)!)).toBe(true);
  });

  it('divergência de arredondamento (3ª casa da planilha) NÃO conta como divergência', () => {
    expect(impactosDivergem({ bruto: 10963.43, liquido: 5481.72, liquidoMensal: 5481.72 }, { bruto: 10963.43, liquido: 5481.715, liquidoMensal: 5481.715 })).toBe(false);
  });

  it('célula vazia não entra no patch; frequência fora do enum não recalcula e vira aviso', () => {
    const le = lerGanhosV2DaLinha({ ...TORRE, 'Racional Custo Evitado': '—', 'Freq. Custo Evitado': 'anual' }, {});
    expect(le.colunas.custo_evitado_racional).toBeUndefined();
    expect(le.colunas.custo_evitado_frequencia).toBeUndefined();
    expect(le.ganhos).toBeNull();
    expect(le.avisos.join(' ')).toMatch(/fora do enum/);
  });

  it('categoria do BANCO vence a inferência quando a célula é legado', () => {
    const le = lerGanhosV2DaLinha(TORRE, { ganho_categorias: '["custo_evitado","imensuravel"]' });
    expect(le.origemCategorias).toBe('banco');
  });

  it('só imensurável → impacto zero nas 3 contas', () => {
    const le = lerGanhosV2DaLinha({ 'Tipos de Ganho': 'Ganho imensurável', 'Ganho Imensurável': 'organiza a área', 'Impacto Líquido Mensal': '0' }, {});
    expect(recalcularImpactos(le.ganhos!)).toEqual({ bruto: 0, liquido: 0, liquidoMensal: 0 });
    expect(le.colunas.ganho_imensuravel_racional).toBe('organiza a área');
  });

  it('custo para rodar: a planilha só tem o TOTAL — vira UM item só quando o banco não tem nenhum', () => {
    const l = { ...TORRE, 'Custo para Rodar': '120,00', 'Freq. Custo para Rodar': 'mensal', 'Justificativa Custo para Rodar': 'API' };
    const semItens = lerGanhosV2DaLinha(l, {});
    expect(semItens.colunas.custo_rodar_itens).toContain('"valor":120');
    expect(recalcularImpactos(semItens.ganhos!)!.liquidoMensal).toBe(7344.05);
    const comItens = lerGanhosV2DaLinha(l, { custo_rodar_itens: '[{"nome":"OpenAI","valor":50,"frequencia":"mensal","o_que_e":""}]' });
    expect(comItens.colunas.custo_rodar_itens).toBeUndefined();
  });
});
