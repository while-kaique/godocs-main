# GoDocs - Hub de Projetos Internos

Hub interno do Gogroup para cadastro, gestão e documentação de projetos de automação (RPA & IA). Funcionários submetem projetos, líderes acompanham o status das submissões de suas áreas, e Admin Masters gerenciam toda a plataforma. Todo o fluxo de submissão (documentação + memorial de saving) é interno — sem dependência de Google Sheets ou n8n.

## Stack

- **Framework**: TanStack Start (SSR) + TanStack Router (file-based routing)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui (new-york style), Lucide icons
- **Forms**: react-hook-form + zod
- **Backend**: Supabase (auth, Postgres com RLS, service role para admin ops)
- **Server functions**: `createServerFn` do TanStack Start (com middleware de auth)
- **LLM**: Camada de abstração (`llm.ts`) que suporta OpenAI e Anthropic via env vars
- **Extração de texto**: pdf-parse v2 (PDF), mammoth (DOCX/DOC), utf-8 direto (TXT/MD)
- **Testes**: Vitest (roda automaticamente antes de `npm run dev`)
- **Build**: Vite 7, npm (package manager), Nitro (SSR runtime via `@lovable.dev/vite-tanstack-config`)
- **Linguagem**: TypeScript strict

## Comandos

```bash
npm install            # instalar dependências
npm run dev            # roda testes + dev server (vite dev)
npm run test           # roda testes uma vez
npm run test:watch     # testes em modo watch
npm run build          # build produção
npm run preview        # preview do build
npm run lint           # eslint
npm run format         # prettier
```

## Testes

- **Framework**: Vitest
- **Config**: `vitest.config.ts` (alias `@/` → `./src/*`, ambiente node)
- **Diretório**: `tests/`
- **Execução obrigatória**: `predev` script garante que testes rodam antes de cada `npm run dev`
- **A cada modificação no código**: rodar `npm run test` para verificar que nada quebrou

### Arquivos de teste

| Arquivo | Cobertura |
|---|---|
| `agents-types.test.ts` | Factories, tipos do orquestrador, ProjetoContexto |
| `orchestrator-prompts.test.ts` | System prompts por fase, regras de validação de horas, transições automáticas de fase |
| `form-validation.test.ts` | E-mail (domínios permitidos), arquivo (extensões/tamanho), nome, data, saving |
| `submission-flow.test.ts` | Auto-aprovação por área, extração de saving do JSON, notificação Google Chat, verificação de duplicata |
| `llm.test.ts` | Erros de configuração, provider desconhecido, defaults |
| `routes.test.ts` | Existência de rotas, arquivos de agentes, infra, tipos Supabase (colunas saving, enum aprovado) |

## Estrutura do projeto

```
src/
  routes/              # File-based routing (TanStack Router)
    __root.tsx         # Root layout (QueryClientProvider, Toaster, head meta)
    index.tsx          # Home pública - 3 cards de ação (Submeter, Editar, Reenviar)
    auth.tsx           # Login (Supabase email/password)
    submeter.tsx       # Formulário multi-step de submissão (3 etapas) + chat IA
    _authenticated/    # Layout guard - redireciona para /auth se não logado
      route.tsx        # Sidebar layout + role check (admin_master | leader)
      dashboard.tsx    # Dashboard de projetos submetidos
      usuarios.tsx     # CRUD de usuários (admin only) - cria via Supabase Admin API
      areas.tsx        # CRUD de áreas/departamentos (admin only)
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
    chat.functions.ts  # Server functions: iniciarSubmissaoFn, enviarMensagemFn, submeterParaValidacaoFn
    extract-text.server.ts  # Extração de texto de PDF/DOCX/DOC/TXT/MD (server-only)
    llm.ts             # Camada de abstração LLM (OpenAI / Anthropic)
    admin.functions.ts # Server functions: createUser, deleteUser, updateUserAreas
    utils.ts           # cn() helper (clsx + tailwind-merge)
  router.tsx           # Configuração do TanStack Router + QueryClient
  server.ts            # Entry SSR - wrapper de erro sobre o server-entry do TanStack
  start.ts             # createStart - registra middlewares globais
  styles.css           # Tokens CSS (light/dark), Tailwind config
tests/                 # Testes unitários (Vitest)
supabase/
  migrations/          # Migrations SQL (schema, RLS, triggers, colunas de saving)
  config.toml          # Config local do Supabase CLI
```

## Banco de dados (Supabase Postgres)

### Tabelas

| Tabela | Descrição |
|---|---|
| `profiles` | id (FK auth.users), nome, email |
| `user_roles` | user_id, role (enum: admin_master, leader) |
| `areas` | id, nome (departamentos da empresa) |
| `leader_areas` | user_id, area_id (N:N - quais áreas um leader acompanha) |
| `projetos` | id, nome, responsavel_nome, responsavel_email, area, area_id, ferramenta, membros, status, chat_completo, data_criacao_projeto, saving_horas, saving_reais, tipo_saving, memorial_calculo, submitted_at, validated_at, validated_by |
| `chat_messages` | id, projeto_id, role (user/assistant/doc), content, options, selected_option |
| `documentacao` | projeto_id, conteudo (JSON estruturado — DocumentacaoGerada + saving) |
| `validacoes` | projeto_id, resultado, parecer, criterios, admin_email, email_enviado |
| `configuracoes` | chave, valor (JSON), descrição — config dinâmica (ex: critérios de validação) |

### Enum `projeto_status`

```
rascunho → em_validacao → validado | rejeitado
                        → aprovado (auto, quando área = RPA)
```

### RLS

- Todas as tabelas têm RLS ativado
- Admins veem/gerenciam tudo; usuários veem apenas seus próprios dados
- Função `has_role()` (SECURITY DEFINER) evita recursão nas policies

### Trigger de bootstrap

- `handle_new_user()`: cria profile automaticamente ao signup
- Se o email for `kaique.breno@gocase.com`, atribui `admin_master` automaticamente

## Rotas

| Rota | Acesso | Descrição |
|---|---|---|
| `/` | Público | Home com 3 cards de ação |
| `/submeter` | Público | Formulário 3 etapas + chat IA (doc + saving) |
| `/auth` | Público | Login email/password |
| `/dashboard` | Autenticado (admin/leader) | Dashboard de projetos |
| `/usuarios` | Admin Master | CRUD de usuários |
| `/areas` | Admin Master | CRUD de áreas |

## Fluxo de submissão (3 etapas + chat IA)

1. **Envio**: status produção (bloqueia se não em produção), nome, email (apenas @gocase, @gobeaute, @gogroup), área, ferramenta, equipe/participantes
2. **Projeto**: nome do projeto, data criação, upload de documentação (PDF/DOCX/DOC/TXT/MD, max 10MB)
3. **Agente IA**: chat interativo em 2 fases (ver seção abaixo). Submissão só disponível após ambos os previews aprovados. Tela de revisão final com previews colapsáveis antes do envio.

### Submissão final (`submeterParaValidacaoFn`)

Quando o usuário clica "Enviar para Triagem" (substitui o antigo fluxo n8n → Sheets):

1. Verifica duplicata (mesmo nome de projeto já submetido)
2. Extrai saving do JSON da documentação e popula colunas do `projetos` (saving_horas, saving_reais, tipo_saving, memorial_calculo)
3. Auto-aprovação: se área = "RPA", status = `aprovado`; senão `em_validacao`
4. Envia notificação para Google Chat (webhook via env var `GOOGLE_CHAT_WEBHOOK_URL`)

## Sistema de agentes IA (chat em 2 fases)

### Máquina de estados (ChatFase)

```
doc → doc_preview → [transição animada 3s] → saving → saving_preview → completo
```

### Fase 1 — Documentação técnica

- Cor do chat: azul (--go-blue)
- Header: "Documentação Técnica"
- IA recebe o documento enviado, extrai os 7 campos silenciosamente
- Pergunta apenas sobre lacunas (1 pergunta por vez)
- Se todos os campos estão cobertos, gera preview direto (sem perguntas desnecessárias)
- É cética: não aceita respostas vagas — mantém campo null e aprofunda
- Quando todos os campos estão preenchidos, gera preview em markdown
- Usuário aprova ou pede ajustes no PreviewPanel
- Na aprovação, IA gera resumo interno do projeto (3-5 frases) para contexto da fase 2

**7 campos coletados (DocumentacaoColetada):**
1. `nome_projeto` — Título do projeto
2. `o_que_faz` — O que faz, para quem, resultado
3. `execucao` — Como é acionado (trigger, schedule, webhook)
4. `dependencias` — Serviços externos, APIs, credenciais
5. `fluxo` — Sequência de etapas (início ao fim, com IF/ELSE)
6. `configurar_antes` — O que fazer antes da primeira execução
7. `atencao` — Riscos, limitações, pontos frágeis

### Transição doc → saving

- Tela animada (3s): check verde, "Documentação aprovada!", mini progress bar (Doc ✓ → Impacto), loading dots
- Chat limpa completamente
- Frontend dispara chamada automática ao agente saving para obter primeira pergunta

### Fase 2 — Análise de Impacto (memorial de saving)

- Cor do chat: lima (--go-lime)
- Header: "Análise de Impacto"
- IA se apresenta em 1 frase + faz pergunta concreta sobre o processo manual anterior
- Coleta dados financeiros via perguntas inteligentes
- Monta o memorial automaticamente (usuário não escreve)
- **Validação de horas obrigatória**: NUNCA aceita horas "de cara" — pede detalhamento da rotina passo a passo, faz a conta, confronta discrepâncias
- Questiona cargo vs tarefa (ex: CEO fazendo tarefa operacional)
- Regras anti-extrapolação: saving deve refletir ganho real
- Na aprovação, fluxo marca como `completo`

**5 campos coletados (SavingColetado):**
1. `economia_horas_mes` — Horas economizadas por mês
2. `valor_hora` — Valor da hora do colaborador (mín R$8, alerta > R$60)
3. `economia_reais_mes` — horas × valor_hora (calculado pela IA)
4. `tipo_saving` — "mensal" ou "pontual"
5. `memorial_calculo` — Descrição detalhada da lógica de cálculo

### Tabela de referência de cargos (usada no prompt do saving)

| Cargo | Valor/hora (com encargos) |
|---|---|
| Estagiário | R$ 10,78 |
| Assistente | R$ 13,94 |
| Analista Júnior | R$ 21,29 |
| Analista Pleno | R$ 29,90 |
| Analista Sênior | R$ 33,10 |
| Coordenador / Especialista | R$ 55,15 |

### Tela de revisão final

Quando ambos os previews são aprovados (`fase = completo`):
- Cards colapsáveis: "Documentação Técnica" e "Memorial de Cálculo" (clica para expandir, badge "Aprovado")
- Botão "Enviar para Triagem" abaixo dos cards

### Orquestrador (`orchestrator.ts`)

- 4 system prompts (um por fase): `buildDocPrompt`, `buildDocPreviewPrompt`, `buildSavingPrompt`, `buildSavingPreviewPrompt`
- `runOrchestrator(ctx, history, fase, coletado, saving, resumoProjeto)` — entry point
- Respostas sempre em JSON: `{type, content/question, coletado/saving, options?}`
- Transições automáticas: preview em doc → `doc_preview`, complete em doc_preview → `saving`, complete em saving_preview → `completo`

### Server functions do chat (`chat.functions.ts`)

- `iniciarSubmissaoFn`: cria projeto no Supabase (com area, data_criacao_projeto), extrai texto do doc, roda orquestrador na fase `doc`
- `enviarMensagemFn`: recebe mensagem do usuário, detecta fase atual, filtra histórico (saving começa limpo), roda orquestrador
- `submeterParaValidacaoFn`: verifica duplicata, popula colunas de saving, auto-aprova se RPA, notifica Google Chat
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
- **CollapsiblePreviewCard**: card colapsável para revisão final (header clicável com chevron, badge "Aprovado")
- **FinalReview**: tela de revisão final com 2 cards colapsáveis + botão de envio
- Sistema de cores por fase: azul (doc) → lima (saving) aplicado em bubbles, borders, backgrounds

## Roles e permissões

- **Admin Master**: acesso total - gerencia usuários, áreas, vê todos os projetos
- **Leader**: vê projetos das áreas que lidera, sem acesso a gestão de usuários/áreas
- Usuários sem role veem tela de "Sem permissão"

## Convenções

- Path alias: `@/*` -> `./src/*`
- Componentes UI ficam em `src/components/ui/` (shadcn, não editar diretamente)
- Server functions em arquivos `.functions.ts` dentro de `src/lib/`
- Formulários usam react-hook-form + zod para validação
- Toasts via sonner (`toast.success()`, `toast.error()`)
- Idioma da interface: **português brasileiro**
- **IMPORTANTE**: Todo texto visível ao usuário DEVE conter acentuação e pontuação corretas do português (á, é, í, ó, ú, ã, õ, ç, ê, â, etc). Nunca omitir acentos. Exemplos: "produção" (não "producao"), "área" (não "area"), "não" (não "nao"), "opção" (não "opcao")
- **Cursor/foco**: Todos os elementos não-editáveis têm `caret-color: transparent` (esconde o caret piscante), mas mantêm seleção de texto habilitada. Apenas `input`, `textarea` e `[contenteditable]` reativam o caret. Foco visível apenas via teclado (`:focus-visible`). Regras globais em `styles.css` na `@layer base` — não sobrescrever
- **Testes obrigatórios**: rodar `npm run test` após qualquer modificação. Testes rodam automaticamente antes de `npm run dev` via `predev`.
- `routeTree.gen.ts` é auto-gerado - não editar manualmente

## Variáveis de ambiente

Definidas em `.env` (não comitar chaves secretas):

- `SUPABASE_URL` / `VITE_SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, necessário para admin ops)
- `LLM_PROVIDER` — `openai` (default) ou `anthropic`
- `LLM_API_KEY` — chave da API do provider escolhido
- `LLM_MODEL` — modelo a usar (default: `gpt-4.1`)
- `GOOGLE_CHAT_WEBHOOK_URL` — webhook do Google Chat para notificações de novo projeto

## Status atual

- Home, login, formulário de submissão, CRUD de usuários e áreas estão funcionais
- **Agente Doc (fase 1)**: funcional — extrai texto, faz perguntas, gera preview formatado, ciclo de aprovação
- **Agente Saving (fase 2)**: funcional — validação de horas com detalhamento obrigatório, monta memorial, ciclo de aprovação
- **Transição doc → saving**: tela animada com check verde e progress bar
- **Tela de revisão final**: cards colapsáveis com previews aprovados antes do envio
- **Submissão interna**: dados salvos no Supabase (sem Sheets), duplicata verificada, auto-aprovação para RPA, notificação Google Chat
- **Testes**: 100 testes passando (6 arquivos), rodam antes de cada `npm run dev`
- Dashboard ainda é placeholder — falta integrar listagem/gestão de projetos
- Design usa identidade visual GoGroup (--go-blue, --go-lime, --go-cream, Poppins)

## Notas importantes

- Projeto originado do Lovable (gerado por IA) - pode conter código que precisa de refatoração
- Arquivos marcados "automatically generated" pelo Lovable podem ser editados agora que o desenvolvimento saiu do Lovable
- O `@lovable.dev/vite-tanstack-config` já inclui tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro etc - não duplicar plugins no vite.config.ts
- O antigo fluxo n8n → Google Sheets foi substituído por submissão interna via Supabase. O arquivo `forms_submissao_logica.json` contém o fluxo n8n legado para referência
