/**
 * O funil do GoDocs tem TRÊS status (decisão do dono do produto, 09/09/2026), e a flag 6-10 é
 * aviso, não status.
 */
import { describe, it, expect } from 'vitest';
import {
  STATUS_FUNIL,
  entraNaFilaDoTime,
  statusDoFunil,
  statusFunilDeLegado,
} from '@/lib/funil-status';

describe('statusDoFunil — o desfecho do time vira status', () => {
  it('são três, e só três', () => {
    expect([...STATUS_FUNIL]).toEqual(['Aprovado', 'Pendente', 'Reprovado']);
  });

  it('aprovar → Aprovado · reprovar → Reprovado', () => {
    expect(statusDoFunil({ saida: 'aprovar' }).status).toBe('Aprovado');
    expect(statusDoFunil({ saida: 'reprovar' }).status).toBe('Reprovado');
  });

  it('⚠️ a faixa 6-10 fica PENDENTE, com a flag, e o porquê diz que o agente aprovaria', () => {
    const d = statusDoFunil({ saida: 'humano', escape: true });
    expect(d.status).toBe('Pendente');
    expect(d.flag6a10).toBe(true);
    expect(d.porque).toMatch(/6 a 10/);
    expect(d.porque).toMatch(/se sustenta/);
  });

  it('a faixa 6-10 vence o desfecho: mesmo com o consenso em aprovar, falta o humano cravar', () => {
    // Não pode ir para Aprovado sem número: a régua se recusa a dizer se é 6 ou 10.
    expect(statusDoFunil({ saida: 'aprovar', escape: true }).status).toBe('Pendente');
  });

  it('`ajuste` NÃO é um 4º status: é Pendente', () => {
    expect(statusDoFunil({ saida: 'ajuste' }).status).toBe('Pendente');
    expect(statusDoFunil({ saida: 'humano' }).status).toBe('Pendente');
  });

  it('⚠️ desfecho DESCONHECIDO vira Pendente, nunca Aprovado nem Reprovado', () => {
    // Ampliar o enum do consenso sem passar por aqui não pode decidir projeto por acidente.
    for (const s of ['isento', 'dispensado', '', 'coisa_nova']) {
      expect(statusDoFunil({ saida: s }).status).toBe('Pendente');
    }
  });

  it('todo desfecho sai com um porquê (status sem justificativa não existe)', () => {
    for (const s of ['aprovar', 'reprovar', 'ajuste', 'humano', 'xpto']) {
      expect(statusDoFunil({ saida: s }).porque.length).toBeGreaterThan(20);
    }
  });
});

describe('statusFunilDeLegado — os seis textos antigos', () => {
  it('Em validação e Reenvio Pendente colapsam em Pendente', () => {
    expect(statusFunilDeLegado('Em validação')).toBe('Pendente');
    expect(statusFunilDeLegado('Reenvio Pendente')).toBe('Pendente');
    expect(statusFunilDeLegado('')).toBe('Pendente');
  });

  it('⚠️ Descontinuado devolve null: não é etapa de funil, é arquivo', () => {
    // `null` significa "não encoste na célula", diferente de "vira Pendente": o dono desligou a
    // automação, e julgar o mérito de algo desligado é gastar chamada num veredito inaplicável.
    expect(statusFunilDeLegado('Descontinuado')).toBeNull();
    expect(entraNaFilaDoTime('Descontinuado')).toBe(false);
    expect(entraNaFilaDoTime('Pendente')).toBe(true);
    expect(entraNaFilaDoTime('Reenvio Pendente')).toBe(true);
  });

  it('caixa e acento não decidem nada', () => {
    expect(statusFunilDeLegado('APROVADO')).toBe('Aprovado');
    expect(statusFunilDeLegado(' reprovado ')).toBe('Reprovado');
    expect(statusFunilDeLegado('rejeitado')).toBe('Reprovado');
  });
});
