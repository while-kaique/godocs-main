# SPEC — Dashboard do admin: triagem sobre a planilha

> **Documento de planejamento/decisão.** Decisões fechadas com o Luis em **2026-07-28**.
> Plano de execução: [`docs/plans/dashboard-admin-sheets.md`](../docs/plans/dashboard-admin-sheets.md).
> Status: ✅ **implementado** (código + testes + build) · ⏳ validação em staging → prod.

## 1. Problema

`/dashboard` era uma lista de 110 linhas lendo `getProjetos()` → `getProjetosWithArea()` — **SQLite**.
Dois sintomas relatados pelo Luis:

1. **Rascunho aparecia** em "Todos os Projetos". Rascunho é estado interno do app e **nunca** vai à
   planilha; numa tela de triagem ele é ruído puro.
2. **O status estava errado.** O `status` do SQLite não é fonte de verdade: o sync reverso o **exclui**
   de propósito (`SAFE_UPDATE_FIELDS`), porque quem manda é a coluna **"Status"** do Sheets, mantida à
   mão por quem valida. "Meus Projetos" já lia o Sheets; o dashboard do admin, não.

Consequência prática: **a validação acontecia na planilha**, não no app — sem busca decente, sem filtro
por fila, sem ver a linha inteira de um projeto num lugar organizado.

## 2. Decisões fechadas (NÃO "corrigir" por engano)

- **D1 — A planilha é a fonte da listagem.** A tela lista **a LINHA DA PLANILHA**, nunca o estado interno
  de `projetos`. **Não voltar a ler o `projetos`**: seria reintroduzir o bug.
  ⚠️ **Emenda 11/08/2026 (D11):** a linha deixou de vir de `readAllRows()` no request e passa a vir do
  **espelho** (`sheet_espelho`, ver D11) — a fonte continua a planilha, mudou de onde se lê.
  Efeitos aceitos e desejados: rascunho não aparece; colunas manuais ("Diff Horas / Antes",
  "Diff Saving / Antes", "Observações") chegam de graça; um projeto que falhou o append de IDA não
  aparece aqui (é o mesmo buraco que a reconciliação de exclusão já trata).
- **D2 — Write-back só na planilha.** Mudar o status escreve **"Status"** (+ **"Observações"** quando há
  motivo) via `updateRowByProjectId` — UPDATE in-place por `ID Projeto`, nunca duplica linha. É a mesma
  semântica de editar a célula à mão, inclusive na consequência: pela regra **TEMPORÁRIA**, um reenvio
  futuro volta a gravar "Pendente" por cima. Isso **não** é bug desta tela.
- **D3 — "Atualizado Em" é intocável.** Aquela coluna é o carimbo da última escrita do **sistema** e é o
  que decide se um legado está regularizado (`pendente` em Meus Projetos). Marcar status **não** é editar
  o projeto; preenchê-la aqui daria baixa numa pendência que ninguém resolveu. Guard em teste
  (`tests/dashboard-admin.test.ts`, "NUNCA escreve Atualizado Em").
- **D4 — O `status` do SQLite não é tocado.** Pertence ao fluxo de submissão/análise, e o sync reverso o
  ignora. A única ponte que existe segue sendo a que já existia: "Descontinuado" na planilha → flag
  `descontinuado` no SQLite (mão única, `sync-reverse.ts`).
- **D5 — ~~Cache de 60 s com single-flight~~ (SUPERADA pela D11, 11/08/2026 — mantida como registro do porquê).** Ler a planilha custa ~1–3 s. N admins abrindo a tela ao mesmo
  tempo geram **uma** leitura; o botão "Atualizar" (`?refresh=1`) fura o cache. Depois de gravar um
  status, a linha é **corrigida no cache** em vez de reler tudo — a tela reflete na hora.
- **D9 — ~~Cache vencido serve dado velho e revalida em background (stale-while-revalidate)~~ (SUPERADA pela D11 — mas leia: as GARANTIAS dela continuam valendo, só mudaram de mecanismo).** Medido em
  28/07/2026: a leitura é **1.450–2.360 ms** para **2,65 MB** (544 linhas × 48 colunas) e **estreitar o
  range não ajuda** (`A1:ZZ` vs `A1:AV` dão o mesmo payload — o peso é volume de células). Com TTL puro, o
  primeiro admin que chegava depois do vencimento pagava a leitura inteira; a espera "aparecia do nada" a
  cada minuto. Agora `lerPlanilha` devolve o cache **vencido na hora** e dispara a releitura via
  `runBackground()` (→ `ctx.waitUntil`, obrigatório no Godeploy), preservando o single-flight; só **bloqueia**
  quando não há cache (isolate frio) ou `?refresh=1`. `revalidando: true` no payload → a tela mostra
  "Atualizando em segundo plano" (ícone + texto). Falha da revalidação **não** rejeita a request nem
  envenena o cache. Serve listagem **e** ficha (mesmo `lerPlanilha`). Consequência aceita: a triagem pode
  ver dado de até ~1 min de idade — quem acabou de gravar um status vê o valor novo, porque a escrita
  corrige a linha no cache (D5) — e essa correção **sobrevive** à revalidação em voo, ver abaixo.
  ⚠️ **Ordenação leitura × escrita (achados do revisor de qualidade, 28/07/2026 — não podem regredir):**
  (a) toda escrita de status registra um **patch** (`patchesEscritos`, por `projeto_id`) que é **reaplicado**
  sobre as linhas de qualquer leitura que **começou antes** dela — sem isso a releitura em voo instalava a
  célula antiga e o status recém-decidido "voltava atrás" por até 60 s; (b) leitura de uma **era** anterior
  (`invalidarCacheDashboard` incrementa `epoca`) ou **mais velha** que a já instalada (`seqLeitura`) **não**
  instala nada; (c) **`?refresh=1` não herda** a revalidação em voo (`iniciarLeitura(true)` abre leitura
  nova) — senão o "Atualizar" devolvia snapshot anterior à edição manual da planilha; (d) **teto de idade**
  `STALE_MAX_MS = 10 × TTL`: com o Sheets falhando, passado o teto a leitura volta a **bloquear e propagar o
  erro** em vez de servir dado de horas atrás para quem decide status.
- **D10 — Cache do auth no cliente em `sessionStorage`, e prefetch da planilha em paralelo ao auth.**
  O `beforeLoad` de `/_authenticated` bloqueava a tela em "Verificando permissões..." e só **depois** o
  componente pedia a planilha — fila indiana de dois custos independentes. Agora: (a) o usuário fica em
  `sessionStorage` (`godocs:auth-v1`, TTL 5 min, `src/lib/auth-cache.ts`), com o cache em memória como 1º
  nível, e é **revalidado em background** para não fixar permissão revogada — reload/navegação não voltam à
  tela de espera; (b) quando o destino é `/dashboard`, `iniciarPrefetchDashboard()` dispara a leitura
  **antes** do `await` do auth e a tela consome a promise (`src/lib/dashboard-prefetch.ts`). **Por que é
  seguro:** o gate real é server-side (`requireAdmin` em toda `/api/admin/*`); o cliente só decide o que
  pintar, e o prefetch de um não-admin recebe 403 e é descartado. O slot do prefetch tem **teto de idade**
  (`PREFETCH_MAX_MS` 15 s): prefetch de navegação abortada não fica retido pela vida da aba servindo dado
  velho. **Conhecido/aceito:** quando a revalidação do auth descobre acesso revogado, os caches são limpos
  mas a tela aberta só sai do layout admin na próxima navegação (as chamadas de dados já dão 403). **`sessionStorage`, não `localStorage`** —
  permissão não deve sobreviver ao fechamento do navegador; o custo é 1 fetch por aba nova.
- **D6 — Payload em duas camadas.** A listagem manda só campos de tabela; memoriais e justificativas
  (vários KB por projeto) só no detalhe, que sai do mesmo cache. **Não** engordar a listagem: com ~300
  projetos, mandar memorial junto passaria de 1 MB para exibir 25 linhas.
- **D7 — Busca no cliente, índice no servidor.** `mapResumo` pré-computa `busca` (minúsculas, **sem
  acento**) com nome do projeto, autor, e-mail, ID, área e ferramenta; o cliente filtra por token em AND.
  Responde na tecla. Buscar no servidor seria mais lento e não mais correto.
- **D8 — Auditoria própria.** A planilha não guarda autoria de célula. Tabela **`admin_status_log`**
  (projeto, de → para, motivo, admin, quando) responde "quem aprovou isto?". É registro paralelo: se a
  gravação da auditoria falhar, a escrita na planilha **não** é desfeita.

- **D11 — A listagem lê o ESPELHO da planilha no SQLite, e o Sheets sai do caminho de request (11/08/2026).**
  Motivo medido: a leitura custa **1.450–2.360 ms** para 2,65 MB (D9) e a cota de 60 leituras/min é
  compartilhada com prod — e o mesmo problema era pior em "Meus Projetos", que fazia um `readAllRows()`
  INTEIRO **por load de página de cada usuário**. O sync reverso (cron de **5 min**) copia a planilha para
  **`sheet_espelho`** (linha crua em JSON + `linha_resumo` + hash + `patch`), e a tela lê de lá.
  **O que caiu:** o cache de 60 s, o single-flight, o SWR, a máquina de `epoca`/`seqLeitura` e os
  `patchesEscritos` em memória (D5/D9) — todos existiam para esconder a leitura lenta.
  **O que NÃO caiu (as garantias da D9, agora no banco):** (a) o status recém-gravado **não volta atrás**
  quando um sync que começou antes da escrita termina depois dela — o `patch`/`escrito_em` da linha é
  reaplicado (empate por milissegundo **protege a nossa escrita**; a planilha vence no ciclo seguinte), e
  agora vale **entre isolates**, não só dentro de um; (b) falha do Sheets **não** derruba a tela nem apaga
  nada — o espelho anterior segue servindo e a resposta traz `syncFalhou`; (c) a listagem segue enxuta —
  `linha_resumo` recortado pelas `COLUNAS_RESUMO` (D6 continua valendo, agora também no SQL: a listagem
  **nunca** seleciona a coluna `linha`).
  **`?refresh=1` mudou de significado:** era "furar o cache", virou "**sincronizar de verdade** agora"
  (lê a planilha, regrava o espelho, relê) — é o botão "Atualizar".
  ⚠️ **O risco desta decisão é o sync morrer em silêncio** (a tela mostraria dado velho com cara de novo),
  então ele é **visível por construção**: `sync_runs` registra cada corrida, o cabeçalho diz "Planilha
  sincronizada às HH:MM" e vira **aviso âmbar com ícone + texto** após 20 min (`ESPELHO_VELHO_MS`), e há
  `GET /api/admin/sync-status`. ⚠️ **Push do Sheets (Apps Script → app) é IMPOSSÍVEL** e não deve ser
  tentado de novo: o edge do Godeploy exige OAuth em TODAS as rotas e devolve **302** para o login
  (medido em 11/08/2026 com `curl`). A cadência do cron É a frescura da tela.
  Plano: `docs/plans/sqlite-fonte-de-leitura.md`. Testes: `tests/dashboard-espelho.test.ts` (banco real),
  `tests/sheet-espelho.test.ts`, `tests/dashboard-admin.test.ts` (fake em memória).

- **D12 — O reenvio do dono/editor vira LINHA no "Histórico de triagem" (24/08/2026).** Antes o log da ficha
  era só `admin_status_log` (mudança de status feita por admin), então um reenvio só dava para inferir pelo
  Status mudar de "Reenvio Pendente" de volta para "Pendente" — não havia registro de que o dono reenviou,
  nem quando. Agora `getProjetoDashboard`/`getProjetosDashboardLote` fundem os reenvios já gravados em
  **`projeto_versions`** (`acao = 'reenvio'`, com `submetido_por` e `created_at`) dentro do `historico`, que
  passou a ser **união discriminada** `tipo: 'status' | 'reenvio'`, ordenada `created_at DESC` (a MESMA ordem
  que o log de status já usava — não reordena a ficha dos outros projetos). Merge na função **PURA**
  `montarHistoricoTriagem` (testável sem banco); "edição N" = `versao_num − 1` (a versão 1 é o submit
  inicial). Leitores novos: `getReenviosDoProjeto` (individual) e `getReenviosPorIds` (lote), ambos **sem os
  blobs de snapshot** — o teto de 32 MiB de RPC do Godeploy já derrubou o Investigador por trazê-los em
  massa. É **acessório como o contrafactual**: falha de leitura só omite as linhas de reenvio, a ficha ainda
  abre. Testes: `tests/dashboard-admin.test.ts`.

## 3. O que a tela faz

| Recurso | Como |
|---|---|
| Lista | Todos os projetos da planilha, mais recente primeiro (`Data Submissão`, pt-BR ou ISO via `parseDataFlexivel`; sem data vai ao fim). |
| Filas de status | Pílulas com **contagem ao vivo**: Todos · Pendente · Em validação · Reenvio pendente · Aprovado · Reprovado · Descontinuado · Sem status. Fila vazia não é exibida (a não ser que esteja selecionada). Rótulos legados agregam na pílula equivalente (`rejeitado`→Reenvio pendente, `validado`→Aprovado). |
| Busca | Instantânea (debounce 120 ms), tokens em AND, ignora acento/caixa. Atalho `/` foca; `Esc` limpa. |
| Ordenação | Projeto · Autor · Ganho total · Enviado (clique no cabeçalho alterna a direção; `aria-sort`). |
| Paginação | 25/50/100 por página, janela com elipses, contador "N–M de T". |
| Detalhe | Overlay (`Dialog`) com a **linha inteira** agrupada: Descrição → **Quem sentiria falta** → Identificação → Saving e horas → Custos e receita → Análise → Memoriais (`<details>`) → **Outras colunas** → Histórico de triagem. |
| Quem sentiria falta | Seção que mostra o **contrafactual da Etapa 2** (`contrafactual_afetados` — pessoas OU times que o autor apontou). ⚠️ Esse campo **nunca virou coluna do Sheets**: vive só no SQLite, então a ficha o busca à parte, por PK (`getContrafactualAfetados`), fora do espelho. Ausente/erro → seção não aparece; não derruba a ficha. |
| Decisão | No topo do overlay: `select` de status + campo de motivo → "Salvar na planilha". Botão desabilitado quando nada mudou. |

**Régua de triagem (elemento de identidade):** cada linha tem 3 px de borda esquerda na cor do status, e
a pílula ativa usa a mesma cor — a composição da fila fica legível de relance. Estado **nunca só por
cor**: rótulo + ícone sempre presentes (`StatusBadge`).

## 4. Onde aterrissou

| Arquivo | O quê |
|---|---|
| `src/lib/dashboard-admin.functions.ts` | **novo** — cache single-flight **+ stale-while-revalidate** (D9), `mapResumo`, `listarProjetosDashboard`, `getProjetoDashboard`, `definirStatusProjeto`, `STATUS_GRAVAVEIS`, parsers puros. |
| `src/routes/_authenticated/dashboard.tsx` | **reescrito** — tabela densa, pílulas, busca, ordenação, paginação. |
| `src/components/dashboard/projeto-detalhe-dialog.tsx` | **novo** — overlay da ficha + decisão de status. Grupos de colunas por NOME; coluna desconhecida cai em "Outras colunas". +seção "Quem sentiria falta se a automação parasse" (contrafactual do SQLite). |
| `src/integrations/db/client.server.ts` | +`getContrafactualAfetados(id)` — leitura por PK de `projetos.contrafactual_afetados` (o campo não está na planilha/espelho). |
| `src/lib/dashboard-admin.functions.ts` | `getProjetoDashboard` faz 3 leituras em `Promise.all` (espelho + histórico + contrafactual); decodifica com `desserializarAfetados`; payload ganha o campo `contrafactual`. |
| `src/components/dashboard/status-triagem.ts` | **novo** — vocabulário (rótulo/cor/ícone/ordem) e agregação de rótulos legados. |
| `src/components/dashboard/tabela-utils.ts` | **novo** — busca/ordenação/janela de páginas puras (testáveis sem React). |
| `src/components/status-badge.tsx` | +`reprovado` (vermelho + `XCircle`) e +`em validação`. Chaves existentes intactas. |
| `src/lib/google/sync-reverse.ts` | +`reprovado` → `rejeitado` em `STATUS_FROM_LABEL`. |
| `src/integrations/db/schema.ts` · `client.server.ts` | tabela `admin_status_log` + `insertAdminStatusLog` / `getAdminStatusLogs`. |
| `src/worker.ts` | `GET /api/admin/dashboard/projetos[?refresh=1]` · `GET /api/admin/dashboard/projetos/:id` · `POST /api/admin/dashboard/status` — todas `requireAdmin`. |
| `tests/dashboard-admin.test.ts` | 29 testes (mapeamento, cache/single-flight, filas, busca, paginação, write-back + guard do "Atualizado Em"). |
| `src/lib/auth-cache.ts` | **novo** (D10) — helpers puros do cache de auth em `sessionStorage` (storage injetável, degrada sem lançar). |
| `src/lib/dashboard-prefetch.ts` | **novo** (D10) — promise de prefetch da listagem, consumida uma vez; erro não fica cacheado. |
| `src/routes/_authenticated/route.tsx` | 2 níveis de cache de auth + revalidação em background + prefetch quando o destino é `/dashboard`. |
| `src/components/dashboard/skeleton-linhas.tsx` | **novo** — linhas-fantasma no lugar do spinner (régua neutra, `aria-hidden`, `motion-reduce`). |
| `tests/dashboard-swr.test.ts` · `auth-cache.test.ts` · `dashboard-prefetch.test.ts` · `dashboard-loadings-ui.test.ts` | 34 testes dos loadings (SWR, cache de auth, prefetch, fiação da UI). |

## 5. Pendências / pré-requisitos operacionais

1. ⚠️ **Dropdown da coluna "Status"** — a tela grava `Pendente` · `Em validação` · `Aprovado` ·
   `Reenvio Pendente` · `Reprovado` · `Descontinuado` (`STATUS_GRAVAVEIS`). Se algum desses textos
   **não** estiver na validação de dados da coluna, a escrita funciona mas a célula fica marcada como
   inválida para quem abre a planilha. **Confirmar/ajustar o dropdown** (ou a constante) antes de usar
   em prod. A regra é uma lista só, num lugar só.
2. **Validação em staging** (`edf400b4`) antes de prod (`674a3710`) — regra 13.
3. Sem tela para o histórico de `admin_status_log` fora do detalhe do projeto (não pedido).

## 6. Fora de escopo (decidido)

**Cache da listagem em SQLite — FORA por decisão do Luis (28/07/2026):** não reintroduzir o SQLite no
caminho de leitura (é o gotcha nº 1 desta spec — D1). Consequência aceita: o **primeiro** acesso após
isolate frio segue pagando ~2,5 s, agora com skeleton em vez de tela vazia. Também fora: cache da listagem
em `localStorage`, mudança de range/colunas lidas, paginação server-side.

Editar dados do projeto pela tela (memorial, horas, saving) · e-mail automático ao mudar status (já
existe `/email-legados`) · paginação/busca server-side · mexer na regra TEMPORÁRIA que grava "Pendente"
na IDA.

---

## 7. Fusão das 3 telas de triagem (14/09/2026)

**Pedido (Luis):** *"A tela de especiais + aprovação de pendentes podem ser fundidas a tela de
dashboard. Vai ser uma view de kanban e uma view de lista, dinâmica, rápida de carregamento. O
skeleton loading vai ser de no máximo 2 segundos. Na tela só deve aparecer os novos nomes da
coluna de v2. Filtros bem organizados e de fácil acesso, mas sem poluir a tela. Evitar textos
poluindo a tela, sem traços nos textos. Remover do menu lateral 'Áreas', 'Disparo de e-mails' e
'Testes', e fazer com que ele encolha e expanda."*

### D11 — o eixo do quadro é DADO, não rota

As três telas (`/dashboard`, `/especiais`, `/aprovacoes-pendentes`) liam o **mesmo** espelho da
planilha, com o **mesmo** `mapResumo`, gravavam status pela **mesma** rota e abriam a **mesma**
ficha. O que as distinguia era o `groupBy` e o recorte de escopo. Isso virou uma tabela de eixos
em `src/lib/dashboard-kanban.ts` (PURO): `status` · `fila` · `nota` · `autor` · `area`, onde
**`nota` é a antiga `/especiais`** e **`autor` a antiga `/aprovacoes-pendentes`**. Acrescentar um
eixo passa a ser uma entrada, não uma tela.

**O que NÃO foi reescrito, de propósito:** a régua de fila/espera/urgência continua em
`especiais-view.ts` e o agrupamento por autor em `aprovacao-pendentes-view.ts`. Os dois já eram
puros e testados; redigitá-los criaria duas verdades sobre "de quem é a bola".

**As rotas antigas continuam de pé.** O que saiu foi a porta no menu. Links para `/especiais` e
`/aprovacoes-pendentes` circulam em conversa e e-mail, e o comparador por **âncora** e a
**divisão de áreas por validador** (`especial_referencia`, `POST /api/admin/especiais/dono`)
seguem morando lá: não foram portados.

### D12 — colunas que aparecem MESMO VAZIAS

No eixo `status`, os **3 status do funil** (`pendente`/`aprovado`/`reprovado`) aparecem sempre; no
eixo `nota`, os **níveis 0 a 5**. Motivo: coluna que some faz "não há reprovado hoje" ser lido como
"reprovar não existe", e a régua da nota com buraco no 4 diz que 4 não existe. Acima de 5 a escala
é **aberta** (há 7, 8 e 10 na planilha) e o nível só ganha coluna quando tem projeto. `sem-nota`
(célula vazia) continua sendo coluna **própria**, diferente de `0`.

### D13 — o quadro não custa rede

Ele reagrupa a listagem que já está no cache do React Query. Trocar de vista ou de eixo é `useMemo`,
não requisição. Canário em `tests/dashboard-kanban.test.ts` conta os `apiFetch` da tela (são 4: a
listagem, o fallback sem prefetch, o "Atualizar" e a gravação de status) — nenhum deles depende de
vista nem de eixo.

### D14 — filtros: painel que abre, pílulas do que está ligado

Eram 8 controles sempre visíveis, ocupando 4 linhas antes do primeiro projeto. Agora a barra tem
**busca + botão "Filtros" (com a contagem) + as pílulas ativas**, e os campos moram num painel
fechado por padrão (`painel-filtros.tsx`).

⚠️ **Com os campos escondidos, recorte ligado vira recorte invisível** — a lista encolhe e ninguém
sabe por quê. As pílulas são o que impede isso, e cada uma desliga a própria dimensão. Régua nas
puras `descreverFiltrosAtivos` e `limparDimensao` (`dashboard-filtros.ts`): **filtro novo entra nas
duas no mesmo commit**, senão ele recorta a lista sem aparecer em lugar nenhum.

⚠️ O painel é **inline, não popover**: dentro dele há três controles que já usam portal (período,
nota, categorias), e popover dentro de popover fecha um ao abrir o outro.

⚠️ O **status fica de fora** das pílulas: ele é a faixa de cima, com contagem própria e sempre
visível. Repeti-lo diria duas vezes a mesma coisa.

### D15 — a lentidão era uma consulta, não a planilha

Medido em 14/09/2026, 6 chamadas quentes de cada lado com base equivalente (782 × 770 projetos):
`GET /api/admin/dashboard/projetos` tinha **mediana 1,74 s** em prod. Não era a planilha (a listagem lê o espelho desde 11/08) nem o payload (o edge já comprime em zstd:
620 KB viram ~87 KB no fio). Era a **coluna do agente**: vinha de `carregarSombraDaListagem(ids)` →
`getAvaliacoesNormaisPorIds`, que **precisa dos ids** e por isso só podia começar depois de o
espelho chegar — e, com a base inteira, virava **8 consultas** `SELECT *` (o `IN` quebrado no teto
de 100 variáveis do Godeploy) arrastando o `votos` de cada linha: o JSON com os pareceres dos 4
agentes, que a tabela nunca desenha.

Trocada por **`getResumoAvaliacoesNormais`** + **`getTodosFeedbacks`** (uma consulta cada, só os
escalares, sem `IN`), que por não dependerem de id nenhum entram no **mesmo `Promise.all`** da
leitura do espelho. Na staging, com o código novo: **mediana 1,22 s** — cerca de 0,5 s (30%) a menos.

⚠️ **Honestidade da medida:** a primeira leitura isolada deu 2,5 s em prod e sugeria ~1 s de ganho;
com 6 amostras quentes o ganho real é ~0,5 s. ⚠️ **Isolate FRIO continua custando 20 s+** nos dois
ambientes — é comportamento da plataforma (já registrado na seção 6) e nenhum skeleton o esconde.
O alvo de "skeleton de no máximo 2 s" vale para o caminho quente, que é onde a triagem vive.

⚠️ É o **gotcha 4 desta spec aplicado a uma segunda tabela**: campo que a tela não desenha não
viaja — e aqui ele nem era campo, era blob. ⚠️ O leitor por `IN` **continua existindo** (a ficha em
lote o usa); o canário em `tests/dashboard-admin.test.ts` proíbe a **listagem** de voltar a chamá-lo.
⚠️ Não procurar ganho no tamanho do payload de novo: a compressão já resolve isso.

### D16 — vocabulário: só v2 na tela

A migração renomeou 19 colunas, mas quatro ficaram com o nome da v1 porque renomeá-las quebraria o
casamento por nome de quem as escreve. Elas ganharam **rótulo de exibição** em `rotuloColuna`
(`src/lib/coluna-rotulo.ts`, a mesma fonte única dos papéis): `Saving Horas Real`/`Escalado` →
"Horas liberadas: carga real / ganho por escala", `Memorial de Saving` → "Memorial do impacto",
`Diff …` → "Diferença de …". Os dois títulos de grupo da ficha passaram a nomear os braços do ganho
("Custo evitado (horas liberadas)" e "Saving efetivado, receita e custo para rodar"), e
**`Custo Externo Mensal` saiu** da ficha: a coluna não existe na planilha desde 03/09/2026.

⚠️ É **rótulo, nunca chave**. Nada aqui muda como a célula é lida ou escrita.

### D17 — o travessão saiu das telas

Célula vazia é vazia; `StatusBadge` sem status diz **"Sem status"**; `ChipAgente` sem análise vira
`sr-only`. Multiplicado por 600 linhas, o traço competia com o dado real e não dizia nada que o
cabeçalho da coluna já não dissesse.

⚠️ Isso é **apresentação**. `ouTraco` (`dashboard-resumo.ts`) continua gravando `—` na planilha, e
isso **não muda**: lá o travessão é o padrão de "texto vazio" da própria base.

### D18 — menu lateral: 4 itens, e recolhe

Ficaram **Triagem · Aglutinação · Investigador · Fluxos** (`src/lib/admin-nav.ts`, PURO). Saíram
**Áreas**, **Disparo de e-mails** e **Testes** (não são trabalho de rotina da triagem) e as duas
telas absorvidas.

⚠️ **Sair do menu não é deixar de existir**: as cinco rotas continuam no ar, alcançáveis por URL, e
`tests/admin-nav.test.ts` cobra os arquivos no repo. ⚠️ O **Dashboard segue sendo o único
`preload={false}`**, pela razão de sempre: hover num link com preload dispara
`iniciarPrefetchDashboard()` no `beforeLoad` do layout, e a cota de leitura é compartilhada com
produção. Recolhido, o rótulo vai para `sr-only` e o `title` carrega rótulo + descrição; a
preferência mora em `localStorage` e **nunca lança** (aba anônima, armazenamento bloqueado).

### D19 — smoke de render

O repo não tem harness de render (sem jsdom), então os guards de UI eram feitos sobre o **fonte** —
o que pega fiação e não pega componente que explode ao montar. `tests/quadro-render.test.ts` renderiza
o quadro com `renderToStaticMarkup` (não precisa de DOM) nos **5 eixos**, com dado real, e prova que
o travessão não voltou. Sem JSX de propósito: a suíte só coleta `tests/**/*.test.ts`.

---

## 8. A coluna ÚNICA de status (14/09/2026)

**Pedido (Luis):** *"No backend podemos unificar a coluna de pre-status e status. O agente so
vai aprovar/reprovar quando status for pre-aprovado, que indica que o lider pre aprovou. Se
for pendente nao teve pre-aprovaçao."* → *"Pendente, pre-aprovado, aprovado, ajuste pedido e
reprovado sao os unicos status possiveis agora. Depois que o ajuste pedido tiver tido seu
ajuste feito, ele volta para pendente com flag de ajuste realizado (log tracking)."*

### O problema, medido

As duas colunas eram **ortogonais no dado e contraditórias na prática**. Nas 782 linhas de
produção, em 14/09/2026:

| Status | Pré-status | n |
|---|---|---|
| Aprovado | vazio | 434 |
| Aprovado | Pré-aprovado | 161 |
| Reprovado | vazio | 104 |
| Reprovado | **Pré-aprovado** | 36 |
| Aprovado | **Pré-pendente** | 14 |
| Aprovado/Reprovado | **Ajuste pedido** | 9 |
| Pendente | vazio | 3 |

**71% tinha pré-status vazio** (nunca entrou em fila de líder) e as linhas em negrito são
combinações que o modelo não deveria permitir: 36 projetos reprovados que o líder havia
pré-aprovado, 14 aprovados que o líder nunca tinha olhado.

### D20 — os cinco, e o que ficou de fora

`Pendente` · `Pré-aprovado` · `Ajuste pedido` · `Aprovado` · `Reprovado`, em
`src/lib/status-funil.ts` (PURO).

⚠️ **`Descontinuado` continua existindo e segue FORA do funil.** É o dono arquivando
(`projetos.descontinuado` é a fonte da verdade, a coluna só reflete), não uma etapa entre
submissão e decisão — a mesma decisão que já valia em `funil-status.ts`. Tirá-lo da coluna
apagaria a marca de 19 projetos em produção.

Saíram: **`Em validação`** (dizia "esperando", que é `Pendente`) e **`Reenvio Pendente`** (virou
`Ajuste pedido`, o mesmo verbo que o líder já usava — os dois caminhos de devolução ao autor
passam a falar a mesma língua).

⚠️ **O vocabulário antigo continua sendo LIDO** (`statusDoTexto`, mapa `LEGADO`): a planilha
tem as duas gerações, e nenhuma linha pode virar `null` por estar escrita no idioma velho.
Texto **desconhecido** devolve `null`, nunca um palpite — é a lição do `Dispensado` que
virava `Pré-reprovado` num fall-through.

### D21 — o portão do agente

`podeAgenteDecidir(status)` é verdadeiro **só em `Pré-aprovado`**. É a regra inteira, e é o
motivo de a coluna ter virado uma só: antes essa pergunta exigia cruzar duas colunas que se
contradiziam. `drenarFilaDoFunil` deixou de filtrar `Status = Pendente` e passa a usar este
predicado.

⚠️ **Corolário operacional:** depois do deploy a fila do cron nasce **vazia** (nenhuma linha
está em `Pré-aprovado`) e enche conforme chegam submissões novas e conforme os líderes
decidem as antigas. Isso é o comportamento pedido, não um defeito.

⚠️ **`Pré-aprovado` não conta como decisão humana** (`ehStatusIndeciso`). Ele é o líder
dizendo "por mim pode seguir", e é literalmente o estado em que o agente foi convocado. Se a
trava de decisão humana (10/09) o tratasse como decisão, ela barraria o agente exatamente
onde ele deve agir, e o funil pararia inteiro.

### D22 — quem nunca passa por líder nasce Pré-aprovado

71% da base não entra em fila: coordenador para cima submetendo, projeto especial (D27),
pessoa sem líder na TeamGuide, integração fora. Eles já recebiam o rótulo `Pré-aprovado
(liderança)` e afins; o que muda é o **Status** dizer o mesmo (`statusDeSubmissao`). Sem isto,
a régua do D21 pararia o funil para a maioria dos projetos, esperando um líder que não existe.
O porquê da isenção continua na justificativa (D12).

### D23 — quem move o Status, e quem não move

| Quem | Quando | Para |
|---|---|---|
| Líder (`decidirAprovacao`) | veredito `aprovado` | `Pré-aprovado` |
| Líder | veredito `ajuste` | `Ajuste pedido` |
| Líder | veredito `reprovado` | `Reprovado` |
| Submissão | sempre | `Pendente` ou `Pré-aprovado` (D22) |
| Triagem (`definirStatusProjeto`) | clique na ficha ou no cartão | qualquer gravável |
| Time de agentes (junta) | só a partir de `Pré-aprovado` | `Aprovado`/`Reprovado`/`Pendente` |

⚠️ O líder só move o Status **no estágio 1** (líder do autor). O estágio 2 (líder do dono do
projeto pai) nunca teve coluna no Sheets e continua sem: mover o funil por ele faria a decisão
de um líder que não é o do autor sobrescrever a do que é.

⚠️ O líder **nunca rebaixa um status FINAL.** A análise e a triagem decidem depois dele; se a
linha já está `Aprovado`/`Reprovado`, um parecer que chega atrasado não a desfaz. A checagem
lê o Status do **espelho** (nunca do Sheets — cota compartilhada com prod) e falha de leitura
devolve `null`, que faz o código **não encostar**.

⚠️ `pendente` (fila aberta) e `dispensado` (fila fechada pelo sistema) **não movem nada**:
dispensar fecha a FILA, não decide o projeto.

### D24 — `Ajuste pedido` volta a `Pendente`, com marca

O reenvio do autor devolve o projeto a `Pendente` pelo caminho normal da IDA e grava
**`projetos.ajuste_realizado_em`**.

⚠️ Coluna **INTERNA**: não existe no Sheets, fica fora de `SAFE_UPDATE_FIELDS` e o sync
reverso não a toca (mesma disciplina de `editores_delegados`). A tela a recebe por **mapa
lateral** na listagem (`ajustesRealizados`), como as avaliações do agente.

⚠️ Sem a marca, o projeto ajustado reentra na fila **indistinguível de quem nunca saiu dela**,
e quem tria perde a informação de que já houve uma volta — que é justamente o que muda como se
lê o projeto. Na tela é o chip "Ajuste realizado" (ícone + texto, nunca só cor).

⚠️ `ehReenvioDeAjuste` só dispara em `Ajuste pedido`: reenvio de um projeto já `Aprovado`
**não** o rebaixa (desfazer decisão da triagem é de gente).

### D25 — a coluna `Aprovação do Líder` fica, congelada

Ela **continua sendo escrita** como auditoria (quem liberou), e a `Justificativa Aprovação do
Líder` segue trazendo o checklist inteiro, que a ficha lê e o parser do D19 desmonta. O que
ela deixou de ser é a **régua do funil**.

Por isso saiu da TELA: a coluna "Pré-status" da tabela, o chip do cartão do quadro e o filtro
de pré-status. Com `Pré-aprovado` no Status, filtrar por "Pré-pendente" é filtrar por
"Pendente".

⚠️ **Não apagar a coluna da planilha** sem decisão explícita: 782 linhas, irreversível, e o
histórico de quem pré-aprovou o quê some.

### D26 — a migração é um no-op, e isso foi medido

`POST /api/admin/migrar-status-unico` (`requireAdmin`, **`dry` é o DEFAULT**), régua na pura
`unificarStatus`. Ela recalcula `Status` a partir do par antigo e **não** toca `Atualizado Em`
nem a coluna do líder. Falha numa linha não derruba as outras.

A precedência resolve as contradições sozinha: **arquivo vence tudo** → **decisão final vence
o parecer do líder** → **pedido de ajuste** → **parecer do líder** → **Pendente**.

**Medido em 14/09/2026: ZERO linhas mudariam** — nem nas 782 de produção, nem nas 770 da
staging (rodado em `dry`). Porque 778 das 782 já estão em `Aprovado`/`Reprovado`/
`Descontinuado`, e decisão final vence parecer. **O que muda é o fluxo daqui para frente, não
o passado.** Uma migração que reescrevesse tudo seria o risco; esta encosta no mínimo.

⚠️ **Pendência de OPERAÇÃO:** o dropdown da coluna `Status` nas 3 abas precisa receber
`Pré-aprovado` e `Ajuste pedido`. Escrever fora do dropdown funciona, mas marca a célula como
inválida para quem abre a planilha.

### D27 — célula vazia é `Pendente`

`pilulaDe` e `contarPorStatus` passaram a contar célula vazia como `pendente`, e a pílula
`sem_status` deixou de existir: com a coluna única, "ninguém escreveu nada" e "ninguém decidiu
ainda" são o mesmo estado do funil, e duas pílulas dividiam a mesma pergunta.

### D28 — o filtro de NATUREZA saiu

Especiais × Padrão existia porque só o projeto especial recebia nota, e a triagem precisava
isolá-los para pontuar. Hoje **todo projeto tem nota**, e `0` é nota (a caixa «Experimenta»),
então a dimensão deixou de responder pergunta nenhuma de triagem. O conceito de projeto
especial continua vivo (`Especial?` na planilha, o fluxo que pula o memorial, o ícone no
cartão): o que saiu foi o recorte.
