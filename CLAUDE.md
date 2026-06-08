# GoDocs - Hub de Projetos Internos

Hub interno do Gogroup para cadastro, gestao e documentacao de projetos de automacao (RPA & IA). Funcionarios submetem projetos, líderes acompanham o status das submissoes de suas areas, e Admin Masters gerenciam toda a plataforma.

## Stack

- **Framework**: TanStack Start (SSR) + TanStack Router (file-based routing)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui (new-york style), Lucide icons
- **Forms**: react-hook-form + zod
- **Backend**: Supabase (auth, Postgres com RLS, service role para admin ops)
- **Server functions**: `createServerFn` do TanStack Start (com middleware de auth)
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
    submeter.tsx       # Formulario multi-step de submissao de projetos (4 etapas)
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
    admin.functions.ts # Server functions: createUser, deleteUser, updateUserAreas
    utils.ts           # cn() helper (clsx + tailwind-merge)
  router.tsx           # Configuracao do TanStack Router + QueryClient
  server.ts            # Entry SSR - wrapper de erro sobre o server-entry do TanStack
  start.ts             # createStart - registra middlewares globais
  styles.css           # Tokens CSS (light/dark), Tailwind config
supabase/
  migrations/          # 3 migrations SQL (schema, revoke has_role, trigger bootstrap)
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
| `/submeter` | Publico | Formulario 4 etapas -> POST webhook n8n |
| `/auth` | Publico | Login email/password |
| `/dashboard` | Autenticado (admin/leader) | Dashboard (placeholder) |
| `/usuarios` | Admin Master | CRUD de usuarios |
| `/areas` | Admin Master | CRUD de areas |

## Webhooks n8n

Os formularios de submissao/edicao/reenvio enviam dados para webhooks do n8n:

- **Submeter**: `https://n8n-study.gogroupgl.com/webhook/submit_workflows` (POST FormData)
- **Editar**: `https://n8n-study.gogroupgl.com/webhook/edit_workflow` (link externo)
- **Reenviar**: `https://n8n-study.gogroupgl.com/webhook/re_workflow` (link externo)

## Formulario de submissao (4 etapas)

1. **Responsavel**: status producao (bloqueia se nao em producao), nome, email, area, ferramenta, equipe/participantes (apenas dominios @gocase, @gobeaute, @gogroup)
2. **Projeto**: nome do projeto, data criacao, descricao, upload de documentacao (PDF/DOCX/DOC/TXT/MD, max 15MB)
3. **Impacto**: solucao similar paga?, saving horas, saving R$, tipo saving. Calcula valor/hora automatico (bloqueia < R$8, avisa > R$60)
4. **Memorial de calculo**: descricao detalhada de como o saving foi calculado

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

## Variaveis de ambiente

Definidas em `.env` (nao comitar service_role_key):

- `SUPABASE_URL` / `VITE_SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, necessario para admin ops)

## Status atual

- Home, login, formulario de submissao, CRUD de usuarios e areas estao funcionais
- Dashboard ainda e placeholder - falta integrar listagem de projetos submetidos
- Editar e Reenviar ainda redirecionam para webhooks externos (sem UI propria)
- Design sera revisado usando o `identidade_visual_gogroup.md`

## Notas importantes

- Projeto originado do Lovable (gerado por IA) - pode conter codigo que precisa de refatoracao
- Arquivos marcados "automatically generated" pelo Lovable podem ser editados agora que o desenvolvimento saiu do Lovable
- O `@lovable.dev/vite-tanstack-config` ja inclui tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro etc - nao duplicar plugins no vite.config.ts
