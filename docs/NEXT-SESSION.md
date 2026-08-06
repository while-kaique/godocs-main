# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

## ✅ 06/08 (SESSÃO MAIS RECENTE) — O DISPARO RETROATIVO SAIU: prod restaurada e 28 líderes avisados

**✅ DECIDIDO E FEITO (06/08, decisão do Luis: _"vamos corrigir esses detalhes e fazer o merge"_):** o 403
do líder foi **CORRIGIDO** antes do merge — o Estevão Vidal reportou o bug do lado do usuário no mesmo dia
(*"não to conseguindo abrir a página de 'Ler a documentação completa'"*, print com **"Acesso negado."**), que
é exatamente o achado que barrou o `/ggsd:ship`. Fix na **D28**: 3ª porta de leitura em `getMeuProjeto` para
quem tem linha em `projeto_aprovacoes` (só leitura — `podeEditar` intocado), papel `'aprovador'`, selo
"Aguarda seu parecer"/"Parecer registrado" e link de volta pra `/aprovacoes`. **1124 testes verdes**
(+13: 6 do predicado puro, 5 de `getMeuProjeto`, 1 do critério 6 do plano, 1 do D27). Junto foram fechados
os achados de doc do review: **D27** (especial não abre fila) e **D28** entraram na spec e no `CLAUDE.md`
(regra 12), a **contradição do cron da F3** (`0 9` × `0 12`) foi resolvida na spec, e a sugestão de tirar o
`abrirPreAprovacao` do caminho quente foi **recusada com motivo registrado** (mover ela move o **append da
planilha** junto — o ponto frágil que já purgou projeto; ver §11.6 da spec).

**✅ DEPLOY FEITO (06/08, 18:00–18:05 UTC) — staging `edf400b4` e prod `674a3710` estão com a `main`.** Os 2
apps e o repo ficaram sincronizados (era o pedido do Luis: *"deixe tudo sincronizado aí"*). Para isso, antes do
deploy, **2 branches que estavam fora da `main` foram integradas** (PR **#237**): `fix/pre-pendente-sempre-e-traco`
— que **já estava no ar** e o deploy da `main` teria apagado (5º atropelo da mesma natureza) — e
`fix/erro-validacao-amigavel` (caso Josiely). Os 2 planos que só existiam como arquivo não-commitado na raiz
entraram no PR **#238**, e a raiz foi fast-forwardada (estava 143 commits atrás).

**Como a staging foi validada** (o edge **não** aceita header de identidade injetado — não dá para se passar por
líder, então a validação é indireta): (1) `POST /api/chat/iniciar-submissao` com `ferramenta` de 248 chars
devolveu **400 com a frase em PT-BR** nomeando "Ferramenta utilizada" — código que só existe no build novo (o
mesmo POST em prod, ANTES do deploy, devolvia **500 com o ZodError cru**); (2) `/api/aprovacoes/pendentes` 200;
(3) o `index.html` servido aponta para o MESMO entry do `dist/` local e o chunk `projeto._id` contém o selo novo.
Depois do deploy de prod, os 3 checks passaram lá também.

**Prova de que o caso do Estevão está resolvido, sem depender de tela:** `GET /api/aprovacoes/pendentes?como=estevao.vidal@gocase.com`
(preview de admin, em PROD) devolve **exatamente 1 item — o projeto `323278fc…` "INVENTÁRIO ESTÚDIO GOGROUP"
(autora Joyce Lima)**, o mesmo do print. Ter linha em `projeto_aprovacoes` é a **única** condição da porta nova
(D28), então `/projeto/323278fc…` agora responde 200 para ele.

**🆕 PEDIDO NOVO DO LUCAS (06/08, fim do dia, por Chat — ainda NÃO planejado, NÃO codado):** *"No card de
aprovação também tem que ter a info do que a pessoa marcou naquele 'se alguém fazia'."* Ou seja: o card da fila
`/aprovacoes` precisa mostrar a resposta de **"Alguém já fazia esse processo antes?"** (`alguem_fazia`), porque é
ela que diz se as horas são **reais** (alguém fazia), **contrafactuais** (ninguém fazia, estimado como se fizesse)
ou se o ganho é **custo externo evitado** (contrato encerrado, 0h) — três casos com o MESMO R$ e credibilidade
diferente, e é justamente o que ele precisa para responder a 3ª pergunta do checklist ("o saving é coerente?").
⚠️ **Hoje o campo NÃO viaja no payload:** `ItemAprovacao` (`src/lib/aprovacoes.functions.ts`) traz
`saving_horas`/`saving_reais`/`tipo_saving`/`ganho_total`/custo externo/custo evitado/receita, e `alguem_fazia`
não está lá — então é agregada da fila → tipo → render no card, com **rótulo legível** (nunca o valor interno
`sim`/`nao`/`externo`). **2 perguntas para ele ANTES de codar, porque mudam o escopo:** (1) só esse campo ou o
pacote da Etapa 2 junto (a composição das horas antes/depois por cargo é o irmão natural para julgar coerência)?
(2) que rótulo ele quer no **custo evitado puro** — um "Não" seco esconde o caso mais delicado. Começar por
`/ggsd:plan` (é mudança de payload + UI → regra 11, skill `frontend-design` antes de codar).

**⛔ PRÓXIMO PASSO — a única coisa que falta é olho humano de LÍDER (2 coisas, 1 clique cada):** pedir ao
**Estevão** (ou ao Lucas) para abrir o link do card outra vez e confirmar que a doc aparece — e, na mesma
passada, **provar o wiring do aviso na submissão** (o único pedaço da D26 nunca exercitado ponta a ponta):
acompanhar a próxima submissão real de um liderado e conferir no `GET` do endpoint do Gomoon (`?email=`) que a
DM saiu. Nada disso é código pendente.

<details><summary>Histórico: o que o ship barrou (resolvido acima)</summary>

o `/ggsd:ship` rodou e
**NÃO mesclou** o PR #235: o revisor de conformidade em contexto fresco devolveu **`diverge-alta`
(confiança 0,74)**. Escolher entre **(a)** mesclar assim mesmo — recomendado: a proteção contra o atropelo
vale mais hoje que o link quebrado — ou **(b)** corrigir o 403 antes (fatia curta e independente) e mesclar
tudo junto. Enquanto não mesclar, o próximo deploy de outra frente derruba a feature de novo, agora com
**36 filas abertas e 28 líderes já avisados**.

**O achado que barrou o merge — `src/routes/aprovacoes.tsx:859`:** o card da fila oferece *"Ler a
documentação completa"* → `/projeto/$id`, mas o gate segue `ehOwner || ehParticipante`
(`meus-projetos.functions.ts:154,483`) — o líder não é nenhum dos dois e leva **403**. É a **T3 do plano F1**
e o **critério de aceitação nº 2**, que a spec ainda afirma cumprido (`SPEC_APROVACAO_LIDER.md:198`). ⚠️
**Não trava a decisão** (o card é auto-suficiente por decisão — D13/D15), mas 28 líderes acabaram de ser
convidados para `/aprovacoes` e quem clicar nesse link bate no erro. Fix: estender `temAcesso` a quem tem
aprovação PENDENTE, **sem** conceder edição (+ o teste do predicado, que não existe).

**4 achados de baixa severidade** (não bloqueiam, ficam de lição de casa): `abrirPreAprovacao` é **aguardado**
no caminho quente do submit em vez de `runBackground` (`chat.functions.ts:3319` — não derruba, mas soma a
latência da TeamGuide) · o casamento tolerante de coluna mexeu no **sync inteiro**, além do blast-radius
aprovado (`google/sheets.ts`, testado e com guarda de ambiguidade) · a **D27 não está na spec nem no
`CLAUDE.md`**, só neste doc (**regra 12**) · a spec se contradiz sobre o cron da F3 (`0 9` × `0 12`, o código
usa `0 12` = 09h BRT) e o critério 6 não tem teste.

✅ **Os 5 invariantes críticos passaram, com evidência:** `abrirPreAprovacao` nunca lança (try/catch +
teste) · **zero R$** no payload do Gomoon (teste varre o JSON) · `projeto_aprovacoes` inalcançável pelo sync
reverso · `Status` do Sheets nunca tocada · `Atualizado Em` só lida pelo dashboard. Nenhum escopo vazado em
código de produção fora da feature. **Sem CI no repo** — quem decide o merge é só esse review.

</details>

**O que a sessão executou, os 4 passos, em produção** (o Luis pediu: *"fazer o disparo de retroativo e
que toda submissão que cair faça a comunicação para a api do gomoon"*):

| Passo | Resultado |
|---|---|
| 1. Prod restaurada (`674a3710`) | entry `index-CpHphllJ.js` — o MESMO da staging; `GET /api/aprovacoes/pendentes` voltou de **404** para 200 |
| 2. Backfill (`/api/admin/aprovacoes/reabrir`) | **36 reabertos · 0 isentos · 0 ignorados · 28 líderes** |
| 3. Aba "Relação Líder-Liderado" regravada | 78 linhas, batendo **exatamente** com o payload (36 projetos · 40 linhas · 28 líderes) |
| 4. Disparo (`/api/admin/notificar-lideres {dry:false}`) | **202** · 28 líderes / 33 liderados / 40 projetos · **0 falhas** · entrega conferida no `GET ?email=` (`entregue` + `messageName`) |

**A segunda metade do pedido — submissão nova avisa na hora — já está no ar** (D26, restaurada por este
deploy) e foi validada em prod por **dry-run com `projetoId`**: chave **por projeto**
(`godocs:<email>:<projetoId>`), só o líder daquele projeto, `ambiente: producao`. Como as chaves (dia ×
projeto) são independentes, o líder que recebeu o retroativo hoje **recebe de novo** numa submissão nova.
⚠️ **Segue sem prova ponta a ponta o wiring dentro do `submeterParaValidacao`** — só uma submissão real
fecha isso; acompanhar a próxima pelo `GET ?email=` do Gomoon.

**Ensaio antes de falar com 28 pessoas (o Luis pediu):** o payload REAL da Kelly (3 projetos, a forma com
bullets) foi POSTado direto na API do Gomoon com o destinatário trocado para o Luis e **chave própria**
(`…:ensaio-retroativo-20260806`, para não queimar a chave de ninguém). Entregue; ele aprovou a formatação
(*"recebi a msg do gomoon, perfeito. Pode enviar assim pros retroativos"*).

**Decisão registrada — a PLANILHA é a fonte da verdade do que está pendente** (resposta do Luis a uma
pergunta direta dele nesta sessão). Vale saber que são **duas fontes em dois momentos**: quem **entra** na
lista sai do Sheets (`readAllRows`, `Status == "pendente"` + régua D27/D20/TeamGuide), mas quem é
**reaberto** e quem **recebe** a DM sai do **SQLite** (`getProjetoById` → `projeto_aprovacoes` →
`getPendenciasPorLider`, que nunca lê a planilha). Elas só coincidem porque o backfill copia uma na outra.
⚠️ E `"Pendente"` no Sheets **não** quer dizer "esperando o líder": pela regra TEMPORÁRIA o sync grava
"Pendente" em tudo, então o filtro é, na prática, *"submetido e ainda não triado pela RPA"*.

**2 achados do caminho — o 2º virou correção (commit `2c577ec`, 1112 testes):**
1. **Caixa do id divergente entre as duas fontes:** `LEGADO-184`/`185` existem na planilha em MAIÚSCULAS e
   no SQLite em minúsculas; o `reabrir` casa por igualdade e devolveu *"projeto não existe no SQLite"* —
   **sem erro, o item só some da lista**. Corrigido na chamada (minúsculas); a divergência em si continua.
2. **O `reabrir` NÃO filtra `[E2E-…]`** — o filtro do runtime mora em quem monta o payload da DM
   (`getPendenciasPorLider` + o guard do aviso imediato). Sem cortar, o backfill abriria **pendência falsa
   na fila do líder do harness**, e a aba de conferência listaria uma linha que o disparo não cobre. O
   filtro entrou nos DOIS scripts (`ids-fila.ts` e `relatorio-sheet.ts`).

<details><summary>🚨 06/08 (sessão anterior) — PROD FOI ATROPELADA: a feature saiu do ar e uma submissão real se perdeu (RESOLVIDO)</summary>

⚠️ **Resolvido às ~14:08 pelo deploy acima.** O risco estrutural, porém, **continua vivo enquanto o PR #235
não for mesclado** — foi exatamente assim que aconteceu.

## 🚨 06/08 — PROD FOI ATROPELADA: a feature saiu do ar e uma submissão real se perdeu

<details><summary>Histórico da sessão paralela do mesmo dia (coluna do líder nunca vazia + re-sync)</summary>

## 🔧 06/08 (SESSÃO MAIS RECENTE) — coluna do líder nunca nasce vazia + o re-sync deixou de APAGAR o parecer

**PRÓXIMO PASSO EXATO:** **mesclar `fix/pre-pendente-sempre-e-traco` na
`worktree-plano-aprovacao-lider-teamguide` (PR #235)** e, **quando a outra frente liberar**,
deployar prod (`674a3710`). ⚠️ O Luis avisou no meio da sessão que **estava mexendo no GoDocs
em paralelo** — por isso **prod NÃO foi tocada** e o merge não foi feito por conta própria (a
branch da feature pode estar em uso). Enquanto o fix não estiver na branch da feature, **o
próximo deploy dela repete o buraco** (é o 4º atropelo da mesma natureza).

**Plano ativo:** nenhum — esta sessão foi um fix direto a partir de um sintoma reportado, sem
`docs/plans/<slug>.md`. Próximo trabalho novo deve começar por `/ggsd:plan`.

### O sintoma NÃO era o que parecia (e isso é o achado que vale guardar)
Reportado: "os novos submetidos estão sendo submetidos com essa linha sem nenhum status" +
"a justificativa indo sem o hífen". **Não era mapeamento de coluna.** Prova dura:
- Cabeçalho real de prod: **53 colunas**, `AE "Aprovação do Líder"` + `AF "Justificativa
  Aprovação do Lider"` **existem**, **zero chave ambígua** (script novo `cabecalho-full.ts`).
- `getApp(674a3710)` → **version 227** com a `userDescription` dos fixes do analisador, e
  `GET /api/aprovacoes/pendentes` → **404**: a prod estava rodando o **`main`, SEM a feature**.
  Sem o código, o sync nunca recebia as 2 chaves → `orderValuesByHeaders` escrevia `''` →
  **célula em branco**. Restaurado na **version 228** (`17:08 UTC` = 14:08 BRT), por outra
  frente, ~5 min antes desta sessão olhar.
- ⚠️ **O `—` na AF das linhas de 03–05/08 NÃO foi o sistema** (a feature não estava no ar
  nessas datas): foi **preenchimento manual** da planilha. A última linha da janela (E2E de
  14:07 BRT, 1 min antes do restore) tem as **duas** células vazias — a assinatura exata do
  build sem feature. Não gaste tempo procurando bug de escrita nessas linhas.
- ⚠️ **Diagnostique por `getApp` + `GET /api/aprovacoes/pendentes`, NUNCA pela tela**
  `/aprovacoes` (o SPA fallback a abre mesmo sem a feature — casca).

### O bug de código REAL, achado no caminho: o re-sync apagava o parecer do líder
`resyncGoogle` chamava `syncSubmitToGoogle` **sem** `aprovacaoLider`/`justificativaAprovacaoLider`,
e a linha fazia `ouTraco(p.aprovacaoLider)` sem condição → `undefined` virava **`—`** e o
`updateRowByProjectId` gravava isso **por cima do parecer que o líder já tinha dado** (estado +
assinatura + checklist + comentário). Ou seja: a ferramenta de **RECUPERAÇÃO** (linha morta por
cota 429) **destruía a pré-aprovação** do projeto que ia salvar.

**Fix:** nessas 2 colunas **`undefined` ≠ `null`** — `null` = "não se aplica" → grava `—` (a
célula **nunca** nasce vazia, **inclusive no append de RECUPERAÇÃO**: foi o teste que pegou esse
ramo, porque ele monta a linha a partir do `row` do modo `edicao`, que já não trazia as chaves);
**`undefined` = "não sei, não encoste"** → coluna **OMITIDA do update**. `resyncGoogle` passa o
estado REAL derivado de `getAprovacoesDoProjeto` pelas funções puras que já existiam
(`rotuloAprovacaoSheet`/`justificativaAprovacaoSheet`) e **não reabre fila** (isso é
`reabrirPreAprovacoes`).

### Decisões do Luis nesta sessão (fechadas — não "consertar" por engano)
- **`Pré-pendente` só quando a fila REALMENTE abre.** As **D12/D20/D27 ficam de pé** (coordenador+
  → `Pré-aprovado`; especial · sem líder · TeamGuide fora → `—`). Rótulo incondicional "igual ao
  Status Pendente" diria "esperando o líder" em projeto que **nunca** entra na fila de ninguém e
  quebraria a aba de espera por líder. O que a planilha ganha é **nunca ficar vazia**.
- **Sem retroativo:** *"só com os novos submetidos essa condição"* — **nenhum backfill**. Os
  projetos da janela sem-feature (incl. "Hub de Importação"/Gustavo Castro, 13:41 BRT) **não**
  são regularizados, e a lista de backfill dos handoffs anteriores **não** deve ser rodada
  sem nova decisão dele.

### Estado da entrega
- **2 commits** em `fix/pre-pendente-sempre-e-traco` (`dcfd26c` fix + `928b44d` scripts).
  `worker.js` rebuildado e commitado (regra 1). `CLAUDE.md` + `SPEC_CORRECOES.md` atualizados
  (regras 7/12). **1118 testes verdes** (+6).
- **Novo teste:** `tests/sync-aprovacao-lider-colunas.test.ts` — 6 casos, incl. **"re-sync não
  toca as colunas"** e **"recuperação nasce preenchida"**.
- ⚠️ Os 7 erros de `npx tsc --noEmit` são **pré-existentes** (idênticos na branch base, em
  arquivos não tocados) — não são desta sessão.
- **VALIDADO NA STAGING** (`edf400b4`, deploy 17:31 UTC) com **1 cenário E2E real**
  (`E2E_ONLY=saving-puro`): a linha nasceu com **`Pré-pendente`** + **`Aguardando Lucas
  Goncalves Queiroz`**, e as linhas antigas da mesma aba mostram as 2 células vazias. Limpeza
  feita (`GOOGLE_SHEETS_TAB=STAGING`, planilha antes do SQLite).

### Scripts de leitura pura novos (fora do `npm run test`)
- **`scripts/dryrun-lider/cabecalho-full.ts`** — cabeçalho inteiro + **chaves ambíguas** + colunas
  que o código conhece e o cabeçalho não tem. É o que mata a hipótese "mapeamento de coluna".
- **`scripts/dryrun-lider/ultimas-linhas.ts`** — últimas N linhas nas colunas que importam;
  **`ABA=STAGING`** inspeciona a staging (default `GoDocs` = **PRODUÇÃO**).
- **`scripts/dryrun-lider/cargo-de.ts`** — `ALVO=<email>`: cargo + isenção D20 + líderes + estado
  esperado. Serve para escolher um autor **não-isento** antes de exercitar a fila ponta a ponta.
- ⚠️ **O worktree não tem `.env`** — harness E2E e estes scripts não o acham. Rodar com
  `set -a; . /home/notebook/godocs-main/.env; set +a` e **sempre** passar `E2E_BASE_URL` e
  `GOOGLE_SHEETS_TAB` explícitos: **o default dos dois é PRODUÇÃO**.

---

## 🚨 06/08 (sessão anterior) — PROD FOI ATROPELADA: a feature saiu do ar e uma submissão real se perdeu

</details>


**PRÓXIMO PASSO EXATO:** ⚠️ **aplicar o deploy em PROD (`674a3710`) para RESTAURAR a pré-aprovação** —
o build está pronto e validado (merge do `origin/main` + D27, **1112 testes**, staging `edf400b4`
deployada 16:45 UTC e respondendo). Só falta `getUploadToken` → `scripts/deploy-godeploy.sh` →
`updateApp` no `674a3710`. **Depois** dele: backfill → dry-run → disparo (passos 2-4 abaixo).

### 🔥 O achado que interrompeu a sessão — prod ficou SEM a feature por um deploy de outra frente
**A pré-aprovação do líder NÃO está no ar em produção agora.** Prova dura, não dedução:
`getApp(674a3710)` → `updatedAt 2026-08-06 16:24:11 UTC` (**13:24 BRT**), **version 227**, com a
`userDescription` dos **fixes do analisador** — exatamente os 2 commits (`41ac22e`+`76b22fb`) que
estavam no `origin/main` e faltavam nesta branch. E `GET /api/aprovacoes/pendentes` em prod devolve
**404 "Rota não encontrada"**. Ou seja: outra frente deployou o `main` (que **não tem**
`aprovacoes.functions.ts`) em cima do deploy da D26 das ~12:20 e **apagou a feature inteira de prod**.
- **Custo real, já materializado:** o **Gustavo Castro** submeteu "Hub de Importação"
  (`9a71f410d3289dddd51e4a33acc2989d`) às **13:41:28 BRT — 17 min depois do atropelo** — e a líder
  **Vitória Azevedo** nunca foi avisada. Não foi bug de régua: o projeto **não é especial**
  (`Especial? = "Não"`), o autor é `Analista de Supply Chain Jr` (**não** isento pela D20) e a líder
  derivada da TeamGuide **é** a Vitória. A fila devia ter aberto e não abriu porque o código não
  estava lá. Auditoria do Gomoon (`GET ?email=vitoria.azevedo@gocase.com`): **1 item, `tipo:"anuncio"`**
  (entregue 12:01 BRT) e **zero** aviso de pendência — o POST nunca saiu daqui.
- ⚠️ **`/aprovacoes` ainda ABRE em prod e isso NÃO significa que a feature está lá** — é o fallback SPA
  servindo o `index.html`, e uma aba antiga ainda carrega o bundle da D26 do cache do GoDeploy (o
  GoDeploy **acumula** assets). A tela é casca: toda chamada dela bate no 404 acima. **O teste honesto
  é o `GET /api/aprovacoes/pendentes`**, nunca a tela.
- ✅ **O merge do `origin/main` (regra 10) salvou os fixes deles:** o build pronto tem feature + D27 +
  os 2 fixes do analisador. Deployar a branch **sem** o merge teria apagado o trabalho da outra frente.
- 🔁 **Vai repetir enquanto a branch não estiver no `main`** (já aconteceu 3× na staging em 04/08, agora
  em PRODUÇÃO). O que fecha o buraco de verdade é **mesclar o PR #235**.
- ⚠️ **A lista do backfill precisa ser RE-DERIVADA**: quando rodou eram **73 pendentes → 35 na fila**;
  com o projeto do Gustavo já são **74**, e ele tem de entrar. Rodar de novo o
  `scripts/dryrun-lider/ids-fila.ts` (novo nesta sessão) imediatamente antes do passo 2.

### 🔎 Scripts de leitura pura criados nesta sessão (todos fora do `npm run test`)
- **`scripts/dryrun-lider/ids-fila.ts`** + `.config.ts` — imprime o `projetoIds` do backfill com a MESMA
  régua do `relatorio-sheet.ts`; `IDS_FILA_OUT=<arquivo>` grava o corpo do POST pronto.
- **`scripts/dryrun-lider/diag-projeto.ts`** + `.config.ts` — `PROJETO=<id>`: linha da planilha nas
  colunas que importam + cargo do autor + isenção D20 + líderes derivados. Foi ele que matou a hipótese
  "era especial".
- ⚠️ **Cabeçalho de prod conferido (`hdr.ts`): as colunas EXISTEM** — `AE "Aprovação do Líder"` e
  `AF "Justificativa Aprovação do Lider"` (sem acento, resolvida pelo match tolerante da D18). Vazias
  na linha do Gustavo porque `abrirPreAprovacao` não rodou, **não** por falta de coluna.
- ⚠️ **O `rtk` engole a saída destes scripts** — redirecionar para arquivo e ler o arquivo.

**PENDÊNCIA ANTERIOR AINDA VÁLIDA:** a staging já tem a D27; o que falta é prod (acima).

**D27 (decisão do Luis, 06/08/2026) — projeto ESPECIAL não é pendência do líder.** Commit `5e40491`,
**1102 testes**, staging `edf400b4` deployada 16:32 BRT. Motivo: especial **não tem memorial financeiro**,
então a 3ª pergunta do checklist do gestor (*"o saving faz sentido?"*) não teria o que julgar — e o destino
dele sempre foi a validação humana da RPA.
- `abrirPreAprovacao` **não abre fila** para especial, com `motivo: 'especial'` + justificativa própria (D12:
  a auditoria precisa distinguir isenção legítima de falha de integração).
- ⚠️ O guard roda **ANTES da TeamGuide** — é flag do projeto, não depende de rede.
- Rede de segurança no SQL das **3** consultas que definem "pendente": payload da DM (`getPendenciasPorLider`),
  tela do líder (`getAprovacoesPendentesDe`) e o **CONTADOR** da faixa da home
  (`contarAprovacoesPendentesDe`, que ganhou o `JOIN` — sem ele diria "3 pendentes" e abriria uma fila de 2).
- O script `scripts/dryrun-lider/relatorio-sheet.ts` aplica a mesma régua (lê a coluna `Especial?`).

**Relação de prod REGRAVADA em 06/08 13:31** (aba "Relação Líder-Liderado", 75 linhas, `RELATORIO_WRITE=1`):
**73 pendentes → 35 projetos na fila (39 linhas, 27 líderes)** · **38 fora**: **29× projeto especial** ·
8× isento por cargo · 1× autor fora da TeamGuide. (Antes da D27 eram 64 na fila — os especiais eram quase
metade.) ⚠️ **Michael e Gesiel não precisaram de exceção manual**: caem sozinhos em "Autor não está
cadastrado na TeamGuide". Só que a categoria mostra **1**, não 2 — provável que o projeto do outro seja
especial (o filtro do especial roda ANTES, por ser característica do projeto). **Conferir qual está onde.**

### ⏭️ O disparo RETROATIVO — os 4 passos, NESTA ordem
1. **Deploy em PROD (`674a3710`)** — agora ele faz DUAS coisas: **restaura a feature** (prod está sem ela
   desde 13:24) e traz a D27. ⚠️ **TEM de vir antes do backfill**, senão os 29 especiais entram na fila.
   O build já está pronto: merge do `main` + `npm run test` (1112) + `build` + `build:worker`, e a
   **staging já foi deployada e validada** com este mesmo build (`/api/auth/me` → 200).
2. **Popular a fila em prod** com os 35 projetos: hoje ela está **VAZIA** (`abrirPreAprovacao` só roda em
   submissão nova; não há importação retroativa). Usar `POST /api/admin/aprovacoes/reabrir` — ⚠️ **fail-closed**:
   exige `projetoIds` OU `autorEmail`, não existe "reabre tudo", e `dry` é o DEFAULT.
3. **Dry-run do disparo** (`POST /api/admin/notificar-lideres {"dry":true}`) para o Luis conferir a lista
   nominal dos 27 líderes ANTES de qualquer DM.
4. **Disparo real** (`{"dry":false}`) — ⚠️ **27 líderes REAIS recebem DM**. O Luis autorizou o disparo, mas
   pediu para confirmar antes deste passo.

⚠️ **Outra sessão mexeu neste doc em paralelo** (a seção "Aprovações Pendentes por Líder" abaixo apareceu
durante esta) — conferir se as duas abas de relatório na planilha de prod não se atropelam.

---

</details>

## ✅ 06/08 — aba "Aprovações Pendentes por Líder" na planilha de PROD

**Plano ativo:** [`docs/plans/teamguide-lideranca-e-areas.md`](plans/teamguide-lideranca-e-areas.md) — segue
**executado**. Esta sessão não mexeu em código de aplicação: é **ferramenta de gestão** (script de relatório),
irmã da aba "Relação Líder-Liderado".

**O que motivou:** o Luis pediu *"uma aba no sheets de prod, assim como a de líder-liderado, com uma relação
de líderes com projetos pendentes pra aprovação — nome, e-mail, quantidade de projetos e o estado — porque
preciso saber quem está há mais de 5 dias esperando aprovação"*.

**O que foi feito** (commits `43e425f` + `84ff92a`, **1101 testes verdes**, aba criada e regravada em prod):
- **`scripts/dryrun-lider/relatorio-espera.ts`** + `espera.config.ts` — mesma mecânica do
  `relatorio-sheet.ts` (aba dedicada, limpa-e-regrava, `ESPERA_WRITE=1` para escrever, dry-run por default),
  mesma régua de fila da produção (**D20**, isenção por CARGO) para o relatório não contar uma coisa e o
  sistema fazer outra. Corte configurável por `ESPERA_LIMITE_DIAS` (default 5) — é decisão de gestão.
- **A 1ª versão foi CORTADA pelo próprio Luis no mesmo dia** (*"está com muita informação, resume essa aba, eu
  quero uma coluna com os dias pendentes: 50, 30, 20, 2, 3, 5"*): de 3 tabelas / 11 colunas / 121 linhas para
  **1 tabela de 5 colunas** e 34 linhas — Líder · E-mail · Projetos pendentes · **Dias pendentes** (a LISTA
  por projeto, mais antigo primeiro) · Mais antigo (dias), essa numérica para ordenar na planilha.
- **Depois ele pediu a coluna das PESSOAS de volta** (commit `13da550`): *"quero também uma relação de quem é a
  pessoa que esse líder tá pendente, pq quero a info pra pesquisar o projeto da pessoa e ver se você acertou"* →
  **"Quem está esperando (dias)"** = `Samuel da Silva Campos — 128 · Samuel da Silva Campos — 8`. Como a coluna
  É a conferência, as duas listas saem da **MESMA** ordenação (`porEspera`): ordenando cada uma por conta
  própria, `42, 34` e `Ana — 34 · Bruno — 42` sairiam trocados e a conferência apontaria a pessoa errada. O
  dry-run passou a imprimir uma amostra `dias | pessoas` para checar o pareamento antes de escrever.
- **Duas coisas que parecem bug na conferência e NÃO são:** o mesmo autor 2× na linha (são 2 projetos dele) e o
  mesmo autor sob 2 líderes (pessoa em 2 times → 2 linhas, o **primeiro que decide resolve** — D4).
- **Escrita confirmada por LEITURA de volta** da aba (`values.get`, HTTP 200, 6 colunas) — não ficou só no
  "a API não reclamou".
- ⚠️ **Correção registrada para não virar folclore:** a tabelinha de exemplo que eu mostrei no chat (`128, 128`,
  `128, 6`) foi montada de cabeça, **não lida da planilha** — os valores reais são `128, 8` nas duas primeiras
  linhas. Os agregados (56 na fila · 31 líderes · 41 acima de 5 dias · máxima 128) vieram do run e valem.
- O que segue fora está **listado no cabeçalho do script** (cargo, contagem acima do corte, média, detalhe
  projeto a projeto, tabela dos que não esperam líder) — voltar tem de ser decisão, não arqueologia. Ofereci
  colocar o **nome do projeto** junto da pessoa (pouparia a busca dele na conferência); ele não respondeu.

**Retrato do 1º run (06/08, 12h50 BRT):** 73 pendentes → **56 na fila de 31 líderes** · **41 projetos acima de
5 dias, com 26 líderes** · espera máxima **128 dias** (Samir Labib e Stefany Costa) · maior volume Natalia
Pavão, 6 pendentes.

**⚠️ Duas ressalvas que mudam a leitura dos números** (a 1ª está escrita no cabeçalho da aba):
1. O **relógio é a coluna `Data Submissão`**. Para projeto submetido pelo app é exatamente quando a fila do
   líder abriu; para **LEGADO** (a maioria dos pendentes) a fila nunca abriu — ali o número é a **idade da
   pendência**, não o tempo em que o líder viu o projeto.
2. A coluna **`Aprovação do Líder` está VAZIA nos 73 pendentes** — produção entrou em 06/08 **sem backfill**.
   Foi por isso que **o estado saiu da aba**: hoje seria uma coluna com o mesmo valor em todas as linhas.
   Quando as novas submissões preencherem (`Pré-pendente`/`Pré-aprovado`/`Ajuste pedido`/`Pré-reprovado`),
   vale trazer de volta.

**Pendências desta frente que seguem abertas:** exercitar o **wiring do aviso imediato numa submissão real em
prod** (falha ali é silenciosa-mas-benigna) · decidir se liga também o **cron do resumo diário** (código
pronto, não agendado) · **PR #235** aberto, aguardando merge.

## ✅ 06/08 — D26: o aviso ao líder virou IMEDIATO e a feature FOI PARA PRODUÇÃO

**Plano ativo:** [`docs/plans/teamguide-lideranca-e-areas.md`](plans/teamguide-lideranca-e-areas.md) — segue
**executado**; execução direta por cima. ⚠️ **A trava "só depois da diretoria" caiu**: o Luis mandou subir, e
o **anúncio global já tinha sido disparado em produção pelo João Victor** (~12:00 BRT, `ambiente:"producao"`,
entregue) — a empresa já sabe da feature.

**O que motivou:** o Luis perguntou o que faltava para prod e disse que o desenho certo é *"submissão nova já
dispara pra API"*. Eu tinha respondido que a integração era diária — **estava errado**: a **§9 do doc v3 do
João Victor** diz *"entregamos a DM na hora em que recebemos o POST"*. A cadência **sempre foi escolha nossa**
(o cron + a data dentro da chave de idempotência), e mudá-la **não exigiu nada do Gomoon**.

**O que foi feito** (commits `ae1835b` + `6af2636`, **1111 testes**, staging `edf400b4` e prod `674a3710`
deployadas ~12:20 BRT):
- `notificarLideresDoProjeto(projetoId, aprovadores, {nomeProjeto})` sai do fim de `submeterParaValidacao`
  via `runBackground`, logo após `abrirPreAprovacao`.
- **Chave por PROJETO** (`godocs:<email>:<projetoId>`, `chaveDeProjeto`) — com a chave diária, a **2ª
  submissão do dia** para o mesmo líder voltaria `ja_entregue` (§8) e a DM sumiria **em silêncio**. A chave é
  string OPACA do lado deles (§3), então o formato é nosso.
- Manda o **BACKLOG do líder**, não só o projeto que disparou — devolve o efeito de lembrete do digest e sai
  da MESMA agregada da tela `/aprovacoes`.
- **Guard `[E2E-…]` EXPLÍCITO** no caminho imediato: a agregada filtra o projeto de teste, mas sem o guard a
  submissão E2E ainda dispararia a DM do **backlog** do líder.
- **Nunca manda `lideres: []`** (invariante do CRON) e **nunca lança** (D3).
- Rota admin aceita `{"projetoId":"…"}` para ensaiar o caminho quente sem passar um formulário inteiro.
- Doc drift corrigido: o commit `4fce723` tirou a linha `👉` do texto, mas `CLAUDE.md` e o jsdoc seguiam
  dizendo que ela ficou.

**Validação.** Staging: dry-run (chave por projeto certa, **só o líder daquele projeto**, texto sem menção a
staging) → envio real **202, 0 falhas** → log do Gomoon `status: entregue`, `messageName` presente. Prod:
dry-run devolveu **`ambiente:"producao"`** e **`lideres: []`** — a fila nasce vazia (não há backfill), então as
DMs começam na **próxima submissão real**.

**O medo do Luis, respondido com prova:** o prefixo `[STAGING — destinatário real: …]` **é escrito pelo
GOMOON**, não por nós — o anúncio que saiu hoje em `ambiente:"producao"` chegou **sem prefixo**, direto no
`lucas.queiroz@`. Prod **não tem** `GODOCS_ENV`, logo `ambiente:"producao"`. Teste explícito prende as 2 pontas.

**Estado dos secrets/cron:** `GOMOON_TOKEN` **setado nos 2 apps** (prod desde 12:09 BRT) — o mesmo token serve
os 2 ambientes e as 2 rotas (§1 do doc v3); **não existe "token de produção pendente"** (isso ficou
desatualizado no nosso doc). **Nenhum cron `notificar-lideres` existe** — o snapshot diário segue implementado
e testado, só **não agendado**.

**Repo sincronizado + PR aberto (06/08, fim da sessão):** `git fetch` mostrou `origin/main` **parado** — a
branch já estava em cima dele (0 atrás), então **nada a mesclar e nenhum rebuild**. Push dos 3 commits
(`ae1835b`, `6af2636`, `779bbf8`) e **PR [#235](https://github.com/while-kaique/godocs-main/pull/235)** aberto
pela conta `LuisEduardo100` (a `rpaiagogroup` é READ). ⚠️ A branch já tinha um PR **MERGED** antigo (#221) —
por isso o #235 é novo, não uma reabertura.

⏰ **"Às 14h começa o disparo normal" — NÃO existe horário.** Com a D26 o aviso sai **na submissão**; não há
cron nem janela agendada, e a feature **já estava no ar desde ~12:20**. Respondido ao Luis com as 2 leituras
possíveis, **pendente a escolha dele**: (a) só acompanhar (nada a fazer) ou (b) querer **também** um resumo
diário às 14h — aí é criar o cron `0 17 * * 1-5` (UTC), com o código do snapshot já pronto e as chaves
(dia × projeto) independentes. ⚠️ Lembrar que o **Lucas pediu MENOS ruído** (D25) antes de ligar o diário.

**Pendências desta sessão:**
1. ⚠️ **O wiring do `submeterParaValidacao` NÃO foi exercitado ponta a ponta** — validei
   `notificarLideresDoProjeto` pela rota admin, mas as 6 linhas dentro do submit só rodam numa submissão real.
   Falha ali é **silenciosa mas benigna**: a DM não sai, a submissão **não** cai. Provar com 1 submissão na
   staging, ou acompanhar a 1ª submissão real de prod pelo `GET` no endpoint do Gomoon (`?email=`).
2. **Perdemos o heartbeat**: sem o cron diário, silêncio virou ambíguo ("ninguém submeteu" × "quebrou").
3. **3 perguntas ao João Victor** (nenhuma bloqueia, detalhe no §16 de `docs/integracao-gomoon-chat.md`):
   descarte de item em retry quando chega POST novo (§8, 3º bullet, escrito para 1 lote/dia); volume (N POSTs
   espalhados); e confirmar que **ele** dispara o anúncio à mão — a §4 exige `mensagem.texto` no corpo e
   **nada no GoDocs chama esse endpoint**.
4. **Nada foi para o `main`** — os 2 commits estão só na branch, sem push nem PR.

---

## ✅ 06/08 — D24/D25: o anúncio saiu do GoDocs e a DM ao líder encolheu

**Plano ativo:** [`docs/plans/teamguide-lideranca-e-areas.md`](plans/teamguide-lideranca-e-areas.md) — segue
**executado**; execução direta por cima dele (nenhum plano novo). A feature inteira continua **travada para
prod** até a validação com a diretoria.

**O que motivou:** o Luis pediu para disparar o aviso do líder e ver como chega. Do disparo saíram 3 pedidos
— dele, do chefe dele e do **Lucas Queiroz** (o líder que recebe a DM).

**O que entrou (staging `edf400b4`, deployada 2× nesta sessão, 1091 testes verdes):**
1. **D24 — o ANÚNCIO GLOBAL saiu do GoDocs.** Quem guarda o texto e dispara é o **Gomoon**. Removidos
   `TEXTO_ANUNCIO_PRE_APROVACAO`, `ANUNCIO_VERSAO`/`ANUNCIO_CHAVE`, `montarPayloadAnuncio`,
   `anunciarPreAprovacao`, a rota `POST /api/admin/anunciar-pre-aprovacao` e os testes do anúncio.
   **Não reimplementar.** O texto acordado (com os ajustes do chefe: sem a lista das 3 perguntas · com
   **"reprova"** como 3º veredito · "coordenação+ vai direto para a validação do time de RPA" · "uma vez
   ajustado" · "saem corretas") está registrado no **§15.1** de `docs/integracao-gomoon-chat.md`.
2. **D25 — a DM ao líder encolheu**, por pedido do Lucas: saíram a frase das "três perguntas rápidas", a
   ressalva "Situação em … pode ignorar" (levou junto `dataHoraBRT` e o parâmetro `geradoEm`) e, depois,
   a linha `👉 <url>` — o cartão já monta o botão "Abrir a fila" do campo `url`. ⚠️ **O campo `url`
   continua obrigatório**: é o destino do botão e agora o ÚNICO caminho até a fila.
3. Os 3 cortes viraram **teste** (`tests/gomoon-mensagens.test.ts`) — voltar atrás tem de ser decisão.

**Validado na staging (2 disparos reais, `202`, 0 falhas):** caso de **1 pessoa/1 projeto** (Lucas ← Luis) e
caso de **2 pessoas/3 projetos** (Will Fernandes ← Mária Dávila 2 + Leticia Fernandes 1), este último montado
reabrindo 3 filas reais via `POST /api/admin/aprovacoes/reabrir` — **as filas seguem abertas na staging**.

**Do lado do Gomoon (v3 do doc do João Victor, §15.3):** corrigido o bug em que **staging queimava a chave de
PRODUÇÃO** do mesmo líder no dia (aconteceu com o Lucas em 05/08); **bypass de idempotência na staging já
ativo** (redisparar no mesmo dia reentrega — confirmado: `ja_entregues: 0` no 2º disparo); o **Luis entrou na
lista de destinatários de teste**; cartão único + `fallbackText`; `<a href>` **não** funciona (sai escapado).

**Pendências desta frente:**
- ⚠️ **Prod continua sem `GOMOON_TOKEN` e sem o cron** `0 12 * * 1-5` → `/api/cron/notificar-lideres`.
  Enquanto isso, nenhum líder real recebe nada.
- **Token separado de staging** (opção 1 do §6) — oferecido pelo João Victor, não emitido. Hoje a única
  proteção contra DM para líder real é o campo `ambiente` derivado do `GODOCS_ENV`.
- **Título fixo no singular** ("Você tem projeto para pré-aprovar") mesmo com 3 projetos — o Luis viu e não
  pediu mudança; é 1 linha se quiser concordância.
- Limpar as 3 filas que semeei na staging, se atrapalharem outro teste.

**Próximo passo:** validar com o Luis as 2 DMs sem a linha do link e, com o OK dele, abrir o PR desta branch
com `/ggsd:ship` (a feature segue travada para prod pela diretoria — o ship é do código, não do rollout).

---

## ✅ 06/08 (última sessão) — D21 DEPLOYADA e DISPARADA na staging + D22: o markup era o de superfície errada

**Plano ativo:** [`docs/plans/teamguide-lideranca-e-areas.md`](plans/teamguide-lideranca-e-areas.md) — segue
**executado**; sessão de execução direta por cima dele (nenhum plano novo). A feature inteira continua
**travada para prod** até a validação com a diretoria.

**O que motivou:** o João Victor avisou que o lado dele estava pronto, e o Luis pediu para disparar o teste
na staging — o **anúncio global** e o **aviso individual por líder** — para ver como chegam.

**Parte 1 — o disparo.** A D21 estava só na branch. Sequência: 1107 testes → `build` + `build:worker` →
`updateApp` no **staging `edf400b4`** (branch já 0 commits atrás do `main`) → dry-run das 2 rotas → disparo
real. Resultado: **202 nos dois, `falhas: []`** · aviso ao líder com 1 líder / 1 liderado / 1 projeto ·
anúncio com `itens: 0` (normal — o Gomoon expande `destinatarios:"todos"` de forma assíncrona).

**Parte 2 — o bug que o print revelou (D22).** A DM chegou com o markup **cru na tela**
(`*Você tem projeto…*`). **Não era falta de formatação nossa nem bug dele:** o contrato v2 não fixava a
**superfície de entrega**. O Google Chat tem 2 sintaxes que não se conversam — mensagem de texto usa
`*negrito*`; **cartão (`cardsV2`/`TextParagraph`) usa `<b>`** — e o Gomoon entrega em cartão (o print mostra
cabeçalho, moldura e botão "Abrir a fila").

**O que ficou pronto** (commits `33e6049` + `31cccb3`, **1109 testes**, staging redeployada 12:10):

| Peça | Mudança |
|---|---|
| `src/lib/gomoon-mensagens.ts` | markup → HTML de cartão (`<b>`/`<i>`) nas 2 mensagens |
| idem | aviso ao líder perdeu a **linha de título** e a **do link** (o cartão já mostra as duas) |
| idem | `ANUNCIO_VERSAO` `v1` → **`v2`** + histórico das versões no comentário |
| `docs/integracao-gomoon-chat.md` §13 | tabela das 2 sintaxes + regra de não duplicar título/link |
| `spec-docs/SPEC_APROVACAO_LIDER.md` §10 | **D22** com as decisões fechadas |
| Testes | +2 guardas (asterisco não volta sem decisão; texto do líder sem título/link) |

**Decisões da sessão (todas na spec, §10 = D22):**
- **A sintaxe segue a SUPERFÍCIE, não o gosto** — se a entrega deixar de ser cartão, `gomoon-mensagens.ts`
  volta ao asterisco **no mesmo deploy**, senão a DM exibe `<b>` literal. O contrato pede que ele avise.
- **`\n` fica, `<br>` não** — o cartão dele preserva a quebra (conferido no print).
- **O `url` continua no payload** mesmo saindo da prosa: é dele que o botão "Abrir a fila" sai.
- **Bump de versão do anúncio NÃO é número de build** — cada um fala com a empresa de novo. O valor está
  **pinado no teste de propósito**, para subir só por edição consciente.

**Estado do teste, e o que depende do João Victor:**
- **Anúncio:** o `v1` foi queimado ainda em teste (chave sem data → no-op eterno depois da 1ª entrega), por
  isso subimos para **`v2`** e redisparamos — **202, `ja_entregues: 0`**, ou seja a DM saiu formatada. É a
  `v2` que vai para produção; **ninguém da empresa recebeu o `v1`**.
- **Aviso ao líder:** re-disparo no mesmo dia devolveu **`ja_entregues: 1`** — sem 2ª DM, e está **correto**
  (§4 do contrato). Para ele ver o texto novo **hoje**, precisa limpar a chave
  `godocs:lucas.queiroz@gocase.com:2026-08-06` do lado dele; senão o disparo de amanhã já sai formatado.

⚠️ **Deployado só na STAGING.** Prod segue sem `GOMOON_TOKEN`, sem cron e sem a feature.

---

## ✅ 06/08 — D21: quem REDIGE as 2 DMs é o GoDocs (texto pronto no payload + anúncio com endpoint próprio)

**Plano ativo:** [`docs/plans/teamguide-lideranca-e-areas.md`](plans/teamguide-lideranca-e-areas.md) — segue
**executado**; esta sessão foi um pedido direto do Luis por cima dele (nenhum plano novo). A feature inteira
continua **travada para prod** até a validação com a diretoria.

**O que motivou:** o Luis escreveu à mão os **2 corpos de mensagem** (anúncio da feature para a empresa +
aviso de pendência ao líder, com `{{lideres[].nome}}`, `{{total}}`, bullets de `{{liderados[]}}`) e perguntou
o que o **João Victor** precisaria mudar na API do Gomoon para receber "mais um parâmetro: as mensagens".

**A resposta (e a decisão):** pedir ao Gomoon que interpole aquilo significaria, do lado dele, um
**mini-engine de template** (bloco de repetição, plural, soma do `total`, data em fuso de Brasília) e a
**cópia da mensagem morando em 2 repos**. Inverteu-se o §7 do contrato: **nós renderizamos**, o texto viaja
**pronto** em `lideres[].mensagem.texto`, e o template dele fica como **fallback** (é o que deixa os dois
lados deployarem em qualquer ordem). Mexer numa vírgula passa a ser deploy nosso.

**Contrato v2** — `docs/integracao-gomoon-chat.md` **§13** (mensagem pronta) e **§14** (anúncio). Foi isso
que o Luis mandou ao João Victor; o adendo cobre o que faltava na 1ª versão da conversa: o **contrato do
endpoint do anúncio** (senão ele inventaria um) e o alerta de que **`ambiente:"staging"` tem de ser honrado
lá também** — sem isso um teste nosso viraria DM para a empresa inteira.

**O que ficou pronto** (commit `35fa358`, **1107 testes**, `worker.js` rebuildado):

| Peça | Onde |
|---|---|
| **Redação das 2 mensagens (PURA, fonte única)** | **`src/lib/gomoon-mensagens.ts`** |
| Aviso diário ao líder | `renderMensagemLider()` → `lideres[].mensagem.texto` |
| Anúncio (1× para a empresa) | `TEXTO_ANUNCIO_PRE_APROVACAO` + `ANUNCIO_CHAVE` (sem data) |
| Envio do anúncio | `anunciarPreAprovacao()` + `POST /api/admin/anunciar-pre-aprovacao` |
| Testes | `tests/gomoon-mensagens.test.ts` + 2 novos no `tests/gomoon-lideres.test.ts` |

**Decisões da sessão (todas na spec, §9 = D21):**
- **O anúncio NÃO viaja no payload diário** — endpoint próprio e chave **sem data**
  (`godocs:anuncio:pre-aprovacao-lider:v1` → 1× por pessoa **para sempre**). Pendurado no snapshot que o cron
  repete, viraria DM de anúncio **todo dia**. Mexer no texto não reenvia nada; só um `v2` explícito.
- **`dry` é o DEFAULT do anúncio** (função e rota): enviar exige `{"dry":false}`. É a única rota do repo em
  que um POST sem body falaria com a empresa inteira.
- **A audiência é do Gomoon** (`destinatarios: "todos"`) — quem já resolve e-mail→usuário do Chat é ele; não
  montamos lista de funcionários (decisão do Luis: *"eles resolvem lá"*).
- **Renderizar DEPOIS de ordenar os liderados** — antes daria uma DM com bullets em ordem diferente da lista.

**Duas promessas do texto do Luis, corrigidas contra o código (com teste prendendo):**
1. *"abre a fila em GoDocs → Pré-aprovações"* → **não existe esse menu**; a entrada é a **faixa
   "Pré-aprovações do meu time" da home** (`src/routes/index.tsx:296`).
2. *"você recebe exatamente o que precisa corrigir"* → o autor **não é avisado** (não há DM nem e-mail para
   ele); virou **"fica visível no seu projeto em Meus Projetos"**, que é o que o app faz.

**O que falta:**
1. **João Victor implementar o lado dele** — o campo `mensagem.texto` no diário e o **endpoint
   `/api/godocs/anuncio`**, que **hoje não existe** (disparar a nossa rota agora devolve erro, não DM).
2. **Staging** (regra 13): validar as 2 mensagens — `{"dry":true}` para conferir o texto, depois
   `{"dry":false}`. A proteção continua sendo o campo `ambiente`.
3. Segue de pé: **`GOMOON_TOKEN` na prod** + **cron `0 12 * * 1-5`**, e a **validação com a diretoria**.

⚠️ **Nada deployado nesta sessão** e nada enviado a ninguém — tudo na branch.

---

## ✅ 05/08 — F3/D17: o aviso diário ao líder (GoDocs → Gomoon) implementado e validado na staging

**Plano ativo:** [`docs/plans/teamguide-lideranca-e-areas.md`](plans/teamguide-lideranca-e-areas.md) — executado;
a feature inteira segue **travada para prod** até a validação com a diretoria.

**O que motivou:** o Luis trouxe o documento de resposta do **João Victor** (`~/Downloads/Integração GoDocs →
Gomoon → Google Chat — como consumir a API.md`): a API deles **já está em produção** e implementou o nosso
contrato v1 **sem mudar o formato de entrada**. Faltava só o nosso lado (F3).

**O que ficou pronto** (commits `f6110a2` + `ec2cfe4`, **1078 testes**, staging `edf400b4` redeployada 15:51):

| Peça | Onde |
|---|---|
| Agregada líder×liderado | `getPendenciasPorLider()` — `src/integrations/db/client.server.ts` |
| Payload (PURO) + envio | `src/lib/gomoon-lideres.functions.ts` |
| Cron (09h BRT = `0 12 * * 1-5` UTC) | `POST /api/cron/notificar-lideres` |
| Manual/admin (`{"dry":true}` não envia) | `POST /api/admin/notificar-lideres` |
| Testes | `tests/gomoon-lideres.test.ts` · `tests/gomoon-pendencias-sql.test.ts` |

**Decisões da sessão:**
- **09h BRT, não 6h** — o Gomoon entrega a DM **na hora que recebe o POST**; às 6h o líder acordava com
  notificação no celular. Sugestão dele, aceita pelo Luis.
- **Staging fica na opção 2** do contrato: o campo `ambiente` (derivado do `GODOCS_ENV`) é a **única**
  proteção. O token separado que fecharia isso estruturalmente está disponível **a pedido** do João.
- A relação sai da **própria fila** (`projeto_aprovacoes`), não de uma 2ª consulta à TeamGuide — senão o
  payload poderia divergir do que a tela `/aprovacoes` mostra.

**Validado ao vivo na staging:** dry-run → payload certo · envio real → **202**, `falhas: []` · log do Gomoon
(`GET` no mesmo endpoint) → `status: entregue` + `messageName` · **`destinatarioEfetivo` = João**, ou seja o
líder REAL nomeado no payload (Lucas Queiroz) **não** recebeu · POST repetido → `ja_entregues: 1`, **sem 2ª DM**.

⚠️ **Bug pego na validação:** `APP_BASE_URL` **não é uma origem limpa** — na staging vale
`…/meus-projetos` (o disparo de e-mails usa o link inteiro) e a concatenação gerava
`/meus-projetos/aprovacoes`, rota inexistente: o líder cairia num **404 vindo da DM**. `origemDe()` descarta o
caminho; 2 testes de regressão.

**Também nesta sessão:** `origin/main` incorporado (regra 10) — o conflito em `src/routes/meus-projetos.tsx`
foi resolvido **pegando o card redesenhado do `main`** (que extraiu `AvisoPendencia` para
`src/components/aviso-pendencia.tsx`) e **reaplicando por cima** o selo do parecer do líder + o campo
`aprovacao` do tipo. `worker.js` e `dist` rebuildados **depois** do merge.

**O que falta, e é decisão/ação do Luis:**
1. **Do lado do Gomoon** (não é código nosso): pedir ao João **(a)** trocar o destinatário de teste do modo
   staging para o e-mail do Luis — no modo staging os e-mails do payload são ignorados, então **não temos
   como** fazer a DM chegar nele — e **(b)** disparar o **anúncio da feature**, que é broadcast do Gomoon e
   **não passa pela nossa API**.
2. **Secret `GOMOON_TOKEN` na PROD** (`674a3710`) — só foi setado na staging (`edf400b4`) e no `.env` local.
3. **Criar o cron** `0 12 * * 1-5` → `/api/cron/notificar-lideres`. Ambos só quando a feature for a prod.

**Dois pontos registrados e NÃO mexidos** (fora do escopo pedido): o `CLAUDE.md` está em **71k** (a régua
pede <40k) e a tela de "Meus Projetos" trata o veredito **`'ajuste'`** como *"Aguardando o líder"* — o union
do frontend só tem 3 valores e o `tsc` já acusava isso **antes** desta sessão (7 erros pré-existentes em 3
arquivos, nenhum introduzido aqui).

---

## ✅ 05/08 — D20: a isenção de pré-aprovação passa a ser pelo CARGO

**O que motivou:** o Luis olhou a aba **"Relação Líder-Liderado"** da planilha de prod e perguntou por que a
**Fablícia** não aparecia com a líder dela (Kelly), mesmo tendo projeto pendente.

**O diagnóstico** (scripts novos em `scripts/dryrun-lider/`, leitura pura contra prod + TeamGuide):
a relação estava CERTA (`líder = kelly.sousa@`), mas a Fablícia era isenta pela **D11** — a TeamGuide
pendura **um nó por pessoa** na árvore (`[TRANSPORTES] TIME FABRICIA LIMA`, filho do time da Kelly) e ela
figurava como `leader` dele. Sendo `leader` de um time ativo, saía `Pré-aprovado (liderança)` **sem ninguém
olhar**. Isso atingia **21 das 64** linhas pendentes.

**Dois candidatos testados e um descartado:**
- `liderados > 0` acertava 7 dos 8 casos, mas **descartado**: 22 pessoas com cargo de IC lideram gente de
  fato (`Team Líder Cx` tem 12 liderados) e a régua as tiraria da isenção.
- **cargo** — a decisão do Luis: *"todos respondem o líder que tiverem, mas cargos altos como coordenador,
  head, diretor, diretoria, gerente, ceo (esses cargos pra cima) não passam"*. **Supervisor NÃO isenta.**

**D20 implementada** (commit `0040fef`, **1049 testes**, `worker.js` rebuildado):
- **`src/lib/cargo-lideranca.ts`** (PURO, fonte única) — `ehCargoDeLideranca` + `CARGOS_LIDERANCA`
  (casa por **PALAVRA**: o `soci` solto fazia "Assistente de **Soci**al Media" virar sócio) +
  `EXCECOES_CARGO_LIDERANCA` (gerência de **OFÍCIO**: Diretor de Arte, Gerente/Diretor de Projetos,
  Gerente/Diretor de Produto — coordenação de projetos/produtos **não** é exceção, lidera gente).
- `ehLideranca` agora só pergunta o cargo (`getCargoDe`); `/employees/refs` entrou nos caches por isolate
  (a régua roda no caminho quente da submissão). Cargo vazio / fora da TeamGuide → **entra em fila**.
- Justificativa do Sheets diz **"cargo de liderança (coordenador ou acima)"** (senão a triagem lê
  "liderança" achando que a pessoa tem equipe).
- Cadeia validada por teste: Fablícia (Analista) → **Kelly (Supervisora, aprova)** → **João Conde (Gerente,
  isento)**; e Arnaldo (`Diretor de Arte PL II`) → **Aline (Coordenadora, isenta)**.

**Aba "Relação Líder-Liderado" (prod) REGRAVADA** com a régua nova e **2 tabelas** (pedido do Luis: *"todos
que iriam receber e quem n iria"*): **QUEM RECEBE** (líder · cargo · liderado · cargo · nº pendentes) e
**QUEM NÃO ENTRA NA FILA** com o motivo em coluna própria. Números: **65 pendentes → 52 projetos em fila,
29 líderes avisados, 10 isentos por cargo, 3 fora da TeamGuide** (antes: 21 isentos / 40 na fila).

**Rulings do Luis registrados:** JR no cargo alto (`Coordenador de RPA JR`) **é isento**; `Gerente/Diretor
de Projetos` e `de Produto` são **exceção** (entram em fila); `Coordenador de Projetos` e `Coordenadora de
produtos` **seguem isentos** (lideram 5 e 3 pessoas).

**⚠️ Nada foi deployado** — staging e prod seguem com a régua antiga (D11). O código está só na branch.

**Ainda nesta sessão — os 2 modelos de mensagem do bot + a API do Gomoon.** O Luis pediu os corpos para
passar ao João Victor, e mandou o documento da API que ele **já construiu**. Ambos foram gravados em
**`docs/integracao-gomoon-chat.md` §10 e §11**: (a) a mensagem de **abertura da feature** para a empresa e a
de **projeto pendente** para o líder (sem R$, com a data do snapshot, variações de 1 projeto / 1 liderado);
(b) os dados da API — `POST https://gomoon.gogroupbr.com/api/godocs/lideres-pendentes`, `Bearer <token>`,
400 na requisição inteira / 401 no token, **GET no mesmo endpoint devolve os últimos 50 itens** (auditoria
do "não recebi", aceita `?email=`), e ele oferece **token separado de staging** que força modo de teste no
servidor. ⚠️ **O nosso lado (F3) continua não existindo**: agregada em `projeto_aprovacoes` + cron das 6h
(`0 9 * * 1-5`, o cron do Godeploy é UTC) + o POST. E falta **pedir o token** ao João Victor.

**Próximo passo:** o Luis conferir a aba "Relação Líder-Liderado" na planilha de prod (quem recebe × quem
não recebe) e mandar os 2 modelos da §10 ao João Victor; se a aba estiver ok → **deploy da D20 na staging
(`edf400b4`, regra 13)** → validar → prod → PR. Depois disso, **F3** (agregada + cron + POST na API do
Gomoon), que já tem endpoint e contrato prontos.

---

## ✅ 05/08 — staging validada + D19: o parecer do líder virou TELA na triagem

**Duas coisas nesta sessão.**

**1. A D18 foi validada na staging.** Antes do deploy, incorporei `origin/main` (estava 4 commits à
frente: gate do ponteiro `[1.4]` + gate de ganho projetado) — conflito em `SPEC_CORRECOES.md`
resolvido **unindo os dois lados** (regra 7) e `worker.js` regerado. Deploy no `edf400b4`, e **o Luis
confirmou ao vivo: a coluna do parecer recebe o conteúdo certo.**

**2. D19 — o parecer do líder aparece DIVIDIDO na ficha de triagem do `/dashboard`.** Pedido do Luis:
_"ver as respostas do usuário líder no projeto da pessoa… fácil e bem dividido, para que não tenhamos
que entrar na planilha e ver de forma feia a pré-aprovação."_
**O que estava errado:** as 2 colunas do líder **já chegavam** na ficha, mas fora de qualquer grupo —
caíam no balde **"Outras colunas"**: o estado como campo qualquer e a justificativa multi-linha da D18
como texto corrido num grid de 2 colunas. O conteúdo estava lá, ilegível.
**O que tem agora:** seção **"Pré-aprovação do líder"** logo abaixo da caixa de decisão — chip de estado
(`Pré-aprovado`/`Ajuste pedido`/`Pré-reprovado`/`Pré-pendente`/`Sem parecer`), quem decidiu + quando,
**1 linha por pergunta com o sim/não** (espinha azul ligando as 3; o "não" com chip âmbar + faixa), texto
livre em bloco citado com o rótulo da D18, e selo **"Respondeu 'não' no checklist"** — a contradição
*pré-aprovado com "não"* é o que a triagem precisa ver primeiro. Fila aberta (`Aguardando …`) e as
**isenções da D12** também aparecem distinguíveis.

**Decisões que não devem regredir:**
- **A fonte é a LINHA DA PLANILHA, não `projeto_aprovacoes`** — o detalhe já a traz inteira: zero leitura
  nova, invariante do dashboard ("lê `readAllRows`, nunca o SQLite") intacta, e funciona para linha de
  outro ambiente / legado / fila reaberta à mão.
- **`chaveColuna` mudou de casa** para o módulo PURO **`src/lib/coluna-chave.ts`** (`google/sheets.ts`
  importa e reexporta): a tela roda no **CLIENTE** e precisa casar o cabeçalho `…do Lider` sem acento —
  quase repeti o bug da D18 do outro lado. A exclusão de "Outras colunas" usa a **mesma chave tolerante**;
  com `Set` de nome exato a célula crua reaparecia logo abaixo do painel.
- **O parser não redigita nenhuma pergunta** (fonte única `CHECKLIST_APROVACAO`) e **nada é engolido**:
  linha não reconhecida aparece como veio. **Teste de IDA-E-VOLTA** (`tests/dashboard-parecer-lider.test.ts`)
  gera com `justificativaAprovacaoSheet` e lê com o parser — mudar a escrita quebra o teste em vez de
  degradar a tela em silêncio.

**Onde:** `src/lib/coluna-chave.ts` (novo), `src/lib/aprovacoes-parecer.ts` (novo),
`src/components/dashboard/parecer-lider.tsx` (novo), `src/components/dashboard/projeto-detalhe-dialog.tsx`,
`src/lib/google/sheets.ts`, +13 testes (**1025 verdes**), `worker.js` rebuildado. Commit **`e61bace`**
(sem push). Registro: **D19** em `SPEC_APROVACAO_LIDER.md` + CLAUDE.md (seções da pré-aprovação e do
dashboard). **Deployado na staging** às 14:46 — cron pós-deploy `200 ok`, sem exceptions.

**3. Coluna "Pré-status" na TABELA do `/dashboard`** (pedido do Luis logo depois, commit `b456626`, **1028
testes**): ao lado de "Status", para saber se foi pré-aprovado **sem abrir ficha por ficha**. Chip
**COMPARTILHADO** com a ficha (`ChipEstadoParecer`, variante compacta) — rótulo/cor/ícone dos 5 estados num
lugar só, senão um dia a tabela mostraria "Aprovado" onde a ficha mostra "Pré-aprovado". Projeto sem fila fica
**"—" quieto** (chip "Sem parecer" em centenas de linhas mataria a leitura). ⚠️ **Só o rótulo curto entra na
listagem** — a justificativa multi-linha segue no detalhe (listagem enxuta, gotcha 4 do dashboard). ⚠️ O campo
`aprovacaoLider` usa **`valorDaColuna` (tolerante)**: com `row['Aprovação do Líder']` a coluna nasceria vazia
em TODO projeto, porque o cabeçalho real é `…do Lider`. Skeleton alinhado à coluna nova (mesma quebra `md`).
**Deployado na staging** às 15:09 (cron pós-deploy `200 ok`).

### ➡️ PRÓXIMO PASSO
**Abrir `/dashboard` na staging e conferir as DUAS coisas: a coluna "Pré-status" na tabela e a seção
"Pré-aprovação do líder" na ficha de um projeto com parecer** (de preferência um caso com "não" no checklist, para ver o selo e o destaque da linha).
Passando, a feature segue **travada para prod** até a validação com a diretoria — e o que resta em código
é a **F3 do Gomoon** (agregada + cron + POST), que depende do endpoint/token deles (P4).
⚠️ Ainda **não pushei nada** (nem PR): quando a fatia fechar, é `/ggsd:ship`.
⚠️ Fora de escopo por decisão: a **listagem** do `/dashboard` continua sem coluna/filtro de pré-aprovação
(só se vê abrindo a ficha) — o Luis foi avisado e é um acréscimo pequeno se ele quiser.

## 📌 05/08 — D18: o parecer do líder chega INTEIRO na planilha

**Pedido do Luis:** _"corrigir a mudança de pré-aprovação na planilha, mudando o status e a justificativa
conforme com o que vem; a justificativa tem que salvar tudo que vier do usuário, as respostas (sim, não e as
justificativas) de forma devida."_ Eram **duas** causas independentes:

1. **A justificativa era descartada.** O cabeçalho de prod E staging é `Justificativa Aprovação do **Lider**`
   (sem acento) e o código escreve `…do **Líder**`; com o match por nome EXATO a chave não casava e o valor
   ia para o lixo com aviso — o ESTADO aparecia em AE e o resto do parecer, em lugar nenhum.
   **Fix sem tocar no cabeçalho:** `chaveColuna` + `resolverColunaLetra` (exato → normalizado) no
   `updateRowByProjectId` **e** no `appendRow`/`orderValuesByHeaders`; chave AMBÍGUA só casa por nome exato.
2. **O conteúdo era pobre:** resumo de 1 linha em rótulos internos + texto livre sem rótulo. Agora a coluna
   guarda TUDO: assinatura (estado + nome + e-mail + data) · **1 linha por PERGUNTA do checklist com o
   sim/não** · texto livre **rotulado** (`O que precisa ser ajustado` · `Motivo da reprovação` ·
   `Justificativa do "não" em <perguntas>` · `Comentário do líder`).

**Onde:** `src/lib/google/sheets.ts`, `src/lib/aprovacoes-checklist.ts` (`detalharChecklist`/`rotuloChecklist`,
fonte única), `src/lib/aprovacoes.functions.ts` (`justificativaAprovacaoSheet`/`rotuloComentarioSheet`),
`scripts/dryrun-lider/hdr.ts`, +9 testes (**945 verdes**), `worker.js` rebuildado.
Commit **`3aac5f5`** na branch `worktree-plano-aprovacao-lider-teamguide` (sem push). Registro:
`SPEC_CORRECOES.md` (2026-08-05) + **D18** em `SPEC_APROVACAO_LIDER.md` + CLAUDE.md.
⚠️ **A coluna `Status` do Sheets segue intocada** (D3 — a pré-aprovação não bloqueia a triagem da RPA).
⚠️ **Nada foi deployado.** Verificação ao vivo do cabeçalho:
`npx vitest run --config scripts/dryrun-lider/vitest.config.ts`.

### ➡️ PRÓXIMO PASSO
**Deployar esta branch na STAGING (`edf400b4`, regra 13) e conferir na aba `STAGING` que a coluna AF recebe o
parecer completo** — antes, checar se a staging não está com outro build no ar
([[staging-pode-ter-branch-nao-mergeada]]: `updateApp` substitui a app inteira; mergear `origin/main` na
branch e `npm run build:worker` se preciso). Depois disso, a feature continua **travada para prod** até a
validação com a diretoria, e a F3 do Gomoon (agregada + cron + POST) segue não codada.

## 🚚 05/08 — D17: o aviso ao líder SAI do GoDocs e vai para o bot do GOMOON

**Decisão do Luis nesta sessão (D17):** o GoDocs **não fala mais com a API do Google Chat**. Quem entrega a
DM é o **bot do Gomoon**; nós mandamos **1 POST/dia às 6h BRT** com um **snapshot da RELAÇÃO**
líder↔liderados-com-pendência e **só isso** (por líder: e-mail, nome, `url` da fila, liderados + contagem de
projetos). O Gomoon enfileira, monta a mensagem, decide a hora e entrega.

**Escrito:** **`docs/integracao-gomoon-chat.md`** (novo) — contrato fechado **para mandar ao time deles**: payload,
resposta por item, idempotência, ambientes, regras de copy e o que eles precisam provisionar.

**Removido do código (feito, 936 testes verdes, `worker.js` rebuildado):** `src/lib/google/chat-dm.ts`
(deletado) · o disparo dentro do `abrirPreAprovacao` · `corpoDmAprovacao`/`mensagemDmAprovacao`/`urlDaFila` ·
os asserts de DM nos testes · as 4 envs de DM do `.env.example`. Docs atualizados: **D17 + F3 na
`SPEC_APROVACAO_LIDER.md`** (D8/D9 marcadas como superadas, F2 = "REMOVIDA, não reimplementar"), gotcha (9) do
`CLAUDE.md`, `docs/staging.md` (**a staging voltou a ser 100% muda**).

> ♻️ **REUSO ÓBVIO para a F3 — não recomeçar do zero:** o relatório desta MESMA data
> (`scripts/dryrun-lider/relatorio-sheet.ts`, bloco 📗 abaixo) já monta a relação líder → liderados →
> projetos pendentes. A F3 é a mesma agregação virando **1 consulta SQL** (`projeto_aprovacoes`,
> `veredito='pendente'`, `GROUP BY aprovador_email`) + cron + POST.

**O que falta (F3, não codado)** — agregada + cron (**`0 9 * * 1-5`: o cron do Godeploy é UTC**) + POST com
`Authorization: Bearer`; **sem R$ no payload**; idempotência `godocs:<email>:<YYYY-MM-DD>` (POST repetido
SUBSTITUI, nunca acumula); dia sem pendência manda `lideres: []`; **excluir `[E2E-…]` ao montar o payload**
(o mute saiu do `abrirPreAprovacao` — há teste afirmando que projeto E2E agora ENTRA na fila); staging com
endpoint/token próprio.

**Bloqueio externo (P4):** a F3 só liga quando o Gomoon devolver URL + token + a confirmação do admin do
Workspace de que o bot faz **DM proativa** (exige o Chat app instalado para a org inteira). **P5:** apagar
os 4 secrets de DM do `edf400b4` (inertes desde agora).

⚠️ **Tudo isto está na worktree `worktree-plano-aprovacao-lider-teamguide`, COMMITADO nesta sessão e SEM
push** (a branch segue travada para prod até a validação com a diretoria).

> ## ✅ 05/08 — a coluna AF do cabeçalho está SEM ACENTO (prod E staging) → justificativa era descartada · RESOLVIDO
>
> O Luis perguntou se a tela de aprovações grava as colunas certas. **Conferido ao vivo** no cabeçalho da aba
> `GoDocs` de PRODUÇÃO (53 colunas, script `scripts/dryrun-lider/hdr.ts`):
> **AE = `Aprovação do Líder` ✅ casa** · **AF = `Justificativa Aprovação do Lider` ❌ SEM o acento no "i"**,
> e o código escreve `'Justificativa Aprovação do Líder'`. Mapeamento é por NOME EXATO (`fetchHeaderMap`) →
> a chave não encontra par e o valor é **ignorado com aviso** (o resto da escrita segue). Efeito hoje: o
> ESTADO apareceria em AE, mas **quem decidiu, quando, o checklist e a justificativa não apareceriam em lugar
> nenhum**. É o MESMO bug já visto na staging em 04/08 — continua igual em prod.
>
> ✅ **RESOLVIDO NO CÓDIGO em 05/08 (3ª saída, melhor que as 2 oferecidas — nenhum cabeçalho foi tocado):**
> o casamento de nome de coluna passou a ser **exato primeiro, normalizado depois** (`chaveColuna` +
> `resolverColunaLetra` em `google/sheets.ts`), no `updateRowByProjectId` **e** no `appendRow`. Acento, caixa e
> espaço a mais deixam de descartar valor; chave AMBÍGUA (2 cabeçalhos que normalizam igual) só casa por nome
> exato, para nunca gravar na coluna errada. Conferido contra o cabeçalho REAL de prod: exato **não** casa,
> tolerante resolve **AF**. **Não é mais preciso renomear a AF1** — e o ⛔ bloqueio de ida a prod por este
> motivo **caiu**. Junto foi o pedido do Luis de a coluna guardar TUDO (D18): perguntas por extenso + resposta
> + texto livre rotulado. Registro: `SPEC_CORRECOES.md` (2026-08-05) e **D18** em `SPEC_APROVACAO_LIDER.md`.
>
> ## 📗 05/08 — RELATÓRIO na aba "Relação Líder-Liderado" (planilha de PROD) para a gestão avaliar
>
> Pedido do Luis: "meu chefe precisa ver de forma organizada e avaliar se está tudo certo". Gerador em
> **`scripts/dryrun-lider/relatorio-sheet.ts`** (commit `d5261e0`), aba **criada** na planilha do GoDocs.
> Rodar: `RELATORIO_WRITE=1 npx vitest run --config scripts/dryrun-lider/vitest.config.ts` — **sem a flag é
> DRY-RUN** (só imprime). ⚠️ **NUNCA escreve na aba `GoDocs`**; e ao rodar de novo **limpa os VALORES** da aba
> do relatório e regrava (não deleta a aba, para não perder comentários que a gestão deixe lá).
>
> **Escopo (o Luis confirmou 2×): SÓ projetos pendentes** (`Pendente` + `Reenvio Pendente`) e **aba de PROD**
> — tirei a seção "hierarquia completa da TeamGuide" que eu tinha posto (abriria 430 pessoas para auditoria,
> fora do escopo). 3 blocos: **1. Resumo** (com coluna explicando cada número) · **2. Fila por líder**
> (líder · e-mail · nº projetos · nº liderados · `Liderado (n)` · projeto · ID · status, agrupado como ele
> pediu) · **3. Fora da fila** com o motivo por linha (isento por liderança × e-mail fora da base ativa).
>
> **REVISÃO 05/08 (`424b075`, aba regravada):** o Luis pediu **uma tabela só** — sem resumo, sem bloco de
> "fora da fila" e **sem `Reenvio Pendente`** (só `Pendente`). Colunas: `Líder · E-mail do líder · Liderado ·
> E-mail do liderado · Projetos pendentes` (1 linha por PAR, ordenada por quem tem mais). Números com o
> filtro novo: **64 pendentes → 40 projetos · 42 DMs · 26 líderes · 32 pares** (isentos 21, sem líder 3 —
> agora **não aparecem na aba**; se a gestão sentir falta, virar 2ª aba). Os NOMES dos projetos também não
> estão na tabela (só a contagem) — acrescentar coluna/linha-por-projeto se pedirem.
>
> **Números da 1ª versão (04/08→05/08):** 78 pendentes → **44 em fila · 46 DMs · 27 líderes · 24 isentos · 10 sem líder**.
> ⚠️ Mudou de leve vs. o dry-run de 04/08 (45 fila / 23 isentos): a hierarquia é lida AO VIVO na TeamGuide e
> **um autor passou a liderar time** → virou isento. O total (68) não mudou. Não "corrigir" essa variação:
> ela é esperada e o relatório sempre reflete a TeamGuide do momento.
>
> **04/08 18:41 (`4bb5e55`, staging):** tirado o "abaixo" da ajuda da 3ª pergunta ("Compare as horas e o
> valor com a rotina real do time") — o card foi reorganizado e o "abaixo" já não apontava para nada.
>
> ## 🐛 04/08 (18:34) — caixa do parecer dessincronizada (bug do Lucas) + placeholders removidos
>
> Commit **`fed1f0e`**, staging `edf400b4` às 18:34, 936 testes. **Esperando a validação dele.**
>
> **Bug:** ele marcou os 3 como "não", abriu a caixa, mudou tudo para "sim" — e a pergunta continuou a do
> "não". Causa: a caixa era aberta com a pergunta do momento do CLIQUE e seguia aberta enquanto as respostas
> mudavam. **Fix em `marcar()`:** mudar QUALQUER resposta fecha a caixa (`setCaixa(null)`) e limpa o texto.
> ⚠️ Escolha deliberada — reabrir custa 1 clique, mas o risco pior era **gravar justificativa de uma pergunta
> que virou "sim"** (o texto ia para a coluna do Sheets junto do checklist já corrigido). Não trocar por
> "adaptar o título ao vivo" sem resolver o texto já digitado.
>
> **Placeholders REMOVIDOS** (pedido dele): o campo entra vazio nos 3 modos; `JustificativaChecklist` perdeu
> o campo `exemplo`. A pergunta no topo já diz o que responder e o exemplo arriscava ser enviado como
> resposta. ⚠️ **NÃO reintroduzir** (está anotado no módulo).
>
> ## 📊 04/08 (noite) — dry-run FINAL da fila, aba GoDocs de PROD, por líder → liderado
>
> ⚠️ O Luis achou que o dry-run tinha rodado na planilha da STAGING. **Rodou em PROD**: o worktree não tem
> `.env`, então `getSheetConfig()` cai no default (planilha + aba `GoDocs` de prod) — a prova é a quebra por
> Status (582 linhas, 490 "Aprovado"), que só existe lá. O script agora imprime a visão que ele pediu
> ("Líder (N) — N DM(s), K liderado(s): Autor (n), …" + os projetos de cada autor).
>
> **Se disparasse hoje (só `Pendente` + `Reenvio Pendente` = 78 linhas): 45 projetos · 47 DMs · 27 líderes.**
> Natália Pavão **6** (Clistony 4 · Jenifer 1 · Kauany 1) · Murilo Guimarães **4** (Kevyn 3 · Mariane 1) ·
> Vinícius Elias **4** (Nathalia Pinheiro 3 · Joaovitor 1) · Igor Morais **3** (Gean Carlos 3) · 7 líderes
> com 2 · **15 líderes com 1** · Lucas Queiroz **1** (Luis Eduardo). **47 ≠ 45** porque os 2 projetos do
> **Samuel Campos** caem em 2 líderes (Samir Labib + Stefany Costa, D4 — o 1º que decidir resolve).
> Fora: 23 isentos por liderança (D11) + 10 de e-mail fora da base ativa da TeamGuide (6 do Glauco).
> **Conclusão:** teto de 6 por líder, ninguém sobrecarregado — um disparo real é absorvível, MAS só acontece
> se alguém abrir fila para o histórico (a rota `reabrir`, `dry` por default); no fluxo normal a fila abre
> **na submissão**.
>
> ## ✅ 04/08 (noite, rodada final) — 3 DESFECHOS no parecer + pergunta/exemplo por "não" (staging 18:25)
>
> Ajustes do Lucas sobre o D16 (commit **`28a033a`**, 936 testes, staging `edf400b4`):
> **(1)** 1ª pergunta virou "move algum KPI **da área**" (tirado o "sua" — direcionava ao líder);
> **(2)** a caixa de justificativa passou a ter **pergunta E exemplo POR CHAVE** (`JUSTIFICATIVA_POR_CHAVE`
> no módulo único) — `move_kpi`: "O que este projeto entrega, se não move um indicador da área?" ·
> `sente_falta`: "Se desligar o projeto não impactaria a área, justifique a aprovação."; era o exemplo do
> SAVING aparecendo em cima de um "não" de KPI que ele reprovou. 2 "nãos" → **um campo** com bullet por
> pergunta. Exemplos são **placeholder**;
> **(3)** **saving incoerente é PRÉ-REQUISITO, não justificativa** — `bloqueiaPreAprovacao` (fonte única):
> o botão verde SOME e aparece o `AVISO_SAVING_INCOERENTE` ("redirecione ao time para ajustes ou reprove");
> o servidor recusa `aprovado` com 400 **mesmo com texto**;
> **(4)** **3 botões**: Pré-aprovar verde `#15803d` · Pedir ajuste âmbar `#b45309` · Reprovar vermelho
> `#b91c1c` (ícone próprio em cada — estado nunca só por cor). Veredito **`ajuste`** passou a ser SEPARADO de
> `reprovado` (antes os dois gravavam `reprovado`): rótulos do Sheets `Pré-aprovado` · **`Ajuste pedido`** ·
> `Pré-reprovado`; reprovar também exige motivo. ⚠️ **Sem migração** — a coluna `veredito` NÃO tem `CHECK`
> (conferido); os tipos foram alargados em `client.server.ts` + `aprovacoes.functions.ts`.
> ⚠️ Pareceres ANTIGOS gravados como `reprovado` significavam "ajuste" e agora aparecem como reprovação
> (poucos, só staging — nada a corrigir).
> ⚠️ **A DM em cartão (`0572a78`) subiu NESTE deploy** — inevitável (`updateApp` troca a app inteira): quem
> submeter na staging manda o cartão novo para o líder.
> **Próximo passo:** o Lucas validar essa rodada na staging (fluxo dos 3 botões + textos do "não"); depois
> prod + PR (regra 10: incorporar `origin/main` `7980aa4` e rebuildar `worker.js`/`dist`).
>
> ## ⏳ 04/08 (fim) — 2 DECISÕES ESPERANDO O LUCAS (nada codar antes)
>
> **1) A pergunta do "Não" foi REPROVADA pelo Lucas.** Motivo: o título é genérico e **o exemplo do campo é
> sempre o do saving**, mesmo quando o "Não" foi em "move KPI" — "o exemplo tem que condizer com o não que a
> pessoa marcou, e ser dinâmico, porque cada não representa algo diferente". Mandei 3 opções para ele aprovar
> (recomendei a 1): **(1) pergunta E exemplo próprios por chave** — `move_kpi`: "O que este projeto entrega,
> se não move um indicador seu?" · `sente_falta`: "Se desligassem hoje e ninguém reclamasse, por que ainda
> vale manter?" · `saving_coerente`: "O que está fora no saving: o número, as horas ou a frequência?";
> **(2)** pergunta única + só o exemplo dinâmico (mais simples, mas convida "não sei"); **(3)** dois campos
> (o que está fora / o que a RPA deve fazer — parecer melhor, digitação dobrada, contra o "rápido pro líder"
> do D13). Com 2+ "nãos": **um único campo** com um bullet por "não" (não duas caixas). Exemplos ficam como
> **placeholder** (nunca preenchidos, para ninguém enviar o exemplo por acidente). Ao implementar, os textos
> entram no MESMO módulo único `src/lib/aprovacoes-checklist.ts` (tela + Sheets leem de lá) e o D16 da spec
> precisa ser atualizado.
>
> **2) A DM em cartão está commitada (`0572a78`) e NÃO deployada** — subir na staging manda mensagem real
> para o Lucas no meio da validação dele. Esperando o "pode subir".
>
> ## 🔧 04/08 (fim da noite) — DM refeita como CARTÃO + ⚠️ CORREÇÃO do dry-run (não era só pendente)
>
> **1) DM virou cartão (`cardsV2`) — pedido do Luis, commit a seguir, NÃO deployada ainda.**
> Antes: 1 parágrafo corrido + link cru na última linha, sem título, sem botão, nada do projeto além do
> nome. Agora: cabeçalho **"Pré-aprovação pendente"** + subtítulo com o nome do projeto, 3 linhas
> `decoratedText` (**Quem submeteu** · **Área** · **Sua fila — N projetos esperando você**) e **botão
> "Abrir a fila"** (azul GoGroup). Onde mexi: `corpoDmAprovacao()` (nova, pura) e `mensagemDmAprovacao()`
> (encurtada — virou o **fallback** do `text`, que é o que aparece na notificação do celular e na prévia da
> conversa, POR ISSO mantém a URL: o botão não existe fora do cartão) em `aprovacoes.functions.ts`;
> `enviarDmChat(email, corpo)` passou a aceitar **string OU corpo cru** (`{text, cardsV2}`) — quem monta o
> cartão é o chamador, o módulo `chat-dm.ts` só cuida de credencial + espaço de DM.
> Regras que NÃO podem regredir: **(a) nada de R$ na DM** (Chat se lê por cima do ombro; saving em R$ é
> staff-only, mesma régua do `ocultarReaisSaving`); **(b) linhas condicionais** — área/fila só entram quando
> existem (cartão com "—" parece erro de sistema; "Sua fila" só a partir de 2); **(c)** a contagem
> (**`contarAprovacoesPendentesDe`**, novo `COUNT` em `client.server.ts`) é resolvida **ANTES** do
> `runBackground` — um `await` antes do `enviarDmChat` dentro do fire-and-forget deixa a promise pendurada e
> **matou 1 teste** ("avisa por DM" via `toHaveBeenCalledTimes`) até eu inverter a ordem. 934 testes verdes,
> `worker.js` rebuildado. ⛔ **NÃO deployei na staging de propósito:** a DM está LIGADA lá e sairia mensagem
> real para o Lucas no meio da validação dele — perguntei se pode subir agora e ficou **sem resposta**.
>
> **2) ⚠️ O dry-run das 15h estava ERRADO — o Luis pegou.** O filtro aceitava qualquer `Status` não-vazio
> menos descontinuado/reprovado, e **490 das 568 linhas eram "Aprovado"**. Números CERTOS, só `Pendente`
> (64) + `Reenvio Pendente` (14) = **78 linhas**: **45 projetos em fila** · **47 DMs** (2 com 2 líderes, D4) ·
> **27 líderes** · **23 isentos por liderança** (~30%) · **10 sem líder**. Carga máxima **Natália Pavão 6**,
> Murilo 4, Vinícius Elias 4, Igor Morais 3, o resto 2 ou 1 — **ninguém com 10+** (o "10 líderes com 10+" do
> resumo anterior era artefato do filtro largo). Bate com o dry-run da manhã sobre a STAGING (76 → 43).
> Os 10 sem líder seguem sendo **cadastro** (Glauco Bezerra concentra 6), não hierarquia. O script
> (`scripts/dryrun-lider/`) já imprime a **quebra por Status dentro/fora do filtro** — foi o que expôs o erro;
> manter esse print em qualquer dry-run futuro.
>
> ## ✅ 04/08 (noite) — "Não" no checklist passou a exigir explicação (D16) + dry-run sobre a aba GoDocs de PROD
>
> **Pedido do Luis:** "hoje se a pessoa botar um não a gente não pede justificativa; quando clicar em
> pré-aprovar e tiver algum não, deve vir uma box pra explicar, e a explicação vai pro campo de
> justificativa". Implementado como **D16** (`spec-docs/SPEC_APROVACAO_LIDER.md`) — commits **`da32167`** +
> **`2c40eef`**, staging `edf400b4` deployada às 17:21, **934 testes verdes**, prod NÃO tocada.
>
> **Como ficou:** clicar em **Pré-aprovar** com qualquer resposta "não" **não grava** — abre a caixa
> *"Por que você pré-aprova mesmo com 'Não' em «X»?"* (campo focado, botão "Pré-aprovar com esta
> explicação"). O texto entra no **MESMO campo `comentario`** → coluna **`Justificativa Aprovação do Líder`**,
> concatenado ao resumo do checklist. Nenhuma coluna nova. Régua na FONTE ÚNICA
> **`exigeJustificativa`/`temNaoNoChecklist`** (`src/lib/aprovacoes-checklist.ts`), consumida pela tela **e
> cobrada no servidor** (`decidirAprovacao` → **400**) — o frontend nunca é a garantia. Checklist todo "Sim"
> segue pré-aprovando em 1 clique; "Pedir ajuste" segue exigindo texto sempre; o "não" **continua sem ser
> veto** (D13 intacto), só não passa calado. A caixa é a MESMA do ajuste (`caixa: 'ajuste' | 'justificar'`),
> com cor/copy/destino próprios. ⚠️ **2ª rodada do Luis:** o parágrafo âmbar que avisava do "não" ANTES do
> clique foi **removido** ("só tá poluindo a tela") — quem informa é a caixa, no clique. 1 teste antigo
> precisou de comentário (aprovava com "não" sem texto).
>
> ## 📋 Dry-run líder↔liderado sobre a aba **GoDocs de PRODUÇÃO** (04/08 noite — o Luis JÁ LEU o resultado)
>
> Leitura pura (`readAllRows` + `construirIndiceLideranca`/`ehLideranca` ao vivo), zero escrita, zero DM.
> Script committado em **`scripts/dryrun-lider/`** (fora do `npm run test`;
> `npx vitest run --config scripts/dryrun-lider/vitest.config.ts`; carrega o `.env` do repo PRINCIPAL porque
> o worktree não tem `.env` — sem `GOOGLE_SHEETS_ID/TAB` o default É prod). ⏳ **DECISÃO PENDENTE:** virar
> rota admin de dry-run, ficar como script, ou apagar (perguntei, sem resposta).
>
> **Números (582 linhas → 568 pendentes):** **319 projetos entrariam em fila** · **321 DMs** (2 projetos com
> autor em 2 times → 2 líderes, D4) · **55 líderes** · **214 isentos por liderança** (D11, 57 autores) ·
> **35 sem líder** (D6) · 0 sem e-mail. Carga: **10 líderes com 10+ projetos**, 24 com 4–9, 15 com 2–3, 6
> com 1. Topo: Murilo Guimarães **19** (13 do mesmo liderado, Kevyn) · Leyde Rodrigues 14 · Giovanna Sabrina
> 13 · Rackel Viana 13 · Kelly Sousa 12 · Eduarda Lourencini 12 · Gilvania Pinheiro 12 · Igor Morais 11 ·
> Will Fernandes 11 · Natália Pavão 10. O Lucas ficaria com 9.
> ⚠️ **Isso é o BACKLOG inteiro, não o fluxo do dia** — `abrirPreAprovacao` só roda **na submissão**, então
> ligar em prod **não** dispara nada retroativo; os legados só entram quando alguém reenviar. Uma fila de 319
> só existe se alguém abrir fila para o histórico (a rota `reabrir` faz isso, e é `dry` por default).
> ⚠️ **Os 35 "sem líder" NÃO são o CEO:** **0** deles é pessoa ATIVA na TeamGuide — são e-mails fora da base
> ativa (ex-funcionário / e-mail diferente do cadastro). Concentração: Glauco Bezerra 6 · Paulo Seabra 5 ·
> Michael Dias 4 · Eduarda Alves 4 · Ana Estolano 3. Causa é **cadastro**, não hierarquia — corrigir na
> TeamGuide resolve em bloco (mesmo achado do dry-run da manhã, agora quantificado em prod).
>
> ## 🚨 04/08 (fim da tarde) — a fila do líder foi APAGADA por cópia de prod na aba STAGING, e recuperada
>
> **Sintoma:** o Luis copiou prod → aba `STAGING` (para eu rodar o dry-run líder↔liderado), depois restaurou
> a versão de testes — e a tela do líder continuou vazia. **Não era bug da tela.** A fila mora em
> `projeto_aprovacoes`, tabela INTERNA (o Sheets é só espelho do veredito), e `projeto_id` é
> `REFERENCES projetos(id) **ON DELETE CASCADE**`: os IDs de teste sumiram da aba → `reconciliarExclusoes`
> removeu os projetos (passada a carência de 1h) → **a fila foi em cascata**. Restaurar a aba recria o
> PROJETO (como legado, via sync reverso), **nunca a fila** — quem abre fila é o `abrirPreAprovacao`, chamado
> só no fim do `submeterParaValidacao`. Diagnóstico confirmado ANTES de mexer:
> `GET /api/aprovacoes/pendentes?como=lucas.queiroz@gocase.com` → `{"lidera":true,"itens":[]}`.
>
> **Recuperação (commit `eff631e`, staging `edf400b4` deployada às 13:45):** nova rota
> **`POST /api/admin/aprovacoes/reabrir`** (`requireAdmin`) + `reabrirPreAprovacoes` em
> `aprovacoes.functions.ts`. Aceita `projetoIds` **OU** `autorEmail` (**fail-closed** — não existe "reabre
> tudo"), é **`dry` por DEFAULT** (escrever exige `dry:false`) e **NUNCA sobrescreve parecer já dado**:
> projeto que já tem linha (pendente OU decidida) é ignorado salvo `forcar:true` — porque
> `abrirAprovacoesPendentes` **deleta** as linhas do projeto antes de inserir, e um reabrir cego apagaria o
> veredito do líder. Espelha `Aprovação do Líder`/`Justificativa…` no Sheets como o submit faz.
> **Aplicado:** 4 projetos do Luis voltaram à fila do Lucas (`itens: 4`, conferido pela API). ⚠️ **Saíram 4
> DMs reais** para o Lucas (DM ligada na staging e nenhum projeto tem a tag `[E2E-`, que é o que muta).
> ⚠️ Rota ainda **não** está em prod nem em PR.
>
> 🔒 **Regra nova (aprendizado):** cópia de prod por cima da aba STAGING **sempre** mata a fila, mesmo
> restaurando depois. Se precisar de dados de prod lá, **apendar** preservando as linhas de teste — e, se
> acontecer de novo, recuperar pela rota acima em vez de refazer submissões.
>
> ## 📋 Dry-run líder↔liderado (04/08, LEITURA PURA — o Luis AINDA NÃO LEU)
>
> Rodado sobre a aba STAGING (580 linhas, já com a cópia de prod) + TeamGuide ao vivo (430 pessoas, 107
> lideranças), aplicando a régua real (`construirIndiceLideranca` + `ehLideranca`). Script:
> `scratchpad/dryrun-lider.mjs` (SA do `.env` + `/teams` + membros paginados; **some com o scratchpad**).
> **76 pendentes** (`Pendente` 63 + `Reenvio Pendente` 13) = **43 com líder** (26 líderes) + **23 isentos por
> liderança (30% da fila!)** + **10 fora da TeamGuide**. Filas grandes: Natalia Pavão 6 · Murilo Guimarães 4 ·
> Igor Morais 3 · Vinicius Elias 3. Único caso de **2 líderes** (D4): os 2 do Samuel Campos (Samir Labib +
> Stefany Costa). Coluna `Aprovação do Líder` **vazia em 580/580**. Nenhum líder recebendo projeto de área
> estranha — as atribuições fazem sentido.
> ⛔ **BLOQUEIO ACHADO (precisa de ação humana):** o cabeçalho tem **`Justificativa Aprovação do Lider`**
> — *sem acento* — e o código escreve `'Justificativa Aprovação do Líder'`. Mapeamento é por nome exato →
> chave não casa → **a justificativa é descartada com aviso** (o rótulo de estado casa certo). Corrigir o
> acento na **STAGING e conferir na aba `GoDocs` de prod** antes de subir a feature.
> ⚠️ **10 sem DM:** 6 reenvios do **Glauco Bezerra** (`glaucolb@gobeaute.com.br`, e-mail fora do padrão) +
> Michael Dias ×2 e Gesiel Silva (já `ÁREA NÃO IDENTIFICADA`) + Jhenyfer Silva. Corrigir o cadastro na
> TeamGuide resolve os 10 de uma vez.
>
> 🔁 **A staging foi atropelada 3× no MESMO dia (04/08: ~09:40, 14:10 e o redeploy meu no meio).** A causa é
> estrutural, não descuido: `updateApp` **substitui a app inteira** e a branch da pré-aprovação **não está no
> `main`** — então QUALQUER deploy de outra frente apaga a tela `/aprovacoes`, e quem descobre é o Lucas, no
> 404. O 2º atropelamento (14:10, "main mergeado — investigador N+1 + reconciliação + gate de sobreposição")
> deu **404 de verdade**, não o redirect silencioso pra home do 1º — o `assetConfig` do build alheio difere.
> **Restaurado às 14:32** mergeando os 3 commits novos do `main` (`aacaa20`/`0dddda5`/`f417d5b`; só o
> `worker.js` conflita → `npm run build:worker`), **931 testes**, rota e fila (3 itens) conferidas no ar.
> ⏳ **DECISÃO PENDENTE DO LUIS** — 3 opções oferecidas: (1) combinar com o Kaique que ele mergeie a branch
> antes de deployar staging; (2) **app de staging separado só p/ esta validação** (recomendado se o Lucas for
> olhar hoje — é o único que garante que ele não bata em 404 no meio da avaliação; custo: dobrar os secrets);
> (3) aceitar e redeployar quando cair (~10 min cada). **Dados nunca correm risco** — o SQLite persiste entre
> deploys; só o código é trocado.
> ⚠️ Ele perguntou se eu "subi os testes E2E pra staging": **não** — os E2E são scripts locais; o que foi
> criado lá são 2 **projetos** (dados) via a API real. Nenhum código de teste foi deployado.

> ⏳ **AGUARDANDO SEU OLHAR (04/08 15:39):** a home passou a aceitar **`?como=<e-mail>`** (pré-visualização de
> ADMIN, o servidor ignora o param para os demais) — antes a faixa decidia só pelo e-mail de quem está logado
> e o Luis, que não lidera time, **nunca** conseguia ver a "view do chefe". Link dado a ele:
> `https://godocs-staging.devgogroup.com/?como=lucas.queiroz@gocase.com`; o `?como=` **viaja no clique** da
> faixa (prop `search` do `Link`), senão abriria a fila vazia do admin. Commit `HEAD` (código +
> staging deployada), **931 testes**; falta o veredito visual dele e, se aprovar, **1 linha na spec** (é
> extensão do D13, que já registrava o `?como=` da tela). ⚠️ **No modo preview os botões gravam de verdade** —
> decidir ali põe o e-mail do ADMIN em `decidido_por`, não o do líder.

**Última sessão:** 2026-08-04 (tarde) — **a fila do líder virou um SLIDER de 1 projeto por vez** (pedido do
Luis). Mudança de UI pequena e fechada, **só na tela `/aprovacoes`**; nada de servidor mudou (sem
`build:worker`). Commits `0eeaf89` (código) + `6110630` (spec/CLAUDE.md), **931 testes verdes**, staging
`edf400b4` redeployada às 11:46 e o bundle conferido no ar (`getAppFile` → `BarraFila`/`decididos` presentes).

1. **O problema:** com 12 projetos empilhados o líder rolava a tela procurando onde parou e não sabia quanto
   faltava — o oposto do "mais fácil, rápido e intuitivo possível" que motivou o D13.
2. **O que existe agora:** barra no topo com **`3 de 12`** + **um traço por projeto** (colorido pelo parecer
   já dado, clicável para saltar), **um** card na tela e, ao decidir, **salto automático para o próximo sem
   parecer** + scroll ao topo.
3. ⚠️ **A decisão que mais importa não regredir — o total NÃO encolhe ao decidir.** O `useEffect` que
   sincroniza com o servidor é **append-only** (só acrescenta projeto novo) e o item decidido **fica** no
   slider em modo leitura (faixa "Você pré-aprovou…" + checklist desabilitado). Se a lista encolhesse,
   `3 de 12` viraria `3 de 11` no meio do caminho e o líder perderia a referência de progresso — além de não
   poder voltar para rever o próprio parecer. O cache do React Query **perde** o item (a fila do servidor não
   o traz mais); quem preserva é o estado local (`fila` + `decididos` + `indice`).
4. **Navegação em 3 vias:** botões no topo, botões no pé do card ("Projeto anterior" / "Decidir depois") e
   as setas `←`/`→` do teclado — **ignoradas dentro de `INPUT`/`TEXTAREA`**, senão brigariam com o cursor da
   caixa de ajuste. Fila **> 20** projetos → os traços viram barra de progresso (40 traços de 3px não se
   clicam nem se leem).
5. **A11y/identidade:** animação reusa `go-step-in`/`go-step-in-back` das etapas do formulário (mesmo gesto
   de "avançar" do produto) e o estado **nunca fica só na cor do traço** — a contagem "2 pré-aprovados ·
   1 ajuste pedido" está escrita e cada traço tem `aria-label`/`title` com nome do projeto + situação.
6. ⚠️ **Numeração das decisões da spec estava com um buraco:** o **D14** (duas colunas no Sheets, estado ×
   justificativa) vivia só no código (`dc53193`) e na memória, **nunca na spec** — foi escrito agora, e o
   slider ficou como **D15**. Conferir a tabela da spec antes de inventar o próximo número.
7. **Pergunta do Luis respondida (sem código):** a entrada da tela **não** depende da DM — é a faixa na
   **home** (`src/routes/index.tsx:289`), visível só para quem `lidera` na TeamGuide, e ela aparece **mesmo
   com a fila vazia**. Não existe item de menu: de outra tela, o líder tem que voltar em "← Início".
   **Oferta em aberto:** atalho fixo no cabeçalho com o número de pendentes (mudança pequena).
8. **Onde aterrissou:** `src/routes/aprovacoes.tsx` (novo componente `BarraFila`; `CardAprovacao` ganhou
   `decidido`/`proximoPendente`/`podeVoltar`/`podeAvancar` e uma Zona 3 de navegação) ·
   `spec-docs/SPEC_APROVACAO_LIDER.md` (D14 + D15 + nota no F1) · `CLAUDE.md` (seção da pré-aprovação).
9. ⚠️ **O `CLAUDE.md` está em 62 kB** — muito acima do teto de 40 k em que o Claude Code avisa (ver
   memória `claude-md-limite-40k`). Não mexi além do parágrafo da feature; **vale uma faxina em sessão
   própria**, movendo detalhe para `docs/`/`spec-docs/`.
10. **O que NÃO mudou:** nenhum arquivo de servidor, nenhuma rota de API, nenhum teste novo (a mudança é de
    apresentação — o `decidirAprovacao` e o checklist obrigatório seguem intactos). Prod continua **sem** a
    feature e a branch segue **sem push e sem PR** (trava da diretoria).

---

## Sessão de 2026-08-04 (manhã) — staging atropelada de novo, restaurada, e fila do líder populada
com 2 projetos mockados.** Zero mudança de comportamento no produto: a sessão foi diagnóstico + integração +
seed de dados.

1. **O sintoma:** nem o Luis nem o Lucas abriam `/aprovacoes` na staging. **Causa:** um deploy de outra
   frente (Kaique) sobrescreveu o `edf400b4` com um build **sem a rota** — `updateApp` troca a app inteira.
   ⚠️ **O sintoma engana:** `/aprovacoes` responde **200** (é o fallback SPA servindo o `index.html`) e o
   TanStack, sem a rota no bundle, devolve o usuário pra `/`. Nada de 404 na cara.
2. **Diagnóstico sem navegador (vale guardar):** `getAppFile(edf400b4, asset, /index.html)` → pega o
   `index-<hash>.js` → `grep aprovacoes` nele. Zero ocorrências = build errado no ar. Comparar com o
   `dist/` local fecha o caso em 2 comandos.
3. **Integração:** mergeado `origin/main` (11 commits do Kaique, PRs **#224–#227** — gate do critério +
   seção `[1.4]`) na branch. **Só o `worker.js` conflitou** (artefato de build) → resolvido com
   `npm run build:worker`. **891 testes verdes** (861 meus + 30 dele).
4. **Staging redeployada** (`edf400b4` apenas; prod `674a3710` **não** foi tocada) e a rota confirmada no ar.
5. ⚠️ **Armadilha de smoke test que custou um redeploy inteiro:** `curl` **sem `Accept: text/html`** dá
   **404** em toda rota profunda — o fallback SPA só atende requisição de navegação. Isso **não** é
   regressão nem `assetConfig` faltando. Sempre mandar o header ao testar rota de SPA por curl.
6. **Fila do Lucas populada com 2 mockados** (pedido do Luis: ver a tela com mais de um pendente), criados
   pelo **fluxo real** do formulário — chat com o agente, memorial gerado, gates de jornada/critério
   passando —, não por INSERT no banco. Script em scratchpad (não versionado), reusando
   `scripts/e2e/lib/{api,responder}.mjs`.
   - ⚠️ **Nome SEM o prefixo `[E2E-`** de propósito: `ehProjetoTesteE2E` silencia a DM, e o Luis quis a
     **DM real** pro Lucas. Efeito colateral: **o `e2e-cleanup` não pega esses 2** — a limpeza é manual, e
     **planilha ANTES do SQLite** (senão o sync reverso ressuscita).
   - ⚠️ **O harness aponta pra PROD por default** (`E2E_BASE_URL` ausente → `godocs.devgogroup.com`) e a
     **worktree não tem `.env`** — foi assim que 3 projetos de teste caíram em prod em 30/07. O script novo
     **aborta** se o BASE_URL não for o da staging.
   - Fila atual (3 itens, todos do Luis): **Alerta de ruptura de estoque** (15h, R$ 1.519,35, custo evitado
     R$ 1.200 — o card com mais números) · **Baixa automática de NF-e** (34h, R$ 857, 2 cargos no memorial) ·
     **n8n audit** (40h, R$ 431,20 — o que já existia).
7. **Aberto para o Luis confirmar:** se as 2 DMs chegaram ao Lucas e **se o link delas abre a staging**
   (`mensagemDmAprovacao` usa `APP_BASE_URL`, que está setado no `edf400b4`, mas o valor do secret não é
   legível — se apontar pra prod, o Lucas cai numa app sem a tela).
8. ⚠️ **Se o Lucas decidir via `?como=`, o `decidido_por` grava o ADMIN**, não ele — para a validação valer
   como o gestor, ele entra com a própria conta em `/aprovacoes`.

**Última sessão anterior:** 2026-08-03 (noite) — **atendeu as ressalvas do Lucas na tela de pré-aprovação (D13).**
O Lucas abriu `/aprovacoes` na staging e apontou 4 coisas: "a visualização não tá legal", "não é uma
aprovação e sim uma **pré**-aprovação", "o gestor tem que responder algumas perguntas com sim e não" e "o
card já tem que vir com as principais informações — dono, participantes, valor total de saving, memorial".
Tudo implementado no commit **`1d3aeb2`** (856 testes verdes, +6 novos; `worker.js` rebuildado; **staging
`edf400b4` redeployada às 16:26**):

1. **Nomenclatura pré-aprovação** em toda a UI, na home, no card do autor e na planilha
   (`Pré-aprovado` / `Ajuste pedido` / `Pré-aprovação pendente com…` — nunca mais `Aprovado`/`Reprovado`).
2. **Card auto-suficiente:** dono (+ área), participantes **com papel**, **saving em destaque (R$ + horas,
   unidade por cadência)**, descrição e **memorial expansível** dentro do card. Ler a doc completa virou opção.
3. **Checklist do gestor — 3 perguntas sim/não** (*move KPI da área? · a área sentiria falta se fosse
   desligado? · o saving é coerente com o impacto?*), **obrigatórias no servidor** (`decidirSchema`) nos DOIS
   vereditos e anexadas ao rótulo do Sheets. Um "não" **não** reprova sozinho (a tela diz isso). Textos em
   **`src/lib/aprovacoes-checklist.ts`** — módulo PURO, FONTE ÚNICA (tela + Sheets), não redigitar.
4. **`/aprovacoes?como=<e-mail>` — pré-visualização só de ADMIN** da fila de outra pessoa: foi assim que o
   Luis viu a tela "como o Lucas". Decidindo nesse modo, o **`decidido_por` grava o admin**, nunca o líder.

**Rodada 2 da mesma sessão (16:35, staging redeployada, 859 testes)** — 4 ajustes pedidos pelo Luis depois
de ver a tela: (a) o card mostra **todos os números do ganho** (ganho total em destaque + recorrência ao lado;
horas economizadas, saving em R$, custo evitado, receita mensal e custo externo com "−", cada linha só quando
existe) nas MESMAS fontes do sync do Sheets — custo evitado e receita saem do JSON da `documentacao`
(`extrairNumeros`, pura, 3 testes), pois não há coluna em `projetos`; (b) **"Ler a documentação completa" abre
em nova aba** (`<a target="_blank">`, não `<Link>`) p/ não perder o checklist marcado; (c) **sem participantes
a coluna nem aparece**; (d) saiu da DM a frase "a triagem da equipe RPA segue em paralelo…".

⚠️ **Exceção consciente que precisa de confirmação:** o líder vê o **saving em R$** — sem o número não há
como responder a 3ª pergunta. Isso contraria "cliente não vê R$ de saving"; reverter para só-horas é 1 linha.
⚠️ **`CLAUDE.md` está em 52 kB** (limite prático 40 kB) — pré-existente, merece PR de enxugamento próprio.
⚠️ **A DM da staging é REAL** — submeter lá para testar notifica o Lucas de verdade.

_Sessão anterior:_ 2026-08-03 (manhã) — **planejamento da pré-aprovação do líder (integração TeamGuide) + entrega
conjunta das 2 frentes fechadas na STAGING**. Investigação ao vivo da API TeamGuide (os endpoints de
liderança dão **403**; a relação líder↔liderado sai de `/teams` + membros), spec nova
`spec-docs/SPEC_APROVACAO_LIDER.md` (D1–D10), plano **F0 aprovado** (não codado) e staging `edf400b4`
deployada com `fix/motivo-reenvio-traco` + os docs desta frente. **PR ainda não aberto** — espera a
validação humana.

> ✅ **DESBLOQUEADO (16:53:37) — staging no ar com o build INTEGRADO.** `origin/main` mergeado na branch
> (já continha `fix/remove-pergunta-o-que-piora`, a frente que havia atropelado a staging às 16:40 — ninguém
> perdeu nada); conflito só no `worker.js` (gerado), resolvido por rebuild. **861 testes verdes**, commits
> `bc3b77a` (+ merge). ⚠️ **LIÇÃO DE DIAGNÓSTICO:** `curl` sem `Accept: text/html` devolve **404 em TODAS** as
> rotas SPA (`/meus-projetos` inclusive) — o fallback do Godeploy só vale para requisições de NAVEGAÇÃO. Meu
> teste inicial era inválido; com `-H "Accept: text/html" -H "Sec-Fetch-Mode: navigate"` a rota responde 200.
> O 404 que o Luis viu no navegador era real e vinha do atropelo, não da tela. ⚠️ Antes de deployar staging,
> rode `getApp(edf400b4)` e compare `updatedAt`/descrição.
>
> 🆕 **Rodada 3 (17:01, staging `edf400b4`, commit `58aab6c`, 861 testes)** — ajustes do Luis vendo a tela:
> as **2 boxes de explicação saíram** (o essencial virou 1 linha no header; o aviso de pré-visualização de
> admin virou destaque lime na mesma linha), **header baixo** (108px, onda 26px) para o card caber sem rolar,
> **resumo da ANÁLISE AUTOMÁTICA** (`analises.resumo`, subquery pela mais recente) abaixo do ganho total e
> **um card por número** (horas · recorrência · saving R$ · custo evitado · receita · custo externo com "−"),
> com **"Não declarado"** quando o campo está vazio (antes a linha desaparecia).
>
> ❓ **Perguntas do Luis respondidas (podem virar pedido):** pré-aprovar/pedir ajuste gravam o veredito em
> todas as linhas do projeto + a coluna `Aprovação do Líder` (com o checklist no texto), tiram o item da fila
> e mostram o selo no card do autor; **`Status` não é tocado** e a triagem da RPA segue. Um **"não" no
> checklist NÃO bloqueia** a pré-aprovação (viaja no texto para a triagem). **O pedido de ajuste NÃO notifica
> o autor** — ele descobre ao abrir o GoDocs. ⚠️ **Adição pequena em aberto: DM ao AUTOR quando o líder pede
> ajuste** (o Luis perguntou; eu ofereci e ele não respondeu ainda).
>
> 🆕 **Rodada 4 (17:06, commit `a786f6c`)** — header ficou só com "← Início" + título e um **`i` (InfoTooltip)**
> ao lado de "Pré-aprovações do meu time" explicando a página em 3 frases **sem travessões** (pedido explícito
> do Luis); a linha de subtítulo saiu inteira, levando com ela o aviso de pré-visualização de admin; o rótulo
> virou só **"Resumo do projeto"** (sem "(análise automática)").
>
> 🆕 **Rodada 5 (17:11, commit `dc53193`) — DUAS COLUNAS no Sheets (combinado com o Luis):**
> **`Aprovação do Líder`** passa a guardar **SÓ o estado** (`Pré-aprovado` · `Pré-pendente` ·
> `Pré-reprovado`), e o detalhe (quem, quando, as 3 respostas do checklist, comentário) vai na coluna
> **NOVA `Justificativa Aprovação do Líder`**. Funções puras novas: `justificativaAprovacaoSheet` e
> `justificativaIsencaoSheet` (a D12 sobrevive: liderança = `Pré-aprovado` + motivo na justificativa;
> sem líder / TeamGuide fora = `—` no estado + motivo próprio). Tela: **7 cards no mesmo nível** (ganho
> total com barra lime, horas, recorrência, saving, custo evitado, receita, custo externo) e o **resumo
> do projeto abaixo deles, em largura cheia**.
> ⚠️ **PENDÊNCIA HUMANA NOVA (Luis):** criar a coluna **`Justificativa Aprovação do Líder`** no cabeçalho
> das abas **`GoDocs` e `STAGING`** — sem ela o valor é ignorado com aviso (o resto do sync segue).
>
> 🆕 **Rodada 6 (17:18 e 17:24, commits `76ffe84` / `6e93636` / `bb96b06`) — 3 correções vistas pelo Luis
> na tela + a régua do resumo.** (a) O **"i" do tooltip sumia**: era `var(--go-blue)` a 55% **sobre o header
> azul**; ganhou `tone="claro"` (branco + disco translúcido, alvo de 20px) no `InfoTooltip` — prop aditiva,
> as outras telas não mudam. (b) Os **7 cards de número** eram brancos sobre o card branco com borda de 10%;
> foram para o azul-acinzentado das outras boxes (fundo 5%, borda 12%). (c) **"Resumo do projeto" passou a
> vir do MEMORIAL** (`[1.2]`, nova pura `extrairResumoMemorial`), com o resumo da análise como fallback, e
> renderiza por `SimpleMarkdown` (os `**` crus sumiram da tela).
> ⚠️ **A primeira tentativa do (c) não funcionou e o motivo importa:** o memorial do "n8n audit" grava os
> rótulos em **TEXTO PURO** (`Resumo: …`), sem `**` nem `###` — o `tituloDaLinha` não os enxerga, a extração
> voltava `null` e a tela caía no fallback. O fix é o `extrairRotuloTextoPuro`, deliberadamente **FORA** do
> `extrairSecaoMemorial`: aquele alimenta os **gates determinísticos** do critério de projeto e da
> carga×escala, e afrouxar o casamento de título lá mudaria o que esses gates enxergam. **Não mover para lá.**
> 867 testes verdes (+6). ⚠️ **Prettier reformata `aprovacoes.functions.ts` inteiro** (o arquivo usa aspas
> simples, o config usa duplas) — não rodar nele, o diff vira ruído.
>
> 🛑 **DECISÃO DO LUIS (03/08, fim da rodada 6): NADA vai para prod nem para o repo por ora** — a ida a
> produção será validada **com a diretoria** antes. Tudo está commitado na branch
> `worktree-plano-aprovacao-lider-teamguide` (24 commits à frente do `origin/main`), **sem push e sem PR**.
> A staging segue no ar com o build atual para a demonstração.
>
> **▶ PRÓXIMO PASSO — o Luis olhar a tela na staging (redeploy 16:35) em
> `https://godocs-staging.devgogroup.com/aprovacoes?como=lucas.queiroz@gocase.com` (pré-visualização de
> admin da fila do Lucas — a fila real tem o projeto "n8n audit" do Luis, 40 h/mês · R$ 431,20) e, com o ok
> dele, deployar **prod `674a3710`** e abrir o PR.** Se ele quiser o saving só em horas, é 1 linha antes de
> subir. O código de **F0 + F1 + F2 + D11/D12/D13 está pronto e commitado** na branch
> `worktree-plano-aprovacao-lider-teamguide`: tabela `projeto_aprovacoes` (+3 colunas do checklist),
> `aprovacoes.functions.ts`, `aprovacoes-checklist.ts`, rotas `/api/aprovacoes/*`, tela **`/aprovacoes`** +
> faixa na home (só p/ quem lidera), selo no card do autor, coluna **`Aprovação do Líder`** no Sheets e a DM
> (`google/chat-dm.ts`) — **ligada na staging**, no-op em prod (sem os secrets).
>
> **D11 escrita na spec** (decisão do Luis): quem **já é liderança** (aparece como `leader` de um time ativo
> na TeamGuide → `ehLideranca`) fica **ISENTO** — não entra em fila e não recebe DM. Só o liderado de fato
> precisa, e quem aprova é o **líder direto**, nunca o líder do líder.
>
> **Esclarecido com o Luis (03/08, fim da sessão):** para uma **liderança** (ex.: Lucas Queiroz), "isento"
> significa **ninguém vê fila nenhuma** — sem DM, coluna `—`, e o projeto vai **direto para a triagem da
> RPA**, como era antes da feature. Se um dia quiserem que o projeto de uma liderança também apareça para
> alguém (o líder dela, ou a diretoria), a régua está concentrada em **um ponto**: a checagem de
> `ehLideranca` no topo de `abrirPreAprovacao`.
>
> **✅ DECIDIDO (03/08) — rótulo da isenção na planilha → D12 na spec.** Os 3 casos sem fila deixaram de
> compartilhar o `—`: liderança → **`Pré-aprovado (liderança)`** · autor sem líder → `Sem líder na
> TeamGuide` · TeamGuide fora → `Aprovação indisponível (integração)`. Mora na função pura
> **`rotuloIsencaoSheet(motivo)`** (`aprovacoes.functions.ts`), consumida pelo `semFila`; o `motivo` já
> vinha pronto. **Comportamento inalterado** — liderança continua sem fila e sem DM, e o card do autor
> **não** ganha selo (decisão do Luis: a feature é invisível para quem é isento). ⚠️ A coluna `Status`
> NÃO é tocada pela feature em nenhum caso (segue "Pendente" pela regra temporária). 848 testes verdes,
> `worker.js` rebuildado. **Este rótulo entra na validação da staging** (caso 2 abaixo).
>
> **✅ STAGING PRONTA PARA O TESTE REAL (03/08, 15:39)** — `edf400b4` redeployada com o worker atual
> (inclui a D12) e a **DM LIGADA**: secrets `GOOGLE_CHAT_DM_ENABLED=true`, `CHAT_SA_CLIENT_EMAIL`,
> `CHAT_SA_KEY_BASE64`, `GOOGLE_CHAT_DM_SUBJECT=rpa_ia@gocase.com`. Cadeia validada ao vivo (troca de
> JWT + `spaces:setup` + post; DM de teste recebida pelo Luis). Aprovador esperado do Luis:
> **Lucas Goncalves Queiroz / lucas.queiroz@gocase.com** (`leader` do time RPA `43718`; o Luis é membro
> direto e não lidera time → não cai na isenção). ⚠️ **Submeter na staging manda Chat REAL para o
> Lucas.** Prod continua sem os secrets (DM no-op) e sem a feature.
>
> **O que validar na staging:** (1) submissão de um liderado → fila abre + coluna "Pendente com X";
> (2) submissão de uma liderança → coluna **"Pré-aprovado (liderança)"** e nenhuma fila/DM; (3) `/aprovacoes` lista, aprova e pede ajuste
> (comentário obrigatório na reprovação); (4) o autor vê o selo no card. **Pré-requisito do Luis (P2):**
> criar a coluna **`Aprovação do Líder`** no cabeçalho das abas `GoDocs` e `STAGING`.

> _Passo anterior:_ **validar o "—" RODANDO EM PRODUÇÃO** (`https://godocs.devgogroup.com/`, deploy
> 2026-08-03 13:00). Decisão do Luis: a aprovação do "—" acontece em prod, não na staging. Depois dela:
> **codar a F0** (plano aprovado) e **escrever a D11** em `spec-docs/SPEC_APROVACAO_LIDER.md` — a fila do
> líder vira **entrada própria no menu com selo de contagem** (visível só a quem lidera alguém), **não** a
> 5ª aba de "Meus Projetos" que a spec ainda descreve.
>
> ✅ **ENTREGUE em 2026-08-03:** staging `edf400b4` (12:38) → **PR #221 mergeado** (`main` `c65e5a1`) → **prod
> `674a3710`** (13:00), servindo `index-CzawDJZX.js` — mesmo artefato nos dois ambientes, sem rebuild no meio.
> Nada pendente de envio.
>
> ⚠️ **Aprendizado desta sessão (custou um commit indevido na `main` local, revertido sem push):** no
> diretório RAIZ, **nunca `git add -A`** — ele arrasta `.claude/worktrees/` como 8 repos git embutidos. O
> `.gitignore` passa a cobri-los; ainda assim, use caminhos explícitos no `git add`.

<details><summary>Instruções da validação em staging (superadas pela decisão de validar em prod)</summary>
> No `/dashboard`: apagar um motivo/parecer deve gravar **"—"** (não branco) e projeto novo nasce com
> "Motivo Reenvio" = "—". A staging grava na aba **`STAGING`** (planilha própria, não a de prod).
> Depois do merge: prod `674a3710`. `gh` precisa da conta **`LuisEduardo100`** (a `rpaiagogroup` é read-only).
> Só **depois** disso a **F0** entra em código (plano já aprovado).

</details>

> **O que validar (e o que NÃO existe ainda):** o único comportamento novo na staging é o **"—"** da coluna
> "Motivo Reenvio" — append e append de recuperação nascem com "—" (`sync.ts:411/440`), o **update da edição
> nunca toca** a coluna (é manual, `sync.ts:147`), apagar motivo/parecer no `/dashboard` grava "—", e o e-mail
> de reenvio não sai mais com o literal "Motivo: —". ⚠️ **Sem backfill**: linhas legadas já em branco
> **continuam em branco** (fronteira do plano, não esquecimento) — preencher o histórico é retroativo à parte.
> Da frente da **pré-aprovação do líder** subiu **só documentação** (spec, `.gitignore`, docs vivos) —
> **zero mudança de comportamento**: nada de `projeto_aprovacoes`, aba de aprovações ou `chat-dm.ts`, e as 10
> pessoas seguem em "ÁREA NÃO IDENTIFICADA" com a paginação lendo 25.

<details><summary>Sessões anteriores (histórico)</summary>

**Sessão de 2026-07-31** — **OPERAÇÃO em produção, sem mudança de código**: 3 diagnósticos
(lógica da classificação de elegibilidade · projeto da Nyara que **desapareceu** de "Meus Projetos" ·
**dupla contagem de R$ 161.913,78** no Sucesso.AI da Maria) e **1 correção aplicada em prod** (planilha +
SQLite). Ver "Sessão de 2026-07-31" abaixo.

> **▶ PRÓXIMO PASSO — varrer o Drive × planilha para achar outros projetos purgados como o da Nyara**
> (read-only, sem código: comparar os arquivos da pasta `1e_Fk8…` contra os IDs/nomes da aba `GoDocs`) **e
> decidir a recuperação dela** — reenvio pela app ou recriação manual da linha a partir da doc do Drive.
> É perda de dado **silenciosa**: some das duas fontes sem aviso, e só reclamação do autor revela.
> **Candidato a frente de CÓDIGO** (exige `/ggsd:plan`): **gate anti-dupla-contagem `custo evitado × receita`**
> — hoje o único bloco anti-dupla-contagem compara *horas × custo evitado*, e a fase de receita **não relê**
> os itens do custo evitado; foi exatamente o buraco do Sucesso.AI.

</details>

## Plano ativo
**→ [docs/plans/teamguide-lideranca-e-areas.md](plans/teamguide-lideranca-e-areas.md)** · Status: ✅ **executado** (código na branch `worktree-plano-aprovacao-lider-teamguide`, 2026-08-03)

> **F0 + F1 + F2** da pré-aprovação do líder (spec: `spec-docs/SPEC_APROVACAO_LIDER.md`, D1–**D12**):
> índice de liderança da TeamGuide + os 2 bugs do caminho (paginação morta · "ÁREA NÃO IDENTIFICADA" em
> 10 pessoas) + tabela/rotas/tela `/aprovacoes` + DM. **Codado e na staging.** O que resta do plano é
> **validação humana**, depois prod e PR — não há fatia de código pendente. 🛑 **Desde 03/08 à noite a ida
> a prod está TRAVADA até a validação com a DIRETORIA** (decisão do Luis): branch commitada, sem push/PR.
> **04/08:** o `origin/main` (PRs #224–#227) foi mergeado na branch e a staging redeployada; a fila do Lucas
> tem **3 itens pendentes** (2 mockados criados de propósito) esperando ele abrir com a **própria conta**.
> **04/08 noite:** entrou o **D16** ("não" no checklist exige explicação, commits `da32167`+`2c40eef`,
> staging 17:21) — segue sem push/PR. ⚠️ A branch está **atrás do `origin/main` `7980aa4` (PR #231)**: antes
> do PR, incorporar o main e **rebuildar `worker.js` + `dist`** (regra 10).
> **04/08 (tarde):** a fila virou **slider de 1 projeto por vez** (D15 — ver "Última sessão"), redeployada;
> continua sendo a MESMA validação humana pendente, agora com a tela nova.
> ⚠️ Os hooks do GGSD resolvem o projeto pela **raiz** do repo — os docs vivos e a flag
> `.claude/.planning-mode` ficam aqui; o código vai para worktree (regra 8). Ver "Nota de ambiente" no plano.

### ⏭️ ANTES da F0 — entrega conjunta das 2 frentes fechadas (decisão do Luis, 2026-08-03)
Duas frentes estão **prontas e não entregues**, e vão **juntas** (deploy de staging substitui a app INTEIRA —
subir uma sozinha apaga a outra):
1. **`fix/motivo-reenvio-traco`** (commit `a6e19f1`, worktree `.claude/worktrees/fix-motivo-reenvio-traco`) —
   o T5 do plano [motivo-reenvio-traco-padrao](plans/motivo-reenvio-traco-padrao.md).
2. **`worktree-plano-aprovacao-lider-teamguide`** (commit `81da73d`) — só docs: `spec-docs/SPEC_APROVACAO_LIDER.md`
   + `.gitignore` (o `GOOGLE-CHAT-DM.md` tem **chave privada de SA em texto puro** e estava rastreável).

**Sequência:** juntar as duas + `origin/main` → `npm run test` → `build` + `build:worker` → **staging
`edf400b4`** → **validação humana do Luis** → **PR + merge**. Prod (`674a3710`) fica para depois da
validação. ⚠️ Conferir qual branch está no ar na staging antes de subir.

**Estado desta fatia:** branch `fix/motivo-reenvio-traco` no worktree
`.claude/worktrees/fix-motivo-reenvio-traco`, commit **`a6e19f1`** — `sync.ts` (append e append de
recuperação inicializam a coluna com "—"; **update da edição NUNCA a toca**), `ouTraco` no write-back do
`/dashboard` (motivo/parecer apagado grava "—"), `motivoDaCelula` no `email-legados` (o e-mail de reenvio
podia sair com _"Motivo: —"_ — defeito latente achado junto), `CLAUDE.md` (gotcha 4 reescrito),
`SPEC_CORRECOES.md` e 3 arquivos de teste. **805 testes verdes**, `worker.js` rebuildado e commitado.
**Sem backfill** das linhas legadas já em branco (fronteira registrada no plano).

⚠️ **Estes docs (`NEXT-SESSION.md`, `plans/INDEX.md`, `plans/motivo-reenvio-traco-padrao.md`) estão
NÃO-COMMITADOS de propósito:** o diretório principal está em `main` (RF-18 proíbe commitar lá) e a frente
paralela está trabalhando nele — nenhuma operação de git foi feita aqui para não atropelá-la. Quem retomar:
commite-os junto do T5 (ou na branch da frente que estiver ativa).

_Antes desta fatia:_ **Nenhum** — nenhum plano em `aprovado` esperando execução (todos os de `docs/plans/INDEX.md` estão
concluídos/executados, e o `perguntas-agente-recorrencia-evidencia` segue 🟡 parcial com T3/T4 abertos por
decisão do Luis). O próximo passo desta sessão é **operacional** (varredura Drive × planilha), não precisa de
plano. Voltar a codar → `/ggsd:plan` primeiro (candidato: gate anti-dupla-contagem `custo evitado × receita`).

> **Contexto de código herdado — nenhuma frente aberta (decisão do Luis, 2026-07-30).** O GoDocs está com o
> backlog de implementação **zerado por ora**: a fatia A1 fechou (PRs #217/#218 mergeados; staging, prod e
> `main` sincronizados) e o **A2 foi DESCARTADO** — ver abaixo. O que resta é **humano**: (1) alinhar com o
> **Bruno** as 2 pendências de decisão da seção seguinte (onde as perguntas-chave de critério vivem · a
> "exceção projetos especiais" no limite de 1 coautor) e (2) calibrar a régua do critério com o **Rafa**,
> agora que ela reprova em produção e o autor vê o motivo.
> **Antes de abrir qualquer código novo:** existe **1 commit de docs à frente do `main`** nesta branch
> (`docs/plano-loadings-dashboard-admin`) — abrir PR ou levá-lo junto do próximo.
> **Se e quando voltar a codar**, as fatias ainda vivas, em ordem de valor: **(a) auto-preenchimento da
> Seção 2.4** (o agente escreve o destino do ganho SEM perguntar e INVENTA — suja o memorial e a coluna
> "Alocação Ganhos" com fala que não é do usuário; é qualidade de dado, o que a gestão lê) · **(b) piso
> `respostaAlocacaoVaga`** (recusa resposta válida misturada com filler — custa 1 repergunta; fronteira que
> exige confirmação do Luis). Qualquer uma começa com `/ggsd:plan`.

### ❌ A2 (materialidade nos gates) — DESCARTADO em 2026-07-30 (decisão do Luis)
Era: pendurar um piso de materialidade em `aplicaConfirmacaoBaseHoras`/`aplicaSplitCargaEscala`, que hoje
disparam com qualquer `horas_antes > 0` (um projeto de 0,05h/mês leva o gate das 220h). **Fora** porque:
**(1)** é o mesmo diagnóstico da "jornada preguiçosa", que o Luis **já havia recusado** em 30/07 — aprovar o
A2 reabriria aquela decisão; **(2)** o ganho é de **1–2 perguntas baratas** (a jornada aparece como opção
clicável, e o split **deixou de ser gate determinístico** em 03/07 — metade do alvo já estava desarmada);
**(3)** pendurar materialidade no teto das 220h **enfraquece** um guard que existe para barrar número
impossível — troca ruim (risco de dado errado por menos um clique). Reabrir exige plano próprio.

## ⏳ Pendentes de DECISÃO do Luis — cobrança do Bruno (chat, 2026-07-30)

Conferência dos pontos **em azul** da mensagem do chefe contra o código **em produção** (os azuis foram
entregues no **PR #216**, não nesta sessão; a A1/PR #217 é a fatia seguinte):

| Ponto do Bruno | Estado real | Pendência |
|---|---|---|
| 1) perguntas-chave de critério **no forms** | ✅ as 3 existem, mas só *"se desligar hoje quem reclama?"* está **no formulário** (Etapa 2). *"que processo mudou e quanto"* e *"moveu ponteiro de custo/receita/KPI"* são conduzidas pelo **AGENTE** (seções `[1.3]`/`[1.4]`) — decisão **R1 do Luis, 29/07**: rastreabilidade não se resolve com checkbox | **DECIDIR:** manter no agente (como está) ou levar para o formulário como ele escreveu. ⚠️ Voltar aos cards de ponteiro na Etapa 2 é explicitamente proibido hoje no `CLAUDE.md` |
| 2) classificar avaliação em 3 | ✅ `claro_sim`/`zona_cinzenta`/`claro_nao` em prod, calibrado (a nuvem de palavras **é reprovada**), `claro_nao` → "Reprovado" + Motivo | nenhuma (só a pendência humana: calibrar com o Rafa) |
| 3) máx. **1 coautor** *(exceção projetos especiais)* | ✅ limite implementado (`coautoresSelecionados`/`limitarCoautorUnico`, `constants.ts`) — ⚠️ **SEM a exceção para projeto especial** e a trava é **client-side** (o sync reverso ainda pode trazer 2+ coautores num legado) | **ESPECIFICAR a exceção** antes de codar; decidir se precisa de trava server-side |

**Não-azuis, seguem abertos:** % participante 75→50 · % contribuidor 50→25 · rotina com lideranças
(discutir zona cinzenta + relatório de inconsistências).

## Sessão de 2026-07-31 — operação em produção: 3 diagnósticos + 1 correção de dado

**Sessão sem mudança de código.** Nenhum arquivo de `src/` tocado, nenhum deploy. O que mudou foi **dado
de produção** (planilha + SQLite) e estes docs.

### 1. Como a coluna "Classificação" decide (só explicação, nada mexido)
Duas camadas. O **LLM** julga por 3 critérios (recorrência · contrafactual · rastreabilidade) e o prompt
(`analyzer.ts:252-278`) dá o desfecho: `claro_sim` = os 3 se sustentam (ou 2 + o 3º inferível) · `claro_nao`
= falha **evidente** em recorrência **E** rastreabilidade/contrafactual, "com PARCIMÔNIA" · `zona_cinzenta`
= **default de qualquer dúvida**, com a **exceção declarada** do par recorrência+contrafactual falhando
junto (foi o que passou a reprovar a nuvem de palavras). Depois, `normalizarClassificacao` (pura,
`analyzer.ts:512`) **só rebaixa** — nunca promove — e age **apenas sobre `claro_nao`**: sem motivo → cinzenta
· especial → cinzenta · materialidade > R$ 5k/mês → cinzenta · valor inválido → cinzenta.
⚠️ **O `motivo_reprovacao` é escrito pelo próprio agente**, não por um humano: sai no mesmo JSON, e o prompt
avisa o LLM da consequência de omiti-lo. O guard só pega o caso em que ele **desobedece o formato**.

### 2. Nyara Sato — "Consulta fiscal - IE e IM" desapareceu de "Meus Projetos" (ABERTO)
**Ela está certa: o projeto existiu e sumiu.** Não está na planilha (571 linhas), não está no SQLite de prod
(635 linhas, incl. os 64 rascunhos), nem como participante. A **única prova sobrevivente** é a doc no Drive:
`2026-07-29_180014_Consulta_fiscal_-_IE_e_IM_FINANÇAS.md` (id `1MZeuSJWJhXvjgqGKHNQErq9bnLJZkP5a`, 46 KB,
pasta de prod `1e_Fk8…`), com "Responsável: Nyara Sato" e a documentação inteira — **submissão em 29/07/2026
às 15:00** (18:00 UTC, carimbo no nome do arquivo).

**Mecanismo** (o modo de falha já documentado no `CLAUDE.md` → Sync Google): o append da IDA morreu → a linha
nunca nasceu na planilha → passada a **carência de 1h**, a `reconciliarExclusoes` purgou do SQLite em cascata.
O guard `deveRecuperarPorAppend` só age **numa edição/reenvio** — ela nunca reeditou, o purge chegou primeiro.
⚠️ **A causa do append falhado NÃO foi confirmada** (cota `429` é hipótese): o log do Godeploy só guarda ~3h
(janela lida: 31/07 14:34→17:17 UTC) e a submissão foi anteontem.

**Aberto:** (a) decidir recuperação — reenvio dela (a doc do Drive acelera a Etapa 2) **ou** recriar a linha
na planilha e deixar o sync reverso importar; o **memorial financeiro não está na doc**, tem de vir dela de
novo. (b) **varrer Drive × planilha** para achar outras vítimas — é o próximo passo desta sessão.

### 3. Maria Ponciano / Sucesso.AI — dupla contagem de R$ 161.913,78 (CORRIGIDO em prod)
Projeto `110f199139399ccd797af95aee10f165`, **linha 385** da aba `GoDocs`. O **mesmo dinheiro** estava dos
dois lados: os itens *"Ressarcimento das transportadoras"* (R$ 55.864,38) e *"Receita retida em reenvio"*
(R$ 106.049,40) no **custo evitado** E somados na **Receita Mensal** (R$ 161.913,78 = exatamente os dois).

**Por que "não atualizou":** no reenvio de 29/07 ela **só reabriu a etapa de receita**. Os `form_events` do dia
são `tipos` (16:30) → `receita` (16:34) → `submit` (16:57) — **nenhum evento `saving`**. O formulário só grava o
que é reaberto, então os 4 itens do custo evitado foram reenviados idênticos. **Não foi falha de sync:** a v3
gravou, `Atualizado Em` avançou, as colunas de receita nasceram certas. Trilha das 3 versões: v1 (08/07) 381h
/R$ 5.311,14 → v2 (22/07) custo evitado puro R$ 174.238,10 → v3 (29/07) + receita.

**O agente detectou e avisou** (16:36): _"os R$ 55.864,38 são ressarcimento/cobrança de transportadora — isso
é saving operacional, não receita incremental… confirme se devo excluir"_. Ela **reafirmou** que era receita e
ele aceitou — comportamento previsto (argumenta 1×, aceita a discordância). **Ponto cego real:** o bloco
anti-dupla-contagem só compara *horas × custo evitado*; **não existe checagem custo evitado × receita**, e a
fase de receita não relê os itens do custo evitado.

**Correção aplicada** (5 células via Service Account + `POST /api/admin/sync-sheets-now` → `atualizados:1,
removidos:0`):

| Coluna | Antes | Depois |
|---|---|---|
| Custo Evitado (T385) | R$ 174.238,10 | **R$ 12.324,32** |
| Saving Reais (W385) | R$ 174.238,10 | **R$ 12.324,32** |
| Ganho Total (AE385) | R$ 190.429,48 | **R$ 28.515,70** |
| Justificativa Custo Evitado (U385) | 4 itens | 2 itens |
| Memorial de Saving (Y385) | totais de 174.238,10 | 12.324,32 |

Intocadas: Receita Mensal, Receita Memorial, Tipo de Receita, Status, Observações, Atualizado Em, Saving
Horas, `Alguém Fazia?`. Verificado nas 3 camadas (planilha, SQLite, dashboard com `?refresh=1`).

⚠️ **RESÍDUO ABERTO — a correção é reversível por acidente:** `projetos.custo_evitado_itens` (JSON só-banco)
**ainda tem os 4 itens** — não está em `SAFE_UPDATE_FIELDS` e não tem coluna no Sheets, então o sync reverso
não o alcança. **Se ela reeditar, o form seeda os 4 de volta e o custo evitado retorna a R$ 174.238,10.**
Fechar exige ela remover os 2 itens no form (recomendado, sem código) ou um endpoint admin novo.

⚠️ **Sem nota de correção nas células** (decisão do Luis, 31/07): a primeira versão da correção gravou uma
nota datada em U385/Y385 explicando a remoção dos 2 itens — **foi retirada**. O histórico da correção mora
NESTE doc e na memória, **nunca no texto que a gestão lê na planilha**.

⚠️ Também aberto: `Alguém Fazia?` = "sim" na planilha, mas o estado do saving é `alguem_fazia:'externo'` desde
a v2 — as **381h/mês** da Assistente da v1 (R$ 5.311,14) viraram 0h e não aparecem em lugar nenhum.

**Não é bug (para não "consertar" por engano):** `Ganho Total` **não é a soma** — receita entra com **÷10**
("fator de equivalência"), igual nos dois caminhos (`submeterParaValidacao` e `resyncGoogle`, `chat.functions.ts`).

**Varredura feita:** dos 11 projetos com receita > 0, **9** têm saving e receita juntos, mas **só o Sucesso.AI**
tinha sobreposição de valores. Nenhuma outra vítima deste padrão.

### 4. GoProduct (Emanuele Correia) — MESMA falha da Nyara, pega a tempo e RECUPERADO
O `sync-sheets-now` da correção acima devolveu `"85d3a9d728fdb909f0b2b290d37b7d88: ausente do Sheets, mas
recente — mantido (carência)"`: **GoProduct** (PRODUTO), submetido **31/07 16:36** local, estava no SQLite e
**não** na planilha — o mesmo append morto que purgou o projeto da Nyara, ainda **dentro da carência de 1h**.
Recuperado com `GET /api/admin/resync-google?projeto_id=…`, que desde o PR #216 **cai para append** quando a
linha não existe: **apendado na linha 574**, Status "Pendente". Sem isso, o projeto seria purgado em ~20 min.
⚠️ **Isto confirma que a falha NÃO é evento isolado da Nyara** — é recorrente e silenciosa. Reforça o próximo
passo (varredura Drive × planilha) e sugere uma segunda frente: **detecção automática** do SQLite-sem-linha
(o `reconciliarExclusoes` já sabe quem está nesse estado — hoje só loga a carência e depois apaga).

### Artefatos desta sessão (scratchpad, não versionados)
`sheets-lib.mjs` (acesso mínimo ao Sheets por Service Account) · `fix-sucesso.mjs` (dry-run por default,
`--apply` grava) · **`backup-sucesso-row.json`** (linha 385 inteira antes da edição — reversível célula a célula).

## Sessão de 2026-07-30 (parte 9) — T7 da A1: staging → prod → repo

**O que rodou:**
1. **Testes + build na worktree `fix-gates-a1a2`:** 797 verdes; `npm run build` + `npm run build:worker`
   reproduziram o `worker.js` já commitado (sem diff) — sinal de que o commit `b390c62` estava íntegro.
2. **Staging `edf400b4` deployada** com o `dist/` inteiro via `scripts/deploy-godeploy.sh`. A conferência de
   "qual branch está no ar" foi feita por comparação de branches: **todas** as branches locais menos as duas
   pendentes já estavam contidas no `origin/main` (`39deaf9`), e a `fix/gate-…` estava 0 commits atrás dele —
   logo o build é superset do que estava no ar, sem risco de apagar feature de outra branch.
3. **Validação ponta a ponta na staging** (não só navegador): driver descartável no scratchpad reusando
   `scripts/e2e/lib/{api,responder,env}.mjs`. O cenário-âncora **não** entrou em `scripts/e2e/scenarios.mjs`
   porque o **gate de plano** recusa editar código sem plano ativo aprovado — a trava **não** foi contornada.
   ⚠️ **Versionar o cenário no harness é passo próprio.**
   - **Run 1** (doc com contexto rico): o agente **nunca perguntou** o destino — auto-preencheu a Seção 2.4 e
     **inventou** "menos prazo / menos retrabalho". Ver o achado no próximo passo (b).
   - **Run 2** (briefing negando explicitamente qualquer efeito de prazo/erro): o gate **perguntou 1×**, a
     resposta de headcount foi **aceita de primeira**, **zero** reinterrogação no preview, e a seção saiu
     gravada com a fala do usuário, enquadrada como *menos custo*. Planilha `STAGING`: 160h · R$ 2.230,40 ·
     **AK preenchida** · split 160/0 · `Classificação` claro_sim.
   - Limpeza: `POST /api/admin/e2e-cleanup` na staging (19 projetos `[E2E-…]` removidos).
4. **Prod `674a3710` deployado** depois da staging (regra 13); os dois ambientes servem o mesmo entry
   `index-CzawDJZX.js`, conferido via `GET /` com cookie.
5. **Repo sincronizado:** `fix/gate-alocacao-taxonomia-e-materialidade` e
   `docs/plano-loadings-dashboard-admin` empurradas; PRs **#217** e **#218** abertos e **mergeados** (o `gh pr merge` foi barrado pelo classificador na 1ª
   tentativa e liberado pelo operador; a #218 exigiu resolver conflito de docs contra o `main` do #216).

**Armadilhas encontradas (para não repetir):**
- ⚠️ **`E2E_COOKIE` expirado dá 302 em staging E prod** e o harness morre no 1º POST com "sessão não
  autenticada". Cheque com `curl -H "Cookie: $E2E_COOKIE" <url>/api/auth/me` **antes** de rodar. Renovado
  nesta sessão (`.env` da raiz **e** da worktree — `scripts/e2e/lib/env.mjs` lê o `.env` da raiz do worktree).
- ⚠️ **Detector de "repergunta" ingênuo dá falso NEGATIVO:** (a) o `content` do **preview** contém o memorial
  inteiro, então um regex de tema casa o texto do memorial e conta como "pergunta"; (b) o memorial gravado
  **não** tem os `###` (o `normalizarMarcadoresMemorial` os remove), então procurar
  `### O que mudou após a automação` não acha a seção que **está lá**. Case pelo título sem `#`.
- ⚠️ O **gate de plano** (`plan-gate.sh`) barra edição de **código** — inclusive `scripts/e2e/*.mjs` — quando
  o `## Plano ativo` do `NEXT-SESSION.md` não aponta plano `aprovado`. Docs passam.

---

**Sessão anterior:** 2026-07-30, parte 7 — **planejamento, sem código**: o escopo fechado na parte 6 virou
**plano aprovado** ([taxonomia-destino-ganho-e-anti-loop](plans/taxonomia-destino-ganho-e-anti-loop.md)),
com **duas mudanças de escopo decididas pelo Luis nesta sessão** (ver "Sessão de 2026-07-30 (parte 7)"):
a **jornada preguiçosa saiu** e o **anti-loop do juiz** ganhou desenho determinístico.

> ~~**▶ PRÓXIMO PASSO:** `/ggsd:code` da fatia A1~~ → **FEITO na parte 8** (T1–T6). A worktree
> `.claude/worktrees/fix-gates-a1a2` (branch `fix/gate-alocacao-taxonomia-e-materialidade`, de `origin/main`
> `39deaf9`) tem o commit `b390c62`. ⚠️ O nome da branch ainda diz "materialidade" (era o escopo A2, hoje
> fora) — o conteúdo é **taxonomia + anti-loop**.

> **▶ Pendências da frente anterior (3 humanas + 1 técnica), ainda válidas:**
> 1. **Avisar o Rafa** — a reprovação automática está em prod e o **motivo é visível ao autor** (D10). A
>    **calibração da régua com ele** segue pendente (agora pós-deploy).
> 2. **Limpar as 15 linhas `[E2E-…]` da planilha da STAGING** — **não dá pelo script como está**: a planilha da
>    staging é **arquivo próprio** cujo `GOOGLE_SHEETS_ID` é **secret do app** (o `.env` local tem o de prod).
>    Com o ID em mão: `GOOGLE_SHEETS_ID=<id-staging> node --experimental-strip-types scripts/e2e/cleanup.mjs <runId>`
>    (**planilha ANTES do SQLite**). IDs listados abaixo.
> 3. **Causa-raiz do analisador morrendo no `waitUntil`** segue **aberta** — hoje o destrave é
>    `POST /api/admin/reanalisar-pendentes` (40–70s). Precisa de plano próprio (`/ggsd:plan`).
> 4. `CLAUDE.md` está em **~48k chars**, acima do teto de 40k — vale uma poda.

## Sessão de 2026-07-30 (parte 8) — fatia A1 codada (T1–T6), staging pendente

**Commit:** `b390c62` na `fix/gate-alocacao-taxonomia-e-materialidade` (worktree `fix-gates-a1a2`, sobre
`origin/main` `39deaf9`). **797 testes verdes** (783 + 14 novos). `worker.js` rebuildado e commitado.

**1. Fonte única.** `TAXONOMIA_DESTINO_GANHO` (`orchestrator.ts`, ao lado de `LIMITE_ECONOMIA_ALTA`) declara os
**5 destinos aceitos** — *mais entrega · menos custo · menos erro/retrabalho · menos risco/fraude · menos
prazo* —, cada um com exemplo concreto, e a régua nova: **basta NOMEAR o destino e encaixá-lo em UM dos 5**.
Os **3 pontos** a interpolam (`blocoEconomiaAlta`, `blocoEconomiaAltaPv` e os 3 textos do gate em
`chat.functions.ts`, que passaram a ser **exportados** para o teste da fonte única). Nenhum redigita a lista —
e o teste garante isso derivando **em runtime** as linhas da constante e exigindo-as em cada consumidor.

**2. Anti-loop determinístico.** `buildSavingPreviewPrompt` deixa de injetar o bloco de economia alta quando
`saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`. Sem campo novo, sem persuasão. O juiz **segue ativo**
onde o gate não se aplica (`'nao'`/`'externo'`), que é onde ele é a única rede.

**3. Fronteiras respeitadas (verificado por revisor de contexto fresco):** `respostaAlocacaoVaga`,
`aplicaGateAlocacaoGanhos` e `LIMITE_ECONOMIA_ALTA` **inalterados** (zero hunks); jornada/220h, split
carga×escala, critério `[1.3]`/`[1.4]`, `analyzer.ts` e colunas do Sheets intocados; o cabeçalho
`### O que mudou após a automação` **permanece exato** (é por ele que a coluna AK é fatiada).

**4. ⚠️ O que a execução descobriu e NÃO corrigiu (registrado no plano, item (a)):** o piso
`respostaAlocacaoVaga` ainda marca como VAGA a resposta que **mistura** destino válido com filler — medido:
*"não repusemos a vaga, o time menor dá conta com essa otimização"*, *"as divergências caíram, ficou mais
eficiente"*, *"o fechamento ficou mais rápido, sobra tempo"* → vaga. As frases **limpas** dos 5 destinos
passam. Custo: **1 repergunta firme** (a 2ª resposta é sempre aceita), não os 5 do caso do Rafa. Alinhar o
piso é **fatia própria** — o predicado é fronteira dura deste plano e mexer nele exige decisão do Luis.

**5. Ressalvas dos revisores (não bloqueantes, no commit e no plano):** conformidade **diverge-baixa** (link do
plano na spec só resolve quando esta branch de docs mergear; a guarda saiu em arquivo novo em vez de estender
`tests/gate-alocacao-ganhos.test.ts`) · qualidade **sugestoes** (além do item 4: a taxonomia inteira vai no
texto exibido ao usuário e é reinjetada no histórico a cada turno, ~300 tokens — caberia derivar uma projeção
curta para o chat da mesma fonte).

**6. Não esquecer no T7:** conferir a branch no ar antes do `updateApp` (substitui a app inteira) · o
`E2E_COOKIE`/`E2E_BASE_URL` (a worktree não tem `.env`, e o harness cai em **PROD** por default) · `tsc` tem
**5 erros pré-existentes** (idênticos sem o diff — não são regressão).

## Sessão de 2026-07-30 (parte 7) — o escopo virou plano aprovado, com 2 mudanças de escopo

**Nenhum código alterado** (sessão de planejamento; Gate D armado do começo ao fim). O plano está em
[docs/plans/taxonomia-destino-ganho-e-anti-loop.md](plans/taxonomia-destino-ganho-e-anti-loop.md),
**✅ aprovado (Luis, 2026-07-30)**.

**1. O defeito foi confirmado no código, e o culpado NÃO é quem se pensava.** A recusa de "menos custo" está
em **3 textos de prompt** que definem resposta completa como _"atividades NOMEADAS **E** o que o time entrega
**A MAIS**"_: `blocoEconomiaAlta` (`buildSavingPrompt`), `blocoEconomiaAltaPv` (`buildSavingPreviewPrompt`) e
os 3 textos do gate em `chat.functions.ts` (`perguntaAlocacaoGanhos` / `…Firme` / `nudgeAlocacaoGanhos`).
Quando o ganho é **menos custo**, a entrega **não aumenta** — e a resposta certa lê como incompleta. O
`blocoEconomiaAlta` cita "redução de equipe-vaga não reposta" **de passagem**, num parêntese de exemplos, mas
o **gate** da frase segue exigindo o par — e é o gate que decide. ⚠️ Confirmado que **`respostaAlocacaoVaga`
(`orchestrator.ts:520`) NÃO reprova** "redução de 3 auxiliares" (tem número → aceita): o defeito é **100% de
prompt**, e o predicado **não se mexe** (mexer afrouxaria a rede que pegou o boilerplate do Gostream).

**2. Mudança de escopo — a jornada preguiçosa FICOU DE FORA (decisão do Luis).** O diagnóstico foi
apresentado (o gate da jornada só define o `cap` do gate do teto, então com o maior cargo em 12h/mês a
resposta é **inerte** — disparou em 15 de 24 conversas sem mudar nada) junto de um desenho **melhor que o
limiar de 176h**: perguntar a jornada **sob demanda**, exatamente quando alguma linha passa de **220h** (o
*menor* cap possível — logo, o único momento em que a resposta muda o resultado), sem número arbitrário e sem
o risco que motivava a margem de 80%. **O Luis optou por deixar o gate como está.** O limiar de 176h,
portanto, **não é mais pendência** — a decisão foi tomada. Reavaliar só **depois de re-medir** o baseline
pós-#216.

**3. Anti-loop do juiz do preview — desenho fechado (determinístico).** O juiz não tem limite de recusas e
reinterroga mesmo depois do gate determinístico já ter coletado o destino (origem das 13 perguntas
pós-preview do baseline). Fix escolhido: `buildSavingPreviewPrompt` **deixa de injetar** o
`blocoEconomiaAltaPv` quando `saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`. **Sem campo novo no
estado e sem depender do LLM obedecer** a um "recuse só 1 vez" (persuasão é o tipo de garantia que já falhou
no Gostream). O juiz **segue ativo** onde o gate não se aplica (contrafactual `'nao'`, custo evitado puro
`'externo'`), que é onde ele é a única rede.

**4. Fronteiras duras registradas no plano:** jornada/base 220h · split carga×escala · `respostaAlocacaoVaga`
· `aplicaGateAlocacaoGanhos` · `LIMITE_ECONOMIA_ALTA` — **nada disso se mexe**. Fusão jornada+teto e
re-medição do baseline seguem fora. **Confiança do blast-radius: média** — este repo **não tem**
`docs/INDEX.md`, `docs/invariants.md` nem `scripts/ctx-route.sh`, então o mapeamento saiu de leitura direta
do código; a sessão de código deve varrer os consumidores antes de editar.

**5. Não esquecer na sessão de código:** regra 3 (`prompt-registry.ts` **afirma hoje** a exigência antiga do
"A MAIS" — sem atualizar, o registry passa a mentir), regra 1 (`worker.js` rebuildado e commitado), regra 12
(`SPEC_CORRECOES.md`) e regra 13 (**staging `edf400b4` antes de prod**, com o cenário-âncora da redução de
headcount tendo de passar **de primeira**). O cabeçalho `### O que mudou após a automação` **permanece
exato** — `extrairAlocacaoGanhos` fatia por ele para a coluna "Alocação Ganhos" (AK).

## Sessão de 2026-07-30 (parte 6) — o que o agente pergunta hoje, e o que ainda falta podar

**Nenhum código alterado** (o `plan-gate` recusou — ver Próximo passo). Sessão de leitura sobre
`origin/main` `39deaf9`, não sobre o doc de 28/07 — a diferença importa, porque o `#216` mexeu nas perguntas.

**1. Inventário do que a pessoa é perguntada HOJE** (levantado do código, não do baseline velho):
- **Form** — Etapa 1: equipe + papel por participante (Coautor único). Etapa 2: nome · data · contexto de
  negócio · AI Proxy · **"se desligar isso hoje, quem reclama?"** (pessoa/time da Team Guide) · **"e o que
  piora?"** · arquivos. Etapa 2 financeira: "alguém já fazia?" → horas antes/depois · recorrência · custo
  evitado · custo do projeto.
- **Chat/doc** — só os campos que o extrator não tirou do código, + "usa IA como funcionalidade?" e, se sim,
  "em que parte a IA entra?" (2 turnos, sempre).
- **Chat/memorial** — as duas seções novas do critério: **`[1.3]` Processo alterado** e **`[1.4]` Ponteiro
  movido e onde verificar**, nos 3 modos, com gate determinístico anti-loop (`perguntaCriterioSecoes`).
- **Gates de sistema** — jornada/220h → teto por pessoa → split carga×escala → alocação de ganhos.

**2. Prestação de contas da frente [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md):**
**T1** ✅ (baseline) · **T2** ✅ (virou o plano do critério e foi executado inteiro, PR #216) ·
**T3 e T4 ABERTOS**. Confirmado **no código do `main`**, não presumido: `orchestrator.ts` segue exigindo
_"o QUE passaram a entregar A MAIS"_ e o juiz do preview segue mandando recusar **sem contador anti-loop**;
`aplicaConfirmacaoBaseHoras` e `aplicaSplitCargaEscala` seguem disparando com qualquer `horas_antes > 0`.

**3. Achado desta sessão — o gate da jornada não tem consequência própria** (`chat.functions.ts:1435-1490`):
a única coisa que a resposta faz é definir o `cap` do gate do teto (`tetoPorJornada`: 220h dias úteis / até
~300h com trabalho humano no fim de semana). Com o maior cargo em 12h/mês, a resposta é **inerte** — o teto
nunca é atingido nos dois cenários. É por isso que ele disparou em 15 de 24 conversas sem mudar nada.

**4. Escopo fechado da próxima fatia (decisões do Luis nesta sessão):**
- **A1 — taxonomia de destino do ganho + anti-loop.** Constante única `TAXONOMIA_DESTINO_GANHO` consumida
  pelos **3** lugares (bloco 2.4 do `buildSavingPrompt`, juiz do `buildSavingPreviewPrompt`, perguntas do
  gate em `chat.functions.ts`): aceitar **mais entrega · menos custo · menos erro/retrabalho ·
  menos risco/fraude · menos prazo** — _"a mesma entrega com um time menor"_ passa a ser resposta **válida e
  completa**. O juiz do preview ganha limite de **1 recusa** (hoje não tem — daí as 13 perguntas
  pós-preview). ⚠️ `respostaAlocacaoVaga` **já aceita** "redução de 3 auxiliares" (não bate no regex vago):
  o defeito é 100% de **prompt**, não do predicado — não "consertar" o predicado por engano.
- **Jornada preguiçosa** — só perguntar quando alguma linha tem `horas_antes` **≥ 176h/mês** (80% do teto;
  a margem cobre o usuário corrigir as horas para cima no meio da conversa). **⏳ falta o Luis confirmar o
  número.**
- **Split carga×escala fica COMO ESTÁ** — decisão explícita do Luis nesta sessão. Não mexer.
- **Fundir jornada + teto numa pergunta só ficou FORA** desta fatia (é o T3 estrutural; foi assim que nasceu
  o loop do split). Reavaliar **depois de re-medir**.
- ⚠️ **Re-medir antes de podar mais:** o baseline de **6,4 perguntas/submissão** é de **28/07, ANTES** do
  #216 — que somou `[1.3]`/`[1.4]` **e** passou a injetar o contrafactual e a doc aprovada em todos os
  prompts (`buildRespostasFormulario`). O saldo é desconhecido; rodar o mesmo script sobre as submissões
  pós-#216 custa pouco.

## ✅ Critério de projeto — EM PRODUÇÃO (PR #216 mergeado, `main` `39deaf9`)
A calibração da régua (**só prompt**, `analyzer.ts`) foi provada ao vivo na staging: o cenário
`criterio-claro-nao` (a **nuvem de palavras**, o caso do Rafa que motivou a frente) fechou em **Status
"Reprovado"**, `Classificação` = _"Claro não — a recorrência falha… o contrafactual também falha… **a
rastreabilidade do artefato existe, mas não compensa a falta do par**"_ e **`Motivo Reprovado`** legível, com
caminho de volta pro autor. Os dois furos diagnosticados na parte 3 fecharam: o **entregável** deixou de valer
como rastreabilidade e a **falha simultânea** (recorrência **e** contrafactual) virou exceção declarada ao
"na dúvida → zona_cinzenta". `normalizarClassificacao` **intacta** (segue só rebaixando — D9).

**Guarda de falso-positivo passou** (run `20260730-1300`, staging): `saving-puro` → **Claro sim** ·
`custo-evitado-puro` → **Claro sim** · `complexidade-autonomia` → **Claro sim** · `receita-pura` →
**Zona cinzenta**. **Nenhum** cenário legítimo virou `claro_nao`. 783 testes, `build` + `build:worker` OK,
prod conferido (entry servido = build novo, favicon 200, `/api/auth/me` OK).

## ⚠️ ARMADILHA que custou 3 projetos de teste EM PRODUÇÃO — ler antes de rodar E2E
`scripts/e2e/lib/env.mjs` resolve o `.env` em `../../../.env` e, **quando não acha, cai em PROD**
(`https://godocs.devgogroup.com`). **Worktree não tem `.env`** → dois runs foram pra produção e submeteram 3
projetos `[E2E-20260730-1256]` na planilha real (removidos com `cleanup.mjs`, planilha antes do SQLite; prod
voltou a **0** linhas E2E e 563 no total). **Sempre** exportar explicitamente:

```bash
export E2E_BASE_URL=https://godocs-staging.devgogroup.com
export E2E_COOKIE=$(grep '^E2E_COOKIE=' /home/notebook/godocs-main/.env | sed 's/^E2E_COOKIE=//')
```

…e **conferir a linha `🚀 E2E run … contra <URL>`** antes de deixar rodar. Corolário: **nunca** pipar o run
pra `tail` — a saída fica presa e o run **parece morto enquanto está submetendo**.

## 🐞 Achado pré-existente (NÃO investigar como bug novo)
`saving-multicargo` estoura os **40 turnos** em loop de repergunta da **Seção 2.4** quando o respondedor do
E2E não tem o dado ("o briefing não detalha"). **Falha idêntica no código de prod**, sem a frente — não é
regressão. O gate determinístico da 2.4 tem anti-loop; quem repergunta sem limite é a rede LLM-juiz do
`buildSavingPreviewPrompt`.

## 🧹 Linhas `[E2E-…]` a remover da planilha da STAGING (15)
`d8ba3c3e8744ae84b969700ac757171b` · `ec2563e8f6ea9c5d25997765e32d97a8` · `dc17203497483353a6d232f46da60a79` ·
`0db1fc6f734db2a17ae455b539fce365` · `1f2355c3dd0e30843b73125ff3238fa3` · `35155594eafce787b872b598b7d96945` ·
`e67a44f3b4fb1dc1b1464c7408f80cfa` · `565aebd32a41f5a50064bef308de6817` · `a35cd24e885d088b43068347400e2dc7` ·
`993b3741bad60bd43da5f1518ec2b6f3` · `ef85becf58e866e62e88a672f6c6a176` · `8eef40970185448a2509572ed734c812` ·
`fccdeceedad244127c29df30a80d75b1` · `c8de6939bcfdf5ba35847bad4f8b2447` · `f688432cf4628579cff8b3686c52e9f8`

⚠️ A aba `STAGING` recebeu **cópia de dados reais de prod** (decisão do Luis, 30/07) — contra a regra de
"dados simulados". Vale considerar repovoar com dado sintético.

## ⚠️ Risco médio ACEITO que viaja com a frente
`false` = "não achei o ID" **≠** "a linha nunca existiu": ID mexido à mão na planilha (ou append in-flight)
pode gerar **2ª linha** em vez de no-op no fallback de recuperação da IDA. Auto-limitante (o append grava o
`ID Projeto`). Detalhe em `spec-docs/SPEC_CORRECOES.md`.

## ✅ O fix da cota se sustentou sob submissão real (`stg-crit-05`)
Re-rodado o cenário `criterio-claro-nao` no worktree `staging-criterios-coautor` → projeto
`35155594eafce787b872b598b7d96945` (R$ 27,88, 2h, pontual). **A linha CHEGOU na planilha** — era exatamente
o que falhava antes (`429` no append + purga após a carência de 1h). `POST /api/admin/reanalisar-pendentes`
devolveu `{"submetidos":570,"faltando":1,"reanalisados":1}` em **38s / HTTP 200** (antes: ~109 projetos por
rodada e HTTP 500). `Complexidade` = `automacao`, coluna **`Classificação` gravada** com justificativa, e as
2 seções novas do memorial (`Processo alterado` · `Ponteiro movido e onde verificar`) presentes.

## 🐞 A RÉGUA NÃO REPROVA O CASO QUE A MOTIVOU — plano aprovado, código pendente
O veredito do cenário foi **zona cinzenta**, não `claro_nao`: Status "Pendente" e `Motivo Reprovado` vazio —
**correto para zona cinzenta**, mas significa que o caminho da reprovação segue sem exercício real e, em
prod, tende a **nunca disparar**. E o cenário é a **nuvem de palavras**, o caso do Rafa que motivou a frente
inteira e que está escrito como few-shot de `claro_nao` no próprio prompt (`analyzer.ts:265`).

A justificativa gravada entrega as 2 causas: _"a recorrência não está bem sustentada… o autor afirma que
nada piora e que ninguém pediu de novo; **por outro lado, há um indicador de uso e um resultado verificável
no material do evento**, então não é caso de claro_nao"_. Ou seja: **(1)** o analisador aceitou o
**entregável** (o slide) como **rastreabilidade** — prova que a peça foi feita, não que um ponteiro mudou; e
**(2)** o "use com PARCIMÔNIA / na dúvida SEMPRE zona_cinzenta" absorveu um caso em que **recorrência E
contrafactual falharam juntos**, que a própria regra já mandava reprovar. Parte disso é artefato do
respondedor do E2E (ele inventou uma evidência plausível), mas **não tudo** — a régua cedeu mesmo com o
contrafactual negado. A `SPEC_CRITERIOS_PROJETO.md` já listava _"régua a calibrar com o Rafa antes de
produção"_ como pendência: é esta.

⚠️ **A parte determinística está OK** e não é o problema: `claro_nao → rejeitado + "Reprovado"` tem teste
(AC1 em `tests/criterios-classificacao.test.ts`) e a escrita das colunas foi provada ao vivo. O que falta é
o LLM **chegar** a `claro_nao`. **Decisão do Luis nesta sessão: calibrar ANTES de prod** (revê o "subir tudo,
calibrar depois" de mais cedo, agora que se sabe que a reprovação pode nunca disparar) — e **levar o fix do
`resyncGoogle` junto**. Plano aprovado: ver "Plano ativo".

_(Contexto da sessão anterior:)_ **2026-07-30, parte 2** (validação em staging — **achou e corrigiu um bug crítico**). O deploy de prod estava aprovado pelo Luis ("subir tudo, calibrar a régua do Rafa depois",
escopo do form mantido como validado), mas foi **parado por um achado** que ele não conhecia.

## 🐞 LOOP DE RECONCILIAÇÃO QUE ESTOURAVA A COTA DO SHEETS — corrigido, commit `cb8d677`
**Regressão da própria branch do critério** (⚠️ `origin/main` está LIMPO — `classifNaPlanilha` não existe
lá; prod nunca teve o bug). Em `reconciliarComplexidade` (`chat.functions.ts`) a coluna nova
`Classificação` fez o critério de "já está pronto" virar `Complexidade preenchida E Classificação
preenchida` — **impossível de satisfazer** para projeto ANTIGO: tem Complexidade na planilha,
`Classificação` vazia (coluna nova) e **nada** de classificação no SQLite, então o cron escrevia só a
Complexidade (que já estava lá), a Classificação seguia vazia e ele voltava no minuto seguinte. **Para
sempre.** Medido nos logs da staging: **109 projetos distintos, 693 tentativas em 7 rodadas (~99 leituras
de cabeçalho por minuto)** contra a cota de **60 leituras/min** do Sheets.

**Danos reais observados** (e que iriam a prod): **707 erros 429**; o **append da submissão do run 3
morreu** (`[google/sync] Falha ao inserir na planilha: 429`) → o projeto **nunca chegou à planilha**; e,
passada a **carência de 1h**, `reconciliarExclusoes` **apagaria o projeto do SQLite** — perda silenciosa.
⚠️ A cota é do **mesmo projeto GCP da produção** (`398963590019`), então a staging estava **degradando o
Sheets de prod**; o cron da staging foi pausado durante o diagnóstico e **religado** após o fix.

**Fix:** a decisão virou a função **pura** `decidirReconciliacaoPlanilha` — só age quando há algo
**realmente gravável** (coluna vazia na planilha **E** dado no SQLite) ou quando cabe re-análise (SQLite
vazio nas duas pontas); nada a fazer → não conta como pendente e **não gera leitura**. **8 testes de
convergência** (`tests/reconciliacao-convergencia.test.ts`), incluindo estabilidade da 2ª passada.
**769 testes verdes**, `build` + `build:worker` OK, `worker.js` recomitado, **staging redeployada 15:03**.
✅ **PROVA no ar:** `POST /api/admin/reanalisar-pendentes` → `{"submetidos":569,"faltando":0,
"ressincronizados":0,"reanalisados":0}` em **15,8s** e **HTTP 200** (antes: ~109/rodada e HTTP 500).

## 🐞 2º gap ACHADO e NÃO corrigido (decisão do Luis: fora deste fix)
**`resyncGoogle` não recupera linha ausente:** ele usa `modo: "edicao"` → `updateRowByProjectId`; se a
linha não existe na planilha, **não acha nada, não faz nada e ainda devolve `ok:true`**. Ou seja: quando o
append da IDA falha (cota/transiente), **não existe caminho de recuperação** e o projeto é purgado após 1h.
Fix sugerido: cair para **append** quando a linha não existe, em vez de no-op silencioso.

## ✅ Validado nesta sessão (lado do AGENTE, item 1 do pedido)
O `stg-crit-02` (que ficou em voo na sessão anterior) **fechou com sucesso** nos 2 cenários — e o
`receita-pura` **não** estourou os 40 turnos, o risco que o handoff anterior apontava. Rodou **no worktree**,
logo **com** as 2 correções do harness. A ficha do `/dashboard` confirma no memorial gravado as duas seções
novas (`Processo alterado` + `Ponteiro movido e onde verificar`) e o **comportamento 3** intacto: _"Não foi
informado no briefing um relatório, painel, sistema ou base específica para conferência desse número;
portanto, a ausência de fonte nomeada fica registrada explicitamente, **sem inventar referência**"_.

## ⚠️ Ainda NÃO validado: `claro_nao → "Reprovado"` (item 2 do pedido)
O cenário novo `criterio-claro-nao` **rodou e submeteu** (`f97856f5…`, ganho R$27,88/mês, 40 turnos não
estourados) — mas a linha **não chegou na planilha** por causa do bug acima, então o caminho da reprovação
**não pôde ser conferido**. Com o fix no ar, **basta re-rodar o cenário**. O analisador em si **funciona**:
os 2 projetos do `stg-crit-02` têm `complexidade` gravada no SQLite (`autonomia`/`automacao`) — o que
falhava era só a escrita na planilha.

## 🧭 Descobertas de método que economizam tempo na próxima sessão
- ⚠️ **A staging tem `GOOGLE_SHEETS_ID` PRÓPRIO** (secret separado) — **não** é a "planilha de prod
  compartilhada" que o `CLAUDE.md` descreve. Ler a planilha da staging com o `.env` local (ID de prod) dá
  **0 linhas** e parece bug do produto. **Caminho certo:** `GET /api/admin/dashboard/projetos` (listagem) e
  **`GET /api/admin/dashboard/projetos/:id`** (a **linha INTEIRA**, é onde `Classificação`/`Motivo
  Reprovado` aparecem). O `read-criterio.mjs` do scratchpad **mede a planilha errada** — corrigir ou largar.
- O cron `reanalisar-pendentes` **dispara sim na staging** (o handoff anterior dizia que não) — ele
  devolvia **500 por cota**, não silêncio.
- `/api/admin/investigador/projetos` **não** expõe `classificacao_avaliacao`; `/api/meus-projetos` expõe
  `motivo_reprovado`/`motivo_reenvio` em **snake_case**.

_(Antes desta:)_ **2026-07-30 (validação em staging — critério de projeto)** — pedido do Luis: **validar por
E2E na staging que o agente pergunta o que o planejamento definiu, antes de levar TUDO a produção**.

**✅ O GATE T8 FUNCIONOU — os 2 cenários que falhavam na rodada de 29/07 passaram** (run `stg-crit-01`,
staging `edf400b4`, `inspect-perguntas.mjs`):

| Cenário | 29/07 (só prompt) | 30/07 (com o gate T8) |
|---|---|---|
| `custo-evitado-puro` | ❌ `[1.4]` gravada **pela metade** (só `**Ponteiro movido:** custo externo`, sem o "onde verificar") nas 2 rodadas | ✅ `[1.3]` **e** `[1.4]` completas — ponteiro (custo externo do contrato) **+** onde conferir (histórico de cancelamento/faturamento + Portal) |
| `receita-pura` | ❌ `[1.3]` **ausente**; `[1.4]` ausente numa das rodadas | ✅ `[1.3]` **e** `[1.4]` presentes |

Mais: **0 repetição** de pergunta de ponteiro/fonte · **2,5 perguntas/submissão** (baseline de prod **6,4**)
— as seções novas **não engordaram o funil**. E o comportamento 3 (o mais importante) se manteve: no
`receita-pura` o agente **registrou a ausência da fonte em vez de inventar uma** — _"O briefing não informou
relatório, painel, sistema ou base específica para conferência desse número"_ → vira **zona cinzenta**, nunca
reprovação automática. ⚠️ **A decisão do PREFIXO se provou load-bearing**: o agente gravou o título como
`### Ponteiro movido e conferência` (não o título exato) — com casamento por título exato o gate teria lido
`null` e reperguntado à toa. **Não "corrigir" o prefixo.**

**Também verificado nesta sessão:** (a) a staging roda **exatamente** `staging/criterios-coautor` — o entry
`index-CLeuBaiL.js` do `/index.html` ao vivo bate com o `dist/` local (é assim que se confere qual branch
está no ar, ver a armadilha do deploy que apagou a Etapa 2); (b) **761 testes verdes** na branch de
integração, que já contém **todo** o `origin/main` (`ad64895`) — é superset limpo para prod; (c) as 3 colunas
do critério (`Classificação` · `Motivo Reprovado` · `Motivo Reenvio`) **existem no cabeçalho das DUAS abas**,
`STAGING` **e** `GoDocs` — o pré-requisito de prod está cumprido (mapeamento é por nome; nome errado é
ignorado com aviso silencioso).

**2 buracos do harness E2E corrigidos** (commitados na branch de integração) — os dois faziam o teste medir a
coisa errada: **(1)** o `metaPadrao` **nunca enviava** `contrafactual_afetados`/`contrafactual_reclamacao`, as
perguntas-chave da Etapa 2 — sem elas o agente roda **cego ao contrafactual**, exatamente o cenário que o
roteiro manda não medir (é `buildRespostasFormulario` que as entrega aos 4 prompts); **(2)** **nenhum cenário
cobria `claro_nao`** — o único caminho que grava **"Reprovado"** na planilha e o que mais precisa de
validação, porque o autor vê. Criado o cenário **`criterio-claro-nao`** (nuvem de palavras: rodou 1×, sem
recorrência, ninguém reclama, materialidade minúscula de propósito — acima de R$5k/mês o invariante de
`normalizarClassificacao` rebaixa para zona cinzenta e o teste não provaria nada).

⚠️ **O lado do ANALISADOR (item 2 do pedido) segue SEM validação** — pelo mesmo motivo de 29/07, não por bug
do código novo: a análise morre no `waitUntil` (timeout de 25s do proxy → fallback OpenAI → *tasks
cancelled*) e o cron de 1 min **não dispara na staging**. A rota de destrave existe
(`POST /api/admin/reanalisar-pendentes`, `requireAdmin`, idempotente) e **foi chamada**, mas devolveu **500 por
cota do Google Sheets** (`ReadRequestsPerMinutePerUser`, 60/min — estourada pelas minhas próprias leituras da
planilha + o run). **É transitório: esperar ~1 min e repetir.** A causa-raiz do `waitUntil` continua aberta
(decisão do Luis entre aterrissar a análise no request do submit ou disparar do front em lotes).

⚠️ **Divergência de escopo registrada:** o pedido do Luis listou **3** perguntas para o **formulário**
("que processo mudou e quanto" · "moveu ponteiro de custo/receita/KPI" · "se desligar hoje quem reclama").
Pela decisão de **29/07** só o **contrafactual** ficou na Etapa 2 ("quem reclama" + "o que piora"); as outras
duas são conduzidas pelo **agente** no chat e é isso que o gate T8 cobre — foi assim que validei. Se o Luis
quiser as três **no form**, é mudança nova e precisa ser dita **antes** do deploy de prod.

_(Antes desta:)_ **2026-07-30 (código, avulsa — fora do plano ativo)** — pedido direto do Luis:
**Coautor único por projeto**. Cada projeto tem **1 autor** (o submissor/dono, que não escolhe papel) e
**no máximo 1 Coautor** (`coexecutor`); Participante e Contribuidor seguem **sem limite**. Implementação
**100% cliente** (nada de schema, sync ou colunas do Sheets — `derivarColunasPapeis` continua aceitando
lista por causa dos legados): helpers puros `PAPEL_COAUTOR`/`coautoresSelecionados()`/`limitarCoautorUnico()`
em `src/lib/submeter/constants.ts`; `validarEtapa1` bloqueia 2+ Coautores nos dois modos (submissão nova e
edição); no seletor (`ParticipantesPapeisInput`) a opção **Coautor SAI da lista** dos demais quando alguém já
a tem (`papeisDisponiveis` — a 1ª versão mostrava a opção *desabilitada* com "(já definido)" e o **Luis pediu
para removê-la da view**); nota informativa abaixo do campo explica a ausência; o **seed da edição**
(`applySeed`, `submeter.tsx`) aplica `limitarCoautorUnico` — legado importado do Sheets pode trazer vários
e-mails na coluna "Participantes", então mantém o 1º e **limpa o papel dos demais** para o usuário
reclassificar (em vez de travar a edição num estado que ele não criou). Branch **`feat/coautor-unico`**
(`da91207` + `0ff9f6b`, sobre `main` `ad64895`), 8 testes novos em `tests/validacao-etapa1.test.ts`,
**667 verdes**; `CLAUDE.md` + `spec-docs/SPEC_FEATURES_NOVAS.md` atualizados. **✅ VALIDADO pelo Luis no
staging.** ⚠️ **Armadilha real desta sessão, que não pode repetir:** o **staging estava rodando a branch
NÃO-mergeada `feat/criterios-projeto-classificacao`** (as perguntas-chave da Etapa 2), e o primeiro deploy —
buildado de `origin/main` — **apagou aquelas perguntas da tela** (o `updateApp` substitui a app INTEIRA).
Corrigido com a branch de integração **`staging/criterios-coautor`** (= `feat/criterios-projeto-classificacao`
+ merge do coautor; conflito só em duas linhas de `import`), **761 testes verdes**, `build` + `build:worker`
OK, **staging redeployado** com as duas frentes. **Prod (`674a3710`) NÃO foi tocado em nenhum momento.**
**Regra que vale daqui pra frente: antes de deployar no staging, descobrir QUAL branch está no ar e mergear a
sua sobre ela.**

_(Antes desta:)_ **Última sessão:** 2026-07-29 (planejamento) — nova frente, pedida pelo Luis: **apertar o critério de
projeto** (o pedido do Rafa, caso da **nuvem de palavras**). Plano ✅ **aprovado** em
[`docs/plans/criterios-projeto-classificacao.md`](plans/criterios-projeto-classificacao.md). Escopo: (a) **2
perguntas determinísticas na Etapa 2** — "moveu sensivelmente o ponteiro de custo/receita/KPI?" + "onde isso
pode ser verificado?" (rastreabilidade, que hoje **não existe** em lugar nenhum) e "se desligar hoje, quem
reclama e o que piora?" (contrafactual); (b) **"que processo mudou e quanto?"** vira seção obrigatória do
`MEMORIAL_ESQUELETO`, perguntada pelo **agente** só quando a doc não traz a magnitude; (c) o **analisador
classifica** em **claro sim / claro não / zona cinzenta**, **sempre** explicando o porquê, com
`normalizarClassificacao()` puro (nunca reprova sem motivo; especial nunca reprova automático; >R$5k → zona
cinzenta); (d) `claro não` grava **`Reprovado`** na coluna Status — **única exceção** à regra TEMPORÁRIA do
"Pendente", que continua valendo para todo o resto; (e) 3 colunas **já criadas pelo Luis** na planilha
(`Classificação` sempre preenchida · `Motivo Reprovado` · `Motivo Reenvio`, esta **só humana**); (f) modal de
triagem do `/dashboard` grava os motivos em coluna própria, **sem tocar em `Observações`** (que o disparo de
e-mails usa). **Barrar submissão continua FORA em definitivo** — a reprovação é pós-envio, no analisador.
Achado que economiza trabalho: **`Reprovado` já existe** em `STATUS_GRAVAVEIS` e no `StatusBadge` (PR #214), e
**`usa_ai_proxy` é o padrão exato a clonar** para as perguntas novas da Etapa 2. **Nenhum código alterado.**

_(Antes desta:)_ **2026-07-28 (código)** — **`/dashboard` do admin virou a tela de triagem sobre a PLANILHA**,
branch `feat/dashboard-admin-sheets`, commit `5ef927a`. A tela lia o **SQLite** (`getProjetos` →
`getProjetosWithArea`) e por isso mostrava **rascunho** e um **status que não é fonte de verdade** (o sync
reverso exclui `status` de propósito). Agora lê `readAllRows()`. Entregue: busca instantânea
(projeto/autor/e-mail/ID/área, sem acento, tokens em AND, atalho `/`), **filas de status com contagem ao
vivo**, ordenação, paginação 25/50/100, **ficha em overlay** com a linha inteira agrupada (coluna
desconhecida cai em "Outras colunas") e **mudança de status gravando no Sheets** + auditoria
`admin_status_log`. **620 testes verdes** (29 novos), `build` + `build:worker` OK, `worker.js` recomitado,
spec `spec-docs/SPEC_DASHBOARD_ADMIN.md` (D1–D8) + `CLAUDE.md`/`docs/` atualizados. Também **removido o
aviso do BUG ABERTO de edição de legado** do `CLAUDE.md` — o Luis confirmou que já foi resolvido.

_(Antes desta: 2026-07-22/23 — `aceitar-zip-submissao` executada, mergeada (PR #213) e em prod.)_

**Última sessão (2026-07-28, planejamento):** nova frente — **as perguntas do agente**. O pedido original
era um "agente porteiro" que barrasse submissões fora de critério (caso da **nuvem de palavras**); foi
**descartado** na conversa do Luis com o Rafa: os critérios ainda não estão fechados, e barrar sem critério
troca um problema por um pior. O alvo virou **cortar a redundância das perguntas** e embutir os 3 critérios
do Rafa (recorrência · contrafactual · rastreabilidade) nas perguntas que já existem. O **T1 foi executado
nesta sessão** (o Luis liberou o `E2E_COOKIE`): **24 conversas reais de prod** medidas em
[`analise-perguntas-agente.md`](analise-perguntas-agente.md) — **154 perguntas / 6,4 por submissão**, 62% na
fase saving, **34% vindas dos 4 gates**, 13 perguntas **depois** do preview. Dois achados que a leitura de
código não pegava: **A1** — o gate da alocação **só aceita "mais saída" e rejeita "menos custo"** (caso
`e57b287a`: usuário informou **redução de 3 auxiliares** → 5 reperguntas; `60b97477`: **corte de hora
extra** → 4), com o juiz do preview mandando recusar _"mesmo que o usuário diga aprovado"_ **sem contador
anti-loop**; **A2** — os gates **ignoram materialidade** (`897df986` economiza **0,05h/mês** e recebe o gate
das 220h/fim de semana), contra a regra que o próprio prompt já tem. **Nenhum código alterado.**

**Última sessão (2026-07-28, operação + planejamento):** fechou o **T8 do dashboard** e abriu a frente dos
**loadings**. (a) `feat/dashboard-admin-sheets` deployada no **staging `edf400b4`**, validada no navegador pelo
Luis e depois em **prod `674a3710`** — mesmos artefatos/hashes nos dois; branch no remoto (`990250e`); **o PR
não foi aberto** porque o `gh pr create` é bloqueado pelo classificador de permissões local (corpo pronto,
conta `gh` em `LuisEduardo100`). (b) **Admin concedido via secret `ADMIN_EMAILS`** (rotaciona sem redeploy):
`bruno.bezerra@gocase.com` em prod **e** staging, `luiza.rios@gocase.com` em prod; `.env` sincronizado.
⚠️ Registrado que **admin não é granular** — dá acesso a TODAS as telas do grupo `_authenticated`
(dashboard, investigador, email-legados, areas, usuarios, testes) + override de edição. (c) O relato "**só 1
descontinuado**" **não era bug**: a tela lê 100% do Sheets. Medido via Service Account — aba **GoDocs**
478 Aprovado / 40 Pendente / 15 Reenvio Pendente / **11 Descontinuado** (544 linhas com ID); aba **STAGING**
287 / 32 / 23 / **1** (343 linhas), ou seja a staging é uma **cópia antiga**. De quebra: a coluna "Status"
está em **posições diferentes** nas duas abas (índice 29 vs 30) e o mapeamento por nome absorveu.
⚠️ **Dado novo para a decisão do dropdown:** `Reprovado` e `Em validação` **não existem em nenhuma das 887
linhas** — os 4 valores reais são Aprovado · Pendente · Reenvio Pendente · Descontinuado. (d) Planejada e
**aprovada** a frente dos loadings (ver Plano ativo). **Nenhum código alterado nesta sessão.**

## Plano ativo
**Nenhum plano ativo.** O último — [taxonomia-destino-ganho-e-anti-loop](plans/taxonomia-destino-ganho-e-anti-loop.md)
— está **✅ executado** (T1–T7, prod deployado, PR #217). O próximo passo é **mergear #217/#218** e depois
**planejar** a fatia escolhida (A2 · auto-preenchimento da Seção 2.4 · piso `respostaAlocacaoVaga`) com
`/ggsd:plan`. Referência do que a A1 entregou:

Implementa a fatia **A1** da frente
[perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md) (T3): constante
única `TAXONOMIA_DESTINO_GANHO` (5 destinos — mais entrega · **menos custo** · menos erro/retrabalho · menos
risco/fraude · menos prazo) consumida pelos **3** textos que hoje exigem o par _"nomeado **E** entregar A
MAIS"_, + **anti-loop determinístico** no juiz do preview (o bloco sai do prompt quando
`saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`).

⚠️ **A jornada preguiçosa saiu do escopo** — decisão do Luis nesta sessão: o gate da jornada **fica como
está**, mesmo com o diagnóstico de que a resposta é inerte em 15 de 24 conversas (ela só define o `cap` do
gate do teto). Reavaliar **depois** de re-medir o baseline pós-#216. Os itens estruturais (registro de "já
respondido", orçamento de perguntas, fusão dos 4 gates, T4) seguem para depois da re-medição.

Os dois planos da frente do critério estão **concluídos e em produção**
(`calibragem-regua-criterio-e-resync-append` + `criterios-projeto-classificacao`, PR #216 mergeado,
`main` `39deaf9`). O que sobrou dela é **humano**: avisar o Rafa e **calibrar a régua com ele** usando casos
reais — reprovar projeto é visível ao autor (D10).

Frentes candidatas à próxima sessão, nenhuma planejada ainda (entram por `/ggsd:plan`):
- **causa-raiz do analisador morrendo no `waitUntil`** — hoje mitigado pelo cron de 1 min em prod
  (`reanalisar-pendentes`, conferido ativo e 200), que em troca **pressiona a cota do Sheets** (60 leituras/min
  compartilhadas com a staging). Caminho quente de submissão: não mexer sem plano;
- **poda do `CLAUDE.md`** (~48k chars, teto 40k);
- **repovoar a aba `STAGING` com dado sintético** (ela recebeu cópia de dados reais de prod).

**Plano anterior (a frente que este destrava)**
**→ [docs/plans/criterios-projeto-classificacao.md](plans/criterios-projeto-classificacao.md)** ·
Status: ✅ aprovado (Luis, 2026-07-29) e **CODADO** na branch `feat/criterios-projeto-classificacao`
(T1–T8, até `9ce9b09`/`28cdb01`) — **no staging, ainda NÃO validado pelo Luis nem em prod**; era essa branch
que estava no ar quando o deploy de 30/07 a sobrescreveu (ver "Última sessão").
Critério de projeto: perguntas-chave na Etapa 2 + classificação em 3 níveis no analisador + reprovação com
motivo nas colunas novas. **Barrar submissão segue FORA em definitivo** (a reprovação é pós-envio).

**⚠️ Frente PARALELA, não sobrescrita — [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** ·
Status: ✅ **aprovado (Luis, 2026-07-28)**, T1 executado, **ainda pendente de código**: **A1** (o gate da
alocação precisa aceitar "menos custo", não só "mais saída" — + anti-loop no juiz do preview) · **A2**
(materialidade nos gates) · **T4** (fluxo de coleta). Coexiste com o plano ativo (ADR-026) e é **adjacente**:
a taxonomia de impacto escrita no T3 do plano ativo deve ser reaproveitável pelo A1. O **T2** (régua do Rafa)
foi **absorvido** pelo T7 do plano ativo — não fazer duas vezes.

_[loadings-dashboard-admin](plans/loadings-dashboard-admin.md) saiu de ativo: **✅ CONCLUÍDO** — T1–T5 no commit
`3b93c65` e o **T6 fechado em 2026-07-28**: staging validada → **prod `674a3710`** → **PR #215 mergeado**
(`main` = `ad64895`). Nada pendente nessa frente._

### Sessão de código 2026-07-28 (loadings do /dashboard) — o que ficou
Codados T1–T5: **SWR** em `lerPlanilha` (cache vencido volta na hora + revalidação em `runBackground`,
single-flight preservado, `revalidando` no payload) · **auth em `sessionStorage`** (`src/lib/auth-cache.ts`,
TTL 5 min, revalidação em background) · **prefetch** da planilha em paralelo ao `/api/auth/me`
(`src/lib/dashboard-prefetch.ts`) · **skeleton** (`components/dashboard/skeleton-linhas.tsx`) com filas
visíveis e chip "Atualizando em segundo plano". **658 testes verdes** (+38), `worker.js` recomitado, spec
**D9/D10** + `CLAUDE.md` (gotchas 3 e 7).
O revisor de qualidade em contexto fresco pegou **1 ALTA já corrigida**: a correção da linha no cache era
apagada pela revalidação em voo → o status recém-decidido voltava atrás por até 60 s. Corrigido com patch
por projeto reaplicado nas leituras iniciadas antes da escrita + guarda de época/sequência; `?refresh=1`
não herda leitura em voo; `STALE_MAX_MS` (10× TTL) volta a bloquear se o Sheets falhar; prefetch com teto
de 15 s. Conformidade: `diverge-baixa` (nada fora das Fronteiras).
⚠️ **`CLAUDE.md` está em ~45k chars** (limite recomendado 40k, já estava 44,2k no `main`) — vale uma sessão
de enxugamento.

Melhorar os **loadings do `/dashboard`** (pedido do Luis em 2026-07-28, escopo escolhido por ele): SWR no
servidor · cache de auth em `sessionStorage` · leitura em paralelo com o auth · skeleton. **Cache em SQLite
ficou FORA por decisão dele** (não reintroduzir SQLite no caminho de leitura). Sai de um worktree sobre a
branch `feat/dashboard-admin-sheets` (os arquivos não existem no `main` ainda).

**⚠️ Frente PARALELA, não sobrescrita —
[perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** · Status:
✅ **aprovado (Luis, 2026-07-28)** — T1 já executado; **pronto para `/ggsd:code`**. Escopo ampliado por ele
no fim da sessão: além das perguntas, entra o **fluxo de coleta** (T4 — onde cada informação deve ser
colhida: formulário × conversa × já sabido), e **barrar submissão está FORA em definitivo** (se voltar,
exige plano próprio). Ordem de ataque: **A1** (taxonomia de impacto + anti-loop no juiz do preview) e **A2**
(materialidade nos gates) primeiro — não dependem da régua do Rafa; **T2** (régua) em paralelo, para ele levar. Não é bloqueada por este plano nem o
bloqueia — as duas coexistem (ADR-026). **A fase de código recusa executar qualquer plano em rascunho** (RF-03).

_(Antes desta:)_ **Nenhum plano `aprovado` pendente de código.** [`dashboard-admin-sheets`](plans/dashboard-admin-sheets.md)
está **✅ executado** (T1–T7). **Falta o T8, que não é código:** deploy no **STAGING `edf400b4`** → validar
no navegador → **PROD `674a3710`** → PR (regras 13 e 10). Nova frente de código → `/ggsd:plan` primeiro.

_(Executados recentes: [aceitar-zip-submissao](plans/aceitar-zip-submissao.md) ✅ mergeado+prod;
[ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ mergeado (PR #210);
[edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md) ✅ executado — resta a validação T5,
ver pré-req das colunas abaixo.)_

## Próximo passo (setado)
**→ Codar o plano aprovado com `/ggsd:code`: T1–T3 (calibrar a régua do `claro_nao`, só prompt) e
T4–T5 (`resyncGoogle` recupera linha ausente por append), na branch `staging/criterios-coautor`.**

```bash
cd .claude/worktrees/staging-criterios-coautor   # a branch que está NO AR na staging
# T1-T3: src/lib/agents/analyzer.ts (régua) · T4: src/lib/google/sheets.ts · T5: src/lib/google/sync.ts
npm run test && npm run build && npm run build:worker   # + comitar worker.js (regra 1)
```
**Depois, na ordem:** (1) **T6 — deploy no staging `edf400b4`** e re-rodar o cenário, esperando agora
**Status "Reprovado" · Classificação "Claro não…" · Motivo Reprovado preenchido**:
```bash
E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING \
  E2E_ONLY=criterio-claro-nao npm run e2e:run -- stg-crit-06
curl -H "Cookie: $E2E_COOKIE" \
  https://godocs-staging.devgogroup.com/api/admin/dashboard/projetos/<ID>   # a linha INTEIRA
```
⚠️ **NÃO use o `read-criterio.mjs`** do scratchpad — ele lê a planilha de **PROD** (a staging tem
`GOOGLE_SHEETS_ID` próprio). Analisador não gravou (waitUntil)? `POST /api/admin/reanalisar-pendentes`
(~38s, não estoura mais a cota). (2) **limpar os runs** — `npm run e2e:cleanup -- stg-crit-05` (e `01`/`02`/
`03`, e o `04` que ficou parcial de um run abortado), **planilha ANTES do SQLite**, senão o sync reverso
ressuscita. (3) **prod `674a3710`** (`getUploadToken` novo — `uploadId` é **single-use** — e o script recebe
o **TOKEN**, não a URL). (4) **PR** via `/ggsd:ship` (conta `gh` em `LuisEduardo100`).
⚠️ **Avisar o Rafa logo após o deploy:** reprovar projeto é **visível ao autor** (D10), e a régua vai ao ar
recém-calibrada, sem rodada de calibração com ele.

### _(Passos da sessão anterior — o que sobrou deles)_
**Fechar a validação do critério e levar as DUAS frentes a produção** (o Luis respondeu a pergunta que estava
aberta: quer **prod recebendo todas as mudanças**, depois de validar o critério por E2E na staging). O lado do
**agente já está validado** (tabela no topo). Falta, nesta ordem:

1. **Terminar o run `stg-crit-02`** (`receita-pura` + `custo-evitado-puro`) — ficou **em voo** no fim da
   sessão, preso num vai-e-vem longo da fase **doc** do `receita-pura` (o respondedor do E2E responde "não
   está no briefing" e o agente repergunta; pode bater no `MAX_TURNS`). Log em
   `.../scratchpad/e2e-stg-crit-02.log`. ⚠️ **Não é bloqueio da validação** — o `stg-crit-01` já cobriu os
   dois cenários com sucesso; se o `stg-crit-02` estourar turnos, isso é achado do **respondedor**, não do
   produto.
2. **Rodar o run 2 com os campos novos** (o harness já foi corrigido e commitado):
   `E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING
   E2E_ONLY=criterio-claro-nao,receita-pura npm run e2e:run -- stg-crit-03` — este é o que valida o
   **item 2 do pedido** (classificação em 3) e o caminho **`claro_nao` → "Reprovado" + Motivo Reprovado**.
3. **Destravar o analisador:** esperar ~1 min (cota do Sheets) e repetir
   `POST /api/admin/reanalisar-pendentes`; depois ler `Classificação`/`Motivo Reprovado`/`Status` na aba
   `STAGING` (script pronto em `.../scratchpad/read-criterio.mjs`).
4. **Limpar** os projetos de teste: `npm run e2e:cleanup -- stg-crit-01` (e `stg-crit-02`/`stg-crit-03`)
   — **planilha ANTES do SQLite**, senão o sync reverso ressuscita.
5. **Prod `674a3710`** com a branch de integração `staging/criterios-coautor` (já é superset do `main`):
   `npm run test && npm run build && npm run build:worker` → `scripts/deploy-godeploy.sh <TOKEN>` → `updateApp`.
   ⚠️ `getUploadToken` novo (o `uploadId` é single-use) e o script recebe o **TOKEN**, não a URL.
6. **PR** via `/ggsd:ship` (conta `gh` em `LuisEduardo100`).

⚠️ **Antes do passo 5, ver a divergência de escopo das 3 perguntas do formulário** registrada no bloco da
última sessão — se o Luis quiser as três **no form** (e não duas no agente), isso muda o que vai a prod.
⚠️ **Gate humano ainda de pé:** a régua do Rafa (T7) **deve ser calibrada com ele antes do deploy em
produção** — reprovar projeto é visível ao autor.

_(Resolvido — era o "PRIMEIRO" desta seção:)_ o staging hoje carrega **duas** frentes
(Coautor único, já validado + critério de projeto, ainda **não** validado por ele). Decidir com ele:
**(1)** subir a prod **só o Coautor único** (`feat/coautor-unico` rebaseada no `main`) e abrir o PR dela,
deixando o critério de projeto só no staging; ou **(2)** esperar a validação do critério de projeto e subir as
duas juntas. **Não subir prod antes dessa resposta.** Quando vier, o caminho do Coautor é: rebase no `main`
→ `npm run test && build && build:worker` → **deploy prod `674a3710`** → `/ggsd:ship` (PR).
⚠️ Ao deployar staging de novo, cheque antes qual branch está no ar (foi o erro desta sessão) e use uma branch
de integração; worktrees vivos: `.claude/worktrees/coautor-unico` e `.claude/worktrees/staging-criterios-coautor`
(este com `node_modules` por **symlink** para o outro).

**DEPOIS — Executar o plano [criterios-projeto-classificacao](plans/criterios-projeto-classificacao.md)** com
`/ggsd:code`, T1 → T7. Worktree novo a partir de **`origin/main` (`ad64895`)** — a branch atual
`docs/plano-loadings-dashboard-admin` é **só de docs e está ATRÁS do main** (o `/dashboard` de triagem e o
`dashboard-admin.functions.ts` **não existem** nela; só no `main`).

**Antes de escrever a primeira linha, nesta ordem:**
1. **Conferir a grafia exata** dos 3 cabeçalhos novos (`Classificação`, `Motivo Reprovado`, `Motivo Reenvio`)
   nas abas **`GoDocs`** e **`STAGING`** — o Luis já criou as colunas, mas o mapeamento é **por nome** e um
   acento diferente faz a coluna ser **ignorada com aviso**, silenciosamente. As duas abas já divergem em
   posição de coluna.
2. Ler o plano ativo inteiro + a seção **"Decisões fechadas que NÃO podem ser corrigidas por engano"**
   (`spec-docs/`, regra 12).
3. Invocar a skill **`frontend-design`** antes da UI da Etapa 2 e do modal de triagem (regra 11).

**Ordem sugerida de execução:** T4 (colunas/sync — desbloqueia a verificação) → T1 (Etapa 2) → T3 (analisador
+ `normalizarClassificacao`) → T2 (memorial/agente) → T5 (`/dashboard`) → T6 (motivo visível ao autor — **é
julgamento do Claude, confirmar com o Luis se mantém**) → T7 (régua de 1 página pro Rafa).

**2 pontos de atenção que o Luis já conhece e não devem ser "corrigidos" por engano:**
- **Não** encerrar a regra TEMPORÁRIA do `Pendente` (decisão D1: a única exceção é `claro_nao → Reprovado`).
- **Não** mexer no `CHECK` de `projetos.status` (exigiria rebuild da tabela); o discriminador da reprovação é a
  coluna nova `classificacao_avaliacao`.
- ⚠️ A régua do Rafa tinha **gate humano** no plano de 28/07 ("nenhum código encosta na régua antes do OK
  dele"). O Luis mandou codar; a régua sai no mesmo PR (T7) e **deve ser calibrada com o Rafa antes do deploy
  em produção** — reprovar projeto é visível ao autor.

✅ **T6 dos loadings encerrado em 2026-07-28:** branch já estava 0 atrás do `origin/main`; 658 testes + `build`
+ `build:worker` verdes (`worker.js` inalterado); **staging `edf400b4`** validada no navegador pelo Luis;
**prod `674a3710`** com os mesmos artefatos (`index-D76hNGpt.js` conferido no `index.html` de prod via
`E2E_COOKIE`); **PR #215 mergeado** → `main` = `ad64895`, espelhando prod.
⚠️ Gotchas do deploy que custaram tempo: `scripts/deploy-godeploy.sh` recebe o **TOKEN** como 1º argumento (URL
com `?token=` → **401**) e o `uploadId` é **single-use** (novo `getUploadToken` entre staging e prod).
Nesta sessão `gh pr create`/`gh pr merge` **funcionaram** — o bloqueio local do classificador não se repetiu.

⚠️ **PR #214 (dashboard de triagem) foi MERGEADO** no `main` (`e878bc1`) nesta sessão; o worktree
`dashboard-admin-sheets` e a branch local foram removidos.
