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

## Feature adicional — Botões "Recomeçar" e "Salvar rascunho" no formulário · jul/2026

> Pedido do dono (Kaique, 2026-07-02): um controle **pequeno e visível** no formulário que,
> ao clicar, abre um popup "tem certeza?" listando o que será perdido e, se confirmado, **zera
> tudo** e volta ao início.

**Problema.** Quem começava uma submissão e queria recomeçar do zero (mudou de projeto, errou o
escopo, quer descartar a conversa com o agente) não tinha um caminho claro — só apagar o rascunho
lá em "Meus Projetos > Rascunhos" ou limpar o localStorage. Faltava um "recomeçar" no próprio form.

**Decisão (fechada).**
- **Escopo: só submissão NOVA** (`!editProjetoId`). Em **edição** de projeto já submetido o botão
  **não aparece** — "recomeçar" não faz sentido ali (não há como zerar para branco um projeto real
  nem criar um novo pelo fluxo de edição). Some também na **tela de sucesso** (que já tem "Submeter
  outro projeto").
- **Posição:** na barra de "chrome" do card (à direita dos `BrowserDots`), reaproveitando a metáfora
  de janela já presente, em vez de flutuar um botão solto. Pequeno, cinza discreto, ícone `RotateCcw`
  + rótulo "Recomeçar" (só ícone no mobile). Esquenta para tom de alerta no hover.
- **Confirmação obrigatória:** popup (overlay embaçado + Esc, mesmo padrão do `DistribuirEdicaoModal`)
  com ícone de alerta âmbar e **lista concreta** do que se perde (etapas + arquivos · conversa com o
  agente + documentação · valores de saving/receita). Ação destrutiva em vermelho, rótulo explícito
  "Sim, recomeçar" (a11y: estado por ícone + rótulo, nunca só cor; foco de teclado visível).
- **Reset "de verdade":** apaga o rascunho no **servidor** (`DELETE /api/meus-projetos/:id`,
  best-effort — evita órfão em "Rascunhos"; se falhar, o reset local segue) + `clearDraft()` local +
  **navegação dura** para `/submeter` limpo (`window.location.assign`, descarta `?retomar` e força
  remontagem do zero). Mesma abordagem robusta do "Submeter outro projeto", sem resetar ~30 estados
  à mão.

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
- `src/routes/submeter.tsx` — import estende para `{ RotateCcw, AlertTriangle, Loader2, Save,
  FolderClock }`; **`ConfirmarRecomecoModal`** (Recomeçar) + **`SalvarRascunhoModal`** (rascunho);
  estados `showResetConfirm`/`recomecando` e `showRascunhoConfirm`/`salvandoRascunho`; handlers
  `handleRecomecar` (DELETE best-effort → `clearDraft` → `window.location.assign("/submeter")`) e
  `handleSalvarRascunho` (`invalidateQueries(['meus-projetos'])` → `clearDraft` → `navigate('/')`);
  os dois botões agrupados na barra dos `BrowserDots` (Recomeçar só `!editProjetoId`; Salvar
  rascunho `!editProjetoId && projetoId`); render dos dois modais ao fim do `PageFrame`.
- Recomeçar reusa `DELETE /api/meus-projetos/:id` (`excluirRascunho`, gate ownership + só
  `status === 'rascunho'`). **Nenhuma mudança server-side** nas duas features (não regera lógica de
  `worker.js`).

**Status.** 🚧 Implementadas (Recomeçar + Salvar rascunho); testes verdes (504) + `tsc` sem erros
novos. Deploy em **staging** (`edf400b4`) para validação manual antes de prod.
