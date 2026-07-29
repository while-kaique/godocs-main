# Plano — Critério de projeto: perguntas-chave + classificação da avaliação + reprovação com motivo

**Status:** ✅ **executado (2026-07-29)** — T1–T7 codados **+ refinamento R1/R2 pós-staging no mesmo dia**
(pedido do Luis, ver abaixo), **726 testes verdes**, `build` + `build:worker` OK, staging `edf400b4`
redeployado. Falta o que **não é código**: validar no staging (os 3 cenários dos critérios de aceitação
**+ o fluxo novo**) → **prod `674a3710`** → PR. ⚠️ **A régua (T7) deve ser calibrada com o Rafa antes de
produção** — reprovar projeto é visível ao autor.

### R1/R2 — refinamento pós-staging (29/07/2026, commit `b6485e4`)
Depois de ver a Etapa 2 na staging, o Luis mudou **onde** duas coisas são coletadas (D5 da spec revisado):
- **R1 — o ponteiro sai do formulário e vai para o AGENTE.** Os cards "moveu o ponteiro de quê?" e o campo
  "onde isso pode ser verificado?" foram **removidos** da Etapa 2. No lugar: seção obrigatória
  **`[1.4]` "Ponteiro movido e onde verificar"** no `MEMORIAL_ESQUELETO` (3 modos) + condução no
  `orchestrator.ts` — pergunta **1×** qual ponteiro moveu (`type:"options"`: custo · receita · KPI da área ·
  ainda não sei) e **1×** onde alguém abre e confere (relatório/painel/base **nomeados**), **argumenta o
  racional junto com a pessoa** e, se ela não souber onde conferir, **registra exatamente isso e segue** —
  nunca inventa fonte nem trava. Motivo: rastreabilidade não se resolve com checkbox. O analisador passou a
  ler a rastreabilidade do memorial; seção ausente ou "não sei" → **zona cinzenta**, nunca reprovação
  automática. ⚠️ `ponteiro_movido`/`ponteiro_evidencia` viraram colunas **LEGADO** (nada mais as escreve).
- **R2 — "quem reclama" vira seleção, não texto livre.** Novo `AfetadosInput` com filtro **dinâmico**:
  **pessoa** (autocomplete nome/e-mail, mesma lista da Etapa 1 — cache de módulo, sem refetch) ou
  **time/área inteiro** (`GET /api/areas`), para não marcar pessoa por pessoa quando o impacto é do time
  todo. Persiste em `contrafactual_afetados` (`"pessoa:a@x;b@y"` | `"time:Fiscal;CX"`) com
  `serializarAfetados`/`desserializarAfetados` puras (round-trip testado; valor legado não derruba a tela).
  Só **"E o que piora?"** segue texto livre (≥15 chars).
- **Reuso:** o posicionamento do dropdown por portal foi extraído para o hook **`useDropdownAnchor`**, agora
  compartilhado pelos autocompletes das Etapas 1 e 2 (eram ~40 linhas duplicadas). Spec: [`spec-docs/SPEC_CRITERIOS_PROJETO.md`](../../spec-docs/SPEC_CRITERIOS_PROJETO.md).
**Blast-radius: ALTO** (formulário + orquestrador + analisador + sync + dashboard)

## Contexto

A gestão (Rafa) apertou o critério de projeto depois de submissões que não deveriam ter entrado (caso-símbolo:
uma **nuvem de palavras**). A régua dele tem 3 critérios: **recorrência** (roda de novo sem alguém pedir?),
**contrafactual** (se desligar amanhã, o que piora e onde se vê?) e **rastreabilidade** (qual indicador mudou e
em qual relatório/sistema/base isso é verificável?). Impacto **não precisa ser receita** — horas, erro,
retrabalho, fraude, risco e prazo valem, desde que recorrentes e verificáveis. **Projeto simples continua
bem-vindo**; o que não vale é **peça única sem evidência** ("aprendizado não é submissão").

Hoje o sistema não colhe rastreabilidade nem contrafactual de forma estruturada, e o analisador só decide
"aprovado / rejeitado" por pontuação — não existe juízo de **elegibilidade** ("isto é projeto?"). Resultado
pretendido: o autor responde 2 perguntas fechadas na Etapa 2 e 1 pergunta narrativa no agente; o analisador
classifica a submissão em **claro sim / claro não / zona cinzenta**, **sempre explicando o porquê**; "claro
não" vira **Reprovado** na planilha com motivo; a triagem humana pode sobrepor tudo.

**Decisão preservada (não muda):** o formulário **não barra** submissão. A reprovação acontece **depois** do
envio, no analisador — coerente com a decisão firme de 28/07/2026
([perguntas-agente-recorrencia-evidencia](perguntas-agente-recorrencia-evidencia.md)).

## Decisões fechadas com o Luis (29/07/2026)

- **D1** — Status na planilha: **exceção só para "claro não"** → grava `Reprovado`. Todo o resto continua
  `Pendente` (a regra TEMPORÁRIA do `CLAUDE.md` **permanece**). E **a classificação é sempre explicada**,
  qualquer que seja o resultado — "é bom o agente explicar bem explicado o porquê da classificação,
  independente de qual for".
- **D2** — **O analisador decide**, o humano sobrepõe no `/dashboard`. Zona cinzenta → `Em validação`.
- **D3** — Onde perguntar: **"moveu sensivelmente o ponteiro?"** e **"se desligar hoje, quem reclama?"** →
  **Etapa 2** (formulário determinístico). **"Que processo mudou e quanto?"** → **agente**, na fase de impacto.
- **D4** — Colunas **já criadas por Luis** na planilha (o banco principal): `Motivo Reenvio`,
  `Motivo Reprovado`, `Classificação`. Texto; ausência = `-`; **Classificação sempre preenchida** em submissão
  nova/atualização. **Motivo Reenvio é humano por enquanto** (preenchido na triagem, nunca pelo sistema).

## O que muda

### T1 — Etapa 2: 2 perguntas determinísticas (padrão `usa_ai_proxy`)

Clonar ponta a ponta o caminho de `usaAiProxy`, que é exatamente este padrão:
`src/routes/submeter.tsx` (FormData + payload de metadados, ~9 pontos) → `src/lib/submeter/constants.ts`
(`validarEtapa2`) → `src/lib/submeter/step2.tsx` (UI) → `src/integrations/db/schema.ts` (`ALTER TABLE`) →
`src/integrations/db/client.server.ts` (insert/update + `ProjetoRow`) → analisador.

1. **"Este projeto moveu sensivelmente o ponteiro de quê?"** — multisseleção em **cards** (checkbox lateral +
   título + descrição — feedback registrado: opção com descrição nunca é texto solto): `Custo` · `Receita` ·
   `KPI da área` · `Nenhum / ainda não sei`. Marcando qualquer um dos 3 primeiros, abre campo obrigatório
   **"Onde isso pode ser verificado?"** (relatório, sistema ou base — nomear) → é o critério de
   **rastreabilidade**, que hoje não existe em lugar nenhum.
   Colunas: `projetos.ponteiro_movido` (TEXT, lista separada por `;`) + `projetos.ponteiro_evidencia` (TEXT).
2. **"Se desligar isso hoje, quem reclama — e o que piora?"** — textarea curta obrigatória (contrafactual).
   Coluna: `projetos.contrafactual_reclamacao` (TEXT).

⚠️ **Obrigatório ≠ barrar:** `Nenhum / ainda não sei` é resposta **válida** e passa. Ela apenas vira **sinal
forte** para o analisador. Nenhum caminho novo bloqueia submissão.

### T2 — Agente: "que processo mudou e quanto?" (sem somar turno quando já se sabe)

Seção nova no **`MEMORIAL_ESQUELETO`** (`src/lib/agents/memorial-format.ts`) — fonte única, exigência do
`CLAUDE.md` — **obrigatória nos 3 modos** (`saving`, `custo_evitado`, `receita`):

> `### Processo alterado` — qual rotina/processo mudou, como era antes, como é agora e a **magnitude**
> (volume, frequência, tempo). Sem R$.

Novo código de checklist em `TITULOS_MEMORIAL` (`1.3` → "Processo alterado"). Instrução anti-redundância nos
prompts (`buildSavingPrompt` / `buildSavingCustoEvitadoPrompt` / `buildReceitaPrompt` em
`src/lib/agents/orchestrator.ts`): se a **documentação já aprovada** descreve o processo e a magnitude, o
agente **preenche a seção sem perguntar**; só pergunta quando falta a magnitude — **máximo 1 pergunta**.
Segue o desenho T4(c) da frente aprovada ("o que já é sabido nunca vira pergunta") e o baseline de 6,4
perguntas/submissão que não deve piorar.

### T3 — Analisador: classificação em 3 níveis + motivo (`src/lib/agents/analyzer.ts`)

**(a) Bloco novo no prompt — "RÉGUA DE CRITÉRIO DE PROJETO":** os 3 critérios do Rafa, a taxonomia de impacto
(horas · custo/headcount/hora extra · erro · retrabalho · fraude/risco · prazo · receita), o aviso explícito de
que **simplicidade não reprova** (só falta de recorrência/evidência reprova), e os exemplos-âncora (nuvem de
palavras, cronômetro → claro não). Alimentado pelos 3 campos novos da Etapa 2 + a seção "Processo alterado".

**(b) Saída JSON nova** (junto de `resultado`/`complexidade`, sem remover nada):
```
"classificacao_avaliacao": "claro_sim" | "claro_nao" | "zona_cinzenta",
"classificacao_justificativa": "<2-4 frases: qual critério passou/falhou e por quê>",   // SEMPRE
"motivo_reprovacao": "<texto legível ao autor>" | null                                   // só claro_nao
```

**(c) `normalizarClassificacao()`** — função **pura**, espelho de `normalizarComplexidade` (mesmo arquivo,
mesmo estilo, testada isolada). Invariantes:
- `claro_nao` **sem motivo** não-vazio → rebaixa para `zona_cinzenta` (**nunca reprova sem explicar**);
- `especial === 1` → nunca reprova automático → `zona_cinzenta` (a rota de projeto especial existe justamente
  para impacto real sem R$ mensurável e **não pode ser atropelada** por esta régua);
- materialidade > **R$ 5k/mês** → `zona_cinzenta` (mesma régua que já força `em_validacao`);
- valor ausente/inválido do LLM → `zona_cinzenta`; justificativa vazia → **fallback determinístico**
  (a coluna `Classificação` **nunca** fica sem texto — exigência do D4).

**(d) Precedência de status** em `analisarProjetoFn` (`src/lib/chat.functions.ts:2060-2130`):

| Classificação | Status interno | Coluna Status (Sheets) |
|---|---|---|
| `claro_nao` | `rejeitado` | **`Reprovado`** ← única exceção nova à regra TEMPORÁRIA |
| `zona_cinzenta` | `em_validacao` | `Pendente` (como hoje) |
| `claro_sim` | fluxo atual (veredito/pontuação) | `Pendente` (regra TEMPORÁRIA intacta) |

`claro_nao` **vence** o veredito de pontuação. As demais linhas ficam como hoje.

⚠️ **Não mexer no enum de `projetos.status`** (`rascunho|em_validacao|validado|rejeitado|aprovado`): trocar o
`CHECK` exigiria **rebuild da tabela**. O discriminador real da reprovação é a coluna nova
`projetos.classificacao_avaliacao`; `rejeitado` segue significando "não aprovado". Ajustar o rótulo no
**Investigador** (`investigador.tsx:308`, hoje `rejeitado → 'Reenvio Pendente'`) para não chamar reprovado de
reenvio.

### T4 — Sync: 3 colunas (mapeadas por NOME)

`src/lib/google/sheets.ts` (`SHEET_COLUMNS`) + `src/lib/google/sync.ts`:

| Coluna | Quem escreve | Conteúdo |
|---|---|---|
| `Classificação` | sistema, **sempre** | `Claro sim — <justificativa>` (rótulos: Claro sim · Claro não · Zona cinzenta) |
| `Motivo Reprovado` | sistema (`claro_nao`) + triagem | motivo; `-` quando não se aplica |
| `Motivo Reenvio` | **só humano** (triagem) | o sistema **nunca** escreve — como `Diff Horas / Antes` |

- Escrita junto de Complexidade/Observações em `syncUpdateToGoogle` (mesma chamada **aguardada**).
- `reconciliarComplexidade` (cron de 1 min) passa a repor **Classificação** vazia também — mesma rede de
  segurança que já existe para a Complexidade perdida quando a análise em background é cancelada.
- Espelho no SQLite (padrão `complexidade`/`observacoes`, para resync e reconciliação):
  `classificacao_avaliacao`, `classificacao_justificativa`, `motivo_reprovacao` via `ALTER TABLE`.
- **Sync reverso:** nenhuma das 3 entra em `SAFE_UPDATE_FIELDS`. `Motivo Reenvio` vive só na planilha;
  `Classificação`/`Motivo Reprovado` são regravadas pelo sistema na próxima submissão/resync (edição manual
  dessas duas é sobrescrita — **documentar na spec**).
- ⚠️ **PRIMEIRO passo da implementação:** confirmar a grafia **exata** dos 3 cabeçalhos nas abas `GoDocs`
  **e** `STAGING`. Nome que não bate = coluna **ignorada com aviso**, silenciosamente. (Já aconteceu de a
  coluna "Status" estar em índices diferentes nas duas abas — o mapeamento por nome absorveu.)

### T5 — `/dashboard` (triagem): motivo na mão

`src/lib/dashboard-admin.functions.ts` + `src/routes/_authenticated/dashboard/projeto-detalhe-dialog.tsx`:
- `COLUNAS_ESCRITAS` += `Motivo Reenvio`, `Motivo Reprovado`.
- No modal de status: escolher **`Reenvio Pendente`** abre textarea **"Motivo do reenvio"** → grava em
  `Motivo Reenvio` (ex.: _"projeto parado, em manutenção; reenviar com os fixes"_). Escolher **`Reprovado`**
  abre **"Motivo da reprovação"** → grava em `Motivo Reprovado`, sobrepondo o do analisador.
  **`Observações` continua reservada ao parecer** — é o texto que o disparo de e-mails do segmento `reenvio`
  já usa como motivo (não pode ser sequestrado).
- Ficha do projeto exibe `Classificação` + os 2 motivos.
- `Reprovado` **já existe** em `STATUS_GRAVAVEIS` e no `StatusBadge` (vieram no PR #214) — nada a criar.
- A auditoria `admin_status_log` já existe e passa a registrar o motivo.

### T6 — O autor precisa ver o porquê (julgamento do Claude, fácil de cortar)

O badge `Reprovado` chega a "Meus Projetos" pelo Sheets. Reprovar **sem mostrar o motivo** gera ticket de
suporte. Exibir `Motivo Reprovado` (e `Motivo Reenvio`) na tela read-only `/projeto/$id` e no card de "Meus
Projetos" — reusando `listarMeusProjetos`, que **já lê essas linhas** da planilha.
**Corte este T6 se o Luis preferir manter os motivos como campo interno de staff.**

### T7 — Régua em 1 página para o Rafa (o T2 da frente aprovada)

`docs/criterios-projeto-recorrencia-evidencia.md`: os 3 critérios, o que é resposta **vaga × aceitável**, e
**≥1 exemplo real que passa e ≥1 que não passa** por critério (tirados de `docs/analise-perguntas-agente.md`).
⚠️ O plano de 28/07 tinha um **gate humano** ("nenhuma linha de código encosta na régua antes do OK do Rafa").
Como agora vamos codar, a régua sai **no mesmo PR**, escrita para o Rafa validar em cima de algo concreto — e
**recomenda-se calibrar com ele antes do deploy em produção**, porque reprovar projeto é consequente e visível
ao autor.

## Fora de escopo (não exceder)

- **Barrar submissão no formulário** — segue **FORA, em definitivo**.
- **A1/A2** da frente [perguntas-agente-recorrencia-evidencia](perguntas-agente-recorrencia-evidencia.md)
  (gate da alocação rejeita "menos custo"; gates ignoram materialidade) — adjacentes e já planejados; a
  taxonomia de impacto do T3 é escrita de forma **reaproveitável** por eles, mas nenhum gate é tocado aqui.
- **Régua de complexidade** (`SPEC_COMPLEXIDADE_NIVEIS.md`) e **rota de projeto especial** — intocadas.
- **Encerrar a regra TEMPORÁRIA** do "Pendente" para todos — fica como está (D1).
- Não reescrever o `buildSavingPrompt` "de passagem" (ADR-028: captura-e-adia).

## Conformidade com as regras do repo

Worktree novo a partir de `origin/main` (regra 8 + 10 — a branch `docs/plano-loadings-dashboard-admin` é só de
docs e está **atrás** do `main`) · `npm run build:worker` + `worker.js` commitado (regra 1) · `npm run test`
(regra 2) · `prompt-registry.ts` + `prompt-inspector.tsx` atualizados (regra 3 — o prompt do analisador muda) ·
PT-BR com acentos (regra 4) · skill **`frontend-design`** antes de codar a UI da Etapa 2 e do modal (regra 11) ·
specs no mesmo PR (regra 12): `spec-docs/SPEC_CRITERIOS_PROJETO.md` novo + entrada em `SPEC_FEATURES_NOVAS.md` ·
**staging `edf400b4` antes de prod `674a3710`** (regra 13) · `CLAUDE.md` revisado antes do PR (regra 7 —
⚠️ já está em ~45k chars, acima do limite de 40k; entrar enxugando, não engordando).

## Critérios de aceitação

1. Uma submissão de "nuvem de palavras" (peça única, sem indicador, sem recorrência) sai com
   `Classificação = "Claro não — …"`, `Status = Reprovado` e `Motivo Reprovado` preenchido.
2. Um saving recorrente com indicador nomeado sai `Claro sim` e **Status `Pendente`** (nada mudou para ele).
3. Um ganho real sem fonte verificável sai `Zona cinzenta` + `Em validação`.
4. A coluna `Classificação` **nunca** fica vazia numa submissão nova/atualizada — inclusive quando o LLM falha
   (fallback determinístico coberto por teste).
5. Nenhum projeto é reprovado **sem** motivo (invariante testada em `normalizarClassificacao`).
6. Projeto **especial** nunca é reprovado automaticamente.
7. `Observações` não é sobrescrita pelo fluxo de motivo, e `Motivo Reenvio` nunca é escrita pelo sistema.
8. Contagem de perguntas por submissão **não piora** em relação ao baseline de 6,4 (a nova pergunta do agente
   é suprimida quando a doc já traz a magnitude).

## Verificação

1. `npm run test` — novos testes: `normalizarClassificacao` (todas as invariantes), derivação das 3 colunas,
   `MEMORIAL_ESQUELETO` (`tests/memorial-esqueleto.test.ts` já cobre estrutura), `validarEtapa2` com os campos
   novos, mapeamento das colunas no `sync`.
2. **Painel de testes in-app** (`src/lib/testes/`): prompt inspector para ler o bloco novo do analisador;
   simulação de chat para confirmar que "processo alterado" **não gera turno extra** quando a doc já traz a
   magnitude.
3. **Confirmar os 3 cabeçalhos** nas abas `GoDocs` e `STAGING` **antes** de qualquer deploy.
4. **Staging (`edf400b4`)** — as 3 submissões simuladas dos critérios de aceitação 1–3; conferir as 3 colunas
   na aba `STAGING` e que **nenhuma outra coluna mudou**.
5. `/dashboard` na staging: gravar `Reenvio Pendente` com motivo → confere `Motivo Reenvio` na planilha e
   `Observações` **intacta**.
6. Só então **prod (`674a3710`)** + `gh pr create` (conta **`LuisEduardo100`**, que tem WRITE; a
   `rpaiagogroup` é READ e falha).

## Blast-radius

**ALTO.** `src/routes/submeter.tsx` · `src/lib/submeter/{step2.tsx,constants.ts}` ·
`src/integrations/db/{schema.ts,client.server.ts,types.ts}` · `src/lib/agents/{analyzer.ts,memorial-format.ts,orchestrator.ts}` ·
`src/lib/chat.functions.ts` (`analisarProjetoFn` + `reconciliarComplexidade`) ·
`src/lib/google/{sheets.ts,sync.ts}` · `src/lib/dashboard-admin.functions.ts` ·
`src/routes/_authenticated/dashboard/projeto-detalhe-dialog.tsx` · `src/routes/_authenticated/investigador.tsx`
(rótulo) · `src/lib/testes/{prompt-registry.ts,prompt-inspector.tsx}` · `tests/`.
Dependentes: harness **E2E** (`scripts/e2e/`, valida A→AS — 3 colunas novas) · disparo de e-mails (segmento
`reenvio` lê `Status` + `Observações` **manuais** do Sheets) · sync reverso (as 3 fora de `SAFE_UPDATE_FIELDS`).
Invariantes tocados: `MEMORIAL_ESQUELETO` como fonte única · mapeamento do Sheets **por nome** · memorial sem
R$ visível ao usuário · `worker.js` commitado · staging antes de prod.
