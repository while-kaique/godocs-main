# Plano — Fatia C: reordenar o wizard (doc paralela, refino no final)
**Status:** ✅ aprovado (Luis, 31/08 — "aprovado. Pode dale.")

## Decisão de UX FECHADA (Luis, 31/08) — o refino da doc no fim é o comportamento de HOJE, reposicionado
O refino da doc no final **NÃO é fase nova nem obrigatória**: é a fase de doc que já existe, com a lógica condicional dela **intacta**, movida para depois de saving/receita. Depois que a doc compila (em background, desde o anexo):
- **Doc completa** → vai direto ao **card de aprovação** (aprovar + pedir ajuste). Sem conversa.
- **Doc incompleta** → o **agente pergunta** para tirar dúvida (igual hoje) e só então libera a aprovação.
Quem decide se pergunta ou não é a **completude da doc** (lógica existente do orquestrador), não o usuário. A única mudança é o **quando**: no fim, sobre a doc já compilada, em vez de no começo travando com a tela branca. **Ordem confirmada:** anexo → doc compila em bg (não trava) → **saving/receita primeiro (todos os gates)** → doc pronta → refino SE necessário ou aprovação direta → submit. Resolve o A×B do rascunho: nem A puro nem B puro — **reusar a fase de doc existente, condicional, no fim**.

**Objetivo:** Tirar a documentação do caminho crítico da submissão reordenando o fluxo guiado — a doc compila em paralelo desde o anexo, o usuário responde `saving`/`receita` primeiro (com todos os gates), e o refino conversacional da doc acontece por último, sobre a doc já compilada. Fecha os ~44s de tela branca que sobram (o `complete` não-streamado do `doc_preview`), sem o usuário perder o refino guiado da doc.

## Contexto — o que já está pronto (reusar, não refazer)
- **A+B em PROD** (`origin/main` PR #307, v312): doc compilada em `runBackground` + modelo leve no extrator/compilador (`doc-async.ts`, `doc-modelo.ts`, `dispararDocBackground`). Plano-fonte: `docs/plans/submissao-doc-fora-do-caminho-critico.md` (§3 item C = esta fatia; o arquivo pode dizer "rascunho" por estar num branch stale — A+B foram executados).
- **Fluxo direto de liderança = template** (`podeFluxoDireto`/`fluxo_direto` em `chat.functions.ts`, `src/lib/submeter-direto.ts`, `handleContinuarDireto`/`modo_direto` em `submeter.tsx`): já compila a doc numa passada e pula o chat, indo ao formulário determinístico. A fatia C reusa o padrão de compilar-em-paralelo, mas MANTÉM a fase conversacional de saving/receita (gates) e ADICIONA um refino conversacional de doc no fim.

## Decisão de produto (fechada — Luis, 29/08)
Doc compila em **paralelo** às perguntas determinísticas; refino conversacional da doc **no FINAL**, sobre a doc já compilada. Nova ordem: extrator + compilação em bg desde o anexo → `saving`/`receita` (mantendo TODOS os gates) → refino conversacional da doc → submit.

## Fronteiras (não exceder) — defaults a confirmar na aprovação
- Só **submissão NOVA + projeto padrão**. Edição (`/editar/$id`), especial e liderança ficam FORA (edição re-seeda a doc; especial e liderança já pulam o agente).
- Durante saving/receita: indicador discreto "documentação sendo preparada"; falha na compilação → fallback determinístico (`buildDocEspecial`), refino no fim resolve.
- Refino no fim mantém a fase conversacional da doc (agente pergunta/ajusta), só reposicionada.
- NÃO mexer nos gates de saving (jornada/teto/≥44h/alocação/ganho projetado/sobreposição), no analisador, nem no contrato do envelope de streaming.

## Design FECHADO na sessão /ggsd:code (31/08, grounded no worktree)
- **Flag:** `reorderDocFinal()` (env `REORDER_DOC_FINAL`, LAZY, default OFF = byte-idêntico) em `doc-async.ts`, ao lado de `docCompilacaoAssincronaAtiva`. O CALLER (`chat.functions.ts`) lê a env e passa o booleano via `streamOpts.reorderDocFinal` de `runOrchestrator` (orquestrador não lê env; testes passam o booleano direto). ⚠️ Reorder **exige** bg-compile → quando `REORDER_DOC_FINAL` liga, `DOC_COMPILE_ASYNC` também deve estar ligado (staging seta os dois).
- **Q1 RESOLVIDA — Opção B durável:** `iniciarSubmissao` (reorder) grava no blob `{...placeholderDocPendente(coletadoInicial), coletado_inicial: coletadoInicial}`. `coletado_inicial` **sobrevive** ao `mergeDocCompilada` (só apaga `compilacao_pendente`/`coletado_pendente`; `soCamposDaDoc` idem). `iniciarSaving`/`iniciarReceita`: quando `extrairEstado` volta vazio (`coletadoVazio`), fallback lê `coletado_inicial` do blob. Flag OFF: chat tem coletado → blob sem `coletado_inicial` → **zero mudança**. Sem msg-fantasma na UI (risco da Opção A descartado).
- **Q2 RESOLVIDA — refino reusa a fase `doc`:** transições invertidas sob flag via `proximaFase` (nova função PURA, unifica o mapa duplicado em `orchestrator.ts:1691-1699`↔`1744-1753`). Nova cadeia: `saving→saving_preview→(receita→receita_preview→)doc(refino)→doc_preview→completo`. Reorder: `saving_preview`✓→`hasReceita?receita:doc` · `receita_preview`✓→`doc` · `doc_preview`✓→`completo`. Refino condicional já existe (seed "PREVIEW DIRETO" com 7 campos, `orchestrator.ts:1491-1492`).
- **Compilação da doc migra de gatilho:** hoje compila em `enviarMensagem` no `doc_preview→saving/receita` (`chat.functions.ts:2361-2403`). Reorder: compila em BG no `iniciarSubmissao` (anexo). No `doc_preview→completo` do refino, RECOMPILA (bg via placeholder) **só se** o refino mudou o coletado (compara `resultado.coletado`×`coletado_inicial` do blob); igual → usa o blob já compilado. `reconciliarDocSePendente` no submit segue como rede (não reimplementar).
- **Frontend (T4):** reorder → após Etapa 2.5 abre o **formulário de saving direto** (padrão de `handleContinuarDireto`, mas mantendo a fase CONVERSACIONAL com gates — NÃO `modo_direto`); `dispararDocBackground` no anexo vira o gatilho do bg-compile; soltar o `await bgPromiseRef`; `docConcluida`/`chatFase` inicial deixam de assumir `doc`.

## Tarefas
> Preenchidas do mapa do explorador `a8f09057b7e6bb769` (30/08, confiança 0.72). ⚠️ **Linhas referenciam `origin/main` (PR #307/v312)**, não esta branch stale — o worktree da fatia C SAI de `origin/main`.

- **T1 — Máquina de fases (orquestrador).** Inverter as transições automáticas de fase em `orchestrator.ts:1738-1753` (+ o fallback espelhado `1687-1700`) de `doc→financeiro→completo` para `financeiro→doc(refino)→completo`: `saving_preview|receita_preview` + `complete` passa a promover `→"doc"` (refino) `→doc_preview→completo`. Semear o system prompt do refino (`buildDocPrompt`, via switch `1456-1477`) com a doc JÁ compilada. (guarda: `tests/orchestrator-prompts.test.ts` — novo caso de transição financeiro→doc)
- **T2 — `iniciarSubmissao` não abre mais a fase `doc` (backend).** No ramo comum (`chat.functions.ts:~893-911` origin/main), trocar `runOrchestrator(fase "doc")` por: gravar placeholder + `runBackground(compilarEPersistirDoc)` (infra A+B reusada) + **persistir o `coletadoInicial` do extrator** onde `extrairEstado` (`~402`) o leia sem a fase doc ter rodado, e retornar já na fase `saving`. ⚠️ **Ponto de acoplamento** (lacuna do explorador — mecanismo a decidir: msg assistant sintética × campo novo). (guarda: `tests/doc-async*.test.ts` estendidos)
- **T3 — Refino de doc pós-financeiro + garantia no submit (backend).** Nova transição fim-do-financeiro → fase de refino de doc; a garantia de doc no submit já existe (`reconciliarDocSePendente`, `~3593`) e protege o analisador — não reimplementar. Definir o comportamento da transição quando a doc ainda está pendente (esperar/reconciliar). ⚠️ **Design aberto** (lacuna). (guarda: `tests/doc-async-submit.test.ts`)
- **T4 — Frontend step 3 (`submeter.tsx`).** Após Etapa 2.5, abrir o formulário de saving direto; refino de doc por último; **soltar o `await bgPromiseRef`** (`~1628-1636`) trocando por indicador discreto "documentação sendo preparada"; ajustar `dispararDocBackground` (`~1362-1456`) e as transições do chat (`~2254-2290`, `~2438-2516`) para a fase inicial `saving`. (guarda: `tests/submeter-stream-callsites.test.ts`)
- **T5 — Sandbox `/fluxos` (`demo-backend.ts:~134-231`).** Reescrever a sequência da state machine do fluxo normal para a nova ordem (saving primeiro, refino de doc por último). Dev-only, guardado pela suíte.
- **T6 — Testes** (novos casos das T1–T5) + suíte verde + smoke.
- **T7 — `build:worker`, deploy STAGING (`edf400b4`)**, medir TTFT/tempo do turno antes×depois, validar doc final íntegra no Drive/analisador (regra 13).
- **T8 — Prod (`674a3710`) + merge no `main`** (regra 14) + `worker.js` commitado (regra 1) + CLAUDE.md/specs.

## Critérios de aceitação (rascunho)
1. Submissão nova padrão: usuário responde saving/receita antes de qualquer conversa de doc; o refino da doc aparece por último, sobre a doc já compilada; submit garante doc completa.
2. Sem regressão nos gates de saving/receita nem no analisador; doc final íntegra no Drive/analisador.
3. Sem os ~44s de espera em branco do turno de aprovação da doc.

## Blast-radius — **ALTO** · confiança **média (0.72)** (explorador `a8f09057b7e6bb769`, 30/08)
⚠️ **Todas as linhas referenciam `origin/main` (PR #307/v312); esta branch está STALE** (`doc-async.ts` não existe aqui; `chat.functions.ts` ~244 linhas menor). **O worktree da fatia C DEVE sair de `origin/main`.**

**Arquivos:**
- `orchestrator.ts` — transições de fase `1738-1753` (inverter) + fallback `1687-1700` (espelha) · `buildDetalhesAprovados` `180-197` (o destravador) · switch de prompt por fase `1456-1477` · stream gating `1590-1599` (não mexer).
- `chat.functions.ts` (origin/main) — `iniciarSubmissao` ramo comum `~893-911` · turno de aprovação doc já-async `~2364-2410` (o padrão a migrar) · `extrairEstado` `~402` · `iniciarSaving` `~2567` · garantia de submit `reconciliarDocSePendente` `~3593` / `bloqueioDocAusente` `~3446` · gates de saving `1361-1368`.
- `submeter.tsx` — `dispararDocBackground` `1362-1456` · `await bgPromiseRef` `1628-1636` (soltar) · `handleContinuarAgente`/`docConcluida` `2254-2290` · transições do chat `2438-2516`.
- `demo-backend.ts` `~134-231` · `doc-async.ts` (origin/main — **reusar**, não refazer).

**Dependentes:** consumidores da doc compilada são TODOS pós-fase-financeira — analisador `analyzer.ts:~331-382` (pós-submit) · submit `reconciliarDocSePendente`/`bloqueioDocAusente` · Drive/telas read-only. `buildRevisaoContexto` (`~340`) lê a doc SÓ na EDIÇÃO (fora do escopo). **Nenhum consumidor lê a doc compilada durante saving/receita — destravador CONFIRMADO em código.**

**Invariantes (não podem regredir):** gates de saving (`chat.functions.ts:1361-1368`) seguem rodando antes do preview financeiro · garantia de doc no submit (analisador pós-submit) · contrato do envelope de streaming (`delta`/`envelope`/`error`) intacto, `doc_preview` complete segue não-streamado · regra 1 (`worker.js`) · só submissão NOVA + padrão (intro/seed/rascunho exclusivos).

**Reuso:** infra A+B `doc-async.ts` (`compilarEPersistirDoc`/`placeholderDocPendente`/`reconciliarDocSePendente`/`recompilarDocsPendentes`) — reusar direto, só muda o GATILHO (de "aprovação da doc" para "anexo/início") · padrão "compila cedo + retorna" do ramo `fluxo_direto` (`~859-891`) — estender, mas MANTENDO a fase conversacional de saving/receita (não usar `modo_direto`).

## Estado (31/08) — /ggsd:code EM ANDAMENTO no worktree `~/godocs-wt-fatia-c`
✅ **T1 (transição) + helpers puros — VERDE.** `proximaFase` (FONTE ÚNICA, unifica os 2 blocos duplicados do orchestrator) + `reorderDocFinal`/`coletadoVazio`/`coletadoInicialDoBlob` em `doc-async.ts`. RED autorado pelo test-writer (`tests/fatia-c-reorder.test.ts`, 37 fail→verde). Flag threadada no `streamOpts` de `runOrchestrator`. **Byte-idêntico com flag OFF** (proximaFase reorder=false = mapa de hoje).
✅ **T2 (wiring backend) — VERDE.** `iniciarSubmissao`: branch reorder (bg-compile + `coletado_inicial` durável no blob + retorna `reorder_doc_final:true`, sem abrir fase doc). `iniciarSaving`/`iniciarReceita`: helper `coletadoParaFinanceiro` relê `coletado_inicial` do blob quando `extrairEstado` vem vazio + flag threadada. **Suíte 2331 verde** (2293 base + 38 novos); tsc só com os 5 erros PRÉ-EXISTENTES do main (chat.functions ×2, submeter ×3).
✅ **T3 (refino pós-financeiro) — VERDE.** Endpoint `iniciar-refino-doc` (`iniciarRefinoDoc`, espelha iniciarSaving; roda a fase `doc` com history=[] p/ disparar o seed condicional; coletado do blob; carrega saving/receita) + rotas nas 2 cadeias do `worker.ts` (SSE + JSON) + set de streaming. Recompilação no `doc_preview→completo` só se o refino mudou o coletado (`coletadoInicialDoBlob` antes×depois). **Financeiro DIFERIDO confirmado seguro:** `isComplete = fase==='completo'`, então `saving_preview→doc` (fase doc) NÃO marca completo; o `estado.saving` viaja pela fase refino (echo preservado no orchestrator 1724-1731) e o bloco completo re-deriva das linhas no `doc_preview→completo` final.
✅ **T4 (frontend `submeter.tsx`) — VERDE.** Flag `reorderAtivo` (set quando iniciar-submissao devolve `reorder_doc_final`); branch em `dispararDocBackground` (sem bolha, fase saving); `handleContinuarAgente` abre o form de saving direto na submissão nova reordenada; `handleSendMessage` ganhou `transitionToDocRefino` (saving_preview/receita_preview→doc) que captura o preview financeiro e chama `iniciar-refino-doc` com streaming numa bolha viva. Sem tela de transição nova (reusa o chatLoading). **Zero erro tsc novo** (3 pré-existentes em submeter.tsx intactos).
⏳ **T5 (demo-backend) — DEFERIDO** para quando a flag ligar em prod (T8): o demo é dev-only e mostra o fluxo DEFAULT (doc-first = live com flag OFF); reescrever agora mostraria um fluxo não-live. Não quebra teste.
✅ **T6 (testes) + §9 revisores tratados.**
- **§9.C reuso** (sugestão): `coletadoInicialDoBlob` duplicava o corpo de `coletadoDePendente` → **aplicado**: leitor único `lerColetadoDoBlob(conteudo, chave)`.
- **§9.B qualidade** (`sugestoes`, não-barrante): `mudou` por `JSON.stringify` é sensível à ordem das chaves → **aplicado**: `coletadoIgual` (campo a campo). Marcador `limpo`.
- **§9.A conformidade**: 1ª passada `diverge-alta` SÓ por falta de cobertura (lógica julgada FIEL); **re-review → `diverge-baixa` (0.85), "não é bloqueio"**. Fechado com `tests/fatia-c-reorder-integracao.test.ts` (SQLite :memory: + LLM mockado, 5 casos: iniciarSubmissao reorder grava `coletado_inicial` durável; flag OFF abre fase doc; iniciarRefinoDoc roda fase doc com coletado do blob; recompile mudou→recompila / não-mudou→não) + casos puros de `resolverColetadoFinanceiro` (memorial nunca em branco) e `coletadoIgual`. Refactor: decisão do coletado virou a PURA `resolverColetadoFinanceiro`.
✅ **Gates GGSD abertos:** review=diverge-baixa · quality=limpo · suite=verde. **Suíte 2346 verde** (161 arquivos). SPA + `worker.js` rebuildados (regra 1).

## ⏳ FALTA (precisa do Luis) — T7 staging · T8 prod+merge · T5 demo
- **T7 (regra 13):** deploy no STAGING `edf400b4` → secrets `REORDER_DOC_FINAL=1` + `DOC_COMPILE_ASYNC=1` (+ `LLM_STREAMING=1` já setado) → validar no navegador (submissão nova padrão: doc some do caminho crítico, saving/receita primeiro, refino no fim) + medir TTFT antes×depois → confirmar doc final íntegra no Drive/analisador.
- **T8 (regra 14):** prod `674a3710` + mesmos secrets → merge no `main` (conta `LuisEduardo100`) + atualizar CLAUDE.md (seção LLM/fluxo) e specs.
- **T5:** reescrever `demo-backend.ts` (fluxo normal → nova ordem) NO DEPLOY da flag (dev-only; hoje mostra o default doc-first).

## Estado (30/08) — mapa do explorador incorporado; aguarda aprovação
✅ **Explorador `a8f09057b7e6bb769` concluído** (confiança 0.72, blast-radius ALTO). Mapa transcrito para as Tarefas e o Blast-radius acima. Destravador **confirmado em código** (`buildDetalhesAprovados` usa só `coletado`; nenhum consumidor lê a doc compilada durante saving/receita).

**Questões de design em aberto (resolver na sessão `/ggsd:code`, não bloqueiam a aprovação do plano):**
1. **Persistência do `coletadoInicial`** (T2): `iniciarSubmissao` precisa gravar a saída do extrator onde `extrairEstado` a leia sem a fase doc ter rodado — msg assistant sintética × campo novo. Não decidido.
2. **Fase de refino de doc pós-financeiro** (T3): não existe em código — como semear `buildDocPrompt` com a doc já compilada e como a transição `saving_preview/receita_preview→doc` se comporta quando a doc ainda está pendente (esperar/reconciliar).
3. **Branch base:** o worktree SAI de `origin/main` (esta branch é stale); a varredura fina do frontend step 3 e do demo-backend fica para o `/ggsd:code`.

Esta fatia **MUDA a verdade funcional** (reordena comportamento visível ao usuário) → na aprovação, oferecer "Aprovar e continuar para a spec".
