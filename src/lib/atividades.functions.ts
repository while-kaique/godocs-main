/**
 * Feed de ações do painel admin — o "Histórico" que abre num drawer nas telas de
 * aprovação (`/dashboard`, `/especiais`, `/aprovacoes-pendentes`).
 *
 * ⚠️ **`registrarAtividade` NUNCA lança.** É auditoria: uma falha aqui não pode desfazer
 * a mudança de status/estrela/parecer que JÁ aconteceu (mesma regra do `insertAdminStatusLog`
 * em `definirStatusProjeto`). Erro vira `console.error` e segue.
 *
 * A tabela `admin_activity_log` é DERIVADA/append-only: nenhum estado do app mora nela
 * (isso é `projetos`/`sheet_espelho`); pode ser apagada que o painel segue funcionando —
 * só o histórico de quem-fez-o-quê some.
 */
import { z } from 'zod';
import {
  insertAdminActivity,
  queryAdminActivities,
  type AdminActivityRow,
} from '@/integrations/db/client.server';

/** Discriminador da ação. Ampliar aqui + no mapa de rótulos do drawer (historico-drawer.tsx). */
export type AcaoAdmin =
  | 'status' // mudança de status na triagem (Aprovado/Reprovado/Reenvio…)
  | 'estrelas' // nota do comparador de especiais
  | 'dono_area' // divisão da validação por área
  | 'lider_decisao' // pré-aprovação do líder feita em modo admin (?como=)
  | 'reabrir_fila' // reabertura da fila de pré-aprovação
  | 'aglutinacao'; // aceite/rejeição de "X é feature de Y" no painel de aglutinação

export type RegistroAtividade = {
  ator_email: string;
  acao: AcaoAdmin;
  projeto_id?: string | null;
  projeto_nome?: string | null;
  detalhe?: string | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Registra uma ação no feed. Fire-and-forget consciente: o chamador NÃO precisa (nem deve)
 * ficar preso ao resultado. Engole qualquer erro.
 */
export async function registrarAtividade(reg: RegistroAtividade): Promise<void> {
  try {
    if (!reg.ator_email) return; // sem ator não há o que auditar
    await insertAdminActivity({
      ator_email: reg.ator_email,
      acao: reg.acao,
      projeto_id: reg.projeto_id ?? null,
      projeto_nome: reg.projeto_nome ?? null,
      detalhe: reg.detalhe ?? null,
      meta_json: reg.meta ? JSON.stringify(reg.meta) : null,
    });
  } catch (e) {
    console.error('[atividades] falha ao registrar atividade (ignorado):', e);
  }
}

// ── Leitura (feed paginado) ──────────────────────────────────────────────────

const LIMITE_PADRAO = 30;
const LIMITE_MAX = 100;

const listarSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITE_MAX).optional(),
});

export type AtividadeItem = {
  id: string;
  ator_email: string;
  acao: string;
  projeto_id: string | null;
  projeto_nome: string | null;
  detalhe: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};

export type ListagemAtividades = {
  itens: AtividadeItem[];
  proximoCursor: string | null;
};

/**
 * Cursor opaco = base64url de "created_at|id". Puro e reversível; um cursor podre só
 * significa "sem cursor" (primeira página), nunca um erro para o usuário.
 */
export function encodeCursor(row: { created_at: string | null; id: string }): string {
  // Conteúdo é ASCII (datetime + id hex), então btoa direto basta. url-safe como em
  // google/auth.ts (o runtime do Worker tem btoa/atob, NÃO tem Buffer/nodejs_compat).
  const raw = `${row.created_at ?? ''}|${row.id}`;
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined): { created_at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const sep = raw.indexOf('|');
    if (sep < 0) return null;
    const created_at = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!id) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}

function parseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function paraItem(row: AdminActivityRow): AtividadeItem {
  return {
    id: row.id,
    ator_email: row.ator_email,
    acao: row.acao,
    projeto_id: row.projeto_id,
    projeto_nome: row.projeto_nome,
    detalhe: row.detalhe,
    meta: parseMeta(row.meta_json),
    created_at: row.created_at,
  };
}

export async function listarAtividades(raw: unknown): Promise<ListagemAtividades> {
  const { cursor, limit } = listarSchema.parse(raw ?? {});
  const tamanho = limit ?? LIMITE_PADRAO;
  const decodificado = decodeCursor(cursor);

  // Pede um a mais para descobrir se há próxima página sem uma segunda consulta.
  const linhas = await queryAdminActivities(decodificado, tamanho + 1);
  const temMais = linhas.length > tamanho;
  const pagina = temMais ? linhas.slice(0, tamanho) : linhas;

  const ultimo = pagina[pagina.length - 1];
  const proximoCursor =
    temMais && ultimo ? encodeCursor({ created_at: ultimo.created_at, id: ultimo.id }) : null;

  return { itens: pagina.map(paraItem), proximoCursor };
}
