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

/** Colunas que a LISTAGEM do Investigador realmente usa.
 *
 * ⚠️ Deliberadamente enxuto — NÃO voltar para `p.*`. O `SELECT p.*` arrastava
 * `memorial_calculo`, `observacoes`, `contexto_especial` e demais blobs de TODOS
 * os projetos só para renderizar uma lista que mostra nome, autor e métricas. */
const PROJETO_INVESTIGADOR_COLS = [
  'p.id', 'p.nome', 'p.responsavel_nome', 'p.responsavel_email',
  'p.area', 'p.ferramenta', 'p.escopo', 'p.status', 'p.tipos_projeto',
  'p.descricao_breve', 'p.complexidade', 'p.chat_completo',
  'p.created_at', 'p.updated_at', 'p.submitted_at',
].join(', ');

export type ProjetoInvestigadorRow = Pick<
  ProjetoRow,
  | 'id' | 'nome' | 'responsavel_nome' | 'responsavel_email' | 'area' | 'ferramenta'
  | 'escopo' | 'status' | 'tipos_projeto' | 'descricao_breve' | 'chat_completo'
  | 'created_at' | 'updated_at' | 'submitted_at'
> & { area_nome: string | null; complexidade: string | null };

/** Projetos para a LISTAGEM do Investigador — só as colunas exibidas. */
export function getProjetosParaInvestigador() {
  return queryAll<ProjetoInvestigadorRow>(`
    SELECT ${PROJETO_INVESTIGADOR_COLS}, a.nome AS area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    ORDER BY p.created_at DESC
  `);
}

/** UM projeto com a área resolvida — evita carregar a tabela inteira só para achar
 *  um id, como fazia o `.find()` sobre `getProjetosWithArea()`. Aqui o `p.*` é
 *  barato (uma linha) e o detalhe precisa de campos fora da lista enxuta
 *  (`membros`, `servico_externo`, `data_criacao_projeto`). */
export function getProjetoWithAreaById(id: string) {
  return queryOne<ProjetoRow & { area_nome: string | null; complexidade: string | null }>(`
    SELECT p.*, a.nome AS area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    WHERE p.id = ?
  `, [id]);
}

export type ChatMetricsRow = {
  projeto_id: string;
  total: number;
  total_user: number;
  total_ia: number;
  ultima_atividade: string | null;
  fase: string | null;
};

/** Métricas de chat de TODOS os projetos numa única query agregada.
 *
 * ⚠️ Substitui o N+1 que derrubava `/api/admin/investigador/projetos`: era um
 * `getChatMessages(id)` por projeto — centenas de round-trips sequenciais
 * trazendo o `content` INTEIRO de cada mensagem, só para calcular 4 escalares.
 * O request estourava e a plataforma o marcava `canceled` (500/503 no browser),
 * enquanto o front exibia lista vazia em silêncio. Mesma lição do
 * `getAllReenvios`: agregue no SQL, trafegue só escalar.
 *
 * `fase` = a fase da última mensagem do assistente que declara uma (equivale a
 * varrer as mensagens de trás para frente). `json_valid` é obrigatório: o
 * `content` nem sempre é JSON e `json_extract` sobre texto solto lança erro —
 * daí o CASE (garante a ordem de avaliação, que o AND não garante). */
export function getChatMetricsPorProjeto() {
  return queryAll<ChatMetricsRow>(`
    SELECT m.projeto_id, m.total, m.total_user, m.total_ia, m.ultima_atividade, f.fase
    FROM (
      SELECT projeto_id,
             COUNT(*) AS total,
             SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS total_user,
             SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS total_ia,
             MAX(created_at) AS ultima_atividade
      FROM chat_messages
      GROUP BY projeto_id
    ) m
    LEFT JOIN (
      SELECT projeto_id, fase FROM (
        SELECT projeto_id,
               CASE WHEN json_valid(content) THEN json_extract(content, '$.fase') END AS fase,
               ROW_NUMBER() OVER (
                 PARTITION BY projeto_id ORDER BY created_at DESC, rowid DESC
               ) AS rn
        FROM chat_messages
        WHERE role = 'assistant'
          AND CASE WHEN json_valid(content) THEN json_extract(content, '$.fase') END IS NOT NULL
      ) ranked WHERE rn = 1
    ) f ON f.projeto_id = m.projeto_id
  `);
}

/** Projetos efetivamente submetidos (têm submitted_at). Usado pela reconciliação
 *  da coluna "Complexidade" no Sheets — evita varrer legados sem submissão. */
export function getProjetosSubmetidos() {
  return queryAll<
    Pick<
      ProjetoRow,
      | 'id'
      | 'complexidade'
      | 'observacoes'
      | 'submitted_at'
      // Classificação de elegibilidade: a reconciliação (cron) repõe a coluna
      // "Classificação"/"Motivo Reprovado" quando a análise em background é cancelada
      // antes do sync — mesma rede de segurança da Complexidade.
      | 'classificacao_avaliacao'
      | 'classificacao_justificativa'
      | 'motivo_reprovacao'
    >
  >(
    `SELECT id, complexidade, observacoes, submitted_at,
            classificacao_avaliacao, classificacao_justificativa, motivo_reprovacao
       FROM projetos WHERE submitted_at IS NOT NULL`
  );
}

/** Projetos NÃO-rascunho (os que pertencem ao Sheets), com os carimbos de tempo
 *  usados pela RECONCILIAÇÃO DE EXCLUSÃO do sync reverso: um projeto que sumiu da
 *  planilha deve ser removido do SQLite (Sheets é a fonte da verdade do que aparece).
 *  Rascunho (`status = 'rascunho'`) é estado interno do app e fica de fora — para a
 *  pessoa retomar o preenchimento; nunca é tocado pela reconciliação. */
export function getProjetosNaoRascunho() {
  return queryAll<Pick<ProjetoRow, 'id' | 'status' | 'submitted_at' | 'updated_at'>>(
    "SELECT id, status, submitted_at, updated_at FROM projetos WHERE status != 'rascunho'"
  );
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
  return queryOne<Pick<ProjetoRow, 'responsavel_nome' | 'responsavel_email' | 'ferramenta' | 'membros' | 'nome' | 'tipo_projeto' | 'tipos_projeto' | 'escopo' | 'servico_externo' | 'descricao_breve' | 'data_criacao_projeto' | 'area' | 'especial' | 'contexto_especial' | 'saving_horas' | 'saving_reais' | 'tipo_saving' | 'memorial_calculo' | 'custo_externo_mensal' | 'alguem_fazia' | 'usa_ai_proxy' | 'contrafactual_afetados' | 'custo_evitado_itens' | 'submitted_at'> & { area_nome: string | null }>(`
    SELECT p.responsavel_nome, p.responsavel_email, p.ferramenta, p.membros,
           p.nome, p.tipo_projeto, p.tipos_projeto, p.escopo, p.servico_externo,
           p.descricao_breve, p.data_criacao_projeto, p.area,
           p.especial, p.contexto_especial,
           p.saving_horas, p.saving_reais, p.tipo_saving, p.memorial_calculo,
           p.custo_externo_mensal, p.alguem_fazia,
           p.usa_ai_proxy, p.contrafactual_afetados,
           -- Itens do custo evitado: insumo do gate de SOBREPOSIÇÃO receita × custo
           -- evitado (agents/sobreposicao-receita.ts). Sem eles a fase de receita é
           -- cega para o dinheiro já contado no saving — o buraco do Sucesso.AI.
           p.custo_evitado_itens,
           p.submitted_at,
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
  // Papel de cada membro (e-mail→papel). Serializado em JSON. `membros` continua
  // sendo a lista plana de todos (base do ownership); este mapa só guarda o papel.
  membros_papeis?: Record<string, string> | null;
  nome?: string | null;
  data_criacao_projeto?: string | null;
  tipo_projeto?: string | null;
  tipos_projeto?: string[] | null;
  descricao_breve?: string | null;
  especial?: boolean | null;
  contexto_especial?: string | null;
  arquivos_nomes?: string[] | null;
  usa_ai_proxy?: string | null;
  // Contrafactual (Etapa 2) — ver ProjetoRow/schema.ts.
  contrafactual_afetados?: string | null;
  status?: string;
};

export async function insertProjeto(data: InsertProjeto) {
  const id = generateId();
  const now = nowISO();
  await exec(`
    INSERT INTO projetos (id, responsavel_nome, responsavel_email, area_id, area, ferramenta,
      escopo, servico_externo, membros, membros_papeis, nome, data_criacao_projeto, tipo_projeto, tipos_projeto,
      descricao_breve, especial, contexto_especial, arquivos_nomes, usa_ai_proxy,
      contrafactual_afetados, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.membros_papeis ? JSON.stringify(data.membros_papeis) : null,
    data.nome ?? null,
    data.data_criacao_projeto ?? null,
    data.tipo_projeto ?? null,
    data.tipos_projeto ? JSON.stringify(data.tipos_projeto) : null,
    data.descricao_breve ?? null,
    data.especial ? 1 : 0,
    data.contexto_especial ?? null,
    data.arquivos_nomes ? JSON.stringify(data.arquivos_nomes) : null,
    data.usa_ai_proxy ?? null,
    data.contrafactual_afetados ?? null,
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
 * `projeto_created_at` quando não há versão anterior.
 *
 * ⚠️ NÃO seleciona os blobs de snapshot (`snapshot_chat`/`_projeto`/`_doc`): a soma
 * deles em TODOS os reenvios estourava o limite de 32 MiB de serialização RPC do
 * Godeploy (`Serialized RPC ... limited to 32MiB`) e derrubava o endpoint `/edicoes`
 * — que, por vir num único `Promise.all` no front, zerava também a lista de projetos
 * do Investigador. As contagens de mensagem são computadas via `json_each` e
 * `status`/`ganho_total_mensal` via `json_extract`, direto no SQL (payload só escalar). */
export function getAllReenvios() {
  return queryAll<{
    id: string;
    projeto_id: string;
    versao_num: number;
    acao: string;
    created_at: string | null;
    nome: string | null;
    responsavel_nome: string;
    responsavel_email: string;
    ferramenta: string;
    area: string | null;
    area_nome: string | null;
    prev_created_at: string | null;
    projeto_created_at: string | null;
    msg_total: number;
    msg_user: number;
    msg_ia: number;
    snap_status: string | null;
    snap_ganho: number | null;
  }>(`
    SELECT v.id, v.projeto_id, v.versao_num, v.acao, v.created_at,
           p.nome, p.responsavel_nome, p.responsavel_email, p.ferramenta,
           p.area, a.nome AS area_nome,
           (SELECT MAX(v2.created_at) FROM projeto_versions v2
              WHERE v2.projeto_id = v.projeto_id AND v2.versao_num < v.versao_num) AS prev_created_at,
           p.created_at AS projeto_created_at,
           (SELECT COUNT(*) FROM json_each(COALESCE(v.snapshot_chat, '[]'))) AS msg_total,
           (SELECT COUNT(*) FROM json_each(COALESCE(v.snapshot_chat, '[]'))
              WHERE json_extract(value, '$.role') = 'user') AS msg_user,
           (SELECT COUNT(*) FROM json_each(COALESCE(v.snapshot_chat, '[]'))
              WHERE json_extract(value, '$.role') = 'assistant') AS msg_ia,
           json_extract(v.snapshot_projeto, '$.status') AS snap_status,
           json_extract(v.snapshot_projeto, '$.ganho_total_mensal') AS snap_ganho
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

// Grava uma configuração criando-a se ainda não existir (UPDATE puro não insere).
// Usada pelo template editável do e-mail de cobrança de legados.
export async function upsertConfiguracao(
  chave: string,
  valor: unknown,
  updatedBy: string,
  descricao?: string,
) {
  const now = nowISO();
  const existente = await getConfiguracao(chave);
  if (existente) {
    await exec(
      'UPDATE configuracoes SET valor = ?, updated_by = ?, updated_at = ? WHERE chave = ?',
      [JSON.stringify(valor), updatedBy, now, chave],
    );
  } else {
    await exec(
      'INSERT INTO configuracoes (id, chave, valor, descricao, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [generateId(), chave, JSON.stringify(valor), descricao ?? null, updatedBy, now],
    );
  }
}

// --- E-mail: legados pendentes + log de disparos ---

export type LegadoPendenteRow = {
  id: string;
  nome: string | null;
  responsavel_nome: string;
  responsavel_email: string;
  atualizado_em: string | null;
};

// Todos os projetos LEGADO (id contém "legado"). O filtro fino "ainda não atualizado"
// (atualizado_em vazio/—/-) é aplicado na camada de negócio com `temAtualizadoEm`,
// mantendo a lógica de pendência em fonte única.
export function getLegadosRows() {
  return queryAll<LegadoPendenteRow>(
    `SELECT id, nome, responsavel_nome, responsavel_email, atualizado_em
       FROM projetos
      WHERE LOWER(id) LIKE '%legado%'`,
    [],
  );
}

export type EmailDisparoRow = {
  id: string;
  email: string;
  nome: string | null;
  projeto_ids: string | null;
  assunto: string | null;
  enviado_por: string | null;
  status: string;
  erro: string | null;
  audiencia: string | null;
  created_at: string | null;
};

export function insertEmailDisparo(input: {
  email: string;
  nome: string | null;
  projetoIds: string[];
  assunto: string;
  enviadoPor: string;
  status: 'sucesso' | 'falha';
  erro?: string | null;
  // Segmento do disparo ('legado'|'reenvio'|'todos') — o selo "enviado em…" é por segmento.
  audiencia?: string;
}) {
  return exec(
    `INSERT INTO email_disparos (id, email, nome, projeto_ids, assunto, enviado_por, status, erro, audiencia, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      input.email,
      input.nome,
      JSON.stringify(input.projetoIds),
      input.assunto,
      input.enviadoPor,
      input.status,
      input.erro ?? null,
      input.audiencia ?? 'legado',
      nowISO(),
    ],
  );
}

// --- Lote de disparo (progresso) ---

export type EmailLoteRow = {
  id: string;
  total: number;
  processados: number;
  enviados: number;
  falhas: number;
  alvos: string | null; // JSON array de e-mails alvo (congelado na criação) — ordena o cursor
  audiencia: string | null; // 'legado' | 'reenvio' | 'todos'
  payload: string | null; // JSON { recipients, template } congelado na criação do lote
  status: string; // 'enviando' | 'cancelando' | 'concluido' | 'erro' | 'cancelado'
  iniciado_por: string | null;
  created_at: string | null;
  updated_at: string | null;
};

// Cria o lote congelando, no momento do disparo: a ordem dos e-mails (`alvos`, p/ o cursor),
// o segmento (`audiencia`) e o `payload` completo (destinatários + template). O chunk lê tudo
// desse snapshot — não relê Sheets/SQLite a cada requisição.
export async function createEmailLote(
  total: number,
  iniciadoPor: string,
  alvos: string[],
  audiencia: string,
  payload: unknown,
): Promise<string> {
  const id = generateId();
  await exec(
    `INSERT INTO email_lotes (id, total, processados, enviados, falhas, alvos, audiencia, payload, status, iniciado_por, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, ?, ?, ?, 'enviando', ?, ?, ?)`,
    [id, total, JSON.stringify(alvos), audiencia, JSON.stringify(payload), iniciadoPor, nowISO(), nowISO()],
  );
  return id;
}

// Avança o cursor do lote: +deltaProcessados no cursor, +deltaEnviados/+deltaFalhas nos
// contadores — tudo num UPDATE atômico (resumível: um chunk interrompido deixa o cursor
// exatamente onde parou, sem reenviar).
export function advanceEmailLote(
  id: string,
  delta: { processados?: number; enviados?: number; falhas?: number },
) {
  return exec(
    `UPDATE email_lotes
        SET processados = processados + ?, enviados = enviados + ?, falhas = falhas + ?, updated_at = ?
      WHERE id = ?`,
    [delta.processados ?? 0, delta.enviados ?? 0, delta.falhas ?? 0, nowISO(), id],
  );
}

export function finalizeEmailLote(id: string, status: 'concluido' | 'erro' | 'cancelado') {
  return exec('UPDATE email_lotes SET status = ?, updated_at = ? WHERE id = ?', [status, nowISO(), id]);
}

// Pede o cancelamento: marca 'cancelando' (só se ainda estiver 'enviando'). O loop de
// envio lê esse status antes de cada e-mail e para no próximo — os já enviados não voltam.
export function requestCancelEmailLote(id: string) {
  return exec(
    `UPDATE email_lotes SET status = 'cancelando', updated_at = ? WHERE id = ? AND status = 'enviando'`,
    [nowISO(), id],
  );
}

export function getEmailLote(id: string) {
  return queryOne<EmailLoteRow>('SELECT * FROM email_lotes WHERE id = ?', [id]);
}

// ─── Ajuda & Suporte (widget flutuante → Google Chat) ──────────────────────

export type AjudaChamadoRow = {
  id: string;
  usuario_email: string;
  usuario_nome: string | null;
  tipo: string; // 'duvida' | 'problema'
  mensagem: string;
  pagina_url: string | null;
  user_agent: string | null;
  print_link: string | null;
  print_filename: string | null;
  chat_status: string | null; // 'pendente' | 'enviado' | 'falha'
  created_at: string | null;
};

// Persiste um chamado de ajuda (fonte de verdade do registro). Retorna a linha
// gravada — o id gerado é usado para marcar o chat_status depois do envio.
export async function insertAjudaChamado(data: {
  usuario_email: string;
  usuario_nome?: string | null;
  tipo: string;
  mensagem: string;
  pagina_url?: string | null;
  user_agent?: string | null;
  print_link?: string | null;
  print_filename?: string | null;
  chat_status?: string;
}): Promise<AjudaChamadoRow> {
  const id = generateId();
  await exec(
    `INSERT INTO ajuda_chamados
       (id, usuario_email, usuario_nome, tipo, mensagem, pagina_url, user_agent, print_link, print_filename, chat_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      id,
      data.usuario_email,
      data.usuario_nome ?? null,
      data.tipo,
      data.mensagem,
      data.pagina_url ?? null,
      data.user_agent ?? null,
      data.print_link ?? null,
      data.print_filename ?? null,
      data.chat_status ?? 'pendente',
    ],
  );
  return (await queryOne<AjudaChamadoRow>('SELECT * FROM ajuda_chamados WHERE id = ?', [id]))!;
}

// Atualiza o resultado do envio ao Google Chat ('enviado' | 'falha').
export function marcarChatStatusAjuda(id: string, status: 'enviado' | 'falha') {
  return exec('UPDATE ajuda_chamados SET chat_status = ? WHERE id = ?', [status, id]);
}

// Lista os chamados mais recentes (mira o painel admin futuro — sem tela na v1).
export function getAjudaChamados(limit = 100) {
  return queryAll<AjudaChamadoRow>(
    'SELECT * FROM ajuda_chamados ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
}

// ── Auditoria da triagem (dashboard do admin) ────────────────────────────────

export type AdminStatusLogRow = {
  id: string;
  projeto_id: string;
  projeto_nome: string | null;
  status_anterior: string | null;
  status_novo: string;
  observacoes: string | null;
  admin_email: string;
  created_at: string | null;
};

// Registra uma mudança de status feita no dashboard. A escrita que vale acontece no
// Google Sheets (fonte de verdade do status); a planilha não guarda autoria, então esta
// linha é a única resposta para "quem aprovou este projeto, quando e por quê".
export async function insertAdminStatusLog(data: {
  projeto_id: string;
  projeto_nome?: string | null;
  status_anterior?: string | null;
  status_novo: string;
  observacoes?: string | null;
  admin_email: string;
}): Promise<void> {
  await exec(
    `INSERT INTO admin_status_log
       (id, projeto_id, projeto_nome, status_anterior, status_novo, observacoes, admin_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      generateId(),
      data.projeto_id,
      data.projeto_nome ?? null,
      data.status_anterior ?? null,
      data.status_novo,
      data.observacoes ?? null,
      data.admin_email,
    ],
  );
}

// ── Pré-aprovação do líder (TeamGuide) ───────────────────────────────────────

/** Número da versão mais recente do projeto (1 quando nunca versionou). */
export async function getUltimaVersaoNum(projetoId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    'SELECT COALESCE(MAX(versao_num), 1) AS n FROM projeto_versions WHERE projeto_id = ?',
    [projetoId],
  );
  return Number(row?.n ?? 1) || 1;
}

export type AprovacaoRow = {
  id: string;
  projeto_id: string;
  versao: number;
  autor_email: string | null;
  aprovador_email: string;
  aprovador_nome: string | null;
  veredito: string; // 'pendente' | 'aprovado' | 'ajuste' | 'reprovado' | 'dispensado'
  comentario: string | null;
  decidido_por: string | null;
  criado_em: string | null;
  decidido_em: string | null;
  // Checklist do gestor (3 perguntas de sim/não). null = parecer anterior ao checklist.
  resp_move_kpi: string | null;
  resp_sente_falta: string | null;
  resp_saving_coerente: string | null;
};

/**
 * Abre a fila de pré-aprovação de um projeto: apaga as linhas da rodada anterior e
 * insere uma pendente por líder. O reset é intencional (D10) — reenviar um projeto
 * invalida o veredito da versão anterior, que tinha outros números. A auditoria de
 * "quem aprovou" fica na linha viva + no snapshot da versão.
 */
export async function abrirAprovacoesPendentes(
  projetoId: string,
  versao: number,
  autorEmail: string | null,
  aprovadores: { email: string; nome: string | null }[],
): Promise<void> {
  await exec('DELETE FROM projeto_aprovacoes WHERE projeto_id = ?', [projetoId]);
  for (const a of aprovadores) {
    const email = (a.email ?? '').trim().toLowerCase();
    if (!email) continue;
    await exec(
      `INSERT INTO projeto_aprovacoes
         (id, projeto_id, versao, autor_email, aprovador_email, aprovador_nome, veredito, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 'pendente', datetime('now'))`,
      [generateId(), projetoId, versao, (autorEmail ?? '').trim().toLowerCase() || null, email, a.nome ?? null],
    );
  }
}

/**
 * Quantos projetos estão pendentes para este aprovador. Só a CONTAGEM (a DM usa para
 * dizer "3 projetos esperando você"); a fila em si é a `getAprovacoesPendentesDe`.
 */
export async function contarAprovacoesPendentesDe(email: string): Promise<number> {
  const rows = await queryAll<{ n: number }>(
    // ⚠️ O JOIN existe para os MESMOS filtros da `getAprovacoesPendentesDe`: o número
    // da faixa da home tem de bater com o tamanho da fila que a tela abre. Sem ele, o
    // líder via "3 pendentes" e encontrava 2 (D27 — especial não é pendência).
    `SELECT COUNT(*) AS n
       FROM projeto_aprovacoes a
       JOIN projetos p ON p.id = a.projeto_id
      WHERE LOWER(a.aprovador_email) = LOWER(?)
        AND a.veredito = 'pendente'
        AND p.status != 'rascunho'
        AND COALESCE(p.especial, 0) != 1`,
    [email],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Fila do líder: pendências dele + tudo que o card precisa mostrar SEM abrir o projeto
 * (dono, participantes, saving e memorial — pedido do Lucas em 03/08/2026). A fila tem
 * poucas linhas por pessoa, então trazer o memorial aqui é barato — diferente de
 * `getAllReenvios`, que varre TODOS os reenvios e não pode carregar blobs.
 */
export function getAprovacoesPendentesDe(email: string) {
  return queryAll<AprovacaoRow & { projeto_nome: string | null; autor_nome: string | null; area: string | null; submitted_at: string | null; tipos_projeto: string | null; especial: number | null; descricao_breve: string | null; saving_horas: number | null; saving_reais: number | null; tipo_saving: string | null; memorial_calculo: string | null; membros: string | null; membros_papeis: string | null; contexto_especial: string | null; custo_externo_mensal: number | null; ganho_total_mensal: number | null; custo_evitado_itens: string | null; doc_conteudo: string | null; resumo_ia: string | null }>(
    `SELECT a.*, p.nome AS projeto_nome, p.responsavel_nome AS autor_nome, p.area AS area,
            p.submitted_at AS submitted_at, p.tipos_projeto AS tipos_projeto, p.especial AS especial,
            p.descricao_breve AS descricao_breve, p.saving_horas AS saving_horas,
            p.saving_reais AS saving_reais, p.tipo_saving AS tipo_saving,
            p.memorial_calculo AS memorial_calculo, p.membros AS membros,
            p.membros_papeis AS membros_papeis, p.contexto_especial AS contexto_especial,
            p.custo_externo_mensal AS custo_externo_mensal,
            p.ganho_total_mensal AS ganho_total_mensal,
            p.custo_evitado_itens AS custo_evitado_itens,
            d.conteudo AS doc_conteudo,
            (SELECT an.resumo FROM analises an WHERE an.projeto_id = p.id
              ORDER BY an.created_at DESC LIMIT 1) AS resumo_ia
       FROM projeto_aprovacoes a
       JOIN projetos p ON p.id = a.projeto_id
       LEFT JOIN documentacao d ON d.projeto_id = p.id
      WHERE LOWER(a.aprovador_email) = LOWER(?)
        AND a.veredito = 'pendente'
        AND p.status != 'rascunho'
        AND COALESCE(p.especial, 0) != 1
      ORDER BY a.criado_em DESC`,
    [email],
  );
}

/**
 * Snapshot da RELAÇÃO líder↔liderados-pendentes, para o POST diário ao Gomoon (D17).
 * Uma linha por par (líder, liderado) com quantos projetos daquele liderado esperam
 * o parecer daquele líder.
 *
 * ⚠️ A relação sai da PRÓPRIA FILA, não da TeamGuide: `projeto_aprovacoes` já foi
 * escrita a partir dela na submissão. Reconsultar a TeamGuide aqui só criaria uma
 * segunda régua (e um jeito de o payload divergir do que a tela `/aprovacoes` mostra).
 *
 * ⚠️ NENHUM valor em R$ sai daqui — é o que torna impossível vazar saving numa DM
 * (§7 do contrato). Só nome, e-mail e contagem.
 *
 * Filtros: rascunho nunca entra em fila; projeto DESCONTINUADO não precisa mais de
 * parecer; e os projetos de teste do harness (`[E2E-…]`) ficam de fora — o mute de
 * Chat saiu do `abrirPreAprovacao`, então excluí-los é responsabilidade de quem monta
 * o payload. (`LIKE` no SQLite não trata `[` como especial — o prefixo casa literal.)
 */
export function getPendenciasPorLider() {
  return queryAll<{
    lider_email: string;
    lider_nome: string | null;
    liderado_email: string | null;
    liderado_nome: string | null;
    projetos_pendentes: number;
  }>(
    `SELECT LOWER(TRIM(a.aprovador_email))                                  AS lider_email,
            MAX(a.aprovador_nome)                                           AS lider_nome,
            LOWER(TRIM(COALESCE(NULLIF(TRIM(a.autor_email), ''),
                                p.responsavel_email, '')))                  AS liderado_email,
            MAX(COALESCE(p.responsavel_nome, ''))                           AS liderado_nome,
            COUNT(*)                                                        AS projetos_pendentes
       FROM projeto_aprovacoes a
       JOIN projetos p ON p.id = a.projeto_id
      WHERE a.veredito = 'pendente'
        AND COALESCE(TRIM(a.aprovador_email), '') != ''
        AND p.status != 'rascunho'
        AND COALESCE(p.descontinuado, 0) != 1
        AND COALESCE(p.especial, 0) != 1
        AND COALESCE(p.nome, '') NOT LIKE '[E2E-%'
      GROUP BY lider_email, liderado_email
      ORDER BY lider_email, projetos_pendentes DESC, liderado_email`,
    [],
  );
}

/** Todas as linhas de um projeto (a decisão de um líder resolve para os demais — D4). */
export function getAprovacoesDoProjeto(projetoId: string) {
  return queryAll<AprovacaoRow>(
    'SELECT * FROM projeto_aprovacoes WHERE projeto_id = ? ORDER BY criado_em',
    [projetoId],
  );
}

/**
 * Grava a decisão em TODAS as linhas do projeto (D4: o primeiro que decide resolve).
 * `decidido_por` guarda quem realmente decidiu, mesmo nas linhas dos outros líderes.
 */
export function decidirAprovacoesDoProjeto(
  projetoId: string,
  // 3 desfechos desde 04/08/2026: 'ajuste' devolve ao autor, 'reprovado' é recusa.
  veredito: 'aprovado' | 'ajuste' | 'reprovado',
  comentario: string | null,
  decididoPor: string,
  respostas?: { move_kpi: string; sente_falta: string; saving_coerente: string } | null,
): Promise<void> {
  return exec(
    `UPDATE projeto_aprovacoes
        SET veredito = ?, comentario = ?, decidido_por = ?, decidido_em = datetime('now'),
            resp_move_kpi = ?, resp_sente_falta = ?, resp_saving_coerente = ?
      WHERE projeto_id = ? AND veredito = 'pendente'`,
    [
      veredito,
      comentario,
      decididoPor.trim().toLowerCase(),
      respostas?.move_kpi ?? null,
      respostas?.sente_falta ?? null,
      respostas?.saving_coerente ?? null,
      projetoId,
    ],
  );
}

/**
 * DISPENSA a fila do projeto (D29): o analisador reprovou por critério, então o parecer
 * do líder deixou de ser necessário e ele para de ser cobrado por algo que o sistema já
 * recusou. `decidido_por = 'sistema'` é o sentinela que distingue isto de uma decisão
 * humana em toda a leitura (rótulos do Sheets, reabertura, card do autor).
 *
 * ⚠️ `AND veredito = 'pendente'` é a invariante: linha JÁ decidida por um líder fica
 * INTACTA — a análise roda depois da submissão e pode chegar quando ele já opinou.
 */
export function dispensarAprovacoesPendentes(
  projetoId: string,
  comentario: string | null,
): Promise<void> {
  return exec(
    `UPDATE projeto_aprovacoes
        SET veredito = 'dispensado', comentario = ?, decidido_por = 'sistema',
            decidido_em = datetime('now')
      WHERE projeto_id = ? AND veredito = 'pendente'`,
    [comentario, projetoId],
  );
}

/** Resumo (1 linha por projeto) para os cards de "Meus Projetos" do autor. */
export function getAprovacoesDeProjetos(ids: string[]) {
  if (!ids.length) return Promise.resolve([] as AprovacaoRow[]);
  const marcas = ids.map(() => '?').join(',');
  return queryAll<AprovacaoRow>(
    `SELECT * FROM projeto_aprovacoes WHERE projeto_id IN (${marcas}) ORDER BY criado_em`,
    ids,
  );
}

// Histórico de status de um projeto (mais recente primeiro) — exibido no detalhe.
export function getAdminStatusLogs(projetoId: string, limit = 20) {
  return queryAll<AdminStatusLogRow>(
    'SELECT * FROM admin_status_log WHERE LOWER(projeto_id) = LOWER(?) ORDER BY created_at DESC LIMIT ?',
    [projetoId, limit],
  );
}

// Último disparo por e-mail (case-insensitive), para exibir "já enviado em…" na tela.
// Escopado por SEGMENTO quando `audiencia` é informada — o selo de "reenvio" não deve
// considerar um envio de "legado" para a mesma pessoa (são campanhas distintas). Sem
// argumento, considera todos os segmentos (compat).
export async function getUltimosDisparosPorEmail(
  audiencia?: string,
): Promise<Map<string, { created_at: string | null; status: string }>> {
  const rows = await queryAll<EmailDisparoRow>(
    audiencia
      ? `SELECT email, status, created_at FROM email_disparos WHERE audiencia = ? ORDER BY created_at DESC`
      : `SELECT email, status, created_at FROM email_disparos ORDER BY created_at DESC`,
    audiencia ? [audiencia] : [],
  );
  const map = new Map<string, { created_at: string | null; status: string }>();
  for (const r of rows) {
    const key = (r.email ?? '').trim().toLowerCase();
    if (!key || map.has(key)) continue; // já ordenado desc → primeiro é o mais recente
    map.set(key, { created_at: r.created_at, status: r.status });
  }
  return map;
}

// ─── FAQ (categorias → tópicos) ─────────────────────────────────────────────
//
// Leitura pública (qualquer logado) e escrita só de admin. Tabelas INTERNAS: nada disso
// vai para o Sheets nem participa do sync reverso. Ver spec-docs/SPEC_FAQ.md.

export type FaqCategoriaRow = {
  id: string;
  slug: string;
  titulo: string;
  resumo: string | null;
  /** Documento da categoria em markdown leve (SPEC_FAQ D13). */
  corpo: string | null;
  ordem: number;
  arquivado: number;
  criado_em: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
};

/**
 * O FAQ inteiro em **1 SELECT** — cada categoria é um documento, então não há nível
 * filho para buscar. (A tabela `faq_itens` é LEGADO: guarda os textos da 1ª versão e
 * não tem mais leitor.)
 */
export async function getFaqCategoriasRows(): Promise<FaqCategoriaRow[]> {
  return queryAll<FaqCategoriaRow>(
    'SELECT * FROM faq_categorias ORDER BY ordem ASC, criado_em ASC',
    [],
  );
}

export async function insertFaqCategoria(dados: {
  slug: string;
  titulo: string;
  resumo?: string | null;
  corpo?: string | null;
  ordem?: number;
  atualizado_por?: string | null;
}): Promise<FaqCategoriaRow> {
  const id = generateId();
  await exec(
    `INSERT INTO faq_categorias (id, slug, titulo, resumo, corpo, ordem, arquivado, criado_em, atualizado_em, atualizado_por)
     VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'), ?)`,
    [
      id,
      dados.slug,
      dados.titulo,
      dados.resumo ?? null,
      dados.corpo ?? null,
      dados.ordem ?? 0,
      dados.atualizado_por ?? null,
    ],
  );
  return (await queryOne<FaqCategoriaRow>('SELECT * FROM faq_categorias WHERE id = ?', [id]))!;
}

/** Atualiza título/resumo/corpo. ⚠️ NUNCA o slug — ele é imutável (D2: o link já circula). */
export async function updateFaqCategoria(
  id: string,
  dados: {
    titulo: string;
    resumo?: string | null;
    corpo?: string | null;
    atualizado_por?: string | null;
  },
): Promise<void> {
  await exec(
    `UPDATE faq_categorias
        SET titulo = ?, resumo = ?, corpo = ?, atualizado_em = datetime('now'), atualizado_por = ?
      WHERE id = ?`,
    [dados.titulo, dados.resumo ?? null, dados.corpo ?? null, dados.atualizado_por ?? null, id],
  );
}

/**
 * Preenche o `corpo` de uma categoria que existe com o campo VAZIO — o backfill da coluna
 * nova (D13). ⚠️ O `AND (corpo IS NULL OR trim(corpo) = '')` é a trava: sem ele o seed
 * passaria por cima do documento que o admin escreveu, quebrando a idempotência (D1).
 */
export async function backfillCorpoFaqCategoria(id: string, corpo: string): Promise<void> {
  await exec(
    `UPDATE faq_categorias
        SET corpo = ?, atualizado_em = datetime('now'), atualizado_por = 'seed'
      WHERE id = ? AND (corpo IS NULL OR trim(corpo) = '')`,
    [corpo, id],
  );
}

/** Arquivar/restaurar — o "remover" desta feature (D6). Não existe DELETE. */
export async function setArquivadoFaqCategoria(
  id: string,
  arquivado: boolean,
  email?: string | null,
): Promise<void> {
  await exec(
    `UPDATE faq_categorias SET arquivado = ?, atualizado_em = datetime('now'), atualizado_por = ? WHERE id = ?`,
    [arquivado ? 1 : 0, email ?? null, id],
  );
}

export async function setOrdemFaqCategoria(id: string, ordem: number): Promise<void> {
  await exec(`UPDATE faq_categorias SET ordem = ? WHERE id = ?`, [ordem, id]);
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
  membros: string | null; // JSON string (lista plana de todos os participantes)
  membros_papeis: string | null; // JSON string (mapa e-mail→papel)
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
  custo_projeto: string | null; // 'sim'|'nao' — solução consome serviço externo pago pra rodar?
  custo_projeto_justificativa: string | null; // texto concatenado dos serviços do projeto
  custo_projeto_itens: string | null; // JSON [{nome,valor,recorrencia,justificativa}] — ABATE
  ganho_total_mensal: number | null;
  complexidade: string | null;
  alguem_fazia: string | null; // 'sim' | 'nao' — havia trabalho manual antes
  observacoes: string | null; // parecer da análise automática (staff-only)
  especial: number | null; // 1 = projeto especial (altíssimo impacto, validação humana)
  contexto_especial: string | null; // descrição do contexto do projeto especial (etapa 2.5)
  usa_ai_proxy: string | null; // 'sim' | 'nao' — usa o AI Proxy interno (governança de custo)
  // Contrafactual — resposta determinística da Etapa 2 (não barra submissão).
  // "pessoa:a@x.com;b@y.com" | "time:Fiscal;CX" — quem sentiria falta (Team Guide).
  contrafactual_afetados: string | null;
  // ⚠️ LEGADO: o "o que piora se desligar hoje" saiu do formulário em 03/08/2026 — nunca
  // teve coluna própria no Sheets e o agente cobre o efeito na conversa. A coluna fica
  // pelos projetos submetidos enquanto a pergunta existia; nada a escreve nem a lê mais.
  contrafactual_reclamacao: string | null;
  // ⚠️ LEGADO: a rastreabilidade (ponteiro movido + onde verificar) saiu do formulário e
  // hoje é conduzida pelo AGENTE no memorial. Nada escreve mais estas duas colunas.
  ponteiro_movido: string | null;
  ponteiro_evidencia: string | null;
  // Classificação de elegibilidade do analisador ("isto é projeto?"). A justificativa é
  // SEMPRE preenchida; o motivo só existe em 'claro_nao'. Ver normalizarClassificacao.
  classificacao_avaliacao: string | null; // 'claro_sim' | 'claro_nao' | 'zona_cinzenta'
  classificacao_justificativa: string | null;
  motivo_reprovacao: string | null;
  arquivos_nomes: string | null; // JSON array de nomes dos arquivos enviados no upload
  arquivos_links: string | null; // JSON array de links (webViewLink) dos arquivos no Drive
  submitted_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
  // Espelho do "Atualizado Em" do Sheets. NULL = app nunca sincronizou p/ a planilha
  // = legado pendente (alimenta a contagem de pendentes sem ler o Sheets).
  atualizado_em: string | null;
  // Editores delegados (JSON array de emails). Participantes a quem o dono delegou o
  // poder de edição. Conceito interno (não vai ao Sheets). Ver meus-projetos.functions.ts.
  editores_delegados: string | null;
  // Projeto descontinuado (a automação não roda mais). 1 = descontinuado; 0/null = ativo.
  // Marcado pelo dono/editor em "Meus Projetos"; para de contar como pendência. FONTE DA
  // VERDADE no app (o Status do Sheets não volta pelo sync reverso). Ver meus-projetos.functions.ts.
  descontinuado: number | null;
  // Split do saving (só quando alguem_fazia='sim'): carga humana real × ganho por escala.
  // Somam saving_horas (o total que vira R$). Transparência → Sheets "Saving Horas Real"/
  // "Saving Horas Escalado". Null quando não se aplica (ninguém fazia / pontual).
  horas_carga_real: number | null;
  horas_escala: number | null;
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
