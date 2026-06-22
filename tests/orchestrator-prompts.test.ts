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

  it('padroniza a verificação de IA: infere dos arquivos, SEMPRE pergunta com caixas de seleção, detecta contradição', async () => {
    await runOrchestrator(makeCtx(), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('SEMPRE com caixas de seleção');
    // Passo 1: inferência dos arquivos
    expect(system).toContain('ia_inferida_dos_arquivos');
    // Passo 2: pergunta com contexto
    expect(system).toContain('PASSO 2 — PERGUNTE COM CONTEXTO');
    // Passo 2.5: se "Sim" sem descrever como, pergunta como a IA é usada (aceita resposta simples)
    expect(system).toContain('PASSO 2.5 — SE "SIM", ENTENDA COMO A IA É USADA');
    expect(system).toContain('Aceite uma resposta SIMPLES e curta');
    // Passo 3: detecção de contradição
    expect(system).toContain('ia_contradição');
    // As 3 opções padrão continuam presentes
    expect(system).toContain('Sim, tem IA como funcionalidade');
    expect(system).toContain('Não, é uma automação determinística');
    expect(system).toContain('Não tenho certeza, me explique melhor');
    // Não repete se já respondido
    expect(system).toContain('Só NÃO repita a pergunta se tem_ia_como_funcionalidade JÁ estiver definido');
  });

  it('inclui guia de formatação do preview (listas/negrito/parágrafos)', async () => {
    await runOrchestrator(makeCtx(), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('FORMATAÇÃO DO PREVIEW');
    expect(system).toContain('LISTA NUMERADA');
  });
});

describe('Contexto de revisão (edição)', () => {
  const revisao = {
    doc: {
      o_que_faz: 'Gera relatório PDF e envia por email.',
      execucao: 'Cron diário 07:00.',
      fluxo: '1. Dispara\n2. Consulta SAP\n3. Envia',
      dependencias: 'SAP B1; SMTP',
      configurar_antes: 'SAP_URL; SMTP_USER',
      atencao: 'API SAP fora: falha silenciosa',
    },
    saving: {
      memorial_calculo: 'Analista gastava 40h/mês; passou a 2h/mês.',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2 }],
      economia_horas_mes: 38,
      economia_reais_mes: 1136.2,
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      custo_externo_mensal: 0,
    },
    receita: { memorial_calculo: 'Aumento de conversão.', valor_ganho_mensal: 25000 },
  };

  const savingPreenchido = {
    ...savingVazio(),
    linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 6, valor_hora: 29.9, economia_horas_mes: 34, economia_reais_mes: 1016.6 }],
    economia_horas_mes: 34,
    economia_reais_mes: 1016.6,
    tipo_saving: 'mensal' as const,
  };

  it('NÃO adiciona o bloco de revisão na primeira submissão (sem revisao)', async () => {
    await runOrchestrator(makeCtx(), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).not.toContain('CONTEXTO DE REVISÃO');
  });

  it('adiciona o bloco de revisão na fase doc quando o projeto já foi submetido', async () => {
    await runOrchestrator(makeCtx({ revisao }), [], 'doc');
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('CONTEXTO DE REVISÃO (EDIÇÃO)');
    expect(system).toContain('DOCUMENTAÇÃO TÉCNICA APROVADA ANTERIORMENTE');
    expect(system).toContain('Gera relatório PDF e envia por email.');
    expect(system).toContain('NÃO recomece do zero');
    expect(system).toContain('Valide APENAS o que mudou');
  });

  it('na fase saving traz o memorial e as horas antes/depois anteriores', async () => {
    await runOrchestrator(makeCtx({ revisao }), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('MEMORIAL DE SAVING APROVADO ANTERIORMENTE');
    expect(system).toContain('Analista Pleno: 40h antes → 2h depois');
    expect(system).toContain('Analista gastava 40h/mês; passou a 2h/mês.');
    // O bloco vem ANTES dos dados atuais do formulário (contexto antes da 1ª pergunta)
    expect(system.indexOf('CONTEXTO DE REVISÃO')).toBeLessThan(system.indexOf('DADOS JÁ DEFINIDOS PELO USUÁRIO'));
  });

  it('não vaza valores em R$ anteriores no bloco de saving', async () => {
    await runOrchestrator(makeCtx({ revisao }), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    const bloco = system.slice(system.indexOf('CONTEXTO DE REVISÃO'), system.indexOf('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', system.indexOf('CONTEXTO DE REVISÃO') + 1));
    expect(bloco).not.toContain('1136');
    expect(bloco).toContain('staff-only');
  });

  it('na fase receita traz o memorial e o valor anteriores', async () => {
    await runOrchestrator(makeCtx({ revisao }), [], 'receita', documentacaoVazia(), savingVazio(), 'Resumo', ['receita_incremental']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('MEMORIAL DE RECEITA APROVADO ANTERIORMENTE');
    expect(system).toContain('25000');
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
    expect(system).toContain('SEM R$ NO CONTEÚDO VISÍVEL');
  });

  it('inclui regras de validação de horas', async () => {
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), savingPreenchido, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('VALIDAÇÃO DE HORAS');
    expect(system).toContain('NUNCA aceite as horas');
    expect(system).toContain('detalhar a rotina');
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

describe('Abertura determinística por perfil das horas (anti-pergunta-burra)', () => {
  const mkSaving = (linhas: { cargo: string; horas_antes: number; horas_depois: number }[]) => ({
    ...savingVazio(),
    linhas: linhas.map((l) => ({ ...l, valor_hora: 29.9, economia_horas_mes: Math.max(0, l.horas_antes - l.horas_depois), economia_reais_mes: 0 })),
    economia_horas_mes: linhas.reduce((s, l) => s + Math.max(0, l.horas_antes - l.horas_depois), 0),
    economia_reais_mes: 0,
    tipo_saving: 'mensal' as const,
  });

  it('0h antes + 0h depois: investiga saving contrafactual ANTES de descartar horas', async () => {
    const saving = mkSaving([{ cargo: 'Estagiário', horas_antes: 0, horas_depois: 0 }]);
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), saving, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    // Não pede rotina que nunca existiu, mas NÃO conclui "sem saving" sem investigar o contrafactual
    expect(system).toContain('SAVING CONTRAFACTUAL');
    expect(system).toContain('precisaria ser feita por alguém');
    expect(system).toContain('PREENCHA horas_antes');
    expect(system).toContain('NUNCA declare "não entra como economia de horas"');
    // A diretiva de abertura precede e domina a regra genérica de validação de horas
    expect(system.indexOf('COMO ABRIR A CONVERSA')).toBeLessThan(system.indexOf('VALIDAÇÃO DE HORAS'));
  });

  it('0h antes + horas depois > 0: investiga contrafactual e trata o depois como monitoramento', async () => {
    const saving = mkSaving([{ cargo: 'Analista Pleno', horas_antes: 0, horas_depois: 2 }]);
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), saving, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('monitoramento/supervisão');
    expect(system).toContain('SAVING CONTRAFACTUAL');
    expect(system).toContain('PREENCHA horas_antes');
  });

  it('inclui o cenário 2 (saving contrafactual) e a regra anti-repetição', async () => {
    const saving = mkSaving([{ cargo: 'Estagiário', horas_antes: 0, horas_depois: 0 }]);
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), saving, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    // Cenário 2 nas REGRAS DE PREENCHIMENTO
    expect(system).toContain('Saving contrafactual — tarefa inviável de fazer à mão');
    expect(system).toContain('era inviável dedicar gente a fazer');
    // Anti-repetição / reconhecer correção do usuário
    expect(system).toContain('NÃO RE-PERGUNTE O QUE JÁ FOI RESPONDIDO');
    expect(system).toContain('perdeu o contexto');
  });

  it('horas antes > 0: abre validando a rotina manual real', async () => {
    const saving = mkSaving([{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2 }]);
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), saving, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('Há rotina manual real');
    expect(system).toContain('VALIDAÇÃO DE HORAS — OBRIGATÓRIO (aplica-se SOMENTE às linhas com horas antes > 0)');
  });

  it('linhas mistas (uma 0h antes, outra com horas): instrui a separar os casos', async () => {
    const saving = mkSaving([
      { cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2 },
      { cargo: 'Estagiário', horas_antes: 0, horas_depois: 1 },
    ]);
    await runOrchestrator(makeCtx(), [], 'saving', documentacaoVazia(), saving, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('parte das linhas tem 0h antes');
    expect(system).toContain('valide a rotina manual normalmente');
  });

  it('ninguém fazia (alguem_fazia="nao"): trata horas_antes como equivalente manual estimado, não rotina real', async () => {
    // No novo modelo, "ninguém fazia" preenche horas_antes com o EQUIVALENTE manual
    // estimado (depois = 0). Mesmo com horas_antes > 0, NÃO é uma rotina que existia.
    const saving = mkSaving([{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 0 }]);
    await runOrchestrator(makeCtx({ alguem_fazia: 'nao' }), [], 'saving', documentacaoVazia(), saving, 'Resumo', ['saving']);
    const system = capturedMessages.find(m => m.role === 'system')?.content ?? '';
    expect(system).toContain('EQUIVALENTE manual');
    expect(system).toContain('VALIDAR a estimativa');
    expect(system).toContain('saving contrafactual');
    // Vence a detecção por horas: NÃO abre como rotina manual real (caso clássico).
    expect(system).not.toContain('Há rotina manual real');
    // E a seção de validação ganha a variante de estimativa (não "detalhe a rotina").
    expect(system).toContain('NESTE PROJETO NINGUÉM FAZIA A TAREFA');
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
