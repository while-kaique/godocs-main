/**
 * T16 — os canários (RF-248). Acurácia perfeita é tripwire, não vitória: no estudo de guardrails,
 * TODAS as rodadas com trapaça deram exatamente 100% e as limpas ficaram entre 35% e 89%.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANARIOS, conferirCanarios, ehCanario } from '@/lib/avaliacao-canarios';
import { agregarAcuracia } from '@/lib/avaliacao-retroativa';

describe('CANARIOS — todos REAIS, com id da base e o porquê nomeado', () => {
  it('cada canário existe no snapshot de 04/09 (não há id inventado)', () => {
    const snapshot = JSON.parse(
      readFileSync('docs/baselines/rodadas/snapshot-reprovacao-04-09.json', 'utf8'),
    ) as { alvos: { id: string; nome: string; imp: number }[] };
    const porId = new Map(snapshot.alvos.map((a) => [a.id.toLowerCase(), a]));
    for (const c of CANARIOS) {
      const alvo = porId.get(c.id.toLowerCase());
      expect(alvo, `${c.id} (${c.nome}) não está no snapshot`).toBeTruthy();
      expect(alvo!.nome).toBe(c.nome);
      expect(c.porque.trim().length).toBeGreaterThan(10);
    }
  });

  it('ehCanario compara sem distinção de caixa (legado grava id em MAIÚSCULA)', () => {
    expect(ehCanario('LEGADO-057')).toBe(true);
    expect ( ehCanario('legado-057')).toBe(true);
    expect(ehCanario(' legado-057 ')).toBe(true);
    expect(ehCanario('outro-projeto')).toBe(false);
    expect(ehCanario(null)).toBe(false);
  });
});

describe('conferirCanarios', () => {
  it('a mesa APROVANDO um canário derruba o relatório', () => {
    const r = conferirCanarios([
      { projeto_id: 'LEGADO-057', veredito_agregado: 'aprovar' },
      { projeto_id: 'projeto-qualquer', veredito_agregado: 'aprovar' },
    ]);
    expect(r.suspeito).toBe(true);
    expect(r.avaliados).toBe(1);
    expect(r.violados[0].nome).toBe('Meta Base - Estoque');
    expect(r.alerta).toMatch(/SUSPEITO/);
    expect(r.alerta).toContain('18,16');
  });

  it('em_validacao e reprovar num canário NÃO derrubam nada', () => {
    const r = conferirCanarios([
      { projeto_id: 'LEGADO-057', veredito_agregado: 'em_validacao' },
      { projeto_id: 'ed370d51237e5a04350552de092da859', veredito_agregado: 'reprovar' },
    ]);
    expect(r.avaliados).toBe(2);
    expect(r.suspeito).toBe(false);
    expect(r.alerta).toBeNull();
  });

  it('corrida sem canário nenhum: a rede não foi exercitada (avaliados 0), e isso é visível', () => {
    const r = conferirCanarios([{ projeto_id: 'x', veredito_agregado: 'aprovar' }]);
    expect(r.avaliados).toBe(0);
    expect(r.suspeito).toBe(false);
  });

  it('⚠️ acurácia 100% com canário aprovado: o número é perfeito e o relatório é suspeito', () => {
    const acuracia = agregarAcuracia(['acerto', 'acerto', 'acerto']);
    expect(acuracia.taxa_acerto).toBe(1);
    const canarios = conferirCanarios([{ projeto_id: 'LEGADO-057', veredito_agregado: 'aprovar' }]);
    expect(canarios.suspeito).toBe(true);
  });
});
