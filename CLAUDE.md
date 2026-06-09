# GoDocs - Hub de Projetos Internos

Hub interno do Gogroup para cadastro, gestao e documentacao de projetos de automacao (RPA & IA). Funcionarios submetem projetos, líderes acompanham o status das submissoes de suas areas, e Admin Masters gerenciam toda a plataforma.

## Stack

- **Framework**: TanStack Start (SSR) + TanStack Router (file-based routing)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui (new-york style), Lucide icons
- **Forms**: react-hook-form + zod
- **Backend**: Supabase (auth, Postgres com RLS, service role para admin ops)
- **Server functions**: `createServerFn` do TanStack Start (com middleware de auth)
- **LLM**: Camada de abstração (`llm.ts`) que suporta OpenAI e Anthropic via env vars
- **Extração de texto**: pdf-parse v2 (PDF), mammoth (DOCX/DOC), utf-8 direto (TXT/MD)
- **Build**: Vite 7, bun (package manager), Nitro (SSR runtime via `@lovable.dev/vite-tanstack-config`)
- **Linguagem**: TypeScript strict

## Comandos

```bash
bun install          # instalar dependencias
bun run dev          # dev server (vite dev)
bun run build        # build producao
bun run preview      # preview do build
bun run lint         # eslint
bun run format       # prettier
```

## Estrutura do projeto

```
src/
  routes/              # File-based routing (TanStack Router)
    __root.tsx         # Root layout (QueryClientProvider, Toaster, head meta)
    index.tsx          # Home publica - 3 cards de acao (Submeter, Editar, Reenviar)
    auth.tsx           # Login (Supabase email/password)
    submeter.tsx       # Formulario multi-step de submissao (3 etapas) + chat IA
    _authenticated/    # Layout guard - redireciona para /auth se nao logado
      route.tsx        # Sidebar layout + role check (admin_master | leader)
      dashboard.tsx    # Dashboard (placeholder para listagem de projetos)
      usuarios.tsx     # CRUD de usuarios (admin only) - cria via Supabase Admin API
      areas.tsx        # CRUD de areas/departamentos (admin only)
  integrations/supabase/
    client.ts          # Supabase client (browser, lazy proxy)
    client.server.ts   # Supabase admin client (service_role, server-only)
    auth-middleware.ts  # Middleware server: valida Bearer token nas server functions
    auth-attacher.ts   # Middleware client: anexa access_token nas chamadas RPC
    types.ts           # Tipos gerados do schema Supabase
  lib/
    agents/            # Sistema de agentes IA (2 fases)
      types.ts         # Tipos: ChatFase, DocumentacaoColetada, SavingColetado, OrchestratorResult
      orchestrator.ts  # Orquestrador principal — prompts por fase, transições automáticas
      doc-compiler.ts  # Compila campos coletados em DocumentacaoGerada (JSON estruturado)
      validator.ts     # Validação automática de documentação (6 critérios)
      email-agent.ts   # Templates de email de aprovação/rejeição
    chat.functions.ts  # Server functions do chat: iniciarSubmissaoFn, enviarMensagemFn
    extract-text.server.ts  # Extração de texto de PDF/DOCX/DOC/TXT/MD (server-only)
    llm.ts             # Camada de abstração LLM (OpenAI / Anthropic)
    admin.functions.ts # Server functions: createUser, deleteUser, updateUserAreas
    utils.ts           # cn() helper (clsx + tailwind-merge)
  router.tsx           # Configuracao do TanStack Router + QueryClient
  server.ts            # Entry SSR - wrapper de erro sobre o server-entry do TanStack
  start.ts             # createStart - registra middlewares globais
  styles.css           # Tokens CSS (light/dark), Tailwind config
supabase/
  migrations/          # Migrations SQL (schema, RLS, triggers, tabelas de agentes)
  config.toml          # Config local do Supabase CLI
```

## Banco de dados (Supabase Postgres)

### Tabelas

| Tabela | Descricao |
|---|---|
| `profiles` | id (FK auth.users), nome, email |
| `user_roles` | user_id, role (enum: admin_master, leader) |
| `areas` | id, nome (departamentos da empresa) |
| `leader_areas` | user_id, area_id (N:N - quais areas um leader acompanha) |
| `projetos` | id, nome, responsavel_nome, responsavel_email, area_id, ferramenta, membros, status, chat_completo |
| `chat_messages` | id, projeto_id, role (user/assistant/doc), content, options, selected_option |
| `documentacao` | projeto_id, conteudo (JSON estruturado — DocumentacaoGerada) |
| `validacoes` | projeto_id, resultado, parecer, criterios, email_enviado |

### RLS

- Todas as tabelas tem RLS ativado
- Admins veem/gerenciam tudo; usuarios veem apenas seus proprios dados
- Funcao `has_role()` (SECURITY DEFINER) evita recursao nas policies

### Trigger de bootstrap

- `handle_new_user()`: cria profile automaticamente ao signup
- Se o email for `kaique.breno@gocase.com`, atribui `admin_master` automaticamente

## Rotas

| Rota | Acesso | Descricao |
|---|---|---|
| `/` | Publico | Home com 3 cards de acao |
| `/submeter` | Publico | Formulário 3 etapas + chat IA (doc + saving) |
| `/auth` | Publico | Login email/password |
| `/dashboard` | Autenticado (admin/leader) | Dashboard (placeholder) |
| `/usuarios` | Admin Master | CRUD de usuarios |
| `/areas` | Admin Master | CRUD de areas |

## Webhooks n8n

Os formularios de submissao/edicao/reenvio enviam dados para webhooks do n8n:

- **Submeter**: `https://n8n-study.gogroupgl.com/webhook/submit_workflows` (POST FormData)
- **Editar**: `https://n8n-study.gogroupgl.com/webhook/edit_workflow` (link externo)
- **Reenviar**: `https://n8n-study.gogroupgl.com/webhook/re_workflow` (link externo)

## Formulário de submissão (3 etapas + chat IA)

1. **Envio**: status produção (bloqueia se não em produção), nome, email, área, ferramenta, equipe/participantes (apenas domínios @gocase, @gobeaute, @gogroup)
2. **Projeto**: nome do projeto, data criação, descrição, upload de documentação (PDF/DOCX/DOC/TXT/MD, max 15MB)
3. **Agente IA**: chat interativo em 2 fases (ver seção abaixo). Submissão só disponível após ambos os previews aprovados.

## Sistema de agentes IA (chat em 2 fases)

Substituiu as etapas manuais de documentação e memorial de cálculo por um chat com IA inteligente.

### Máquina de estados (ChatFase)

```
doc → doc_preview → saving → saving_preview → completo
```

### Fase 1 — Documentação técnica (Agent Doc)

- Cor do chat: azul (--go-blue)
- IA recebe o documento enviado, extrai os 7 campos silenciosamente
- Pergunta apenas sobre lacunas (1 pergunta por vez)
- Quando todos os campos estão preenchidos, gera preview em markdown
- Usuário aprova ou pede ajustes no PreviewPanel
- Na aprovação, IA gera resumo do projeto (3-5 frases) usado como contexto para fase 2

**7 campos coletados (DocumentacaoColetada):**
1. `nome_projeto` — Título do projeto
2. `o_que_faz` — O que faz, para quem, resultado
3. `execucao` — Como é acionado (trigger, schedule, webhook)
4. `dependencias` — Serviços externos, APIs, credenciais
5. `fluxo` — Sequência de etapas (início ao fim, com IF/ELSE)
6. `configurar_antes` — O que fazer antes da primeira execução
7. `atencao` — Riscos, limitações, pontos frágeis

### Fase 2 — Memorial de saving (Agent Saving)

- Cor do chat: lima (--go-lime)
- Chat se limpa na transição doc → saving
- IA usa o resumo do projeto como contexto
- Coleta dados financeiros via perguntas inteligentes
- Monta o memorial automaticamente (usuário não escreve)
- Regras anti-extrapolação: saving deve refletir ganho real
- Na aprovação, fluxo marca como `completo`

**5 campos coletados (SavingColetado):**
1. `economia_horas_mes` — Horas economizadas por mês
2. `valor_hora` — Valor da hora do colaborador (mín R$8, alerta > R$60)
3. `economia_reais_mes` — horas × valor_hora (calculado pela IA)
4. `tipo_saving` — "mensal" ou "pontual"
5. `memorial_calculo` — Descrição detalhada da lógica de cálculo

### Orquestrador (`orchestrator.ts`)

- 4 system prompts (um por fase): `buildDocPrompt`, `buildDocPreviewPrompt`, `buildSavingPrompt`, `buildSavingPreviewPrompt`
- `runOrchestrator(ctx, history, fase, coletado, saving, resumoProjeto)` — entry point
- Respostas sempre em JSON: `{type, content/question, coletado/saving, options?}`
- Transições automáticas: preview em doc → `doc_preview`, complete em doc_preview → `saving`, complete em saving_preview → `completo`

### Server functions do chat (`chat.functions.ts`)

- `iniciarSubmissaoFn`: cria projeto no Supabase, extrai texto do doc, roda orquestrador na fase `doc`
- `enviarMensagemFn`: recebe mensagem do usuário, detecta fase atual, filtra histórico (saving começa limpo), roda orquestrador
- Ações pós-transição: compila documentação quando doc aprovada, salva saving quando fluxo completo

### Extração de texto (`extract-text.server.ts`)

- PDF: `pdf-parse` v2 (classe PDFParse, fallback para v1)
- DOCX/DOC: `mammoth` (extractRawText)
- TXT/MD: leitura direta utf-8
- Normaliza whitespace, trunca em 50.000 chars

### LLM (`llm.ts`)

- Provider configurável via `LLM_PROVIDER` (openai | anthropic)
- Modelo via `LLM_MODEL` (default: gpt-4.1)
- JSON mode habilitado para respostas estruturadas do orquestrador

### Componentes de UI do chat

- **SimpleMarkdown**: renderizador leve de markdown (headings com dot colorido, listas, bold, parágrafos)
- **PreviewPanel**: card estilo documento com header strip, scroll interno (max 300px), botões de Aprovar (lima) e Pedir Alteração (outline)
- Sistema de cores por fase: azul (doc) → lima (saving) aplicado em bubbles, borders, backgrounds

## Roles e permissoes

- **Admin Master**: acesso total - gerencia usuarios, areas, ve todos os projetos
- **Leader**: ve projetos das areas que lidera, sem acesso a gestao de usuarios/areas
- Usuarios sem role veem tela de "Sem permissao"

## Convencoes

- Path alias: `@/*` -> `./src/*`
- Componentes UI ficam em `src/components/ui/` (shadcn, nao editar diretamente)
- Server functions em arquivos `.functions.ts` dentro de `src/lib/`
- Formularios usam react-hook-form + zod para validacao
- Toasts via sonner (`toast.success()`, `toast.error()`)
- Idioma da interface: **português brasileiro**
- **IMPORTANTE**: Todo texto visível ao usuário DEVE conter acentuação e pontuação corretas do português (á, é, í, ó, ú, ã, õ, ç, ê, â, etc). Nunca omitir acentos. Exemplos: "produção" (não "producao"), "área" (não "area"), "não" (não "nao"), "opção" (não "opcao")
- **Cursor/foco**: Todos os elementos não-editáveis têm `caret-color: transparent` (esconde o caret piscante), mas mantêm seleção de texto habilitada. Apenas `input`, `textarea` e `[contenteditable]` reativam o caret. Foco visível apenas via teclado (`:focus-visible`). Regras globais em `styles.css` na `@layer base` — não sobrescrever
- `routeTree.gen.ts` e auto-gerado - nao editar manualmente

## Variáveis de ambiente

Definidas em `.env` (não comitar chaves secretas):

- `SUPABASE_URL` / `VITE_SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, necessário para admin ops)
- `LLM_PROVIDER` — `openai` (default) ou `anthropic`
- `LLM_API_KEY` — chave da API do provider escolhido
- `LLM_MODEL` — modelo a usar (default: `gpt-4.1`)

## Status atual

- Home, login, formulário de submissão, CRUD de usuários e áreas estão funcionais
- **Agente Doc (fase 1)**: funcional — extrai texto, faz perguntas, gera preview formatado, ciclo de aprovação
- **Agente Saving (fase 2)**: estrutura pronta, transição automática implementada
- PreviewPanel + SimpleMarkdown renderizam previews de forma agradável
- Dashboard ainda é placeholder — falta integrar listagem de projetos submetidos
- Editar e Reenviar ainda redirecionam para webhooks externos (sem UI própria)
- Design usa identidade visual GoGroup (--go-blue, --go-lime, --go-cream, Poppins)

## Notas importantes

- Projeto originado do Lovable (gerado por IA) - pode conter codigo que precisa de refatoracao
- Arquivos marcados "automatically generated" pelo Lovable podem ser editados agora que o desenvolvimento saiu do Lovable
- O `@lovable.dev/vite-tanstack-config` ja inclui tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro etc - nao duplicar plugins no vite.config.ts
