# Plano — abrir a ficha de triagem sem espera (`/dashboard`)
**Status:** ✅ aprovado (Luis, 13/08/2026)

**Objetivo:** tirar a espera perceptível de **abrir uma linha** no `/dashboard`: começar a
requisição da ficha **antes do clique** (prefetch por intenção) e parar de pagar duas idas
ao SQLite em série no servidor.

## Diagnóstico (feito por leitura do código, não por suposição)

A lentidão que sobrou **não é a planilha**. O espelho já tirou o `readAllRows()` do request
(a listagem lê `sheet_espelho`), e a rota do detalhe também: `getProjetoDashboard` chama
`lerLinhaEspelho` — SQLite, `projeto_id` é PRIMARY KEY. O que custa é:

1. **Uma requisição inteira no caminho crítico do clique.** Medido em prod e já registrado no
   `CLAUDE.md`: qualquer rota do GoDocs custa **~750–800 ms de overhead FIXO** (gate de OAuth
   do edge) — inclusive `/favicon.svg`, que não faz trabalho nenhum. Hoje o
   `ProjetoDetalheDialog` só dispara o fetch **no `useEffect` do `id`**, isto é, depois do
   clique. Nada é aquecido, nada é guardado: reabrir a MESMA linha paga tudo de novo.
2. **Duas leituras SQLite em SÉRIE** dentro de `getProjetoDashboard`
   (`src/lib/dashboard-admin.functions.ts:168`): `await lerLinhaEspelho(id)` e, só depois,
   `await getAdminStatusLogs(id)`. São independentes — o histórico só começa quando a linha
   chega. No Godeploy cada round-trip é RPC de Durable Object.
3. Enquanto isso, o corpo do overlay é **spinner puro** ("Carregando a linha da planilha…"),
   então os ~1 s aparecem como tela vazia.

`requireAdmin` fica de fora do escopo: para admin de `ADMIN_EMAILS` o `isAdmin` nem consulta
o banco (`envAdmins()` curto-circuita).

### Tarefas
- **T1 —** Paralelizar as duas leituras de `getProjetoDashboard` com `Promise.all`, com o
  `catch` do histórico **DENTRO** do `Promise.all` (guarda: o 404 de "projeto não está na
  planilha" é lançado depois, e a rejeição do log não pode escapar como *unhandled*;
  histórico que falha continua devolvendo `[]` e a ficha continua abrindo).
  (guarda: `tests/dashboard-admin.test.ts` e `tests/dashboard-espelho.test.ts` já cobrem
  ficha OK, `historico: []` e o 404 — têm de seguir verdes sem edição)
- **T2 —** Novo módulo `src/lib/dashboard-detalhe-cache.ts` (irmão do `dashboard-prefetch.ts`):
  `obterDetalhe(id)` · `prefetchDetalhe(id)` · `agendarPrefetchDetalhe(id)` /
  `cancelarPrefetchDetalhe()` · `invalidarDetalhe(id)` · `limparDetalhes()`, com **TTL de 30 s**,
  **teto de entradas**, **erro nunca cacheado** e fetcher injetável.
  (guarda: `tests/dashboard-detalhe-cache.test.ts` — novo)
- **T3 —** `ProjetoDetalheDialog` passa a pedir a ficha por `obterDetalhe` (aproveita o que o
  hover aqueceu) e **invalida** a entrada depois de gravar status/motivos.
  (guarda: teste de que gravar invalida — a próxima abertura refaz o fetch)
- **T4 —** Linha da tabela do `/dashboard` dispara `agendarPrefetchDetalhe` no
  `mouseenter`/`focus` e cancela no `mouseleave`/`blur`; o botão "Atualizar" (que sincroniza de
  verdade) chama `limparDetalhes()`.
  (guarda: `npm run test` + validação no navegador da staging)
- **T5 —** `npm run test && npm run build && npm run build:worker` + **commitar o `worker.js`**
  (regra 1 — `dashboard-admin.functions.ts` é server-side).
- **T6 —** `CLAUDE.md` (seção *Dashboard do admin* + o bullet de performance de navegação) e
  `spec-docs/SPEC_CORRECOES.md` (sintoma → causa → fix → onde aterrissou), regras 7 e 12.
- **T7 —** Deploy **staging `edf400b4`** e validar abrindo fichas; **só então** prod `674a3710`
  (regra 13).

### Critérios de aceitação
1. Passar o mouse ~0,2 s sobre uma linha e clicar abre a ficha **sem spinner perceptível**
   (a resposta já estava em voo ou concluída).
2. Rolar a tabela com o mouse atravessando muitas linhas **não** dispara uma requisição por
   linha (o atraso de 150 ms + cancelamento no `mouseleave` seguram).
3. Fechar e reabrir a mesma ficha dentro de 30 s **não** gera requisição nova.
4. Gravar status → reabrir a ficha mostra o valor **novo** (a entrada foi invalidada), e o
   "Atualizar" que sincroniza limpa todas.
5. Falha na ficha (403/rede/edge) **não** fica presa no cache: a abertura seguinte tenta de
   novo e mostra o erro real.
6. O servidor faz as 2 leituras em paralelo e nenhuma delas é o Google Sheets.
7. `npm run test` verde; `worker.js` commitado.

### Fronteiras (não exceder)
- **Nada de cache em `localStorage`/SQLite** — a decisão de produto de 28/07/2026 mantém isso
  fora, e ela não está sendo revisitada. O cache aqui é **em memória, por aba, 30 s**.
- **Não** mexer no write-back de status (nem encostar em "Atualizado Em"), nem no `status` do
  SQLite, nem na régua do espelho (`patch`/`escrito_em`).
- **Não** transformar o overlay em render progressivo dos campos do resumo (é outra fatia, de
  UI); esta fatia só ataca a CONTAGEM de requisições e a serialização no servidor.
- **Não** tocar a listagem nem o `dashboard-prefetch.ts` existente.

### Blast-radius
**Arquivos:** `src/lib/dashboard-admin.functions.ts` (só `getProjetoDashboard`) ·
`src/lib/dashboard-detalhe-cache.ts` (novo) ·
`src/components/dashboard/projeto-detalhe-dialog.tsx` ·
`src/routes/_authenticated/dashboard.tsx` · `tests/dashboard-detalhe-cache.test.ts` (novo) ·
`worker.js` (rebuild) · `CLAUDE.md` · `spec-docs/SPEC_CORRECOES.md`.

**Dependentes:** `getProjetoDashboard` tem **um** chamador de produção (a rota
`GET /api/admin/dashboard/projetos/:id` no `worker.ts`) + 2 testes existentes. O módulo novo
nasce sem dependentes fora da tela.

**Invariantes tocados (do `CLAUDE.md`):**
- *"a listagem/ficha é a LINHA DA PLANILHA lida do ESPELHO — reintroduzir leitura do Sheets no
  caminho de request é regressão"* → **respeitado**: o prefetch aquece a rota do detalhe, que lê
  só o espelho.
- *"`preload` NÃO pode disparar I/O"* (as 2 travas do link "Dashboard") → este plano **introduz
  I/O no hover de propósito**, e a razão de ser seguro é declarada: o alvo é SQLite local, não a
  planilha, então **não consome a cota de 60 leituras/min compartilhada com prod**. ⚠️ Condição
  que inverte isso: se a rota do detalhe algum dia passar a ler o Sheets, o prefetch por hover
  sai no MESMO commit — vai escrito no cabeçalho do módulo.
- *"cache da listagem em localStorage/SQLite é FORA (28/07/2026)"* → não violado (em memória, e é
  a **ficha**, não a listagem).
- Risco próprio, mitigado: a ficha semeia os campos **Observações/Motivo Reenvio/Motivo
  Reprovado** que a triagem regrava. Servir ficha velha alargaria a janela de sobrescrever texto
  mais novo da planilha → daí **TTL de 30 s** (cobre hover→clique e o reabrir imediato, nada
  além) **+ invalidação ao gravar**.

**Reuso (RF-32/34):** o padrão canônico de prefetch já existe — `src/lib/dashboard-prefetch.ts`
(promise em voo, erro nunca cacheado, teto de idade). Esta fatia **herda o padrão** (mesmas
decisões, mesmo vocabulário) em **módulo irmão**, e não estende o arquivo existente porque a
semântica difere de propósito: aquele é um **slot único de consumo único** para a listagem (a 2ª
chamada devolve `null`); este é um **mapa por id, multi-consumo, com invalidação explícita**.
Enfiar os dois no mesmo módulo seria a "abstração errada" do RF-34.

**Confiança:** alta sobre o código (li os 6 arquivos envolvidos, o schema do espelho e as duas
queries), **média** sobre o processo: o repo **não tem `docs/INDEX.md` nem `docs/invariants.md`**
(nem `scripts/ctx-route.sh`), então a consulta mecânica de blast-radius não existe — a varredura
completa de dependentes fica para o `/ggsd:code` (RF-35).

### Onde esta fatia aterrissa (decisão de branch)
O código do espelho **só existe na `feat/espelho-e-perf-navegacao`** (worktree
`.claude/worktrees/espelho-e-perf`), que já está **em produção e ainda não foi pushada** — o
`main` não tem nem o espelho nem os 2 commits de perf do Kaique. Esta fatia **depende** daquele
código (`lerLinhaEspelho`) e é do **mesmo assunto** (perf de navegação), então o default é
implementá-la **na mesma branch**, entrando no mesmo PR. A alternativa (branch empilhada) só
faz sentido se o PR do espelho tiver de sair intacto primeiro.

**Decidido pelo Luis (13/08/2026): mesma branch** — `feat/espelho-e-perf-navegacao`, worktree
`.claude/worktrees/espelho-e-perf`. Um PR só, um rebuild de `worker.js`.
