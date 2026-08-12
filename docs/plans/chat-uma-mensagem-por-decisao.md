# Plano — uma mensagem por decisão: fechar a duplicata do alerta do Chat

**Status:** ✅ aprovado (Luis Albuquerque, 12/08/2026)

**Objetivo:** o grupo do Google Chat recebe **exatamente uma** mensagem por pré-aprovação, mesmo com duplo
clique, retry do cliente ou dois líderes da mesma fila (D4) decidindo em paralelo — sem nunca trocar a
duplicata por **silêncio**.

## Por que agora (achado nº 1 da revisão de 12/08)

O gate de `decidirAprovacao` (`src/lib/aprovacoes.functions.ts`) é **check-then-act**: ele lê a linha
`pendente` por `SELECT` (`getAprovacoesDoProjeto` → `minha`) e só depois roda o `UPDATE`. Duas requisições
que leem antes de qualquer uma escrever passam **as duas** pelo gate e **as duas** disparam
`notificarChatPreAprovacao`. Antes da D30 a corrida era inofensiva — o efeito era o write-back idempotente
no Sheets; agora ela vira **mensagem duplicada** num grupo que a triagem lê.

O `UPDATE` **já é o ponto de serialização** (`WHERE projeto_id = ? AND veredito = 'pendente'`): quem chega
depois escreve **0 linhas**. Falta só o número chegar até o gatilho — hoje o helper `exec` da camada de
banco descarta o `ExecResult` inteiro.

### A sub-decisão que dá o desenho: "não sei" ≠ "zero"

`ExecResult = { rowsWritten: number }` está **declarado** no `db-adapter.ts`, o wrapper de dev
(`vite-plugin-dev-api.ts`) devolve `result.changes` e **todos** os fakes de teste também. Mas **nenhum
caminho de produção lê `rowsWritten` hoje** (varredura: só o tipo e os fakes) — o `env.DB` do Godeploy
nunca foi exercitado nisso. Se ele devolver `undefined`/formato diferente, um `rowsWritten > 0` cru
avaliaria `false` **sempre** e o alerta **morreria calado em prod** — trocaríamos "2 mensagens" por
"nenhuma mensagem", que é estritamente pior e invisível.

Então o número entra como **`number | null`**, com `null` = "o adaptador não reportou", e o predicado
**notifica** no `null`. É o mesmo default invertido que já governa o módulo `notificacao-chat.ts` (D30):
diante do estado que não sabe interpretar, **avisa** — projeto que não aparece no grupo é o dano que não
se descobre.

## Tarefas

- **T1 —** `client.server.ts`: helper novo `execContando(sql, params): Promise<number | null>` ao lado do
  `exec` atual (que segue `Promise<void>` para os outros 26 call sites), devolvendo `null` quando
  `rowsWritten` não vier como número finito. `decidirAprovacoesDoProjeto` passa a `Promise<number | null>`
  usando esse helper — mudança **aditiva** (os 2 call sites atuais fazem `await` e ignoram o valor).
  _(guarda: teste do T4 que fixa o adaptador devolvendo `undefined` e ainda notifica)_
- **T2 —** `src/lib/notificacao-chat.ts` (módulo PURO, fonte única do "quando"): predicado
  `deveNotificarDecisao(linhasGravadas: number | null): boolean` — `null` → `true`, `0` → `false`,
  `> 0` → `true`, com o porquê no comentário. _(guarda: 4 casos de unidade)_
- **T3 —** `decidirAprovacao`: captura o retorno do `UPDATE` e passa pelo predicado antes de disparar
  `notificarChatPreAprovacao`. O write-back das 2 colunas do Sheets **fica incondicional** (é idempotente e
  a última escrita é a correta). _(guarda: teste da corrida)_
- **T4 —** testes em `tests/aprovacoes-notifica-chat.test.ts`: (a) 2 líderes da mesma fila (D4) decidindo
  concorrentemente → **1** chamada de notificação; (b) duplo clique do mesmo líder → **1**; (c) adaptador
  que não reporta `rowsWritten` → **notifica**; (d) unidade do predicado.
- **T5 —** docs (regra 12): bullet do D30 no `CLAUDE.md` (seção Sync Google) + `SPEC_APROVACAO_LIDER.md`
  §12/D30 ganham a linha do "1 mensagem por decisão, e `null` notifica"; registrar os achados **2–6** da
  revisão como pendência declarada (não são desta fatia).
- **T6 —** `npm run test` + `npm run build:worker` (regra 1) e commit na branch
  `feat/chat-notifica-so-pre-aprovacao` (mesma fatia funcional — não nasce branch nova).

## Critérios de aceitação

1. Dois líderes da mesma fila decidindo em paralelo → `notificarChatPreAprovacao` chamada **1×**.
2. Duas decisões do MESMO líder em paralelo → **1×** (a perdedora escreve 0 linhas ou cai no 403).
3. Adaptador que não devolve `rowsWritten` (`undefined`) → **notifica** (nunca cala).
4. `ajuste`/`reprovado` seguem sem notificar e a falha do aviso (assíncrona ou síncrona) segue **não**
   derrubando a decisão do líder — os 5 testes que já existem no arquivo permanecem verdes.
5. Suíte inteira verde (baseline 1242) e `worker.js` rebuildado/commitado.

## Fronteiras (não exceder)

- **Os achados 2–6 da revisão ficam FORA**: timeout no `fetch` do webhook · extrair o builder dos ~17 args
  de `buildSubmitMessage` · unificar `assinaturaDoParecer`/`justificativaAprovacaoSheet` · as 3 cópias de
  `ouTraco` · importar `MotivoIsencaoNotificacao` do canônico (este último segue o **ADR-028**, que já
  adiou o mesmo movimento para o `Veredito`).
- **Nada de tabela/coluna de idempotência** de notificação: o `UPDATE` existente já serializa.
- `dispensarAprovacoesPendentes` **não** muda (dispensa não notifica).
- O **texto** da mensagem, o mute de `[E2E-…]` e o momento da submissão (`decidirMomentoNotificacao`) não
  se tocam.
- Nada de deploy nesta fatia — o deploy é o T8 do plano [chat-notifica-so-pre-aprovacao](chat-notifica-so-pre-aprovacao.md),
  retomado depois desta.

## Blast-radius

**Arquivos:** `src/integrations/db/client.server.ts` (helper + 1 assinatura) · `src/lib/notificacao-chat.ts`
(predicado puro) · `src/lib/aprovacoes.functions.ts` (o gatilho) · `tests/aprovacoes-notifica-chat.test.ts`.
**Dependentes:** `decidirAprovacoesDoProjeto` tem **1** call site de produção (`decidirAprovacao`) e 1 de
teste (`gomoon-pendencias-sql.test.ts`), ambos ignorando o retorno → aditivo. `notificarChatPreAprovacao`
tem **1** disparo. O `exec` original fica intocado, então os outros 26 usos não entram no raio.
**Invariantes tocados:** D30 (quando o grupo é avisado) · D3 (o aviso nunca derruba a decisão) · D4 (o
primeiro que decide resolve). Sem `docs/INDEX.md`/`invariants.md` neste repo (**RF-35**) — o raio veio de
leitura direta + grep dos call sites; a sessão de código **confirma com varredura**.
**Confiança:** média-alta. O único ponto genuinamente não observável daqui é o comportamento do `env.DB` do
Godeploy quanto ao `rowsWritten` — e é exatamente por isso que o `null` notifica.
