import { describe, it, expect } from 'vitest';
import {
  verificarCoerencia,
  removerNumerosDivergentes,
  PISTAS_DEPENDENTE,
} from '@/lib/coerencia-leitura';
import { TETO_AGENTE } from '@/lib/estrelas-regua';

/**
 * ⚠️ O defeito que estes testes seguram foi MEDIDO, não imaginado: nas rodadas de 04/09/2026 o
 * texto contradizia a nota em 3% das leituras do agente sozinho e em 39% a 43% das do time. É o
 * que mais custa confiança de quem lê: nota 4 no topo e "fica em 5★" logo abaixo faz a pessoa
 * duvidar do resto, inclusive das notas certas.
 */
describe('coerência entre o porquê e a nota', () => {
  it('pega o número cravado que diverge, nas formas que apareceram de verdade', () => {
    const casos = [
      'Fica em 5★ porque atua no gasto.',
      'Recebe 3 estrelas por automatizar a rotina.',
      'Merece 2, pois só informa.',
      'A nota 1 se justifica pelo alcance.',
    ];
    for (const t of casos) {
      const inc = verificarCoerencia(t, 4, TETO_AGENTE);
      expect(inc.some((i) => i.tipo === 'numero_divergente'), t).toBe(true);
    }
  });

  it('texto que crava a MESMA nota é coerente', () => {
    expect(verificarCoerencia('Fica em 4★ porque decide sozinho.', 4, TETO_AGENTE)).toEqual([]);
  });

  it('texto sem número nenhum é coerente', () => {
    expect(verificarCoerencia('Consolida relatórios e envia ao time.', 2, TETO_AGENTE)).toEqual([]);
  });

  /**
   * O caso PIAPP: o agente escreve a prova do escape e não escapa. Medido na run 5 em 60
   * projetos. Não é erro por si, é uma afirmação que ficou SEM RESPOSTA.
   */
  it('marca a afirmação de dependentes quando a nota não escapa', () => {
    for (const pista of PISTAS_DEPENDENTE) {
      const t = `O projeto ${pista} outros fluxos da área.`;
      const inc = verificarCoerencia(t, TETO_AGENTE, TETO_AGENTE);
      expect(inc.some((i) => i.tipo === 'dependente_sem_escape'), pista).toBe(true);
    }
  });

  it('acima do teto do agente a afirmação de dependentes NÃO é pendência: ele já escapou', () => {
    const t = 'O projeto sustenta outros três fluxos nomeados.';
    const inc = verificarCoerencia(t, TETO_AGENTE + 1, TETO_AGENTE);
    expect(inc.some((i) => i.tipo === 'dependente_sem_escape')).toBe(false);
  });

  describe('remoção da frase divergente', () => {
    it('tira a frase inteira, não só o número', () => {
      const t = 'Automatiza o envio diário. Fica em 5★ porque atua no gasto. Sobe se decidir sozinho.';
      const limpo = removerNumerosDivergentes(t, 4);
      expect(limpo).not.toMatch(/5/);
      expect(limpo).toContain('Automatiza o envio diário');
      expect(limpo).toContain('Sobe se decidir sozinho');
    });

    it('preserva a frase que crava a nota CERTA', () => {
      const t = 'Fica em 4★ porque decide sozinho. Automatiza a rotina.';
      expect(removerNumerosDivergentes(t, 4)).toContain('Fica em 4');
    });

    // ⚠️ Sem texto nenhum a triagem fica PIOR do que com a contradição: ela perde o argumento
    // inteiro e não ganha nada em troca.
    it('nunca devolve vazio', () => {
      const t = 'Fica em 5★.';
      expect(removerNumerosDivergentes(t, 4).length).toBeGreaterThan(0);
    });
  });
});
