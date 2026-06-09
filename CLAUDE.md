# GoDocs - Hub de Projetos Internos

Hub interno do Gogroup para cadastro, gestão e documentação de projetos de automação (RPA & IA). Funcionários submetem projetos, líderes acompanham o status das submissões de suas áreas, e Admin Masters gerenciam toda a plataforma. Todo o fluxo de submissão (documentação + memorial de saving) é interno — sem dependência de Google Sheets ou n8n.

## Stack

- **Framework**: TanStack Start (SSR) + TanStack Router (file-based routing)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui (new-york style), Lucide icons
- **Forms**: react-hook-form + zod
- **Backend**: Supabase (auth, Postgres com RLS, service role para admin ops)
- **Server functions**: `createServerFn` do TanStack Start (com middleware de auth)
- **LLM**: Camada de abstração (`llm.ts`) que suporta OpenAI e Anthropic via env vars
- **Extração de texto**: Cloudflare OCR Worker (PDF), mammoth (DOCX/DOC), utf-8 direto (TXT/MD)
- **Testes**: Vitest (roda automaticamente antes de `npm run dev`)
- **Build**: Vite 7, npm (package manager), Nitro (SSR runtime via `@lovable.dev/vite-tanstack-config`)
- **Deploy**: Cloudflare Workers via wrangler (`npm run deploy`)
- **Linguagem**: TypeScript strict

## Comandos

```bash
npm install            # instalar dependências
npm run dev            # roda testes + dev server (vite dev)
npm run test           # roda testes uma vez
npm run test:watch     # testes em modo watch
npm run build          # build produção (Nitro cloudflare-module)
npm run preview        # preview do build (vite)
npm run preview:worker # build + preview local via wrangler dev (workerd runtime)
npm run deploy         # build + deploy no Cloudflare Workers
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
    agents/            # Sistema de agentes IA
      types.ts         # Tipos: ChatFase, DocumentacaoColetada, SavingColetado, OrchestratorResult, ProjetoContexto
      extractor.ts     # 1 chamada (temp 0) que lê toda a codebase → pré-preenche os 7 campos
      orchestrator.ts  # Orquestrador do chat — prompts por fase, transições automáticas
      doc-compiler.ts  # Compila campos coletados em DocumentacaoGerada (JSON estruturado)
      validator.ts     # Validação automática de documentação (6 critérios)
      email-agent.ts   # Templates de email de aprovação/rejeição
    submeter/          # UI do formulário /submeter (steps + componentes)
      constants.ts     # FormData, extensões aceitas, MAX_FILE_MB, TOKEN_* (gate), readFileAsBase64
      step1.tsx        # Step 1 (Envio): responsável, área, ferramenta, equipe
      step2.tsx        # Step 2 (Projeto): tipo, nome, data, contexto + upload multi-arquivo (árvore)
      step3-chat.tsx   # Step 3 (Agente): chat IA, previews, revisão final
      form-components.tsx # Inputs, RadioGroup, InfoTooltip (via portal), ChipsInput
      layout.tsx       # PageFrame, WizardProgress, StepAnimation
    chat.functions.ts  # Server functions: iniciarSubmissaoFn, enviarMensagemFn, submeterParaValidacaoFn
    extract-text.server.ts  # Extração de texto: PDF/DOCX/DOC/TXT/MD/JSON + código; multi-arquivo (server-only)
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
| `projetos` | id, nome, responsavel_nome, responsavel_email, area, area_id, ferramenta, membros, status, chat_completo, data_criacao_projeto, **tipo_projeto** (saving\|receita_incremental), **descricao_breve**, saving_horas, saving_reais, tipo_saving, memorial_calculo, submitted_at, validated_at, validated_by |
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
2. **Projeto**: tipo (saving | receita_incremental), nome, data criação, **contexto de negócio** (descrição obrigatória), e **upload de arquivos/pasta** (ver seção abaixo)
3. **Agente IA**: chat interativo em 2 fases (ver seção abaixo). Submissão só disponível após ambos os previews aprovados. Tela de revisão final com previews colapsáveis antes do envio.

### Upload de arquivos (Step 2 — `step2.tsx`)

A IA lê a **codebase/pasta inteira** e gera a documentação automaticamente. Lógica de seleção:

- **Múltiplos arquivos ou pasta inteira** (`webkitdirectory`, recursivo) + drag-and-drop
- **Extensões**: docs (PDF, DOCX, DOC, TXT, MD) e código (`.json .ts .tsx .js .jsx .py .sql .sh .yaml .yml .toml .css .html`)
- **Filtro automático** (estilo `.gitignore`, por segmento do caminho): ignora `node_modules`, `.git`, `dist`, `build`, `.output`, `.wrangler`, `.vercel`, `.next`, `.venv`, `__pycache__`, `vendor`, `target` etc. + lock files, `*.min.js/css`, `*.map`. **Sem limite de contagem** de arquivos (cap de segurança 5000)
- **Gate por tokens** (~4 chars/token): WARN ~150k tokens (600k chars), **BLOCK ~200k tokens (800k chars)** → painel com prompt para gerar pré-documentação no Claude.ai. A trava também roda no submit (`handleIniciarAgente`)
- **Estimativa por tamanho** (sem ler conteúdo no browser → instantâneo); chars exatos só no backend pós-extração
- **Árvore de pastas colapsável** (`FileTreeNode`): hierarquia original, agregado por pasta, expandir/recolher, remover arquivo/pasta. Identidade por **caminho completo** (`webkitRelativePath`), não pelo nome
- **Loading** mostrado já no clique do botão (cobre a enumeração do browser, que é lenta e ocorre antes do `onChange`); evento `cancel` limpa o estado

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
- **Pré-extração** (`extractor.ts`): antes do chat, 1 chamada ao LLM (temp 0) lê todo o conteúdo dos arquivos e preenche os 7 campos. Campos **técnicos** (execução, dependências, fluxo, configurar_antes) saem direto do código; campos de **negócio** (o_que_faz, atenção) ficam null se o código não revelar
- O chat então **só pergunta o que ficou null** (regras de negócio que o código não mostra) — não reconfirma o que já foi extraído
- Se o extractor preencheu todos os 7, o orquestrador gera o **preview direto** (zero perguntas)
- 1 pergunta por vez, cética (não aceita respostas vagas — mantém null e aprofunda)
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

- `iniciarSubmissaoFn`: cria projeto (com `tipo_projeto`, `descricao_breve`, area, data), recebe **array `docs`** (até 5000), extrai texto de todos via `extractTextFromMultipleFiles`, roda o **extractor** para pré-preencher os 7 campos, então roda o orquestrador na fase `doc`
- `enviarMensagemFn`: recebe mensagem do usuário, detecta fase atual, filtra histórico (saving começa limpo), roda orquestrador
- `submeterParaValidacaoFn`: verifica duplicata, popula colunas de saving, auto-aprova se RPA, notifica Google Chat
- Ações pós-transição: compila documentação quando doc aprovada, salva saving quando fluxo completo

### Extração de texto (`extract-text.server.ts`)

- PDF: Cloudflare OCR Worker (`OCR_WORKER_URL` + `OCR_WORKER_TOKEN`)
- DOCX/DOC: `mammoth` (extractRawText)
- TXT/MD/JSON/código: leitura direta utf-8
- `extractTextFromMultipleFiles`: extrai e concatena vários arquivos com separadores `=== caminho ===`; loga análise de eficiência pós-extração (chars/tokens por arquivo e por extensão)
- Truncamento: **150k chars por arquivo**, **800k chars no total** (~200k tokens)

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

Definidas em `.env` (não comitar chaves secretas). No Cloudflare Workers, as variáveis runtime são secrets (`wrangler secret bulk .env`).

### Build-time (baked no bundle via `VITE_` prefix — precisam existir no `.env` na hora do build)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

### Runtime (server-only — lidos via `process.env` no Worker com `nodejs_compat`)

- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `LLM_PROVIDER` — `openai` (default) ou `anthropic`
- `LLM_API_KEY` — chave da API do provider escolhido
- `LLM_MODEL` — modelo a usar (default: `gpt-4.1`)
- `GOOGLE_CHAT_WEBHOOK_URL` — webhook do Google Chat para notificações de novo projeto
- `OCR_WORKER_URL` — URL do Cloudflare Worker de extração de texto de PDFs
- `OCR_WORKER_TOKEN` — token Bearer de autenticação do OCR Worker
- `BREVO_API_KEY` / `EMAIL_FROM` — envio de e-mail via Brevo
- `GODEPLOY_USER_HEADER` — header com email do usuário autenticado (default: `x-user-email`)

## Deploy (Cloudflare Workers)

- **URL produção**: `https://godocs.kaique-rpa.workers.dev`
- **Runtime**: Cloudflare Workers com `nodejs_compat` (V8 isolate + polyfills Node)
- **Build**: Nitro preset `cloudflare-module` via `@lovable.dev/vite-tanstack-config`
- **Config**: `vite.config.ts` habilita Nitro com `nitro: { preset: "cloudflare-module", cloudflare: { nodeCompat: true, deployConfig: true } }`
- **wrangler.toml** na raiz: apenas `name` e `compatibility_date` — Nitro auto-gera o `wrangler.json` completo em `.output/server/` com entry point, assets, flags e rules
- **Deploy config**: `.wrangler/deploy/config.json` aponta o wrangler pro config gerado
- **Secrets**: setados via `wrangler secret bulk .env` (todas as vars runtime)
- **Fluxo de deploy**: `npm run deploy` = `vite build && wrangler deploy`
- **Preview local com workerd**: `npm run preview:worker` = `vite build && wrangler dev`
- **Extração de PDF**: delegada ao Cloudflare OCR Worker externo (removeu `pdf-parse` do bundle)
- **mammoth (DOCX)**: roda dentro do Worker com `nodejs_compat` — funciona mas é o ponto mais frágil

## Status atual

- Home, login, formulário de submissão, CRUD de usuários e áreas estão funcionais
- **Step 2 (upload)**: upload de codebase/pasta inteira com filtro de pastas de dev, gate de ~200k tokens e árvore de pastas colapsável
- **Agente Doc (fase 1)**: funcional — pré-extração lê o código e preenche os campos técnicos; chat pergunta só as regras de negócio; gera preview formatado, ciclo de aprovação
- **Agente Saving (fase 2)**: funcional — validação de horas com detalhamento obrigatório, monta memorial, ciclo de aprovação
- **Transição doc → saving**: tela animada com check verde e progress bar
- **Tela de revisão final**: cards colapsáveis com previews aprovados antes do envio
- **Submissão interna**: dados salvos no Supabase (sem Sheets), duplicata verificada, auto-aprovação para RPA, notificação Google Chat
- **Deploy**: live no Cloudflare Workers via wrangler
- **Testes**: 100 testes passando (6 arquivos), rodam antes de cada `npm run dev`
- Dashboard ainda é placeholder — falta integrar listagem/gestão de projetos
- Design usa identidade visual GoGroup (--go-blue, --go-lime, --go-cream, Poppins)

## Notas importantes

- Projeto originado do Lovable (gerado por IA) - pode conter código que precisa de refatoração
- Arquivos marcados "automatically generated" pelo Lovable podem ser editados agora que o desenvolvimento saiu do Lovable
- O `@lovable.dev/vite-tanstack-config` já inclui tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro etc - não duplicar plugins no vite.config.ts
- Fora do sandbox Lovable, o Nitro só roda no build se `nitro` for explicitamente setado no `defineConfig` (truthy). O Nitro instalado (3.0.260429-beta) não suporta `defaultPreset`, então `preset: "cloudflare-module"` deve ser explícito
- O antigo fluxo n8n → Google Sheets foi substituído por submissão interna via Supabase. O arquivo `forms_submissao_logica.json` contém o fluxo n8n legado para referência
