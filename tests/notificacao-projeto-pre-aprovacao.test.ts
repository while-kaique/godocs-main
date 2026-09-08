// Aviso ao grupo do Chat disparado PELA pré-aprovação do líder.
//
// A mensagem não existe mais na submissão (o projeto ainda está esperando parecer); ela
// nasce quando o líder pré-aprova. Como o turno da submissão já acabou, o payload é
// REMONTADO do banco (projeto + documentação, para saving/receita).
//
// Invariantes: nunca lança (um aviso não pode derrubar a decisão do líder), projeto de
// teste `[E2E-…]` segue mudo e projeto inexistente não vira mensagem nem exceção.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

// `ehProjetoTesteE2E` e `buildSubmitMessage` ficam REAIS (é o texto que queremos ver);
// só o envio é stub, para não pingar o espaço do Chat.
vi.mock('@/lib/google/chat', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/chat')>();
  return { ...actual, sendChatNotification: vi.fn().mockResolvedValue(true) };
});
// A planilha não é chamada aqui; o mock existe só para nenhuma rede escapar.
vi.mock('@/lib/google/sheets', () => ({
  appendRow: vi.fn(async () => undefined),
  updateRowByProjectId: vi.fn(async () => true),
  readAllRows: vi.fn(async () => []),
}));

import { setDb, insertProjetoRaw, upsertDocumentacao } from '@/integrations/db/client.server';
import { sendChatNotification } from '@/lib/google/chat';
import { notificarChatPreAprovacao } from '@/lib/notificacao-projeto.functions';

const mockChat = sendChatNotification as unknown as ReturnType<typeof vi.fn>;

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

const PARECER = { por: 'Lucas Gonçalves Queiroz', em: '11/08/2026 14:32' };

let seq = 0;
async function criarProjeto(nome = 'Automação de Faturamento'): Promise<string> {
  const id = `np-${++seq}`;
  await insertProjetoRaw({
    id,
    nome,
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: 'luis.albuquerque@gocase.com',
    ferramenta: 'n8n',
    escopo: 'interno',
    descricao_breve: 'Automatiza o faturamento mensal.',
    area: 'RPA',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
    tipos_projeto: JSON.stringify(['saving']),
    saving_horas: 120,
    saving_reais: 5000,
    tipo_saving: 'mensal',
  });
  await upsertDocumentacao(id, {
    saving: { economia_horas_mes: 120, economia_reais_mes: 5000, tipo_saving: 'mensal' },
    receita: null,
  });
  return id;
}

describe('notificarChatPreAprovacao', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue(true);
  });

  it('envia UMA mensagem com os dados do projeto e devolve true', async () => {
    const id = await criarProjeto();

    const enviou = await notificarChatPreAprovacao(id, PARECER);

    expect(enviou).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
    // ⚠️ O payload é um CARD (cardsV2), não string — `String(obj)` daria
    // "[object Object]" e o teste passaria a não medir nada.
    const texto = JSON.stringify(mockChat.mock.calls[0][0]);
    expect(texto).toContain('Automação de Faturamento');
    expect(texto).toContain('Luis Albuquerque');
    // Remontado do banco: o saving das COLUNAS da v1 entra na mensagem.
    expect(texto).toMatch(/120/);
    expect(texto).toContain('5.000,00');
  });

  it('a mensagem assina quem pré-aprovou e quando', async () => {
    const id = await criarProjeto();

    await notificarChatPreAprovacao(id, PARECER);

    const texto = JSON.stringify(mockChat.mock.calls[0][0]);
    expect(texto).toMatch(/pré-aprova/i);
    expect(texto).toContain(PARECER.por);
    expect(texto).toContain(PARECER.em);
  });

  // ⚠️ REGRESSÃO do defeito de 08/09/2026: o card anunciava **R$ 0,00 e 0 horas** em todo
  // projeto da v2, porque esta função só passava as colunas da v1 (`saving_horas`/
  // `saving_reais`/`tipo_saving`), que o formulário determinístico da v2 nunca escreve.
  // O ganho agora vem de `resumirGanho`, que decide a geração pelo `ganho_categorias`.
  it('projeto da V2 anuncia o impacto declarado, nunca R$ 0,00', async () => {
    const id = `v2-${++seq}`;
    await insertProjetoRaw({
      id,
      nome: 'Automação v2',
      responsavel_nome: 'Luis Albuquerque',
      responsavel_email: 'luis.albuquerque@gocase.com',
      ferramenta: 'n8n',
      escopo: 'interno',
      descricao_breve: 'Declarou o ganho pelo formulário determinístico.',
      area: 'RPA',
      status: 'em_validacao',
      submitted_at: new Date().toISOString(),
      categoria_projeto: 'automacao',
      // Nada de `saving_horas`/`saving_reais`/`tipos_projeto`: é justamente o que a v2
      // NÃO grava, e o que fazia o card mentir.
      ganho_categorias: JSON.stringify(['saving_efetivado']),
      saving_efetivado_valor_antes: 8000,
      saving_efetivado_valor_agora: 2000,
      saving_efetivado_frequencia: 'mensal',
      saving_efetivado_evidencia: 'Contrato encerrado, fatura zerada em 08/2026.',
      impacto_bruto: 6000,
      impacto_liquido: 6000,
      impacto_liquido_mensal: 6000,
    });

    expect(await notificarChatPreAprovacao(id, PARECER)).toBe(true);

    const texto = JSON.stringify(mockChat.mock.calls[0][0]);
    expect(texto).toContain('6.000,00');
    expect(texto).toContain('Saving efetivado');
    expect(texto).not.toContain('R$ 0,00');
    // A linha "Tipos" saía "—" na v2; hoje é o eixo TIPO da categorização.
    expect(texto).toContain('Automação');
  });

  it('projeto `[E2E-…]` NÃO envia nada e devolve false', async () => {
    const id = await criarProjeto('[E2E-abc123] Automação de teste');

    const enviou = await notificarChatPreAprovacao(id, PARECER);

    expect(enviou).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('projeto inexistente: devolve false, sem enviar e sem lançar', async () => {
    const enviou = await notificarChatPreAprovacao('nao-existe-999', PARECER);

    expect(enviou).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('falha no envio não vira exceção: devolve false', async () => {
    const id = await criarProjeto();
    mockChat.mockRejectedValueOnce(new Error('webhook fora do ar'));

    await expect(notificarChatPreAprovacao(id, PARECER)).resolves.toBe(false);
  });
});
