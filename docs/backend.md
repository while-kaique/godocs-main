# Backend

O backend é um Cloudflare Worker (`src/worker.ts`) que roteia todas as requisições `/api/*`. As funções de negócio ficam em arquivos `*.functions.ts` dentro de `src/lib/`.

## Arquitetura

```
worker.ts (entry point)
  ├─ Polyfill process.env (Godeploy não expõe process global)
  ├─ setDb(env.DB) + initSchema() (uma vez por isolate)
  ├─ Roteamento por pathname
  ├─ Logging automático de /api/chat/* em api_logs (fire-and-forget)
  └─ Respostas JSON + tratamento de erros com status HTTP

Em dev: vite-plugin-dev-api.ts intercepta /api/* e redireciona
para worker.ts via ssrLoadModule, usando better-sqlite3 como DB.
```

## Endpoints

### Auth
| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/auth/me` | Nenhuma | Retorna `{ email, isAdmin }` do header Godeploy |

### Chat (todas POST, logadas em `api_logs`)
| Rota | Função | Descrição |
|---|---|---|
| `/api/chat/iniciar-submissao` | `iniciarSubmissao` | Cria projeto, extrai texto dos docs, **faz upload dos arquivos ao Drive** (link → `arquivos_links`/coluna URL), roda extractor + orquestrador |
| `/api/chat/enviar-mensagem` | `enviarMensagem` | Avança o chat; compila doc na transição doc→impacto |
| `/api/chat/iniciar-saving` | `iniciarSaving` | Inicia fase saving com linhas pré-preenchidas; calcula economia |
| `/api/chat/iniciar-receita` | `iniciarReceita` | Inicia fase receita com valor/racional opcionais |
| `/api/chat/atualizar-tipos` | `atualizarTipos` | Persiste troca de tipo (saving/receita) durante o fluxo |
| `/api/chat/atualizar-metadados` | `atualizarMetadados` | Persiste edições; se arquivos mudaram, reinicia doc |
| `/api/chat/analisar` | `analisarProjetoFn` | Dispara análise IA pós-submissão (background) |
| `/api/chat/submeter-validacao` | `submeterParaValidacao` | Submete: duplicata, impacto, auto-aprovação, n8n, Google Chat |

### Áreas
| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/areas` | Nenhuma | Lista áreas (formulador) |
| POST | `/api/admin/areas/sync` | Admin | Sincroniza áreas do TeamGuide |
| POST | `/api/cron/sync-areas` | Header `X-Godeploy-Cron` | Cron diário + limpeza api_logs >30d |
| POST | `/api/cron/sync-sheets-to-sqlite` | Header `X-Godeploy-Cron` | Cron **horário**: sync reverso Sheets → SQLite (cria legados faltantes + reflete edições manuais em campos seguros) |

### Admin (todas requerem `requireAdmin`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/projetos` | Lista projetos com área |
| GET | `/api/admin/projetos/:id` | Detalhes completos (chat + doc + validações) |
| GET/POST | `/api/admin/usuarios` | CRUD de usuários |
| POST | `/api/admin/users` | Cria usuário (profile + roles + leader_areas) |
| POST | `/api/admin/users/delete` | Remove usuário (impede auto-deleção) |
| POST | `/api/admin/users/update-areas` | Atualiza áreas de um leader |
| GET/POST | `/api/admin/admins` | Lista/adiciona admins |
| POST | `/api/admin/admins/remove` | Remove admin (impede auto-deleção) |
| GET/POST | `/api/admin/areas` | Lista/cria áreas |
| POST | `/api/admin/areas/remove` | Remove área |
| GET/POST | `/api/admin/configuracoes` | Config dinâmica (chave-valor) |
| GET | `/api/admin/validar-projeto` | Validação de projeto |
| GET | `/api/admin/investigador/projetos` | Lista enriquecida (fase, métricas, último log, `total_edicoes`) |
| GET | `/api/admin/investigador/projetos/:id` | Detalhes + chat + logs + análise + `versions` (snapshots) + `form_events` |
| GET | `/api/admin/investigador/stats` | Métricas globais de API |
| GET | `/api/admin/investigador/edicoes` | Lista de reenvios (1 linha por edição) com métricas da janela daquela edição |
| GET | `/api/admin/investigador/log/:id` | Corpo (request/response) de um log de API específico |
| GET | `/api/admin/resync-google` | Re-dispara sync de IDA (Sheets+Chat) de um projeto, sem reanálise (`?projeto_id=`) |
| POST | `/api/admin/sync-sheets-now` | Dispara o sync reverso Sheets → SQLite sob demanda (mesmo trabalho do cron) |

## Investigador (`src/lib/investigador.functions.ts`)

Painel admin com **3 abas**: **Submetidos** (`submitted_at != null` — abre a submissão original), **Edições** (1 linha por reenvio, via `getEdicoesInvestigador`, com chat/API/métricas daquela edição) e **Abandonados** (rascunho nunca submetido e inativo há > 1h — diagnóstico de travamentos). Não há mais "tempo de submissão"/"tempo médio" (inflavam porque o form fica aberto): `computeTimeSinceStart`/`tempo_desde_inicio_min` foram removidos.

**Timeline determinístico (`form_events`)** — os valores que a pessoa marca no formulário (saving mensal, horas antes/depois, custo evitado, receita, metadados) chegam por payloads a `iniciar*`/`atualizar*` e **não viram `chat_messages`**. Por isso `chat.functions.ts` grava esses valores em `form_events` (via helper `gravarEvento`, não-bloqueante) nas funções `iniciarSubmissao`, `iniciarSaving`, `iniciarReceita`, `atualizarMetadados`, `atualizarTipos` e `submeterParaValidacao`. Reentradas (a pessoa volta e reedita) recebem `voltou: true` (detectado por `hasFormEventTipo`). O frontend intercala esses eventos no histórico do chat, na ordem dos acontecimentos, com marcador "Voltou e editou".

**Snapshot por versão** — `submeterParaValidacao` grava `snapshot_chat` (conversa congelada) em `projeto_versions` via `gravarVersaoProjeto`. As abas Submetidos/Edições usam o snapshot da versão; quando ausente (versões antigas), caem no chat atual. Métricas/eventos por versão são fatiados pela janela `[versão anterior, versão]`.

## Autenticação

1. Worker lê o header `x-godeploy-user-email` (configurável via `GODEPLOY_USER_HEADER`)
2. Em dev, usa `DEV_USER_EMAIL` como fallback
3. **Admins hardcoded**: 6 emails no Set `HARDCODED_ADMINS` em `auth.functions.ts` — consultados primeiro (sem DB)
4. **Admins dinâmicos**: tabela `admins` consultada se não hardcoded
5. `requireAdmin()` retorna 401 (sem email) ou 403 (não admin)

## LLM (`llm.ts`)

- Provider: `LLM_PROVIDER` (`openai` default, `anthropic`)
- Modelo: `LLM_MODEL` (default `gpt-4.1`); `LLM_MODEL_FAST` para turnos do orquestrador
- JSON mode habilitado para OpenAI; usa `max_completion_tokens` (modelos novos)
- **Adaptação automática**: se o modelo retorna 400 por parâmetro não suportado, remove o parâmetro e retenta (cache por modelo, até 4 tentativas)
- Anthropic: separa system message, header `x-api-key`, sem JSON mode
- Temperature default: 0.7; max tokens default: 2048

## Extração de texto (`extract-text.server.ts`)

| Tipo | Método |
|---|---|
| PDF | POST para OCR Worker externo (`OCR_WORKER_URL` + token) |
| DOCX/DOC | mammoth (extractRawText via arrayBuffer, sem Node Buffer) |
| TXT/MD/JSON/código | Leitura direta UTF-8 |

**Limites**: 150k chars por arquivo, 800k chars total (~200k tokens). Trunca com `[... arquivo truncado]`.

Usa Web APIs (`atob`, `TextDecoder`) em vez de Node Buffer (compatível com workerd).

## Áreas via TeamGuide (`teamguide.server.ts`)

- 3 raízes encontradas por **nome do líder** (Rafael Lobo, Guilherme Nobrega, Luis Liveri) — normalizado sem acentos
- L1 = área, exceto 4 nós passthrough (Bruno Bezerra, Pedro Glycerio, Rafael Menezes, Joaquim Quindere) cujos L2 viram área
- Raízes aninhadas são ignoradas (não duplica)
- Dedup por slug; resultado ordenado por locale PT-BR
- Fallback hardcoded: `AREAS` em `constants.ts` (34 áreas)
