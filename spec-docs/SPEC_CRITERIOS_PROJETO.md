# SPEC — Critério de projeto: perguntas-chave, classificação da avaliação e reprovação com motivo

> **Documento de planejamento/decisão.** Decisões fechadas com o Luis em **2026-07-29**.
> Plano de execução: [`docs/plans/criterios-projeto-classificacao.md`](../docs/plans/criterios-projeto-classificacao.md).
> Régua para a gestão: [`docs/criterios-projeto-recorrencia-evidencia.md`](../docs/criterios-projeto-recorrencia-evidencia.md).
> Status: ✅ **implementado** (código + testes + build) · ⏳ validação em staging → prod · ⏳ **régua a
> calibrar com o Rafa antes de produção** (reprovar projeto é visível ao autor).

## 1. Problema

A gestão (Rafa) apertou o critério de projeto depois de submissões que não deveriam ter entrado — o
caso-símbolo é uma **nuvem de palavras** gerada uma vez para uma apresentação. A régua dele tem 3
critérios: **recorrência**, **contrafactual** e **rastreabilidade**; o impacto **não precisa ser receita**.

O sistema não colhia rastreabilidade nem contrafactual de forma estruturada, e o analisador só decidia
"aprovado / rejeitado" **por pontuação de qualidade da documentação** — não existia juízo de
**elegibilidade** ("isto é projeto?"). Um artefato de uso único, bem documentado, era aprovado.

## 2. Decisões fechadas (NÃO "corrigir" por engano)

- **D1 — `claro_nao` → `Reprovado` é a ÚNICA exceção à regra TEMPORÁRIA do "Pendente".** A regra do
  `CLAUDE.md` (gravar sempre "Pendente" na coluna Status) **permanece** para todo o resto — inclusive
  aprovados e zona cinzenta. Não encerrar a regra TEMPORÁRIA por conta desta feature.
- **D2 — O analisador decide; o humano sobrepõe** no `/dashboard`. Zona cinzenta → `em_validacao`.
- **D3 — A classificação é SEMPRE explicada**, qualquer que seja o resultado (D4 do Luis: _"é bom o agente
  explicar bem explicado o porquê da classificação, independente de qual for"_). A coluna `Classificação`
  nunca fica vazia — há fallback determinístico quando o LLM não devolve texto.
- **D4 — Barrar submissão no formulário continua FORA, em definitivo.** A reprovação é **pós-envio**.
  As perguntas da Etapa 2 são de resposta **obrigatória**, mas **nenhuma resposta barra** — o que a pessoa
  responde vira sinal para o analisador, não trava.
- **D5 — Onde perguntar (REVISADO 29/07/2026, pós-staging).** Só o **contrafactual** fica no formulário
  (Etapa 2); **ponteiro movido + onde verificar saíram do form e passaram para o AGENTE**, junto de "que
  processo mudou e quanto". Motivo: rastreabilidade não se resolve com checkbox — o racional ("moveu de
  fato um ponteiro? onde isso se confere?") precisa ser construído **junto com a pessoa**, argumentando.
  ⚠️ Não reintroduzir os cards de ponteiro na Etapa 2.
- **D5b — "Quem reclama" é seleção, não texto livre (29/07/2026).** Quem sentiria falta é escolhido na
  **Team Guide** (mesma fonte do autocomplete de participantes da Etapa 1), com filtro **dinâmico**:
  por **pessoa** (autocomplete nome/e-mail) **ou** por **time/área** inteiro (`GET /api/areas`) — quando o
  impacto é do time todo, não se marca pessoa por pessoa. Trocar o tipo limpa a lista. Só o "o que piora"
  segue texto livre.
- **D6 — 3 colunas novas na planilha**, criadas à mão pelo Luis nas abas `GoDocs` **e** `STAGING`:
  `Motivo Reenvio` (**só humano** — o sistema NUNCA escreve, como as colunas de Diff) ·
  `Motivo Reprovado` (sistema + triagem) · `Classificação` (sistema, sempre com texto).
- **D7 — `Observações` continua reservada ao parecer.** Os motivos vão em coluna PRÓPRIA. `Observações` é
  o texto que o **disparo de e-mails** do segmento `reenvio` usa como motivo — sequestrá-la quebraria o
  e-mail (ver `SPEC_DISPARO_EMAILS.md`).
- **D8 — Não mexer no `CHECK` de `projetos.status`** (`rascunho|em_validacao|validado|rejeitado|aprovado`):
  trocar exigiria rebuild da tabela. O discriminador real da reprovação é a coluna nova
  `projetos.classificacao_avaliacao`; `rejeitado` segue significando "não aprovado".
- **D9 — Os guards da normalização agem só sobre `claro_nao`.** Especial e materialidade alta impedem a
  **reprovação automática**; NÃO rebaixam um `claro_sim` legítimo (o gate de materialidade continua agindo
  no **status**, não na régua de elegibilidade).
- **D10 — O autor vê o motivo** (T6, confirmado pelo Luis): reprovar sem mostrar o porquê gera ticket de
  suporte. Motivo aparece no card de "Meus Projetos" e na tela read-only `/projeto/$id`.

## 3. Onde aterrissou

### 3.1 Etapa 2 — contrafactual (pergunta determinística, padrão `usa_ai_proxy`)

| Pergunta | Campo | Coluna SQLite |
|---|---|---|
| "Se desligar isso hoje, quem reclama?" (toggle **Pessoas específicas** / **Um time/área inteiro** → chips) | `form.contrafactualAfetadosTipo` + `form.contrafactualAfetados` | `contrafactual_afetados` (`"pessoa:a@x;b@y"` \| `"time:Fiscal;CX"`) |
| "E o que piora?" (texto livre, ≥15 caracteres) | `form.contrafactualReclamacao` | `contrafactual_reclamacao` |

- UI: `AfetadosInput` (`submeter/form-components.tsx`) em `step2.tsx` · validação pura em `validarEtapa2`
  (`submeter/constants.ts`) · serialização pura `serializarAfetados`/`desserializarAfetados` (round-trip
  testado; valor legado/sem prefixo → `pessoa` + lista vazia, nunca derruba a tela).
- Fontes: pessoas de `GET /api/participantes/sugestoes` (hook `useSugestoesParticipantes`, **cache de
  módulo** — não refaz o fetch da Etapa 1) · times de `GET /api/areas` (`areas-sugestoes.ts`). Falha em
  qualquer uma → o campo segue usável (o modo pessoa aceita e-mail digitado).
- **Reuso:** o posicionamento do dropdown por portal foi extraído para o hook `useDropdownAnchor` e agora
  serve ao autocomplete da Etapa 1 **e** ao da Etapa 2 (a lógica era a mesma, ~40 linhas duplicadas).
- ⚠️ **`ponteiro_movido` / `ponteiro_evidencia` são colunas LEGADO**: existem pelos projetos submetidos
  enquanto a pergunta ficava no formulário (janela de staging). **Nada as escreve mais**; o analisador as
  lê só quando vierem preenchidas.
- As perguntas **não** entram em `camposMinimosDocProntos` — o processamento da doc em background continua
  disparando assim que o arquivo é anexado.
- `CardCheckboxGroup` (extraído da Etapa 2.5) permanece como componente canônico de "opção com descrição".

### 3.2 Agente — seções "Processo alterado" e "Ponteiro movido e onde verificar"

`MEMORIAL_ESQUELETO` (`agents/memorial-format.ts`, **fonte única**) ganhou a seção **obrigatória nos 3
modos** (`saving`, `custo_evitado`, `receita`) + código `1.3` em `TITULOS_MEMORIAL`. Os prompts
(`orchestrator.ts`) trazem a instrução **anti-redundância**: se a documentação aprovada já descreve o
processo **e** a magnitude, o agente escreve a seção **sem perguntar**; só pergunta quando falta a
magnitude, no **máximo 1 pergunta**. (Baseline de 6,4 perguntas/submissão não deve piorar —
`docs/analise-perguntas-agente.md`.)

**Ponteiro movido e onde verificar** (`1.4`, obrigatória nos 3 modos) é a **RASTREABILIDADE**, agora
conduzida pelo agente: pergunta 1× com `type:"options"` qual ponteiro moveu (custo · receita · KPI da área
— erro, retrabalho, prazo/SLA, fraude/risco) e 1× **onde alguém abre e confere** o número (relatório,
painel, sistema ou base **nomeados**; "no sistema" é vago). O agente **argumenta junto** e, se a pessoa não
souber onde conferir, **registra exatamente isso** e SEGUE — nunca inventa fonte nem trava (sinal legítimo
para a triagem: puxa para `zona_cinzenta`, **não** para reprovação automática). Anti-redundância e
anti-loop iguais aos da seção `1.3`: se a doc aprovada já traz ponteiro + fonte, escreve sem perguntar.

### 3.2c Gate determinístico do `[1.3]`/`[1.4]` (D11 — implementado 2026-07-30)

O prompt sozinho **não segurou** (evidência da staging, D11). O backend agora confere as duas seções
**antes de liberar o preview**, nas duas famílias de fase financeira (`saving`/`saving_preview` — inclusive
custo evitado puro — e `receita`/`receita_preview`):

- **Extração** (`memorial-format.ts`): `extrairProcessoAlterado` e `extrairPonteiroMovido`, sobre o memorial
  já normalizado. ⚠️ O `[1.4]` casa por **PREFIXO** (`"ponteiro movido"`), não por título exato: o agente
  gravou a metade da seção sob o rótulo curto `**Ponteiro movido:**`, e casar exato devolveria `null` —
  a meia-seção ficaria **indistinguível da ausência total**, que é o que se quer julgar.
- **Predicados puros** (`orchestrator.ts`): `secaoProcessoVaga` (ausente ou < `MIN_SECAO_CRITERIO` = 60
  chars) e `secaoPonteiroVaga` (ausente, curta, ou **sem nenhuma pista de onde conferir**).
  ⚠️ **Decisão fechada:** o gate **NÃO** julga se a fonte foi bem NOMEADA ("no sistema" × "no Metabase") —
  a regex distinguiria mal e puniria quem respondeu honestamente "não sei onde conferir", que é
  comportamento CORRETO (ponto 3 do roteiro, aprovado em staging: vira zona cinzenta, nunca reprovação
  automática). Essa camada fica com o prompt e o analisador.
- **Estado** `criterio_secoes` (`null` → `'pendente'` → `'ok'`) em **`SavingColetado` E `ReceitaColetada`**,
  backend-only, re-mesclado a cada turno (`enviarMensagem`) — sem o re-merge do lado da RECEITA o `'ok'` se
  perderia e a pergunta voltaria: o **loop** que a lição do split carga×escala mandou nunca repetir.
- **ANTI-LOOP:** pergunta **UMA vez só**. O turno de resposta marca `'ok'` aconteça o que acontecer e injeta
  nudge `[SISTEMA]` com o texto do usuário para o LLM escrever a(s) seção(ões) faltante(s).
- Roda **por último**, depois de todos os gates de saving (jornada → teto → alocação) e só quando o
  resultado ainda é `preview`/`complete` — um gate por turno.

### 3.2b Contexto do formulário → prompts (`buildRespostasFormulario`)

O `[1.4]` nasceu **cego ao contrafactual**: `contrafactual_afetados`/`contrafactual_reclamacao` eram
gravados e lidos **só pelo analisador** — não existiam em `ProjetoContexto`, então o agente perguntava
o ponteiro sem saber o que a pessoa respondera duas telas antes. Causa de fundo: o contexto do
formulário chegava aos prompts por **whitelist manual**, e só a fase de doc injetava a descrição breve.

- **`buildRespostasFormulario(ctx)`** (`orchestrator.ts`, pura) = **FONTE ÚNICA** do bloco "RESPOSTAS
  QUE O AUTOR JÁ DEU NO FORMULÁRIO", injetado nos **4** prompts (doc · saving · receita · custo
  evitado). Renderiza descrição breve, contrafactual (quem + o que piora), escopo/serviço externo e AI
  Proxy, com as regras "nunca pergunte de novo" e "aponte contradição em vez de escolher em silêncio".
  Vazio → bloco omitido inteiro. ⚠️ **Campo novo no formulário → renderize AQUI** e nomeie em
  `ProjetoContexto` + `getProjetoContexto` + `getProjetoContextoData`; não voltar a injetar campo solto
  em um prompt (foi assim que o contrafactual ficou órfão).
- **`buildDetalhesAprovados(ctx, coletado, resumo)`** — fonte única do bloco que as 3 fases financeiras
  herdam da doc (era copiado literalmente nas três). Passou a incluir `dependencias`,
  `configurar_antes` e `atencao`: são onde os **sistemas nomeados** (Metabase, Protheus, base X)
  aparecem — matéria-prima do "onde alguém confere" do `[1.4]`.
- **`[1.4]` passou a partir do que já existe:** (a) deduz o ponteiro do contrafactual e **não pergunta**
  quando dá para deduzir; (b) **propõe** a fonte que a doc já nomeia em vez de perguntar em aberto.
- ⚠️ Dois canais chegam ao agente e **não** se confundem: o financeiro (`SavingColetado`/
  `ReceitaColetada`, parâmetro próprio, sempre completo) e o de contexto (`ProjetoContexto`, a
  whitelist). O defeito vinha de campos "antes do chat" divididos entre os dois por acidente.
- Testes: `tests/contexto-formulario-agente.test.ts` (13) — as 4 fases recebem o contrafactual, rótulo
  pessoa×time, valor legado sem prefixo não derruba, seções vazias não viram `"null"`.

### 3.3 Analisador — classificação em 3 níveis

- Bloco de prompt **"RÉGUA DE CRITÉRIO DE PROJETO"** (`agents/analyzer.ts`): os 3 critérios, a taxonomia de
  impacto (horas · custo · erro · retrabalho · fraude/risco · prazo · receita), o aviso de que
  **simplicidade não reprova** e os exemplos-âncora (nuvem de palavras, cronômetro → `claro_nao`).
- Saída JSON nova: `classificacao_avaliacao` · `classificacao_justificativa` (SEMPRE) ·
  `motivo_reprovacao` (só `claro_nao`).
- **`normalizarClassificacao()`** — pura, espelho de `normalizarComplexidade`. Rebaixa para
  `zona_cinzenta` quando: (1) reprovação **sem motivo**; (2) projeto **especial**; (3) materialidade
  **> R$ 5k/mês**; (4) valor ausente/inválido. Justificativa vazia → **fallback determinístico**.
- **`decidirStatusSubmissao()`** — pura: decide o status interno **e** o rótulo da coluna Status de uma só
  vez (não duplicar a precedência em dois lugares — foi assim que os dois já divergiram).

| Classificação | Status interno | Coluna Status |
|---|---|---|
| `claro_nao` | `rejeitado` | **`Reprovado`** ← única exceção nova |
| `zona_cinzenta` | `em_validacao` | `Pendente` |
| `claro_sim` | fluxo atual (veredito/materialidade) | `Pendente` |

### 3.4 Sync + reconciliação

- `SHEET_COLUMNS` += as 3 colunas (mapeamento **por NOME** — grafia conferida nas duas abas em 29/07/2026:
  `AV Motivo Reenvio` · `AW Motivo Reprovado` · `AX Classificação`, acentos precompostos).
- `derivarClassificacaoSheet(classificacao, justificativa)` monta `"Claro não — <justificativa>"`; ausente
  → `"—"`. `syncSubmitToGoogle` grava as 2 do sistema no append/update; `syncUpdateToGoogle` as regrava
  quando o analisador conclui (parâmetros opcionais: `undefined` = não toca a célula).
- **`Motivo Reenvio` nunca é escrita pelo sync** — só pelo `/dashboard`.
- `reconciliarComplexidade` (cron de 1 min) passa a repor **`Classificação`/`Motivo Reprovado`** vazias,
  do espelho SQLite — mesma rede de segurança da Complexidade (a análise em background pode ser cancelada
  antes do sync).
- **Sync reverso:** nenhuma das 3 entra em `SAFE_UPDATE_FIELDS`. `Motivo Reenvio` vive **só** na planilha;
  `Classificação`/`Motivo Reprovado` são regravadas pelo sistema na próxima submissão/resync — **edição
  manual dessas duas é sobrescrita** (comportamento aceito).

### 3.5 `/dashboard` (triagem) e a visão do autor

- `COLUNAS_ESCRITAS` += `Motivo Reenvio`, `Motivo Reprovado`. O modal abre o campo de motivo conforme o
  status escolhido (`Reenvio Pendente` → "Motivo do reenvio"; `Reprovado` → "Motivo da reprovação",
  sobrepondo o do analisador). `Observações` **intacta**. A auditoria `admin_status_log` registra o motivo
  quando não há parecer.
- Ficha do projeto exibe `Classificação` + os 2 motivos.
- **Autor:** `mapItem` devolve `motivo_reprovado`/`motivo_reenvio`; o card de "Meus Projetos" ganhou o
  aviso **"Projeto reprovado"** (cinza-ardósia, ícone `Ban` — estado nunca só por cor) com o motivo, e a
  tela `/projeto/$id` mostra o bloco de motivo. Na LISTA os motivos vêm da planilha (incluem a
  sobreposição da triagem); no DETALHE, do espelho SQLite (uma sobreposição manual aparece lá após o
  próximo resync).

## 4. Testes

- `tests/criterios-classificacao.test.ts` — invariantes de `normalizarClassificacao` (nunca reprova sem
  motivo · especial · materialidade · valor inválido · fallback da justificativa) e a precedência de
  `decidirStatusSubmissao` (inclui um varredor "nunca devolve Reprovado para quem não é `claro_nao`").
- `tests/criterios-projeto.test.ts` — colunas no `SHEET_COLUMNS`, `derivarClassificacaoSheet`, a seção
  "Processo alterado" no esqueleto e os motivos em `mapItem`.
- `tests/validacao-etapa2.test.ts` — as 3 perguntas novas, com o caso central: **"Nenhum / ainda não sei"
  passa**.
- `tests/dashboard-admin.test.ts` — motivos em coluna própria **sem tocar** `Observações`/`Atualizado Em`.
- `tests/gate-criterio-secoes.test.ts` — o gate do `[1.3]`/`[1.4]`: extração das seções (incl. a
  **meia-seção** do custo evitado puro e o memorial legado com códigos `[1.3]`/`[1.4]`), os predicados
  (ausente/curta/sem pista → bloqueia; ponteiro + fonte nomeada → passa) e o caso que **não pode** bloquear:
  o "não sei onde conferir" registrado honestamente.

## 5. Pendências

1. **Calibrar a régua com o Rafa** antes do deploy em produção (fronteira `claro_nao` × `zona_cinzenta`).
2. Validar em **staging (`edf400b4`)** pelo roteiro de 8 cenários —
   [`docs/roteiro-validacao-criterios.md`](../docs/roteiro-validacao-criterios.md), que também define o
   que conta como "o agente acerta sem trava" e a regra de decisão do gate do `[1.4]` (pendência 3).
   Conferir que **nenhuma outra coluna mudou**.
3. **Harness E2E** (`scripts/e2e/`) valida colunas A→AS — as 3 novas ainda não estão nos asserts.
4. Frente **paralela** [`perguntas-agente-recorrencia-evidencia`](../docs/plans/perguntas-agente-recorrencia-evidencia.md):
   **A1** (o gate da alocação precisa aceitar "menos custo" — a taxonomia de impacto escrita aqui é
   reaproveitável) e **A2** (materialidade nos gates) seguem pendentes de código.

## D11 — Gate determinístico do `[1.3]`/`[1.4]`: **DECIDIDO — fazer** (2026-07-29)

A **pendência 3** ("o prompt segura sozinho?") foi resolvida **com medição**, não por opinião: 7 conversas
na staging (runs `stg-ctx-01`/`stg-ctx-02`) mostraram o agente acertando os comportamentos **3, 4 e 5**
(aceita "não sei" **sem inventar fonte**; não repete; não pergunta o que já sabe — **1,8–2,7 perguntas por
submissão** contra a baseline de 6,4) e **falhando os 1 e 2**: no modo **receita** o memorial fecha sem a
seção `Processo alterado` (as 2 rodadas) e sem `Ponteiro movido e onde verificar` (1 rodada); no
**custo evitado puro** o `[1.4]` sai pela metade (`**Ponteiro movido:** custo externo eliminado.`, sem o
"onde verificar") nas 2 rodadas. Pela régua do roteiro → **gate**, versão barata (extrai antes do preview;
ausente/vaga → bloqueia e pergunta **1× só**, depois segue; clona `alocacao_ganhos`). Detalhe e evidência:
[`docs/roteiro-validacao-criterios.md`](../docs/roteiro-validacao-criterios.md) · tarefa **T8** em
[`docs/plans/criterios-projeto-classificacao.md`](../docs/plans/criterios-projeto-classificacao.md).

⚠️ **O que essa medição NÃO cobriu:** o lado do **analisador** (`Classificação` / `Reprovado` /
`Motivo Reprovado`). Nos 7 projetos a coluna saiu `—` porque a análise **morre antes de gravar** na staging
(timeout de 25s no proxy → fallback → `waitUntil` cancelado), com a `Complexidade` vazia junto — **não é
bug do código de classificação**, é o modo de falha já conhecido, e na staging o cron `reanalisar-pendentes`
**não dispara**. Os critérios de aceitação **1 a 4** do plano continuam **sem evidência**.

**Destravado em 2026-07-30:** rota **`POST /api/admin/reanalisar-pendentes`** (`requireAdmin`) — o MESMO
trabalho do cron `reanalisar-pendentes`, sob demanda e sem o header `x-godeploy-cron`. Repõe
`Complexidade`/`Classificação` que a análise em background não gravou, ou re-roda o analisador de quem
nunca foi analisado (`reconciliarComplexidade`, idempotente). É o que torna o lado do analisador
**validável na staging**; em produção vira também uma alavanca manual. ⚠️ **A causa-raiz continua aberta** —
a análise ainda pode morrer no `waitUntil` (timeout de 25s do proxy + fallback). As opções desenhadas e
**não** implementadas: (a) aterrissar a análise no próprio request do submit (custo: o usuário espera);
(b) o FRONT disparar `/api/chat/analisar` logo após o submit, no padrão do disparo de e-mails em lotes
(custo: risco de análise duplicada, precisaria de guarda de idempotência).
