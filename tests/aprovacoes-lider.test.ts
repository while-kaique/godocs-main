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
  rotuloIsencaoSheet,
  montarParticipantes,
} from '@/lib/aprovacoes.functions';
import { checklistCompleto, resumirChecklist } from '@/lib/aprovacoes-checklist';

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

// Checklist do gestor: obrigatório em toda decisão (pedido do Lucas, 03/08/2026).
const RESP_OK = { move_kpi: 'sim', sente_falta: 'sim', saving_coerente: 'sim' } as const;

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
    expect(r.rotuloSheet).toBe('Pré-aprovação pendente com Lucas Gonçalves Queiroz');
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

    expect(r).toMatchObject({
      isento: true,
      motivo: 'lideranca',
      rotuloSheet: 'Pré-aprovado (liderança)',
    });
    expect(await getAprovacoesDoProjeto(id)).toEqual([]);
    expect(mockDm).not.toHaveBeenCalled();
  });

  it('autor sem líder (topo da cadeia) não entra em fila nenhuma (D6)', async () => {
    mockLideres.mockResolvedValue([]);
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r).toMatchObject({
      isento: true,
      motivo: 'sem_lider',
      rotuloSheet: 'Sem líder na TeamGuide',
    });
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

    expect(r).toMatchObject({
      isento: true,
      motivo: 'teamguide_indisponivel',
      rotuloSheet: 'Aprovação indisponível (integração)',
    });
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

    await decidirAprovacao(ALINE.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });

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
      decidirAprovacao('estranho@gocase.com', { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK }),
    ).rejects.toMatchObject({ status: 403 });
    // E não decide duas vezes: depois de decidido, a linha não está mais pendente.
    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });
    await expect(
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'reprovado', comentario: 'x', respostas: RESP_OK }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reprovar exige comentário (é o texto que o autor lê)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await expect(
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'reprovado', comentario: '   ', respostas: RESP_OK }),
    ).rejects.toMatchObject({ status: 400 });

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'reprovado',
      comentario: 'Confira a frequência das horas do fiscal.',
      respostas: RESP_OK,
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

    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });

    expect(mockSheet).toHaveBeenCalledTimes(1);
    const [projetoId, cells] = mockSheet.mock.calls[0];
    expect(projetoId).toBe(id);
    expect(String((cells as Record<string, string>)['Aprovação do Líder'])).toMatch(
      /^Pré-aprovado por Lucas Gonçalves Queiroz em \d{2}\/\d{2}\/\d{4} — Move KPI: sim · Sentiria falta: sim · Saving coerente: sim$/,
    );
  });

  it('reenvio REABRE a fila — o veredito da versão anterior não carimba a nova (D10)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);
    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });
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


  it('CHECKLIST: sem as 3 respostas o parecer não é gravado (400) e a fila continua', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await expect(
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: { move_kpi: 'sim', sente_falta: 'sim' },
      }),
    ).rejects.toMatchObject({ status: 400 });
    // valor fora de sim/nao também não passa
    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: { move_kpi: 'talvez', sente_falta: 'sim', saving_coerente: 'sim' },
      }),
    ).rejects.toMatchObject({ status: 400 });

    const fila = (await listarAprovacoesPendentes(LUCAS.email)).itens.filter(
      (i) => i.projeto_id === id,
    );
    expect(fila).toHaveLength(1);
  });

  it('CHECKLIST: as respostas ficam gravadas na decisão e vão para a planilha', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'aprovado',
      respostas: { move_kpi: 'sim', sente_falta: 'nao', saving_coerente: 'sim' },
    });

    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas[0]).toMatchObject({
      resp_move_kpi: 'sim',
      resp_sente_falta: 'nao',
      resp_saving_coerente: 'sim',
    });
    const [, cells] = mockSheet.mock.calls[0];
    expect(String((cells as Record<string, string>)['Aprovação do Líder'])).toContain(
      'Sentiria falta: não',
    );
  });

  it('PRÉ-VISUALIZAÇÃO DE ADMIN: quem clicou é quem fica no `decidido_por`', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await decidirAprovacao(
      LUCAS.email,
      { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK },
      { atorReal: 'luis.albuquerque@gocase.com' },
    );

    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas.every((l) => l.decidido_por === 'luis.albuquerque@gocase.com')).toBe(true);
  });

  it('o card traz dono, participantes, saving e memorial sem abrir o projeto', async () => {
    const id = `p-card-${Date.now()}`;
    await insertProjetoRaw({
      id,
      nome: 'Conciliação fiscal',
      responsavel_nome: 'Luis Albuquerque',
      responsavel_email: 'luis.albuquerque@gocase.com',
      ferramenta: 'n8n',
      status: 'em_validacao',
      submitted_at: new Date().toISOString(),
      tipos_projeto: JSON.stringify(['saving']),
      area: 'RPA',
      descricao_breve: 'Concilia notas do fiscal todos os dias.',
      membros: JSON.stringify(['maria@gocase.com', 'luis.albuquerque@gocase.com']),
      membros_papeis: JSON.stringify({ 'maria@gocase.com': 'planejador' }),
      saving_horas: 44,
      saving_reais: 3200,
      tipo_saving: 'mensal',
      memorial_calculo: '### Resumo\nTotal de 44h/mês.',
    });
    await abrirPreAprovacao(id);

    const item = (await listarAprovacoesPendentes(LUCAS.email)).itens.find(
      (i) => i.projeto_id === id,
    )!;
    expect(item.autor_nome).toBe('Luis Albuquerque');
    expect(item.participantes).toEqual([
      { nome: 'Maria', email: 'maria@gocase.com', papel: 'Participante' },
    ]);
    expect(item.saving_horas).toBe(44);
    expect(item.saving_reais).toBe(3200);
    expect(item.memorial).toContain('Total de 44h/mês');
    expect(item.descricao_breve).toBe('Concilia notas do fiscal todos os dias.');
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
        { veredito: 'pendente', aprovador_nome: 'Lucas', aprovador_email: 'l@x', comentario: null, decidido_por: null, decidido_em: null, resp_move_kpi: null, resp_sente_falta: null, resp_saving_coerente: null },
        { veredito: 'pendente', aprovador_nome: 'Aline', aprovador_email: 'a@x', comentario: null, decidido_por: null, decidido_em: null, resp_move_kpi: null, resp_sente_falta: null, resp_saving_coerente: null },
      ]),
    ).toBe('Pré-aprovação pendente com Lucas, Aline');
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
        resp_move_kpi: 'sim',
        resp_sente_falta: 'sim',
        resp_saving_coerente: 'nao',
      },
    ]);
    expect(txt).toMatch(
      /^Ajuste pedido por Lucas em \d{2}\/\d{2}\/\d{4} — Move KPI: sim · Sentiria falta: sim · Saving coerente: não — Rever as horas$/,
    );
  });
});

describe('rotuloIsencaoSheet (puro) — os 3 casos sem fila são distinguíveis', () => {
  it('liderança sai como pré-aprovado (decisão do Luis, 03/08/2026)', () => {
    expect(rotuloIsencaoSheet('lideranca')).toBe('Pré-aprovado (liderança)');
  });

  it('sem líder e falha de integração NÃO se confundem com a isenção de liderança', () => {
    expect(rotuloIsencaoSheet('sem_lider')).toBe('Sem líder na TeamGuide');
    expect(rotuloIsencaoSheet('teamguide_indisponivel')).toBe('Aprovação indisponível (integração)');
    // os 3 textos são distintos entre si — é o ponto da mudança
    const textos = (['lideranca', 'sem_lider', 'teamguide_indisponivel'] as const).map(
      rotuloIsencaoSheet,
    );
    expect(new Set(textos).size).toBe(3);
  });

  it('motivo nulo (há fila) cai no "—" e nunca em texto de isenção', () => {
    expect(rotuloIsencaoSheet(null)).toBe('—');
  });
});

describe('checklist do gestor (puro)', () => {
  it('só libera com as 3 respondidas', () => {
    expect(checklistCompleto({})).toBe(false);
    expect(checklistCompleto({ move_kpi: 'sim', sente_falta: 'nao' })).toBe(false);
    expect(checklistCompleto({ move_kpi: 'sim', sente_falta: 'nao', saving_coerente: 'sim' })).toBe(
      true,
    );
  });

  it('parecer antigo (sem checklist) não suja o rótulo da planilha', () => {
    expect(resumirChecklist({})).toBe('');
  });
});

describe('montarParticipantes (puro)', () => {
  it('tira o autor da lista, deduplica e traduz o papel', () => {
    expect(
      montarParticipantes(
        JSON.stringify(['ANA@gocase.com', 'ana@gocase.com', 'dono@gocase.com', 'bruno.lima@gocase.com']),
        JSON.stringify({ 'ana@gocase.com': 'coexecutor', 'bruno.lima@gocase.com': 'idealizador' }),
        'Dono@gocase.com',
      ),
    ).toEqual([
      { nome: 'Ana', email: 'ana@gocase.com', papel: 'Coautor' },
      // papel LEGADO cai em Contribuidor, igual ao sync do Sheets
      { nome: 'Bruno Lima', email: 'bruno.lima@gocase.com', papel: 'Contribuidor' },
    ]);
  });

  it('projeto sem participantes/papéis não quebra', () => {
    expect(montarParticipantes(null, null, null)).toEqual([]);
    expect(montarParticipantes('{ nao é json', 'nem isso', 'a@x')).toEqual([]);
  });
});
