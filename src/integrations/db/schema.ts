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
    ganho_total_mensal REAL,
    alguem_fazia TEXT,
    observacoes TEXT,
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

  CREATE TABLE IF NOT EXISTS projeto_versions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao_num INTEGER NOT NULL,
    acao TEXT NOT NULL CHECK(acao IN ('submit_inicial','reenvio')),
    snapshot_projeto TEXT NOT NULL,
    snapshot_doc TEXT,
    submetido_por TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(projeto_id, versao_num)
  );

  CREATE INDEX IF NOT EXISTS idx_projeto_versions_projeto_id
    ON projeto_versions(projeto_id);

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

  CREATE TABLE IF NOT EXISTS analises (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    resultado TEXT NOT NULL,
    pontuacao_total INTEGER NOT NULL,
    pontuacao_maxima INTEGER NOT NULL,
    justificativa TEXT NOT NULL,
    resumo TEXT,
    criterios_hardcoded TEXT,
    criterios_dinamicos TEXT,
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

  CREATE TABLE IF NOT EXISTS api_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id TEXT REFERENCES projetos(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'POST',
    duration_ms INTEGER,
    status_code INTEGER NOT NULL DEFAULT 200,
    error TEXT,
    request_size INTEGER,
    response_size INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
`;

// Migrações seguras — ALTER TABLE com tratamento de "duplicate column" para bancos existentes.
// Cada migração roda em try/catch: se a coluna já existir (banco novo), ignora silenciosamente.
const MIGRATIONS = [
  'ALTER TABLE analises ADD COLUMN resumo TEXT',
  'ALTER TABLE projetos ADD COLUMN ganho_total_mensal REAL',
  'ALTER TABLE projetos ADD COLUMN complexidade TEXT',
  // Saving: havia alguém fazendo o processo manualmente antes da automação? ('sim'|'nao')
  // Renomeado de tinha_pessoa_antes → alguem_fazia (mais descritivo). O RENAME cobre
  // bancos que já receberam a coluna antiga; o ADD é fallback para bancos novos.
  // Ambos em try/catch: o que não se aplicar é ignorado silenciosamente.
  'ALTER TABLE projetos RENAME COLUMN tinha_pessoa_antes TO alguem_fazia',
  'ALTER TABLE projetos ADD COLUMN alguem_fazia TEXT',
  // Observações da análise automática (parecer da IA) — só para staff, não exibido ao usuário.
  'ALTER TABLE projetos ADD COLUMN observacoes TEXT',
  // Rastreamento de sincronização com n8n
  'ALTER TABLE projetos ADD COLUMN webhook_sync TEXT',
  'ALTER TABLE projetos ADD COLUMN webhook_error TEXT',
  // Justificativa da classificação de complexidade (por que automacao/inteligencia/autonomia)
  'ALTER TABLE analises ADD COLUMN complexidade_justificativa TEXT',
  // Corpos de request/response para debug no investigador
  'ALTER TABLE api_logs ADD COLUMN request_body TEXT',
  'ALTER TABLE api_logs ADD COLUMN response_body TEXT',
  // Projeto ESPECIAL ("estrela do Mario Kart"): altíssimo impacto que NÃO se encaixa
  // em saving nem receita incremental. Pula a análise financeira e o analisador IA —
  // validação é feita por um humano. `especial` é a flag; `contexto_especial` é a
  // descrição do contexto do projeto especial coletada na etapa 2.5.
  'ALTER TABLE projetos ADD COLUMN especial INTEGER DEFAULT 0',
  'ALTER TABLE projetos ADD COLUMN contexto_especial TEXT',
  // Nomes dos arquivos enviados no upload (JSON array de strings) — exibidos na edição
  'ALTER TABLE projetos ADD COLUMN arquivos_nomes TEXT',
];

// Admins iniciais — INSERT OR IGNORE garante idempotência (se já existir, não duplica).
const SEED_ADMINS = [
  'lucas.queiroz@gocase.com',
  'joao.gabriel@gocase.com',
  'joaovictor.esteves@gocase.com',
  'kaique.breno@gocase.com',
  'luciano.cavalcante@gocase.com',
  'luis.albuquerque@gocase.com',
];

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

  // Migrações pós-schema (idempotentes)
  for (const migration of MIGRATIONS) {
    try {
      await db.exec(migration + ';', []);
    } catch {
      // Coluna já existe ou tabela não existe — ignorar silenciosamente
    }
  }

  // Seed de admins iniciais
  for (const email of SEED_ADMINS) {
    await db.exec(
      "INSERT OR IGNORE INTO admins (id, email) VALUES (lower(hex(randomblob(16))), ?);",
      [email]
    );
  }
}
