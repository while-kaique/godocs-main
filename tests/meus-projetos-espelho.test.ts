// "Meus Projetos" lendo o ESPELHO da planilha — banco de VERDADE, só a rede mockada.
//
// Regressão do custo que motivou a fatia: esta listagem fazia um `readAllRows()` da planilha
// INTEIRA a cada load de página (visível nos logs de prod: `[sync-reverse:owner] total=9 …
// ignorados=9` em todo `GET /api/meus-projetos`), ~2 s por load, com a cota de 60
// leituras/min compartilhada com produção.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  readAllRows: vi.fn(async () => []),
  updateRowByProjectId: vi.fn(async () => true),
}));

// O sync de auto-cura vai para o `waitUntil` — capturamos para poder aguardar/assertar.
const emBackground: Promise<unknown>[] = [];
vi.mock('@/lib/background', () => ({
  runBackground: vi.fn((p: Promise<unknown>) => {
    emBackground.push(Promise.resolve(p).catch(() => undefined));
  }),
}));

import { readAllRows } from '@/lib/google/sheets';
import { runBackground } from '@/lib/background';
import { criarDbMemoria } from './helpers/db-memoria';
import { listarMeusProjetos } from '@/lib/meus-projetos.functions';
import { espelharLinhas } from '@/lib/sheet-espelho';
import { insertProjetoRaw, insertSyncRun } from '@/integrations/db/client.server';

const mockRead = vi.mocked(readAllRows);
const mockBackground = vi.mocked(runBackground);

const DONO = 'helen@gocase.com';

async function criarProjeto(over: Record<string, unknown> = {}) {
  await insertProjetoRaw({
    id: 'legado-148',
    nome: 'Portal de Reembolsos',
    responsavel_nome: 'Helén Sá',
    responsavel_email: DONO,
    ferramenta: 'Python',
    status: 'em_validacao',
    submitted_at: '2026-05-12T12:00:00.000Z',
    ...over,
  });
}

function linhaPlanilha(over: Record<string, string> = {}) {
  return {
    'ID Projeto': 'legado-148',
    Projeto: 'Portal de Reembolsos',
    Email: DONO,
    Status: 'Reenvio Pendente',
    'Atualizado Em': '23/06/2026 10:00',
    'Motivo Reprovado': '—',
    'Motivo Reenvio': 'faltou a composição das horas',
    ...over,
  } as never;
}

/** Marca uma sincronização recente para a auto-cura não disparar no teste. */
async function registrarSyncRecente() {
  await insertSyncRun({
    gatilho: 'cron',
    ok: 1,
    total: 1,
    espelhados: 1,
    criados: 0,
    atualizados: 0,
    removidos: 0,
    erros: 0,
    duracao_ms: 5,
    detalhe: null,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  emBackground.length = 0;
  await criarDbMemoria();
});

describe('listarMeusProjetos lê o espelho, não a planilha', () => {
  it('NÃO faz nenhuma leitura do Google Sheets no caminho do request', async () => {
    await criarProjeto();
    await espelharLinhas([linhaPlanilha()], Date.now());
    await registrarSyncRecente();

    const lista = await listarMeusProjetos(DONO);
    expect(mockRead).not.toHaveBeenCalled();
    expect(lista).toHaveLength(1);
  });

  it('Status, motivos e "Atualizado Em" vêm do espelho (a planilha é a fonte, lida pelo cron)', async () => {
    await criarProjeto();
    await espelharLinhas([linhaPlanilha()], Date.now());
    await registrarSyncRecente();

    const [p] = await listarMeusProjetos(DONO);
    expect(p!.status).toBe('reenvio pendente'); // chave do StatusBadge
    expect(p!.motivo_reenvio).toBe('faltou a composição das horas');
    expect(p!.motivo_reprovado).toBeNull(); // "—" é ausência
    expect(p!.atualizado_em).toBe('23/06/2026 10:00');
    expect(p!.pendente).toBe(false); // legado com "Atualizado Em" = regularizado
  });

  it('projeto AUSENTE do espelho fica com status null → "—" (nunca cai no status do SQLite)', async () => {
    await criarProjeto({ status: 'aprovado' });
    await registrarSyncRecente();

    const [p] = await listarMeusProjetos(DONO);
    expect(p!.status).toBeNull();
  });

  it('legado sem "Atualizado Em" na planilha continua PENDENTE de regularização', async () => {
    await criarProjeto();
    await espelharLinhas([linhaPlanilha({ 'Atualizado Em': '' })], Date.now());
    await registrarSyncRecente();

    const [p] = await listarMeusProjetos(DONO);
    expect(p!.pendente).toBe(true);
  });

  it('flag `descontinuado` do SQLite tem precedência sobre o Status do espelho', async () => {
    await criarProjeto({ descontinuado: 1 });
    await espelharLinhas([linhaPlanilha({ Status: 'Pendente' })], Date.now());
    await registrarSyncRecente();

    const [p] = await listarMeusProjetos(DONO);
    expect(p!.status).toBe('descontinuado');
    expect(p!.pendente).toBe(false);
  });

  it('espelho ilegível não derruba a tela — a lista sai sem Status', async () => {
    await criarProjeto();
    await registrarSyncRecente();
    const { getDb, setDb } = await import('@/integrations/db/client.server');
    const real = getDb();
    let falhar = true;
    await setDb({
      query: async (sql: string, params: unknown[] = []) => {
        if (falhar && sql.includes('sheet_espelho')) throw new Error('espelho fora');
        return real.query(sql, params);
      },
      exec: async (sql: string, params: unknown[] = []) => real.exec(sql, params),
    });

    const lista = await listarMeusProjetos(DONO);
    falhar = false;
    expect(lista).toHaveLength(1);
    expect(lista[0]!.status).toBeNull();
  });
});

describe('auto-cura: espelho estagnado agenda um sync sem bloquear a resposta', () => {
  it('sem nenhuma sincronização registrada, agenda o sync em background', async () => {
    await criarProjeto();
    await espelharLinhas([linhaPlanilha()], Date.now());

    const lista = await listarMeusProjetos(DONO);
    expect(lista).toHaveLength(1); // a resposta saiu na hora, com o espelho que existia
    expect(mockBackground).toHaveBeenCalledTimes(1);
    await Promise.all(emBackground);
  });

  it('com sincronização recente, NÃO agenda nada (o cron dá conta)', async () => {
    await criarProjeto();
    await espelharLinhas([linhaPlanilha()], Date.now());
    await registrarSyncRecente();

    await listarMeusProjetos(DONO);
    expect(mockBackground).not.toHaveBeenCalled();
  });
});
