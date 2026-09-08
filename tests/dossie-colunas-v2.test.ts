/**
 * BUG (08/09/2026) — o dossiê do time lia a planilha por nomes de coluna da **v1**, e a aba
 * `GoDocs` de PROD já está 100% em **v2**: TODO o financeiro chegava `null` aos agentes.
 *
 * Caso real verificado, `dba1cc1c23ebb528d6ad4c852ad32b64` (SmartOnline/DIFAL): a planilha tinha
 * `Saving Efetivado = 324.005,09` e `Custo Evitado Horas = 60`, e o dossiê entregou
 * `saving_horas`, `saving_reais`, `custo_evitado_reais`, `tipo_saving`, `receita_mensal` e
 * `ganho_total_mensal` TODOS `null`. Os agentes só citaram números porque estavam na PROSA do
 * memorial — e o cético acusou "contradição interna" porque o dossiê dizia "Saving em R$: —"
 * contra um memorial que trazia o valor. Falso positivo nascido de leitura vazia.
 */
import { describe, it, expect } from 'vitest';
import { dossieDaLinhaPlanilha, dossieParaTexto } from '@/lib/avaliacao/dossie';
import { NOME_LEGADO, SEM_ALIAS_DE_LEITURA, nomeV2De } from '@/lib/coluna-chave';
import { GANHO_CATEGORIAS } from '@/lib/ganhos';
import { GANHO_ROTULOS } from '@/lib/ganhos-rotulos';

/** A linha do caso real, com os nomes de coluna da aba v2 (é o que PROD tem hoje). */
function linhaV2(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'ID Projeto': 'dba1cc1c23ebb528d6ad4c852ad32b64',
    Projeto: 'Plataforma SmartOnline - DIFAL',
    Área: 'FISCAL',
    Status: 'Pendente',
    'Tipos de Ganho': 'Custo evitado, Saving efetivado',
    'Custo Evitado Horas': '60',
    'Custo Evitado Horas Reais': 'R$ 3.000,00',
    'Saving Efetivado': 'R$ 324.005,09',
    'Freq. Custo Evitado': 'Mensal',
    'Impacto Bruto': 'R$ 327.005,09',
    'Impacto Líquido': 'R$ 325.505,09',
    'Impacto Líquido Mensal': 'R$ 325.505,09',
    'Receita Incremental': 'R$ 0,00',
    'Memorial de Saving': 'A multa e os juros de DIFAL somavam R$ 324.005,09 por mês.',
    ...extra,
  };
}

/** A mesma coisa na aba v1 (legado) — tem de continuar lendo igual. */
function linhaV1(): Record<string, string> {
  return {
    'ID Projeto': 'legado-999',
    Projeto: 'Projeto legado',
    Status: 'Aprovado',
    'Tipos Projeto': 'saving',
    'Saving Horas': '60',
    'Horas em Reais': 'R$ 3.000,00',
    'Custo Evitado': 'R$ 324.005,09',
    'Tipo de Saving': 'Mensal',
    'Saving Reais': 'R$ 8.844,00',
    'Ganho Total': 'R$ 8.844,00',
    'Receita Mensal': 'R$ 1.000,00',
  };
}

describe('linha v2: o financeiro chega aos agentes (era todo null)', () => {
  const d = dossieDaLinhaPlanilha(linhaV2())!;

  it('as horas e o custo evitado saem dos nomes v2', () => {
    expect(d.financeiro.saving_horas).toBe(60);
    expect(d.financeiro.custo_evitado_reais).toBeCloseTo(324005.09, 2);
  });

  it('cadência, receita e os tipos de ganho também', () => {
    expect(d.financeiro.tipo_saving).toBe('Mensal');
    expect(d.financeiro.receita_mensal).toBe(0);
    expect(d.classificacao.tipos.length).toBeGreaterThan(0);
    expect(d.classificacao.tipos.join(' ')).toMatch(/custo evitado/i);
  });

  it('o ganho mensal vem do Impacto Líquido Mensal, por escolha EXPLÍCITA', () => {
    expect(d.financeiro.ganho_total_mensal).toBeCloseTo(325505.09, 2);
    expect(d.financeiro.impacto_liquido).toBeCloseTo(325505.09, 2);
    expect(d.financeiro.impacto_bruto).toBeCloseTo(327005.09, 2);
  });

  it('⚠️ `saving_reais` NÃO herda o `Impacto Bruto` (que inclui receita)', () => {
    // A armadilha: `Impacto Bruto` = saving + custo evitado + RECEITA. Cair no alias faria o
    // especialista financeiro auditar receita dentro do saving.
    expect(d.financeiro.saving_reais).toBeNull();
    expect(d.financeiro.saving_reais).not.toBe(327005.09);
  });

  it('o texto do dossiê NÃO afirma "Saving em R$: —" (a origem do falso positivo do cético)', () => {
    const txt = dossieParaTexto(d, { comReais: true });
    expect(txt).not.toMatch(/Saving em R\$:\s*—/);
    // e nomeia o que existe, com o número (o `fmt` do dossiê não formata milhar)
    expect(txt).toMatch(/Impacto bruto/);
    expect(txt).toContain('327005.09');
    expect(txt).toMatch(/Ganho mensal do projeto: 325505\.09/);
  });
});

describe('linha v1 (legado) continua lendo igual', () => {
  const d = dossieDaLinhaPlanilha(linhaV1())!;

  it('todos os campos v1 seguem preenchidos pelo nome de sempre', () => {
    expect(d.financeiro.saving_horas).toBe(60);
    expect(d.financeiro.custo_evitado_reais).toBeCloseTo(324005.09, 2);
    expect(d.financeiro.tipo_saving).toBe('Mensal');
    expect(d.financeiro.receita_mensal).toBe(1000);
    expect(d.classificacao.tipos).toEqual(['saving']);
  });

  it('e os dois campos EXPLÍCITOS usam a coluna v1, não a v2', () => {
    expect(d.financeiro.saving_reais).toBeCloseTo(8844, 2);
    expect(d.financeiro.ganho_total_mensal).toBeCloseTo(8844, 2);
    // Linha v1 não tem os compostos da v2.
    expect(d.financeiro.impacto_bruto).toBeNull();
    expect(d.financeiro.impacto_liquido).toBeNull();
  });
});

describe('nomeV2De — o alias de leitura, e o que fica DE FORA dele', () => {
  it('traduz o nome legado para o v2, tolerante a acento e caixa', () => {
    expect(nomeV2De('Saving Horas')).toBe('Custo Evitado Horas');
    expect(nomeV2De('Custo Evitado')).toBe('Saving Efetivado');
    expect(nomeV2De('Tipos Projeto')).toBe('Tipos de Ganho');
    expect(nomeV2De('tipo de saving')).toBe('Freq. Custo Evitado');
    expect(nomeV2De('Receita Mensal')).toBe('Receita Incremental');
  });

  it('⚠️ `Saving Reais` e `Ganho Total` NÃO têm alias — o significado mudou', () => {
    expect(SEM_ALIAS_DE_LEITURA.has('Saving Reais')).toBe(true);
    expect(SEM_ALIAS_DE_LEITURA.has('Ganho Total')).toBe(true);
    expect(nomeV2De('Saving Reais')).toBeNull();
    expect(nomeV2De('Ganho Total')).toBeNull();
  });

  it('nome desconhecido devolve null (não inventa coluna)', () => {
    expect(nomeV2De('Coluna Que Não Existe')).toBeNull();
  });

  it('todo alias aponta para uma chave real de NOME_LEGADO (o inverso não inventa nada)', () => {
    for (const [v2, legado] of Object.entries(NOME_LEGADO)) {
      if (SEM_ALIAS_DE_LEITURA.has(legado)) continue;
      expect(nomeV2De(legado), legado).toBe(v2);
    }
  });
});

describe('a INVERSÃO de vocabulário que confundia os agentes (08/09/2026)', () => {
  const txt = dossieParaTexto(dossieDaLinhaPlanilha(linhaV2())!, { comReais: true });

  it('o R$ que a empresa PAGAVA e parou não é mais chamado de "custo evitado"', () => {
    // Na v2 "custo evitado" é a despesa que NUNCA NASCEU. A multa de DIFAL que parou de ser paga
    // é saving efetivado, e o dossiê a rotulava com a palavra do outro conceito — foi por isso que
    // a mesa pediu comprovante da coisa errada.
    expect(txt).toMatch(/parou de pagar \(saving efetivado\): 324005\.09/);
    expect(txt).not.toMatch(/Custo evitado: 324005\.09/);
  });

  it('as horas liberadas são nomeadas pelo que são, não como "saving"', () => {
    expect(txt).toMatch(/Horas humanas liberadas: 60h/);
    expect(txt).not.toMatch(/Saving em horas/);
  });

  it('o glossário vem das MESMAS palavras do formulário (fonte única `GANHO_ROTULOS`)', () => {
    for (const c of GANHO_CATEGORIAS) {
      expect(txt, c).toContain(GANHO_ROTULOS[c].titulo);
      expect(txt, c).toContain(GANHO_ROTULOS[c].descricao.slice(0, 40));
    }
  });

  it('a categoria DECLARADA pelo autor entra, para o time poder conferir a distinção', () => {
    expect(txt).toMatch(/Categorias de ganho DECLARADAS pelo autor: .*Custo evitado/);
  });

  it('e a régua da distinção está escrita, com o que cada uma exige de prova', () => {
    expect(txt).toMatch(/EXISTIA e parou é saving efetivado/i);
    expect(txt).toMatch(/NUNCA NASCEU.*é custo evitado/is);
    // a armadilha nomeada: cobrar extrato de custo evitado é cobrar o impossível
    expect(txt).toMatch(/cobrar o impossível/i);
  });
});
