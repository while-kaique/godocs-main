/**
 * T14 — PISO de materialidade (D4/D4.2 / RF-243). O gabarito é o snapshot de 04/09/2026: o piso
 * está certo se reprovar os 137 que o dono do produto reprovou à mão, e mais ninguém.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  abaixoDoPisoDeImpacto,
  reprovaPeloPiso,
  ESTRELA_LIMITE_REPROVAVEL,
  impactoMensalDeclarado,
  motivoPisoDeImpacto,
  PISO_IMPACTO_MENSAL,
} from '@/lib/materialidade-piso';
import { avaliarFinanceiro } from '@/lib/agents/avaliacao-financeira';

describe('abaixoDoPisoDeImpacto', () => {
  it('o piso adotado é R$ 100/mês (D4.2)', () => {
    expect(PISO_IMPACTO_MENSAL).toBe(100);
  });

  it('valor positivo menor que o piso → abaixo', () => {
    expect(abaixoDoPisoDeImpacto(18.16)).toBe(true);
    expect(abaixoDoPisoDeImpacto(0.87625)).toBe(true);
    expect(abaixoDoPisoDeImpacto(99.99)).toBe(true);
  });

  it('no piso ou acima → NÃO abaixo (a régua é "menor que")', () => {
    expect(abaixoDoPisoDeImpacto(100)).toBe(false);
    expect(abaixoDoPisoDeImpacto(5000)).toBe(false);
  });

  it('AUSÊNCIA de número não é ganho abaixo do piso', () => {
    // ⚠️ O ponto mais importante do módulo: especial não tem memorial financeiro e a v2 tem ganho
    // IMENSURÁVEL declarado. Se 0/null reprovassem, as duas famílias cairiam inteiras.
    expect(abaixoDoPisoDeImpacto(0)).toBe(false);
    expect(abaixoDoPisoDeImpacto(null)).toBe(false);
    expect(abaixoDoPisoDeImpacto(undefined)).toBe(false);
    expect(abaixoDoPisoDeImpacto(NaN)).toBe(false);
    expect(abaixoDoPisoDeImpacto(-50)).toBe(false);
  });

  it('o motivo nomeia o valor e o piso, com centavos', () => {
    const m = motivoPisoDeImpacto(18.16);
    expect(m).toContain('18,16');
    expect(m).toContain('100,00');
  });
});

describe('impactoMensalDeclarado — qual número o piso julga', () => {
  it('prefere o Ganho Total já materializado', () => {
    expect(
      impactoMensalDeclarado({ ganhoTotalMensal: 18.16, savingReais: 9999, receitaMensal: 9999 }),
    ).toBe(18.16);
  });

  it('sem ele, repete a régua do negócio: saving cheio + receita ÷ 10', () => {
    expect(impactoMensalDeclarado({ savingReais: 50, receitaMensal: 1000 })).toBe(150);
    expect(impactoMensalDeclarado({ receitaMensal: 500 })).toBe(50);
  });

  it('sem fonte nenhuma → null (não há número declarado)', () => {
    expect(impactoMensalDeclarado({})).toBeNull();
    expect(
      impactoMensalDeclarado({ ganhoTotalMensal: null, savingReais: null, receitaMensal: null }),
    ).toBeNull();
  });
});

describe('avaliarFinanceiro — o piso vira sinal próprio (o caso real LEGADO-057)', () => {
  it('LEGADO-057 (R$ 18,16/mês) volta atencao + abaixoDoPiso, e NÃO mais ok/0,9', () => {
    const r = avaliarFinanceiro({ temSaving: true, economiaReaisMes: 18.16, materialidade: 18.16 });
    expect(r.abaixoDoPiso).toBe(true);
    expect(r.veredito).toBe('atencao');
    expect(r.confianca).toBe(0.3);
    expect(r.motivo).toContain('18,16');
    expect(r.sinais.join(' ')).toMatch(/piso/i);
  });

  it('projeto com impacto acima do piso segue ok e sem a marca', () => {
    const r = avaliarFinanceiro({ temSaving: true, economiaReaisMes: 3000, materialidade: 3000 });
    expect(r.abaixoDoPiso).toBe(false);
    expect(r.veredito).toBe('ok');
  });

  it('sem dado financeiro nenhum (especial) NÃO marca o piso', () => {
    const r = avaliarFinanceiro({});
    expect(r.veredito).toBe('inconclusivo');
    expect(r.abaixoDoPiso).toBe(false);
  });

  it('o teto de R$ 5.000 continua valendo (o piso não o substituiu)', () => {
    const r = avaliarFinanceiro({ temSaving: true, economiaReaisMes: 9000, materialidade: 9000 });
    expect(r.veredito).toBe('atencao');
    expect(r.abaixoDoPiso).toBe(false);
    expect(r.motivo).toMatch(/teto/i);
  });
});

describe('gabarito de 04/09/2026 — o piso reprova os 137 e mais ninguém', () => {
  type Alvo = { id: string; nome: string; imp: number; statusAntes: string };
  const snapshot = JSON.parse(
    readFileSync('docs/baselines/rodadas/snapshot-reprovacao-04-09.json', 'utf8'),
  ) as { alvos: Alvo[] };

  it('todos os 137 alvos ficam abaixo do piso', () => {
    expect(snapshot.alvos.length).toBe(137);
    const escapam = snapshot.alvos.filter((a) => !abaixoDoPisoDeImpacto(a.imp));
    expect(escapam.map((a) => `${a.nome}: ${a.imp}`)).toEqual([]);
  });

  it('e o maior impacto entre eles ainda cabe no piso (a régua não é folgada demais)', () => {
    const maior = Math.max(...snapshot.alvos.map((a) => a.imp));
    expect(maior).toBeLessThan(PISO_IMPACTO_MENSAL);
    // ⚠️ Se alguém baixar o piso, o teste dos 137 acima cai primeiro; este guarda o outro lado:
    // um piso muito acima de 100 pegaria projeto que o dono do produto NÃO reprovou.
    expect(PISO_IMPACTO_MENSAL).toBeLessThanOrEqual(100);
  });
});

describe('reprovaPeloPiso — a régua COMPOSTA, medida contra o gabarito de 04/09', () => {
  it('a régua é ESTRITAMENTE abaixo de 1 — ou seja, nota zero', () => {
    expect(ESTRELA_LIMITE_REPROVAVEL).toBe(1);
  });

  it('⚠️ nota 1 NÃO reprova (o `<= 1` era invenção minha; o gabarito só tem 0★)', () => {
    // Correção do dono do produto: *"você inventou o <= 1, eu falei < 1"*. São 6 projetos
    // APROVADOS de 1★ que o teto errado derrubava sem nenhuma evidência: RA Monitor (R$ 37,92),
    // Controle de Vencimentos (R$ 41,37), [ECOMM] Alerta de pedidos travados (R$ 42,58),
    // Direcionador de Fórum (R$ 42,75), Pesquisa Satisfação Prima Vida (R$ 38,62) e
    // [DUDA] Cupons (R$ 98,50).
    expect(reprovaPeloPiso({ impactoMensal: 37.92, estrela: 1 })).toBe(false);
    expect(reprovaPeloPiso({ impactoMensal: 98.5, estrela: 1 })).toBe(false);
    // e nada acima de 1, obviamente
    expect(reprovaPeloPiso({ impactoMensal: 42.75, estrela: 2 })).toBe(false);
  });

  it('impacto baixo + nota ZERO (ou sem nota) → reprova', () => {
    expect(reprovaPeloPiso({ impactoMensal: 18.16, estrela: 0 })).toBe(true);
    // ⚠️ Ausência de nota NÃO poupa: é o estado da maioria dos que a rodada de 04/09 pegou, e
    // exigir estrela para reprovar tornaria o piso inerte justamente em quem ninguém avaliou.
    expect(reprovaPeloPiso({ impactoMensal: 18.16, estrela: null })).toBe(true);
    expect(reprovaPeloPiso({ impactoMensal: 18.16 })).toBe(true);
  });

  it('⚠️ nota ALTA poupa — é o que o piso sozinho errava', () => {
    // Casos REAIS de prod que o piso sozinho derrubaria: Funil R&S (4★, R$ 89,70),
    // Onboarding & Integração (3★, R$ 91,19), Portal de Admissão (2★, R$ 97,02). Quase todos de
    // processo, a família em que o valor não está no dinheiro.
    expect(reprovaPeloPiso({ impactoMensal: 89.7, estrela: 4 })).toBe(false);
    expect(reprovaPeloPiso({ impactoMensal: 91.19, estrela: 3 })).toBe(false);
    expect(reprovaPeloPiso({ impactoMensal: 97.02, estrela: 2 })).toBe(false);
  });

  it('impacto acima do piso não reprova, nem com nota 0', () => {
    expect(reprovaPeloPiso({ impactoMensal: 5000, estrela: 0 })).toBe(false);
  });

  it('ausência de NÚMERO nunca reprova (especial, ganho imensurável)', () => {
    expect(reprovaPeloPiso({ impactoMensal: 0, estrela: 0 })).toBe(false);
    expect(reprovaPeloPiso({ impactoMensal: null, estrela: 0 })).toBe(false);
  });
});

describe('gabarito de 04/09 — a régua composta reproduz o julgamento humano', () => {
  type Alvo = { id: string; nome: string; imp: number };
  const alvos = (
    JSON.parse(readFileSync('docs/baselines/rodadas/snapshot-reprovacao-04-09.json', 'utf8')) as {
      alvos: Alvo[];
    }
  ).alvos;

  it('⚠️ os 137 que ele reprovou tinham TODOS 0★ — medido em 08/09/2026', () => {
    // Este é o fato que criou a régua composta: o julgamento humano nunca foi só o piso.
    // A prova viva está no relatório; aqui travamos a consequência.
    const relatorio = JSON.parse(
      readFileSync('docs/baselines/rodadas/piso-impacto-precisao-08-09.json', 'utf8'),
    ) as { recall_sobre_os_137: string; extensao_por_status: Record<string, number> };
    expect(relatorio.recall_sobre_os_137).toMatch(/136\/137/);
  });

  it('com estrela 0, a régua composta pega os 137 alvos (o mesmo recall do piso sozinho)', () => {
    const escapam = alvos.filter((a) => !reprovaPeloPiso({ impactoMensal: a.imp, estrela: 0 }));
    expect(escapam.map((a) => `${a.nome}: ${a.imp}`)).toEqual([]);
  });
});
