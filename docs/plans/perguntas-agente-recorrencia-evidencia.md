# Plano — Perguntas do agente: cortar redundância e coletar recorrência / contrafactual / rastreabilidade

**Status:** rascunho

**Objetivo:** Medir, com conversas reais, onde o agente repete pergunta e quantos turnos custa cada
submissão; propor a régua dos 3 critérios do Rafa (recorrência · contrafactual · rastreabilidade) para
aprovação humana; e desenhar a reescrita que embute esses 3 critérios **reduzindo** o total de perguntas.
Esta fatia **não altera prompt nem código** — entrega diagnóstico, régua e desenho.

## Contexto — por que não é "gate que barra"

A ideia inicial era um agente-porteiro que bloqueasse submissões fora de critério (o caso da nuvem de
palavras). Descartada na conversa com o Rafa: **os critérios ainda não estão definidos**, e barrar sem
critério fechado troca um problema (submissão fraca) por um pior (projeto válido barrado). O alvo passou a
ser **a qualidade e a economia das perguntas que o agente já faz** — conduzir a pessoa à reflexão em vez de
só arrancar dado —, porque já há reclamação recorrente de que o agente **repete a mesma pergunta com outras
palavras**.

### Diagnóstico da exploração (por que ele repete — 4 causas estruturais no código)

1. **Empilhamento de diretivas que mandam perguntar.** `buildSavingPrompt` (`orchestrator.ts:691-1087`,
   ~400 linhas) tem 9 blocos independentes que ordenam "questione / confirme / exija detalhamento":
   composição das horas, plausibilidade entre cargos, plausibilidade por pessoa, validar o "depois",
   reconciliação de ambíguo, materialidade, multiplicadores, sincronia linhas↔texto, ganho real×projetado.
   Cada um nasceu de um caso real e **nenhum foi fundido** com os anteriores. Não há ordem única nem
   orçamento de perguntas.
2. **Não existe registro do que já foi respondido.** A única defesa é prosa —
   `orchestrator.ts:979`: _"NÃO RE-PERGUNTE O QUE JÁ FOI RESPONDIDO… esse vai-e-volta é a principal causa de
   o usuário sentir que você perdeu o contexto"_. O estado `saving` guarda números, não "composição já
   coletada" / "depois já validado".
3. **Quatro gates determinísticos em fila no fim.** jornada → teto por pessoa → split carga/escala →
   alocação de ganhos (`chat.functions.ts`): até 4 perguntas do SISTEMA em sequência, logo depois das do
   agente. Um deles (split) já teve de ser desarmado por gerar loop na edição (jul/2026).
4. **Sobreposição entre etapas.** A Etapa 2 já coleta cargos/horas/custos; a fase doc coleta trigger e
   frequência em `execucao`; a fase saving pergunta frequência e volume **de novo**.

### Onde os 3 critérios do Rafa encaixam (2 de 3 substituem pergunta existente)

| Critério | Casa hoje | Mudança pretendida |
|---|---|---|
| **Recorrência** — roda de novo sem alguém pedir? quantas vezes? | `execucao` (fase doc) já pede o trigger, mas aceita "manual"/"quando precisa" | Mesma pergunta, régua mais dura: recorrência real (roda sozinho? quantas vezes por período?). Nenhuma pergunta nova |
| **Contrafactual** — se desligar amanhã, o que piora e onde se vê | ponto `[2.4]` "o que mudou após a automação" (só ≥44h) + portão ganho real×projetado | Vira a **formulação padrão** do [2.4] (é a mesma pergunta pelo outro lado, e muito mais fácil de responder). Nenhuma pergunta nova |
| **Rastreabilidade** — qual indicador, em qual relatório/sistema/base | **não existe** | Pergunta **nova** — a de maior retorno: uma fonte verificável vale mais que a quebra estimada de horas arrancada a fórceps hoje |

Meta desta frente: **entrar com os 3 critérios saindo com menos perguntas no total.**

### Decisões tomadas com o Luis (28/07/2026)

- **D1** — Medir antes de reescrever: sem baseline empírico a reescrita é palpite e corre o risco de
  derrubar um gate que existe por causa de um caso real.
- **D2** — A régua dos critérios é **proposta por nós** em 1 página e **aprovada pelo Rafa**; o código só
  encosta nos critérios depois do OK. Nada bloqueia submissão nesta frente, então a régua pode ser afinada
  sem risco.
- **D3** — A resposta de rastreabilidade vira **seção própria do memorial + coluna no Sheets** (padrão já
  usado: `extrairAlocacaoGanhos` → AK; `derivarJustificativaCargaEscala` → AS). ⚠️ Depende de criar a coluna
  no cabeçalho das abas **GoDocs** e **STAGING** (mesma pendência que hoje bloqueia Participantes 2 /
  Contribuidor).

### Medição já feita nesta sessão (28/07/2026) — o T1 saiu adiantado

O Luis liberou o `E2E_COOKIE` durante o planejamento, então a medição do T1 **foi executada**: 24
submissões reais de prod (25→28/07), em [`docs/analise-perguntas-agente.md`](../analise-perguntas-agente.md).
Baseline: **154 perguntas / 24 conversas = 6,4 por submissão**, máx. 16; **62% na fase saving**; **34% das
perguntas vêm dos 4 gates**; **13 perguntas depois do preview**, concentradas em 4 conversas.

O diagnóstico de leitura de código foi **confirmado em 4 dos 6 pontos** e ganhou dois achados que a
leitura não pegava — e um deles **reordena a prioridade do plano**:

- **A1 (novo, o mais grave):** o gate da alocação de ganhos **só aceita ganho na forma "mais saída"** e
  rejeita **"mesma saída, menos custo"**. Dois casos independentes: `e57b287a` (redução de **3 auxiliares**
  → 5 reperguntas) e `60b97477` (corte de **hora extra** → 4 reperguntas). Causa em duas camadas:
  `orchestrator.ts:873/883` transforma "entregar A MAIS" em gate, e o juiz do
  `buildSavingPreviewPrompt` manda recusar **"mesmo que o usuário diga 'aprovado'"** — **sem contador
  anti-loop** (o anti-loop existe só no gate determinístico, `chat.functions.ts:899`). É **exatamente** o
  ponto 4 do Rafa ("impacto não precisa ser receita — horas, erro, retrabalho, fraude, risco, prazo")
  faltando no código.
- **A2 (novo):** os gates **não escalam com materialidade** e contradizem a regra que já está no mesmo
  prompt (`orchestrator.ts:1034`, "para ganhos pequenos NÃO burocratize"): `aplicaConfirmacaoBaseHoras`
  (`:462`) e `aplicaSplitCargaEscala` (`:480`) disparam com qualquer `horas_antes > 0`. Caso-símbolo:
  `897df986` economiza **0,05h/mês (3 minutos)** e recebe o gate das 220h/fim de semana.
- **A3:** recorrência (critério 1 do Rafa) hoje custa **3 turnos** e ainda não conclui se roda sozinho
  (`62b60c15`) → precisa de melhor formulação, não de pergunta nova.
- **A4:** "usa IA" + detalhamento = 2 turnos em quase toda conversa, **mesmo quando o extrator já
  inferiu** — e o preview da doc é aprovado logo depois, onde a confirmação poderia viver.

**Consequência para o plano:** a correção do **A1** vira a prioridade — é a que resolve a reclamação de
redundância no pior caso, e é o critério 4 do Rafa virando código. **A2** é o segundo maior ganho e não
depende de régua nenhuma (é só respeitar a materialidade que o prompt já manda respeitar).

### Tarefas

- **T1 — Inventário + baseline empírico das perguntas** — ✅ **FEITO nesta sessão**
  (`docs/analise-perguntas-agente.md`). O que **resta** do T1, e é opcional: medir a aba
  **Abandonados** (rascunho inativo > 1h) para saber se quem desiste recebeu mais perguntas que quem
  concluiu — é o número que transforma "o agente é chato" em custo medido. Fica como T1b.
  _(o texto original do T1, mantido abaixo como registro do método)_
  Extrair **15-25 conversas reais de produção** e etiquetar pergunta por pergunta: o que foi perguntado, em
  que fase, se a informação **já estava disponível** (form da Etapa 1/2, extrator, turno anterior) e quantos
  turnos até cada preview. Sai `docs/analise-perguntas-agente.md` com (a) o **inventário único de todas as
  perguntas do sistema** (form + doc + gates + saving/receita) com origem e condição de disparo, e (b) as
  métricas de baseline: turnos até o preview de doc e de impacto, perguntas por fase, duplicatas
  confirmadas, e quantas caem em cada uma das 4 causas acima.
  _(guarda: cada duplicata da tabela cita `arquivo:linha` das DUAS origens; o baseline é reprodutível pelo
  script/consulta registrado no próprio doc)_
  ⚠️ **Fonte de dados — dependência:** o `godocs.db` local tem 30 conversas, mas são rascunhos de teste
  (`asdasda`, `N8n audit`, até 24/06) → **não serve**. Precisa de prod, via Investigador
  (`investigador.functions.ts` já devolve `chat_messages` enriquecidas e `snapshot_chat` por versão), e o
  **`E2E_COOKIE` do `.env` está expirado** (já barrou a sessão de 28/07). Caminhos, em ordem: (a) Luis renova
  o `E2E_COOKIE`; (b) Luis exporta pelo navegador logado no painel; (c) fallback declarado — usar as
  conversas locais **só** para o inventário estrutural, marcando no doc que o baseline numérico ficou
  pendente. Não inventar número sem a fonte.

- **T2 — Proposta de régua dos 3 critérios, para o Rafa aprovar** (`docs/`).
  1 página, concreta e testável: o que conta como **recorrência** (e o que é peça única), o que conta como
  **contrafactual** respondido, o que conta como **evidência verificável** (relatório/sistema/base nomeados)
  e — o mais importante para calibração — **o que é resposta vaga e o que é aceitável**, com exemplos
  extraídos das conversas reais do T1, incluindo o caso da nuvem de palavras. Deixa explícito que impacto
  não precisa ser receita (horas, erro, retrabalho, fraude, risco, prazo) e que **projeto simples é bem-vindo
  desde que recorrente e verificável**, para a régua não virar filtro de complexidade.
  _(guarda: cada critério vem com ≥1 exemplo REAL que passa e ≥1 que não passa, tirados do T1 — régua sem
  exemplo real não é aprovável)_
  **Gate humano:** T3 pode ser desenhado em paralelo, mas nenhuma linha de código encosta na régua antes do
  OK do Rafa.

- **T3 — Desenho da reescrita (spec, ainda sem código).** ⚠️ **Reordenado pela medição:** os dois
  primeiros itens do desenho passam a ser **A1** (taxonomia de impacto aceita pelo gate da alocação — com
  as famílias do Rafa: menos horas, menos custo/headcount/hora extra, menos erro, menos retrabalho, menos
  fraude/risco, menos prazo — **e um contador anti-loop no juiz do preview**, que hoje não tem) e **A2**
  (limiar de materialidade nos predicados `aplicaConfirmacaoBaseHoras` e `aplicaSplitCargaEscala`, para
  um projeto de 3 minutos não levar o gate das 220h). Só depois vêm os itens estruturais abaixo.
  Com o T1 na mão, especificar: (a) **registro de "já respondido"** no estado — quais chaves, quem escreve,
  como é injetado no prompt como bloco proibitivo (o que hoje é só prosa); (b) **ordem única + orçamento de
  perguntas** por fase, substituindo os 9 blocos concorrentes — incluindo quais blocos **morrem**, quais
  **se fundem** e quais viram verificação silenciosa sem turno; (c) **fusão dos 4 gates** numa checagem final
  única (e o que fazer quando 2+ disparam juntos), preservando o motivo original de cada um; (d) onde as 3
  perguntas do Rafa entram e **qual pergunta cada uma substitui**; (e) a seção nova do memorial + coluna do
  Sheets da rastreabilidade, começando pelo `MEMORIAL_ESQUELETO` (fonte única — exigência do CLAUDE.md).
  _(guarda: para cada um dos 9 blocos e dos 4 gates, o desenho diz explicitamente "mantém / funde em X /
  morre porque Y" — nenhum pode ficar sem destino, e "morre" exige dizer qual caso real o originou e por que
  deixou de precisar de turno próprio)_

### Critérios de aceitação

1. ✅ `docs/analise-perguntas-agente.md` com inventário ancorado em `arquivo:linha` + baseline numérico
   (154 perguntas / 24 conversas / 6,4 de média) e os limites da amostra declarados.
2. ✅ Achados **provados** com caso real citado (`e57b287a`, `60b97477`, `897df986`, `62b60c15`), não alegados.
3. `docs/criterios-projeto-recorrencia-evidencia.md` (T2) está pronto para ir ao Rafa: 3 critérios, régua de
   vago × aceitável, e exemplos reais de aprovado e reprovado para cada um.
4. O desenho do T3 dá destino explícito a **todos** os 9 blocos e **todos** os 4 gates, e mostra a conta:
   quantas perguntas entram, quantas saem, saldo esperado em turnos.
5. Nenhum arquivo fora de `docs/` foi alterado nesta fatia.

### Fronteiras (não exceder)

- **Nada de código:** nenhum prompt, gate, estado, coluna de Sheets ou teste é alterado aqui. A
  implementação é a fatia seguinte, em sessão de código à parte, com o T2 já aprovado pelo Rafa.
- **Nada que barre submissão.** Gate de elegibilidade (bloquear "isto não é projeto") está **fora de escopo**
  e permanece fora até os critérios estarem fechados e calibrados com dados. Esta frente só melhora pergunta.
- **Não mexer na régua de complexidade** (`SPEC_COMPLEXIDADE_NIVEIS.md`) nem na rota de **projeto especial** —
  ela existe justamente para impacto real sem R$ mensurável e não pode ser atropelada pelos novos critérios.
- Não reescrever o `buildSavingPrompt` "de passagem" enquanto se mede (ADR-028: captura-e-adia).

### Blast-radius

**Desta fatia:** BAIXO — só `docs/**` (2 documentos novos + este plano) e leitura do banco.

**Da implementação que ela desenha (para dimensionar a fatia seguinte):** ALTO.
Arquivos: `src/lib/agents/orchestrator.ts` (`buildDocPrompt`, `buildSavingPrompt`,
`buildSavingCustoEvitadoPrompt`, `buildReceitaPrompt` + preds `aplica*`) · `src/lib/chat.functions.ts` (os 4
gates e o estado que eles mesclam a cada turno) · `src/lib/agents/memorial-format.ts`
(`MEMORIAL_ESQUELETO` primeiro) · `src/lib/agents/types.ts` (chaves novas de estado) ·
`src/lib/google/sheets.ts` + `sync.ts` (coluna de rastreabilidade, mapeada por NOME) ·
`src/lib/testes/prompt-registry.ts` + `prompt-inspector.tsx` (**regra 3** — prompt alterado exige atualizar
os dois) · `tests/` (memorial-esqueleto, prompts, sync).
Dependentes: analisador (`analyzer.ts` lê o memorial e tem critério `trigger_definido` que encosta em
recorrência) · `derivar*`/`extrair*` das colunas AK/AS · harness E2E (`scripts/e2e/`, valida A→AS).
Invariantes tocados: memorial sem R$ visível ao usuário · `linhas` como fonte de verdade das horas ·
`MEMORIAL_ESQUELETO` como fonte única das seções · mapeamento do Sheets por nome · `worker.js` commitado
(regra 1) · staging antes de prod (regra 13).
**Confiança: média.** O projeto **não tem `docs/INDEX.md` nem `docs/invariants.md`** (RF-35) — o
blast-radius acima saiu de leitura direta do código e do `CLAUDE.md`, não de índice mantido. A varredura
profunda de dependentes fica para o `/ggsd:code` da fatia de implementação.

### Reuso (RF-32/34) — o que se estende, não se recria

Sem registro de componentes canônicos no repo (não há `docs/INDEX.md`), o levantamento foi manual:
- **Coluna derivada do memorial:** estender o padrão `extrairAlocacaoGanhos` (AK) /
  `derivarJustificativaCargaEscala` (AS) — fatia a seção do memorial, sem coluna SQLite própria,
  re-extraída no resync. **Não** criar mecanismo novo de persistência.
- **Seções do memorial:** declarar no `MEMORIAL_ESQUELETO` (fonte única por modo) e renderizar via
  `descreverEsqueletoMemorial` — é a exigência explícita do CLAUDE.md ao adicionar seção obrigatória.
- **Gates:** reusar o padrão de predicado puro + estado (`aplicaConfirmacaoBaseHoras`,
  `aplicaSplitCargaEscala`, `aplicaGateAlocacaoGanhos`) e o vocabulário `null→pendente→reperguntado→ok`.
- **Criado do zero (com razão):** o **registro de "já respondido"** — hoje não existe nada equivalente
  (a defesa é prosa no prompt), e é justamente a peça que falta para matar a repetição.

### Pendências externas (não são código)

1. **Renovar o `E2E_COOKIE`** no `.env` (ou exportar as conversas pelo navegador logado) — sem isso o
   baseline do T1 fica pendente.
2. **Aprovação do Rafa** na régua do T2 antes de qualquer código tocar os critérios.
3. **Coluna nova no cabeçalho** das abas GoDocs + STAGING para a rastreabilidade (quando a implementação
   chegar) — soma-se à pendência já aberta de "Participantes 2" / "Contribuidor".
