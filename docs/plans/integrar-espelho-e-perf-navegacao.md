# Plano — Integrar o espelho da planilha com a perf de navegação (e fechar a T12)

**Status:** ✅ **executado — EM PRODUÇÃO (13/08, prod `674a3710`, deploy 11:40:17 UTC)** — T1–T8 entregues; **T9 (push + PR) ABERTA** e a branch segue **local**.
Aprovado por Luis em 2026-08-12. ⚠️ **Ressalva de processo:** a Fronteira "não deployar prod antes da validação humana da T7" **não foi cumprida na ordem** — o Luis deu o go explícito ("go") e o deploy saiu antes de uma T7 formal; a validação de fato foi ele usando o `/dashboard` às 11:49 (2 requests `ok`).

> ### Registro de execução (13/08, sessão do deploy em prod)
> **`origin/main` reincorporado ANTES do build** (merge **`fa5ef97`**): o `main` havia andado **7 commits**
> (#256/#257/#258) e um deles é o **revert do #255** — que estava DENTRO da nossa branch (foi à staging na
> v151). Buildar antes do merge teria levado a prod uma mensagem que o Kaique já desfez. **1428 testes / 97
> arquivos** verdes · `worker.js` **1.010,7 kb** · `grep` de sanidade no bundle: `sheet_espelho` presente e
> **`buildUpdateMessage` ausente** (o merge não ressuscitou a notificação duplicada do D30).
>
> **Pareamento provado por grafo, não por memória:** `rev-list --count HEAD..origin/main` = **0** e
> `merge-base --is-ancestor origin/perf/navegacao-chunks-e-swr HEAD` = SIM (ponta `896c26a`, 12/08 14:49).
> ⚠️ Uma contagem minha anterior sugeriu "1 commit do Kaique faltando" — **era erro de contagem**, nada falta.
>
> **T6 FECHADA (verde):** a staging acumulou **18 corridas** consecutivas com `espelhados=` e `erros=0`
> (19:10→20:35 de 12/08) — o `Durable Object storage operation exceeded timeout` das 19:05 era **transitório**,
> não defeito. ⚠️ E os logs mostraram que entre 10:50 e 11:30 de 13/08 a staging estava **sem** o espelho
> (mais um deploy alheio) — o redeploy desta sessão o restaurou, com prova de runtime às **11:35**.
>
> **T8 (prod):** deploy 11:40:17 → cron trocado de `0 * * * *` para **`*/5`** (`mzsxhqmsj19r` criado ANTES de
> remover o horário `nd2c170ykcg8`, para não abrir janela sem sync). **Cold start OK:** 11:45
> `total=626 espelhados=382 erros=0` e 11:50 `total=626 espelhados=0 erros=0` (regime) — **sem timeout de DO**
> com 626 linhas, 48 mais que a staging. ⚠️ O `382 < 626` da 1ª corrida não foi explicado pelos logs (linhas
> sem "ID Projeto" são puladas em silêncio por `if (!id) continue`, ou parte já viera de um sync de cura); o
> que **prova completude** é a corrida seguinte escrever **0** — toda linha com ID bate hash.
>
> **⚠️ Ordem que virou régua:** o cron `*/5` vai **DEPOIS** do deploy. Antes, o sync ANTIGO (23–27 s, com o
> N+1) rodaria 12× mais e pressionaria a cota de 60 leituras/min compartilhada com prod, **sem** popular
> espelho nenhum.

> ### Registro de execução (12/08, sessão da integração)
> **Branch:** `feat/espelho-e-perf-navegacao` (worktree `.claude/worktrees/espelho-e-perf`), criada de
> `origin/main` `d0652a4` → merge da perf do Kaique (**limpo**) → merge do espelho (**8 conflitos**, todos
> resolvidos, merge commit **`8d14c02`**). ⚠️ **A branch NUNCA foi pushada.**
>
> **Verificações (T1–T4):** **1346 testes / 94 arquivos** verdes (baseline `main` = 1258/91) · `tsc` com os
> **MESMOS 5** erros da baseline, **0 novos** · `worker.js` regenerado (**995,9 kb**) e commitado ·
> **0 commits** do Kaique, do espelho e do `main` fora da branch · no artefato: `vendor-icons-CcRl8KEQ.js`
> no `dist/` (dele) e `sheet_espelho` no `worker.js` (nosso).
>
> **4 resoluções que valem memória:**
> 1. ⚠️ **O espelho importava `buildUpdateMessage`, que o D30 REMOVEU horas antes** — aceitar o lado do
>    espelho no `sync.ts` ressuscitaria a notificação duplicada que o PR #248 acabou de matar. Ficou a
>    versão do `main` + o import de `espelharEscrita`.
> 2. `listarMeusProjetos` lê o **espelho**, mas `contarPendentes({sync:true})` **mantém** o cache de 60 s do
>    Kaique — é o **único caminho de request que ainda lê o Sheets** (o selo da home precisa de legado que
>    só existe na planilha e que não está no espelho deste dono até o cron rodar).
> 3. Um comentário virou **falso** no merge (`"mesmo cache da listagem"`) e foi reescrito — mesma classe de
>    defeito que o revisor pegou no `d7447eb`.
> 4. Artefato real do merge: `tests/sync-reverse.test.ts` usava `beforeEach` **sem importar** (pego pelo
>    `tsc`, não pelos testes).
>
> **T5:** staging `edf400b4` no ar em **19:00:17 UTC** (guarda cumprida: a version ainda era **146** logo
> antes de subir → ninguém deployou no meio, o merge seguia válido).
>
> ⛔ **T6 — o que FALTA e é o próximo gesto:** o cron `*/5` já existe e está `enabled`, mas as corridas de
> **18:55 e 19:00** levaram **23,2 s / 24,0 s** e logaram `total=578 … ignorados=578` **SEM o campo
> `espelhados=`** → é o código **ANTIGO** (a de 19:00 começou 16 s antes do deploy pousar). **O sinal a
> exigir na corrida das 19:05+:** o campo **`espelhados=`** no log **E** a duração caindo de ~24 s para
> **~1,3 s**. Sem esse sinal, suspeite do bug conhecido deste repo (deploy que mantém o **worker antigo**
> com assets novos) e **redeploye** — nunca conclua pelo `getApp`.

**Objetivo:** juntar numa única branch o **espelho da planilha no SQLite**
([sqlite-fonte-de-leitura](sqlite-fonte-de-leitura.md), executado mas **nunca pushado**) e a **perf de
navegação do Kaique** (`origin/perf/navegacao-chunks-e-swr`), sobre o `origin/main` atual, e levar o
resultado a **staging → validação → prod** — fechando a **T12** do plano do espelho.

## Por que esta fatia existe (o problema que ela resolve não é técnico)

Os dois trabalhos atacavam a **mesma dor** (a leitura do Sheets em tempo de request) por caminhos
diferentes, e **nenhum dos dois estava no `main`**:

- O espelho existia só em **7 commits locais** nesta máquina — não havia branch remota. Quando o Luis
  pediu ao Kaique para puxar da `main`, ele não recebeu nada: estava **correto**, não era falha dele.
- A perf do Kaique foi **deployada na staging** (version 146, 12/08 17:47 UTC) e a branch só apareceu no
  remoto às **14:49 (-03)**.
- Como o `updateApp` **substitui a app INTEIRA**, cada deploy apagava o trabalho do outro: o deploy do
  espelho (v141) tirou a perf dele do ar, e o dele (v146) tirou o espelho. **Nada foi perdido no git —
  mas o ar era sempre de um só.**

⚠️ **Invariante desta fatia:** o build que sobe **contém os dois trabalhos**. É isso — e não uma promessa
de cuidado — que impede o deploy de atrasar o Kaique.

## A sobreposição, medida (não presumida)

Investigação feita antes deste plano, lendo os dois diffs:

| Peça do `perf/navegacao-chunks-e-swr` | Destino | Razão |
|---|---|---|
| `vite.config.ts` — `vendor-icons` + `experimentalMinChunkSize` (49→19 assets) | **fica** | Ortogonal ao espelho (bundle) |
| `router.tsx` — `defaultPreload:'intent'` + `defaultPreloadDelay:150` | **fica** | Ortogonal |
| `_authenticated/route.tsx` — guard `!preload` + `preload={false}` no Dashboard | **fica** | Ainda evita request no hover |
| `meus-projetos-cache.ts` (60 s, single-flight, SWR) + `leituraOk` | **fica** | Ver abaixo — **continua útil** |
| Invalidações (`submeterParaValidacao`, `descontinuarProjeto`) | **fica** | Alimentam o mesmo caminho |
| A chamada `lerLinhasDoDono` **dentro de `listarMeusProjetos`** | **sai** | Ali o espelho troca a planilha por SQLite |

**O achado que mudou a decisão:** o espelho **não** remove a leitura do Sheets de todo lugar — ele deixa
`contarPendentes({sync:true})` (o selo da home) chamando `syncOwnerRowsFromSheet` de verdade. O cache dele
**segue cobrindo esse caminho**, então descartá-lo seria perder trabalho útil. A colisão real é de **uma
linha**.

⚠️ O `leituraOk` **não é decorativo**: `syncOwnerRowsFromSheet` devolve `rows: []` tanto para "a planilha
não respondeu" quanto para "este usuário não tem projeto", e cachear o primeiro caso apagaria a coluna
Status de todo mundo por um minuto. Manter.

## Tarefas

- **T1 — Resolver os 4 conflitos de CÓDIGO** no worktree `.claude/worktrees/espelho-e-perf`
  (merge já feito: `origin/main` ← perf ← espelho).
  - `src/lib/google/sync-reverse.ts`: estrutura do espelho (`lerPlanilhaComRetry`, `inicio`) **+** o campo
    aditivo `leituraOk` dele nos 3 pontos de retorno.
  - `src/lib/meus-projetos.functions.ts`: `listarMeusProjetos` lê o **espelho**; `contarPendentes` mantém
    `lerLinhasDoDono` (cache); invalidações preservadas.
  - `src/lib/google/sync.ts` e `src/lib/aprovacoes.functions.ts`: espelho × **D30** (que entrou no `main`
    hoje pelo PR #248) — preservar `notificarChat` obrigatório, `deveNotificarDecisao` e o `espelharEscrita`.
  - (guarda: `npx tsc --noEmit` sem erro novo — a baseline tem **5** pré-existentes em
    `chat.functions.ts:1756/3890` e `submeter.tsx:578/697/720`)
- **T2 — Resolver os 3 conflitos de DOC unindo os dois lados** (regra 7 do `CLAUDE.md`): `CLAUDE.md`,
  `docs/NEXT-SESSION.md`, `spec-docs/SPEC_FEATURES_NOVAS.md`. No `CLAUDE.md` o conflito é o bullet **"Sync
  sob demanda por dono"**, onde os dois lados dizem coisas **verdadeiras e complementares** (o espelho tirou
  a chamada da listagem; o cache cobre o que sobrou). (guarda:
  `grep -n '^<<<<<<<\|^=======\|^>>>>>>>' ` volta **vazio** em todos)
- **T3 — Regenerar o `worker.js`** (é **gerado**, nunca mergeado): `npm run build:worker` e commitar
  (regra 1). (guarda: rebuild num arquivo temporário dá **md5 idêntico** ao commitado)
- **T4 — Suíte verde**: `npm run test`. Baseline `main` = **1258**; a fatia soma os testes do espelho
  (`sheet-espelho`, `dashboard-espelho`, `meus-projetos-espelho`) e os dele
  (`meus-projetos-cache`), menos os 2 arquivos de SWR do dashboard que o espelho **remove de propósito**
  (`dashboard-swr.test.ts`, `dashboard-swr-escrita.test.ts`). (guarda: 0 falhas)
- **T5 — Build + deploy na STAGING (`edf400b4`)** pelo fluxo da regra 13/9: `npm run build` →
  `scripts/deploy-godeploy.sh` (lista de assets derivada do `dist/` REAL) → `updateApp`.
  (guarda: **conferir a version da staging imediatamente antes** — se ela mudou desde a v146, alguém
  deployou no meio e o merge tem de ser refeito **antes** de subir)
- **T6 — Cron de 5 min na staging**: garantir `*/5` para `POST /api/cron/sync-sheets-to-sqlite`
  (o espelho **só é fresco se o cron roda** — sem ele as telas mostram dado velho e a arquitetura mente).
  (guarda: `GET /api/admin/sync-status` + a linha "Planilha sincronizada às HH:MM" no `/dashboard`)
- **T7 — Validação do Luis na staging** (é a metade que falta da T12 do plano do espelho): abrir
  "Meus Projetos" e `/dashboard`, conferir que Status/motivos aparecem e medir a percepção de velocidade.
- **T8 — Prod (`674a3710`) + cron `*/5`**, só depois do OK da T7. (guarda: sinal de **RUNTIME** nos logs,
  não o `getApp` — o deploy do Godeploy já manteve worker antigo com assets novos neste repo)
- **T9 — PR e sincronização com o GitHub**: push da branch, PR para a `main`. ⚠️ A branch do Kaique
  entra **dentro** deste PR (o merge preserva os commits dele) — combinar com ele para não abrir 2 PRs
  sobre o mesmo trabalho.

## Critérios de aceitação

1. `listarMeusProjetos` e `/dashboard` **não fazem leitura do Sheets em request**; o Status vem do espelho.
2. `contarPendentes({sync:true})` **continua lendo a planilha**, agora com o cache de 60 s do Kaique.
3. As 3 peças de navegação dele (chunks, preload, os 2 guards do Dashboard) estão no build que sobe.
4. Nenhum marcador de conflito em arquivo nenhum; `worker.js` bate com o rebuild.
5. Suíte verde e `tsc` sem erro novo.
6. Staging validada por **runtime** (cron rodando, idade do espelho visível) antes de prod.
7. Nada do trabalho do Kaique sai do ar em nenhum dos dois deploys.

## Fronteiras (não exceder)

- **Não** mover `contarPendentes` para o espelho (seria trabalho novo, fora dos dois planos; fica como
  sugestão de follow-up).
- **Não** reintroduzir cache/SWR no `/dashboard` (o espelho o remove **de propósito** — ver o gotcha 3 do
  `SPEC_DASHBOARD_ADMIN`).
- **Não** mexer no `assetConfig`/`cache-control` dos assets (pendência de **plataforma**, registrada pelo
  Kaique no `docs/deploy.md`).
- **Não** deployar prod antes da validação humana da T7 (regra 13).
- **Não** apagar branches nem worktrees de terceiros.

## Blast-radius

**Arquivos:** 21 do espelho (`sheet-espelho.ts`, `dashboard-resumo.ts`, `client.server.ts`, `schema.ts`,
`sync-reverse.ts`, `sync.ts`, `dashboard-admin.functions.ts`, `meus-projetos.functions.ts`, `worker.ts`,
`dashboard.tsx` + testes) **+** 12 dele (`vite.config.ts`, `router.tsx`, `route.tsx`,
`meus-projetos-cache.ts`, `chat.functions.ts` + docs/testes).
**Dependentes:** as 2 telas de listagem, o selo da home, a triagem do `/dashboard`, o cron do sync reverso
e **toda escrita nossa no Sheets** (que agora precisa chamar `espelharEscrita`).
**Invariantes tocados:** o gotcha **(1)** e **(3)** do `SPEC_DASHBOARD_ADMIN` (a listagem é a linha da
planilha; o cache sai), os **3 invariantes do espelho** (espelhar toda escrita · patch sobrevive a sync que
começou antes · listagem nunca seleciona `linha`), a **regra 1** (`worker.js`), a **regra 9** (assets do
`dist/` real) e a **regra 13** (staging antes de prod).
**Confiança: MÉDIA-ALTA.** Alta na sobreposição (medida lendo os dois diffs, não inferida) e no escopo dos
conflitos (o merge já mostrou os 8). Menor em dois pontos: este repo **não tem** `docs/INDEX.md`,
`docs/invariants.md` nem `scripts/ctx-route.sh`, então o mapa de invariantes saiu do `CLAUDE.md` à mão; e a
**semântica de `rowsWritten`/`INSERT OR REPLACE` do `env.DB` em prod** só se observa em prod (o espelho já
carrega esse risco desde o plano original).

## Riscos e o que fazer

- **Deploy concorrente do Kaique** (o risco central): se ele subir a branch dele na staging/prod depois de
  mim, o espelho sai do ar de novo — e vice-versa. Mitigação: o build carrega os dois, a T5 confere a
  version **antes** de subir, e o PR da T9 põe tudo na `main` para que "deployar a `main`" pare de ser
  destrutivo. **A trava real é social**, não técnica: avisá-lo.
- **Cron não criado** = espelho velho servindo tela com cara de fresca. É a T6, com guarda própria.
- **Revisores de contexto fresco nunca rodaram no espelho** (a sessão original proibiu subagentes) — o
  `/ggsd:code §9` desta fatia é a **primeira** revisão independente desse código.
