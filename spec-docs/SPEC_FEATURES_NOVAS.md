# Spec — 5 Features Novas (GoDocs) · jun/2026

> **Documento vivo.** Decisões fechadas com o Luis em 2026-06-24. Mantido em
> `spec-docs/` (versionado no repo).
> **Status global (2026-06-24): F1–F4 + etapa de auditoria MERGEADAS e DEPLOYADAS em
> produção** (`godocs.devgogroup.com`). Falta só a **F5 (antiagente)**.

## Visão geral

Cinco features, **uma por worktree/branch/PR** (ordem entregue: **1 → 3 → 2 → 4**, depois a
etapa de auditoria; antiagente por último). Cada uma reconciliada com o `main` da vez antes do
merge.

| # | Feature | Status | PR |
|---|---------|--------|----|
| 1 | **AI Proxy** (usa o gateway interno?) | ✅ mergeada + deployada | #143 |
| 3 | **Custos do projeto** (serviço pago p/ rodar) | ✅ mergeada + deployada | #144 |
| 2 | **Periodicidade trimestral/semestral** | ✅ mergeada + deployada | #145 |
| 4 | **Carga real × escala** | ✅ mergeada + deployada | #146 |
| — | **Etapa de auditoria** (gate determinístico do split + fixes de coluna) | ✅ mergeada + deployada | #147, #148 |
| 5 | **Antiagente** (crítico adversarial) | ⏳ pendente (último) | — |

`tsc --noEmit` tem **4 erros pré-existentes** no `main` atual (1 em `chat.functions.ts` + 3 casts
de seed em `submeter.tsx`) — herdados, **não** introduzidos por estas features. O build usa
esbuild/vite (não typecheck), então esses erros não quebram nada. Critério de "verde": mesma
contagem de erros pré-existentes + todos os testes passando + `build:worker` e `build` ok.

---

## Etapa de auditoria — gates determinísticos (a informação de análise SEMPRE existe)

Princípio (decidido com o Luis): os números de saving que vão para a gestão **precisam ser
auditáveis** — e a coleta da informação **não pode depender da boa vontade do LLM** (ele às
vezes gera o preview sem perguntar). Por isso os pontos críticos viraram **gates
determinísticos no backend** (`chat.functions.ts`/`enviarMensagem`): o sistema **conduz a
pergunta** (não o LLM) e **bloqueia o preview/complete** até a informação existir. Rodam na
fase `saving`, **um de cada vez**, e o estado vive no objeto `saving` (re-mesclado a cada turno,
nunca ecoado pelo LLM).

| Gate | Quando aplica | O que garante | Estado |
|------|---------------|---------------|--------|
| **Jornada-base 220h** | rotina manual real **mensal** (`aplicaConfirmacaoBaseHoras`) | base CLT 220h/mês como TETO por pessoa; só sobe com trabalho HUMANO em fim de semana (≤300h) | `saving.jornada_base` |
| **Teto por pessoa** | idem, e alguma linha > teto | linha acima do teto só passa se o usuário confirmar que soma **várias pessoas/unidades** | `saving.teto_pessoa` |
| **Carga real × escala** | alguém fazia à mão (`'sim'`), recorrente, com horas (`aplicaSplitCargaEscala`) | separa **carga humana real** × **ganho por escala** (volume que só a automação cobre); o sistema pergunta o nº da carga real, a escala é o resto | `saving.carga_escala` |
| **Economia alta [2.4]** | saving **mensal** ≥ 44h | exige registrar **o que mudou**: atividades **nomeadas** p/ onde o tempo foi (nunca "outras atividades") + o que se entrega **a mais** (com nº quando houver) — gate via prompt (com exemplo bom×ruim) + rede no preview; fatiado p/ coluna AK "Alocação Ganhos" | — |

Padrão comum: predicado de escopo exportado do `orchestrator.ts`; o backend intercepta o
preview, troca por uma pergunta (`pergunta*`), interpreta a resposta de forma determinística
(`interpretar*`) e injeta um nudge `[SISTEMA]` efêmero para o LLM reagir/registrar no memorial.
A **F5 (antiagente)** é a camada final dessa etapa: um crítico adversarial que lê o projeto +
veredito e **registra** ressalvas (sem mudar status) — coluna "Análise Antiagente" (hoje "—").

**Convenção de preenchimento das colunas do Sheets:** coluna **numérica** vazia → **`0`**;
coluna de **texto** vazia → **`—`** (`COLUNAS_NUMERICAS` + `padronizarLinha` em `sync.ts`).

---

## Decisões fechadas que NÃO podem ser "corrigidas" por engano

1. **F4 — o saving TOTAL vira R$** (não a carga real). O Luis confirmou **2×**, vendo o aviso
   de "inflação". As 2 colunas novas (real/escala) são só transparência/auditoria; o antiagente
   vigia abuso. NÃO reescrever para "carga real vira R$".
2. **F2 — trimestral/semestral gravam o valor CHEIO do período** (NÃO mensalizar ÷3/÷6). O
   campo `tipo_saving` carrega a cadência; quem lê interpreta. Comporta-se como o pontual no
   quesito "não dividir".
3. **F3 — custos do projeto ABATEM o ganho** (~~pontual ÷12, mensal cheio~~ → **atualizado em
   01/07/2026: pontual e mensal pelo valor cheio, SEM ÷12** — ver `SPEC_CORRECOES.md`, mesma
   mudança aplicada ao custo evitado). Escopo: coletado **só no form de saving** → abate
   `saving_reais`. Projeto **receita-pura** (sem form de saving) ainda **não captura** — limitação
   conhecida e documentada; estender se o Luis pedir.

---

## Colunas no Google Sheets (match por NOME, não posição)

`SHEET_COLUMNS` em `src/lib/google/sheets.ts`. Reordenar na planilha não quebra; só o nome
precisa bater (ausente = ignorada com aviso).

**Já criadas pelo Luis na planilha real:**
`Custo do Projeto` · `Justificativa Custo do Projeto` · `Custo do Projeto Mensal ou Pontual`
(F3) · `Usa AI Proxy` (F1) · `Análise Antiagente` (F5).

**Confirmado pelo Luis (2026-06-24):** os nomes são **`Saving Horas Real`** e
**`Saving Horas Escalado`** (HORAS, casa com "Saving Horas"). A coluna **"Saving Horas"
(existente) continua sendo o TOTAL** (o número que vira R$). Já mapeadas em `SHEET_COLUMNS`
(AL/AM). ⚠️ **Precisam existir no cabeçalho da planilha real** (mapeamento por nome).

---

## F1 — AI Proxy ✅ (feito)

**O quê:** governança de custo — saber se o projeto roteia IA pelo gateway interno
(`ai-proxy.gogroupbr.com`). Duas camadas: pergunta determinística no form + auto-detecção na doc.

**Onde aterrissou:**
- Form **Etapa 2** (`step2.tsx`): `usaAiProxy` ('sim'/'nao', obrigatória) em `FormData`
  (`constants.ts`); validação em `validateStep(2)` (`routes/submeter.tsx`).
- Payloads (`routes/submeter.tsx`): `usa_ai_proxy` em todos os fluxos (iniciar normal/especial,
  4× atualizar-metadados); seed da edição em `applySeed` + `snapshotMeta`/`AgentMeta`.
- Backend: `usa_ai_proxy` em `iniciarSubmissaoSchema` + `atualizarMetadadosSchema`; `insertProjeto`
  (INSERT + tipo `InsertProjeto`); `atualizarMetadados`; `form_events`. Coluna `ProjetoRow`.
- Migração `schema.ts`: `ALTER TABLE projetos ADD COLUMN usa_ai_proxy TEXT`.
- **Auto-detecção:** `detectarAiProxy(texto)` em `agents/extractor.ts` (regex
  `ai-proxy.gogroupbr.com`, determinístico — mais confiável que pedir ao LLM).
- **Cross-check:** `analyzer.ts` (`buildUserMessage` envia `usa_ai_proxy_declarado` ×
  `ai_proxy_detectado_na_doc`; `buildSystemPrompt` instrui a registrar divergência nas
  Observações SEM mudar status/complexidade).
- Sheets: coluna `Usa AI Proxy` (declarado 'Sim'/'Não'/'—') em `sync.ts`.
- `getMeuProjeto` retorna `usa_ai_proxy`; `MeuProjetoDetalhes` atualizado.
- `prompt-registry.ts` (description do analisador) + CLAUDE.md atualizados. Teste:
  `detectarAiProxy` em `tests/extractor.test.ts`.

**Decisão de UX:** pergunta **obrigatória** p/ todos os projetos (não só os com IA). Se o Luis
preferir opcional, é ajuste de 1 linha em `validateStep`.

---

## F3 — Custos do projeto ✅ (feito)

**O quê:** serviços externos PAGOS que a solução **interna** consome p/ rodar (chave de API,
ElevenLabs). 4º tópico do form de saving, espelha o custo evitado **mas ABATE** o ganho.
≠ `custo_externo_mensal` (escopo externo) e ≠ `custo_evitado` (que SOMA).

**Onde aterrissou:**
- Form (`step3-chat.tsx`): `temCustoProjeto` + `custoProjetoItens` (lista incremental
  nome/valor/recorrência/justificativa); revelação progressiva após o custo evitado;
  validação `cp*`. `SavingFormData` em `constants.ts`.
- Tipos: `SavingColetado.custo_projeto_reais/_tipo/_descricao` (`agents/types.ts` + `savingVazio`).
- Cálculo (`agents/saving-calc.ts`): `custoProjetoMensalFromItens` (pontual e mensal pelo valor
  cheio, sem ÷12 desde 01/07/2026 — ver `SPEC_CORRECOES.md`) + `recomputarSavingFinanceiro`
  **subtrai** `custo_projeto_reais` do líquido; bloco no memorial.
- Backend (`chat.functions.ts`): `iniciarSavingSchema` (`tem_custo_projeto`+`custo_projeto_itens`);
  `iniciarSaving` mensaliza, persiste 3 colunas, seta no `saving`, abate no líquido inline,
  `form_events`. Submit e fim-de-chat re-derivam de `projeto.custo_projeto_itens` (fonte da verdade).
- Migrações `schema.ts`: `custo_projeto`, `custo_projeto_justificativa`, `custo_projeto_itens`
  (+ `ProjetoRow`).
- Sheets (`sheets.ts`+`sync.ts`): 3 colunas (`Custo do Projeto` numérica abate; justificativa;
  recorrência via `custoEvitadoRecorrenciaLabel` reusado).
- **Cross-check:** `analyzer.ts` recebe `custo_projeto_itens`+`custo_projeto_reais` e cruza com
  serviços pagos da doc (sinaliza não-declarado nas Observações, sem mexer no cálculo).
- `getMeuProjeto`+`MeuProjetoDetalhes`+`applySeed` (repopula na edição). `prompt-registry` + CLAUDE.md.
  Testes em `tests/saving-calc.test.ts` (mensalização, abatimento, composição) + count em
  `tests/agents-types.test.ts` (savingVazio → 15 chaves).

---

## F2 — Periodicidade trimestral/semestral ✅ (feito)

**O quê:** rotinas que rodam a cada 3/6 meses. Coletar o saving **acumulado do período**;
gravar o valor **cheio do período** (NÃO mensalizar). O `tipo_saving` carrega a cadência.

**Onde aterrissou** (worktree `../godocs-periodicidade`, branch `feat/periodicidade-saving`, 372 testes, 5 erros tsc pré-existentes, builds ok):
- Enum `tipo_saving` widened para `'mensal'|'pontual'|'trimestral'|'semestral'|null` em `agents/types.ts`
  (3 ocorrências: `SavingColetado`, `ReceitaColetada`, e o `saving?` do resultado) + schemas
  `iniciarSavingSchema`/`iniciarReceitaSchema` (`chat.functions.ts`) + `SavingFormData.tipoSaving`
  (`constants.ts`) + casts em `submeter.tsx` (2 payloads) e `step3-chat.tsx` (state + onSubmit).
- **Gates MENSAIS → `=== 'mensal'`** (era `!isPontual`): `aplicaConfirmacaoBaseHoras` (220h/teto)
  e `economiaAlta`/`economiaAltaPv` (≥44h). `isPontual` segue `=== 'pontual'`. Helpers novos
  exportados: `periodoSavingInfo` (trimestre/semestre + meses) e `unidadeHorasDe` (h/mês · h/trimestre
  · h/semestre · h total único). Bloco de conduta "TIPO DE SAVING" ganhou ramo TRIMESTRAL/SEMESTRAL
  (orienta o ACUMULADO, proíbe mensalizar). Receita: unidade/cadência tornadas period-aware (defensivo
  p/ projeto saving+receita que compartilha a frequência).
- Form (`step3-chat.tsx`): toggle 2→4 opções **só no saving** (receita segue 2), grid responsivo
  (2 cols → 4 em `sm`), `role=radio`/`aria-checked` (estado não só por cor), helper "acumulado do
  período"; rótulos/aria da tabela de horas viram `horas/{período}`.
- `saving-calc.ts`: **nenhuma divisão nova** — valor do período entra cheio (como o pontual).
- Docs/testes: `prompt-registry.ts` (nota PERIODICIDADE no saving), CLAUDE.md (nova seção
  "Periodicidade"), 6 testes novos em `tests/saving-base-horas.test.ts`.
- **Materialidade (R$5k/mês):** valor do período × teto mensal → cai mais fácil em revisão humana.
  Aceito/conservador, só documentado.

**Mapa original (referência):**
- Enum `tipo_saving`: `'mensal' | 'pontual' | 'trimestral' | 'semestral'` em `agents/types.ts`
  (3 ocorrências) + schemas `iniciarSavingSchema` e `iniciarReceitaSchema` (`chat.functions.ts`).
- Form (`step3-chat.tsx`): toggle de tipo de saving de 2 → 4 opções (provável dropdown).
  `SavingFormData.tipoSaving` aceita os novos valores.
- **`orchestrator.ts` (`buildSavingPrompt` + `buildSavingPreviewPrompt`):**
  - `isPontual` permanece só `=== 'pontual'`.
  - `unidadeHoras`: `h/mês` | `h/trimestre` | `h/semestre` | `h (total único)` (pontual).
  - ⚠️ **CRÍTICO:** os gates MENSAIS (economia alta ≥44h, em `orchestrator.ts:~487`; teto 220h
    `aplicaConfirmacaoBaseHoras`) hoje branham em `!isPontual`. Trocar para
    **`tipo_saving === 'mensal'`** — senão trimestral (ex.: 132h/trim) dispara o teto mensal errado.
  - Prompt instrui a pessoa a trazer o acumulado do período (não por mês).
- `saving-calc.ts`: **nada de ÷** novo — valor do período entra cheio (como o pontual).
- Materialidade (R$5k/mês): vai comparar valor trimestral contra teto mensal → cai mais fácil
  em revisão humana. **Aceito/conservador** — só documentar, não bloquear.
- Sheets: a coluna **"Tipo de Saving"** já existe e recebe o valor do enum (nada novo).
- Lembrar: `prompt-registry.ts` (prompts mudaram) + CLAUDE.md (seção "Pontual e o ÷12" e
  base de horas) + testes (`orchestrator-prompts.test.ts`, `saving-base-horas.test.ts`).

---

## F4 — Carga real × escala ✅ (feito)

**Onde aterrissou** (worktree `../godocs-carga-escala`, branch `feat/carga-real-escala`, base
`c5249a8`, 381 testes, 4 erros tsc pré-existentes do novo main, builds ok):
- `SavingColetado.horas_carga_real` / `horas_escala` (+ `savingVazio`, +2 chaves → 14) — `types.ts`.
- Migração `schema.ts` (`projetos.horas_carga_real`/`horas_escala` REAL) + `ProjetoRow` (`client.server.ts`).
- **`buildSavingPrompt`:** bloco "CARGA REAL × GANHO POR ESCALA" + gate ("GATE CARGA REAL × ESCALA",
  string distinta da do gate ≥44h p/ não colidir) quando `ctx.alguem_fazia==='sim' && !isPontual &&
  temHorasAntes`. Instrui o LLM a preencher os 2 campos (somando o total) e registrar no memorial.
  ATENÇÃO 5 no formato de saída. **Sem gate determinístico** (qualitativo, prompt-enforced).
- **`chat.functions.ts`:** re-mescla sticky (`horas_carga_real`/`horas_escala`) a cada turno (não
  some entre preview/complete); persiste no `updateProjeto` do submit; inclui no snapshot de auditoria.
- **Sheets:** `SHEET_COLUMNS` ganha `Saving Horas Real` (AL) / `Saving Horas Escalado` (AM);
  `syncSubmitToGoogle` grava o nº quando há split (`alguem_fazia==='sim'` + ambos os campos), "—"
  senão. **Fora de `COLUNAS_NUMERICAS`** (p/ "—" não virar 0). Funciona no submit E no resync
  (lê `p.saving`, preservado por `recomputarSavingFinanceiro` via spread).
- `prompt-registry` (nota CARGA REAL × ESCALA), CLAUDE.md (nova seção + layout A→AM), testes:
  `tests/saving-carga-escala.test.ts` (5), +case em `sync-padronizacao.test.ts`, count em `agents-types.test.ts` (14).
- **Decisão consciente preservada:** TOTAL vira R$ (linhas/`saving_reais`/`ganho_total` inalterados);
  o split é só transparência. NÃO mexe em `getMeuProjeto`/`applySeed` — o split round-trip via
  `documentacao.conteudo.saving` (e o gate o re-coleta se a pessoa refizer o saving na edição).

**Mapa original (referência):**

**O quê:** quando `alguem_fazia = 'sim'`, o auditor separa a **carga manual real** (o que a
pessoa de fato fazia, ex. 6h×4=24h) do **ganho incremental por escala** (o que só a automação
passou a fazer, ex. 6h×18d=108h). Objetivo: auditoria qualitativa quase-humana, sem creditar
"240h" como se uma pessoa gastasse isso.

**Decisão (CONSCIENTE, confirmada 2×):** o **TOTAL** (132h) é que vira R$ — `saving_reais`/
`ganho_total` **não mudam**. As 2 colunas novas (`Saving Real` = 24h, `Saving Escalado` = 108h)
são **só transparência**. O antiagente (F5) + humano auditam o abuso.

**Onde mexer (planejado):**
- DB: `projetos.horas_carga_real`, `projetos.horas_escala` (REAL) + `ProjetoRow` + migração.
- `SavingColetado`: 2 campos novos p/ o split fluírem.
- **Gate de prompt** em `buildSavingPrompt` (`orchestrator.ts`): quando `ctx.alguem_fazia==='sim'`,
  bloco obrigatório — separar carga real × escala antes do preview, registrar ambos no memorial.
  (Mecanismo: prompt-enforced, como `[2.4]`/composição; é qualitativo → não dá pra ser botão fixo.)
- Sheets: 2 colunas novas (`Saving Real`/`Saving Escalado` — **criar na planilha e confirmar nome**).
  "Saving Horas" continua o total. **Atualização 29/06/2026:** `alguem_fazia='nao'` (contrafactual)
  passou a gravar **Real=0 / Escalado=total** (100% ganho por escala) via `derivarSplitHorasSheet`
  (`sync.ts`); só `'externo'`/legado-sem-split-capturado/pontual ficam `0/0` (numérico). Vale daqui
  pra frente (submissões + edições; sem backfill). Antes: `'nao'` → `0/0`. Ver `SPEC_CORRECOES.md`.
- `sync.ts` (mapa), `getMeuProjeto`/`applySeed` (seed), `prompt-registry`, CLAUDE.md, testes.

---

## F5 — Antiagente ⏳ (último)

**O quê:** agente crítico adversarial que roda na análise final, **logo após** o analisador
(`analisarProjetoFn`, `chat.functions.ts`), recebendo projeto + conteúdo + veredito. Foco:
saving inflado por escala (casa com F4), vazamentos entre colunas, coerência doc × conversa.

**Decisão:** **só registra** a crítica — **NÃO altera status/complexidade**. Informativo p/ humano.

**Onde mexer (planejado):**
- Novo agente (prompt adversarial) chamado em `analisarProjetoFn` após o analisador.
- DB: `projetos.analise_antiagente` (TEXT) — espelha o padrão de `complexidade`/`observacoes`.
- Sheets: coluna **"Análise Antiagente"** (já criada) via `syncUpdateToGoogle` (`sync.ts`).
- Resiliência: entrar na reconciliação do cron `reanalisar-pendentes` (a análise bg às vezes é
  cancelada — mesma rede de segurança da Complexidade).
- `prompt-registry` (novo prompt) + CLAUDE.md.

---

## Como retomar numa nova sessão (runbook)

1. **Ler este doc + a memória** (`features-novas-spec-junho-2026`).
2. **Sincronizar antes de tudo:** no `main`, `git fetch origin` + `git pull --ff-only origin main`.
   Depois reconciliar cada branch de feature em aberto (procedimento abaixo).
3. **Para cada feature nova:** criar worktree próprio a partir do `main` atualizado
   (regra 8): `git worktree add -b feat/<nome> ../godocs-<nome> main` e
   `ln -sf /home/notebook/godocs-main/node_modules ../godocs-<nome>/node_modules`.
4. **Gate antes de considerar pronto:** `npx tsc --noEmit` (esperar os 5 pré-existentes,
   zero novos) · `npx vitest run` (tudo verde) · `npm run build:worker` · `npm run build`.
5. **Obrigatório (regras CLAUDE.md):** `worker.js` rebuildado+commitado · `prompt-registry.ts`
   atualizado se prompt mudou · texto PT-BR com acento · CLAUDE.md antes do PR · `git pull`
   antes de abrir PR.

### Procedimento de reconcile de uma branch com o `main` (sem commitar o WIP)

```
cd ../godocs-<feature>
git checkout -- worker.js                 # descarta o worker gerado (regenerável)
git stash push -u -m wip -- $(git diff --name-only)
git merge --ff-only main                  # FF do ponteiro da branch (WIP fica fora)
git stash pop                             # reaplica; resolve conflitos se houver
git stash drop                            # só se o pop deixou a stash (houve conflito)
npm run build:worker                      # regenera o worker na base nova
```

**Conflitos recorrentes esperados** (triviais — manter as DUAS adições):
- `src/integrations/db/schema.ts` — array `MIGRATIONS` (várias branches anexam `ALTER TABLE`).
- `src/lib/google/sheets.ts` — `SHEET_COLUMNS` (cada feature anexa colunas).
- `CLAUDE.md` — seções/linha de layout das colunas (A→A?).
- `worker.js` — sempre regenerar, nunca resolver à mão.

## Estado dos worktrees (no momento deste doc)

- `../godocs-ai-proxy` (`feat/ai-proxy-check`) — F1 aplicada, reconciliada com `ba86463`, **não commitada**.
- `../godocs-custos-projeto` (`feat/custos-projeto`) — F3 aplicada, reconciliada com `ba86463`, **não commitada**.
- Stashes de outras sessões podem existir (`other-window-wip-*`, `meus-projetos edicao`) — **não mexer**.

> Este arquivo é **untracked** no root do `main` (não commitado). Serve de bússola da próxima
> sessão; quando os PRs forem abrindo, pode ser removido ou virar um doc em `docs/`.

---

## Feature adicional — Identidade automática (nome + e-mail da conta logada) · jun/2026

> Decisão do dono (Kaique, 2026-06-29): remover do formulário as perguntas de **nome** e
> **e-mail** — são redundantes com a conta autenticada — mantendo apenas **participantes**.

**Problema.** O edge Godeploy já exige OAuth em **todas** as rotas e injeta
`x-godeploy-user-email`. O worker lê isso (`getCurrentUser`) e o e-mail **já é a fonte de
verdade do ownership** no `submeterParaValidacao(body, email)`. Mesmo assim a Etapa 1 pedia
**Nome Completo** e **E-mail** digitados à mão — redundante e propenso a erro (e-mail divergente
do dono real, typo no nome).

**Decisão (fechada).**
- O **e-mail do edge é a fonte de verdade** do responsável/ownership — o form nunca mais o pede.
- **Nome:** lido de um header do edge (`GODEPLOY_NAME_HEADER`, default `x-godeploy-user-name`);
  ausente/vazio → **derivado do local-part do e-mail** (`derivarNomeDeEmail`, Title Case). O
  design **degrada graciosamente**: o nome aparece com ou sem header.
- A identidade vira um bloco **read-only** ("Submetendo como…") na Etapa 1 — não há mais input
  de nome/e-mail. Participantes seguem iguais (com validação de domínio).
- ✅ **CONFIRMADO em deploy (probe nos headers de `/api/auth/me`, 2026-06-30):** o edge Godeploy
  injeta **APENAS** o header de e-mail (`x-godeploy-user-email`) — **não há header de nome**
  (nem `x-godeploy-user-name`, nem `x-forwarded-user`). Portanto **o nome é SEMPRE derivado do
  e-mail**. A leitura de `GODEPLOY_NAME_HEADER` fica como **future-proofing**: se um dia o edge
  passar a injetar um header de nome, basta setar essa env no Godeploy (sem mudar código).

**Onde aterrissou.**
- `src/lib/auth.functions.ts` — `CurrentUser.name`; `getCurrentUser` lê o header de nome (lazy)
  com fallback; novo helper puro exportado `derivarNomeDeEmail(email)`.
- `src/worker.ts` — `/api/auth/me` passa a devolver `name` (sem mudança extra — já serializa o
  `CurrentUser`).
- `src/routes/submeter.tsx` — `useEffect` busca `/api/auth/me` e preenche `form.nome`/
  `form.email` **só se vazios** (não sobrescreve seed de edição / rehydrate de rascunho);
  validação da Etapa 1 não checa mais nome/e-mail (só exige que a identidade exista). `FormData`
  mantém `nome`/`email` (continuam indo no payload de `iniciarSubmissao`/`atualizar-metadados`).
- `src/lib/submeter/step1.tsx` — removidos os campos Nome/E-mail; bloco read-only de identidade
  (a11y: ícone + texto, não só cor); fallback âmbar se a conta não for detectada.
- Docs/env: `docs/backend.md` (Autenticação), `CLAUDE.md` (bullet "Identidade automática"),
  `.env.example` (`GODEPLOY_NAME_HEADER`).

**Status.** ✅ **Mergeada (PR #176) e LIVE em produção** (30/06/2026). `/api/auth/me` retorna
`name`; o form não pede mais nome/e-mail e mostra "Submetendo como…". Testes verdes + `build`
(typecheck) limpo.

## Feature adicional — Botão "Salvar rascunho" no formulário · jul/2026

> Pedido do dono (Kaique, 2026-07-02): controles **pequenos e visíveis** no formulário. Nasceram
> DOIS botões ("Recomeçar" + "Salvar rascunho"); após validar no staging o dono decidiu **manter só
> o "Salvar rascunho"** ("é suficiente") e **remover o "Recomeçar"**.

**Problema.** Quem começava uma submissão e queria parar para submeter outro projeto depois não tinha
caminho claro no próprio formulário — o rascunho só era gerenciável em "Meus Projetos > Rascunhos".

> ⛔ **"Recomeçar" foi implementado e REMOVIDO (decisão do dono, 2026-07-02).** Era um botão destrutivo
> (popup âmbar → `DELETE` do rascunho + `clearDraft` + `window.location.assign('/submeter')`). Ficou só
> "Salvar rascunho". Registrado aqui para não ser reintroduzido por engano — se um dia for preciso,
> o histórico da branch `feat/botao-recomecar-forms` tem a implementação.

### "Salvar rascunho" (guardar e sair)

> Pedido do dono (Kaique, 2026-07-02, mesma leva): um botão que **salva o projeto atual como
> rascunho** e libera o usuário para submeter outro, **redirecionando para a home**, com um popup
> informando os cuidados.

**Decisão (fechada).**
- **Escopo: só submissão nova COM rascunho no servidor** (`projetoId != null`). O rascunho
  server-side (linha `projetos` status `'rascunho'`) só nasce em `iniciar-submissao`
  (`handleIniciarAgente`, que exige arquivos) — **antes do agente iniciar não há o que guardar**,
  então o botão fica **oculto** nas Etapas 1/2 pré-agente e some em edição.
- **O projeto JÁ está parkeado no servidor** (metadados de `iniciar-submissao`/`atualizar-metadados`;
  conversa persistida em `chat_messages` a cada turno). Por isso "salvar rascunho" **não faz POST
  novo** — apenas **desanexa a sessão local** (`clearDraft`, senão `/submeter` retomaria este mesmo
  rascunho em vez de começar um novo), **invalida o cache de Meus Projetos** e **navega para `/`**.
- **Retomada:** por **Meus Projetos › Rascunhos › Continuar** (`?retomar=<id>`, rehidrata do
  servidor via `GET /api/chat/historico/:id`). Mesma fidelidade do resume já existente.
- **Popup informativo** (tom azul, não destrutivo) com os cuidados: **(a)** o rascunho **NÃO foi
  enviado para análise** — a equipe só vê depois de concluir e enviar; **(b)** ao sair, volta à
  home e pode começar outra submissão. Botão "Salvar e sair" (azul).
- ⚠️ **Limitação aceita (igual ao resume atual):** edições de campo das Etapas 1/2 feitas *depois*
  do agente iniciar e ainda não re-enviadas (`atualizar-metadados`), além do input de chat não
  enviado, vivem só no localStorage — ao retomar do servidor podem não voltar. Não vale
  over-engineer: é o mesmo teto do `?retomar` que já existe.

**Onde aterrissou.**
- `src/routes/submeter.tsx` — `import { Loader2, Save, FolderClock } from "lucide-react"`;
  componente **`SalvarRascunhoModal`**; estados `showRascunhoConfirm`/`salvandoRascunho`; handler
  `handleSalvarRascunho` (`invalidateQueries(['meus-projetos'])` → `clearDraft` → `navigate('/')`);
  botão na barra dos `BrowserDots` (gate `!editProjetoId && projetoId`); render do modal ao fim do
  `PageFrame`. **Nenhuma mudança server-side** nesta feature.
- **Fix acoplado (retomada não vaza texto bruto):** a retomada sem snapshot local (forçada pelo
  `clearDraft` do "Salvar rascunho") caía num caminho que despejava a role `'doc'` crua no chat.
  Corrigido em `getHistoricoMeuProjeto` (`meus-projetos.functions.ts`, filtra `user`/`assistant` +
  parseia o JSON do assistant) e no map do histórico no `submeter.tsx`. Detalhe em
  `SPEC_CORRECOES.md` (2026-07-02). Server-side → `worker.js` rebuildado.

**Status.** ✅ Implementada (só "Salvar rascunho"; "Recomeçar" removido) + fix da retomada; testes
verdes (504) + `tsc` sem erros novos. Validada no **staging** (`edf400b4`) e promovida a **produção**
(`674a3710`) em 2026-07-02.

## Feature adicional — Nudge de "versão desatualizada" (version skew) · jul/2026

> Decisão do dono (Kaique, 2026-07-01): oferecer recarregar quando o cliente estiver rodando
> um build antigo. **Só botão manual — nunca recarrega sozinho** (app de formulário longo:
> reload automático interromperia digitação/coleta).

**Problema (medido nos logs de prod, 01/07).** O GoDeploy **acumula** os assets a cada deploy
(manifesto com ~3015 arquivos; dezenas de hashes do mesmo chunk). Consequência: uma aba aberta
há horas continua baixando os **próprios** chunks (que ainda existem → **sem 404**) e conversa
com o worker **novo**. O cliente velho nunca "quebra" e nunca é forçado a atualizar → **version
skew silencioso**. Amostra de ~80 min mostrou **4 builds distintos** do entry `index-*.js`
batendo na API, **2 concorrentes nos últimos 30 min** (atual `DWTXmzVW` + um antigo `DqutV0M1`).
Isso agrava o padrão "cliente sobrepõe servidor" (ex.: draft de edição em localStorage
ressuscitando estágio que o servidor não tem mais).

**Decisão (fechada).**
- Detecção **100% no cliente** — **sem tocar no worker** (nenhum rebuild de `worker.js`). O
  `index.html` é a fonte canônica do build atual: compara-se o entry `<script type="module"
  src="/assets/index-<hash>.js">` **em execução** com o do `/index.html` recém-buscado
  (`cache:'no-store'` + cachebust). Hash diferente → há build novo publicado.
  - ⚠️ Escolhido em vez de expor um `buildId` no `GET /api/config`: aquele exigiria carimbar o
    mesmo id no bundle do SPA **e** no worker (builds separados) + rebuild/deploy do worker. O
    poll do `index.html` é mais leve e não depende de contrato servidor↔cliente.
  - **Não dá pra confiar em 404 de chunk** para forçar reload: como os assets se acumulam, o
    chunk velho **nunca** some. Por isso a detecção é ativa (poll), não reativa a erro.
- **Conservador:** se qualquer lado não for legível (dev sem hash, HTML de erro do edge, offline)
  → **não cutuca**. Em **dev** o entry é `/src/main.tsx` (sem `/assets/*.js`) → faixa nunca aparece.
- **Cadência:** checa no mount, a cada **10 min**, e no `visibilitychange` (voltar pra aba — momento
  mais provável de ter saído deploy). Para de checar depois de detectar (a faixa já está de pé).
- **UX/UI:** faixa `sticky top-0` em `--go-blue` (aviso de sistema — distinta do lime da staging e
  do vermelho de erro) + botão **Recarregar** (`location.reload()`). A11y: `role="status"`,
  ícone + texto (nunca só cor), foco de teclado visível (ring lime), **sem animação perpétua**.

**Onde aterrissou.**
- `src/lib/version-check.ts` — puro/testável: `extractEntrySrc(html)`, `isUpdateAvailable(atual,
  html)`, `getCurrentEntrySrc(doc?)`.
- `src/components/atualizacao-banner.tsx` — `AtualizacaoBanner` (poll + faixa + Recarregar).
- `src/routes/__root.tsx` — montado **acima** da `StagingBanner`.
- `tests/version-check.test.ts` — 10 casos (extração, ordem de atributos invertida, HTML de erro,
  mesmo/outro hash, dev → null, conservadorismo).

**Não faz parte deste PR (fica pra depois).** (a) Limpeza/poda dos ~3015 assets acumulados
(higiene de deploy — podar quebraria abas velhas; melhor migrar todo mundo pelo nudge primeiro);
(b) o guard de fingerprint no draft de edição em localStorage (invalidar o cache local quando o
servidor mudou) — mesma raiz "servidor manda", tratar em PR próprio.

**Status.** ⏳ Implementado; testes verdes + `build` (typecheck) limpo. **Deploy pendente** (a
pedido: sem subir ainda; quando for, regra 13 — staging `edf400b4` antes de prod).

## Feature adicional — Autocomplete de participantes (busca na TeamGuide) · jul/2026

> Pedido do dono (Kaique, 2026-07-02): no campo "E-mails dos participantes" (etapa 1), a cada
> letra digitada o sistema filtra a lista total de e-mails da TeamGuide e reduz as opções, até o
> usuário apertar **Enter** (no item marcado) ou **clicar** no e-mail — com **scroll** quando há
> muitos resultados.

**Decisões (fechadas).**
- **Fonte:** `GET /employees/refs?unpaged=true&page=0` da TeamGuide (mesma API/token `TG_API_TOKEN`
  das áreas) — devolve a base inteira (~440 pessoas: `name`, `contactEmail`, `position`) numa
  chamada só. Validado ao vivo antes de codar (200, 439 itens, todos com e-mail).
- **Filtro no FRONTEND, lista servida 1x:** o worker expõe `GET /api/participantes/sugestoes`
  (autenticada pelo edge como toda rota) com **cache em memória de 10 min**; o cliente busca a
  lista **uma vez** (quando "Em equipe? Sim" aparece) e filtra localmente a cada tecla — zero
  requisição por letra digitada.
- **Degradação suave, nunca bloqueia:** TeamGuide fora do ar → endpoint devolve `[]` (ou o cache
  vencido, se houver) e o campo continua aceitando e-mail digitado livre (validação de domínio
  @gocase/@gobeaute/@gogroup inalterada). O autocomplete é conveniência, não gate.
- **Espaço deixou de ser separador universal:** no campo de participantes, espaço só "fecha" o
  e-mail quando o texto já é um e-mail completo (`EMAIL_RE`); senão passa como texto — sem isso
  seria impossível buscar por nome composto ("maria souza"). Vírgula/`;`/Tab/Enter seguem separando.
- **A11y (padrão combobox):** `role="combobox"`/`listbox`/`option`, `aria-activedescendant`, item
  ativo marcado por fundo azul + barra lime **+ selo "↵ Enter"** (estado nunca só por cor),
  `scrollIntoView` na navegação ↑/↓, Esc fecha até a próxima digitação, `prefers-reduced-motion`
  coberto pelo guard global do `styles.css`.
- **Relevância:** todas as palavras da busca precisam casar (nome OU e-mail, sem acento/caixa);
  ordena e-mail-começa-por > nome-começa-por > demais; exclui já adicionados; renderiza até 80 de
  uma vez (rodapé "mostrando 80 de N") com rolagem (`max-h-60`).

**Onde aterrissou.**
- `src/lib/areas/teamguide.server.ts` — `listarPessoasTeamGuide()` (reusa `tgGet` com retry).
- `src/lib/participantes.functions.ts` — `getSugestoesParticipantes()` (cache TTL 10 min).
- `src/worker.ts` — rota `GET /api/participantes/sugestoes`.
- `src/lib/submeter/participantes-sugestoes.ts` — `filtrarSugestoes()` (puro, testável) +
  `useSugestoesParticipantes()` (fetch 1x com cache de módulo).
- `src/lib/submeter/form-components.tsx` — combobox no **`ParticipantesPapeisInput`** (prop
  `suggestions`) — reconciliado com a feature de papéis (PR #195), que substituiu o `ChipsInput`
  na Etapa 1 no meio desta implementação; o `ChipsInput` ficou como estava (não mais usado).
- `src/lib/submeter/step1.tsx` — carrega quando `emEquipe === 'sim'` e injeta no
  `ParticipantesPapeisInput`.
- `tests/participantes-sugestoes.test.ts` — 9 casos (filtro, acentos, dedup, ranking; listagem
  TeamGuide com fetch mockado).

**Status.** ⏳ Implementado; testes verdes, `build` + `build:worker` limpos, endpoint validado
contra a TeamGuide real no dev server. Deploy: regra 13 (staging `edf400b4` antes de prod).


## Feature adicional — Papéis dos participantes (Coexecutor/Planejador/Idealizador/Referência técnica) · jul/2026

> Decisão do dono (Luis, 2026-07-02): na submissão em equipe, cada participante recebe um **papel**.
> A coluna "Participantes" do Sheets passa a ser a de **Coexecutor** (sem renomear); três colunas
> novas (I/J/K) guardam os demais papéis. As colunas novas são criadas **manualmente** na planilha.

> 🔤 **REDESENHO PARA 3 PAPÉIS (Kaique, 2026-07-02):** de 4 papéis passou a **3** —
> **Coautor**, **Participante**, **Contribuidor**. Mapeamento form → coluna do Sheets:
> **Coautor → "Participantes"** · **Participante → "Participantes 2"** (ex-"Planejador")
> · **Contribuidor → "Contribuidor"**. Os antigos **Idealizador** e **Referência técnica** foram
> **removidos** do seletor e consolidados em **Contribuidor** (no sync os valores legados
> `idealizador`/`referencia_tecnica` caem na coluna "Contribuidor"). ⚠️ **Os `value` internos
> `coexecutor`(=Coautor)/`planejador`(=Participante) foram MANTIDOS** (invisíveis; trocá-los exigiria
> migrar `membros_papeis`); o 3º papel usa o value novo `contribuidor`. O `membrosPapeisSchema` aceita
> os 3 atuais **+** os 2 legados (não rejeita cliente com cache antigo — version skew).
> **Abaixo, o texto original (4 papéis) fica como histórico; vale o redesenho acima.**

> 📖 **Legenda dos papéis (Kaique, 2026-07-02):** abaixo do campo de participantes (Etapa 1, só com
> "em equipe = sim") há uma **legenda** explicando o que cada papel significa — uma linha por papel
> com o ponto colorido (mesma cor do seletor, `COR_PAPEL`), o rótulo em negrito e a descrição.
> Componente `LegendaPapeis` + mapa `DESCRICAO_PAPEL` em `form-components.tsx`; renderizado em
> `step1.tsx` logo após `ParticipantesPapeisInput`. Só UI (sem backend). Textos: Coautor = "Executou e
> esteve à frente… executor ou coexecutor principal"; Participante = "Apoiou diretamente… entregas
> concretas dentro de um escopo definido"; Contribuidor = "Auxiliou com planejamento, decisões técnicas
> ou ideias, sem atuar diretamente na execução".

> 🔎 **Log dos papéis no Investigador (Kaique, 2026-07-02):** o timeline do Investigador (aba "Chat")
> passa a exibir os PAPÉIS dos participantes nos eventos **"Formulário enviado"** (`submissao`) e
> **"Dados atualizados"** (`metadados`), como uma linha **"Participantes e papéis"**: `email (Coautor),
> email2 (Participante), …`. **Abordagem aditiva/não-destrutiva (sensível ao banco):** o backend só
> acrescenta a chave `membros_papeis` ao JSON `dados` dos dois `gravarEvento` (`chat.functions.ts`) — a
> coluna `form_events.dados` já existe (**sem migração**), a regra **append-only** do `form_events`
> é preservada e `gravarEvento` segue não-bloqueante. **Retrocompatível:** eventos antigos sem
> `membros_papeis` renderizam a linha "Membros" simples de antes. No front (`investigador.tsx`):
> helper puro `formatarPapeisEvento` + mapa `PAPEL_LABEL_INVESTIGADOR` (value→rótulo, com os legados
> `idealizador`/`referencia_tecnica` → "Contribuidor"); `linhasDoEvento` troca "Membros" por
> "Participantes e papéis" quando há papéis (submissao e metadados). `worker.js` rebuildado.

> 👤 **COAUTOR ÚNICO POR PROJETO (Luis, 2026-07-30):** cada projeto tem **1 autor** (o submissor/dono,
> `responsavel_email`, que não escolhe papel) e **no máximo 1 Coautor** (`coexecutor`). Não é possível
> marcar 2+ pessoas como Coautor; os demais participantes ficam como **Participante** ou
> **Contribuidor** (esses seguem SEM limite). Implementação (só cliente — nenhuma mudança de schema,
> sync ou colunas do Sheets; `derivarColunasPapeis` continua aceitando lista, para legados):
> **(a)** helpers puros em `submeter/constants.ts` — `PAPEL_COAUTOR`, `coautoresSelecionados()` e
> `limitarCoautorUnico()`; **(b)** `validarEtapa1` bloqueia o avanço da Etapa 1 com 2+ Coautores
> (mensagem "Só é possível ter 1 Coautor por projeto…"), nos dois modos (submissão nova e edição);
> **(c)** no seletor (`ParticipantesPapeisInput`), a opção **Coautor** SAI da lista dos demais
> quando alguém já é Coautor (`papeisDisponiveis(email)` — nada de opção morta/desabilitada na tela;
> decisão do Luis, 30/07/2026); quem É o Coautor mantém a opção, para exibir o papel atual e poder
> trocar; **(d)** nota informativa (ícone + texto, nunca só cor) — é ela que EXPLICA a ausência
> abaixo da lista e "Apenas 1 por projeto" na descrição do papel na `LegendaPapeis`.
> ⚠️ **Legado/edição:** um projeto antigo (ou legado importado do Sheets, onde a coluna
> "Participantes" pode ter vários e-mails) traria vários Coautores no seed — `applySeed`
> (`submeter.tsx`) aplica `limitarCoautorUnico`, **mantendo o primeiro** e **limpando o papel dos
> demais** (não promove ninguém por conta própria); a validação então exige que o usuário
> reclassifique. Testes: `tests/validacao-etapa1.test.ts`.

**Decisões fechadas (com o Luis).**
- **4 papéis**, um por pessoa (seletor por participante): `coexecutor · planejador · idealizador
  · referencia_tecnica`. O **autor/submissor NÃO** se classifica — é o dono (`responsavel_email`),
  fora da lista de participantes. Só os e-mails do time adicionados ganham papel.
- **Obriga escolher**: participante entra **sem papel** e o gate de avançar da Etapa 1 bloqueia
  enquanto alguém estiver sem papel. (Exceção: na EDIÇÃO, membros já existentes sem papel conhecido
  entram como **coexecutor** — semântica da coluna "Participantes" de onde vieram; novos participantes
  começam sem papel.)
- **Todos os papéis contam como participante** (acesso de leitura, "Participo", editor delegado):
  `membros` = **união dos 4 papéis** — ownership/agentes/editor delegado **inalterados**.
- **Sheets**: "Participantes" (H)=coexecutores; "Planejador"/"Idealizador"/"Referência técnica"
  (I/J/K) os demais. Cada e-mail em **uma** coluna. Coluna sem ninguém → **"—"**. Papel
  ausente/desconhecido → coexecutor (retrocompatível: legados com todos em "Participantes").

**Onde aterrissou.**
- `src/lib/submeter/constants.ts` — `PAPEIS_PARTICIPANTE` + tipo `PapelParticipante`;
  `FormData.participantesPapeis` (mapa e-mail→papel); helper puro `montarMembrosPapeis`.
- `src/lib/submeter/form-components.tsx` — novo `ParticipantesPapeisInput` (lista uma-linha-por-pessoa
  + `<select>` de papel; a11y: `aria-label` por linha, foco visível, estado por texto+cor; nudge
  âmbar "N sem papel"). `ChipsInput` antigo permanece (não mais usado na Etapa 1).
- `src/lib/submeter/step1.tsx` — usa o novo componente; `setPapelParticipant`/`removeParticipant`.
- `src/routes/submeter.tsx` — estado inicial `{}`; `applySeed` seeda papéis (fallback coexecutor);
  `snapshotMeta`/`AgentMeta` carregam papéis (troca de papel dispara metaChanged → persiste);
  validação da Etapa 1 exige papel; payload `membros_papeis` em iniciar-submissao + atualizar-metadados;
  rehydrate normaliza rascunho antigo (`?? {}`).
- Banco: `membros_papeis TEXT` (migração idempotente, `schema.ts`); `InsertProjeto`/`ProjetoRow`/
  `insertProjeto` (`client.server.ts`). Schemas + persistência em `chat.functions.ts`
  (`membrosPapeisSchema`). `getMeuProjeto` devolve `membros_papeis` (seed da edição).
- Sync: `derivarColunasPapeis` (IDA, `sync.ts`) distribui nas 4 colunas; `parseParticipantesPapeis`
  (VOLTA, `sync-reverse.ts`) reconstrói `membros`(união)+`membros_papeis`; filtro por dono checa as
  4 colunas; `SHEET_COLUMNS` ganha os 3 nomes (`sheets.ts`).
- Testes: `tests/participantes-papeis.test.ts` (derivarColunasPapeis + montarMembrosPapeis) +
  caso de papéis em `tests/sync-reverse.test.ts`.

**Dependência de planilha (manual, do dono) — pós-redesenho 3 papéis.** As colunas de papel agora são
**`Participantes`** (Coautor), **`Participantes 2`** (ex-`Planejador` → Participante) e
**`Contribuidor`**. Precisam existir no cabeçalho com **exatamente** esses nomes (caixa + acentos),
tanto na aba **`GoDocs`** (prod) quanto na **`STAGING`**. Ações do dono na planilha: **(1)** renomear a
coluna antiga **"Planejador" → "Participantes 2"**; **(2)** garantir uma coluna **"Contribuidor"** (pode
reaproveitar a antiga "Idealizador" renomeando, ou criar nova). As antigas "Idealizador"/"Referência
técnica" saíram do código (o append/update não escreve mais nelas). Enquanto uma coluna esperada não
existir, o append/update **ignora** com aviso (não quebra) e só as presentes são gravadas.

**Status.** ⏳ Implementado; testes verdes (526) + `build`/`build:worker` OK; typecheck sem novos
erros (baseline pré-existente inalterado). **Deploy pendente** (regra 13 — staging `edf400b4` antes
de prod; requer as 3 colunas nas abas).

---

## Feature adicional — Descontinuar projeto (jul/2026)

**Pedido.** Em "Meus Projetos", o dono precisa poder marcar um projeto como
**"Descontinuado"** (a automação não roda mais). Ao marcar: o status na planilha vira
"Descontinuado" (já é opção da lista suspensa) e o projeto **para de contar** para os
avisos de pendência.

**Decisão de arquitetura.** O status flui só num sentido (SQLite→Sheets, hoje sempre
"Pendente" pela regra TEMPORÁRIA) e o **sync reverso EXCLUI status** — então o "Status"
do Sheets nunca volta ao SQLite. Por isso a fonte da verdade de "descontinuado" é uma
**coluna própria no SQLite** (`projetos.descontinuado` INTEGER 0/1), não o Status do
Sheets. Isso mantém a contagem de pendências (que lê SQLite, rápido) correta sem
depender da planilha.

**Como funciona.**
- **Backend** `descontinuarProjeto(email, id, descontinuar)` (`meus-projetos.functions.ts`):
  gate = quem pode editar (dono, editor delegado ou admin RPA não-participante, igual ao
  `getMeuProjeto`); rascunho → 400 (não existe na planilha). Grava a flag e reflete
  **"Descontinuado"** na coluna Status do Sheets via `updateRowByProjectId` (best-effort —
  a flag no SQLite já governa o app). Reativar grava **"Pendente"** (valor da regra
  TEMPORÁRIA). Rota `POST /api/meus-projetos/:id/descontinuar` (body `{ descontinuar }`).
- **Para de contar / badge:** `contarPendentes` e `mapItem.pendente` excluem
  `descontinuado===1`; `mapItem.status` dá **precedência** à flag (badge "Descontinuado"
  na hora, mesmo se a escrita no Sheets atrasar/falhar). Badge cinza-ardósia + ícone
  `Archive` (`StatusBadge`) — estado nunca só por cor.
- **Reativação:** botão "Reativar" no card **ou** reenviar o projeto — `submeterParaValidacao`
  zera a flag (`descontinuado: 0`) e a IDA volta a gravar "Pendente".
- **Sync reverso reconhece o dropdown:** marcar "Descontinuado" manualmente na planilha
  liga a flag (`criarLegado` + `atualizarExistente`, `sync-reverse.ts`) — **mão única**:
  não desmarca pela planilha porque a IDA grava sempre "Pendente" (ambíguo). Reativar é
  ação do app. A coluna `descontinuado` é INTERNA (fora de `SAFE_UPDATE_FIELDS`).
- **Frontend** (`meus-projetos.tsx`): botão `Archive` (confirmação no toast) / `RotateCcw`
  (reativar direto), só para quem pode editar, em projetos submetidos. Atualização
  otimista do cache (sem refetch da lista, que lê o Sheets ~9s).

**Testes.** `tests/sync-reverse.test.ts` ganhou o bloco "reconhecimento de Descontinuado"
(cria legado descontinuado · promove ativo→descontinuado · NÃO reativa por "Pendente").

**Dependência de planilha.** Nenhuma coluna nova no Sheets — só usa o valor
**"Descontinuado"** (já existente) da lista suspensa da coluna **Status**.

**Status.** ⏳ Implementado; testes verdes (537) + `build`/`build:worker` OK. Deploy em
staging (`edf400b4`) primeiro (regra 13).

---

## Feature adicional — Alerta do Google Chat enxuto para projeto especial · jul/2026

**Motivação.** O alerta de submissão no Google Chat (`buildSubmitMessage`, `src/lib/google/chat.ts`)
era único para todo projeto. Projeto **especial** pula o analisador e vai direto à avaliação humana —
não tem saving/receita/escopo/tipos financeiros — então o alerta trazia linhas sempre zero/irrelevantes
(`Saving estimado 0h`, `R$ 0,00`, `Escopo: —`, `Tipos: especial`) e **não** mostrava a justificativa do
porquê o projeto é especial (`contexto_especial`), que é justamente o que o avaliador precisa ler.

**O que mudou.** `buildSubmitMessage` recebe dois campos opcionais — `especial?: boolean` e
`contextoEspecial?: string`. Quando `especial` é `true`, desvia para `buildEspecialMessage` (mesmo
arquivo), que monta um alerta enxuto:
- **Mantém** os metadados que fazem sentido: Projeto, Área, Ferramenta, Solicitante, E-mail,
  Participantes, Descrição, Data da submissão, link da planilha.
- **Omite** Escopo, Tipos, Saving (horas/R$/tipo) e Receita — irrelevantes ao caso.
- **Destaca** a justificativa: bloco `⭐ Por que é um projeto especial:` com o `contexto_especial`
  (traço `—` quando vazio, nunca linha em branco).
- Cabeçalho próprio: `⭐ Projeto especial – avaliação humana necessária` (ou `✏️ Edição de projeto
  especial …` no modo edição).

**Onde aterrissou.** `src/lib/google/chat.ts` (`buildSubmitMessage` + novo `buildEspecialMessage`);
caller `src/lib/google/sync.ts` (`syncSubmitToGoogle`) passa `especial: p.projeto.especial === 1` e
`contextoEspecial: p.projeto.contexto_especial`. Teste: `tests/chat-message-especial.test.ts`.

**Status.** ⏳ Implementado (jul/2026); **este doc não comprova o deploy** — conferir no app antes de afirmar. ⚠️ **Revisitada em 11/08/2026** — a mensagem do especial encolheu de
novo (saíram Ferramenta, Participantes, Data da submissão e os separadores; descrição e justificativa
passaram a ser truncadas), porque com a mudança abaixo ela virou uma das poucas que ainda saem na
submissão. Ver "Notificação do Chat só quando há pré-aprovação do líder".

## Feature adicional — Botão "Refazer" o memorial financeiro na revisão final · jul/2026

**Motivação.** Na tela final ("Enviar para Triagem") a pessoa só conseguia mexer na
**documentação** (mandando um arquivo/informação nova, que reprocessa a doc). O **memorial
financeiro** já aprovado ficava travado: para trocar cargos/horas/valores era preciso recomeçar
a submissão do zero. Faltava um caminho para refazer **só** o memorial, preservando a doc.

**O que mudou.** Um botão **"Refazer"** no cabeçalho do card do memorial financeiro aprovado da
revisão final (`FinalReview`/`CollapsiblePreviewCard`, `step3-chat.tsx`). Reabre o formulário
determinístico da fase financeira **pré-preenchido** (cargos/horas/custos, ou receita) sem tocar
na documentação. Fica no card **Memorial de Saving**; em projeto **só-receita** (sem card de
saving), fica no card **Memorial de Receita**. Card de documentação **não** recebe o botão
(resetar doc = recomeçar, decisão de produto). Projeto **especial** (sem memorial financeiro)
não recebe o botão.

- **Handler** `handleReiniciarMemorial` (`submeter.tsx`): sai da revisão final
  (`setChatComplete(false)`) e chama `openSavingForm()` (ou `openReceitaForm()` no só-receita),
  que recoloca o snapshot já enviado (`savingSubmitted`/`receitaSubmitted`). Gate: só quando há
  memorial financeiro (`!especial && (saving || receita)`), **independente de ser edição** — vale
  igual na **submissão nova** e na **edição** (mesmo `FinalReview`).
- **Reenvio do formulário:** se mudar algo, a fase financeira reinicia (invalida o preview
  antigo, como no "Editar dados"); se **não** mudar nada, volta direto à revisão final — agora
  **simétrico** nos dois fluxos (o ramo `!editProjetoId && !temReceita && approvedSavingPreview`
  de `handleSavingFormSubmit` passou a marcar `chatComplete=true`; antes só a edição fazia isso).

**Onde aterrissou.** `src/routes/submeter.tsx` (`handleReiniciarMemorial`, prop
`onReiniciarMemorial` no `Step3Chat`, ramo de reenvio-sem-mudança em `handleSavingFormSubmit`);
`src/lib/submeter/step3-chat.tsx` (`onReiniciarMemorial` encadeado até `FinalReview`; prop
`onRefazer`/`refazerDisabled` no `CollapsiblePreviewCard`, cabeçalho refatorado de `<button>`
único para container com toggle + ação, mantendo a11y — foco de teclado, `aria-label` no
chevron, estado por ícone+rótulo). Sem mudança de backend/worker.

**Status.** ✅ Implementado; **538 testes verdes** + `build`/`build:worker` OK; **validado na
staging** (`edf400b4`) e **deployado em produção** (`674a3710`, `godocs.devgogroup.com`).

## Feature adicional — Remover arquivo já enviado + processar doc em background (Etapa 2) · jul/2026

Duas melhorias na Etapa 2 do `/submeter` (arquivos). Plano: `docs/plans/remover-arquivo-e-doc-background.md`.

**F1 — Remover de verdade um arquivo já enviado.** O box "Arquivos enviados anteriormente"
(`step2.tsx`) listava os nomes **sem** como removê-los: quem subia um arquivo e o removia via ✕
da árvore via o nome "voltar" no box amarelo, sem saída (o arquivo "ficava na memória").
- **UI:** cada item do box ganhou um **✕** (`onRemoverExistente`, sempre visível, `aria-label`,
  foco de teclado, estado por ícone+rótulo). Copy adaptativa: padrão = "texto reaproveitado";
  após remover = aviso pedindo re-upload. Box some quando esvazia → aviso avulso orienta.
- **Estado:** `handleRemoverExistente` (`submeter.tsx`) tira o nome de `nomesExistentes` +
  liga `docExistenteInvalidado` (persistido no `DraftSnapshot` → sobrevive ao reload).
- **Regra (decisão fechada — Opção A):** o servidor guarda a documentação como **um `doc`
  concatenado** (`chat.functions.ts`, `insertChatMessage role:"doc"`), **não por arquivo**, e o
  cliente não retém os `File` antigos → **não há como regenerar de um subconjunto**. Logo remover
  um arquivo já enviado **invalida** a doc e **exige re-upload** dos que se quer manter (para 1
  arquivo, o caso comum, é transparente). `validarEtapa2` (função pura em `constants.ts`) bloqueia
  o "Continuar" quando `docExistenteInvalidado && sem upload novo`. A flag é limpa quando a doc é
  regenerada (`handleIniciarAgente`/`reprocessarComNovosArquivos`/background). **NÃO** foi feita a
  Opção B (guardar texto por-arquivo no servidor) — fora de escopo.

**F2 — Processar a documentação em segundo plano ao subir arquivos.** Antes, toda a extração +
geração da doc (`iniciar-submissao`: `extractTextFromMultipleFiles` + extrator + orquestrador,
tudo LLM) só rodava no clique "Analisar com Agente" (Etapa 2→3), com o usuário esperando.
- **Disparo (gatilho ENXUTO — "adiantar o background"):** um efeito com **debounce (~800ms)** chama
  `iniciar-submissao` em background quando `!editProjetoId && arquivos.length>0 && !projetoId &&
  camposMinimosDocProntos(form)` e a assinatura (arquivos+meta) mudou. ⚠️ `camposMinimosDocProntos`
  exige **só escopo + nome (Etapa 1)** — deliberadamente **NÃO** espera `descricaoBreve≥60` nem
  `usaAiProxy` (campos da Etapa 2 que a pessoa digita/responde por último). Com o gatilho no fim da
  Etapa 2, o background não tinha folga para terminar antes do clique em avançar e a pessoa esperava
  o processamento inteiro num spinner (feedback do Luis, 22/07). Enxuto, o disparo acontece assim que
  o **arquivo é anexado**, dando ao processamento o tempo em que ela preenche o resto. O texto do
  documento é o input principal do extrator; a descrição é sinal secundário e chega ao servidor via
  `atualizar-metadados` ao avançar. **Trade-off aceito:** o extrator pode rodar antes de a descrição
  final estar pronta (qualidade de pré-preenchimento levemente menor), e quem avançar em ~2-3s ainda
  pode pegar o fim do processamento no spinner (mitigado, não eliminado). Dedup por `bgSigRef` +
  `bgInFlightRef`; cria o rascunho **uma vez**. Status discreto no `step2` (`bgStatus`:
  processando/pronto/erro) — **não** bloqueia a navegação.
- **Sem tipo/especial:** o background roda a **fase de doc** SEM `tipos`/`especial` (definidos na
  Etapa 2.5, não afetam a documentação). O backend reusa `iniciar-submissao` **sem alteração**.
- **Idempotência da Etapa 2.5 (evita projeto DUPLICADO):** quando o background já criou o projeto,
  o botão não-especial já vira "Continuar com Agente" (`handleContinuarAgente`, que sincroniza
  tipos/meta e navega). Para a janela em que o disparo ainda está **em voo**, `handleIniciarAgente`
  aguarda `bgPromiseRef` e delega via flag `pendingContinuar` (um render depois, com `projetoId`
  fresco no estado — evita ler o valor stale logo após o `setProjetoId`). `handleEnviarEspecial`
  (submissão nova), se o background já criou um projeto não-especial, **converte** via
  `atualizar-metadados {especial:true, reset_doc:true}` (que monta `buildDocEspecial` sem IA +
  `chat_completo`) em vez de recriar.
- **Escopo:** só **submissão NOVA** (`!editProjetoId`) — a edição mantém o caminho próprio de
  reprocesso (mais frágil, BUG ABERTO de legado; não regride). Sem mudança de backend/worker.

**Onde aterrissou.** `src/lib/submeter/step2.tsx` (✕ no box + `bgStatus`), `src/routes/submeter.tsx`
(`docExistenteInvalidado`, `handleRemoverExistente`, `dispararDocBackground` + efeitos, guardas de
idempotência em `handleIniciarAgente`/`handleEnviarEspecial`), `src/lib/submeter/constants.ts`
(`validarEtapa2` + `camposMinimosDocProntos` puras), `src/lib/submeter/draft-storage.ts`
(`docExistenteInvalidado` no snapshot). Testes: `tests/validacao-etapa2.test.ts`.

**Status.** ✅ Implementado; **576 testes verdes** + `build`/`build:worker` OK. ⏳ Pendente:
validar na **staging** (`edf400b4`) e deployar em **produção** (`674a3710`).

## Feature adicional — Critério de projeto: classificação da avaliação + reprovação com motivo · jul/2026

**Spec própria (completa):** [`SPEC_CRITERIOS_PROJETO.md`](SPEC_CRITERIOS_PROJETO.md) · régua para a gestão
em [`docs/criterios-projeto-recorrencia-evidencia.md`](../docs/criterios-projeto-recorrencia-evidencia.md) ·
plano em [`docs/plans/criterios-projeto-classificacao.md`](../docs/plans/criterios-projeto-classificacao.md).

Resumo: o analisador passou a julgar **elegibilidade** ("isto é projeto?") além da qualidade, pela régua de
**recorrência · contrafactual · rastreabilidade** (pedido do Rafa, caso da nuvem de palavras). A Etapa 2
ganhou 2 perguntas determinísticas (**ponteiro movido** + **onde verificar** + **contrafactual**), o
memorial ganhou a seção obrigatória **"Processo alterado"** (que o agente NÃO pergunta quando a doc já traz
a magnitude) e a planilha ganhou 3 colunas (`Classificação` sempre preenchida · `Motivo Reprovado` ·
`Motivo Reenvio`, esta **só humana**). `claro_nao` → status **`Reprovado`** (única exceção à regra
TEMPORÁRIA do "Pendente"), com motivo que **o autor vê**. Invariantes na função pura
`normalizarClassificacao`: nunca reprova sem motivo · especial nunca reprova automático · materialidade
> R$ 5k/mês vira decisão humana · justificativa nunca vazia. **Barrar submissão continua FORA** — a
reprovação é pós-envio e a triagem humana sobrepõe tudo.

---

## Gate de sobreposição RECEITA × CUSTO EVITADO (04/08/2026)

**Problema.** O anti-dupla-contagem existente só compara *horas × custo evitado*. O mesmo
dinheiro declarado como **custo evitado** (saving) e, depois, como **receita incremental**
passava batido. Caso Sucesso.AI (Maria Ponciano): "Ressarcimento das transportadoras"
(R$ 55.864,38) e "Receita retida em reenvio" (R$ 106.049,40) estavam nos itens de custo
evitado e foram declarados de novo como receita — R$ 161.913,78, exatamente a soma.

**Por que avisar não bastava.** O agente PERCEBEU e avisou: _"os R$ 55.864,38 são
ressarcimento/cobrança de transportadora — isso é saving operacional, não receita
incremental… confirme se devo excluir"_. A autora **repetiu o valor sem justificar** e ele
aceitou. Duas falhas: (a) ele nunca disse que o valor **já estava contabilizado** — porque
a fase de receita não lê os itens do custo evitado; (b) um aviso que se atravessa
repetindo o número não é trava.

**O que foi feito.**
1. **Detecção determinística** (`detectarSobreposicaoReceita`), não depende do LLM
   perceber (⚠️ "o prompt sozinho NÃO segurava"): compara os itens do custo evitado com o
   dinheiro da receita por **valor** (item == total · item citado no racional · soma dos
   itens == total) ou por **nome** (nome do item dentro do racional, **≥8 chars** — nomes
   curtos como "Frete" armariam o gate em qualquer projeto).
2. **Confirmação explícita, não aviso**: bloqueia preview/complete e pergunta com
   `type:'options'` — "são valores diferentes" × "é o mesmo dinheiro". A pergunta NOMEIA a
   inconsistência (o que é custo evitado, o que é receita, e que seriam contados 2×).
3. **`custo_evitado_itens` em `ProjetoContexto`** (+ `getProjetoContextoData`) — insumo
   EXCLUSIVO do gate. ⚠️ **Não entra em prompt**: o R$ do custo evitado é escondido do LLM
   por decisão de produto.

**⚠️ ANTI-LOOP — 4 travas por construção.** Este repo já queimou duas vezes (loop de 38
perguntas do gate `[1.4]`; forçamento do split carga×escala, removido em 03/07/2026 por
travar a edição). Por isso:
- **(1) No máximo 2 perguntas**, sempre — independe de a resposta ser boa.
- **(2) Máquina estritamente MONOTÔNICA**: `null → 'pendente' → 'reperguntado' → terminal`
  (`'confirmado'`/`'ajustar'`/`'nao_respondido'`). Nenhum ramo anda para trás.
  ⚠️ A 1ª versão do ramo de bloqueio via `'reperguntado'` e voltava a `'pendente'` — **loop
  real**, alcançável quando outro gate consome o turno de resposta na cadeia de `else if`.
  Pego pelo **teste de simulação de 20 turnos**, não por revisão. O teste ficou.
- **(3) Saída por CLIQUE**, não por juízo do LLM sobre texto livre — foi exatamente o
  juízo-sobre-texto que produziu os dois loops anteriores.
- **(4) Lê o estado VIVO**, nunca o snapshot do topo do turno (lição do bug das 38).

**Desfechos.** `'confirmado'` → nudge manda registrar no memorial, em uma frase, o que
distingue os dois. `'ajustar'` → nudge manda voltar ao saving e remover o item duplicado;
**não** muta o saving sozinho. `'nao_respondido'` → libera e grava no memorial
"Sobreposição … apontada e não confirmada pelo autor — conferir na triagem".

**Não confunde o bot:** zero instrução nova no prompt no caminho normal — o gate é código
determinístico e o nudge `[SISTEMA]` entra **uma vez**, só quando dispara. Roda depois do
gate do critério e só com `!reask` (um gate por turno).

**Onde aterrissou:** `src/lib/agents/sobreposicao-receita.ts` (módulo puro) ·
`src/lib/agents/types.ts` (`ReceitaColetada.sobreposicao_custo_evitado`,
`ProjetoContexto.custo_evitado_itens`) · `src/integrations/db/client.server.ts` (SELECT) ·
`src/lib/chat.functions.ts` (ramos de resposta 6/6b, ramo de bloqueio, re-merge) ·
`tests/sobreposicao-receita.test.ts` (23 testes; detecção do caso real, falsos positivos,
interpretação, e as simulações anti-loop).

**Escopo v1.** Só a fase de receita e só com itens de custo evitado presentes. A ordem
inversa (receita declarada primeiro, custo evitado depois) fica de fora.

---

## Feature adicional — Ferramenta EDITÁVEL na Etapa 1 da edição (07/08/2026)

**Pedido (Luis, 07/08/2026):** "na etapa 1 de edição dos projetos, quero que permita editar
a ferramenta utilizada por um projeto, pois atualmente só dá pra editar os participantes.
Dessa forma a pessoa vai poder editar uma mudança como Vercel → GoDeploy (mudou o ambiente
de hospedagem)."

**⚠️ Isto REVOGA em parte o refinamento R2 de 17/07/2026**
(`docs/plans/edicao-etapa1-participantes.md`), que tinha jogado **escopo + status +
ferramenta** para o card "🔒 Dados do projeto · somente leitura". Continuam read-only o
**escopo** (interna/externa) e o **status de produção**; **só a ferramenta saiu do card**.
Não "consertar" devolvendo a ferramenta ao card — é decisão do dono do produto.

**Por que escopo e status seguem fixos:** trocar o escopo muda a regra financeira (custo
externo entra/sai do saving líquido) e o status é a premissa nº 1 do formulário (só entra
projeto em produção). A ferramenta não altera cálculo nenhum — é descrição da stack, e a
stack de um projeto vivo muda de verdade.

**O que mudou**
- `src/lib/submeter/step1.tsx` — o campo virou o bloco compartilhado `blocoFerramenta`,
  usado nos DOIS modos (submissão nova inalterada). Na edição ele aparece entre a
  identidade e os participantes, com uma linha de ajuda ("Trocou de ferramenta desde a
  submissão? Atualize aqui"). O card read-only ficou com Escopo + Status.
- **Legado com ferramenta fora da lista** ("Power Automate", "VBA"…): o `<select>` injeta o
  valor atual como opção. Sem isso ele abriria VAZIO na edição e a pessoa acharia que o
  dado sumiu.
- `src/lib/submeter/constants.ts` (`validarEtapa1`) — a ferramenta **segue opcional na
  edição** (legado pode não tê-la, RF-103), mas escolher **"Outros" sem escrever o nome**
  passa a bloquear nos DOIS modos: gravaria a string literal "Outros" na planilha.
- `src/lib/chat.functions.ts` (`atualizarMetadados`) — schema aceita e persiste
  **`servico_externo`**. No escopo EXTERNO o mesmo campo é o nome do serviço contratado, e
  ele tem coluna própria que alimenta o prompt do orquestrador ("solução EXTERNA contratada
  (X)"); sem isso, editar o serviço atualizava só `ferramenta` e o **agente seguia citando o
  nome antigo**. O `escopo` em si continua **não** editável (por isso não entrou no schema).
- `src/routes/submeter.tsx` — helper `servicoExternoEnviado()` e o campo adicionado nos **6**
  payloads de `atualizar-metadados`.

**Encanamento que já existia (nada novo):** a Etapa 1 → 3 sempre passa por
`handleContinuarAgente`, que detecta `metaChanged` (o `ferramenta` já estava no
`snapshotMeta`) e persiste via `atualizar-metadados`; a IDA para o Sheets grava a coluna
**"Ferramenta"** a partir de `projetos.ferramenta`, e o sync reverso a tem em
`SAFE_UPDATE_FIELDS`.

**Testes:** `tests/validacao-etapa1.test.ts` — troca de ferramenta na edição não gera erro;
"Outros" sem nome bloqueia nos 2 modos; escopo externo fora dessa regra.

> ⚠️ **Superado em parte pela feature abaixo (12/08/2026):** o campo virou **multi-seleção
> em grade de checkbox** e o `<select>` (com a `<option>` extra do legado) deixou de existir. O que
> continua valendo desta seção: a ferramenta é **editável na edição**, escopo e status
> seguem read-only, e o legado fora da lista nunca desaparece da tela.

---

## Feature adicional — Ferramentas em MULTI-seleção (grade 3×3) + o Claude dividido em 3 (12/08/2026)

**Pedido (Luis, 12/08/2026):** "quero que torne o campo de ferramentas uma multi-seleção
(pense de forma bem agradável e bonita de usar) e divida 'Claude' entre 'Claude AI',
'Claude Cowork' e 'Claude Code'. Além disso, bote uma frase dizendo que é a ferramenta usada
para construção do projeto, e não a ferramenta na qual o projeto funciona (até pq isso fica
na documentação, como supabase e tal)." Complemento no mesmo dia: **"godeploy pode ficar como
ferramenta pq é exceção, só ele"**. E, depois de ver a tela: **"remova o 'só o godeploy é…'
ninguém precisa saber disso"** + **"veja como a lista de ferramentas ficou estranha visualmente,
repense e melhore"** (o que trocou pílulas por grade — item 5 abaixo).

### Decisões fechadas (não "consertar" por engano)

1. **A lista responde "com o que foi CONSTRUÍDO"**, não "do que depende para rodar". Banco,
   APIs e integrações (Supabase, Shopify…) são conteúdo da **documentação**. A frase está na
   tela, acima do campo — não é tooltip, porque era justamente o mal-entendido do campo.
   ⚠️ **A frase NÃO diz que o GoDeploy é a exceção da regra** (pedido do Luis: "ninguém precisa
   saber disso"): a exceção é decisão interna, e enunciá-la na tela só convida a pessoa a
   discutir a régua em vez de responder à pergunta.
2. **GoDeploy é a ÚNICA exceção** aceita na lista (é a nossa infra de execução). Decisão
   explícita do dono do produto — **não abrir a exceção para mais nada**; o próximo pedido
   será Supabase, e aí a lista deixa de responder à pergunta do item 1.
3. **"Claude + GoDeploy" saiu da lista.** Era artefato da escolha ÚNICA: com multi-seleção, uma
   opção que significa duas. GoDeploy virou opção própria, e o valor legado se desmonta sozinho
   na leitura.
4. **"Claude" sozinho (legado) → "Claude Code".** O campo pergunta com o que se CONSTRUIU e,
   no GoGroup, o Claude que constrói é o Claude Code — é o que o glossário do `analyzer.ts` já
   afirmava. É um chute *declarado*, registrado em `FERRAMENTAS_LEGADO`.
5. **É uma GRADE 3×3 de checkbox, NÃO pílulas nem emoji** — as duas primeiras versões foram
   reprovadas na validação visual no navegador e **não devem voltar**:
   - **(a) emoji por opção** (🔗🐍📗…): com 9 itens a fileira virava cartela de adesivos,
     ocupava 3 linhas e competia com a única informação do campo (o que está marcado).
   - **(b) pílulas com `flex-wrap`**: larguras irregulares, última linha com **item órfão** e —
     o pior — era o **único controle arredondado** numa tela em que todo radio é retângulo de
     largura regular; sem caixa de check, liam como **"tags de leitura"**, não como "marque
     vários". Parecia de outro sistema de design.
   - **A grade resolve os três de uma vez:** colunas iguais (nada de ragged), retângulo com a
     MESMA linguagem do `.go-radio-label`, e a **caixa de check visível** (a do
     `CardCheckboxGroup`) devolve a afordância de checkbox. 9 opções em 3 colunas = 3 linhas
     exatas.
   - ⚠️ **O preenchimento é por COLUNA** (`grid-auto-flow: column`), não por linha, e o
     **arranjo foi fechado pelo Luis olhando a tela**:

     ```
     Claude AI      │ Python   │ Apps Script
     Claude Cowork  │ n8n      │ Vercel
     Claude Code    │ GoDeploy │ Outros
     ```

     A família Claude **empilhada na 1ª coluna** é o que a agrupa. O nº de linhas vai inline
     (`Math.ceil(opções / colunas)`): fixá-lo em 3 faria uma opção LEGADA extra abrir uma 4ª
     coluna e a grade transbordaria para o lado.
   - ⚠️ **Esta ordem visual é TAMBÉM a ordem de serialização** — há uma lista só
     (`FERRAMENTAS_OPCOES`), de propósito, para não existirem duas ordens divergindo. Mexer no
     arranjo muda a ordem dos nomes dentro da string gravada; é inofensivo (nada lê a coluna
     por posição), mas o teste de ida-e-volta compara a ordem CANÔNICA e vai apontar.
6. **Quem agrupa as 3 superfícies do Claude é a TIPOGRAFIA + a POSIÇÃO**, nunca uma caixa em
   volta: "Claude" em peso 500/opacidade .82 + a superfície em negrito
   (`.go-grid-check-familia`) e, na grade de 3 colunas, as 3 ocupam **a linha do meio inteira**.
   Opacidade .7/peso 400 foi testada e **lia como "desabilitado"** — não baixar de novo.
7. **`label` encurta o rótulo EXIBIDO sem mexer no `value` gravado** ("Apps Script" na tela ×
   "Google Apps Script" na planilha): o nome cheio não cabe numa coluna de ~150px.
8. **As 3 do Claude usam a cor do logo dele** (pedido do Luis, 12/08/2026): `marca: "claude"` na
   opção → `.go-grid-check-marca-claude`. Tokens `--go-claude` (#D97757) e `--go-claude-ink`
   (#B45C3E). ⚠️ **Dois tons por acessibilidade, não por capricho:** #D97757 tem **3,1:1** contra
   branco — serve para borda e preenchimento (mínimo 3:1 de componente) e **reprova** AA em texto
   de 12,5px; o texto usa o #B45C3E (**4,6:1**). ⚠️ Marcado, a **caixa e o rótulo acompanham** a
   borda: borda laranja com caixa azul dentro lê como bug, não como marca. ⚠️ `marca` é campo
   PRÓPRIO em `FerramentaOpcao`, não derivado de `familia` (cor de marca e agrupamento de família
   são coisas independentes), e é **puramente estético** — o estado marcado/não é comunicado pelo
   "✓" + peso 700, nunca por cor, então nada de informação depende dela.
   ⚠️ **Quem recebe a cor é a VARIANTE, não a família** (`.go-grid-check-variante`): "Claude" fica
   no tom neutro e o `.ai`/`Cowork`/`Code` salta em laranja. O inverso foi testado no navegador e
   descartado — deixava em evidência a palavra que é IGUAL nas três e apagava justamente a que
   diferencia; a decisão real da pessoa é a superfície.
9. **Ajuda "Qual a diferença entre os 3 Claudes?"** — `InfoTooltip` **abaixo da grade**, alinhada
   à esquerda (embaixo da coluna dos Claudes), com 1 frase por superfície (navegador · arquivos e
   ferramentas conectadas · terminal/IDE). ⚠️ É **pergunta visível**, não o ícone "i": ninguém
   caça um ícone para descobrir uma diferença que não sabe que existe. Para isso o `InfoTooltip`
   ganhou `trigger` e `largura` — o portal, o `tabIndex`, o `role` e os handlers seguem os MESMOS
   (abre no hover **e no foco de teclado**), então não há balão novo duplicando a lógica. Gatilho
   estilizado por `.go-hint-link` (sublinhado pontilhado + `cursor: help`, para não se confundir
   com link de navegação — não leva a lugar nenhum).

### A coluna continua sendo UMA string

`projetos.ferramenta` (banco) e a coluna **"Ferramenta"** (Sheets) seguem com **200 chars** de
texto. As escolhas são unidas por **`" + "`** — o **mesmo separador** que o valor legado
"Claude + GoDeploy" já usava, então **nada precisou migrar na planilha** e nenhum consumidor
(sync, analisador, dashboard, investigador) mudou.

Ponte em 3 funções PURAS (`src/lib/submeter/constants.ts`):

| Função | Papel | Detalhe que não pode regredir |
|---|---|---|
| `serializarFerramentas` | lista → string | Ordem **canônica da lista**, não a dos cliques: o `metaChanged` do wizard compara strings, e ordem por clique faria a mesma escolha parecer mudança (reprocessando o agente de graça). "Outros" viaja como `Outros: <texto>`. |
| `desserializarFerramentas` | string → lista | Normaliza legado (`Claude`, `Claude + GoDeploy`, `python` minúsculo) e **preserva valor fora da lista** ("Power Automate") como chip extra. |
| `limiteFerramentaOutra` | cap do campo "Especifique" | **Dinâmico**: 200 − o que as outras marcadas já ocupam. O cap fixo antigo (192) voltaria a estourar o zod **depois** de tudo preenchido — é a família do bug do caso Josiely (`erro-validacao.ts`). Com só "Outros" marcado dá exatamente 192. |

### O que mudou

- `src/lib/submeter/constants.ts` — `FERRAMENTAS_OPCOES` (9 opções + `familia`/`variante`),
  `FERRAMENTAS` (ordem canônica), `FERRAMENTAS_LEGADO`, as 3 funções puras acima e as
  constantes `FERRAMENTA_OUTROS`/`FERRAMENTA_SEP`/`PREFIXO_OUTROS`/`FERRAMENTA_MAX`.
  **`FormData.ferramenta: string` → `FormData.ferramentas: string[]`**; `validarEtapa1` passa
  a cobrar `errs.ferramentas` ("Selecione ao menos uma ferramenta").
- `src/lib/submeter/form-components.tsx` — **`GridCheckboxGroup`** novo: grade
  `repeat(auto-fit, minmax(150px, 1fr))`. Os 2 componentes que já existiam não servem para 9
  opções curtas — `CheckboxGroup` divide a linha em partes iguais (`flex-1`) e aperta a partir
  de 3; `CardCheckboxGroup` empilha um card por opção (9 cards para uma decisão de um clique).
  A11y: estado **nunca só por cor** (a caixinha enche de azul com "✓" e o rótulo engrossa),
  input `sr-only` (toggle por Espaço) + anel de foco na célula inteira
  (`.go-grid-check-item:has(:focus-visible)`), animação curta que o CSS global neutraliza sob
  `prefers-reduced-motion`. Em tela estreita a grade cai para 2/1 coluna sozinha.
- `src/styles.css` — `.go-grid-check` / `-item` / `-on` / `-box` / `-familia`, mesma linguagem
  do `.go-radio-label` (que fica intocado): retângulo, `--go-radius-sm`, borda 1.5px.
- `src/lib/submeter/step1.tsx` — o `<select>` virou o `GridCheckboxGroup` + a frase de
  construção × execução; `opcoesFerramentas` acrescenta o valor legado fora da lista.
  ⚠️ Desmarcar uma opção legada a remove **de vez** (é a leitura correta de "não é isso"; a
  pessoa a reescreve em "Outros").
- `src/routes/submeter.tsx` — `computeFerramenta()` virou a **FONTE ÚNICA** da string: a mesma
  expressão estava reescrita à mão em **5** lugares (payloads de `iniciar-submissao`, do
  especial, o `applySeed` e o resumo da comparação), e com serialização não trivial seriam 5
  cópias para divergir. O seed usa `desserializarFerramentas`; o `rehydrateFromLocal` converte
  **rascunho local antigo** (`ferramenta: "Claude"`, sem a chave nova) — sem isso o campo
  abriria vazio e o `.includes()` derrubaria a tela.
- **Prompts** (`analyzer.ts`, `orchestrator.ts` + `prompt-registry.ts`, regra 3): o glossário
  de ferramentas foi reescrito — declara CONSTRUÇÃO, lista as 3 superfícies do Claude, diz que
  o campo aceita várias unidas por `" + "` e mantém a trava **"construir com Claude ≠ IA em
  runtime"** (que é o que impede a ferramenta de inflar a complexidade), agora valendo para as
  3 superfícies e para os valores legados.

### Testes

`tests/ferramentas-multi.test.ts` (novo, 30 casos) — **ida-e-volta** (marcar → gravar →
reabrir devolve a MESMA escolha, incluindo o legado fora da lista), os valores legados um por
um, a ordem canônica, o cap dinâmico gasto até o fim sem estourar 200 chars, e guardas da
lista (as 3 superfícies existem, o "Claude" genérico e o "Claude + GoDeploy" **não**, nenhum
rótulo contém `" + "`). `tests/validacao-etapa1.test.ts` e `validacao-etapa2.test.ts`
migrados para o campo em array.

---

## Feature adicional — Tela de apresentação antes do formulário (11/08/2026)

**Pedido (Kaique, 11/08/2026):** "uma tela que aparece antes de aparecer a tela de
submissão. essa tela é uma apresentação do forms, e deve ser bem clara, breve e objetiva
com: o que é o forms, qual a finalidade e um guia rápido de como submeter. tudo isso com
um botão abaixo de 'Ok, entendi' para prosseguir e ir para o forms real."

**Por que ganha o clique extra:** a premissa nº 1 do GoDocs (só entra automação **já em
produção**, com ganho **já medido**) só aparecia DEPOIS — no gate de ganho real ×
projetado, no meio da fase financeira do chat. Quem chegava com projeção descobria a régua
com a submissão já quase pronta e perdia o trabalho inteiro (caso "Automação cadastro de
novos cliente"/Eduardo Santana, 28/07/2026). Dizer isso na primeira tela é a versão barata
da mesma trava.

**Onde mora**
- **`src/lib/submeter/intro.tsx`** (novo) — `IntroSubmissao` + o predicado PURO
  `deveMostrarIntro`.
- `src/routes/submeter.tsx` — `showIntro` (`useState` com inicializador) + early return.

### Decisões fechadas (não "consertar" sem confirmar)

1. **Aparece SEMPRE que se abre `/submeter` do zero — sem flag em localStorage**
   (decisão de produto, 11/08/2026). Foram descartadas "só na primeira vez" e "checkbox
   não mostrar de novo": quem submete 1× por mês esquece a régua, e a flag sumiria
   justamente para quem já errou antes. Consequência aceita e coerente: **"Recomeçar"**
   (`handleRecomecar`, que faz `location.assign("/submeter")` sem rascunho) e **"Submeter
   outro projeto"** (`location.reload()` na tela de sucesso) voltam a mostrar a
   apresentação.
2. **NÃO é uma etapa do wizard.** `STEPS` e `WizardProgress` ficam intocados. Uma "etapa
   0" apareceria também em `/editar/$id` (que renderiza o MESMO `SubmeterPageContent`) e
   mexeria em `completedSteps`/`handleStepClick`.
3. **NÃO é rota própria** (`/submeter/intro` foi descartada): `/submeter` está em favorito
   das pessoas, e um redirect quebraria `?retomar=<id>` e duplicaria o fetch de
   identidade.
4. **Quem NÃO vê** (predicado `deveMostrarIntro`, mesmos 3 sinais do `seedLoading`):
   **edição** (`editProjetoId` — senão vaza para quem só corrige um projeto já submetido) ·
   **`?retomar=<id>`** (retomada explícita) · **rascunho local** (`hasLocalDraft()`; o
   `rehydrateFromLocal` salta para `setStep(d.step ?? 3)`, e a intro ficaria na frente de
   um chat em andamento).
5. **O early return vem DEPOIS do `if (seedLoading)`.** Hoje os dois são mutuamente
   exclusivos (sinais idênticos), mas se deixarem de ser, é a tela de carregamento que tem
   de ganhar — a intro na frente de um seed em voo esconderia um projeto sendo restaurado.
6. **A trilha das 3 etapas repete o desenho do `WizardProgress`** (círculo azul de 36px +
   trilho de 2,5px), só na vertical: a pessoa reconhece na intro o mesmo stepper que verá
   no topo do formulário. Os **rótulos saem de `STEPS`** (fonte única) — só o resumo de
   cada etapa é texto próprio (`RESUMO_ETAPAS`), para a intro nunca divergir do stepper.
7. **Foco no `<h2>`, não no botão** (`tabIndex={-1}` + `focus()`): autofocar o CTA faz o
   leitor de tela anunciar "Ok, entendi, botão" antes de a pessoa ouvir uma linha da
   apresentação.
8. **"Entra / não entra" nunca depende só de cor** (regra 11): cada linha tem ícone
   (`CircleCheck` / `CircleSlash2`) **e** rótulo em negrito ("Entra aqui:" / "Não entra:").
9. **A tela INSTRUI: as 3 perguntas do critério** (pedido do Kaique, 11/08/2026) — o miolo é
   "Seu projeto responde a estas 3 perguntas?" com **recorrência · contrafactual ·
   rastreabilidade** (constante `CRITERIOS` em `intro.tsx`), em forma de pergunta para a
   pessoa responder **a si mesma**. É a MESMA régua que o analisador aplica depois e que o
   agente cobra nas seções "Processo alterado" / "Ponteiro movido e onde verificar"
   (`SPEC_CRITERIOS_PROJETO.md` · `docs/criterios-projeto-recorrencia-evidencia.md`).
   ⚠️ **Ao mudar a régua LÁ, mude o texto aqui** — uma intro que promete critério diferente
   do que o agente cobra é pior que intro nenhuma. ⚠️ **NÃO importamos a constante do
   prompt** (`BLOCO_SECOES_CRITERIO`, `orchestrator.ts`): é redação para LLM, roda no
   worker e fala em códigos `[1.3]`/`[1.4]`, que são roteiro interno e **proibidos** na
   tela. ⚠️ A 3ª pergunta manda **NOMEAR** relatório/painel/sistema/base de propósito: "dá
   para ver no sistema" é a resposta vaga que o gate recusa, e é onde as pessoas mais
   empacam. ⚠️ E a tela diz explicitamente que **não saber alguma não trava nada** (o
   agente ajuda a montar; o que ficar em aberto vai à revisão humana) — a intenção é
   preparar, não filtrar na porta.
10. **Os critérios NÃO são numerados; as etapas são.** A numeração fica só onde a ordem é
    real (as 3 etapas do wizard); os 3 critérios são testes independentes, separados pelo
    NOME + uma barra lima. E o título da seção **não repete o eyebrow** "Antes de começar"
    — ele é a própria pergunta, que é o que a pessoa deve fazer com a lista.

**Testes:** `tests/intro-submissao.test.ts` — os 4 ramos do predicado + string vazia não
contando como id.

---

## Feature adicional — Triagem do projeto ESPECIAL: dashboard e ganho organizacional (12/08/2026)

**Pedido (Kaique, 12/08/2026):** ao marcar o projeto como **especial** na Etapa 2.5, aparecem
**duas perguntas novas, em sequência, ANTES dos campos que já existem** (contexto especial),
cada uma com 2 botões (sim/não) e a segunda só depois de responder a primeira:

1. *"Este projeto é, objetivamente (ou principalmente), um dashboard ou um painel de
   controle?"* — se SIM, **não é especial** (dashboard não é projeto especial).
2. *"O ganho principal deste projeto é prioritariamente organizacional?"* — se SIM, quase
   certamente **não é um especial válido**: sem saving considerado nem receita real medida é
   muito difícil ser um especial legítimo.

**Qualquer "sim" BLOQUEIA a submissão**, com mensagem que diz o que foi respondido, por que
isso não caracteriza um especial e o que fazer (padrão "Para corrigir…").

**Por que na porta, e determinístico:** o especial **pula o memorial financeiro** e vai direto
à validação humana — é a rota mais barata do formulário e, por isso, a mais atraente para quem
não quer levantar horas. Dashboard/painel é uma ENTREGA (o ganho aparece nas horas que ninguém
gasta mais montando o relatório, na conferência que sumiu, no erro que parou de acontecer) e
"organizar" é MEIO para o impacto, não o impacto: os dois são mensuráveis pelo caminho normal.
E o bloqueio **não pode ser prompt** — este repo já queimou 3× confiando no LLM para segurar
regra (Gostream, ganho projetado, custo evitado no chat: *avisar não é trava*). Aqui, porém, o
gate é de **FORMULÁRIO**: 2 cliques, sem máquina de estados de chat, sem risco de loop.

**Onde mora**
- **`src/lib/mensagens-submissao.ts`** (FONTE ÚNICA, módulo PURO) — `PERGUNTAS_ESPECIAL` (o
  texto das 2 perguntas + os rótulos dos 4 botões), `MotivoBloqueioEspecial`,
  `mensagemEspecialDashboard()`, `mensagemEspecialGanhoOrganizacional()` e o dispatcher
  `mensagemEspecialInvalido(motivo)`.
- **`src/lib/submeter/constants.ts`** — os 2 campos em `FormData`
  (`especialDashboard`/`especialGanhoOrganizacional`) + as funções PURAS
  `motivoBloqueioEspecial(form)` (o predicado do bloqueio) e `validarEtapa25Especial(form)`
  (perguntas não respondidas + o bloqueio, em `FieldErrors`).
- **`src/lib/submeter/step25.tsx`** — a UI: bloco "Duas checagens antes de seguir" com
  `PerguntaSimNao` (numeração 1/2, `fieldset`/`legend`, input `peer sr-only` + indicador
  redondo) e `BloqueioEspecial` (ícone `Ban` + veredito + a mensagem da fonte única).
- **`src/routes/submeter.tsx`** — estado inicial, seed da edição, `rehydrateFromLocal`,
  `handleRespTriagemEspecial`, a triagem dentro de `validateEtapa25` e o **gate** no topo de
  `handleEnviarEspecial` **e** de `handleSubmitProjeto`.

### Decisões fechadas (não "consertar" sem confirmar)

1. **O gate é SÓ DO FRONTEND, como o `prodStatus`** — e isso é escolha, não esquecimento. As
   2 respostas não vão ao backend, a nenhum prompt e a nenhuma coluna do Sheets: o que
   sobrevive ao envio é a NATUREZA do projeto (`especial`/`tipos_projeto`), que já é gravada,
   e um especial que passasse por engano é pego pela validação humana (que é o destino de
   todo especial). Um campo server-side exigiria payload em `iniciar-submissao` +
   `atualizar-metadados`, coluna nova, `ProjetoContexto`/`getProjetoContextoData`,
   `buildRespostasFormulario` e coluna no Sheets — custo alto para uma resposta que ninguém
   lê depois. ⚠️ **Se um dia a triagem tiver de constar na planilha/auditoria, aí sim** ela
   entra por esse caminho completo (regra do `CLAUDE.md`), nunca solta num prompt.
2. **A 2ª pergunta só existe depois de a 1ª ser "não"** — e a validação cobra exatamente o
   que a tela mostra (`validarEtapa25Especial`). Com a 1ª em "sim" o projeto já está
   bloqueado; cobrar a resposta de uma pergunta invisível travaria o formulário sem dizer
   onde. Por isso `handleRespTriagemEspecial` também **zera** a 2ª resposta quando a 1ª volta
   para "sim".
3. **Precedência: dashboard vence** quando as duas seriam "sim" — é o critério OBJETIVO (não
   depende de julgar a natureza do ganho).
4. **O bloqueio aparece no CLIQUE, não só no envio.** O painel vermelho com o "Para corrigir…"
   nasce no instante do "sim" (e o **contexto especial deixa de ser exibido**: escrever 20+
   caracteres para uma submissão que não vai sair é trabalho jogado fora). No clique em
   "Enviar Projeto" o **toast repete a MESMA mensagem** (fonte única, 20s, sem prefixo "Erro
   ao enviar" — é orientação, não falha técnica).
5. **O botão "Enviar Projeto" continua HABILITADO.** Desabilitar economiza um clique e tira a
   explicação: quem não entende por que o botão morreu não descobre sozinho. O gate está no
   handler.
6. **O gate roda nos DOIS caminhos de envio** (`handleEnviarEspecial` da Etapa 2.5 e
   `handleSubmitProjeto` da Etapa 3, que um especial alcança pela navegação do topo) —
   bloqueio não pode depender de qual botão a pessoa achou primeiro. Na Etapa 3 o bloqueio
   **devolve a pessoa à Etapa 2.5** (`setShowEtapa25(true)` + `goToStep(2)`), onde as
   perguntas estão.
7. **Marcar "Não. É um projeto padrão…" LIMPA as 2 respostas** (como já acontece com o
   contexto especial): resposta guardada para pergunta que a tela não mostra mais é dado
   obsoleto, e voltar a "Sim" tem de exigir reafirmar.
8. **Na EDIÇÃO as perguntas nascem em branco** (os campos não existem no servidor) — efeito
   desejado: um especial LEGADO passa pela triagem que não existia quando ele entrou. Rascunho
   local salvo antes desta feature também cai em `""` (default no `rehydrateFromLocal`, como
   manda o comentário-armadilha de lá).
9. **UI: nada de linguagem visual nova.** Reusa `.go-radio-label`/`go-radio-checked`,
   `FieldError` e o painel arredondado da própria Etapa 2.5; o vermelho do bloqueio é o
   `#dc2626`/`#b91c1c` já usado nos erros e o ícone é o `Ban` do "Projeto reprovado"
   (`aviso-pendencia.tsx`). A11y (regra 11): o estado **não é só cor** (o disco do indicador
   aparece/desaparece + rótulo em negrito), o foco de teclado acende no indicador
   (`peer-focus-visible`, com o input `sr-only`), `fieldset`/`legend` amarram as opções à
   pergunta, o painel de bloqueio é `role="alert"` com medida travada em 72ch e as animações
   respeitam `prefers-reduced-motion` (bloco global em `styles.css`). ⚠️ Os overrides de
   `justify-content`/`gap` do rótulo vão em `style` inline **de propósito**: `.go-radio-label`
   é CSS não-camadado e venceria a utilitária do Tailwind v4 (onde, aliás, `!classe` com "!"
   na frente não existe mais).
10. **A numeração 1/2 é legítima** (a ordem é real: uma destrava a outra) — não é enfeite,
    ao contrário dos `01 / 02 / 03` decorativos.

11. **A 2ª saída diz "volte como projeto PADRÃO", não "espere"** (Kaique, 12/08/2026, olhando a
    tela). Ela nasceu como `Ou espere a medição — O GoDocs documenta ganho já realizado.`, e
    isso não informa **esperar até o quê** nem **por qual porta se volta**. Pior: do lado do
    especial a leitura natural é a ERRADA — *"não tenho número, então mando como especial"* —,
    que é precisamente o desvio que estas 2 perguntas fecham. Hoje é a constante
    **`CAMINHO_SEM_MEDICAO`** (FONTE ÚNICA dos 2 bloqueios — o texto era digitado 2× idêntico)
    e diz as 3 coisas: sem número **o especial não é a saída** (ele registra o projeto **sem
    valor de ganho**) · apure o resultado · **submeta como projeto PADRÃO, com o ganho já
    validado**. ⚠️ **Detalhar isso NÃO reabre o painel-bloco:** o encurtamento do mesmo dia
    (resumo de 1 frase + 2 caminhos, no lugar de ~4 caminhos + resumo de 5 linhas) continua
    valendo, e o teste prende os dois lados — o conteúdo da saída **e** o teto de tamanho/nº
    de caminhos.

**Testes:** `tests/especial-triagem.test.ts` — texto exato das 2 perguntas (mudar tem de ser
DECISÃO), os 6 ramos de `motivoBloqueioEspecial` (incluindo "projeto padrão nunca é afetado" e
"em branco não bloqueia"), o que `validarEtapa25Especial` cobra em cada estado e as 2
mensagens (o que foi respondido · por que · "Para corrigir…" · sem R$ · a saída sem medição
mandando voltar como PADRÃO · e o teto "2 caminhos, < 900 chars", que preserva o
encurtamento). As 2 mensagens também entram no laço de invariantes de
`tests/mensagens-submissao.test.ts`.


## Feature adicional — Notificação do Chat só quando há pré-aprovação do líder (11/08/2026)

**Motivação.** O grupo do Google Chat recebia **uma mensagem por submissão e por edição** — e, logo
depois, uma **segunda** do mesmo projeto (`🚨 Novo fluxo de automação cadastrado – Análise Pendente`,
disparada pelo `syncUpdateToGoogle` no fim da análise). Como a pré-aprovação do líder passou a existir
(D1–D29), a maior parte desse barulho é sobre projeto que **ainda não foi olhado por ninguém**. Pedido
do Luis: *"que só ocorram agora quando houver uma pré-aprovação do líder … só a pessoa submeter ou
editar e não tiver aprovação do líder ou validação nós vamos desconsiderar"*.

**O que mudou.** O gatilho do alerta deixa de ser a submissão e passa a ser o projeto estar **liberado
do lado do líder**. A régua é o módulo PURO `src/lib/notificacao-chat.ts`
(`decidirMomentoNotificacao`), FONTE ÚNICA do "quando" e dos textos das notas:

- fila REALMENTE aberta (`isento: false`) → **silêncio** na submissão; a mensagem sai quando o líder
  clica em **Pré-aprovar** (`decidirAprovacao` → `notificarChatPreAprovacao`), com a **assinatura** de
  quem pré-aprovou;
- **`ajuste`/`reprovado`** → nada (é o "desconsiderar" do pedido; fica entre líder e autor);
- **especial** (D27, não abre fila) → mensagem na submissão, **própria e enxuta**;
- **liderança · sem líder · TeamGuide fora** → mensagem na submissão **com uma linha** dizendo por
  que não há parecer, para a triagem não a ler como pré-aprovação de um líder que não existiu;
- a 2ª mensagem por submissão foi **suprimida** (`buildUpdateMessage` REMOVIDO): **1 por projeto**.

**Onde aterrissou.** `src/lib/notificacao-chat.ts` (novo, puro) · `src/lib/notificacao-projeto.functions.ts`
(novo — remonta o payload do BANCO e envia; **não** reusa `resyncGoogle`, que também escreveria no
Sheets) · `src/lib/google/chat.ts` (`notaPreAprovacao`/`preAprovacao` no `buildSubmitMessage`, especial
enxuto, `buildUpdateMessage` removido) · `src/lib/google/sync.ts` (`notificarChat` **obrigatório** em
`SubmitSyncParams`; Chat fora do `syncUpdateToGoogle`) · `src/lib/aprovacoes.functions.ts` (gatilho +
`assinaturaDoParecer`) · `src/lib/chat.functions.ts` (2 call sites; `resyncGoogle` → `notificarChat: false`).

**Testes.** `tests/notificacao-chat.test.ts` · `tests/sync-notificar-chat.test.ts` ·
`tests/notificacao-projeto-pre-aprovacao.test.ts` · `tests/aprovacoes-notifica-chat.test.ts` +
`tests/chat-message-especial.test.ts` atualizado.

**Decisões e gotchas completos:** `SPEC_APROVACAO_LIDER.md` §12 (D30).

**Status.** ✅ **EM PRODUÇÃO** — staging `edf400b4` version 141 (12/08, 13:51 UTC, runtime validado) →
prod `674a3710` **version 237** (14:32 UTC), e mergeado na `main` pelo **PR #248** (`4a361f2`). ⚠️ O
**conteúdo** da mensagem só se confere na 1ª pré-aprovação REAL em prod: a staging não tem webhook de Chat.
---

## Espelho da planilha no SQLite — as telas param de ler o Google Sheets em request (11/08/2026)

**Pedido do Luis:** *"nosso godocs ta demorando mt pra puxar informações nas telas… precisamos fazer com
que seja tudo sqlite agora como fonte da verdade, porém não vamos mudar o ciclo de inserção dentro do
sheets, nosso sqlite deve ser atualizado rotineiramente, várias vzs por dia… Edições devem ser feitas
sempre na planilha, e o sqlite se atualizar com essas edições/inserções"*.

### O problema, medido
- **`/api/meus-projetos` fazia um `readAllRows()` da planilha INTEIRA a cada load de página.** Está nos
  logs de prod: `[sync-reverse:owner] email=… total=9 … ignorados=9` em **todo** GET da tela. A leitura
  custa ~1,5–2,5 s (2,65 MB) e a cota de 60 leituras/min é **compartilhada com produção**.
- O `/dashboard` escondia a mesma leitura atrás de cache de 60 s + SWR + patches em memória (~120 linhas
  de máquina de estado que só existiam por causa da lentidão).
- Efeito colateral que gerou reclamação de usuário (**"tinha projeto bugado na lista"**): a listagem
  dependia de um sync sob demanda rodando **dentro** do request; quando ele falhava (cota/timeout), a tela
  caía num estado parcial — status "—", projeto morto que não saía.

### A decisão
Uma tabela **`sheet_espelho`** guarda a **linha crua da planilha** (JSON chaveado pelo nome REAL da
coluna). O sync reverso (cron de **5 min**, era 1×/h) a mantém; **as telas leem só dela**. A planilha
segue **fonte da verdade e único lugar onde se edita** — o espelho é derivado e descartável.

Por que a linha crua e não colunas novas em `projetos`: `mapResumo`, a ficha de triagem e o parser do
parecer do líder (`interpretarParecerLider`) continuam operando sobre um `SheetRow`. Nenhuma regra de
negócio mudou de lugar — é o que torna a troca de baixo risco.

### Invariantes (não podem regredir)
1. **Toda escrita nossa no Sheets remenda o espelho na hora** (`espelharEscrita`): triagem de status ·
   descontinuar · IDA (append/update) · analisador · as 2 colunas do líder. Sem isso, **submissão nova
   apareceria sem Status** até o próximo cron. O cron é a REDE: esquecer um ponto custa ≤5 min de atraso,
   não uma mentira permanente.
2. **O remendo sobrevive a um sync que começou ANTES dele** (`patch` + `escrito_em` ≥ início da leitura).
   Empate por milissegundo **protege a nossa escrita** — a falha oposta é o status voltar atrás na cara da
   triagem; a planilha vence no ciclo seguinte. Era o que os `patchesEscritos` em memória faziam, agora no
   banco e válido entre isolates.
3. **A listagem nunca seleciona a coluna `linha`** — só `linha_resumo`, recortado pelas `COLUNAS_RESUMO`
   (`src/lib/dashboard-resumo.ts`, módulo PURO; `dashboard-admin.functions.ts` re-exporta). Puxar os
   memoriais de ~600 projetos numa consulta é o gotcha dos **32 MiB de RPC** do Investigador. Coluna nova
   lida pelo `mapResumo` entra em `COLUNAS_RESUMO` no MESMO commit — há teste de ida-e-volta.
4. **O recorte casa por chave TOLERANTE** (o cabeçalho real é `Aprovação do **Lider**`, sem acento).
5. **Leitura da planilha com retry (3×)** e, se falhar de vez, **nada é espelhado nem removido** —
   `ok:false` em `sync_runs`.
6. **O sync é auditável**: `sync_runs` por corrida, "Planilha sincronizada às HH:MM" no cabeçalho, aviso
   âmbar (ícone + texto) após 20 min, `GET /api/admin/sync-status`. O único jeito de esta arquitetura
   mentir é o sync morrer em silêncio.

### Descartado (não tentar de novo)
- **Webhook do Sheets** (Apps Script → nosso endpoint, "sincronizar na hora que a linha entra"): o edge do
  Godeploy exige OAuth em **todas** as rotas e devolve **302** para `devgogroup.com/auth/login` — medido
  com `curl` em 11/08/2026. Um trigger de planilha não tem como autenticar. A cadência do cron é o
  substituto (a plataforma aceita até 1 min).
- **Colunas novas em `projetos` espelhando a planilha**: obrigaria a mapear ~48 colunas (incluindo as
  manuais e as que ainda não existem) e duplicaria as regras de leitura.

### Fora do escopo desta fatia
`reconciliarComplexidade` (cron de 1 min — hoje o **maior** consumidor de cota: um `readAllRows()` por
minuto) e `/email-legados` seguem lendo a planilha ao vivo. `reconciliar-financeiro` continua no Sheets de
propósito (é reparo *fail-closed*, precisa do dado vivo).

Plano: `docs/plans/sqlite-fonte-de-leitura.md` · Spec da triagem: `SPEC_DASHBOARD_ADMIN.md` **D11**.
**Status.** ⏳ Implementado; suíte verde + `build:worker` OK. **Deploy pendente** (regra 13 — staging
`edf400b4` antes de prod).

---

## Feature adicional — Modal de exemplos no campo "trabalho manual ADICIONAL" (12/08/2026)

**Pedido (Kaique, 12/08/2026):** a pergunta 2c — *"Além desse gasto eliminado, a automação
substitui um trabalho manual ADICIONAL — que ninguém fazia e que esse gasto NÃO cobria?"* —
"pode ser muito confuso depois da pessoa já ter marcado que o projeto reduziu custos no campo
anterior". Daí um botão de dúvida que abre um popup central, fundo embaçado. A 1ª versão trazia
6 exemplos em cards (*Contexto → Custo eliminado → veredito*); o formato final, pedido no mesmo
dia depois de ver a tela, é **uma lista curta de sinais** — *"para saber se o seu projeto tem
esse trabalho, observe se:"* + frases marcadas ✕ (não é esse caso) e ✓ (é esse caso).

**Por que o campo confunde:** ele vem logo DEPOIS de a pessoa cadastrar o gasto que a empresa
deixou de pagar. Quem acabou de declarar "cortei R$ 3.200/mês do escritório contábil" lê a
pergunta seguinte como "e esse trabalho conta?" e responde **sim** com o MESMO trabalho — que é
exatamente a dupla contagem que a árvore de 3 desfechos existe para evitar (caso Portal de
Reembolsos: contrato + horas-fantasma = R$ 7.597 em vez de R$ 5.700). Texto de ajuda genérico
("conta só se for diferente") já existia e não bastava; o que separa as duas coisas é o caso
concreto lado a lado.

**Onde mora**
- **`src/lib/submeter/exemplos-modal.tsx`** (novo) — `ExemplosCampoAjuda` (trigger + modal),
  o tipo `SinalCampo` (`vale` · `texto` · `detalhe?`) e a constante
  **`SINAIS_TRABALHO_ADICIONAL`** (2 sinais ✕ + 2 ✓). Genérico de propósito: outro campo
  confuso reusa passando a própria lista.
- `src/lib/submeter/step3-chat.tsx` — bloco 2c (`mostrarContrafactualAdicional`): o botão
  entra abaixo do texto de ajuda. Nenhum estado do formulário muda.
- `tests/exemplos-trabalho-adicional.test.ts` — trava o CONTEÚDO (2 + 2, ✕ primeiro, frase
  curta com teto de 110 chars, os 2 erros cobertos).

### Decisões fechadas (não "consertar" sem confirmar)

1. **É uma LISTA de sinais, não exemplos em card** (decisão de produto, 12/08/2026, depois de
   ver as duas versões na tela): cada linha é uma frase que a pessoa confere contra o próprio
   projeto, com um `detalhe` curto só onde há o que fazer em vez disso ("volte e responda Sim").
   Os cards de exemplo pediam leitura de 3 informações para extrair 1 conclusão.
2. **Os 3 "não vale" cobrem os 3 erros REAIS**, não variações do mesmo: (a) mesmo escopo do
   gasto eliminado → dupla contagem; (b) horas que **alguém já fazia** → é o outro ramo do
   formulário (a resposta certa é voltar em "Alguém já fazia?" e marcar **Sim**); (c) trabalho
   que **nasceu com** a automação (monitorar painel, conferir log) → custo de operação, não
   trabalho substituído. Trocar um deles por mais um exemplo de dupla contagem desperdiça o
   card e derruba o teste.
3. **É modal, não tooltip nem accordion.** `InfoTooltip` (`form-components.tsx`) some no
   `mouseleave` e não caberia 6 casos; um accordion inline empurraria o resto do formulário
   para fora da vista no meio de uma decisão. O modal é renderizado por **`createPortal` no
   `document.body`** — o formulário vive dentro do container animado do chat, e um `transform`
   ancestral quebraria o `position: fixed`.
4. **Piso de a11y (regra 11):** veredito **nunca só por cor** (ícone + palavra "Válido"/"Não
   vale"), `role="dialog"`/`aria-modal`/`aria-labelledby`, Esc e clique no fundo fecham, foco
   inicial no "Fechar" e **devolvido ao botão que abriu**, Tab circula dentro do modal, scroll
   do fundo travado. Movimento respeita `prefers-reduced-motion` pela regra global do
   `styles.css`.
5. **Copy do campo alinhada à decisão de 12/08/2026** (a pergunta do custo evitado é
   GENÉRICA — tipos são só exemplos): "esse **contrato** NÃO cobria" → "esse **gasto** NÃO
   cobria", no rótulo e no texto de ajuda. Falar em "contrato" excluía quem cortou multa,
   juros ou taxa (caso SmartOnline/DIFAL).
6. **Uma coluna de 580px, sem rolagem** — a lista de 6 frases cabe inteira; as duas colunas de
   900px existiram só enquanto o conteúdo eram cards. O corpo mantém `overflow-y-auto` como
   rede para viewport curto.
7. **A ORDEM é ✕ antes de ✓** (travada em teste): o erro que a pergunta produz é o "sim"
   indevido, então o que precisa ser lido primeiro é o que NÃO conta.
8. **Fecha com a saída conservadora** — "na dúvida, responda 'Não, só o custo eliminado'".
   Sem esse fecho, quem não se decide tende ao "sim" (parece mais completo) e infla o ganho.
   A nota carrega também o 3º erro (tempo gasto **acompanhando** a automação), que saiu da
   lista quando ela foi reduzida a **2 sinais por lado** (decisão de produto, 12/08/2026 —
   a lista tem de ser lida de um olhar).
9. **Todas as linhas com a MESMA altura** (`gridAutoRows: minmax(76px, auto)`, conteúdo
   centrado): altura variável fazia a frase curta parecer menos importante que a longa. Não é
   altura FIXA — em tela estreita a linha cresce em vez de cortar texto. ⚠️ `1fr` não serve
   aqui: num grid de altura automática ele resolve para o conteúdo de cada linha.
10. **Só o campo 2c** — o campo anterior ("Qual gasto a empresa deixou de pagar?") **não** leva
   botão de exemplos (decisão do Kaique, 12/08/2026).

**Status.** ⏳ Implementado; suíte verde (1296 testes) + `npm run build` OK. **`worker.js` não
precisa de rebuild** (mudança 100% frontend). **Deploy pendente** (regra 13 — staging
`edf400b4` antes de prod).

---

## Feature adicional — Filtros combináveis do `/dashboard` + calendário próprio (17/08/2026)

**Pedido (Luis).** Na triagem: filtro de projetos **especiais** que **soma** com os demais
("todos + especiais", "pendentes + especiais", "descontinuados + especiais"), filtro **rápido
de data** com um calendário "personalizado e bem organizado" — **um** calendário só, 1º clique
na data inicial e 2º na final (nada de duas caixas de-para), com os **atalhos** (hoje, semana,
mês, últimos dias) **dentro** dele —, filtros por **saving** e **receita incremental**, e por
**área**. E o calendário padrão da **Etapa 2** da submissão deve virar o mesmo.

**Onde aterrissou.**

| Arquivo | Papel |
|---|---|
| `src/lib/calendario-datas.ts` | PURO — aritmética de dia civil (UTC), grade do mês, rótulos pt-BR, `PRESETS_PERIODO` |
| `src/lib/dashboard-filtros.ts` | PURO — composição AND dos filtros, contagens recortadas, áreas disponíveis |
| `src/components/calendario/calendario.tsx` | Grade + popover; `SeletorPeriodo` (intervalo) e `CampoData` (dia único) |
| `src/routes/_authenticated/dashboard.tsx` | 2ª faixa de filtros + `Segmentado`; contagens passam a ser do recorte |
| `src/lib/submeter/step2.tsx` | `CampoData` no lugar do `<input type="date">` |

**Decisões fechadas.**

1. **Os filtros somam (AND), e a composição tem UM lugar** — `aplicarFiltros`. A tela não
   refiltra por fora; se refiltrasse, a contagem exibida e a lista deixariam de concordar.
2. **A contagem das pílulas de status é do RECORTE**, não da planilha (`contarPorPilula`
   ignora só a dimensão de status). Pílula anunciando 40 e abrindo 3 linhas seria pior do
   que não ter contagem.
3. **"Limpar filtros" preserva a fila de status** — ela é a faixa de cima, tem contagem
   própria e é o eixo principal da triagem.
4. **A régua do filtro de ganho é o VALOR**, não o rótulo de "Tipos Projeto": projeto marcado
   como saving que terminou com R$ 0 não pertence à fila de quem confere saving. Zero e
   célula vazia ficam de fora.
5. **Natureza tem 3 estados** (Todos · Especiais · Padrão), não um liga-desliga: excluir os
   especiais é uso real da triagem e um toggle esconderia essa metade.
6. **Nenhum filtro custa leitura nova.** Todos saem de campos que o resumo do espelho já
   carrega. ⚠️ Filtro que exija coluna fora de `COLUNAS_RESUMO` entra na lista no MESMO
   commit (o teste de ida-e-volta do espelho cobra).
7. **Período compara em UTC e é inclusivo nas duas pontas**; projeto **sem data fica FORA**
   de qualquer janela (não se afirma que ele está no período).
8. **`hojeIso()` usa o relógio LOCAL** — exceção deliberada ao resto do módulo, que é todo
   UTC: às 22h de Brasília o UTC já virou o dia seguinte, e "Hoje" tem de ser o dia da pessoa.
9. **A grade tem sempre 42 células.** Altura variável faria o popover pular ao trocar de mês
   e o cursor cairia no botão errado.
10. **Tabindex móvel com parada garantida no mês visível** (`paradaTab`). Preso ao dia focado,
    trocar de mês deixava a grade inalcançável pelo teclado — e 42 paradas de Tab seriam
    uma armadilha pior.
11. **Popover em portal, e NÃO é modal** (≠ o exemplo que o Luis mandou, que era um diálogo
    sobre a tela): a triagem precisa continuar vendo a lista que está filtrando. Portal
    porque o cartão da Etapa 2 tem rolagem e cortaria o painel.
12. **A Etapa 2 usa o MESMO componente** em modo `unico`. O valor gravado continua
    `YYYY-MM-DD` — schema, `validarEtapa2` e sync intocados. Ganho colateral: os dias fora
    da janela permitida (antes de 2024, depois de hoje) aparecem apagados e não clicáveis,
    em vez de virarem erro depois do envio.

13. **Pré-status do líder é a 5ª dimensão (17/08, pedido do Luis: "faltou filtro de pré-aprovado
    também")** — `<select>` com os estados PRESENTES na listagem, contagem ao lado, na
    `ORDEM_ESTADO_PARECER` (pendente primeiro: é a fila que espera decisão). A régua é
    `chaveDoEstado` e os rótulos vêm de **`ROTULO_ESTADO_PARECER`**, extraída para
    `aprovacoes-parecer.ts` e passada a ser consumida TAMBÉM pelo `ChipEstadoParecer` — o texto
    estava digitado só dentro da aparência do chip, e um segundo lugar redigitando-o faria a
    tabela dizer "Ajuste pedido" e o filtro, "Ajustes".
14. **Isenção NÃO é pré-aprovação.** "Pré-aprovado (liderança)" (D12 — coordenador para cima)
    cai em `sem_parecer`, porque `chaveDoEstado` só casa o rótulo exato. É intencional: filtrar
    "Pré-aprovado" e receber os isentos afirmaria que um líder olhou o projeto.

**Testes.** `tests/dashboard-filtros.test.ts` (37 casos: AND das dimensões, ganho positivo,
pontas inclusivas do período, contagens recortadas, aritmética de mês/ano bissexto, atalhos,
fuso, os 6 estados de parecer + a isenção que não é pré-aprovação) e
`tests/calendario-ui.test.ts` (11 guardas de fiação: fonte única do filtro e dos rótulos de
parecer, Etapa 2 sem `type="date"`, piso de acessibilidade).

**Status.** ⏳ Implementado; suíte verde (1486 testes) + `npm run build` OK (19 assets JS, o
mesmo número de antes — a régua de performance é a CONTAGEM de requisições). **`worker.js`
não precisa de rebuild** (mudança 100% frontend). **Deploy pendente** (regra 13 — staging
`edf400b4` antes de prod).

## Feature adicional — Comparador de projetos ESPECIAIS por ÂNCORA (`/especiais`, 18/08/2026)

**Origem.** Discussão GoBrands × PIAPP: o GoBrands saiu de 8 estrelas para "será que vale alguma?" numa conversa só. A causa não é julgamento ruim — é a escala não existir. A coluna manual "Estrelas" é um número sem denominador: (1) 1/2/3 não têm definição escrita; (2) só o número é gravado, nenhuma justificativa, então nenhuma nota vira referência depois; (3) comparar dois especiais exige abrir duas documentações longas.

**Decisão — a régua é ÂNCORA, não rubrica absoluta.** Gente é ruim em nota absoluta e boa em comparação. A tela agrupa os especiais por NÍVEL e fixa no topo de cada coluna o projeto REAL que o define (o "flagship"), com uma frase curta (≤280 chars) escrita pela triagem. A pergunta deixa de ser "quantas estrelas isto vale?" e passa a ser "isto é maior ou menor que o PIAPP?".

**Onde aterrissou.**
- `src/lib/especiais-view.ts` — módulo PURO: `agruparEspeciais`, `alvosDaComparacao`, `ancoraForaDoNivel`, `rotuloNota`, `NOTAS_BASE`, `MAX_COMPARAR`. Testes: `tests/especiais-view.test.ts` (14 casos).
- `src/lib/especiais.functions.ts` — servidor: `listarEspeciais` (lê o MESMO espelho da triagem, filtra especial no servidor), `definirEstrelasEspecial`, `definirReferenciaEspecial`, `removerReferenciaEspecial`.
- Tabela INTERNA `especial_referencia` (`schema.ts` + `client.server.ts`): `projeto_id` (PK), `nota`, `motivo`, `definido_por`, `definido_em`. Sem coluna no Sheets, fora de `SAFE_UPDATE_FIELDS`, o sync reverso não a toca.
- Rotas `GET /api/admin/especiais` · `POST /api/admin/especiais/estrelas` · `POST /api/admin/especiais/referencia` · `POST /api/admin/especiais/referencia/remover` — todas `requireAdmin`.
- Tela `src/routes/_authenticated/especiais.tsx` + item "Especiais" na sidebar.

**Decisões fechadas (não "corrigir" por engano).**
- **A âncora aparece na coluna da NOTA GRAVADA, nunca na `nota` declarada na referência.** Regravar a estrela de um projeto-âncora na ficha do `/dashboard` deixaria o cartão numa coluna e a régua em outra, e a tela afirmaria que o nível 3 é definido por um projeto que está no 2. A divergência vira **aviso no cartão**, não sumiço.
- **Um nível pode ter MAIS DE UMA âncora** (o topo da base é PIAPP e companhia) — por isso a chave da tabela é o projeto, não a nota. A frase da régua do nível é a da 1ª âncora que tenha texto: âncora sem frase não apaga a que outra escreveu.
- **`null` (sem nota) ≠ `0`.** São duas colunas: "ninguém olhou" e "olhei e não dei estrela".
- **Níveis 0–5 aparecem mesmo vazios** (a régua tem de ser visível inteira: "não existe projeto de 4" ≠ "4 não existe"); notas acima ganham coluna quando há projeto ou âncora (escala ABERTA — há 7, 8 e 10 na planilha).
- **A nota continua morando na planilha.** Esta tela é o 2º lugar do sistema que escreve "Estrelas" e escreve SÓ ela — nada de "Status", nada de "Atualizado Em" (carimbo do sistema que regulariza legado). Escrita numérica sem `ouTraco` (a coluna é somada/ordenada na planilha) + `espelharEscrita` com carimbo.
- **O modo comparar reusa o LOTE da triagem** (`/api/admin/dashboard/projetos/lote`) — 1 requisição, porque cada uma custa ~750 ms de overhead fixo do edge — e **injeta a âncora do nível de cada selecionado** (`alvosDaComparacao`): sem isso a comparação seria "projeto novo × projeto novo", que é o que não resolve.
- **Passos de ±1 na nota do cartão** (não a fileira de estrelas inteira): o gesto desta tela é REPOSICIONAR entre níveis; pontuar do zero é da ficha.

**Fora de escopo por ora (peça seguinte).** O agente que pré-classifica o especial submetido comparando-o com o topo da base (PIAPP e as âncoras de 5, 6 e 7) e já propõe a caixa. Ele depende desta tela existir: as âncoras + as frases da régua são o material de comparação dele. Ver `docs/NEXT-SESSION.md`.

**Peça 1 (rubrica de eixos) NÃO foi implementada** — decisão do Luis de 18/08/2026 foi trabalhar em volta das peças 2 e 3 (âncora + view). A pergunta que a rubrica dependia ("a estrela mede impacto para a empresa ou mérito do projeto?") segue em aberto.

---

## Aba TEMPORÁRIA — Aprovação de pendentes por autor (`/aprovacoes-pendentes`) + filtro "2+ projetos" no /dashboard (19/08/2026)

**Pedido do Luis.** Uma aba admin temporária, cópia da `/especiais` mas **sem estrelas e sem agente**, para o time de RPA aprovar os projetos **pendentes e pré-aprovados** do fluxo normal — organizados numa **coluna por AUTOR** (para achar quem submeteu vários e validar tudo de uma vez), com divisão por área entre os admins (para editar).

**Decisões (via pergunta ao Luis):**
- **Colunas por AUTOR**, ordenadas por quem tem mais projetos (empate: nome). Chave por e-mail (`chaveAutor`), para homônimos não se juntarem e a mesma pessoa não se partir por acento/caixa.
- **Escopo** (`ehDaFilaRpa`): só `!especial && !descontinuado && statusChave ∈ {'', 'pendente'}`. Fora: especial (aba própria), descontinuado, reenvio e já decididos (a bola não está com o RPA).
- **Filtro** = toggle **"Só quem tem 2+ projetos"** (`apenasAutoresComMultiplos`): conta autores sobre o conjunto JÁ filtrado, soma (AND) com os demais (busca, validador, situação, período).

**O mesmo filtro foi ao `/dashboard`** (pedido seguinte): toggle "Autores com 2+ projetos" (`filtros.soMultiplos`), aplicado por ÚLTIMO em `filtrados` (é filtro de CONJUNTO, não predicado por linha — não entra em `aplicarFiltros`, e as contagens das pílulas não o refletem de propósito).

**Reuso / fonte única:** `chaveAutor` e `apenasAutoresComMultiplos` moram em `src/lib/dashboard-resumo.ts` (módulo PURO), consumidos pelas duas telas. A régua de fila/espera/divisão-por-área vem de `especiais-view.ts`. As ações de triagem reusam `especiais-acoes` + `POST /api/admin/dashboard/status`; a ficha reusa `ProjetoDetalheDialog`; a divisão reusa `POST /api/admin/especiais/dono`. Único endpoint novo: `GET /api/admin/aprovacao-pendentes` (`listarAprovacaoPendentes`, lê o espelho).

**Arquivos:** `src/lib/aprovacao-pendentes-view.ts` (puro), `src/lib/aprovacao-pendentes.functions.ts` (servidor), `src/routes/_authenticated/aprovacoes-pendentes.tsx`, nav em `route.tsx` (selo "Temporária"), rota no `worker.ts`. Testes: `tests/aprovacao-pendentes-view.test.ts`.

**Decisão em aberto:** o escopo inclui todos os `pendente` não-especiais (situação — fila do RPA / aguardando líder / aguardando autor — vira etiqueta + filtro). Se o Luis quiser só o que já é do RPA, é 1 linha em `ehDaFilaRpa`.

---

## Alerta do Google Chat leva ao /dashboard (deep-link da ficha) — 20/08/2026

**Motivo:** os avisos que caem no grupo do Google Chat (pré-aprovação do líder e projeto especial) terminavam com o *link da planilha de automações*. Mas quem lê esse grupo é **só admin**, e a triagem acontece no `/dashboard`, não na planilha. Pedido do Luis: trocar o link da planilha pelo link do dashboard, **já abrindo a ficha do projeto** com as informações gerais.

**O que mudou:**
- `src/lib/google/chat.ts`: removido o `SHEETS_URL`; novo helper PURO `linkDashboardProjeto(projetoId?)` que monta `<APP_BASE_URL>/dashboard?projeto=<id>` (origem extraída da env, `process.env` lido DENTRO da função — nunca no topo do módulo; fallback `https://godocs.devgogroup.com`; sem id → raiz do dashboard). As 2 mensagens (`buildSubmitMessage` e `buildEspecialMessage`) terminam agora em `🔎 Abrir a ficha no dashboard: <url>`. Campo `projetoId?` nos dois builders.
- Chamadores passam o id: `notificacao-projeto.functions.ts` (`notificarChatPreAprovacao`) e `google/sync.ts` (`syncSubmitToGoogle`, via `p.projetoId`).
- `src/routes/_authenticated/dashboard.tsx`: novo `validateSearch` para `?projeto=<id>`; um `useEffect` acha o resumo na lista COMPLETA (independe de filtro/página — o card é estado próprio) e abre a ficha (o MESMO `ProjetoDetalheDialog` do clique, herdando cache/prefetch). Um `useRef` guarda o id já aberto para não reabrir depois que a pessoa fecha; fechar a ficha limpa o param (`navigate` com `to:'/dashboard'`, `replace`).

**Decisões fechadas:**
- O link da planilha **saiu de vez** dessas mensagens (não é linha secundária) — decisão do Luis.
- O deep-link abre o overlay de triagem (edita status), não a página read-only `/projeto/$id`. Como o grupo é só de admin, o gate `requireAdmin`/`_authenticated` do dashboard é adequado.

**Testes:** `tests/chat-message-especial.test.ts` (link com id, encoding, raiz sem id, ausência do link da planilha nas 3 variantes de mensagem).

---

## Fluxo direto de liderança (pula o agente) — 21/08/2026

**Problema / pedido (Luis).** Cargos de liderança já isentos de pré-aprovação (coordenador para cima) não deveriam ter de conversar com o agente para submeter. Eles passam pela Etapa 1 e 2 e a documentação é gerada direto do que enviaram, indo para a submissão — só pelo fluxo determinístico.

**Decisões fechadas (não "corrigir" por engano):**
- **Quem entra:** exatamente a régua de isenção por cargo — `ehLideranca`/`cargo-lideranca.ts` (coordenador+, supervisor NÃO). Não duplicar a lista.
- **Gates 100% desligados** para esses cargos (decisão do Luis): sem jornada/teto/≥44h/alocação/ganho-projetado/sobreposição. O memorial é montado do formulário.
- **Doc gerada por IA numa passada** (não é a doc pobre do especial): extrator + `compilarDocumentacao`, sem conversa.
- **Memorial sem R$** para o usuário (o R$ segue escondido; entra por `enriquecerMemorial` no `memorial_calculo`).
- **Analisador não auto-reprova** projeto de liderança (imune como o especial → validação humana). Detectado por `ehLideranca(autor)`; sem coluna nova.
- **Só submissão NOVA e projeto padrão.** Edição de líder segue a revisão guiada normal; especial já pula o agente sozinho.
- **Permissão reconferida no SERVIDOR** em todo endpoint (o flag do cliente não burla gate).
- **Override admin `?lideranca=1`** para admins testarem sem depender do cargo real (só admin; o servidor reconfere).

**Onde aterrissou.** Backend: `src/lib/submeter-direto.ts` (memoriais puros), `iniciarSubmissao`/`iniciarSaving`/`iniciarReceita` (flags `fluxo_direto`/`modo_direto` + `podeFluxoDireto`), `analyzer.ts` (`fluxoDireto` em `normalizarClassificacao`/`decidirStatusSubmissao`), `worker.ts` (rota `GET /api/submeter/perfil` + e-mail threaded). Frontend: `submeter.tsx` (prop/estado de perfil, `modoDireto`, `handleContinuarDireto`, ramos diretos nos submits, botão da Etapa 2.5, background desligado). Testes: `tests/submeter-direto.test.ts` + `tests/criterios-classificacao.test.ts`.

---

## Sandbox de fluxos (`/fluxos`, admin) — 21/08/2026

**Pedido (Luis).** Uma tela de admin para ver os fluxos de submissão (normal e especial — e liderança) sem passar pela submissão real: todas as telas, textos e loading de botão, com o frontend funcionando normal.

**Abordagem escolhida (pelo Luis): sandbox do wizard REAL.** Rota admin `/fluxos` abre o formulário real de submissão em modo demonstração, com o backend mockado — nada é persistido. Vantagem: usa os componentes reais, então os textos nunca desincronizam do que vai para produção.

**Decisões fechadas:**
- Hook `setDemoBackend` em `api-client.ts`: quando definido, `apiFetch` delega a um handler mockado; quando `null` (produção), o caminho de rede fica idêntico (early-return).
- `src/lib/fluxos/demo-backend.ts`: state machine que imita o SHAPE das respostas reais (para os componentes reais renderizarem) — textos são exemplos, não vêm do LLM.
- `submeter.tsx` ganhou `demoFluxo`: instala o backend em `useLayoutEffect` (antes dos fetches passivos), pré-preenche o formulário e desliga seed/rascunho/background. `key={fluxo}` remonta limpo ao trocar.
- Rota dentro de `_authenticated` (já gated a admin). É ferramenta de inspeção; não escreve nada.

**Onde aterrissou.** `src/lib/api-client.ts`, `src/lib/fluxos/demo-backend.ts`, `src/routes/_authenticated/fluxos.tsx`, `src/routes/submeter.tsx`.

---

## Streaming SSE das respostas do chat (flag `LLM_STREAMING`) — 24/08/2026

**Status: EM PRODUÇÃO** (prod `674a3710` v276, PR #276 `4424030`, `main`=prod=staging). Plano completo em `docs/plans/streaming-latencia-ia.md` (§0 = o que foi entregue). Fase 1 do plano; partes 2 (Structured Outputs) e 3 (prompt-cache) caíram/deferidas — ver plano.

**Problema.** As respostas do chat eram lidas INTEIRAS antes de pintar qualquer coisa (`await res.json()` no `llm.ts` → uma mensagem pronta na UI): tela em branco de 60–88s nos turnos pesados (doc, memorial). E o timeout do proxy era régua de TAMANHO, não de saúde — ~58% dos turnos pesados caíam no fallback gpt-5.4-mini só por serem longos (ver a correção "Fallback do LLM era a REGRA" em `SPEC_CORRECOES.md`). Origem: caso RA Monitor / Luis Liveri (`eef2ba7414d5ed3540b017063f804add`, 6min47s só de espera de IA).

**Decisão central — "prosa em stream + envelope JSON no fim".** O contrato é um JSON único (`{type,content,coletado,saving,receita,options,fase}`) e gates determinísticos reescrevem esse objeto DEPOIS do LLM (um `preview` vira `question`). Então: a **prosa** (`content`) streama token a token; os **campos estruturais** resolvem no FIM, como evento `envelope`, depois dos gates pós-LLM. A UI pinta a prosa e reconcilia com o envelope canônico.

**Decisões fechadas (não regredir):**
- **Só as 4 rotas de conversa** (`iniciar-submissao`/`enviar-mensagem`/`iniciar-saving`/`iniciar-receita`) respondem `text/event-stream` (eventos `delta`/`envelope`/`error`). Erro vai DENTRO do stream (HTTP já é 200), com status/bloqueio, e o cliente reconstrói o `ApiError`.
- **Streama a PROSA só em `type`∈{preview,complete}** (`llmChatStream`), **NUNCA no `complete` de `doc_preview`** — a compilação pesada da doc (~64s) segue silenciosa (é a única espera em branco que sobra). O gate do type usa REGEX de VALOR COMPLETO `/"type":"(...)"/` — ler o type parcial travava `streamAtivo` pra sempre (bug pego em teste).
- **Timeout deixa de medir a resposta inteira e vira POR STALL, em DUAS FASES** (`callOpenAIStream`, envs lidas LAZY em `streamTimeouts()`): **(1) até o 1º delta de CONTEÚDO** vale só o relógio de PRIMEIRO CONTEÚDO — 60s proxy (`STREAM_FIRST_CONTENT_TIMEOUT_MS`) / 30s fallback (`STREAM_FIRST_CONTENT_FALLBACK_MS`) —, que cobre headers + o "raciocínio" do modelo; **(2) depois do 1º conteúdo** vale o **GAP 25s** entre chunks (`STREAM_GAP_TIMEOUT_MS`), resetado a cada chunk. Geração longa saudável nunca corta (maior gap real ~1,7s). O **fallback de dois relógios é preservado**. ⚠️ **Correção 24/08/2026:** o GAP de 25s deixou de valer ANTES do 1º conteúdo (era o que jogava o memorial pesado do Codex no fallback gpt-5.4-mini enquanto ele "pensava" >25s); chunks sem conteúdo (role/keepalive) não resetam o relógio de primeiro-conteúdo nem armam o GAP. Só o estol pré-conteúdo além da janela de primeiro-conteúdo cai no fallback; depois do 1º conteúdo, estol devolve o parcial SEM fallback (anti-prosa-dupla). Testes de fake-timer em `tests/llm-stream.test.ts`.
- **Turno em que um gate assume (`reask !== null`) NÃO streama** — devolve `json()` imediato, como hoje (muitas vezes sem chamar o LLM). Estado e gates 100% inalterados.
- **Cliente transparente ao transporte:** `apiStream` trata SSE E json → ligar/desligar é **só a env `LLM_STREAMING`**, sem redeploy do cliente. **Default OFF = idêntico ao json de sempre.** A flag é lida lazy por `streamingLigado()` (nunca `process.env` em escopo de módulo).
- **Parser incremental hand-rolled** (`extractPartialJsonStringField`) no lugar da dep `partial-json` (node_modules symlinkado + bundle do worker; só precisávamos de um campo string).
- ⛔ **Structured Outputs segue MORTA no proxy** (backend Codex ignora `response_format`) → o loop de retry/regex do orchestrator FICA. Fix viável do lado do time do proxy (ver plano §4.2).

**Validação (staging, probe SSE, 24/08).** Prosa streama onde deve (memorial 931 deltas, TTFB 18s vs 66s de tela branca); silenciosa onde deve; submissão completou; logs = todas as `/api/chat/*` "ok", zero exceções; 1 fallback esperado no memorial. Veredito: seguro em prod.

**Onde aterrissou.** `src/lib/llm.ts` (`llmChatStream`, stall-timeout, `extractPartialJsonStringField`), `src/lib/agents/orchestrator.ts` (`runOrchestrator` com `onDelta`), `src/lib/chat.functions.ts` (4 rotas threadam `onDelta`), `src/worker.ts` (SSE atrás de `LLM_STREAMING`), `src/lib/api-client.ts` (`apiStream`), `submeter.tsx`/`step3-chat.tsx` (bolha viva). Testes: `tests/llm-stream`, `tests/orchestrator-stream`, `tests/api-stream` (+24).

## Bloqueio TEMPORÁRIO de novas submissões (janela determinística) — 24/08/2026

**Status: EM PRODUÇÃO.** Feature temporária: pausar SUBMISSÕES NOVAS numa janela de tempo, sem tocar no que já foi enviado.

**Problema.** Precisamos pausar o recebimento de projetos novos por uma semana (validação do formulário), mas SEM parar a triagem/aprovação do que já entrou e SEM impedir que quem já submeteu edite/reenvie.

**Decisões fechadas (não regredir):**
- **Janela DETERMINÍSTICA, sem cron.** Pura função do relógio: `estaBloqueado(now)` compara o instante contra dois marcos UTC fixos. Bloqueado quando `2026-08-26T02:59:00Z <= agora < 2026-09-01T03:00:00Z` (BRT: ter 25/08 23h59 → ter 01/09 00h00; fim exclusivo = instante de reabertura).
- **FONTE ÚNICA PURA `src/lib/bloqueio-submissao.ts`** (client + server): janela + copy + `estaBloqueado`/`faseBloqueio`/`estadoBloqueio`/`deveRecusarSubmissao`/`janelaBloqueio`. Env de override (`SUBMISSAO_BLOQUEIO_INICIO`/`SUBMISSAO_BLOQUEIO_FIM`, ISO UTC) lida **LAZY** e guardada por `typeof process` (nunca `process.env` em escopo de módulo; no navegador cai nos defaults baked). Override inválido (`NaN`) volta ao default (nunca abre a janela por engano).
- **Só SUBMISSÃO NOVA é barrada.** `deveRecusarSubmissao(ehReenvio, now)` = `!ehReenvio && estaBloqueado`. Reenvio/edição (`modo==='edicao'` ou `projeto.submitted_at` presente) nunca é recusado.
- **Reforço de SERVIDOR + botão.** `submeterParaValidacao` (`chat.functions.ts`) lança `erroDeBloqueio(bloqueioSubmissaoPausada())` (novo `codigo:'submissao_pausada'` em `mensagens-submissao.ts`, que reusa a copy "durante" — titulo+resumo recompõem a frase). Cliente: home (`routes/index.tsx`) e intro (`submeter/intro.tsx`) mostram a faixa `AvisoBloqueioSubmissao` (`src/components/aviso-bloqueio-submissao.tsx`) e desabilitam o botão DURANTE; ANTES da janela mostram o aviso prévio sem bloquear.
- **Copy (FONTE ÚNICA, sem "-"/"—"):** aviso prévio = "As novas submissões serão pausadas nesta terça, 25 de agosto, às 23h59. Se você já começou a submissão de um projeto, conclua o envio antes desse horário. Voltamos a receber submissões na terça, 1º de setembro."; durante (= recusa do servidor) = "As submissões estão pausadas no momento e voltam na terça, 1º de setembro. Os projetos que você já enviou seguem em avaliação normalmente pelo time de RPA."
- **a11y (regra 11):** estado nunca só por cor (ícone + rótulo textual "Aviso"/"Submissões pausadas"), `role="status"`, botão com `aria-disabled`/`title`, sem animação.

**Reabrir / mover:** setar os secrets `SUBMISSAO_BLOQUEIO_INICIO`/`SUBMISSAO_BLOQUEIO_FIM` (sem redeploy de lógica). **Remover de vez:** apagar a chamada em `submeterParaValidacao`, a faixa nas 2 telas e os 2 blocos TEMPORÁRIO no `CLAUDE.md`.

**Onde aterrissou.** `src/lib/bloqueio-submissao.ts` (novo), `src/components/aviso-bloqueio-submissao.tsx` (novo), `src/lib/mensagens-submissao.ts` (`bloqueioSubmissaoPausada` + codigo), `src/lib/chat.functions.ts` (guard em `submeterParaValidacao`), `src/routes/index.tsx`, `src/lib/submeter/intro.tsx`. Teste: `tests/bloqueio-submissao.test.ts`.

## Feature adicional — "O que essa pessoa fez?" por participante (25/08/2026)

**Problema.** O formulário sabia QUEM participou e em que papel (`membros` + `membros_papeis`),
mas não o QUE cada pessoa fez. Na triagem e nas duas abas temporárias do admin
(`/especiais`, `/aprovacoes-pendentes`) o time de RPA via uma lista de e-mails e tinha de
adivinhar a divisão de trabalho — ou perguntar ao autor.

**O que foi feito.** Abaixo do seletor de papel de CADA participante (qualquer papel) entra um
texto curto obrigatório: "O que essa pessoa fez". Vai só para o banco e aparece no Investigador
e nos cartões/fichas das 2 abas do admin.

**Decisões fechadas (não regredir):**
- **20–100 caracteres, limites em FONTE ÚNICA** (`CONTRIBUICAO_MIN`/`CONTRIBUICAO_MAX`,
  `submeter/constants.ts`). O campo tem 2 linhas de altura e contador `n/100` — a altura é o que
  comunica "é curto" sem precisar de aviso.
- **Coluna INTERNA `projetos.membros_contribuicoes`** (JSON, e-mail→texto). **NÃO existe no
  Sheets** (decisão de produto: é dado de gestão, não de planilha), logo está fora de
  `SAFE_UPDATE_FIELDS`, o sync reverso nunca a toca e ela sobrevive aos syncs — mesma classe de
  `editores_delegados`. **Nunca entra em prompt de IA** (nem doc, nem memorial, nem analisador).
- **O autor NÃO entra** (idêntico à régua dos papéis: o campo é dos participantes).
- **A trava é do FRONT; o servidor tolera.** `validarEtapa1` bloqueia o avanço nos DOIS modos
  (submissão nova e edição), em campo de erro PRÓPRIO (`participantesContribuicoes`) — a
  mensagem de papel/coautor fala de outra coisa e não explicaria a falta do texto. O zod
  (`membrosContribuicoesSchema`) limita só o TETO: com o piso no servidor, uma aba com JS em
  cache (version skew — já aconteceu neste repo) levaria **400 no meio da submissão**, sem saída
  além de recarregar. A consequência aceita: cliente adulterado pode gravar texto curto, e a
  triagem vê o que veio.
- **Uma cobrança por vez na tela:** enquanto falta PAPEL, o aviso âmbar é o do papel; o do texto
  só aparece depois. Duas cobranças simultâneas viram ruído.
- **Poda de quem sai do time:** `montarMembrosContribuicoes` só emite participantes atuais
  (chave órfã nunca vai ao banco), faz trim e corta no teto.
- **Entra no `AgentMeta`**, como os papéis: editar o texto no meio do chat dispara `metaChanged`
  e persiste via `atualizar-metadados`. Sem isso a correção morria na tela.
- **Timeline:** chave nova (`membros_contribuicoes`) no JSON `dados` dos eventos `submissao` e
  `metadados` do `form_events` — sem migração; evento antigo não a tem e a linha não aparece.

**Como as 2 abas do admin enxergam o texto (o ponto não óbvio).** `/especiais` e
`/aprovacoes-pendentes` listam do **espelho da planilha** (`sheet_espelho`), e este campo não
existe lá. Então ele chega por um **mapa lateral do banco**, chaveado pelo id do projeto —
exatamente o que as `avaliacoes` da `/especiais` já faziam: `getContribuicoesDeParticipantes()`
(SELECT das 4 colunas de participantes, só das linhas com texto, **sem blobs** — a lição dos
32 MiB de RPC) → mapper PURO `montarContribuicoesPorProjeto` (`src/lib/participantes-contribuicoes.ts`),
que ordena pela ordem de `membros`, traduz o papel (`rotuloPapelParticipante`, legados
`idealizador`/`referencia_tecnica` → "Contribuidor") e **descarta projeto sem texto** (legado não
vira fileira de "—").

- No **cartão**, o bloco `QuemFezOQue` (`src/components/admin/quem-fez-o-que.tsx`, fonte única das
  2 telas) vem **COLAPSADO**: 4 pessoas × 100 chars inflariam a coluna, que serve para escanear —
  é a lição do aviso de reprovação nos cards de "Meus Projetos", que aberto por padrão crescia
  ~200px.
- Na **ficha** (`ProjetoDetalheDialog`, prop OPCIONAL `pessoas`) vem **ABERTO**: a ficha é onde se
  decide, e é para ler. A prop é opcional porque a ficha do `/dashboard` não carrega o mapa.

**Rótulo das colunas de papel na ficha (mesmo PR).** A ficha mostrava os nomes crus da planilha:
"PARTICIPANTES" e "PARTICIPANTES 2" — sendo que quem submeteu escolheu "Coautor" e
"Participante". `rotuloColuna` (`src/lib/coluna-rotulo.ts`, PURO, casamento tolerante via
`chaveColuna`) traduz na EXIBIÇÃO. ⚠️ É só rótulo: a **chave** de leitura/escrita da célula
continua sendo o nome da coluna (renomear a coluna quebraria o mapeamento por nome).

**Onde aterrissou.** `src/integrations/db/schema.ts` (migração), `client.server.ts`
(`InsertProjeto`/INSERT/`ProjetoRow` + `getContribuicoesDeParticipantes`),
`src/lib/submeter/constants.ts` (2 puras + limites + `FormData` + `validarEtapa1`),
`submeter/step1.tsx`, `submeter/form-components.tsx` (campo), `routes/submeter.tsx` (seed da
edição, rehydrate, `AgentMeta`, 11 payloads), `chat.functions.ts` (schemas, insert, update, 2
eventos), `meus-projetos.functions.ts` (seed), `investigador.functions.ts` +
`routes/_authenticated/investigador.tsx` (timeline + painel), `especiais.functions.ts`,
`aprovacao-pendentes.functions.ts`, `routes/_authenticated/especiais.tsx`,
`routes/_authenticated/aprovacoes-pendentes.tsx`, `components/dashboard/projeto-detalhe-dialog.tsx`,
`src/lib/participantes-contribuicoes.ts` (novo), `src/lib/coluna-rotulo.ts` (novo),
`src/components/admin/quem-fez-o-que.tsx` (novo). Teste: `tests/participantes-contribuicoes.test.ts`.

## Agente CLASSIFICADOR de projetos ESPECIAIS — a "peça 4" (RAG por embeddings) · 25/08/2026

**Decisão (Luis, 25/08/2026):** o `/especiais` mostra a recomendação da auditoria (estrela 0–10),
mas até aqui ela só vinha do **seed da força-tarefa do JV** (99 projetos, 18/08) e de importação em
lote — todo especial submetido **depois** aparecia SEM recomendação. Faltava o agente que classifica
na submissão. Ele **aprende com a própria memória** (os especiais já avaliados) e usa **RAG por
embeddings** para "rápida e precisa avaliação". Escolhas: **embeddings vetoriais** (não recuperação
lexical) + **1 passe com guard determinístico** (não passe adversarial).

### O que o agente é (e o que NÃO é)
- **PROPÕE** a estrela + a `leitura` que a justifica, gravada em `especial_avaliacao` (origem
  `agente-classificador`, com o `modelo`). **NUNCA grava a coluna "Estrelas" da planilha** — a nota
  só muda por clique de gente (mesma invariante do lote/seed). É um 2º par de olhos calibrado.
- Roda **em background após a submissão** (só se `especial === 1`), no `worker.ts`, junto da análise
  (`processarPosSubmissao` → `Promise.allSettled([analisar, classificar])` sob `ctx.waitUntil`).
- **Backfill/cron** para os especiais que já existem sem recomendação (o buraco que o Luis viu):
  `POST /api/admin/especiais/classificar-pendentes` (dry é o DEFAULT) + `POST /api/admin/especiais/classificar`
  (um projeto, para teste) + cron `POST /api/cron/classificar-especiais` (dry:false, bounded a 10/corrida).

### A memória e o "RAG"
- **A memória são os especiais JÁ decididos.** O corpus de exemplares = especiais do espelho que têm
  **nota humana** (coluna "Estrelas" = VERDADE) **ou** uma recomendação gravada. ⚠️ **O rótulo
  preferido é a nota HUMANA, não a recomendação do próprio agente** — aprender das próprias saídas é
  como o classificador deriva (feedback loop); a nota de gente é o chão (`rotuloExemplar`).
- **Embeddings vão SEMPRE direto na OpenAI, NUNCA no proxy** — o gateway GoGroup é uma subscription
  Codex e devolve **404 em `/embeddings`** (probe 25/08). Chave: `LLM_EMBEDDINGS_KEY` senão
  `LLM_FALLBACK` (já nos secrets de prod). Modelo `text-embedding-3-small` (1536d, override
  `LLM_EMBEDDINGS_MODEL`). Sem chave → degrada para recuperação sem vizinhos, nunca quebra
  (`embeddings.ts`, envs LAZY).
- **Vetor no SQLite como base64 de Float32Array** (o Worker não tem Buffer), tabela INTERNA/DERIVADA
  `especial_embedding` (fora do Sheets e de `SAFE_UPDATE_FIELDS`; apagável — o backfill reconstrói).
  `texto_hash` evita re-embeddar (custa) quando o texto do projeto não mudou.
- **Recuperação PURA e testável** (`especial-corpus.ts`): cosseno em JS sobre o corpus (dezenas de
  linhas), top-K acima do piso, exclui o próprio projeto e exemplares sem rótulo. Os vizinhos viram
  bloco few-shot com nota + área + a `leitura` que ancora (é a leitura que ensina o "por que não sobe").

### Prompt e guard (`agents/especial-classificador.ts`)
- Prompt montado da `especiais-regua.ts` (FONTE ÚNICA: níveis, critérios, o que derruba, a CURVA_BASE
  real) — não redigitar a régua aqui.
- **Structured Outputs está MORTA no proxy** → `jsonMode: true` + parser defensivo por regex
  (`extrairJson`: puro / cerca ```json / objeto embutido), mesmo padrão do `analyzer.ts`.
- **Guard determinístico** (`normalizarRecomendacao`): clampa 0–10 e arredonda; confiança inválida →
  `baixa`; **nota ≥3 (top 4% da base) força confiança ≤ média e marca `contestada`** (nota rara pede
  olho humano) — e o agente **nunca grava a estrela** mesmo assim. Sem nota numérica → `null` (não grava).

### Salvaguardas anti-inflação (a curva é dura de propósito)
- ≥3★ é top 4%; ≥5★ é top 1%. A curva vai no prompt; o guard rebaixa confiança em nota alta; o corpus
  prioriza a verdade humana. E a triagem humana continua sendo a rede final (o agente só sugere).

### Arquivos
- `src/lib/embeddings.ts` (novo) · `src/lib/especial-corpus.ts` (novo, PURO) ·
  `src/lib/agents/especial-classificador.ts` (novo) · `src/lib/especial-classificador.functions.ts` (novo) ·
  tabela `especial_embedding` + helpers em `client.server.ts`/`schema.ts` · rotas + disparo em `worker.ts`.
- Testes: `tests/especial-classificador.test.ts` (round-trip base64, cosseno, recuperação, parse+guard).
  Validado E2E contra OpenAI+proxy reais (25/08): painel de margem → 2★ ancorado no «Godash».
