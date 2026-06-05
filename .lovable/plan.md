# Hub de Projetos Internos

Plataforma simples com landing pública de 3 ações e área administrativa autenticada (Admin Master / Leader). Submissão, edição e reenvio acontecem 100% no n8n — o hub apenas redireciona.

## Escopo desta entrega

### 1. Página Home (pública)

Hero institucional + 3 cards/botões grandes que abrem o link n8n em **nova aba**:

- **Submeter projeto** → `https://n8n-study.gogroupgl.com/webhook/submit_workflows`
- **Editar projeto** → `https://n8n-study.gogroupgl.com/webhook/edit_workflow`
- **Reenviar projeto** → `https://n8n-study.gogroupgl.com/webhook/re_workflow`

Cada card com ícone, título, descrição curta dos status que se aplicam (ex.: "Reenviar" menciona projetos em "Reenvio Pendente").

Header com logo e botão "Área Admin" (login).

### 2. Autenticação

- Login por e-mail/senha (Lovable Cloud).
- Dois papéis: `admin_master` e `leader` (tabela `user_roles` separada — padrão de segurança).
- Cadastro de novos usuários **só pelo Admin Master** (não há signup público).

### 3. Área Admin (autenticada)

Layout com sidebar. Conteúdo varia por papel:

**Admin Master** vê:

- Dashboard placeholder ("Listagem de projetos em breve")
- **Gestão de usuários**: criar/editar/remover Admins e Leaders, definir e-mail, senha inicial, papel e — para Leaders — as **áreas que ele lidera** (multi-select).
- **Gestão de áreas**: CRUD de áreas da empresa (ex.: TI, RH, Operações).

**Leader** vê:

- Dashboard placeholder ("Seus projetos aparecerão aqui assim que a integração de leitura com o n8n for configurada"), listando as áreas que ele lidera.

> A listagem real de projetos/status fica fora do escopo desta entrega (decisão: dados ficam só no n8n por enquanto).

## Detalhes técnicos

**Stack:** TanStack Start + Lovable Cloud (Supabase via integração).

**Rotas (`src/routes/`):**

- `index.tsx` — Home pública com os 3 botões.
- `auth.tsx` — tela de login.
- `_authenticated/route.tsx` — layout protegido (gate gerenciado pela integração).
- `_authenticated/index.tsx` — dashboard (renderiza visão de Admin ou Leader).
- `_authenticated/usuarios.tsx` — só admin (gate via `has_role`).
- `_authenticated/areas.tsx` — só admin.

**Schema (migration):**

- `enum app_role` com `admin_master`, `leader`.
- `user_roles (user_id, role)` + função `has_role` security definer.
- `areas (id, nome)`.
- `leader_areas (user_id, area_id)` — N:N que define o que cada Leader enxerga.
- `profiles (id, nome, email)` — opcional para nome de exibição.
- RLS em todas: admin_master gerencia tudo; leader lê apenas suas próprias linhas em `leader_areas`/`profiles`.
- GRANTs explícitos para `authenticated` e `service_role`.

**Componentes-chave:** shadcn `Card`, `Button`, `Dialog`, `Table`, `Select` (multi para áreas), `Form` + zod.

**Sem signup público:** rota `/auth` mostra só login. Criação de usuário é server function admin-only que usa `supabaseAdmin.auth.admin.createUser`.

## Design

Visual corporativo/clean — fundo claro, tipografia sóbria, acento em uma cor primária forte. Os 3 botões da home como cartões grandes lado a lado (stack no mobile), com ícone, título e microcopy. Sem direções de design exploratórias — proposta direta.

## Fora de escopo (próximas iterações)

- Listagem real de projetos vindos do n8n (precisa de endpoint GET no n8n ou webhook de volta).
- Notificações de mudança de status.
- Reset de senha self-service.

## Email inicial Admin Master:

kaique.breno@gocase.com