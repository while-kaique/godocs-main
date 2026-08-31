# Plano — Fatia C: reordenar o wizard (doc paralela, refino no final)
**Status:** rascunho (mapa do explorador incorporado; **aguarda aprovação via seletor**)

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

## Estado (30/08) — mapa do explorador incorporado; aguarda aprovação
✅ **Explorador `a8f09057b7e6bb769` concluído** (confiança 0.72, blast-radius ALTO). Mapa transcrito para as Tarefas e o Blast-radius acima. Destravador **confirmado em código** (`buildDetalhesAprovados` usa só `coletado`; nenhum consumidor lê a doc compilada durante saving/receita).

**Questões de design em aberto (resolver na sessão `/ggsd:code`, não bloqueiam a aprovação do plano):**
1. **Persistência do `coletadoInicial`** (T2): `iniciarSubmissao` precisa gravar a saída do extrator onde `extrairEstado` a leia sem a fase doc ter rodado — msg assistant sintética × campo novo. Não decidido.
2. **Fase de refino de doc pós-financeiro** (T3): não existe em código — como semear `buildDocPrompt` com a doc já compilada e como a transição `saving_preview/receita_preview→doc` se comporta quando a doc ainda está pendente (esperar/reconciliar).
3. **Branch base:** o worktree SAI de `origin/main` (esta branch é stale); a varredura fina do frontend step 3 e do demo-backend fica para o `/ggsd:code`.

Esta fatia **MUDA a verdade funcional** (reordena comportamento visível ao usuário) → na aprovação, oferecer "Aprovar e continuar para a spec".
