# Plano — Dashboard do admin: triagem sobre a planilha (busca, filtros, paginação, detalhe, status)
**Status:** ✅ executado (2026-07-28) — T1–T7 completos no commit `820f637` (branch
`feat/dashboard-admin-sheets`): 620 testes verdes, `build` + `build:worker` OK, `worker.js` recomitado,
spec + docs atualizados. **Falta T8** — deploy STAGING (`edf400b4`) → validar no navegador → PROD
(`674a3710`) → PR. Escopo confirmado com o Luis (write-back de status incluído + tabela densa).

**Objetivo:** transformar `/dashboard` (hoje 110 linhas lendo SQLite) na tela onde a triagem realmente
acontece: todos os projetos da planilha, busca instantânea por nome de projeto/autor, filtro por status,
paginação, detalhe rápido em overlay com **todas** as colunas do Sheets e a **mudança de status** feita ali
(Aprovado / Reprovado / Reenvio Pendente / …) em vez de na planilha.

**Contexto/causa:** a tela atual lê `getProjetos()` → `getProjetosWithArea()` (**SQLite**). Daí os dois
sintomas relatados: **rascunho aparece** (estado interno que nunca vai à planilha) e o **status está errado**
(o SQLite não é fonte de verdade do status — o sync reverso EXCLUI `status` de propósito; quem manda é a
coluna "Status" do Sheets, mantida à mão pela triagem). Já existe a leitura certa pronta: `readAllRows()`
(`google/sheets.ts`), chaveada pelo **nome real do cabeçalho**, usada assim em `email-legados.functions.ts`.

### Decisões desta sessão
- **D1 — a planilha é a fonte da listagem.** A tela lê `readAllRows()`, não o SQLite. Efeito desejado:
  rascunho desaparece; colunas manuais (Diff Horas/Saving, Observações) chegam de graça.
- **D2 — write-back só na planilha.** Mudar status escreve na coluna "Status" (+ "Observações" quando há
  motivo) via `updateRowByProjectId`. **Não** toca o `status` do SQLite (pertence ao fluxo de submissão) e
  **não** escreve "Atualizado Em" — aquela coluna é o carimbo da última escrita do SISTEMA e é o que decide
  se um legado está regularizado; preenchê-la marcaria como regularizado um legado que ninguém editou.
- **D3 — cache curto com single-flight.** Ler a planilha custa ~1–3 s. TTL de 60 s + dedup de leituras
  concorrentes; a mudança de status corrige a linha **no cache** em vez de reler tudo. Botão "Atualizar" força.
- **D4 — payload em duas camadas.** A listagem manda só campos de tabela (memoriais somam vários KB por
  projeto); o detalhe vem do mesmo cache, então abrir o overlay é instantâneo e sem leitura nova.
- **D5 — busca no cliente, índice no servidor.** O servidor pré-computa uma chave minúscula e **sem acento**
  por projeto; o cliente filtra com `includes` por token (AND). Responde na tecla, sem round-trip.
- **D6 — auditoria.** Tabela nova `admin_status_log` (quem mudou, de → para, motivo, quando). A escrita na
  planilha não é rastreável de outra forma, e a validação passa a acontecer no app.

### Tarefas
- **T1 — Backend** `src/lib/dashboard-admin.functions.ts` (NOVO): cache single-flight sobre `readAllRows`;
  `mapResumo` (linha → resumo de tabela + `busca`); `chaveStatus`/`texto`/`numero`/`chaveBusca` puros;
  `listarProjetosDashboard(refresh)` (+ contagem por status); `getProjetoDashboard(id)` (linha inteira);
  `definirStatusProjeto(body, adminEmail)` (valida contra `STATUS_GRAVAVEIS`, grava, corrige o cache, audita).
- **T2 — Persistência** `schema.ts` (+`admin_status_log` com `CREATE TABLE IF NOT EXISTS` + índice) e
  `client.server.ts` (`insertAdminStatusLog`, `getAdminStatusLogs`).
- **T3 — Rotas** `worker.ts`, todas sob `requireAdmin`: `GET /api/admin/dashboard/projetos[?refresh=1]` ·
  `GET /api/admin/dashboard/projetos/:id` · `POST /api/admin/dashboard/status`.
- **T4 — Frontend** `src/routes/_authenticated/dashboard.tsx` (REESCRITA): faixa de KPIs que são os filtros
  de status (contagem ao vivo), busca com debounce, tabela densa com **régua de status** na borda esquerda,
  ordenação por coluna, paginação, e `Dialog` de detalhe com todas as colunas agrupadas + ação de status.
  Identidade GoGroup (regra 11): estado nunca só por cor (ícone + rótulo), foco de teclado visível,
  `prefers-reduced-motion`, PT-BR com acento.
- **T5 — `StatusBadge`** (`src/components/status-badge.tsx`): adicionar `reprovado` (vermelho + `XCircle`) e
  `em validação`; e `reprovado` → `rejeitado` no `STATUS_FROM_LABEL` do sync reverso, para o reflexo interno
  não ficar cego ao rótulo novo.
- **T6 — Testes** `tests/dashboard-admin.test.ts`: mapeamento de linha, status vazio → `null`, contagem,
  ordenação (sem data vai ao fim), `numero` pt-BR, índice de busca sem acento, e o guard de que
  `definirStatusProjeto` **não** escreve "Atualizado Em".
- **T7 — Docs/regras** `worker.js` recomitado (regra 1) · `spec-docs/SPEC_DASHBOARD_ADMIN.md` + linha no
  `spec-docs/README.md` (regra 12) · `CLAUDE.md`: seção do dashboard **e fechar o aviso do bug de edição de
  legado** (o Luis confirmou nesta sessão que já foi resolvido).
- **T8 — Staging → prod** (regra 13): `edf400b4` primeiro, validar no navegador, só então `674a3710`.

### Critérios de aceitação
1. `/dashboard` lista os projetos da planilha; **nenhum rascunho** aparece; o status de cada linha é o da
   coluna "Status" (vazio → "—", nunca o status do SQLite).
2. Digitar parte do nome do projeto **ou** do autor filtra na tecla, sem requisição nova, e ignora acento.
3. Filtro por status com contagem ao vivo, incluindo Aprovado / Em validação / Reprovado / Reenvio Pendente.
4. Paginação com tamanho de página ajustável; a contagem exibida bate com o filtro aplicado.
5. Clicar numa linha abre o overlay com descrição e **todas** as colunas preenchidas da planilha, agrupadas;
   coluna desconhecida ainda aparece (seção "Outras colunas").
6. Mudar o status no overlay reflete na planilha (UPDATE in-place por `ID Projeto`, sem duplicar linha),
   aparece na tela na hora e grava uma linha em `admin_status_log`. "Atualizado Em" fica intacta.
7. `npm run test` + `npm run build` + `npm run build:worker` verdes, `worker.js` commitado.

### Fronteiras (não exceder)
- **Sem** mexer no `status` do SQLite nem na regra TEMPORÁRIA que grava "Pendente" na IDA (o write-back tem
  a mesma semântica de editar a célula à mão: um reenvio futuro volta a gravar "Pendente").
- **Sem** tocar "Atualizado Em", "Diff Horas / Antes", "Diff Saving / Antes" (colunas manuais).
- **Sem** editar dados do projeto (memorial, horas, saving) pela tela — só status/observações.
- **Sem** e-mail automático ao mudar status (o disparo já tem tela própria, `/email-legados`).
- **Sem** paginação/busca server-side: a planilha tem centenas de linhas, filtrar no cliente é mais rápido.

### Blast-radius
Arquivos: `src/lib/dashboard-admin.functions.ts` (novo) · `src/routes/_authenticated/dashboard.tsx`
(reescrita) · `src/components/status-badge.tsx` (+2 chaves) · `src/lib/google/sync-reverse.ts` (+1 rótulo)
· `src/integrations/db/schema.ts` + `client.server.ts` (tabela de auditoria) · `src/worker.ts` (3 rotas) ·
`tests/dashboard-admin.test.ts` (novo) · `worker.js` · `spec-docs/` + `CLAUDE.md`.
Dependentes: `StatusBadge` é compartilhado com `meus-projetos.tsx`/`projeto.$id.tsx` — só **acrescento**
chaves, nenhuma existente muda. `/api/admin/projetos` (SQLite) continua existindo para o resto do admin.
Invariantes preservadas: planilha = fonte de verdade do status; "Atualizado Em" = carimbo do sistema;
`updateRowByProjectId` nunca duplica linha.
Confiança: **alta** — os caminhos (readAllRows, updateRowByProjectId, requireAdmin, StatusBadge) foram
lidos direto nesta sessão.
Reuso: `readAllRows`/`updateRowByProjectId`/`parseDataFlexivel`/`StatusBadge`/`Dialog` reaproveitados; os
parsers `texto`/`numero` replicam 6 linhas privadas do `sync-reverse.ts` de propósito (não exportar dali
para não acoplar o dashboard ao módulo de sync).
