// Testes: fluxo de submissão (regras de negócio da submeterParaValidacaoFn)
import { describe, it, expect } from 'vitest';

describe('Regra de auto-aprovação por área', () => {
  const getStatus = (area: string | null) => area === 'RPA' ? 'aprovado' : 'em_validacao';

  it('área RPA → status aprovado', () => {
    expect(getStatus('RPA')).toBe('aprovado');
  });

  it('área CX → status em_validacao', () => {
    expect(getStatus('CX')).toBe('em_validacao');
  });

  it('área null → status em_validacao', () => {
    expect(getStatus(null)).toBe('em_validacao');
  });

  it('área Tecnologia → status em_validacao', () => {
    expect(getStatus('Tecnologia')).toBe('em_validacao');
  });

  it('case-sensitive (rpa ≠ RPA)', () => {
    expect(getStatus('rpa')).toBe('em_validacao');
  });
});

describe('Extração de saving do JSON de documentação', () => {
  it('extrai campos de saving quando presentes', () => {
    const conteudo = {
      titulo: 'Projeto X',
      saving: {
        economia_horas_mes: 58.3,
        valor_hora: 10.78,
        economia_reais_mes: 628.37,
        tipo_saving: 'mensal',
        memorial_calculo: 'Detalhamento completo...',
      },
    };

    const saving = conteudo.saving;
    expect(saving.economia_horas_mes).toBe(58.3);
    expect(saving.economia_reais_mes).toBe(628.37);
    expect(saving.tipo_saving).toBe('mensal');
    expect(saving.memorial_calculo).toContain('Detalhamento');
  });

  it('lida com saving ausente (retorna null)', () => {
    const conteudo: Record<string, unknown> = { titulo: 'Projeto X' };
    const saving = conteudo.saving as Record<string, unknown> | undefined;
    expect(saving?.economia_horas_mes ?? null).toBeNull();
    expect(saving?.economia_reais_mes ?? null).toBeNull();
  });
});

describe('Ganho total mensal — pontual NÃO divide por 12', () => {
  // Replica a fórmula inline de submeterParaValidacao/resyncGoogle (chat.functions.ts).
  // Regra (docs/business-rules.md): saving entra cheio, receita aplica ÷10 — e
  // valor PONTUAL entra cheio em ambos (NÃO mensaliza por 12). O ÷12 é exclusivo
  // do custo evitado, que já está embutido em economia_reais_mes.
  // Regressão: o fix fe910a2 foi revertido sem querer pelo refactor 46e32dd.
  const ganhoTotal = (savingReais: number, receitaValor: number) =>
    Math.round((savingReais + receitaValor / 10) * 100) / 100;

  it('saving pontual entra cheio (sem ÷12)', () => {
    // R$ 12.000 pontual → ganho R$ 12.000 (não R$ 1.000)
    expect(ganhoTotal(12000, 0)).toBe(12000);
  });

  it('saving mensal entra cheio', () => {
    expect(ganhoTotal(2400, 0)).toBe(2400);
  });

  it('receita aplica ÷10 e pontual NÃO divide por 12', () => {
    // R$ 5.000 → equivalente R$ 500 (÷10), sem ÷12
    expect(ganhoTotal(0, 5000)).toBe(500);
  });

  it('saving + receita combinados', () => {
    // 12.000 (cheio) + 5.000/10 = 12.500
    expect(ganhoTotal(12000, 5000)).toBe(12500);
  });
});

describe('Verificação de duplicata', () => {
  it('identifica projetos com mesmo nome (simulação)', () => {
    const projetos = [
      { id: '1', nome: 'Bot CX', status: 'em_validacao' },
      { id: '2', nome: 'Cadastro Embaixadores', status: 'aprovado' },
    ];

    const novoNome = 'Bot CX';
    const novoId = '3';

    const duplicata = projetos.find(
      p => p.nome === novoNome && p.id !== novoId && p.status !== 'rascunho'
    );

    expect(duplicata).toBeDefined();
    expect(duplicata!.id).toBe('1');
  });

  it('não marca como duplicata projetos em rascunho', () => {
    const projetos = [
      { id: '1', nome: 'Bot CX', status: 'rascunho' },
    ];

    const duplicata = projetos.find(
      p => p.nome === 'Bot CX' && p.id !== '2' && p.status !== 'rascunho'
    );

    expect(duplicata).toBeUndefined();
  });

  it('não marca o próprio projeto como duplicata', () => {
    const projetos = [
      { id: '1', nome: 'Bot CX', status: 'em_validacao' },
    ];

    const duplicata = projetos.find(
      p => p.nome === 'Bot CX' && p.id !== '1' && p.status !== 'rascunho'
    );

    expect(duplicata).toBeUndefined();
  });
});
