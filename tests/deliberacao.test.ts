import { describe, it, expect } from 'vitest';
import {
  LIMIAR_GRAU_ALTA,
  LIMIAR_GRAU_MEDIA,
  MAX_RODADAS_DELIBERACAO,
  grauConfianca,
  conciliarComCetico,
  avancarDeliberacao,
} from '@/lib/deliberacao';

describe('constantes', () => {
  it('valores fixos', () => {
    expect(LIMIAR_GRAU_ALTA).toBe(0.8);
    expect(LIMIAR_GRAU_MEDIA).toBe(0.6);
    expect(MAX_RODADAS_DELIBERACAO).toBe(5);
  });
});

describe('grauConfianca', () => {
  it('>=0.8 → alta', () => {
    expect(grauConfianca(0.8)).toBe('alta');
    expect(grauConfianca(0.95)).toBe('alta');
  });
  it('n>1 → alta', () => {
    expect(grauConfianca(1.5)).toBe('alta');
  });
  it('[0.6,0.8) → media', () => {
    expect(grauConfianca(0.6)).toBe('media');
    expect(grauConfianca(0.79)).toBe('media');
  });
  it('<0.6 → baixa', () => {
    expect(grauConfianca(0.59)).toBe('baixa');
    expect(grauConfianca(0)).toBe('baixa');
  });
  it('negativo/NaN/não-finito → baixa', () => {
    expect(grauConfianca(-1)).toBe('baixa');
    expect(grauConfianca(NaN)).toBe('baixa');
    expect(grauConfianca(Infinity)).toBe('baixa');
  });
});

describe('conciliarComCetico', () => {
  it('isento → intacto, ceticoRefutou false, grau alta', () => {
    const agregado = {
      veredito: 'isento' as const,
      confianca: 0.3,
      aplicarEmValidacao: false,
      divergencia: false,
      isento: true,
      motivos: ['sem líder'],
    };
    const r = conciliarComCetico(agregado, { refuta: true, confianca: 0.9, motivo: 'x' });
    expect(r.veredito).toBe('isento');
    expect(r.confianca).toBe(0.3);
    expect(r.motivos).toEqual(['sem líder']);
    expect(r.ceticoRefutou).toBe(false);
    expect(r.grau).toBe('alta');
  });

  it('cético refuta aprovar → rebaixa para em_validacao', () => {
    const agregado = {
      veredito: 'aprovar' as const,
      confianca: 0.9,
      aplicarEmValidacao: false,
      divergencia: false,
      isento: false,
      motivos: ['ok'],
    };
    const r = conciliarComCetico(agregado, { refuta: true, confianca: 0.4, motivo: 'FTE raspando' });
    expect(r.veredito).toBe('em_validacao');
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.ceticoRefutou).toBe(true);
    // confianca = min(0.9, 1 - 0.4) = 0.6
    expect(r.confianca).toBeCloseTo(0.6, 10);
    expect(r.motivos).toContain('FTE raspando');
    expect(r.motivos).toContain('ok');
    expect(r.grau).toBe(grauConfianca(0.6));
  });

  it('cético refuta com motivo null → não adiciona motivo nulo', () => {
    const agregado = {
      veredito: 'aprovar' as const,
      confianca: 0.7,
      aplicarEmValidacao: false,
      divergencia: false,
      isento: false,
      motivos: ['base'],
    };
    const r = conciliarComCetico(agregado, { refuta: true, confianca: 0.5, motivo: null });
    expect(r.veredito).toBe('em_validacao');
    expect(r.motivos).toEqual(['base']);
  });

  it('cético NÃO refuta aprovar → intacto (anti-bajulação: nunca vira em_validacao à toa)', () => {
    const agregado = {
      veredito: 'aprovar' as const,
      confianca: 0.85,
      aplicarEmValidacao: false,
      divergencia: false,
      isento: false,
      motivos: ['ok'],
    };
    const r = conciliarComCetico(agregado, { refuta: false, confianca: 0, motivo: null });
    expect(r.veredito).toBe('aprovar');
    expect(r.aplicarEmValidacao).toBe(false);
    expect(r.ceticoRefutou).toBe(false);
    expect(r.confianca).toBe(0.85);
    expect(r.grau).toBe('alta');
  });

  it('agregado já em_validacao + cético refuta → permanece em_validacao, ceticoRefutou false', () => {
    const agregado = {
      veredito: 'em_validacao' as const,
      confianca: 0.5,
      aplicarEmValidacao: true,
      divergencia: true,
      isento: false,
      motivos: ['divergiu'],
    };
    const r = conciliarComCetico(agregado, { refuta: true, confianca: 0.4, motivo: 'y' });
    expect(r.veredito).toBe('em_validacao');
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.ceticoRefutou).toBe(false);
    expect(r.confianca).toBe(0.5);
    expect(r.grau).toBe(grauConfianca(0.5));
  });
});

describe('avancarDeliberacao', () => {
  it('isento → estado isento, encerrada, veredito isento, confianca 1', () => {
    const r = avancarDeliberacao(
      { estado: 'deliberando', rodada: 1 },
      { agregadoVeredito: 'isento', divergencia: false, confianca: 0.2, ceticoRefuta: false },
    );
    expect(r.estado).toBe('isento');
    expect(r.veredito).toBe('isento');
    expect(r.confianca).toBe(1);
    expect(r.grau).toBe('alta');
    expect(r.encerrada).toBe(true);
    expect(r.rodada).toBe(1);
    expect(typeof r.motivo).toBe('string');
    expect(r.motivo.length).toBeGreaterThan(0);
  });

  it('consenso na rodada 1 (aprovar, sem divergência, sem refuta, confiança alta)', () => {
    const r = avancarDeliberacao(
      { estado: 'deliberando', rodada: 0 },
      { agregadoVeredito: 'aprovar', divergencia: false, confianca: 0.9, ceticoRefuta: false },
    );
    expect(r.estado).toBe('consenso');
    expect(r.veredito).toBe('aprovar');
    expect(r.rodada).toBe(1);
    expect(r.encerrada).toBe(true);
    expect(r.grau).toBe(grauConfianca(0.9));
    expect(r.motivo.length).toBeGreaterThan(0);
  });

  // ⚠️ REGRA MUDOU (01/09/2026): `aprovar` + divergência agora É consenso — o quórum de preocupação
  // já foi aplicado no agregador (ver QUORUM_PREOCUPACAO), e reexigir `!divergencia` aqui era a mesma
  // trava duplicada. O cenário "sem consenso" parte do veredito que o agregador de fato barrou.
  it('em_validacao → deliberando nas r1..r4, nao_consenso na r5', () => {
    const sinais = { agregadoVeredito: 'em_validacao' as const, divergencia: true, confianca: 0.9, ceticoRefuta: false };
    let atual: { estado?: string | null; rodada?: number | null } = { estado: null, rodada: 0 };
    const rs = [] as ReturnType<typeof avancarDeliberacao>[];
    for (let i = 0; i < 5; i++) {
      const r = avancarDeliberacao(atual as never, sinais);
      rs.push(r);
      atual = { estado: r.estado, rodada: r.rodada };
    }
    for (let i = 0; i < 4; i++) {
      expect(rs[i].estado).toBe('deliberando');
      expect(rs[i].veredito).toBe('em_validacao');
      expect(rs[i].rodada).toBe(i + 1);
      expect(rs[i].encerrada).toBe(false);
    }
    expect(rs[4].estado).toBe('nao_consenso');
    expect(rs[4].veredito).toBe('em_validacao');
    expect(rs[4].rodada).toBe(5);
    expect(rs[4].encerrada).toBe(true);
  });

  it('confiança baixa bloqueia consenso → deliberando até a r4, nao_consenso na r5', () => {
    const sinais = { agregadoVeredito: 'aprovar' as const, divergencia: false, confianca: 0.3, ceticoRefuta: false };
    let atual: { estado?: string | null; rodada?: number | null } = { estado: null, rodada: 0 };
    const rs = [] as ReturnType<typeof avancarDeliberacao>[];
    for (let i = 0; i < 5; i++) {
      const r = avancarDeliberacao(atual as never, sinais);
      rs.push(r);
      atual = { estado: r.estado, rodada: r.rodada };
    }
    for (let i = 0; i < 4; i++) expect(rs[i].estado).toBe('deliberando');
    expect(rs[4].estado).toBe('nao_consenso');
    expect(rs[4].rodada).toBe(5);
  });

  // ⚠️ REGRA MUDOU (01/09/2026): a objeção do cético NÃO bloqueia mais o consenso por si só. Quem
  // decide se ela barra é o QUÓRUM, no agregador; se o agregador disse `aprovar`, a deliberação não
  // pode desdizer — era o que travava 100% dos projetos em `nao_consenso`.
  it('cético refuta NÃO bloqueia mais o consenso (quem decide é o quórum, no agregador)', () => {
    const r = avancarDeliberacao(
      { estado: null, rodada: 0 },
      { agregadoVeredito: 'aprovar', divergencia: false, confianca: 0.9, ceticoRefuta: true },
    );
    expect(r.estado).toBe('consenso');
    expect(r.veredito).toBe('aprovar');
    expect(r.encerrada).toBe(true);
  });

  it('objeção SOLITÁRIA (aprovar + divergência) fecha consenso na r1 — não fica moendo rodadas', () => {
    const r = avancarDeliberacao(
      { estado: null, rodada: 0 },
      { agregadoVeredito: 'aprovar', divergencia: true, confianca: 0.7, ceticoRefuta: true },
    );
    expect(r.estado).toBe('consenso');
    expect(r.rodada).toBe(1);
    expect(r.encerrada).toBe(true);
  });

  it('confiança abaixo do limiar ainda bloqueia consenso mesmo com aprovar', () => {
    const r = avancarDeliberacao(
      { estado: null, rodada: 0 },
      { agregadoVeredito: 'aprovar', divergencia: false, confianca: 0.5, ceticoRefuta: false },
    );
    expect(r.estado).toBe('deliberando');
    expect(r.veredito).toBe('em_validacao');
  });

  it('limiarConfianca custom respeitado', () => {
    // confianca 0.7, limiar 0.75 → não fecha consenso
    const r = avancarDeliberacao(
      { estado: null, rodada: 0 },
      { agregadoVeredito: 'aprovar', divergencia: false, confianca: 0.7, ceticoRefuta: false, limiarConfianca: 0.75 },
    );
    expect(r.estado).toBe('deliberando');
  });

  it('estado terminal é idempotente (não incrementa rodada)', () => {
    for (const estado of ['consenso', 'nao_consenso', 'isento'] as const) {
      const r = avancarDeliberacao(
        { estado, rodada: 2 },
        { agregadoVeredito: 'aprovar', divergencia: false, confianca: 0.9, ceticoRefuta: false },
      );
      expect(r.estado).toBe(estado);
      expect(r.encerrada).toBe(true);
      expect(r.rodada).toBe(2);
    }
  });

  it('maxRodadas custom = 1 encerra em nao_consenso já na r1 sem consenso', () => {
    const r = avancarDeliberacao(
      { estado: null, rodada: 0 },
      { agregadoVeredito: 'em_validacao', divergencia: true, confianca: 0.9, ceticoRefuta: false },
      { maxRodadas: 1 },
    );
    expect(r.rodada).toBe(1);
    expect(r.estado).toBe('nao_consenso');
    expect(r.encerrada).toBe(true);
  });
});
