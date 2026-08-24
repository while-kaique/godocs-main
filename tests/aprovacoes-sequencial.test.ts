// Pré-aprovação SEQUENCIAL de 2 líderes (projeto como FEATURE de outro projeto).
//
// Estágio 1 = líder do AUTOR (fluxo de sempre). Estágio 2 = líder do DONO DO PROJETO PAI,
// aberto SÓ depois de o estágio 1 ser APROVADO (ou já na submissão se o estágio 1 for
// isento). Cada estágio tem isenção INDEPENDENTE por cargo (D20) e a decisão de um estágio
// não fecha a fila do outro.
//
// DB real (better-sqlite3 in-memory, igual ao adapter async do Godeploy); TeamGuide,
// Sheets, Chat e Gomoon são mockados (rede).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

vi.mock('@/lib/areas/teamguide.server', () => ({
  ehLideranca: vi.fn(),
  getLideresDe: vi.fn(),
  getLideradosDe: vi.fn(),
}));
vi.mock('@/lib/google/sheets', () => ({
  updateRowByProjectId: vi.fn(async () => true),
  readAllRows: vi.fn(async () => []),
}));
vi.mock('@/lib/auth.functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth.functions')>()),
  isAdmin: vi.fn(async () => false),
}));
// O aviso ao líder do pai (Gomoon) é mockado: aqui validamos o wiring da FILA, não a rede.
vi.mock('@/lib/gomoon-lideres.functions', () => ({
  notificarLiderDoProjetoPai: vi.fn(async () => ({ ok: true })),
}));

import { ehLideranca, getLideresDe, getLideradosDe } from '@/lib/areas/teamguide.server';
import { notificarLiderDoProjetoPai } from '@/lib/gomoon-lideres.functions';
import { setDb, insertProjetoRaw, getAprovacoesDoProjeto } from '@/integrations/db/client.server';
import {
  abrirPreAprovacao,
  abrirPreAprovacaoProjetoPai,
  decidirAprovacao,
  parecerEstagio2ParaFicha,
} from '@/lib/aprovacoes.functions';

const mockLideranca = ehLideranca as unknown as ReturnType<typeof vi.fn>;
const mockLideres = getLideresDe as unknown as ReturnType<typeof vi.fn>;
const mockLiderados = getLideradosDe as unknown as ReturnType<typeof vi.fn>;
const mockNotifPai = notificarLiderDoProjetoPai as unknown as ReturnType<typeof vi.fn>;

function asyncAdapter(db: BetterSqlite3.Database): GoDeployDB {
  return {
    async query(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])), rowsRead: rows.length };
    },
    async exec(sql: string, params: unknown[] = []) {
      if (params.length > 0) {
        const r = db.prepare(sql).run(...params);
        return { rowsWritten: r.changes };
      }
      db.exec(sql);
      return { rowsWritten: 0 };
    },
  };
}

const RESP_OK = { move_kpi: 'sim', sente_falta: 'sim', saving_coerente: 'sim' } as const;

const LIDER_AUTOR = { nome: 'Lucas (líder do autor)', email: 'lucas.queiroz@gocase.com' };
const LIDER_PAI = { nome: 'Aline (líder do dono do pai)', email: 'aline.montenegro@gocase.com' };
const AUTOR = 'liderado@gocase.com';
const DONO_PAI = 'dono.pai@gocase.com';

// Por padrão: líder do AUTOR = Lucas; líder do DONO DO PAI = Aline.
function lideresPorEmail(email: string) {
  return (email ?? '').toLowerCase() === DONO_PAI ? [LIDER_PAI] : [LIDER_AUTOR];
}

let seq = 0;
async function criarPai(): Promise<string> {
  const id = `pai-${++seq}`;
  await insertProjetoRaw({
    id,
    nome: 'Projeto Pai',
    responsavel_nome: 'Dona do Pai',
    responsavel_email: DONO_PAI,
    ferramenta: 'n8n',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
  });
  return id;
}
async function criarFeature(paiId: string | null, nome = 'Feature X'): Promise<string> {
  const id = `feat-${++seq}`;
  await insertProjetoRaw({
    id,
    nome,
    responsavel_nome: 'Autor da Feature',
    responsavel_email: AUTOR,
    ferramenta: 'n8n',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
    tipos_projeto: JSON.stringify(['saving']),
    projeto_pai_id: paiId,
  });
  return id;
}

function pendentesDe(linhas: { estagio: number; veredito: string }[], estagio: number) {
  return linhas.filter((l) => Number(l.estagio) === estagio);
}

describe('pré-aprovação sequencial (feature de outro projeto)', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockImplementation(async (email: string) => lideresPorEmail(email));
    mockLiderados.mockResolvedValue([]);
  });

  it('estágio 1 APROVADO → abre o estágio 2 (líder do dono do pai)', async () => {
    const pai = await criarPai();
    const feat = await criarFeature(pai);

    // Estágio 1 abre com o líder do autor.
    const r1 = await abrirPreAprovacao(feat);
    expect(r1.isento).toBe(false);
    expect(r1.aprovadores.map((a) => a.email)).toEqual([LIDER_AUTOR.email]);
    expect(pendentesDe(await getAprovacoesDoProjeto(feat), 2)).toHaveLength(0); // estágio 2 ainda não

    // Líder do autor APROVA → dispara o estágio 2.
    await decidirAprovacao(LIDER_AUTOR.email, {
      projeto_id: feat,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });

    const linhas = await getAprovacoesDoProjeto(feat);
    const e1 = pendentesDe(linhas, 1);
    const e2 = pendentesDe(linhas, 2);
    expect(e1[0].veredito).toBe('aprovado');
    expect(e2).toHaveLength(1);
    expect(e2[0].veredito).toBe('pendente');
    expect(e2[0].aprovador_email).toBe(LIDER_PAI.email);
    // O aviso próprio ao líder do pai saiu (copy da feature).
    expect(mockNotifPai).toHaveBeenCalledTimes(1);
  });

  it('estágio 1 REPROVA → NÃO chega ao estágio 2', async () => {
    const pai = await criarPai();
    const feat = await criarFeature(pai);
    await abrirPreAprovacao(feat);

    await decidirAprovacao(LIDER_AUTOR.email, {
      projeto_id: feat,
      veredito: 'reprovado',
      comentario: 'não faz sentido',
      respostas: RESP_OK,
    });

    expect(pendentesDe(await getAprovacoesDoProjeto(feat), 2)).toHaveLength(0);
    expect(mockNotifPai).not.toHaveBeenCalled();
  });

  it('estágio 1 pede AJUSTE → NÃO chega ao estágio 2', async () => {
    const pai = await criarPai();
    const feat = await criarFeature(pai);
    await abrirPreAprovacao(feat);

    await decidirAprovacao(LIDER_AUTOR.email, {
      projeto_id: feat,
      veredito: 'ajuste',
      comentario: 'corrija o memorial',
      respostas: RESP_OK,
    });

    expect(pendentesDe(await getAprovacoesDoProjeto(feat), 2)).toHaveLength(0);
  });

  it('isenção do estágio 2 é INDEPENDENTE: dono do pai é liderança → estágio 2 sem fila', async () => {
    const pai = await criarPai();
    const feat = await criarFeature(pai);
    await abrirPreAprovacao(feat);
    // Só o DONO DO PAI é liderança (o autor não).
    mockLideranca.mockImplementation(async (email: string) => (email ?? '').toLowerCase() === DONO_PAI);

    await decidirAprovacao(LIDER_AUTOR.email, {
      projeto_id: feat,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });

    expect(pendentesDe(await getAprovacoesDoProjeto(feat), 2)).toHaveLength(0);
    expect(mockNotifPai).not.toHaveBeenCalled();
  });

  it('decisão do estágio 2 NÃO reabre nem mexe no estágio 1', async () => {
    const pai = await criarPai();
    const feat = await criarFeature(pai);
    await abrirPreAprovacao(feat);
    await decidirAprovacao(LIDER_AUTOR.email, {
      projeto_id: feat,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });

    // Líder do pai decide o estágio 2.
    await decidirAprovacao(LIDER_PAI.email, {
      projeto_id: feat,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });

    const linhas = await getAprovacoesDoProjeto(feat);
    expect(pendentesDe(linhas, 1)[0].veredito).toBe('aprovado'); // intacto
    expect(pendentesDe(linhas, 2)[0].veredito).toBe('aprovado');
    // A ficha do dashboard mostra o parecer do estágio 2.
    const parecer = parecerEstagio2ParaFicha(linhas);
    expect(parecer?.estado).toBe('Pré-aprovado');
  });

  it('abrirPreAprovacaoProjetoPai é IDEMPOTENTE (o gatilho pode disparar 2x)', async () => {
    const pai = await criarPai();
    const feat = await criarFeature(pai);
    await abrirPreAprovacao(feat);
    await decidirAprovacao(LIDER_AUTOR.email, {
      projeto_id: feat,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });

    const r = await abrirPreAprovacaoProjetoPai(feat); // 2ª chamada explícita
    expect(r).toMatchObject({ aberto: false, motivo: 'ja_aberto' });
    expect(pendentesDe(await getAprovacoesDoProjeto(feat), 2)).toHaveLength(1);
  });

  it('projeto SEM pai não abre estágio 2 ao aprovar o estágio 1', async () => {
    const feat = await criarFeature(null, 'Projeto normal');
    await abrirPreAprovacao(feat);
    await decidirAprovacao(LIDER_AUTOR.email, {
      projeto_id: feat,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });
    expect(pendentesDe(await getAprovacoesDoProjeto(feat), 2)).toHaveLength(0);
    const semPai = await abrirPreAprovacaoProjetoPai(feat);
    expect(semPai).toMatchObject({ aberto: false, motivo: 'sem_pai' });
  });

  it('parecerEstagio2ParaFicha é null quando não há estágio 2', async () => {
    const feat = await criarFeature(null);
    await abrirPreAprovacao(feat);
    expect(parecerEstagio2ParaFicha(await getAprovacoesDoProjeto(feat))).toBeNull();
  });
});
