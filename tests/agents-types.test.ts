// Testes: tipos e factories dos agentes
import { describe, it, expect } from 'vitest';
import {
  documentacaoVazia,
  savingVazio,
} from '@/lib/agents/types';
import type {
  ChatFase,
  DocumentacaoColetada,
  SavingColetado,
  OrchestratorResult,
  ProjetoContexto,
} from '@/lib/agents/types';

describe('documentacaoVazia', () => {
  it('retorna todos os 7 campos como null', () => {
    const doc = documentacaoVazia();
    const campos: (keyof DocumentacaoColetada)[] = [
      'nome_projeto', 'o_que_faz', 'execucao', 'dependencias',
      'fluxo', 'configurar_antes', 'atencao',
    ];
    expect(Object.keys(doc)).toHaveLength(7);
    for (const campo of campos) {
      expect(doc[campo]).toBeNull();
    }
  });

  it('retorna instância nova a cada chamada (sem referência compartilhada)', () => {
    const a = documentacaoVazia();
    const b = documentacaoVazia();
    expect(a).not.toBe(b);
    a.nome_projeto = 'teste';
    expect(b.nome_projeto).toBeNull();
  });
});

describe('savingVazio', () => {
  it('retorna todos os 5 campos como null', () => {
    const saving = savingVazio();
    const campos: (keyof SavingColetado)[] = [
      'economia_horas_mes', 'valor_hora', 'economia_reais_mes',
      'tipo_saving', 'memorial_calculo',
    ];
    expect(Object.keys(saving)).toHaveLength(5);
    for (const campo of campos) {
      expect(saving[campo]).toBeNull();
    }
  });

  it('retorna instância nova a cada chamada', () => {
    const a = savingVazio();
    const b = savingVazio();
    expect(a).not.toBe(b);
  });
});

describe('Tipos de fase (ChatFase)', () => {
  it('aceita todas as fases válidas', () => {
    const fases: ChatFase[] = ['doc', 'doc_preview', 'saving', 'saving_preview', 'completo'];
    expect(fases).toHaveLength(5);
  });
});

describe('ProjetoContexto', () => {
  it('pode ser construído com dados mínimos', () => {
    const ctx: ProjetoContexto = {
      responsavel_nome: 'Teste',
      responsavel_email: 'teste@gocase.com',
      area: 'RPA',
      ferramenta: 'n8n',
      membros: [],
      nome_projeto: 'Projeto Teste',
      data_criacao: '2025-01-01',
      doc_texto: null,
    };
    expect(ctx.nome_projeto).toBe('Projeto Teste');
    expect(ctx.doc_texto).toBeNull();
    expect(ctx.membros).toEqual([]);
  });
});

describe('OrchestratorResult', () => {
  it('tipo question tem content e fase', () => {
    const result: OrchestratorResult = {
      type: 'question',
      content: 'Qual a área?',
      fase: 'doc',
      coletado: documentacaoVazia(),
      saving: savingVazio(),
    };
    expect(result.type).toBe('question');
    expect(result.content).toBe('Qual a área?');
    expect(result.fase).toBe('doc');
  });

  it('tipo options tem question + 3 opções', () => {
    const result: OrchestratorResult = {
      type: 'options',
      question: 'Escolha o cargo:',
      options: ['Estagiário', 'Analista', 'Coordenador'],
      fase: 'saving',
      coletado: documentacaoVazia(),
      saving: savingVazio(),
    };
    expect(result.type).toBe('options');
    expect(result.options).toHaveLength(3);
  });

  it('tipo preview tem content markdown', () => {
    const result: OrchestratorResult = {
      type: 'preview',
      content: '# Projeto\n\n## O que faz\nAlgo útil.',
      fase: 'doc_preview',
      coletado: documentacaoVazia(),
      saving: savingVazio(),
    };
    expect(result.content).toContain('# Projeto');
  });

  it('tipo complete com saving preenchido', () => {
    const saving: SavingColetado = {
      economia_horas_mes: 58.3,
      valor_hora: 10.78,
      economia_reais_mes: 628.37,
      tipo_saving: 'mensal',
      memorial_calculo: 'Detalhamento...',
    };
    const result: OrchestratorResult = {
      type: 'complete',
      content: 'Memorial aprovado!',
      fase: 'completo',
      coletado: documentacaoVazia(),
      saving,
    };
    expect(result.saving.economia_horas_mes).toBe(58.3);
    expect(result.saving.economia_reais_mes).toBe(628.37);
    expect(result.saving.tipo_saving).toBe('mensal');
  });
});
