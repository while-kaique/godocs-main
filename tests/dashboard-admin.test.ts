// Dashboard do admin (triagem sobre a planilha): mapeamento de linha do Sheets, cache
// com single-flight, contagem/ordenação das filas e o write-back de status — incluindo o
// guard de que a tela NUNCA escreve "Atualizado Em" (aquela coluna é o carimbo do
// sistema e é o que decide se um legado está regularizado).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  readAllRows: vi.fn(),
  updateRowByProjectId: vi.fn(),
}));

vi.mock('@/integrations/db/client.server', () => ({
  insertAdminStatusLog: vi.fn(),
  getAdminStatusLogs: vi.fn(async () => []),
}));

import { readAllRows, updateRowByProjectId } from '@/lib/google/sheets';
import { insertAdminStatusLog } from '@/integrations/db/client.server';
import {
  mapResumo,
  chaveStatus,
  numero,
  chaveBusca,
  contarPorStatus,
  ordenarPorDataDesc,
  listarProjetosDashboard,
  getProjetoDashboard,
  definirStatusProjeto,
  invalidarCacheDashboard,
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
    'Ganho Total': 'R$ 5.700,00',
    Ferramenta: 'Python',
    ...over,
  } as Record<string, string>;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidarCacheDashboard();
  mockInsertLog.mockResolvedValue(undefined);
});

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
  it('lê a planilha, descarta linhas sem ID e ordena por data desc', async () => {
    mockReadAllRows.mockResolvedValue([
      linha({ 'ID Projeto': 'a', 'Data Submissão': '01/05/2026' }),
      linha({ 'ID Projeto': '' }),
      linha({ 'ID Projeto': 'b', 'Data Submissão': '20/06/2026' }),
    ] as never);

    const r = await listarProjetosDashboard();
    expect(r.projetos.map((p) => p.id)).toEqual(['b', 'a']);
    expect(r.total).toBe(2);
    expect(r.contagem).toEqual({ pendente: 2 });
  });

  it('serve do cache na segunda chamada e relê só com refresh', async () => {
    mockReadAllRows.mockResolvedValue([linha()] as never);

    const primeira = await listarProjetosDashboard();
    expect(primeira.doCache).toBe(false);
    const segunda = await listarProjetosDashboard();
    expect(segunda.doCache).toBe(true);
    expect(mockReadAllRows).toHaveBeenCalledTimes(1);

    await listarProjetosDashboard(true);
    expect(mockReadAllRows).toHaveBeenCalledTimes(2);
  });

  it('single-flight: chamadas concorrentes geram UMA leitura', async () => {
    mockReadAllRows.mockResolvedValue([linha()] as never);
    await Promise.all([
      listarProjetosDashboard(),
      listarProjetosDashboard(),
      listarProjetosDashboard(),
    ]);
    expect(mockReadAllRows).toHaveBeenCalledTimes(1);
  });
});

describe('getProjetoDashboard', () => {
  it('devolve todas as células preenchidas e ignora vazias/"—"', async () => {
    mockReadAllRows.mockResolvedValue([
      linha({ Descrição: 'Automatiza o reembolso', Complexidade: '—', Observações: '' }),
    ] as never);

    const d = await getProjetoDashboard('LEGADO-148'); // match case-insensitive
    expect(d.campos['Descrição']).toBe('Automatiza o reembolso');
    expect(d.campos['Complexidade']).toBeUndefined();
    expect(d.campos['Observações']).toBeUndefined();
    expect(d.historico).toEqual([]);
  });

  it('404 quando o ID não está na planilha', async () => {
    mockReadAllRows.mockResolvedValue([linha()] as never);
    await expect(getProjetoDashboard('nao-existe')).rejects.toThrow(/não encontrado/i);
  });
});

describe('definirStatusProjeto', () => {
  beforeEach(() => {
    mockReadAllRows.mockResolvedValue([linha()] as never);
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

  it('corrige o cache: a listagem seguinte já mostra o status novo, sem reler', async () => {
    await listarProjetosDashboard();
    await definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado' }, 'a@b.com');
    const depois = await listarProjetosDashboard();
    expect(depois.projetos[0]!.statusChave).toBe('aprovado');
    expect(mockReadAllRows).toHaveBeenCalledTimes(1);
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
