// FAQ — resolução de slug, seed idempotente (+ backfill do corpo), arquivamento, ordem e o
// parser do markdown leve. Ver spec-docs/SPEC_FAQ.md (D1, D2, D6, D13).
import { describe, it, expect, beforeAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

import { setDb, getFaqCategoriasRows, updateFaqCategoria } from '@/integrations/db/client.server';
import {
  FAQ_SEED,
  chaveSlug,
  resolverCategoria,
  slugDeTitulo,
  type FaqCategoria,
} from '@/lib/faq/conteudo';
import { parseFaqMarkdown, partirNegrito, titulosDoDocumento } from '@/lib/faq/markdown';
import {
  arquivarFaq,
  listarFaq,
  reordenarFaq,
  salvarCategoria,
  semearFaq,
} from '@/lib/faq.functions';

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

beforeAll(async () => {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  await setDb(asyncAdapter(db));
});

const ADMIN = 'admin@gocase.com';

/* ── 1. slug: o link colado à mão tem de abrir a mesma página ── */

describe('chaveSlug / resolução de rota', () => {
  const arvore: FaqCategoria[] = [
    {
      id: 'c1',
      slug: 'tipos_projetos',
      titulo: 'Tipos de Projeto',
      resumo: null,
      corpo: '## Projeto especial\n\ntexto',
      ordem: 0,
      arquivado: false,
    },
  ];

  it('trata -, _, espaço, acento e caixa como o mesmo slug', () => {
    for (const variante of [
      'tipos_projetos',
      'tipos-projetos',
      'Tipos_Projetos',
      'tipos projetos',
      'TIPOS-PROJETOS',
    ]) {
      expect(resolverCategoria(arvore, variante)?.id).toBe('c1');
    }
  });

  it('slug inexistente devolve undefined (a tela mostra "não encontrado", não quebra)', () => {
    expect(resolverCategoria(arvore, 'inventado')).toBeUndefined();
    expect(resolverCategoria(arvore, undefined)).toBeUndefined();
  });

  it('slugDeTitulo normaliza título digitado no painel', () => {
    expect(slugDeTitulo('Ganho real × projetado')).toBe('ganho_real_projetado');
    expect(chaveSlug('  Ação/Reação  ')).toBe('acao_reacao');
  });
});

/* ── 2. markdown leve: allowlist fechada, e HTML nunca é interpretado (D13) ── */

describe('parseFaqMarkdown', () => {
  it('reconhece títulos, parágrafos, listas e destaque', () => {
    const blocos = parseFaqMarkdown(
      [
        '## Saving operacional',
        '',
        'Primeira linha',
        'continua o mesmo parágrafo.',
        '',
        '- um',
        '- dois',
        '',
        '1. primeiro',
        '2. segundo',
        '',
        '> um aviso',
        '',
        '### Detalhe',
      ].join('\n'),
    );

    expect(blocos).toEqual([
      { tipo: 'titulo', nivel: 2, texto: 'Saving operacional' },
      { tipo: 'paragrafo', texto: 'Primeira linha continua o mesmo parágrafo.' },
      { tipo: 'lista', ordenada: false, itens: ['um', 'dois'] },
      { tipo: 'lista', ordenada: true, itens: ['primeiro', 'segundo'] },
      { tipo: 'destaque', texto: 'um aviso' },
      { tipo: 'titulo', nivel: 3, texto: 'Detalhe' },
    ]);
  });

  it('HTML digitado no painel vira PARÁGRAFO literal — nunca marcação', () => {
    const blocos = parseFaqMarkdown('<script>alert(1)</script>\n\n<b>negrito?</b>');
    expect(blocos).toEqual([
      { tipo: 'paragrafo', texto: '<script>alert(1)</script>' },
      { tipo: 'paragrafo', texto: '<b>negrito?</b>' },
    ]);
  });

  it('negrito parte em pedaços e asterisco solto fica literal', () => {
    expect(partirNegrito('vai **assim** e pronto')).toEqual([
      { texto: 'vai ', forte: false },
      { texto: 'assim', forte: true },
      { texto: ' e pronto', forte: false },
    ]);
    expect(partirNegrito('2 ** 3 mesmo')).toEqual([{ texto: '2 ** 3 mesmo', forte: false }]);
  });

  it('texto vazio não vira bloco (a tela mostra "ainda não tem texto")', () => {
    expect(parseFaqMarkdown('')).toEqual([]);
    expect(parseFaqMarkdown(null)).toEqual([]);
    expect(parseFaqMarkdown('   \n  ')).toEqual([]);
  });

  it('titulosDoDocumento devolve só as seções de 1º nível, sem marcação', () => {
    const md = '## **Um**\n\ntexto\n\n### Sub\n\n## Dois\n\ntexto';
    expect(titulosDoDocumento(md)).toEqual(['Um', 'Dois']);
  });
});

/* ── 3. o seed nunca desfaz o que o admin escreveu (D1) ── */

describe('semearFaq — idempotente por slug', () => {
  it('semeia o FAQ_SEED na 1ª vez e NÃO duplica na 2ª', async () => {
    const primeira = await semearFaq();
    expect(primeira.categorias).toBe(FAQ_SEED.length);

    const segunda = await semearFaq();
    expect(segunda).toEqual({ categorias: 0, backfill: 0 });

    const categorias = await getFaqCategoriasRows();
    expect(categorias.filter((c) => chaveSlug(c.slug) === 'tipos_projetos')).toHaveLength(1);
  });

  it('o link do formulário aponta para um assunto que EXISTE e tem texto', () => {
    const tipos = FAQ_SEED.find((c) => c.slug === 'tipos_projetos');
    expect(tipos, 'assunto tipos_projetos do link /faq/tipos_projetos').toBeTruthy();
    expect(titulosDoDocumento(tipos!.corpo).length).toBeGreaterThan(1);
  });

  it('BACKFILL preenche corpo VAZIO e nunca sobrescreve o texto do admin (D13)', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const tipos = resolverCategoria(categorias, 'tipos_projetos')!;

    // Simula o banco anterior à coluna `corpo`: assunto existe, documento vazio.
    await updateFaqCategoria(tipos.id, { titulo: tipos.titulo, resumo: tipos.resumo, corpo: null });
    const backfill = await semearFaq();
    expect(backfill.backfill).toBe(1);
    const preenchido = resolverCategoria(
      (await listarFaq({ admin: true })).categorias,
      'tipos_projetos',
    )!;
    expect(preenchido.corpo).toContain('## Saving operacional');

    // Agora o admin reescreve: nenhum seed posterior pode passar por cima.
    await salvarCategoria(ADMIN, {
      id: tipos.id,
      titulo: 'Tipos de Projeto',
      resumo: 'resumo do admin',
      corpo: '## Só o que o admin escreveu',
    });
    await semearFaq();
    const depois = resolverCategoria(
      (await listarFaq({ admin: true })).categorias,
      'tipos_projetos',
    )!;
    expect(depois.corpo).toBe('## Só o que o admin escreveu');
    expect(depois.resumo).toBe('resumo do admin');
  });
});

/* ── 4. arquivar é o "remover" (D6) ── */

describe('arquivar / restaurar', () => {
  it('assunto arquivado sai da leitura pública, continua para o admin e o seed não o ressuscita', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const acomp = resolverCategoria(categorias, 'acompanhamento')!;

    await arquivarFaq(ADMIN, { id: acomp.id, arquivar: true });

    expect(resolverCategoria((await listarFaq()).categorias, 'acompanhamento')).toBeUndefined();
    expect(
      resolverCategoria((await listarFaq({ admin: true })).categorias, 'acompanhamento')?.arquivado,
    ).toBe(true);

    // ⚠️ Seed NÃO ressuscita assunto arquivado (senão o admin arquivaria para sempre e
    // nada mudaria no próximo request).
    expect(await semearFaq()).toEqual({ categorias: 0, backfill: 0 });
    expect(resolverCategoria((await listarFaq()).categorias, 'acompanhamento')).toBeUndefined();

    await arquivarFaq(ADMIN, { id: acomp.id, arquivar: false });
    expect(resolverCategoria((await listarFaq()).categorias, 'acompanhamento')).toBeTruthy();
  });

  it('arquivar id inexistente devolve 404', async () => {
    await expect(arquivarFaq(ADMIN, { id: 'nao-existe', arquivar: true })).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* ── 5. slug é imutável; criação deriva e desambigua ── */

describe('salvarCategoria', () => {
  it('editar NÃO muda o slug (o link já circula fora do app)', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const tipos = resolverCategoria(categorias, 'tipos_projetos')!;

    const r = await salvarCategoria(ADMIN, {
      id: tipos.id,
      titulo: 'Tipos de projeto e enquadramento',
      resumo: 'outro resumo',
      corpo: tipos.corpo,
      slug: 'enquadramento', // tentativa explícita de trocar o endereço
    });

    expect(r.slug).toBe('tipos_projetos');
    const depois = await listarFaq({ admin: true });
    expect(resolverCategoria(depois.categorias, 'tipos_projetos')?.titulo).toBe(
      'Tipos de projeto e enquadramento',
    );
    expect(resolverCategoria(depois.categorias, 'enquadramento')).toBeUndefined();
  });

  it('cria assunto derivando o slug do título e desambigua repetidos', async () => {
    const a = await salvarCategoria(ADMIN, { titulo: 'Prazos e SLA', resumo: null, corpo: null });
    expect(a.slug).toBe('prazos_e_sla');
    const b = await salvarCategoria(ADMIN, { titulo: 'Prazos e SLA', resumo: null, corpo: null });
    expect(b.slug).toBe('prazos_e_sla_2');
  });

  it('recusa título vazio e texto acima do limite', async () => {
    await expect(
      salvarCategoria(ADMIN, { titulo: '   ', resumo: null, corpo: null }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      salvarCategoria(ADMIN, { titulo: 'X', resumo: null, corpo: 'a'.repeat(30001) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('editar id inexistente devolve 404', async () => {
    await expect(
      salvarCategoria(ADMIN, { id: 'nao-existe', titulo: 'X', resumo: null, corpo: null }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* ── 6. ordem manual (D7) ── */

describe('reordenarFaq', () => {
  it('troca com o vizinho e reescreve a sequência (empate de ordem não trava)', async () => {
    const antes = (await listarFaq({ admin: true })).categorias.map((c) => c.slug);
    expect(antes.length).toBeGreaterThan(1);

    const segundo = (await listarFaq({ admin: true })).categorias[1];
    await reordenarFaq(ADMIN, { id: segundo.id, direcao: 'cima' });

    const depois = (await listarFaq({ admin: true })).categorias.map((c) => c.slug);
    expect(depois[0]).toBe(antes[1]);
    expect(depois[1]).toBe(antes[0]);
  });

  it('primeiro assunto subindo é no-op (não estoura, não reordena nada)', async () => {
    const primeiro = (await listarFaq({ admin: true })).categorias[0];
    const r = await reordenarFaq(ADMIN, { id: primeiro.id, direcao: 'cima' });
    expect(r.movido).toBe(false);
  });
});

/* ── 7. o conteúdo semeado ── */

describe('conteúdo semeado', () => {
  it('todo assunto tem título, resumo e documento com pelo menos 2 seções', () => {
    for (const categoria of FAQ_SEED) {
      expect(categoria.titulo.trim()).not.toBe('');
      expect((categoria.resumo ?? '').trim(), categoria.slug).not.toBe('');
      expect(titulosDoDocumento(categoria.corpo).length, categoria.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it('nenhum documento do seed traz tag HTML', () => {
    for (const categoria of FAQ_SEED) {
      expect(categoria.corpo ?? '', categoria.slug).not.toMatch(/<[a-z/][^>]*>/i);
    }
  });

  it('o assunto "Tipos de Projeto" cobre os 3 enquadramentos e a régua do ganho medido', () => {
    const tipos = FAQ_SEED.find((c) => c.slug === 'tipos_projetos')!;
    const secoes = titulosDoDocumento(tipos.corpo);
    expect(secoes).toContain('Saving operacional');
    expect(secoes).toContain('Receita incremental');
    expect(secoes).toContain('Projeto especial');
    expect(tipos.corpo).toMatch(/real e medido/i);
  });

  it('o texto ficou OBJETIVO: nenhum assunto passa de 4.500 caracteres', () => {
    // A 1ª versão do FAQ tinha ~9.000 caracteres só em "Tipos de Projeto", em 3 páginas.
    // O limite existe para o documento continuar escaneável — se um assunto crescer além
    // disso, ele quer ser DOIS assuntos, não um texto mais longo.
    for (const categoria of FAQ_SEED) {
      expect((categoria.corpo ?? '').length, categoria.slug).toBeLessThan(4500);
    }
  });
});
