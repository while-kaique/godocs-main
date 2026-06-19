// SQLite database client (server-only)
// Abstrai o acesso ao banco via interface GoDeployDB (env.DB no Godeploy, wrapper better-sqlite3 em dev)
//
// IMPORTANTE: o env.DB do Godeploy é ASSÍNCRONO (query/exec retornam Promise) e
// exige o argumento de params sempre (mesmo []). Por isso toda a camada é async e
// sempre passa params. O wrapper better-sqlite3 do dev é síncrono, mas `await`
// sobre um valor síncrono é no-op — então o mesmo código funciona em dev e em prod.

import { initSchema } from './schema';
import type { GoDeployDB } from './db-adapter';

export type { GoDeployDB } from './db-adapter';

// ─── Singleton global — setado pelo worker ou pelo dev plugin ──────────────

let _db: GoDeployDB | undefined;
let _schemaReady = false;

/**
 * Injeta a instância do banco. Chamado pelo worker.ts no início de cada request.
 *
 * IMPORTANTE (Cloudflare Workers): o I/O de um binding (env.DB) fica atrelado ao
 * request que o originou. NÃO podemos cachear a *promise* do initSchema em escopo
 * de módulo e dar `await` nela em requests seguintes — isso lança
 * "Error: Network connection lost." (a plataforma então devolve "App error" em
 * texto puro, quebrando o JSON.parse do frontend).
 *
 * Por isso guardamos apenas um booleano. O initSchema roda dentro do contexto do
 * request atual sempre que o schema ainda não foi confirmado. CREATE TABLE IF NOT
 * EXISTS é idempotente, então uma eventual execução concorrente (ou repetida) é
 * inofensiva. Se o init falhar, `_schemaReady` continua falso e o próximo request
 * tenta de novo no seu próprio contexto — nunca envenenamos uma promise.
 */
export async function setDb(db: GoDeployDB): Promise<void> {
  _db = db;
  if (_schemaReady) return;
  await initSchema(db);
  _schemaReady = true;
}

/** Retorna a instância do banco injetada. Lança erro se não foi setada. */
export function getDb(): GoDeployDB {
  if (!_db) throw new Error('Database não inicializado. Chame setDb() antes de acessar o banco.');
  return _db;
}

// ─── Helpers de query ──────────────────────────────────────────────────────

/**
 * Converte o resultado de uma query em array de objetos tipados.
 *
 * Lida com os dois formatos possíveis de `rows`:
 *  - **Produção (env.DB do Godeploy)**: cada row já é um objeto (`Record<string, unknown>`),
 *    com as colunas como chaves. Usamos o objeto diretamente.
 *  - **Dev (wrapper better-sqlite3)**: cada row é um array posicional (`unknown[]`),
 *    indexado pela ordem das colunas. Reconstruímos o objeto via `columns`.
 *
 * Tratar sempre como array posicional (como era antes) faz com que, em produção
 * (rows = objetos), todos os campos virem `undefined` — inclusive `id` —, causando
 * "NOT NULL constraint failed: chat_messages.projeto_id" ao iniciar a análise.
 */
function rowsToObjects<T>(result: { columns: string[]; rows: unknown[] }): T[] {
  const { columns, rows } = result;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    // Já é um objeto (formato do env.DB do Godeploy) → usa direto.
    if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
      return row as T;
    }
    // Array posicional (wrapper better-sqlite3 em dev) → mapeia por coluna.
    const arr = row as unknown[];
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = arr[i];
    }
    return obj as T;
  });
}

/** SELECT que retorna array de objetos */
async function queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getDb().query(sql, params);
  return rowsToObjects<T>(result);
}

/** SELECT que retorna um único objeto ou undefined */
async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await getDb().query(sql, params);
  return rowsToObjects<T>(result)[0];
}

/** INSERT/UPDATE/DELETE */
async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await getDb().exec(sql, params);
}

// ─── Helpers genéricos ─────────────────────────────────────────────────────

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function nowISO(): string {
  return new Date().toISOString();
}

/** JSON-parse seguro para colunas que armazenam JSON como TEXT */
export function parseJson<T = unknown>(raw: string | null | undefined): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─── Funções de acesso ao banco ─────────────────────────────────────────────

// --- Admins ---

export function getAdmins() {
  return queryAll<AdminRow>('SELECT * FROM admins ORDER BY email');
}

export function getAdminByEmail(email: string) {
  return queryOne<AdminRow>('SELECT * FROM admins WHERE email = ?', [email]);
}

export async function insertAdmin(email: string, nome?: string | null) {
  const id = generateId();
  await exec('INSERT INTO admins (id, email, nome) VALUES (?, ?, ?)', [id, email, nome ?? null]);
  return (await queryOne<AdminRow>('SELECT * FROM admins WHERE id = ?', [id]))!;
}

export function deleteAdmin(id: string) {
  return exec('DELETE FROM admins WHERE id = ?', [id]);
}

// --- Areas ---

export function getAreas() {
  return queryAll<AreaRow>('SELECT * FROM areas ORDER BY nome');
}

export function getAreaById(id: string) {
  return queryOne<AreaRow>('SELECT * FROM areas WHERE id = ?', [id]);
}

export async function insertArea(nome: string) {
  const id = generateId();
  await exec('INSERT INTO areas (id, nome) VALUES (?, ?)', [id, nome]);
  return (await queryOne<AreaRow>('SELECT * FROM areas WHERE id = ?', [id]))!;
}

export function deleteArea(id: string) {
  return exec('DELETE FROM areas WHERE id = ?', [id]);
}

// --- Projetos ---

export function getProjetosWithArea() {
  return queryAll<ProjetoRow & { area_nome: string | null }>(`
    SELECT p.*, a.nome as area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    ORDER BY p.created_at DESC
  `);
}

export function getProjetoById(id: string) {
  return queryOne<ProjetoRow>('SELECT * FROM projetos WHERE id = ?', [id]);
}

export async function getProjetoWithRelations(id: string) {
  const projeto = await queryOne<ProjetoRow & { area_nome: string | null }>(`
    SELECT p.*, a.nome as area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    WHERE p.id = ?
  `, [id]);
  if (!projeto) return undefined;

  const chatMessages = await queryAll<ChatMessageRow>(
    'SELECT * FROM chat_messages WHERE projeto_id = ? ORDER BY created_at', [id]
  );

  const documentacao = await queryAll<DocumentacaoRow>(
    'SELECT * FROM documentacao WHERE projeto_id = ?', [id]
  );

  const validacoes = await queryAll<ValidacaoRow>(
    'SELECT * FROM validacoes WHERE projeto_id = ?', [id]
  );

  return { ...projeto, chat_messages: chatMessages, documentacao, validacoes };
}

export function getProjetoContextoData(id: string) {
  return queryOne<Pick<ProjetoRow, 'responsavel_nome' | 'responsavel_email' | 'ferramenta' | 'membros' | 'nome' | 'tipo_projeto' | 'tipos_projeto' | 'escopo' | 'descricao_breve' | 'data_criacao_projeto' | 'area' | 'especial' | 'contexto_especial' | 'saving_horas' | 'saving_reais' | 'tipo_saving' | 'memorial_calculo' | 'custo_externo_mensal' | 'alguem_fazia' | 'submitted_at'> & { area_nome: string | null }>(`
    SELECT p.responsavel_nome, p.responsavel_email, p.ferramenta, p.membros,
           p.nome, p.tipo_projeto, p.tipos_projeto, p.escopo,
           p.descricao_breve, p.data_criacao_projeto, p.area,
           p.especial, p.contexto_especial,
           p.saving_horas, p.saving_reais, p.tipo_saving, p.memorial_calculo,
           p.custo_externo_mensal, p.alguem_fazia, p.submitted_at,
           a.nome as area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    WHERE p.id = ?
  `, [id]);
}

// Conteúdo da documentação estruturada aprovada (DocumentacaoGerada serializada).
// Presente apenas quando o projeto já foi compilado/submetido — usado como
// contexto de revisão quando o projeto é editado.
export function getDocumentacaoConteudo(projetoId: string) {
  return queryOne<{ conteudo: string }>(
    'SELECT conteudo FROM documentacao WHERE projeto_id = ? LIMIT 1', [projetoId]
  );
}

export type InsertProjeto = {
  responsavel_nome: string;
  responsavel_email: string;
  area_id?: string | null;
  area?: string | null;
  ferramenta: string;
  escopo?: string | null;
  servico_externo?: string | null;
  membros?: string[];
  nome?: string | null;
  data_criacao_projeto?: string | null;
  tipo_projeto?: string | null;
  tipos_projeto?: string[] | null;
  descricao_breve?: string | null;
  especial?: boolean | null;
  contexto_especial?: string | null;
  arquivos_nomes?: string[] | null;
  status?: string;
};

export async function insertProjeto(data: InsertProjeto) {
  const id = generateId();
  const now = nowISO();
  await exec(`
    INSERT INTO projetos (id, responsavel_nome, responsavel_email, area_id, area, ferramenta,
      escopo, servico_externo, membros, nome, data_criacao_projeto, tipo_projeto, tipos_projeto,
      descricao_breve, especial, contexto_especial, arquivos_nomes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    data.responsavel_nome,
    data.responsavel_email,
    data.area_id ?? null,
    data.area ?? null,
    data.ferramenta,
    data.escopo ?? null,
    data.servico_externo ?? null,
    data.membros ? JSON.stringify(data.membros) : null,
    data.nome ?? null,
    data.data_criacao_projeto ?? null,
    data.tipo_projeto ?? null,
    data.tipos_projeto ? JSON.stringify(data.tipos_projeto) : null,
    data.descricao_breve ?? null,
    data.especial ? 1 : 0,
    data.contexto_especial ?? null,
    data.arquivos_nomes ? JSON.stringify(data.arquivos_nomes) : null,
    data.status ?? 'rascunho',
    now,
    now,
  ]);
  return (await queryOne<ProjetoRow>('SELECT * FROM projetos WHERE id = ?', [id]))!;
}

export function updateProjeto(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return Promise.resolve();
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => {
    const v = fields[k];
    if (v === undefined) return null;
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
  return exec(`UPDATE projetos SET ${sets}, updated_at = ? WHERE id = ?`, [...values, nowISO(), id]);
}

/** IDs de todos os projetos (usado pelo sync reverso Sheets→SQLite). */
export async function getAllProjetoIds(): Promise<string[]> {
  const rows = await queryAll<{ id: string }>('SELECT id FROM projetos', []);
  return rows.map((r) => r.id);
}

/**
 * Insert genérico em `projetos` a partir de um mapa coluna→valor (exige `id`).
 * Usado pelo sync reverso para importar projetos legados que só existem na
 * planilha. `INSERT OR IGNORE` garante idempotência (se o id já existir, no-op).
 * Objetos/arrays viram JSON; booleans viram 1/0.
 */
export async function insertProjetoRaw(fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.includes('id')) throw new Error('insertProjetoRaw requer o campo id');
  const cols = keys.join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map((k) => {
    const v = fields[k];
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
  await exec(`INSERT OR IGNORE INTO projetos (${cols}) VALUES (${placeholders})`, values);
}

export function findDuplicateProjeto(nome: string, excludeId: string) {
  return queryOne<{ id: string }>(
    "SELECT id FROM projetos WHERE nome = ? AND id != ? AND status != 'rascunho' LIMIT 1",
    [nome, excludeId]
  );
}

// --- Versões ---

export async function gravarVersaoProjeto(
  projeto_id: string,
  acao: 'submit_inicial' | 'reenvio',
  snapshotProjeto: Record<string, unknown>,
  snapshotDoc: Record<string, unknown> | null,
  submetidoPor: string | null,
  // Snapshot da conversa (chat_messages) no momento da submissão — preserva a
  // conversa ORIGINAL de cada versão (os chat_messages são apagados ao voltar
  // etapas). Opcional/forward-only: versões antigas ficam com NULL.
  snapshotChat?: unknown[] | null,
): Promise<void> {
  const row = await queryOne<{ proxima: number }>(
    'SELECT COALESCE(MAX(versao_num), 0) + 1 AS proxima FROM projeto_versions WHERE projeto_id = ?',
    [projeto_id],
  );
  const versao_num = row?.proxima ?? 1;
  await exec(
    `INSERT INTO projeto_versions (id, projeto_id, versao_num, acao, snapshot_projeto, snapshot_doc, snapshot_chat, submetido_por, created_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      projeto_id,
      versao_num,
      acao,
      JSON.stringify(snapshotProjeto),
      snapshotDoc ? JSON.stringify(snapshotDoc) : null,
      snapshotChat && snapshotChat.length > 0 ? JSON.stringify(snapshotChat) : null,
      submetidoPor,
    ],
  );
}

/** Contagem de reenvios (edições) por projeto — usado na listagem do Investigador. */
export async function getReenvioCounts(): Promise<Map<string, number>> {
  const rows = await queryAll<{ projeto_id: string; total: number }>(
    "SELECT projeto_id, COUNT(*) AS total FROM projeto_versions WHERE acao = 'reenvio' GROUP BY projeto_id",
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.projeto_id, r.total);
  return map;
}

/** Todos os reenvios (edições) com dados do projeto — alimenta a aba "Edições".
 * `prev_created_at` = carimbo da versão imediatamente anterior (limite inferior da
 * janela de tempo desta edição, usada para fatiar api_logs); cai para
 * `projeto_created_at` quando não há versão anterior. */
export function getAllReenvios() {
  return queryAll<VersionRow & {
    nome: string | null;
    responsavel_nome: string;
    responsavel_email: string;
    ferramenta: string;
    area: string | null;
    area_nome: string | null;
    prev_created_at: string | null;
    projeto_created_at: string | null;
  }>(`
    SELECT v.*, p.nome, p.responsavel_nome, p.responsavel_email, p.ferramenta,
           p.area, a.nome AS area_nome,
           (SELECT MAX(v2.created_at) FROM projeto_versions v2
              WHERE v2.projeto_id = v.projeto_id AND v2.versao_num < v.versao_num) AS prev_created_at,
           p.created_at AS projeto_created_at
    FROM projeto_versions v
    JOIN projetos p ON v.projeto_id = p.id
    LEFT JOIN areas a ON p.area_id = a.id
    WHERE v.acao = 'reenvio'
    ORDER BY v.created_at DESC
  `);
}

export function getVersionsByProjeto(projeto_id: string) {
  return queryAll<VersionRow>(
    'SELECT * FROM projeto_versions WHERE projeto_id = ? ORDER BY versao_num ASC',
    [projeto_id],
  );
}

export function getLatestVersionByProjeto(projeto_id: string) {
  return queryOne<VersionRow>(
    'SELECT * FROM projeto_versions WHERE projeto_id = ? ORDER BY versao_num DESC LIMIT 1',
    [projeto_id],
  );
}

export function getProjetosByOwnerEmail(email: string) {
  return queryAll<ProjetoRow & { area_nome: string | null }>(`
    SELECT p.*, a.nome as area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    WHERE LOWER(p.responsavel_email) = LOWER(?) OR p.membros LIKE ?
    ORDER BY p.created_at DESC
  `, [email, `%"${email}"%`]);
}

// --- Chat Messages ---

export function getChatMessages(projetoId: string) {
  return queryAll<ChatMessageRow>(
    'SELECT * FROM chat_messages WHERE projeto_id = ? ORDER BY created_at', [projetoId]
  );
}

export function getChatMessagesExcludeRole(projetoId: string, excludeRole: string) {
  return queryAll<{ role: string; content: string }>(
    'SELECT role, content FROM chat_messages WHERE projeto_id = ? AND role != ? ORDER BY created_at',
    [projetoId, excludeRole]
  );
}

/** Remove todas as mensagens de uma role do chat (usado ao re-sincronizar o agente). */
export function deleteChatMessagesByRole(projetoId: string, role: string) {
  return exec('DELETE FROM chat_messages WHERE projeto_id = ? AND role = ?', [projetoId, role]);
}

/** Remove TODAS as mensagens do chat de um projeto (reset da conversa). */
export function deleteChatMessagesByProjeto(projetoId: string) {
  return exec('DELETE FROM chat_messages WHERE projeto_id = ?', [projetoId]);
}

/**
 * Apaga um projeto e TUDO que depende dele. Deleta explicitamente as tabelas
 * relacionadas (não dependemos do ON DELETE CASCADE estar ativo no runtime) e
 * por último o próprio projeto. Usado para excluir rascunhos.
 */
export async function excluirProjetoCascade(projetoId: string) {
  for (const tabela of ['chat_messages', 'documentacao', 'projeto_versions', 'analises', 'validacoes']) {
    await exec(`DELETE FROM ${tabela} WHERE projeto_id = ?`, [projetoId]);
  }
  await exec('DELETE FROM projetos WHERE id = ?', [projetoId]);
}

/**
 * Remove projetos de TESTE E2E (nome com prefixo "[E2E-") e tudo que depende deles.
 * O schema tem ON DELETE CASCADE (chat_messages, documentacao, projeto_versions,
 * validacoes, analises, api_logs, form_events), então deletar de `projetos` limpa
 * o resto. Retorna os IDs removidos para auditoria/limpeza da planilha.
 * Usado pelo endpoint admin POST /api/admin/e2e-cleanup. Ver scripts/e2e/.
 */
export async function deleteProjetosTesteE2E(): Promise<string[]> {
  const rows = await queryAll<{ id: string }>(
    "SELECT id FROM projetos WHERE nome LIKE '[E2E-%'", []
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  await exec("DELETE FROM projetos WHERE nome LIKE '[E2E-%'", []);
  return ids;
}

/**
 * Remove as mensagens de uma fase financeira (saving|receita) a partir do marcador
 * de transição — a mensagem `type:'complete', fase:<alvo>` que abriu a fase. O
 * marcador (e tudo antes dele: doc + resumo do projeto) é mantido; só a conversa
 * da fase é apagada.
 *
 * Usado quando a pessoa volta ao formulário determinístico para editar os dados e
 * reinicia a fase: a conversa anterior estava ancorada nos números antigos e, se
 * mantida, voltaria a aparecer no histórico do agente (buildPhaseHistory). Na
 * primeira vez que a fase inicia ainda não há mensagens após o marcador, então
 * isto é um no-op — chamar sempre é seguro e idempotente.
 */
export async function deleteChatMessagesAfterFaseMarker(projetoId: string, fase: 'saving' | 'receita') {
  const rows = await queryAll<{ id: string; role: string; content: string }>(
    'SELECT id, role, content FROM chat_messages WHERE projeto_id = ? ORDER BY created_at', [projetoId]
  );
  // 1) Marcador de transição (type:complete + fase): a conversa da fase vem DEPOIS
  //    dele; o marcador é mantido.
  // 2) Fallback: quando a fase foi ADICIONADA depois (ex.: a pessoa concluiu o saving
  //    e voltou à etapa 2 para marcar receita), não há transição/marcador. Aí
  //    ancoramos na PRIMEIRA mensagem da própria fase (startIdx = i-1), de modo que
  //    a limpeza apague a conversa da fase inteira (inclusive a mensagem de abertura).
  let startIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(rows[i].content) as { type?: string; fase?: string };
      if (parsed.type === 'complete' && parsed.fase === fase) { startIdx = i; break; }
    } catch { /* não-JSON (ex.: role 'doc') — ignora */ }
  }
  if (startIdx < 0) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].role !== 'assistant') continue;
      try {
        const parsed = JSON.parse(rows[i].content) as { fase?: string };
        if (parsed.fase === fase) { startIdx = i - 1; break; }
      } catch { /* ignora */ }
    }
  }
  if (startIdx < 0) return; // a fase nunca iniciou — nada a limpar
  const idsToDelete = rows.slice(startIdx + 1).map((r) => r.id);
  for (const id of idsToDelete) {
    await exec('DELETE FROM chat_messages WHERE id = ?', [id]);
  }
}

export function getDocMessage(projetoId: string) {
  return queryOne<{ content: string }>(
    "SELECT content FROM chat_messages WHERE projeto_id = ? AND role = 'doc' LIMIT 1",
    [projetoId]
  );
}

export async function insertChatMessage(data: {
  projeto_id: string;
  role: string;
  content: string;
  options?: unknown;
  selected_option?: number | null;
}) {
  const id = generateId();
  await exec(`
    INSERT INTO chat_messages (id, projeto_id, role, content, options, selected_option)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    id,
    data.projeto_id,
    data.role,
    data.content,
    data.options ? JSON.stringify(data.options) : null,
    data.selected_option ?? null,
  ]);
  return (await queryOne<ChatMessageRow>('SELECT * FROM chat_messages WHERE id = ?', [id]))!;
}

// --- Form Events (timeline determinístico do formulário) ---

/**
 * Registra um evento determinístico do formulário (valores marcados, "voltar etapa").
 * Append-only — NÃO é tocado pelas limpezas de chat. `dados` é serializado para JSON.
 */
export async function recordFormEvent(data: {
  projeto_id: string;
  tipo: string;
  fase?: string | null;
  dados?: unknown;
}) {
  await exec(
    `INSERT INTO form_events (id, projeto_id, tipo, fase, dados, created_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))`,
    [
      data.projeto_id,
      data.tipo,
      data.fase ?? null,
      data.dados != null ? JSON.stringify(data.dados) : null,
    ],
  );
}

export function getFormEventsByProjeto(projetoId: string) {
  return queryAll<FormEventRow>(
    'SELECT * FROM form_events WHERE projeto_id = ? ORDER BY created_at', [projetoId]
  );
}

/** Já existe algum evento desse tipo para o projeto? Usado para detectar reentradas
 * (ex.: 2ª vez que a fase saving inicia → o usuário "voltou e editou"). */
export async function hasFormEventTipo(projetoId: string, tipo: string): Promise<boolean> {
  const row = await queryOne<{ total: number }>(
    'SELECT COUNT(*) AS total FROM form_events WHERE projeto_id = ? AND tipo = ?',
    [projetoId, tipo],
  );
  return (row?.total ?? 0) > 0;
}

// --- Documentacao ---

export function getDocumentacao(projetoId: string) {
  return queryOne<DocumentacaoRow>(
    'SELECT * FROM documentacao WHERE projeto_id = ?', [projetoId]
  );
}

export async function upsertDocumentacao(projetoId: string, conteudo: unknown) {
  const existing = await queryOne<{ id: string }>('SELECT id FROM documentacao WHERE projeto_id = ?', [projetoId]);
  const now = nowISO();
  const jsonStr = JSON.stringify(conteudo);
  if (existing) {
    await exec('UPDATE documentacao SET conteudo = ?, updated_at = ? WHERE projeto_id = ?', [jsonStr, now, projetoId]);
  } else {
    const id = generateId();
    await exec('INSERT INTO documentacao (id, projeto_id, conteudo, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, projetoId, jsonStr, now, now]);
  }
}

// --- Validacoes ---

export async function insertValidacao(data: {
  projeto_id: string;
  resultado: string;
  parecer: string;
  criterios?: unknown;
  admin_email?: string | null;
}) {
  const id = generateId();
  await exec(`
    INSERT INTO validacoes (id, projeto_id, resultado, parecer, criterios, admin_email)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, data.projeto_id, data.resultado, data.parecer, data.criterios ? JSON.stringify(data.criterios) : null, data.admin_email ?? null]);
  return id;
}

export function updateValidacaoEmailEnviado(projetoId: string) {
  return exec('UPDATE validacoes SET email_enviado = 1 WHERE projeto_id = ?', [projetoId]);
}

// --- Analises ---

export async function insertAnalise(data: {
  projeto_id: string;
  resultado: string;
  pontuacao_total: number;
  pontuacao_maxima: number;
  justificativa: string;
  resumo?: string;
  criterios_hardcoded?: unknown;
  criterios_dinamicos?: unknown;
  complexidade_justificativa?: string;
}) {
  const id = generateId();
  await exec(`
    INSERT INTO analises (id, projeto_id, resultado, pontuacao_total, pontuacao_maxima,
      justificativa, resumo, criterios_hardcoded, criterios_dinamicos, complexidade_justificativa)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, data.projeto_id, data.resultado,
    data.pontuacao_total, data.pontuacao_maxima,
    data.justificativa,
    data.resumo ?? null,
    data.criterios_hardcoded ? JSON.stringify(data.criterios_hardcoded) : null,
    data.criterios_dinamicos ? JSON.stringify(data.criterios_dinamicos) : null,
    data.complexidade_justificativa ?? null,
  ]);
  return id;
}

export function getLatestAnalise(projetoId: string) {
  return queryOne<AnaliseRow>(
    'SELECT * FROM analises WHERE projeto_id = ? ORDER BY created_at DESC LIMIT 1',
    [projetoId]
  );
}

// --- Configuracoes ---

export function getConfiguracoes() {
  return queryAll<ConfiguracaoRow>('SELECT * FROM configuracoes ORDER BY chave');
}

export function getConfiguracao(chave: string) {
  return queryOne<ConfiguracaoRow>('SELECT * FROM configuracoes WHERE chave = ?', [chave]);
}

export function updateConfiguracao(chave: string, valor: unknown, updatedBy: string) {
  const now = nowISO();
  return exec('UPDATE configuracoes SET valor = ?, updated_by = ?, updated_at = ? WHERE chave = ?', [
    JSON.stringify(valor), updatedBy, now, chave
  ]);
}

// --- Profiles ---

export function getProfiles() {
  return queryAll<ProfileRow>('SELECT id, nome, email FROM profiles ORDER BY nome');
}

export function getProfileById(id: string) {
  return queryOne<ProfileRow>('SELECT * FROM profiles WHERE id = ?', [id]);
}

export async function upsertProfile(id: string, nome: string, email: string) {
  const existing = await queryOne<{ id: string }>('SELECT id FROM profiles WHERE id = ?', [id]);
  if (existing) {
    await exec('UPDATE profiles SET nome = ?, email = ? WHERE id = ?', [nome, email, id]);
  } else {
    await exec('INSERT INTO profiles (id, nome, email) VALUES (?, ?, ?)', [id, nome, email]);
  }
}

export function deleteProfile(id: string) {
  return exec('DELETE FROM profiles WHERE id = ?', [id]);
}

// --- User Roles ---

export function getUserRoles() {
  return queryAll<UserRoleRow>('SELECT user_id, role FROM user_roles');
}

export function getUserRole(userId: string, role?: string) {
  if (role) {
    return queryOne<UserRoleRow>('SELECT * FROM user_roles WHERE user_id = ? AND role = ?', [userId, role]);
  }
  return queryOne<UserRoleRow>('SELECT * FROM user_roles WHERE user_id = ?', [userId]);
}

export function deleteUserRoles(userId: string) {
  return exec('DELETE FROM user_roles WHERE user_id = ?', [userId]);
}

export function insertUserRole(userId: string, role: string) {
  return exec('INSERT OR REPLACE INTO user_roles (user_id, role) VALUES (?, ?)', [userId, role]);
}

// --- Leader Areas ---

export function getLeaderAreas() {
  return queryAll<LeaderAreaRow>('SELECT user_id, area_id FROM leader_areas');
}

export function deleteLeaderAreas(userId: string) {
  return exec('DELETE FROM leader_areas WHERE user_id = ?', [userId]);
}

export async function insertLeaderAreas(userId: string, areaIds: string[]) {
  for (const areaId of areaIds) {
    await exec('INSERT INTO leader_areas (user_id, area_id) VALUES (?, ?)', [userId, areaId]);
  }
}

// --- Api Logs ---

/** Limite de corpo armazenado por log (500 KB). Bodies maiores são truncados. */
const API_LOG_BODY_LIMIT = 512_000;

function truncateBody(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length <= API_LOG_BODY_LIMIT) return raw;
  return raw.slice(0, API_LOG_BODY_LIMIT) + '\n…[truncado — ' + raw.length.toLocaleString('pt-BR') + ' chars]';
}

export async function insertApiLog(data: {
  projeto_id?: string | null;
  endpoint: string;
  method?: string;
  duration_ms?: number | null;
  status_code: number;
  error?: string | null;
  request_size?: number | null;
  response_size?: number | null;
  request_body?: string | null;
  response_body?: string | null;
}) {
  const id = generateId();
  await exec(`
    INSERT INTO api_logs (id, projeto_id, endpoint, method, duration_ms, status_code, error, request_size, response_size, request_body, response_body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    data.projeto_id ?? null,
    data.endpoint,
    data.method ?? 'POST',
    data.duration_ms ?? null,
    data.status_code,
    data.error ?? null,
    data.request_size ?? null,
    data.response_size ?? null,
    truncateBody(data.request_body),
    truncateBody(data.response_body),
  ]);
}

/** Colunas leves (sem bodies) para listagens. */
const API_LOG_LIGHT_COLS = 'id, projeto_id, endpoint, method, duration_ms, status_code, error, request_size, response_size, created_at';

export function getApiLogsByProjeto(projetoId: string) {
  return queryAll<ApiLogRow>(
    `SELECT ${API_LOG_LIGHT_COLS} FROM api_logs WHERE projeto_id = ? ORDER BY created_at DESC`, [projetoId]
  );
}

export function getApiLogsRecent(limit = 200) {
  return queryAll<ApiLogRow>(
    `SELECT ${API_LOG_LIGHT_COLS} FROM api_logs ORDER BY created_at DESC LIMIT ?`, [limit]
  );
}

export function getApiLogById(id: string) {
  return queryOne<ApiLogRow>(
    'SELECT * FROM api_logs WHERE id = ?', [id]
  );
}

/**
 * Logs de iniciar-submissao COM o request_body (contém o base64 dos docs).
 * Usado pelo backfill retroativo de documentos ao Drive. Inclui o body inteiro
 * (pode ser grande) — usar só em fluxos admin/backfill, nunca em listagens.
 */
export function getIniciarSubmissaoLogs() {
  return queryAll<{ id: string; projeto_id: string | null; request_body: string | null; created_at: string | null }>(
    `SELECT id, projeto_id, request_body, created_at FROM api_logs
     WHERE endpoint = '/api/chat/iniciar-submissao' AND request_body IS NOT NULL
     ORDER BY created_at`, []
  );
}

/** id, nome e arquivos_links de todos os projetos (cross-ref do backfill). */
export function getProjetosLinkInfo() {
  return queryAll<{ id: string; nome: string | null; arquivos_links: string | null }>(
    'SELECT id, nome, arquivos_links FROM projetos', []
  );
}

export function cleanupOldApiLogs(daysToKeep = 30) {
  return exec(
    "DELETE FROM api_logs WHERE created_at < datetime('now', '-' || ? || ' days')", [daysToKeep]
  );
}

// ─── Row types ──────────────────────────────────────────────────────────────

export type AdminRow = {
  id: string;
  email: string;
  nome: string | null;
  created_at: string | null;
};

export type AreaRow = {
  id: string;
  nome: string;
  created_at: string | null;
};

export type ProjetoRow = {
  id: string;
  nome: string | null;
  responsavel_nome: string;
  responsavel_email: string;
  area: string | null;
  area_id: string | null;
  ferramenta: string;
  escopo: string | null;
  servico_externo: string | null;
  membros: string | null; // JSON string
  status: string | null;
  chat_completo: number | null;
  data_criacao_projeto: string | null;
  tipo_projeto: string | null;
  tipos_projeto: string | null; // JSON string
  descricao_breve: string | null;
  saving_horas: number | null;
  saving_reais: number | null;
  tipo_saving: string | null;
  memorial_calculo: string | null;
  custo_externo_mensal: number | null;
  custo_evitado: string | null; // 'sim' | 'nao' — a solução evitou custo externo?
  custo_evitado_justificativa: string | null; // texto concatenado das ferramentas evitadas
  custo_evitado_itens: string | null; // JSON [{nome,valor,recorrencia,justificativa}]
  ganho_total_mensal: number | null;
  complexidade: string | null;
  alguem_fazia: string | null; // 'sim' | 'nao' — havia trabalho manual antes
  observacoes: string | null; // parecer da análise automática (staff-only)
  especial: number | null; // 1 = projeto especial (altíssimo impacto, validação humana)
  contexto_especial: string | null; // descrição do contexto do projeto especial (etapa 2.5)
  arquivos_nomes: string | null; // JSON array de nomes dos arquivos enviados no upload
  arquivos_links: string | null; // JSON array de links (webViewLink) dos arquivos no Drive
  submitted_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
  // Espelho do "Atualizado Em" do Sheets. NULL = app nunca sincronizou p/ a planilha
  // = legado pendente (alimenta a contagem de pendentes sem ler o Sheets).
  atualizado_em: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ChatMessageRow = {
  id: string;
  projeto_id: string;
  role: string;
  content: string;
  options: string | null; // JSON string
  selected_option: number | null;
  created_at: string | null;
};

export type DocumentacaoRow = {
  id: string;
  projeto_id: string;
  conteudo: string; // JSON string
  versao: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VersionRow = {
  id: string;
  projeto_id: string;
  versao_num: number;
  acao: string;
  snapshot_projeto: string; // JSON
  snapshot_doc: string | null; // JSON
  snapshot_chat: string | null; // JSON (array de chat_messages); NULL em versões antigas
  submetido_por: string | null;
  created_at: string | null;
};

export type FormEventRow = {
  id: string;
  projeto_id: string;
  tipo: string; // submissao|saving|receita|tipos|metadados|back|submit
  fase: string | null; // doc|saving|receita — alinhamento com o chat
  dados: string | null; // JSON (pares label → valor)
  created_at: string | null;
};

export type ValidacaoRow = {
  id: string;
  projeto_id: string;
  resultado: string;
  parecer: string;
  criterios: string | null; // JSON string
  admin_email: string | null;
  email_enviado: number | null;
  created_at: string | null;
};

export type AnaliseRow = {
  id: string;
  projeto_id: string;
  resultado: string;
  pontuacao_total: number;
  pontuacao_maxima: number;
  justificativa: string;
  resumo: string | null;
  criterios_hardcoded: string | null; // JSON string
  criterios_dinamicos: string | null; // JSON string
  complexidade_justificativa: string | null;
  created_at: string | null;
};

export type ConfiguracaoRow = {
  id: string;
  chave: string;
  valor: string; // JSON string
  descricao: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type ProfileRow = {
  id: string;
  nome: string;
  email: string;
};

export type UserRoleRow = {
  user_id: string;
  role: string;
};

export type LeaderAreaRow = {
  user_id: string;
  area_id: string;
};

export type ApiLogRow = {
  id: string;
  projeto_id: string | null;
  endpoint: string;
  method: string;
  duration_ms: number | null;
  status_code: number;
  error: string | null;
  request_size: number | null;
  response_size: number | null;
  request_body: string | null;
  response_body: string | null;
  created_at: string | null;
};
