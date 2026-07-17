# Plano — Etapa 1 editável na tela de edição (participantes + papéis)
**Status:** ✅ executado (2026-07-17) — T1–T3 implementados; T4 registrado como limitação; T5 (staging) pendente.

> **Resultado da sessão de código (2026-07-17):**
> - **T1** — Etapa 1 navegável na edição: `layout.tsx` mostra os 3 passos sempre (removido `editMode`);
>   guards `handleBack`/`handleStepClick` relaxados; "Voltar" visível na Etapa 2 da edição; landing na Etapa 2
>   preservado. Submissão nova inalterada (RF-106).
> - **T2** — validação da Etapa 1 extraída para `validarEtapa1(form, {modoEdicao})` (pura, em `constants.ts`) e
>   ligada em `validateStep`. Em edição relaxa `escopo`/`prodStatus`/`ferramenta` (RF-103); nova mantém
>   validação cheia (comportamento idêntico ao inline anterior). Testes: `tests/validacao-etapa1.test.ts`.
> - **T3** — persistência participante-only já correta (seed `agentMeta` e `snapshotMeta` normalizam ambos por
>   `montarMembrosPapeis`, apples-to-apples) → sem mudança de código; teste de guarda em `participantes-papeis.test.ts`.
> - **T4 (RF-107) — LIMITAÇÃO REGISTRADA (não implementado):** em `atualizarMetadados` o ramo especial
>   (`ehEspecial`, `chat.functions.ts:1928`) **sempre** reconstrói a doc via `buildDocEspecial` e retorna
>   `{reset:true}`, **ignorando `reset_doc`** (o flag só vale no caminho NÃO-especial, `:1956`). Exentar de
>   verdade a edição participante-only exigiria mudança **server-side** (fora das Fronteiras/blast-radius +
>   `build:worker`). Como a doc do especial é **determinística** (derivada de descrição/contexto/membros),
>   "resetar" a regenera idêntica, sem perda real → decisão: não implementar.
> - Sem tocar server-side (só `submeter.tsx`/`layout.tsx`/`constants.ts` + testes) → `build:worker` desnecessário
>   (INV-06). 561 testes verdes; `npm run build` compila. Verificação de conformidade: `diverge-baixa` (0.9).
> - **T5 pendente:** round-trip em staging (regra 13) + pré-requisito operacional das colunas (abaixo).

**Status original:** ✅ aprovado (Luis, 2026-07-17)

**Objetivo:** Tornar a **Etapa 1** (participantes + papéis: Coautor · Participante · Contribuidor) visível e
navegável na tela de edição (`/editar/$id`), para donos/editores delegados — **inclusive projetos legados** —
persistindo a alteração no Sheets (fonte da verdade) e refletindo no site, sem regredir a submissão nova, o
ownership, nem o sync.

---

## Contexto do código (mapeado contra o real — 3 varreduras + leituras diretas)

- `/editar/$id` (`src/routes/editar.$id.tsx:53`) só renderiza `<SubmeterPageContent editProjetoId={id} />` — a
  diferença da edição vive em `src/routes/submeter.tsx`.
- **A Etapa 1 já contém o editor de participantes+papéis** (`Step1` → `ParticipantesPapeisInput`,
  `form.participantes` + `form.participantesPapeis`, `step1.tsx:291-308`). O autor aparece read-only.
- **Os dados já são seedados na edição** (`applySeed`, `submeter.tsx:391-436`): `membros` → `participantes`,
  `membros_papeis` → `participantesPapeis` (fallback `coexecutor` p/ legado sem papel). **Não há encanamento de
  dados novo** — os dados estão carregados, só a Etapa 1 está escondida.
- **A edição esconde/bloqueia a Etapa 1 em 4 pontos coordenados:**
  1. `applySeed` termina com `setStep(2)` (`submeter.tsx:601`) — a edição "aterrissa" na Etapa 2.
  2. `WizardProgress` recebe `editMode={!!editProjetoId}` (`submeter.tsx:2226`) e `layout.tsx:103` faz
     `visibleSteps = editMode ? STEPS.filter(s => s.id !== 1) : STEPS` — some o índice da Etapa 1.
  3. Guards de navegação: `handleBack` (`:1025` — `if (editProjetoId && step <= 2) return`) e `handleStepClick`
     (`:1031` — `if (editProjetoId && target === 1) return`).
  4. Visibilidade do botão "Voltar" (`:2362`).
- **Persistência (fonte da verdade = Sheets):** editar participantes dispara `atualizar-metadados` porque
  `snapshotMeta()` inclui `participantes`/`participantesPapeis` e `handleContinuarAgente` detecta `metaChanged`
  (`submeter.tsx:1479-1505`) → grava `membros`/`membros_papeis` no SQLite (via `atualizarMetadados`,
  `chat.functions.ts:1869-1876`) → `submeter-validacao` dispara a **IDA** (`syncSubmitToGoogle` via
  `runBackground`/`waitUntil`), que em `modo:'edicao'` faz `updateRowByProjectId` e **sobrescreve as 3 colunas
  de papel** (`Participantes`/`Participantes 2`/`Contribuidor`) via `derivarColunasPapeis`. O sync reverso
  reflete Sheets→SQLite→site.
- **Ownership (INV-01):** gate 403 em `submeterParaValidacao(body, email)` (`chat.functions.ts:2307-2328`) —
  só dono / editor delegado. `atualizar-metadados` **não** tem gate próprio (pré-existente; não regride nesta fatia).

## Decisões desta sessão

- **D1 — sync/clobber:** **Sem guarda de timestamp.** O **Sheets é a fonte da verdade** e o SQLite é reflexo; a
  IDA leva a edição à fonte pelo mesmo caminho de toda edição, e o site reflete. O eventual atraso do reflexo é
  transitório e auto-corrige. (Descartada a guarda de carência no sync reverso.)
- **D2 — validação de legado:** **Relaxar** a validação da Etapa 1 **em modo edição** — exigir só o essencial
  (identidade detectada + participantes/papéis válidos quando "em equipe = sim"); **não** travar por
  `ferramenta`/`escopo`/`prodStatus` ausentes num legado que só quer corrigir participantes.
- **D3 — worktree × GGSD:** esta frente roda na **raiz do repo** + branch `feat/edicao-etapa1-participantes`
  (o GGSD assume a raiz; worktree aninhado colidia com os hooks). O GGSD passa a dar a segurança de git.

## Pré-requisito OPERACIONAL (não-código, ação do Luis)

⚠️ As colunas **"Participantes 2"** e **"Contribuidor"** DEVEM existir no cabeçalho das abas **GoDocs (prod)**
e **STAGING**. Sem elas, a IDA ignora com aviso e os papéis Participante/Contribuidor **nunca chegam à fonte
da verdade** (perda real). Conferir/criar antes de validar em staging e antes de prod. _(A memória do projeto
registra essa criação como pendente.)_

---

### Tarefas
- **T1 — Mostrar e navegar à Etapa 1 na edição (UI/roteamento).** Tocar os 4 pontos: (a) `layout.tsx:103`
  mostrar os 3 passos também na edição; (b) relaxar guards `submeter.tsx:1025`/`:1031`; (c) visibilidade do
  "Voltar" `:2362`; (d) manter a **aterrissagem na Etapa 2** (`setStep(2)` em `:601`) mas com a Etapa 1 clicável
  no topo e via "Voltar". NÃO regredir a submissão nova. _(guarda: smoke — abrir `/editar/$id`, ver 3 passos, ir
  à Etapa 1, editar participante, voltar à 2)_
- **T2 — Relaxar validação da Etapa 1 no modo edição (D2).** `validateStep(1)` (`submeter.tsx:953-985`): em
  `editProjetoId`, não bloquear por `ferramenta`/`escopo`/`prodStatus`; manter identidade + participantes/papéis
  válidos (domínios `@gocase/@gobeaute/@gogroup`, papel obrigatório por participante). _(guarda: teste unit de
  `validateStep(1)` — legado sem ferramenta em edição passa; participante sem papel bloqueia)_
- **T3 — Garantir persistência de edição participante-only.** Confirmar/blindar que alterar SÓ participantes
  muda `snapshotMeta()` → `metaChanged` → `atualizar-metadados` grava `membros`/`membros_papeis` (validar
  normalização `montarMembrosPapeis` seed×snapshot para comparação apples-to-apples). _(guarda: teste que
  `snapshotMeta` difere de `agentMeta` ao mudar participante/papel; caminho 1→2→3 grava)_
- **T4 — Projeto especial: não perder a doc ao editar só participantes (avaliar).** Hoje, em `especial`,
  qualquer `metaChanged` faz `reset_doc:true` (`submeter.tsx:1398-1462`) — editar participante nukaria a doc.
  Se trivial, isentar mudança **participante-only** do `reset_doc`; senão, registrar limitação (fora de escopo).
  _(guarda: se implementado, teste de que participante-only não reseta a doc especial)_
- **T5 — Round-trip em staging (regra 13).** Após `npm run test && build && build:worker`, deploy no **staging
  `edf400b4`**, editar participantes de um projeto de teste e um "legado" simulado, conferir as 3 colunas no
  Sheets e o reflexo no site; só então prod `674a3710`. _(guarda: validação no navegador; cenário E2E se couber)_

### Critérios de aceitação
1. Dono/editor delegado vê os 3 passos na edição, navega à Etapa 1 e edita participantes/papéis; **legado não
   trava** ao avançar 1→2.
2. Reenvio persiste `membros`/`membros_papeis` e a IDA escreve as **3 colunas de papel** no Sheets (fonte da
   verdade), **sem duplicar linha** (UPDATE in-place por ID); o site reflete após o sync.
3. **Ownership intacto (INV-01):** participante não-delegado e admin-participante seguem barrados no submit (403).
4. **Submissão NOVA inalterada** (mesmo componente `Step1`) — nenhum comportamento novo indesejado.
5. `npm run test` verde + `npm run build` + `npm run build:worker`; validado em **staging antes de prod** (regra 13).

### Fronteiras (não exceder)
- **Não** alterar o modelo de dados (`membros`/`membros_papeis` já existem) nem o schema.
- **Não** adicionar guarda de timestamp no sync reverso (D1 — Sheets é a fonte).
- **Não** adicionar validação server-side de subset/autor em `membros_papeis` (permanece como hoje; subset é
  garantido por construção em `derivarColunasPapeis` + cliente).
- **Não** mexer em `sync.ts`/`sheets.ts`/`sync-reverse.ts` — IDA/volta já cobrem os 3 papéis (reuso).
- T4 é **opcional**: só entra se for trivial; senão vira limitação registrada.

### Blast-radius
- **Arquivos:** `src/routes/submeter.tsx` (roteamento/validação/landing), `src/lib/submeter/layout.tsx`
  (progress bar). Possível ajuste cosmético em `step1.tsx` (nenhuma mudança de dados). **Sem** mudança
  server-side/sync → provavelmente **sem `build:worker`** (confirmar na fase de código; se nada server mudar,
  não é preciso recomitar `worker.js`).
- **Dependentes:** a **submissão nova** compartilha o mesmo `SubmeterPageContent`/`Step1` — regressão proibida.
  `editar.$id.tsx` (wrapper). Draft de edição (`draft-storage.ts`) já carrega `form` inteiro (participantes
  incluídos) — sem mudança.
- **Invariantes:** INV-01 (ownership) — preservar; INV-04/05 (sync por nome, não duplicar) — reuso, preservar;
  INV-09 (PT-BR com acento) — copy nova, se houver.
- **Confiança:** **alta** — fluxo mapeado por 3 varreduras independentes + leituras diretas dos trechos-chave.
