# GoDocs - Hub de Projetos Internos

Hub interno do Gogroup para cadastro, gestão e documentação de projetos de automação (RPA & IA). Funcionários submetem projetos, líderes acompanham o status das submissões de suas áreas, e Admin Masters gerenciam toda a plataforma. Todo o fluxo de submissão (documentação + memorial de saving) é interno — sem dependência de Google Sheets ou n8n.

## Stack

- **Arquitetura**: **SPA** (Single Page Application) — React puro no cliente + API em `/api/*` servida por um Cloudflare Worker (`src/worker.ts`). Migrado de TanStack Start (SSR) para SPA (PR #24/#25).
- **Framework**: TanStack Router (file-based routing) rodando como SPA (sem SSR)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui (new-york style), Lucide icons
- **Forms**: react-hook-form + zod
- **Backend**: SQLite via `better-sqlite3` (banco local `godocs.db`, auto-criado); auth via header do Godeploy edge (Google OAuth)
- **API**: funções de negócio em `*.functions.ts` chamadas pelo `src/worker.ts` (roteador `/api/*`); o frontend chama via `apiFetch` (`src/lib/api-client.ts`). Em dev, o `vite-plugin-dev-api.ts` serve as rotas `/api/*` reusando o `worker.ts` via `ssrLoadModule`
- **LLM**: Camada de abstração (`llm.ts`) que suporta OpenAI e Anthropic via env vars
- **Extração de texto**: Cloudflare OCR Worker (PDF), mammoth (DOCX/DOC), utf-8 direto (TXT/MD)
- **Testes**: Vitest (roda automaticamente antes de `npm run dev`)
- **Build**: Vite 7, npm (package manager); build SPA estático em `dist/`
- **Deploy**: Godeploy (SPA + Worker API). ⚠️ `better-sqlite3` é binário nativo de Node — **não roda em Cloudflare Workers/workerd**; produção exige runtime Node real, ou migração para D1/Turso (ver `PLANO_MIGRACAO_SQLITE.md`)
- **Linguagem**: TypeScript strict

## Comandos

```bash
npm install            # instalar dependências
npm run dev            # roda testes + dev server (vite dev)
npm run test           # roda testes uma vez
npm run test:watch     # testes em modo watch
npm run build          # build produção (SPA estática em dist/)
npm run build:dev      # build em modo development
npm run preview        # preview do build (vite)
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
| `routes.test.ts` | Existência de rotas, arquivos de agentes, infra (`integrations/db/`), schema SQLite e tipos (colunas saving, enum aprovado), ausência do Supabase |

## Estrutura do projeto

```
src/
  routes/              # File-based routing (TanStack Router)
    __root.tsx         # Root layout (QueryClientProvider, Toaster, head meta)
    index.tsx          # Home pública - 3 cards de ação (Submeter, Editar, Reenviar)
    auth.tsx           # Redireciona para /dashboard (auth é via Godeploy edge)
    submeter.tsx       # Formulário multi-step de submissão (3 etapas) + chat IA
    _authenticated/    # Layout guard - beforeLoad chama /api/auth/me; redireciona p/ / se não admin
      route.tsx        # Sidebar layout + guard de admin (via /api/auth/me)
      dashboard.tsx    # Dashboard de projetos submetidos (lê via /api/admin/projetos)
      usuarios.tsx     # CRUD de usuários (admin only) - lê via /api/admin/usuarios
      areas.tsx        # CRUD de áreas/departamentos (admin only) - via /api/admin/areas
  integrations/db/
    client.server.ts   # Client SQLite (better-sqlite3) + funções de acesso ao banco (server-only)
    schema.ts          # Criação das tabelas SQLite (auto-init na primeira execução)
    types.ts           # Tipos TypeScript do schema (Projeto, Area, ProjetoStatus, etc.)
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
    chat.functions.ts  # Funções de negócio do chat: iniciarSubmissao, iniciarSaving, enviarMensagem, submeterParaValidacao, validarProjeto
    admin.functions.ts # Funções admin: áreas, admins, projetos, usuários (createUser/deleteUser/updateUserAreas/getUsuarios), configurações
    auth.functions.ts  # getCurrentUser (lê email do header Godeploy → consulta tabela admins)
    projeto.functions.ts # Funções auxiliares de projeto/chat (CRUD via db)
    api-client.ts      # apiFetch — helper do frontend para chamar /api/*
    extract-text.server.ts  # Extração de texto: PDF/DOCX/DOC/TXT/MD/JSON + código; multi-arquivo (server-only)
    llm.ts             # Camada de abstração LLM (OpenAI / Anthropic)
    utils.ts           # cn() helper (clsx + tailwind-merge)
  router.tsx           # Configuração do TanStack Router + QueryClient
  worker.ts            # Entry do Cloudflare Worker — roteia /api/* p/ as funções; fallback SPA
  main.tsx             # Entry do cliente (monta a SPA React)
  styles.css           # Tokens CSS (light/dark), Tailwind config
vite-plugin-dev-api.ts # Plugin Vite que serve /api/* em dev reusando o worker.ts
tests/                 # Testes unitários (Vitest)
PLANO_MIGRACAO_SQLITE.md # Plano da migração Supabase → SQLite + risco de runtime no deploy
godocs.db              # Banco SQLite local (auto-criado, ignorado no git)
```

## Banco de dados (SQLite via better-sqlite3)

### Tabelas

O schema é criado automaticamente na primeira execução por `initSchema()` em `src/integrations/db/schema.ts`. IDs são gerados como hex de 32 chars (`lower(hex(randomblob(16)))`) — **não são UUID**; colunas JSON (`membros`, `tipos_projeto`, `options`, `conteudo`, `criterios`, `valor`) são armazenadas como TEXT e parseadas via `parseJson()`. Booleanos viram INTEGER 0/1.

| Tabela | Descrição |
|---|---|
| `admins` | id, email (UNIQUE), nome — controla quem tem acesso admin |
| `profiles` | id, nome, email |
| `user_roles` | user_id, role (admin_master, leader) |
| `areas` | id, nome (departamentos da empresa) |
| `leader_areas` | user_id, area_id (N:N - quais áreas um leader acompanha) |
| `projetos` | id, nome, responsavel_nome, responsavel_email, area, area_id, ferramenta, escopo, servico_externo, membros (JSON), status, chat_completo, data_criacao_projeto, **tipo_projeto**, **tipos_projeto** (JSON), **descricao_breve**, saving_horas, saving_reais, tipo_saving, memorial_calculo, custo_externo_mensal, submitted_at, validated_at, validated_by |
| `chat_messages` | id, projeto_id, role (user/assistant/doc), content, options (JSON), selected_option |
| `documentacao` | projeto_id (UNIQUE), conteudo (JSON — DocumentacaoGerada + saving) |
| `validacoes` | projeto_id, resultado, parecer, criterios (JSON), admin_email, email_enviado |
| `configuracoes` | chave (UNIQUE), valor (JSON), descrição — config dinâmica (ex: critérios de validação) |

### Status (CHECK na coluna `projetos.status`)

```
rascunho → em_validacao → validado | rejeitado
                        → aprovado (auto, quando área = RPA)
```

### Segurança

- Sem RLS (SQLite não tem) — o controle de acesso é feito no `src/worker.ts` (`requireAdmin`) e nos middlewares de auth das funções
- Auth via header do Godeploy edge (Google OAuth), nome do header em `GODEPLOY_USER_HEADER` (default `x-godeploy-user-email`)
- A tabela `admins` define quem é admin (`getCurrentUser` / `requireAdmin` consultam por email)
- `createUser` apenas cria `profiles` + `user_roles` (+ `leader_areas`); não há mais credenciais locais — a senha do formulário é ignorada

## Rotas

| Rota | Acesso | Descrição |
|---|---|---|
| `/` | Público | Home com 3 cards de ação |
| `/submeter` | Público | Formulário 3 etapas + chat IA (doc + saving) |
| `/auth` | Público | Redireciona para `/dashboard` (auth via Godeploy edge) |
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
- Após transição: **formulário determinístico** (`SavingForm`) aparece antes do chat

### Formulário determinístico (SavingForm)

Após a transição, o usuário preenche dados antes do chat de IA começar:

**Para tipo_projeto = "saving":**
- Cargo (dropdown único) — seleção de um dos 6 cargos da tabela
- Horas/mês antes da automação (number input)
- Horas/mês depois da automação (number input, deve ser < horas_antes)
- Mensal / Pontual (2 botões toggle)
- Botão "Iniciar análise"

**Para tipo_projeto = "receita_incremental":**
- Apenas Mensal / Pontual toggle + botão "Iniciar análise"

O **valor R$/hora nunca aparece ao usuário** — é calculado no backend: `(horas_antes - horas_depois) × valor_hora_do_cargo`

Server function `iniciarSavingFn` recebe os dados, calcula valores e inicia o chat.

### Fase 2 — Análise de Impacto (memorial de saving)

- Cor do chat: lima (--go-lime)
- Header: "Análise de Impacto"

**Para tipo "saving":**
- IA recebe cargo, horas antes/depois e cálculos já preenchidos
- NÃO pergunta sobre valores em R$, cargo, tipo_saving — esses já foram definidos
- Foco: **validar/desafiar as horas** — pede detalhamento da rotina manual passo a passo
- Monta o memorial automaticamente (usuário não escreve)
- Regras anti-extrapolação: saving deve refletir ganho real

**Para tipo "receita_incremental":**
- IA coleta **valor_ganho_mensal** via conversa
- Desafia o valor com pedido de evidências concretas
- Monta memorial sobre argumentos de receita

Na aprovação do preview, fluxo marca como `completo`.

**9 campos (SavingColetado):**
1. `cargo` — Cargo selecionado pelo usuário (dropdown)
2. `horas_antes` — Horas/mês antes da automação
3. `horas_depois` — Horas/mês após a automação
4. `economia_horas_mes` — horas_antes - horas_depois (calculado)
5. `valor_hora` — Derivado do cargo via tabela CARGOS (não editável)
6. `economia_reais_mes` — economia_horas × valor_hora (calculado)
7. `tipo_saving` — "mensal" ou "pontual" (definido por botão)
8. `memorial_calculo` — Descrição detalhada da lógica (montado pela IA)
9. `valor_ganho_mensal` — Para receita incremental (coletado pela IA)

### Tabela de referência de cargos (`CARGOS` em `types.ts`)

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

- 4 system prompts (um por fase): `buildDocPrompt`, `buildDocPreviewPrompt`, `buildSavingPrompt` (bifurcado por tipoProjeto), `buildSavingPreviewPrompt`
- `runOrchestrator(ctx, history, fase, coletado, saving, resumoProjeto, tipoProjeto)` — entry point
- Respostas sempre em JSON: `{type, content/question, coletado/saving, options?}`
- Transições automáticas: preview em doc → `doc_preview`, complete em doc_preview → `saving`, complete em saving_preview → `completo`

### Server functions do chat (`chat.functions.ts`)

- `iniciarSubmissaoFn`: cria projeto (com `tipo_projeto`, `descricao_breve`, area, data), recebe **array `docs`** (até 5000), extrai texto de todos via `extractTextFromMultipleFiles`, roda o **extractor** para pré-preencher os 7 campos, então roda o orquestrador na fase `doc`
- `iniciarSavingFn`: recebe dados determinísticos (cargo, horas_antes, horas_depois, tipo_saving), calcula saving no backend via tabela `CARGOS`, inicia chat saving com contexto pré-preenchido
- `enviarMensagemFn`: recebe mensagem do usuário, detecta fase atual, filtra histórico (saving começa limpo), roda orquestrador com `tipoProjeto`
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
- Funções de negócio em arquivos `.functions.ts` dentro de `src/lib/` (chamadas pelo `worker.ts`; o frontend usa `apiFetch`). Funções que tocam o banco/`process.env` só rodam no servidor (importam de `integrations/db/client.server`)
- Formulários usam react-hook-form + zod para validação
- Toasts via sonner (`toast.success()`, `toast.error()`)
- Idioma da interface: **português brasileiro**
- **IMPORTANTE**: Todo texto visível ao usuário DEVE conter acentuação e pontuação corretas do português (á, é, í, ó, ú, ã, õ, ç, ê, â, etc). Nunca omitir acentos. Exemplos: "produção" (não "producao"), "área" (não "area"), "não" (não "nao"), "opção" (não "opcao")
- **Cursor/foco**: Todos os elementos não-editáveis têm `caret-color: transparent` (esconde o caret piscante), mas mantêm seleção de texto habilitada. Apenas `input`, `textarea` e `[contenteditable]` reativam o caret. Foco visível apenas via teclado (`:focus-visible`). Regras globais em `styles.css` na `@layer base` — não sobrescrever
- **Testes obrigatórios**: rodar `npm run test` após qualquer modificação. Testes rodam automaticamente antes de `npm run dev` via `predev`.
- `routeTree.gen.ts` é auto-gerado - não editar manualmente

## Variáveis de ambiente

Definidas em `.env` (não comitar chaves secretas). No deploy, são injetadas como variáveis do Worker (lidas via `process.env`).

### Runtime (server-only — lidos via `process.env` no `worker.ts` / funções `.server`)

- `DATABASE_PATH` — caminho do arquivo SQLite (default: `./godocs.db`)
- `GODEPLOY_USER_HEADER` — header com email do usuário autenticado pelo Godeploy edge (default: `x-godeploy-user-email`)
- `DEV_USER_EMAIL` — em dev, email usado quando não há header de auth
- `LLM_PROVIDER` — `openai` (default) ou `anthropic`
- `LLM_API_KEY` — chave da API do provider escolhido
- `LLM_MODEL` — modelo a usar (default: `gpt-4.1`)
- `GOOGLE_CHAT_WEBHOOK_URL` — webhook do Google Chat para notificações de novo projeto
- `OCR_WORKER_URL` — URL do Cloudflare Worker de extração de texto de PDFs
- `OCR_WORKER_TOKEN` — token Bearer de autenticação do OCR Worker
- `BREVO_API_KEY` / `EMAIL_FROM` — envio de e-mail via Brevo

## Deploy (Godeploy — SPA + Worker API)

- **Arquitetura**: SPA estática (`dist/`) + Cloudflare Worker (`src/worker.ts`) que serve `/api/*`
- **Build**: `npm run build` (Vite) gera a SPA estática em `dist/`
- **Worker**: o Godeploy serve os assets estáticos e invoca o `worker.ts` para `/api/*` e para recursos sem asset correspondente
- **process.env**: o Godeploy **não** expõe `process` global (sem `nodejs_compat`) — o `worker.ts` faz um polyfill de `process.env` no início do `fetch`, injetando as env vars do Worker
- **Dev**: `vite-plugin-dev-api.ts` serve `/api/*` localmente reusando o `worker.ts` via `ssrLoadModule`
- **Extração de PDF**: delegada ao Cloudflare OCR Worker externo (sem `pdf-parse` no bundle)
- **⚠️ Risco de runtime do SQLite**: `better-sqlite3` é binário nativo de Node — **não carrega em Cloudflare Workers/workerd** (nem com `nodejs_compat`). Funciona em dev (`npm run dev`, runtime Node) e em qualquer runtime Node real. Para deploy em Workers, migrar para **Cloudflare D1** ou **Turso (libsql)**. Detalhes e mapeamento em `PLANO_MIGRACAO_SQLITE.md`

## Status atual

- Home, formulário de submissão, CRUD de usuários e áreas estão funcionais
- **Arquitetura SPA**: migrada de SSR (TanStack Start) para SPA + Worker API; rotas admin leem via `/api/*` (sem client browser)
- **Backend SQLite**: migrado de Supabase para `better-sqlite3` (banco local, schema auto-criado); auth via header do Godeploy edge
- **Step 2 (upload)**: upload de codebase/pasta inteira com filtro de pastas de dev, gate de ~200k tokens e árvore de pastas colapsável
- **Agente Doc (fase 1)**: funcional — pré-extração lê o código e preenche os campos técnicos; chat pergunta só as regras de negócio; gera preview formatado, ciclo de aprovação
- **Agente Saving (fase 2)**: funcional — validação de horas com detalhamento obrigatório, monta memorial, ciclo de aprovação
- **Transição doc → saving**: tela animada com check verde e progress bar
- **Tela de revisão final**: cards colapsáveis com previews aprovados antes do envio
- **Submissão interna**: dados salvos no SQLite (sem Sheets), duplicata verificada, auto-aprovação para RPA, notificação Google Chat
- **Testes**: rodam antes de cada `npm run dev` via `predev`
- Design usa identidade visual GoGroup (--go-blue, --go-lime, --go-cream, Poppins)

## Notas importantes

- Projeto originado do Lovable (gerado por IA) - pode conter código que precisa de refatoração
- A arquitetura saiu de SSR (TanStack Start + Nitro/Cloudflare) para **SPA + Worker API** (`src/worker.ts`). Não há mais `server.ts`/`start.ts`, Nitro nem `@lovable.dev/vite-tanstack-config` — o `vite.config.ts` usa `@vitejs/plugin-react` + `TanStackRouterVite` + `devApiPlugin`
- `routeTree.gen.ts` é auto-gerado — não editar manualmente
- O antigo fluxo n8n → Google Sheets foi substituído por submissão interna via SQLite. O arquivo `forms_submissao_logica.json` contém o fluxo n8n legado para referência
