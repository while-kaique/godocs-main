# Pré-aprovação do líder (integração TeamGuide) — 03/08/2026

> Status: **🟢 F0 + F1 + F2 implementadas** (03/08/2026) — a DM (F2) nasce atrás do
> gate `GOOGLE_CHAT_DM_ENABLED` (ligar = trocar a env, sem redeploy de código).
> Pendente: validação na staging → prod (regra 13) e a coluna do Sheets (P2). Autor do plano:
> sessão Claude de 03/08/2026, a partir de investigação **ao vivo** contra
> `https://api.teamguide.app` com o `TG_API_TOKEN` do `.env`.

O liderado submete um projeto no GoDocs; o **líder direto** recebe uma **DM privada
no Google Chat** (remetente `rpa_ia@gocase.com`) avisando, e **aprova dentro do
próprio GoDocs** — a DM é só o carteiro, nunca o lugar da decisão. A relação
líder↔liderado vem da **TeamGuide**.

---

## 1. Decisões fechadas (não "corrigir" sem confirmar)

| # | Decisão | Por quê |
|---|---|---|
| **D1** | **A aprovação mora no GoDocs**, não no Chat/e-mail. | Aprovação é **estado do projeto** (precisa de auditoria, versão, aparecer na triagem, reabrir no reenvio) e o líder precisa do memorial na frente pra decidir — não cabe em cartão de Chat. A tela read-only `/projeto/$id` já existe. |
| **D2** | **DM privada no Google Chat** é o canal de notificação (decisão do chefe do Luis, 03/08/2026). E-mail fica como alternativa futura, **não** implementar junto. | Adesão: líder não abre o GoDocs espontaneamente. DM é mais direta que e-mail no dia a dia da Gogroup. |
| **D3** | **NÃO bloqueia a triagem da RPA** — pré-aprovação roda **em paralelo**. | Líder de férias/ausente congelaria o projeto e o autor não saberia por quê. O selo do líder é informação *a mais* pra triagem, não portão. |
| **D4** | Pessoa em 2+ times → **todos os líderes derivados veem na fila, o primeiro que decidir resolve**. | 2 pessoas hoje estão em 2+ times (Joaquim Quinderé, Aline Montenegro em 3). Unanimidade travaria fácil; escolher "o time mais profundo" erraria quando a alocação secundária é a relevante. |
| **D5** | Área das pessoas nos nós de diretoria/passthrough = **nome do próprio nó** (`N1`, `BIZOPS`, `OPERAÇÕES`, `TIME JOAQUIM QUINDERE`…). | Fiel ao TeamGuide, zero nome inventado. Rejeitado: rótulo sintético "DIRETORIA" (não existe na fonte) e herdar a área de um filho (enganoso — Bruno Bezerra não é de "DADOS"). |
| **D6** | **Autor sem líder** (só `rafael@gocase.com`, CEO) → projeto **não** entra em fila de aprovação nenhuma; vai direto pra triagem, sem erro e sem DM. | O topo da cadeia não tem quem aprove. Silenciar é o comportamento correto, não uma exceção a tratar. |
| **D7** | A relação líder↔liderado é derivada de **`/teams` + membros**, **não** dos endpoints de liderança da TeamGuide. | Os endpoints "óbvios" (`/employees/{id}/leaders`, `/leaders/{id}/led`, `/employees/{id}/teams`) devolvem **403** com o nosso token (ver §2). A derivação pela árvore funciona hoje e cobre 431/432 pessoas. |
| **D8** | Falha de DM **nunca** derruba a submissão (best-effort em `runBackground`), e a DM é **muda na staging**. | Mesmo padrão do widget de ajuda e do `sendChatNotification`. Submissão é o caminho crítico; notificação não é. |
| **D9** | A DM sai de uma **credencial de Chat própria** (`CHAT_SA_*` no `.env`, impersonando `GOOGLE_CHAT_DM_SUBJECT` = `rpa_ia@gocase.com`), com **fallback para `GOOGLE_SA_*`** — o mesmo padrão do `GMAIL_SA_*`. | ✅ **Validada ao vivo em 03/08/2026**: a troca de JWT por `access_token` com `sub=rpa_ia@gocase.com` e os 2 escopos de Chat retornou OK (sem enviar mensagem). Logo a **F2 não está mais bloqueada** — a DWD da SA `godocs@` virou **faxina** (apagar 2 linhas do `.env`), não pré-requisito. ⚠️ A credencial fica **só no `.env`/secrets**; nada de chave em doc (ver §5.5). |
| **D10** | Aprovação é **por versão** do projeto: reenvio do liderado volta o veredito a pendente. | Aprovar a v1 não pode carimbar uma v2 com números diferentes. O `projeto_versions` já existe pra ancorar isso. |
| **D11** | **Quem já É liderança está ISENTO** de pré-aprovação (decisão do Luis, 03/08/2026): o projeto dele não entra em fila nenhuma e não gera DM. Só o liderado "de fato" (quem não lidera time) precisa de aprovação — e quem aprova é o **líder direto**, nunca o líder do líder. | Não faz sentido uma liderança esperar o líder maior liberar o projeto dela. Ex.: o Lucas (coordenador de RPA) aprova o projeto do Luis (liderado dele), e o projeto do **Lucas** sai sem depender do Bruno; o Bruno, que também lidera, é isento pelo mesmo motivo. **Régua:** aparecer como `leader` de algum time ATIVO na TeamGuide (`ehLideranca`) — e não "tem liderados no índice", porque um time recém-criado pode ter líder e nenhum membro. |
| **D12** | **Os 3 casos sem fila têm rótulo PRÓPRIO na coluna `Aprovação do Líder`** (decisão do Luis, 03/08/2026): liderança → **`Pré-aprovado (liderança)`** · autor sem líder → `Sem líder na TeamGuide` · TeamGuide fora → `Aprovação indisponível (integração)`. Nada disso toca a coluna `Status` nem o comportamento (segue sem fila e sem DM — D11/D6/D3). | Antes os 3 gravavam o mesmo `—` e a auditoria não distinguia a **isenção legítima** de uma **falha de integração** — mesmos sintoma e cara na planilha, causas opostas. O rótulo da liderança diz o **efeito** ("do lado do líder, liberado"), não um parecer: ninguém decidiu nada, porque o líder é o próprio autor — por isso `(liderança)` fica explícito no texto e a coluna `Status` continua "Pendente" pela regra temporária. Mora na função pura `rotuloIsencaoSheet(motivo)`; o `motivo` já vinha pronto do `abrirPreAprovacao`. **O card do autor NÃO ganha selo** (a feature segue invisível para quem é isento). |

---

## 2. O que a API TeamGuide realmente entrega (verificado ao vivo, 03/08/2026)

⚠️ **Os endpoints de liderança estão 403 com o `TG_API_TOKEN` atual** — não são
uma opção, e pedir token novo seria dependência de infra:

| Endpoint | Resultado real |
|---|---|
| `GET /employees/{id}/leaders` | **403** `"You aren't allowed to detail this employee"` |
| `GET /employees/{id}/teams` | **403** (mesma mensagem) |
| `GET /leaders/{id}/led` | **403** `"You are not allowed to access this resource"` |
| `GET /leaders/is-direct-leader-of` · `is-led-by` | Relativos ao **dono do token**, não a um terceiro → inúteis aqui |
| `GET /employees/me/leaders` · `/teams/leader/me` | `200` mas **`[]`** (o token não é de uma pessoa com liderança) |

**O que funciona (é a base do plano):**

| Fonte | Custo | O que dá |
|---|---|---|
| `GET /teams` | 1 call, 129 times ativos | `id`, `name`, `teamParent`, **`leader: {id, name}`** → a árvore inteira |
| `GET /teams/25419/members?directOnly=false&pageNumber=N&pageSize=100` | ~5 calls | 432 pessoas com `contactEmail` + **`teamsIds`** |
| `GET /employees/emails/{email}` | 1 call | `{exists, employeeId}` — resolve o e-mail direto, sem busca por nome |

**Regra de derivação:** *líder de P = líder do time de P; se P **é** o líder daquele
time, sobe pro time pai e repete.*

Rodada nas 432 pessoas: **431 têm líder; exatamente 1 não tem — `rafael@gocase.com`
(CEO, time `N1`, cujo pai `Gogroup` não tem líder)**. Confere com a realidade (D6).
Amostras validadas: `luis.albuquerque@` → Lucas Gonçalves Queiroz (RPA) ·
`adyla.martins@` (que **é** líder de FACILITIES) → subiu certo pra Simony Morais
(GENTE E GESTÃO).

---

## 3. Dois bugs achados na integração atual (`src/lib/areas/teamguide.server.ts`)

### 3.1 🐛 Paginação morta — toda listagem lê só os 25 primeiros (✅ corrigido na F0)

`fetchMembersByText` pagina com `?page=N`. No OpenAPI o parâmetro `page` é um
**objeto** (`{pageNumber, pageSize}`), ou seja os nomes reais são
**`pageNumber`/`pageSize`** — `?page=N` é **ignorado** e a API devolve sempre a
primeira página. Verificado: `?page=0` e `?page=1` retornam as **mesmas** 25
pessoas; `?pageNumber=1` retorna outras. `pageSize` tem **teto de 100** (pedir 1000
devolve 100).

O loop de 20 páginas nunca avança e o `break` de `batch.length < 25` nunca dispara
(sempre vêm 25 cheios). Não explodiu até hoje porque o `text=` estreita o resultado
pra menos de 25 na maioria dos casos — mas é uma bomba armada para qualquer
listagem mais larga.

### 3.2 🐛 "ÁREA NÃO IDENTIFICADA" — 10 pessoas, não só o Rafael (✅ corrigido na F0)

O `buildAreaIndex` cobre **121 dos 129 times**. Os **8 descobertos são exatamente
os nós que a regra declara "não são área"** — as raízes de domínio e os
passthrough:

- **Diretoria/raízes:** `Gogroup` (25419), `N1` (43685, Rafael Lobo), `N1 - GUILHERME NOBREGA` (43688), `N1 - LUIS LIVERI` (43689)
- **Passthrough:** `BIZOPS` (46642, Bruno Bezerra), `MKT | PRODUTO | B2B GOCASE` (46645, Pedro Glycério), `OPERAÇÕES` (43732, Rafael Menezes), `TIME JOAQUIM QUINDERE` (48320)

Quem está alocado **no** nó guarda-chuva (e não num filho) cai no vazio — **10
pessoas**: Rafael Lobo, Guilherme Nóbrega, Joaquim Quinderé, Bruno Bezerra, Rafael
Menezes, Leandro Dias, Ricardo Maurique, Claudinei Zunfrilli, Luísa Souza, Rafael
Craveiro.

**Fix (D5):** segunda camada de fallback no índice — nó ainda descoberto mapeia
para **si mesmo** (nome do próprio nó), aplicada **depois** da camada de área
normal. Os 422 que já resolvem não mudam.

> Corolário: `deriveAreaFromEmail` deve parar de buscar por **nome** (tokens do
> local-part do e-mail, com dedução frágil) e usar `GET /employees/emails/{email}`
> + o índice de membros. Hoje um homônimo ou um e-mail que não siga
> `nome.sobrenome@` erra silenciosamente.

---

## 4. Plano de implementação

### F0 — Base TeamGuide (`src/lib/areas/teamguide.server.ts`) — ✅ **implementada 03/08/2026**

> Como aterrissou: `fetchTeamMembers` (paginação real) · 2ª camada em `buildAreaIndex`
> (nó descoberto → próprio nome) · `raizesDeCobertura` (de onde os membros são lidos —
> genérica porque um ciclo na árvore zeraria a lista de "sem pai") · caches
> `cacheTimes`/`cacheMembros`/`cacheLideranca` por isolate, só em sucesso ·
> `buildLiderancaIndex`/`getLideresDe`/`getLideradosDe`. Testes:
> `tests/teamguide-lideranca.test.ts` (16 casos) + `tests/areas-teamguide.test.ts`.
> ⚠️ O índice devolvido por `buildLiderancaIndex()` são **2 mapas**
> (`lideresPorEmail`/`lideradosPorEmail`), não o `Map<email, {employeeId,…}>` que o
> item 4 abaixo previa — os dois lados saem do mesmo índice, como planejado.

1. `tgGet` ganha helper de paginação com **`pageNumber`/`pageSize=100`**, parando
   por página parcial **ou** por página sem ids novos (defesa contra param
   ignorado — foi exatamente o modo de falha do bug 3.1).
2. `buildAreaIndex` ganha a **camada de fallback** (nó descoberto → próprio nome).
3. `deriveAreaFromEmail` reescrita sobre `GET /employees/emails/{email}` + índice
   de membros; mantém a assinatura e o `null` de saída (o chamador segue decidindo
   o aviso).
4. **Novo:** `buildLiderancaIndex()` → `Map<email, { employeeId, times: number[], lideres: {email, nome}[] }>`,
   derivado de `/teams` + membros, com o algoritmo de D7 e cache por isolate
   (mesma vida do cache de token).
5. **Novo:** `getLideresDe(email)` e `getLideradosDe(email)` — os dois lados, um
   índice só.

**Testes** (`tests/teamguide-lideranca.test.ts`, funções puras sobre fixture da
árvore real): os 10 casos de área sem cobertura, Rafael sem líder, o caso
"líder do próprio time sobe pro pai" (Adyla), multi-time (Joaquim/Aline), e a
paginação parando em página repetida.

### F1 — Aprovação dentro do GoDocs — ✅ **implementada 03/08/2026**

> Como aterrissou (arquivos): `src/lib/aprovacoes.functions.ts` (novo, coração da
> feature) · tabela `projeto_aprovacoes` em `src/integrations/db/schema.ts` + helpers em
> `client.server.ts` · rotas em `src/worker.ts` · tela `src/routes/aprovacoes.tsx` (nova)
> + faixa de entrada em `src/routes/index.tsx` + selo no card em `meus-projetos.tsx` ·
> coluna `Aprovação do Líder` em `google/sheets.ts` (+ `aprovacaoLider` no payload de
> `google/sync.ts`) · gancho em `submeterParaValidacao` (`chat.functions.ts`).
> Testes: `tests/aprovacoes-lider.test.ts` (16 casos) + os 5 novos de `ehLideranca`
> em `tests/teamguide-lideranca.test.ts`.

- **Tabela `projeto_aprovacoes`** (`CREATE TABLE IF NOT EXISTS`, padrão do
  `ajuda_chamados`): `projeto_id`, `versao`, `autor_email`, `aprovador_email`,
  `aprovador_nome`, `veredito` (`pendente|aprovado|reprovado`), `comentario`,
  `decidido_por`, `criado_em`, `decidido_em`. **Interna** — fora de
  `SAFE_UPDATE_FIELDS`, não sofre sync reverso. `ON DELETE CASCADE` do projeto.
  ⚠️ **Nenhum comentário do `SCHEMA_SQL` pode conter ponto-e-vírgula** — o `initSchema`
  divide o SQL por `;` e um deles no meio de um comentário parte o `CREATE TABLE` ao
  meio (aconteceu nesta implementação: `db-async`/`sync-reverse` quebraram em bloco).
- **`src/lib/aprovacoes.functions.ts`**:
  - `abrirPreAprovacao(projetoId)` — chamada no `submeterParaValidacao`. Resolve a
    isenção (D11 → `ehLideranca`), depois os líderes (D6 → `getLideresDe`), regrava a
    fila (D10: apaga a rodada anterior e insere pendentes) e dispara a DM em
    `runBackground`. **NUNCA lança** (D3): devolve `{isento, motivo, rotuloSheet}` e a
    submissão segue igual se a TeamGuide estiver fora.
  - `listarAprovacoesPendentes(email)` → `{ lidera, itens }` (o `lidera` é o gate de
    exibição no frontend; cai para "tem pendência?" se a TeamGuide falhar).
  - `decidirAprovacao(email, body)` com **gate server-side**: só grava se existir linha
    PENDENTE para (projeto, e-mail) — a linha veio da TeamGuide na submissão, então ela
    É a prova de que quem decide lidera o autor. Reprovar **exige comentário** (é o
    texto que o autor lê). D4: grava em TODAS as linhas pendentes do projeto.
  - `resumoAprovacaoPorProjeto(ids)` — 1 query (IN) para os cards do autor.
  - `rotuloAprovacaoSheet(linhas)` — função **pura**, único lugar que redige os rótulos
    de fila (pendente/aprovado/reprovado).
  - `rotuloIsencaoSheet(motivo)` — função **pura**, único lugar que redige os rótulos dos
    3 casos SEM fila (D12). ⚠️ Não redigitar esses textos no `semFila` nem no chamador.
- **Rotas** (`src/worker.ts`, autenticadas, **não** admin):
  `GET /api/aprovacoes/pendentes` · `POST /api/aprovacoes/decidir`.
- **Frontend**: rota própria **`/aprovacoes`** ("Aprovações do meu time") em vez da 5ª
  aba de "Meus Projetos" — a fila é um fluxo de decisão (ler doc → aprovar/pedir ajuste
  com comentário), e a lista de "Meus Projetos" é derivada de um único fetch com
  contagem por filtro (encaixar outra fonte ali era cirurgia num arquivo de 43 KB por
  zero ganho de UX). Entrada: faixa na home, visível **só a quem lidera**. O card abre
  `/projeto/$id` read-only (memorial **sem R$** — a regra vale também pro líder).
  Estado por **rótulo + ícone**, nunca só cor.
- **Sheets:** coluna **`Aprovação do Líder`** (mapeada por nome) — `"Pendente com X"` no
  append, `"Aprovado por X em dd/mm/aaaa"` / `"Reprovado por X em dd/mm/aaaa — motivo"`
  quando o líder decide, `"—"` quando não se aplica. ⚠️ **A coluna precisa existir no
  cabeçalho** das abas `GoDocs` e `STAGING` (pré-requisito P2 do Luis) — sem ela o valor
  é ignorado com aviso e o resto do sync segue normal.

### F2 — DM privada no Google Chat — ✅ **implementada 03/08/2026** (atrás do gate)

> Como aterrissou: `src/lib/google/chat-dm.ts` (novo) — `enviarDmChat(email, texto)` faz
> `spaces:setup` (idempotente, `DIRECT_MESSAGE`) + `POST /messages`, com token próprio
> (SA `CHAT_SA_*` → fallback `GOOGLE_SA_*`, impersonando `GOOGLE_CHAT_DM_SUBJECT`).
> **Nunca lança** — devolve `false` e loga. Disparo em `runBackground` dentro de
> `abrirPreAprovacao`. Envs documentadas no `.env.example`.

- Gate `GOOGLE_CHAT_DM_ENABLED` (`!= "true"` → no-op silencioso): é assim que a staging
  fica muda e que o rollout em prod é uma troca de env, sem redeploy de código (D8).
- Guard: destino `==` subject → no-op (a API não abre DM consigo mesmo), não falha.
- Mudo para projetos de teste E2E (`ehProjetoTesteE2E`), igual ao Chat atual.
- ⚠️ O `chat-dm.ts` NÃO reusa o `createSignedJwt` do `auth.ts` (que é privado ao
  módulo) — repete só o mint do JWT, com os escopos de Chat. Se um dia o `auth.ts`
  exportar o helper, é uma boa faxina.


---

## 5. Gotchas que não podem regredir

1. **Nunca ler `process.env` em escopo de módulo** (convenção do `CLAUDE.md`) — o
   token da TeamGuide e as envs de Chat só dentro de função. O `getToken()` atual
   já faz certo; manter.
2. **A cota da TeamGuide é compartilhada** com os outros consumidores (mesmo
   padrão da cota do Sheets): `buildLiderancaIndex` é ~6 calls, então **cachear**
   e nunca chamar por item numa listagem.
3. **`descontinuado` e ownership não mudam**: a fila de aprovação não é ownership.
   Líder **não** ganha direito de editar o projeto do liderado (isso é
   `editores_delegados`, decisão separada).
4. **A DM não é fonte de verdade de nada** — se a mensagem falhar, a aprovação
   continua pendente no GoDocs e visível na aba. Nunca gravar estado a partir do
   retorno do Chat.
5. **A isenção de liderança (D11) mora em UM lugar só** — `ehLideranca` (derivado do
   `leader` dos times) + a checagem no topo de `abrirPreAprovacao`. Não espalhar
   "quem é líder" por outros pontos: se a régua mudar (ex.: passar a valer só de
   coordenador pra cima), ela muda ali.
6. **A pré-aprovação NUNCA bloqueia a submissão** (D3): `abrirPreAprovacao` não
   propaga erro e o status do projeto/planilha não depende do veredito do líder.
   Se um dia isso virar portão, é decisão de produto — não efeito colateral.
7. **`GOOGLE-CHAT-DM.md` contém chave privada em texto puro** e foi adicionado ao
   `.gitignore` nesta sessão (junto com `openapi.json`). ⚠️ **Não commitar, não
   colar o conteúdo em spec/doc/PR.** Se já tiver circulado, rotacionar a chave da
   SA no GCP.

---

## 6. Pendências fora do código

| # | Pendência | Dono |
|---|---|---|
| ~~P1~~ | ~~**DWD da SA `godocs@admin-n8n-study`**~~ — **RESOLVIDA por outro caminho (03/08/2026)**: a credencial `CHAT_SA_*` do `.env` já tem os escopos `chat.spaces` + `chat.messages.create` com `sub=rpa_ia@gocase.com`, validada ao vivo (D9). Pedir a DWD da SA `godocs@` virou opcional — se um dia sair, é só apagar as 2 linhas `CHAT_SA_*` e cair no fallback `GOOGLE_SA_*`. | — (era: Admin do Workspace) |
| P2 | Criar a coluna **`Aprovação do Líder`** no cabeçalho das abas `GoDocs` e `STAGING`. | Luis |
| P3 | Confirmar que `rpa_ia@gocase.com` existe e tem **Google Chat ativo** (é o remetente impersonado). | Luis / TI |

**F0 e F1 não dependem de nada disso** e podem ir a staging → prod antes.
F2 nasce atrás do gate `GOOGLE_CHAT_DM_ENABLED=false` — mas por **cautela de
rollout** (D8), não por bloqueio de credencial: ligar é trocar a env.

---

## 7. Próximos passos (código pronto — 03/08/2026)

1. **Staging** (`edf400b4`, regra 13): validar a submissão de um liderado (fila abre +
   coluna "Pendente com X"), a de uma liderança (isento, coluna "—"), a fila em
   `/aprovacoes`, o aprovar e o pedir-ajuste. `GOOGLE_CHAT_DM_ENABLED` fica **false**.
2. **Coluna do Sheets** (P2) antes de validar a planilha — sem ela o valor é ignorado
   com aviso (o resto do sync não quebra).
3. **Prod** (`674a3710`) e, num segundo momento, ligar `GOOGLE_CHAT_DM_ENABLED=true`
   nos secrets (rollout da DM separado do rollout da tela).
