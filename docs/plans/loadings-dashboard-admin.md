# Plano — Loadings do /dashboard do admin
**Status:** ✅ aprovado (Luis, 2026-07-28)

**Objetivo:** Tirar a espera percebida do `/dashboard`: ninguém mais bloqueia em "Verificando permissões" nem
em "Lendo a planilha…" por causa de cache vencido ou de fila indiana entre auth e leitura — mantendo a
planilha como fonte única.

## Diagnóstico (medido em 2026-07-28, contra a planilha real)
| Etapa | Custo |
|---|---|
| Leitura do Sheets (`readAllRows`, aba `GoDocs`) | **1.450–2.360 ms**, payload **2,65 MB** (544 linhas × 48 colunas) |
| Token OAuth da Service Account | ~560 ms — já cacheado em módulo (`google/auth.ts:109`, `_cached`) |
| `/api/auth/me` | barato: `isAdmin()` curto-circuita em `envAdmins()` antes de tocar o banco (`auth.functions.ts:44-49`) |

Estreitar o range **não** ajuda: `A1:ZZ` vs `A1:AV` medidos, a API já corta nas 48 colunas reais — mesmos
2,65 MB. O peso é volume de células, não o range.

**A causa é serialização, não o Sheets ser lento.** Hoje:
1. `_authenticated/route.tsx` `beforeLoad` **bloqueia** a tela inteira (`AuthLoadingScreen`, linha 51)
   esperando `/api/auth/me`;
2. só depois o componente monta e o `useEffect` (`dashboard.tsx:102`) dispara
   `/api/admin/dashboard/projetos`, que faz a leitura de ~2 s.

Três agravantes:
- Cache do servidor é **in-memory do isolate** (`CACHE_TTL_MS = 60_000`, `dashboard-admin.functions.ts:154`)
  e **sem revalidação em background**: TTL vencido = o próximo admin **espera** a leitura inteira.
- Cache de auth no cliente é **in-memory** (`cachedUser`/`AUTH_CACHE_MS`, `route.tsx:7-9`): todo **reload** ou
  **aba nova** volta ao "Verificando permissões".
- `getProjetoDashboard` (a **ficha**) também chama `lerPlanilha(false)` — abrir um card com cache vencido
  paga os mesmos ~2 s. É o "carregamento do card" relatado; o T1 cobre junto.

### Tarefas
- **T1 — Stale-while-revalidate no servidor** (`src/lib/dashboard-admin.functions.ts`, `lerPlanilha`).
  Havendo cache **vencido**, devolvê-lo **na hora** e disparar a releitura via `runBackground()`
  (`src/lib/background.ts` → `ctx.waitUntil`), preservando o *single-flight* (N chamadas concorrentes =
  1 releitura). Só bloqueia quando **não há cache nenhum** (isolate frio) ou quando `?refresh=1` é explícito.
  Expor `revalidando: boolean` em `ListagemDashboard` para a UI sinalizar (o payload já tem `lidoEm`/`doCache`).
  Beneficia a listagem **e** a ficha, que partilham `lerPlanilha`.
  (guarda: teste com leitura mockada lenta — cache vencido resolve **sem** esperar a releitura; N concorrentes
  disparam 1 releitura; `refresh=1` continua bloqueando e devolvendo dado novo; falha na revalidação **não**
  derruba a request nem envenena o cache)
- **T2 — Cache do auth em `sessionStorage`** (`src/routes/_authenticated/route.tsx`). Extrair helper **puro**
  (`lerAuthCache`/`gravarAuthCache`) e persistir `{user, at}` sob chave versionada (`godocs:auth-v1`), mesmo
  TTL de 5 min, mantendo o cache em memória como 1º nível. Entrada válida → **não** bloqueia em fetch;
  revalida em background para não fixar permissão obsoleta.
  **`sessionStorage`, não `localStorage`** — dado de permissão não deve sobreviver ao fechamento do navegador;
  o custo é 1 fetch por aba nova.
  Seguro: o gate real é **server-side** (`requireAdmin` em toda `/api/admin/*`) — o cliente só decide o que pintar.
  (guarda: teste do helper puro — grava/lê, expira no TTL, JSON corrompido/quota cheia degradam para "sem cache"
  em vez de lançar)
- **T3 — Paralelizar auth × leitura da planilha.** Módulo novo `src/lib/dashboard-prefetch.ts` guardando a
  promise em voo; `beforeLoad` do `_authenticated` chama `iniciarPrefetchDashboard()` **antes** do
  `await fetch('/api/auth/me')` quando o destino é `/dashboard`; `carregar()` consome a promise pendente se
  existir, senão faz o fetch normal. Tira o RTT do auth do caminho crítico.
  (guarda: teste do módulo — consome a promise uma vez, 2ª chamada refaz, **erro não fica cacheado** nem
  pendura o consumidor; prefetch de não-admin engole o 403 sem estourar)
- **T4 — Skeleton em vez de spinner** (`dashboard.tsx:343-349`). Pintar cabeçalho, busca e pílulas de fila
  imediatamente, com linhas-fantasma no lugar de "Lendo a planilha…". Componente novo
  `src/components/dashboard/skeleton-linhas.tsx` — **não há canônico**: `src/components/ui/` não tem
  `skeleton.tsx` e o único `animate-pulse` do projeto (`investigador.tsx:592`) é indicador de "ao vivo", não
  placeholder. Fica na pasta `components/dashboard/` que já existe (onde vive `status-triagem.ts`), em vez de
  criar casa nova. Invocar a skill **`frontend-design`** antes de codar (regra 11); respeitar
  `prefers-reduced-motion` e não sinalizar estado só por cor.
  (guarda: smoke de render — sem dados aparece o skeleton e a busca já é interativa; com dados, nenhuma
  linha-fantasma)
- **T5 — Testes + build** (regras 1 e 2): `npm run test` verde (620 + novos), `npm run build`,
  `npm run build:worker` e **`worker.js` recomitado** (T1 é server-side).
- **T6 — Spec + docs + deploy** (regras 12 e 13): atualizar `spec-docs/SPEC_DASHBOARD_ADMIN.md` (nova decisão
  de cache/SWR + o que continua proibido) e o gotcha do `CLAUDE.md` se necessário; deploy **staging
  `edf400b4`** → validar no navegador → **prod `674a3710`** → PR.

### Critérios de aceitação
1. Com o cache do servidor **vencido**, a resposta de `/api/admin/dashboard/projetos` volta **imediatamente**
   (dado possivelmente velho, sinalizado na UI) e a releitura acontece em background — nenhum admin espera
   os ~2 s por expiração de TTL.
2. **Reload** da página ou **navegação entre telas admin** na mesma aba **não** mostra "Verificando permissões".
3. No primeiro acesso da aba, a requisição da planilha começa **junto** com a do auth (não depois) —
   verificável na aba Network: as duas em paralelo.
4. Enquanto carrega, a tela mostra busca + filas + linhas-fantasma **interativas** em vez de spinner centrado.
5. A planilha segue **fonte única**: nenhuma leitura de projeto/status vem do SQLite, e o write-back continua
   gravando só "Status"/"Observações", **nunca "Atualizado Em"** (testes de guard existentes seguem verdes).
6. 620 testes atuais + novos verdes; `worker.js` recomitado; validado em staging antes de prod.

### Fronteiras (não exceder)
- **FORA — cache da listagem em SQLite** (decisão explícita do Luis, 2026-07-28). Não reintroduzir SQLite no
  caminho de leitura: é o **gotcha nº 1** da `SPEC_DASHBOARD_ADMIN.md` e o bug que o PR atual acabou de
  corrigir. Consequência aceita: o **primeiro** acesso após isolate frio segue pagando ~2,5 s (agora com
  skeleton em vez de tela branca).
- FORA — cache da listagem em `localStorage` no cliente, mudança no range/colunas lidas do Sheets, paginação
  server-side, e qualquer alteração em `STATUS_GRAVAVEIS` (decisão de produto ainda pendente).
- FORA — mexer no `AuthLoadingScreen` além do necessário: ele segue válido no 1º acesso da aba.

### Blast-radius
**Arquivos:** `src/lib/dashboard-admin.functions.ts` (T1) · `src/routes/_authenticated/route.tsx` (T2, T3) ·
`src/routes/_authenticated/dashboard.tsx` (T3, T4) · novos `src/lib/dashboard-prefetch.ts` e
`src/components/dashboard/skeleton-linhas.tsx` · `worker.js` (rebuild) · testes.
**Dependentes:** ⚠️ `_authenticated/route.tsx` é o gate de **todas** as telas admin — `/investigador`,
`/email-legados`, `/areas`, `/usuarios`, `/testes` — então o T2/T3 tem alcance maior que o `/dashboard`; é o
ponto mais arriscado da fatia. `lerPlanilha` é partilhada por listagem, ficha e write-back (T1 afeta os três).
**Invariantes:** planilha = fonte única do status (gotcha 1) · "Atualizado Em" nunca escrita pela triagem ·
`requireAdmin` server-side em toda `/api/admin/*` (é o que torna o T2 seguro) · `runBackground` obrigatório
para fire-and-forget no Godeploy.
**Confiança:** média — o projeto **não tem** `docs/INDEX.md` nem `docs/invariants.md` (RF-35), então este
blast-radius saiu de leitura manual; a sessão de código deve fazer a **varredura completa** dos dependentes de
`route.tsx` e de `lerPlanilha`.

### Nota operacional (base da branch)
Os três arquivos tocados **só existem na branch `feat/dashboard-admin-sheets`**, cujo PR está **aberto e não
mergeado**. O worktree novo (regra 8) sai de **`feat/dashboard-admin-sheets`**, não do `main` — e se aquele PR
for mergeado antes, rebasear sobre o `main` e **rebuildar** (regras 10 e 9).
