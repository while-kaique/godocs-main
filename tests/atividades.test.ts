// Feed de ações do painel admin (drawer "Histórico"): cursor reversível, paginação por
// keyset (pede limit+1 para saber se há próxima página) e o contrato de que registrarAtividade
// NUNCA lança — auditoria não pode desfazer a ação que já aconteceu.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertAdminActivity = vi.fn(async () => undefined);
const queryAdminActivities = vi.fn(async () => [] as unknown[]);

vi.mock('@/integrations/db/client.server', () => ({
  insertAdminActivity: (...a: unknown[]) => insertAdminActivity(...(a as [])),
  queryAdminActivities: (...a: unknown[]) => queryAdminActivities(...(a as [])),
}));

import {
  encodeCursor,
  decodeCursor,
  listarAtividades,
  registrarAtividade,
} from '@/lib/atividades.functions';

function linha(id: string, created_at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    ator_email: 'ana@gocase.com',
    acao: 'status',
    projeto_id: 'P1',
    projeto_nome: 'Projeto 1',
    detalhe: 'Aprovado',
    meta_json: null,
    created_at,
    ...extra,
  };
}

beforeEach(() => {
  insertAdminActivity.mockClear();
  queryAdminActivities.mockClear();
  queryAdminActivities.mockResolvedValue([]);
});

describe('cursor', () => {
  it('vai e volta sem perder created_at nem id', () => {
    const c = encodeCursor({ created_at: '2026-08-19 14:23:01', id: 'abc123' });
    expect(decodeCursor(c)).toEqual({ created_at: '2026-08-19 14:23:01', id: 'abc123' });
  });

  it('cursor podre ou vazio vira null (= primeira página), nunca erro', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('%%%nao-e-base64%%%')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});

describe('listarAtividades', () => {
  it('devolve proximoCursor quando há mais que o limite', async () => {
    // limit 2 → pede 3; devolvendo 3, sabe que há próxima página e corta em 2.
    queryAdminActivities.mockResolvedValue([
      linha('a', '2026-08-19 10:00:00'),
      linha('b', '2026-08-19 09:00:00'),
      linha('c', '2026-08-19 08:00:00'),
    ]);
    const r = await listarAtividades({ limit: 2 });
    expect(r.itens).toHaveLength(2);
    expect(r.itens.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.proximoCursor).not.toBeNull();
    // O cursor aponta para o ÚLTIMO item da página (b), não para o descartado (c).
    expect(decodeCursor(r.proximoCursor!)).toEqual({ created_at: '2026-08-19 09:00:00', id: 'b' });
    // Pediu limit + 1.
    expect(queryAdminActivities).toHaveBeenCalledWith(null, 3);
  });

  it('proximoCursor é null quando cabe tudo na página', async () => {
    queryAdminActivities.mockResolvedValue([linha('a', '2026-08-19 10:00:00')]);
    const r = await listarAtividades({ limit: 5 });
    expect(r.itens).toHaveLength(1);
    expect(r.proximoCursor).toBeNull();
  });

  it('desserializa meta_json em objeto', async () => {
    queryAdminActivities.mockResolvedValue([
      linha('a', '2026-08-19 10:00:00', { meta_json: '{"estrelas":10}' }),
    ]);
    const r = await listarAtividades({});
    expect(r.itens[0].meta).toEqual({ estrelas: 10 });
  });

  it('meta_json inválido não quebra a leitura (vira null)', async () => {
    queryAdminActivities.mockResolvedValue([
      linha('a', '2026-08-19 10:00:00', { meta_json: 'nao-e-json' }),
    ]);
    const r = await listarAtividades({});
    expect(r.itens[0].meta).toBeNull();
  });

  it('passa o cursor decodificado para a consulta', async () => {
    const cursor = encodeCursor({ created_at: '2026-08-19 09:00:00', id: 'b' });
    await listarAtividades({ cursor });
    expect(queryAdminActivities).toHaveBeenCalledWith(
      { created_at: '2026-08-19 09:00:00', id: 'b' },
      31, // limite padrão 30 + 1
    );
  });
});

describe('registrarAtividade', () => {
  it('serializa meta e repassa os campos', async () => {
    await registrarAtividade({
      ator_email: 'ana@gocase.com',
      acao: 'estrelas',
      projeto_id: 'P1',
      projeto_nome: 'Projeto 1',
      detalhe: '10 estrelas',
      meta: { estrelas: 10 },
    });
    expect(insertAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        ator_email: 'ana@gocase.com',
        acao: 'estrelas',
        projeto_id: 'P1',
        meta_json: '{"estrelas":10}',
      }),
    );
  });

  it('NUNCA lança — erro do banco é engolido', async () => {
    insertAdminActivity.mockRejectedValueOnce(new Error('DB fora'));
    await expect(
      registrarAtividade({ ator_email: 'ana@gocase.com', acao: 'status' }),
    ).resolves.toBeUndefined();
  });

  it('sem ator não grava nada (não há o que auditar)', async () => {
    await registrarAtividade({ ator_email: '', acao: 'status' });
    expect(insertAdminActivity).not.toHaveBeenCalled();
  });
});
