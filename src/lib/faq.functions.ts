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
import {
  FAQ_SEED,
  chaveSlug,
  slugDeTitulo,
  type FaqCategoria,
  type FaqVersaoAnterior,
} from '@/lib/faq/conteudo';

const log = (...args: unknown[]) => console.log('[faq.functions]', ...args);

// Lança um erro 400 com a mensagem de validação (o worker mapeia .status).
function erro400(mensagem: string): never {
  throw Object.assign(new Error(mensagem), { status: 400 });
}

function erro404(mensagem: string): never {
  throw Object.assign(new Error(mensagem), { status: 404 });
}

/* ─────────────────────────── leitura ─────────────────────────── */

/**
 * Lê o snapshot da versão anterior. JSON quebrado (edição manual no banco, migração
 * malfeita) devolve `null` em vez de derrubar a leitura do FAQ inteiro — o pior caso é o
 * botão "Voltar" não aparecer.
 */
function lerVersaoAnterior(json: string | null): FaqVersaoAnterior | null {
  if (!json?.trim()) return null;
  try {
    const v = JSON.parse(json) as Partial<FaqVersaoAnterior>;
    if (typeof v?.titulo !== 'string') return null;
    return {
      titulo: v.titulo,
      resumo: typeof v.resumo === 'string' ? v.resumo : null,
      corpo: typeof v.corpo === 'string' ? v.corpo : null,
      em: typeof v.em === 'string' ? v.em : null,
      por: typeof v.por === 'string' ? v.por : null,
    };
  } catch {
    return null;
  }
}

function paraCategoria(c: FaqCategoriaRow, admin: boolean): FaqCategoria {
  return {
    id: c.id,
    slug: c.slug,
    titulo: c.titulo,
    resumo: c.resumo,
    corpo: c.corpo,
    ordem: c.ordem,
    arquivado: c.arquivado === 1,
    atualizado_em: c.atualizado_em,
    atualizado_por: c.atualizado_por,
    // O texto anterior é ferramenta de edição: não vai no payload de quem só lê.
    versao_anterior: admin ? lerVersaoAnterior(c.versao_anterior) : null,
  };
}

const vazio = (texto: string | null | undefined) => !texto || !texto.trim();

const mesmoTexto = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim() === (b ?? '').trim();

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
    categorias: rows.filter((c) => admin || c.arquivado !== 1).map((c) => paraCategoria(c, admin)),
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

    // Snapshot de 1 nível para o botão "Voltar" (D14).
    // ⚠️ Só guarda quando algo REALMENTE mudou: salvar sem alterar nada gravaria um
    // snapshot idêntico e QUEIMARIA o slot — o admin perderia o texto bom para onde ele
    // ainda queria voltar, sem ter mudado uma letra.
    const mudou =
      !mesmoTexto(atual.titulo, dados.titulo) ||
      !mesmoTexto(atual.resumo, dados.resumo) ||
      !mesmoTexto(atual.corpo, dados.corpo);

    const snapshot: FaqVersaoAnterior = {
      titulo: atual.titulo,
      resumo: atual.resumo,
      corpo: atual.corpo,
      em: atual.atualizado_em,
      por: atual.atualizado_por,
    };

    // ⚠️ slug NÃO entra: é imutável (o link já circula fora do app).
    await updateFaqCategoria(atual.id, {
      titulo: dados.titulo,
      resumo: dados.resumo ?? null,
      corpo: dados.corpo ?? null,
      versao_anterior: mudou ? JSON.stringify(snapshot) : atual.versao_anterior,
      atualizado_por: email,
    });
    return { ok: true as const, id: atual.id, slug: atual.slug, guardouVersao: mudou };
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

export const desfazerSchema = z.object({ id: z.string().trim().min(1) });

/**
 * Restaura a versão imediatamente anterior (D14). O texto ATUAL é descartado de propósito —
 * é o que o modal de confirmação avisa —, e o slot é **limpo**: o undo é de 1 nível, não um
 * botão que fica alternando entre duas versões.
 *
 * ⚠️ Sem versão anterior → 400 com a razão. O botão não pinta nesse caso, mas o gate real é
 * aqui (a UI não autoriza nada).
 */
export async function desfazerFaq(email: string, body: unknown) {
  const dados = parse(desfazerSchema, body);
  const atual = (await getFaqCategoriasRows()).find((c) => c.id === dados.id);
  if (!atual) erro404('Assunto não encontrado.');

  const anterior = lerVersaoAnterior(atual.versao_anterior);
  if (!anterior) erro400('Não há versão anterior para voltar neste assunto.');

  await updateFaqCategoria(atual.id, {
    titulo: anterior.titulo,
    resumo: anterior.resumo,
    corpo: anterior.corpo,
    versao_anterior: null,
    atualizado_por: email,
  });
  log(`desfez a última edição de ${atual.slug} (por ${email})`);
  return { ok: true as const, id: atual.id, slug: atual.slug };
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
