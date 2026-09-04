import { describe, it, expect } from 'vitest';
import { ajustarNotaComPainel, confiancaPorConsenso, AJUSTE_MAX_PAINEL } from '@/lib/especiais-ajuste';
import { TETO_AGENTE } from '@/lib/estrelas-regua';

/**
 * ⚠️ Medido em 03/09/2026: com o painel decidindo sozinho, o PIAPP saiu 2, 5, 3, 7, 8 e 3 em seis
 * chamadas idênticas. As lentes variavam pouco; o resultado é que explodia. Estes testes travam a
 * propriedade que resolve isso: o time AJUSTA a nota do run 1, não a substitui.
 */
describe('ajuste fino da nota do run 1', () => {
  /** Lentes CONCORDES entre si (dispersão 0) — é o cenário dos casos antigos. */
  const semPiso = (nota: number) => ({ nota_lentes: nota, piso: null, notas_das_lentes: [nota, nota, nota, nota] });

  it('nunca move mais que um degrau, por mais longe que as lentes estejam', () => {
    for (let base = 0; base <= TETO_AGENTE; base++) {
      for (let lentes = 0; lentes <= TETO_AGENTE; lentes++) {
        const r = ajustarNotaComPainel(base, semPiso(lentes));
        expect(Math.abs(r.nota - base), `base ${base} lentes ${lentes}`).toBeLessThanOrEqual(AJUSTE_MAX_PAINEL);
      }
    }
  });

  it('sobe na direção das lentes; concordância não mexe em nada', () => {
    expect(ajustarNotaComPainel(2, semPiso(5)).nota).toBe(3);
    expect(ajustarNotaComPainel(3, semPiso(3)).nota).toBe(3);
  });

  // A faixa alta é a peça que o run 1 já acerta: exige duas citações e nenhuma lente sozinha
  // responde à pergunta do escape. Nem tira de lá, nem coloca lá.
  it('a faixa 6-10 vem do run 1 e as lentes não a movem', () => {
    for (const base of [6, 7, 8, 9, 10]) {
      expect(ajustarNotaComPainel(base, semPiso(0)).nota).toBe(base);
      expect(ajustarNotaComPainel(base, semPiso(5)).nota).toBe(base);
    }
    // e não empurram uma base de 5 para dentro da faixa
    expect(ajustarNotaComPainel(TETO_AGENTE, semPiso(TETO_AGENTE)).nota).toBe(TETO_AGENTE);
    expect(ajustarNotaComPainel(TETO_AGENTE, semPiso(0)).nota).toBeLessThanOrEqual(TETO_AGENTE);
  });

  // Única exceção ao degrau: o piso não é "um pouco menos", é "não pontua".
  it('piso nomeado zera de qualquer altura, e diz qual foi', () => {
    const r = ajustarNotaComPainel(5, { nota_lentes: 5, piso: 'fora_de_uso', notas_das_lentes: [5, 5, 5, 5] });
    expect(r.nota).toBe(0);
    expect(r.motivo).toContain('fora_de_uso');
  });


  /**
   * ⚠️ O caso «[VERSTA] Robô orçamento», run 7 (04/09/2026). A base leu o dossiê inteiro e disse 5;
   * as lentes saíram função 5, alcance 4, gate 2, complexidade 2. A consolidação usa o gate como
   * TETO, então o gate sozinho puxou a nota para baixo e o texto final ficou dizendo "controla
   * 100% do orçamento, roda 24/7, sem aprovação manual" debaixo de um 4.
   *
   * O padrão era sistemático, não anedota: dos 9 projetos com base 5 no run 7, os 9 desceram, e o
   * nível 5 esvaziou (2 projetos, contra 5 na faixa de escape que as lentes não alcançam).
   */
  /**
   * ⚠️ A propriedade central: a lente lê UM eixo e a régua é disjuntiva, então lente baixa não
   * desmente a caixa em que a base pôs o projeto — só diz que aquele eixo é fraco.
   *
   * O caso é o «[VERSTA] Robô orçamento» (planilha 8): base 5 nas runs 7 E 8, e nas duas o time
   * entregou 4, com o texto dizendo "controla 100% do orçamento, roda 24/7, sem aprovação manual",
   * que é a definição literal do 5. Na run 7, dos 9 projetos com base 5, os 9 desceram.
   */
  it('as lentes NUNCA derrubam a nota da base, por mais baixas que estejam', () => {
    for (let base = 0; base <= TETO_AGENTE; base++) {
      for (let lentes = 0; lentes < base; lentes++) {
        const r = ajustarNotaComPainel(base, semPiso(lentes));
        expect(r.nota, `base ${base} lentes ${lentes}`).toBe(base);
        expect(r.delta).toBe(0);
      }
    }
  });

  it('o VERSTA fica em 5 com as lentes do run 7 E com as do run 8', () => {
    // run 7: função 5, alcance 4, gate 2, complexidade 2 — um eixo sustentava
    expect(ajustarNotaComPainel(5, { nota_lentes: 3, piso: null, notas_das_lentes: [5, 4, 2, 2] }).nota).toBe(5);
    // run 8: o eixo que sustentava caiu para 2, e mesmo assim a caixa da base vale
    expect(ajustarNotaComPainel(5, { nota_lentes: 2, piso: null, notas_das_lentes: [2, 2, 0, 4] }).nota).toBe(5);
  });

  // Para baixo existe UMA força, e ela exige citação do dossiê para agir.
  it('o piso continua zerando de qualquer altura', () => {
    for (let base = 0; base <= TETO_AGENTE; base++) {
      const r = ajustarNotaComPainel(base, { nota_lentes: base, piso: 'fora_de_uso', notas_das_lentes: [base, base, base, base] });
      expect(r.nota).toBe(0);
    }
  });

  it('o motivo diz quando o ajuste foi LIMITADO, para o relatório não parecer concordância', () => {
    const r = ajustarNotaComPainel(1, semPiso(5));
    expect(r.nota).toBe(2);
    expect(r.motivo).toContain('sustentavam 5');
  });

  it('nunca sai da escala', () => {
    expect(ajustarNotaComPainel(0, semPiso(0)).nota).toBe(0);
    expect(ajustarNotaComPainel(0, semPiso(5)).nota).toBe(1);
  });
});

/**
 * Confiança vinda do CONSENSO.
 *
 * ⚠️ Perguntar a confiança ao modelo não mede nada: medido no T1, ele se declarou "alta" em 456
 * de 484. O que mede é o que os agentes de fato concordaram, e isso o time produz de graça.
 */
describe('confiança pelo consenso dos agentes', () => {
  const semDivergencia = { notasDasLentes: [2, 2, 3, 2, 2], deltaAjuste: 0 };

  it('lentes de acordo e ajuste zero: a confiança não muda', () => {
    expect(confiancaPorConsenso('alta', semDivergencia)).toBe('alta');
    expect(confiancaPorConsenso('media', semDivergencia)).toBe('media');
  });

  it('lentes muito divergentes entre si rebaixam um degrau', () => {
    // um eixo viu quase o topo e outro quase o piso do MESMO projeto
    expect(confiancaPorConsenso('alta', { notasDasLentes: [5, 1, 3, 5, 0], deltaAjuste: 0 })).toBe('media');
  });

  it('base e lentes discordando rebaixam um degrau', () => {
    expect(confiancaPorConsenso('alta', { notasDasLentes: [2, 2, 2, 2, 2], deltaAjuste: -1 })).toBe('media');
  });

  it('os dois sinais juntos rebaixam dois degraus', () => {
    expect(confiancaPorConsenso('alta', { notasDasLentes: [5, 0, 3, 4, 1], deltaAjuste: 1 })).toBe('baixa');
  });

  // ⚠️ Consenso não PROVA que a nota está certa: cinco agentes podem errar juntos, e erram
  // quando o dossiê é ruim. Ele só desmente a certeza quando ela não existe.
  it('nunca SOBE a confiança, por mais que todos concordem', () => {
    expect(confiancaPorConsenso('baixa', semDivergencia)).toBe('baixa');
    expect(confiancaPorConsenso('media', semDivergencia)).toBe('media');
  });

  it('não quebra com lente faltando ou lista vazia', () => {
    expect(confiancaPorConsenso('alta', { notasDasLentes: [], deltaAjuste: 0 })).toBe('alta');
    expect(confiancaPorConsenso('alta', { notasDasLentes: [3], deltaAjuste: 0 })).toBe('alta');
  });
});
