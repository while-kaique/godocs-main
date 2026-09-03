// T14 — Cérebro A (mérito) com tools + auditoria de valor (`src/lib/avaliacao/cerebro-merito.ts`).
//
// Prende o contrato PURO do cérebro de mérito do time unificado (plano
// `docs/plans/regua-estrelas-e-time-unificado.md`, §11.3, D18): 4 dimensões fixas
// (plausibilidade das horas · financeiro · precedente · evidência), prompt por dimensão com
// o dossiê e os vizinhos, normalização defensiva do JSON do LLM, fallback quando o LLM não
// responde, e a consolidação por QUÓRUM — D18 é o ponto central: critérios dos PADRÕES são
// plausibilidade com ferramenta, NÃO gate. O agente PERGUNTA ao autor, não reprova calado.
// Por isso `ajuste` só sai com pergunta concreta; sem saber o que perguntar, vai a `humano`.
// E a pergunta ao autor JAMAIS carrega R$ (valor/hora por cargo é escondido do submissor).
import { describe, it, expect } from 'vitest';
import {
  DIMENSOES_MERITO,
  QUORUM_AJUSTE,
  buildPromptMerito,
  normalizarJulgamentoMerito,
  julgamentoFallback,
  consolidarMerito,
  type DimensaoMerito,
  type JulgamentoMerito,
  type VizinhoTexto,
} from '@/lib/avaliacao/cerebro-merito';
import { dossieDaLinhaPlanilha, dossieParaTexto } from '@/lib/avaliacao/dossie';

// ── fixtures ─────────────────────────────────────────────────────────────────

function linhaPlanilha(): Record<string, string> {
  return {
    'ID Projeto': 'abc123',
    Projeto: 'Robô de Conciliação Bancária',
    Status: 'Pendente',
    Estrelas: '0',
    Classificação: 'zona_cinzenta',
    'Motivo Reprovado': '—',
    'Motivo Reenvio': '—',
    'Aprovação do Líder': 'Pré-aprovado',
    'Justificativa Aprovação do Líder': 'Parecer: Pré-aprovado por Kelly',
    Observações: 'Parecer do analisador aqui',
    'Memorial de Saving': '### Contexto\nUm analista conciliava extratos à mão, 500 h por mês.',
    'Receita Memorial': '—',
    'Receita Mensal': '0',
    'Tipo de Receita': '—',
    Complexidade: 'Média',
    'Saving Horas Real': '500',
    'Saving Horas Escalado': '0',
    'Justificativa Saving Escalado e Real': 'Antes fazia à mão 500h; a automação cobriu tudo.',
    'Alocação Ganhos': 'Mais entrega: passou a fechar o mês em D+1.',
  };
}

function dossieTexto(): string {
  const d = dossieDaLinhaPlanilha(linhaPlanilha());
  expect(d).not.toBeNull();
  return dossieParaTexto(d!);
}

function vizinhos(): VizinhoTexto[] {
  return [
    { id: 'v1', nome: 'Conciliação Fiscal', status: 'Aprovado', similaridade: 0.91, resumo: 'Concilia notas.' },
    { id: 'v2', nome: 'Robô de Extratos', status: 'Reprovado', similaridade: 0.77, resumo: 'Lê extratos.' },
  ];
}

function julgamento(
  dimensao: DimensaoMerito,
  extra: Partial<JulgamentoMerito> = {},
): JulgamentoMerito {
  return {
    dimensao,
    preocupa: false,
    argumento: `Argumento sobre ${dimensao}.`,
    evidencias: [],
    pergunta_ao_autor: null,
    valor: null,
    fallback: false,
    ...extra,
  };
}

function systemDe(msgs: ReturnType<typeof buildPromptMerito>): string {
  return msgs[0].content;
}
function userDe(msgs: ReturnType<typeof buildPromptMerito>): string {
  return msgs[1].content;
}

// ── 1. dimensões + prompt ─────────────────────────────────────────────────────

describe('DIMENSOES_MERITO e buildPromptMerito', () => {
  it('as 4 dimensões, nessa ordem', () => {
    expect(DIMENSOES_MERITO).toEqual(['plausibilidade_horas', 'financeiro', 'precedente', 'evidencia']);
  });

  it('devolve [system, user] para toda dimensão', () => {
    for (const dimensao of DIMENSOES_MERITO) {
      const msgs = buildPromptMerito({ dimensao, dossieTexto: dossieTexto(), vizinhos: vizinhos() });
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('system');
      expect(msgs[1].role).toBe('user');
      expect(msgs[0].content.length).toBeGreaterThan(0);
      expect(msgs[1].content.length).toBeGreaterThan(0);
    }
  });

  it('o system de cada dimensão é diferente dos outros três e cita a própria dimensão', () => {
    const systems = DIMENSOES_MERITO.map((dimensao) =>
      systemDe(buildPromptMerito({ dimensao, dossieTexto: dossieTexto(), vizinhos: [] })),
    );
    expect(new Set(systems).size).toBe(4);
    DIMENSOES_MERITO.forEach((dimensao, i) => {
      expect(systems[i]).toContain(dimensao);
    });
  });

  it('plausibilidade_horas cita o teto 220 e a economia alta 44', () => {
    const s = systemDe(buildPromptMerito({ dimensao: 'plausibilidade_horas', dossieTexto: dossieTexto(), vizinhos: [] }));
    expect(s).toContain('220');
    expect(s).toContain('44');
  });

  it('financeiro pede valor_sugerido e cita "absurdo"', () => {
    const s = systemDe(buildPromptMerito({ dimensao: 'financeiro', dossieTexto: dossieTexto(), vizinhos: [] }));
    expect(s).toContain('valor_sugerido');
    expect(s.toLowerCase()).toContain('absurdo');
  });

  it('precedente cita vizinhos ou aprovados', () => {
    const s = systemDe(buildPromptMerito({ dimensao: 'precedente', dossieTexto: dossieTexto(), vizinhos: [] })).toLowerCase();
    expect(/vizinhos|aprovados/.test(s)).toBe(true);
  });

  it('evidencia cita anexo ou evidência', () => {
    const s = systemDe(buildPromptMerito({ dimensao: 'evidencia', dossieTexto: dossieTexto(), vizinhos: [] })).toLowerCase();
    expect(/anexo|evidência/.test(s)).toBe(true);
  });

  it('todo system exige o JSON (preocupa, argumento, evidencias, pergunta_ao_autor) e proíbe R$ por hora na pergunta', () => {
    for (const dimensao of DIMENSOES_MERITO) {
      const s = systemDe(buildPromptMerito({ dimensao, dossieTexto: dossieTexto(), vizinhos: [] }));
      expect(s).toContain('preocupa');
      expect(s).toContain('argumento');
      expect(s).toContain('evidencias');
      expect(s).toContain('pergunta_ao_autor');
      expect(s).toContain('R$');
      expect(/valor\/hora|valor por hora/i.test(s)).toBe(true);
    }
  });

  it('o user contém o dossiê inteiro', () => {
    const texto = dossieTexto();
    const u = userDe(buildPromptMerito({ dimensao: 'financeiro', dossieTexto: texto, vizinhos: [] }));
    expect(u).toContain(texto);
  });

  it('com vizinhos, o user traz nome, status e similaridade de cada um', () => {
    const u = userDe(buildPromptMerito({ dimensao: 'precedente', dossieTexto: dossieTexto(), vizinhos: vizinhos() }));
    expect(u).toContain('Conciliação Fiscal');
    expect(u).toContain('Aprovado');
    expect(u).toContain('0.91');
    expect(u).toContain('Robô de Extratos');
    expect(u).toContain('Reprovado');
    expect(u).toContain('0.77');
  });

  it('sem vizinhos, o user avisa', () => {
    const u = userDe(buildPromptMerito({ dimensao: 'precedente', dossieTexto: dossieTexto(), vizinhos: [] })).toLowerCase();
    expect(/sem vizinhos|nenhum vizinho/.test(u)).toBe(true);
  });

  it('com outrosJulgamentos (réplica), o user traz o argumento de cada um e fala em réplica/debate', () => {
    const outros = [
      julgamento('financeiro', { preocupa: true, argumento: 'ARGUMENTO-FIN-XYZ: o valor por hora está fora da curva.' }),
      julgamento('evidencia', { argumento: 'ARGUMENTO-EVI-QWE: anexo confere com o memorial.' }),
    ];
    const u = userDe(
      buildPromptMerito({ dimensao: 'plausibilidade_horas', dossieTexto: dossieTexto(), vizinhos: [], outrosJulgamentos: outros }),
    );
    expect(u).toContain('ARGUMENTO-FIN-XYZ');
    expect(u).toContain('ARGUMENTO-EVI-QWE');
    expect(/réplica|debate/i.test(u)).toBe(true);
  });

  it('com ferramentasTexto, o system o contém', () => {
    const ferramentas = 'FERRAMENTA-TETO: 220h/pessoa; linha 1 tem 500h → acima do teto.';
    const s = systemDe(
      buildPromptMerito({ dimensao: 'plausibilidade_horas', dossieTexto: dossieTexto(), vizinhos: [], ferramentasTexto: ferramentas }),
    );
    expect(s).toContain(ferramentas);
  });
});

// ── 2/3. normalização ─────────────────────────────────────────────────────────

describe('normalizarJulgamentoMerito', () => {
  it('caminho feliz do financeiro: todos os campos, fallback false, valor_sugerido 4400', () => {
    const j = normalizarJulgamentoMerito(
      {
        preocupa: true,
        argumento: 'O valor implica R$ 147,40/hora para um analista.',
        evidencias: ['saving 8.844 com 60h de 1 analista'],
        pergunta_ao_autor: 'Quantas pessoas executavam a rotina?',
        valor: { absurdo: true, valor_sugerido: 4400, justificativa: 'Valor/hora de analista fica em torno de R$ 73.' },
      },
      'financeiro',
    );
    expect(j).not.toBeNull();
    expect(j!.dimensao).toBe('financeiro');
    expect(j!.preocupa).toBe(true);
    expect(j!.argumento).toBe('O valor implica R$ 147,40/hora para um analista.');
    expect(j!.evidencias).toEqual(['saving 8.844 com 60h de 1 analista']);
    expect(j!.pergunta_ao_autor).toBe('Quantas pessoas executavam a rotina?');
    expect(j!.fallback).toBe(false);
    expect(j!.valor).not.toBeNull();
    expect(j!.valor!.absurdo).toBe(true);
    expect(j!.valor!.valor_sugerido).toBe(4400);
    expect(j!.valor!.justificativa.length).toBeGreaterThan(0);
  });

  it('dimensão ≠ financeiro com valor informado → valor null (só o financeiro audita valor)', () => {
    for (const dimensao of ['plausibilidade_horas', 'precedente', 'evidencia'] as const) {
      const j = normalizarJulgamentoMerito(
        { preocupa: false, argumento: 'ok', evidencias: [], pergunta_ao_autor: null, valor: { absurdo: true, valor_sugerido: 1, justificativa: 'x' } },
        dimensao,
      );
      expect(j).not.toBeNull();
      expect(j!.valor).toBeNull();
    }
  });

  it('preocupa como string "true"/"sim" → true; ausente → false', () => {
    expect(normalizarJulgamentoMerito({ preocupa: 'true', argumento: 'a' }, 'precedente')!.preocupa).toBe(true);
    expect(normalizarJulgamentoMerito({ preocupa: 'sim', argumento: 'a' }, 'precedente')!.preocupa).toBe(true);
    expect(normalizarJulgamentoMerito({ argumento: 'a' }, 'precedente')!.preocupa).toBe(false);
  });

  it('evidencias não-array → []; com vazios → filtra', () => {
    expect(normalizarJulgamentoMerito({ preocupa: false, argumento: 'a', evidencias: 'texto' }, 'evidencia')!.evidencias).toEqual([]);
    expect(
      normalizarJulgamentoMerito({ preocupa: false, argumento: 'a', evidencias: ['', '  ', 'anexo confere', 42, null] }, 'evidencia')!
        .evidencias,
    ).toEqual(['anexo confere']);
  });

  it('pergunta_ao_autor vazia → null', () => {
    expect(normalizarJulgamentoMerito({ preocupa: true, argumento: 'a', pergunta_ao_autor: '' }, 'evidencia')!.pergunta_ao_autor).toBeNull();
    expect(normalizarJulgamentoMerito({ preocupa: true, argumento: 'a', pergunta_ao_autor: '   ' }, 'evidencia')!.pergunta_ao_autor).toBeNull();
    expect(normalizarJulgamentoMerito({ preocupa: true, argumento: 'a' }, 'evidencia')!.pergunta_ao_autor).toBeNull();
  });

  it('argumento ausente → string padrão não vazia; > 600 chars → cortado em 600 com "…"', () => {
    const semArg = normalizarJulgamentoMerito({ preocupa: false }, 'precedente')!;
    expect(typeof semArg.argumento).toBe('string');
    expect(semArg.argumento.trim().length).toBeGreaterThan(0);

    const longo = 'x'.repeat(700);
    const cortado = normalizarJulgamentoMerito({ preocupa: false, argumento: longo }, 'precedente')!;
    expect(cortado.argumento.length).toBe(600);
    expect(cortado.argumento.endsWith('…')).toBe(true);
  });

  it('bruto não-objeto → null', () => {
    expect(normalizarJulgamentoMerito(null, 'financeiro')).toBeNull();
    expect(normalizarJulgamentoMerito(undefined, 'financeiro')).toBeNull();
    expect(normalizarJulgamentoMerito('texto', 'financeiro')).toBeNull();
    expect(normalizarJulgamentoMerito(42, 'financeiro')).toBeNull();
    expect(normalizarJulgamentoMerito([1, 2], 'financeiro')).toBeNull();
  });

  it('segurança: a pergunta ao autor é sanitizada (R$ vira "[valor]"), o argumento não', () => {
    const j = normalizarJulgamentoMerito(
      {
        preocupa: true,
        argumento: 'Seu saving de R$ 147,40/hora está alto.',
        evidencias: [],
        pergunta_ao_autor: 'Seu saving de R$ 147,40/hora está alto, confirma?',
        valor: null,
      },
      'financeiro',
    )!;
    expect(j.pergunta_ao_autor).not.toBeNull();
    expect(j.pergunta_ao_autor).not.toContain('R$');
    expect(j.pergunta_ao_autor).not.toContain('147,40');
    expect(j.pergunta_ao_autor).toContain('[valor]');
    expect(j.pergunta_ao_autor).toContain('confirma');
    // o argumento é interno: fica intacto
    expect(j.argumento).toContain('R$ 147,40');
  });
});

// ── 4. fallback ───────────────────────────────────────────────────────────────

describe('julgamentoFallback', () => {
  it('não preocupa, marca fallback, argumento cita o motivo e "fallback", resto vazio/null', () => {
    const j = julgamentoFallback('precedente', 'LLM sem resposta');
    expect(j.dimensao).toBe('precedente');
    expect(j.preocupa).toBe(false);
    expect(j.fallback).toBe(true);
    expect(j.argumento).toContain('LLM sem resposta');
    expect(j.argumento.toLowerCase()).toContain('fallback');
    expect(j.evidencias).toEqual([]);
    expect(j.pergunta_ao_autor).toBeNull();
    expect(j.valor).toBeNull();
  });
});

// ── 5–10. consolidação ────────────────────────────────────────────────────────

describe('consolidarMerito', () => {
  it('QUORUM_AJUSTE é 2', () => {
    expect(QUORUM_AJUSTE).toBe(2);
  });

  it('0 preocupações → aprovar, listas vazias', () => {
    const s = consolidarMerito(DIMENSOES_MERITO.map((d) => julgamento(d)), { temVizinhos: true });
    expect(s.veredito).toBe('aprovar');
    expect(s.preocupacoes).toEqual([]);
    expect(s.perguntas_ao_autor).toEqual([]);
    expect(s.ressalvas).toEqual([]);
  });

  it('2+ preocupações com pergunta → ajuste; perguntas únicas na ordem das dimensões; preocupacoes lista as dimensões', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas', { preocupa: true, pergunta_ao_autor: 'Quantas pessoas a linha soma?' }),
        julgamento('financeiro', { preocupa: true, pergunta_ao_autor: 'Quantas pessoas a linha soma?' }),
        julgamento('precedente'),
        julgamento('evidencia', { preocupa: true, pergunta_ao_autor: 'Há um anexo que comprove a medição?' }),
      ],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('ajuste');
    expect(s.preocupacoes).toEqual(['plausibilidade_horas', 'financeiro', 'evidencia']);
    expect(s.perguntas_ao_autor).toEqual(['Quantas pessoas a linha soma?', 'Há um anexo que comprove a medição?']);
  });

  it('2+ preocupações e NENHUMA pergunta → humano', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas', { preocupa: true }),
        julgamento('financeiro', { preocupa: true }),
        julgamento('precedente'),
        julgamento('evidencia'),
      ],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('humano');
    expect(s.perguntas_ao_autor).toEqual([]);
    expect(s.preocupacoes).toEqual(['plausibilidade_horas', 'financeiro']);
  });

  it('1 preocupação: plausibilidade_horas com pergunta → ajuste', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas', { preocupa: true, pergunta_ao_autor: 'Como uma pessoa executava 500 h por mês?' }),
        julgamento('financeiro'),
        julgamento('precedente'),
        julgamento('evidencia'),
      ],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('ajuste');
    expect(s.perguntas_ao_autor).toEqual(['Como uma pessoa executava 500 h por mês?']);
  });

  it('1 preocupação: plausibilidade_horas SEM pergunta → humano', () => {
    const s = consolidarMerito(
      [julgamento('plausibilidade_horas', { preocupa: true }), julgamento('financeiro'), julgamento('precedente'), julgamento('evidencia')],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('humano');
  });

  it('1 preocupação: financeiro com absurdo true e pergunta → ajuste; sem pergunta → humano', () => {
    const base = [julgamento('plausibilidade_horas'), julgamento('precedente'), julgamento('evidencia')];
    const comPergunta = consolidarMerito(
      [
        ...base,
        julgamento('financeiro', {
          preocupa: true,
          pergunta_ao_autor: 'Quantas pessoas executavam a rotina?',
          valor: { absurdo: true, valor_sugerido: 4400, justificativa: 'fora da curva' },
        }),
      ],
      { temVizinhos: true },
    );
    expect(comPergunta.veredito).toBe('ajuste');

    const semPergunta = consolidarMerito(
      [...base, julgamento('financeiro', { preocupa: true, valor: { absurdo: true, valor_sugerido: null, justificativa: 'fora da curva' } })],
      { temVizinhos: true },
    );
    expect(semPergunta.veredito).toBe('humano');
  });

  it('1 preocupação: financeiro com absurdo false sozinho → aprovar com ressalva', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas'),
        julgamento('financeiro', {
          preocupa: true,
          pergunta_ao_autor: 'O valor foi medido em qual período?',
          valor: { absurdo: false, valor_sugerido: null, justificativa: 'plausível, só falta contexto' },
        }),
        julgamento('precedente'),
        julgamento('evidencia'),
      ],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('aprovar');
    expect(s.preocupacoes).toEqual(['financeiro']);
    expect(s.ressalvas).toHaveLength(1);
    expect(s.ressalvas[0]).toContain('financeiro');
  });

  it('1 preocupação: precedente sozinho → aprovar com ressalva citando a dimensão', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas'),
        julgamento('financeiro'),
        julgamento('precedente', { preocupa: true, pergunta_ao_autor: 'Como este difere do projeto reprovado X?' }),
        julgamento('evidencia'),
      ],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('aprovar');
    expect(s.preocupacoes).toEqual(['precedente']);
    expect(s.ressalvas).toHaveLength(1);
    expect(s.ressalvas[0]).toContain('precedente');
  });

  it('1 preocupação: evidencia sozinha → aprovar com ressalva citando a dimensão', () => {
    const s = consolidarMerito(
      [julgamento('plausibilidade_horas'), julgamento('financeiro'), julgamento('precedente'), julgamento('evidencia', { preocupa: true })],
      { temVizinhos: false },
    );
    expect(s.veredito).toBe('aprovar');
    expect(s.preocupacoes).toEqual(['evidencia']);
    expect(s.ressalvas).toHaveLength(1);
    expect(s.ressalvas[0]).toContain('evidencia');
  });

  it('valor da saída = valor do julgamento financeiro; null quando não há', () => {
    const valor = { absurdo: true, valor_sugerido: 4400, justificativa: 'fora da curva' };
    const com = consolidarMerito(
      [julgamento('plausibilidade_horas'), julgamento('financeiro', { preocupa: true, pergunta_ao_autor: 'p?', valor }), julgamento('precedente'), julgamento('evidencia')],
      { temVizinhos: true },
    );
    expect(com.valor).toEqual(valor);

    const semFinanceiro = consolidarMerito([julgamento('plausibilidade_horas'), julgamento('precedente')], { temVizinhos: true });
    expect(semFinanceiro.valor).toBeNull();

    const financeiroNulo = consolidarMerito(DIMENSOES_MERITO.map((d) => julgamento(d)), { temVizinhos: true });
    expect(financeiroNulo.valor).toBeNull();
  });

  it('sinais: temEvidenciaCitada só de julgamento não-fallback; temVizinhos vem do ctx', () => {
    const soFallbackComEvidencia = consolidarMerito(
      [julgamento('evidencia', { fallback: true, evidencias: ['anexo X'] }), julgamento('precedente')],
      { temVizinhos: false },
    );
    expect(soFallbackComEvidencia.sinais.temEvidenciaCitada).toBe(false);
    expect(soFallbackComEvidencia.sinais.temVizinhos).toBe(false);

    const comEvidencia = consolidarMerito([julgamento('evidencia', { evidencias: ['anexo X'] }), julgamento('precedente')], { temVizinhos: true });
    expect(comEvidencia.sinais.temEvidenciaCitada).toBe(true);
    expect(comEvidencia.sinais.temVizinhos).toBe(true);
  });

  it('fallback NÃO conta como preocupação: 3 fallbacks + 1 plausibilidade com pergunta → ajuste', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas', { preocupa: true, pergunta_ao_autor: 'Quantas pessoas a linha soma?' }),
        julgamentoFallback('financeiro', 'timeout'),
        julgamentoFallback('precedente', 'timeout'),
        julgamentoFallback('evidencia', 'timeout'),
      ],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('ajuste');
    expect(s.preocupacoes).toEqual(['plausibilidade_horas']);
    expect(s.perguntas_ao_autor).toEqual(['Quantas pessoas a linha soma?']);
  });

  it('fallback com preocupa true (defensivo) segue fora das preocupações', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas'),
        julgamento('financeiro', { fallback: true, preocupa: true, pergunta_ao_autor: 'x?' }),
        julgamento('precedente', { fallback: true, preocupa: true, pergunta_ao_autor: 'y?' }),
        julgamento('evidencia'),
      ],
      { temVizinhos: true },
    );
    expect(s.preocupacoes).toEqual([]);
    expect(s.veredito).toBe('aprovar');
  });

  it('caso do plano ("500 h para uma pessoa") → ajuste, 2 perguntas, nenhuma com R$', () => {
    const s = consolidarMerito(
      [
        julgamento('plausibilidade_horas', {
          preocupa: true,
          evidencias: ['Saving Horas Real: 500'],
          pergunta_ao_autor: 'Como uma pessoa executava 500 h por mês? Quantas pessoas ou unidades a linha soma?',
        }),
        julgamento('financeiro', {
          preocupa: true,
          evidencias: ['500h de 1 analista'],
          pergunta_ao_autor: 'O valor considera quantas pessoas na rotina?',
          valor: { absurdo: true, valor_sugerido: null, justificativa: 'horas impossíveis para 1 pessoa inflam o total' },
        }),
        julgamento('precedente'),
        julgamento('evidencia'),
      ],
      { temVizinhos: true },
    );
    expect(s.veredito).toBe('ajuste');
    expect(s.perguntas_ao_autor).toHaveLength(2);
    for (const p of s.perguntas_ao_autor) expect(p).not.toContain('R$');
    expect(s.preocupacoes).toEqual(['plausibilidade_horas', 'financeiro']);
    expect(s.valor?.absurdo).toBe(true);
  });

  it('sem julgamento nenhum → humano, com ressalva sobre a ausência', () => {
    const s = consolidarMerito([], { temVizinhos: false });
    expect(s.veredito).toBe('humano');
    expect(s.julgamentos).toEqual([]);
    expect(s.preocupacoes).toEqual([]);
    expect(s.perguntas_ao_autor).toEqual([]);
    expect(s.valor).toBeNull();
    expect(s.ressalvas.length).toBeGreaterThanOrEqual(1);
    expect(/julgamento/i.test(s.ressalvas.join(' '))).toBe(true);
  });
});
