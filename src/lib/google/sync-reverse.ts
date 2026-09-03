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
  getProjetosParaSyncReverso,
  insertProjetoRaw,
  insertSyncRun,
  updateProjeto,
  excluirProjetoCascade,
  parseJson,
  type ProjetoRow,
} from '@/integrations/db/client.server';
import { espelharLinhas, removerEspelhoAusentes } from '@/lib/sheet-espelho';

export type ReverseSyncResult = {
  total: number;
  criados: number;
  atualizados: number;
  removidos: number;
  ignorados: number;
  erros: number;
  detalhes: string[];
  /** Linhas gravadas no ESPELHO (as demais estavam idênticas — ver `sheet-espelho.ts`). */
  espelhados?: number;
  /** A leitura da planilha teve sucesso? `false` = nada foi espelhado nem removido. */
  ok?: boolean;
};

// ─── Leitura da planilha com RETRY ───────────────────────────────────────────
//
// Com as telas lendo o espelho, uma leitura perdida deixa TODO MUNDO vendo dado velho até
// a próxima corrida. E a falha mais comum aqui é transiente por natureza: `429` de cota
// (60 leituras/min compartilhadas com prod) e `503` do Sheets. Uma segunda tentativa 1 s
// depois resolve a maioria — sem retry, o incidente durava um ciclo inteiro de cron.

const TENTATIVAS_LEITURA = 3;
const ESPERA_RETRY_MS = [1000, 3000];

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function lerPlanilhaComRetry(
  tentativas = TENTATIVAS_LEITURA,
): Promise<{ rows: SheetRow[] } | { erro: Error }> {
  let ultimo: Error = new Error('leitura não tentada');
  for (let i = 0; i < tentativas; i++) {
    try {
      return { rows: await readAllRows() };
    } catch (e) {
      ultimo = e as Error;
      console.error(`[sync-reverse] leitura da planilha falhou (tentativa ${i + 1}/${tentativas}):`, e);
      const espera = ESPERA_RETRY_MS[i];
      if (i < tentativas - 1 && espera) await dormir(espera);
    }
  }
  return { erro: ultimo };
}

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
  // Rótulo gravado pela triagem no dashboard do admin — mesmo destino interno que
  // "rejeitado" (o CHECK do schema não tem 'reprovado').
  reprovado: 'rejeitado',
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

// Papel → coluna do Sheets (3). "Coautor" = coexecutor/"Coautor" (retrocompatível:
// legados tinham todos os membros lá); "Participante" = planejador/"Participante";
// "Contribuidor" = contribuidor/"Contribuidor". O `papel` é o `value` INTERNO
// (`coexecutor`/`planejador` mantidos). A ordem define o desempate quando um e-mail
// aparece em mais de uma coluna (não deveria — 1 papel por pessoa): a PRIMEIRA vence.
const COLUNA_PAPEL: ReadonlyArray<{ col: SheetColumn; papel: string }> = [
  { col: 'Coautor', papel: 'coexecutor' },
  { col: 'Participante', papel: 'planejador' },
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

/** A coluna "Status" (dropdown do Sheets) marca o projeto como DESCONTINUADO? */
function ehStatusDescontinuado(v: string | undefined): boolean {
  return (v ?? '').trim().toLowerCase() === 'descontinuado';
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

// A coluna "Saving Efetivado" passou a guardar o VALOR R$ (não mais 'sim'/'não').
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
  const tipos = parseList(row['Tipos de Ganho']).map((t) => t.toLowerCase());
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
    saving_horas: parseNum(row['Custo Evitado Horas']),
    saving_reais: parseNum(row['Impacto Bruto']),
    tipo_saving: txt(row['Freq. Custo Evitado']),
    memorial_calculo: txt(row['Memorial de Saving']),
    custo_externo_mensal: parseNum(row['Custo Externo Mensal']),
    ganho_total_mensal: parseNum(row['Impacto Líquido']),
    complexidade: txt(row['Complexidade']),
    alguem_fazia: txt(row['Alguém Fazia?']),
    observacoes: txt(row['Observações']),
    especial,
    contexto_especial: txt(row['Ganho Imensurável']),
    custo_evitado: custoEvitadoFlag(row['Saving Efetivado']),
    custo_evitado_justificativa: txt(row['Evidência Saving Efetivado']),
    // Legado marcado "Descontinuado" na planilha nasce descontinuado no SQLite.
    descontinuado: ehStatusDescontinuado(row['Status']) ? 1 : 0,
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
  /** Coluna cujo significado mudou na v2: só sincroniza de volta em linha v1 (ver laço abaixo). */
  soV1?: true;
}> = [
  { col: 'Projeto', field: 'nome', kind: 'text' },
  { col: 'Email', field: 'responsavel_email', kind: 'text' },
  { col: 'Nome Completo', field: 'responsavel_nome', kind: 'text' },
  { col: 'Área', field: 'area', kind: 'text' },
  { col: 'Descrição', field: 'descricao_breve', kind: 'text' },
  { col: 'Ferramenta', field: 'ferramenta', kind: 'text' },
  { col: 'Escopo', field: 'escopo', kind: 'text' },
  { col: 'Alguém Fazia?', field: 'alguem_fazia', kind: 'text' },
  { col: 'Custo Evitado Horas', field: 'saving_horas', kind: 'num' },
  { col: 'Impacto Bruto', field: 'saving_reais', kind: 'num' , soV1: true },
  { col: 'Freq. Custo Evitado', field: 'tipo_saving', kind: 'text' , soV1: true },
  { col: 'Memorial de Saving', field: 'memorial_calculo', kind: 'text' },
  { col: 'Custo Externo Mensal', field: 'custo_externo_mensal', kind: 'num' },
  { col: 'Impacto Líquido', field: 'ganho_total_mensal', kind: 'num' , soV1: true },
  { col: 'Complexidade', field: 'complexidade', kind: 'text' },
  { col: 'Observações', field: 'observacoes', kind: 'text' },
  // "Saving Efetivado" guarda o VALOR R$ (não 'sim/não') e não tem coluna própria no
  // SQLite — não é sincronizado de volta para não gravar número no campo flag.
  { col: 'Evidência Saving Efetivado', field: 'custo_evitado_justificativa', kind: 'text' , soV1: true },
  { col: 'Ganho Imensurável', field: 'contexto_especial', kind: 'text' , soV1: true },
  // Mantém o espelho do "Atualizado Em" fresco no SQLite (alimenta o selo de pendentes).
  { col: 'Atualizado Em', field: 'atualizado_em', kind: 'text' },
];

// Um projeto convertido de especial → financeiro no app tem, no SQLite, tipos_projeto
// com um tipo NÃO-especial (saving/receita), gravado por atualizarTipos no ato da
// conversão. Serve para o sync reverso NÃO re-forçar especial a partir de uma célula
// "Especial?"=Sim que ainda não foi atualizada na planilha (ela só vira "Não" no submit).
function jaConvertidoParaFinanceiro(current: ProjetoRow): boolean {
  const tipos = (parseJson<string[]>(current.tipos_projeto) ?? []).map((t) =>
    String(t).trim().toLowerCase(),
  );
  return tipos.length > 0 && !tipos.includes('especial');
}

/**
 * Projeto do banco como o diff precisa dele. Vem da carga em LOTE
 * (`getProjetosParaSyncReverso`) — ver o `atualizarExistente`.
 */
type ProjetoParaDiff = Partial<ProjetoRow> & { id: string };

async function atualizarExistente(
  id: string,
  row: SheetRow,
  // ⚠️ Injetado pela carga em LOTE do orquestrador. O fallback `getProjetoById` só existe
  // para o caminho de UM dono (`syncOwnerRowsFromSheet`, que não vale carregar a tabela
  // inteira) — nunca para dentro do laço do sync global, que era o N+1 de antes.
  currentInjetado?: ProjetoParaDiff,
): Promise<boolean> {
  const current = (currentInjetado ?? (await getProjetoById(id))) as ProjetoRow | undefined;
  if (!current) return false;

  const updates: Record<string, unknown> = {};
  // Linha v2 (tem "Impacto Líquido Mensal") — as colunas renomeadas têm significado v2
  // (Impacto Bruto = S+CE+R, Ganho Imensurável ≠ contexto de especial): gravá-las nos campos v1
  // do SQLite dava coluna com dois significados (achado da revisão de qualidade). Pula-as.
  const linhaV2 = txt(row['Impacto Líquido Mensal']) != null;
  for (const { col, field, kind, soV1 } of SAFE_UPDATE_FIELDS) {
    if (soV1 && linhaV2) continue;
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

  // "Especial?" + "Tipos de Ganho": o Sheet é a fonte da verdade do TIPO do projeto.
  // Ficam FORA de SAFE_UPDATE_FIELDS porque precisam de parse próprio e de efeitos
  // colaterais. Sem isto, uma edição "especial → saving/receita" deixava o SQLite
  // preso em especial=1 / tipos_projeto=['especial'] (o flag nunca voltava do Sheet),
  // e o projeto reabria no fluxo de edição ESPECIAL errado, sem puxar o saving já
  // preenchido. (caso AVD Central v2 / Helen — bug do "especial sticky" pré-fix.)
  const especialSheet = parseEspecialFlag(row['Especial?']); // 1 | 0 | null (vazio = não mexe)
  if (especialSheet != null && especialSheet !== (current.especial ?? 0)) {
    if (especialSheet === 0) {
      // Deixou de ser especial → tipos vêm de "Tipos de Ganho"; contexto especial limpa.
      // (o loop SAFE pula "—"/vazio porque txt() → null, então a limpeza é explícita.)
      // Aplica SEMPRE — é o sentido que corrige o "especial sticky" (caso Helen).
      updates['especial'] = 0;
      updates['contexto_especial'] = null;
      const tipos = parseList(row['Tipos de Ganho']).map((t) => t.toLowerCase());
      if (tipos.length) {
        updates['tipos_projeto'] = tipos;
        updates['tipo_projeto'] = tipos[0];
      }
    } else if (!jaConvertidoParaFinanceiro(current)) {
      // Virou especial → tipo único 'especial'.
      updates['especial'] = 1;
      updates['tipos_projeto'] = ['especial'];
      updates['tipo_projeto'] = 'especial';
    }
    // else: a planilha diz "Sim", mas o SQLite JÁ foi convertido para saving/receita no
    // app. A conversão (atualizarTipos) zera especial no ato; a célula "Especial?" só
    // vira "Não" no submit. Entre a conversão e o submit, este cron horário lia "Sim" e
    // re-forçava especial=1 — reconstruindo a doc especial e APAGANDO o saving em
    // andamento (caso Hugo/legado-038, 2ª recorrência do bug). Tratamos a "Sim" como
    // STALE e não mexemos; o próximo submit do usuário grava "Não" na planilha. Só afeta
    // o sentido "Sim → especial"; "Não → não-especial" (fix da Helen) segue aplicado.
  }

  // "Descontinuado" (dropdown do Sheets) → flag no SQLite. Promoção de MÃO ÚNICA: o app
  // grava "Descontinuado" na planilha ao descontinuar (a flag SQLite é a fonte da
  // verdade), mas marcar manualmente na planilha também precisa refletir aqui. NÃO
  // desmarca pela planilha — a IDA grava sempre "Pendente" (regra TEMPORÁRIA), então
  // "Pendente" é ambíguo (≠ "reativado"); reativar é ação do app (que limpa a flag).
  if (ehStatusDescontinuado(row['Status']) && current.descontinuado !== 1) {
    updates['descontinuado'] = 1;
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

/**
 * Corrida completa da volta: planilha → **espelho** (o que as telas leem) + planilha →
 * `projetos` (criação de legado, campos seguros, especial/descontinuado) + remoção do que
 * sumiu da aba, dos dois lados.
 *
 * @param gatilho de onde veio a corrida — só para o registro em `sync_runs`, que é como se
 *                descobre "o sync parou de rodar" sem abrir log.
 */
export async function syncSheetsToSqlite(
  gatilho: 'cron' | 'manual' | 'sob-demanda' = 'cron',
): Promise<ReverseSyncResult> {
  const result: ReverseSyncResult = {
    total: 0,
    criados: 0,
    atualizados: 0,
    removidos: 0,
    ignorados: 0,
    erros: 0,
    detalhes: [],
    espelhados: 0,
    ok: false,
  };
  // ⚠️ Carimbado ANTES da leitura: é o relógio que decide se um remendo nosso
  // (`espelharEscrita`) é mais novo que o snapshot que temos em mãos. Ver `sheet-espelho.ts`.
  const inicio = Date.now();

  const leitura = await lerPlanilhaComRetry();
  if ('erro' in leitura) {
    // Leitura falhou → NÃO espelha e NÃO remove nada (o espelho antigo segue servindo).
    result.erros = 1;
    result.detalhes.push(`Falha ao ler a planilha: ${leitura.erro.message}`);
    await registrarCorrida(gatilho, result, inicio, leitura.erro.message);
    return result;
  }
  const rows = leitura.rows;

  // ─── 1. ESPELHO (o que as telas leem) ──────────────────────────────────────
  // Vem primeiro de propósito: é o caminho de que a UI depende, e ele não precisa de
  // nenhuma escrita em `projetos` para servir a tela.
  const espelho = await espelharLinhas(rows, inicio);
  result.espelhados = espelho.espelhados;
  result.erros += espelho.erros;

  // ─── 2. `projetos` (legados, campos seguros, especial/descontinuado) ───────
  const existingIds = new Set((await getAllProjetoIds()).map((x) => x.toLowerCase()));
  // Carga em LOTE: uma consulta para o diff de todas as linhas, em vez de um
  // `getProjetoById` por linha (eram ~600 round-trips por corrida).
  const porId = new Map<string, ProjetoParaDiff>();
  for (const p of await getProjetosParaSyncReverso()) porId.set(p.id.toLowerCase(), p);

  for (const row of rows) {
    const rawId = row['ID Projeto'];
    if (!rawId || !rawId.trim()) continue;
    const id = rawId.trim().toLowerCase();
    result.total++;
    try {
      if (existingIds.has(id)) {
        const changed = await atualizarExistente(id, row, porId.get(id));
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

  // ─── 3. Reconciliação de exclusão (Sheets = fonte do que APARECE) ──────────
  // Projeto NÃO-rascunho que sumiu da planilha sai do SQLite **e** do espelho. Só roda se
  // a leitura trouxe linhas (planilha vazia = suspeito → não apaga nada).
  const sheetIds = idsDaPlanilha(rows);
  if (sheetIds.size > 0) {
    await reconciliarExclusoes(sheetIds, await getProjetosNaoRascunho(), Date.now(), result);
    // O espelho é o que a tela LÊ: se a linha do espelho ficasse para trás, o projeto
    // apagado da aba continuaria aparecendo na triagem (era o "projeto morto na lista").
    // Aqui não há carência: sem linha na planilha não há o que mostrar.
    const foraDoEspelho = await removerEspelhoAusentes(sheetIds);
    if (foraDoEspelho > 0) result.detalhes.push(`espelho: ${foraDoEspelho} linha(s) removida(s)`);
  }

  result.ok = true;
  await registrarCorrida(gatilho, result, inicio, null);

  console.log(
    `[sync-reverse] total=${result.total} espelhados=${result.espelhados} criados=${result.criados} ` +
      `atualizados=${result.atualizados} removidos=${result.removidos} ` +
      `ignorados=${result.ignorados} erros=${result.erros}`,
  );
  return result;
}

/**
 * Registra a corrida em `sync_runs`. Nunca propaga erro: o registro é observabilidade — não
 * pode desfazer um sync que já aconteceu (mesma régua da auditoria de status do dashboard).
 */
async function registrarCorrida(
  gatilho: string,
  r: ReverseSyncResult,
  inicio: number,
  detalhe: string | null,
): Promise<void> {
  try {
    await insertSyncRun({
      gatilho,
      ok: r.ok ? 1 : 0,
      total: r.total,
      espelhados: r.espelhados ?? 0,
      criados: r.criados,
      atualizados: r.atualizados,
      removidos: r.removidos,
      erros: r.erros,
      duracao_ms: Date.now() - inicio,
      detalhe,
    });
  } catch (e) {
    console.error('[sync-reverse] falha ao registrar a corrida em sync_runs:', e);
  }
}

// ─── Sync sob demanda dos projetos de UM dono ────────────────────────────────
//
// Usado ao abrir "Meus Projetos": espelha do Sheets (fonte de verdade) só as
// linhas onde o usuário é responsável (col "Email") ou participante (col
// "Coautor"), para o legado aparecer imediatamente sem esperar o cron
// horário. Reusa criarLegado/atualizarExistente; nunca propaga erro (o caller
// deve cair de volta no SQLite se a planilha falhar).
// `leituraOk` distingue "a planilha respondeu" de "este usuário não tem projeto" —
// os dois devolvem `rows: []`. Quem CACHEIA o resultado (`meus-projetos-cache.ts`)
// precisa da diferença: instalar um `[]` de falha apagaria a coluna Status de todo
// mundo por um minuto. Campo ADITIVO; os demais chamadores o ignoram.
export async function syncOwnerRowsFromSheet(
  email: string,
): Promise<ReverseSyncResult & { rows: SheetRow[]; leituraOk: boolean }> {
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
  if (!alvo) return { ...result, rows: [], leituraOk: false };
  const inicio = Date.now();

  const leitura = await lerPlanilhaComRetry();
  if ('erro' in leitura) {
    result.erros = 1;
    result.detalhes.push(`Falha ao ler a planilha: ${leitura.erro.message}`);
    return { ...result, rows: [], leituraOk: false };
  }
  const rows = leitura.rows;

  const doDono = rows.filter((row) => {
    const responsavel = (row['Email'] ?? '').trim().toLowerCase();
    if (responsavel === alvo) return true;
    // Participante em QUALQUER papel (as 4 colunas), não só "Coautor".
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

  // Espelha as linhas DESTE dono (não a planilha toda: isto roda no caminho de um request,
  // e a corrida completa é do cron). Sem remoção no espelho aqui — quem reconcilia o
  // espelho inteiro é `syncSheetsToSqlite`, com a planilha inteira em mãos.
  const espelho = await espelharLinhas(doDono, inicio);
  result.espelhados = espelho.espelhados;
  result.erros += espelho.erros;

  console.log(
    `[sync-reverse:owner] email=${alvo} total=${result.total} criados=${result.criados} ` +
      `atualizados=${result.atualizados} removidos=${result.removidos} ` +
      `ignorados=${result.ignorados} erros=${result.erros}`,
  );
  return { ...result, rows: doDono, leituraOk: true };
}
