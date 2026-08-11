// FAQ — resolução de slug, seed idempotente, arquivamento e as invariantes de escrita.
// Ver spec-docs/SPEC_FAQ.md (D1, D2, D6).
import { describe, it, expect, beforeAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

import { setDb, getFaqItensRows, getFaqCategoriasRows } from '@/integrations/db/client.server';
import {
  FAQ_SEED,
  chaveSlug,
  resolverCategoria,
  resolverItem,
  slugDeTitulo,
  type FaqCategoria,
} from '@/lib/faq/conteudo';
import {
  arquivarFaq,
  listarFaq,
  reordenarFaq,
  salvarCategoria,
  salvarItem,
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
      ordem: 0,
      arquivado: false,
      itens: [
        {
          id: 'i1',
          slug: 'especiais',
          titulo: 'Projeto Especial',
          resumo: null,
          corpo: 'texto',
          ordem: 0,
          arquivado: false,
        },
      ],
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

  it('resolve o item dentro da categoria', () => {
    const cat = resolverCategoria(arvore, 'tipos_projetos');
    expect(resolverItem(cat, 'Especiais')?.id).toBe('i1');
  });

  it('slug inexistente devolve undefined (a tela mostra "não encontrado", não quebra)', () => {
    expect(resolverCategoria(arvore, 'inventado')).toBeUndefined();
    expect(resolverItem(resolverCategoria(arvore, 'tipos_projetos'), 'inventado')).toBeUndefined();
  });

  it('slugDeTitulo normaliza título digitado no painel', () => {
    expect(slugDeTitulo('Ganho real × projetado')).toBe('ganho_real_projetado');
    expect(chaveSlug('  Ação/Reação  ')).toBe('acao_reacao');
  });
});

/* ── 2. o seed nunca desfaz o que o admin escreveu (D1) ── */

describe('semearFaq — idempotente por slug', () => {
  it('semeia o FAQ_SEED na 1ª vez e NÃO duplica na 2ª', async () => {
    const primeira = await semearFaq();
    expect(primeira.categorias).toBe(FAQ_SEED.length);
    expect(primeira.itens).toBe(FAQ_SEED.reduce((n, c) => n + c.itens.length, 0));

    const segunda = await semearFaq();
    expect(segunda).toEqual({ categorias: 0, itens: 0 });

    const categorias = await getFaqCategoriasRows();
    expect(categorias.filter((c) => chaveSlug(c.slug) === 'tipos_projetos')).toHaveLength(1);
  });

  it('o link do formulário aponta para conteúdo que EXISTE no seed', () => {
    const tipos = FAQ_SEED.find((c) => c.slug === 'tipos_projetos');
    expect(tipos, 'categoria tipos_projetos do link /faq/tipos_projetos/especiais').toBeTruthy();
    expect(tipos!.itens.some((i) => i.slug === 'especiais')).toBe(true);
  });

  it('NÃO restaura o texto do código por cima da edição do admin', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const especiais = resolverItem(
      resolverCategoria(categorias, 'tipos_projetos'),
      'especiais',
    )!;
    await salvarItem(ADMIN, {
      id: especiais.id,
      categoria_id: resolverCategoria(categorias, 'tipos_projetos')!.id,
      titulo: 'Projeto Especial (revisado pela triagem)',
      resumo: 'resumo novo',
      corpo: 'corpo reescrito pelo admin',
    });

    await semearFaq();

    const depois = await listarFaq({ admin: true });
    const item = resolverItem(resolverCategoria(depois.categorias, 'tipos_projetos'), 'especiais')!;
    expect(item.titulo).toBe('Projeto Especial (revisado pela triagem)');
    expect(item.corpo).toBe('corpo reescrito pelo admin');
  });
});

/* ── 3. arquivar é o "remover" (D6) ── */

describe('arquivar / restaurar', () => {
  it('item arquivado sai da leitura pública e continua para o admin', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const tipos = resolverCategoria(categorias, 'tipos_projetos')!;
    const saving = resolverItem(tipos, 'saving')!;

    await arquivarFaq(ADMIN, { tipo: 'item', id: saving.id, arquivar: true });

    const publico = await listarFaq();
    expect(resolverItem(resolverCategoria(publico.categorias, 'tipos_projetos'), 'saving')).toBeUndefined();

    const admin = await listarFaq({ admin: true });
    const doAdmin = resolverItem(resolverCategoria(admin.categorias, 'tipos_projetos'), 'saving');
    expect(doAdmin?.arquivado).toBe(true);

    // restaurar volta a aparecer
    await arquivarFaq(ADMIN, { tipo: 'item', id: saving.id, arquivar: false });
    const voltou = await listarFaq();
    expect(resolverItem(resolverCategoria(voltou.categorias, 'tipos_projetos'), 'saving')).toBeTruthy();
  });

  it('categoria arquivada esconde a categoria (e os tópicos dela) da leitura pública', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const acomp = resolverCategoria(categorias, 'acompanhamento')!;

    await arquivarFaq(ADMIN, { tipo: 'categoria', id: acomp.id, arquivar: true });

    const publico = await listarFaq();
    expect(resolverCategoria(publico.categorias, 'acompanhamento')).toBeUndefined();

    // ⚠️ Seed NÃO ressuscita categoria arquivada (senão o próximo request desfaria o
    // arquivamento — o admin arquivaria para sempre e nada mudaria).
    const seed = await semearFaq();
    expect(seed).toEqual({ categorias: 0, itens: 0 });
    expect(resolverCategoria((await listarFaq()).categorias, 'acompanhamento')).toBeUndefined();

    await arquivarFaq(ADMIN, { tipo: 'categoria', id: acomp.id, arquivar: false });
  });
});

/* ── 4. slug é imutável; criação deriva e desambigua ── */

describe('salvarCategoria / salvarItem', () => {
  it('editar NÃO muda o slug (o link já circula fora do app)', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const tipos = resolverCategoria(categorias, 'tipos_projetos')!;

    const r = await salvarCategoria(ADMIN, {
      id: tipos.id,
      titulo: 'Tipos de projeto e enquadramento',
      resumo: 'outro resumo',
      slug: 'enquadramento', // tentativa explícita de trocar o endereço
    });

    expect(r.slug).toBe('tipos_projetos');
    const depois = await listarFaq({ admin: true });
    expect(resolverCategoria(depois.categorias, 'tipos_projetos')?.titulo).toBe(
      'Tipos de projeto e enquadramento',
    );
    expect(resolverCategoria(depois.categorias, 'enquadramento')).toBeUndefined();
  });

  it('cria categoria derivando o slug do título e desambigua repetidos', async () => {
    const a = await salvarCategoria(ADMIN, { titulo: 'Prazos e SLA', resumo: null });
    expect(a.slug).toBe('prazos_e_sla');
    const b = await salvarCategoria(ADMIN, { titulo: 'Prazos e SLA', resumo: null });
    expect(b.slug).toBe('prazos_e_sla_2');
  });

  it('cria tópico dentro da categoria e recusa título vazio', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const tipos = resolverCategoria(categorias, 'tipos_projetos')!;

    const criado = await salvarItem(ADMIN, {
      categoria_id: tipos.id,
      titulo: 'Custo evitado',
      resumo: 'Gasto externo que parou de ser pago.',
      corpo: 'texto',
    });
    expect(criado.slug).toBe('custo_evitado');

    await expect(
      salvarItem(ADMIN, { categoria_id: tipos.id, titulo: '   ', resumo: null, corpo: null }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('recusa tópico em categoria inexistente', async () => {
    await expect(
      salvarItem(ADMIN, { categoria_id: 'nao-existe', titulo: 'X', resumo: null, corpo: null }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* ── 5. ordem manual (D7) ── */

describe('reordenarFaq', () => {
  it('troca com o vizinho e reescreve a sequência (empate de ordem não trava)', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const tipos = resolverCategoria(categorias, 'tipos_projetos')!;
    const antes = tipos.itens.map((i) => i.slug);
    expect(antes.length).toBeGreaterThan(1);

    await reordenarFaq(ADMIN, { tipo: 'item', id: tipos.itens[1].id, direcao: 'cima' });

    const depois = await listarFaq({ admin: true });
    const ordemNova = resolverCategoria(depois.categorias, 'tipos_projetos')!.itens.map((i) => i.slug);
    expect(ordemNova[0]).toBe(antes[1]);
    expect(ordemNova[1]).toBe(antes[0]);
  });

  it('primeiro item subindo é no-op (não estoura, não reordena nada)', async () => {
    const { categorias } = await listarFaq({ admin: true });
    const tipos = resolverCategoria(categorias, 'tipos_projetos')!;
    const r = await reordenarFaq(ADMIN, { tipo: 'item', id: tipos.itens[0].id, direcao: 'cima' });
    expect(r.movido).toBe(false);
  });
});

/* ── 6. o corpo é texto puro; nada de HTML interpretado (D10) ── */

describe('conteúdo', () => {
  it('nenhum corpo do seed contém tag HTML (o render é whitespace-pre-wrap)', () => {
    for (const categoria of FAQ_SEED) {
      for (const item of categoria.itens) {
        expect(item.corpo ?? '', `${categoria.slug}/${item.slug}`).not.toMatch(/<[a-z/][^>]*>/i);
      }
    }
  });

  it('todo item do seed tem título, resumo e corpo preenchidos', () => {
    for (const categoria of FAQ_SEED) {
      expect(categoria.titulo.trim()).not.toBe('');
      expect((categoria.resumo ?? '').trim()).not.toBe('');
      for (const item of categoria.itens) {
        expect(item.titulo.trim(), `${categoria.slug}/${item.slug}`).not.toBe('');
        expect((item.resumo ?? '').trim(), `${categoria.slug}/${item.slug}`).not.toBe('');
        expect((item.corpo ?? '').trim().length, `${categoria.slug}/${item.slug}`).toBeGreaterThan(200);
      }
    }
  });

  it('o texto de projeto especial diz o que NÃO é e o que muda na submissão', async () => {
    const especial = FAQ_SEED.find((c) => c.slug === 'tipos_projetos')!.itens.find(
      (i) => i.slug === 'especiais',
    )!;
    expect(especial.corpo).toMatch(/O que NÃO é projeto especial/);
    expect(especial.corpo).toMatch(/pula as etapas financeiras/);
    expect(especial.corpo).toMatch(/pré-aprovação/);
    // Guard de conteúdo: os itens semeados existem no banco depois do seed.
    const itens = await getFaqItensRows();
    expect(itens.some((i) => chaveSlug(i.slug) === 'especiais')).toBe(true);
  });
});
