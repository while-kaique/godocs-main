# Plano — SQLite como fonte de LEITURA das telas (espelho da planilha)

**Status:** ✅ aprovado (Luis, 2026-08-11)

**Objetivo:** as telas de listagem (**Meus Projetos** e **/dashboard**) param de ler o Google Sheets em
tempo de request e passam a ler um **espelho da planilha dentro do SQLite**, atualizado por **cron a cada
5 min** e remendado na hora pelas nossas próprias escritas. A planilha continua sendo a **fonte da
verdade** e o **único lugar onde se edita/insere** — o que muda é de onde a tela lê.

## Por que (o problema medido)

- `listarMeusProjetos` chama `syncOwnerRowsFromSheet(email)`, que faz um **`readAllRows()` INTEIRO da
  planilha a cada load de página** — visível nos logs de prod agora: `[sync-reverse:owner]
  email=… total=9 … ignorados=9` em cada `GET /api/meus-projetos`. Uma leitura do Sheets custa ~1,5–2,5 s
  e a cota (60 leituras/min) é compartilhada com prod.
- `/dashboard` lê a planilha e esconde o custo atrás de um **cache de 60 s com SWR + patches em memória**
  (~120 linhas de máquina de estado que existem só porque a leitura é lenta).
- Efeito colateral relatado por usuários: **"projeto bugado na lista"** — a listagem depende de um sync
  sob demanda que roda no meio do request; quando ele falha (cota/timeout), a tela cai num estado
  parcial (status "—", projeto morto que não sai). Com o espelho, a lista é sempre o retrato do último
  sync bem-sucedido, e a **remoção dos mortos** acontece no cron, não por sorte no page load.

## Decisão de arquitetura (e a alternativa descartada)

- **Push do Sheets (Apps Script → nosso endpoint) está FORA**: o edge do Godeploy exige OAuth em TODAS
  as rotas — provado agora com `curl`, `POST /api/cron/sync-sheets-to-sqlite` sem sessão devolve **302**
  para `devgogroup.com/auth/login`. Um trigger de planilha não tem como autenticar. **Não tentar de novo.**
- Substituto: **cron de 5 min** (a plataforma aceita até 1 min; hoje o `sync-sheets-to-sqlite` roda 1×/h).
  Fica barato porque o espelho é **hash-gated**: linha que não mudou não gera escrita.
- O espelho guarda **a linha crua da planilha** (JSON chaveado pelo nome real da coluna). Isso é o que faz
  a mudança ser de baixo risco: `mapResumo`, a ficha de triagem e o parser do parecer do líder
  (`interpretarParecerLider`) continuam operando sobre um `SheetRow`, sem reescrever regra de negócio.

### Tarefas
- **T1 —** Tabelas `sheet_espelho` (linha crua + `linha_resumo` + `linha_hash` + `patch`/`escrito_em`) e
  `sync_runs` no `SCHEMA_SQL`, + helpers em `client.server.ts` (upsert hash-gated, remoção de ausentes,
  leitura por ids/resumos/linha, registro de run). ⚠️ comentário no `SCHEMA_SQL` **sem ponto-e-vírgula**
  (o `initSchema` divide por `;`). (guarda: `tests/sheet-espelho.test.ts` — upsert idempotente: 2ª passada
  com a mesma linha **não** escreve; remoção só de ausente)
- **T2 —** Módulo PURO `src/lib/dashboard-resumo.ts` com os mappers que hoje moram em
  `dashboard-admin.functions.ts` (`texto`/`numero`/`chaveStatus`/`chaveBusca`/`mapResumo`/`ordenarPorDataDesc`/
  `contarPorStatus`) + a constante DECLARADA `COLUNAS_RESUMO` (as colunas curtas da listagem).
  `dashboard-admin` **re-exporta** (fonte única, nada redigitado — mesmo padrão de `coluna-chave.ts`, que
  foi extraído porque a tela roda no cliente). (guarda: teste de que `mapResumo(linhaCheia)` ==
  `mapResumo(recorte por COLUNAS_RESUMO)` — pega coluna nova esquecida na lista)
- **T3 —** `src/lib/sheet-espelho.ts`: `espelharLinhas(rows, inicioMs)` · `removerEspelhoAusentes(ids)` ·
  `lerLinhasEspelho(ids)` · `lerResumosEspelho()` · `lerLinhaEspelho(id)` · `espelharEscrita(id, valores)` ·
  `statusEspelho()`. (guarda: teste do `patch` — escrita que aterrissou DEPOIS do início da leitura
  sobrevive ao upsert do sync; escrita anterior é legitimamente substituída pela planilha)
- **T4 —** `sync-reverse.ts` robusto: (a) `readAllRows` com **retry/backoff** (3 tentativas); (b) carga em
  **LOTE** dos projetos — fim do `getProjetoById` por linha (hoje são N round-trips e é por isso que o
  sync só cabia 1×/h); (c) espelha todas as linhas + remove ausentes; (d) registra a corrida em
  `sync_runs`. (guarda: `tests/sync-reverse.test.ts` + casos novos — retry, ausência de N+1, run
  registrada, leitura falha → **não remove nada**)
- **T5 —** `/dashboard` lê o espelho: `listarProjetosDashboard`/`getProjetoDashboard` sem `readAllRows`;
  **sai** o cache de 60 s / SWR / patches em memória (existiam só para esconder a leitura lenta);
  `?refresh=1` passa a significar "**sincroniza de verdade agora** e relê". (guarda:
  `tests/dashboard-swr.test.ts` e `dashboard-swr-escrita.test.ts` reescritos para as invariantes novas —
  status recém-gravado não volta atrás, leitura não bloqueia no Sheets, ficha traz a linha inteira)
- **T6 —** `listarMeusProjetos` para de chamar `syncOwnerRowsFromSheet` e lê o espelho pelos ids do
  usuário; **auto-cura**: espelho mais velho que 30 min dispara um sync em `runBackground` (single-flight,
  não bloqueia a resposta). (guarda: teste de que a listagem **não** toca `readAllRows` e que
  status/motivos/`atualizado_em` vêm do espelho)
- **T7 —** **Invariante nova:** toda escrita nossa na planilha remenda o espelho na hora —
  `definirStatusProjeto` (triagem), `descontinuarProjeto`, `syncSubmitToGoogle` (append/update),
  `syncUpdateToGoogle` (analisador) e as 2 colunas do líder em `aprovacoes.functions.ts`. Sem isso, uma
  submissão nova ficaria sem Status até o próximo cron. O cron é a **rede** (esquecer um ponto custa ≤5 min
  de atraso, não uma mentira permanente). (guarda: um teste por caminho)
- **T8 —** Cron `*/5 * * * *` substituindo o horário (nos 2 apps) + rota `GET /api/admin/sync-status`
  (última run: quando, ok, contadores). (guarda: `listCronJobs` mostra a cadência nova; endpoint responde)
- **T9 —** Frontend `/dashboard`: o cabeçalho passa a dizer **"espelho de HH:MM"** e avisa quando está
  velho (>20 min) — com ícone/rótulo, **estado nunca só por cor** (regra 11).
- **T10 —** Docs: `CLAUDE.md` (seção **Sync Google** + os gotchas **(1)** e **(3)** do Dashboard, que mudam
  por decisão), `docs/database.md` (2 tabelas novas), `docs/backend.md` (rota + cron),
  `spec-docs/SPEC_DASHBOARD_ADMIN.md` e `spec-docs/SPEC_FEATURES_NOVAS.md` (regra 12).
- **T11 —** `npm run test` + `npm run build` + `npm run build:worker` **commitado** (regra 1).
- **T12 —** Deploy **staging `edf400b4`** → validar no navegador → **prod `674a3710`** (regra 13).

### Critérios de aceitação
1. Nenhuma rota de listagem chama `readAllRows` no caminho de request: `/api/meus-projetos`,
   `/api/admin/dashboard/projetos` e a ficha do dashboard.
2. Meus Projetos e /dashboard mostram **os mesmos valores de hoje** (Status, motivos, parecer do líder,
   colunas manuais da ficha) — a origem muda, o conteúdo não.
3. Projeto apagado da planilha **desaparece** das duas telas depois do próximo sync (≤5 min), sem depender
   de um sync sob demanda dentro do page load.
4. Status gravado na triagem aparece **na hora** e **não volta atrás** quando um sync que começou antes da
   escrita termina depois dela.
5. Sync que falha (Sheets 429/503) **não apaga nada** e fica registrado em `sync_runs` com `ok=0`.
6. Submissão nova aparece na lista do autor com Status "Pendente" **sem esperar o cron**.
7. Cron de 5 min ativo; `GET /api/admin/sync-status` mostra a última corrida.
8. `npm run test` verde e `worker.js` rebuildado no commit.

### Fronteiras (não exceder)
- **O ciclo de IDA não muda** (quem escreve o quê na planilha, `padronizarLinha`, `SAFE_UPDATE_FIELDS`,
  exclusão do `status` na volta, regra TEMPORÁRIA do "Pendente") — nada disso é assunto desta fatia.
- **`reconciliarComplexidade`** (cron de 1 min, hoje o maior consumidor de cota: um `readAllRows` por
  minuto) e **`/email-legados`** seguem lendo a planilha ao vivo → **fatia própria**.
- **`reconciliar-financeiro`** continua lendo a planilha (é reparo *fail-closed*, precisa do dado vivo).
- **Sem webhook do Sheets** (provado impossível — 302 do edge).
- **Sem backfill/migração**: o espelho nasce no 1º sync depois do deploy.
- Não mexer no `CHECK` de `projetos.status` nem em `projeto_aprovacoes`.

### Blast-radius
Arquivos: `src/integrations/db/schema.ts` · `client.server.ts` · **novos** `src/lib/sheet-espelho.ts` e
`src/lib/dashboard-resumo.ts` · `src/lib/google/sync-reverse.ts` · `dashboard-admin.functions.ts` ·
`meus-projetos.functions.ts` · `google/sync.ts` · `aprovacoes.functions.ts` · `worker.ts` ·
`routes/_authenticated/dashboard.tsx` + testes.
Dependentes: as duas telas de listagem, a ficha de triagem, o cron da volta, o selo de pendentes da home,
o disparo de e-mails (indireto — segue no Sheets).
Invariantes tocados **por decisão** (registrar na spec, não "consertar" depois): gotcha **(1)** do
`SPEC_DASHBOARD_ADMIN` ("a listagem lê `readAllRows`, NÃO o SQLite") passa a ser "lê o **espelho** da
planilha, nunca o estado interno de `projetos`" — o motivo original do gotcha (rascunho aparecia; status do
banco não é verdade) continua honrado, porque o espelho **é** a planilha; gotcha **(3)** (cache 60 s + SWR
+ patches) **sai**, substituído pelo espelho + `patch` na tabela. Segue valendo: "Status vem do Sheets"
(agora do espelho do Sheets), listagem enxuta (por isso `linha_resumo` — o gotcha dos 32 MiB de RPC do
Investigador vale aqui), rascunho nunca aparece.
Confiança: **média-alta** (li os 6 arquivos centrais e os logs/crons de prod) — mas o projeto **não tem
`docs/INDEX.md`/`invariants.md`**, então a varredura de dependentes reais fica para o `/ggsd:code`.

### Nota de ferramenta (custo conhecido)
O `plan-gate.sh`/`gate-d.sh` resolvem tudo contra o `CLAUDE_PROJECT_DIR` (a **raiz**), então este plano é
escrito na raiz enquanto o **código** vai no worktree `.claude/worktrees/sqlite-fonte-leitura`
(branch `feat/sqlite-fonte-de-leitura`, regra 8). No fechamento, os docs desta sessão são copiados para a
branch e a raiz é restaurada — a `main` local não fica suja.
