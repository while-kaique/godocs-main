# SPEC — Histórico de ações do painel (drawer "Histórico")

Feed global das ações do painel admin, aberto por um botão **"Histórico"** no cabeçalho das
3 telas de aprovação (`/dashboard`, `/especiais`, `/aprovacoes-pendentes`). Drawer lateral à
direita, mais recente primeiro, paginado. Responde "quem aprovou/reprovou/pediu reenvio, deu
estrelas, dividiu área ou reabriu fila — quando e por quê", com o e-mail `@gocase` da borda
como ator.

## Decisões fechadas (não "corrigir" por engano)

- **D1 — Tabela ÚNICA, não união na leitura.** `admin_activity_log` (SQLite) é a fonte do
  feed. Toda mutação de admin grava 1 linha via `registrarAtividade` (`atividades.functions.ts`).
  Escolhida sobre "UNION de `admin_status_log` + `projeto_aprovacoes` na leitura" porque o
  pedido é *todas* as ações de admin, e ações sem log próprio (estrelas, dono de área) ficariam
  de fora. As ações que JÁ têm log próprio (status → `admin_status_log`, decisão de líder →
  `projeto_aprovacoes`) **espelham** no feed; a tabela original continua sendo a fonte de
  verdade daquele domínio.
- **D2 — Só admin.** Botão e endpoint (`GET /api/admin/atividades`) atrás de `requireAdmin`.
  As 3 telas já são só-admin.
- **D3 — `registrarAtividade` NUNCA lança.** Auditoria é registro paralelo: uma falha aqui não
  pode desfazer a mudança de status/estrela/parecer que já aconteceu (mesma regra do
  `insertAdminStatusLog` em `definirStatusProjeto`). Erro → `console.error` e segue.
- **D4 — `admin_activity_log` é DERIVADA/append-only.** Nenhum estado do app mora nela (isso é
  `projetos`/`sheet_espelho`). Pode ser apagada que o painel segue funcionando — só o histórico
  some. INTERNA: sem coluna no Sheets, fora de `SAFE_UPDATE_FIELDS`, o sync reverso não a toca.
- **D5 — Paginação por keyset `(created_at, id)` DESC, cursor opaco.** Estável sob escrita
  concorrente (offset "escorregaria"). Cursor = base64url de `created_at|id` (btoa/atob — o
  runtime do Worker NÃO tem `Buffer`/`nodejs_compat`). Cursor podre = primeira página, nunca
  erro. Query na forma PORTÁTIL `created_at < ? OR (created_at = ? AND id < ?)` (evita o
  row-value `(a,b) < (?,?)`, que nem todo motor aceita). Pede `limit + 1` para saber se há
  próxima página sem 2ª consulta.
- **D6 — Estado NUNCA só por cor (a11y).** Cada item = ícone + rótulo textual da ação + tom de
  cor. `visualDe()`/`CLASSES_TOM` em `historico-drawer.tsx`.

## Ações capturadas (v1)

| Ação (`acao`) | Onde grava | Ator |
|---|---|---|
| `status` | `definirStatusProjeto` (após `admin_status_log`) | admin da triagem |
| `estrelas` | `definirEstrelasEspecial` (ganhou `adminEmail`) | admin do comparador |
| `dono_area` | `definirDonoDeArea` | admin |
| `lider_decisao` | `decidirAprovacao` **só em modo `?como=`** (admin decide como líder) | admin |
| `reabrir_fila` | rota `/api/admin/aprovacoes/reabrir` (só quando `!dry`) | admin |

Fora da v1 (extensível — `registrarAtividade` é 1 linha): descontinuar/reativar (ação de dono
em Meus Projetos, não do painel), disparo de e-mail (já tem `email_disparos`), CRUD de admin.

## Arquivos

- Backend: `src/integrations/db/schema.ts` (tabela), `src/integrations/db/client.server.ts`
  (`insertAdminActivity`/`queryAdminActivities`), `src/lib/atividades.functions.ts` (helper +
  leitura), rota em `src/worker.ts`. Instrumentação em `dashboard-admin.functions.ts`,
  `especiais.functions.ts`, `aprovacoes.functions.ts`, `worker.ts`.
- Frontend: `src/components/ui/sheet.tsx` (drawer sobre o Radix Dialog já usado),
  `src/components/historico/historico-drawer.tsx` (+ helpers puros de nome/data/tom),
  `src/components/historico/historico-button.tsx`. Ligado nos 3 cabeçalhos.
- Testes: `tests/atividades.test.ts` (cursor ida-e-volta, paginação `limit+1`,
  `registrarAtividade` não-lança).
