// Testes: prompts do orquestrador (verificam que os prompts são construídos corretamente)
// Importa as funções de build de prompt indiretamente via o módulo do orquestrador
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjetoContexto, DocumentacaoColetada, SavingColetado } from '@/lib/agents/types';
import { documentacaoVazia, savingVazio } from '@/lib/agents/types';

// Mock do LLM para capturar os prompts enviados
let capturedMessages: { role: string; content: string }[] = [];
vi.mock('@/lib/llm', () => ({
  llmChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    capturedMessages = messages;
    return JSON.stringify({
      type: 'question',
      content: 'mock response',
      coletado: documentacaoVazia(),
      saving: savingVazio(),
    });
  }),
}));

const { runOrchestrator } = await import('@/lib/agents/orchestrator');

function makeCtx(overrides: Partial<ProjetoContexto> = {}): ProjetoContexto {
  return {
    responsavel_nome: 'Teste',
    responsavel_email: 'teste@gocase.com',
    area: 'CX',
    ferramenta: 'n8n',
    membros: [],
    nome_projeto: 'Projeto Teste',
    data_criacao: '2025-06-01',
    doc_texto: null,
    ...overrides,
  };
}

beforeEach(() => {
  capturedMessages = [];
});

describe('Prompt fase doc', () => {
  it('inclui os 7 campos da estrutura do documento', async () => {
    await runOrchestrator(makeCtx(), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('nome_projeto');
    expect(system).toContain('o_que_faz');
    expect(system).toContain('execucao');
    expect(system).toContain('dependencias');
    expect(system).toContain('fluxo');
    expect(system).toContain('configurar_antes');
    expect(system).toContain('atencao');
  });

  it('inclui informação sobre arquivos quando fornecidos', async () => {
    await runOrchestrator(makeCtx({ doc_texto: 'Meu workflow faz cadastro de embaixadores' }), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    // O prompt novo não embute o texto do doc no system prompt (fica no contexto do extractor)
    // mas deve mencionar que o sistema leu os arquivos
    expect(system).toContain('campos');
  });

  it('indica quando não há arquivo enviado', async () => {
    await runOrchestrator(makeCtx({ doc_texto: null }), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('Nenhum arquivo');
  });

  it('inclui dados do projeto no prompt', async () => {
    await runOrchestrator(makeCtx({ nome_projeto: 'Bot CX', ferramenta: 'Python' }), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('Bot CX');
    expect(system).toContain('Python');
  });

  it('inclui regra de não perguntar campos já preenchidos', async () => {
    await runOrchestrator(makeCtx({ doc_texto: 'algo' }), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('NÃO peça confirmação');
  });

  it('inclui regra de nunca inventar informações', async () => {
    await runOrchestrator(makeCtx(), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('NUNCA invente');
  });

  it('envia mensagem de sistema para iniciar quando sem histórico', async () => {
    await runOrchestrator(makeCtx({ doc_texto: 'doc texto aqui' }), [], 'doc');
    const userMsg = capturedMessages.find(m => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('[SISTEMA]');
    // Novo paradigma: mensagem fala sobre arquivos/campos, não "Leia a documentação"
    expect(userMsg).toContain('sistema');
  });

  it('não envia mensagem de sistema quando há histórico', async () => {
    await runOrchestrator(
      makeCtx(),
      [{ role: 'user', content: 'oi' }],
      'doc'
    );
    const msgs = capturedMessages.filter(m => m.content.includes('[SISTEMA]'));
    expect(msgs).toHaveLength(0);
  });

  it('inclui guia de formatação do preview (listas/negrito/parágrafos)', async () => {
    await runOrchestrator(makeCtx(), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('FORMATAÇÃO DO PREVIEW');
    expect(system).toContain('LISTA NUMERADA');
  });
});

describe('Prompt fase doc_preview', () => {
  it('inclui guia de formatação ao gerar novo preview após ajuste', async () => {
    await runOrchestrator(makeCtx(), [{ role: 'user', content: 'ajuste o fluxo' }], 'doc_preview');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('FORMATAÇÃO DO PREVIEW');
  });
});

describe('Prompt fase saving', () => {
  it('inclui os 5 campos do saving', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingVazio(), 'Resumo do projeto');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('economia_horas_mes');
    expect(system).toContain('valor_hora');
    expect(system).toContain('economia_reais_mes');
    expect(system).toContain('tipo_saving');
    expect(system).toContain('memorial_calculo');
  });

  it('inclui tabela de referência de cargos', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingVazio(), 'Resumo');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('Estagiário');
    expect(system).toContain('10,78');
    expect(system).toContain('Coordenador');
    expect(system).toContain('55,15');
  });

  it('inclui regras de validação de horas', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingVazio(), 'Resumo');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('VALIDAÇÃO DE HORAS');
    expect(system).toContain('NUNCA aceite um número de horas');
    expect(system).toContain('JUSTIFICAR');
  });

  it('inclui regras anti-extrapolação', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingVazio(), 'Resumo');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('ANTI-EXTRAPOLAÇÃO');
    expect(system).toContain('ganho REAL');
  });

  it('inclui resumo do projeto como contexto', async () => {
    const resumo = 'O projeto automatiza o cadastro de embaixadores via Typebot.';
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingVazio(), resumo);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain(resumo);
  });

  it('mensagem de sistema pede apresentação + pergunta', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingVazio(), 'Resumo');
    const userMsg = capturedMessages.find(m => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('[SISTEMA]');
    expect(userMsg).toContain('pergunta');
  });
});

describe('Transições de fase', () => {
  it('doc → doc_preview quando type=preview', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'preview', content: '# Preview', coletado: documentacaoVazia() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'teste' }], 'doc');
    expect(result.fase).toBe('doc_preview');
  });

  it('doc_preview → saving quando type=complete', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'complete', content: 'Resumo', coletado: documentacaoVazia() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'doc_preview');
    expect(result.fase).toBe('saving');
  });

  it('saving → saving_preview quando type=preview', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'preview', content: '## Memorial', saving: savingVazio() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'mensal' }], 'saving');
    expect(result.fase).toBe('saving_preview');
  });

  it('saving_preview → completo quando type=complete', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'complete', content: 'Aprovado!', saving: savingVazio() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'saving_preview');
    expect(result.fase).toBe('completo');
  });

  it('mantém fase quando type=question', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'question', content: 'Pergunta?', coletado: documentacaoVazia() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'algo' }], 'doc');
    expect(result.fase).toBe('doc');
  });
});
