// Dashboard do admin (triagem sobre a planilha): mapeamento de linha do Sheets, leitura do
// ESPELHO, contagem/ordenação das filas e o write-back de status — incluindo o guard de que
// a tela NUNCA escreve "Atualizado Em" (aquela coluna é o carimbo do sistema e é o que
// decide se um legado está regularizado).
//
// ⚠️ Desde 11/08/2026 a listagem NÃO lê a planilha em request: lê o espelho no SQLite. Aqui
// o espelho é um fake em memória e a planilha (mockada) chega nele por um sync explícito —
// `semearEspelho()`. O caminho com banco de verdade está em `tests/dashboard-espelho.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  readAllRows: vi.fn(),
  updateRowByProjectId: vi.fn(),
}));

// `vi.hoisted` porque o factory do `vi.mock` é içado para o topo do arquivo e não pode
// alcançar variáveis normais — o fake tem de nascer ANTES dos mocks.
const espelhoFakeP = vi.hoisted(
  async () => (await import('./helpers/espelho-fake')).criarEspelhoFake(),
);

vi.mock('@/integrations/db/client.server', async () => ({
  insertAdminStatusLog: vi.fn(),
  getAdminStatusLogs: vi.fn(async () => []),
  getAdminStatusLogsPorIds: vi.fn(async () => new Map()),
  // Contrafactual mora só no SQLite; por padrão null (a maioria dos casos não o exercita).
  getContrafactualAfetados: vi.fn(async () => null),
  getContrafactualAfetadosPorIds: vi.fn(async () => new Map()),
  // "O que cada participante fez" também só existe no SQLite; por padrão vazio.
  getContribuicoesDeParticipantesPorIds: vi.fn(async () => new Map()),
  // Reenvios (edições) do dono/editor — por padrão vazio (a maioria dos casos não exercita).
  getReenviosDoProjeto: vi.fn(async () => []),
  getReenviosPorIds: vi.fn(async () => new Map()),
  // Avaliação em SOMBRA (teste sombra) — tabelas INTERNAS; por padrão sem recomendação/voto.
  getAvaliacoesNormaisPorIds: vi.fn(async () => new Map()),
  getAvaliacaoNormal: vi.fn(async () => null),
  getDeliberacao: vi.fn(async () => null),
  getDeliberacoesPorIds: vi.fn(async () => new Map()),
  getAvaliacaoRetroativa: vi.fn(async () => null),
  getAvaliacoesRetroativasPorIds: vi.fn(async () => new Map()),
  getFeedbacksPorIds: vi.fn(async () => new Map()),
  getAvaliacaoFeedback: vi.fn(async () => null),
  upsertAvaliacaoFeedback: vi.fn(async () => undefined),
  deleteAvaliacaoFeedback: vi.fn(async () => undefined),
  ...(await espelhoFakeP).api,
  // O `?refresh=1` dispara o sync reverso de verdade; aqui só o espelho interessa, então o
  // lado de `projetos` é stub (quem cobre aquele lado é `tests/sync-reverse.test.ts`).
  getAllProjetoIds: vi.fn(async () => []),
  getProjetosParaSyncReverso: vi.fn(async () => []),
  getProjetosNaoRascunho: vi.fn(async () => []),
  getProjetosByOwnerEmail: vi.fn(async () => []),
  getProjetoById: vi.fn(async () => undefined),
  insertProjetoRaw: vi.fn(async () => undefined),
  updateProjeto: vi.fn(async () => undefined),
  excluirProjetoCascade: vi.fn(async () => undefined),
  parseJson: (v: string | null) => {
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  },
}));

import { readAllRows, updateRowByProjectId } from '@/lib/google/sheets';
import {
  insertAdminStatusLog,
  getAdminStatusLogs,
  getContrafactualAfetados,
  getContrafactualAfetadosPorIds,
  getContribuicoesDeParticipantesPorIds,
  getReenviosDoProjeto,
  getReenviosPorIds,
} from '@/integrations/db/client.server';
import {
  mapResumo,
  chaveStatus,
  numero,
  chaveBusca,
  contarPorStatus,
  ordenarPorDataDesc,
  listarProjetosDashboard,
  getProjetoDashboard,
  getProjetosDashboardLote,
  definirStatusProjeto,
  montarHistoricoTriagem,
  STATUS_GRAVAVEIS,
  type ProjetoDashboardResumo,
} from '@/lib/dashboard-admin.functions';
import {
  filtrarPorTermo,
  paginasVisiveis,
  compararProjetos,
} from '@/components/dashboard/tabela-utils';
import { pilulaDe, corDaRegua } from '@/components/dashboard/status-triagem';

const mockReadAllRows = vi.mocked(readAllRows);
const mockUpdateRow = vi.mocked(updateRowByProjectId);
const mockInsertLog = vi.mocked(insertAdminStatusLog);

function linha(over: Record<string, string> = {}) {
  return {
    'ID Projeto': 'legado-148',
    Projeto: 'Portal de Reembolsos',
    'Nome Completo': 'Helén Sá',
    Email: 'helen@gocase.com',
    Área: 'CSC',
    Status: 'Pendente',
    'Data Submissão': '12/05/2026',
    'Impacto Líquido': 'R$ 5.700,00',
    Ferramenta: 'Python',
    ...over,
  } as Record<string, string>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  (await espelhoFakeP).limpar();
  mockInsertLog.mockResolvedValue(undefined);
});

/**
 * Coloca linhas "na planilha" e sincroniza para o espelho — é o `?refresh=1` da tela.
 * Depois disto, ler NÃO toca mais o Sheets (é o que esta fatia veio garantir).
 */
async function semearEspelho(rows: Record<string, string>[]) {
  mockReadAllRows.mockResolvedValue(rows as never);
  const r = await listarProjetosDashboard(true);
  mockReadAllRows.mockClear();
  return r;
}

describe('parsers de célula', () => {
  it('numero aceita os formatos que a planilha realmente produz', () => {
    expect(numero('R$ 1.234,56')).toBeCloseTo(1234.56);
    expect(numero('418,2')).toBeCloseTo(418.2);
    expect(numero('10.5')).toBeCloseTo(10.5);
    expect(numero('0')).toBe(0);
    expect(numero('—')).toBeNull();
    expect(numero('')).toBeNull();
    expect(numero(undefined)).toBeNull();
  });

  it('chaveStatus normaliza e trata célula vazia como ausência de status', () => {
    expect(chaveStatus('Reenvio Pendente')).toBe('reenvio pendente');
    expect(chaveStatus('  Aprovado ')).toBe('aprovado');
    expect(chaveStatus('')).toBeNull();
    expect(chaveStatus('—')).toBeNull();
    expect(chaveStatus(null)).toBeNull();
  });

  it('chaveBusca remove acento e caixa (buscar "helen sa" acha "Helén Sá")', () => {
    const idx = chaveBusca('Portal de Reembôlsos', 'Helén Sá');
    expect(idx).toContain('reembolsos');
    expect(idx).toContain('helen sa');
  });
});

describe('mapResumo', () => {
  it('mapeia a linha para o resumo da tabela', () => {
    const r = mapResumo(linha())!;
    expect(r.id).toBe('legado-148');
    expect(r.nome).toBe('Portal de Reembolsos');
    expect(r.autor).toBe('Helén Sá');
    expect(r.status).toBe('Pendente');
    expect(r.statusChave).toBe('pendente');
    expect(r.ganhoTotal).toBeCloseTo(5700);
    // "12/05/2026" é 12 de MAIO (pt-BR), não 5 de dezembro — o bug do Date.parse.
    expect(new Date(r.dataOrdenacao!).getUTCMonth()).toBe(4);
    expect(r.busca).toContain('portal de reembolsos');
  });

  it('descarta linha sem ID (separador/rodapé/lixo da planilha)', () => {
    expect(mapResumo(linha({ 'ID Projeto': '' }))).toBeNull();
    expect(mapResumo({} as never)).toBeNull();
  });

  it('status vazio vira null (nunca inventa status)', () => {
    const r = mapResumo(linha({ Status: '' }))!;
    expect(r.status).toBeNull();
    expect(r.statusChave).toBeNull();
  });

  it('reconhece "Especial?" nas variações que a planilha usa', () => {
    expect(mapResumo(linha({ 'Especial?': 'Sim' }))!.especial).toBe(true);
    expect(mapResumo(linha({ 'Especial?': 'Não' }))!.especial).toBe(false);
    expect(mapResumo(linha())!.especial).toBe(false);
  });
});

describe('filas de triagem', () => {
  const base = mapResumo(linha())!;

  it('conta por status e agrupa os sem status', () => {
    const c = contarPorStatus([
      { ...base, statusChave: 'aprovado' },
      { ...base, statusChave: 'aprovado' },
      { ...base, statusChave: 'reprovado' },
      { ...base, statusChave: null },
    ]);
    expect(c).toEqual({ aprovado: 2, reprovado: 1, sem_status: 1 });
  });

  it('rótulos legados caem na pílula equivalente', () => {
    expect(pilulaDe('rejeitado')).toBe('reenvio pendente');
    expect(pilulaDe('validado')).toBe('aprovado');
    expect(pilulaDe(null)).toBe('sem_status');
    expect(pilulaDe('aprovado')).toBe('aprovado');
  });

  it('status desconhecido ainda recebe cor de régua (não fica invisível)', () => {
    expect(corDaRegua('status inventado')).toBeTruthy();
  });

  it('ordena por data desc e joga quem não tem data para o fim', () => {
    const antigo = { ...base, dataOrdenacao: 1000 };
    const novo = { ...base, dataOrdenacao: 9000 };
    const semData = { ...base, dataOrdenacao: null };
    const ordenado = [antigo, semData, novo].sort(ordenarPorDataDesc);
    expect(ordenado.map((p) => p.dataOrdenacao)).toEqual([9000, 1000, null]);
  });
});

describe('busca e paginação (lógica da tabela)', () => {
  const projetos = [
    { busca: 'portal de reembolsos helen sa csc', nome: 'Portal' },
    { busca: 'base de custos hugo m gobeaute', nome: 'Base' },
  ] as ProjetoDashboardResumo[];

  it('exige TODOS os termos (AND), em qualquer ordem', () => {
    expect(filtrarPorTermo(projetos, 'helen portal')).toHaveLength(1);
    expect(filtrarPorTermo(projetos, 'portal hugo')).toHaveLength(0);
  });

  it('ignora acento e caixa no termo digitado', () => {
    expect(filtrarPorTermo(projetos, 'HELÉN')).toHaveLength(1);
    expect(filtrarPorTermo(projetos, 'gobeauté')).toHaveLength(1);
  });

  it('termo vazio devolve a lista inteira', () => {
    expect(filtrarPorTermo(projetos, '   ')).toHaveLength(2);
  });

  it('projeto sem ganho fica abaixo de um ganho de R$ 0', () => {
    const semGanho = { ganhoTotal: null } as ProjetoDashboardResumo;
    const zero = { ganhoTotal: 0 } as ProjetoDashboardResumo;
    expect(compararProjetos(semGanho, zero, 'ganho')).toBeLessThan(0);
  });

  it('janela de páginas: sem elipse até 7, com elipse depois', () => {
    expect(paginasVisiveis(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginasVisiveis(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(paginasVisiveis(1, 12)).toEqual([1, 2, null, 12]);
  });
});

describe('listarProjetosDashboard', () => {
  it('descarta linhas sem ID e ordena por data desc', async () => {
    const r = await semearEspelho([
      linha({ 'ID Projeto': 'a', 'Data Submissão': '01/05/2026' }),
      linha({ 'ID Projeto': '' }),
      linha({ 'ID Projeto': 'b', 'Data Submissão': '20/06/2026' }),
    ]);
    expect(r.projetos.map((p) => p.id)).toEqual(['b', 'a']);
    expect(r.total).toBe(2);
    expect(r.contagem).toEqual({ pendente: 2 });
  });

  it('NUNCA lê a planilha na listagem — o dado vem do espelho', async () => {
    await semearEspelho([linha()]);
    const r = await listarProjetosDashboard();
    expect(mockReadAllRows).not.toHaveBeenCalled();
    expect(r.projetos).toHaveLength(1);
  });

  it('chamadas concorrentes não geram leitura nenhuma da planilha', async () => {
    await semearEspelho([linha()]);
    await Promise.all([
      listarProjetosDashboard(),
      listarProjetosDashboard(),
      listarProjetosDashboard(),
    ]);
    expect(mockReadAllRows).not.toHaveBeenCalled();
  });

  it('`refresh` sincroniza de verdade (é o botão "Atualizar")', async () => {
    await semearEspelho([linha()]);
    mockReadAllRows.mockResolvedValue([linha({ Status: 'Aprovado' })] as never);
    const r = await listarProjetosDashboard(true);
    expect(mockReadAllRows).toHaveBeenCalledTimes(1);
    expect(r.projetos[0]!.statusChave).toBe('aprovado');
  });

  it('planilha fora do ar no `refresh` NÃO derruba a tela — serve o espelho e avisa', async () => {
    await semearEspelho([linha()]);
    mockReadAllRows.mockRejectedValue(new Error('429 cota'));
    const r = await listarProjetosDashboard(true);
    expect(r.projetos).toHaveLength(1); // o espelho anterior continua servindo
    expect(r.syncFalhou).toBe(true);
  });
});

describe('getProjetoDashboard', () => {
  it('devolve todas as células preenchidas e ignora vazias/"—"', async () => {
    await semearEspelho([
      linha({ Descrição: 'Automatiza o reembolso', Complexidade: '—', Observações: '' }),
    ]);

    const d = await getProjetoDashboard('LEGADO-148'); // match case-insensitive
    expect(d.campos['Descrição']).toBe('Automatiza o reembolso');
    expect(d.campos['Complexidade']).toBeUndefined();
    expect(d.campos['Observações']).toBeUndefined();
    expect(d.historico).toEqual([]);
  });

  it('404 quando o ID não está na planilha', async () => {
    await semearEspelho([linha()]);
    await expect(getProjetoDashboard('nao-existe')).rejects.toThrow(/não encontrado/i);
  });

  it('decodifica o contrafactual do SQLite (quem sentiria falta) no payload', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getContrafactualAfetados).mockResolvedValueOnce({
      contrafactual_afetados: 'time:Fiscal;CX',
    } as never);
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.contrafactual).toEqual({ tipo: 'time', lista: ['Fiscal', 'CX'] });
  });

  it('contrafactual é null quando o autor não respondeu', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getContrafactualAfetados).mockResolvedValueOnce(null as never);
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.contrafactual).toBeNull();
  });

  it('contrafactual é null (e não derruba a ficha) se a leitura do SQLite falhar', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getContrafactualAfetados).mockRejectedValueOnce(new Error('db down'));
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.contrafactual).toBeNull();
    expect(d.campos['Projeto']).toBeDefined();
  });

  // ── "O que cada participante fez" (`membros_contribuicoes`) ────────────────
  // Mesma natureza do contrafactual: só existe no SQLite, nunca virou coluna do Sheets.
  // A ficha é a FONTE ÚNICA das 3 abas (/dashboard, /especiais, /aprovacoes-pendentes) —
  // por isso o payload precisa carregá-lo, e não a tela.

  it('a ficha traz o que cada participante fez, com o papel legível', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getContribuicoesDeParticipantesPorIds).mockResolvedValueOnce(
      new Map([
        [
          'legado-148',
          {
            id: 'LEGADO-148',
            membros: JSON.stringify(['ana@x.com']),
            membros_papeis: JSON.stringify({ 'ana@x.com': 'coexecutor' }),
            membros_contribuicoes: JSON.stringify({ 'ana@x.com': 'Montou os fluxos no n8n' }),
          },
        ],
      ]) as never,
    );
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.pessoas).toEqual([
      { email: 'ana@x.com', papel: 'Coautor', texto: 'Montou os fluxos no n8n' },
    ]);
  });

  it('pessoas vem vazio (e a ficha abre) quando o projeto é anterior à feature', async () => {
    await semearEspelho([linha()]);
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.pessoas).toEqual([]);
    expect(d.campos['Projeto']).toBeDefined();
  });

  it('falha na leitura das contribuições não derruba a ficha', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getContribuicoesDeParticipantesPorIds).mockRejectedValueOnce(new Error('db down'));
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.pessoas).toEqual([]);
    expect(d.campos['Projeto']).toBeDefined();
  });

  it('o lote também traz o que cada participante fez', async () => {
    await semearEspelho([linha({ 'ID Projeto': 'legado-148' })]);
    vi.mocked(getContribuicoesDeParticipantesPorIds).mockResolvedValueOnce(
      new Map([
        [
          'legado-148',
          {
            id: 'legado-148',
            membros: JSON.stringify(['bia@y.com']),
            membros_papeis: JSON.stringify({ 'bia@y.com': 'planejador' }),
            membros_contribuicoes: JSON.stringify({ 'bia@y.com': 'Revisou as regras fiscais' }),
          },
        ],
      ]) as never,
    );
    const lote = await getProjetosDashboardLote({ ids: ['legado-148'] });
    expect(lote['legado-148'].pessoas).toEqual([
      { email: 'bia@y.com', papel: 'Participante', texto: 'Revisou as regras fiscais' },
    ]);
  });

  it('o lote também traz o contrafactual (via consulta em lote)', async () => {
    await semearEspelho([linha({ 'ID Projeto': 'legado-148' })]);
    vi.mocked(getContrafactualAfetadosPorIds).mockResolvedValueOnce(
      new Map([['legado-148', 'pessoa:ana@x.com;bia@y.com']]) as never,
    );
    const lote = await getProjetosDashboardLote({ ids: ['legado-148'] });
    expect(lote['legado-148'].contrafactual).toEqual({
      tipo: 'pessoa',
      lista: ['ana@x.com', 'bia@y.com'],
    });
  });

  it('lote: contrafactual null quando não há resposta, sem derrubar o lote', async () => {
    await semearEspelho([linha({ 'ID Projeto': 'legado-148' })]);
    vi.mocked(getContrafactualAfetadosPorIds).mockResolvedValueOnce(new Map() as never);
    const lote = await getProjetosDashboardLote({ ids: ['legado-148'] });
    expect(lote['legado-148'].contrafactual).toBeNull();
  });

  it('o reenvio (projeto_versions) vira linha do histórico na ficha individual', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getReenviosDoProjeto).mockResolvedValueOnce([
      { versao_num: 2, submetido_por: 'dono@x.com', created_at: '2026-08-21 20:04:13' },
    ] as never);
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.historico).toEqual([
      { tipo: 'reenvio', edicao: 1, submetido_por: 'dono@x.com', created_at: '2026-08-21 20:04:13' },
    ]);
  });

  it('o lote também traz o reenvio (via consulta em lote)', async () => {
    await semearEspelho([linha({ 'ID Projeto': 'legado-148' })]);
    vi.mocked(getReenviosPorIds).mockResolvedValueOnce(
      new Map([
        ['legado-148', [{ versao_num: 3, submetido_por: 'dono@x.com', created_at: '2026-08-22 10:00:00' }]],
      ]) as never,
    );
    const lote = await getProjetosDashboardLote({ ids: ['legado-148'] });
    expect(lote['legado-148'].historico).toEqual([
      { tipo: 'reenvio', edicao: 2, submetido_por: 'dono@x.com', created_at: '2026-08-22 10:00:00' },
    ]);
  });

  it('reenvio que falhar não derruba a ficha (só omite as linhas de reenvio)', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getReenviosDoProjeto).mockRejectedValueOnce(new Error('db down'));
    const d = await getProjetoDashboard('LEGADO-148');
    expect(d.historico).toEqual([]);
    expect(d.campos['Projeto']).toBeDefined();
  });

  it('status e reenvio convivem na linha do tempo, mais recente primeiro', async () => {
    await semearEspelho([linha()]);
    vi.mocked(getAdminStatusLogs).mockResolvedValueOnce([
      {
        status_anterior: 'Pendente',
        status_novo: 'Reenvio Pendente',
        observacoes: 'ajustar ganhos',
        admin_email: 'triagem@x.com',
        created_at: '2026-08-18 17:22:11',
      },
    ] as never);
    vi.mocked(getReenviosDoProjeto).mockResolvedValueOnce([
      { versao_num: 2, submetido_por: 'dono@x.com', created_at: '2026-08-21 20:04:13' },
    ] as never);
    const d = await getProjetoDashboard('LEGADO-148');
    // Reenvio (21/08) primeiro, depois o pedido de reenvio (18/08).
    expect(d.historico.map((h) => h.tipo)).toEqual(['reenvio', 'status']);
    expect(d.historico[0]).toMatchObject({ tipo: 'reenvio', edicao: 1 });
    expect(d.historico[1]).toMatchObject({ tipo: 'status', status_novo: 'Reenvio Pendente' });
  });
});

describe('montarHistoricoTriagem (puro)', () => {
  it('ordena por created_at DESC, com carimbo ausente por último', () => {
    const out = montarHistoricoTriagem(
      [
        {
          status_anterior: null,
          status_novo: 'Pendente',
          observacoes: null,
          admin_email: 'a@x.com',
          created_at: '2026-08-10 09:00:00',
        },
      ],
      [
        { versao_num: 2, submetido_por: 'd@x.com', created_at: '2026-08-21 20:04:13' },
        { versao_num: 3, submetido_por: 'd@x.com', created_at: null },
      ],
    );
    expect(out.map((h) => h.created_at)).toEqual([
      '2026-08-21 20:04:13',
      '2026-08-10 09:00:00',
      null,
    ]);
  });

  it('edição = versao_num - 1 (o submit inicial é a versão 1)', () => {
    const out = montarHistoricoTriagem(
      [],
      [{ versao_num: 4, submetido_por: null, created_at: '2026-08-01 00:00:00' }],
    );
    expect(out).toEqual([
      { tipo: 'reenvio', edicao: 3, submetido_por: null, created_at: '2026-08-01 00:00:00' },
    ]);
  });
});

describe('definirStatusProjeto', () => {
  beforeEach(async () => {
    await semearEspelho([linha()]);
  });

  it('grava o Status na planilha e audita quem mudou', async () => {
    const r = await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Aprovado' },
      'luis.albuquerque@gocase.com',
    );

    expect(mockUpdateRow).toHaveBeenCalledWith('legado-148', { Status: 'Aprovado' });
    expect(r.statusAnterior).toBe('Pendente');
    expect(mockInsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        projeto_id: 'legado-148',
        status_anterior: 'Pendente',
        status_novo: 'Aprovado',
        admin_email: 'luis.albuquerque@gocase.com',
      }),
    );
  });

  it('NUNCA escreve "Atualizado Em" — é o carimbo do sistema que regulariza legado', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Reprovado', observacoes: 'faltou a composição das horas' },
      'admin@gocase.com',
    );
    const escritas = Object.keys(mockUpdateRow.mock.calls[0]![1]);
    expect(escritas).toEqual(['Status', 'Observações']);
    expect(escritas).not.toContain('Atualizado Em');
    expect(escritas).not.toContain('Diff Horas / Antes');
    expect(escritas).not.toContain('Diff Saving / Antes');
  });

  it('só toca "Observações" quando o motivo é informado', async () => {
    await definirStatusProjeto({ projeto_id: 'legado-148', status: 'Pendente' }, 'a@b.com');
    expect(Object.keys(mockUpdateRow.mock.calls[0]![1])).toEqual(['Status']);
  });

  // ── Nota da triagem (coluna manual "Estrelas") ─────────────────────────────
  it('grava a nota como NÚMERO na coluna "Estrelas"', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Aprovado', estrelas: 4 },
      'admin@gocase.com',
    );
    const escritas = mockUpdateRow.mock.calls[0]![1] as Record<string, string>;
    expect(escritas['Estrelas']).toBe('4');
  });

  it('nota 0 é uma nota — grava "0", nunca "—" (a coluna é numérica)', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Aprovado', estrelas: 0 },
      'admin@gocase.com',
    );
    expect((mockUpdateRow.mock.calls[0]![1] as Record<string, string>)['Estrelas']).toBe('0');
  });

  it('quem só muda o status NÃO encosta na nota (preserva a de outra pessoa)', async () => {
    await definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado' }, 'a@b.com');
    expect(Object.keys(mockUpdateRow.mock.calls[0]![1])).not.toContain('Estrelas');
  });

  // A escala NÃO tem teto de 5 (pedido do Luis, 17/08/2026: "podemos dar N estrelas") — o
  // teto antigo tratava as notas 7/8/10 que já existem na planilha como legado a substituir.
  it('aceita nota acima de 5 (a escala é aberta)', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Aprovado', estrelas: 8 },
      'admin@gocase.com',
    );
    expect((mockUpdateRow.mock.calls[0]![1] as Record<string, string>)['Estrelas']).toBe('8');
  });

  it('recusa nota negativa, fracionada ou absurda (sanidade da célula)', async () => {
    await expect(
      definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado', estrelas: -1 }, 'a@b.com'),
    ).rejects.toThrow();
    await expect(
      definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado', estrelas: 2.5 }, 'a@b.com'),
    ).rejects.toThrow();
    await expect(
      definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado', estrelas: 101 }, 'a@b.com'),
    ).rejects.toThrow();
  });

  // ── Motivos da triagem em COLUNA PRÓPRIA (critério de projeto) ──────────────
  it('grava "Motivo Reenvio" em coluna própria, SEM tocar "Observações"', async () => {
    await definirStatusProjeto(
      {
        projeto_id: 'legado-148',
        status: 'Reenvio Pendente',
        motivo_reenvio: 'projeto parado, em manutenção; reenviar com os fixes',
      },
      'admin@gocase.com',
    );
    const escritas = mockUpdateRow.mock.calls[0]![1] as Record<string, string>;
    expect(escritas['Motivo Reenvio']).toBe('projeto parado, em manutenção; reenviar com os fixes');
    expect(Object.keys(escritas)).not.toContain('Observações');
    expect(Object.keys(escritas)).not.toContain('Atualizado Em');
  });

  it('grava "Motivo Reprovado" em coluna própria (sobrepõe o do analisador)', async () => {
    await definirStatusProjeto(
      {
        projeto_id: 'legado-148',
        status: 'Reprovado',
        motivo_reprovado: 'entrega única, sem indicador verificável',
      },
      'admin@gocase.com',
    );
    const escritas = mockUpdateRow.mock.calls[0]![1] as Record<string, string>;
    expect(escritas['Motivo Reprovado']).toBe('entrega única, sem indicador verificável');
    expect(Object.keys(escritas)).not.toContain('Observações');
  });

  // ── Padrão da planilha: coluna de TEXTO nunca fica em branco (vazio → "—") ──
  it('motivo APAGADO grava "—" (não deixa a célula em branco)', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Pendente', motivo_reenvio: '   ', motivo_reprovado: '' },
      'admin@gocase.com',
    );
    const escritas = mockUpdateRow.mock.calls[0]![1] as Record<string, string>;
    expect(escritas['Motivo Reenvio']).toBe('—');
    expect(escritas['Motivo Reprovado']).toBe('—');
  });

  it('parecer APAGADO grava "—" em "Observações"', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Pendente', observacoes: '' },
      'admin@gocase.com',
    );
    expect((mockUpdateRow.mock.calls[0]![1] as Record<string, string>)['Observações']).toBe('—');
  });

  it('a auditoria não registra o "—" como se fosse motivo', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Pendente', motivo_reenvio: '  ' },
      'admin@gocase.com',
    );
    expect(mockInsertLog).toHaveBeenCalledWith(expect.objectContaining({ observacoes: null }));
  });

  it('a auditoria registra o motivo quando não há parecer em "Observações"', async () => {
    await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Reprovado', motivo_reprovado: 'sem recorrência' },
      'admin@gocase.com',
    );
    expect(mockInsertLog).toHaveBeenCalledWith(
      expect.objectContaining({ observacoes: 'sem recorrência' }),
    );
  });

  it('recusa status fora da lista gravável', async () => {
    await expect(
      definirStatusProjeto({ projeto_id: 'legado-148', status: 'Inventado' }, 'a@b.com'),
    ).rejects.toThrow();
    expect(mockUpdateRow).not.toHaveBeenCalled();
  });

  it('404 sem escrever nada quando o projeto não está na planilha', async () => {
    await expect(
      definirStatusProjeto({ projeto_id: 'fantasma', status: 'Aprovado' }, 'a@b.com'),
    ).rejects.toThrow(/não encontrado/i);
    expect(mockUpdateRow).not.toHaveBeenCalled();
  });

  it('remenda o espelho: a listagem seguinte mostra o status novo, sem ler a planilha', async () => {
    await definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado' }, 'a@b.com');
    const depois = await listarProjetosDashboard();
    expect(depois.projetos[0]!.statusChave).toBe('aprovado');
    expect(mockReadAllRows).not.toHaveBeenCalled();
  });

  it('falha da auditoria não desfaz a escrita já feita na planilha', async () => {
    mockInsertLog.mockRejectedValue(new Error('banco fora'));
    const r = await definirStatusProjeto(
      { projeto_id: 'legado-148', status: 'Aprovado' },
      'a@b.com',
    );
    expect(r.ok).toBe(true);
    expect(mockUpdateRow).toHaveBeenCalled();
  });

  it('a lista de status graváveis cobre as filas que a triagem usa', () => {
    expect(STATUS_GRAVAVEIS).toContain('Aprovado');
    expect(STATUS_GRAVAVEIS).toContain('Reprovado');
    expect(STATUS_GRAVAVEIS).toContain('Reenvio Pendente');
    expect(STATUS_GRAVAVEIS).toContain('Em validação');
  });
});
