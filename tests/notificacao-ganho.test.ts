// O RESUMO do ganho para o alerta do Chat (`src/lib/notificacao-ganho.ts`, módulo PURO).
//
// ⚠️ Este módulo existe por um defeito medido em 08/09/2026: o card do "Alerta de
// Automações" anunciava **R$ 0,00 e 0 horas** em todo projeto da **v2**. A causa não era o
// card — era a FONTE: `buildSubmitMessage` lia `saving_horas`/`saving_reais`/`tipo_saving`
// (colunas da v1) e a receita do blob do chat, e o formulário determinístico da v2 nunca
// as escreve (grava `ganho_categorias` + os 4 blocos + os 3 `impacto_*`).
//
// A régua que estes testes trancam:
//  · o discriminador é `ganho_categorias` — a MESMA de `celulasGanhoV2` no sync;
//  · nada é recalculado: o destaque sai de `impacto_liquido_mensal`, materializado;
//  · categoria DESMARCADA não volta pelas costas, mesmo com a coluna preenchida;
//  · "sem número" é uma AFIRMAÇÃO (imensurável), não um R$ 0,00.
import { describe, it, expect } from 'vitest';
import {
  resumirGanho,
  resumirGanhoV1,
  resumirGanhoV2,
  rotuloTipoProjeto,
} from '@/lib/notificacao-ganho';

const V2_COMPLETO = {
  ganho_categorias: JSON.stringify(['saving_efetivado', 'custo_evitado', 'receita_incremental']),
  saving_efetivado_valor_antes: 20000,
  saving_efetivado_valor_agora: 5000,
  saving_efetivado_frequencia: 'mensal',
  saving_efetivado_evidencia: 'Contrato encerrado em 07/2026, fatura zerada.',
  custo_evitado_frequencia: 'mensal',
  custo_evitado_horas_linhas: JSON.stringify([
    { funcao: 'Analista', horas_antes: 40, horas_depois: 10 },
    { funcao: 'Assistente', horas_antes: 20, horas_depois: 0 },
  ]),
  custo_evitado_horas_valor: 1500,
  custo_evitado_nao_contratado: 3000,
  custo_evitado_racional: 'A vaga de analista não foi aberta.',
  receita_incremental_valor: 10000,
  receita_incremental_frequencia: 'mensal',
  receita_incremental_racional: 'Cobrança recuperada que não voltava.',
  custo_rodar_itens: JSON.stringify([
    { nome: 'OpenAI', valor: 400, frequencia: 'mensal', o_que_e: 'chamadas de LLM' },
  ]),
  impacto_bruto: 21000,
  impacto_liquido: 20600,
  impacto_liquido_mensal: 20600,
};

describe('resumirGanhoV2 — o discriminador é `ganho_categorias`', () => {
  it('sem `ganho_categorias` devolve null (é projeto da v1, e o chamador cai no outro resumo)', () => {
    expect(resumirGanhoV2({})).toBeNull();
    expect(resumirGanhoV2({ ganho_categorias: null })).toBeNull();
    expect(resumirGanhoV2({ ganho_categorias: '[]' })).toBeNull();
    // ⚠️ JSON quebrado NÃO pode virar v2 com tudo zerado — seria o bug de volta com
    // outra roupa. `desserializarCategorias` nunca lança; devolve lista vazia.
    expect(resumirGanhoV2({ ganho_categorias: '{isto não é json' })).toBeNull();
  });

  it('com categorias, marca geração v2 e nomeia as categorias legíveis', () => {
    const r = resumirGanhoV2(V2_COMPLETO)!;
    expect(r.geracao).toBe('v2');
    expect(r.categorias).toBe('Saving efetivado · Custo evitado · Receita incremental');
  });
});

describe('resumirGanhoV2 — os números NÃO são recalculados', () => {
  it('o destaque é o `impacto_liquido_mensal` materializado, com bruto e líquido na nota', () => {
    const r = resumirGanhoV2(V2_COMPLETO)!;
    expect(r.destaque?.rotulo).toBe('Impacto líquido mensal');
    expect(r.destaque?.valor).toContain('20.600,00');
    expect(r.destaque?.nota).toContain('21.000,00');
  });

  it('impacto ausente/zero não inventa destaque (nem mostra R$ 0,00 como se fosse ganho)', () => {
    const r = resumirGanhoV2({ ...V2_COMPLETO, impacto_liquido_mensal: 0 })!;
    expect(r.destaque).toBeNull();
    // Mas ainda há blocos declarados, então NÃO é "sem número".
    expect(r.semNumero).toBe(false);
  });

  it('o saving é a DIFERENÇA entre as duas pontas, e as duas aparecem na nota', () => {
    const r = resumirGanhoV2(V2_COMPLETO)!;
    const saving = r.detalhe.find((d) => d.rotulo.startsWith('Saving efetivado'))!;
    expect(saving.valor).toContain('15.000,00'); // 20.000 → 5.000
    expect(saving.nota).toContain('20.000,00');
    expect(saving.nota).toContain('5.000,00');
  });

  it('par de saving INVERTIDO não vira ganho negativo (clampa em 0)', () => {
    const r = resumirGanhoV2({
      ...V2_COMPLETO,
      saving_efetivado_valor_antes: 1000,
      saving_efetivado_valor_agora: 4000,
    })!;
    const saving = r.detalhe.find((d) => d.rotulo.startsWith('Saving efetivado'))!;
    expect(saving.valor).not.toContain('-');
    expect(saving.valor).toContain('0,00');
  });

  it('custo evitado soma os DOIS braços e mostra as horas liberadas', () => {
    const r = resumirGanhoV2(V2_COMPLETO)!;
    const ce = r.detalhe.find((d) => d.rotulo.startsWith('Custo evitado'))!;
    expect(ce.valor).toContain('4.500,00'); // 1.500 (horas) + 3.000 (não contratado)
    expect(ce.nota).toContain('50 horas'); // (40-10) + (20-0)
  });

  it('o custo para rodar entra com SINAL NEGATIVO e lista os itens', () => {
    const r = resumirGanhoV2(V2_COMPLETO)!;
    const custo = r.detalhe.find((d) => d.rotulo === 'Custo para rodar')!;
    expect(custo.valor).toContain('-');
    expect(custo.valor).toContain('400,00');
    expect(custo.nota).toContain('OpenAI');
  });

  it('sem item de custo, a linha de custo para rodar não existe', () => {
    const r = resumirGanhoV2({ ...V2_COMPLETO, custo_rodar_itens: null })!;
    expect(r.detalhe.some((d) => d.rotulo === 'Custo para rodar')).toBe(false);
  });

  it('a frequência de cada bloco aparece no rótulo, com o rótulo do formulário', () => {
    const r = resumirGanhoV2({ ...V2_COMPLETO, custo_evitado_frequencia: 'trimestral' })!;
    expect(r.detalhe.some((d) => d.rotulo === 'Custo evitado (Trimestral)')).toBe(true);
  });
});

describe('resumirGanhoV2 — categoria DESMARCADA não volta pelas costas', () => {
  it('coluna preenchida de categoria não marcada é resíduo e fica FORA', () => {
    // ⚠️ Mesma régua do RF-218/`montarPatchGanhos`: quem manda é `ganho_categorias`,
    // não a presença do dado. Trocar de categoria no meio do preenchimento deixa o
    // bloco antigo gravado, e ele não pode reaparecer no alerta.
    const r = resumirGanhoV2({
      ...V2_COMPLETO,
      ganho_categorias: JSON.stringify(['saving_efetivado']),
    })!;
    expect(r.categorias).toBe('Saving efetivado');
    expect(r.detalhe.some((d) => d.rotulo.startsWith('Custo evitado'))).toBe(false);
    expect(r.detalhe.some((d) => d.rotulo.startsWith('Receita'))).toBe(false);
    expect(r.textos.some((t) => t.rotulo.includes('custo evitado'))).toBe(false);
  });
});

describe('resumirGanhoV2 — ganho imensurável', () => {
  const imensuravel = {
    ganho_categorias: JSON.stringify(['imensuravel']),
    ganho_imensuravel_racional: 'Elimina o risco de multa por atraso fiscal.',
    impacto_bruto: 0,
    impacto_liquido: 0,
    impacto_liquido_mensal: 0,
  };

  it('não tem número e DIZ isso — nada de R$ 0,00 (que se lê como bug do sistema)', () => {
    const r = resumirGanhoV2(imensuravel)!;
    expect(r.destaque).toBeNull();
    expect(r.detalhe).toHaveLength(0);
    expect(r.semNumero).toBe(true);
  });

  it('o racional é preservado — é o insumo do classificador e o que o card mostra', () => {
    const r = resumirGanhoV2(imensuravel)!;
    expect(r.textos).toEqual([
      { rotulo: 'Ganho imensurável', texto: 'Elimina o risco de multa por atraso fiscal.' },
    ]);
  });

  it('imensurável CONVIVE com bloco medido (deixou de ser exclusivo em 02/09/2026)', () => {
    const r = resumirGanhoV2({
      ...V2_COMPLETO,
      ganho_categorias: JSON.stringify(['saving_efetivado', 'imensuravel']),
      ganho_imensuravel_racional: 'Decisão que antes ninguém tomava.',
    })!;
    expect(r.semNumero).toBe(false);
    expect(r.destaque).not.toBeNull();
    expect(r.textos.some((t) => t.rotulo === 'Ganho imensurável')).toBe(true);
  });
});

describe('resumirGanhoV1 — os legados e tudo que veio antes da v2', () => {
  it('destaque é o saving em R$, com as horas na nota', () => {
    const r = resumirGanhoV1({
      tiposProjeto: ['saving'],
      savingHoras: 120,
      savingReais: 5000,
      tipoSaving: 'mensal',
    });
    expect(r.geracao).toBe('v1');
    expect(r.categorias).toBe('Saving');
    expect(r.destaque?.valor).toContain('5.000,00');
    expect(r.destaque?.nota).toContain('120 horas');
  });

  it('só receita → o destaque é a receita', () => {
    const r = resumirGanhoV1({
      tiposProjeto: ['receita_incremental'],
      receitaValor: 8000,
      tipoReceita: 'mensal',
    });
    expect(r.destaque?.rotulo).toBe('Receita incremental');
    expect(r.destaque?.valor).toContain('8.000,00');
  });

  it('⚠️ NÃO soma saving + receita: a conta do ganho total é regra de negócio de outro lugar', () => {
    const r = resumirGanhoV1({
      tiposProjeto: ['saving', 'receita_incremental'],
      savingReais: 5000,
      receitaValor: 10000,
      tipoSaving: 'mensal',
      tipoReceita: 'mensal',
    });
    // O destaque é o saving; a receita é uma PARCELA no detalhe. Somar aqui (ou aplicar
    // o ÷10) criaria a 2ª cabeça que a v2 existe para desfazer.
    expect(r.destaque?.valor).toContain('5.000,00');
    expect(r.detalhe).toHaveLength(2);
  });

  it('nada declarado → sem número, sem destaque, categorias em "—"', () => {
    const r = resumirGanhoV1({});
    expect(r.semNumero).toBe(true);
    expect(r.destaque).toBeNull();
    expect(r.categorias).toBe('—');
  });
});

describe('resumirGanho — v2 vence quando existe', () => {
  it('projeto v2 ignora os campos da v1 passados ao lado', () => {
    const r = resumirGanho(V2_COMPLETO, { savingHoras: 999, savingReais: 999, tiposProjeto: ['saving'] });
    expect(r.geracao).toBe('v2');
    expect(JSON.stringify(r)).not.toContain('999');
  });

  it('projeto v1 cai no resumo da v1', () => {
    const r = resumirGanho({}, { tiposProjeto: ['saving'], savingReais: 300, tipoSaving: 'mensal' });
    expect(r.geracao).toBe('v1');
    expect(r.destaque?.valor).toContain('300,00');
  });
});

describe('rotuloTipoProjeto — a linha que saía "Tipos: —"', () => {
  it('slug conhecido vira rótulo', () => {
    expect(rotuloTipoProjeto('automacao')).toBe('Automação');
    expect(rotuloTipoProjeto('AGENTE')).toBe('Agente');
  });

  it('ausente devolve null — o card OMITE a linha em vez de escrever "—"', () => {
    expect(rotuloTipoProjeto(null)).toBeNull();
    expect(rotuloTipoProjeto('')).toBeNull();
    expect(rotuloTipoProjeto('   ')).toBeNull();
  });

  it('valor fora da escala volta como veio (mostra o que existe)', () => {
    expect(rotuloTipoProjeto('coisa-nova')).toBe('coisa-nova');
  });
});

describe('resumirGanhoV2 — a nota do destaque não repete o mesmo número', () => {
  it('em projeto mensal, bruto == líquido == mensal → a nota fica vazia', () => {
    const r = resumirGanhoV2({
      ganho_categorias: JSON.stringify(['saving_efetivado']),
      saving_efetivado_valor_antes: 1000,
      saving_efetivado_valor_agora: 0,
      saving_efetivado_frequencia: 'mensal',
      impacto_bruto: 1000,
      impacto_liquido: 1000,
      impacto_liquido_mensal: 1000,
    })!;
    expect(r.destaque?.nota).toBe('');
  });

  it('quando o bruto DIFERE (houve custo para rodar), ele aparece', () => {
    const r = resumirGanhoV2({
      ganho_categorias: JSON.stringify(['saving_efetivado']),
      saving_efetivado_valor_antes: 1000,
      saving_efetivado_valor_agora: 0,
      saving_efetivado_frequencia: 'mensal',
      impacto_bruto: 1000,
      impacto_liquido: 900,
      impacto_liquido_mensal: 900,
    })!;
    expect(r.destaque?.nota).toContain('bruto');
    expect(r.destaque?.nota).toContain('1.000,00');
  });
});

// ─── A PLANILHA como fonte (o caminho preferido, 08/09/2026) ─────────────────
//
// ⚠️ Origem: em produção um líder pré-aprovou um projeto e o card anunciou só
// "Saving R$ X", com a seção "Números do ganho" REPETINDO a mesma linha. O card estava
// tecnicamente certo (o projeto é v1), e é aí que estava o erro de projeto: eu tratei o
// caminho v1 como fallback de legado e dei a ele o mínimo, quando a base de produção é
// **100% v1** (739 projetos) — ou seja, aquele era o caminho de TODOS os cards.
//
// A planilha, por outro lado, já está no vocabulário da v2 para a base inteira (a régua D1
// renomeou as colunas in-place e o retroativo recalculou os 3 `Impacto *`): 667 de 739
// (90%) têm impacto. Então o número existe — só não em `projetos`, onde `impacto_*` é NULL
// fora da v2. Ler o espelho resolve v1 e v2 pelo mesmo caminho e, por construção, impede o
// card de discordar da ficha do /dashboard.
import { resumirGanhoDaPlanilha, rotularCategoriasGanho } from '@/lib/notificacao-ganho';

// Linha REAL de produção (projeto v1 "Mapeamento de prazo ecomerce", 02/09/2026), reduzida
// às colunas de ganho. É a linha do card que motivou esta mudança.
const LINHA_V1_REAL = {
  'Tipos de Ganho': 'saving, receita_incremental',
  'Saving Efetivado': '5.000,00',
  'Freq. Saving Efetivado': 'Mensal',
  'Evidência Saving Efetivado': '• erros de leilão intelipost com transportadoras mais caras',
  'Custo Evitado Horas': '30,00',
  'Custo Evitado Horas Reais': '638,70',
  'Freq. Custo Evitado': 'mensal',
  'Racional Custo Evitado': 'Antes × depois por cargo: Analista Júnior 30h→0h.',
  'Receita Incremental': '5.000,00',
  'Freq. Receita': 'mensal',
  'Racional Receita': 'Mapeia prazo e abre oportunidade de frete.',
  'Custo para Rodar': '0,00',
  'Impacto Bruto': '10638,7',
  'Impacto Líquido': '5819,35',
  'Impacto Líquido Mensal': '5819,35',
  'Alguém Fazia?': 'sim',
  'Saving Horas Real': '30',
  'Saving Horas Escalado': '0',
};

describe('resumirGanhoDaPlanilha — o defeito que motivou a mudança', () => {
  it('projeto V1 mostra IMPACTO LÍQUIDO MENSAL, não "Saving"', () => {
    const r = resumirGanhoDaPlanilha(LINHA_V1_REAL)!;
    expect(r.geracao).toBe('planilha');
    expect(r.destaque?.rotulo).toBe('Impacto líquido mensal');
    expect(r.destaque?.valor).toContain('5.819,35');
    expect(r.destaque?.nota).toContain('10.638,70'); // o bruto, que difere
  });

  it('o número bate com o que o /dashboard mostra (mesmo parser, mesma célula)', () => {
    // `ganhoTotal: 5819.35` na listagem de prod para este mesmo projeto. Card e ficha
    // discordarem foi o defeito de ORIGEM desta frente.
    const r = resumirGanhoDaPlanilha(LINHA_V1_REAL)!;
    expect(r.destaque?.valor.replace(/[^\d,]/g, '')).toBe('5.819,35'.replace(/[^\d,]/g, ''));
  });

  it('"Números do ganho" NÃO repete o destaque — são parcelas distintas', () => {
    const r = resumirGanhoDaPlanilha(LINHA_V1_REAL)!;
    expect(r.detalhe.length).toBeGreaterThanOrEqual(4);
    // Nenhuma linha do detalhe pode ser o próprio destaque (era literalmente o bug).
    for (const d of r.detalhe) {
      expect(d.valor).not.toBe(r.destaque?.valor);
      expect(d.rotulo).not.toBe(r.destaque?.rotulo);
    }
  });

  it('as parcelas trazem informação que o resumo do banco não tinha', () => {
    const r = resumirGanhoDaPlanilha(LINHA_V1_REAL)!;
    const rotulos = r.detalhe.map((d) => d.rotulo).join(' | ');
    expect(rotulos).toContain('Saving efetivado');
    expect(rotulos).toContain('Custo evitado');
    expect(rotulos).toContain('Receita incremental');
    expect(rotulos).toContain('Origem das horas'); // split carga real × escala
    expect(rotulos).toContain('Alguém já fazia?');
    // As horas liberadas aparecem, com unidade.
    expect(JSON.stringify(r.detalhe)).toContain('30 horas liberadas');
  });

  it('os textos longos (evidência e racionais) vão para o colapsável', () => {
    const r = resumirGanhoDaPlanilha(LINHA_V1_REAL)!;
    expect(r.textos.map((t) => t.rotulo)).toEqual([
      'Evidência do saving',
      'Racional do custo evitado',
      'Racional da receita',
    ]);
  });
});

describe('resumirGanhoDaPlanilha — o rótulo SEGUE o campo', () => {
  it('sem "Impacto Líquido Mensal", o rótulo é "Impacto líquido" (sem prometer cadência)', () => {
    // ⚠️ Caso real: o `syncSubmitToGoogle` do caminho v1 escreve `Impacto Líquido` e NÃO
    // `Impacto Líquido Mensal` (esse veio do retroativo); e na v2 o `Impacto Líquido` é o
    // do PERÍODO, não o mensal. Chamá-lo de "mensal" afirmaria uma cadência que ele não tem.
    const { 'Impacto Líquido Mensal': _, ...semMensal } = LINHA_V1_REAL;
    const r = resumirGanhoDaPlanilha(semMensal)!;
    expect(r.destaque?.rotulo).toBe('Impacto líquido');
    expect(r.destaque?.valor).toContain('5.819,35');
  });

  it('bruto igual ao destaque não vira nota (não repete o mesmo número)', () => {
    const r = resumirGanhoDaPlanilha({
      'Impacto Bruto': '1.000,00',
      'Impacto Líquido Mensal': '1.000,00',
    })!;
    expect(r.destaque?.nota).toBe('');
  });
});

describe('resumirGanhoDaPlanilha — degrada, não mente', () => {
  it('linha ausente devolve null (o chamador cai no resumo do banco)', () => {
    expect(resumirGanhoDaPlanilha(null)).toBeNull();
    expect(resumirGanhoDaPlanilha(undefined)).toBeNull();
  });

  it('linha SEM nada de ganho devolve null, em vez de um card com tudo zerado', () => {
    expect(resumirGanhoDaPlanilha({ Projeto: 'X', 'Área': 'Fiscal' })).toBeNull();
  });

  it('célula "—" e zero contam como ausência, nunca como R$ 0,00', () => {
    const r = resumirGanhoDaPlanilha({
      'Impacto Líquido Mensal': '900,00',
      'Saving Efetivado': '—',
      'Custo para Rodar': '0,00',
      'Receita Incremental': '0',
    })!;
    expect(r.detalhe).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain('R$ 0,00');
  });

  it('casa o nome da coluna de forma TOLERANTE (o cabeçalho é digitado à mão)', () => {
    // O cabeçalho real da planilha já tem `Justificativa Aprovação do **Lider**` sem
    // acento; a mesma disciplina do `resolverColunaLetra` vale aqui.
    const r = resumirGanhoDaPlanilha({ 'IMPACTO LIQUIDO MENSAL': '2.500,00' })!;
    expect(r.destaque?.valor).toContain('2.500,00');
  });

  it('número pt-BR nos 2 formatos que a própria planilha mistura', () => {
    // "5.000,00" (com milhar) e "5819,35" (sem) convivem na MESMA linha em produção.
    expect(resumirGanhoDaPlanilha({ 'Impacto Líquido Mensal': '10638,7' })!.destaque?.valor)
      .toContain('10.638,70');
    expect(resumirGanhoDaPlanilha({ 'Impacto Líquido Mensal': '1.234,56' })!.destaque?.valor)
      .toContain('1.234,56');
  });
});

describe('rotularCategoriasGanho — a coluna carrega os DOIS vocabulários', () => {
  it('slugs da v1 viram rótulo', () => {
    expect(rotularCategoriasGanho('saving, receita_incremental')).toBe('Saving · Receita incremental');
  });

  it('títulos da v2 atravessam intactos', () => {
    expect(rotularCategoriasGanho('Saving efetivado · Custo evitado')).toBe(
      'Saving efetivado · Custo evitado',
    );
  });

  it('token desconhecido volta como veio (mostra o que existe)', () => {
    expect(rotularCategoriasGanho('coisa_nova')).toBe('coisa_nova');
  });

  it('vazio/"—" devolve null (o card cai no traço)', () => {
    expect(rotularCategoriasGanho('')).toBeNull();
    expect(rotularCategoriasGanho('—')).toBeNull();
    expect(rotularCategoriasGanho(null)).toBeNull();
  });
});

describe('resumirGanhoDaPlanilha — "Ganho Imensurável" fica FORA de propósito', () => {
  it('não vira texto do resumo (na v1 essa célula é o "por que é especial")', () => {
    // Incluí-la duplicaria o contexto que o card do especial já mostra na seção própria e,
    // num projeto padrão, rotularia o contexto especial como racional de ganho sem número.
    const r = resumirGanhoDaPlanilha({
      'Impacto Líquido Mensal': '500,00',
      'Ganho Imensurável': 'Projeto de altíssimo impacto estratégico.',
    })!;
    expect(JSON.stringify(r)).not.toContain('altíssimo impacto');
  });
});
