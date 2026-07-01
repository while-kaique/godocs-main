# Banco de Dados

SQLite acessado via interface única `GoDeployDB` (`integrations/db/db-adapter.ts`).

## Interface GoDeployDB

```typescript
interface GoDeployDB {
  query(sql: string, params?: unknown[]): QueryResult | Promise<QueryResult>
  exec(sql: string, params?: unknown[]): ExecResult | Promise<ExecResult>
}
```

- **Produção**: `env.DB` do Godeploy — async, retorna `Promise`. Rows como objetos.
- **Dev**: wrapper `better-sqlite3` — síncrono (await é no-op). Rows como arrays posicionais.
- `rowsToObjects()` em `client.server.ts` normaliza ambos os formatos.

## Padrões de acesso (`client.server.ts`)

### Singleton
```typescript
let _db: GoDeployDB | undefined
let _schemaReady: boolean  // flag, NÃO Promise (Cloudflare não cacheia Promises entre requests)

setDb(db)   // chamado no início de cada request pelo worker.ts
getDb()     // retorna _db ou throw
```

### Helpers
| Função | Retorno | Uso |
|---|---|---|
| `queryAll<T>(sql, params?)` | `T[]` | SELECT múltiplos |
| `queryOne<T>(sql, params?)` | `T \| undefined` | SELECT único |
| `exec(sql, params?)` | `void` | INSERT/UPDATE/DELETE |

**Regra crítica**: sempre `await` e sempre passar params (mesmo `[]`). O `env.DB` do Godeploy **exige** o argumento de params.

### IDs
Hex de 32 caracteres gerados por `crypto.getRandomValues()` na aplicação. Default no SQLite: `lower(hex(randomblob(16)))`. **Não são UUID**.

### Convenções de armazenamento
- **JSON**: colunas TEXT (`membros`, `tipos_projeto`, `options`, `conteudo`, `criterios`, `valor`), parseadas via `parseJson()`
- **Booleanos**: INTEGER 0/1
- **Timestamps**: strings ISO 8601

## Tabelas

### `admins`
Controle de acesso admin. Email único. Seed com 6 admins hardcoded via `INSERT OR IGNORE`.

| Coluna | Tipo | Nota |
|---|---|---|
| id | TEXT PK | hex 32 |
| email | TEXT UNIQUE | |
| nome | TEXT | |
| created_at | TEXT | ISO 8601 |

### `areas`
Departamentos da empresa. Populada via sync TeamGuide ou manualmente.

| Coluna | Tipo |
|---|---|
| id | TEXT PK |
| nome | TEXT NOT NULL |
| created_at | TEXT |

### `projetos`
Entidade principal. Uma linha por projeto submetido.

| Coluna | Tipo | Nota |
|---|---|---|
| id | TEXT PK | |
| nome | TEXT | Nome do projeto |
| responsavel_nome, responsavel_email | TEXT | Quem submeteu |
| area, area_id | TEXT | Nome da área + FK opcional |
| ferramenta | TEXT | n8n, Python, Claude, etc. |
| escopo | TEXT | interno/externo |
| servico_externo | TEXT | Se escopo = externo |
| membros | TEXT (JSON) | Array de emails |
| status | TEXT | CHECK: rascunho, em_validacao, validado, rejeitado, aprovado |
| chat_completo | INTEGER | 0/1 |
| data_criacao_projeto | TEXT | |
| tipo_projeto | TEXT | Legado: valor único. `'especial'` quando projeto especial |
| tipos_projeto | TEXT (JSON) | Array: ['saving', 'receita_incremental'] ou ['especial'] |
| descricao_breve | TEXT | Contexto de negócio (o que a automação faz/resolve) |
| especial | INTEGER | 0/1 — projeto especial (altíssimo impacto, validação humana) |
| contexto_especial | TEXT | Descrição do contexto do projeto especial (etapa 2.5) |
| saving_horas, saving_reais | REAL | Totais calculados |
| tipo_saving | TEXT | mensal/pontual |
| memorial_calculo | TEXT | Texto sem markdown |
| custo_externo_mensal | REAL | Custo INCORRIDO pela automação (ferramenta usada — subtrai) |
| custo_evitado | TEXT | sim/não — a solução evitou custo de ferramenta/serviço externo? (form de saving) |
| custo_evitado_justificativa | TEXT | Texto concatenado das ferramentas evitadas |
| custo_evitado_itens | TEXT | JSON `[{nome,valor,recorrencia,justificativa}]`; pontual e mensal pelo valor cheio (sem ÷12), soma em saving_reais |
| ganho_total_mensal | REAL | saving + receita ponderados |
| alguem_fazia | TEXT | sim/não — tinha processo manual antes? |
| complexidade | TEXT | automacao/inteligencia/autonomia |
| observacoes | TEXT | Parecer da análise (staff-only) |
| submitted_at, validated_at | TEXT | |
| validated_by | TEXT | Email do admin |
| created_at, updated_at | TEXT | |

### `chat_messages`
Histórico do chat. Role `doc` = texto extraído dos arquivos (não aparece no histórico do usuário).

| Coluna | Tipo | Nota |
|---|---|---|
| id | TEXT PK | |
| projeto_id | TEXT FK CASCADE | |
| role | TEXT | user / assistant / doc |
| content | TEXT | JSON para assistant (OrchestratorResult) |
| options | TEXT (JSON) | Opções múltipla escolha |
| selected_option | TEXT | |
| created_at | TEXT | |

### `documentacao`
Documentação compilada. Uma por projeto (UNIQUE).

| Coluna | Tipo | Nota |
|---|---|---|
| id | TEXT PK | |
| projeto_id | TEXT UNIQUE FK CASCADE | |
| conteudo | TEXT (JSON) | DocumentacaoGerada + saving/receita |
| versao | INTEGER | |
| created_at, updated_at | TEXT | |

### `analises`
Resultado da análise automática pós-submissão.

| Coluna | Tipo | Nota |
|---|---|---|
| id | TEXT PK | |
| projeto_id | TEXT FK CASCADE | |
| resultado | TEXT | aprovado/rejeitado |
| pontuacao_total, pontuacao_maxima | INTEGER | |
| justificativa | TEXT | Markdown completo |
| resumo | TEXT | 2-4 frases para usuário |
| criterios_hardcoded, criterios_dinamicos | TEXT (JSON) | Top 4 de cada |
| created_at | TEXT | |

### `validacoes`
Validação manual por admin.

| Coluna | Tipo |
|---|---|
| id | TEXT PK |
| projeto_id | TEXT FK CASCADE |
| resultado | TEXT |
| parecer | TEXT |
| criterios | TEXT (JSON) |
| admin_email | TEXT |
| email_enviado | INTEGER (0/1) |
| created_at | TEXT |

### `configuracoes`
Config dinâmica (chave-valor).

| Coluna | Tipo |
|---|---|
| id | TEXT PK |
| chave | TEXT UNIQUE |
| valor | TEXT (JSON) |
| descricao | TEXT |
| updated_at | TEXT |
| updated_by | TEXT |

### Tabelas auxiliares

- **`profiles`**: id, nome, email (UNIQUE) — usuários cadastrados
- **`user_roles`**: user_id FK CASCADE, role (`admin_master` | `leader`) — PK composto
- **`leader_areas`**: user_id FK CASCADE, area_id FK CASCADE — N:N líder↔área
- **`api_logs`**: id, projeto_id FK CASCADE, endpoint, method, duration_ms, status_code, error, request_size, response_size, request_body, response_body, created_at — métricas para o Investigador; limpeza >30 dias no cron
- **`projeto_versions`**: id, projeto_id FK CASCADE, versao_num, acao (`submit_inicial` | `reenvio`), snapshot_projeto (JSON), snapshot_doc (JSON), **snapshot_chat** (JSON — conversa congelada da versão; NULL em versões antigas), submetido_por, created_at — UNIQUE(projeto_id, versao_num). Snapshot imutável a cada submissão/reenvio (sistema de versionamento). Alimenta a aba "Edições" e a visão da submissão original no Investigador (os `chat_messages` são apagados ao voltar etapas; o snapshot preserva o original).
- **`form_events`**: id, projeto_id FK CASCADE, tipo (`submissao`|`saving`|`receita`|`tipos`|`metadados`|`back`|`submit`), fase (`doc`|`saving`|`receita`|`completo`), dados (JSON — pares label→valor), created_at — **APPEND-ONLY**: ao contrário de `chat_messages`, NUNCA é apagado pelas limpezas de chat. É a fonte do timeline determinístico do Investigador (os valores marcados no formulário — saving mensal, horas, receita… — chegam por payloads e não viram `chat_messages`, então sem isto não apareceriam). O flag `voltou` em `dados` marca reentradas (a pessoa voltou e reeditou a etapa).

## Status do projeto

```
rascunho → em_validacao → validado | rejeitado
                        → aprovado (auto, quando área = RPA)
```

Projeto **especial** nunca auto-aprova (nem na área RPA): fica sempre `em_validacao`
(→ "Pendente" na planilha) e não passa pelo analisador IA — a validação é humana.

## Migrações

Aplicadas em `schema.ts` com `try/catch` (colunas podem já existir):
- ADD `resumo` TEXT em `analises`
- ADD `ganho_total_mensal` REAL em `projetos`
- ADD `complexidade` TEXT em `projetos`
- RENAME `tinha_pessoa_antes` → `alguem_fazia` em `projetos`
- ADD `observacoes` TEXT em `projetos`
- ADD `especial` INTEGER DEFAULT 0 em `projetos`
- ADD `contexto_especial` TEXT em `projetos`
- ADD `arquivos_nomes` TEXT em `projetos` (JSON — nomes dos arquivos)
- ADD `arquivos_links` TEXT em `projetos` (JSON — links dos arquivos no Drive; vão p/ coluna "URL" da planilha)
- ADD `request_body`/`response_body` TEXT em `api_logs` (corpos p/ debug no Investigador)
- ADD `custo_evitado`/`custo_evitado_justificativa`/`custo_evitado_itens` TEXT em `projetos`
- ADD `snapshot_chat` TEXT em `projeto_versions` (conversa congelada por versão — forward-only)
- Tabela nova `form_events` (criada no schema base, não migração) — timeline determinístico do Investigador

## Sync reverso (Sheets → SQLite)

A planilha (aba `GoDocs`) é a fonte de verdade. `syncSheetsToSqlite()` (`src/lib/google/sync-reverse.ts`), rodado de hora em hora pelo cron, reconcilia o SQLite:

- **Legados** (existem só na planilha) → `insertProjetoRaw(fields)` cria a linha em `projetos` (id = `ID Projeto` em minúsculo). Isso os torna visíveis em "Meus Projetos" e editáveis pelos donos (match por `responsavel_email`/`membros`, vindos das colunas F/H).
- **Existentes** → `updateProjeto` apenas dos **campos seguros** (diff-aware). `status`, `responsavel_*` e `membros` **não** são sobrescritos; célula vazia nunca apaga dado.
- Helpers novos em `client.server.ts`: `getAllProjetoIds()` e `insertProjetoRaw(fields)` (INSERT genérico por mapa coluna→valor, exige `id`, `INSERT OR IGNORE`).
- Legados importados **não têm `documentacao`** — a edição funciona (forms financeiros começam vazios), pois `getMeuProjeto` lida com doc ausente.
