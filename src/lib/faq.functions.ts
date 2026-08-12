// FAQ — regras de negócio (server-only).
//
// Leitura: qualquer pessoa logada (`GET /api/faq`). Escrita: só admin, atrás de
// `requireAdmin` em `/api/admin/faq/*` — a UI usa `/api/auth/me` apenas para decidir o que
// PINTA, nunca como autorização. Ver spec-docs/SPEC_FAQ.md (D4, D5).
//
// ⚠️ Invariantes que não podem regredir:
//   • seed IDEMPOTENTE por slug — deploy novo nunca sobrescreve edição do admin (D1)
//   • BACKFILL só preenche corpo VAZIO — documento escrito pelo admin é intocável (D13)
//   • slug IMUTÁVEL depois de criado — o link circula em Chat/e-mail/formulário (D2)
//   • remover é ARQUIVAR — não existe DELETE nesta feature (D6)
//   • o corpo nunca vira HTML: o renderer tem allowlist fechada (D13)

import { z } from 'zod';
import {
  backfillCorpoFaqCategoria,
  getFaqCategoriasRows,
  insertFaqCategoria,
  setArquivadoFaqCategoria,
  setOrdemFaqCategoria,
  updateFaqCategoria,
  type FaqCategoriaRow,
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

function paraCategoria(c: FaqCategoriaRow): FaqCategoria {
  return {
    id: c.id,
    slug: c.slug,
    titulo: c.titulo,
    resumo: c.resumo,
    corpo: c.corpo,
    ordem: c.ordem,
    arquivado: c.arquivado === 1,
  };
}

const vazio = (texto: string | null | undefined) => !texto || !texto.trim();

/**
 * Semeia o conteúdo inicial. **Idempotente por slug**: slug ausente → INSERT, slug
 * presente → não toca em título, resumo nem ordem. É isso que garante que um deploy novo
 * não desfaça o que o admin escreveu no painel (D1).
 *
 * ⚠️ Categoria ARQUIVADA conta como presente: se o admin arquivou "Acompanhamento e
 * status", o seed não pode ressuscitá-la no próximo request.
 *
 * ⚠️ O `backfill` existe por causa da coluna `corpo`, que nasceu depois das categorias
 * (D13): sem ele, o banco que já tinha "Tipos de Projeto" ficaria com o documento vazio
 * para sempre, porque o slug já está presente. Ele só escreve onde o corpo está vazio.
 */
export async function semearFaq(): Promise<{ categorias: number; backfill: number }> {
  const categorias = await getFaqCategoriasRows();
  const porSlug = new Map(categorias.map((c) => [chaveSlug(c.slug), c]));

  let novas = 0;
  let backfill = 0;

  for (const [indice, semente] of FAQ_SEED.entries()) {
    const atual = porSlug.get(chaveSlug(semente.slug));

    if (!atual) {
      const criada = await insertFaqCategoria({
        slug: semente.slug,
        titulo: semente.titulo,
        resumo: semente.resumo,
        corpo: semente.corpo,
        ordem: indice,
        atualizado_por: 'seed',
      });
      porSlug.set(chaveSlug(criada.slug), criada);
      novas++;
      continue;
    }

    if (vazio(atual.corpo) && !vazio(semente.corpo)) {
      await backfillCorpoFaqCategoria(atual.id, semente.corpo!);
      backfill++;
    }
  }

  if (novas || backfill) log(`seed: +${novas} categoria(s), ${backfill} corpo(s) preenchido(s)`);
  return { categorias: novas, backfill };
}

/**
 * O FAQ inteiro. `admin: true` inclui os arquivados (marcados) para o painel inline.
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
  const rows = await getFaqCategoriasRows();
  return {
    categorias: rows.filter((c) => admin || c.arquivado !== 1).map(paraCategoria),
  };
}

/* ─────────────────────────── escrita (admin) ─────────────────────────── */

const TEXTO_TITULO = z
  .string()
  .trim()
  .min(1, 'Escreva um título.')
  .max(120, 'Título muito longo (máximo 120 caracteres).');

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
  corpo: z
    .string()
    .trim()
    .max(30000, 'Texto muito longo (máximo 30.000 caracteres).')
    .optional()
    .nullable(),
  // Só é lido na CRIAÇÃO (slug imutável na edição). Ausente → derivado do título.
  slug: z.string().trim().max(60).optional().nullable(),
});

export const arquivarSchema = z.object({
  id: z.string().trim().min(1),
  arquivar: z.boolean(),
});

export const reordenarSchema = z.object({
  id: z.string().trim().min(1),
  direcao: z.enum(['cima', 'baixo']),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) erro400(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

/** Slug livre entre as categorias. Repetido → sufixo numérico. */
function slugDisponivel(desejado: string, usados: string[]): string {
  const base = desejado || 'assunto';
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
    if (!atual) erro404('Assunto não encontrado.');
    // ⚠️ slug NÃO entra: é imutável (o link já circula fora do app).
    await updateFaqCategoria(atual.id, {
      titulo: dados.titulo,
      resumo: dados.resumo ?? null,
      corpo: dados.corpo ?? null,
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
    corpo: dados.corpo ?? null,
    ordem,
    atualizado_por: email,
  });
  return { ok: true as const, id: criada.id, slug: criada.slug };
}

export async function arquivarFaq(email: string, body: unknown) {
  const dados = parse(arquivarSchema, body);
  const existe = (await getFaqCategoriasRows()).some((c) => c.id === dados.id);
  if (!existe) erro404('Assunto não encontrado.');
  await setArquivadoFaqCategoria(dados.id, dados.arquivar, email);
  return { ok: true as const, arquivado: dados.arquivar };
}

/**
 * Troca a posição com o vizinho (ordem MANUAL — D7). Vizinho ausente (já é o primeiro ou
 * o último) → no-op silencioso.
 *
 * ⚠️ Ordena como a leitura e reescreve a sequência inteira. Empates de `ordem` (herdados
 * do seed ou de uma criação concorrente) fariam a troca "não mexer em nada" se
 * trocássemos só os 2 valores.
 */
export async function reordenarFaq(email: string, body: unknown) {
  const dados = parse(reordenarSchema, body);
  const escopo = (await getFaqCategoriasRows()).map((c) => ({ id: c.id }));

  const posicao = escopo.findIndex((e) => e.id === dados.id);
  if (posicao === -1) erro404('Assunto não encontrado.');
  const destino = dados.direcao === 'cima' ? posicao - 1 : posicao + 1;
  if (destino < 0 || destino >= escopo.length) return { ok: true as const, movido: false };

  const nova = [...escopo];
  [nova[posicao], nova[destino]] = [nova[destino], nova[posicao]];

  for (const [indice, e] of nova.entries()) await setOrdemFaqCategoria(e.id, indice);
  log(`reordenou ${dados.id} para ${dados.direcao} (por ${email})`);
  return { ok: true as const, movido: true };
}
