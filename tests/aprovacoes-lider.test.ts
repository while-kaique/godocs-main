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
vi.mock('@/lib/google/sheets', () => ({ updateRowByProjectId: vi.fn(async () => true) }));

import { ehLideranca, getLideresDe, getLideradosDe } from '@/lib/areas/teamguide.server';
import { updateRowByProjectId } from '@/lib/google/sheets';
import { setDb, insertProjetoRaw, getAprovacoesDoProjeto } from '@/integrations/db/client.server';
import {
  abrirPreAprovacao,
  decidirAprovacao,
  listarAprovacoesPendentes,
  resumoAprovacaoPorProjeto,
  rotuloAprovacaoSheet,
  rotuloIsencaoSheet,
  justificativaAprovacaoSheet,
  justificativaIsencaoSheet,
  montarParticipantes,
  extrairNumeros,
} from '@/lib/aprovacoes.functions';
import {
  CHECKLIST_APROVACAO,
  bloqueiaPreAprovacao,
  checklistCompleto,
  exigeJustificativa,
  resumirChecklist,
  temNaoNoChecklist,
} from '@/lib/aprovacoes-checklist';

const mockLideranca = ehLideranca as unknown as ReturnType<typeof vi.fn>;
const mockLideres = getLideresDe as unknown as ReturnType<typeof vi.fn>;
const mockLiderados = getLideradosDe as unknown as ReturnType<typeof vi.fn>;
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
    mockSheet.mockResolvedValue(true);
  });

  it('abre a fila com o líder DIRETO', async () => {
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r.isento).toBe(false);
    expect(r.aprovadores.map((a) => a.email)).toEqual([LUCAS.email]);
    expect(r.rotuloSheet).toBe('Pré-pendente');
    expect(r.justificativaSheet).toBe('Aguardando Lucas Gonçalves Queiroz');
    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].veredito).toBe('pendente');
  });

  it('AUTOR QUE É LIDERANÇA fica isento — nenhuma fila (D11)', async () => {
    mockLideranca.mockResolvedValue(true);
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r).toMatchObject({
      isento: true,
      motivo: 'lideranca',
      rotuloSheet: 'Pré-aprovado',
    });
    expect(await getAprovacoesDoProjeto(id)).toEqual([]);
  });

  it('autor sem líder (topo da cadeia) não entra em fila nenhuma (D6)', async () => {
    mockLideres.mockResolvedValue([]);
    const id = await criarProjeto();

    const r = await abrirPreAprovacao(id);

    expect(r).toMatchObject({
      isento: true,
      motivo: 'sem_lider',
      rotuloSheet: '—',
    });
    expect(await getAprovacoesDoProjeto(id)).toEqual([]);
  });

  // D27 (06/08/2026, decisão do Luis): projeto ESPECIAL não é pendência do líder —
  // não tem memorial financeiro, então a 3ª pergunta do checklist ("o saving faz
  // sentido?") não teria o que julgar, e o destino dele sempre foi a validação humana
  // da RPA. ⚠️ O guard roda ANTES da TeamGuide: é um flag do projeto, não depende de
  // integração externa — por isso este teste deixa a liderança/os líderes mockados
  // como um autor NORMAL e ainda assim espera fila zero.
  it('projeto ESPECIAL não abre fila, nem consulta a TeamGuide (D27)', async () => {
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([ALINE]);
    const id = `p-especial-${++seq}`;
    await insertProjetoRaw({
      id,
      nome: 'Projeto especial de teste',
      responsavel_nome: 'Luis Albuquerque',
      responsavel_email: 'luis.albuquerque@gocase.com',
      ferramenta: 'n8n',
      status: 'em_validacao',
      submitted_at: new Date().toISOString(),
      tipos_projeto: JSON.stringify(['especial']),
      especial: 1,
      area: 'RPA',
    });

    const r = await abrirPreAprovacao(id);

    expect(r).toMatchObject({ isento: true, motivo: 'especial', rotuloSheet: '—' });
    expect(r.aprovadores).toEqual([]);
    expect(await getAprovacoesDoProjeto(id)).toEqual([]);
    // A auditoria precisa distinguir isenção legítima de falha de integração (D12).
    expect(r.justificativaSheet).toMatch(/especial/i);
    expect(mockLideranca).not.toHaveBeenCalled();
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
      rotuloSheet: '—',
    });
  });

  // D17 (05/08/2026): notificar é do Gomoon, e a submissão NÃO dispara nada. Logo o
  // projeto de teste `[E2E-…]` entra na fila como qualquer outro — excluí-lo é
  // responsabilidade de quem monta o payload diário (docs/integracao-gomoon-chat.md).
  // Este teste existe para ninguém reintroduzir o filtro AQUI.
  it('projeto de teste E2E abre fila normalmente (o mute mora no payload do Gomoon)', async () => {
    const id = await criarProjeto('[E2E-abc] Projeto');

    const r = await abrirPreAprovacao(id);

    expect(r.isento).toBe(false);
    expect(await getAprovacoesDoProjeto(id)).toHaveLength(1);
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

  it('SAVING INCOERENTE bloqueia a pré-aprovação — só ajuste/reprovação (04/08/2026)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);
    const respostas = { ...RESP_OK, saving_coerente: 'nao' as const };

    // Número errado não se justifica, se corrige: nem com texto o "aprovado" passa.
    await expect(
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        comentario: 'confio no autor',
        respostas,
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Ajuste passa (com texto) e a planilha recebe o rótulo próprio.
    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'ajuste',
      comentario: 'As horas supõem diário; é 2× por semana. Corrija a frequência.',
      respostas,
    });
    const cells = mockSheet.mock.calls.at(-1)![1] as Record<string, string>;
    expect(cells['Aprovação do Líder']).toBe('Ajuste pedido');
  });

  it('REPROVAR é desfecho próprio (rótulo e exigência de motivo)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);
    await expect(
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'reprovado', respostas: RESP_OK }),
    ).rejects.toMatchObject({ status: 400 });

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'reprovado',
      comentario: 'Não é automação: a planilha é preenchida à mão pela própria equipe.',
      respostas: RESP_OK,
    });
    const cells = mockSheet.mock.calls.at(-1)![1] as Record<string, string>;
    expect(cells['Aprovação do Líder']).toBe('Pré-reprovado');
  });

  it('pré-aprovar com "não" no checklist exige explicação (04/08/2026)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    // Sem texto: barra (a contradição "não é coerente, mas pré-aprovo" precisa de motivo).
    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: { ...RESP_OK, sente_falta: 'nao' },
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Com texto: grava, e a explicação vai para a coluna de justificativa junto do checklist.
    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'aprovado',
      comentario: 'Roda pouco hoje, mas na alta de novembro evita 2 pessoas dedicadas.',
      respostas: { ...RESP_OK, sente_falta: 'nao' },
    });
    const resumo = await resumoAprovacaoPorProjeto([id]);
    expect(resumo[id]).toMatchObject({ veredito: 'aprovado' });
    const cells = mockSheet.mock.calls.at(-1)![1] as Record<string, string>;
    const just = String(cells['Justificativa Aprovação do Líder']);
    // A pergunta como o líder a leu + o "não" que ele marcou (não um código resumido).
    expect(just).toContain('Se este projeto fosse desligado hoje, a área sentiria falta? — não');
    // E a explicação rotulada pela pergunta que ficou "não" (05/08/2026).
    expect(just).toContain('Justificativa do "não" em Sentiria falta: Roda pouco hoje');
    expect(just).toContain('alta de novembro');
  });

  it('pré-aprovar com checklist todo "sim" NÃO exige explicação', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);
    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });
    expect((await resumoAprovacaoPorProjeto([id]))[id].veredito).toBe('aprovado');
  });

  it('a decisão reflete na planilha (best-effort)', async () => {
    const id = await criarProjeto();
    await abrirPreAprovacao(id);

    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });

    expect(mockSheet).toHaveBeenCalledTimes(1);
    const [projetoId, cells] = mockSheet.mock.calls[0];
    expect(projetoId).toBe(id);
    const c = cells as Record<string, string>;
    expect(c['Aprovação do Líder']).toBe('Pré-aprovado');
    // Uma linha de assinatura + UMA LINHA POR PERGUNTA do checklist (05/08/2026). Sem
    // texto livre (checklist todo "sim"), são exatamente 4 linhas.
    const linhasJust = String(c['Justificativa Aprovação do Líder']).split('\n');
    expect(linhasJust[0]).toMatch(
      /^Pré-aprovado por Lucas Gonçalves Queiroz \(lucas\.queiroz@gocase\.com\) em \d{2}\/\d{2}\/\d{4}$/,
    );
    expect(linhasJust).toHaveLength(4);
    for (const p of CHECKLIST_APROVACAO) {
      expect(linhasJust).toContain(`${p.pergunta} — sim`);
    }
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
      // Com um "não" no checklist, a explicação é obrigatória (04/08/2026).
      comentario: 'O processo é sazonal, a área só sente falta no fechamento.',
      respostas: { move_kpi: 'sim', sente_falta: 'nao', saving_coerente: 'sim' },
    });

    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas[0]).toMatchObject({
      resp_move_kpi: 'sim',
      resp_sente_falta: 'nao',
      resp_saving_coerente: 'sim',
    });
    const [, cells] = mockSheet.mock.calls[0];
    const just = String((cells as Record<string, string>)['Justificativa Aprovação do Líder']);
    expect(just).toContain('O projeto move algum KPI da área? — sim');
    expect(just).toContain('Se este projeto fosse desligado hoje, a área sentiria falta? — não');
    expect(just).toContain('O saving declarado é coerente com o impacto que você vê na área? — sim');
    expect(just).toContain('O processo é sazonal');
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

describe('Sheets: estado e justificativa são colunas SEPARADAS (decisão 03/08/2026)', () => {
  const pendentes = [
    { veredito: 'pendente', aprovador_nome: 'Lucas', aprovador_email: 'l@x', comentario: null, decidido_por: null, decidido_em: null, resp_move_kpi: null, resp_sente_falta: null, resp_saving_coerente: null },
    { veredito: 'pendente', aprovador_nome: 'Aline', aprovador_email: 'a@x', comentario: null, decidido_por: null, decidido_em: null, resp_move_kpi: null, resp_sente_falta: null, resp_saving_coerente: null },
  ];

  it('sem fila → "—" nas duas colunas', () => {
    expect(rotuloAprovacaoSheet([])).toBe('—');
    expect(justificativaAprovacaoSheet([])).toBe('—');
  });

  it('pendente → estado "Pré-pendente"; os líderes vão para a justificativa', () => {
    expect(rotuloAprovacaoSheet(pendentes)).toBe('Pré-pendente');
    expect(justificativaAprovacaoSheet(pendentes)).toBe('Aguardando Lucas, Aline');
  });

  it('decidido → o estado é UMA palavra; checklist e comentário só na justificativa', () => {
    const linhas = [
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
    ];
    expect(rotuloAprovacaoSheet(linhas)).toBe('Pré-reprovado');
    expect(rotuloAprovacaoSheet(linhas)).not.toContain('Rever as horas');
    const just = justificativaAprovacaoSheet(linhas);
    expect(just.split('\n')[0]).toMatch(/^Pré-reprovado por Lucas \(l@x\) em \d{2}\/\d{2}\/\d{4}$/);
    expect(just).toContain('O saving declarado é coerente com o impacto que você vê na área? — não');
    // Reprovação: o texto livre é o MOTIVO, e a planilha diz isso.
    expect(just).toContain('Motivo da reprovação: Rever as horas');
    expect(rotuloAprovacaoSheet([{ veredito: 'aprovado' }])).toBe('Pré-aprovado');
  });
});

describe('Justificativa do Sheets guarda TUDO o que o líder respondeu (05/08/2026)', () => {
  const base = {
    aprovador_nome: 'Lucas',
    aprovador_email: 'l@x',
    decidido_por: 'l@x',
    decidido_em: '2026-08-05T12:00:00.000Z',
  };

  it('pedido de ajuste: o texto livre é rotulado como o que precisa mudar', () => {
    const just = justificativaAprovacaoSheet([
      {
        ...base,
        veredito: 'ajuste',
        comentario: 'Refazer as horas do time fiscal',
        resp_move_kpi: 'sim',
        resp_sente_falta: 'sim',
        resp_saving_coerente: 'nao',
      },
    ]);
    expect(just.split('\n')[0]).toContain('Ajuste pedido por Lucas');
    expect(just).toContain('O que precisa ser ajustado: Refazer as horas do time fiscal');
  });

  it('DOIS "nãos": a explicação diz A QUAIS perguntas ela responde', () => {
    const just = justificativaAprovacaoSheet([
      {
        ...base,
        veredito: 'aprovado',
        comentario: 'Projeto sazonal: só aparece no fechamento, mas ali é crítico.',
        resp_move_kpi: 'nao',
        resp_sente_falta: 'nao',
        resp_saving_coerente: 'sim',
      },
    ]);
    expect(just).toContain('Justificativa do "não" em Move KPI e Sentiria falta:');
    expect(just).toContain('O projeto move algum KPI da área? — não');
    expect(just).toContain('Se este projeto fosse desligado hoje, a área sentiria falta? — não');
    expect(just).toContain('Projeto sazonal');
  });

  it('parecer ANTIGO (sem checklist) não inventa respostas — só assinatura + texto', () => {
    const just = justificativaAprovacaoSheet([
      {
        ...base,
        veredito: 'aprovado',
        comentario: 'ok',
        resp_move_kpi: null,
        resp_sente_falta: null,
        resp_saving_coerente: null,
      },
    ]);
    expect(just.split('\n')).toHaveLength(2);
    expect(just).not.toContain('—');
    expect(just).toContain('Comentário do líder: ok');
  });

  it('decidido por quem não está na fila (preview de admin) — nome derivado + e-mail', () => {
    const just = justificativaAprovacaoSheet([
      {
        ...base,
        aprovador_nome: null,
        veredito: 'aprovado',
        comentario: null,
        decidido_por: 'luis.albuquerque@gocase.com',
        resp_move_kpi: 'sim',
        resp_sente_falta: 'sim',
        resp_saving_coerente: 'sim',
      },
    ]);
    expect(just.split('\n')[0]).toContain('Luis Albuquerque (luis.albuquerque@gocase.com)');
  });
});

describe('isenção (puro) — estado enxuto + motivo na justificativa (D12)', () => {
  it('liderança sai como "Pré-aprovado" e o motivo vai para a justificativa', () => {
    expect(rotuloIsencaoSheet('lideranca')).toBe('Pré-aprovado');
    expect(justificativaIsencaoSheet('lideranca')).toContain('liderança');
  });

  it('sem líder e falha de integração não têm estado, só justificativa distinta', () => {
    expect(rotuloIsencaoSheet('sem_lider')).toBe('—');
    expect(rotuloIsencaoSheet('teamguide_indisponivel')).toBe('—');
    expect(justificativaIsencaoSheet('sem_lider')).toBe('Sem líder na TeamGuide');
    expect(justificativaIsencaoSheet('teamguide_indisponivel')).toBe(
      'Aprovação indisponível (integração)',
    );
    const textos = (['lideranca', 'sem_lider', 'teamguide_indisponivel'] as const).map(
      justificativaIsencaoSheet,
    );
    expect(new Set(textos).size).toBe(3);
  });

  it('motivo nulo (há fila) cai no "—" nas duas', () => {
    expect(rotuloIsencaoSheet(null)).toBe('—');
    expect(justificativaIsencaoSheet(null)).toBe('—');
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

  it('exigeJustificativa: sempre no ajuste, e na pré-aprovação só com "não"', () => {
    const todosSim = { move_kpi: 'sim', sente_falta: 'sim', saving_coerente: 'sim' } as const;
    const comNao = { ...todosSim, sente_falta: 'nao' } as const;

    expect(temNaoNoChecklist(todosSim)).toBe(false);
    expect(temNaoNoChecklist(comNao)).toBe(true);

    expect(exigeJustificativa('aprovado', todosSim)).toBe(false);
    expect(exigeJustificativa('aprovado', comNao)).toBe(true);
    // Pedir ajuste sempre pede texto — inclusive com o checklist todo "sim".
    expect(exigeJustificativa('reprovado', todosSim)).toBe(true);
    expect(exigeJustificativa('ajuste', todosSim)).toBe(true);
    // Saving incoerente NÃO pede justificativa: bloqueia a pré-aprovação.
    const savingRuim = { ...todosSim, saving_coerente: 'nao' } as const;
    expect(bloqueiaPreAprovacao(savingRuim)).toBe(true);
    expect(bloqueiaPreAprovacao(comNao)).toBe(false);
    expect(exigeJustificativa('aprovado', savingRuim)).toBe(false);
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

describe('extrairNumeros (puro) — números do card nas fontes do sync', () => {
  it('custo evitado vem do JSON da doc e a receita do bloco de receita', () => {
    expect(
      extrairNumeros({
        custo_evitado_itens: JSON.stringify([{ valor: 100 }, { valor: 50 }]),
        doc_conteudo: JSON.stringify({
          saving: { custo_evitado_reais: 900 },
          receita: { valor_ganho_mensal: 1200 },
        }),
      }),
    ).toEqual({ custo_evitado_reais: 900, receita_mensal: 1200 });
  });

  it('sem valor na doc, o custo evitado cai na SOMA dos itens do formulário', () => {
    expect(
      extrairNumeros({
        custo_evitado_itens: JSON.stringify([{ valor: 100 }, { valor: 50 }]),
        doc_conteudo: null,
      }),
    ).toEqual({ custo_evitado_reais: 150, receita_mensal: null });
  });

  it('zero e JSON quebrado viram null (o card não mostra a linha)', () => {
    expect(extrairNumeros({ custo_evitado_itens: 'x{', doc_conteudo: 'y{' })).toEqual({
      custo_evitado_reais: null,
      receita_mensal: null,
    });
  });
});
