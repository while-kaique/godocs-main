// T21 — schema REAL das tabelas de memória/log dos agentes (`avaliacao_ciclos` e `agente_log`),
// aplicado num better-sqlite3 em memória via `criarDbMemoria()` (o mesmo `initSchema` de prod).
//
// O que este arquivo PRENDE:
//  - as duas tabelas existem com as COLUNAS do contrato (`PRAGMA table_info`);
//  - `agente_log` tem índices cobrindo as consultas que o log em árvore faz (pai, subárvore por
//    caminho, ciclo×projeto, projeto×data, agente×data, veredito) — checados pelas COLUNAS
//    indexadas (`index_list`/`index_info`), nunca pelo nome do índice;
//  - o `caminho` materializado + `prefixoSubarvore` devolvem EXATAMENTE a subárvore por LIKE.
//
// Por quê: sem coluna o insert lança em prod (e o log é fire-and-forget → sumiria em silêncio);
// sem índice a consulta de subárvore/feed vira full scan em tabela que cresce a cada avaliação.
import { describe, it, expect, beforeEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { criarDbMemoria } from './helpers/db-memoria';
import { prefixoSubarvore } from '@/lib/agentes-log';

let db: BetterSqlite3.Database;

beforeEach(async () => {
  db = await criarDbMemoria();
});

function colunas(tabela: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
}

/** Conjunto de listas de colunas indexadas em `tabela` (uma lista por índice, na ordem do índice). */
function indicesPorColunas(tabela: string): string[][] {
  const lista = db.prepare(`PRAGMA index_list(${tabela})`).all() as { name: string }[];
  return lista.map((ix) =>
    (db.prepare(`PRAGMA index_info(${ix.name})`).all() as { seqno: number; name: string }[])
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name),
  );
}

/** Existe índice cujas PRIMEIRAS colunas são exatamente `prefixo` (prefixo de índice serve à consulta). */
function temIndiceComPrefixo(tabela: string, prefixo: string[]): boolean {
  return indicesPorColunas(tabela).some(
    (cols) => cols.length >= prefixo.length && prefixo.every((c, i) => cols[i] === c),
  );
}

describe('tabelas existem', () => {
  it('avaliacao_ciclos e agente_log estão em sqlite_master', () => {
    const nomes = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('avaliacao_ciclos','agente_log')`).all() as {
        name: string;
      }[]
    )
      .map((r) => r.name)
      .sort();
    expect(nomes).toEqual(['agente_log', 'avaliacao_ciclos']);
  });
});

describe('colunas do contrato', () => {
  it('agente_log tem todas as colunas do nó', () => {
    const esperadas = [
      'id',
      'ciclo_id',
      'pai_id',
      'caminho',
      'profundidade',
      'projeto_id',
      'agente',
      'tipo',
      'rodada',
      'entrada',
      'saida',
      'tools_chamadas',
      'confianca',
      'veredito',
      'modelo',
      'tokens_in',
      'tokens_out',
      'custo_usd',
      'duracao_ms',
      'erro',
      'created_at',
    ];
    const reais = colunas('agente_log');
    for (const c of esperadas) expect(reais, `coluna ausente: ${c}`).toContain(c);
  });

  it('avaliacao_ciclos tem as colunas do ciclo', () => {
    const esperadas = [
      'id',
      'gatilho',
      'status',
      'amostra',
      'modelos',
      'variante',
      'metricas',
      'relatorio_path',
      'created_at',
      'finalizado_em',
    ];
    const reais = colunas('avaliacao_ciclos');
    for (const c of esperadas) expect(reais, `coluna ausente: ${c}`).toContain(c);
  });
});

describe('índices de agente_log (pelas colunas, não pelo nome)', () => {
  it('pai_id', () => {
    expect(temIndiceComPrefixo('agente_log', ['pai_id'])).toBe(true);
  });

  it('caminho (subárvore por LIKE prefixo)', () => {
    expect(temIndiceComPrefixo('agente_log', ['caminho'])).toBe(true);
  });

  it('(ciclo_id, projeto_id)', () => {
    expect(temIndiceComPrefixo('agente_log', ['ciclo_id', 'projeto_id'])).toBe(true);
  });

  it('(projeto_id, created_at)', () => {
    expect(temIndiceComPrefixo('agente_log', ['projeto_id', 'created_at'])).toBe(true);
  });

  it('(agente, created_at)', () => {
    expect(temIndiceComPrefixo('agente_log', ['agente', 'created_at'])).toBe(true);
  });

  it('veredito', () => {
    expect(temIndiceComPrefixo('agente_log', ['veredito'])).toBe(true);
  });
});

describe('subárvore por caminho materializado', () => {
  function inserir(id: string, pai_id: string | null, caminho: string, profundidade: number, agente: string, tipo: string) {
    db.prepare(
      `INSERT INTO agente_log (id, ciclo_id, pai_id, caminho, profundidade, projeto_id, agente, tipo)
       VALUES (?, 'C1', ?, ?, ?, 'P1', ?, ?)`,
    ).run(id, pai_id, caminho, profundidade, agente, tipo);
  }

  it('LIKE prefixoSubarvore("C1/orq:a") devolve exatamente o filho e o neto, nunca a raiz', () => {
    inserir('a', null, 'C1/orq:a', 0, 'orq', 'orquestrador');
    inserir('b', 'a', 'C1/orq:a/cerebroA:b', 1, 'cerebroA', 'cerebro');
    inserir('c', 'b', 'C1/orq:a/cerebroA:b/tool:c', 2, 'tool', 'tool');
    // Outra raiz do mesmo ciclo, fora da subárvore — não pode entrar.
    inserir('z', null, 'C1/orq:z', 0, 'orq', 'orquestrador');

    const ids = (
      db.prepare(`SELECT id FROM agente_log WHERE caminho LIKE ? ORDER BY caminho`).all(prefixoSubarvore('C1/orq:a')) as {
        id: string;
      }[]
    ).map((r) => r.id);
    expect(ids).toEqual(['b', 'c']);
  });

  it('a raiz aceita pai_id NULL e um nó com created_at default não fica sem data', () => {
    inserir('a', null, 'C1/orq:a', 0, 'orq', 'orquestrador');
    const row = db.prepare(`SELECT pai_id, created_at FROM agente_log WHERE id = 'a'`).get() as {
      pai_id: string | null;
      created_at: string | null;
    };
    expect(row.pai_id).toBeNull();
    expect(row.created_at).toBeTruthy();
  });
});
