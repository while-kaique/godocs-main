// Dispensa da fila do líder quando o ANALISADOR reprova o projeto (`claro_nao`).
//
// Comportamento (plano `docs/plans/dispensa-fila-lider-reprovado.md`): quando o
// analisador classifica o projeto como `claro_nao` (→ Status "Reprovado" na planilha),
// as linhas PENDENTES da fila de pré-aprovação viram `'dispensado'` — o líder para de
// ser cobrado de um parecer sobre algo que o sistema já recusou.
//
// O que estes testes prendem:
//  • T1 — `dispensarAprovacoesPendentes` só toca linha PENDENTE (parecer humano fica
//    intacto no banco).
//  • T2 — os 2 rótulos do Sheets tratam `'dispensado'` EXPLICITAMENTE. ⚠️ Risco nº 1 do
//    plano: o fall-through atual de `rotuloAprovacaoSheet` devolve "Pré-reprovado" para
//    qualquer veredito desconhecido — a planilha afirmaria que O LÍDER reprovou um
//    projeto que ele nunca abriu. E o parecer HUMANO vence a dispensa, INDEPENDENTE da
//    ordem das linhas no array.
//  • T3 — `dispensarPreAprovacao` é no-op sem fila pendente e NUNCA lança (D3).
//  • T6 — `chaveDoEstado` reconhece o rótulo novo (o chip do /dashboard).
//  • T7 — fila TODA dispensada é reabrível sem `forcar` (a triagem pode reverter a
//    reprovação); fila com parecer humano segue exigindo `forcar`.
//  • Critério nº 1 — o projeto dispensado SOME da fila (`listarAprovacoesPendentes`) e
//    do payload do Gomoon (`getPendenciasPorLider`).
//
// Mesmo fixture do `tests/aprovacoes-lider.test.ts`: DB real (better-sqlite3 in-memory
// sobre o adapter async do Godeploy), TeamGuide/Sheets mockados, `isAdmin` fixado em
// false (ele lê `ADMIN_EMAILS` do ambiente e o override de admin já fez teste passar
// por engano neste repo).
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

import { ehLideranca, getLideresDe, getLideradosDe } from '@/lib/areas/teamguide.server';
import { updateRowByProjectId } from '@/lib/google/sheets';
import * as dbNs from '@/integrations/db/client.server';
import {
  setDb,
  insertProjetoRaw,
  getAprovacoesDoProjeto,
  getPendenciasPorLider,
} from '@/integrations/db/client.server';
import * as aprovacoesNs from '@/lib/aprovacoes.functions';
import {
  abrirPreAprovacao,
  decidirAprovacao,
  listarAprovacoesPendentes,
  rotuloAprovacaoSheet,
  justificativaAprovacaoSheet,
  reabrirPreAprovacoes,
  resumoAprovacaoPorProjeto,
} from '@/lib/aprovacoes.functions';
import { chaveDoEstado } from '@/lib/aprovacoes-parecer';

const mockLideranca = ehLideranca as unknown as ReturnType<typeof vi.fn>;
const mockLideres = getLideresDe as unknown as ReturnType<typeof vi.fn>;
const mockLiderados = getLideradosDe as unknown as ReturnType<typeof vi.fn>;
const mockSheet = updateRowByProjectId as unknown as ReturnType<typeof vi.fn>;

const RESP_OK = { move_kpi: 'sim', sente_falta: 'sim', saving_coerente: 'sim' } as const;
const LUCAS = { nome: 'Lucas Gonçalves Queiroz', email: 'lucas.queiroz@gocase.com' };
const ALINE = { nome: 'Aline Montenegro', email: 'aline.montenegro@gocase.com' };

// ─── Símbolos que o plano cria (T1/T3) ───────────────────────────────────────
// Resolvidos por NAMESPACE de propósito: um `import { … }` de export inexistente
// derruba o arquivo inteiro no carregamento e todos os casos morreriam por crash. Assim
// cada caso falha por ASSERÇÃO, dizendo qual símbolo falta.

type ResultadoDispensa = {
  dispensou: boolean;
  rotuloSheet?: string;
  justificativaSheet?: string;
};

function fnDispensarPreAprovacao(): (projetoId: string) => Promise<ResultadoDispensa> {
  const f = (aprovacoesNs as unknown as Record<string, unknown>)['dispensarPreAprovacao'];
  expect(
    typeof f,
    '`dispensarPreAprovacao` ainda não é exportada por @/lib/aprovacoes.functions (T3 do plano)',
  ).toBe('function');
  return f as (projetoId: string) => Promise<ResultadoDispensa>;
}

function fnDispensarLinhas(): (projetoId: string, comentario: string | null) => Promise<void> {
  const f = (dbNs as unknown as Record<string, unknown>)['dispensarAprovacoesPendentes'];
  expect(
    typeof f,
    '`dispensarAprovacoesPendentes` ainda não é exportada por @/integrations/db/client.server (T1 do plano)',
  ).toBe('function');
  return f as (projetoId: string, comentario: string | null) => Promise<void>;
}

// O adapter carrega um interruptor de falha: é assim que se prova a invariante D3
// (`dispensarPreAprovacao` NUNCA lança) sem trocar o banco no meio da suíte.
// `falharLeituraAposEscrita` cobre o duplo-fault que separa "falhou ANTES de gravar" de
// "falhou DEPOIS": a re-leitura cai com o UPDATE já aplicado. É o caso em que devolver
// `dispensou:false` deixaria a planilha em "Pré-pendente" com a fila fechada no SQLite.
const estadoDb = { falhar: false, falharLeituraAposEscrita: false, escreveu: false };

function asyncAdapter(db: BetterSqlite3.Database): GoDeployDB {
  return {
    async query(sql: string, params: unknown[] = []) {
      if (estadoDb.falhar) throw new Error('Network connection lost.');
      if (estadoDb.falharLeituraAposEscrita && estadoDb.escreveu) {
        throw new Error('Network connection lost.');
      }
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])), rowsRead: rows.length };
    },
    async exec(sql: string, params: unknown[] = []) {
      if (estadoDb.falhar) throw new Error('Network connection lost.');
      estadoDb.escreveu = true;
      if (params.length > 0) {
        const r = db.prepare(sql).run(...params);
        return { rowsWritten: r.changes };
      }
      db.exec(sql);
      return { rowsWritten: 0 };
    },
  };
}

let seq = 0;
/** Projeto submetido; `autor` permite isolar a linha do relatório do Gomoon. */
async function criarProjeto(nome = 'Projeto de teste', autor = 'luis.albuquerque@gocase.com') {
  const id = `disp-${++seq}`;
  await insertProjetoRaw({
    id,
    nome,
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: autor,
    ferramenta: 'n8n',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
    tipos_projeto: JSON.stringify(['saving']),
    area: 'RPA',
  });
  return id;
}

describe('dispensa da fila quando o analisador reprova (banco)', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  beforeEach(() => {
    estadoDb.falhar = false;
    estadoDb.falharLeituraAposEscrita = false;
    estadoDb.escreveu = false;
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([LUCAS]);
    mockLiderados.mockResolvedValue([]);
    mockSheet.mockResolvedValue(true);
  });

  it('T1: dispensa TODAS as linhas pendentes — sistema como autor da decisão', async () => {
    mockLideres.mockResolvedValue([LUCAS, ALINE]);
    const id = await criarProjeto('Projeto reprovado por critério');
    await abrirPreAprovacao(id);

    await fnDispensarLinhas()(id, 'Reprovado pela análise automática de critério.');

    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas).toHaveLength(2);
    for (const l of linhas) {
      expect(l.veredito).toBe('dispensado');
      expect(l.decidido_por).toBe('sistema');
      expect(l.decidido_em).toBeTruthy();
      expect(l.comentario).toBe('Reprovado pela análise automática de critério.');
    }
  });

  it('T1: parecer HUMANO já dado fica INTACTO — a dispensa só toca "pendente"', async () => {
    const id = await criarProjeto('Projeto já pré-aprovado');
    await abrirPreAprovacao(id);
    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });

    await fnDispensarLinhas()(id, 'Reprovado pela análise automática de critério.');

    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas.every((l) => l.veredito === 'aprovado')).toBe(true);
    expect(linhas.every((l) => l.decidido_por === LUCAS.email)).toBe(true);
    expect(linhas.every((l) => l.comentario == null)).toBe(true);
  });

  it('CRITÉRIO 1: o projeto some da fila do líder E do payload do Gomoon', async () => {
    const autor = 'liderado.dispensa@gocase.com';
    const id = await criarProjeto('Projeto que será reprovado', autor);
    await abrirPreAprovacao(id);

    const naFila = async () =>
      (await listarAprovacoesPendentes(LUCAS.email)).itens.filter((i) => i.projeto_id === id);
    const noGomoon = async () =>
      (await getPendenciasPorLider()).filter((r) => r.liderado_email === autor);
    expect(await naFila()).toHaveLength(1);
    expect(await noGomoon()).toHaveLength(1);

    const r = await fnDispensarPreAprovacao()(id);

    expect(r.dispensou).toBe(true);
    expect(r.rotuloSheet).toBe('Dispensado');
    expect(r.justificativaSheet).toBeTruthy();
    expect(await naFila()).toEqual([]);
    expect(await noGomoon()).toEqual([]);
    expect((await getAprovacoesDoProjeto(id)).every((l) => l.veredito === 'dispensado')).toBe(true);
  });

  it('T3: projeto SEM fila nenhuma é no-op — não inventa rótulo para a planilha', async () => {
    mockLideres.mockResolvedValue([]); // autor sem líder (D6) → nenhuma linha
    const id = await criarProjeto('Projeto sem fila');
    await abrirPreAprovacao(id);
    expect(await getAprovacoesDoProjeto(id)).toEqual([]);

    const r = await fnDispensarPreAprovacao()(id);

    expect(r.dispensou).toBe(false);
    expect(r.rotuloSheet).toBeUndefined();
    expect(r.justificativaSheet).toBeUndefined();
  });

  it('T3: fila JÁ DECIDIDA pelo líder é no-op — o sync não pode sobrescrever o parecer', async () => {
    const id = await criarProjeto('Projeto decidido antes da análise');
    await abrirPreAprovacao(id);
    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'ajuste',
      comentario: 'Refaça as horas do fiscal.',
      respostas: RESP_OK,
    });

    const r = await fnDispensarPreAprovacao()(id);

    expect(r.dispensou).toBe(false);
    expect(r.rotuloSheet).toBeUndefined();
    expect(r.justificativaSheet).toBeUndefined();
    expect((await getAprovacoesDoProjeto(id)).every((l) => l.veredito === 'ajuste')).toBe(true);
  });

  it('T3/D3: falha do banco NÃO lança — devolve `dispensou:false` e a análise segue', async () => {
    const id = await criarProjeto('Projeto com banco fora');
    await abrirPreAprovacao(id);
    const dispensar = fnDispensarPreAprovacao();

    estadoDb.falhar = true;
    try {
      await expect(dispensar(id)).resolves.toMatchObject({ dispensou: false });
    } finally {
      estadoDb.falhar = false;
    }
  });

  it('T3: falha DEPOIS de gravar NÃO vira "não fez nada" — a planilha não fica em Pré-pendente', async () => {
    const id = await criarProjeto('Projeto com a re-leitura fora');
    await abrirPreAprovacao(id);
    const dispensar = fnDispensarPreAprovacao();

    estadoDb.escreveu = false; // só as leituras DEPOIS do UPDATE devem cair
    estadoDb.falharLeituraAposEscrita = true;
    let r: ResultadoDispensa;
    try {
      r = await dispensar(id);
    } finally {
      estadoDb.falharLeituraAposEscrita = false;
      estadoDb.escreveu = false;
    }

    // O UPDATE passou: omitir as 2 colunas deixaria a planilha afirmando que o líder
    // ainda deve um parecer sobre um projeto já recusado — e nada reconcilia isso depois.
    expect(r.dispensou).toBe(true);
    expect(r.rotuloSheet).toBe('Dispensado');
    expect(r.justificativaSheet).toMatch(/sistema/i);
    expect((await getAprovacoesDoProjeto(id)).every((l) => l.veredito === 'dispensado')).toBe(true);
  });

  it('resumo do card do autor: fila dispensada vira `dispensado`, e o parecer humano vence', async () => {
    const soDispensada = await criarProjeto('Projeto dispensado');
    await abrirPreAprovacao(soDispensada);
    await fnDispensarLinhas()(soDispensada, 'Reprovado pela análise automática de critério.');
    expect((await resumoAprovacaoPorProjeto([soDispensada]))[soDispensada].veredito).toBe(
      'dispensado',
    );

    // É esta régua que alimenta o card de "Meus Projetos" e o selo de `/projeto/$id`:
    // sem ela o autor leria "Aguardando o líder" sobre um projeto já reprovado.
    const comParecer = await criarProjeto('Projeto decidido antes');
    await abrirPreAprovacao(comParecer);
    await decidirAprovacao(LUCAS.email, {
      projeto_id: comParecer,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });
    await fnDispensarLinhas()(comParecer, 'Reprovado pela análise automática de critério.');
    expect((await resumoAprovacaoPorProjeto([comParecer]))[comParecer].veredito).toBe('aprovado');
  });

  it('T7: fila TODA dispensada é reabrível SEM `forcar` (a triagem reverteu a reprovação)', async () => {
    const id = await criarProjeto('Projeto reprovado e depois revertido');
    await abrirPreAprovacao(id);
    await fnDispensarLinhas()(id, 'Reprovado pela análise automática de critério.');

    const r = await reabrirPreAprovacoes({ projetoIds: [id], dry: false });

    expect(r.reabertos.map((x) => x.projeto_id)).toContain(id);
    expect(r.ignorados.map((x) => x.projeto_id)).not.toContain(id);
    const linhas = await getAprovacoesDoProjeto(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].veredito).toBe('pendente');
  });

  it('T7: fila com PARECER HUMANO segue exigindo `forcar` (não regredir)', async () => {
    const id = await criarProjeto('Projeto com parecer humano');
    await abrirPreAprovacao(id);
    await decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });

    const r = await reabrirPreAprovacoes({ projetoIds: [id], dry: false });

    expect(r.reabertos.map((x) => x.projeto_id)).not.toContain(id);
    expect(r.ignorados.map((x) => x.projeto_id)).toContain(id);
    expect((await getAprovacoesDoProjeto(id)).every((l) => l.veredito === 'aprovado')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — os 2 rótulos do Sheets (funções PURAS).
//
// ⚠️ É o risco nº 1 do plano: sem tratamento explícito, o fall-through devolve
// "Pré-reprovado" e a planilha AFIRMA que o líder reprovou um projeto que ele nunca
// abriu — sobre uma pessoa com nome e e-mail na célula do lado.
// ─────────────────────────────────────────────────────────────────────────────

describe('rótulos do Sheets para a fila DISPENSADA (puros)', () => {
  const base = {
    aprovador_nome: LUCAS.nome,
    aprovador_email: LUCAS.email,
    comentario: null,
    decidido_por: 'sistema',
    decidido_em: '2026-08-06T12:00:00.000Z',
    resp_move_kpi: null,
    resp_sente_falta: null,
    resp_saving_coerente: null,
  };
  const dispensada = { ...base, veredito: 'dispensado' };
  const humana = (veredito: string) => ({
    ...base,
    veredito,
    decidido_por: LUCAS.email,
    comentario: veredito === 'aprovado' ? null : 'Rever as horas',
    resp_move_kpi: 'sim',
    resp_sente_falta: 'sim',
    resp_saving_coerente: 'sim',
  });

  it('estado: "Dispensado" — NUNCA "Pré-reprovado" (não foi o líder que reprovou)', () => {
    expect(rotuloAprovacaoSheet([{ veredito: 'dispensado' }])).toBe('Dispensado');
    expect(rotuloAprovacaoSheet([{ veredito: 'pendente' }, { veredito: 'dispensado' }])).toBe(
      'Dispensado',
    );
  });

  it('PRECEDÊNCIA: parecer humano vence a dispensa, em QUALQUER ordem das linhas', () => {
    for (const v of ['aprovado', 'ajuste', 'reprovado']) {
      const esperado =
        v === 'aprovado' ? 'Pré-aprovado' : v === 'ajuste' ? 'Ajuste pedido' : 'Pré-reprovado';
      expect(rotuloAprovacaoSheet([{ veredito: 'dispensado' }, { veredito: v }])).toBe(esperado);
      expect(rotuloAprovacaoSheet([{ veredito: v }, { veredito: 'dispensado' }])).toBe(esperado);
    }
  });

  it('justificativa: diz que quem recusou foi o SISTEMA e como a fila volta', () => {
    const just = justificativaAprovacaoSheet([dispensada]);

    expect(just).not.toBe('—');
    // (a) a recusa é do sistema/da análise automática…
    expect(just).toMatch(/sistema|an[áa]lise autom/i);
    // (b) …e a fila pode ser reaberta se a triagem reverter.
    expect(just).toMatch(/reabert|reabrir|reaberta/i);
    // Nada de assinatura de gente: ninguém decidiu isto.
    expect(just).not.toContain(LUCAS.nome);
    expect(just).not.toContain(LUCAS.email);
    // E não é "Aguardando" — a fila não está mais esperando ninguém.
    expect(just).not.toContain('Aguardando');
  });

  it('justificativa: com parecer humano na fila, é o do LÍDER que vale', () => {
    const just = justificativaAprovacaoSheet([dispensada, humana('aprovado')]);
    expect(just.split('\n')[0]).toContain(`Pré-aprovado por ${LUCAS.nome}`);
  });
});

// T6 — o /dashboard lê o rótulo de volta (chip com rótulo + ícone; a régua é uma só).
describe('chaveDoEstado reconhece o estado novo (puro)', () => {
  it('"Dispensado" → `dispensado` (e os estados antigos não mudam)', () => {
    expect(chaveDoEstado('Dispensado')).toBe('dispensado');
    expect(chaveDoEstado('Pré-aprovado')).toBe('aprovado');
    expect(chaveDoEstado('Pré-pendente')).toBe('pendente');
    expect(chaveDoEstado('—')).toBe('sem_parecer');
  });
});
