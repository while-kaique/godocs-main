import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock da camada LLM — não queremos rede nos testes. Controlamos o que o "agente"
// devolve a cada chamada para exercitar o parse, o retry e o lançamento sem fallback.
vi.mock('@/lib/llm', () => ({ llmChat: vi.fn() }));

import { llmChat } from '@/lib/llm';
import { parseDocJson, compilarDocumentacao } from '@/lib/agents/doc-compiler';
import type { DocumentacaoColetada, ProjetoContexto } from '@/lib/agents/types';

const llmChatMock = vi.mocked(llmChat);

const ctx: ProjetoContexto = {
  responsavel_nome: 'Luis Albuquerque',
  responsavel_email: 'luis.albuquerque@gocase.com',
  area: 'Tecnologia',
  ferramenta: 'Python',
  membros: ['Kaique'],
  doc_texto: '',
  tipo_projeto: 'saving',
  tipos_projeto: ['saving'],
} as ProjetoContexto;

const coletado: DocumentacaoColetada = {
  nome_projeto: 'Auditoria de Workflows n8n',
  o_que_faz: 'Audita workflows de múltiplas instâncias do n8n e grava em Google Sheets.',
  execucao: 'Manual via Python (main.py).',
  dependencias: 'n8n API; Google Sheets',
  fluxo: 'Coletar workflows; atualizar abas',
  configurar_antes: 'Configurar service account',
  atencao: 'Rate limit das APIs do n8n',
};

const DOC_VALIDA = JSON.stringify({
  titulo: 'Auditoria de Workflows n8n',
  responsavel: { nome: 'Luis', email: 'luis.albuquerque@gocase.com', area: 'Tecnologia' },
  ferramenta: 'Python',
  membros: ['Kaique'],
  o_que_faz: 'Audita workflows do n8n.',
  execucao: 'Manual.',
  dependencias: [{ servico: 'n8n API', descricao: 'coleta' }],
  fluxo: [{ etapa: 'Coletar', descricao: 'coleta workflows' }],
  configurar_antes: ['service account'],
  atencao: [{ titulo: 'Rate limit', descricao: 'pode atrasar' }],
});

// Reproduz o erro do log: resposta cortada no meio (Unexpected end of JSON input).
const DOC_TRUNCADA = '{\n  "titulo": "asdasd",\n  "responsavel": { "nome": "asdad", "email": ';

beforeEach(() => {
  llmChatMock.mockReset();
});

describe('parseDocJson', () => {
  it('parseia JSON válido e completo', () => {
    const doc = parseDocJson(JSON.stringify({ titulo: 'X', o_que_faz: 'faz algo' }));
    expect(doc).not.toBeNull();
    expect(doc?.titulo).toBe('X');
  });

  it('retorna null para JSON truncado', () => {
    expect(parseDocJson(DOC_TRUNCADA)).toBeNull();
  });

  it('retorna null para JSON válido mas sem conteúdo mínimo', () => {
    expect(parseDocJson('{}')).toBeNull();
    expect(parseDocJson('"texto solto"')).toBeNull();
  });
});

describe('compilarDocumentacao', () => {
  it('compila na 1ª tentativa quando a IA devolve JSON válido', async () => {
    llmChatMock.mockResolvedValueOnce(DOC_VALIDA);

    const doc = await compilarDocumentacao(ctx, coletado);

    expect(doc.titulo).toBe('Auditoria de Workflows n8n');
    expect(doc.gerado_em).toBeTruthy();
    expect(llmChatMock).toHaveBeenCalledTimes(1);
  });

  it('faz retry e compila quando a 1ª resposta vem truncada', async () => {
    llmChatMock.mockResolvedValueOnce(DOC_TRUNCADA).mockResolvedValueOnce(DOC_VALIDA);

    const doc = await compilarDocumentacao(ctx, coletado);

    expect(doc.o_que_faz).toBe('Audita workflows do n8n.');
    expect(llmChatMock).toHaveBeenCalledTimes(2);
  });

  it('LANÇA (sem fallback) quando a IA nunca devolve JSON válido', async () => {
    llmChatMock.mockResolvedValue(DOC_TRUNCADA);

    await expect(compilarDocumentacao(ctx, coletado)).rejects.toThrow(
      /não retornou um JSON válido/i,
    );
    // Tentou MAX_ATTEMPTS (3) vezes antes de desistir.
    expect(llmChatMock).toHaveBeenCalledTimes(3);
  });
});
