// Invariantes da classificação de elegibilidade ("isto é projeto?") — função PURA,
// espelho de normalizarComplexidade. As invariantes existem porque reprovar um projeto
// é visível ao autor: nunca reprovar sem motivo, nunca reprovar um especial, nunca
// deixar a coluna "Classificação" sem texto.
import { describe, it, expect } from 'vitest';
import { normalizarClassificacao, decidirStatusSubmissao } from '@/lib/agents/analyzer';

describe('normalizarClassificacao — caminho felizes', () => {
  it('preserva claro_sim com justificativa', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_sim',
      justificativa: 'Roda todo dia 1º; o ganho aparece no relatório de conciliação.',
    });
    expect(r.classificacao).toBe('claro_sim');
    expect(r.justificativa).toContain('conciliação');
    expect(r.motivo).toBeNull();
    expect(r.ajuste).toBeNull();
  });

  it('preserva claro_nao QUANDO há motivo não-vazio', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_nao',
      justificativa: 'Peça única, sem indicador verificável.',
      motivo: 'Esta entrega rodou uma única vez e não há indicador verificável.',
    });
    expect(r.classificacao).toBe('claro_nao');
    expect(r.motivo).toContain('uma única vez');
    expect(r.ajuste).toBeNull();
  });

  it('preserva zona_cinzenta', () => {
    const r = normalizarClassificacao({
      classificacao: 'zona_cinzenta',
      justificativa: 'Recorrência sim; rastreabilidade não informada.',
    });
    expect(r.classificacao).toBe('zona_cinzenta');
  });

  it('descarta motivo de reprovação quando não é claro_nao (não vaza para o autor)', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_sim',
      justificativa: 'ok',
      motivo: 'texto de reprovação que o LLM deixou sobrando',
    });
    expect(r.motivo).toBeNull();
  });
});

describe('normalizarClassificacao — NUNCA reprova sem explicar', () => {
  it.each([undefined, null, '', '   '])(
    'claro_nao com motivo %p é rebaixado para zona_cinzenta',
    (motivo) => {
      const r = normalizarClassificacao({
        classificacao: 'claro_nao',
        justificativa: 'Sem recorrência.',
        motivo: motivo as string | null | undefined,
      });
      expect(r.classificacao).toBe('zona_cinzenta');
      expect(r.motivo).toBeNull();
      expect(r.ajuste).toMatch(/motivo/i);
    },
  );
});

describe('normalizarClassificacao — projeto especial nunca reprova automático', () => {
  it('claro_nao + especial → zona_cinzenta', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_nao',
      justificativa: 'Sem indicador objetivo.',
      motivo: 'Não há indicador verificável.',
      especial: true,
    });
    expect(r.classificacao).toBe('zona_cinzenta');
    expect(r.motivo).toBeNull();
    expect(r.ajuste).toMatch(/especial/i);
  });

  it('especial classificado como claro_sim/zona_cinzenta passa intacto', () => {
    expect(normalizarClassificacao({ classificacao: 'claro_sim', justificativa: 'x', especial: true }).classificacao)
      .toBe('claro_sim');
  });
});

describe('normalizarClassificacao — fluxo direto de liderança nunca reprova automático', () => {
  it('claro_nao + fluxoDireto → zona_cinzenta (validação humana), sem motivo', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_nao',
      justificativa: 'Sem indicador objetivo.',
      motivo: 'Não há indicador verificável.',
      fluxoDireto: true,
    });
    expect(r.classificacao).toBe('zona_cinzenta');
    expect(r.motivo).toBeNull();
    expect(r.ajuste).toMatch(/liderança|direto/i);
  });

  it('liderança classificada como claro_sim passa intacta', () => {
    expect(
      normalizarClassificacao({ classificacao: 'claro_sim', justificativa: 'x', fluxoDireto: true })
        .classificacao,
    ).toBe('claro_sim');
  });
});

describe('normalizarClassificacao — materialidade alta não reprova sozinha', () => {
  it('claro_nao com materialidade > R$ 5k/mês → zona_cinzenta (validação humana)', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_nao',
      justificativa: 'Evidência fraca.',
      motivo: 'Falta indicador.',
      materialidade: 12000,
    });
    expect(r.classificacao).toBe('zona_cinzenta');
    expect(r.ajuste).toMatch(/materialidade/i);
  });

  it('não rebaixa claro_sim por causa do valor (o gate de materialidade age no STATUS, não na régua)', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_sim',
      justificativa: 'Recorrente e verificável no ERP.',
      materialidade: 90000,
    });
    expect(r.classificacao).toBe('claro_sim');
    expect(r.ajuste).toBeNull();
  });

  it('exatamente no teto (R$ 5.000) não dispara — é > e não >=', () => {
    const r = normalizarClassificacao({
      classificacao: 'claro_nao',
      justificativa: 'Peça única.',
      motivo: 'Rodou uma vez.',
      materialidade: 5000,
    });
    expect(r.classificacao).toBe('claro_nao');
  });
});

describe('normalizarClassificacao — valor inválido e justificativa vazia', () => {
  it.each([undefined, null, '', 'claro_talvez', 'CLARO_NAO_MESMO'])(
    'classificação %p cai em zona_cinzenta (fallback conservador)',
    (valor) => {
      const r = normalizarClassificacao({
        classificacao: valor as string | null | undefined,
        justificativa: 'algo',
      });
      expect(r.classificacao).toBe('zona_cinzenta');
    },
  );

  it('aceita o valor com espaços/caixa alta ao redor', () => {
    expect(normalizarClassificacao({ classificacao: ' Claro_Sim ', justificativa: 'x' }).classificacao)
      .toBe('claro_sim');
  });

  it.each([undefined, null, '', '   '])(
    'justificativa %p vira fallback determinístico (a coluna nunca fica sem texto)',
    (just) => {
      const r = normalizarClassificacao({
        classificacao: 'claro_sim',
        justificativa: just as string | null | undefined,
      });
      expect(r.justificativa.trim().length).toBeGreaterThan(20);
    },
  );

  it('o fallback da justificativa não repete o rótulo (a célula do Sheets já o tem)', () => {
    const r = normalizarClassificacao({ classificacao: 'zona_cinzenta', justificativa: '' });
    expect(r.justificativa.toLowerCase()).not.toContain('zona cinzenta —');
  });
});

// ── Precedência de status (critérios de aceitação 1-3 do plano) ──────────────
describe('decidirStatusSubmissao', () => {
  const base = { ehEspecial: false, materialidade: 0, vereditoAprovado: true };

  it('AC1 — claro_nao vira rejeitado + "Reprovado" na planilha, mesmo com veredito aprovado', () => {
    expect(decidirStatusSubmissao({ ...base, classificacao: 'claro_nao' })).toEqual({
      status: 'rejeitado',
      statusSheet: 'Reprovado',
    });
  });

  it('AC2 — claro_sim não muda nada: aprovado + "Pendente" (regra TEMPORÁRIA intacta)', () => {
    expect(decidirStatusSubmissao({ ...base, classificacao: 'claro_sim' })).toEqual({
      status: 'aprovado',
      statusSheet: 'Pendente',
    });
  });

  it('AC3 — zona_cinzenta vai para em_validacao com "Pendente"', () => {
    expect(decidirStatusSubmissao({ ...base, classificacao: 'zona_cinzenta' })).toEqual({
      status: 'em_validacao',
      statusSheet: 'Pendente',
    });
  });

  it('AC6 — projeto especial nunca é reprovado (nem se a classificação vier claro_nao)', () => {
    expect(
      decidirStatusSubmissao({ ...base, classificacao: 'claro_nao', ehEspecial: true }),
    ).toEqual({ status: 'em_validacao', statusSheet: 'Pendente' });
  });

  it('fluxo direto de liderança nunca é reprovado (claro_nao → em_validacao/"Pendente")', () => {
    expect(
      decidirStatusSubmissao({ ...base, classificacao: 'claro_nao', fluxoDireto: true }),
    ).toEqual({ status: 'em_validacao', statusSheet: 'Pendente' });
  });

  it('fluxo direto de liderança vai sempre para validação humana (claro_sim → em_validacao)', () => {
    expect(
      decidirStatusSubmissao({ ...base, classificacao: 'claro_sim', fluxoDireto: true }),
    ).toEqual({ status: 'em_validacao', statusSheet: 'Pendente' });
  });

  it('mantém o gate de materialidade (> R$ 5k → em_validacao/"Pendente")', () => {
    expect(
      decidirStatusSubmissao({ ...base, classificacao: 'claro_sim', materialidade: 8000 }),
    ).toEqual({ status: 'em_validacao', statusSheet: 'Pendente' });
  });

  it('mantém o caminho antigo do veredito reprovado → "Reenvio Pendente"', () => {
    expect(
      decidirStatusSubmissao({ ...base, classificacao: 'claro_sim', vereditoAprovado: false }),
    ).toEqual({ status: 'rejeitado', statusSheet: 'Reenvio Pendente' });
  });

  it('classificação ausente (submissão legada) não muda o comportamento anterior', () => {
    expect(decidirStatusSubmissao({ ...base, classificacao: null })).toEqual({
      status: 'aprovado',
      statusSheet: 'Pendente',
    });
    expect(
      decidirStatusSubmissao({ ...base, classificacao: null, vereditoAprovado: false }),
    ).toEqual({ status: 'rejeitado', statusSheet: 'Reenvio Pendente' });
  });

  it('nunca devolve "Reprovado" para quem não é claro_nao', () => {
    for (const classificacao of ['claro_sim', 'zona_cinzenta', null, '', 'inventado']) {
      for (const vereditoAprovado of [true, false]) {
        for (const materialidade of [0, 90000]) {
          const r = decidirStatusSubmissao({
            classificacao,
            ehEspecial: false,
            materialidade,
            vereditoAprovado,
          });
          expect(r.statusSheet).not.toBe('Reprovado');
        }
      }
    }
  });
});
