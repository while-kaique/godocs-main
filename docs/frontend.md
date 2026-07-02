# Frontend

SPA React com TanStack Router (file-based routing). Entry point: `src/main.tsx` → `src/router.tsx`. Todas as rotas admin ficam sob `_authenticated/` com guard de auth.

## Rotas

| Rota | Arquivo | Acesso | Descrição |
|---|---|---|---|
| `/` | `routes/index.tsx` | Público | Home com 3 cards de ação (Submeter, Editar, Reenviar) |
| `/submeter` | `routes/submeter.tsx` | Público | Formulário 3 etapas + chat IA (página mais complexa) |
| `/auth` | `routes/auth.tsx` | Público | Redireciona para `/dashboard` |
| `/dashboard` | `_authenticated/dashboard.tsx` | Admin/Leader | Projetos submetidos |
| `/usuarios` | `_authenticated/usuarios.tsx` | Admin Master | CRUD de usuários com roles e áreas |
| `/areas` | `_authenticated/areas.tsx` | Admin Master | CRUD áreas + botão sync TeamGuide |
| `/investigador` | `_authenticated/investigador.tsx` | Admin Master | 3 abas — **Submetidos** (submissão original), **Edições** (1 linha por reenvio, com chat/API/métricas da edição), **Abandonados** (rascunho parado > 1h). Detalhe tem seletor de versão (Original/Edição/Atual); o histórico do chat intercala os valores marcados no formulário (`form_events`) e o marcador "Voltou e editou". Polling 8s |
| `/testes/prompts` | `_authenticated/testes/prompts.tsx` | Admin Master | Inspetor de prompts IA com syntax highlight e contagem de tokens |
| `/testes/cenarios` | `_authenticated/testes/cenarios.tsx` | Admin Master | Simulador de cenários com inspetor de estado |

## Guard de autenticação (`_authenticated/route.tsx`)

- `beforeLoad` chama `GET /api/auth/me`
- Se não admin/leader → redireciona para `/`
- Layout com sidebar para páginas admin

## Página `/submeter` (controlador principal)

Arquivo mais complexo do projeto. Gerencia o fluxo de 3 etapas com navegação livre entre steps completados.

### Estado principal

- **Form**: `form` (FormData), `errors`, `completedSteps` (Set)
- **Chat**: `chatMessages`, `chatInput`, `chatLoading`, `chatFase`, `projetoId`
- **Workflow**: `agentTipos` (tipos quando o agente iniciou), `agentMeta` (snapshot do form), `agentArquivosSig` (fingerprint dos arquivos para detectar mudanças)
- **Previews**: `approvedDocPreview`, `approvedSavingPreview`, `approvedReceitaPreview`
- **Submissão**: `submitted`, `submittingProject`, `analyzing`

### Handlers chave

| Handler | Quando | O que faz |
|---|---|---|
| `handleIniciarAgente` | Step 2 → 3 (primeira vez) | Converte arquivos para base64, valida token budget, chama `iniciar-submissao`, armazena `projetoId` |
| `handleContinuarAgente` | Volta para step 2 e avança de novo | Detecta mudanças em arquivos/metadados/tipos; sincroniza com o backend |
| `handleSendMessage` | Usuário envia mensagem no chat | POST `enviar-mensagem`, processa transições de fase, captura previews |
| `handleSavingFormSubmit` | Formulário SavingForm submetido | POST `iniciar-saving` com linhas de cargo/horas |
| `handleReceitaFormSubmit` | Formulário ReceitaForm submetido | POST `iniciar-receita` com valor/racional |
| `handleSubmitAndAnalyze` | "Enviar para Triagem" | POST `submeter-validacao` + `analisar` em paralelo |

## Componentes do formulário (`src/lib/submeter/`)

### Step 1 — Envio (`step1.tsx`)
- Escopo (interno/externo), status de produção
- Responsável: nome + email (valida domínios @gocase/@gobeaute/@gogroup)
- Área (dropdown via `/api/areas`, fallback hardcoded)
- Ferramenta (dropdown: n8n, Python, Google Apps Script, Claude + GoDeploy, Claude, Outros)
- Equipe/participantes (`ParticipantesPapeisInput`: uma linha por pessoa com papel obrigatório + **autocomplete da TeamGuide** no input de e-mail — lista via `/api/participantes/sugestoes` carregada 1x quando "Em equipe? Sim", filtro local a cada tecla (nome/e-mail sem acento, ranking começa-por), dropdown com scroll, ↑/↓ + Enter ou clique; padrão ARIA combobox; espaço só separa quando o texto já é e-mail completo; TeamGuide fora → segue aceitando e-mail digitado. Filtro puro em `participantes-sugestoes.ts`)

### Step 2 — Projeto (`step2.tsx`)
- **Tipo**: multi-select (saving e/ou receita_incremental)
- Nome, data de criação, descrição breve
- **Upload**: pasta inteira ou múltiplos arquivos com:
  - Filtro automático (node_modules, .git, dist, lock files, .min.js, etc.)
  - Extensões aceitas: docs (PDF, DOCX, TXT, MD) + código (JSON, TS, JS, PY, SQL, etc.)
  - Gate de tokens: warn ~150k tokens (600k chars), **block ~200k tokens (800k chars)**
  - Árvore colapsável (`FileTreeNode`) com remoção por arquivo/pasta
  - Estimativa de tamanho sem ler conteúdo (instantâneo no browser)

### Step 3 — Chat + Impacto (`step3-chat.tsx`)
- **Chat**: bubbles coloridas por fase (azul = doc, lima = impacto), markdown renderizado
- **SavingForm**: multi-linha por cargo/pessoa, toggle mensal/pontual, custo externo
- **ReceitaForm**: valor estimado + racional curto
- **PreviewPanel**: card com markdown, botões Aprovar / Pedir ajuste
- **Revisão final**: cards colapsáveis com badge "Aprovado" + botão "Enviar para Triagem"
- **AnalyzerOverlay**: tela pós-submissão com loading animado; bloqueia saída (`beforeunload`)

## API Client (`api-client.ts`)

```typescript
apiFetch<T>(path: string, body?: unknown): Promise<T>
// POST se body, GET caso contrário
// Throws ApiError (com status) se !response.ok
```

## Design System (`styles.css`)

### Tokens de cor
| Token | Valor | Uso |
|---|---|---|
| `--go-blue` | #0059A9 | Primária, headings, fase doc |
| `--go-lime` | #D7DB00 | Accent, botões, fase impacto |
| `--go-cream` | #FBF4EE | Background principal |
| `--go-light-blue` | #C7E9FD | Seções alternadas |
| `--go-text-primary` | #333333 | Texto body |

### Outros tokens
- Radius: `--go-radius-sm` (8px) a `--go-radius-pill` (9999px)
- Sombras: `--go-shadow-sm/md/lg`, `--go-shadow-lime-glow`
- Animações: `go-fade-in-up`, `go-step-in`, `go-step-in-back`, `go-shake`, `go-bounce`, `go-spin`
- Fonte: Poppins (importada via Google Fonts)

### Regras globais
- `caret-color: transparent` em não-editáveis (esconde cursor); reativado em `input`, `textarea`, `[contenteditable]`
- Foco visível só via teclado (`:focus-visible`)
- Componentes shadcn/ui em `src/components/ui/` — não editar diretamente
