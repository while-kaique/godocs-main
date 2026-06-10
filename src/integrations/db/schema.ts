// Schema SQLite — cria todas as tabelas na primeira execução
// Usa a interface GoDeployDB (compatível com env.DB do Godeploy e wrapper better-sqlite3 em dev)

import type { GoDeployDB } from './db-adapter';

const SCHEMA_SQL = `
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
    membros TEXT,
    status TEXT DEFAULT 'rascunho' CHECK(status IN ('rascunho','em_validacao','validado','rejeitado','aprovado')),
    chat_completo INTEGER DEFAULT 0,
    data_criacao_projeto TEXT,
    tipo_projeto TEXT,
    tipos_projeto TEXT,
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
    options TEXT,
    selected_option INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documentacao (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id TEXT NOT NULL UNIQUE REFERENCES projetos(id) ON DELETE CASCADE,
    conteudo TEXT NOT NULL,
    versao INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS validacoes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    resultado TEXT NOT NULL,
    parecer TEXT NOT NULL,
    criterios TEXT,
    admin_email TEXT,
    email_enviado INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS configuracoes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    chave TEXT NOT NULL UNIQUE,
    valor TEXT NOT NULL,
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
`;

export async function initSchema(db: GoDeployDB) {
  // env.DB.exec do Godeploy não suporta múltiplos statements em uma única chamada.
  // Dividimos o SQL por ';' e executamos cada statement separadamente.
  // O env.DB é assíncrono e exige o argumento de params sempre (mesmo []).
  const statements = SCHEMA_SQL
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await db.exec(stmt + ';', []);
  }
}
