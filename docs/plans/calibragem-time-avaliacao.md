# Plano — Calibragem do time de agentes de avaliação

**Status:** ✅ aprovado (Luis, 08/09/2026)

**Spec cristalizada:** `SPEC.md` §4 (RF-230 a RF-248) e §5 (INV-16, INV-17, INV-18).

**Objetivo:** fechar as três coisas que impedem o time de avaliação de melhorar sozinho: o raciocínio
que vem depois do número, a discordância humana que não vira lição, e a confiança que é o placar da
votação disfarçado de percentual.

### Ordem recomendada, e onde dá para parar

São **três fatias com deploy e PR próprios**, nesta ordem — cada uma fecha sozinha, e parar em
qualquer uma deixa o sistema coerente:

1. **(a) T1-T4** — ✅ **T1/T2/T3 EXECUTADAS em 08/09** (suíte 3724 verde, conformidade `diverge-baixa`,
   canário `tests/racional-primeiro.test.ts`). ⏳ **T4 pendente e é o que falta para a fatia FECHAR:** a
   run 10 exige **deploy na staging** — o harness `scripts/v2/classificar-paralelo.mts` faz POST numa rota
   HTTP com `E2E_COOKIE`, não roda local. Enquanto ela não roda, a inversão está travada por teste e **não
   medida**, e o critério de aceitação 1 (e a RF-232) segue sem cobertura.
   ⚠️ **Nada de instrução nova entrou nos 8 prompts, de propósito** — uma linha "⚠️ ORDEM OBRIGATÓRIA DAS
   CHAVES" chegou a ser escrita e foi **retirada**: a T4 é uma MEDIÇÃO contra a run 9, e texto novo faria a
   run 10 medir duas mudanças ao mesmo tempo. Se alguém quiser aquele reforço no prompt, é **rodada
   separada**, depois de a inversão estar medida.
2. **(b) T5-T9** — abre a coleta. Quanto mais cedo entrar, mais lições existem quando a (c) for medir,
   porque o marco da concordância implícita começa a contar no deploy dela (D2).
3. **(c) T10-T17** — blast ALTO e a maior. ⚠️ **Sozinha ela já é um plano** (8 tarefas, 3 tabelas na
   vizinhança, o enum de veredito e 17+ asserções de teste em volta). Se a sessão de código ficar
   grande, **fatie a (c) em duas**: `T10-T13` (medir e exibir honesto) e `T14-T17` (piso, reprovação e
   canários), que é exatamente a fronteira entre "parar de mentir sobre a confiança" e "passar a
   reprovar".

---

## Por que esta sessão existe (a investigação, com evidência)

Quatro achados medidos em 08/09/2026, todos com arquivo e linha.

### A1 — A confiança da mesa é o placar da votação, não uma medida

`agregarJulgamentos` (`src/lib/agents/agregador-avaliacao.ts:285-287`) faz
`confianca = concordanciaDirecional × confiancaMedia`. Com **4** especialistas fixos, a direcional só
pode valer **0,5 · 0,75 · 1,0**, e a `confiancaMedia` é auto-declaração do LLM, colada em 0,85-0,95.
Enumerado (24 valores alcançáveis em passos de 0,05):

| placar | direcional | faixa possível | desfecho |
|---|---|---|---|
| 4-0 | 1,00 | 60-100% | aprovar |
| **3-1** | 0,75 | 45-75% → **71%** | **aprovar** (quórum 2 não bate) |
| **2-2** | 0,50 | 30-50% → **43%** | em_validacao |

Os "71% quando está boa" são **3-1 × 0,95**; os "40 e poucos" são **2-2 × 0,85**. Não existe faixa
intermediária porque nada a produz. O 71% é a **cota máxima de um projeto em que o cético objetou
sozinho**, exibida com 2 dígitos significativos como se fosse medição.

⚠️ O repo **já sabia** disso na outra metade do sistema: `src/lib/estrelas-regua.ts:465` documenta
*"confiança que sai de julgamento do LLM não é auditável — medido no T1, o modelo auto-declarou alta
em 456 de 484"*, e por isso a régua das estrelas declara confiança por **sinais** e **é calibrada de
verdade** (run 9: alta 96% · média 84% · baixa 62% de aderência em ±1). A mesa multiplica exatamente
o número que a outra metade descartou.

⚠️ Achado do explorador que muda o desenho: o float **já é um ordinal disfarçado** em toda a cadeia —
`avaliacao-financeira.ts:112` (`ok ? 0.9 : 0.3`), `cetico-avaliacao.ts:101` (`sinais.length*0.3`),
`agregador-avaliacao.ts:60` (`0.85 / 0.4 / 0.55`). Não há reamostragem, regressão nem frequência
histórica em nenhum ponto. E `grauConfianca` (`deliberacao.ts:35`) **já é** a camada ordinal usada na
UI. O que não existe é a lógica de DECISÃO operando sobre o ordinal.

### A2 — Não reprova porque reprovar não existe

`VeredictoAgregado = aprovar | em_validacao | isento` e `SaidaConsenso = aprovar | ajuste | humano`.
Nenhum dos dois tem desfecho negativo — é a "regra de ouro" declarada no topo do
`agregador-avaliacao.ts`. Só `analyzer.ts` (`claro_nao`) reprova em todo o sistema.

Somado a um buraco de cobertura: `avaliacao-financeira.ts:16` tem **TETO** de materialidade
(R$ 5.000/mês → atenção) e **NENHUM PISO**. Um projeto de R$ 18,16/mês volta `veredito: 'ok'` com
confiança 0,9. Foi exatamente por esse eixo que **137 projetos** foram reprovados à mão em 04/09
(`docs/baselines/rodadas/snapshot-reprovacao-04-09.json`: 137 alvos, **todos** com
`statusAntes: "Aprovado"`). A mesa procura **inflação** em quatro eixos e nunca pergunta se o ganho é
**irrelevante**.

### A3 — O circuito de feedback está aberto em três pontos

1. **`politicaDeLiberacao(null, ...)`** — literal, em `src/lib/avaliacao/time.functions.ts:200`. A
   política que decide se o time pode agir sozinho lê acurácia medida e **nunca recebe nenhuma**. O
   time está em sombra por argumento hardcoded, não por medição. As `METAS_LIBERACAO` (acerto ≥90%,
   erro grave = 0, n ≥300) são inalcançáveis por construção.
2. **`avaliacao_feedback` é write-only.** O 👍/👎 é lido só para redesenhar o próprio botão
   (`dashboard-admin.functions.ts`). Nenhum prompt, limiar ou métrica o consome.
3. **Gabarito congelado.** `getIdsRetroativos()` (`client.server.ts:3540`) devolve **todos** os
   medidos e o retroativo os pula para sempre. Os 137 que viraram `Aprovado → Reprovado` em 04/09
   estão medidos contra a verdade antiga, e quem a mesa marcou `aprovar` ali é um `erro_grave` que
   **nunca será contado**. O cron roda a cada 15 min desde então, medindo sobre base movida.
4. **Não existe medição de calibração em lugar nenhum.** `agregarAcuracia`
   (`avaliacao-retroativa.ts:60`) computa taxas **globais** e não segmenta por faixa. A coluna
   `avaliacao_retroativa.grau` **é gravada e nunca lida de volta**. Ou seja: o dado para calibrar já
   está no banco, só ninguém agrupa por ele.

### A4 — Todos os agentes são *score-first*

Os 8 blocos "FORMATO — responda APENAS com JSON" pedem o **número antes do raciocínio**:

| arquivo | ordem hoje |
|---|---|
| `agents/especialista-avaliacao.ts:149` | `preocupa` → `argumento` → `confianca` |
| `avaliacao/cerebro-estrela.ts:52` | `nota` → … → `leitura` (último) |
| `avaliacao/cerebro-merito.ts:48` | bool → raciocínio |
| `agents/especiais-lentes.ts:401` | `nota` → … → `racional` (6º) |
| `agents/especial-classificador.ts:147` | `nota` → **`confianca`** → `leitura` |
| `agents/especiais-revisor.ts:85` | `refutada` → `motivo` |
| `avaliacao/cetico-estrela.ts:52` | (idem) |
| `avaliacao/time.ts:91` (`buildPromptCetico`) | (idem) |

A literatura mediu a inversão para racional-primeiro: concordância exata **42,6% → 51,9%**
(+9,3 pontos, MAE −0,15), num estudo de *autoregressive commitment* — o modelo confabula o racional
para justificar um número já emitido. **Nossa run 9 está em 52% de nota idêntica**, praticamente
sobre o baseline score-first deles.

⚠️ `agents/cetico-avaliacao.ts` é **PURO, sem LLM e sem bloco de FORMATO** — fica fora.

---

## Decisões do dono do produto nesta sessão (08/09/2026)

- **D1 — Feedback humano = nota certa + eixo que errou + texto livre.** O botão **👍 SAI**: ausência
  de 👎 é concordância.
  - ✅ **REVISADO na implementação e CONFIRMADO pelo Luis (08/09/2026).** A ficha do
    `/dashboard` **não exibe nota do agente**: a única nota ali é a coluna MANUAL "Estrelas", e não
    havia com o que `ensinaAlgo` comparasse (sem referência que mudou, a lição era descartada 100%
    das vezes). Um segundo controle de estrela na mesma tela seria dois canais para a mesma coisa.
    Então o que a ficha coleta é o **DESFECHO certo** (`tipo: 'veredito'`); quem corrige NOTA segue
    pelo canal da estrela (`definirEstrelasEspecial`), que já grava motivo e leitura do agente, e o
    parser aceita `nota_certa` para quando aquele canal declarar o eixo. Registrado em `SPEC.md`
    RF-234 + RF-234.1. **A substância da D1 está entregue** (👍 fora, eixo, motivo ≥10, a lição
    reaparecendo em projeto diferente); o que mudou é o CAMPO do "certo".
- **D2 — Concordância implícita vale SÓ com PROVA DE OLHADA.** Avaliação nascida após um marco +
  admin gravou Status ou Estrelas naquele projeto **depois** de a avaliação existir + sem 👎. Projeto
  que ninguém abriu fica **FORA** da conta, não vira acerto de graça. A base passada **não** conta
  como concordância implícita; o 👎 conta retroativamente.
- **D3 — Realimentação = lição recuperada + relatório. SEM ajuste automático de limiar.**
- **D4 — O time passa a poder reprovar, por RÉGUA DECLARADA.** Duas portas, e as duas são régua, não
  juízo livre: **(i)** o **piso de impacto**; **(ii)** o projeto ser **inválido**, e aí o agente tem de
  **NOMEAR** qual motivo declarado aplicou **e citar** o trecho do material que comprova.
  ⚠️ **Isto EXPANDE a primeira resposta do dono do produto** (que era só o piso mecânico). Palavras
  dele: *"além de reprovar projetos que são absurdos também. Nosso time de agentes tem toda nossa base
  para discernir exatamente se um projeto é válido ou não, além de critérios e nossas ressalvas."*
  A doutrina *"rejeição mecânica sobrepõe aprovação do LLM, nunca o contrário"* fica de pé porque a
  lista é **fechada** e a **citação é obrigatória** — é o mesmo padrão que `PISO_ZERO` já usa (o agente
  já diz qual desqualificador aplicou) e que `especiais-lentes` já usa (evidência copiada do material).
- **D4.1 — ⚠️ A reprovação é MUITO mais estreita que o 0★, e isto é a armadilha da fatia.** Os motivos
  de invalidez são **só `fora_de_uso` e `ressubmissao`** — exatamente os dois que `ROTULO_DESQ`
  (`avaliacao/consenso.ts:86`) já reconhece como desqualificador contra um `aprovar`. Os outros **5**
  motivos do `PISO_ZERO` (`apenas_mensuravel`, `so_o_autor`, `simples_local`, `marginal`,
  `experimentacao`) significam **nota zero**, não reprovação. Motivo medido: **336 dos 637** projetos
  da run 9 são **0★** (53% da base), e o dono do produto reprovou **137** pela régua de impacto — se
  qualquer motivo do piso reprovasse, o time reprovaria **metade da base**. A memória do repo é
  explícita: *"0★ É veredito (caixa «Experimenta»), não «não avaliado»"*.
- **D4.2 — Piso adotado: R$ 100/mês**, a mesma régua que o dono do produto aplicou à mão em 04/09 (137
  projetos). ⚠️ **Assunção declarada:** ele confirmou que *"isso é um piso"* sem cravar o número, e
  este é o único número que ele já aplicou nesta base. Fica como constante nomeada, e o **snapshot de
  04/09 é o gabarito pronto**: o piso está certo se reprovar aqueles 137 e mais ninguém. Se a fórmula
  do Líquido da v2 mudou o que "R$ 100" significa, o número se revisa **antes** da T15, não depois.
- **D5 — A independência dos especialistas entra junto do racional-primeiro** (as duas são mudança
  de prompt e as duas só se medem rodando; uma run de ~1h em 640 projetos mede as duas).

---

## Reuso-primeiro (RF-32/33/34)

### O que se REUSA como está

| Peça | Canônico | Nota |
|---|---|---|
| Item de lição (nota certa + argumento do agente + motivo humano) | **`src/lib/correcoes.ts`** (`Correcao`, `ensinaAlgo`, `descreverCorrecao`, `blocoCorrecoes`, `licoesPara`) | ⚠️ **É o achado que encolhe a entrega (b).** Ver abaixo. |
| Piso/teto do motivo | `MOTIVO_MIN = 10` / `MOTIVO_MAX = 400` (`correcoes.ts`) | a tela usa os mesmos, para não aceitar o que o prompt descarta |
| Camada ordinal da confiança | `grauConfianca` + `LIMIAR_GRAU_ALTA/MEDIA` (`deliberacao.ts`) | já existe e já é o que a UI colore |
| Fonte da correção humana | `admin_activity_log` via `queryAdminActivities` | keyset paginado, sem blob, longe do teto de 32 MiB |
| Recuperação por similaridade | `especial-corpus.ts` + `pinecone.ts` + `embeddings.ts` | **não** se cria índice novo (ver abaixo) |
| Régua de estrelas | `estrelas-regua.ts` | entra INTACTA (D20 do plano anterior) |

### ⚠️ A decisão de 05/09/2026 que NÃO se reverte

`src/lib/correcoes.ts:170-186` registra que o dono do produto **já fez esta mesma pergunta** ("não
seria melhor uma base de consulta em vez de tudo no prompt?") e a resposta que ficou foi: **não criar
índice separado** — a base de consulta já é o RAG, e a correção **viaja junto do vizinho a que
pertence** (`licoesPara` ordena vizinhos primeiro, cronológico depois), capada em 6 lições. Uma tool
de consulta dinâmica foi **considerada e descartada com motivo**: o `llm.ts` não expõe `tools`, o
proxy não faz tool-calling nativo, e falha de parse já custou 65% de uma rodada.

**Este plano honra essa decisão.** Nada de `calibragem_embedding`, nada de namespace novo no
Pinecone, nada de tool. O que falta em `correcoes.ts` é outra coisa, e é pequeno:

1. `correcoesDoLog` filtra **`acao !== 'estrelas' → continue`**. O veredito da MESA não tem caminho
   de correção nenhum: o 👎 morre em `avaliacao_feedback`.
2. Falta o **EIXO** (o `tipo` distingue `estrela | valor`, não qual lente errou) — D1 pede o eixo.
3. O 👎 não tem onde escrever o motivo (é a lacuna que o dono do produto identificou).

### O que se CRIA do zero, e por quê

| Novo | Razão (RF-34) |
|---|---|
| `src/lib/avaliacao-calibragem.ts` (PURO) | agrupar acerto por faixa de confiança não existe em lugar nenhum (A3.4) e não cabe em `avaliacao-retroativa.ts`, que mede taxa global. Módulo puro, testável sem banco. |
| `src/lib/materialidade-piso.ts` (PURO) ou constante em `avaliacao-financeira.ts` | o piso é régua nova de produto (D4). Decidir no §T5 se vira módulo ou constante — a régua dos R$100/mês da rodada de 04/09 é a fonte. |

---

## Tarefas

### Entrega (a) — racional-primeiro + independência · blast BAIXO

- **T1 — ✅ FEITA (08/09).** Inverter a ordem das chaves nos **8** blocos de FORMATO para que o campo de raciocínio
  venha **antes** do número/booleano. Nenhuma chave é adicionada ou removida.
  *(guarda: `npm run test` verde; os parsers acessam por nome — `extrairJson`/`extrairJsonSeguro` +
  os 7 `normalizar*` —, nenhum depende de ordem, e não há teste de snapshot de prompt.)*
- **T2 — ✅ FEITA (08/09).** No `especial-classificador.ts`, mover `confianca` para **depois** de `leitura` (hoje
  declara a confiança antes de raciocinar, que é o caso mais grave).
  *(guarda: teste de normalização existente segue verde.)*
- **T3 — ✅ FEITA (08/09).** Tirar `outrosVotos` do prompt do especialista (`buildPromptEspecialista`): a 1ª passada
  julga **cega**, e a conciliação continua onde está (`agregarJulgamentos`). A interferência de
  rubrica medida em 2026 é exatamente o veredito de um critério mudar conforme os outros presentes no
  contexto.
  *(guarda: teste novo provando que o prompt do especialista não cita o parecer dos outros; a
  `divergencia` do agregador segue calculada.)*
- **T4 — ⏳ PENDENTE (exige deploy na staging + `E2E_COOKIE`).** Rodar o harness contra o baseline da **run 9** (`docs/baselines/runs/run-9.json`,
  n=637, idêntica 52%, ±1 76%) e gravar a **run 10** no mesmo formato, com o comparativo em
  `run-10-comparacao.txt`.
  *(guarda: o comparativo existe e diz se a concordância subiu, caiu ou empatou — ⚠️ medir só com
  `humana > 0`, conforme a memória da calibragem.)*

### Entrega (b) — a discordância humana vira lição · blast MÉDIO

- **T5 —** Estender `Correcao` com **`eixo`** (`horas | financeiro | precedente | impacto_irrelevante
  | outro`) e `TipoCorrecao` com **`veredito`**. `descreverCorrecao` passa a nomear o eixo na linha da
  lição. `ensinaAlgo` **não muda** (motivo ≥10 chars continua sendo o portão).
  *(guarda: teste de ida-e-volta em `tests/correcoes.test.ts` cobrindo eixo e o tipo novo.)*
- **T6 —** `correcoesDoLog` passa a reconhecer uma **segunda** `acao` do `admin_activity_log`
  (a da discordância com a mesa), além de `'estrelas'`.
  *(guarda: teste com log misto provando que as duas ações viram `Correcao` e que uma ação
  desconhecida continua sendo ignorada.)*
- **T7 —** Registrar a discordância: o 👎 grava em `admin_activity_log` via `registrarAtividade`
  (que **nunca lança** — D3 do histórico de ações) com `meta_json` carregando nota certa, eixo,
  motivo e a **leitura do agente** que estava na tela. ⚠️ Sem `leitura_agente` a lição fica pela
  metade: o motivo humano é quase sempre réplica a uma frase específica do agente.
  *(guarda: teste de que o `meta_json` gravado é lido de volta por `correcoesDoLog` sem perda.)*
- **T8 —** UI da ficha (`projeto-detalhe-dialog.tsx`): **o botão 👍 sai** (D1). O 👎 abre o formulário
  com nota certa + eixo + motivo, cobrando `MOTIVO_MIN` **no cliente e no servidor**. Estado nunca só
  por cor (rótulo + ícone), foco de teclado visível, PT-BR com acentos.
  *(guarda: teste de que o servidor recusa motivo curto; a skill `frontend-design` é invocada antes
  de codar a tela — regra 11.)*
- **T9 —** Ligar a lição na MESA: `agregarJulgamentos`/`computarVotos` passam a receber o bloco de
  `blocoCorrecoes(licoesPara(...))` no prompt do especialista, com os ids dos vizinhos que o RAG já
  recuperou. **Reuso puro** — nenhuma função nova de recuperação.
  *(guarda: teste de que o bloco entra no prompt quando há lição com motivo e **não** entra quando
  só há correção sem motivo.)*

### Entrega (c) — confiança medida em vez de inventada · blast ALTO

⚠️ **O float interno NÃO muda.** Trocar a semântica do campo tocaria 3 tabelas (`REAL NOT NULL`), 2
contratos de API, 2 telas, o cron de deliberação e **17+ asserções numéricas** em 4 arquivos de
teste — e, pior, sem medição de calibração existente, a troca seria às cegas. A mudança é de
**exibição + medição**, e o número segue interno onde a lógica já o compara.

- **T10 —** `src/lib/avaliacao-calibragem.ts` (PURO): agrupa os itens de `avaliacao_retroativa` por
  **faixa** (a coluna `grau` já é gravada e **nunca lida de volta**) e devolve acerto/erro grave/n
  por faixa. É o que torna a confiança uma frequência em vez de uma afirmação.
  *(guarda: teste com distribuição sintética + o caso de faixa com n=0, que não pode virar 0%.)*
- **T11 —** A ficha e a coluna "Sombra" param de exibir **percentual**. Passam a exibir o grau + a
  taxa MEDIDA daquela faixa quando `n` for suficiente ("nesta faixa o time bate com a triagem em X de
  10, sobre N casos"), e **"ainda sem medição"** quando não for. `pctConfianca` deixa de ser usada na
  UI (fica no módulo, sem call-site, ou sai).
  *(guarda: teste de que faixa sem amostra não exibe número nenhum; canário de que nenhum componente
  chama `pctConfianca`.)*
- **T12 —** Descongelar o gabarito: `getIdsRetroativos` deixa de ser "todos os medidos" e passa a
  excluir quem foi medido **contra um Status humano diferente do atual** (re-medir é reavaliar — o
  `upsertAvaliacaoRetroativa` já é UPSERT).
  *(guarda: teste provando que um projeto que virou `Aprovado → Reprovado` volta à fila de medição, e
  que um projeto com Status inalterado **não** volta.)*
- **T13 —** Ligar `politicaDeLiberacao` à acurácia real, substituindo o `null` literal de
  `time.functions.ts:200`. **As flags de liberação continuam desligadas** — o que muda é a política
  passar a dizer *"acerto de X% abaixo da meta"* em vez de *"sem medição"*.
  *(guarda: teste de que, com acurácia abaixo da meta, `age_sozinho` segue `false`; e de que sem
  medição a mensagem continua sendo a de ausência.)*
- **T14 —** **Piso de materialidade** no financeiro (D4): ganho mensal abaixo do piso vira sinal
  próprio, com a régua dos R$100/mês da rodada de 04/09 como fonte. Constante nomeada, nunca
  literal solto.
  *(guarda: teste com o caso real `LEGADO-057` (R$ 18,16/mês), que hoje volta `ok`/0,9.)*
- **T15 —** **5ª saída `reprovar`**, por RÉGUA DECLARADA (D4), com **duas** portas:
  **(i)** piso de impacto violado (T14) — puramente mecânica;
  **(ii)** projeto **inválido**, e só quando o agente **NOMEIA** `fora_de_uso` ou `ressubmissao` (a
  lista de D4.1, fonte única com `ROTULO_DESQ`) **E cita** o trecho do material que comprova. Sem nome
  ou sem citação, **não reprova** — cai em `em_validacao`.
  ⚠️ Os outros 5 motivos do `PISO_ZERO` **não** reprovam (D4.1 — reprovariam 53% da base).
  ⚠️ Ampliar o enum obriga varrer os **LEITORES**, não só os escritores — é a lição do
  `Dispensado → Pré-reprovado` (D29): rótulo desconhecido caindo num fall-through afirma coisa falsa
  em 3 telas.
  *(guarda: teste de que nenhum caminho de LLM alcança `reprovar` sem motivo nomeado + citado; teste
  de que cada um dos 5 motivos restantes do piso NÃO reprova; teste de rótulo para cada leitor do enum
  — chip, ficha, retroativo.)*
- **T17 —** Classe de erro **própria** para a reprovação indevida: `compararComHumano` hoje só conhece
  `acerto | conservador | erro_grave | sem_base`, e `erro_grave` é *"aprovou o que o humano
  reprovou"*. Com a T15 nasce o erro **espelhado** — *"reprovou o que o humano aprovou"* —, que é o
  pior para o autor do projeto e que hoje cairia em `acerto` ou em nada.
  *(guarda: teste dos 4 cruzamentos de veredito × Status humano, com a classe nova nomeada; a taxa
  dela entra no relatório ao lado da `taxa_erro_grave`.)*
- **T16 —** **Canários** no retroativo: casos que ninguém honesto aprova (os R$ 18,16/mês do
  `LEGADO-057`, o caso das 500h). Acurácia perfeita passa a ser tripwire, não vitória — no estudo de
  guardrails, **todas** as rodadas com trapaça deram exatamente 100% e as limpas ficaram entre 35% e
  89%.
  *(guarda: teste de que a mesa aprovando um canário derruba o relatório.)*

---

## Critérios de aceitação

1. **(a)** A run 10 existe em `docs/baselines/runs/`, no mesmo formato da run 9, com comparativo
   escrito. O critério **não** é "subiu": é **estar medido** contra o baseline, com `humana > 0`.
2. **(b)** Um 👎 com nota certa, eixo e motivo ≥10 caracteres reaparece como lição no prompt de um
   projeto **diferente**, e a mesma discordância **sem** motivo **não** reaparece. Provado por teste.
3. **(b)** O botão 👍 não existe mais em nenhuma tela.
4. **(c)** A ficha não mostra percentual de confiança em lugar nenhum. Onde há amostra, mostra a taxa
   medida com o `n`; onde não há, diz que não há.
5. **(c)** A concordância implícita conta **só** com prova de olhada (D2), e um projeto que ninguém
   abriu fica de fora da conta — provado por teste com os dois casos.
6. **(c)** `politicaDeLiberacao` recebe acurácia real e **ainda assim** mantém `age_sozinho: false`
   (as flags seguem desligadas). O time continua em sombra por MEDIÇÃO, não por `null`.
7. **(c)** Um projeto cujo Status humano mudou volta à fila do retroativo; um cujo Status não mudou
   não volta.
8. **(c)** `reprovar` só é alcançável pelo piso ou por um motivo de invalidez **nomeado e citado**;
   cada um dos 5 motivos restantes do `PISO_ZERO` **não** reprova; todo leitor do enum tem rótulo
   próprio (nenhum fall-through).
9. **(c)** Rodado o piso contra o snapshot de 04/09, ele reprova **os 137** e não pega ninguém a mais.
   Se pegar, o número do piso se revisa **antes** de a T15 subir.
10. **(c)** A reprovação indevida (time reprova, humano aprovou) tem classe própria e taxa própria no
    relatório — não se dilui em `acerto`.
11. `npm run test` verde. `npm run build:worker` rodado e `worker.js` commitado (regra 1). Especs
    atualizadas (regra 12): correções em `SPEC_CORRECOES.md`, o que for feature em
    `SPEC_FEATURES_NOVAS.md`.
12. Staging (`edf400b4`) validada antes de prod (`674a3710`) — regra 13. Merge no `main` no mesmo
    dia do deploy de prod — regra 14.

---

## Fronteiras (não exceder)

- **Nada muda status de projeto em produção.** O modo sombra continua sombra: `age_sozinho` fica
  `false` e as flags de liberação seguem desligadas. T15 cria o desfecho `reprovar`, **não** o
  autoriza a agir.
- **Não se cria índice/namespace/tabela de vetores para calibração** — a decisão de 05/09/2026 fica
  (ver Reuso). Nada de tool-calling.
- **Não se altera a régua de estrelas** (`estrelas-regua.ts`) nem a curva. Ela entra intacta.
- **Não se altera o tipo da coluna `confianca`** nem a aritmética de `agregarVotos`/
  `conciliarComCetico`/`avancarDeliberacao`. Entrega (c) é exibição + medição.
- **Não se mexe na imunidade do analisador real** (`normalizarClassificacao`,
  `decidirStatusSubmissao` em `analyzer.ts`) — lá `fluxoDireto` mexe em status de produção. As duas
  réguas **não** se unificam.
- **Não se ajusta limiar automaticamente** (D3).
- **Não se registra os 8 agentes no `prompt-registry.ts`/`prompt-inspector.tsx`.** O explorador
  confirmou que **nenhum** dos 8 está registrado hoje: a regra 3 do CLAUDE.md **não tem alvo** aqui.
  É lacuna **pré-existente**, não regressão desta fatia. Fica **anotada** para decisão do dono do
  produto, não consertada de contrabando.
- **Não se unifica `extrairJson` com `extrairJsonSeguro`** (duplicação existente notada pelo
  explorador, fora do escopo).
- Retroativo segue **bounded** (`limite`, hoje 20/corrida) e leitura em lote — o teto de 32 MiB de
  RPC já derrubou 3 consultas nesta vizinhança.

---

## Blast-radius

**Arquivos:**
- *(a)* `agents/especialista-avaliacao.ts` · `avaliacao/cerebro-estrela.ts` ·
  `avaliacao/cerebro-merito.ts` · `agents/especiais-lentes.ts` · `agents/especial-classificador.ts` ·
  `agents/especiais-revisor.ts` · `avaliacao/cetico-estrela.ts` · `avaliacao/time.ts`
- *(b)* `correcoes.ts` · `atividades.functions.ts` · `dashboard-admin.functions.ts` ·
  `components/dashboard/projeto-detalhe-dialog.tsx` · `avaliacao-normais.functions.ts` ·
  `integrations/db/schema.ts` (aditivo) · `worker.ts` (rota do feedback)
- *(c)* `avaliacao-calibragem.ts` (novo) · `avaliacao-retroativa.ts` ·
  `avaliacao-retroativa.functions.ts` · `client.server.ts` (`getIdsRetroativos`) ·
  `avaliacao/time.functions.ts:200` · `avaliacao-sombra-rotulos.ts` ·
  `components/dashboard/chip-sombra.tsx` · `agents/avaliacao-financeira.ts` ·
  `agents/agregador-avaliacao.ts` (enum)

**Dependentes:** cron `/api/cron/deliberar-avaliacoes` (compara confiança por limiar) · cron
`/api/cron/avaliacao-retroativa` (15 min, vivo, 200) · cron `/api/cron/avaliar-normais` (10 min) ·
`routes/_authenticated/dashboard.tsx` (tipa `confianca: number | null`) · 3 telas que leem o enum de
veredito · `tests/{agregador-avaliacao,deliberacao,mesa-especialistas,avaliacao-sombra-rotulos,retroativo-avaliacao,correcoes}.test.ts`

**Invariantes que entram:**
- `ensinaAlgo`: correção sem motivo (≥10 chars) **não** vira lição — anti "concorde com o humano".
- `rotuloExemplar`: nota **humana** vence a recomendada pelo próprio agente (anti-feedback-loop).
- `registrarAtividade` **nunca lança** (auditoria não desfaz a ação que já aconteceu).
- `null` (índice indisponível) **≠** `[]` (sem vizinho) — decide o fallback do Pinecone.
- Rejeição **mecânica** sobrepõe aprovação do LLM, nunca o contrário.
- Modo **sombra**: nada aqui muda status.
- Teto de **32 MiB** de RPC: leitura em lote nasce paginada, sem blob.
- Comentário em `schema.ts` **nunca** leva `;` (o `initSchema` divide por ele).

**Confiança: média.** Os quatro achados têm arquivo e linha, e o blast por entrega veio de três
exploradores independentes — (a) BAIXO, (b) MÉDIO, (c) ALTO. O que rebaixa de alta para média: este
repo **não tem `docs/INDEX.md` nem `docs/invariants.md`**, então não houve consulta a mapa e os três
exploradores degradaram para varredura direta (RF-35), com confiança própria de 0,72-0,79. A
**varredura completa de dependentes é da sessão de `/ggsd:code`**, em especial (i) os leitores do enum
de veredito na T15 e (ii) os call-sites de `pctConfianca` na T11.

**Lacunas declaradas pelos exploradores:**
- `especiais-calibrador.ts` não foi aberto — se o "banco de calibração" colidir com esse calibrador
  de rodada, precisa de pesquisa dedicada antes da T10.
- `getProjetosDashboardLote` não conferido em detalhe: pode ser um 4º ponto de payload com
  `confianca` (não muda o veredito de blast).
- Não foi verificado se algum `spec-docs/` ou `docs/plans/*.md` cola o JSON de FORMATO por texto
  (ficaria cosmeticamente stale, sem quebrar runtime).
