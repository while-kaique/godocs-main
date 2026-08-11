// FAQ — regras de negócio (server-only).
//
// Leitura: qualquer pessoa logada (`GET /api/faq`). Escrita: só admin, atrás de
// `requireAdmin` em `/api/admin/faq/*` — a UI usa `/api/auth/me` apenas para decidir o que
// PINTA, nunca como autorização. Ver spec-docs/SPEC_FAQ.md (D4, D5).
//
// ⚠️ Invariantes que não podem regredir:
//   • seed IDEMPOTENTE por slug — deploy novo nunca sobrescreve edição do admin (D1)
//   • slug IMUTÁVEL depois de criado — o link circula em Chat/e-mail/formulário (D2)
//   • remover é ARQUIVAR — não existe DELETE nesta feature (D6)
//   • corpo é TEXTO PURO — nada de HTML/markdown, nunca `dangerouslySetInnerHTML` (D10)

import { z } from 'zod';
import {
  getFaqCategoriasRows,
  getFaqItensRows,
  insertFaqCategoria,
  insertFaqItem,
  setArquivadoFaqCategoria,
  setArquivadoFaqItem,
  setOrdemFaqCategoria,
  setOrdemFaqItem,
  updateFaqCategoria,
  updateFaqItem,
  type FaqCategoriaRow,
  type FaqItemRow,
} from '@/integrations/db/client.server';
import { FAQ_SEED, chaveSlug, slugDeTitulo, type FaqCategoria } from '@/lib/faq/conteudo';

const log = (...args: unknown[]) => console.log('[faq.functions]', ...args);

// Lança um erro 400 com a mensagem de validação (o worker mapeia .status).
function erro400(mensagem: string): never {
  throw Object.assign(new Error(mensagem), { status: 400 });
}

function erro404(mensagem: string): never {
  throw Object.assign(new Error(mensagem), { status: 404 });
}

/* ─────────────────────────── leitura ─────────────────────────── */

function montarArvore(
  categorias: FaqCategoriaRow[],
  itens: FaqItemRow[],
  incluirArquivados: boolean,
): FaqCategoria[] {
  const porCategoria = new Map<string, FaqItemRow[]>();
  for (const item of itens) {
    if (!incluirArquivados && item.arquivado === 1) continue;
    const lista = porCategoria.get(item.categoria_id);
    if (lista) lista.push(item);
    else porCategoria.set(item.categoria_id, [item]);
  }

  return categorias
    .filter((c) => incluirArquivados || c.arquivado !== 1)
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      titulo: c.titulo,
      resumo: c.resumo,
      ordem: c.ordem,
      arquivado: c.arquivado === 1,
      itens: (porCategoria.get(c.id) ?? []).map((i) => ({
        id: i.id,
        slug: i.slug,
        titulo: i.titulo,
        resumo: i.resumo,
        corpo: i.corpo,
        ordem: i.ordem,
        arquivado: i.arquivado === 1,
      })),
    }));
}

/**
 * Semeia o conteúdo inicial. **Idempotente por slug**: slug ausente → INSERT, slug
 * presente → não toca em nada. É isso que garante que um deploy novo não desfaça o que o
 * admin escreveu no painel (D1).
 *
 * ⚠️ Categoria ARQUIVADA conta como presente: se o admin arquivou "Acompanhamento e
 * status", o seed não pode ressuscitá-la no próximo request.
 */
export async function semearFaq(): Promise<{ categorias: number; itens: number }> {
  const categorias = await getFaqCategoriasRows();
  const itens = await getFaqItensRows();

  const porSlugCategoria = new Map(categorias.map((c) => [chaveSlug(c.slug), c]));
  const itensPorCategoria = new Map<string, Set<string>>();
  for (const i of itens) {
    const set = itensPorCategoria.get(i.categoria_id) ?? new Set<string>();
    set.add(chaveSlug(i.slug));
    itensPorCategoria.set(i.categoria_id, set);
  }

  let novasCategorias = 0;
  let novosItens = 0;

  for (const [indice, semente] of FAQ_SEED.entries()) {
    let categoria = porSlugCategoria.get(chaveSlug(semente.slug));
    if (!categoria) {
      categoria = await insertFaqCategoria({
        slug: semente.slug,
        titulo: semente.titulo,
        resumo: semente.resumo,
        ordem: indice,
        atualizado_por: 'seed',
      });
      porSlugCategoria.set(chaveSlug(categoria.slug), categoria);
      novasCategorias++;
    }

    const jaTem = itensPorCategoria.get(categoria.id) ?? new Set<string>();
    for (const [posicao, item] of semente.itens.entries()) {
      if (jaTem.has(chaveSlug(item.slug))) continue;
      await insertFaqItem({
        categoria_id: categoria.id,
        slug: item.slug,
        titulo: item.titulo,
        resumo: item.resumo,
        corpo: item.corpo,
        ordem: posicao,
        atualizado_por: 'seed',
      });
      jaTem.add(chaveSlug(item.slug));
      novosItens++;
    }
    itensPorCategoria.set(categoria.id, jaTem);
  }

  if (novasCategorias || novosItens) {
    log(`seed: +${novasCategorias} categoria(s), +${novosItens} tópico(s)`);
  }
  return { categorias: novasCategorias, itens: novosItens };
}

/**
 * Árvore do FAQ. `admin: true` inclui os arquivados (marcados) para o painel inline.
 * O seed roda antes da leitura — é o que faz o conteúdo existir no 1º acesso de um
 * ambiente novo (staging, banco recriado) sem ninguém digitar em produção.
 */
export async function listarFaq({ admin = false }: { admin?: boolean } = {}): Promise<{
  categorias: FaqCategoria[];
}> {
  try {
    await semearFaq();
  } catch (e) {
    // Seed é conveniência: se falhar, a leitura segue com o que já existe no banco.
    console.error('[faq.functions] seed falhou (seguindo com o conteúdo existente):', e);
  }
  const [categorias, itens] = [await getFaqCategoriasRows(), await getFaqItensRows()];
  return { categorias: montarArvore(categorias, itens, admin) };
}

/* ─────────────────────────── escrita (admin) ─────────────────────────── */

const TEXTO_TITULO = z.string().trim().min(1, 'Escreva um título.').max(120, 'Título muito longo (máximo 120 caracteres).');
const TEXTO_RESUMO = z
  .string()
  .trim()
  .max(300, 'Resumo muito longo (máximo 300 caracteres).')
  .optional()
  .nullable();

export const categoriaSchema = z.object({
  id: z.string().trim().min(1).optional().nullable(),
  titulo: TEXTO_TITULO,
  resumo: TEXTO_RESUMO,
  // Só é lido na CRIAÇÃO (slug imutável na edição). Ausente → derivado do título.
  slug: z.string().trim().max(60).optional().nullable(),
});

export const itemSchema = z.object({
  id: z.string().trim().min(1).optional().nullable(),
  categoria_id: z.string().trim().min(1, 'Escolha a categoria.'),
  titulo: TEXTO_TITULO,
  resumo: TEXTO_RESUMO,
  corpo: z
    .string()
    .trim()
    .max(20000, 'Texto muito longo (máximo 20.000 caracteres).')
    .optional()
    .nullable(),
  slug: z.string().trim().max(60).optional().nullable(),
});

export const arquivarSchema = z.object({
  tipo: z.enum(['categoria', 'item']),
  id: z.string().trim().min(1),
  arquivar: z.boolean(),
});

export const reordenarSchema = z.object({
  tipo: z.enum(['categoria', 'item']),
  id: z.string().trim().min(1),
  direcao: z.enum(['cima', 'baixo']),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) erro400(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

/** Slug livre dentro do escopo (global para categoria, categoria_id para item). */
function slugDisponivel(
  desejado: string,
  usados: string[],
): string {
  const base = desejado || 'topico';
  const ocupados = new Set(usados.map(chaveSlug));
  if (!ocupados.has(chaveSlug(base))) return base;
  for (let n = 2; n < 100; n++) {
    const tentativa = `${base}_${n}`;
    if (!ocupados.has(chaveSlug(tentativa))) return tentativa;
  }
  erro400('Não foi possível gerar um endereço único para este título. Mude o título.');
}

export async function salvarCategoria(email: string, body: unknown) {
  const dados = parse(categoriaSchema, body);
  const categorias = await getFaqCategoriasRows();

  if (dados.id) {
    const atual = categorias.find((c) => c.id === dados.id);
    if (!atual) erro404('Categoria não encontrada.');
    // ⚠️ slug NÃO entra: é imutável (o link já circula fora do app).
    await updateFaqCategoria(atual.id, {
      titulo: dados.titulo,
      resumo: dados.resumo ?? null,
      atualizado_por: email,
    });
    return { ok: true as const, id: atual.id, slug: atual.slug };
  }

  const slug = slugDisponivel(
    chaveSlug(dados.slug || '') || slugDeTitulo(dados.titulo),
    categorias.map((c) => c.slug),
  );
  const ordem = categorias.reduce((max, c) => Math.max(max, c.ordem), -1) + 1;
  const criada = await insertFaqCategoria({
    slug,
    titulo: dados.titulo,
    resumo: dados.resumo ?? null,
    ordem,
    atualizado_por: email,
  });
  return { ok: true as const, id: criada.id, slug: criada.slug };
}

export async function salvarItem(email: string, body: unknown) {
  const dados = parse(itemSchema, body);
  const categorias = await getFaqCategoriasRows();
  const categoria = categorias.find((c) => c.id === dados.categoria_id);
  if (!categoria) erro404('Categoria não encontrada.');

  const itens = await getFaqItensRows();

  if (dados.id) {
    const atual = itens.find((i) => i.id === dados.id);
    if (!atual) erro404('Tópico não encontrado.');
    // ⚠️ slug e categoria NÃO mudam na edição (D2).
    await updateFaqItem(atual.id, {
      titulo: dados.titulo,
      resumo: dados.resumo ?? null,
      corpo: dados.corpo ?? null,
      atualizado_por: email,
    });
    return { ok: true as const, id: atual.id, slug: atual.slug, categoria_slug: categoria.slug };
  }

  const daCategoria = itens.filter((i) => i.categoria_id === categoria.id);
  const slug = slugDisponivel(
    chaveSlug(dados.slug || '') || slugDeTitulo(dados.titulo),
    daCategoria.map((i) => i.slug),
  );
  const ordem = daCategoria.reduce((max, i) => Math.max(max, i.ordem), -1) + 1;
  const criado = await insertFaqItem({
    categoria_id: categoria.id,
    slug,
    titulo: dados.titulo,
    resumo: dados.resumo ?? null,
    corpo: dados.corpo ?? null,
    ordem,
    atualizado_por: email,
  });
  return { ok: true as const, id: criado.id, slug: criado.slug, categoria_slug: categoria.slug };
}

export async function arquivarFaq(email: string, body: unknown) {
  const dados = parse(arquivarSchema, body);
  if (dados.tipo === 'categoria') {
    const existe = (await getFaqCategoriasRows()).some((c) => c.id === dados.id);
    if (!existe) erro404('Categoria não encontrada.');
    await setArquivadoFaqCategoria(dados.id, dados.arquivar, email);
  } else {
    const existe = (await getFaqItensRows()).some((i) => i.id === dados.id);
    if (!existe) erro404('Tópico não encontrado.');
    await setArquivadoFaqItem(dados.id, dados.arquivar, email);
  }
  return { ok: true as const, arquivado: dados.arquivar };
}

/**
 * Troca a posição com o vizinho (ordem MANUAL — D7). Puro no espírito: calcula os 2 novos
 * valores de `ordem` e grava. Vizinho ausente (já é o primeiro/último) → no-op silencioso.
 *
 * ⚠️ Ordena por `(ordem, criado_em)` como a leitura, e reescreve a sequência inteira do
 * escopo. Empates de `ordem` (herdados do seed ou de uma criação concorrente) fariam a
 * troca "não mexer em nada" se trocássemos só os 2 valores.
 */
export async function reordenarFaq(email: string, body: unknown) {
  const dados = parse(reordenarSchema, body);

  const escopo =
    dados.tipo === 'categoria'
      ? (await getFaqCategoriasRows()).map((c) => ({ id: c.id, ordem: c.ordem }))
      : await (async () => {
          const itens = await getFaqItensRows();
          const alvo = itens.find((i) => i.id === dados.id);
          if (!alvo) erro404('Tópico não encontrado.');
          return itens
            .filter((i) => i.categoria_id === alvo.categoria_id)
            .map((i) => ({ id: i.id, ordem: i.ordem }));
        })();

  const posicao = escopo.findIndex((e) => e.id === dados.id);
  if (posicao === -1) erro404('Item não encontrado.');
  const destino = dados.direcao === 'cima' ? posicao - 1 : posicao + 1;
  if (destino < 0 || destino >= escopo.length) return { ok: true as const, movido: false };

  const nova = [...escopo];
  [nova[posicao], nova[destino]] = [nova[destino], nova[posicao]];

  for (const [indice, e] of nova.entries()) {
    if (dados.tipo === 'categoria') await setOrdemFaqCategoria(e.id, indice);
    else await setOrdemFaqItem(e.id, indice);
  }
  log(`reordenou ${dados.tipo} ${dados.id} para ${dados.direcao} (por ${email})`);
  return { ok: true as const, movido: true };
}
