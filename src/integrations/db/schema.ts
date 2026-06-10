// Schema SQLite — cria todas as tabelas na primeira execução
import type Database from 'better-sqlite3';

export function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT NOT NULL UNIQUE,
      nome TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS areas (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projetos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome TEXT,
      responsavel_nome TEXT NOT NULL,
      responsavel_email TEXT NOT NULL,
      area TEXT,
      area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
      ferramenta TEXT NOT NULL,
      escopo TEXT,
      servico_externo TEXT,
      membros TEXT, -- JSON array
      status TEXT DEFAULT 'rascunho' CHECK(status IN ('rascunho','em_validacao','validado','rejeitado','aprovado')),
      chat_completo INTEGER DEFAULT 0,
      data_criacao_projeto TEXT,
      tipo_projeto TEXT,
      tipos_projeto TEXT, -- JSON array
      descricao_breve TEXT,
      saving_horas REAL,
      saving_reais REAL,
      tipo_saving TEXT,
      memorial_calculo TEXT,
      custo_externo_mensal REAL,
      submitted_at TEXT,
      validated_at TEXT,
      validated_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      options TEXT, -- JSON
      selected_option INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documentacao (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      projeto_id TEXT NOT NULL UNIQUE REFERENCES projetos(id) ON DELETE CASCADE,
      conteudo TEXT NOT NULL, -- JSON
      versao INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS validacoes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
      resultado TEXT NOT NULL,
      parecer TEXT NOT NULL,
      criterios TEXT, -- JSON
      admin_email TEXT,
      email_enviado INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      chave TEXT NOT NULL UNIQUE,
      valor TEXT NOT NULL, -- JSON
      descricao TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('admin_master','leader')),
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE IF NOT EXISTS leader_areas (
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, area_id)
    );
  `);
}
