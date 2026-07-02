// Sync reverso: Google Sheets (fonte de verdade) → SQLite.
//
// Roda de hora em hora (cron) para refletir no SQLite:
//   1. Projetos LEGADOS que só existem na planilha → cria a linha no SQLite
//      (habilita "Meus Projetos" e edição para os donos).
//   2. Edições manuais na planilha de projetos já existentes → atualiza apenas
//      campos seguros (diff-aware), sem apagar dados ricos do SQLite.
//   3. Linhas APAGADAS da planilha → remove o projeto espelhado do SQLite (cascata).
//      O Sheets é a fonte da verdade do que aparece em "Meus Projetos"; um projeto
//      que sumiu de lá não pode continuar poluindo a tela. RASCUNHO fica de fora
//      (estado interno do app — o SQLite é a fonte dele). Ver reconciliarExclusoes.
//
// Nunca propaga erros — tudo é logado via console.error e contabilizado no
// resultado. Match por "ID Projeto" (coluna B), case-insensitive (ids do SQLite
// são minúsculos; legados na planilha às vezes em MAIÚSCULAS).

import { readAllRows, type SheetColumn, type SheetRow } from './sheets';
import { toIsoOrNull, parseDataFlexivel } from '@/lib/format-date';
import {
  getAllProjetoIds,
  getProjetoById,
  getProjetosByOwnerEmail,
  getProjetosNaoRascunho,
  insertProjetoRaw,
  updateProjeto,
  excluirProjetoCascade,
  parseJson,
  type ProjetoRow,
} from '@/integrations/db/client.server';

export type ReverseSyncResult = {
  total: number;
  criados: number;
  atualizados: number;
  removidos: number;
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

// Papel → coluna do Sheets (3). "Participantes" = coexecutor/"Coautor" (retrocompatível:
// legados tinham todos os membros lá); "Participantes 2" = planejador/"Participante";
// "Contribuidor" = contribuidor/"Contribuidor". O `papel` é o `value` INTERNO
// (`coexecutor`/`planejador` mantidos). A ordem define o desempate quando um e-mail
// aparece em mais de uma coluna (não deveria — 1 papel por pessoa): a PRIMEIRA vence.
const COLUNA_PAPEL: ReadonlyArray<{ col: SheetColumn; papel: string }> = [
  { col: 'Participantes', papel: 'coexecutor' },
  { col: 'Participantes 2', papel: 'planejador' },
  { col: 'Contribuidor', papel: 'contribuidor' },
];

// Lê as 4 colunas de papel → lista PLANA de participantes (dedup por caixa, base do
// ownership) + mapa e-mail→papel. Vazio quando as 4 colunas estão vazias.
function parseParticipantesPapeis(row: SheetRow): { membros: string[]; papeis: Record<string, string> } {
  const membros: string[] = [];
  const vistos = new Set<string>();
  const papeis: Record<string, string> = {};
  for (const { col, papel } of COLUNA_PAPEL) {
    for (const email of parseMembros(row[col])) {
      const chave = email.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      membros.push(email);
      papeis[email] = papel;
    }
  }
  return { membros, papeis };
}

// Assinatura canônica do mapa de papéis (chave em caixa baixa, ordenada) — comparação
// estável e independente de ordem/caixa, p/ não gerar update espúrio a cada sync.
function assinaturaPapeis(m: Record<string, string>): string {
  return Object.entries(m).map(([e, p]) => `${e.toLowerCase()}=${p}`).sort().join('|');
}

function parseEspecial(v: string | undefined): number {
  return (v ?? '').trim().toLowerCase().startsWith('s') ? 1 : 0;
}

/**
 * Flag "Especial?" do Sheet → 1 | 0 | null.
 * Diferente de `parseEspecial`, distingue célula VAZIA (null → "não mexe") de um
 * "Não" explícito (0). Usado no sync reverso de projetos JÁ existentes para não
 * forçar especial=0 quando a coluna está em branco (regra "vazio não apaga").
 */
function parseEspecialFlag(v: string | undefined): 0 | 1 | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s || s === '—' || s === '-') return null;
  return s.startsWith('s') ? 1 : 0;
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
  const { membros, papeis } = parseParticipantesPapeis(row);
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
    membros_papeis: Object.keys(papeis).length ? papeis : null,
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

  // Participantes + papéis → membros (lista plana) + membros_papeis (mapa). As 3
  // colunas de papel (Participantes=Coautor + Participantes 2=Participante + Contribuidor)
  // são a fonte. Mesma regra "vazio não apaga": se as 3 estiverem vazias, mantém os
  // membros/papéis atuais.
  const { membros: membrosSheet, papeis: papeisSheet } = parseParticipantesPapeis(row);
  if (membrosSheet.length > 0) {
    const membrosAtuais = parseJson<string[]>(current.membros) ?? [];
    const mesmaLista =
      membrosSheet.length === membrosAtuais.length &&
      membrosSheet.every((m) => membrosAtuais.some((c) => c.toLowerCase() === m.toLowerCase()));
    if (!mesmaLista) updates['membros'] = membrosSheet;
    // Distribuição de papéis: atualiza quando muda (comparação estável por assinatura).
    const papeisAtuais = parseJson<Record<string, string>>(current.membros_papeis) ?? {};
    if (assinaturaPapeis(papeisAtuais) !== assinaturaPapeis(papeisSheet)) {
      updates['membros_papeis'] = papeisSheet;
    }
  }

  // "Especial?" + "Tipos Projeto": o Sheet é a fonte da verdade do TIPO do projeto.
  // Ficam FORA de SAFE_UPDATE_FIELDS porque precisam de parse próprio e de efeitos
  // colaterais. Sem isto, uma edição "especial → saving/receita" deixava o SQLite
  // preso em especial=1 / tipos_projeto=['especial'] (o flag nunca voltava do Sheet),
  // e o projeto reabria no fluxo de edição ESPECIAL errado, sem puxar o saving já
  // preenchido. (caso AVD Central v2 / Helen — bug do "especial sticky" pré-fix.)
  const especialSheet = parseEspecialFlag(row['Especial?']); // 1 | 0 | null (vazio = não mexe)
  if (especialSheet != null && especialSheet !== (current.especial ?? 0)) {
    updates['especial'] = especialSheet;
    if (especialSheet === 0) {
      // Deixou de ser especial → tipos vêm de "Tipos Projeto"; contexto especial limpa.
      // (o loop SAFE pula "—"/vazio porque txt() → null, então a limpeza é explícita.)
      updates['contexto_especial'] = null;
      const tipos = parseList(row['Tipos Projeto']).map((t) => t.toLowerCase());
      if (tipos.length) {
        updates['tipos_projeto'] = tipos;
        updates['tipo_projeto'] = tipos[0];
      }
    } else {
      // Virou especial → tipo único 'especial'.
      updates['tipos_projeto'] = ['especial'];
      updates['tipo_projeto'] = 'especial';
    }
  }

  if (Object.keys(updates).length === 0) return false;
  await updateProjeto(id, updates);
  return true;
}

// ─── Reconciliação de EXCLUSÃO (Sheets é a fonte da verdade do que aparece) ───
//
// Quando uma linha é APAGADA da planilha, o projeto espelhado no SQLite precisa
// sumir junto — senão ele continua poluindo "Meus Projetos". Como o sync só sabia
// criar/atualizar, o registro ficava órfão. Aqui removemos (cascata) os projetos
// NÃO-rascunho que existem no SQLite mas não estão mais na planilha.
//
// Salvaguardas:
//  • RASCUNHO nunca é tocado — é estado interno do app (o SQLite é a fonte dele,
//    para a pessoa retomar o preenchimento); rascunho jamais vai ao Sheets.
//  • JANELA DE CARÊNCIA: uma submissão feita pelo app nasce no SQLite e só depois
//    (em background) é gravada na planilha. Não removemos projetos cujo último
//    carimbo (submitted_at/updated_at) seja recente — senão mataríamos uma
//    submissão que ainda não teve tempo de chegar ao Sheets.
//  • O caller só chama isto quando a leitura da planilha teve SUCESSO e veio com
//    linhas (planilha vazia/erro = suspeito → não remove nada).

const CARENCIA_EXCLUSAO_MS = 60 * 60 * 1000; // 1h: protege submissão recém-feita (append em background)

/**
 * ISO (`...Z`), `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, UTC sem Z) ou data
 * pt-BR (`dd/mm/yyyy [HH:MM:SS]`) → epoch ms (UTC).
 *
 * ⚠️ Usa `parseDataFlexivel` em vez de `Date.parse` porque os legados gravam
 * `submitted_at` em pt-BR ("12/05/2026"), e `Date.parse` o interpreta como
 * MM/DD (5 de dezembro) — um carimbo no FUTURO. Isso fazia `agora − carimbo`
 * ficar negativo, deixando o órfão SEMPRE "dentro da carência" → nunca era
 * reconciliado (status cinza eterno em "Meus Projetos").
 */
function carimboMs(v: unknown): number | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  return parseDataFlexivel(s)?.getTime() ?? null;
}

/**
 * Remove do SQLite os projetos NÃO-rascunho ausentes da planilha.
 * @param sheetIds  ids (lowercase) presentes na planilha — denominador da verdade.
 * @param candidatos projetos do SQLite a verificar (já filtrados p/ não-rascunho).
 * @param agora     epoch ms de referência (injetável p/ teste).
 */
async function reconciliarExclusoes(
  sheetIds: Set<string>,
  candidatos: ReadonlyArray<Pick<ProjetoRow, 'id' | 'status' | 'submitted_at' | 'updated_at'>>,
  agora: number,
  result: ReverseSyncResult,
): Promise<void> {
  for (const p of candidatos) {
    if ((p.status ?? '') === 'rascunho') continue; // defensivo: rascunho nunca some
    const id = p.id.toLowerCase();
    if (sheetIds.has(id)) continue; // ainda existe na planilha → mantém

    const recente = Math.max(carimboMs(p.submitted_at) ?? 0, carimboMs(p.updated_at) ?? 0);
    if (recente && agora - recente < CARENCIA_EXCLUSAO_MS) {
      result.detalhes.push(`${id}: ausente do Sheets, mas recente — mantido (carência)`);
      continue;
    }

    try {
      await excluirProjetoCascade(p.id);
      result.removidos++;
      result.detalhes.push(`${id}: removido (ausente do Sheets)`);
    } catch (e) {
      result.erros++;
      result.detalhes.push(`${id}: falha ao remover — ${(e as Error).message}`);
      console.error(`[sync-reverse] Erro ao remover ${id}:`, e);
    }
  }
}

/** Conjunto de ids (lowercase) presentes nas linhas da planilha (ignora linhas sem ID). */
function idsDaPlanilha(rows: ReadonlyArray<SheetRow>): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    const raw = row['ID Projeto'];
    if (raw && raw.trim()) set.add(raw.trim().toLowerCase());
  }
  return set;
}

// ─── Orquestrador ────────────────────────────────────────────────────────────

export async function syncSheetsToSqlite(): Promise<ReverseSyncResult> {
  const result: ReverseSyncResult = {
    total: 0,
    criados: 0,
    atualizados: 0,
    removidos: 0,
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

  // Reconciliação de exclusão: projeto NÃO-rascunho que sumiu da planilha sai do
  // SQLite. Só roda se a leitura trouxe linhas (planilha vazia = suspeito → não apaga).
  const sheetIds = idsDaPlanilha(rows);
  if (sheetIds.size > 0) {
    await reconciliarExclusoes(sheetIds, await getProjetosNaoRascunho(), Date.now(), result);
  }

  console.log(
    `[sync-reverse] total=${result.total} criados=${result.criados} ` +
      `atualizados=${result.atualizados} removidos=${result.removidos} ` +
      `ignorados=${result.ignorados} erros=${result.erros}`,
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
    removidos: 0,
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
    // Participante em QUALQUER papel (as 4 colunas), não só "Participantes".
    return parseParticipantesPapeis(row).membros.some((m) => m.toLowerCase() === alvo);
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

  // Reconciliação de exclusão, escopada a ESTE dono: remove do SQLite os projetos
  // dele que sumiram da planilha. Usa os ids do Sheet INTEIRO (não só `doDono`) —
  // assim um projeto que apenas trocou de dono na planilha (continua existindo, mas
  // some do recorte deste usuário) NÃO é apagado por engano. Só roda com planilha
  // não-vazia (leitura suspeita = não apaga nada).
  const sheetIds = idsDaPlanilha(rows);
  if (sheetIds.size > 0) {
    await reconciliarExclusoes(sheetIds, await getProjetosByOwnerEmail(email), Date.now(), result);
  }

  console.log(
    `[sync-reverse:owner] email=${alvo} total=${result.total} criados=${result.criados} ` +
      `atualizados=${result.atualizados} removidos=${result.removidos} ` +
      `ignorados=${result.ignorados} erros=${result.erros}`,
  );
  return { ...result, rows: doDono };
}
