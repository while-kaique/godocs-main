# Plano — Notificação do Chat só quando há pré-aprovação do líder
**Status:** ✅ **CONCLUÍDO — T1–T8 (12/08/2026), EM PRODUÇÃO.** T8 fechada: staging `edf400b4` (version 141, 13:51 UTC, runtime validado 13:56) → **prod `674a3710` version 237, 14:32 UTC** (1258 testes verdes, `worker.js` rebuildado idêntico ao commitado). ⛔ Falta só o **PR** (`/ggsd:ship`) — a branch segue local. ⚠️ **O conteúdo da mensagem só se confere na 1ª pré-aprovação REAL em prod** (staging não tem webhook: nada é enviado).

> **Execução (12/08/2026).** Worktree `.claude/worktrees/chat-so-pre-aprovacao`, branch
> `feat/chat-notifica-so-pre-aprovacao`. Teste **red** autorado em contexto fresco pelo
> `ggsd:test-writer` (12 asserções vermelhas + 3 módulos inexistentes) **antes** da implementação.
> Suíte: **91 arquivos / 1242 testes verdes** (baseline 87/1206). `npm run build` + `build:worker` OK
> (worker.js 983.5kb, commitado — regra 1). `npx tsc --noEmit` acusa **os mesmos 5 erros do
> `origin/main`** (linhas deslocadas) — nenhum erro de tipo novo.
>
> **Ajustes de rota durante a execução (nada fora das Fronteiras):**
> • `assinaturaDoParecer` (função nova, pura, em `aprovacoes.functions.ts`) — o plano não a previa;
>   deriva "quem pré-aprovou e quando" com a MESMA régua da `justificativaAprovacaoSheet` (o
>   `decidido_por` manda, D4) em vez de redigitá-la no gatilho.
> • `syncUpdateToGoogle` ficou com `projectName` sem uso ao perder o bloco de Chat — em vez de
>   remover o campo (churn em 4 call sites), ele entrou no `console.error` da falha de escrita, que
>   não identificava o projeto.
> • Os **5 testes de sync existentes** passaram a declarar `notificarChat: false` e perderam a chave
>   morta `buildUpdateMessage` do mock (item do próprio Blast-radius).

**Objetivo:** o grupo do Google Chat deixa de ser notificado a cada submissão/edição e passa a ser notificado quando o projeto está **liberado do lado do líder** — a pré-aprovação vira o gatilho; quem nunca terá parecer (especial, autor liderança, sem líder, TeamGuide fora) notifica na submissão, **sinalizado**.

## Contexto e decisões (Luis, 11/08/2026)

Pedido: *"as notificações que rolam a cada submissão ou edição no grupo do Google Chat eu quero que só ocorram quando houver uma pré-aprovação do líder. Pois só a pessoa submeter ou editar e não tiver aprovação do líder ou validação nós vamos desconsiderar. Continuar mostrando submissão de projetos especiais de forma normal, porém de forma mais enxuta e objetiva."*

3 decisões tomadas por seletor na abertura:

| Pergunta | Decisão |
|---|---|
| Projetos em que **ninguém** vai pré-aprovar (autor sem líder na TeamGuide · TeamGuide fora) | **Notificar na submissão, sinalizado** com a linha do porquê não há parecer. Silenciar sumiria com o projeto do grupo para sempre — a integração já caiu antes. |
| Líder decide **"Pedir ajuste"** ou **"Reprovar"** | **Não notifica.** É exatamente o "desconsiderar" do pedido; fica entre líder e autor. |
| 2ª mensagem por submissão (`🚨 Novo fluxo de automação cadastrado – Análise Pendente`, do `syncUpdateToGoogle` pós-análise) | **Suprimir também.** É a mesma notificação por submissão com outra roupa — mantê-la anularia a mudança. Passa a ser **1 mensagem por projeto**. |

**Régua resultante (o "quando"):** o alerta sai quando o projeto está liberado do lado do líder.
- Fila aberta (`isento === false`) → **cala** na submissão; dispara no veredito `aprovado`.
- Isento por `lideranca` / `sem_lider` / `teamguide_indisponivel` → **dispara na submissão**, com nota.
- `especial` (D27, não abre fila) → **dispara na submissão**, mensagem própria e enxuta.

## Tarefas

- **T1 — Módulo PURO da régua:** criar `src/lib/notificacao-chat.ts` com `decidirMomentoNotificacao({isento, motivo}) → {quando: 'submissao'|'pre_aprovacao', nota}`. FONTE ÚNICA do "quando" e dos textos das notas. ⚠️ **Default seguro invertido**: só `isento === false` cala — qualquer motivo de isenção (inclusive um que o futuro acrescente, via `default:`) notifica na submissão, porque projeto sem ninguém para aprová-lo não pode ficar invisível. (guarda: `tests/notificacao-chat.test.ts` — 1 caso por motivo + o `default`)
- **T2 — Builders (`src/lib/google/chat.ts`):** `buildSubmitMessage` ganha `notaPreAprovacao?: string|null` (linha sinalizando a ausência de parecer) e `preAprovacao?: {por, em}|null` (cabeçalho + assinatura de quem pré-aprovou). **Mensagem do especial fica enxuta**: cabeçalho + projeto/área + solicitante + descrição + por que é especial (truncados) + link da planilha; saem separadores, ferramenta, participantes e data. (guarda: `tests/chat-message-especial.test.ts` atualizado + casos novos da nota/pré-aprovação)
- **T3 — Gate no sync (`src/lib/google/sync.ts`):** `SubmitSyncParams` ganha `notificarChat: boolean` **obrigatório** (cada call site declara a intenção — opcional-com-default deixaria um chamador novo notificando por acidente) + `notaPreAprovacao?`. O bloco do Chat passa a ser condicionado. Em `syncUpdateToGoogle`, **remover** o bloco de Chat e o builder `buildUpdateMessage` (T-decisão 3). (guarda: teste de que `sendChatNotification` não é chamado com `notificarChat:false` e é chamado com `true`)
- **T4 — Notificação da pré-aprovação:** novo `src/lib/notificacao-projeto.functions.ts` com `notificarChatPreAprovacao(projetoId, {por, em})` — remonta o payload do banco (`getProjetoById` + `documentacao.conteudo` para saving/receita), monta com `buildSubmitMessage` e envia. **Nunca lança** e respeita o mute de `[E2E-…]` (`ehProjetoTesteE2E`). (guarda: teste com banco mockado — envia no caminho feliz, engole erro, cala no E2E)
- **T5 — Gatilho (`src/lib/aprovacoes.functions.ts`):** em `decidirAprovacao`, quando `veredito === 'aprovado'`, disparar T4 via `runBackground` (ao lado do write-back do Sheets, que já é best-effort). `ajuste`/`reprovado` não disparam nada. (guarda: teste do gatilho por veredito)
- **T6 — Call sites (`src/lib/chat.functions.ts`):** `submeterParaValidacao` chama `decidirMomentoNotificacao(preAprovacao)` e repassa `notificarChat`/`notaPreAprovacao`; `resyncGoogle` passa `notificarChat: false` (reparo administrativo não avisa ninguém). (guarda: suíte existente de sync verde)
- **T7 — Docs (regra 12 + regra 7):** `CLAUDE.md` (seção do Sync Google + a da Pré-aprovação, como **D30**), `spec-docs/SPEC_APROVACAO_LIDER.md` e `spec-docs/SPEC_FEATURES_NOVAS.md`. (guarda: `grep` de marcador de conflito vazio)
- **T8 — Build + validação:** `npm run test`, `npm run build`, `npm run build:worker` (regra 1) → **staging `edf400b4`** (regra 13) → validar → prod `674a3710` → PR.

## Critérios de aceitação

1. Submissão/edição de projeto **com fila aberta** não gera **nenhuma** mensagem no grupo (nem a do submit, nem a `Análise Pendente`).
2. Líder clica **"Pré-aprovar"** → sai **uma** mensagem no grupo, com os dados do projeto e a assinatura de quem pré-aprovou.
3. Líder clica **"Pedir ajuste"** ou **"Reprovar"** → **nenhuma** mensagem.
4. Projeto **especial** → mensagem na submissão, visivelmente mais curta que a atual, sem saving/receita/escopo/tipos.
5. Autor **liderança**, **sem líder** ou **TeamGuide fora** → mensagem na submissão **com a linha** dizendo por que não há parecer de líder.
6. `resyncGoogle` e o analisador não disparam nada no Chat.
7. Projetos `[E2E-…]` seguem mudos em todos os caminhos.
8. `npm run test` verde (suíte atual + novos) e `worker.js` rebuildado/commitado.

## Fronteiras (não exceder)

- **Não** mexer no webhook do **widget de Ajuda** (`GOOGLE_CHAT_WEBHOOK_URL_AJUDA`) nem no `sendChatNotification` em si.
- **Não** mexer nas DMs do **Gomoon** (aviso ao líder) — outro canal, outro contrato.
- **Não** mexer em `Status`, colunas do Sheets, `projeto_aprovacoes`, gates do chat, nem no fluxo de decisão do líder. Só o **canal Chat** muda.
- **Não** criar notificação para `ajuste`/`reprovado` (decisão 2).
- **Não** fazer backfill/reenvio de alertas de projetos já submetidos.

## Blast-radius

**Arquivos:** `src/lib/notificacao-chat.ts` (novo) · `src/lib/notificacao-projeto.functions.ts` (novo) · `src/lib/google/chat.ts` · `src/lib/google/sync.ts` · `src/lib/aprovacoes.functions.ts` · `src/lib/chat.functions.ts` (2 call sites) · `tests/*` · `worker.js` (rebuild).

**Dependentes:** os **2** chamadores de `syncSubmitToGoogle` (`submeterParaValidacao`, `resyncGoogle`) e os **2** de `syncUpdateToGoogle` (`analisarProjetoFn`, `resyncGoogle`) — todos precisam declarar a intenção; 6 testes mockam `./chat` com `buildUpdateMessage` no factory (mock com chave a mais é inofensivo, mas convém limpar).

**Invariantes tocados:** `docs/INDEX.md`/`docs/invariants.md` **não existem** neste repo (RF-35) → o mapeamento acima veio de leitura direta do código, não do índice; a sessão de código deve confirmar com varredura. Invariantes conhecidos que **não podem regredir**: mute de `[E2E-…]` (`ehProjetoTesteE2E`) · o sync **nunca propaga erro** (tudo `console.error`) · fire-and-forget só via `runBackground`/`waitUntil` · `abrirPreAprovacao` nunca lança (D3) · nada aqui pode bloquear submissão nem decisão do líder.

**Reuso (RF-32):** reusa `buildSubmitMessage`, `sendChatNotification`, `ehProjetoTesteE2E`, `runBackground` e o `ResultadoAbertura` de `abrirPreAprovacao`. **Criado do zero:** o módulo puro da régua (`notificacao-chat.ts`) — não existe hoje um lugar que decida *quando* notificar (a decisão estava implícita no ponto de chamada), e ele precisa ser puro/testável e consumido por 2 caminhos distintos; e o `notificacao-projeto.functions.ts`, porque a montagem do payload a partir do banco hoje só existe dentro de `resyncGoogle` (que também **escreve** no Sheets — reusá-lo faria a pré-aprovação regravar a linha inteira).

**Confiança:** média-alta no código (li os 4 arquivos e todos os call sites) · **média** no mapeamento formal (sem `INDEX.md`/`invariants.md`).
