// RED test — detecção de saving implausível por FTE (função PURA nova).
// Contexto: um saving de 500h/mês por 1 pessoa foi APROVADO indevidamente
// (500/220 ≈ 2,27 FTE para 1 pessoa). O detector deve ENFILEIRAR (nunca reprovar).
// Isenções: especial, fluxo direto de liderança, e "múltiplo" já confirmado no chat.
import { describe, it, expect } from 'vitest';
import {
  avaliarPlausibilidadeFTE,
  FATOR_FTE_PADRAO,
  HORAS_BASE_FTE,
} from '@/lib/agents/analyzer';

describe('avaliarPlausibilidadeFTE — caso que motivou o gate (500h/1 pessoa)', () => {
  it('1. enfileira 500h para 1 pessoa (fte ≈ 2,27 > 1,5)', () => {
    const r = avaliarPlausibilidadeFTE({ horasTotais: 500, pessoasDeclaradas: 1 });
    expect(r.implausivel).toBe(true);
    expect(r.motivo).not.toBeNull();
    expect(typeof r.motivo).toBe('string');
    expect(r.motivo).toMatch(/pessoa/i);
    expect(r.fte).toBeCloseTo(500 / 220, 2);
    expect(r.pessoas).toBe(1);
  });
});

describe('avaliarPlausibilidadeFTE — isenções (nunca enfileira)', () => {
  it('2. projeto ESPECIAL não é enfileirado', () => {
    const r = avaliarPlausibilidadeFTE({
      horasTotais: 500,
      pessoasDeclaradas: 1,
      especial: true,
    });
    expect(r.implausivel).toBe(false);
    expect(r.motivo).toBeNull();
  });

  it('3. FLUXO DIRETO de liderança não é enfileirado', () => {
    const r = avaliarPlausibilidadeFTE({
      horasTotais: 500,
      pessoasDeclaradas: 1,
      fluxoDireto: true,
    });
    expect(r.implausivel).toBe(false);
    expect(r.motivo).toBeNull();
  });

  it('4. MÚLTIPLO já confirmado no chat não é enfileirado', () => {
    const r = avaliarPlausibilidadeFTE({
      horasTotais: 500,
      pessoasDeclaradas: 1,
      temMultiplo: true,
    });
    expect(r.implausivel).toBe(false);
  });
});

describe('avaliarPlausibilidadeFTE — casos plausíveis', () => {
  it('5. projeto normal plausível (100h/1 pessoa, fte ≈ 0,45)', () => {
    const r = avaliarPlausibilidadeFTE({ horasTotais: 100, pessoasDeclaradas: 1 });
    expect(r.fte).toBeCloseTo(100 / 220, 2);
    expect(r.implausivel).toBe(false);
    expect(r.motivo).toBeNull();
  });

  it('6. muitas pessoas cobrem as horas (500h/5 pessoas, 2,27 ≤ 5*1,5)', () => {
    const r = avaliarPlausibilidadeFTE({ horasTotais: 500, pessoasDeclaradas: 5 });
    expect(r.implausivel).toBe(false);
    expect(r.motivo).toBeNull();
  });
});

describe('avaliarPlausibilidadeFTE — sem base para julgar', () => {
  it('7a. horasTotais null → nunca enfileira, fte 0', () => {
    const r = avaliarPlausibilidadeFTE({ horasTotais: null, pessoasDeclaradas: 1 });
    expect(r.implausivel).toBe(false);
    expect(r.fte).toBe(0);
    expect(r.motivo).toBeNull();
  });

  it('7b. horasTotais 0 → nunca enfileira, fte 0', () => {
    const r = avaliarPlausibilidadeFTE({ horasTotais: 0, pessoasDeclaradas: 1 });
    expect(r.implausivel).toBe(false);
    expect(r.fte).toBe(0);
    expect(r.motivo).toBeNull();
  });
});

describe('avaliarPlausibilidadeFTE — kill switch / fator', () => {
  it('8a. fator 0 desliga o gate', () => {
    const r = avaliarPlausibilidadeFTE({
      horasTotais: 500,
      pessoasDeclaradas: 1,
      fator: 0,
    });
    expect(r.implausivel).toBe(false);
  });

  it('8b. fator não-finito (Infinity) desliga o gate', () => {
    const r = avaliarPlausibilidadeFTE({
      horasTotais: 500,
      pessoasDeclaradas: 1,
      fator: Infinity,
    });
    expect(r.implausivel).toBe(false);
  });

  it('8c. fator estrito 1.0: 200h plausível, 250h implausível', () => {
    const ok = avaliarPlausibilidadeFTE({
      horasTotais: 200,
      pessoasDeclaradas: 1,
      fator: 1.0,
    });
    expect(ok.fte).toBeCloseTo(200 / 220, 2);
    expect(ok.implausivel).toBe(false);

    const ruim = avaliarPlausibilidadeFTE({
      horasTotais: 250,
      pessoasDeclaradas: 1,
      fator: 1.0,
    });
    expect(ruim.fte).toBeCloseTo(250 / 220, 2);
    expect(ruim.implausivel).toBe(true);
  });
});

describe('avaliarPlausibilidadeFTE — pessoas ausentes/zero assume ≥1', () => {
  it('9a. pessoasDeclaradas 0 → mesmo desfecho do caso 1', () => {
    const r = avaliarPlausibilidadeFTE({ horasTotais: 500, pessoasDeclaradas: 0 });
    expect(r.implausivel).toBe(true);
    expect(r.pessoas).toBe(1);
  });

  it('9b. pessoasDeclaradas ausente → mesmo desfecho do caso 1', () => {
    const r = avaliarPlausibilidadeFTE({ horasTotais: 500 });
    expect(r.implausivel).toBe(true);
    expect(r.pessoas).toBe(1);
  });
});

describe('avaliarPlausibilidadeFTE — invariante motivo ↔ implausivel', () => {
  const amostra = [
    { horasTotais: 500, pessoasDeclaradas: 1 },
    { horasTotais: 500, pessoasDeclaradas: 1, especial: true },
    { horasTotais: 500, pessoasDeclaradas: 1, fluxoDireto: true },
    { horasTotais: 500, pessoasDeclaradas: 1, temMultiplo: true },
    { horasTotais: 100, pessoasDeclaradas: 1 },
    { horasTotais: 500, pessoasDeclaradas: 5 },
    { horasTotais: null, pessoasDeclaradas: 1 },
    { horasTotais: 0, pessoasDeclaradas: 1 },
    { horasTotais: 500, pessoasDeclaradas: 0 },
  ];

  it('10. implausivel=true ⟺ motivo string não-vazia; implausivel=false ⟺ motivo null', () => {
    for (const caso of amostra) {
      const r = avaliarPlausibilidadeFTE(caso);
      if (r.implausivel) {
        expect(typeof r.motivo).toBe('string');
        expect((r.motivo ?? '').trim().length).toBeGreaterThan(0);
      } else {
        expect(r.motivo).toBeNull();
      }
    }
  });
});

describe('avaliarPlausibilidadeFTE — constantes exportadas', () => {
  it('11. FATOR_FTE_PADRAO e HORAS_BASE_FTE', () => {
    expect(FATOR_FTE_PADRAO).toBe(1.5);
    expect(HORAS_BASE_FTE).toBe(220);
  });
});
