# Pré-aprovação do líder (integração TeamGuide) — 03/08/2026

> Status: **📐 planejada** (nada implementado ainda). Autor do plano: sessão Claude
> de 03/08/2026, a partir de investigação **ao vivo** contra `https://api.teamguide.app`
> com o `TG_API_TOKEN` do `.env`.

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
| **D9** | A DM sai da **SA atual do GoDocs** (`godocs@admin-n8n-study`), pedindo os escopos de Chat na DWD. | Uma SA só, sem chave nova em env. ⚠️ **Bloqueia a F2** até um admin do Workspace autorizar (ver §6). Rejeitado: usar a SA `planilha-jg` do `GOOGLE-CHAT-DM.md`, que já tem os escopos — desbloquearia hoje, mas espalha credencial. |
| **D10** | Aprovação é **por versão** do projeto: reenvio do liderado volta o veredito a pendente. | Aprovar a v1 não pode carimbar uma v2 com números diferentes. O `projeto_versions` já existe pra ancorar isso. |

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

### 3.1 🐛 Paginação morta — toda listagem lê só os 25 primeiros

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

### 3.2 🐛 "ÁREA NÃO IDENTIFICADA" — 10 pessoas, não só o Rafael

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

### F0 — Base TeamGuide (`src/lib/areas/teamguide.server.ts`)

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

### F1 — Aprovação dentro do GoDocs

- **Tabela `projeto_aprovacoes`** (`CREATE TABLE IF NOT EXISTS`, padrão do
  `ajuda_chamados`): `projeto_id`, `versao`, `aprovador_email`, `aprovador_nome`,
  `veredito` (`pendente|aprovado|reprovado`), `comentario`, `criado_em`,
  `decidido_em`. **Interna** — fora de `SAFE_UPDATE_FIELDS`, não sofre sync reverso.
- **`src/lib/aprovacoes.functions.ts`**: `criarAprovacoesPendentes(projetoId)`
  (chamada no `submeterParaValidacao`, resolve os líderes via F0 — sem líder → no-op),
  `listarAprovacoesPendentes(email)`, `decidirAprovacao(projetoId, email, veredito, comentario)`
  com **gate server-side** (só grava se o TeamGuide confirmar que `email` lidera o
  autor — nunca confiar no frontend), e reabertura no reenvio (D10).
- **Rotas** (`src/worker.ts`, autenticadas, **não** admin):
  `GET /api/aprovacoes/pendentes` · `POST /api/aprovacoes/:id/decidir`.
- **Frontend** (`src/routes/_authenticated/meus-projetos.tsx`): 5ª aba
  **"Aprovações do meu time"**, visível só a quem lidera alguém; card abre o
  `/projeto/$id` read-only (memorial **sem R$** — a regra de "cliente não vê
  financeiro de saving" continua valendo pro líder que não é staff) + ações
  Aprovar / Reprovar com comentário. Skill `frontend-design` **antes** de codar
  (regra 11); estado **nunca só por cor** (rótulo + ícone).
- **Sheets:** coluna nova **`Aprovação do Líder`** em `SHEET_COLUMNS` (mapeada por
  nome, então a posição no array é só documentação) — `"Aprovado por X em
  dd/mm"` / `"Reprovado por X"` / `"Pendente"` / `"—"` quando não se aplica.
  ⚠️ **A coluna precisa existir no cabeçalho** das abas `GoDocs` e `STAGING`,
  senão é ignorada com aviso (pré-requisito do Luis).

### F2 — DM privada no Google Chat (⚠️ bloqueada pela DWD — ver §6)

- **`src/lib/google/chat-dm.ts`**: `enviarDmChat(email, texto)` →
  `POST /v1/spaces:setup` (idempotente, `spaceType: DIRECT_MESSAGE`) +
  `POST /v1/{space}/messages`. **Reusa o `createSignedJwt` do `auth.ts`**, que já
  aceita `sub` (é assim que o Gmail impersona) — não copiar o código do
  `GOOGLE-CHAT-DM.md`, que reimplementa tudo.
- Envs: `GOOGLE_CHAT_DM_SUBJECT` (default `rpa_ia@gocase.com`) e
  `GOOGLE_CHAT_DM_ENABLED` (gate de dry-run; **desligada na staging** — D8).
- Disparo em `runBackground` no fim do `submeterParaValidacao`, **best-effort**:
  erro só loga (D8). Mensagem = 1 parágrafo + link do `/projeto/$id`.
- Guard: destino `==` `subject` é erro da API do Chat (não dá DM pra si mesmo) →
  tratar como no-op, não como falha.
- Mudo para projetos de teste E2E (`ehProjetoTesteE2E`), igual ao Chat atual.

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
5. **`GOOGLE-CHAT-DM.md` contém chave privada em texto puro** e foi adicionado ao
   `.gitignore` nesta sessão (junto com `openapi.json`). ⚠️ **Não commitar, não
   colar o conteúdo em spec/doc/PR.** Se já tiver circulado, rotacionar a chave da
   SA no GCP.

---

## 6. Pendências fora do código

| # | Pendência | Dono |
|---|---|---|
| P1 | **DWD da SA `godocs@admin-n8n-study`**: autorizar no Google Admin Console (Security → API Controls → Domain-wide Delegation), no Client ID dessa SA, os escopos `https://www.googleapis.com/auth/chat.spaces` e `https://www.googleapis.com/auth/chat.messages.create`. Sem isso a troca do JWT devolve **`401 unauthorized_client`**. Também garantir a **Google Chat API habilitada** no projeto `admin-n8n-study` (senão `spaces:setup` dá 403). | Admin do Workspace |
| P2 | Criar a coluna **`Aprovação do Líder`** no cabeçalho das abas `GoDocs` e `STAGING`. | Luis |
| P3 | Confirmar que `rpa_ia@gocase.com` existe e tem **Google Chat ativo** (é o remetente impersonado). | Luis / TI |

**F0 e F1 não dependem de nada disso** e podem ir a staging → prod antes.
F2 fica codada atrás do gate `GOOGLE_CHAT_DM_ENABLED=false` até P1 sair.

---

## 7. Ordem sugerida

1. **F0** (base + os 2 bugs + testes) → staging → prod. Ganho imediato e isolado:
   conserta as 10 áreas e a paginação, sem tocar em fluxo de submissão.
2. **F1** (aprovação no GoDocs) → depende de P2 pro Sheets, mas a aba e a tabela
   podem ir antes.
3. **F2** (DM) → só quando P1 sair; ligar por env, sem redeploy de código.
