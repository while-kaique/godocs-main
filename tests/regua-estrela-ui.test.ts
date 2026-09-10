/**
 * A RÉGUA DA ESTRELA na tela — pedido do dono do produto (10/09/2026), olhando o «SendApp» com 2★:
 * *"pra eu poder ver la que sendApp é 2 e eu poder ler as 2? Deve ser exatamente como os que passei
 * para o agente calibrar"*.
 *
 * ⚠️ O invariante que este teste existe para travar: **a tela NÃO redigita a régua**. Régua na tela
 * divergindo da régua do agente é pior que régua nenhuma — a triagem passaria a corrigir a nota por
 * um critério que ninguém aplicou.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CRITERIOS_ESTRELA, FAIXA_ESCAPE, NIVEL_ZERO } from '@/lib/estrelas-regua';
import { verboDaNota } from '@/components/dashboard/regua-estrela';

const fonte = readFileSync('src/components/dashboard/regua-estrela.tsx', 'utf8');

describe('verboDaNota', () => {
  it('cada nota tem o verbo da régua, e o 0 é "Experimenta" (tem nome, não é ausência)', () => {
    expect(verboDaNota(0)).toBe(NIVEL_ZERO.verbo);
    for (const n of CRITERIOS_ESTRELA) expect(verboDaNota(n.nota)).toBe(n.verbo);
  });

  it('a faixa de escape tem verbo próprio', () => {
    expect(verboDaNota(FAIXA_ESCAPE.min)).toBe('Muda o jogo');
    expect(verboDaNota(FAIXA_ESCAPE.max)).toBe('Muda o jogo');
  });

  it('sem nota não inventa verbo', () => {
    expect(verboDaNota(null)).toBeNull();
    expect(verboDaNota(undefined)).toBeNull();
  });
});

describe('⚠️ a tela lê a régua da FONTE ÚNICA, não redigita', () => {
  it('importa os níveis em vez de escrever o texto', () => {
    expect(fonte).toMatch(/from '@\/lib\/estrelas-regua'/);
    expect(fonte).toMatch(/CRITERIOS_ESTRELA/);
    expect(fonte).toMatch(/NIVEL_ZERO/);
  });

  it('nenhum critério dos níveis 0 a 5 aparece copiado no componente', () => {
    for (const n of [NIVEL_ZERO, ...CRITERIOS_ESTRELA]) {
      const trecho = n.criterio.slice(0, 40);
      expect(fonte.includes(trecho)).toBe(false);
    }
  });

  it('a faixa 6-10 declara que o agente NÃO crava o número', () => {
    expect(fonte).toMatch(/não crava o número/);
    expect(fonte).toMatch(/do comitê humano/);
  });

  it('estado nunca só por cor: o nível atual é dito em texto', () => {
    expect(fonte).toMatch(/nota deste projeto/);
    expect(fonte).toMatch(/faixa deste projeto/);
  });
});
