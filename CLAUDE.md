# GoDocs - Hub de Projetos Internos

Hub interno do Gogroup para cadastro, gestão e documentação de projetos de automação (RPA & IA). Funcionários submetem projetos, líderes acompanham o status das submissões de suas áreas, e Admin Masters gerenciam toda a plataforma. O fluxo de submissão (documentação + memorial de impacto financeiro) salva no SQLite local e, ao enviar para triagem, também envia os dados para o n8n via webhook (`N8N_WEBHOOK_URL`) para registro em planilha/Google Drive.

## Stack

- **Arquitetura**: **SPA** (Single Page Application) — React puro no cliente + API em `/api/*` servida por um Cloudflare Worker (`src/worker.ts`). Migrado de TanStack Start (SSR) para SPA (PR #24/#25).
- **Framework**: TanStack Router (file-based routing) rodando como SPA (sem SSR)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui (new-york style), Lucide icons
- **Forms**: react-hook-form + zod
- **Backend / banco**: SQLite acessado por uma interface única `GoDeployDB` (`integrations/db/db-adapter.ts`). Em **produção** é o `env.DB` do Godeploy (SQLite gerenciado, **assíncrono**); em **dev** é um wrapper `better-sqlite3` que implementa a mesma interface (banco local `godocs.db`, auto-criado). Auth via header do Godeploy edge (Google OAuth)
- **API**: funções de negócio em `*.functions.ts` chamadas pelo `src/worker.ts` (roteador `/api/*`); o frontend chama via `apiFetch` (`src/lib/api-client.ts`). Em dev, o `vite-plugin-dev-api.ts` serve as rotas `/api/*` reusando o `worker.ts` via `ssrLoadModule`
- **LLM**: Camada de abstração (`llm.ts`) que suporta OpenAI e Anthropic via env vars
- **Extração de texto**: Cloudflare OCR Worker (PDF), mammoth (DOCX/DOC), utf-8 direto (TXT/MD/JSON/código)
- **Testes**: Vitest (roda automaticamente antes de `npm run dev`)
- **Build**: Vite 7, npm (package manager); SPA estática em `dist/` (`vite build`) + bundle do Worker em `worker.js` (`esbuild`, **commitado no git**)
- **Deploy**: Godeploy (SPA + Worker API + datasource `env.DB`)
- **Linguagem**: TypeScript strict

## Comandos

```bash
npm install            # instalar dependências
npm run dev            # roda testes + dev server (vite dev)
npm run test           # roda testes uma vez
npm run test:watch     # testes em modo watch
npm run build          # build produção (SPA estática em dist/)
npm run build:dev      # build em modo development
npm run build:worker   # bundle do Worker (esbuild src/worker.ts → worker.js) — REBUILDAR ao mexer no backend
npm run preview        # preview do build (vite)
npm run lint           # eslint
npm run format         # prettier
```

⚠️ **`worker.js` é um artefato commitado no git**, gerado por `npm run build:worker`. Sempre que mexer no `src/worker.ts` ou em qualquer código de servidor que ele empacota, **rode `npm run build:worker` e comite o `worker.js` atualizado** — senão o backend rodando no Godeploy fica defasado do source (sintoma clássico: "puxei o código e não vejo a mudança"). O `dist/` (frontend) é gitignored e (re)buildado no deploy.

## Testes

- **Framework**: Vitest
- **Config**: `vitest.config.ts` (alias `@/` → `./src/*`, ambiente node)
- **Diretório**: `tests/`
- **Execução obrigatória**: `predev` script garante que testes rodam antes de cada `npm run dev`
- **A cada modificação no código**: rodar `npm run test` para verificar que nada quebrou

### Arquivos de teste

| Arquivo | Cobertura |
|---|---|
| `agents-types.test.ts` | Factories, tipos do orquestrador, ProjetoContexto, SavingColetado/ReceitaColetada |
| `orchestrator-prompts.test.ts` | System prompts por fase, regras de validação de horas, transições automáticas (doc → saving/receita → completo) |
| `extractor.test.ts` | Pré-extração: preenchimento dos 7 campos a partir do conteúdo dos arquivos |
| `extract-text.test.ts` | Extração de texto por tipo de arquivo + concatenação multi-arquivo + truncamento |
| `form-validation.test.ts` | E-mail (domínios permitidos), arquivo (extensões/tamanho), nome, data, saving |
| `submission-flow.test.ts` | Auto-aprovação por área, extração de saving do JSON, notificação Google Chat, verificação de duplicata |
| `areas-teamguide.test.ts` | Derivação de áreas a partir da árvore TeamGuide (regra de passthrough v3, dedup por slug) |
| `db-async.test.ts` | Camada de banco assíncrona sobre a interface `GoDeployDB` (compatibilidade dev/prod) |
| `llm.test.ts` | Erros de configuração, provider desconhecido, defaults |
| `doc-compiler.test.ts` | Compilação da documentação (doc-compiler): merge de saving/receita, campos obrigatórios, resiliência a falhas do LLM |
| `routes.test.ts` | Existência de rotas, arquivos de agentes, infra (`integrations/db/`), schema SQLite e tipos, ausência do Supabase |

## Estrutura do projeto

```
src/
  routes/              # File-based routing (TanStack Router)
    __root.tsx         # Root layout (QueryClientProvider, Toaster, head meta)
    index.tsx          # Home pública - 3 cards de ação (Submeter, Editar, Reenviar)
    auth.tsx           # Redireciona para /dashboard (auth é via Godeploy edge)
    submeter.tsx       # Formulário multi-step (3 etapas) + chat IA; navegação livre entre steps sem perda de estado
    _authenticated/    # Layout guard - beforeLoad chama /api/auth/me; redireciona p/ / se não admin
      route.tsx        # Sidebar layout + guard de admin (via /api/auth/me)
      dashboard.tsx    # Dashboard de projetos submetidos (lê via /api/admin/projetos)
      usuarios.tsx     # CRUD de usuários (admin only) - lê via /api/admin/usuarios
      areas.tsx        # CRUD de áreas + botão "Sincronizar áreas" (admin only) - via /api/admin/areas
      investigador.tsx # Painel de monitoramento em tempo real — projetos ativos, chat, logs de API, métricas
  integrations/db/
    db-adapter.ts      # Interface GoDeployDB (query/exec async) — compatível com env.DB (prod) e better-sqlite3 (dev)
    client.server.ts   # Client do banco sobre GoDeployDB + funções de acesso (server-only, totalmente async)
    schema.ts          # Criação das tabelas SQLite (auto-init na primeira execução)
    types.ts           # Tipos TypeScript do schema (Projeto, Area, ProjetoStatus, etc.)
  lib/
    agents/            # Sistema de agentes IA
      types.ts         # Tipos: ChatFase, DocumentacaoColetada, SavingColetado, ReceitaColetada, OrchestratorResult, ProjetoContexto, CARGOS
      extractor.ts     # 1 chamada (temp 0) que lê o material enviado (código ou docs) → pré-preenche os 7 campos
      orchestrator.ts  # Orquestrador do chat — prompts por fase, transições automáticas
      doc-compiler.ts  # Compila campos coletados em DocumentacaoGerada (JSON estruturado)
      analyzer.ts      # Agente analisador pré-submissão — 10 critérios fixos + dinâmicos, complexidade, parecer
      validator.ts     # Validação automática de documentação (6 critérios)
      email-agent.ts   # Templates de email de aprovação/rejeição
    submeter/          # UI do formulário /submeter (steps + componentes)
      constants.ts     # FormData, AREAS (fallback), extensões aceitas, MAX_FILE_MB, TOKEN_* (gate), readFileAsBase64, AnaliseResult
      step1.tsx        # Step 1 (Envio): escopo, status, responsável, área (via /api/areas), ferramenta, equipe
      step2.tsx        # Step 2 (Projeto): tipo(s), nome, data, contexto + upload multi-arquivo (árvore)
      step3-chat.tsx   # Step 3 (Agente): chat IA, SavingForm/ReceitaForm, previews, revisão final
      analyzer-overlay.tsx # Card de análise pré-submissão (loading animado, header com veredito, parecer em texto)
      form-components.tsx # Inputs, RadioGroup, InfoTooltip (via portal), ChipsInput
      layout.tsx       # PageFrame, WizardProgress (steps clicáveis), StepAnimation
    areas/
      teamguide.server.ts # Deriva áreas da árvore TeamGuide (fonte única; regra passthrough v3, dedup por slug) — server-only
    chat.functions.ts  # Funções do chat: iniciarSubmissao, iniciarSaving, iniciarReceita, enviarMensagem, atualizarTipos, submeterParaValidacao
    investigador.functions.ts # Funções do painel Investigador: getProjetosInvestigador, getProjetoInvestigadorDetalhes, getInvestigadorStats
    areas.functions.ts # getAreasPublicas (tabela areas + fallback hardcoded AREAS) e sincronizarAreas (upsert das derivadas)
    admin.functions.ts # Funções admin: áreas, admins, projetos, usuários (createUser/deleteUser/updateUserAreas/getUsuarios), configurações
    auth.functions.ts  # getCurrentUser (lê email do header Godeploy → consulta tabela admins)
    projeto.functions.ts # Funções auxiliares de projeto/chat (CRUD via db)
    api-client.ts      # apiFetch — helper do frontend para chamar /api/*
    extract-text.server.ts  # Extração de texto: PDF/DOCX/DOC/TXT/MD/JSON + código; multi-arquivo (server-only)
    config.server.ts   # Leitura tipada de config/env (server-only)
    llm.ts             # Camada de abstração LLM (OpenAI / Anthropic)
    utils.ts           # cn() helper (clsx + tailwind-merge)
  router.tsx           # Configuração do TanStack Router + QueryClient
  worker.ts            # Entry do Cloudflare Worker — roteia /api/*, injeta env.DB (setDb), polyfill process.env; fallback SPA
  main.tsx             # Entry do cliente (monta a SPA React)
  styles.css           # Tokens CSS (light/dark), Tailwind config
vite-plugin-dev-api.ts # Plugin Vite que serve /api/* em dev reusando o worker.ts (com wrapper better-sqlite3 → GoDeployDB)
worker.js              # Bundle do Worker (esbuild), COMMITADO — rebuildar via npm run build:worker ao mexer no backend
tests/                 # Testes unitários (Vitest)
forms_n8n/             # Workflows n8n (submit_forms.json + fluxos legados)
PLANO_MIGRACAO_SQLITE.md # Histórico da migração Supabase → SQLite (o risco de runtime foi resolvido pelo env.DB do Godeploy)
godocs.db              # Banco SQLite local de dev (auto-criado, ignorado no git)
```

## Banco de dados (SQLite via interface `GoDeployDB`)

### Acesso ao banco

Toda a camada (`client.server.ts`) é **assíncrona** e fala com a interface `GoDeployDB` (`db-adapter.ts`):

- **Produção**: `env.DB` do Godeploy — SQLite gerenciado, `query`/`exec` retornam `Promise` e **exigem o argumento de params sempre** (mesmo `[]`). O `worker.ts` injeta `env.DB` via `setDb()` no início de cada request (que também roda `initSchema()` uma vez por isolate).
- **Dev**: wrapper `better-sqlite3` (em `vite-plugin-dev-api.ts`) que implementa a mesma interface. É síncrono, mas `await` sobre valor síncrono é no-op — o mesmo código roda em dev e prod.

O schema é criado automaticamente por `initSchema()` em `schema.ts`. IDs default das tabelas são hex de 32 chars (`lower(hex(randomblob(16)))`) — **não são UUID**; IDs gerados na aplicação usam `crypto.getRandomValues`. Colunas JSON (`membros`, `tipos_projeto`, `options`, `conteudo`, `criterios`, `valor`) são TEXT parseadas via `parseJson()`. Booleanos viram INTEGER 0/1.

### Tabelas

| Tabela | Descrição |
|---|---|
| `admins` | id, email (UNIQUE), nome — controla quem tem acesso admin |
| `profiles` | id, nome, email |
| `user_roles` | user_id, role (admin_master, leader) |
| `areas` | id, nome (departamentos da empresa; populada via sync TeamGuide) |
| `leader_areas` | user_id, area_id (N:N - quais áreas um leader acompanha) |
| `projetos` | id, nome, responsavel_nome, responsavel_email, area, area_id, ferramenta, escopo, servico_externo, membros (JSON), status, chat_completo, data_criacao_projeto, **tipo_projeto**, **tipos_projeto** (JSON), **descricao_breve**, saving_horas, saving_reais, tipo_saving, memorial_calculo, custo_externo_mensal, **complexidade** (automacao\|inteligencia\|autonomia), **observacoes** (parecer da análise — staff-only), submitted_at, validated_at, validated_by |
| `chat_messages` | id, projeto_id, role (user/assistant/doc), content, options (JSON), selected_option |
| `documentacao` | projeto_id (UNIQUE), conteudo (JSON — DocumentacaoGerada + saving/receita) |
| `validacoes` | projeto_id, resultado, parecer, criterios (JSON), admin_email, email_enviado |
| `analises` | id, projeto_id, resultado (aprovado\|rejeitado), pontuacao_total, pontuacao_maxima, justificativa, resumo, criterios_hardcoded (JSON), criterios_dinamicos (JSON), created_at |
| `configuracoes` | chave (UNIQUE), valor (JSON), descrição — config dinâmica (ex: critérios de validação) |
| `api_logs` | id, projeto_id (FK), endpoint, method, duration_ms, status_code, error, request_size, response_size, created_at — log de cada chamada `/api/chat/*` para o Investigador; limpeza automática >30 dias no cron |

### Status (CHECK na coluna `projetos.status`)

```
rascunho → em_validacao → validado | rejeitado
                        → aprovado (auto, quando área = RPA)
```

### Segurança

- Sem RLS (SQLite não tem) — o controle de acesso é feito no `src/worker.ts` (`requireAdmin`) e nos middlewares de auth das funções
- Auth via header do Godeploy edge (Google OAuth), nome do header em `GODEPLOY_USER_HEADER` (default `x-godeploy-user-email`)
- A tabela `admins` define quem é admin (`getCurrentUser` / `requireAdmin` consultam por email)
- `createUser` apenas cria `profiles` + `user_roles` (+ `leader_areas`); não há credenciais locais — a senha do formulário é ignorada
- O endpoint `/api/cron/sync-areas` exige o header `X-Godeploy-Cron`

## Rotas (páginas)

| Rota | Acesso | Descrição |
|---|---|---|
| `/` | Público | Home com 3 cards de ação |
| `/submeter` | Público | Formulário 3 etapas + chat IA (doc + impacto: saving/receita) |
| `/auth` | Público | Redireciona para `/dashboard` (auth via Godeploy edge) |
| `/dashboard` | Autenticado (admin/leader) | Dashboard de projetos |
| `/usuarios` | Admin Master | CRUD de usuários |
| `/areas` | Admin Master | CRUD de áreas + sincronização TeamGuide |
| `/investigador` | Admin Master | Painel de monitoramento em tempo real — projetos sendo preenchidos, histórico de chat (com markdown renderizado), logs de API (duração, erros, tamanho), métricas de performance; polling a cada 8s; detecção de atividade via último log de API (<5min) |
| `/testes` | Admin Master | Console de testes e simulação (sub-rotas abaixo) |
| `/testes/prompts` | Admin Master | Inspetor de prompts da IA — exibe todos os system prompts dos agentes com syntax highlight, parâmetros LLM e contagem de tokens |
| `/testes/cenarios` | Admin Master | Simulador de cenários — chat de teste com inspetor de estado e log de chamadas API |

### Endpoints de API (`/api/*`, roteados pelo `worker.ts`)

- **Auth**: `GET /api/auth/me`
- **Chat**: `POST /api/chat/iniciar-submissao`, `/iniciar-saving`, `/iniciar-receita`, `/enviar-mensagem`, `/atualizar-tipos`, `/atualizar-metadados`, `/analisar`, `/submeter-validacao` — todas logadas automaticamente na tabela `api_logs` (duração, status, erro, tamanho req/res)
- **Áreas**: `GET /api/areas` (público), `POST /api/admin/areas/sync` (admin), `POST /api/cron/sync-areas` (cron + limpeza de api_logs >30 dias)
- **Admin**: `/api/admin/projetos`, `/usuarios`, `/users` (+ delete/update-areas), `/admins` (+ remove), `/areas` (+ remove), `/configuracoes`, `/validar-projeto`
- **Investigador**: `GET /api/admin/investigador/projetos` (lista enriquecida com fase, métricas, último log), `/projetos/:id` (detalhes + chat + logs), `/stats` (métricas globais de API)

## Fluxo de submissão (3 etapas + chat IA)

Navegação **livre** entre os 3 steps: o `WizardProgress` permite voltar/avançar para steps já concluídos (`completedSteps`) sem perder o progresso do chat.

1. **Envio**: escopo (interno/externo), status produção (bloqueia se não em produção/uso), nome, email (apenas @gocase, @gobeaute, @gogroup), área (carregada de `/api/areas`), ferramenta, equipe/participantes
2. **Projeto**: tipo(s) — **multi-select** saving e/ou receita_incremental — nome, data criação, **contexto de negócio** (descrição obrigatória) e **upload de arquivos/pasta** (ver abaixo)
3. **Agente IA**: chat interativo (ver abaixo). Submissão só disponível após os previews aprovados. Tela de revisão final com previews colapsáveis antes do envio.

### Troca de tipo no meio do fluxo

O usuário pode voltar à etapa 2 com o agente já iniciado, trocar o(s) tipo(s) e clicar **"Continuar com Agente"** (`handleContinuarAgente` em `submeter.tsx`):

- Detecta se `tipoProjeto` mudou em relação ao tipo com que o agente está alinhado (`agentTipos`)
- Persiste a mudança via `POST /api/chat/atualizar-tipos` (`atualizarTipos` grava `tipos_projeto`/`tipo_projeto` no banco)
- Se a **documentação já foi concluída**, a fase de impacto **recomeça** no tipo certo (limpa chat/previews, reseta `chatFase` para `saving` ou `receita`)
- Se ainda está na **fase de doc**, o próprio orquestrador roteia para a fase certa ao aprovar a doc (lê `tipos_projeto` fresco do banco)
- Bloqueia avançar sem nenhum tipo selecionado

### Upload de arquivos (Step 2 — `step2.tsx`)

A IA lê a **codebase/pasta inteira** e gera a documentação automaticamente. Lógica de seleção:

- **Múltiplos arquivos ou pasta inteira** (`webkitdirectory`, recursivo) + drag-and-drop
- **Extensões**: docs (PDF, DOCX, DOC, TXT, MD) e código (`.json .ts .tsx .js .jsx .py .sql .sh .yaml .yml .toml .css .html`)
- **Filtro automático** (estilo `.gitignore`, por segmento do caminho): ignora `node_modules`, `.git`, `dist`, `build`, `.output`, `.wrangler`, `.vercel`, `.next`, `.venv`, `__pycache__`, `vendor`, `target` etc. + lock files, `*.min.js/css`, `*.map`. **Sem limite de contagem** (cap de segurança 5000)
- **Gate por tokens** (~4 chars/token): WARN ~150k tokens (600k chars), **BLOCK ~200k tokens (800k chars)** → painel com prompt para gerar pré-documentação no Claude.ai. A trava também roda no submit (`handleIniciarAgente`)
- **Estimativa por tamanho** (sem ler conteúdo no browser → instantâneo); chars exatos só no backend pós-extração
- **Árvore de pastas colapsável** (`FileTreeNode`): hierarquia original, agregado por pasta, expandir/recolher, remover arquivo/pasta. Identidade por **caminho completo** (`webkitRelativePath`)
- **Loading** mostrado já no clique do botão (cobre a enumeração lenta do browser); evento `cancel` limpa o estado

### Submissão final (`submeterParaValidacao`)

Quando o usuário clica "Enviar para Triagem":

1. Verifica duplicata (mesmo nome de projeto já submetido)
2. Extrai impacto do JSON da documentação e popula colunas do `projetos` (saving_horas, saving_reais, tipo_saving, memorial_calculo, custo_externo_mensal). O `memorial_calculo` (e o `receita_memorial` enviado ao n8n) passa por `stripMarkdown` (`src/lib/strip-markdown.ts`) na fronteira de persistência — remove `**`, `#`, backticks, etc. mantendo as quebras de linha; o markdown cru continua em `documentacao.conteudo` (preview do chat)
3. Auto-aprovação: se área = "RPA", status = `aprovado`; senão `em_validacao`
4. Envia notificação para Google Chat (webhook via env var `GOOGLE_CHAT_WEBHOOK_URL`)
5. Envia dados completos (projeto + documentação + saving) para n8n via `N8N_WEBHOOK_URL` — o workflow n8n gera Markdown, sobe ao Drive, salva na planilha

## Sistema de agentes IA (chat por fases)

### Máquina de estados (ChatFase)

```
doc → doc_preview → [transição animada 3s] → saving   → saving_preview   ┐
                                           → receita  → receita_preview  ┴→ completo
```

- Projetos **só saving** ou **só receita** vão direto para a fase correspondente após a doc.
- Projetos com **ambos os tipos** executam saving → receita em sequência (a transição saving_preview → receita também passa pela tela animada), gerando documentação unificada.
- O roteamento `doc_preview → saving|receita` e `saving_preview → receita|completo` é decidido pelo orquestrador lendo `tipos_projeto` do banco.

### Fase 1 — Documentação técnica

- Cor do chat: azul (--go-blue) · Header: "Documentação Técnica"
- **Pré-extração** (`extractor.ts`): antes do chat, 1 chamada ao LLM (temp 0) lê o material enviado (código-fonte ou documentação prévia — ambos aceitos sem questionamento) e preenche os 7 campos. Campos **técnicos** (execução, dependências, fluxo, configurar_antes) saem do material; campos de **negócio** (o_que_faz, atenção) ficam null se não revelados
- O chat **só pergunta o que ficou null** — não reconfirma o que já foi extraído
- Se o extractor preencheu todos os 7, o orquestrador gera o **preview direto** (zero perguntas) com uma nota convidando o usuário a pedir ajustes caso precise complementar algo — o ciclo de revisão do `doc_preview` cuida disso
- 1 pergunta por vez, cética (não aceita respostas vagas — mantém null e aprofunda)
- Na aprovação, IA gera resumo interno do projeto (3-5 frases) para contexto da fase 2

**7 campos coletados (DocumentacaoColetada):** `nome_projeto`, `o_que_faz`, `execucao`, `dependencias`, `fluxo`, `configurar_antes`, `atencao`.

### Transição doc → impacto

- Tela animada (3s): check verde, "Documentação aprovada!", mini progress bar (Doc ✓ → Impacto), loading dots
- Chat limpa completamente
- Após transição: **formulário determinístico** (`SavingForm` ou `ReceitaForm`) aparece antes do chat

### Formulário determinístico (SavingForm / ReceitaForm)

**Para saving (`SavingForm`):**
- **Multi-linha** — uma linha por pessoa/cargo que executava a tarefa (`linhas: SavingLinha[]`). Cada linha: cargo (dropdown dos 6 cargos), horas/mês antes, horas/mês depois
- Mensal / Pontual (toggle); se escopo externo, custo externo (abatido no líquido)
- Validação **relaxada**: aceita horas `>= 0` (inclusive 0 antes); o ganho líquido é clampado no backend (`Math.max(0, antes - depois)`)
- O **cálculo em R$ NUNCA é exibido ao usuário** (taxa R$/h, economia por linha, total) — é métrica de gestão e expô-la induz manipulação; o cálculo roda no backend
- Botão "Iniciar análise"

**Para receita_incremental (`ReceitaForm`):**
- Apenas Mensal / Pontual toggle + botão "Iniciar análise"

`iniciarSaving` recebe `linhas` (cargo + horas), calcula `valor_hora` por cargo via `CARGOS`, totais e líquido; `iniciarReceita` inicia a fase receita. Ambos iniciam o chat com o contexto pré-preenchido.

### Fase 2 — Análise de Impacto

- Cor do chat: lima (--go-lime) · Header: "Análise de Impacto"

**Saving:** IA recebe linhas, horas e cálculos prontos; NÃO pergunta valores em R$/cargo/tipo_saving; foco em **validar/desafiar as horas** (detalhamento passo a passo da rotina manual); monta o memorial automaticamente; regras anti-extrapolação.

**Receita incremental:** IA coleta `valor_ganho_mensal` via conversa, desafia o valor pedindo evidências concretas, monta o memorial sobre os argumentos de receita.

Na aprovação do último preview, o fluxo marca como `completo`.

**Campos coletados:**
- `SavingColetado`: `linhas` (SavingLinha[]: cargo, horas_antes, horas_depois, valor_hora, economia_horas_mes, economia_reais_mes), `economia_horas_mes` (total), `economia_reais_mes` (total líquido), `tipo_saving`, `memorial_calculo`, `valor_ganho_mensal`
- `ReceitaColetada`: `tipo_saving`, `valor_ganho_mensal`, `memorial_calculo`

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

Quando os previews são aprovados (`fase = completo`): cards colapsáveis ("Documentação Técnica", "Memorial de Cálculo" e/ou "Memorial de Receita", com badge "Aprovado") + botão "Enviar para Triagem".

### Análise automática pré-submissão (`analyzer.ts` + `analyzer-overlay.tsx`)

Quando o usuário clica "Enviar para Triagem", a submissão e a análise IA rodam em paralelo:

1. A submissão (`submeterParaValidacao`) é enviada primeiro — se falhar, não mostra a tela de sucesso
2. A tela de sucesso aparece imediatamente com o card de análise em estado de **loading** (frases animadas de terminal)
3. A análise IA (`analisarProjetoFn` → `analisarProjeto` em `analyzer.ts`) roda em background
4. O botão "Submeter outro projeto" fica **desabilitado** (cinza, texto "Aguardando análise...") até a análise concluir
5. **`beforeunload`** impede saída acidental da página durante a análise

**Agente analisador** (`analyzer.ts`):
- 10 critérios fixos (propósito, trigger, dependências, fluxo, config, riscos, saving, ferramenta, descrição, completude) + 2-3 dinâmicos por projeto
- Classifica complexidade: `automacao` | `inteligencia` | `autonomia`
- Gera parecer em texto (`resumo`) + justificativa completa em markdown
- Resultado salvo na tabela `analises`; complexidade salva no `projetos`; o **parecer** (`resumo`, sem markdown) é salvo na coluna `projetos.observacoes` e enviado ao n8n via `N8N_WEBHOOK_URL_UPDATE` (coluna "Observações" do Sheets)
- O LLM avalia todos os critérios internamente mas retorna apenas os mais relevantes no JSON (max 8)

**Card de análise** (`analyzer-overlay.tsx`):
- Loading: spinner + frases rotativas estilo terminal
- Resultado: **confirmação neutra** ("Análise concluída") — o parecer/pontos de atenção **NÃO é mais exibido ao usuário** (é mensagem de staff que gerava ansiedade; vive na coluna `observacoes`/Sheets). O card só serve para segurar a página (`beforeunload` + botão desabilitado) até a análise concluir e persistir as observações
- Sem exibição de critérios, pontuação, veredito ou parecer ao usuário

### Orquestrador (`orchestrator.ts`)

- 6 system prompts (um por fase): `buildDocPrompt`, `buildDocPreviewPrompt`, `buildSavingPrompt`, `buildSavingPreviewPrompt`, `buildReceitaPrompt`, `buildReceitaPreviewPrompt`
- `runOrchestrator(ctx, history, fase, coletado, saving, resumoProjeto, tipos_projeto, receita)` — entry point; `tipos_projeto` é um **array** (`('saving' | 'receita_incremental')[]`)
- Respostas sempre em JSON: `{type, content/question, coletado/saving/receita, options?}` — fallback robusto p/ JSON truncado; retry automático em resposta vazia do LLM
- **Regras de prompt**: a IA nunca expõe nomes de campos internos ao usuário; linguagem natural de conversa entre colegas; prompts de saving adaptados à frequência (pontual vs mensal) e a quem executava antes (suporte a `horas_antes=0` — ninguém antes — e custo adicional); na receita, desafia o `valor_ganho_mensal` e o racional informados
- Transições automáticas: `preview` em doc → `doc_preview`; `complete` em doc_preview → `saving` (se `hasSaving`) senão `receita`; `complete` em saving_preview → `receita` (se `hasReceita`) senão `completo`; `complete` em receita_preview → `completo`
- **Modelo**: quando `LLM_MODEL_FAST` está setado, os turnos de conversa do orquestrador usam o modelo rápido; doc-compiler e extractor seguem no `LLM_MODEL` forte

### Server functions do chat (`chat.functions.ts`)

- `iniciarSubmissao`: cria projeto (com `tipos_projeto`, `descricao_breve`, area, data), recebe **array `docs`** (até 5000), extrai texto via `extractTextFromMultipleFiles`, roda o **extractor** e então o orquestrador na fase `doc`
- `iniciarSaving`: recebe `linhas` (cargo + horas) + tipo_saving + custo externo; calcula totais/líquido no backend via `CARGOS`; inicia o chat saving
- `iniciarReceita`: inicia a fase receita após a doc (ou após o saving, no fluxo de ambos os tipos); recebe `valor_ganho_mensal` + `racional` pré-preenchidos para o agente desafiar
- `enviarMensagem`: detecta fase atual, filtra histórico por fase, **relê `tipos_projeto` do banco**, roda o orquestrador; compila a doc na transição doc→impacto e salva dados financeiros no `completo`
- `atualizarTipos`: persiste a troca de tipo feita na etapa 2 durante o fluxo do agente
- `atualizarMetadados`: persiste edições de metadado feitas após o agente iniciar (descrição, nome, área, ferramenta, data, membros); se os **arquivos** mudarem, re-extrai o texto, re-roda o extractor e **reinicia a doc**
- `analisarProjetoFn`: dispara o agente analisador (`analyzer.ts`) para um projeto, persiste o resultado na tabela `analises` e a complexidade no projeto
- `submeterParaValidacao`: verifica duplicata, popula colunas de impacto, auto-aprova se RPA, notifica Google Chat e envia os dados completos ao n8n (`N8N_WEBHOOK_URL`)

### Extração de texto (`extract-text.server.ts`)

- PDF: Cloudflare OCR Worker (`OCR_WORKER_URL` + `OCR_WORKER_TOKEN`)
- DOCX/DOC: `mammoth` (extractRawText) · TXT/MD/JSON/código: leitura direta utf-8
- `extractTextFromMultipleFiles`: extrai e concatena vários arquivos com separadores `=== caminho ===`; loga eficiência (chars/tokens por arquivo e extensão)
- Truncamento: **150k chars por arquivo**, **800k chars no total** (~200k tokens)
- Sem `Buffer` do Node (quebrava no workerd) — usa APIs web-padrão

### LLM (`llm.ts`)

- Provider via `LLM_PROVIDER` (openai | anthropic) · modelo via `LLM_MODEL` (default: gpt-4.1) · modelo rápido opcional via `LLM_MODEL_FAST`
- JSON mode habilitado; `temperature` adaptada a modelos que só aceitam o default; usa `max_completion_tokens` (gpt-5+); o `model` resolvido sempre vence o spread de opts (evita `model: undefined`)

### Componentes de UI do chat

- **SimpleMarkdown**: renderizador leve (headings com dot colorido, listas, bold, parágrafos)
- **PreviewPanel**: card estilo documento, scroll interno, botões Aprovar (lima) / Pedir Alteração
- **CollapsiblePreviewCard / FinalReview**: revisão final com cards colapsáveis + botão de envio
- Cores por fase: azul (doc) → lima (impacto) em bubbles, borders, backgrounds

## Áreas via TeamGuide (fonte única)

As áreas/departamentos são derivadas da árvore organizacional do **TeamGuide** (não mais cadastradas só à mão):

- `areas/teamguide.server.ts`: deriva a lista canônica de áreas da árvore TeamGuide. Os 3 domínios-raiz são achados pelo **nome do líder** (não pelo id, que muda ao recriar times); filhos diretos da raiz (L1) são áreas, exceto 4 nós "passthrough" (cujos filhos L2 viram área) e as **outras raízes de domínio aninhadas** (N1/diretoria — não são área). Dedup por slug. Resultado: **20 áreas**. Exige `TG_API_TOKEN`
- `areas.functions.ts`: `getAreasPublicas()` lê a tabela `areas` e cai na lista hardcoded `AREAS` (em `constants.ts`) como fallback — o formulário nunca fica sem opções; `sincronizarAreas()` faz upsert das áreas derivadas
- Rotas: `GET /api/areas` (público, consumido pelo Step 1), `POST /api/admin/areas/sync` (admin, botão "Sincronizar áreas"), `POST /api/cron/sync-areas` (cron diário no Godeploy, exige header `X-Godeploy-Cron`)

## Roles e permissões

- **Admin Master**: acesso total - gerencia usuários, áreas, vê todos os projetos
- **Leader**: vê projetos das áreas que lidera, sem acesso a gestão de usuários/áreas
- Usuários sem role veem tela de "Sem permissão"

## Convenções

- Path alias: `@/*` -> `./src/*`
- Componentes UI ficam em `src/components/ui/` (shadcn, não editar diretamente)
- Funções de negócio em arquivos `.functions.ts` dentro de `src/lib/` (chamadas pelo `worker.ts`; o frontend usa `apiFetch`). Funções que tocam o banco/`process.env` só rodam no servidor (importam de `integrations/db/client.server` ou são `.server.ts`)
- A camada de banco é **async** — sempre `await` e sempre passar params (mesmo `[]`)
- Formulários usam react-hook-form + zod para validação
- Toasts via sonner (`toast.success()`, `toast.error()`)
- Idioma da interface: **português brasileiro**
- **IMPORTANTE**: Todo texto visível ao usuário DEVE conter acentuação e pontuação corretas do português (á, é, í, ó, ú, ã, õ, ç, ê, â, etc). Nunca omitir acentos. Exemplos: "produção" (não "producao"), "área" (não "area"), "não" (não "nao"), "opção" (não "opcao")
- **Cursor/foco**: elementos não-editáveis têm `caret-color: transparent` (esconde o caret), mantendo seleção de texto. Apenas `input`, `textarea` e `[contenteditable]` reativam o caret. Foco visível só via teclado (`:focus-visible`). Regras globais em `styles.css` na `@layer base` — não sobrescrever
- **Testes obrigatórios**: rodar `npm run test` após qualquer modificação (rodam também antes de cada `npm run dev` via `predev`)
- **Backend alterado → rebuildar o bundle**: `npm run build:worker` e comitar o `worker.js` atualizado
- **Prompts da IA alterados → atualizar o inspetor de prompts**: ao editar qualquer system prompt dos agentes (`orchestrator.ts`, `extractor.ts`, `doc-compiler.ts`, `analyzer.ts`, `validator.ts`), verificar se o **registro de prompts** (`src/lib/testes/prompt-registry.ts`) e o **inspetor** (`src/lib/testes/prompt-inspector.tsx`) refletem a mudança — incluindo descrições, parâmetros LLM, dados mock de contexto e contagem de prompts registrados. A página `/testes/prompts` é a referência da equipe para entender o que a IA recebe
- `routeTree.gen.ts` é auto-gerado — não editar manualmente

## Variáveis de ambiente

Definidas em `.env` (não comitar chaves secretas). No deploy, são injetadas como variáveis do Worker (lidas via `process.env`, com polyfill no `worker.ts`). O banco de produção vem como **binding `env.DB`** (datasource do Godeploy), não como env var.

### Runtime (server-only)

- `DATABASE_PATH` — caminho do SQLite **em dev** (default: `./godocs.db`); em prod usa-se o binding `env.DB`
- `GODEPLOY_USER_HEADER` — header com email do usuário autenticado pelo Godeploy edge (default: `x-godeploy-user-email`)
- `DEV_USER_EMAIL` — em dev, email usado quando não há header de auth
- `LLM_PROVIDER` — `openai` (default) ou `anthropic`
- `LLM_API_KEY` — chave da API do provider escolhido
- `LLM_MODEL` — modelo a usar (default: `gpt-4.1`)
- `LLM_MODEL_FAST` — (opcional) modelo mais rápido/barato para os turnos de conversa do orquestrador (perguntas/preview). Se ausente, usa `LLM_MODEL`. A compilação da doc (`doc-compiler`) e a pré-extração (`extractor`) sempre usam o `LLM_MODEL` forte.
- `GOOGLE_CHAT_WEBHOOK_URL` — webhook do Google Chat para notificações de novo projeto
- `N8N_WEBHOOK_URL` — webhook do n8n para registrar submissões (gera Markdown, sobe ao Drive, salva na planilha)
- `OCR_WORKER_URL` / `OCR_WORKER_TOKEN` — Cloudflare OCR Worker (extração de PDF)
- `TG_API_TOKEN` — token da API do TeamGuide (derivação/sync de áreas)
- `BREVO_API_KEY` / `EMAIL_FROM` — envio de e-mail via Brevo

## Deploy (Godeploy — SPA + Worker API)

- **Arquitetura**: SPA estática (`dist/`) + Cloudflare Worker (`src/worker.ts` → bundle `worker.js`) que serve `/api/*`, com datasource `env.DB`
- **Build**: `npm run build` (Vite) gera a SPA em `dist/`; `npm run build:worker` gera o `worker.js` (commitado)
- **Worker**: o Godeploy serve os assets estáticos e invoca o Worker para `/api/*` e para recursos sem asset correspondente; injeta `env.DB` e as env vars do Worker
- **process.env**: o Godeploy **não** expõe `process` global (sem `nodejs_compat`) — o `worker.ts` faz polyfill de `process.env` no início do `fetch`
- **Dev**: `vite-plugin-dev-api.ts` serve `/api/*` localmente reusando o `worker.ts`, com um wrapper `better-sqlite3` implementando a interface `GoDeployDB`
- **Extração de PDF**: delegada ao Cloudflare OCR Worker externo (sem `pdf-parse` no bundle)
- **✅ Runtime do SQLite resolvido**: produção usa o `env.DB` do Godeploy (SQLite gerenciado, async) — `better-sqlite3` roda **apenas em dev**. Não há mais dependência de binário nativo de Node no runtime de produção. (O `PLANO_MIGRACAO_SQLITE.md` documenta o histórico.)

### ⚠️ Upload de assets para o Godeploy (regra obrigatória)

Ao fazer deploy via `updateApp`, os arquivos de `dist/` devem ser enviados **SEM o prefixo `dist/`** no path. O `index.html` do Vite referencia `/assets/*`, não `/dist/assets/*`. Exemplo correto:

```
Upload:   -F "index.html=@./dist/index.html"  -F "assets/foo.js=@./dist/assets/foo.js"
Assets:   ["index.html", "assets/foo.js"]
```

**ERRADO** (causa 404): `-F "dist/index.html=@./dist/index.html"` / `["dist/assets/foo.js"]`

Sempre incluir `assetConfig: { "not_found_handling": "single-page-application" }` no `updateApp` para que rotas SPA (`/`, `/submeter`, `/dashboard` etc.) caiam no `index.html` em vez de retornar "Not Found".

### ⚠️ Verificar usuários ativos antes de fazer deploy

Antes de subir uma nova versão no Godeploy, **sempre verificar se há alguém preenchendo o formulário naquele momento**. O deploy pode interromper a sessão e causar perda de dados do preenchimento em andamento.

**Como verificar**: chamar `GET /api/admin/investigador/projetos` (requer auth admin) e checar se algum projeto com `status = 'rascunho'` tem `ultimo_log_api` nos últimos 5 minutos. Se houver, aguardar a conclusão do preenchimento ou avisar o responsável antes de prosseguir.

Em dev, pode verificar via:
```bash
curl -s http://localhost:5173/api/admin/investigador/projetos | jq '[.[] | select(.status == "rascunho" and .ultimo_log_api != null)] | length'
# Se retornar > 0, há alguém preenchendo agora
```

## Status atual

- Home, formulário de submissão, CRUD de usuários e áreas funcionais
- **Arquitetura SPA**: SSR (TanStack Start) → SPA + Worker API; rotas admin leem via `/api/*`
- **Banco**: Supabase → SQLite via interface `GoDeployDB` (async); prod = `env.DB` do Godeploy, dev = better-sqlite3; schema auto-criado; auth via header Godeploy edge
- **Step 2 (upload)**: codebase/pasta inteira com filtro de pastas de dev, gate de ~200k tokens, árvore colapsável
- **Multi-tipo + navegação livre**: tipo(s) saving e/ou receita; navegação livre entre steps; troca de tipo no meio do fluxo re-roteia o agente (`atualizar-tipos`); edições de metadado/arquivos se propagam ao agente (`atualizar-metadados`)
- **Agente Doc (fase 1)**: pré-extração + chat só das regras de negócio, preview formatado, ciclo de aprovação
- **Agente Saving (fase 2)**: formulário multi-linha (por pessoa/cargo), cálculo só no backend, validação de horas relaxada (suporte a "ninguém antes/depois"), memorial automático
- **Agente Receita (fase 2)**: coleta valor + racional curto no formulário e desafia ambos no chat, memorial automático
- **Transições animadas** doc → saving/receita e saving → receita; **revisão final** com cards colapsáveis; loader com etapa nomeada nas operações pesadas
- **Submissão interna + n8n**: dados no SQLite, duplicata verificada, auto-aprovação RPA, notificação Google Chat e envio ao n8n (webhook → Markdown/Drive/planilha)
- **Áreas via TeamGuide**: fonte única + fallback hardcoded + sync (admin/cron)
- **Análise automática pré-submissão**: agente analisador com 10 critérios fixos + dinâmicos, classificação de complexidade, card com parecer em texto; roda em background após submissão
- **Investigador** (`/investigador`): painel admin de monitoramento em tempo real — lista de projetos com fase atual, métricas de chat e API, filtros (ativos agora, com erros, lentos >5s), busca; detalhe com dados das etapas 1/2, histórico do chat com markdown renderizado, logs de API tabulados, documentação/análise. Polling a cada 8s. Detecção de atividade via `api_logs` (<5min). Tabela `api_logs` registra cada chamada `/api/chat/*`; limpeza automática >30 dias no cron
- **Testes**: 153 passando; rodam antes de cada `npm run dev` via `predev`
- Identidade visual GoGroup (--go-blue, --go-lime, --go-cream, Poppins)

## Notas importantes

- Projeto originado do Lovable (gerado por IA) — pode conter código que precisa de refatoração
- A arquitetura saiu de SSR (TanStack Start + Nitro/Cloudflare) para **SPA + Worker API** (`src/worker.ts`). Não há mais `server.ts`/`start.ts`, Nitro nem `@lovable.dev/vite-tanstack-config` — o `vite.config.ts` usa `@vitejs/plugin-react` + `TanStackRouterVite` + `devApiPlugin`
- `worker.js` é commitado e gerado por `npm run build:worker` — rebuildar ao mexer no backend, senão o deploy fica defasado do source
- `routeTree.gen.ts` é auto-gerado — não editar manualmente
- O antigo fluxo n8n → Google Sheets foi reestruturado: a submissão agora salva no SQLite local e **também** envia para o n8n via webhook (`N8N_WEBHOOK_URL`). O workflow n8n atual (`forms_n8n/submit_forms.json`) recebe o JSON, gera Markdown, sobe ao Drive e salva na planilha. Os fluxos legados (erro, manutenção, reenvio, sucesso) estão em `forms_n8n/` para referência
