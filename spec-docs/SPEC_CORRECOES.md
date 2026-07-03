# Spec — Registro de Correções (GoDocs)

> **Documento vivo.** Uma entrada por correção de bug relevante (regra 12 do `CLAUDE.md`:
> "Specs — consultar antes, atualizar a CADA implementação"). Formato fixo:
> **sintoma → causa-raiz → fix → onde aterrissou → status/PR**. Mais recente no topo.

---

## 2026-07-03 — Autocomplete de participantes não mostrava a lista da TeamGuide + sem feedback de carregando

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/autocomplete-participantes-lento`

**Sintoma:** no campo "Participantes e seus papéis" (Etapa 1), digitar um nome ("kai") NÃO abria a lista
dinâmica da TeamGuide — só aparecia o erro de validação "Insira um e-mail válido". E não havia nenhum
sinal de que a lista estava sendo carregada (parecia quebrado).

**Causa-raiz (DUAS somadas):**
1. **Infra (a de verdade):** `GET /api/participantes/sugestoes` caía, de forma **intermitente**, num erro de
   plataforma do Godeploy no cold start — `Internal error while starting up Durable Object storage caused
   object to be reset` → **502**. Nos logs, o mesmo erro batia em `/api/config` e `/api/auth/me` no MESMO
   instante: é o Durable Object que respalda o `env.DB` falhando ao subir, atingindo **TODAS** as rotas de
   API (esta rota nem toca o banco) — **não** é o handler, e não dá pra capturar no código. Recupera sozinho
   em 1-2 tentativas (às 17:03 o `/api/config` já voltava `ok`). Nessa janela, a lista vinha vazia.
2. **UX que escondia a falha:** o dropdown só abria com `suggestions.length > 0` e a lista só começava a
   carregar ao marcar "em equipe = sim". Sem estado de "carregando", uma lista vazia (por 502 ou por ainda
   estar carregando) era indistinguível de "quebrado": quem digitava caía no `onBlur`→`tryAdd("kai")` →
   falha do `EMAIL_RE` → "Insira um e-mail válido".

**Fix (frontend, sem tocar server — o 502 é infra, não código):**
- **Retry no cliente:** `buscarSugestoesComRetry` tenta o endpoint até 3× com backoff (400/800ms) antes de
  desistir — um 502 transitório do DO se auto-cura sozinho. Esgotado, reseta a promise (nova chance no
  próximo mount) e degrada suave (lista vazia, campo segue aceitando e-mail digitado).
- **Velocidade — prefetch:** `prefetchSugestoesParticipantes()` dispara o fetch (com retry) já no MOUNT da
  Etapa 1 (antes de marcar "em equipe"), então a lista costuma estar pronta quando o usuário digita. Reusa
  cache/promise de módulo (idempotente) + cache de 10 min do servidor (`getSugestoesParticipantes`).
- **Feedback — `loading`:** `useSugestoesParticipantes` devolve `{ pessoas, loading }`. O dropdown abre
  também enquanto `loadingSuggestions` e mostra uma linha SUTIL "Buscando e-mails na Team Guide…" (3
  pontinhos go-blue, `go-bounce`, neutralizado sob `prefers-reduced-motion`; `role="status"`/`aria-live`).

**Onde aterrissou:** `src/lib/submeter/participantes-sugestoes.ts` (retry + `prefetch…` + hook devolve
`loading`), `src/lib/submeter/step1.tsx` (prefetch no mount + passa `loadingSuggestions`),
`src/lib/submeter/form-components.tsx` (`ParticipantesPapeisInput`: abre no load + linha "buscando…").
Só frontend. ⚠️ O erro de DO no cold start é da PLATAFORMA (mais frequente na staging, "fria"); se persistir
em prod, é caso de abrir com o time do Godeploy — não é bug do app.

---

## 2026-07-03 — "Enviar para Triagem" liberado sem memorial de saving aprovado (edição especial→saving) → 500 "sem ganho mensurável" mascarado

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/enviar-sem-memorial-saving`

**Sintoma:** autor de projeto (caso real "Supply Lojas <> Estoque CDs" / Juan Silva, prod 03/07) edita e recebe
o toast genérico *"Erro ao enviar projeto. Tente novamente."* — preso. Nos `api_logs` do Investigador:
**6× `submeter-validacao` HTTP 500** com *"Não é possível submeter este projeto como saving sem ganho
mensurável"*. Não é o bug de LEGADO doc-ausente (ID hex, doc existe) nem o de base64 vazio.

**Causa-raiz:** o botão "Enviar para Triagem" (`FinalReview`, `step3-chat.tsx`) é gated **só** por
`chatComplete` — **não** exige o preview de memorial de saving aprovado. O **seed** (`submeter.tsx`,
`applySeed`) já liga `chatComplete` só quando `saving.memorial_calculo` existe; mas o **atalho de "reenviou
o formulário de saving sem mudar nada" no modo edição** (`handleSavingFormSubmit`) fazia
`setChatComplete(true)` **sem** essa checagem. Fluxo do caso: projeto ESPECIAL → na edição foi **convertido
para saving** (`atualizar-tipos`), doc re-aprovada (handoff doc→saving já liga `chatComplete`), form de
saving enviado (Assistente 75h→6h) → o agente fez a **pergunta do gate de composição** (memorial NÃO
gerado); ao **reabrir o form ("Editar dados") e reenviar igual**, o atalho marcou a conversa como concluída
→ botão "Enviar" apareceu com `documentacao.conteudo.saving` ausente → o gate do servidor
(`submeterParaValidacao`) leu `economia_reais_mes` ausente = 0 e lançou o 500. O cliente mascarava a
mensagem real. Reproduzido de forma determinística no staging (mesmo erro + mesma pergunta do gate).

**Fix (client-only — sem `worker.js`; o gate do servidor já barra corretamente):**
- **(a)** `handleSavingFormSubmit`: no atalho de reenvio idêntico da edição, só `setChatComplete(true)` se
  `approvedSavingPreview !== null` (espelha o guard que o ramo do fluxo "ambos" já tinha); sem preview
  aprovado, cai no chat da fase de saving (a pergunta pendente) para o memorial ser concluído.
- **(b)** `handleSubmitProjeto` (defesa em profundidade): antes de enviar, se o projeto não é especial e
  falta `approvedSavingPreview` (saving) ou `approvedReceitaPreview` (receita), barra com toast orientando a
  concluir o memorial e reabre o formulário — em vez de deixar o servidor devolver 500.
- **(c)** `handleSubmitProjeto` (catch): mostra a **mensagem real** do servidor
  (`Erro ao enviar projeto: <msg>`) em vez do genérico "Tente novamente" — orienta a ação se algo escapar.
- **(nota)** o seed de `approvedSavingPreview` a partir do memorial salvo já existe no `main` (necessário
  para (a)/(b) não quebrarem a edição legítima de quem não mexe no saving).

**Onde aterrissou:** `src/routes/submeter.tsx` (`handleSavingFormSubmit`, `handleSubmitProjeto`).
Testes: 534 passando. Sem mudança server-side.

---

## 2026-07-03 — Loop da pergunta "quantas horas a pessoa fazia à mão" (gate carga real × escala) na EDIÇÃO

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/loop-carga-escala-agente-conduz`

**Sintoma:** usuários relataram que, ao **editar** um projeto e chegar no memorial, o chat travava
repetindo **sem fim** a pergunta do split carga real × escala ("dessas Xh economizadas, quantas a pessoa
realmente fazia à mão?"). Mesmo respondendo ("eu já falei", "é assim e assado que as horas funcionam", ou
dando um valor), o agente **jogava a MESMA pergunta de novo** e nunca saía dela. Concentrado em edições.

**Causa-raiz:** a pergunta era um **GATE DETERMINÍSTICO** no backend, não uma pergunta do agente. Duas
camadas de forçamento em `chat.functions.ts`/`enviarMensagem`: (1) a branch de resposta
(`carga_escala==='pendente'`) parseava o texto do usuário e, quando ele **contestava o total** ou não dava
número limpo, refazia via escape (reset + nudge pro LLM recalcular); (2) o **gate de preview**
(`carga_escala!=='ok'`) **interceptava o preview/complete que o LLM produzia e o descartava**, recolocando
a pergunta fixa. Ou seja: por mais que o agente "raciocinasse" e tentasse seguir, um `if` do backend
sobrepunha a saída dele e re-perguntava. O escape (fix de 30/jun, `contestaTotalCargaReal`) **delegava a
terminação ao LLM** sem loop-breaker determinístico — e, na **edição**, o memorial pronto (linhas/total já
fixos) **ancora** o LLM a re-previewar o MESMO total, então o gate re-perguntava indefinidamente. A
pergunta ainda dizia "não o valor por dia", e o usuário de edição respondia "5 min por dia" → casava
`/por dia/` no `contestaTotalCargaReal` → escape → loop.

**Fix — o AGENTE conduz a pergunta (padrão saudável da verificação de "usa IA?"), sem forçamento:**
- **Prompt (`buildSavingPrompt`, `orchestrator.ts`):** o bloco "CARGA REAL × GANHO POR ESCALA" foi
  virado de "CONDUZIDA PELO SISTEMA — você NÃO pergunta" para **"VOCÊ conduz — pergunte 1×"**, espelhando
  a verificação de IA (`orchestrator.ts:159`): pergunta UMA vez com `type:"options"` (["fazia o volume
  todo à mão" → carga real=total/escala 0 · "só uma parte" → pergunta curta quanto, convertendo "por dia"
  · "não sei" → ajuda 1x, senão conservador]); confirma plausibilidade (escala >~60%) UMA vez; e — o
  ponto-chave — **aceita a discordância e SEGUE, NUNCA repete** a mesma pergunta (igual ao PASSO 3 da IA,
  onde contradição é registrada e não vira loop).
- **Backend (`chat.functions.ts`):** **removidos** o gate de preview que bloqueava/descartava o preview e
  as branches determinísticas de resposta (`carga_escala` 'pendente'/'confirmar_escala'), mais os helpers
  mortos (`perguntaCargaEscala`, `perguntaConfirmarEscala`, `interpretarConfirmacaoEscala`,
  `nudgeCargaEscala`, `nudgeRecalcularCargaEscala`, `OPCOES_CONFIRMAR_ESCALA`). Em `orchestrator.ts`,
  removidos os predicados que só serviam ao gate (`interpretarCargaReal`, `contestaTotalCargaReal`,
  `precisaConfirmarEscala`, `parseNumeroPtBR`, `LIMITE_ESCALA_ALTA`).
- **Rede de segurança NÃO-bloqueante (`resolverSplitCargaEscala`, `orchestrator.ts`):** como o forçamento
  saiu, o agente pode não capturar o split. Na **gravação** (`submeterParaValidacao` e `resyncGoogle`), se
  o split se aplica ('sim' recorrente com horas) e não veio, o backend assume o **conservador — carga real
  = total, escala 0** ("fazia o volume todo à mão"; nunca infla escala) e preenche
  `horas_carga_real`/`horas_escala`. Mantém as colunas "Saving Horas Real/Escalado" + a justificativa
  preenchidas **sem travar/repetir nada no chat**. O sync reverso horário NÃO passa por aí → **legados
  ociosos ficam como estão** (respeita a decisão 29/06 do 'nao'→0/total e do 'sim'-sem-split→0/0 no
  `derivarSplitHorasSheet`, que **não foi alterado**).

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (bloco do prompt + `resolverSplitCargaEscala`;
remoção dos predicados do gate), `src/lib/chat.functions.ts` (remoção do gate de preview, das branches e
dos helpers; chamada de `resolverSplitCargaEscala` no submit/resync), `src/lib/agents/types.ts`
(`carga_escala`/`carga_escala_racional` viram LEGADO), `src/lib/testes/prompt-registry.ts` (descrição
atualizada), `tests/saving-carga-escala.test.ts` (testes do novo desenho + `resolverSplitCargaEscala`).

**Decisão de design:** a pergunta deixou de ser uma armadilha determinística e passou a ser conduzida pelo
agente como qualquer outra pergunta saudável (opções, uma vez, aceita e segue). A garantia do DADO (não do
diálogo) migrou para uma rede conservadora na gravação — o chat nunca mais trava por causa do split.

---

## 2026-07-03 — Autocomplete de participantes cortado pela borda do card (só ~4 sugestões visíveis)

**PR:** #202 · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/dropdown-participantes-corte`

**Sintoma:** no campo **"E-mails dos participantes"** (Etapa 1, `ParticipantesPapeisInput`), ao digitar um nome genérico como **"Lucas"** a lista de sugestões da TeamGuide fica grande, mas aparecia **cortada** — só ~4 pessoas visíveis, com cara de espremido. A lista rolava internamente, mas o container ficava truncado na borda inferior do formulário.

**Causa-raiz:** o dropdown era `position: absolute` dentro do campo, e o **card central do formulário** (`submeter.tsx`, `<div ref={formCardRef} className="relative overflow-hidden …">`) tem **`overflow-hidden`** — necessário para o slide entre etapas e para arredondar a barra de gradiente do topo. Como o campo de participantes é o **último** da Etapa 1, a lista estourava a borda inferior do card e era **clipada por esse `overflow-hidden` ancestral**, não pela própria `max-h-60`.

**Fix (`src/lib/submeter/form-components.tsx`, `ParticipantesPapeisInput`):** o dropdown passou a ser renderizado num **portal no `<body>`** (`createPortal`) em **`position: fixed`**, ancorado à caixa do input — escapa do `overflow-hidden` e flutua acima de tudo. Um `useEffect` mede a caixa (`getBoundingClientRect`), calcula `left`/`width` e decide **abrir para baixo (padrão) ou para cima** quando não cabe embaixo e há mais espaço acima; `maxHeight` adaptativo (132–288px) conforme o espaço livre na janela, com scroll interno. Reposiciona em `scroll`(capture)/`resize` enquanto aberto. Mantido tudo do resto: estilo GoGroup, realce do termo, navegação por teclado (↑↓/Enter/Esc), `aria-*`, rodapé "Mostrando N de M" e a animação `go-slide-down` (neutralizada pelo global `prefers-reduced-motion`).

**Onde aterrissou:** `src/lib/submeter/form-components.tsx` (só frontend — **sem** rebuild de `worker.js`). Sem novos testes (mudança puramente de layout/posicionamento); `npm run test` (552) e `npm run build` verdes.

---

## 2026-07-02 — LEGADO especial→saving voltava a especial: sync reverso re-forçava `especial=1` da planilha (caso Hugo/legado-038, 2ª recorrência)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `worktree-fix-sync-reverso-legado-especial-conversao`

**Sintoma:** `hugo.santana@gobeaute.com.br` editou o legado **`legado-038` ("Base Custos - Gobeaute")** de **especial → saving**, preencheu o saving completo (6h40/mês, `Especialista+`) e submeteu — mas o projeto **caiu como especial DE NOVO** (pela 2ª vez). No SQLite: `tipos_projeto=['especial']`, `documentacao.saving=null` (a doc especial reconstruída **apagou** o saving). Nos logs, todos os turnos do chat de saving dele registravam `tipos: especial`.

**Causa-raiz:** é a **variante LEGADO** do bug "especial sticky" — o app-fix de 30/06 ([entrada abaixo](#2026-06-30--edição-de-projeto-especial--savingreceita-não-desmarcava-especial-sticky)) funciona, mas **não segura para legados**. `atualizarTipos` zera `especial` no SQLite **no ato** da conversão, porém a célula **"Especial?" da planilha só vira "Não" no SUBMIT**. Entre a conversão e o submit, o **cron horário de sync reverso** (`syncSheetsToSqlite` → `atualizarExistente`, `sync-reverse.ts`) lia a coluna **"Especial?"=Sim** ainda stale e **re-forçava `especial=1`/`tipos_projeto=['especial']`** — atropelando a conversão em andamento. O resto do chat rodava com `especial=1`, o `atualizarMetadados` (ramo especial) reconstruía a doc especial e o saving se perdia. Recorre para **qualquer legado especial editado para saving/receita** que sofra um sync reverso antes de submeter.

**Fix (`sync-reverse.ts`, `atualizarExistente`):** no sentido **"Especial?"=Sim → especial=1**, guardamos com `jaConvertidoParaFinanceiro(current)` — se o SQLite **já tem `tipos_projeto` não-especial** (saving/receita, gravado por `atualizarTipos`), a "Sim" da planilha é tratada como **STALE** e **não re-forçamos** especial (será corrigida para "Não" no próximo submit). O sentido oposto **"Não" → especial=0** (fix da Helen, anti-sticky) segue **aplicado incondicionalmente**. Guard estreito: um SQLite não-financeiro por deriva (`tipos=['especial']`) ainda é reconciliado para especial normalmente.

**Onde aterrissou:** `src/lib/google/sync-reverse.ts` (helper `jaConvertidoParaFinanceiro` + reestrutura do bloco "Especial?"; cobre `syncSheetsToSqlite` **e** `syncOwnerRowsFromSheet`, que reusam `atualizarExistente`). Server-side → `worker.js` rebuildado. Testes: `tests/sync-reverse.test.ts` (+2 — "Sim não clobber conversão financeira" e "guard estreito: Sim ainda re-força quando não-financeiro").

**Recuperação do legado-038 (feita antes do fix, 02/07):** replay do pipeline real (admin+cookie prod) — `atualizar-tipos([saving])` → `iniciar-saving` (linha `Especialista+`, 6h40/mês→0h, mensal, alguém fazia=sim, tudo à mão/escala 0, sem custo evitado/externo, `valor_hora=R$55,15` → **R$367,67/mês**) → gates (composição, jornada=dias úteis) → aprovar preview → `submeter-validacao(edicao)`. Depois `resyncGoogle` (escrita AWAITED do Sheet: "Especial?"=Não + saving) e `sync-sheets-now` (reverse sync manteve `tipos=['saving']`, provando o loop quebrado). Números vieram dos `form_events`/logs (form dizia 10h; ele corrigiu p/ 6h40 no chat — usado o 6h40 final).

**Nota:** trade-off aceito — uma conversão in-app **abandonada** (converteu p/ saving mas nunca submeteu) mantém `saving` no SQLite mesmo com a planilha ainda "Sim"; resolve-se no submit. Alternativa considerada (escrever "Não" no Sheet no ato do `atualizarTipos`, ida awaited) ficou de fora para manter o PR cirúrgico.

---

## 2026-07-02 — Retomada de rascunho despejava o TEXTO BRUTO dos arquivos (`=== arquivo ===`) no chat

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `feat/botao-recomecar-forms`

**Sintoma:** ao **retomar um rascunho** (Meus Projetos › Rascunhos › Continuar) o chat abria com o
**conteúdo cru de um arquivo enviado** despejado como mensagem — ex.: `=== CLAUDE.md === …` (o texto
inteiro de outro projeto usado como upload de teste). Ficava visível ao usuário. Descoberto testando o
novo botão **"Salvar rascunho"** (que redireciona pra home e depois retoma pela lista).

**Causa-raiz:** duas coisas somadas.
1. `getHistoricoMeuProjeto` (`meus-projetos.functions.ts`) devolvia **todas** as `chat_messages` cruas —
   inclusive `role:'doc'` (que guarda o texto concatenado dos arquivos, contexto do LLM montado em
   `extractTextFromMultipleFiles`, `=== nome === …`) e `role:'assistant'` gravado como
   `JSON.stringify(resultado)`. O map do frontend (`submeter.tsx`, caminho **cross-device / sem snapshot
   local**) renderizava tudo sem filtrar nem parsear → bolha com o dump do arquivo (e, nas respostas do
   agente, o JSON cru).
2. O caminho servidor do resume só é usado **quando não há snapshot local** (`loadDraft()` nulo). Antes
   era raro; o novo **"Salvar rascunho"** chama `clearDraft()` (para `/submeter` não retomar o mesmo
   rascunho) e **passou a forçar exatamente esse caminho** — tornando o bug pré-existente fácil de
   reproduzir.

**Fix:**
- **Backend (`getHistoricoMeuProjeto`):** filtra para **só `user`/`assistant`** (a role `'doc'` nunca sai
  do servidor) e, para `assistant`, **parseia o JSON** devolvendo o texto de exibição
  (`content ?? question`) + `options` + flags derivados (`isPreview = type==='preview'`,
  `isComplete = fase==='completo'`, `fase`) — mesma semântica do `formatResponse` da ida.
- **Frontend (`submeter.tsx`, resume cross-device):** lê os novos campos no `ChatMessage`, mantém um
  **filtro defensivo** (só `user`/`assistant`) contra dados legados, e alinha `chatFase`/`chatComplete`
  à última mensagem (senão a conversa retomada ficava presa na fase `doc`).

**Onde aterrissou:** `src/lib/meus-projetos.functions.ts` (`getHistoricoMeuProjeto` — tipo de retorno +
transform) e `src/routes/submeter.tsx` (map do histórico no efeito de mount). Server-side → `worker.js`
rebuildado. Sem mudança em `chat.functions.ts` (a gravação `role:'doc'` continua — é contexto legítimo do
LLM; o fix é **não exibir**).

**Notas:** o bug afeta qualquer retomada sem snapshot local (ex.: outro navegador), não só o novo botão —
o "Salvar rascunho" só o tornou comum. A role `'doc'` segue sendo gravada de propósito (o LLM precisa do
texto); o conserto é puramente de **exibição/serialização ao cliente**.

---

## 2026-07-01 — Gate ≥44h "O que mudou após a automação" era só prompt e escapou (projeto Gostream)

**PR:** _(a abrir)_ · **Status:** 🔜 validar no staging (`edf400b4`) → prod · **Branch:** `fix/gate-alocacao-ganhos`

**Sintoma:** o projeto **Gostream** (`legado-152`, R&S, **150h/mês**, `alguem_fazia='sim'`) fechou o
memorial **sem** que o usuário fosse perguntado pra onde foi o tempo liberado. A Seção 2.4 ("### O que
mudou após a automação") existia no memorial, mas preenchida com **exatamente** o boilerplate que a régua
manda RECUSAR: _"o tempo liberado foi realocado para outras atividades do time de R&S, sem necessidade de
manter essa rotina manual."_ Ninguém no chat viu a pergunta (confirmado puxando o `chat/historico` de prod
com o `E2E_COOKIE`).

**Causa-raiz:** o gate de economia alta (≥44h/mês) era **100% prompt** — o bloco "SEÇÃO 2.4" em
`buildSavingPrompt` + a rede de segurança (LLM-juiz) em `buildSavingPreviewPrompt`. Diferente dos gates de
**jornada**, **teto 220h** e **carga real × escala** (que são DETERMINÍSTICOS no backend e por isso
dispararam), este dependia do LLM obedecer. O LLM **auto-gerou** a seção vaga e previewou sem perguntar; a
rede de segurança do preview (também LLM) deixou passar na aprovação. Resultado: a única família de gate de
horas altas SEM trava determinística falhou silenciosamente.

**Fix (transformar em GATE DETERMINÍSTICO, nos moldes do carga×escala):**
- **Predicado** `aplicaGateAlocacaoGanhos(ctx, saving)` (`orchestrator.ts`): `alguem_fazia==='sim'` **&&**
  `tipo_saving==='mensal'` **&&** (total ≥ `LIMITE_ECONOMIA_ALTA(44)` OU um cargo ≥44h). Contrafactual
  (`'nao'`) e custo evitado puro (`'externo'`) NÃO entram (não houve tempo humano REAL liberado — a Seção
  2.4 ali segue só no prompt, sem bloqueio). Pontual/periódico fora (base ≠ mês).
- **Estado** `saving.alocacao_ganhos` (`null`→`pendente`→`reperguntado`→`ok`) + `alocacao_ganhos_racional`
  (resposta crua do usuário, backend-only, re-mesclada a cada turno). Em `types.ts`/`savingVazio`.
- **Gate em `enviarMensagem` (`chat.functions.ts`):** antes do preview, se a Seção 2.4 do memorial já for
  CONCRETA (`extrairAlocacaoGanhos` + `!respostaAlocacaoVaga`) → libera (`'ok'`); senão **bloqueia** e
  pergunta `perguntaAlocacaoGanhos` ("pra onde foi o tempo? nomeie as atividades / o que entrega a mais").
  No turno de resposta: se vier vaga (`respostaAlocacaoVaga`), **repergunta FIRME 1x** (`'reperguntado'`,
  anti-loop); senão captura o racional e injeta o nudge `[SISTEMA]` (`nudgeAlocacaoGanhos`) p/ o LLM
  escrever a seção a partir do que o usuário disse. Roda por ÚLTIMO (jornada→teto→split→alocação, 1/turno).
- **`respostaAlocacaoVaga(texto)`** (`orchestrator.ts`, puro): heurística CONSERVADORA — só marca vaga se
  curta demais OU bate em padrão vago ("realocado/outras atividades/sobra tempo/produtividade/eficiência")
  **e** não traz nada concreto junto (nº ou destino nomeado via "para/pra …"). Na dúvida, aceita (custo do
  falso-positivo = 1 pergunta a mais; a rede de segurança do preview + validação humana são backstops). NÃO
  é juiz de qualidade — é só o piso p/ forçar UMA reperguntada.

**Onde aterrissou:** `src/lib/agents/types.ts` (2 campos + `savingVazio`); `src/lib/agents/orchestrator.ts`
(`LIMITE_ECONOMIA_ALTA` exportado, `aplicaGateAlocacaoGanhos`, `respostaAlocacaoVaga`); `src/lib/chat.functions.ts`
(helpers `perguntaAlocacaoGanhos`/`…Firme`/`nudgeAlocacaoGanhos` + branches de resposta + re-merge + gate de
preview); `tests/gate-alocacao-ganhos.test.ts` (novo, 14 casos incl. o boilerplate do Gostream);
`tests/agents-types.test.ts` (shape 19→21). `worker.js` rebuildado. **Não muda prompt** (rule 3 N/A) — o
bloco 2.4 do prompt segue igual; o gate é backend. 532 testes verdes.

---

## 2026-07-01 — Favicon some do deploy (upload só varria `dist/assets/*`, não a raiz do `dist/`)

**PR:** _(a abrir)_ · **Status:** ✅ deployada (staging `edf400b4` + prod `674a3710`) · **Branch:** `fix/deploy-favicon-dist-root`

**Sintoma:** o **favicon** (ícone da aba) sumiu do app deployado. `index.html` referencia
`<link rel="icon" href="/favicon.svg">`, mas a aba do navegador ficava sem ícone.

**Causa-raiz (processo de deploy, não código do app):** o Vite copia `public/favicon.svg` para a
**raiz** do `dist/` (`dist/favicon.svg`), **fora** de `dist/assets/`. O runbook de deploy
(`CLAUDE.md` / `docs/deploy.md`) montava o upload e o manifest de assets varrendo **só** `dist/assets/*`
(`for f in dist/assets/*`). Resultado: `favicon.svg` **nunca era enviado nem registrado como asset**.
Com o SPA fallback (`not_found_handling: single-page-application`), `GET /favicon.svg` não encontrado
devolvia o `index.html` (HTML) em vez do SVG → o browser não usava como ícone → **favicon some**.
Confirmado pelo `assetManifest` do app: `/favicon.svg` estava **ausente**.

**Fix ("lista derivada do `dist/` real, nunca à mão"):** novo script `scripts/deploy-godeploy.sh` que
**varre `dist/` recursivamente** (`find dist -type f`) + `worker.js`, faz o upload multipart
(token via header `Authorization: Bearer`, não query param) e **imprime o `ASSETS_JSON`** com TODOS os
arquivos do `dist/` para o `updateApp`. Assim, `favicon.svg` — e qualquer futuro arquivo de `public/`
na raiz do `dist/` (ex.: `robots.txt`) — entra no deploy automaticamente, sem depender de lembrar de
listar. Runbooks (`CLAUDE.md` "Deploy rápido" e `docs/deploy.md`) reescritos para usar o script e alertar
contra varrer só `assets/*`.

**Onde aterrissou:** `scripts/deploy-godeploy.sh` (novo); `docs/deploy.md` e `CLAUDE.md` (seção Deploy
rápido). Validado: `assetManifest` de staging **e** prod agora contêm `/favicon.svg` (654 bytes) — antes
ausente. (Obs.: o edge exige OAuth, então `curl` anônimo em `/favicon.svg` dá 302→login; logado, o
browser recebe o SVG. Sem mudança de código do app — só do processo de deploy.)

---

## 2026-07-01 — Edição de LEGADO "ressuscita" a tela de aprovação final (rascunho local sobrepõe o servidor)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/edit-draft-legado-guard`

**Sintoma:** um legado (`legado-141`, "Regularizações - GoGroup") foi apagado do deploy para a dona
**reauditar do zero**. Ao reabrir `/editar/legado-141`, ela **caía de novo na etapa final de
aprovação** — como se nada tivesse sido apagado. Apagar os registros no servidor não resolvia: ao
reabrir, o estágio voltava.

**Causa-raiz:** no modo edição (`submeter.tsx`), o seed do servidor (`applySeed`) era **sobreposto
INCONDICIONALMENTE** por `rehydrateFromLocal(editDraft)` — o rascunho de edição salvo no
**localStorage do navegador** (`godocs:edicao-v1:<id>`), que guarda chat/fase/previews do ponto onde
a pessoa parou. Como o id do legado é fixo, qualquer limpeza no servidor era irrelevante: o navegador
recolocava o estágio final por cima. O fluxo de **retomar rascunho** já fazia o certo
(`submeter.tsx`: se `status !== 'rascunho'` → `clearDraft()`), mas o de **edição** não tinha guard.
Mesma família do 🐞 bug aberto "Documentação ainda não foi gerada": cliente afirmando um estágio
(`chatComplete`/`docPronta`) que o servidor nunca persistiu (legado entra por sync reverso **sem** a
linha `documentacao`, que só é gravada na aprovação do preview).

**Fix ("servidor manda"):** `deveDescartarDraftEdicao` (`draft-storage.ts`, puro/testável) — ao abrir
a edição, só reidrata o rascunho local se for **consistente** com o servidor. Se o rascunho diz que a
fase de doc terminou (`chatComplete` **ou** `approvedDocPreview != null`) mas o servidor **não tem doc
persistida** (`data.documentacao == null`), **descarta** o rascunho (`clearDraft`) em vez de reidratar.
Com o chat vazio, o caminho de re-init já existente dispara `atualizar-metadados` com `reset_doc:true`,
que faz `deleteChatMessagesByProjeto` (limpa o chat no servidor) e recomeça a auditoria **do zero** —
tudo **por código**, sem ação no navegador do usuário e sem cirurgia manual de dados. NÃO descarta
rascunhos legítimos: quem está no meio da fase de doc (sem preview aprovado) e edições de projetos que
JÁ têm doc no servidor são preservados.

**Onde aterrissou:** `src/lib/submeter/draft-storage.ts` (`deveDescartarDraftEdicao`);
`src/routes/submeter.tsx` (guard no branch de edição, antes de `rehydrateFromLocal`);
`tests/draft-storage.test.ts` (4 casos: descarta chatComplete/preview sem doc no servidor; preserva
reenvio normal e meio-de-doc). Mitiga também o caminho de rascunho do 🐞 bug aberto do legado
(o endurecimento **servidor** — `submeterParaValidacao` virar 4xx claro em vez de 500 — segue pendente).

---

## 2026-07-01 — Investigador sem NENHUM projeto visível — `/edicoes` estourando o limite de 32 MiB de RPC

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/investigador-edicoes-rpc-limit`

**Sintoma:** o painel **Investigador** (admin) não mostrava **nenhum** projeto — abas Submetidos e
Abandonados vazias ("Nenhum projeto encontrado"), mesmo com projetos existindo. Nos logs de produção,
o endpoint `GET /api/admin/investigador/edicoes` logava, em **toda** requisição:
`[worker] GET /api/admin/investigador/edicoes: Serialized RPC arguments or return values are limited to
32MiB, but the size of this value was: 35088590 bytes.` (**35 MB** contra o teto de 32 MiB). O endpoint
`/projetos` em si respondia **200 OK** (15× no log) — ou seja, os dados existiam e a query de projetos
funcionava.

**Causa-raiz (dois problemas encadeados):**
1. **Servidor** — `getAllReenvios` (`client.server.ts`) fazia `SELECT v.*` de `projeto_versions`,
   trazendo os blobs **`snapshot_chat`** (conversa congelada inteira de cada reenvio), `snapshot_projeto`
   e `snapshot_doc` de **todos** os reenvios pela fronteira RPC do banco async do Godeploy. A soma
   estourava os 32 MiB → a chamada lançava → `/edicoes` falhava. `getEdicoesInvestigador` só usava esses
   blobs para **contar mensagens** (total/usuário/IA) e ler **`status`/`ganho_total_mensal`** — nunca
   devolvia os blobs em si. `snapshot_doc` não era usado para nada.
2. **Frontend** — `fetchData` (`investigador.tsx`) buscava `/projetos`, `/stats` e `/edicoes` num único
   `Promise.all`. Quando `/edicoes` rejeitava, o `Promise.all` inteiro rejeitava **antes** de qualquer
   `setProjetos`, o `catch {}` engolia o erro em silêncio e `projetos` ficava `[]` → **toda** a tela
   aparecia vazia por causa de **um** endpoint quebrado.

**Fix (determinístico, sem migração/coluna nova):**
1. **`getAllReenvios` para de trafegar os blobs** — troca `SELECT v.*` por colunas escalares +
   agregações no próprio SQL: contagens de mensagem via `json_each(COALESCE(snapshot_chat,'[]'))`
   (guarda o NULL das versões antigas → conta 0 sem erro) e `status`/`ganho_total_mensal` via
   `json_extract(snapshot_projeto, …)`. `snapshot_doc` sai de vez. Payload passa a ser só escalar
   (KB, não MB). `getEdicoesInvestigador` consome `msg_total`/`msg_user`/`msg_ia`/`snap_status`/
   `snap_ganho` (não parseia mais snapshot).
2. **`fetchData` usa `Promise.allSettled`** — cada endpoint popula seu estado independentemente; a
   falha de um não zera os outros (defesa em profundidade — se `/edicoes` voltar a crescer, Submetidos/
   Abandonados continuam aparecendo).

**Onde aterrissou:**
- `src/integrations/db/client.server.ts` — `getAllReenvios` reescrita (colunas escalares + `json_each`/
  `json_extract`; novo tipo de retorno, sem `snapshot_*` crus).
- `src/lib/investigador.functions.ts` — `getEdicoesInvestigador` consome os campos agregados.
- `src/routes/_authenticated/investigador.tsx` — `fetchData`: `Promise.all` → `Promise.allSettled`.
- `worker.js` rebuildado. Sem teste unitário novo (não há cobertura de `getAllReenvios`); SQL validado à
  parte contra `better-sqlite3` (contagens + `snapshot_chat` NULL). Os 504 testes seguem verdes.

**Notas / não-regressão:** as contagens `json_each`/`json_extract` foram conferidas no engine de dev
(better-sqlite3) — json1 é padrão e o D1/GoDeployDB também suporta; **validar no staging** (`edf400b4`)
antes de prod (regra 13) confirma o suporte no engine de produção.

---

## 2026-07-01 — Custo evitado e custo do projeto PONTUAIS deixam de ser mensalizados ÷12 (entram pelo valor CHEIO)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/custos-pontuais-valor-cheio`

**Natureza:** decisão de produto (não é bug de código). **Reverte deliberadamente** a "Exceção: custo evitado
pontual é mensalizado ÷12" que constava no `CLAUDE.md` e foi entregue com a F3 (`SPEC_FEATURES_NOVAS.md`).
Não é conserto por engano de uma decisão fechada — é uma mudança de regra pedida pela gestão.

**Sintoma/pedido:** o **custo evitado pontual** (e, por tabela, o **custo do projeto pontual**) era dividido por
12 antes de somar/abater no saving — divergindo de saving e receita pontuais, que sempre entraram pelo **valor
cheio**. A gestão pediu para **remover a divisão** e tratar o pontual igual aos demais (valor cheio).

**Causa (comportamento anterior):** a mensalização `recorrencia === 'pontual' ? valor / 12 : valor` vivia em
**4 lugares**: `custoEvitadoMensalFromItens` (`saving-calc.ts`, fonte da verdade no submit/resync),
`custoProjetoMensalFromItens` (delega ao anterior) e **inline** no `iniciarSaving` (`chat.functions.ts`, 2×:
custo evitado e custo do projeto, na persistência ao entrar na fase de saving).

**Fix:** removida a divisão por 12 nos 4 pontos — pontual passa a somar `it.valor` cheio, igual a mensal. A
recorrência marcada (mensal/pontual) continua persistida e exibida como **rótulo** ("Custo Mensal ou Pontual"),
mas **não altera mais o valor**. `recomputarSavingFinanceiro` já usava `custo_evitado_reais` cheio (não mudou).
**Fora de escopo (não tocado):** custo externo ANUAL (`custoPeriodicidade === 'anual'`, `submeter.tsx`) segue
÷12 (conversão anual→mensal, legítima); trimestral/semestral seguem valor cheio do período.

**Onde aterrissou:** `src/lib/agents/saving-calc.ts` (`custoEvitadoMensalFromItens` + comentários de
`custoProjetoMensalFromItens`/`recomputarSavingFinanceiro`), `src/lib/chat.functions.ts` (`iniciarSaving`, 2
somas inline + comentários), comentários em `src/integrations/db/schema.ts` e `src/lib/agents/types.ts`,
testes `tests/saving-calc.test.ts` (asserções pontuais atualizadas: 6000→6000, 1200→1200, mistos recalculados),
docs (`CLAUDE.md`, `docs/business-rules.md`, `docs/database.md`). `worker.js` **rebuildado** (mexeu em
server-side).

**Retroativo (backfill) — `POST /api/admin/retroativo-custos-pontuais`** (`retroativoCustosPontuais`,
`chat.functions.ts`, requireAdmin). Corrige projetos já preenchidos com o ÷12. Body `{dry?:boolean}` — **dry
default TRUE** (só relata `{projetos, flagged, metodo}`; `dry:false` aplica). Idempotente. NÃO reusa
`resyncGoogle`/`syncSubmitToGoogle` (dispararia 1 notificação Chat por projeto = spam em prod); escreve direto
via `updateRowByProjectId` (batch parcial, sem Chat). Dois caminhos:
- **CASO A** — submetido pelo app (tem `custo_evitado_itens`/`custo_projeto_itens`): re-deriva dos itens (cheio)
  + `recomputarSavingFinanceiro` (exato); atualiza doc.saving + colunas SQLite + Sheet (Custo Evitado, Custo do
  Projeto, Saving Reais, Ganho Total, Memorial de Saving, Atualizado Em).
- **CASO B** — legado sem itens (só via sync do Sheet, sem doc.saving), custo evitado PONTUAL PURO (0h,
  `alguem_fazia='externo'`, sem custo externo/projeto → `saving_reais == custo evitado ÷12`): recupera o valor
  original da justificativa `R$ X (pontual)` (método 1) ou fallback `×12` (só puro). Legado pontual NÃO-puro ou
  com custo do projeto pontual → `flagged` (revisão manual — não arrisca isolar).
- Invocação: edge exige OAuth → precisa de cookie de sessão do ambiente (staging tem sessão própria; prod usa
  `E2E_COOKIE` de `godocs.devgogroup.com`).

**Validação staging (`edf400b4`):** retroativo aplicado — 2 legados corrigidos via justificativa
(`legado-100` 264,33→3171,96; `legado-149` 19,52→234,19), 0 flagged, idempotente (re-run = 0 afetados).

---

## 2026-06-30 — Submissão/edição trava com `ZodError` `docs[].base64 too_small` quando há arquivo VAZIO (0 bytes)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/arquivo-vazio-base64-submissao`

**Sintoma:** ao **Enviar Projeto** (reportado num projeto **especial** em edição), toast vermelho cru:
`Erro ao enviar projeto: [ { "code": "too_small", "minimum": 1, "type": "string", "message":
"String must contain at least 1 character(s)", "path": [ "docs", 18, "base64" ] } ]`. A pessoa fica presa.
Confirmado em produção com **Mário Gonzaga Monteiro** (projeto "Prazo Otimizado", reenvio de edição).
O índice (`docs[18]`) varia conforme a posição do arquivo problemático.

**Causa-raiz:** um dos arquivos enviados tinha **0 bytes** (vazio — ex.: `__init__.py`, `.gitkeep`,
config em branco, que é comum ao reenviar a **pasta inteira** do projeto). Para arquivo vazio,
`readFileAsBase64` (`submeter/constants.ts`) faz `result.split(",")[1]` sobre `"data:...;base64,"` →
retorna **`""`**. O backend valida cada doc com `z.object({ base64: z.string().min(1), ... })`
(`chat.functions.ts`, schemas de `iniciar-submissao` **e** `atualizar-metadados`) → o base64 vazio
**reprova o payload inteiro** (não só aquele arquivo) com `ZodError` → toast cru. O `addFiles` do
`step2.tsx` validava extensão, tamanho-máximo, duplicidade e pastas ignoradas, **mas nunca o piso de
tamanho** — arquivo de 0 bytes era aceito normalmente. Atinge submissão nova **e** edição (todos os
caminhos montavam `docs` do mesmo jeito).

**Fix — 2 camadas (causa-raiz + rede de segurança):**
1. **`step2.tsx` (`addFiles`) barra arquivos de 0 bytes na seleção** — ramo `file.size === 0` na cadeia de
   rejeição (junto de "sem extensão"/"formato"/"excede MB"), com contador `emptyCount`, log e
   **toast informativo** (`"N arquivo(s) vazio(s) (0 bytes) ignorado(s) — sem conteúdo para documentar"`).
   Arquivo vazio não tem conteúdo a documentar → descartá-lo não perde nada. É o ponto onde os arquivos
   entram em `arquivos` (única fonte do estado).
2. **`constants.ts` — `filesToDocs(files)` + `descartarDocsVazios(docs)`** (rede de segurança): centralizam a
   montagem do payload `docs` e **filtram qualquer `base64 ""` remanescente** antes de enviar. Os 4 call-sites
   de `submeter.tsx` (`handleIniciarAgente`, `handleEnviarEspecial` criação **e** edição,
   `reprocessarComNovosArquivos`) passaram a usar `filesToDocs` (DRY + garantia uniforme). No ramo de edição
   especial, `docs` vira `[]` quando não sobra nada → cai no `reset_doc` (reusa os arquivos já enviados, sem
   reupload), preservando o comportamento. `readFileAsBase64` também ganhou `?? ""` (defensivo) no split.

O backend permanece estrito (`base64.min(1)` é guard correto) — o conserto é client-side, para nunca
**enviar** um doc vazio.

**Onde aterrissou:** `src/lib/submeter/step2.tsx` (rejeição de 0 bytes), `src/lib/submeter/constants.ts`
(`filesToDocs`/`descartarDocsVazios` + `?? ""`), `src/routes/submeter.tsx` (import + 4 call-sites usam
`filesToDocs`), teste de regressão `tests/docs-vazios.test.ts` (`descartarDocsVazios`). `worker.js` não muda
(funções client-side, tree-shaken do bundle do worker — `areas.functions.ts` só importa `AREAS`).

**Recuperação (não-código):** nenhuma. Os dados do projeto do Mário estão intactos (a submissão só não
completou); após o deploy, ao reenviar a pasta o arquivo vazio é descartado automaticamente e a submissão
conclui. Não há backfill.

---

## 2026-06-30 — Edição de projeto ESPECIAL → saving/receita não desmarcava `especial` (flag sticky de mão única)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/edicao-especial-vira-normal`

**Sintoma:** pessoas editavam um projeto submetido como **especial**, trocavam para **saving operacional**
(ou receita), passavam por todo o fluxo e reenviavam — mas o projeto **voltava como especial**: a coluna
**"Especial?" do Sheets continuava "Sim"** e internamente seguia `especial=1`. Confirmado em produção com
`hugo.santana@gobeaute.com.br` (`legado-038`) e `oscar.filho@gocase.com` (`3d27a2e3…`). Log do Hugo:
`16:20:52 atualizar-tipos → saving` e 3 s depois `atualizarMetadados` logando *"Projeto especial
legado-038: doc reconstruída sem IA, pronto para reenvio"* — o backend ignorou a troca, rodou o chat
inteiro como `tipos: especial`, e o analyzer recebeu só ~900 chars de contexto (o memorial de saving do
Hugo **não foi capturado**; o do Oscar, com ~8000 chars, provavelmente persistiu, só preso na flag).

**Causa-raiz:** a flag `especial` era **sticky de mão única** — havia caminhos que a marcavam `true`, mas
**nenhum** que a voltasse a `false` numa edição. Dois pontos somavam:
1. **`atualizarTipos` (`chat.functions.ts`)** gravava `tipos_projeto`/`tipo_projeto` ao trocar para
   saving/receita, mas **não tocava em `especial`** → o projeto seguia `especial=1`.
2. **`atualizarMetadados` (`chat.functions.ts`)** fazia `ehEspecial = data.especial === true ||
   ctxData?.especial === 1`. Como o banco ainda dizia `especial=1`, ele **re-forçava
   `especial=true`/`tipo_projeto='especial'`/`tipos_projeto=['especial']`, reconstruía a doc especial sem
   IA e dava `return` antecipado** — ignorando a conversão e pulando a coleta de saving. O frontend
   (`submeter.tsx`) ainda mandava `especial: true` fixo (handler especial) ou **nada** (fluxo normal),
   então o backend nunca recebia o sinal de "deixou de ser especial". No submit, o status e a coluna
   "Especial?" derivam de `projeto.especial === 1` → subia "Sim".

**Fix — 3 camadas (à prova de ordem de chamada):**
1. **`atualizarTipos` zera `especial`** ao escolher um tipo financeiro (escolher saving/receita = não-especial):
   `updateProjeto(..., { tipos_projeto, tipo_projeto: tipos[0], especial: false })`. É o ponto onde o
   usuário declara a natureza do impacto.
2. **`atualizarMetadados` respeita `especial: false` EXPLÍCITO** — quebra a stickiness do `ctxData`:
   `ehEspecial = data.especial === true || (data.especial !== false && ctxData?.especial === 1)`; e quando
   `data.especial === false && ctxData?.especial === 1`, zera a flag no banco (belt-and-suspenders com a
   camada 1, cobre a ordem em que metadados chega antes da troca de tipos). `especial === undefined`
   preserva o comportamento antigo (chamadas internas/cron, legado→especial).
3. **Frontend (`submeter.tsx`)** passa `especial: form.especial` em **todas** as chamadas de edição de
   `atualizar-metadados` (antes umas mandavam `true` fixo, outras nada). `false` = sinal de conversão.

Além da flag, a conversão **limpa `contexto_especial`** (`= null`) nos dois pontos (`atualizarTipos` e o ramo
de conversão de `atualizarMetadados`): o contexto especial não descreve mais o projeto. Como a coluna
**"Contexto do Projeto Especial"** (`sync.ts:254`) é `ouTraco(p.projeto.contexto_especial)`, zerar o campo a
faz virar **"—"** — edição fidedigna ao novo tipo. _(reportado após o fix inicial: o `Especial?` virava "Não"
mas o contexto antigo sobrevivia na coluna.)_

Como a coluna "Especial?" (`sync.ts`) deriva de `projeto.especial`, zerar a flag no banco + re-sync de
IDA já reflete **"Não"** no Sheets — sem alteração no mapeamento.

**Onde aterrissou:** `src/lib/chat.functions.ts` (`atualizarTipos`, `atualizarMetadados`),
`src/routes/submeter.tsx` (5 call-sites de `especial:`), teste de regressão em
`tests/atualizar-metadados-especial.test.ts` (atualizarTipos zera especial; atualizarMetadados com
`especial:false` converte sem reconstruir a doc especial).

**Recuperação (não-código):** Hugo (`legado-038`) e Oscar (`3d27a2e3…`) — flag a destravar e, no caso do
Hugo, memorial de saving a reconstruir do timeline (`chat_messages`/`form_events`/`snapshot_chat`). Sem
backfill geral; só os dois casos reportados (decisão do dono).

---

## 2026-06-30 — Agente "delirando": repete a MESMA pergunta da carga real (loop no gate de saving)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/loop-carga-real-contestacao-total`

**Sintoma:** vários clientes relataram, na **validação de saving**, o agente "delirando" e repetindo
**verbatim** a mesma pergunta do split carga real × escala. Caso da captura: total calculado em
`0.5h/mês` (a partir de "5 min por dia para cada colaborador"); o gate pergunta "dessas **0.5h/mês**,
quantas a pessoa realmente fazia à mão?"; o usuário responde **"eu disse que era 5min por dia pra cada
colaborador. isso não é 0.5h por mês"** (corrigindo o TOTAL) → o agente repete a pergunta IDÊNTICA.
Usuário preso, sem saída. Recorrência de um problema "já resolvido" antes.

**Causa-raiz (duas, somadas):**
1. **O gate determinístico não tinha saída para CONTESTAÇÃO do total.** Na branch
   `carga_escala === 'pendente'` (`chat.functions.ts`/`enviarMensagem`), quando
   `interpretarCargaReal` devolve `null`, o backend **re-perguntava a mesma coisa SEM chamar o
   orquestrador**. A correção do usuário (que dizia que o *total* 0.5h estava errado, não a carga
   real) nunca chegava ao LLM que poderia recalcular → loop infinito.
2. **`interpretarCargaReal` destruía decimais** (`orchestrator.ts`): `.replace(/\./g, '')` tratava
   todo `.` como separador de milhar, então `"0.5"` → `"05"` → `5`, `"1.83"` → `183`. O próprio
   agente EXIBE "0.5h/mês" com ponto — qualquer resposta com decimal já entrava quebrada (virava
   `> total` → `null` → re-pergunta).

**Fix:**
- **(A) Parser pt-BR robusto `parseNumeroPtBR`** (`orchestrator.ts`, exportado/testável): `,` sempre
  decimal; `.` decimal por padrão (`0.5`→0.5, `1.83`→1.83), só vira milhar quando inequívoco (vários
  pontos, ou 1 ponto com exatamente 3 dígitos e inteiro ≠ 0 → `1.234`→1234). Usado em
  `interpretarCargaReal`.
- **(B) Escape do loop** (`chat.functions.ts`, branch do gate): novo predicado puro
  `contestaTotalCargaReal` (valor "por dia"/"por execução"/min/seg, correção explícita "está
  errado"/"não é isso", ou nº claramente acima do total) — com **precedência** sobre
  `interpretarCargaReal`. Quando o usuário contesta (ou não dá nº usável), o backend **reseta o estado
  do gate** (`carga_escala=null`, zera `horas_carga_real/escala`), injeta o nudge `[SISTEMA]`
  **`nudgeRecalcularCargaEscala`** (manda o LLM RECALCULAR o total a partir do que o usuário
  descreveu — ex.: min/dia × dias úteis × nº de pessoas — ou ajudar a quantificar) e **devolve o
  controle ao orquestrador** em vez de repetir a pergunta. A garantia do split não se perde: o **gate
  de preview** (mais abaixo, `carga_escala !== 'ok'`) reconduz a pergunta com o total já corrigido.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (`parseNumeroPtBR`, `contestaTotalCargaReal`,
`interpretarCargaReal`), `src/lib/chat.functions.ts` (branch `carga_escala==='pendente'` +
`nudgeRecalcularCargaEscala`), `tests/saving-carga-escala.test.ts` (decimais, parser, contestação).

**Decisão de design:** o gate determinístico continua GARANTINDO que o split seja perguntado (via gate
de preview), mas deixou de ser uma armadilha — quando o usuário discorda do número, o LLM volta ao
comando para recalcular. Não há loop infinito possível: contestação/resposta-sem-nº sempre escala
para o orquestrador; a captura determinística só ocorre quando há um nº de carga real plausível.

---

## 2026-06-30 — "Tipo de Receita" (e "Tipo de Saving") em branco no Sheets — erosão de `tipo_saving` pelo echo do LLM

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/tipo-receita-preserva-form`

**Sintoma:** projeto `legado-260` ("Ticketsense gocase", linha 234 da planilha), editado como
saving **e** receita, salvou com a coluna **"Tipo de Receita" = "—"** (em branco). Na auditoria, o
`documentacao.conteudo.receita` estava `{ "valor_ganho_mensal": 1489.5, "tipo": "mensal",
"memorial_calculo": "## Memorial de Saving ..." }` — periodicidade na chave errada (`tipo` em vez de
`tipo_saving`) e a receita poluída com dados de saving (ver "Nota" abaixo).

**Causa-raiz:** `tipo_saving` (a periodicidade mensal/pontual/tri/semestral) é uma escolha do
**formulário** (definida em `iniciarSaving`/`iniciarReceita`), não algo que o LLM colete. Mas o
orquestrador (`orchestrator.ts`, parse do resultado) fazia `receita: (parsed.receita) ?? receita` —
**adotava o objeto ecoado pelo LLM inteiro**. O LLM frequentemente (a) **omite** `tipo_saving` no
echo, (b) devolve a receita como `{}`, ou (c) usa a chave legada `tipo`. Em qualquer caso
`tipo_saving` virava `undefined/null`, e como `extrairEstado` lê sempre a **última** mensagem do
assistant, o null **se propagava** por todos os turnos seguintes até o `complete` → `doc.receita`
(`chat.functions.ts:1311`) → submit → coluna "Tipo de Receita" vazia. O `saving.tipo_saving` tinha a
**mesma** vulnerabilidade (linha gêmea), só não aparecia tanto porque o prompt de saving ecoa o campo
com mais disciplina.

**Fix:** no `orchestrator.ts`, ao montar o `result`, `tipo_saving` deixa de vir do echo do LLM e passa
a ser **preservado do estado de entrada (form = fonte da verdade)** para saving e receita:
`tipo_saving: <entrada>.tipo_saving ?? <echo>.tipo_saving ?? <alias tipo do echo> ?? null`. Como a
preservação roda em **todo** turno do orquestrador (chamado por `iniciarReceita`/`iniciarSaving`/
`enviarMensagem`), o valor do form nunca mais é zerado por um echo desleixado, e o caso `{}` também
fica coberto (cai no valor de entrada). O alias `tipo` é rede de último recurso para estados já
erodidos. Determinístico, sem depender do prompt.

Além da erosão de `tipo_saving`, o `legado-260` revelou um problema **de produto** maior: o usuário
**não foi barrado** ao submeter como receita mesmo depois de o agente concluir que era saving. No chat,
o agente questionou os R$15 mil de receita (potencial não comprovado), o usuário concordou e pediu para
reclassificar como saving — mas isso aconteceu **dentro da fase de receita**: o agente coletou o saving
ali mesmo (1h30/dia → R$1.489,50) e completou, gravando um **"## Memorial de Saving" no slot de
receita**. Não havia gate determinístico (a) forçando a reclassificação nem (b) checando a completude
da receita antes do submit (o gate de "ganho zero" não pegou porque havia valor e o saving já deixava o
total positivo). Resultado: dado pela metade + saving disfarçado de receita.

**Fix — 3 camadas (todas determinísticas, no padrão dos gates de saving):**
1. **`tipo_saving` preservado do form** (`orchestrator.ts`, montagem do `result` em `runOrchestrator`):
   deixa de vir do echo do LLM — `tipo_saving: <entrada>.tipo_saving ?? <echo>.tipo_saving ??
   <alias tipo do echo> ?? null`, para saving e receita. Roda em **todo** turno (chamado por
   `iniciarReceita`/`iniciarSaving`/`enviarMensagem`), então o form nunca mais é zerado por um echo
   desleixado, e o caso `{}` fica coberto. Alias `tipo` = rede para estados já erodidos.
2. **Backstop de reclassificação no chat** (`enviarMensagem`): predicado puro `receitaMemorialEhSaving`
   (`orchestrator.ts`) detecta um memorial salvo no slot de receita que é saving / "não aplicável" /
   "reclassificado como saving". Quando bate, o backend **bloqueia o preview/complete da receita**,
   zera o memorial saving-shaped e devolve uma pergunta-guia (`MSG_RECLASSIFICAR_RECEITA`) mandando
   trocar o tipo do projeto para Saving — mantendo a fase em `receita`. Prompt sozinho não segurava.
3. **Gate de completude no submit** (`submeterParaValidacao`): projeto `receita_incremental` só submete
   com `valor_ganho_mensal > 0` **+** `tipo_saving` preenchido **+** memorial de receita não-vazio e
   não saving-shaped (mesmo predicado). Rede determinística final.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (preservação de `tipo_saving` no `result`;
predicado `receitaMemorialEhSaving`); `src/lib/agents/chat.functions.ts` (backstop em `enviarMensagem`;
gate de completude em `submeterParaValidacao`; const `MSG_RECLASSIFICAR_RECEITA`); testes em
`tests/orchestrator-prompts.test.ts` (4 — preservação de `tipo_saving`) e `tests/receita-memorial-saving.test.ts`
(6 — o predicado); `worker.js` rebuildado.

**Pendente (decisão de produto, fora deste fix):** a **correção retroativa da linha 234** do `legado-260`
no Sheets (a receita lá é um saving deslocado — periodicidade do form = mensal). Aguarda decisão da
equipe na validação (o projeto está "Pendente").

---

## 2026-06-29 — Gate de complexidade por IA (`tem_ia_como_funcionalidade`) MORTO em produção

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `docs/spec-complexidade-autonomia`

**Sintoma:** o gate determinístico documentado — "a resposta explícita do usuário sobre IA como
funcionalidade tem PRECEDÊNCIA sobre o `usa_ia` inferido pelo LLM" — **nunca disparava**. Na prática,
quem classificava a complexidade era **só** o `usa_ia` inferido; a resposta do usuário não tinha efeito.
Achado durante a revisão da redefinição de autonomia (ver [SPEC_COMPLEXIDADE_NIVEIS.md](SPEC_COMPLEXIDADE_NIVEIS.md), G0).

**Causa-raiz:** o sinal `tem_ia_como_funcionalidade` é coletado na fase *doc* e vive em `coletado`
(estado do orquestrador / JSON do `chat_messages`). Mas, na aprovação da doc, `compilarDocumentacao`
gera um `DocumentacaoGerada` cujo schema **não inclui** esse campo, e `upsertDocumentacao` persiste só
esse objeto. O analisador lê `documentacao.conteudo` (`getDocumentacao`, um `SELECT *` puro) — então
`conteudo.tem_ia_como_funcionalidade` chegava sempre `undefined → null`, e os gates de precedência
(`analyzer.ts`) eram código morto. Os testes só checavam string do prompt — nunca exercitavam o gate
com `conteudo` persistido real, então o bug passou batido.

**Fix:** em `chat.functions.ts`, na transição `doc_preview → saving/receita`, o `tem_ia_como_funcionalidade`
de `resultado.coletado` é carregado para o objeto persistido via `upsertDocumentacao` (spread sobre a
doc compilada). O merge da fase `completo` relê o `conteudo` já com o sinal e o preserva. Edições passam
pelo mesmo caminho. Legados/especiais (sem coleta) seguem `null` → inferência do LLM (retrocompat).

**Onde aterrissou:** `src/lib/chat.functions.ts` (upsert da doc aprovada). Cobertura indireta pelos
testes de `normalizarComplexidade` (precedência do `tem_ia` sobre `usa_ia`) em `tests/analyzer-complexidade.test.ts`.

---

## 2026-06-29 — "Saving Horas Escalado" sempre 0 p/ contrafactual + zeros ambíguos + splits inválidos

**PR:** _(a abrir)_ · **Status:** 🔧 implementada, em revisão · **Branch:** `fix/split-nao-contrafactual`

### Parte B — auditoria dos splits capturados: números inválidos / mal classificados

**Sintoma:** o chefe achou estranhos alguns valores de Real/Escalado **já preenchidos**. Auditei as
**26 linhas com split capturado** na planilha de produção.

**Achados:** a soma `Real+Escalado = Total` bate em todas (sem erro aritmético); o problema é
**semântico**, concentrado em **Escalado > 0** (quando o agente tenta *dividir*):
- 🔴 **`f4dd86…`** (`107.8h · real=108.2 · esc=0`): **carga real MAIOR que o total** (impossível) +
  conta errada no texto (49+73,6 ≠ 108,2). Caso "fez tudo" → real deve ser ≤ total. **Erro de número.**
- 🟠 **`legado-189`** (`22h · real=22 · esc=0`): os **números já estavam certos** (fez o volume todo),
  mas a **justificativa narrava** *"~1h por dia → 1h real / 21h escala"* — **inconsistência texto × número**
  por confusão dia × mês no raciocínio do agente. Justificativa corrigida; números mantidos.
- 🟡 **`legado-231`** (1/10) e **`faff95…`** (6/26): escala 91%/81% mal fundamentada (questionáveis,
  deixados p/ o time confirmar).
- ✅ Os 13 casos `'sim'` com escala 0 (fez o volume todo) e os 6 `'nao'` (100% escala) estão corretos.

**Causa-raiz:** o gate aceitava o nº da carga real **sem validar** e derivava `escala = total − real`
mecanicamente. Sem checagem de plausibilidade, "1h/dia" virava real=1 (escala fantasma); e o caminho
"split capturado pelo LLM" aceitava `real > total` (só conferia a SOMA, com tolerância 1h).

**Fix (trava de plausibilidade — "corrigir o agente que classifica errado"):**
- **`precisaConfirmarEscala(real,total)`** (`orchestrator.ts`, `LIMITE_ESCALA_ALTA=0.6`): escala ≥60%
  do total → exige **confirmação** (novo estado `carga_escala='confirmar_escala'`). 3 opções:
  confirma a escala / "fazia o volume todo" (→ real=total) / "corrigir" (reabre a pergunta).
- **Clamp `real ≤ total`** no caminho LLM-capturado (re-deriva a escala) → mata o `real>total`.
- **Pergunta da carga real reforça "total no MÊS, não por dia"** (`perguntaCargaEscala`).
- Pega `189` (escala 95% → confirma/corrige), `f4dd86` (clamp), e sinaliza `231`/`faff95`.

**Dados existentes:** os 2 erros claros (`legado-189`, `f4dd86`) foram corrigidos direto na planilha
para `real=total / escala=0` (colunas de transparência — não afeta R$). Durável quando reeditados
pós-deploy. Os 2 questionáveis ficaram p/ revisão do time RPA.

### Parte A — contrafactual ('nao') gravava 0/0 + zeros ambíguos

**Sintoma (relatado pela gestão):** o chefe estranhou a **veracidade** das colunas "Saving Horas
Real"/"Saving Horas Escalado". Dois pontos: (1) projetos onde **ninguém fazia** (`alguem_fazia='nao'`)
não tinham as horas contadas como escala; (2) **muitos** projetos com `alguem_fazia='sim'` saíam com
**Escalado=0** — parecia que a feature não media nada.

**Diagnóstico (planilha de produção, 298 linhas, fora E2E):**
- 213 linhas (71%) são **legado** com "Alguém Fazia?" vazio → split `0/0` (nunca passou pelo gate).
- `'sim'` (63): **60 com Escalado 0/null**. Destes, ~19 são **zeros legítimos** (a pessoa fazia o
  volume TODO à mão → escala 0 correta) e ~43 têm **AMBOS null** = split **nunca capturado** (legado
  + submissões pré-feature de 19–24/06). Para submissões **novas (25/06+) o gate captura** o split
  corretamente — a feature em si é confiável para o fluxo novo.
- `'nao'`/`'não'` (22): real sempre 0; **~6 linhas com Escalado=total** e justificativa manual
  ("Como Alguém Fazia=Não, todo o saving é escala") — **incoerente com o código**, que força 0 para
  `'nao'`. Eram preenchimentos manuais compensando a ausência da regra.

**Causa-raiz:** (a) **Coerência do `'nao'`** — `temSplit` em `sync.ts` exigia `alguem_fazia==='sim'`,
então contrafactual gravava `0/0`. Mas, por definição, **ninguém fazia à mão ⇒ carga real 0 e 100%
do saving é ganho por escala** → o esperado é `Real=0, Escalado=total`. (b) **Zeros ambíguos** — a
coluna numérica colapsa três situações no mesmo `0`: "sem escala" (real=total, legítimo), "não medido"
(legado/pré-feature, null→0) e contrafactual. Só a coluna de justificativa (vazia nos não-medidos)
desambiguava.

**Fix:** regra do `'nao'` virou **derivação determinística** (decisão de produto, Luis 29/06/2026:
`'nao'` → 100% escala). Helper puro `derivarSplitHorasSheet(alguemFazia, saving)` em `sync.ts`:
`'sim'` usa o split capturado pelo gate; **`'nao'` → `Real=0, Escalado=total`**; `'externo'`/legado-
sem-split/pontual → `0/0` (sem dado medido, não inventa). Roda em `syncSubmitToGoogle`, que é o
caminho de **submissão nova E de edição/resync** → vale **daqui pra frente** sem backfill (zeros
antigos só mudam quando o projeto for editado — decisão do dono). A justificativa do `'nao'` ganhou
fallback próprio em `derivarJustificativaCargaEscala` (em vez de "—" ao lado de um Escalado cheio).
⚠️ O **gate do chat** (`aplicaSplitCargaEscala`) **continua só `'sim'`** — no contrafactual não há o
que perguntar; a regra do `'nao'` é pura derivação no sync.

**Onde aterrissou:**
- `src/lib/google/sync.ts` — novo `derivarSplitHorasSheet` (exportado) + uso em `syncSubmitToGoogle`
  (substitui o `temSplit` inline).
- `src/lib/chat.functions.ts` — `derivarJustificativaCargaEscala`: branch `'nao'` (justificativa
  "100% escala").
- `tests/sync-padronizacao.test.ts` — 5 casos de `derivarSplitHorasSheet`.
- `CLAUDE.md` (seção carga×escala) + `SPEC_FEATURES_NOVAS.md` (F4) atualizados. `worker.js` rebuildado.

**Notas / não-regressão:**
- **NÃO** altera `saving_reais`/`ganho_total`/`linhas` — F4 segue: o TOTAL é o que vira R$ (decisão
  fechada). As colunas do split são só transparência.
- `aplicaSplitCargaEscala` e o prompt do gate ficam intactos → `tests/saving-carga-escala.test.ts`
  segue verde (`'nao'`/`'externo'` ainda FALSE no gate de conversa).
- Sem migração/coluna nova; sem backfill (decisão do dono — propaga por edição).

### Parte C — gate da carga real não entendia "100%" / "nada escalado"

**Sintoma (reportado, com print):** ao responder o gate da carga real com **"100% das horas eram na
mão"** (= tudo manual, nada escalado), o agente **não entendia e perguntava de novo** — o usuário
ficava repetindo algo que já tinha respondido.

**Causa-raiz:** `interpretarCargaReal` só reconhecia `tudo`/`o total` ou um **número de horas**. "100%"
caía no parser de números → **"100" > total** (ex.: total 35h) → rejeitado → `null` → **re-pergunta**.
E não havia tratamento para "nada escalado"/"sem escala"/"tudo na mão".

**Fix:** `interpretarCargaReal` movida p/ `orchestrator.ts` (pura/testável) e ampliada — reconhece, em
ordem: (1) **porcentagem** ("100%", "50% na mão", "100 por cento" → fração do total; última % vence,
cobre "não era 100%, era 50%"); (2) **"nada/sem/nenhuma escala"** e **"não foi escalado"** → carga real
= total; (3) "fez tudo à mão / tudo manual / volume todo / tudo real" (com guard de negação — "não fazia
tudo" NÃO vira total); (4) números (como antes). Também corrigido um **bug de tipo+lógica** no
`interpretarConfirmacaoEscala` do novo sub-gate: `selected_option` é índice **1-based** (`z.number()`),
não a string da opção — casava por `indexOf(string)` e os **botões nunca bateriam**. 6 testes novos
(`tests/saving-carga-escala.test.ts`), incl. o caso exato do print.

---

## 2026-06-26 — Edição de legado reiniciava a doc ao voltar da parte determinística

**PR:** #168 · **Status:** ✅ mergeada + deployada · **Branch:** `fix/reset-doc-edicao-legado`

**Sintoma (relatado):** uma usuária entrou para **editar um projeto legado**, passou da fase de
doc, preencheu a parte determinística e, já no chat com a IA, lembrou que precisava **adicionar
um analista** e voltou à parte determinística. Ao avançar de novo para o chat, **o sistema
reiniciou TUDO desde a doc** — como se a documentação tivesse mudado — e ela **teve que enviar os
arquivos novamente** (perdendo o saving já preenchido).

**Causa-raiz:** desync entre `arquivos: File[]` e `agentArquivosSig` em `handleContinuarAgente`
(`src/routes/submeter.tsx`). A detecção de "arquivos mudaram" era
`arquivosSig() !== agentArquivosSig`. Quando a página **remonta no meio da edição** (recurso
"reload não perde o chat"), o `rehydrateFromLocal` **restaura `agentArquivosSig`** do rascunho
(ex.: `"arquivo.json:11975"`), mas o `arquivos: File[]` **não pode ser restaurado** — objetos
`File` não serializam para o localStorage (não estão no `DraftSnapshot`). Resultado:
`arquivosSig()` vira `""`, a comparação dá "mudou" falsamente e força o reprocesso da doc.
Específico de **legado** porque legado **obriga upload** na edição (não tem doc/`arquivos_nomes`
prévios), então `agentArquivosSig` sempre fica preenchido — projeto já documentado não sobe
arquivo e não desincroniza. Como `reprocessarComNovosArquivos` é no-op sem `File[]`
(`if (arquivos.length === 0) return;`), o primeiro "Continuar com Agente" pós-remontagem só
**travava** (early-return, sem chamada ao servidor → invisível nos logs); para destravar, a
pessoa reenviava o arquivo, e aí o reprocesso rodava de verdade e zerava a doc + o saving.

**Fix:** só disparar a detecção quando há arquivo NOVO de fato — guard `arquivos.length > 0`:

```js
if (projetoId && arquivos.length > 0 && arquivosSig() !== agentArquivosSig) {
  await reprocessarComNovosArquivos();
  return;
}
```

Sem upload novo (inclusive pós-reload) → não reprocessa, segue o fluxo normal (reabre o form de
saving / preserva o chat). Com upload real → `arquivos.length > 0` + assinatura diferente →
reprocessa corretamente (comportamento legítimo mantido).

**Onde aterrissou:**
- `src/routes/submeter.tsx` — `handleContinuarAgente`: guard `arquivos.length > 0` nas DUAS
  detecções de troca de arquivos (ramo **padrão** e ramo **projeto especial**).
- Frontend-only (não toca `worker.js`/backend). Sem migração, sem coluna nova.

**Notas / não-regressão:**
- Diagnóstico só por código: a janela de logs do Godeploy (~1,5h) não capturou o incidente
  (variante "travada" não faz request); o padrão de risco aparece (ytalo.ferreira editando
  legado-194/196 com upload de arquivo).
- Sem teste unitário novo: a lógica é inline no componente e a base de testes é node-only (sem
  testing-library/jsdom). `reprocessarComNovosArquivos` continua com o early-return defensivo.

---

## Sync reverso desatualizado: `especial` preso e órfão "cinza" (caso Helen)

**Sintoma (2 relatos, 30/06/2026):**
1. **Status cinza** em "Meus Projetos" — `legado-148` ("AVD Central") existia no SQLite mas
   **não tinha linha no Sheet**; como o status na lista vem **só do Sheets**, sem linha → `null`
   → badge cinza ("—"). Não saía nunca.
2. **Especial preso** — `AVD Central v2` (`e4b1dcc3…`) estava `Especial?=Não` + saving completo
   (112h) no **Sheet**, mas no **SQLite** ainda `especial=1`/`tipos_projeto=['especial']`/
   `contexto_especial` cheio. Abria no fluxo de edição ESPECIAL errado e, ao trocar p/ não-especial
   no form, não puxava o saving (seed dava `tipoProjeto=[]`).

**Causa:**
1. `carimboMs` (carência da `reconciliarExclusoes`) usava `Date.parse`, que lê `submitted_at`
   pt-BR `"12/05/2026"` como **MM/DD → 5/dez/2026 (FUTURO)**. `agora − carimbo` < 0 → sempre
   "dentro da carência de 1h" → órfão **nunca** reconciliado. Pega qualquer legado órfão com
   `submitted_at` de **dia ≤ 12** (vira mês válido ao trocar).
2. O sync reverso **não propagava** `especial` nem `tipos_projeto` (só `contexto_especial` estava
   em `SAFE_UPDATE_FIELDS`, e o loop pula "—" porque `txt()→null`). O bug do "especial sticky"
   (pré-PR #181) deixou o SQLite preso, e o Sheet dizer "Não" nunca desfazia.

**Fix (`src/lib/google/sync-reverse.ts`):**
- `carimboMs` passa a usar `parseDataFlexivel` (lê `dd/mm/yyyy` corretamente) em vez de `Date.parse`.
- `atualizarExistente` reconcilia o tipo do projeto a partir do Sheet (fonte da verdade):
  `parseEspecialFlag('Especial?')` (1|0|**null** p/ vazio = não mexe); ao virar **não-especial**,
  deriva `tipos_projeto`/`tipo_projeto` de "Tipos Projeto" e **zera `contexto_especial`**; ao virar
  especial, `tipos=['especial']`.

**Onde aterrissou:**
- `src/lib/google/sync-reverse.ts` (`carimboMs`, `parseEspecialFlag`, `atualizarExistente`).
- `tests/sync-reverse.test.ts` — +3 casos (flip especial→não, "Especial?" vazia não apaga, órfão
  pt-BR removido com `vi.setSystemTime`). 489 testes verdes.

**Recuperação de dados (prod, via forçar sync):** `POST /api/admin/sync-sheets-now` rodou o novo
código: `e4b1dcc3` auto-curou (`especial=0`, `tipos=['saving']`, contexto null); `legado-148` (+
`legado-126` + 1 teste) removidos como órfãos. 0 órfãos restantes. Validado **ponta a ponta no
staging** (criar especial → flip p/ "Não" no Sheet → sync desmarca) antes do prod (regra 13).

**Notas:** decisão do dono — para a `AVD Central v2` foi só o fix de sync (não o replay completo),
então a doc segue sem `saving.linhas`; ao reeditar, a Helen refaz o saving no chat (o flag/tipo já
estão certos). A regra "Sheets é o banco principal; SQLite espelha em quase-tempo-real" guiou a
escolha.
