// Contexto do formulário → prompts do agente.
//
// O defeito que estes testes travam: o que o autor preenche ANTES do chat chegava aos
// prompts de forma acidental. Só a fase de doc injetava a descrição breve, e o
// contrafactual da Etapa 2 (quem sentiria falta + o que piora) não chegava a prompt
// NENHUM — o agente perguntava o ponteiro do [1.4] sem saber que a pessoa já havia
// respondido, duas telas antes. A causa era a whitelist manual do ProjetoContexto.
import { describe, it, expect } from 'vitest';
import {
  buildRespostasFormulario,
  buildDetalhesAprovados,
  buildDocPrompt,
  buildSavingPrompt,
  buildReceitaPrompt,
} from '@/lib/agents/orchestrator';
import { documentacaoVazia, savingVazio, receitaVazia } from '@/lib/agents/types';
import type { ProjetoContexto, DocumentacaoColetada } from '@/lib/agents/types';
import { serializarAfetados } from '@/lib/submeter/constants';

const ctxBase: ProjetoContexto = {
  responsavel_nome: 'Ana',
  responsavel_email: 'ana@gocase.com',
  area: 'Fiscal',
  ferramenta: 'n8n',
  membros: [],
  nome_projeto: 'Conciliação diária',
  data_criacao: null,
  doc_texto: null,
};

const docCompleta: DocumentacaoColetada = {
  ...documentacaoVazia(),
  nome_projeto: 'Conciliação diária',
  o_que_faz: 'Concilia notas fiscais',
  execucao: 'Todo dia às 7h',
  fluxo: '1. baixa notas 2. compara 3. grava',
  dependencias: 'Metabase, Protheus',
  configurar_antes: 'Token do Protheus',
  atencao: 'Base pedidos_cancelados precisa estar atualizada',
};

describe('buildRespostasFormulario — bloco único do formulário', () => {
  it('renderiza o contrafactual por PESSOA com nomes legíveis', () => {
    const bloco = buildRespostasFormulario({
      ...ctxBase,
      contrafactual_afetados: serializarAfetados('pessoa', ['ana@gocase.com', 'bruno@gocase.com']),
      contrafactual_reclamacao: 'Volta a conferir 400 notas à mão por dia',
    });
    expect(bloco).toContain('Pessoas que sentiriam falta');
    expect(bloco).toContain('ana@gocase.com, bruno@gocase.com');
    expect(bloco).toContain('Volta a conferir 400 notas à mão por dia');
  });

  it('renderiza o contrafactual por TIME com o rótulo certo', () => {
    const bloco = buildRespostasFormulario({
      ...ctxBase,
      contrafactual_afetados: serializarAfetados('time', ['Fiscal', 'CX']),
    });
    expect(bloco).toContain('Times/áreas que sentiriam falta');
    expect(bloco).toContain('Fiscal, CX');
  });

  it('instrui a NÃO repetir a pergunta e a apontar contradição', () => {
    const bloco = buildRespostasFormulario({ ...ctxBase, descricao_breve: 'Automatiza a conciliação' });
    expect(bloco).toContain('NUNCA pergunte de novo');
    expect(bloco).toMatch(/CONTRADIZER/i);
  });

  it('é omitido por completo quando nada foi preenchido', () => {
    expect(buildRespostasFormulario(ctxBase)).toBe('');
  });

  it('sobrevive a valor legado sem prefixo (não derruba o prompt)', () => {
    const bloco = buildRespostasFormulario({
      ...ctxBase,
      contrafactual_afetados: 'ana@gocase.com',
      contrafactual_reclamacao: 'Piora o fechamento',
    });
    // Sem prefixo a lista vem vazia — o que piora ainda tem de aparecer.
    expect(bloco).toContain('Piora o fechamento');
  });
});

describe('o bloco chega a TODAS as fases (era o defeito)', () => {
  const ctx: ProjetoContexto = {
    ...ctxBase,
    descricao_breve: 'Automatiza a conciliação fiscal',
    contrafactual_afetados: serializarAfetados('time', ['Fiscal']),
    contrafactual_reclamacao: 'Volta a conferir 400 notas à mão',
  };

  it.each([
    ['doc', () => buildDocPrompt(ctx, documentacaoVazia())],
    ['saving', () => buildSavingPrompt(ctx, docCompleta, savingVazio(), 'resumo')],
    ['receita', () => buildReceitaPrompt(ctx, docCompleta, receitaVazia(), 'resumo')],
  ])('a fase %s recebe o contrafactual do formulário', (_fase, build) => {
    const prompt = build();
    expect(prompt).toContain('Volta a conferir 400 notas à mão');
    expect(prompt).toContain('Fiscal');
  });

  it('a fase de custo evitado puro também recebe', () => {
    // alguem_fazia === 'externo' delega para buildSavingCustoEvitadoPrompt.
    const prompt = buildSavingPrompt({ ...ctx, alguem_fazia: 'externo' }, docCompleta, savingVazio(), 'r');
    expect(prompt).toContain('Volta a conferir 400 notas à mão');
  });
});

describe('buildDetalhesAprovados — a doc que a fase financeira herda', () => {
  it('inclui as seções onde os SISTEMAS NOMEADOS aparecem (insumo do [1.4])', () => {
    const detalhes = buildDetalhesAprovados(ctxBase, docCompleta, 'resumo');
    expect(detalhes).toContain('Metabase, Protheus');
    expect(detalhes).toContain('Token do Protheus');
    expect(detalhes).toContain('pedidos_cancelados');
  });

  it('omite as seções vazias em vez de escrever "null"', () => {
    const detalhes = buildDetalhesAprovados(ctxBase, { ...docCompleta, dependencias: null, atencao: null }, 'r');
    expect(detalhes).not.toContain('Dependências');
    expect(detalhes).not.toContain('Pontos de atenção');
    expect(detalhes).not.toMatch(/: null/);
  });
});

describe('[1.4] parte do que já foi respondido', () => {
  it('manda deduzir o ponteiro do contrafactual antes de perguntar', () => {
    const prompt = buildSavingPrompt(ctxBase, docCompleta, savingVazio(), 'resumo');
    expect(prompt).toMatch(/PRIMEIRO olhe as RESPOSTAS QUE O AUTOR JÁ DEU/);
    expect(prompt).toMatch(/vá direto ao item \(b\)/);
  });

  it('manda propor a fonte que a doc já nomeia', () => {
    const prompt = buildSavingPrompt(ctxBase, docCompleta, savingVazio(), 'resumo');
    expect(prompt).toMatch(/se a doc já nomeia o sistema\/base/i);
  });
});
