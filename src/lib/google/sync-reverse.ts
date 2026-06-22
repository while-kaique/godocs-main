// Sync reverso: Google Sheets (fonte de verdade) → SQLite.
//
// Roda de hora em hora (cron) para refletir no SQLite:
//   1. Projetos LEGADOS que só existem na planilha → cria a linha no SQLite
//      (habilita "Meus Projetos" e edição para os donos).
//   2. Edições manuais na planilha de projetos já existentes → atualiza apenas
//      campos seguros (diff-aware), sem apagar dados ricos do SQLite.
//
// Nunca propaga erros — tudo é logado via console.error e contabilizado no
// resultado. Match por "ID Projeto" (coluna B), case-insensitive (ids do SQLite
// são minúsculos; legados na planilha às vezes em MAIÚSCULAS).

import { readAllRows, type SheetColumn, type SheetRow } from './sheets';
import { toIsoOrNull } from '@/lib/format-date';
import {
  getAllProjetoIds,
  getProjetoById,
  insertProjetoRaw,
  updateProjeto,
  parseJson,
  type ProjetoRow,
} from '@/integrations/db/client.server';

export type ReverseSyncResult = {
  total: number;
  criados: number;
  atualizados: number;
  ignorados: number;
  erros: number;
  detalhes: string[];
};

// ─── Parsers ─────────────────────────────────────────────────────────────────

/** Texto: trim + trata célula vazia / "—" como null. */
function txt(v: string | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === '—' || s === '-' ? null : s;
}

/**
 * Número pt-BR robusto: lida com "418,2", "R$ 1.234,56" e também "10.5" (ponto
 * decimal). Regra: se há vírgula, ela é o separador decimal e o ponto é milhar;
 * se só há ponto, é decimal.
 */
function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  let s = String(v).trim().replace(/r\$\s*/gi, '').replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Label da planilha → status interno (CHECK do schema). */
const STATUS_FROM_LABEL: Record<string, string> = {
  aprovado: 'aprovado',
  'reenvio pendente': 'rejeitado',
  rejeitado: 'rejeitado',
  pendente: 'em_validacao',
  validado: 'validado',
  'em validação': 'em_validacao',
  'em validacao': 'em_validacao',
};
function statusFromLabel(v: string | undefined): string {
  if (!v) return 'em_validacao';
  return STATUS_FROM_LABEL[v.trim().toLowerCase()] ?? 'em_validacao';
}

function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseMembros(v: string | undefined): string[] {
  return parseList(v).filter((s) => s.includes('@'));
}

function parseEspecial(v: string | undefined): number {
  return (v ?? '').trim().toLowerCase().startsWith('s') ? 1 : 0;
}

// A coluna "Custo Evitado" passou a guardar o VALOR R$ (não mais 'sim'/'não').
// Deriva o flag sim/não para o SQLite: número > 0 → 'sim'; 0 → 'não'; legados
// antigos com texto 's…/n…' preservados; vazio → null.
function custoEvitadoFlag(v: string | undefined): string | null {
  const n = parseNum(v);
  if (n != null) return n > 0 ? 'sim' : 'nao';
  const s = txt(v);
  if (!s) return null;
  if (/^s/i.test(s)) return 'sim';
  if (/^n/i.test(s)) return 'nao';
  return null;
}

// ─── Criação de legado (projeto só existe na planilha) ───────────────────────

async function criarLegado(id: string, row: SheetRow): Promise<void> {
  const tipos = parseList(row['Tipos Projeto']).map((t) => t.toLowerCase());
  const especial = parseEspecial(row['Especial?']);
  const membros = parseMembros(row['Participantes']);
  const status = statusFromLabel(row['Status']);
  const dataCriacao = txt(row['Data Criação']);
  // "Data Submissão" vem em pt-BR (dd/mm/yyyy) da planilha — normaliza para ISO
  // para o frontend formatar certo (senão `new Date()` → "Enviado em Invalid date").
  const submittedAt = toIsoOrNull(row['Data Submissão']);

  await insertProjetoRaw({
    id,
    nome: txt(row['Projeto']),
    responsavel_nome: txt(row['Nome Completo']) ?? '—',
    responsavel_email: txt(row['Email']) ?? '',
    area: txt(row['Área']),
    ferramenta: txt(row['Ferramenta']) ?? '—',
    escopo: txt(row['Escopo']),
    membros: membros.length ? membros : null,
    status,
    chat_completo: 1,
    data_criacao_projeto: dataCriacao ? dataCriacao.split(' ')[0] : null,
    tipo_projeto: tipos[0] ?? (especial ? 'especial' : null),
    tipos_projeto: tipos.length ? tipos : especial ? ['especial'] : null,
    descricao_breve: txt(row['Descrição']),
    saving_horas: parseNum(row['Saving Horas']),
    saving_reais: parseNum(row['Saving Reais']),
    tipo_saving: txt(row['Tipo de Saving']),
    memorial_calculo: txt(row['Memorial de Saving']),
    custo_externo_mensal: parseNum(row['Custo Externo Mensal']),
    ganho_total_mensal: parseNum(row['Ganho Total']),
    complexidade: txt(row['Complexidade']),
    alguem_fazia: txt(row['Alguém Fazia?']),
    observacoes: txt(row['Observações']),
    especial,
    contexto_especial: txt(row['Contexto do Projeto Especial']),
    custo_evitado: custoEvitadoFlag(row['Custo Evitado']),
    custo_evitado_justificativa: txt(row['Justificativa Custo Evitado']),
    submitted_at: submittedAt,
    validated_at: status === 'aprovado' ? submittedAt : null,
    // Espelha "Atualizado Em": vazio nos legados → fica null → projeto pendente.
    atualizado_em: txt(row['Atualizado Em']),
  });
}

// ─── Atualização de projeto existente (somente campos seguros, diff-aware) ────
//
// `status` é DELIBERADAMENTE excluído: durante a validação, a planilha grava
// sempre "Pendente" (regra TEMPORÁRIA) — sincronizar de volta rebaixaria o
// status interno correto.
// OWNERSHIP (responsavel_email/nome + membros) AGORA SINCRONIZA do Sheets (fonte da
// verdade): editar Email/Participantes na planilha reatribui dono/participantes no
// GoDocs. `membros` (Participantes) é tratado fora desta tabela (precisa de parse de
// lista). Célula vazia nunca apaga dado existente.
const SAFE_UPDATE_FIELDS: ReadonlyArray<{
  col: SheetColumn;
  field: keyof ProjetoRow;
  kind: 'text' | 'num';
}> = [
  { col: 'Projeto', field: 'nome', kind: 'text' },
  { col: 'Email', field: 'responsavel_email', kind: 'text' },
  { col: 'Nome Completo', field: 'responsavel_nome', kind: 'text' },
  { col: 'Área', field: 'area', kind: 'text' },
  { col: 'Descrição', field: 'descricao_breve', kind: 'text' },
  { col: 'Ferramenta', field: 'ferramenta', kind: 'text' },
  { col: 'Escopo', field: 'escopo', kind: 'text' },
  { col: 'Alguém Fazia?', field: 'alguem_fazia', kind: 'text' },
  { col: 'Saving Horas', field: 'saving_horas', kind: 'num' },
  { col: 'Saving Reais', field: 'saving_reais', kind: 'num' },
  { col: 'Tipo de Saving', field: 'tipo_saving', kind: 'text' },
  { col: 'Memorial de Saving', field: 'memorial_calculo', kind: 'text' },
  { col: 'Custo Externo Mensal', field: 'custo_externo_mensal', kind: 'num' },
  { col: 'Ganho Total', field: 'ganho_total_mensal', kind: 'num' },
  { col: 'Complexidade', field: 'complexidade', kind: 'text' },
  { col: 'Observações', field: 'observacoes', kind: 'text' },
  // "Custo Evitado" guarda o VALOR R$ (não 'sim/não') e não tem coluna própria no
  // SQLite — não é sincronizado de volta para não gravar número no campo flag.
  { col: 'Justificativa Custo Evitado', field: 'custo_evitado_justificativa', kind: 'text' },
  { col: 'Contexto do Projeto Especial', field: 'contexto_especial', kind: 'text' },
  // Mantém o espelho do "Atualizado Em" fresco no SQLite (alimenta o selo de pendentes).
  { col: 'Atualizado Em', field: 'atualizado_em', kind: 'text' },
];

async function atualizarExistente(id: string, row: SheetRow): Promise<boolean> {
  const current = await getProjetoById(id);
  if (!current) return false;

  const updates: Record<string, unknown> = {};
  for (const { col, field, kind } of SAFE_UPDATE_FIELDS) {
    const raw = row[col];
    const newVal = kind === 'num' ? parseNum(raw) : txt(raw);
    if (newVal == null) continue; // célula vazia não apaga dado existente

    const curVal = (current as Record<string, unknown>)[field as string];
    if (kind === 'num') {
      const curNum = curVal == null || curVal === '' ? null : Number(curVal);
      if (curNum != null && Math.abs(curNum - (newVal as number)) < 0.005) continue;
    } else {
      if (curVal != null && String(curVal).trim() === String(newVal).trim()) continue;
    }
    updates[field as string] = newVal;
  }

  // Participantes → membros (lista de e-mails → array; updateProjeto serializa em JSON).
  // Mesma regra "vazio não apaga": Participantes vazio mantém os membros atuais.
  const membrosSheet = parseMembros(row['Participantes']);
  if (membrosSheet.length > 0) {
    const membrosAtuais = parseJson<string[]>(current.membros) ?? [];
    const mesmaLista =
      membrosSheet.length === membrosAtuais.length &&
      membrosSheet.every((m) => membrosAtuais.some((c) => c.toLowerCase() === m.toLowerCase()));
    if (!mesmaLista) updates['membros'] = membrosSheet;
  }

  if (Object.keys(updates).length === 0) return false;
  await updateProjeto(id, updates);
  return true;
}

// ─── Orquestrador ────────────────────────────────────────────────────────────

export async function syncSheetsToSqlite(): Promise<ReverseSyncResult> {
  const result: ReverseSyncResult = {
    total: 0,
    criados: 0,
    atualizados: 0,
    ignorados: 0,
    erros: 0,
    detalhes: [],
  };

  let rows: SheetRow[];
  try {
    rows = await readAllRows();
  } catch (e) {
    console.error('[sync-reverse] Falha ao ler a planilha:', e);
    result.erros = 1;
    result.detalhes.push(`Falha ao ler a planilha: ${(e as Error).message}`);
    return result;
  }

  const existingIds = new Set((await getAllProjetoIds()).map((x) => x.toLowerCase()));

  for (const row of rows) {
    const rawId = row['ID Projeto'];
    if (!rawId || !rawId.trim()) continue;
    const id = rawId.trim().toLowerCase();
    result.total++;
    try {
      if (existingIds.has(id)) {
        const changed = await atualizarExistente(id, row);
        if (changed) result.atualizados++;
        else result.ignorados++;
      } else {
        await criarLegado(id, row);
        existingIds.add(id);
        result.criados++;
      }
    } catch (e) {
      result.erros++;
      result.detalhes.push(`${id}: ${(e as Error).message}`);
      console.error(`[sync-reverse] Erro no projeto ${id}:`, e);
    }
  }

  console.log(
    `[sync-reverse] total=${result.total} criados=${result.criados} ` +
      `atualizados=${result.atualizados} ignorados=${result.ignorados} erros=${result.erros}`,
  );
  return result;
}

// ─── Sync sob demanda dos projetos de UM dono ────────────────────────────────
//
// Usado ao abrir "Meus Projetos": espelha do Sheets (fonte de verdade) só as
// linhas onde o usuário é responsável (col "Email") ou participante (col
// "Participantes"), para o legado aparecer imediatamente sem esperar o cron
// horário. Reusa criarLegado/atualizarExistente; nunca propaga erro (o caller
// deve cair de volta no SQLite se a planilha falhar).
export async function syncOwnerRowsFromSheet(
  email: string,
): Promise<ReverseSyncResult & { rows: SheetRow[] }> {
  const result: ReverseSyncResult = {
    total: 0,
    criados: 0,
    atualizados: 0,
    ignorados: 0,
    erros: 0,
    detalhes: [],
  };

  const alvo = email.trim().toLowerCase();
  if (!alvo) return { ...result, rows: [] };

  let rows: SheetRow[];
  try {
    rows = await readAllRows();
  } catch (e) {
    console.error('[sync-reverse:owner] Falha ao ler a planilha:', e);
    result.erros = 1;
    result.detalhes.push(`Falha ao ler a planilha: ${(e as Error).message}`);
    return { ...result, rows: [] };
  }

  const doDono = rows.filter((row) => {
    const responsavel = (row['Email'] ?? '').trim().toLowerCase();
    if (responsavel === alvo) return true;
    return parseMembros(row['Participantes']).some((m) => m.toLowerCase() === alvo);
  });

  const existingIds = new Set((await getAllProjetoIds()).map((x) => x.toLowerCase()));

  for (const row of doDono) {
    const rawId = row['ID Projeto'];
    if (!rawId || !rawId.trim()) continue;
    const id = rawId.trim().toLowerCase();
    result.total++;
    try {
      if (existingIds.has(id)) {
        const changed = await atualizarExistente(id, row);
        if (changed) result.atualizados++;
        else result.ignorados++;
      } else {
        await criarLegado(id, row);
        existingIds.add(id);
        result.criados++;
      }
    } catch (e) {
      result.erros++;
      result.detalhes.push(`${id}: ${(e as Error).message}`);
      console.error(`[sync-reverse:owner] Erro no projeto ${id}:`, e);
    }
  }

  console.log(
    `[sync-reverse:owner] email=${alvo} total=${result.total} criados=${result.criados} ` +
      `atualizados=${result.atualizados} ignorados=${result.ignorados} erros=${result.erros}`,
  );
  return { ...result, rows: doDono };
}
