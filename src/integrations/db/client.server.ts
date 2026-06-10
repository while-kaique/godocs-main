// SQLite database client (server-only)
import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { initSchema } from './schema';

let _db: BetterSqlite3.Database | undefined;

export function getDb(): BetterSqlite3.Database {
  if (!_db) {
    const dbPath = process.env.DATABASE_PATH || path.resolve('godocs.db');
    _db = new BetterSqlite3(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

// ─── Helpers genéricos para simplificar queries ─────────────────────────────

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
  return getDb().prepare('SELECT * FROM admins ORDER BY email').all() as AdminRow[];
}

export function getAdminByEmail(email: string) {
  return getDb().prepare('SELECT * FROM admins WHERE email = ?').get(email) as AdminRow | undefined;
}

export function insertAdmin(email: string, nome?: string | null) {
  const id = generateId();
  getDb().prepare('INSERT INTO admins (id, email, nome) VALUES (?, ?, ?)').run(id, email, nome ?? null);
  return getDb().prepare('SELECT * FROM admins WHERE id = ?').get(id) as AdminRow;
}

export function deleteAdmin(id: string) {
  getDb().prepare('DELETE FROM admins WHERE id = ?').run(id);
}

// --- Areas ---

export function getAreas() {
  return getDb().prepare('SELECT * FROM areas ORDER BY nome').all() as AreaRow[];
}

export function getAreaById(id: string) {
  return getDb().prepare('SELECT * FROM areas WHERE id = ?').get(id) as AreaRow | undefined;
}

export function insertArea(nome: string) {
  const id = generateId();
  getDb().prepare('INSERT INTO areas (id, nome) VALUES (?, ?)').run(id, nome);
  return getDb().prepare('SELECT * FROM areas WHERE id = ?').get(id) as AreaRow;
}

export function deleteArea(id: string) {
  getDb().prepare('DELETE FROM areas WHERE id = ?').run(id);
}

// --- Projetos ---

export function getProjetosWithArea() {
  return getDb().prepare(`
    SELECT p.*, a.nome as area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    ORDER BY p.created_at DESC
  `).all() as (ProjetoRow & { area_nome: string | null })[];
}

export function getProjetoById(id: string) {
  return getDb().prepare('SELECT * FROM projetos WHERE id = ?').get(id) as ProjetoRow | undefined;
}

export function getProjetoWithRelations(id: string) {
  const projeto = getDb().prepare(`
    SELECT p.*, a.nome as area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    WHERE p.id = ?
  `).get(id) as (ProjetoRow & { area_nome: string | null }) | undefined;
  if (!projeto) return undefined;

  const chatMessages = getDb().prepare(
    'SELECT * FROM chat_messages WHERE projeto_id = ? ORDER BY created_at'
  ).all(id) as ChatMessageRow[];

  const documentacao = getDb().prepare(
    'SELECT * FROM documentacao WHERE projeto_id = ?'
  ).all(id) as DocumentacaoRow[];

  const validacoes = getDb().prepare(
    'SELECT * FROM validacoes WHERE projeto_id = ?'
  ).all(id) as ValidacaoRow[];

  return { ...projeto, chat_messages: chatMessages, documentacao, validacoes };
}

export function getProjetoContextoData(id: string) {
  return getDb().prepare(`
    SELECT p.responsavel_nome, p.responsavel_email, p.ferramenta, p.membros,
           p.nome, p.tipo_projeto, p.tipos_projeto, p.escopo, a.nome as area_nome
    FROM projetos p
    LEFT JOIN areas a ON p.area_id = a.id
    WHERE p.id = ?
  `).get(id) as (Pick<ProjetoRow, 'responsavel_nome' | 'responsavel_email' | 'ferramenta' | 'membros' | 'nome' | 'tipo_projeto' | 'tipos_projeto' | 'escopo'> & { area_nome: string | null }) | undefined;
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
  status?: string;
};

export function insertProjeto(data: InsertProjeto) {
  const id = generateId();
  const now = nowISO();
  getDb().prepare(`
    INSERT INTO projetos (id, responsavel_nome, responsavel_email, area_id, area, ferramenta,
      escopo, servico_externo, membros, nome, data_criacao_projeto, tipo_projeto, tipos_projeto,
      descricao_breve, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    data.status ?? 'rascunho',
    now,
    now,
  );
  return getDb().prepare('SELECT * FROM projetos WHERE id = ?').get(id) as ProjetoRow;
}

export function updateProjeto(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => {
    const v = fields[k];
    if (v === undefined) return null;
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
  getDb().prepare(`UPDATE projetos SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, nowISO(), id);
}

export function findDuplicateProjeto(nome: string, excludeId: string) {
  return getDb().prepare(
    "SELECT id FROM projetos WHERE nome = ? AND id != ? AND status != 'rascunho' LIMIT 1"
  ).get(nome, excludeId) as { id: string } | undefined;
}

// --- Chat Messages ---

export function getChatMessages(projetoId: string) {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE projeto_id = ? ORDER BY created_at'
  ).all(projetoId) as ChatMessageRow[];
}

export function getChatMessagesExcludeRole(projetoId: string, excludeRole: string) {
  return getDb().prepare(
    'SELECT role, content FROM chat_messages WHERE projeto_id = ? AND role != ? ORDER BY created_at'
  ).all(projetoId, excludeRole) as { role: string; content: string }[];
}

export function getDocMessage(projetoId: string) {
  return getDb().prepare(
    "SELECT content FROM chat_messages WHERE projeto_id = ? AND role = 'doc' LIMIT 1"
  ).get(projetoId) as { content: string } | undefined;
}

export function insertChatMessage(data: {
  projeto_id: string;
  role: string;
  content: string;
  options?: unknown;
  selected_option?: number | null;
}) {
  const id = generateId();
  getDb().prepare(`
    INSERT INTO chat_messages (id, projeto_id, role, content, options, selected_option)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.projeto_id,
    data.role,
    data.content,
    data.options ? JSON.stringify(data.options) : null,
    data.selected_option ?? null,
  );
  return getDb().prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as ChatMessageRow;
}

// --- Documentacao ---

export function getDocumentacao(projetoId: string) {
  const row = getDb().prepare(
    'SELECT * FROM documentacao WHERE projeto_id = ?'
  ).get(projetoId) as DocumentacaoRow | undefined;
  return row;
}

export function upsertDocumentacao(projetoId: string, conteudo: unknown) {
  const existing = getDb().prepare('SELECT id FROM documentacao WHERE projeto_id = ?').get(projetoId) as { id: string } | undefined;
  const now = nowISO();
  const json = JSON.stringify(conteudo);
  if (existing) {
    getDb().prepare('UPDATE documentacao SET conteudo = ?, updated_at = ? WHERE projeto_id = ?').run(json, now, projetoId);
  } else {
    const id = generateId();
    getDb().prepare('INSERT INTO documentacao (id, projeto_id, conteudo, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, projetoId, json, now, now);
  }
}

// --- Validacoes ---

export function insertValidacao(data: {
  projeto_id: string;
  resultado: string;
  parecer: string;
  criterios?: unknown;
  admin_email?: string | null;
}) {
  const id = generateId();
  getDb().prepare(`
    INSERT INTO validacoes (id, projeto_id, resultado, parecer, criterios, admin_email)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.projeto_id, data.resultado, data.parecer, data.criterios ? JSON.stringify(data.criterios) : null, data.admin_email ?? null);
  return id;
}

export function updateValidacaoEmailEnviado(projetoId: string) {
  getDb().prepare('UPDATE validacoes SET email_enviado = 1 WHERE projeto_id = ?').run(projetoId);
}

// --- Configuracoes ---

export function getConfiguracoes() {
  return getDb().prepare('SELECT * FROM configuracoes ORDER BY chave').all() as ConfiguracaoRow[];
}

export function getConfiguracao(chave: string) {
  return getDb().prepare('SELECT * FROM configuracoes WHERE chave = ?').get(chave) as ConfiguracaoRow | undefined;
}

export function updateConfiguracao(chave: string, valor: unknown, updatedBy: string) {
  const now = nowISO();
  getDb().prepare('UPDATE configuracoes SET valor = ?, updated_by = ?, updated_at = ? WHERE chave = ?').run(
    JSON.stringify(valor), updatedBy, now, chave
  );
}

// --- Profiles ---

export function getProfiles() {
  return getDb().prepare('SELECT id, nome, email FROM profiles ORDER BY nome').all() as ProfileRow[];
}

export function getProfileById(id: string) {
  return getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
}

export function upsertProfile(id: string, nome: string, email: string) {
  const existing = getDb().prepare('SELECT id FROM profiles WHERE id = ?').get(id) as { id: string } | undefined;
  if (existing) {
    getDb().prepare('UPDATE profiles SET nome = ?, email = ? WHERE id = ?').run(nome, email, id);
  } else {
    getDb().prepare('INSERT INTO profiles (id, nome, email) VALUES (?, ?, ?)').run(id, nome, email);
  }
}

export function deleteProfile(id: string) {
  getDb().prepare('DELETE FROM profiles WHERE id = ?').run(id);
}

// --- User Roles ---

export function getUserRoles() {
  return getDb().prepare('SELECT user_id, role FROM user_roles').all() as UserRoleRow[];
}

export function getUserRole(userId: string, role?: string) {
  if (role) {
    return getDb().prepare('SELECT * FROM user_roles WHERE user_id = ? AND role = ?').get(userId, role) as UserRoleRow | undefined;
  }
  return getDb().prepare('SELECT * FROM user_roles WHERE user_id = ?').get(userId) as UserRoleRow | undefined;
}

export function deleteUserRoles(userId: string) {
  getDb().prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
}

export function insertUserRole(userId: string, role: string) {
  getDb().prepare('INSERT OR REPLACE INTO user_roles (user_id, role) VALUES (?, ?)').run(userId, role);
}

// --- Leader Areas ---

export function getLeaderAreas() {
  return getDb().prepare('SELECT user_id, area_id FROM leader_areas').all() as LeaderAreaRow[];
}

export function deleteLeaderAreas(userId: string) {
  getDb().prepare('DELETE FROM leader_areas WHERE user_id = ?').run(userId);
}

export function insertLeaderAreas(userId: string, areaIds: string[]) {
  const stmt = getDb().prepare('INSERT INTO leader_areas (user_id, area_id) VALUES (?, ?)');
  const tx = getDb().transaction((ids: string[]) => {
    for (const areaId of ids) {
      stmt.run(userId, areaId);
    }
  });
  tx(areaIds);
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
  submitted_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
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
