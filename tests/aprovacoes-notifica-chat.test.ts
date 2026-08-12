// A decisão do líder é o GATILHO do aviso no grupo do Chat.
//
// Pré-aprovou → o grupo recebe a mensagem do projeto (é o único momento em que ela sai,
// para projetos que entram em fila). Pediu ajuste ou reprovou → silêncio: o projeto ainda
// não está liberado e avisar seria ruído para a triagem.
//
// ⚠️ O aviso é acessório: ele nunca pode derrubar a decisão do líder (mesma régua do D3).
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
// O envio em si tem teste próprio (tests/notificacao-projeto-pre-aprovacao.test.ts);
// aqui interessa só QUEM dispara e QUANDO.
vi.mock('@/lib/notificacao-projeto.functions', () => ({
  notificarChatPreAprovacao: vi.fn(async () => true),
}));

import { ehLideranca, getLideresDe, getLideradosDe } from '@/lib/areas/teamguide.server';
import {
  setDb,
  insertProjetoRaw,
  getAprovacoesDoProjeto,
  decidirAprovacoesDoProjeto,
} from '@/integrations/db/client.server';
import { abrirPreAprovacao, decidirAprovacao } from '@/lib/aprovacoes.functions';
import { notificarChatPreAprovacao } from '@/lib/notificacao-projeto.functions';
// ⚠️ Namespace import de propósito: `deveNotificarDecisao` ainda não existe. Com
// `import { ... }` o arquivo INTEIRO morre no carregamento e leva junto os casos que
// não têm nada a ver com o predicado.
import * as notificacaoChat from '@/lib/notificacao-chat';

const mockLideranca = ehLideranca as unknown as ReturnType<typeof vi.fn>;
const mockLideres = getLideresDe as unknown as ReturnType<typeof vi.fn>;
const mockLiderados = getLideradosDe as unknown as ReturnType<typeof vi.fn>;
const mockNotifica = notificarChatPreAprovacao as unknown as ReturnType<typeof vi.fn>;

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

/**
 * Mesmo adaptador, com LATÊNCIA real (um tick de macrotarefa antes de cada operação).
 * Em produção o `env.DB` do Godeploy é uma chamada de rede — o intervalo entre o
 * `SELECT` do gate e o `UPDATE` existe de verdade. Com o adaptador síncrono o teste
 * dependeria da sorte do agendamento de microtarefas para reproduzir a corrida.
 */
function asyncAdapterComLatencia(db: BetterSqlite3.Database): GoDeployDB {
  const base = asyncAdapter(db);
  return {
    async query(sql: string, params: unknown[] = []) {
      await new Promise((r) => setTimeout(r, 1));
      return base.query(sql, params);
    },
    async exec(sql: string, params: unknown[] = []) {
      await new Promise((r) => setTimeout(r, 1));
      return base.exec(sql, params);
    },
  };
}

/** Deixa qualquer aviso agendado em background/microtarefa aterrissar antes do assert. */
async function assentar(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

// UMA instância de banco para o arquivo inteiro: `setDb` só roda o `initSchema` na
// PRIMEIRA chamada (flag de módulo), então cada bloco troca o ADAPTADOR por cima do
// mesmo SQLite. Os ids dos projetos são únicos (`seq`), não há colisão entre blocos.
const dbBruto = new BetterSqlite3(':memory:');
dbBruto.pragma('foreign_keys = ON');

const RESP_OK = { move_kpi: 'sim', sente_falta: 'sim', saving_coerente: 'sim' } as const;
const LUCAS = { nome: 'Lucas Gonçalves Queiroz', email: 'lucas.queiroz@gocase.com' };
const MARIA = { nome: 'Maria Fernanda Rocha', email: 'maria.rocha@gocase.com' };

let seq = 0;
async function criarProjetoEmFila(): Promise<string> {
  const id = `nc-${++seq}`;
  await insertProjetoRaw({
    id,
    nome: `Projeto ${id}`,
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: 'luis.albuquerque@gocase.com',
    ferramenta: 'n8n',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
    tipos_projeto: JSON.stringify(['saving']),
    area: 'RPA',
  });
  await abrirPreAprovacao(id);
  return id;
}

describe('decidirAprovacao — gatilho do aviso no grupo do Chat', () => {
  beforeAll(async () => {
    await setDb(asyncAdapter(dbBruto));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([LUCAS]);
    mockLiderados.mockResolvedValue([]);
    mockNotifica.mockResolvedValue(true);
  });

  it('PRÉ-APROVADO dispara o aviso, com o projeto e a assinatura de quem decidiu', async () => {
    const id = await criarProjetoEmFila();

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });

    expect(mockNotifica).toHaveBeenCalledTimes(1);
    const [projetoId, parecer] = mockNotifica.mock.calls[0] as [string, { por: string; em: string }];
    expect(projetoId).toBe(id);
    expect(String(parecer.por)).toMatch(/lucas/i);
    expect(String(parecer.em ?? '').trim().length).toBeGreaterThan(0);
  });

  it('AJUSTE não avisa ninguém', async () => {
    const id = await criarProjetoEmFila();

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'ajuste',
      comentario: 'Reveja a frequência das horas.',
      respostas: RESP_OK,
    });

    expect(mockNotifica).not.toHaveBeenCalled();
  });

  it('REPROVADO não avisa ninguém', async () => {
    const id = await criarProjetoEmFila();

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'reprovado',
      comentario: 'Não é projeto: rotina pontual.',
      respostas: RESP_OK,
    });

    expect(mockNotifica).not.toHaveBeenCalled();
  });

  it('falha do aviso NÃO derruba a decisão do líder', async () => {
    const id = await criarProjetoEmFila();
    mockNotifica.mockRejectedValueOnce(new Error('Chat fora do ar'));

    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: RESP_OK,
      }),
    ).resolves.toMatchObject({ ok: true, veredito: 'aprovado' });
  });

  it('aviso que LANÇA de forma síncrona também não derruba a decisão', async () => {
    const id = await criarProjetoEmFila();
    mockNotifica.mockImplementationOnce(() => {
      throw new Error('explodiu antes da promise');
    });

    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: RESP_OK,
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// UMA mensagem por decisão, mesmo sob corrida — e "não sei" ≠ "zero".
// ---------------------------------------------------------------------------

type PredicadoDecisao = (linhasGravadas: number | null) => boolean;
const deveNotificarDecisao = (
  notificacaoChat as unknown as { deveNotificarDecisao?: PredicadoDecisao }
).deveNotificarDecisao;

describe('deveNotificarDecisao — o predicado puro do "quantas linhas escrevi"', () => {
  it('está exportado por src/lib/notificacao-chat.ts (a fonte única do QUANDO)', () => {
    expect(typeof deveNotificarDecisao).toBe('function');
  });

  it('escreveu 1 linha → NOTIFICA (esta requisição é a que ganhou a corrida)', () => {
    expect(deveNotificarDecisao?.(1)).toBe(true);
  });

  it('escreveu VÁRIAS linhas → NOTIFICA (D4: um clique resolve todas as linhas do projeto)', () => {
    expect(deveNotificarDecisao?.(3)).toBe(true);
  });

  it('escreveu 0 linhas → CALA (outra requisição já decidiu; a mensagem já saiu)', () => {
    expect(deveNotificarDecisao?.(0)).toBe(false);
  });

  it('o adaptador NÃO reportou (null) → NOTIFICA: "não sei" nunca vira silêncio', () => {
    expect(deveNotificarDecisao?.(null)).toBe(true);
  });
});

describe('decidirAprovacao — corrida: o grupo recebe UMA mensagem, não duas', () => {
  beforeAll(async () => {
    await setDb(asyncAdapterComLatencia(dbBruto));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([LUCAS]);
    mockLiderados.mockResolvedValue([]);
    mockNotifica.mockResolvedValue(true);
  });

  it('DOIS líderes da mesma fila (D4) pré-aprovando em paralelo → 1 aviso', async () => {
    mockLideres.mockResolvedValue([LUCAS, MARIA]);
    const id = await criarProjetoEmFila();
    // A fila precisa mesmo ter as 2 linhas, senão o teste da corrida não corre nada.
    expect((await getAprovacoesDoProjeto(id)).length).toBe(2);

    const decidir = (email: string) =>
      decidirAprovacao(email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });

    const desfechos = await Promise.allSettled([decidir(LUCAS.email), decidir(MARIA.email)]);
    await assentar();

    // Pelo menos um líder tem de ter conseguido decidir (a corrida não pode matar as duas).
    expect(desfechos.some((d) => d.status === 'fulfilled')).toBe(true);
    expect(mockNotifica).toHaveBeenCalledTimes(1);
    expect(mockNotifica.mock.calls[0][0]).toBe(id);
  });

  it('DUPLO CLIQUE do mesmo líder (mesma decisão 2×, em paralelo) → 1 aviso', async () => {
    const id = await criarProjetoEmFila();

    const decidir = () =>
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK });

    const desfechos = await Promise.allSettled([decidir(), decidir()]);
    await assentar();

    expect(desfechos.some((d) => d.status === 'fulfilled')).toBe(true);
    expect(mockNotifica).toHaveBeenCalledTimes(1);
  });

  it('TRÊS retries do cliente sobre a mesma fila ainda rendem 1 aviso', async () => {
    mockLideres.mockResolvedValue([LUCAS, MARIA]);
    const id = await criarProjetoEmFila();

    await Promise.allSettled([
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK }),
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK }),
      decidirAprovacao(MARIA.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK }),
    ]);
    await assentar();

    expect(mockNotifica).toHaveBeenCalledTimes(1);
  });

  it('decisão SEQUENCIAL depois de já decidido não repete o aviso', async () => {
    const id = await criarProjetoEmFila();

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });
    await assentar();
    expect(mockNotifica).toHaveBeenCalledTimes(1);

    // O líder abre a aba velha e clica de novo: erre para 403 ou grave 0 linhas —
    // o que NÃO pode é o grupo receber a mensagem duas vezes.
    await Promise.allSettled([
      decidirAprovacao(LUCAS.email, { projeto_id: id, veredito: 'aprovado', respostas: RESP_OK }),
    ]);
    await assentar();

    expect(mockNotifica).toHaveBeenCalledTimes(1);
  });

  it('projetos DIFERENTES em paralelo continuam avisando cada um (1 por projeto)', async () => {
    const a = await criarProjetoEmFila();
    const b = await criarProjetoEmFila();

    await Promise.all([
      decidirAprovacao(LUCAS.email, { projeto_id: a, veredito: 'aprovado', respostas: RESP_OK }),
      decidirAprovacao(LUCAS.email, { projeto_id: b, veredito: 'aprovado', respostas: RESP_OK }),
    ]);
    await assentar();

    expect(mockNotifica).toHaveBeenCalledTimes(2);
    const avisados = mockNotifica.mock.calls.map((c) => c[0]).sort();
    expect(avisados).toEqual([a, b].sort());
  });
});

// ⚠️ O caso mais importante: NENHUM caminho de produção lê `rowsWritten` hoje, então o
// que o `env.DB` do Godeploy devolve é DESCONHECIDO. Diante do desconhecido, avisa —
// trocar 2 mensagens por NENHUMA é estritamente pior e invisível.
describe('adaptador que NÃO reporta quantas linhas escreveu → notifica assim mesmo', () => {
  const variantes: Array<{ nome: string; retorno: unknown }> = [
    { nome: 'exec devolve undefined', retorno: undefined },
    { nome: 'exec devolve objeto sem rowsWritten', retorno: {} },
    { nome: 'exec devolve rowsWritten não-numérico', retorno: { rowsWritten: 'ok' } },
    { nome: 'exec devolve rowsWritten NaN', retorno: { rowsWritten: Number.NaN } },
  ];

  for (const { nome, retorno } of variantes) {
    it(`${nome} → o grupo é avisado (e a decisão fica gravada)`, async () => {
      const base = asyncAdapter(dbBruto);
      const cego: GoDeployDB = {
        query: (sql: string, params: unknown[] = []) => base.query(sql, params),
        exec: (async (sql: string, params: unknown[] = []) => {
          await base.exec(sql, params); // a escrita ACONTECE; só o relatório é cego
          return retorno;
        }) as GoDeployDB['exec'],
      };
      await setDb(cego);

      vi.clearAllMocks();
      mockLideranca.mockResolvedValue(false);
      mockLideres.mockResolvedValue([LUCAS]);
      mockLiderados.mockResolvedValue([]);
      mockNotifica.mockResolvedValue(true);

      const id = await criarProjetoEmFila();
      await decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: RESP_OK,
      });
      await assentar();

      expect(mockNotifica).toHaveBeenCalledTimes(1);
      const linhas = await getAprovacoesDoProjeto(id);
      expect(linhas.every((l) => l.veredito === 'aprovado')).toBe(true);
    });
  }
});

describe('decidirAprovacoesDoProjeto — o UPDATE conta quantas linhas escreveu', () => {
  it('devolve o número de linhas do projeto na 1ª gravação e 0 na 2ª (o ponto de serialização)', async () => {
    await setDb(asyncAdapter(dbBruto));
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([LUCAS, MARIA]);
    mockLiderados.mockResolvedValue([]);

    const id = await criarProjetoEmFila();

    const primeira = await decidirAprovacoesDoProjeto(id, 'aprovado', null, LUCAS.email, RESP_OK);
    const segunda = await decidirAprovacoesDoProjeto(id, 'aprovado', null, MARIA.email, RESP_OK);

    expect(primeira).toBe(2); // D4: um parecer resolve as 2 linhas do projeto
    expect(segunda).toBe(0); // não há mais 'pendente' — quem chega depois não escreve nada
  });

  it('adaptador que não reporta → devolve null (e null NÃO é zero)', async () => {
    const base = asyncAdapter(dbBruto);
    await setDb({
      query: (sql: string, params: unknown[] = []) => base.query(sql, params),
      // `ExecResult` promete `{ rowsWritten: number }`, e é EXATAMENTE essa promessa que
      // está sob teste: o adaptador real pode não cumpri-la. O cast passa por `unknown`
      // porque o TS (com razão) recusa a conversão direta — é o ponto do caso.
      exec: (async (sql: string, params: unknown[] = []) => {
        await base.exec(sql, params);
        return undefined;
      }) as unknown as GoDeployDB['exec'],
    });
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([LUCAS]);
    mockLiderados.mockResolvedValue([]);

    const id = await criarProjetoEmFila();
    const escritas = await decidirAprovacoesDoProjeto(id, 'aprovado', null, LUCAS.email, RESP_OK);

    expect(escritas).toBeNull();
  });
});
