// Triagem do /dashboard sobre o ESPELHO da planilha — com banco de VERDADE (better-sqlite3
// em memória) e só a rede (Google Sheets) mockada.
//
// Substitui `dashboard-swr.test.ts` e `dashboard-swr-escrita.test.ts`: aqueles protegiam o
// cache de 60 s com stale-while-revalidate, que existia para esconder uma leitura de ~2 s da
// planilha dentro do request. A leitura saiu do request, então o cache saiu com ela — mas as
// duas GARANTIAS que aqueles testes defendiam continuam valendo e estão aqui:
//   1. a tela não bloqueia esperando o Google (agora nem chama);
//   2. o status recém-gravado NÃO volta atrás quando um sync que começou antes termina.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  readAllRows: vi.fn(),
  updateRowByProjectId: vi.fn(async () => true),
}));

import { readAllRows, updateRowByProjectId } from '@/lib/google/sheets';
import { criarDbMemoria } from './helpers/db-memoria';
import {
  listarProjetosDashboard,
  getProjetoDashboard,
  definirStatusProjeto,
  ESPELHO_VELHO_MS,
} from '@/lib/dashboard-admin.functions';
import { syncSheetsToSqlite } from '@/lib/google/sync-reverse';
import { espelharEscrita, espelharLinhas } from '@/lib/sheet-espelho';
import { getEspelhoIndice, insertSyncRun } from '@/integrations/db/client.server';

const mockRead = vi.mocked(readAllRows);
const mockUpdate = vi.mocked(updateRowByProjectId);

function linha(over: Record<string, string> = {}) {
  return {
    'ID Projeto': 'legado-148',
    Projeto: 'Portal de Reembolsos',
    'Nome Completo': 'Helén Sá',
    Email: 'helen@gocase.com',
    Área: 'CSC',
    Ferramenta: 'Python',
    Status: 'Pendente',
    'Data Submissão': '12/05/2026',
    'Impacto Líquido': 'R$ 5.700,00',
    // Colunas MANUAIS da equipe + memorial: só a ficha as mostra, nunca a listagem.
    'Diff Horas / Antes': '+12',
    'Memorial de Saving': 'memorial completo '.repeat(40),
    ...over,
  } as Record<string, string>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(true);
  await criarDbMemoria();
});

/** Sincroniza a "planilha" (mock) para o espelho e zera o contador de leituras. */
async function sincronizar(rows: Record<string, string>[]) {
  mockRead.mockResolvedValue(rows as never);
  const r = await syncSheetsToSqlite('cron');
  mockRead.mockClear();
  return r;
}

describe('a listagem não toca o Google Sheets', () => {
  it('lista do espelho, sem uma única leitura da planilha', async () => {
    await sincronizar([linha(), linha({ 'ID Projeto': 'legado-149', Projeto: 'AVD Central' })]);

    const r = await listarProjetosDashboard();
    expect(mockRead).not.toHaveBeenCalled();
    expect(r.total).toBe(2);
    expect(r.projetos.map((p) => p.id).sort()).toEqual(['legado-148', 'legado-149']);
    expect(r.contagem).toEqual({ pendente: 2 });
  });

  it('a ficha traz a linha INTEIRA, inclusive as colunas manuais e o memorial', async () => {
    await sincronizar([linha()]);
    const d = await getProjetoDashboard('LEGADO-148'); // case-insensitive
    expect(mockRead).not.toHaveBeenCalled();
    expect(d.campos['Diff Horas / Antes']).toBe('+12');
    expect(d.campos['Memorial de Saving']).toContain('memorial completo');
  });

  it('a LISTAGEM não carrega memorial nenhum (payload enxuto)', async () => {
    await sincronizar([linha()]);
    const r = await listarProjetosDashboard();
    expect(JSON.stringify(r)).not.toContain('memorial completo');
  });
});

describe('escrita de status × sync concorrente', () => {
  it('grava na planilha e a listagem seguinte já mostra o novo status', async () => {
    await sincronizar([linha()]);
    await definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado' }, 'admin@gocase.com');

    expect(mockUpdate).toHaveBeenCalledWith('legado-148', { Status: 'Aprovado' });
    const r = await listarProjetosDashboard();
    expect(r.projetos[0]!.statusChave).toBe('aprovado');
  });

  it('o status novo NÃO volta atrás quando um sync que começou ANTES da escrita termina depois', async () => {
    await sincronizar([linha()]);

    // O sync começa aqui e tem em mãos um snapshot com "Pendente"…
    const snapshotAntigo = [linha({ Status: 'Pendente' })];
    const inicioLeitura = Date.now();

    // …a triagem grava "Aprovado" no meio do caminho…
    await definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado' }, 'admin@gocase.com');

    // …e só então o sync instala o que leu.
    await espelharLinhas(snapshotAntigo as never, inicioLeitura);

    const r = await listarProjetosDashboard();
    expect(r.projetos[0]!.statusChave).toBe('aprovado');
  });

  it('uma correção feita À MÃO na planilha depois da nossa escrita vence (a planilha manda)', async () => {
    await sincronizar([linha()]);
    await definirStatusProjeto({ projeto_id: 'legado-148', status: 'Aprovado' }, 'admin@gocase.com');

    // ⚠️ O desempate por MILISSEGUNDO é deliberado: `escrito_em >= inicio_da_leitura` conta
    // como "a leitura pode não ter visto a minha escrita", então o empate PROTEGE o que
    // acabamos de gravar. É a direção segura — a falha oposta é o status voltar atrás na
    // cara da triagem. Em produção a janela é o ciclo de 5 min; aqui os dois acontecem no
    // mesmo ms, então esperamos 2 ms para simular o sync SEGUINTE.
    await new Promise((r) => setTimeout(r, 2));

    // Sync posterior à escrita: a triagem mexeu na aba e é isso que vale.
    await sincronizar([linha({ Status: 'Reenvio Pendente' })]);
    const r = await listarProjetosDashboard();
    expect(r.projetos[0]!.statusChave).toBe('reenvio pendente');
  });

  it('404 quando o projeto não está no espelho — e nada é escrito na planilha', async () => {
    await sincronizar([linha()]);
    await expect(
      definirStatusProjeto({ projeto_id: 'fantasma', status: 'Aprovado' }, 'admin@gocase.com'),
    ).rejects.toThrow(/não encontrado/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('projeto apagado da planilha sai das telas', () => {
  it('sai do espelho no sync seguinte (era o "projeto morto" na lista de quem reclamou)', async () => {
    await sincronizar([linha(), linha({ 'ID Projeto': 'legado-149' })]);
    expect((await listarProjetosDashboard()).total).toBe(2);

    await sincronizar([linha()]); // a linha do legado-149 foi apagada da aba
    const r = await listarProjetosDashboard();
    expect(r.projetos.map((p) => p.id)).toEqual(['legado-148']);
  });

  it('leitura da planilha FALHANDO não apaga nada nem esvazia a tela', async () => {
    await sincronizar([linha(), linha({ 'ID Projeto': 'legado-149' })]);
    mockRead.mockRejectedValue(new Error('503 Service Unavailable'));

    const r = await syncSheetsToSqlite('cron');
    expect(r.ok).toBe(false);
    expect((await getEspelhoIndice()).length).toBe(2);
    expect((await listarProjetosDashboard()).total).toBe(2);
  });
});

describe('idade do espelho (o sync morrer em silêncio tem de aparecer)', () => {
  it('sync recente → sem aviso', async () => {
    await sincronizar([linha()]);
    const r = await listarProjetosDashboard();
    expect(r.espelhoVelho).toBe(false);
    expect(r.syncFalhou).toBe(false);
  });

  it('última corrida com falha → a tela avisa', async () => {
    await sincronizar([linha()]);
    mockRead.mockRejectedValue(new Error('429'));
    await syncSheetsToSqlite('cron');
    expect((await listarProjetosDashboard()).syncFalhou).toBe(true);
  });

  it('sem sincronizar há mais que o limite → espelhoVelho', async () => {
    await espelharLinhas([linha() as never], Date.now());
    const velho = new Date(Date.now() - ESPELHO_VELHO_MS - 60_000).toISOString();
    await insertSyncRun({
      gatilho: 'cron',
      ok: 1,
      total: 1,
      espelhados: 1,
      criados: 0,
      atualizados: 0,
      removidos: 0,
      erros: 0,
      duracao_ms: 10,
      detalhe: null,
    });
    // Reescreve o carimbo da corrida para o passado (o INSERT usa datetime('now')).
    const { getDb } = await import('@/integrations/db/client.server');
    await getDb().exec('UPDATE sync_runs SET iniciado_em = ?', [velho]);

    const r = await listarProjetosDashboard();
    expect(r.espelhoVelho).toBe(true);
  });

  it('banco novo, nada sincronizado → `semEspelho` (a tela pede "Atualizar")', async () => {
    const r = await listarProjetosDashboard();
    expect(r.semEspelho).toBe(true);
    expect(r.total).toBe(0);
  });
});

describe('remendo de escrita fora da triagem', () => {
  it('espelharEscrita cria a linha da submissão NOVA (não espera o cron)', async () => {
    await espelharEscrita(
      'a1b2c3',
      { 'ID Projeto': 'a1b2c3', Projeto: 'Bot de Faturamento V2', Status: 'Pendente' },
      { novaLinha: true },
    );
    const r = await listarProjetosDashboard();
    expect(r.projetos.map((p) => p.id)).toEqual(['a1b2c3']);
    expect(r.projetos[0]!.statusChave).toBe('pendente');
  });
});
