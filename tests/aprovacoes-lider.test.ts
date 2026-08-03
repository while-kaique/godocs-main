// Pré-aprovação do líder (F1). DB real (better-sqlite3 in-memory, igual ao adapter
// async do Godeploy); TeamGuide, Sheets e Chat são mockados (rede).
//
// Cobre as decisões que não podem regredir: a ISENÇÃO de liderança (D11), o autor sem
// líder (D6), o "primeiro que decide resolve" (D4), a reabertura no reenvio (D10) e o
// GATE server-side de quem pode decidir.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

vi.mock('@/lib/areas/teamguide.server', () => ({
  ehLideranca: vi.fn(),
  getLideresDe: vi.fn(),
  getLideradosDe: vi.fn(),
}));
vi.mock('@/lib/google/chat-dm', () => ({ enviarDmChat: vi.fn(async () => true) }));
vi.mock('@/lib/google/sheets', () => ({ updateRowByProjectId: vi.fn(async () => true) }));

import { ehLideranca, getLideresDe, getLideradosDe } from '@/lib/areas/teamguide.server';
import { enviarDmChat } from '@/lib/google/chat-dm';
import { updateRowByProjectId } from '@/lib/google/sheets';
import { setDb, insertProjetoRaw, getAprovacoesDoProjeto } from '@/integrations/db/client.server';
import {
  abrirPreAprovacao,
  decidirAprovacao,
  listarAprovacoesPendentes,
  resumoAprovacaoPorProjeto,
  rotuloAprovacaoSheet,
} from '@/lib/aprovacoes.functions';

const mockLideranca = ehLideranca as unknown as ReturnType<typeof vi.fn>;
const mockLideres = getLideresDe as unknown as ReturnType<typeof vi.fn>;
const mockLiderados = getLideradosDe as unknown as ReturnType<typeof vi.fn>;
const mockDm = enviarDmChat as unknown as ReturnType<typeof vi.fn>;
const mockSheet = updateRowByProjectId as unknown as ReturnType<typeof vi.fn>;

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

const LUCAS = { nome: 'Lucas Gonçalves Queiroz', email: 'lucas.queiroz@gocase.com' };
const ALINE = { nome: 'Aline Montenegro', email: 'aline.montenegro@gocase.com' };

let seq = 0;
/** Cria um projeto submetido do `luis.albuquerque@` e devolve o id. */
async function criarProjeto(nome = 'Projeto de teste'): Promise<string> {
  const id = `p-${++seq}`;
  await insertProjetoRaw({
    id,
    nome,
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: 'luis.albuquerque@gocase.com',
    ferramenta: 'n8n',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
    tipos_projeto: JSON.stringify(['saving']),
    area: 'RPA',
  });
  return id;
}

describe('pré-aprovação do líder', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([LUCAS]);
    mockLiderados.mockResolvedValue([]);
    mockDm.mockResolvedValue(true);
    mockSheet.mockResolvedValue(true);
  });

  it('abre a fila com o líder DIRETO e avisa por DM', async () => {
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r.isento).toBe(false);
    expect(r.aprovadores.map((a) => a.email)).toEqual([LUCAS.email]);
    expect(r.rotuloSheet).toBe('Pendente com Lucas Gonçalves Queiroz');
    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].veredito).toBe('pendente');
    expect(mockDm).toHaveBeenCalledTimes(1);
    expect(mockDm.mock.calls[0][0]).toBe(LUCAS.email);
  });

  it('AUTOR QUE É LIDERANÇA fica isento — nenhuma fila, nenhuma DM (D11)', async () => {
    mockLideranca.mockResolvedValue(true);
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r).toMatchObject({ isento: true, motivo: 'lideranca', rotuloSheet: '—' });
    expect(await getAprovacoesDoProjeto(id)).toEqual([]);
    expect(mockDm).not.toHaveBeenCalled();
  });

  it('autor sem líder (topo da cadeia) não entra em fila nenhuma (D6)', async () => {
    mockLideres.mockResolvedValue([]);
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r).toMatchObject({ isento: true, motivo: 'sem_lider', rotuloSheet: '—' });
    expect(await getAprovacoesDoProjeto(id)).toEqual([]);
  });

  it('líder sem e-mail cadastrado não vira aprovador', async () => {
    mockLideres.mockResolvedValue([{ nome: 'Líder Sem Email', email: null }]);
    const id = await criarProjeto();

    expect(await abrirPreAprovacao(id)).toMatchObject({ isento: true, motivo: 'sem_lider' });
  });

  it('TeamGuide fora não derruba a submissão — devolve isento com motivo (D3/D8)', async () => {
    mockLideranca.mockRejectedValue(new Error('TeamGuide 503'));
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r).toMatchObject({ isento: true, motivo: 'teamguide_indisponivel', rotuloSheet: '—' });
  });

  it('projeto de teste E2E não dispara DM', async () => {
    const id = await criarProjeto('[E2E-abc] Projeto');

    await abrirPreAprovacao(id);

    expect(mockDm).not.toHaveBeenCalled();
  });

  it('multi-time: 2 líderes na fila e o PRIMEIRO que decide resolve (D4)', async () => {
    mockLideres.mockResolvedValue([LUCAS, ALINE]);
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    // Os dois veem na fila… (o banco é compartilhado entre os casos → filtra por id)
    const naFila = async (email: string) =>
      (await listarAprovacoesPendentes(email)).itens.filter((i) => i.projeto_id === id);
    expect(await naFila(LUCAS.email)).toHaveLength(1);
    expect(await naFila(ALINE.email)).toHaveLength(1);

    await decidirAprovacao(ALINE.email, { projeto_id: id, veredito: 'aprovado' });

    // …e a decisão de um limpa a fila do outro.
    expect(await naFila(LUCAS.email)).toEqual([]);
    expect(await naFila(ALINE.email)).toEqual([]);
    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas.every((l) => l.veredito === 'aprovado')).toBe(true);
    expect(linhas.every((l) => l.decidido_por === ALINE.email)).toBe(true);
  });

  it('GATE: quem não tem pendência no projeto não decide (403)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await expect(
      decidirAprovacao('estranho@gocase.com', { projeto_id: id, veredito: 'aprovado' }),
    ).rejects.toMatchObject({ status: 403 });
    // E não decide duas vezes: depois de decidido, a linha não está mais pendente.
    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado' });
    await expect(
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'reprovado', comentario: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reprovar exige comentário (é o texto que o autor lê)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await expect(
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'reprovado', comentario: '   ' }),
    ).rejects.toMatchObject({ status: 400 });

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'reprovado',
      comentario: 'Confira a frequência das horas do fiscal.',
    });
    const resumo = await resumoAprovacaoPorProjeto([id]);
    expect(resumo[id]).toMatchObject({
      veredito: 'reprovado',
      comentario: 'Confira a frequência das horas do fiscal.',
    });
  });

  it('a decisão reflete na planilha (best-effort)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado' });

    expect(mockSheet).toHaveBeenCalledTimes(1);
    const [projetoId, cells] = mockSheet.mock.calls[0];
    expect(projetoId).toBe(id);
    expect(String((cells as Record<string, string>)['Aprovação do Líder'])).toMatch(
      /^Aprovado por Lucas Gonçalves Queiroz em \d{2}\/\d{2}\/\d{4}$/,
    );
  });

  it('reenvio REABRE a fila — o veredito da versão anterior não carimba a nova (D10)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);
    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado' });
    expect((await resumoAprovacaoPorProjeto([id]))[id].veredito).toBe('aprovado');

    await abrirPreAprovacao(id); // reenvio

    expect((await resumoAprovacaoPorProjeto([id]))[id].veredito).toBe('pendente');
    const fila = (await listarAprovacoesPendentes(LUCAS.email)).itens.filter(
      (i) => i.projeto_id === id,
    );
    expect(fila).toHaveLength(1);
  });

  it('lidera=true para quem tem liderados mesmo com a fila vazia', async () => {
    mockLiderados.mockResolvedValue([{ nome: 'Luis Albuquerque', email: 'luis.albuquerque@gocase.com' }]);

    const r = await listarAprovacoesPendentes('outro.lider@gocase.com');

    expect(r.itens).toEqual([]);
    expect(r.lidera).toBe(true);
  });

  it('quem não lidera ninguém não vê a fila', async () => {
    const r = await listarAprovacoesPendentes('luis.albuquerque@gocase.com');

    expect(r).toEqual({ lidera: false, itens: [] });
  });
});

describe('rotuloAprovacaoSheet (puro)', () => {
  it('sem fila → "—" (isento ou sem líder)', () => {
    expect(rotuloAprovacaoSheet([])).toBe('—');
  });

  it('pendente lista todos os líderes da fila', () => {
    expect(
      rotuloAprovacaoSheet([
        { veredito: 'pendente', aprovador_nome: 'Lucas', aprovador_email: 'l@x', comentario: null, decidido_por: null, decidido_em: null },
        { veredito: 'pendente', aprovador_nome: 'Aline', aprovador_email: 'a@x', comentario: null, decidido_por: null, decidido_em: null },
      ]),
    ).toBe('Pendente com Lucas, Aline');
  });

  it('reprovado leva o motivo para a planilha', () => {
    const txt = rotuloAprovacaoSheet([
      {
        veredito: 'reprovado',
        aprovador_nome: 'Lucas',
        aprovador_email: 'l@x',
        comentario: 'Rever as horas',
        decidido_por: 'l@x',
        decidido_em: '2026-08-03T12:00:00.000Z',
      },
    ]);
    expect(txt).toMatch(/^Reprovado por Lucas em \d{2}\/\d{2}\/\d{4} — Rever as horas$/);
  });
});
