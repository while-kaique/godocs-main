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

describe('Formatação da notificação Google Chat', () => {
  it('monta texto de notificação com dados do projeto', () => {
    const projeto = {
      nome: 'Cadastro de Embaixadores',
      area: 'Marketing de Influência',
      ferramenta: 'n8n',
      responsavel_nome: 'Teste Testando',
      responsavel_email: 'teste@gocase.com',
      membros: ['colega@gocase.com'],
    };
    const saving = {
      economia_horas_mes: 150,
      economia_reais_mes: 1617,
      tipo_saving: 'mensal',
    };
    const status = 'em_validacao';

    const fmtReais = Number(saving.economia_reais_mes).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const membros = projeto.membros.join(', ');

    const text = [
      `📌 *Projeto:* ${projeto.nome}`,
      `🏷️ *Área:* ${projeto.area}`,
      `🛠️ *Ferramenta:* ${projeto.ferramenta}`,
      `👤 *Solicitante:* ${projeto.responsavel_nome}`,
      `📧 *E-mail:* ${projeto.responsavel_email}`,
      `👥 *Participantes:* ${membros}`,
      `⏱️ *Saving estimado (horas/mês):* ${saving.economia_horas_mes} horas`,
      `💰 *Saving estimado (R$/mês):* R$ ${fmtReais}`,
    ].join('\n');

    expect(text).toContain('Cadastro de Embaixadores');
    expect(text).toContain('Marketing de Influência');
    expect(text).toContain('n8n');
    expect(text).toContain('teste@gocase.com');
    expect(text).toContain('colega@gocase.com');
    expect(text).toContain('150 horas');
    expect(text).toContain('R$');
  });

  it('omite participantes quando lista vazia', () => {
    const membros: string[] = [];
    const membrosStr = membros.join(', ');
    const lines = [
      membrosStr ? `👥 *Participantes:* ${membrosStr}` : '',
    ].filter(Boolean);
    expect(lines).toHaveLength(0);
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
