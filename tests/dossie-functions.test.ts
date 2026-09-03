// T11 — Dossiê do projeto (D17), lado SERVIDOR (`src/lib/avaliacao/dossie.functions.ts`).
//
// Prende que `carregarDossie` junta as 6 fontes persistidas (projetos, documentacao,
// espelho da planilha, versões, form_events, cargo na TeamGuide) via `montarDossie`,
// NUNCA lança (fonte que falha vira LACUNA, não exceção) e NÃO toca em `chat_messages`
// — o mock do client.server abaixo não expõe `getChatMessages`/`getChatHistory` de
// propósito: se a implementação importar ou chamar um deles, o vitest acusa.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProjetoById = vi.fn<(id: string) => Promise<Record<string, unknown> | undefined>>();
const getDocumentacaoConteudo = vi.fn<(id: string) => Promise<{ conteudo: string } | undefined>>();
const getVersoesRecentesDe = vi.fn<(ids: string[]) => Promise<unknown[]>>();
const getFormEventsByProjeto = vi.fn<(id: string) => Promise<unknown[]>>();
const lerLinhaEspelho = vi.fn<(id: string) => Promise<Record<string, string> | null>>();
const getCargoDe = vi.fn<(email: string) => Promise<string | null>>();

// ⚠️ SEM getChatMessages / getChatHistory — é a afirmação do critério 12.
vi.mock('@/integrations/db/client.server', () => ({
  getProjetoById: (...a: unknown[]) => getProjetoById(...(a as [string])),
  getDocumentacaoConteudo: (...a: unknown[]) => getDocumentacaoConteudo(...(a as [string])),
  getVersoesRecentesDe: (...a: unknown[]) => getVersoesRecentesDe(...(a as [string[]])),
  getFormEventsByProjeto: (...a: unknown[]) => getFormEventsByProjeto(...(a as [string])),
}));
vi.mock('@/lib/sheet-espelho', () => ({
  lerLinhaEspelho: (...a: unknown[]) => lerLinhaEspelho(...(a as [string])),
}));
vi.mock('@/lib/areas/teamguide.server', () => ({
  getCargoDe: (...a: unknown[]) => getCargoDe(...(a as [string])),
}));

import { carregarDossie } from '@/lib/avaliacao/dossie.functions';

const ID = 'abc123';

function projetoBase(): Record<string, unknown> {
  return {
    id: ID,
    nome: 'Robô de Conciliação',
    descricao_breve: 'Concilia extratos.',
    responsavel_nome: 'Ana Silva',
    responsavel_email: 'ana.silva@gocase.com',
    area: 'Financeiro',
    especial: 0,
    tipos_projeto: '["saving"]',
    ferramenta: 'Python',
    escopo: 'Área',
    saving_horas: 60,
    saving_reais: 8844,
    tipo_saving: 'mensal',
    alguem_fazia: 'sim',
    custo_evitado_reais: null,
    custo_evitado_itens: '[]',
    custo_projeto_itens: '[]',
    custo_externo_mensal: 0,
    ganho_total_mensal: 8844,
    memorial_calculo: 'M',
    contrafactual_afetados: '[]',
    membros: '["ana.silva@gocase.com"]',
    arquivos_links: '[]',
    contexto_especial: null,
    descontinuado: 0,
    atualizado_em: '2026-08-20 10:00:00',
    submitted_at: '2026-08-01 09:00:00',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProjetoById.mockResolvedValue(projetoBase());
  getDocumentacaoConteudo.mockResolvedValue({
    conteudo: JSON.stringify({
      o_que_faz: 'Lê o extrato.',
      execucao: 'Diário.',
      fluxo: [{ etapa: 'A', descricao: 'a' }],
      dependencias: [],
      atencao: [],
      configurar_antes: [],
      saving: { linhas: [{ cargo: 'Analista', horas_antes: 60, horas_depois: 0 }] },
    }),
  });
  getVersoesRecentesDe.mockResolvedValue([
    {
      projeto_id: ID,
      versao_num: 1,
      acao: 'submit_inicial',
      snapshot_projeto: JSON.stringify({ nome: 'Robô', saving_reais: 100 }),
      snapshot_doc: null,
      submetido_por: 'ana.silva@gocase.com',
      created_at: '2026-08-01 09:00:00',
    },
    {
      projeto_id: ID,
      versao_num: 2,
      acao: 'reenvio',
      snapshot_projeto: JSON.stringify({ nome: 'Robô', saving_reais: 250 }),
      snapshot_doc: null,
      submetido_por: 'ana.silva@gocase.com',
      created_at: '2026-08-20 10:00:00',
    },
  ]);
  getFormEventsByProjeto.mockResolvedValue([
    { id: 'e1', projeto_id: ID, tipo: 'submissao', fase: 'doc', dados: '{}', created_at: '2026-08-01 09:00:00' },
  ]);
  lerLinhaEspelho.mockResolvedValue({
    'ID Projeto': ID,
    Status: 'Aprovado',
    Estrelas: '5',
    Classificação: 'claro_sim',
    'Motivo Reprovado': '—',
    'Motivo Reenvio': '—',
    'Aprovação do Lider': 'Pré-aprovado',
    'Justificativa Aprovação do Lider': 'ok',
    Observações: 'parecer',
    'Memorial de Saving': 'R$ 8.844,00',
    'Receita Memorial': '—',
    'Receita Mensal': '',
    'Tipo de Receita': '—',
    Complexidade: 'Média',
  });
  getCargoDe.mockResolvedValue('Analista');
});

describe('carregarDossie — caminho feliz', () => {
  it('consulta as 6 fontes pelo id/e-mail certos e monta o dossiê completo', async () => {
    const d = await carregarDossie(ID);
    expect(d).not.toBeNull();

    expect(getProjetoById).toHaveBeenCalledWith(ID);
    expect(getDocumentacaoConteudo).toHaveBeenCalledWith(ID);
    expect(getVersoesRecentesDe).toHaveBeenCalledWith([ID]);
    expect(getFormEventsByProjeto).toHaveBeenCalledWith(ID);
    expect(lerLinhaEspelho).toHaveBeenCalledWith(ID);
    expect(getCargoDe).toHaveBeenCalledWith('ana.silva@gocase.com');

    expect(d!.fonte).toBe('app');
    expect(d!.id).toBe(ID);
    expect(d!.autor.cargo).toBe('Analista');
    expect(d!.documentacao.presente).toBe(true);
    expect(d!.financeiro.linhas).toEqual([{ cargo: 'Analista', horas_antes: 60, horas_depois: 0 }]);
    expect(d!.triagem.status).toBe('Aprovado');
    expect(d!.triagem.estrelas).toBe(5);
    expect(d!.submissao.versao).toBe(2);
    expect(d!.submissao.reenvios).toBe(1);
    expect(d!.historico.mudancas_ultimo_reenvio).toEqual([
      { campo: 'saving_reais', antes: 100, depois: 250 },
    ]);
    expect(d!.historico.eventos).toHaveLength(1);
    // Nenhuma lacuna além das inevitáveis.
    expect([...d!.lacunas].sort()).toEqual(['texto_anexos', 'v2']);
  });

  it('projeto inexistente no banco E fora do espelho → null', async () => {
    getProjetoById.mockResolvedValue(undefined);
    lerLinhaEspelho.mockResolvedValue(null);
    await expect(carregarDossie('nao-existe')).resolves.toBeNull();
  });

  it('projeto só na planilha (legado sem linha em projetos) → dossiê da planilha com lacuna "projeto"', async () => {
    getProjetoById.mockResolvedValue(undefined);
    getDocumentacaoConteudo.mockResolvedValue(undefined);
    getVersoesRecentesDe.mockResolvedValue([]);
    getFormEventsByProjeto.mockResolvedValue([]);
    const d = await carregarDossie(ID);
    expect(d).not.toBeNull();
    expect(d!.fonte).toBe('planilha');
    expect(d!.lacunas).toContain('projeto');
  });
});

describe('carregarDossie — NUNCA lança', () => {
  it('lerLinhaEspelho rejeitando → dossiê sai com lacuna "espelho" e triagem vazia', async () => {
    lerLinhaEspelho.mockRejectedValue(new Error('SQLite fora'));
    const d = await carregarDossie(ID);
    expect(d).not.toBeNull();
    expect(d!.fonte).toBe('app');
    expect(d!.lacunas).toContain('espelho');
    expect(d!.triagem.status).toBeNull();
  });

  it('getCargoDe lançando → cargo null e lacuna "teamguide"', async () => {
    getCargoDe.mockRejectedValue(new Error('TeamGuide 401'));
    const d = await carregarDossie(ID);
    expect(d).not.toBeNull();
    expect(d!.autor.cargo).toBeNull();
    expect(d!.lacunas).toContain('teamguide');
  });

  it('getDocumentacaoConteudo e getVersoesRecentesDe rejeitando → lacunas, não exceção', async () => {
    getDocumentacaoConteudo.mockRejectedValue(new Error('boom doc'));
    getVersoesRecentesDe.mockRejectedValue(new Error('boom versoes'));
    const d = await carregarDossie(ID);
    expect(d).not.toBeNull();
    expect(d!.documentacao.presente).toBe(false);
    expect(d!.lacunas).toContain('documentacao');
    expect(d!.lacunas).toContain('versoes');
    expect(d!.submissao.reenvios).toBe(0);
  });

  it('getFormEventsByProjeto rejeitando → eventos vazios, dossiê continua', async () => {
    getFormEventsByProjeto.mockRejectedValue(new Error('boom eventos'));
    const d = await carregarDossie(ID);
    expect(d).not.toBeNull();
    expect(d!.historico.eventos).toEqual([]);
  });

  it('getProjetoById lançando → null, sem propagar', async () => {
    getProjetoById.mockRejectedValue(new Error('DB caiu'));
    lerLinhaEspelho.mockResolvedValue(null);
    await expect(carregarDossie(ID)).resolves.toBeNull();
  });
});

describe('carregarDossie — sem chat', () => {
  it('carrega e roda sem que o mock exponha getChatMessages/getChatHistory', async () => {
    // O factory do vi.mock acima NÃO define esses leitores: se a implementação os
    // importasse/chamasse, o vitest lançaria "No export is defined on the mock".
    const d = await carregarDossie(ID);
    expect(d).not.toBeNull();
    expect(dossieNaoCitaChat(JSON.stringify(d))).toBe(true);
  });
});

function dossieNaoCitaChat(json: string): boolean {
  return !json.includes('chat_messages') && !json.includes('snapshot_chat');
}
