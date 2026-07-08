import { describe, it, expect } from 'vitest';
import { buildSubmitMessage } from '@/lib/google/chat';

// Base de parâmetros de um projeto NÃO-especial (com saving/receita) para reuso.
const base = {
  projeto: 'Automação X',
  area: 'Operações',
  ferramenta: 'n8n',
  escopo: 'interno',
  tipos: 'saving',
  nomeCompleto: 'Fulano de Tal',
  email: 'fulano@gocase.com',
  participantes: 'Beltrano',
  descricao: 'Descrição do projeto.',
  savingHoras: 120,
  savingReais: 5000,
  tipoSaving: 'mensal',
  receitaValor: 0,
  tipoReceita: '',
  dataSubmissao: '08/07/2026',
  modo: 'novo' as const,
};

describe('buildSubmitMessage — alerta de projeto especial', () => {
  it('projeto padrão mantém as linhas de saving/escopo/tipos', () => {
    const msg = buildSubmitMessage(base);
    expect(msg).toContain('Saving estimado (horas/mês)');
    expect(msg).toContain('Saving estimado (R$/mês)');
    expect(msg).toContain('Escopo:');
    expect(msg).toContain('Tipos:');
  });

  it('projeto especial OMITE saving/receita/escopo/tipos e mostra a justificativa', () => {
    const msg = buildSubmitMessage({
      ...base,
      especial: true,
      contextoEspecial: 'Projeto de pesquisa sem saving mensurável, valor estratégico.',
    });
    // Linhas irrelevantes ao caso especial não aparecem.
    expect(msg).not.toContain('Saving estimado');
    expect(msg).not.toContain('Tipo de saving');
    expect(msg).not.toContain('Receita incremental');
    expect(msg).not.toContain('Escopo:');
    expect(msg).not.toContain('Tipos:');
    // Cabeçalho e justificativa próprios do especial.
    expect(msg).toContain('Projeto especial');
    expect(msg).toContain('Por que é um projeto especial:');
    expect(msg).toContain('Projeto de pesquisa sem saving mensurável, valor estratégico.');
    // Metadados que ainda fazem sentido continuam.
    expect(msg).toContain('Automação X');
    expect(msg).toContain('Fulano de Tal');
    expect(msg).toContain('Descrição do projeto.');
  });

  it('especial sem contexto cai no traço (nunca célula vazia)', () => {
    const msg = buildSubmitMessage({ ...base, especial: true, contextoEspecial: '' });
    expect(msg).toContain('Por que é um projeto especial:');
    expect(msg).toContain('—');
  });

  it('edição de projeto especial usa o cabeçalho de edição', () => {
    const msg = buildSubmitMessage({
      ...base,
      modo: 'edicao',
      especial: true,
      contextoEspecial: 'Contexto qualquer.',
    });
    expect(msg).toContain('Edição de projeto especial');
  });
});
