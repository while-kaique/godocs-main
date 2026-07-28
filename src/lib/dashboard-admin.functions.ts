/**
 * Dashboard do admin — a planilha como fonte de verdade.
 *
 * A tela antiga lia `getProjetosWithArea()` (SQLite) e por isso mostrava rascunho e
 * status interno desatualizado: o "Status" que vale é o da coluna do Sheets, mantido
 * à mão pela triagem (o sync reverso inclusive EXCLUI `status` dos campos que voltam
 * para o SQLite). Aqui a lista vem de `readAllRows()` — a mesma leitura que o disparo
 * de e-mails usa — então o dashboard reflete exatamente o que a triagem vê.
 *
 * Consequências dessa escolha:
 * - **Rascunho não aparece** (nunca vai à planilha) — é o comportamento desejado.
 * - Colunas manuais (Diff Horas / Diff Saving, Observações da revisão) chegam junto,
 *   sem precisar de espelho no banco.
 * - Toda coluna é chaveada pelo NOME REAL do cabeçalho, então reordenar/inserir coluna
 *   na planilha não quebra a tela (mesma garantia de `google/sheets.ts`).
 *
 * Custo: uma leitura de planilha é lenta (~1–3 s). Por isso há cache curto em memória
 * com *single-flight* (N admins carregando ao mesmo tempo = 1 leitura), e a mudança de
 * status corrige a linha no cache em vez de reler tudo.
 */
import { z } from 'zod';
import { readAllRows, updateRowByProjectId, type SheetRow } from '@/lib/google/sheets';
import { parseDataFlexivel } from '@/lib/format-date';
import { insertAdminStatusLog, getAdminStatusLogs } from '@/integrations/db/client.server';

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Status que a tela pode GRAVAR na planilha, na ordem em que aparecem na triagem.
 * ⚠️ Estes textos precisam existir na validação de dados (dropdown) da coluna
 * "Status" — escrever um valor fora do dropdown não falha, mas deixa a célula
 * marcada como inválida para quem abre a planilha.
 */
export const STATUS_GRAVAVEIS = [
  'Pendente',
  'Em validação',
  'Aprovado',
  'Reenvio Pendente',
  'Reprovado',
  'Descontinuado',
] as const;
export type StatusGravavel = (typeof STATUS_GRAVAVEIS)[number];

/**
 * Chave normalizada do status (minúsculas, sem espaço sobrando) — é a mesma chave que
 * o `StatusBadge` consome, então rótulo/ícone/cor saem de um lugar só. Célula vazia
 * (ou "—") → `null`, que o badge mostra como "—". NUNCA cai no status do SQLite.
 */
export function chaveStatus(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  if (s === '' || s === '—' || s === '-') return null;
  return s.toLowerCase();
}

// ─── Parsers de célula ───────────────────────────────────────────────────────

/** Texto da célula: trim, tratando vazio / "—" / "-" como ausência. */
export function texto(valor: string | undefined): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  return s === '' || s === '—' || s === '-' ? null : s;
}

/**
 * Número pt-BR tolerante: "R$ 1.234,56", "418,2" e "10.5". Regra: se há vírgula, ela é
 * o decimal e o ponto é milhar; só ponto → decimal. (Mesma regra do sync reverso.)
 */
export function numero(valor: string | undefined): number | null {
  if (valor == null) return null;
  let s = String(valor)
    .trim()
    .replace(/r\$\s*/gi, '')
    .replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function ehSim(valor: string | undefined): boolean {
  const s = texto(valor)?.toLowerCase() ?? '';
  return s === 'sim' || s === 's' || s === 'true' || s === '1';
}

/**
 * Índice de busca: minúsculas e SEM acento, para "reembolso" achar "Reembôlso" e
 * "helen" achar "Helén". É pré-computado no servidor (uma vez por leitura) para a
 * filtragem no cliente ser só `includes` — a busca precisa responder na tecla.
 */
export function chaveBusca(...partes: (string | null | undefined)[]): string {
  return partes
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ─── Tipos expostos ao frontend ──────────────────────────────────────────────

/**
 * Linha da tabela. Deliberadamente ENXUTA: os memoriais e as justificativas somam
 * vários KB por projeto e só são necessários no detalhe — mandar tudo na listagem
 * faria a tela baixar megabytes para exibir 25 linhas.
 */
export type ProjetoDashboardResumo = {
  id: string;
  nome: string | null;
  autor: string | null;
  email: string | null;
  area: string | null;
  status: string | null; // valor cru da planilha (para regravar sem perder o texto)
  statusChave: string | null; // normalizado (StatusBadge)
  dataSubmissao: string | null;
  dataOrdenacao: number | null; // epoch ms — ordenação estável no cliente
  ganhoTotal: number | null;
  savingReais: number | null;
  receitaMensal: number | null;
  savingHoras: number | null;
  complexidade: string | null;
  tipos: string | null;
  ferramenta: string | null;
  especial: boolean;
  atualizadoEm: string | null;
  observacoes: string | null;
  busca: string;
};

export type ListagemDashboard = {
  projetos: ProjetoDashboardResumo[];
  contagem: Record<string, number>; // statusChave → total ('sem_status' quando vazio)
  total: number;
  lidoEm: string; // ISO — quando a planilha foi lida (o cache pode servir leitura anterior)
  doCache: boolean;
};

export type DetalheDashboard = {
  id: string;
  /** Todas as células não-vazias da linha, chaveadas pelo nome real da coluna. */
  campos: Record<string, string>;
  /** Mudanças de status feitas por esta tela (a planilha não guarda autoria). */
  historico: {
    status_anterior: string | null;
    status_novo: string;
    observacoes: string | null;
    admin_email: string;
    created_at: string | null;
  }[];
};

// ─── Cache com single-flight ─────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;

type Cache = { rows: SheetRow[]; lidoEm: number };
let cache: Cache | null = null;
let leituraEmCurso: Promise<Cache> | null = null;

/**
 * Lê a planilha respeitando o cache. `refresh` força a releitura (botão "Atualizar").
 * Enquanto uma leitura está em curso, chamadas concorrentes esperam a MESMA promise —
 * três admins abrindo a tela juntos geram uma requisição ao Sheets, não três.
 */
async function lerPlanilha(refresh: boolean): Promise<{ cache: Cache; doCache: boolean }> {
  if (!refresh && cache && Date.now() - cache.lidoEm < CACHE_TTL_MS) {
    return { cache, doCache: true };
  }
  if (!refresh && leituraEmCurso) {
    return { cache: await leituraEmCurso, doCache: true };
  }
  const promessa = (async () => {
    const rows = await readAllRows();
    const novo: Cache = { rows, lidoEm: Date.now() };
    cache = novo;
    return novo;
  })();
  leituraEmCurso = promessa;
  try {
    return { cache: await promessa, doCache: false };
  } finally {
    if (leituraEmCurso === promessa) leituraEmCurso = null;
  }
}

/** Descarta o cache (botão de atualizar força pelo `refresh`; usado também nos testes). */
export function invalidarCacheDashboard() {
  cache = null;
  leituraEmCurso = null;
}

// ─── Mapeamento ──────────────────────────────────────────────────────────────

export function mapResumo(row: SheetRow): ProjetoDashboardResumo | null {
  const id = texto(row['ID Projeto']);
  if (!id) return null; // linha sem ID não é projeto (separador, rodapé, lixo)

  const nome = texto(row['Projeto']);
  const autor = texto(row['Nome Completo']);
  const email = texto(row['Email']);
  const area = texto(row['Área']);
  const ferramenta = texto(row['Ferramenta']);
  const dataSubmissao = texto(row['Data Submissão']);
  const d = parseDataFlexivel(dataSubmissao);

  return {
    id,
    nome,
    autor,
    email,
    area,
    status: texto(row['Status']),
    statusChave: chaveStatus(row['Status']),
    dataSubmissao,
    dataOrdenacao: d ? d.getTime() : null,
    ganhoTotal: numero(row['Ganho Total']),
    savingReais: numero(row['Saving Reais']),
    receitaMensal: numero(row['Receita Mensal']),
    savingHoras: numero(row['Saving Horas']),
    complexidade: texto(row['Complexidade']),
    tipos: texto(row['Tipos Projeto']),
    ferramenta,
    especial: ehSim(row['Especial?']),
    atualizadoEm: texto(row['Atualizado Em']),
    observacoes: texto(row['Observações']),
    // O que a busca alcança: nome do projeto, autor, e-mail, id, área e ferramenta.
    busca: chaveBusca(nome, autor, email, id, area, ferramenta),
  };
}

/** Ordena por data de submissão (mais recente primeiro); sem data vai para o fim. */
export function ordenarPorDataDesc(a: ProjetoDashboardResumo, b: ProjetoDashboardResumo): number {
  if (a.dataOrdenacao == null && b.dataOrdenacao == null) {
    return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  }
  if (a.dataOrdenacao == null) return 1;
  if (b.dataOrdenacao == null) return -1;
  return b.dataOrdenacao - a.dataOrdenacao;
}

export function contarPorStatus(projetos: ProjetoDashboardResumo[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of projetos) {
    const k = p.statusChave ?? 'sem_status';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export async function listarProjetosDashboard(refresh = false): Promise<ListagemDashboard> {
  const { cache: c, doCache } = await lerPlanilha(refresh);
  const projetos = c.rows
    .map(mapResumo)
    .filter((p): p is ProjetoDashboardResumo => p != null)
    .sort(ordenarPorDataDesc);

  return {
    projetos,
    contagem: contarPorStatus(projetos),
    total: projetos.length,
    lidoEm: new Date(c.lidoEm).toISOString(),
    doCache,
  };
}

function acharLinha(rows: SheetRow[], id: string): SheetRow | undefined {
  const alvo = id.trim().toLowerCase();
  return rows.find((r) => (r['ID Projeto'] ?? '').trim().toLowerCase() === alvo);
}

/**
 * Detalhe de um projeto: a linha INTEIRA da planilha (todas as células preenchidas).
 * Sai do mesmo cache da listagem, então abrir o detalhe é instantâneo e não gera
 * leitura nova. O frontend agrupa os campos; colunas que não conhecemos aparecem
 * numa seção "Outras colunas" em vez de desaparecerem.
 */
export async function getProjetoDashboard(id: string): Promise<DetalheDashboard> {
  z.string().min(1).max(120).parse(id);
  const { cache: c } = await lerPlanilha(false);
  const alvo = acharLinha(c.rows, id);
  if (!alvo) {
    throw Object.assign(new Error('Projeto não encontrado na planilha.'), { status: 404 });
  }
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(alvo)) {
    const val = texto(v as string | undefined);
    if (val) campos[k] = val;
  }

  // O histórico é acessório: se a tabela de auditoria falhar, o detalhe ainda abre.
  let historico: DetalheDashboard['historico'] = [];
  try {
    historico = (await getAdminStatusLogs(id)).map((l) => ({
      status_anterior: l.status_anterior,
      status_novo: l.status_novo,
      observacoes: l.observacoes,
      admin_email: l.admin_email,
      created_at: l.created_at,
    }));
  } catch (e) {
    console.error('[dashboard-admin] falha ao ler histórico de status:', e);
  }

  return { id, campos, historico };
}

const statusSchema = z.object({
  projeto_id: z.string().min(1).max(120),
  status: z.enum(STATUS_GRAVAVEIS),
  // Motivo da revisão: vai para a coluna "Observações", que é o texto que o disparo de
  // e-mails de reenvio manda para o dono. `undefined` = não mexer na célula.
  observacoes: z.string().max(4000).optional(),
});

/** Colunas que este módulo escreve — o teste garante que a lista não cresce por descuido. */
export const COLUNAS_ESCRITAS = ['Status', 'Observações'] as const;

/**
 * Grava o status na planilha (a fonte de verdade da triagem) e registra quem mudou.
 *
 * ⚠️ NÃO escreve "Atualizado Em": aquela coluna é o carimbo da última escrita do
 * SISTEMA e é o que decide se um legado está regularizado (`pendente` em Meus
 * Projetos). Preenchê-la aqui marcaria como regularizado um legado que ninguém editou.
 *
 * ⚠️ Não mexe no `status` do SQLite: o sync reverso exclui `status` de propósito
 * (planilha manda) e o status interno pertence ao fluxo de submissão/análise. A
 * exceção conhecida é "Descontinuado", que o sync reverso reconhece e reflete na flag
 * `descontinuado` do projeto.
 */
export async function definirStatusProjeto(raw: unknown, adminEmail: string) {
  const { projeto_id, status, observacoes } = statusSchema.parse(raw);

  const { cache: c } = await lerPlanilha(false);
  const linha = acharLinha(c.rows, projeto_id);
  if (!linha) {
    throw Object.assign(new Error('Projeto não encontrado na planilha.'), { status: 404 });
  }

  const statusAnterior = texto(linha['Status']);
  const updates: Partial<Record<(typeof COLUNAS_ESCRITAS)[number], string>> = { Status: status };
  if (observacoes !== undefined) updates['Observações'] = observacoes.trim();

  await updateRowByProjectId(projeto_id, updates);

  // Corrige a linha no cache em vez de reler a planilha inteira: a tela reflete a
  // mudança na hora e a próxima leitura real acontece no TTL normal.
  const mutavel = linha as Record<string, string>;
  mutavel['Status'] = status;
  if (observacoes !== undefined) mutavel['Observações'] = observacoes.trim();

  try {
    await insertAdminStatusLog({
      projeto_id,
      projeto_nome: texto(linha['Projeto']),
      status_anterior: statusAnterior,
      status_novo: status,
      observacoes: observacoes?.trim() || null,
      admin_email: adminEmail,
    });
  } catch (e) {
    // Auditoria é registro paralelo — não pode desfazer uma escrita que já aconteceu.
    console.error('[dashboard-admin] falha ao registrar auditoria de status:', e);
  }

  return { ok: true, projeto_id, status, statusAnterior };
}
