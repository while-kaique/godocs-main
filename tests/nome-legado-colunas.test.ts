import { describe, it, expect } from 'vitest';
import { NOME_LEGADO } from '@/lib/coluna-chave';
import { SHEET_COLUMNS, chavesForaDoCabecalho, resolverColunaLetra } from '@/lib/google/sheets';
import { recortarResumo, mapResumo, COLUNAS_RESUMO } from '@/lib/dashboard-resumo';

/**
 * O cabeçalho REAL da aba `GoDocs` de PRODUÇÃO em 03/09/2026 (56 colunas), lido da planilha —
 * ainda com os nomes da v1. ⚠️ Copiado da leitura, NÃO digitado: a 1ª versão deste fixture foi
 * escrita de memória e errou nos dois sentidos (inventou `URL Godeploy`, esqueceu `ID Pai` e
 * `ID Feature`), o que fez o teste acusar um defeito que não existia.
 * ⚠️ Não "atualize" para os nomes novos: é justamente esta aba não migrada que o alias
 * existe para atender. Quando prod for migrada, este fixture vira o histórico do porquê.
 */
const CABECALHO_PROD_V1 = [
  'Data Submissão', 'ID Projeto', 'Data Criação', 'Área', 'Nome Completo', 'Email', 'Projeto',
  'Participantes', 'Participantes 2', 'Contribuidor', 'Descrição', 'URL', 'Ferramenta',
  'Escopo', 'Tipos Projeto', 'Alguém Fazia?', 'Estrelas', 'Saving Horas', 'Horas em Reais',
  'Custo Evitado', 'Justificativa Custo Evitado', 'Custo Mensal ou Pontual', 'Saving Reais',
  'Tipo de Saving', 'Memorial de Saving', 'Custo Externo Mensal', 'Receita Mensal',
  'Tipo de Receita', 'Receita Memorial', 'Status', 'Aprovação do Líder',
  'Justificativa Aprovação do Lider', 'Ganho Total', 'Complexidade', 'Diff Horas / Antes',
  'Diff Saving / Antes', 'Memorial anterior', 'Observações', 'Contexto do Projeto Especial',
  'Alocação Ganhos', 'Especial?', 'Saving Horas Escalado', 'Saving Horas Real',
  'Justificativa Saving Escalado e Real', 'Custo do Projeto', 'Justificativa Custo do Projeto',
  'Custo do Projeto Mensal ou Pontual', 'Usa AI Proxy', 'Análise Antiagente', 'Motivo Reenvio',
  'Motivo Reprovado', 'Classificação', 'Atualizado Em', 'ID Pai', 'ID Feature',
  'Tipo de Projeto',
  // criada em 03/09/2026, junto com o campo da Etapa 2 que a alimenta
  'URL Godeploy',
];

const mapaDe = (headers: string[]) => ({
  headers,
  letterByName: Object.fromEntries(headers.map((h, i) => [h, String(i)])),
  letterByKey: Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), String(i)])),
});

describe('alias de nome legado — a aba de prod ainda não foi migrada', () => {
  it('⚠️ sem o alias, 22 colunas que o código ESCREVE não existiriam em prod', () => {
    // Sem esta ponte o /dashboard leria `undefined` e mostraria R$ 0 para todo projeto,
    // e o append gravaria a linha sem número nenhum (com um console.warn que ninguém lê).
    // Só sobram as 3 colunas genuinamente NOVAS da v2 — que não devem ter equivalente
    // inventado, e cuja ausência é o próprio discriminador de "esta linha é v1".
    const fora = chavesForaDoCabecalho(
      CABECALHO_PROD_V1,
      Object.fromEntries(SHEET_COLUMNS.map((n) => [n, 'x'])),
    );
    expect(fora.sort()).toEqual(
      ['Custo Evitado Não Contratado', 'Impacto Líquido Mensal', 'Saving Efetivado Agora'].sort(),
    );
  });

  it('resolve o nome novo para a coluna legada', () => {
    const m = mapaDe(CABECALHO_PROD_V1);
    expect(resolverColunaLetra(m, 'Impacto Líquido')).toBe(
      String(CABECALHO_PROD_V1.indexOf('Ganho Total')),
    );
    expect(resolverColunaLetra(m, 'Impacto Bruto')).toBe(
      String(CABECALHO_PROD_V1.indexOf('Saving Reais')),
    );
  });

  it('⚠️ o nome NOVO vence: numa aba migrada o alias nunca é consultado', () => {
    // Com as duas colunas presentes, a escrita tem de cair na NOVA — senão migrar a aba
    // mudaria comportamento, que é o oposto do que este mapa promete.
    const m = mapaDe(['Ganho Total', 'Impacto Líquido']);
    expect(resolverColunaLetra(m, 'Impacto Líquido')).toBe('1');
  });

  it('todo destino do mapa existe no cabeçalho de prod (nenhum alias aponta para o vazio)', () => {
    for (const legado of Object.values(NOME_LEGADO)) {
      expect(CABECALHO_PROD_V1).toContain(legado);
    }
  });
});

describe('leitura: a linha v1 chega ao resumo sob o nome NOVO', () => {
  const linhaV1 = {
    'ID Projeto': 'legado-001',
    'Projeto': 'Automação X',
    'Ganho Total': '8.951,30',
    'Saving Reais': '546,00',
    'Receita Mensal': '84.053,00',
    'Tipo de Saving': 'mensal',
  } as never;

  it('recortarResumo traduz o legado para o nome da v2', () => {
    const r = recortarResumo(linhaV1);
    expect(r['Impacto Líquido']).toBe('8.951,30');
    expect(r['Impacto Bruto']).toBe('546,00');
    expect(r['Receita Incremental']).toBe('84.053,00');
  });

  it('⚠️ e por isso o /dashboard NÃO mostra R$ 0 numa aba não migrada', () => {
    const m = mapResumo(recortarResumo(linhaV1) as never);
    expect(m?.ganhoTotal).toBeCloseTo(8951.3, 2);
    expect(m?.savingReais).toBeCloseTo(546, 2);
  });

  it('valor sob o nome NOVO tem precedência sobre o legado', () => {
    const r = recortarResumo({ 'ID Projeto': 'x', 'Ganho Total': '1', 'Impacto Líquido': '2' } as never);
    expect(r['Impacto Líquido']).toBe('2');
  });

  it('toda coluna do resumo com alias sobrevive ao recorte de uma linha v1', () => {
    const comAlias = COLUNAS_RESUMO.filter((c) => c in NOME_LEGADO);
    const linha = Object.fromEntries(comAlias.map((c) => [NOME_LEGADO[c], 'v'])) as never;
    const r = recortarResumo(linha);
    for (const c of comAlias) expect(r[c]).toBe('v');
  });
});
