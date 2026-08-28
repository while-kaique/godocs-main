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

  -- Toda leitura de chat filtra por projeto_id. Sem este índice cada consulta
  -- varre a tabela inteira — o que tornava o Investigador (uma consulta por
  -- projeto) inviável quando o volume de mensagens cresceu.
  CREATE INDEX IF NOT EXISTS idx_chat_messages_projeto_id
    ON chat_messages(projeto_id);

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

  -- Log de disparos de e-mail de cobrança de legados pendentes (painel admin).
  -- Uma linha POR DESTINATÁRIO POR DISPARO — registra quem recebeu, quando, por
  -- qual admin e o resultado (sucesso/falha). Serve para mostrar "já enviado em…"
  -- na tela e evitar disparo duplicado acidental (reenvio é permitido, mas
  -- consciente). 'projeto_ids' = JSON dos legados pendentes incluídos no e-mail.
  CREATE TABLE IF NOT EXISTS email_disparos (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email TEXT NOT NULL,
    nome TEXT,
    projeto_ids TEXT,
    assunto TEXT,
    enviado_por TEXT,
    status TEXT NOT NULL DEFAULT 'sucesso',
    erro TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_email_disparos_email
    ON email_disparos(email);

  -- Lote de disparo (progresso). Uma linha por clique em "Enviar para X pessoas":
  -- guarda o total e os contadores que o backend incrementa a cada envio, para o
  -- front exibir barra de progresso + contador NN/total (polling). 'status':
  -- 'enviando' → 'concluido' | 'erro'.
  CREATE TABLE IF NOT EXISTS email_lotes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    total INTEGER NOT NULL DEFAULT 0,
    processados INTEGER NOT NULL DEFAULT 0,
    enviados INTEGER NOT NULL DEFAULT 0,
    falhas INTEGER NOT NULL DEFAULT 0,
    alvos TEXT,
    status TEXT NOT NULL DEFAULT 'enviando',
    iniciado_por TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Chamados do Widget de Ajuda & Suporte (botão flutuante → painel estilo chat).
  -- Mão única: a pessoa envia uma DÚVIDA ou relata um PROBLEMA (opcionalmente com
  -- um print), o backend persiste aqui (fonte de verdade do registro) e notifica um
  -- espaço dedicado do Google Chat. Sem painel admin na v1 — a tabela já guarda tudo
  -- para habilitar um painel futuro sem retrabalho. Ver spec-docs/SPEC_WIDGET_AJUDA.md.
  CREATE TABLE IF NOT EXISTS ajuda_chamados (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    usuario_email   TEXT NOT NULL,
    usuario_nome    TEXT,
    tipo            TEXT NOT NULL DEFAULT 'duvida',    -- 'duvida' | 'problema' | 'sugestao'
    mensagem        TEXT NOT NULL,
    pagina_url      TEXT,                              -- de onde a pessoa abriu o widget
    user_agent      TEXT,
    print_link      TEXT,                              -- webViewLink do Drive (se houver print)
    print_filename  TEXT,
    chat_status     TEXT DEFAULT 'pendente',           -- 'pendente' | 'enviado' | 'falha'
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ajuda_chamados_email ON ajuda_chamados(usuario_email);
  CREATE INDEX IF NOT EXISTS idx_ajuda_chamados_criado ON ajuda_chamados(created_at);

  -- Auditoria da triagem feita no dashboard do admin: quem mudou o "Status" de um
  -- projeto na planilha, de → para, com que motivo e quando. A escrita acontece no
  -- Google Sheets (fonte de verdade do status) e a planilha não guarda autoria — sem
  -- esta tabela, "quem aprovou este projeto?" não tem resposta. Só registro: nada aqui
  -- alimenta a UI de status, e o sync reverso não lê esta tabela.
  -- Ver spec-docs/SPEC_DASHBOARD_ADMIN.md.
  CREATE TABLE IF NOT EXISTS admin_status_log (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id      TEXT NOT NULL,
    projeto_nome    TEXT,
    status_anterior TEXT,                              -- null quando a célula estava vazia
    status_novo     TEXT NOT NULL,
    observacoes     TEXT,                              -- motivo gravado na coluna "Observações"
    admin_email     TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_admin_status_log_projeto ON admin_status_log(projeto_id);
  CREATE INDEX IF NOT EXISTS idx_admin_status_log_criado ON admin_status_log(created_at);

  -- Log UNIFICADO de ações do painel admin (feed do drawer "Histórico"). Onde o
  -- admin_status_log responde "quem mexeu no STATUS deste projeto", esta tabela responde
  -- "o que aconteceu no painel", em UMA linha por gesto: mudança de status, estrelas,
  -- dono de área, pré-aprovação em modo admin, reabertura de fila. Toda escrita passa por
  -- registrarAtividade() (não-bloqueante), então uma auditoria fora do ar NUNCA desfaz a
  -- ação real. É DERIVADO/append-only: pode ser apagado sem perda de estado do app.
  -- 'acao' é o discriminador. 'detalhe' é a frase legível. 'meta_json' guarda o extra
  -- estruturado (status anterior/novo, nota, veredito) para o renderer, nunca em prompt.
  CREATE TABLE IF NOT EXISTS admin_activity_log (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    ator_email    TEXT NOT NULL,                     -- e-mail @gocase da borda (quem fez)
    acao          TEXT NOT NULL,                     -- 'status'|'estrelas'|'dono_area'|'lider_decisao'|'reabrir_fila'
    projeto_id    TEXT,                              -- null em ações sem projeto (ex. divisão de área)
    projeto_nome  TEXT,
    detalhe       TEXT,                              -- frase pronta para exibir ("Reprovado", "10 estrelas"...)
    meta_json     TEXT,                              -- JSON opcional com o extra estruturado
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_admin_activity_criado ON admin_activity_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_admin_activity_projeto ON admin_activity_log(projeto_id);

  -- Pré-aprovação do LÍDER (integração TeamGuide). O liderado submete e o líder direto
  -- (derivado de /teams + membros) recebe uma DM no Chat e aprova/reprova DENTRO do
  -- GoDocs (a aprovação é estado do projeto, não do Chat). Uma linha por (projeto,
  -- versão, aprovador): pessoa em 2+ times tem 2+ linhas e o PRIMEIRO que decidir
  -- resolve para todos (D4). NÃO bloqueia a triagem da RPA (D3).
  -- ⚠️ NUNCA use ponto-e-vírgula nos comentários deste arquivo. O initSchema divide o
  -- SQL por ponto-e-vírgula, então um deles dentro de comentário parte o CREATE ao meio.
  -- ⚠️ Tabela INTERNA: fora de SAFE_UPDATE_FIELDS, o sync reverso nunca a toca.
  -- Ver spec-docs/SPEC_APROVACAO_LIDER.md.
  CREATE TABLE IF NOT EXISTS projeto_aprovacoes (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    projeto_id       TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao           INTEGER NOT NULL DEFAULT 1,
    autor_email      TEXT,
    aprovador_email  TEXT NOT NULL,
    aprovador_nome   TEXT,
    veredito         TEXT NOT NULL DEFAULT 'pendente',  -- 'pendente'|'aprovado'|'reprovado'
    comentario       TEXT,
    decidido_por     TEXT,                              -- quem decidiu (pode ser outro líder — D4)
    criado_em        TEXT DEFAULT (datetime('now')),
    decidido_em      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_projeto_aprovacoes_aprovador
    ON projeto_aprovacoes(aprovador_email);
  CREATE INDEX IF NOT EXISTS idx_projeto_aprovacoes_projeto
    ON projeto_aprovacoes(projeto_id);

  -- ESPELHO da planilha dentro do SQLite — uma linha por "ID Projeto" da aba.
  -- Existe para as TELAS não lerem o Google Sheets em tempo de request: "Meus Projetos"
  -- fazia um readAllRows() INTEIRO por load de página (~2 s, e a cota de 60 leituras/min
  -- é compartilhada com prod) e a triagem do /dashboard escondia a mesma leitura atrás de
  -- um cache de 60 s. A planilha continua sendo a fonte da verdade e o ÚNICO lugar onde se
  -- edita — este espelho é reconstruído pelo sync reverso (cron) e remendado pelas nossas
  -- próprias escritas. É dele que as telas leem.
  --   linha        JSON do SheetRow COMPLETO (chaveado pelo NOME REAL da coluna) — é o que
  --                a ficha de triagem abre e o que o parser do parecer do líder lê
  --   linha_resumo JSON só com as colunas curtas da LISTAGEM (COLUNAS_RESUMO). A listagem
  --                NUNCA seleciona "linha": os memoriais de todos os projetos de uma vez
  --                são o mesmo risco de payload do gotcha de 32 MiB do Investigador
  --   linha_hash   impressão digital do que veio da planilha — linha igual não gera UPDATE,
  --                o que deixa o cron de 5 min quase sem escrita
  --   patch        colunas que NÓS gravamos na planilha (com escrito_em) — protege a
  --                escrita recém-feita de ser desfeita por um sync que começou ANTES dela
  --                e leu a célula antiga
  -- ⚠️ Tabela DERIVADA: pode ser apagada e o próximo sync a reconstrói inteira. Nada de
  -- estado do app mora aqui (isso é "projetos").
  CREATE TABLE IF NOT EXISTS sheet_espelho (
    projeto_id   TEXT PRIMARY KEY,                  -- id em minúsculas (match case-insensitive)
    linha        TEXT NOT NULL,
    linha_resumo TEXT NOT NULL,
    linha_hash   TEXT,
    patch        TEXT,
    escrito_em   TEXT,                              -- quando NÓS gravamos por último
    lido_em      TEXT DEFAULT (datetime('now'))     -- quando veio da planilha
  );

  -- Uma linha por execução do sync Sheets → SQLite. Serve para a tela dizer "espelho de
  -- HH:MM" e para saber, sem abrir log, se o sync parou de rodar — o risco real desta
  -- arquitetura é o sync morrer em silêncio e as telas seguirem mostrando dado velho como
  -- se fosse novo. Append-only, nada aqui alimenta regra de negócio.
  CREATE TABLE IF NOT EXISTS sync_runs (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    gatilho       TEXT NOT NULL,                    -- 'cron'|'manual'|'sob-demanda'
    ok            INTEGER NOT NULL DEFAULT 0,       -- 1 = leu a planilha e espelhou
    total         INTEGER DEFAULT 0,                -- linhas com ID na planilha
    espelhados    INTEGER DEFAULT 0,                -- linhas gravadas no espelho
    criados       INTEGER DEFAULT 0,
    atualizados   INTEGER DEFAULT 0,
    removidos     INTEGER DEFAULT 0,
    erros         INTEGER DEFAULT 0,
    duracao_ms    INTEGER,
    detalhe       TEXT,                             -- 1ª causa quando ok = 0
    iniciado_em   TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sync_runs_iniciado ON sync_runs(iniciado_em);
  -- FAQ. Todo mundo LÊ em /faq, admin edita inline. Cada categoria é UM documento
  -- (coluna corpo, markdown leve) -- a lista de cards existe só no índice /faq.
  -- O conteúdo inicial nasce do FAQ_SEED (src/lib/faq/conteudo.ts) por seed IDEMPOTENTE
  -- por slug -- deploy novo nunca sobrescreve o que o admin editou.
  -- ⚠️ Tabelas INTERNAS: nada de coluna no Sheets, fora de SAFE_UPDATE_FIELDS, o sync
  -- reverso jamais as toca. Conteúdo do app, não dado de projeto.
  -- ⚠️ O slug é IMUTÁVEL depois de criado (o link circula em Chat/e-mail/formulário) e
  -- remover é ARQUIVAR (arquivado=1) -- não existe DELETE nesta feature.
  -- ⚠️ NUNCA use ponto-e-vírgula nos comentários deste arquivo (o initSchema divide o SQL
  -- por ponto-e-vírgula e partiria o CREATE TABLE ao meio).
  -- Ver spec-docs/SPEC_FAQ.md.
  CREATE TABLE IF NOT EXISTS faq_categorias (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    slug           TEXT NOT NULL UNIQUE,
    titulo         TEXT NOT NULL,
    resumo         TEXT,
    corpo          TEXT,
    -- Snapshot da versão IMEDIATAMENTE anterior (JSON) para o botão "Voltar" do admin --
    -- 1 nível só, por decisão (D14). NULL = não há para onde voltar.
    versao_anterior TEXT,
    ordem          INTEGER NOT NULL DEFAULT 0,
    arquivado      INTEGER NOT NULL DEFAULT 0,
    criado_em      TEXT DEFAULT (datetime('now')),
    atualizado_em  TEXT DEFAULT (datetime('now')),
    atualizado_por TEXT
  );

  -- ⚠️ LEGADO (D13): o FAQ teve um nível de "tópico" por categoria, substituído pelo
  -- documento único em faq_categorias.corpo. Nada lê nem escreve esta tabela hoje -- ela
  -- fica de pé porque os textos da 1ª versão vivem aqui (remover é arquivar, jamais DROP).
  CREATE TABLE IF NOT EXISTS faq_itens (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    categoria_id   TEXT NOT NULL REFERENCES faq_categorias(id) ON DELETE CASCADE,
    slug           TEXT NOT NULL,
    titulo         TEXT NOT NULL,
    resumo         TEXT,
    corpo          TEXT,
    ordem          INTEGER NOT NULL DEFAULT 0,
    arquivado      INTEGER NOT NULL DEFAULT 0,
    criado_em      TEXT DEFAULT (datetime('now')),
    atualizado_em  TEXT DEFAULT (datetime('now')),
    atualizado_por TEXT
  );

  -- Slug único DENTRO da categoria (nunca global): /tipos_projetos/especiais e um futuro
  -- /glossario/especiais convivem.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_itens_slug ON faq_itens(categoria_id, slug);
  CREATE INDEX IF NOT EXISTS idx_faq_itens_categoria ON faq_itens(categoria_id);

  -- Âncoras da régua dos projetos ESPECIAIS (comparador em /especiais). Cada linha diz
  -- "este projeto REAL é o que define o nível N", com a frase da régua.
  -- ⚠️ Tabela INTERNA: nenhuma coluna no Sheets, fora de SAFE_UPDATE_FIELDS, o sync reverso
  -- jamais a toca. A NOTA continua morando na planilha (coluna manual "Estrelas") -- aqui só
  -- fica o papel de referência, que é decisão da triagem sobre a régua, não dado do projeto.
  -- ⚠️ Um nível pode ter MAIS DE UMA âncora (o topo da base é PIAPP e companhia), por isso a
  -- chave é o projeto e não a nota.
  -- ⚠️ NUNCA use ponto-e-vírgula nos comentários deste arquivo (ver o aviso do FAQ acima).
  CREATE TABLE IF NOT EXISTS especial_referencia (
    projeto_id   TEXT PRIMARY KEY,
    nota         INTEGER NOT NULL,
    motivo       TEXT,
    definido_por TEXT,
    definido_em  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_especial_referencia_nota ON especial_referencia(nota);

  -- Recomendação de estrelas por projeto (auditoria): o lote importado da força-tarefa e, na
  -- fase seguinte, a saída do agente classificador.
  -- ⚠️ Tabela INTERNA e ela NUNCA vira a nota: a coluna "Estrelas" da planilha só muda por
  -- clique de gente. Aqui fica a SUGESTÃO + a leitura que a justifica.
  -- ⚠️ A coluna modelo existe porque o llm.ts troca de modelo sozinho no fallback -- sem gravar qual
  -- produziu a nota, "de quem é esta recomendação" vira pergunta sem resposta.
  -- ⚠️ NUNCA use ponto-e-vírgula nos comentários deste arquivo (ver o aviso do FAQ acima).
  -- Divisão da validação: qual admin cuida de cada ÁREA (a força-tarefa do JV, mas definida
  -- à mão em vez de derivada por algoritmo -- quem valida o quê é decisão de quem coordena).
  -- ⚠️ Tabela INTERNA: sem coluna no Sheets, fora de SAFE_UPDATE_FIELDS, o sync não a toca.
  -- ⚠️ A chave é a ÁREA, não o projeto: contexto não se parte, e projeto novo da área já
  -- nasce com dono sem ninguém ter de redistribuir nada.
  CREATE TABLE IF NOT EXISTS especial_area_dono (
    area         TEXT PRIMARY KEY,
    dono_email   TEXT NOT NULL,
    dono_nome    TEXT,
    definido_por TEXT,
    definido_em  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS especial_avaliacao (
    projeto_id            TEXT PRIMARY KEY,
    estrelas_recomendada  REAL NOT NULL,
    confianca             TEXT,
    leitura               TEXT,
    contestada            INTEGER NOT NULL DEFAULT 0,
    origem                TEXT,
    modelo                TEXT,
    criado_em             TEXT DEFAULT (datetime('now'))
  );

  -- Memória VETORIAL do agente classificador de especiais: o embedding de cada projeto especial,
  -- para recuperar os vizinhos semânticos ao classificar um novo (RAG).
  -- ⚠️ Tabela INTERNA e DERIVADA: fora do Sheets e de SAFE_UPDATE_FIELDS, o sync não a toca.
  -- Pode ser apagada -- o backfill/cron a reconstrói chamando a OpenAI de novo.
  -- ⚠️ O vetor vive como base64 de Float32Array (o Worker não tem Buffer) -- ver embeddings.ts.
  -- ⚠️ texto_hash existe para NÃO re-embeddar (custa dinheiro) quando o texto do projeto não mudou.
  -- ⚠️ NUNCA use ponto e vírgula nos comentários deste arquivo (o initSchema quebra o SQL nele).
  CREATE TABLE IF NOT EXISTS especial_embedding (
    projeto_id  TEXT PRIMARY KEY,
    modelo      TEXT NOT NULL,
    dim         INTEGER NOT NULL,
    vetor       TEXT NOT NULL,
    texto_hash  TEXT,
    criado_em   TEXT DEFAULT (datetime('now'))
  );

  -- Memória VETORIAL dos projetos NORMAIS (time autônomo de avaliação, fatia B). Espelha
  -- especial_embedding mas é uma tabela SEPARADA de propósito: normais têm memorial financeiro,
  -- especiais são qualitativos, e os corpora não se misturam (não atropelar a peça do Kaique).
  -- ⚠️ Tabela INTERNA e DERIVADA: fora do Sheets e de SAFE_UPDATE_FIELDS, o sync não a toca.
  -- Pode ser apagada -- o cron de backfill a reconstrói chamando a OpenAI de novo.
  -- ⚠️ O vetor vive como base64 de Float32Array (o Worker não tem Buffer) -- ver embeddings.ts.
  -- ⚠️ texto_hash existe para NÃO re-embeddar (custa dinheiro) quando o texto do projeto não mudou.
  -- ⚠️ NUNCA use ponto e vírgula nos comentários deste arquivo (o initSchema quebra o SQL nele).
  CREATE TABLE IF NOT EXISTS projeto_embedding (
    projeto_id  TEXT PRIMARY KEY,
    modelo      TEXT NOT NULL,
    dim         INTEGER NOT NULL,
    vetor       TEXT NOT NULL,
    texto_hash  TEXT,
    criado_em   TEXT DEFAULT (datetime('now'))
  );

  -- Recomendação do AGREGADOR/juiz do time autônomo de avaliação (fatia B, MODO SOMBRA):
  -- o veredito conciliado (Plausibilidade/FTE + Financeiro + sinal do RAG) + confiança + os
  -- votos individuais (auditoria). ⚠️ SOMBRA -- esta tabela GRAVA a recomendação mas NADA nela
  -- muda o status do projeto (a decisão segue sendo a de decidirStatusSubmissao) até o Luis
  -- validar. ⚠️ Tabela INTERNA: a decisão vive no projeto/planilha, a sugestão vive aqui.
  -- ⚠️ NUNCA use ponto e vírgula nos comentários deste arquivo (o initSchema quebra o SQL nele).
  CREATE TABLE IF NOT EXISTS projeto_avaliacao (
    projeto_id  TEXT PRIMARY KEY,
    veredito    TEXT NOT NULL,
    confianca   REAL NOT NULL,
    aplicar     INTEGER NOT NULL DEFAULT 0,
    divergencia INTEGER NOT NULL DEFAULT 0,
    motivo      TEXT,
    votos       TEXT,
    origem      TEXT,
    modelo      TEXT,
    criado_em   TEXT DEFAULT (datetime('now'))
  );

  -- Estado da DELIBERAÇÃO multi-turno do time autônomo de avaliação (fatia C, MODO SOMBRA):
  -- quando os especialistas divergem, a confiança agregada é baixa OU o cético refuta, a mesa
  -- abre +1 rodada. Máquina de estados PERSISTIDA (deliberando → consenso | nao_consenso |
  -- isento), avançada pelo CRON idempotente e bounded (uma rodada não cabe indefinidamente num
  -- request de 60s). ⚠️ SOMBRA -- grava a recomendação e o estado, NADA aqui muda o status do
  -- projeto. ⚠️ Tabela INTERNA e DERIVADA (fora do Sheets e de SAFE_UPDATE_FIELDS).
  -- ⚠️ historico é JSON PEQUENO (resumo de cada rodada), nunca blob de snapshot (teto 32 MiB RPC).
  -- ⚠️ NUNCA use ponto e vírgula nos comentários deste arquivo (o initSchema quebra o SQL nele).
  CREATE TABLE IF NOT EXISTS deliberacao_avaliacao (
    projeto_id    TEXT PRIMARY KEY,
    estado        TEXT NOT NULL,
    rodada        INTEGER NOT NULL DEFAULT 0,
    veredito      TEXT,
    confianca     REAL,
    grau          TEXT,
    encerrada     INTEGER NOT NULL DEFAULT 0,
    motivo        TEXT,
    historico     TEXT,
    origem        TEXT,
    atualizado_em TEXT DEFAULT (datetime('now'))
  );

  -- RETROATIVO (fatia C, MODO SOMBRA): roda a MESA nos projetos com veredito HUMANO assentado
  -- (aprovado/reprovado no espelho) e compara a recomendação da mesa com o que o humano decidiu,
  -- medindo acerto/erro (acerto | conservador | erro_grave | sem_base) — mede a qualidade da mesa
  -- SEM tocar em status nenhum. ⚠️ Tabela INTERNA e DERIVADA (fora do Sheets e de
  -- SAFE_UPDATE_FIELDS). Pode ser apagada -- o cron retroativo a reconstrói.
  -- ⚠️ NUNCA use ponto e vírgula nos comentários deste arquivo (o initSchema quebra o SQL nele).
  CREATE TABLE IF NOT EXISTS avaliacao_retroativa (
    projeto_id       TEXT PRIMARY KEY,
    veredito_agregado TEXT,
    veredito_humano  TEXT,
    resultado        TEXT NOT NULL,
    confianca        REAL,
    grau             TEXT,
    motivo           TEXT,
    origem           TEXT,
    criado_em        TEXT DEFAULT (datetime('now'))
  );

  -- FEEDBACK do admin sobre a recomendação em SOMBRA (teste sombra do time de avaliação): o
  -- admin marca 👍/👎 na ficha do projeto dizendo se concorda com o veredito do agente. É
  -- SINAL DE TREINAMENTO -- nada aqui muda o status do projeto (que segue humano). Tabela
  -- INTERNA e DERIVADA (fora do Sheets e de SAFE_UPDATE_FIELDS). Um voto por projeto (o voto
  -- mais recente vale) -- guardamos o veredito a que o voto se refere para dar contexto depois.
  -- ⚠️ NUNCA use ponto e vírgula nos comentários deste arquivo (o initSchema quebra o SQL nele).
  CREATE TABLE IF NOT EXISTS avaliacao_feedback (
    projeto_id         TEXT PRIMARY KEY,
    voto               TEXT NOT NULL,
    veredito_referente TEXT,
    admin_email        TEXT,
    criado_em          TEXT DEFAULT (datetime('now'))
  );

  -- ⚠️ NUNCA use ponto e vírgula nos comentários deste arquivo (o initSchema quebra o SQL nele).
  -- Rollup histórico de saving/receita por (grão, período, área, tipo_saving) — fonte durável
  -- da API histórica consumida pelo squad Intelli (João Gabriel). Tabela DERIVADA e INTERNA
  -- (fora de SAFE_UPDATE_FIELDS, o sync reverso não a toca) reconstruída pelo backfill a
  -- partir dos projetos aprovados. saving_reais e receita_reais são CRUS e SEPARADOS.
  CREATE TABLE IF NOT EXISTS rollup_saving_receita (
    grao          TEXT NOT NULL,
    periodo       TEXT NOT NULL,
    area          TEXT NOT NULL,
    tipo_saving   TEXT NOT NULL,
    saving_reais  REAL NOT NULL DEFAULT 0,
    receita_reais REAL NOT NULL DEFAULT 0,
    num_projetos  INTEGER NOT NULL DEFAULT 0,
    atualizado_em TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (grao, periodo, area, tipo_saving)
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
'ALTER TABLE projetos ADD COLUMN arquivos_links TEXT',
  // Custo evitado: a solução fez a empresa DEIXAR de pagar ferramentas/serviços
  // externos? `custo_evitado` = 'sim'|'nao'; `custo_evitado_justificativa` = texto
  // concatenado legível; `custo_evitado_itens` = JSON [{nome,valor,recorrencia,justificativa}].
  // O valor (pontual e mensal pelo valor cheio, sem ÷12) entra no saving_reais/ganho_total.
  // Coletado no formulário de saving (≠ custo_externo_mensal, que é o custo INCORRIDO).
  'ALTER TABLE projetos ADD COLUMN custo_evitado TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_evitado_justificativa TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_evitado_itens TEXT',
  // Custos do projeto: serviços externos PAGOS que a solução INTERNA consome pra
  // rodar (chave de API, ElevenLabs…). `custo_projeto` = 'sim'|'nao'; justificativa =
  // texto legível; itens = JSON [{nome,valor,recorrencia,justificativa}]. O valor
  // (pontual e mensal pelo valor cheio, sem ÷12) SUBTRAI do saving_reais/ganho_total.
  // Distinto de custo_externo_mensal (escopo externo) e de custo_evitado (que SOMA).
  'ALTER TABLE projetos ADD COLUMN custo_projeto TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_projeto_justificativa TEXT',
  'ALTER TABLE projetos ADD COLUMN custo_projeto_itens TEXT',
  // Snapshot imutável da conversa (chat_messages) no momento de cada submissão/reenvio.
  // Os chat_messages são mutados/apagados in-place quando a pessoa volta etapas; este
  // snapshot preserva a conversa ORIGINAL de cada versão para o Investigador (abas
  // Submetidos × Edições). Forward-only: versões antigas (anteriores a esta coluna)
  // ficam com snapshot_chat NULL e caem no fallback do chat atual.
  'ALTER TABLE projeto_versions ADD COLUMN snapshot_chat TEXT',
  // Procedência do snapshot: 'real' = gravado no caminho de submissão/reenvio;
  // 'reconciliado' = reconstruído do estado atual pelo cron reconciliarSnapshots
  // (fecha furos de submissões cujo snapshot falhou e de legados sem versão).
  // NULL = linha anterior a esta coluna, tratada como 'real' pelos leitores.
  'ALTER TABLE projeto_versions ADD COLUMN origem TEXT',
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
  // Papel de cada PARTICIPANTE no projeto (JSON, mapa e-mail→papel). 3 papéis atuais:
  // 'coexecutor'("Coautor") | 'planejador'("Participante") | 'contribuidor'("Contribuidor").
  // `membros` continua sendo a lista PLANA de todos os participantes (base do ownership);
  // este mapa só guarda o papel de cada um. Colunas do Sheets: `coexecutor`→"Participantes",
  // `planejador`→"Participantes 2", `contribuidor`→"Contribuidor". Os `value` internos
  // coexecutor/planejador foram mantidos ao renomear rótulos/colunas; os papéis legados
  // 'idealizador'/'referencia_tecnica' (feature anterior) caem em "Contribuidor" no sync.
  // NÃO se aplica ao autor (responsavel_email). Vazio/null = legado sem papéis (coexecutor).
  'ALTER TABLE projetos ADD COLUMN membros_papeis TEXT',
  // O que CADA participante fez neste projeto (JSON, mapa e-mail→texto curto, 20–100
  // chars). Irmã de `membros_papeis`: o papel diz o "de que tamanho" e este campo diz o
  // "o quê". Coluna INTERNA — NÃO existe no Sheets (decisão de produto: é dado de gestão,
  // não de planilha), logo fica fora de `SAFE_UPDATE_FIELDS` e o sync reverso nunca a
  // toca (sobrevive aos syncs, como `editores_delegados`). NÃO se aplica ao autor
  // (responsavel_email), e nunca entra em prompt nenhum. A trava dos 20–100 chars é do
  // FORMULÁRIO (`validarEtapa1`); o zod do backend só limita o teto, para uma aba com JS
  // em cache (version skew) não levar 400 na submissão.
  'ALTER TABLE projetos ADD COLUMN membros_contribuicoes TEXT',
  // Governança de IA: o projeto usa o AI Proxy interno (ai-proxy.gogroupbr.com)?
  // 'sim'|'nao', resposta determinística do formulário (etapa 2). O agente de
  // documentação faz auto-detecção do uso na doc enviada e o analisador cruza
  // declaração × detecção. Vai para a coluna "Usa AI Proxy" do Sheets.
  'ALTER TABLE projetos ADD COLUMN usa_ai_proxy TEXT',
  // Split do saving em carga real × ganho por escala (só quando alguém fazia à mão).
  // horas_carga_real = trabalho humano de fato; horas_escala = volume incremental que
  // só a automação cobre. Somam o total (saving_horas), que continua sendo o que vira R$.
  // Transparência/auditoria → colunas "Saving Horas Real"/"Saving Horas Escalado" no Sheets.
  'ALTER TABLE projetos ADD COLUMN horas_carga_real REAL',
  'ALTER TABLE projetos ADD COLUMN horas_escala REAL',
  // Projeto DESCONTINUADO (marcado pelo dono/editor em "Meus Projetos"): a automação
  // não roda mais. Deixa de contar como pendência (regularização de legado / reenvio)
  // e o badge vira "Descontinuado". 1 = descontinuado; 0 = ativo. É a FONTE DA VERDADE
  // no app (o "Status" do Sheets não volta pelo sync reverso — regra TEMPORÁRIA grava
  // sempre "Pendente"); a IDA reflete "Descontinuado" na coluna Status da planilha.
  'ALTER TABLE projetos ADD COLUMN descontinuado INTEGER DEFAULT 0',
  // Disparo de e-mail de legados em LOTES (chunks). `alvos` = JSON dos e-mails alvo
  // (congelado na criação do lote, p/ o cursor ser estável entre chunks); `processados`
  // = cursor (quantos já foram tratados = enviados + falhas + pulados). O envio deixou
  // de ser um loop único em background (que o runtime matava por tempo) e passou a ser
  // dirigido pelo front, um chunk por requisição.
  'ALTER TABLE email_lotes ADD COLUMN alvos TEXT',
  'ALTER TABLE email_lotes ADD COLUMN processados INTEGER NOT NULL DEFAULT 0',
  // Disparo de e-mails por SEGMENTO/público (a tela deixou de ser só "cobrança de
  // legados"): `audiencia` ∈ 'legado' | 'reenvio' | 'todos'. Tanto o lote quanto cada
  // disparo guardam o segmento (o selo "enviado em…" é escopado por segmento). `payload`
  // congela a lista completa de destinatários (e-mail+nome+projetos) + o template no
  // momento da criação do lote — o chunk lê desse snapshot, sem reler o Sheets/SQLite a
  // cada requisição (mais robusto e sem race com o status mudando no meio do envio).
  "ALTER TABLE email_lotes ADD COLUMN audiencia TEXT NOT NULL DEFAULT 'legado'",
  'ALTER TABLE email_lotes ADD COLUMN payload TEXT',
  "ALTER TABLE email_disparos ADD COLUMN audiencia TEXT NOT NULL DEFAULT 'legado'",
  // ─── Critério de projeto (régua de recorrência · contrafactual · rastreabilidade) ──
  // O CONTRAFACTUAL é pergunta determinística da Etapa 2 (padrão `usa_ai_proxy`) e NÃO
  // barra a submissão — alimenta a classificação do analisador:
  // `contrafactual_afetados`: quem sentiria falta, serializado como
  // "pessoa:a@x.com;b@y.com" ou "time:Fiscal;CX" (escolhido na Team Guide — pessoas OU
  // times inteiros).
  // ⚠️ `ponteiro_movido`/`ponteiro_evidencia`/`contrafactual_reclamacao` são LEGADO: a
  // RASTREABILIDADE (que ponteiro moveu + onde verificar) e o "o que piora se desligar
  // hoje" saíram do formulário — a primeira passou a ser conduzida pelo AGENTE na seção
  // "Ponteiro movido e onde verificar" do memorial; o "o que piora" foi REMOVIDO em
  // 03/08/2026 (nunca teve coluna no Sheets; o analisador extrai o efeito da doc). As
  // colunas ficam pelos projetos submetidos enquanto as perguntas existiam no form; nada
  // as escreve nem as lê mais. O ALTER permanece só para o schema de bancos novos bater
  // com o de produção — não reintroduza as perguntas.
  'ALTER TABLE projetos ADD COLUMN ponteiro_movido TEXT',
  'ALTER TABLE projetos ADD COLUMN ponteiro_evidencia TEXT',
  'ALTER TABLE projetos ADD COLUMN contrafactual_reclamacao TEXT',
  'ALTER TABLE projetos ADD COLUMN contrafactual_afetados TEXT',
  // Classificação de ELEGIBILIDADE decidida pelo analisador ("isto é projeto?"),
  // independente do veredito de pontuação: 'claro_sim'|'claro_nao'|'zona_cinzenta'.
  // A justificativa é SEMPRE preenchida (fallback determinístico) → coluna
  // "Classificação" do Sheets. `motivo_reprovacao` só existe em 'claro_nao' (nunca
  // reprova sem motivo) → coluna "Motivo Reprovado". O discriminador da reprovação é
  // ESTA coluna, não o CHECK de projetos.status (que segue rascunho|em_validacao|
  // validado|rejeitado|aprovado — trocá-lo exigiria rebuild da tabela).
  'ALTER TABLE projetos ADD COLUMN classificacao_avaliacao TEXT',
  'ALTER TABLE projetos ADD COLUMN classificacao_justificativa TEXT',
  'ALTER TABLE projetos ADD COLUMN motivo_reprovacao TEXT',
  // Checklist do gestor na pré-aprovação (3 perguntas de sim/não pedidas pelo Lucas em
  // 03/08/2026). São OBRIGATÓRIAS para registrar o parecer e ficam junto da decisão:
  // move_kpi = o projeto move um KPI da área  ·  sente_falta = a área sentiria falta se
  // o projeto fosse desligado  ·  saving_coerente = o saving declarado é coerente com o
  // impacto que a área percebe. Valores 'sim'|'nao' (null = parecer antigo, antes do
  // checklist). Um "nao" NÃO reprova sozinho — é sinal para a triagem da RPA ler.
  "ALTER TABLE projeto_aprovacoes ADD COLUMN resp_move_kpi TEXT",
  "ALTER TABLE projeto_aprovacoes ADD COLUMN resp_sente_falta TEXT",
  "ALTER TABLE projeto_aprovacoes ADD COLUMN resp_saving_coerente TEXT",
  // FAQ: a categoria virou UM documento (markdown leve) em vez de uma lista de tópicos
  // (SPEC_FAQ D13). Bancos que já tinham as categorias recebem a coluna aqui, e o seed
  // faz o BACKFILL do texto só quando o corpo está vazio — corpo escrito pelo admin
  // nunca é sobrescrito.
  'ALTER TABLE faq_categorias ADD COLUMN corpo TEXT',
  // Botão "Voltar à versão anterior" do FAQ (D14): snapshot JSON de UM nível
  // (titulo/resumo/corpo + quando/quem). Restaurar consome o slot — não é histórico.
  'ALTER TABLE faq_categorias ADD COLUMN versao_anterior TEXT',
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
