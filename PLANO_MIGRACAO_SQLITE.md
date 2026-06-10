# Plano de Migração: Supabase → SQLite (better-sqlite3)

> Contexto: o projeto está rodando como **SPA + Cloudflare Worker API** (PR #24).
> O stash `!!GitHub_Desktop<main>` contém uma tentativa anterior de migração feita sobre a arquitetura TanStack Start (pré-SPA) — não pode ser mergeada diretamente, mas o `client.server.ts` do SQLite e o schema estão prontos e podem ser reutilizados.

---

## O que já está pronto (no stash)

| Arquivo | Status | Observação |
|---|---|---|
| `src/integrations/db/schema.ts` | ✅ Completo | 9 tabelas (admins, areas, projetos, chat_messages, documentacao, validacoes, configuracoes, profiles, user_roles, leader_areas) |
| `src/integrations/db/types.ts` | ✅ Completo | Tipos TS espelhando o schema, inclui `Constants.public.Enums` |
| `src/integrations/db/client.server.ts` | ✅ Completo | ~460 linhas, todas as funções CRUD (getAdmins, insertProjeto, updateProjeto, getChatMessages, etc.) |
| `src/lib/chat.functions.ts` | ✅ Migrado | Já importa de `db/client.server`, sem Supabase |

---

## O que precisa ser feito

### Fase 0 — Setup (deps + config)

1. **Instalar deps**:
   ```bash
   npm install better-sqlite3
   npm install -D @types/better-sqlite3
   ```

2. **Atualizar `.gitignore`** — adicionar:
   ```
   # SQLite
   *.db
   *.db-wal
   *.db-shm
   ```

3. **Copiar os 3 arquivos do stash** para `src/integrations/db/`:
   - `schema.ts` (criação de tabelas)
   - `types.ts` (tipos TS)
   - `client.server.ts` (camada de acesso)

   Estes arquivos já estão no working tree como untracked — basta commitar.

### Fase 1 — Migrar `auth.functions.ts`

**Arquivo**: `src/lib/auth.functions.ts`
**Atual**: importa `supabaseAdmin`, consulta tabela `admins` via SDK Supabase
**Alvo**: importar `getAdminByEmail` de `db/client.server`

```typescript
// DE:
import { supabaseAdmin } from '@/integrations/supabase/client.server'
export async function getCurrentUser(request: Request) {
  // ...
  const { data } = await supabaseAdmin.from('admins').select('email').eq('email', email).maybeSingle()
  return { email, isAdmin: !!data }
}

// PARA:
import { getAdminByEmail } from '@/integrations/db/client.server'
export async function getCurrentUser(request: Request) {
  // ...
  const admin = getAdminByEmail(email)
  return { email, isAdmin: !!admin }
}
```

**Manter**: a assinatura `getCurrentUser(request: Request)` — o `worker.ts` chama assim.

### Fase 2 — Migrar `admin.functions.ts`

**Arquivo**: `src/lib/admin.functions.ts`
**Atual**: ~20 funções que usam `supabaseAdmin.from(...)` para CRUD de áreas, admins, projetos, usuários
**Alvo**: trocar cada chamada Supabase pela função equivalente em `client.server.ts`

Mapeamento (todas as funções SQLite já existem no `client.server.ts`):

| Função atual | Supabase | SQLite equivalente |
|---|---|---|
| `getAreas()` | `.from('areas').select('*')` | `db.getAreas()` |
| `createArea()` | `.from('areas').insert(...)` | `db.insertArea(nome)` |
| `deleteArea()` | `.from('areas').delete()` | `db.deleteArea(id)` |
| `getAdmins()` | `.from('admins').select('*')` | `db.getAdmins()` |
| `addAdmin()` | `.from('admins').insert(...)` | `db.insertAdmin(email, nome)` |
| `removeAdmin()` | `.from('admins').delete()` | `db.deleteAdmin(id)` |
| `getProjetos()` | `.from('projetos').select(...)` | `db.getProjetosWithArea()` |
| `getProjetoDetalhes()` | `.from('projetos').select(...)` | `db.getProjetoWithRelations(id)` |
| `createUser()` | Supabase Admin API + profiles + roles | `db.upsertProfile()` + `db.insertUserRole()` |
| `deleteUser()` | Supabase Admin API | `db.deleteProfile(id)` |
| `updateUserAreas()` | `.from('leader_areas')...` | `db.deleteLeaderAreas()` + `db.insertLeaderAreas()` |
| `getConfiguracoes()` | `.from('configuracoes').select(...)` | `db.getConfiguracoes()` |
| `updateConfiguracao()` | `.from('configuracoes').update(...)` | `db.updateConfiguracao()` |

**Atenção especial**: `createUser` e `deleteUser` usam a **Supabase Admin API** (`supabaseAdmin.auth.admin.createUser`). Como não haverá mais Supabase Auth, essas funções devem passar a gerenciar users apenas na tabela `profiles` do SQLite. A auth é via Godeploy edge (headers), então não há criação de credenciais.

### Fase 3 — Migrar `projeto.functions.ts`

**Arquivo**: `src/lib/projeto.functions.ts`
**Atual**: CRUD de projetos via `supabaseAdmin`
**Alvo**: usar funções do `client.server.ts`

Mesmo padrão: trocar cada `.from('projetos').select/insert/update/delete(...)` pela função SQLite correspondente.

### Fase 4 — Migrar `worker.ts`

**Arquivo**: `src/worker.ts`
**Atual**: importa `supabaseAdmin` diretamente para o `requireAdmin()` helper
**Alvo**: importar `getAdminByEmail` de `db/client.server`

```typescript
// DE:
import { supabaseAdmin } from '@/integrations/supabase/client.server'
async function requireAdmin(request: Request) {
  const { data } = await supabaseAdmin.from('admins').select('email').eq('email', email).maybeSingle()
  if (!data) throw ...
}

// PARA:
import { getAdminByEmail } from '@/integrations/db/client.server'
async function requireAdmin(request: Request) {
  const admin = getAdminByEmail(email)
  if (!admin) throw ...
}
```

### Fase 5 — Remover Supabase

1. **Deletar** toda a pasta `src/integrations/supabase/`:
   - `client.ts` (browser client — não será mais usado)
   - `client.server.ts` (admin client)
   - `auth-middleware.ts` (middleware TanStack — substituído pelo helper no worker)
   - `auth-attacher.ts` (anexava token — não existe mais)
   - `types.ts` (431 linhas de tipos gerados — substituído por `db/types.ts`)

2. **Remover dep** do `package.json`:
   ```bash
   npm uninstall @supabase/supabase-js
   ```

3. **Remover variáveis de ambiente** do `.env` e secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

4. **Adicionar variável**:
   - `DATABASE_PATH` — caminho do arquivo SQLite (default: `./godocs.db`)

### Fase 6 — Atualizar testes

**Arquivo**: `tests/routes.test.ts`
- Trocar verificações de `src/integrations/supabase/` por `src/integrations/db/`
- Trocar verificação de tipos Supabase por verificação do schema SQLite
- Ajustar contagem de testes se necessário

### Fase 7 — Atualizar CLAUDE.md

O CLAUDE.md selecionado pelo usuário já tem a versão atualizada pronta. Principais mudanças:
- Stack: "SQLite via better-sqlite3" em vez de "Supabase"
- Estrutura: `integrations/db/` em vez de `integrations/supabase/`
- Banco de dados: seção reescrita para SQLite
- Variáveis de ambiente: remover Supabase, adicionar `DATABASE_PATH`
- Status: "dados salvos no SQLite"

### Fase 8 — Testar e Deploy

1. `npm run test` — todos os testes devem passar
2. `npm run dev` — testar localmente (o banco `godocs.db` será criado automaticamente)
3. **⚠️ Cloudflare Workers**: SQLite via `better-sqlite3` **NÃO funciona** em Workers (usa bindings nativos do Node). Opções:
   - **Cloudflare D1** (SQLite gerenciado) — requer migração do `better-sqlite3` para a API D1
   - **Godeploy com Node.js runtime** — se o runtime suportar binários nativos
   - **Turso** (libsql) — SQLite remoto, drop-in replacement

---

## Ordem de execução recomendada

```
Fase 0 (setup)
  ↓
Fase 1 (auth.functions)  →  testar /api/auth/me
  ↓
Fase 2 (admin.functions) →  testar CRUD no dashboard
  ↓
Fase 3 (projeto.functions)  →  testar submissão
  ↓
Fase 4 (worker.ts)  →  testar requireAdmin
  ↓
Fase 5 (remover Supabase)  →  npm run test
  ↓
Fase 6 (testes)  →  npm run test (todos passam)
  ↓
Fase 7 (CLAUDE.md)
  ↓
Fase 8 (deploy)
```

## Risco principal

**Deploy em Cloudflare Workers**: `better-sqlite3` é um binding nativo do Node.js (compilado em C++). Cloudflare Workers roda em V8 isolates, não em Node.js. O `nodejs_compat` flag NÃO resolve isso — ele polyfilla APIs de Node.js, mas não carrega binários nativos.

**Solução mais provável**: migrar de `better-sqlite3` para **Cloudflare D1** (banco SQLite nativo dos Workers). O schema e as queries são compatíveis — a diferença é a API de acesso (de `db.prepare().run()` síncrono para `env.DB.prepare().run()` assíncrono via binding).

Alternativa: se o deploy for via Godeploy com runtime Node.js real (não Workers), `better-sqlite3` funciona direto.
