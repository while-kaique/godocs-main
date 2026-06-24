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

  -- Eventos determinísticos do formulário (saving mensal, horas, custo evitado,
  -- receita, metadados…) e marcadores de "voltar etapa". APPEND-ONLY: ao contrário
  -- de chat_messages, NUNCA são apagados quando a pessoa volta etapas e reinicia o
  -- agente (deleteChatMessages*). É a fonte de verdade do timeline do Investigador:
  -- como os valores chegam por payloads e não viram chat, sem isto não apareceriam.
  -- 'tipo': submissao|saving|receita|tipos|metadados|back|submit.
  -- 'fase': fase do chat à qual o evento se alinha (doc|saving|receita) — usada para
  -- intercalar o evento no lugar certo do histórico.
  -- 'dados': JSON com pares legíveis (label → valor) já prontos para exibição.
  CREATE TABLE IF NOT EXISTS form_events (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    fase TEXT,
    dados TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_form_events_projeto_id
    ON form_events(projeto_id);
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
'ALTER TABLE projetos ADD COLUMN arquivos_links TEXT',
  // Custo evitado: a solução fez a empresa DEIXAR de pagar ferramentas/serviços
  // externos? `custo_evitado` = 'sim'|'nao'; `custo_evitado_justificativa` = texto
  // concatenado legível; `custo_evitado_itens` = JSON [{nome,valor,recorrencia,justificativa}].
  // O valor (mensalizado: pontual ÷12) entra no saving_reais/ganho_total. Coletado no
  // formulário de saving (≠ custo_externo_mensal, que é o custo INCORRIDO).
  'ALTER TABLE projetos ADD COLUMN custo_evitado TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_evitado_justificativa TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_evitado_itens TEXT',
  // Custos do projeto: serviços externos PAGOS que a solução INTERNA consome pra
  // rodar (chave de API, ElevenLabs…). `custo_projeto` = 'sim'|'nao'; justificativa =
  // texto legível; itens = JSON [{nome,valor,recorrencia,justificativa}]. O valor
  // (mensalizado: pontual ÷12) SUBTRAI do saving_reais/ganho_total. Distinto de
  // custo_externo_mensal (escopo externo) e de custo_evitado (que SOMA).
  'ALTER TABLE projetos ADD COLUMN custo_projeto TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_projeto_justificativa TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_projeto_itens TEXT',
  // Snapshot imutável da conversa (chat_messages) no momento de cada submissão/reenvio.
  // Os chat_messages são mutados/apagados in-place quando a pessoa volta etapas; este
  // snapshot preserva a conversa ORIGINAL de cada versão para o Investigador (abas
  // Submetidos × Edições). Forward-only: versões antigas (anteriores a esta coluna)
  // ficam com snapshot_chat NULL e caem no fallback do chat atual.
  'ALTER TABLE projeto_versions ADD COLUMN snapshot_chat TEXT',
  // Espelho do "Atualizado Em" do Sheets (carimbo da última escrita do sistema na
  // planilha). NULL = o app nunca sincronizou este projeto p/ o Sheets = legado
  // pendente de regularização. Persistir no SQLite deixa a contagem de pendentes
  // (selo da home) instantânea, sem precisar ler a planilha a cada load.
  'ALTER TABLE projetos ADD COLUMN atualizado_em TEXT',
  // Editores delegados (JSON array de emails). O dono pode distribuir o poder de
  // edição a participantes específicos (membros), que passam a editar/reenviar
  // "como se fossem o dono". Conceito INTERNO do app — NÃO existe coluna no Sheets,
  // então o sync reverso nunca toca este campo (a delegação sobrevive aos syncs).
  // Permissão efetiva = interseção com `membros` (sai de membros → perde o poder).
  'ALTER TABLE projetos ADD COLUMN editores_delegados TEXT',
];

// Projetos LEGADO — importados manualmente (anteriores ao formulário GoDocs).
// INSERT OR IGNORE com `id` fixo garante idempotência: roda em todo cold start
// mas só insere uma vez. Cada entrada é um array de params na ordem do INSERT abaixo.
// Para adicionar novos legados, basta acrescentar um array aqui.
const SEED_PROJETOS_LEGADO_SQL = `
  INSERT OR IGNORE INTO projetos (
    id, nome, responsavel_nome, responsavel_email, area, ferramenta, escopo,
    membros, status, chat_completo, data_criacao_projeto, tipo_projeto, tipos_projeto,
    descricao_breve, saving_horas, saving_reais, tipo_saving, memorial_calculo,
    custo_externo_mensal, ganho_total_mensal, alguem_fazia, complexidade, observacoes,
    especial, submitted_at, validated_at, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  );
`;

const SEED_PROJETOS_LEGADO: (string | number | null)[][] = [
  [
    /* id                    */ 'legado-270',
    /* nome                  */ 'HRBP Workspace',
    /* responsavel_nome      */ 'Erivania Apolonia Santos Martins',
    /* responsavel_email     */ 'erivania.martins@gocase.com',
    /* area                  */ 'Gente e Gestão',
    /* ferramenta            */ 'Claude Code',
    /* escopo                */ 'interno',
    /* membros               */ null,
    /* status                */ 'aprovado',
    /* chat_completo         */ 1,
    /* data_criacao_projeto  */ '2026-05-15',
    /* tipo_projeto          */ 'saving',
    /* tipos_projeto         */ '["saving"]',
    /* descricao_breve       */ 'Workspace centralizado para HRBPs com dados e ferramentas de gestão de pessoas.',
    /* saving_horas          */ 12,
    /* saving_reais          */ 661.8,
    /* tipo_saving           */ 'mensal',
    /* memorial_calculo      */
      '12h × R$55,15 (Coord) = R$661,80.\n\n' +
      '- Tempo semanal economizado: 3h, totalizando 12h mensais de um Especialista.\n\n' +
      'Esse saving considera apenas o tempo direto de compilação e preparação de relatórios ' +
      'semanais para liderança, que passou a ser gerado automaticamente pela plataforma. ' +
      'Não estão incluídos ganhos adicionais como redução no tempo de atualização de organogramas, ' +
      'gestão de vagas e acompanhamento de riscos de turnover — o que torna esse número conservador.',
    /* custo_externo_mensal  */ 0,
    /* ganho_total_mensal    */ 661.8,
    /* alguem_fazia          */ 'sim',
    /* complexidade          */ 'automacao',
    /* observacoes           */
      'Projeto legado (código original: LEGADO-270), importado manualmente — anterior ao formulário GoDocs. ' +
      'Parecer original: "Saving OK. R$55,15 ✓." ' +
      'Documento: https://drive.google.com/file/d/1i_fwDL-_ME0InuR84eDWJHFkwDHVbrYe/view',
    /* especial              */ 0,
    /* submitted_at          */ '2026-06-09T12:00:00.000Z',
    /* validated_at          */ '2026-06-09T12:00:00.000Z',
    /* created_at            */ '2026-06-09T12:00:00.000Z',
    /* updated_at            */ '2026-06-09T12:00:00.000Z',
  ],
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

  // Seed de projetos legado (idempotente — id fixo + INSERT OR IGNORE)
  for (const params of SEED_PROJETOS_LEGADO) {
    try {
      await db.exec(SEED_PROJETOS_LEGADO_SQL, params);
    } catch (e) {
      console.error('[schema] Falha ao inserir projeto legado:', e);
    }
  }
}
