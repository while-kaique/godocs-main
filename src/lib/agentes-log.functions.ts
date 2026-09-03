// Memória e LOG dos agentes em ÁRVORE — lado server (T21). Regras em `agentes-log.ts`.
//
// ⚠️ `registrarNoAgente`/`abrirCiclo`/`fecharCiclo` NUNCA lançam: log é auditoria, e auditoria
// não pode derrubar a avaliação que já aconteceu (mesma régua de `registrarAtividade`). Nó que
// viola a árvore é RECUSADO antes do banco, logado e CONTADO (`recusasRegistroAgente`).
// Leitura paginada por keyset `(created_at, id)`, cursor btoa/atob (o Worker não tem Buffer).
import {
  insertAvaliacaoCiclo,
  updateAvaliacaoCiclo,
  insertAgenteLog,
  getAgenteLogNo,
  queryAgenteLogPorCiclo,
  queryAgenteLog,
  queryAvaliacaoCiclos,
} from '@/integrations/db/client.server';
import {
  validarNo,
  montarCaminho,
  profundidadeDe,
  montarArvore,
  type ArvoreNo,
  type NoAgente,
  type NoAgenteEntrada,
  type PaiResumo,
} from '@/lib/agentes-log';

const LIMITE_PADRAO = 50;
const LIMITE_TETO = 200;

let recusas = 0;
/** Recusas de nó inválido desde o boot do isolate (diagnóstico; não persiste). */
export function recusasRegistroAgente(): number {
  return recusas;
}

function novoId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function jsonOuNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

export async function abrirCiclo(c: {
  gatilho: string;
  amostra?: unknown;
  modelos?: Record<string, string>;
  variante?: string | null;
}): Promise<string | null> {
  const id = novoId();
  try {
    await insertAvaliacaoCiclo({
      id,
      gatilho: c.gatilho,
      status: 'aberto',
      amostra: jsonOuNull(c.amostra),
      modelos: jsonOuNull(c.modelos),
      variante: c.variante ?? null,
    });
    return id;
  } catch (e) {
    console.error('[agentes-log] abrirCiclo falhou (ignorado):', e);
    return null;
  }
}

export async function fecharCiclo(
  id: string,
  fim: { status: 'concluido' | 'erro'; metricas?: unknown; relatorio_path?: string | null },
): Promise<boolean> {
  try {
    const n = await updateAvaliacaoCiclo(id, {
      status: fim.status,
      metricas: jsonOuNull(fim.metricas),
      relatorio_path: fim.relatorio_path ?? null,
    });
    // `null` = o adaptador não reportou; tratamos como escrito (não é silêncio, é desconhecido).
    return n === null || n > 0;
  } catch (e) {
    console.error('[agentes-log] fecharCiclo falhou (ignorado):', e);
    return false;
  }
}

export async function registrarNoAgente(no: NoAgenteEntrada): Promise<{ id: string; caminho: string } | null> {
  try {
    let pai: PaiResumo = null;
    // Raiz não consulta o banco. Só busca o pai quando há pai_id — e a validação corre em cima
    // do que o banco DEVOLVEU (inexistente → recusa), nunca do que o chamador afirmou.
    if (no.pai_id != null && no.ciclo_id?.trim() && no.projeto_id?.trim() && no.agente?.trim()) {
      pai = (await getAgenteLogNo(no.pai_id)) ?? null;
    }
    const v = validarNo(no, pai);
    if (!v.ok) {
      recusas += 1;
      console.warn(`[agentes-log] nó recusado (${v.motivo}): agente=${no.agente} ciclo=${no.ciclo_id} pai=${no.pai_id}`);
      return null;
    }
    const id = no.id?.trim() || novoId();
    const caminho = montarCaminho(pai, no.ciclo_id, no.agente, id);
    await insertAgenteLog({
      id,
      ciclo_id: no.ciclo_id,
      pai_id: no.pai_id ?? null,
      caminho,
      profundidade: profundidadeDe(pai),
      projeto_id: no.projeto_id,
      agente: no.agente,
      tipo: no.tipo,
      rodada: no.rodada ?? null,
      entrada: no.entrada ?? null,
      saida: no.saida ?? null,
      tools_chamadas: jsonOuNull(no.tools_chamadas),
      confianca: no.confianca ?? null,
      veredito: no.veredito ?? null,
      modelo: no.modelo ?? null,
      tokens_in: no.tokens_in ?? null,
      tokens_out: no.tokens_out ?? null,
      custo_usd: no.custo_usd ?? null,
      duracao_ms: no.duracao_ms ?? null,
      erro: no.erro ?? null,
    });
    return { id, caminho };
  } catch (e) {
    console.error('[agentes-log] registrarNoAgente falhou (ignorado):', e);
    return null;
  }
}

function paraNo(row: Record<string, unknown>): NoAgente {
  let tools: unknown[] | null = null;
  if (typeof row.tools_chamadas === 'string') {
    try {
      const v = JSON.parse(row.tools_chamadas);
      tools = Array.isArray(v) ? v : null;
    } catch {
      tools = null;
    }
  } else if (Array.isArray(row.tools_chamadas)) {
    tools = row.tools_chamadas;
  }
  return { ...(row as unknown as NoAgente), tools_chamadas: tools, created_at: String(row.created_at ?? '') };
}

export async function lerArvore(cicloId: string, projetoId?: string): Promise<ArvoreNo[]> {
  const linhas = (await queryAgenteLogPorCiclo(cicloId, projetoId)) as Record<string, unknown>[];
  return montarArvore(linhas.map(paraNo));
}

// ─── Paginação keyset ────────────────────────────────────────────────────────────────

export function encodeCursorLog(row: { created_at: string | null; id: string }): string {
  const raw = `${row.created_at ?? ''}|${row.id}`;
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursorLog(cursor: string | undefined): { created_at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const sep = raw.indexOf('|');
    if (sep < 0) return null;
    const id = raw.slice(sep + 1);
    return id ? { created_at: raw.slice(0, sep), id } : null;
  } catch {
    return null;
  }
}

function limiteDe(v: number | string | undefined): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
  if (!Number.isFinite(n as number) || (n as number) <= 0) return LIMITE_PADRAO;
  return Math.min(n as number, LIMITE_TETO);
}

function paginar<T extends { created_at: string | null; id: string }>(
  linhas: T[],
  tamanho: number,
): { itens: T[]; proximoCursor: string | null } {
  const temMais = linhas.length > tamanho;
  const pagina = temMais ? linhas.slice(0, tamanho) : linhas;
  const ultimo = pagina[pagina.length - 1];
  return {
    itens: pagina,
    proximoCursor: temMais && ultimo ? encodeCursorLog({ created_at: ultimo.created_at, id: ultimo.id }) : null,
  };
}

export async function listarCiclos(
  opts: { cursor?: string; limit?: number | string } = {},
): Promise<{ itens: unknown[]; proximoCursor: string | null }> {
  const tamanho = limiteDe(opts.limit);
  const c = decodeCursorLog(opts.cursor);
  const linhas = (await queryAvaliacaoCiclos({
    limit: tamanho + 1,
    cursor_created_at: c?.created_at ?? null,
    cursor_id: c?.id ?? null,
  })) as { created_at: string | null; id: string }[];
  return paginar(linhas, tamanho);
}

export async function listarLog(
  opts: {
    agente?: string;
    desde?: string;
    veredito?: string;
    projeto?: string;
    ciclo?: string;
    cursor?: string;
    limit?: number | string;
  } = {},
): Promise<{ itens: unknown[]; proximoCursor: string | null }> {
  const tamanho = limiteDe(opts.limit);
  const c = decodeCursorLog(opts.cursor);
  const linhas = (await queryAgenteLog({
    limit: tamanho + 1,
    agente: opts.agente ?? null,
    desde: opts.desde ?? null,
    veredito: opts.veredito ?? null,
    projeto: opts.projeto ?? null,
    ciclo: opts.ciclo ?? null,
    cursor_created_at: c?.created_at ?? null,
    cursor_id: c?.id ?? null,
  })) as Record<string, unknown>[];
  const r = paginar(linhas.map(paraNo), tamanho);
  return { itens: r.itens, proximoCursor: r.proximoCursor };
}
