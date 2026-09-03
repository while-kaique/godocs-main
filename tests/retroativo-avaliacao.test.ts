/**
 * T18 — Retroativo de 3 saídas + gabarito limpo (plano `docs/plans/regua-estrelas-e-time-unificado.md`,
 * §8, §11.3, D7, D11, D12, §6.1 Achado 5). Módulo PURO `src/lib/avaliacao/retroativo.ts`, sem mock.
 *
 * Encoda o comportamento que o plano pede — não o que o código faz.
 */
import { describe, it, expect } from 'vitest';
import {
  MESES_SEM_TRIAGEM,
  classificarGabarito,
  compararProjeto,
  agregarRetroativo,
  amostrarEstratificado,
  relatorioParaMarkdown,
  type LinhaGabarito,
  type ResultadoProjeto,
  type ComparacaoProjeto,
} from '@/lib/avaliacao/retroativo';
import { detectarAchatamento, conferirCalibragem } from '@/lib/estrelas-regua';

// ─── fixtures ────────────────────────────────────────────────────────────────

function linha(over: Partial<LinhaGabarito> = {}): LinhaGabarito {
  return {
    id: 'p1',
    nome: 'Projeto 1',
    area: 'Fiscal',
    especial: false,
    nota_humana: null,
    status: 'Aprovado',
    data_submissao: '2026-05-10',
    descontinuado: false,
    ...over,
  };
}

function resultado(over: Partial<ResultadoProjeto> = {}): ResultadoProjeto {
  return {
    id: 'p1',
    nome: 'Projeto 1',
    area: 'Fiscal',
    especial: false,
    saida: 'aprovar',
    veredito_merito: 'aprovar',
    estrela: 1,
    escape: false,
    confianca: 'alta',
    valor_absurdo: null,
    valor_sugerido: null,
    contestacao: null,
    erros: 0,
    custo_usd: 0.01,
    ...over,
  };
}

function comparacao(over: Partial<ComparacaoProjeto> = {}): ComparacaoProjeto {
  return {
    id: 'c1',
    nome: 'Comparação 1',
    area: 'Fiscal',
    especial: false,
    gabarito: 'status_assentado',
    merito: 'acerto',
    estrela: { humana: null, time: 0, distancia: null, dentro_de_1: null },
    escape: false,
    saida: 'aprovar',
    confianca: 'alta',
    valor_absurdo: null,
    contestou: false,
    ...over,
  };
}

/** As 6 comparações fabricadas do critério 3 (reusadas no markdown do critério 5). */
const SEIS: ComparacaoProjeto[] = [
  comparacao({
    id: 'c1', nome: 'Especial Um', especial: true, gabarito: 'nota_humana', merito: 'acerto',
    saida: 'aprovar', confianca: 'alta',
    estrela: { humana: 3, time: 2, distancia: 1, dentro_de_1: true },
    valor_absurdo: false, contestou: false,
  }),
  comparacao({
    id: 'c2', nome: 'Especial Dois', especial: true, gabarito: 'nota_humana', merito: 'conservador',
    saida: 'ajuste', confianca: 'media',
    estrela: { humana: 4, time: 4, distancia: 0, dentro_de_1: true },
    valor_absurdo: null, contestou: true,
  }),
  comparacao({
    id: 'c3', nome: 'Especial Três', especial: true, gabarito: 'nota_humana', merito: 'erro_grave',
    saida: 'aprovar', confianca: 'alta', escape: true,
    estrela: { humana: 7, time: 5, distancia: 2, dentro_de_1: false },
    valor_absurdo: false, contestou: false,
  }),
  comparacao({
    id: 'c4', nome: 'Padrão Quatro', gabarito: 'status_assentado', merito: 'acerto',
    saida: 'ajuste', confianca: 'alta',
    estrela: { humana: null, time: 0, distancia: null, dentro_de_1: null },
    valor_absurdo: true, contestou: false,
  }),
  comparacao({
    id: 'c5', nome: 'Padrão Cinco', gabarito: 'nao_auditado', merito: 'sem_base',
    saida: 'humano', confianca: 'baixa',
    estrela: { humana: 0, time: 1, distancia: null, dentro_de_1: null },
    valor_absurdo: null, contestou: false,
  }),
  comparacao({
    id: 'c6', nome: 'Padrão Seis', gabarito: 'fora', merito: 'sem_base',
    saida: 'humano', confianca: 'baixa',
    estrela: { humana: null, time: 0, distancia: null, dentro_de_1: null },
    valor_absurdo: false, contestou: true,
  }),
];

// ─── 1. classificarGabarito ──────────────────────────────────────────────────

describe('classificarGabarito — confiança do gabarito humano', () => {
  it('declara julho/2026 como mês sem triagem (Achado 5)', () => {
    expect(MESES_SEM_TRIAGEM).toContain('2026-07');
  });

  it('descontinuado → fora, independente de nota ou status (D7)', () => {
    expect(classificarGabarito(linha({ descontinuado: true, nota_humana: 5, status: 'Aprovado' }))).toBe('fora');
    expect(classificarGabarito(linha({ descontinuado: true, nota_humana: null, status: null }))).toBe('fora');
  });

  it('nota humana ≥ 1 → nota_humana', () => {
    expect(classificarGabarito(linha({ nota_humana: 1, especial: true }))).toBe('nota_humana');
    expect(classificarGabarito(linha({ nota_humana: 8, especial: true, status: 'Pendente' }))).toBe('nota_humana');
  });

  it('nota 0/null com data de submissão em 2026-07 → nao_auditado, nos 3 formatos de data', () => {
    for (const data of ['2026-07-15', '15/07/2026', '15/07/2026 10:00']) {
      expect(classificarGabarito(linha({ nota_humana: 0, status: 'Aprovado', data_submissao: data }))).toBe('nao_auditado');
      expect(classificarGabarito(linha({ nota_humana: null, status: 'Reprovado', data_submissao: data }))).toBe('nao_auditado');
    }
  });

  it('nota 0 com Status Aprovado/Reprovado fora de julho → status_assentado', () => {
    expect(classificarGabarito(linha({ nota_humana: 0, status: 'Aprovado', data_submissao: '2026-05-10' }))).toBe('status_assentado');
    expect(classificarGabarito(linha({ nota_humana: 0, status: 'Reprovado', data_submissao: '10/06/2026' }))).toBe('status_assentado');
  });

  it('nota 0 com Status Pendente fora de julho → nao_auditado', () => {
    expect(classificarGabarito(linha({ nota_humana: 0, status: 'Pendente', data_submissao: '2026-05-10' }))).toBe('nao_auditado');
  });

  it('status null e nota null → nao_auditado', () => {
    expect(classificarGabarito(linha({ nota_humana: null, status: null, data_submissao: '2026-05-10' }))).toBe('nao_auditado');
  });
});

// ─── 2. compararProjeto ──────────────────────────────────────────────────────

describe('compararProjeto — mérito da saída × Status humano', () => {
  const aprovado = linha({ nota_humana: 0, status: 'Aprovado' });
  const reprovado = linha({ nota_humana: 0, status: 'Reprovado' });

  it('Aprovado × aprovar → acerto', () => {
    expect(compararProjeto(resultado({ saida: 'aprovar' }), aprovado).merito).toBe('acerto');
  });

  it('Aprovado × ajuste ou humano → conservador', () => {
    expect(compararProjeto(resultado({ saida: 'ajuste' }), aprovado).merito).toBe('conservador');
    expect(compararProjeto(resultado({ saida: 'humano' }), aprovado).merito).toBe('conservador');
  });

  it('Reprovado × aprovar → erro_grave', () => {
    expect(compararProjeto(resultado({ saida: 'aprovar' }), reprovado).merito).toBe('erro_grave');
  });

  it('Reprovado × ajuste → acerto (pedir ajuste a um reprovado é o esperado)', () => {
    expect(compararProjeto(resultado({ saida: 'ajuste' }), reprovado).merito).toBe('acerto');
  });

  it('Reprovado × humano → conservador', () => {
    expect(compararProjeto(resultado({ saida: 'humano' }), reprovado).merito).toBe('conservador');
  });

  it('gabarito nao_auditado, fora, Pendente ou status null → sem_base', () => {
    expect(
      compararProjeto(resultado({ saida: 'aprovar' }), linha({ nota_humana: 0, status: 'Aprovado', data_submissao: '2026-07-03' })).merito,
    ).toBe('sem_base');
    expect(compararProjeto(resultado({ saida: 'aprovar' }), linha({ descontinuado: true })).merito).toBe('sem_base');
    expect(compararProjeto(resultado({ saida: 'aprovar' }), linha({ nota_humana: 0, status: 'Pendente' })).merito).toBe('sem_base');
    expect(compararProjeto(resultado({ saida: 'aprovar' }), linha({ nota_humana: null, status: null })).merito).toBe('sem_base');
  });

  it('propaga gabarito, saída, confiança, escape, valor_absurdo e identidade', () => {
    const c = compararProjeto(
      resultado({ id: 'x9', nome: 'X Nove', area: 'CX', especial: true, saida: 'ajuste', confianca: 'media', escape: true, valor_absurdo: true }),
      linha({ id: 'x9', nome: 'X Nove', area: 'CX', especial: true, nota_humana: 4, status: 'Aprovado' }),
    );
    expect(c).toMatchObject({
      id: 'x9', nome: 'X Nove', area: 'CX', especial: true,
      gabarito: 'nota_humana', saida: 'ajuste', confianca: 'media', escape: true, valor_absurdo: true,
    });
  });
});

describe('compararProjeto — estrela humana × estrela do time', () => {
  it('humana 3, time 2 → distância 1, dentro de 1', () => {
    const c = compararProjeto(resultado({ estrela: 2 }), linha({ nota_humana: 3, status: 'Aprovado' }));
    expect(c.estrela).toEqual({ humana: 3, time: 2, distancia: 1, dentro_de_1: true });
  });

  it('humana 5, time 2 → distância 3, fora de 1', () => {
    const c = compararProjeto(resultado({ estrela: 2 }), linha({ nota_humana: 5, status: 'Aprovado' }));
    expect(c.estrela).toEqual({ humana: 5, time: 2, distancia: 3, dentro_de_1: false });
  });

  it('humana null → distância null e dentro_de_1 null', () => {
    const c = compararProjeto(resultado({ estrela: 2 }), linha({ nota_humana: null, status: 'Aprovado' }));
    expect(c.estrela.humana).toBeNull();
    expect(c.estrela.time).toBe(2);
    expect(c.estrela.distancia).toBeNull();
    expect(c.estrela.dentro_de_1).toBeNull();
  });

  it('nao_auditado com nota 0: humana segue 0 mas NÃO se compara (distância null)', () => {
    const c = compararProjeto(
      resultado({ estrela: 2 }),
      linha({ nota_humana: 0, status: 'Aprovado', data_submissao: '15/07/2026' }),
    );
    expect(c.gabarito).toBe('nao_auditado');
    expect(c.estrela.humana).toBe(0);
    expect(c.estrela.distancia).toBeNull();
    expect(c.estrela.dentro_de_1).toBeNull();
  });

  it('contestou = contestacao != null', () => {
    const g = linha({ nota_humana: 3, status: 'Aprovado' });
    expect(compararProjeto(resultado({ contestacao: null }), g).contestou).toBe(false);
    expect(compararProjeto(resultado({ contestacao: { motivo: 'nota humana parece inflada' } }), g).contestou).toBe(true);
  });
});

// ─── 3. agregarRetroativo ────────────────────────────────────────────────────

describe('agregarRetroativo — relatório sobre 6 comparações fabricadas', () => {
  const r = agregarRetroativo(SEIS);

  it('conta total e por gabarito', () => {
    expect(r.total).toBe(6);
    expect(r.por_gabarito).toEqual({ nota_humana: 3, status_assentado: 1, nao_auditado: 1, fora: 1 });
  });

  it('mérito: acurácia = acerto/(acerto+conservador+erro_grave), ignorando sem_base', () => {
    expect(r.merito).toMatchObject({ acerto: 2, conservador: 1, erro_grave: 1, sem_base: 2 });
    expect(r.merito.acuracia).toBeCloseTo(0.5, 6);
  });

  it('acurácia por veredito: só saídas com gabarito confiável', () => {
    // aprovar: c1 (acerto) + c3 (erro_grave) → n=2
    expect(r.acuracia_por_veredito.aprovar).toBeDefined();
    expect(r.acuracia_por_veredito.aprovar!.n).toBe(2);
    expect(r.acuracia_por_veredito.aprovar!.acerto).toBeCloseTo(0.5, 6);
    expect(r.acuracia_por_veredito.aprovar!.erro_grave).toBe(1);
    // ajuste: c2 (conservador) + c4 (acerto) → n=2; c5/c6 (humano/sem_base) ficam de fora
    expect(r.acuracia_por_veredito.ajuste).toBeDefined();
    expect(r.acuracia_por_veredito.ajuste!.n).toBe(2);
    expect(r.acuracia_por_veredito.ajuste!.acerto).toBeCloseTo(0.5, 6);
    expect(r.acuracia_por_veredito.ajuste!.erro_grave).toBe(0);
  });

  it('estrelas: distribuição do time por "0".."5" e humana com "6+"', () => {
    expect(r.estrelas.distribuicao_time).toMatchObject({ '0': 2, '1': 1, '2': 1, '3': 0, '4': 1, '5': 1 });
    expect(r.estrelas.distribuicao_humana['3']).toBe(1);
    expect(r.estrelas.distribuicao_humana['4']).toBe(1);
    expect(r.estrelas.distribuicao_humana['6+']).toBe(1);
    expect(r.estrelas.distribuicao_humana).not.toHaveProperty('7');
  });

  it('estrelas: escape, exato, dentro_de_1, viés e n_comparaveis só sobre distância !== null', () => {
    expect(r.estrelas.escape).toBe(1);
    expect(r.estrelas.n_comparaveis).toBe(3); // c1, c2, c3
    expect(r.estrelas.exato).toBeCloseTo(1 / 3, 6); // c2
    expect(r.estrelas.dentro_de_1).toBeCloseTo(2 / 3, 6); // c1, c2
    expect(r.estrelas.vies).toBeCloseTo((2 - 3 + (4 - 4) + (5 - 7)) / 3, 6); // média de time − humana = −1
  });

  it('achatamento = detectarAchatamento sobre os destinos das QUEDAS (humana > time)', () => {
    // quedas: c1 (3→2) e c3 (7→5)
    const esperado = detectarAchatamento([2, 5]);
    expect(r.achatamento.total).toBe(2);
    expect(r.achatamento.suspeito).toBe(esperado.suspeito);
    expect(r.achatamento.proporcao).toBeCloseTo(esperado.proporcao, 6);
  });

  it('calibragem = conferirCalibragem sobre todas as notas do time', () => {
    expect(r.calibragem).toEqual(conferirCalibragem([2, 4, 5, 0, 1, 0]));
    expect(r.calibragem.total).toBe(6);
  });

  it('saídas e humano_pct', () => {
    expect(r.saidas).toEqual({ aprovar: 2, ajuste: 2, humano: 2 });
    expect(r.humano_pct).toBeCloseTo(2 / 6, 6);
  });

  it('valor: absurdos = true, auditados = !== null', () => {
    expect(r.valor).toEqual({ absurdos: 1, auditados: 4 });
  });

  it('contestações listam quem contestou, com humana e time', () => {
    expect(r.contestacoes).toHaveLength(2);
    expect(r.contestacoes).toEqual(
      expect.arrayContaining([
        { id: 'c2', nome: 'Especial Dois', humana: 4, time: 4 },
        { id: 'c6', nome: 'Padrão Seis', humana: null, time: 0 },
      ]),
    );
  });

  it('alertas: humano acima de 10%, erro grave presente, calibragem com desvio', () => {
    expect(r.alertas.some((a) => /humano/i.test(a))).toBe(true);
    expect(r.alertas.some((a) => /erro grave/i.test(a))).toBe(true);
    // 4 de 6 notas ≤3 (0,67) fica abaixo do piso de 0,8 → a calibragem acusa desvio, e o alerta tem de nomeá-lo
    expect(r.calibragem.desvio).not.toBeNull();
    expect(r.alertas.some((a) => new RegExp(String(r.calibragem.desvio), 'i').test(a))).toBe(true);
    // não houve achatamento (2 quedas para destinos diferentes)
    expect(r.achatamento.suspeito).toBe(false);
    expect(r.alertas.some((a) => /achatamento/i.test(a))).toBe(false);
  });
});

describe('agregarRetroativo — alerta de achatamento (D12)', () => {
  it('quedas concentradas num único destino acusam a régua, não os projetos', () => {
    const comps = [3, 4, 5].map((humana, i) =>
      comparacao({
        id: `q${i}`, nome: `Queda ${i}`, gabarito: 'nota_humana', merito: 'acerto', saida: 'aprovar',
        estrela: { humana, time: 1, distancia: humana - 1, dentro_de_1: humana - 1 <= 1 },
      }),
    );
    const r = agregarRetroativo(comps);
    expect(r.achatamento).toEqual(detectarAchatamento([1, 1, 1]));
    expect(r.achatamento.suspeito).toBe(true);
    expect(r.alertas.some((a) => /achatamento/i.test(a))).toBe(true);
  });
});

describe('agregarRetroativo — lista vazia', () => {
  it('não lança e devolve zeros e nulls', () => {
    const r = agregarRetroativo([]);
    expect(r.total).toBe(0);
    expect(r.por_gabarito).toEqual({ nota_humana: 0, status_assentado: 0, nao_auditado: 0, fora: 0 });
    expect(r.merito).toEqual({ acerto: 0, conservador: 0, erro_grave: 0, sem_base: 0, acuracia: null });
    expect(r.estrelas.n_comparaveis).toBe(0);
    expect(r.estrelas.exato).toBeNull();
    expect(r.estrelas.dentro_de_1).toBeNull();
    expect(r.estrelas.vies).toBeNull();
    expect(r.estrelas.escape).toBe(0);
    expect(r.saidas).toEqual({ aprovar: 0, ajuste: 0, humano: 0 });
    expect(r.humano_pct).toBeNull();
    expect(r.valor).toEqual({ absurdos: 0, auditados: 0 });
    expect(r.contestacoes).toEqual([]);
    expect(r.achatamento.total).toBe(0);
    expect(r.calibragem.total).toBe(0);
    expect(Array.isArray(r.alertas)).toBe(true);
  });
});

// ─── 4. amostrarEstratificado ────────────────────────────────────────────────

function baseDe200(): LinhaGabarito[] {
  const out: LinhaGabarito[] = [];
  for (let i = 0; i < 60; i++)
    out.push(linha({ id: `esp-${i}`, nome: `Especial ${i}`, especial: true, nota_humana: (i % 5) + 1, status: 'Aprovado' }));
  for (let i = 0; i < 100; i++)
    out.push(linha({ id: `apr-${i}`, nome: `Aprovado ${i}`, nota_humana: 0, status: 'Aprovado' }));
  for (let i = 0; i < 20; i++)
    out.push(linha({ id: `rep-${i}`, nome: `Reprovado ${i}`, nota_humana: 0, status: 'Reprovado' }));
  for (let i = 0; i < 20; i++)
    out.push(linha({ id: `sem-${i}`, nome: `Sem status ${i}`, nota_humana: null, status: null }));
  return out;
}

describe('amostrarEstratificado — amostra determinística por estrato', () => {
  const base = baseDe200();
  const descontinuados = [0, 1, 2, 3, 4].map((i) =>
    linha({ id: `desc-${i}`, nome: `Descontinuado ${i}`, descontinuado: true, nota_humana: 3, especial: true }),
  );
  const baseComDesc = [...base, ...descontinuados];

  it('devolve exatamente `tamanho` linhas, todas únicas', () => {
    const a = amostrarEstratificado(base, { tamanho: 30, seed: 7 });
    expect(a).toHaveLength(30);
    expect(new Set(a.map((l) => l.id)).size).toBe(30);
  });

  it('é determinística: mesma seed → mesma amostra; seed diferente → amostra diferente', () => {
    const a = amostrarEstratificado(base, { tamanho: 30, seed: 7 }).map((l) => l.id);
    const b = amostrarEstratificado(base, { tamanho: 30, seed: 7 }).map((l) => l.id);
    const c = amostrarEstratificado(base, { tamanho: 30, seed: 8 }).map((l) => l.id);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('cobre todos os estratos presentes na base', () => {
    const a = amostrarEstratificado(base, { tamanho: 30, seed: 7 });
    expect(a.some((l) => l.especial && (l.nota_humana ?? 0) >= 1)).toBe(true);
    expect(a.some((l) => !l.especial && l.status === 'Aprovado')).toBe(true);
    expect(a.some((l) => l.status === 'Reprovado')).toBe(true);
    expect(a.some((l) => l.status === null)).toBe(true);
  });

  it('descontinuado NUNCA entra (D7)', () => {
    for (const seed of [1, 7, 42, 999]) {
      const a = amostrarEstratificado(baseComDesc, { tamanho: 205, seed });
      expect(a.some((l) => l.descontinuado)).toBe(false);
    }
  });

  it('tamanho maior que a base → base inteira sem descontinuados, sem duplicar', () => {
    const a = amostrarEstratificado(baseComDesc, { tamanho: 500, seed: 7 });
    expect(a).toHaveLength(200);
    expect(new Set(a.map((l) => l.id)).size).toBe(200);
    expect(a.some((l) => l.descontinuado)).toBe(false);
  });

  it('tamanho 0 → []', () => {
    expect(amostrarEstratificado(base, { tamanho: 0, seed: 7 })).toEqual([]);
  });
});

// ─── 5. relatorioParaMarkdown ────────────────────────────────────────────────

describe('relatorioParaMarkdown — relatório legível do ciclo', () => {
  const r = agregarRetroativo(SEIS);
  const md = relatorioParaMarkdown(r, { ciclo: 'ciclo-01', amostra: 6, modelo: 'gpt-5.6-luna', variante: 'B' });

  it('traz ciclo, amostra, modelo e variante', () => {
    expect(md).toContain('ciclo-01');
    expect(md).toMatch(/\b6\b/);
    expect(md).toContain('gpt-5.6-luna');
    expect(md).toMatch(/\bB\b/);
  });

  it('sem variante escreve "sem variante"', () => {
    const md2 = relatorioParaMarkdown(r, { ciclo: 'ciclo-01', amostra: 6, modelo: 'gpt-5.6-luna', variante: null });
    expect(md2).toMatch(/sem variante/i);
  });

  it('tem tabela com as 3 saídas e a acurácia de mérito em %', () => {
    expect(md).toMatch(/\|\s*aprovar\s*\|/i);
    expect(md).toMatch(/\|\s*ajuste\s*\|/i);
    expect(md).toMatch(/\|\s*humano\s*\|/i);
    expect(md).toMatch(/50([.,]0+)?\s*%/);
  });

  it('tem a tabela de distribuição de estrelas com a coluna de escape', () => {
    expect(md).toMatch(/\|[^\n]*escape[^\n]*\|/i);
    expect(md).toMatch(/\|\s*6\+\s*\|/);
  });

  it('lista os alertas e as contestações', () => {
    for (const a of r.alertas) expect(md).toContain(a);
    expect(md).toContain('Especial Dois');
    expect(md).toContain('Padrão Seis');
  });

  it('não vaza travessão, undefined, NaN nem null', () => {
    expect(md).not.toContain('—');
    expect(md).not.toMatch(/\bundefined\b/);
    expect(md).not.toMatch(/\bNaN\b/);
    expect(md).not.toMatch(/\bnull\b/);
  });

  it('relatório vazio também renderiza sem lixo', () => {
    const md0 = relatorioParaMarkdown(agregarRetroativo([]), { ciclo: 'vazio', amostra: 0, modelo: 'm', variante: null });
    expect(md0).toContain('vazio');
    expect(md0).not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b/);
    expect(md0).not.toContain('—');
  });
});
