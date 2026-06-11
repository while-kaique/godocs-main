// Testes: prompts do orquestrador (verificam que os prompts são construídos corretamente)
// Importa as funções de build de prompt indiretamente via o módulo do orquestrador
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjetoContexto, DocumentacaoColetada, SavingColetado } from '@/lib/agents/types';
import { documentacaoVazia, receitaVazia, savingVazio } from '@/lib/agents/types';

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
      receita: receitaVazia(),
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

  it('inclui regra de confiar nos campos extraídos do código', async () => {
    await runOrchestrator(makeCtx({ doc_texto: 'algo' }), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('não questione a veracidade dos campos extraídos');
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

describe('Prompt fase saving (tipo saving)', () => {
  const savingPreenchido = {
    ...savingVazio(),
    linhas: [
      { cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2, valor_hora: 29.90, economia_horas_mes: 38, economia_reais_mes: 1136.20 },
    ],
    economia_horas_mes: 38,
    economia_reais_mes: 1136.20,
    tipo_saving: 'mensal' as const,
  };

  it('inclui dados determinísticos pré-preenchidos', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('Analista Pleno');
    expect(system).toContain('40h/mês');
    expect(system).toContain('2h/mês');
    expect(system).toContain('VALIDAR');
  });

  it('instrui IA a NÃO perguntar sobre campos já definidos', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('NÃO pergunte sobre eles');
    expect(system).toContain('NÃO MENCIONE valores em R$');
  });

  it('inclui regras de validação de horas', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('VALIDAÇÃO DE HORAS');
    expect(system).toContain('NUNCA aceite as horas');
    expect(system).toContain('detalhar a rotina manual');
  });

  it('inclui regras anti-extrapolação', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('ANTI-EXTRAPOLAÇÃO');
    expect(system).toContain('ganho REAL');
  });

  it('inclui resumo do projeto como contexto', async () => {
    const resumo = 'O projeto automatiza o cadastro de embaixadores via Typebot.';
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingPreenchido, resumo, ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain(resumo);
  });

  it('mensagem de sistema inclui dados do formulário', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const userMsg = capturedMessages.find(m => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('[SISTEMA]');
    expect(userMsg).toContain('Analista Pleno');
    expect(userMsg).toContain('40h→2h');
  });
});

describe('Prompt fase receita (tipo receita_incremental)', () => {
  it('instrui IA a coletar valor de receita ganho', async () => {
    await runOrchestrator(makeCtx(), [], 'receita', documentacaoVazia(), savingVazio(), 'Resumo', ['receita_incremental']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('receita incremental');
    expect(system).toContain('valor_ganho_mensal');
    expect(system).toContain('memorial_calculo');
  });

  it('não menciona cargo ou horas', async () => {
    await runOrchestrator(makeCtx(), [], 'receita', documentacaoVazia(), savingVazio(), 'Resumo', ['receita_incremental']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).not.toContain('Horas gastas antes');
    expect(system).not.toContain('Cargo de quem executava');
  });

  it('mensagem de sistema menciona receita incremental', async () => {
    await runOrchestrator(makeCtx(), [], 'receita', documentacaoVazia(), savingVazio(), 'Resumo', ['receita_incremental']);
    const userMsg = capturedMessages.find(m => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('[SISTEMA]');
    expect(userMsg).toContain('receita incremental');
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

  it('doc_preview → saving quando type=complete e tipos inclui saving', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'complete', content: 'Resumo', coletado: documentacaoVazia() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'doc_preview', documentacaoVazia(), savingVazio(), '', ['saving']);
    expect(result.fase).toBe('saving');
  });

  it('doc_preview → receita quando type=complete e tipos é só receita_incremental', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'complete', content: 'Resumo', coletado: documentacaoVazia() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'doc_preview', documentacaoVazia(), savingVazio(), '', ['receita_incremental']);
    expect(result.fase).toBe('receita');
  });

  it('saving → saving_preview quando type=preview', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'preview', content: '## Memorial', saving: savingVazio() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'mensal' }], 'saving');
    expect(result.fase).toBe('saving_preview');
  });

  it('saving_preview → completo quando type=complete e só saving', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'complete', content: 'Aprovado!', saving: savingVazio() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'saving_preview', documentacaoVazia(), savingVazio(), '', ['saving']);
    expect(result.fase).toBe('completo');
  });

  it('saving_preview → receita quando type=complete e tipos inclui ambos', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'complete', content: 'Aprovado!', saving: savingVazio() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'saving_preview', documentacaoVazia(), savingVazio(), '', ['saving', 'receita_incremental']);
    expect(result.fase).toBe('receita');
  });

  it('receita_preview → completo quando type=complete', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'complete', content: 'Receita aprovada!' })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'receita_preview');
    expect(result.fase).toBe('completo');
  });

  it('mantém fase quando type=question', async () => {
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(
      JSON.stringify({ type: 'question', content: 'Pergunta?', coletado: documentacaoVazia() })
    );
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'algo' }], 'doc');
    expect(result.fase).toBe('doc');
  });

  // Regressão: JSON truncado (limite de tokens) na aprovação não pode travar a transição.
  // O resumo longo + echo de `coletado` estourava o limite, caía no fallback de recuperação
  // e a fase ficava presa em doc_preview (resumo aparecia como mensagem solta no chat).
  it('doc_preview → saving mesmo com JSON truncado (type=complete recuperado)', async () => {
    const truncado = '{"type":"complete","content":"Resumo factual do projeto que ficou cortado no meio';
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(truncado);
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'doc_preview', documentacaoVazia(), savingVazio(), '', ['saving']);
    expect(result.type).toBe('complete');
    expect(result.fase).toBe('saving');
  });

  it('saving_preview → completo mesmo com JSON truncado (type=complete recuperado)', async () => {
    const truncado = '{"type":"complete","content":"Memorial aprovado e cortado no meio';
    vi.mocked((await import('@/lib/llm')).llmChat).mockResolvedValueOnce(truncado);
    const result = await runOrchestrator(makeCtx(), [{ role: 'user', content: 'Aprovado' }], 'saving_preview', documentacaoVazia(), savingVazio(), '', ['saving']);
    expect(result.type).toBe('complete');
    expect(result.fase).toBe('completo');
  });
});
