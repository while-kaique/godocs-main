# Plano — Pré-aprovação do líder: fila `/aprovacoes` + decisão na tela do projeto (F1)
**Status:** ✅ aprovado (Luis, 2026-08-03) — **na fila atrás da F0** (`teamguide-lideranca-e-areas.md`), que é o plano ativo

**Objetivo:** o líder direto do autor recebe os projetos do time numa fila própria (`/aprovacoes`), lê o projeto na tela read-only que já existe e **pré-aprova ou pré-reprova ali**, com o veredito espelhado na coluna `Aprovação do Líder` do Sheets — sem bloquear a triagem da RPA.

> Contexto e decisões D1–D10: `spec-docs/SPEC_APROVACAO_LIDER.md`. Esta é a fatia **F1** de lá.
> **Depende da F0** (`docs/plans/teamguide-lideranca-e-areas.md`, aprovada e ainda não codada): sem
> `getLideresDe()` não há como popular a fila nem rodar o gate de autorização. **Ordem decidida pelo Luis
> (03/08/2026): F0 primeiro, em sessão à parte, depois esta.**

### Decisões tomadas nesta sessão de planejamento (03/08/2026)

| # | Decisão | Por quê |
|---|---|---|
| **E1** | A fila é **rota própria `/aprovacoes`**, não a "5ª aba de Meus Projetos" que a spec previa. ⚠️ **Mudança de decisão** — atualizar a spec no mesmo PR (regra 12). | As 4 abas de `meus-projetos.tsx` (`Todos · Meus · Participo · Rascunhos`) são recortes do **mesmo** conjunto (o que você submeteu/participa) por papel/estado, com paginação e estados vazios compartilhados. A fila é de projetos de **outras pessoas** e o verbo é **decidir** — entraria herdando copy e paginação que não servem. |
| **E2** | **O líder VÊ o R$** ao decidir (exceção escopada à regra "cliente não vê financeiro de saving"). | Decisão do Luis. Ele julga materialidade; decidir sobre 44h/mês sem saber se isso é R$ 2 mil ou R$ 200 mil é decidir no escuro. A exceção vale **só** para quem tem aprovação **pendente** naquele projeto — o autor continua sem ver. |
| **E3** | O selo "Aprovações" na home **reusa o padrão do selo de pendências de legado** (`index.tsx:44-68` — fetch silencioso, "se falhar, o selo simplesmente não aparece"), como botão condicional **ao lado** do "Área Admin". | ⚠️ O "Área Admin" (`index.tsx:192`/`363`) é link **estático** para `/auth` (o gate é dentro do `/auth`, que devolve `/?acesso_negado`) — **não** existe nav condicional por usuário para pendurar o selo. Reuso do canônico que já vive na mesma página (RF-32), em vez de um 2º mecanismo de selo. |
| **E4** | **Sem 2ª coluna no Sheets.** A célula leva só o vocabulário fechado; quem/quando/comentário vivem no app (tela + `projeto_aprovacoes`). | O Luis criou **uma** coluna. Coluna ausente é ignorada com aviso — planejar contra o cabeçalho real. Se ele criar `Líder / Decidido em` depois, é fatia pequena à parte. |
| **E5** | **Sem backfill.** Projetos submetidos antes da F1 não ganham linha de aprovação retroativa: a célula fica `—` até o projeto ser reenviado. | Mesmo precedente do "Motivo Reenvio" (`docs/plans/motivo-reenvio-traco-padrao.md`): backfill de histórico é retroativo à parte, com decisão própria. Popular a fila com 887 linhas legadas também soterraria os líderes na estreia. |

### Tarefas

- **T1 — Tabela `projeto_aprovacoes` + `src/lib/aprovacoes.functions.ts`.** `CREATE TABLE IF NOT EXISTS` (padrão do `ajuda_chamados`): `projeto_id`, `versao`, `aprovador_email`, `aprovador_nome`, `veredito` (`pendente|aprovado|reprovado`), `comentario`, `criado_em`, `decidido_em`. Tabela **INTERNA** — não vai ao Sheets, fora de `SAFE_UPDATE_FIELDS`, sobrevive aos syncs. Funções: `criarAprovacoesPendentes(projetoId)` (resolve líderes via `getLideresDe` da F0; **sem líder → no-op silencioso**, D6; multi-time → 1 linha por líder e o **primeiro que decidir resolve**, D4), `listarAprovacoesPendentes(email)`, `decidirAprovacao(projetoId, email, veredito, comentario)`.
  _(guarda: testes das funções puras/decisoras — autor sem líder não cria linha; autor em 2 times cria 2 linhas e a 1ª decisão fecha as outras; reenvio (nova `versao`) reabre como `pendente`, D10)_

- **T2 — Gate server-side de autorização em `decidirAprovacao`.** Só grava se o **TeamGuide confirmar** que `email` lidera o autor **e** existir linha `pendente` da versão corrente — nunca confiar no frontend. Rejeição = **403**, não silêncio. Excluir da fila o que não faz sentido decidir: `status = 'rascunho'`, `descontinuado = 1` e projetos de teste E2E (`ehProjetoTesteE2E`).
  _(guarda: teste prova 403 para quem não lidera o autor, 403 para versão já decidida, e que rascunho/descontinuado não entram na fila)_

- **T3 — Acesso do líder ao detalhe (o ponto central).** ⚠️ Hoje `temAcesso = ehOwner || ehParticipante` (`meus-projetos.functions.ts:146`) → o líder leva **403** em `/api/meus-projetos/:id`. Estender o acesso de **leitura** a quem tem aprovação pendente do projeto, **sem** conceder edição: `podeEditar` NÃO muda (líder não vira editor — isso é `editores_delegados`, gotcha 3 da spec). O payload ganha um bloco `aprovacao: { pendente, versao, jaDecidida }` calculado **no servidor** (o frontend não decide se pode aprovar), e o **financeiro (E2)** só é incluído quando esse bloco diz que o requisitante é aprovador pendente.
  _(guarda: testes do predicado — líder lê e NÃO edita; ex-líder (deixou de liderar) perde a leitura; owner/participante seguem exatamente como hoje; o financeiro não aparece no payload de um participante comum)_

- **T4 — Rotas no `src/worker.ts`** (autenticadas, **não** admin — padrão do `POST /api/ajuda`): `GET /api/aprovacoes/pendentes` · `POST /api/aprovacoes/:id/decidir`.
  _(guarda: smoke das 2 rotas + teste de que ambas exigem sessão e a de decidir respeita o gate do T2)_

- **T5 — Selo "Aprovações" na home** (`src/routes/index.tsx`), reusando o padrão do selo de legado (E3): fetch silencioso, contador, botão só aparece com ≥1 pendente. Falha da busca → botão não aparece (nunca erro na cara do usuário).
  _(guarda: smoke do artefato servido — home renderiza o botão com contador quando o endpoint devolve itens, e não renderiza quando devolve vazio/erro)_

- **T6 — Rota `/aprovacoes`** (fila enxuta: autor, projeto, área, data, horas). **Sem ação de decidir na lista** (aprovação cega) — o clique abre `/projeto/$id`. Skill **`frontend-design` antes de codar** (regra 11); estado **nunca só por cor** (rótulo + ícone); PT-BR com acentos (regra 4).
  _(guarda: smoke do artefato servido — a fila lista os pendentes do líder e não expõe botão de decisão)_

- **T7 — Barra de ação em `/projeto/$id`** (rodapé fixo): *Pré-aprovar* · *Pré-reprovar* (com comentário), renderizada **só** quando o bloco `aprovacao.pendente` do T3 for verdadeiro. Junto dela, o bloco financeiro do **E2** (memorial enriquecido + `saving_reais`/`ganho_total`) — hoje a tela renderiza `p.documentacao.saving.memorial_calculo` (memorial do LLM, **sem** R$), então isto é render novo, não troca de fonte. Após decidir: volta a `/aprovacoes`, item fora da fila, toast.
  _(guarda: smoke — a barra aparece para o aprovador pendente e NÃO aparece para o autor/participante/admin-sem-aprovação; o R$ só aparece junto da barra)_

- **T8 — Espelho no Sheets, mão única.** Adicionar `'Aprovação do Líder'` ao `SHEET_COLUMNS` (`google/sheets.ts` — mapeada por **nome**, a posição no array é só documentação; a coluna **já existe** no cabeçalho, criada pelo Luis) e ao **row builder** de `google/sync.ts`, que serve append **e** update in-place — então o reenvio reescreve a célula sozinho (D10). Vocabulário **fechado**: `Pré-aprovado` · `Pré-reprovado` · `Pré-pendente` · `—` (autor sem líder). Valor **derivado da tabela** no momento do sync (sem coluna desnormalizada em `projetos` para divergir). ⚠️ **FORA de `SAFE_UPDATE_FIELDS`** (`sync-reverse.ts:222`) — pré-aprovação é decisão de **autorização**, e o sync reverso permitiria "pré-aprovar" digitando na célula. ⚠️ Não confundir com `Motivo Reenvio`, que é manual e o update nunca toca: aqui é o **oposto**, o update **tem** que escrever.
  _(guarda: teste do derivador puro nos 4 casos; teste de que a coluna NÃO está em `SAFE_UPDATE_FIELDS`; teste de que o update in-place inclui a chave e o `Motivo Reenvio` continua intocado)_

- **T9 — Spec + regras do repo.** Atualizar `spec-docs/SPEC_APROVACAO_LIDER.md`: a mudança de decisão do **E1** (5ª aba → rota própria), o **E2** (líder vê R$ — é exceção a uma regra do `CLAUDE.md`, tem que ficar escrito), **E4/E5**, e o P2 do §6 como **resolvido**. Atualizar o `CLAUDE.md` (regra 7/12) no bullet de ownership e no de "cliente não vê financeiro de saving", que passa a ter exceção nomeada.

- **T10 — `npm run test` verde + `worker.js` rebuildado e commitado** (regras 1 e 2): mexe em `worker.ts` e em funções server-side → `npm run build:worker` obrigatório.

### Critérios de aceitação

1. Autor com líder submete → nasce linha `pendente` em `projeto_aprovacoes` e a célula `Aprovação do Líder` vira **`Pré-pendente`**; autor **sem** líder (`rafael@gocase.com`, D6) → nenhuma linha, célula **`—`**, nenhum erro no log.
2. O líder vê o projeto em `/aprovacoes`, abre `/projeto/$id` **sem 403**, vê o R$ (E2) e a barra de ação; decide → célula vira `Pré-aprovado`/`Pré-reprovado` e o item sai da fila.
3. Quem **não** lidera o autor recebe **403** no `POST /api/aprovacoes/:id/decidir`, mesmo forjando o request (gate server-side, não frontend).
4. O autor e um participante comum abrem `/projeto/$id` e **não** veem barra de ação nem R$; `podeEditar` de todos os papéis fica **idêntico** ao de hoje.
5. Reenvio do projeto volta o veredito a `Pré-pendente` (D10) e a triagem segue funcionando com o líder pendente (D3 — não bloqueia).
6. Digitar `Pré-aprovado` na planilha à mão **não** muda nada no SQLite (coluna fora de `SAFE_UPDATE_FIELDS`).
7. `npm run test` verde e `worker.js` commitado.

### Fronteiras (não exceder)

- **FORA: a F0.** `getLideresDe()`/`buildLiderancaIndex()`, a paginação e o fallback de área são do plano `teamguide-lideranca-e-areas.md`, em sessão à parte e **antes** desta.
- **FORA: a F2** — `src/lib/google/chat-dm.ts` e qualquer envio de DM no Google Chat. O líder descobre a fila pelo selo da home nesta fatia. `GOOGLE_CHAT_DM_ENABLED` fica `false`.
- **FORA: 2ª coluna no Sheets** (`Líder / Decidido em`) — E4.
- **FORA: backfill** dos projetos já submetidos — E5.
- **FORA: bloquear a triagem** pela pré-aprovação (D3) e **FORA** de mexer no `CHECK` de `projetos.status` ou no significado da coluna `Status` oficial.
- **FORA: dar edição ao líder** (`editores_delegados` é decisão separada) e **FORA** de mexer em ownership/`descontinuado`.
- **FORA: deploy.** Staging (`edf400b4`) → prod (`674a3710`) entram na sessão seguinte (regra 13).

### Blast-radius

**Arquivos (produção):** `src/lib/aprovacoes.functions.ts` (novo) · `src/lib/meus-projetos.functions.ts` (acesso + payload — T3) · `src/worker.ts` (2 rotas) · `src/lib/google/sheets.ts` (`SHEET_COLUMNS`) · `src/lib/google/sync.ts` (row builder) · `src/lib/chat.functions.ts` (`submeterParaValidacao` chama `criarAprovacoesPendentes`) · `src/routes/index.tsx` (selo) · `src/routes/aprovacoes.tsx` (novo) · `src/routes/projeto.$id.tsx` (barra + financeiro) · `integrations/db` (tabela).

**Dependentes:** `submeterParaValidacao` é **caminho quente da submissão** — a criação de aprovações tem que ser **best-effort** (padrão `runBackground`/`waitUntil`), nunca derrubar a submissão · `getMeuProjeto` serve `/projeto/$id` **e** o seed da edição (mudar o predicado de acesso mexe nos dois) · `readAllRows`/`/dashboard` leem a linha inteira do Sheets (coluna nova aparece na ficha da triagem) · `syncSheetsToSqlite` e `syncOwnerRowsFromSheet` percorrem `SAFE_UPDATE_FIELDS` (a exclusão da coluna nova é o que impede a escrita fake).

**Invariantes:** `docs/invariants.md` **não existe** neste projeto (nem `docs/INDEX.md`, nem `scripts/ctx-route.sh`) → sem INV-XX formal e **sem o acelerador de glob**; os invariantes efetivos vêm do `CLAUDE.md`: nunca ler `process.env` em escopo de módulo · `worker.js` commitado (r1) · testes (r2) · PT-BR com acentos (r4) · banco async com params (r6) · worktree (r8) · `frontend-design` antes de UI (r11) · spec no mesmo PR (r12) · staging antes de prod (r13). Mais os da spec: cota da TeamGuide é compartilhada (cachear o índice, nunca chamar por item numa listagem) e a coluna precisa existir no cabeçalho.

**Confiança: média.** Os 2 achados que sustentam o T3 e o T7 (`temAcesso` 403 para o líder; a tela renderiza o memorial do LLM sem R$) vieram de leitura direta do código nesta sessão. Mas sem `INDEX.md`/`invariants.md` o mapa de dependentes saiu de grep pontual — **a varredura completa é papel do `/ggsd:code`**, com atenção especial aos consumidores de `getMeuProjeto` e ao caminho de submissão.

**Risco: ALTO** — é a fatia mais larga desta frente (10 arquivos de produção, 2 telas, 1 tabela, 1 coluna de planilha, 1 mudança de predicado de acesso). Se a sessão de código ficar grande demais, a quebra natural é **T1–T4 + T8 (backend + espelho) primeiro, T5–T7 (UI) depois** — mas aí o 1º PR entrega fila sem tela, então **não** deployar o backend sozinho em prod.

### Capturado-e-adiado (ADR-028 — não é desta fatia)

**`getMeuProjeto` já devolve `saving_reais` e `memorial_calculo` (com R$) para o autor e para participantes** — a tela simplesmente não os renderiza (usa o memorial do LLM). Ou seja, a regra "cliente não vê financeiro de saving" é hoje garantida **no frontend**, e o R$ viaja no payload de quem não deveria vê-lo (visível em devtools). **É pré-existente, não introduzido pela F1**, e o E2 não piora (o líder passa a ver por decisão). Merece plano próprio: strip server-side do financeiro para quem não é staff nem aprovador. Não corrigir de carona aqui.
