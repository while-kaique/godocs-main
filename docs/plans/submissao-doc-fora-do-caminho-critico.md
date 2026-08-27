# Plano — Frente 1: tirar a documentação do caminho crítico da submissão

**Status:** executado (código) — 27/08/2026 · A+B+C implementados (`feat/submissao-doc-async`, HEAD `82bbc4e`), suíte **1965 verde**, `worker.js` rebuildado. Fatia C: compilador da doc SEMPRE no modelo escolhido (sem `gpt-5.4-mini` escondido) via `semFallbackModelo` + timeout folgado + retries do luna + defer no submit + cron `recompilar-docs-pendentes`. ⚠️ **Revisão §9 NÃO re-rodou** para o diff da fatia C (`.review-status`/`.quality-status`=`pendente`) → `/ggsd:ship` barra até rodar. FALTA: staging (`DOC_COMPILE_ASYNC=1`, opcionais `DOC_MECANICO_MODEL=luna`/`DOC_COMPILE_TIMEOUT_MS`/`DOC_COMPILE_RETRIES`/`DOC_COMPILE_PRESERVAR_MODELO`) + validação/prod pelo Luis. _(aprovado por Luis em 27/08/2026)_
>
> **Fatia C — compilador sempre no modelo escolhido (sem mini escondido):** (1) distinguir LENTIDÃO de ERRO — lentidão do luna não corta nem troca modelo (timeout FOLGADO, background); (2) ERRO real (502/exceção) → retenta o LUNA com backoff, nunca o mini; (3) esgotado → defere p/ recompilação em background/cron (doc fica pendente, re-tentada no luna), nunca publica doc de mini; (4) cliente nunca trava — segue com o `coletado`; a doc é garantida no submit/depois sem travar. Env-gated; NÃO mexer no fallback das outras chamadas (chat/saving/memorial) — só no compilador.
>
> Origem: reclamações recorrentes de que "submeter projeto está lento/chato". Objetivo do dono do produto (Luis, 27/08/2026): o cliente que submete **não pode sentir gargalo nenhum**. Esta é a **prioridade #1**, independente da Frente 2 (time de agentes).
> Metodologia: GGSD (plano aprovado → código em worktree → staging → prod). Regras do projeto 1/2/8/10/13/14.

## 0. Contexto — o que JÁ foi feito (não refazer)

A latência da IA já teve duas entregas grandes; o gargalo que sobra é **outro**:

- **Streaming SSE ponta a ponta** (`LLM_STREAMING`) — EM PROD. O memorial e as perguntas streamam token a token; acabou a tela branca de 60–88s **nas fases conversacionais**. (`docs/plans/streaming-latencia-ia.md`)
- **Roteamento de modelo por FASE** — código feito/revisado: `doc`/`doc_preview` → `gpt-5.6-luna` + `reasoning_effort=low`; saving/receita ficam no `sol`. (`docs/plans/latencia-ia-roteamento-por-fase.md`, `orchestrator.ts:1550-1554`)
- ⚠️ **Structured Outputs está morta no proxy** (Codex ignora `response_format`) — não é caminho.

**O que NÃO foi resolvido e é a dor que sobra:** a **compilação final da doc** e o **extrator** — ambos síncronos, no modelo forte, e no caminho crítico de quem submete.

## 1. Problema (com precisão, arquivo:linha)

Do mapa do fluxo (read-only, 27/08):

1. **Compilação da doc = ~88s, síncrona, não-streamada, no `sol`.** No turno em que o usuário aprova a doc (`doc_preview → saving/receita`), o backend chama `compilarDocumentacao` **antes** de fechar o turno e só então persiste (`chat.functions.ts:2346-2382`). O `complete` de `doc_preview` é **deliberadamente não-streamado** por causa disso (`orchestrator.ts:1592-1597`). É a maior espera em branco que sobra depois do streaming.
2. **Extrator de campos = síncrono, no `sol`.** `extrairCamposDocumentacao` roda com `await` em `iniciarSubmissao` (`chat.functions.ts:846`) e chama `llmChat` **sem `model`** → herda `LLM_MODEL` (sol) (`extractor.ts:227-233`), embora seja trabalho essencialmente mecânico. Idem o `compilarDocumentacao` (`doc-compiler.ts:125-129`, sem `model`, `maxTokens:8192`).
3. **O "background da doc" no cliente não elimina a espera.** `dispararDocBackground` (`submeter.tsx:1362-1428`) antecipa só a fase INICIAL de doc, e o botão de avançar **aguarda a promise** (`await bgPromiseRef.current`, `submeter.tsx:1629-1634`); a compilação pesada **nem é antecipada** por ele (ela mora no turno de aprovação).

### 1.1 Achado-chave que destrava tudo

A fase de **saving/receita** consome `buildDetalhesAprovados`, que usa apenas o **`coletado`** (campos extraídos) + resumo — **NÃO** a doc compilada (`orchestrator.ts:180-197`). A doc compilada (`documentacao.conteudo`) só é necessária para **exibição/Drive** e para o **analisador** (pós-submissão). Logo: **a compilação pesada pode sair do caminho crítico** — o usuário segue para o impacto financeiro só com o `coletado`, e a doc compila em background, reconciliando no submit.

## 2. Objetivo + critérios de aceite (EARS)

- **QUANDO** o usuário aprova a documentação no chat, **O SISTEMA DEVE** liberar o próximo passo (saving/receita) imediatamente, sem esperar a compilação da doc (~88s) terminar.
- **ENQUANTO** a documentação está sendo compilada em background, **O SISTEMA DEVE** deixar o usuário responder as perguntas de impacto (saving/receita) normalmente.
- **QUANDO** a compilação da doc termina em background, **O SISTEMA DEVE** persistir o resultado (`documentacao.conteudo`) sem intervenção do usuário.
- **SE** o usuário chegar ao envio antes de a compilação terminar, **ENTÃO O SISTEMA DEVE** garantir a doc compilada antes de submeter (aguardar/reconciliar), nunca submetendo doc incompleta.
- **O extrator e o compilador de doc DEVEM** rodar no modelo/effort adequado ao trabalho mecânico (leve), não no `sol` por herança.
- **Invariante preservado:** nenhuma regressão nos gates de saving (jornada/teto/≥44h/alocação/ganho projetado/sobreposição), no analisador, nem no que vai ao Sheets.

## 3. Abordagens (trade-offs + recomendação)

**A — Compilação da doc em background + reconciliação no submit (RECOMENDADA).**
Aproveita 1.1: no turno de aprovação da doc, retornar imediatamente (o `coletado` já basta para seguir), disparar `compilarDocumentacao` via `runBackground`/`waitUntil`, persistir `documentacao.conteudo` quando terminar, e no `submeterParaValidacao` garantir a doc pronta (aguardar a promise/checar persistência) antes de submeter. Ganho: elimina os ~88s do caminho crítico. Risco: gerenciar a promise de background no isolate do Worker (usar o `runBackground` que já existe) e o caso "submeteu antes de compilar" (rede no submit). Escopo contido, alto impacto.

**B — Modelo leve para extrator + compilador (barato, combina com A).**
Passar `model: LLM_MODEL_FAST` + `reasoningEffort: FAST` nas chamadas de `extractor.ts` e `doc-compiler.ts` (opt-in, env-gated, default = hoje). Reduz o tempo BRUTO das duas operações mecânicas. Baixo risco; medir qualidade da doc compilada (LLM-juiz) antes de fixar. **Fazer junto com A.**

**C — Reordenar o wizard (doc 100% paralela às perguntas determinísticas).**
Ideal do Luis levado ao limite: perguntas determinísticas primeiro, doc processando em paralelo desde o anexo. Maior refactor do fluxo guiado (a doc hoje é fase conversacional). **Adiar** — A+B já entregam o ganho sentido; C fica como fase 2 se ainda incomodar.

> Recomendação: **A + B agora** (env-gated, staging primeiro, medir antes/depois). C fica anotada.

## 4. Blast-radius (área tocada + invariantes)

- `src/lib/chat.functions.ts` — turno de aprovação da doc (`~2346-2382`), `iniciarSubmissao` (`791/846/894`), `submeterParaValidacao` (garantia da doc no submit). ⚠️ Regra 1: rebuildar `worker.js`.
- `src/lib/agents/doc-compiler.ts` (`101-145`) e `src/lib/agents/extractor.ts` (`184/227`) — injeção opt-in de `model`/`reasoningEffort`.
- `src/lib/background.ts` — reuso do `runBackground`/`waitUntil` (já registra em `ctx.waitUntil`).
- `src/routes/submeter.tsx` — remover/afrouxar o `await bgPromiseRef` que bloqueia o avanço (`1629-1634`), reconciliar quando a doc chegar.
- **Invariantes:** doc compilada continua sendo a fonte de `documentacao.conteudo` (Drive/analisador); o analisador roda pós-submit e precisa da doc pronta — a garantia no submit protege isso. Não mexer nos gates de saving nem no contrato do envelope de streaming.

## 5. Tasks

- **T1** — Confirmar dependências finas: quem lê `documentacao.conteudo` entre a aprovação da doc e o submit (garantir que só submit/analisador precisam da versão compilada). Varredura no worktree.
- **T2** — (A) Mover `compilarDocumentacao` do turno de aprovação para background (`runBackground`), persistindo ao terminar; retornar o turno na hora.
- **T3** — (A) Garantia no `submeterParaValidacao`: doc compilada pronta antes de submeter (aguardar/rechecar); tratar "submeteu antes" sem bloquear indevidamente.
- **T4** — Cliente: soltar o avanço (não `await` a promise pesada), reconciliar estado quando a doc chegar (`submeter.tsx`).
- **T5** — (B) `model`/`reasoningEffort` leve opt-in em extrator + compilador (env-gated, default hoje).
- **T6** — Testes: novos casos (doc em background não bloqueia; submit aguarda doc; extrator/compilador no modelo leve) + suíte verde + smoke.
- **T7** — `build:worker`, deploy **staging** (`edf400b4`), medir TTFT/tempo do turno de aprovação e da submissão antes/depois; validar doc final íntegra.
- **T8** — Prod (`674a3710`) + merge no `main` (regra 14) + atualizar CLAUDE.md/specs.

## 6. Rollout / gates

Worktree `~/godocs-wt-doc-async` (fora da raiz — memória `plan-gate-worktree-fora-da-raiz`). `npm run test && build && build:worker`. **Staging antes de prod (regra 13)**; Luis valida no navegador com o cookie. Tudo que muda tempo é medido (10s→3s? 3s ganha). Env-gated onde der, para rollback sem redeploy de lógica.
