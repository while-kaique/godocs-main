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

  it('move na direção das lentes, e concordância não mexe em nada', () => {
    expect(ajustarNotaComPainel(2, semPiso(5)).nota).toBe(3);
    expect(ajustarNotaComPainel(4, semPiso(0)).nota).toBe(3);
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
  it('NÃO desce quando as lentes discordam entre si: a base julga o projeto, a lente só um eixo', () => {
    const versta = { nota_lentes: 3, piso: null, notas_das_lentes: [5, 4, 2, 2] };
    const r = ajustarNotaComPainel(5, versta);
    expect(r.nota).toBe(5);
    expect(r.delta).toBe(0);
    expect(r.motivo).toContain('discordaram');
  });

  it('desce normalmente quando as lentes concordam que é para baixo', () => {
    const r = ajustarNotaComPainel(4, { nota_lentes: 2, piso: null, notas_das_lentes: [2, 2, 1, 2] });
    expect(r.nota).toBe(3);
  });

  // Subir é assimétrico DE PROPÓSITO: a régua é disjuntiva, a nota vem de UM eixo, então uma lente
  // sustentando mais do que a base viu é informação nova mesmo com as outras baixas.
  it('SOBE mesmo com as lentes dispersas', () => {
    const r = ajustarNotaComPainel(1, { nota_lentes: 5, piso: null, notas_das_lentes: [5, 4, 0, 0] });
    expect(r.nota).toBe(2);
  });

  // O piso é fato do projeto inteiro, não média de eixo: dispersão não o segura.
  it('o piso zera mesmo com as lentes dispersas', () => {
    const r = ajustarNotaComPainel(5, { nota_lentes: 5, piso: 'fora_de_uso', notas_das_lentes: [5, 0, 5, 0] });
    expect(r.nota).toBe(0);
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
