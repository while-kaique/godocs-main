# Plano — Painel de agentes para julgar ESPECIAIS (o fluxograma, agora dentro do app)

**Status:** **PRONTO PARA CODAR** — branch `feat/painel-agentes-especiais` criada. Confiança **ALTA** nas
decisões de topologia (elas vêm de um pipeline que JÁ rodou, ver abaixo) e **MÉDIA** no que só a medição
do T1 pode responder. ⚠️ **Nada sobe até o T7 passar** (decisão do Kaique, 26/08/2026): a trava de
subida é o painel BATER o baseline no test set, não "ficou pronto".

**Objetivo:** trocar o julgamento de **um** agente pelo **painel** do fluxograma — roteador → avaliadores
com lentes distintas → **calibrador** → **revisor adversarial** → marca de inconsistência — para
recomendar a estrela 0–10 de cada especial. **Em LOTE, nunca no caminho da submissão.**

## O que já existe (não reconstruir)

| Peça | Onde | Papel no painel |
|---|---|---|
| Régua + níveis + critérios + **`CURVA_BASE`** | `src/lib/especiais-regua.ts` (**FONTE ÚNICA**) | entra em TODOS os prompts; é a base do calibrador |
| Agente classificador (1 avaliador) | `src/lib/agents/especial-classificador.ts` | vira o **baseline** a bater, e o fallback |
| RAG (vizinhos semânticos) | `especial-corpus.ts` + `pinecone.ts` (índice `godocs-especiais`, 3072d) | alimenta few-shot e o **roteamento por função** |
| Recomendações gravadas | tabela `especial_avaliacao` (`origem`, `contestada`) | destino do painel — **nunca** a coluna "Estrelas" |
| Re-auditoria (nota × pares) | `especiais-reauditoria.ts` | instrumento já pronto; o T1 reusa a mecânica |
| Retrato da força-tarefa (99 projetos) | `especiais-seed.ts` | **prova de que a topologia funciona** (ver abaixo) |

## Por que a topologia já está decidida (não relitigar)

O fluxograma **já rodou uma vez, fora do app**: é o pipeline da força-tarefa do JV que gerou o
`especiais-seed.ts` — *7 avaliadores por cluster → calibrador que reescala na curva real → revisor
adversarial sobre toda nota ≥3*. Resultado em 99 projetos: **0★:8 · 1★:43 · 2★:40 · 3★:6 · 4★:2**
(nenhum chegou a 5). Duas lições que **não podem ser redescobertas na marra**:

1. ⚠️ **O nó CALIBRADOR não pode faltar.** Cada agente a mais num loop empurra a nota para CIMA. Sem
   reescalar na `CURVA_BASE` (**≥3★ = top 4% de 644 projetos; ≥5★ = top 1%**), três voltas viram
   inflação. Foi o calibrador que fez a força-tarefa não passar de 4★.
2. ⚠️ **Rotear por ÁREA é o eixo errado, e isso está MEDIDO.** O `a1fe406` cortou área/ferramenta/tipo
   do texto do embedding exatamente porque área aproxima por setor/marca e **separa irmãos de função** —
   foi o bug «GoPrice» (Gocase) 0–1★ contra «Agente precificador» (Gobeaute) 4★. O eixo é **FUNÇÃO**.

## Decisões fechadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Roteamento por quê? | **FUNÇÃO**, nunca área (lição 2). A função sai de uma **taxonomia DECLARADA** (`TAXONOMIA_FUNCAO`, fonte única, no espírito da `TAXONOMIA_DESTINO_GANHO`) + os vizinhos do Pinecone como evidência. ⚠️ Taxonomia declarada, não inventada pelo LLM a cada corrida: função que muda de nome entre corridas destrói a comparabilidade. |
| 2 | Avaliadores idênticos ou com lentes distintas? | **Lentes DISTINTAS.** N cópias do mesmo prompt concordam por construção e a "convergência" vira teatro. As lentes saem dos `CRITERIOS` que já existem na régua: **recorrência+rastreabilidade · complexidade/autonomia · alcance/reuso · risco evitado**. |
| 3 | Calibrador | **OBRIGATÓRIO e determinístico onde der.** Reescala a distribuição da RODADA contra uma curva de referência DECLARADA. ⚠️ **Corrigido pela medição de 26/08/2026 (achado 4 do T1): a referência é a `CURVA_ESPECIAIS_AUDITADOS` (≥3 = 41,7%), NÃO a `CURVA_BASE` (≥3 = 5,4%)** — são populações diferentes, e usar a da base rebaixaria prata correta. |
| 4 | Revisor adversarial | Sobre **toda nota ≥3** (é o que a força-tarefa fez, e 3★ já é top 4%). Prompt de REFUTAR, não de confirmar; empate mantém a nota MENOR. |
| 5 | Teto de voltas | **3**, absorvente. Não convergiu → grava a nota do calibrador + **`contestada: true`** (campo que já existe) e segue. ⚠️ Loop sem teto absorvente é o erro que este repo já cometeu 3× (gate `[1.4]`, carga×escala, ganho projetado). |
| 6 | Onde roda | **BATCH, jamais pós-submissão.** Estimativa original: ~4 lentes × 3 voltas + roteador + calibrador + revisor ≈ 30–36 chamadas/projeto. ⚠️ **MEDIDO no T6: ~8 chamadas/projeto** — a volta re-roda o REVISOR, não as lentes (o material não muda entre voltas), o roteador é determinístico e o calibrador é puro. Rota admin + cron, paginada e retomável (`proximo_offset`) + teto de custo por corrida. |
| 7 | Convive com o classificador de hoje? | **Sim.** O painel grava em `especial_avaliacao` com `origem` PRÓPRIA (`painel-agentes`); o classificador de 1 agente continua sendo o caminho pós-submissão e o fallback. Trocar o padrão só depois do T7. |
| 8 | Escreve nota? | **NUNCA.** Coluna "Estrelas" só por clique humano — invariante do projeto inteiro, não desta fatia. |

## Decisões que só a MEDIÇÃO fecha (T1 antes de T2)

- **Quantas lentes** (3 ou 4) e **quantas voltas** valem o custo. Se 2 lentes já batem o baseline, 4 é
  dinheiro fora. ⚠️ Com ~10 s por chamada de LLM (medido no T1), cada lente a mais é ~8 min a mais
  numa corrida de 48.
- **Se o painel ganha do agente único.** ⚠️ É possível que não ganhe. O T7 é uma trava real: sem ganho
  medido, o painel **não vira o padrão** — vira ferramenta de auditoria em lote e o classificador segue.

## T1 MEDIDO — o baseline do agente único (26/08/2026, staging, 48/48 especiais)

Rodado em 4 páginas de 12 pelo `POST /api/admin/especiais/concordancia` (o espelho da staging traz a
planilha real, então o test set é o de verdade). **Este é o número que o T7 tem de bater.**

| Métrica | Agente único (baseline) |
|---|---|
| pares medidos | **48** (não 644 — ver abaixo) |
| MAE | **1,69** |
| dentro de ±1 | **58,3%** |
| nota exata | **29,2%** |
| viés agregado | **−0,06** ⚠️ engana, ver abaixo |
| ≥3★ na rodada × nos especiais auditados | **33,3% × 41,7%** → CONSERVADOR (ver achado 4) |
| ≥5★ na rodada × nos especiais auditados | **6,3% × 12,5%** → CONSERVADOR |

**Quatro achados que mudam o T2/T3 (não redescobrir na marra):**

1. ⚠️ **O test set são ~48 especiais, não 644.** A `CURVA_BASE` conta LINHAS da aba (financeiros
   incluídos, 100 sem nota); auditado **e** especial é um subconjunto pequeno. A comparação do T7 é
   **pareada** (mesmo conjunto, dois juízes), então 48 serve — mas não dá para cravar 2ª casa decimal,
   e "MAE 1,69 → 1,62" não é ganho, é ruído.
2. ⚠️ **O viés agregado MENTE, e por pouco: −0,06 leria como juiz calibrado.** Aberto por faixa do
   gabarito: **0★ → +1,94** · 3★ → −0,91 · 4★ → −1,67 · 5★ → −2,33 · **7★ → −7** · 8★ → −4 ·
   10★ → −6. O defeito não é generosidade nem dureza: é **COMPRESSÃO PARA O MEIO** (tudo vira 1–3), e
   os dois lados se cancelam na média. Daí o campo `erro_por_nota` no módulo puro — o harness sem ele
   devolveria um número que aprova um juiz ruim.
3. ⚠️ **A matriz diz onde dói:** dos 17 zeros humanos, **12 saem do zero** (6→bronze, 5→prata, 1→
   diamante); dos 14 pratas humanos, **10 caem para bronze**. Ou seja, o calibrador da decisão 3 tem
   **duas** tarefas, não uma — segurar o topo **e** parar de promover o lixo. Um calibrador que só
   reescala a distribuição arruma o histograma sem arrumar o PAR (pode empurrar zeros para cima e
   notas altas para baixo e ainda "bater a curva").
4. ⚠️ **CORREÇÃO (26/08/2026): a rodada NÃO estava inflada — a comparação era com a população
   errada.** A 1ª leitura do T1 usou a `CURVA_BASE` (base INTEIRA) e cravou "INFLADA" nos 2 cortes.
   Medido depois na staging, sem LLM (`GET /api/admin/especiais` + `/api/admin/dashboard/projetos`,
   espelho real): a curva humana dos **48 especiais auditados** é
   `0:17 · 1:3 · 2:8 · 3:11 · 4:3 · 5:3 · 7:1 · 8:1 · 10:1` → **≥3 = 41,7% · ≥5 = 12,5%**, enquanto a
   base inteira (535 auditados) deu **≥3 = 5,4% · ≥5 = 1,1%** (bate com a `CURVA_BASE`, então o
   espelho é fiel). São **7× de diferença** no corte da prata. Ou seja: o agente único é **menos**
   generoso que a triagem nos dois cortes (33,3% × 41,7% e 6,3% × 12,5%) — e isso **casa** com o
   achado 2 (compressão: 7★ → −7, 8★ → −4, 10★ → −6). ⚠️ **Consequência prática:** cota contra a
   `CURVA_BASE` rebaixaria prata CORRETA (numa página de 12 ela permitiria 2 e a triagem dá 5), e o
   critério de aceitação 2 foi reescrito. A constante medida vive em `CURVA_ESPECIAIS_AUDITADOS`
   (`especiais-calibrador.ts`), com teste que prende os 48 e os 2 percentuais. Nada na régua mudou.

**Custo medido:** ~13 s de overhead fixo por corrida (espelho + embeddings + Pinecone) + **~10 s por
projeto**, 1 chamada de LLM cada. Os 48 do baseline levaram ~7 min em 4 requisições. ⚠️ Uma corrida
do PAINEL nos mesmos 48, a 30–36 chamadas/projeto, é **~1.500 chamadas** — o T6 precisa do teto de
custo e da retomada por página desde o primeiro commit, não como polimento.

**Vizinhança:** 48/48 vieram do **Pinecone** (`vizinhos_de.sqlite = 0`), 0 falhas — o índice está
vivo e o fallback não foi exercitado nesta medição.

## Tarefas

- **T1 — Harness de concordância (FAZER PRIMEIRO).** ✅ **FEITO** (`especiais-concordancia.ts` +
  `medirConcordanciaAgente` + `POST /api/admin/especiais/concordancia`), baseline medido acima. As **644 notas humanas** da coluna "Estrelas" são
  test set pronto. Medir o **agente ATUAL** contra elas: **MAE**, **% dentro de ±1**, matriz por faixa e
  a distribuição contra `CURVA_BASE`. Módulo PURO para as métricas + rota admin read-only. ⚠️ Sem este
  número não existe "melhorou" — existe opinião. (guarda: teste puro das métricas com casos fixos)
- **T2 — `TAXONOMIA_FUNCAO` + roteador.** ✅ **FEITO** (`especiais-funcao.ts` +
  `rotearEspeciaisPorFuncao` + `POST /api/admin/especiais/funcoes`), validado nos **51 especiais**.

  **12 funções declaradas, tiradas da base real** — nenhuma vazia, **0 indefinidas em 51**, e a
  função ATRAVESSA área (preço aparece em Growth e em Gobeaute; documento/fiscal em 3 áreas), que
  era a lição 2. Distribuição: criativo 14 · preço 6 · doc/fiscal 5 · atendimento 5 · gente 4 ·
  integração/alerta/painel/logística 3 cada · qualidade/plataforma-IA 2 · coleta 1.

  **O roteador é DETERMINÍSTICO (vocabulário, sem LLM)** — é o que garante "mesmo texto → mesma
  função" e, com isso, a comparabilidade entre corridas. Duas decisões que a MEDIÇÃO impôs:

  1. ⚠️ **Termo no NOME/"o que faz" vale 3× termo no corpo** (`PESO_TITULO`). Sem isso, **14 de 51
     (27%) empatavam em 1 termo × 1 termo** e o desempate errava: «Gobeaute Prompt Studio» virava
     *integração* por um "integrar" perdido na doc; «[VERSTA] Robo orçamento» virava *criativo* por
     um "ads"; «Hub Criativo» virava *gente e processo* por um "checklist"; «Ferramenta de comentar
     nos posts» virava *criativo* por "vídeo". Com o peso, os 4 acertam e os empates caíram a 8.
  2. ⚠️ **Vizinho do Pinecone NÃO desempata — só fala quando NADA casou.** Desempatando, ele decidiu
     13 de 51 e **errou ao menos 3** (é o que provocou os 2 primeiros erros acima). A evidência que
     se tem dele é `nome + leitura`, texto curtíssimo; evidência fina não pode vencer régua
     declarada. Depois da mudança ele decidiu **1** caso em 51 — vira rede, como deve ser.

  **Função ≠ nota (a prova que o roteamento não embute juízo):** dentro de `conteudo_criativo` as
  notas humanas vão de **0 a 10** (`[0,0,0,1,2,2,3,3,3,4,5,5,7,10]`), e em `preco_margem` de 0 a 8.
  Se a função predissesse a nota, o roteador estaria julgando em vez de rotear — e o T3 herdaria o
  viés. É justamente esse espalhamento que dá contraste ao avaliador: o PIAPP (10★) e o «Hub
  Criativo» (0★) são irmãos de função, e é comparando os dois que a lente aprende onde está a
  diferença. ⚠️ **Corolário para o T3/T4: agrupar por função NÃO reduz a variância da nota** — não
  contar com isso para o calibrador.
- **T3 — Avaliadores por lente.** ✅ **FEITO** (`src/lib/agents/especiais-lentes.ts`, 26 testes puros).
  **4 lentes declaradas**, cada uma com os `CRITERIOS` do seu eixo importados da régua e a lista
  explícita do que ela **NÃO** julga: `recorrencia_rastro` (recorrência + rastreabilidade +
  contrafactual) · `complexidade_autonomia` · `alcance_reuso` · `risco_evitado`. Os 2 critérios que
  não são eixo de valor (`Qualidade de execução`, `Especiais`) viram `CRITERIOS_GLOBAIS` e vão em
  TODAS as lentes — numa lente só, as outras três julgariam um especial como se fosse financeiro.
  ⚠️ **Teste de cobertura**: lentes ∪ globais tem de cobrir a régua inteira, então critério novo em
  `especiais-regua.ts` esquecido aqui **falha o teste** em vez de desaparecer do painel calado.

  Três decisões que os achados do T1 impuseram (não relitigar sem medir de novo):

  1. ⚠️ **Cada lente devolve um TETO do seu eixo, não um voto — e a consolidação NÃO usa média.**
     Média de N lentes **fabrica** a compressão para o meio que o T1 mediu (lente 0 + lente 4 = 2,
     e é exatamente o defeito: viés agregado −0,06 escondendo 0★ → +1,94 e 7★ → −7). `consolidarLentes`
     é PURA: `nota = min(teto, max(gate, maior lente de valor))` — **disjuntiva para cima** (a régua
     diz 4★ = "reuso multi-área **OU** risco material **OU** ganho estrutural": um eixo forte basta)
     e **conjuntiva no gate**.
  2. ⚠️ **A lente estrutural é GATE (teto), não mais uma opinião.** A `DERRUBA` inteira fala do eixo
     estrutural (peça única, POC, sem ponteiro nem contrafactual → 0–1) e o topo da régua é
     conjuntivo. Então complexidade técnica **não compra nota** sem recorrência com ponteiro
     nomeado. `MARGEM_ACIMA_DO_GATE = 1`, e o gate só empresta essa margem quando a prova dele é
     **`nomeada`**. Isso ataca o achado 3 do T1 de frente — **12 dos 17 zeros humanos** foram
     promovidos pelo agente único.
  3. ⚠️ **Prova é campo próprio (`evidencia: nomeada|vaga|ausente`), separada da confiança.**
     Confiança é o quanto o modelo acredita; evidência é o que dá para ir conferir. Dois guards
     determinísticos: `evidencia: 'ausente'` limita a própria lente a **1★** (`TETO_SEM_EVIDENCIA`
     — senão "provavelmente roda todo mês" compra 3★), e **`nomeada` sem o trecho copiado vira
     `vaga`** (alegar fonte é grátis, copiar o trecho não é — a mesma régua do `[1.4]`: substantivo
     de fonte, não verbo de verificação).

  Mais duas propriedades que o T6/T7 dependem: **lente que falha ≠ lente que deu 0** (falha vira
  `falhas` + `Consolidado.faltando`, para o T7 distinguir "julgou baixo" de "não julgou"), e
  **`opts.lentes` escolhe quais rodar** — é como a medição responde "2, 3 ou 4 lentes valem o
  custo" sem tocar no código. A função do T2 entra no prompt como CONTEXTO ("o que este grupo
  faz") com o aviso explícito de que grupo não prevê nota (dentro de uma função as notas humanas
  vão de 0 a 10).
- **T4 — Calibrador.** ✅ **FEITO** — parte PURA em `src/lib/especiais-calibrador.ts` (17 testes) e
  a redação da leitura em `src/lib/agents/especiais-calibrador.ts`.

  **DOIS mecanismos, porque o achado 3 do T1 diz que a tarefa é dupla** (segurar o topo **e** parar
  de promover o lixo — um calibrador só-histograma arruma a distribuição sem arrumar o PAR):

  1. **Piso de PROVA (por projeto, SEM curva).** `≥3` exige prova **nomeada** no eixo estrutural;
     `≥5` exige **2** eixos de valor sustentando ≥3 (o 5★ da régua é conjuntivo; um eixo forte
     sozinho é o 4★ "Prata alta"). Não depende da composição do lote, então não é fraudável por
     sorte de amostra — é o mecanismo que ataca os **12 dos 17 zeros** promovidos pelo agente único.
  2. **Cota por faixa (por rodada, contra uma curva de referência).** Nos 2 cortes que a régua
     NOMEIA (`LIMIARES_GENEROSIDADE`, ≥3 e ≥5), do corte mais alto para o mais baixo, rebaixando
     **do mais fraco para o mais forte** — `compararForca` põe a NOTA na frente da prova, e é isso
     que garante que a cota **nunca inverta a ordem** da rodada.

  Invariantes provados por teste: **nunca promove** (`depois ≤ antes` em qualquer entrada) · **não
  inverte a ordem** · rodada inflada volta para a curva · página pequena com **uma** prata legítima
  não é rebaixada (`MIN_POR_FAIXA`) · `aplicarCota:false` mede e RELATA sem mexer na nota (é como se
  comparam os 2 regimes no T7) · rodada vazia não lança.

  ⚠️ **Duas armadilhas da curva de referência, e as duas mudam o T7:**

  - **A `CURVA_BASE` NÃO é a referência de uma rodada de especiais** — MEDIDO no mesmo dia (achado 4
    do T1): ≥3 = **41,7%** nos especiais auditados contra **5,4%** na base inteira, 7× de diferença.
    O default virou a **`CURVA_ESPECIAIS_AUDITADOS`** (constante medida, com teste prendendo os 48 e
    os 2 percentuais); a curva segue **PARÂMETRO** (`opts.curva`/`rotuloCurva`, e o resumo declara
    qual usou), e `FATOR_TOLERANCIA` caiu de 2 para **1,25** — com a curva da própria população, a
    folga cobre variação de amostra numa página de 12, não diferença de população.
  - **Usar as notas humanas do conjunto SOB MEDIÇÃO como referência é VAZAMENTO** — e aqui os 48
    auditados são, ao mesmo tempo, a população e o gabarito. Por isso a corrida principal do T7 roda
    com **`aplicarCota: false`** (mede e RELATA); a cota com a curva dos especiais vale para a
    PRODUÇÃO, sobre os especiais ainda não auditados. `curvaDeNotas(notas)` existe para declarar a
    curva de outra população (a força-tarefa, um período anterior).

  A parte LLM só **redige** (nota + motivo já decididos entram prontos no prompt, que **proíbe**
  propor outra nota) e **nunca fica sem texto**: falha, vazio ou texto gigante caem no
  determinístico `explicarCalibragem`, com a nota idêntica.
- **T5 — Revisor adversarial + convergência.** ✅ **FEITO** — máquina PURA em
  `src/lib/especiais-convergencia.ts` + agente em `src/lib/agents/especiais-revisor.ts` (18 testes).

  As **4 travas anti-loop** deste repo, aplicadas a voltas de agente em vez de turnos de chat:
  **(1)** teto **absorvente** `TETO_VOLTAS = 3`; **(2)** máquina **estritamente monotônica** —
  `volta` só cresce e a nota **só desce** (empate ou sugestão para CIMA mantém a atual, decisão 4);
  **(3)** **terminal é NO-OP** — `aplicarRevisao` sobre estado encerrado devolve o MESMO objeto, o
  que torna impossível reabrir a discussão na fiação do T6; **(4)** o laço consulta o predicado
  `podeRevisarDeNovo`, nunca um `while (true)`. Guarda pedida pelo plano: **20 revisões que nunca
  aceitam TERMINAM** — e um laço INGÊNUO (sem o predicado) também para, porque o terminal é no-op.

  Duas decisões que valem registro: **nota abaixo do corte já nasce encerrada** (`sem_revisao` —
  refutar 1★ é gastar chamada) e **veredicto ILEGÍVEL vira REFUTAÇÃO, nunca aceitação** (aceitar por
  não entender a resposta carimbaria nota rara por acidente; o custo é limitado pelo teto). Nota que
  cai abaixo do corte durante a revisão encerra **sem** `contestada` — não há mais nota rara a
  defender, e contestar ali só sujaria o cartão da triagem.
- **T6 — Orquestração + rota admin + cron.** ✅ **FEITO** — `julgarEspeciaisComPainel` +
  `julgarUmEspecialComPainel` (`especial-classificador.functions.ts`, ao lado do T1/T2), montagem
  final PURA em `src/lib/especiais-painel.ts`, rota **`POST /api/admin/especiais/painel`** e cron
  **`POST /api/cron/painel-especiais`** (14 testes; `worker.js` rebuildado).

  **Três fases por corrida:** (1) por projeto — lentes em paralelo → pisos de prova → revisor;
  (2) por rodada — `calibrarRodada` sobre as notas que saíram do revisor (a cota é cross-projeto e
  só faz sentido com a página em mãos); (3) leitura + gravação em `especial_avaliacao` com
  `origem: 'painel-agentes'`.

  Decisões que o custo impôs (e que o T7 pode revisar COM número):

  1. ⚠️ **Uma volta re-roda o REVISOR, não as lentes.** O material do projeto não muda entre voltas —
     o que muda é o desafio, e quem tem de produzir argumento novo é o desafiante (ele recebe os
     argumentos já usados e é proibido de repetir). Re-rodar as 4 lentes por volta levaria de ~8 para
     ~15 chamadas/projeto sem nova evidência. Isso derruba a estimativa da decisão 6: **~8
     chamadas/projeto**, não 30–36 — os 48 do test set custam ~380 chamadas, não ~1.500.
  2. ⚠️ **Os pisos de prova rodam ANTES do revisor** — não se gasta chamada defendendo nota que a
     prova já derrubou.
  3. ⚠️ **A redação da leitura é OPT-IN** (`redigirLeitura`): sem ela a leitura sai determinística
     (`leituraDoPainel`, que nomeia a PROVA de cada eixo, não só a nota) e a corrida economiza 1
     chamada por projeto. Ligada, ela ainda respeita o teto.

  Travas: **`dry` é o DEFAULT** (gravar exige `{"dry":false}`, com teste) · **teto de custo por
  corrida** (`tetoChamadas`, default 120) que PARA a corrida e devolve `proximo_offset` do projeto em
  que parou · **nunca lança** (projeto que explode vira linha em `falhas` e a corrida segue) ·
  **nunca toca a coluna "Estrelas"** nem o Sheets · candidatos padrão são os especiais **sem
  recomendação e sem nota humana**, então o painel **não sobrescreve** o agente único (a tabela tem
  UMA linha por projeto — sobrescrever exige `forcar`, e o resultado conta `sobrescritos`).
  ⚠️ O cron existe mas **NÃO está agendado no Godeploy**: até o T7 passar, o painel roda pela rota
  admin. `soComNotaHumana: true` julga exatamente o test set do T7.
- **T7 — Medir o PAINEL no mesmo harness do T1 e comparar.** ⚠️ **É a trava de subida.** O juiz é
  PARÂMETRO de `medirConcordanciaAgente` (`opts.juiz`/`rotuloJuiz`) e `compararConcordancia` já aplica
  o critério 1 — o T7 é fiação, não código novo. Alvo a bater: **MAE < 1,69 E ±1 > 58,3%**, sem piorar
  o `erro_por_nota` das pontas. ⚠️ Depois do achado 4, o ganho tem de vir das **PONTAS** (parar de
  promover os 17 zeros e parar de esmagar 7★/8★/10★), não de "ficar mais duro" — o juiz já é
  conservador no topo. ⚠️ A corrida principal roda com **`aplicarCota: false`** (a curva de
  referência é a da mesma população que dá o gabarito; usá-la como cota na medição é vazamento). A
  corrida com cota entra como número secundário, para saber quanto a cota mexeria em produção.
  ⚠️ E o `erro_por_nota` do harness compara contra a curva da base: ao ler o relatório, a régua de
  generosidade é a `CURVA_ESPECIAIS_AUDITADOS`.

  **Fiação FEITA** (`medirConcordanciaPainel` + `POST /api/admin/especiais/concordancia`
  `{"juiz":"painel"}`, 2 testes): o painel entra como `opts.juiz` do harness do T1, que já monta o
  alvo, recupera a vizinhança **excluindo o próprio projeto** e calcula MAE / ±1 / matriz /
  `erro_por_nota`. Duas coisas que a fiação obrigou a arrumar:

  - ⚠️ **`JuizConcordancia` ganhou um 3º parâmetro** (`extra.funcao`, aditivo — o agente único
    ignora): a FUNÇÃO tem de sair do **mesmo texto** no harness e no lote, senão as duas corridas
    roteariam diferente e deixariam de ser comparáveis. O recipe (título = nome + "o que faz";
    corpo = o texto do embedding) virou **`funcaoDoMontado`**, fonte única — estava digitado 3×.
  - ⚠️ **Página de 5, não 15** (`PAGINA_CONCORDANCIA_PAINEL`): ~7 chamadas e até ~40 s por projeto
    (lentes em paralelo + até 3 voltas de revisor SEQUENCIAIS) — 12 numa requisição passariam de 8
    minutos. São ~10 requisições para varrer os 48.

  **Falta a MEDIÇÃO**, e ela só roda com o código na staging (o `/funcoes` do T2 respondeu 404 lá,
  então a staging está num build anterior a esta branch) → é o T8.
- **T8 — Staging → validar → prod (regra 13) + PR (regra 7).**

## T7 MEDIDO — o painel NÃO bateu o baseline (27/08/2026, staging, 48/48 pares, 0 falhas)

Rodado em 16 páginas de 3 com 4 em paralelo pelo `POST /api/admin/especiais/concordancia
{"juiz":"painel"}` (5 min de relógio; modelo `gpt-5.6-sol`). **O critério 1 não passou.**

| Métrica | Agente único (baseline) | Painel (T7) | Veredito |
|---|---|---|---|
| MAE | 1,69 | **1,65** | empate (−0,04 é o ruído que o achado 1 declara) |
| dentro de ±1 | 58,3% | **58,3%** | ❌ o critério exige MAIOR, deu IGUAL |
| nota exata | 29,2% | 31,3% | ganho pequeno |
| viés agregado | −0,06 | **−0,98** | o painel é DURO, e agora o agregado não engana |
| ≥3★ na rodada (população 41,7%) | 33,3% | **0%** | ❌ critério 2 estourado |
| ≥5★ na rodada (população 12,5%) | 6,3% | **0%** | ❌ |

**O painel nunca passa de 2★.** Nenhum dos 48 recebeu 3 ou mais. Erro por faixa do gabarito:
0★ **+0,88** (melhorou muito contra o +1,94 do agente único) · 1★ −0,33 · 2★ −0,13 · 3★ −1,55 ·
4★ −3,67 · 5★ −4 · 7★ −5 · 8★ −6 · **10★ −9** (PIAPP, humana 10 → painel 1). Ou seja: o painel
ACERTOU o fundo da distribuição e perdeu o topo inteiro — o oposto do agente único, que inflava
zeros e comprimia as pontas.

**Causa (uma linha, não a régua):** `agents/especiais-lentes.ts:345` —
`const margem = gateAv.evidencia === "nomeada" ? MARGEM_ACIMA_DO_GATE : 0`. Como `nomeada` só
sobrevive com trecho copiado (`MIN_SUSTENTACAO`, linha 254), a maioria dos projetos cai em `vaga`,
a margem vira **0** e o teto do painel = a nota do gate. O eixo de alcance não tem para onde subir.
⚠️ O que se mexe é o **teto/margem quando a prova é `vaga`** — **não** a régua, não a `CURVA_BASE`,
não a exigência de trecho copiado (é ela que consertou os zeros). Confirma em n=48 o sinal precoce
de n=2 registrado em 26/08.

**Situação:** nada sobe. O painel fica como ferramenta de auditoria (critério 1, 2ª frase) até a
margem ser recalibrada e a corrida repetida — a corrida custa 5 min e 0 intervenção, então medir de
novo é barato.

### Tentativa 1 (27/08/2026) — RESULTADO NEGATIVO: a curva no prompt da lente NÃO é o lever

Diagnóstico primeiro (`POST /api/admin/especiais/painel` `{dry, soComNotaHumana, aplicarCota:false,
limite:6}`), que mostrou o mecanismo e derrubou a suspeita registrada em 26/08 (a `MARGEM_ACIMA_DO_GATE`):

- **`nomeada` FUNCIONA** — a maioria das lentes devolve prova nomeada; não é o guard do trecho copiado.
- **Os pisos de prova nem mordem** — `motivos` volta **vazio** em todos os 6. Quem corta é o **teto da
  consolidação** (`teto = nota do gate + margem`), antes de o calibrador falar.
- **A lente-gate dá 1–2 em quase tudo**, e é ela o teto. Exemplo: «Integrações multi-plataforma de CRM»
  (humana 3) saiu gate `1/vaga` + alcance `3/nomeada` → teto 1 → **nota 1**: o eixo forte é descartado.

A hipótese testada foi que o **prompt** da lente mostrava a `CURVA_BASE` ("≥3★ é top 4% da base … na
dúvida fique na MENOR") — a população errada, o mesmo erro que o achado 4 corrigiu no calibrador em
26/08. Trocada pela `CURVA_ESPECIAIS_AUDITADOS` (com a constante movida para `especiais-regua.ts`,
porque o calibrador importa as lentes e o inverso seria ciclo) e **medida nos mesmos 48 pares**:

| | painel (curva da base) | painel (curva dos especiais) |
|---|---|---|
| MAE | 1,65 | **1,79** |
| dentro de ±1 | 58,3% | **54,2%** |
| ≥3★ | 0% | **0%** |
| zeros (viés) | +0,88 | **+1,18** |

**Revertido** (`b7f9266` reverte `e59d959`). Mexeu — os zeros se moveram, então o build estava no ar —
mas na direção errada, e o teto de 2★ não cedeu. ⚠️ **Não retentar esta hipótese**: a moldura de
população no prompt não é o que segura o painel.

**O que sobra como trava, para a próxima tentativa** — são DUAS, em série, e qualquer uma sozinha já
impede o 3★:
1. `consolidarLentes` (`agents/especiais-lentes.ts:345`): `teto = gate + (nomeada ? 1 : 0)`. Com gate
   1–2, teto 1–3. Um eixo de valor 4 com prova nomeada não sobe nada.
2. `aplicarPisosDeProva` (`especiais-calibrador.ts:110`): **≥3 exige prova `nomeada` no eixo
   ESTRUTURAL**. Mesmo com margem, gate `vaga` volta para 2.
⚠️ Mexer nisso é mexer na semântica da **decisão fechada nº 2** (gate conjuntivo: "nada sobe sem
recorrência com ponteiro") — é decisão de produto, não calibragem. As opções são: dar margem ao eixo
de VALOR com prova nomeada mesmo com gate `vaga`; rever a régua da lente-gate (que dá 1–2 em tudo);
ou aceitar o critério 1 na 2ª frase (painel = ferramenta de auditoria, classificador segue padrão).

### Tentativa 2 (27/08/2026) — prova nomeada em eixo de VALOR: destravou o teto, NÃO destravou o 3★

Decisão do Kaique com a medição na mesa (afrouxar o gate conjuntivo da decisão fechada nº 2):
`MARGEM_VALOR_NOMEADO` em `consolidarLentes` + o piso de ≥3 aceitando prova nomeada em QUALQUER eixo
(`aplicarPisosDeProva`). Commit `d4ad1e3`, 2028 testes.

| | baseline | painel original | +curva (revertida) | +margem emprestada |
|---|---|---|---|---|
| MAE | 1,69 | 1,65 | 1,79 | **1,75** |
| dentro de ±1 | 58,3% | 58,3% | 54,2% | **52,1%** |
| ≥3★ | 33,3% | 0% | 0% | **0%** |
| viés | −0,06 | −0,98 | −0,92 | **−0,83** |

**Mexeu no topo** — PIAPP 1★→2★, CTR machine 1★→2★, 4★ passou de −3,67 para −3,33 — mas **nenhum
projeto chegou a 3★**, e o ±1 caiu. O teto deixou de ser a trava e algo DEPOIS dele segura.

**Suspeito nº 1 para a tentativa 3: o revisor adversarial (decisão fechada nº 4).** Ele revisa **toda
nota ≥3** com prompt de REFUTAR e, no empate, **mantém a nota MENOR** — se a consolidação libera 3 e o
revisor derruba, o efeito medido é exatamente este: 0% de ≥3★ com o teto já aberto. ⚠️ **Confirmar
ANTES de mexer**, com `POST /api/admin/especiais/painel {dry:true, soComNotaHumana:true,
aplicarCota:false, limite:2..3}` e lendo `nota_lentes` → `nota_pos_prova` → `nota` + `voltas` +
`encerramento`: se `nota_lentes ≥ 3` e `nota` = 2, é o revisor; se `nota_lentes` continua 1–2, o
problema é a régua da lente-gate. ⚠️ `limite:6` estourou o tempo da requisição (`Failed to fetch`) —
usar 2 ou 3.

⚠️ **O diagnóstico ficou pendente por falta de janela na staging:** às **20:13** outra sessão
deployou a "Frente 1 (doc assíncrona)" no `edf400b4` (version 245) e a rota do painel passou a dar
**404** — rota commitada ≠ rota no ar. A medição acima já tinha fechado, então os números valem; o
follow-up precisa de um novo deploy da branch (combinar com quem estiver medindo).

### DIAGNÓSTICO DEFINITIVO (28/08/2026) — o gargalo são AS LENTES; teto, piso e revisor nunca entram

`POST /api/admin/especiais/painel {dry:true, soComNotaHumana:true, aplicarCota:false, limite:3}`,
staging com o HEAD `eedb853`, 12 chamadas, 0 falhas:

| projeto | humana | eixos (nota/prova) | lentes | pós-prova | final | voltas |
|---|---|---|---|---|---|---|
| Integrações multi-plataforma de CRM | 3 | recorrência **1/vaga** · complexidade 2 · alcance 2 · risco 1 | 1 | 1 | 1 | 0 |
| BB Indústria QC | 0 | 2 · 2 · 1 · 2 (todas nomeadas) | 2 | 2 | 2 | 0 |
| Hub Criativo | 0 | **1/vaga** · 2 · 2 · 1 | 1 | 1 | 1 | 0 |

`encerramento` das três: **"nota abaixo do corte de revisão — não passou pelo revisor adversarial"**,
`motivos: []`. Isto **elimina** os três suspeitos anteriores de uma vez:

- **não é o revisor** (decisão nº 4): a nota nunca alcança o corte de ≥3, então ele nem roda;
- **não é o piso de prova** (`motivos` vazio nas três);
- **não é o teto da consolidação**: `nota_lentes` já é 1–2 — o teto não tem o que cortar.

**É a RÉGUA que cada lente recebe.** O prompt entrega a régua **global** (`NIVEIS`) e pergunta "a nota
mais alta que o SEU eixo sustenta". Mas as âncoras de 3★ para cima descrevem o **projeto inteiro**
(plataforma/produto interno, várias áreas usando, autonomia, ponteiro auditável) — propriedades que um
eixo ISOLADO quase nunca pode alegar sozinho. Cada lente responde 1–2 corretamente **dentro da
pergunta que recebeu**, e a soma das partes nunca chega ao todo. ⚠️ **Consequência para as tentativas
1 e 2: as duas mexeram a jusante do gargalo** — daí não terem movido o ≥3★ (a 2 mexeu no topo porque
mudou o teto de quem já tinha 2, nada mais).

**As duas saídas reais (decisão de produto, não calibragem):**
1. **Âncoras POR EIXO** — cada lente recebe o que 0/1/2/3/4/5 significam **no eixo dela** (ex.: alcance
   3 = "2+ áreas usam", 4 = "área inteira depende", 5 = "virou plataforma de terceiros"), em vez da
   régua global. É a correção mais fiel à decisão nº 2 (lentes distintas, sem média) e a que a
   evidência aponta. Custo: escrever 4 réguas curtas na fonte única (`CRITERIOS`/`NIVEIS` da régua).
2. **Consolidação que compõe** em vez de tomar o máximo com teto — mexe na decisão nº 2 e reintroduz o
   risco de média/compressão que o T1 mediu (viés −0,06 escondendo +1,94 nos zeros). **Não recomendada.**

⚠️ **O que NÃO tentar de novo:** curva no prompt (tentativa 1, medida e revertida) · teto/piso/margem
(tentativa 2, medida: mexe no topo mas não cria 3★) · revisor adversarial (este diagnóstico: nem roda).

### Tentativa 3 (28/08/2026) — ÂNCORAS POR EIXO (a saída nº 1 do diagnóstico) — implementada, A MEDIR

Cada lente deixou de receber a régua **global** (`NIVEIS`, que descreve o projeto INTEIRO) e passou a
receber **as âncoras do eixo dela**: `Lente.ancoras` em `agents/especiais-lentes.ts`, 7 níveis (0–5 e
7) por lente, renderizadas por `descreverAncoras(lente)` no lugar de `descreverNiveis()`.

O que cada 3★ virou, por eixo — é aqui que o gargalo se desfaz:

| eixo | 3 no eixo (antes: "inteligência + recorrência + evidência + adoção", que é o projeto todo) |
|---|---|
| recorrência/rastro (gate) | roda sozinho, ponteiro com nome próprio, gente de FORA do autor depende |
| complexidade | inteligência DENTRO do fluxo (IA/modelo/heurística decide algo que entra no processo) |
| alcance | pessoas de fora do time do autor usam de fato, e dá para nomear quem |
| risco | risco material nomeado (multa, juros, prazo contratual, perda de dado) com valor ou ocorrência |

⚠️ **A régua global NÃO saiu do prompt inteira** — sairia junto a leitura dos vizinhos do few-shot,
que carregam nota **global**. Entrou `descreverEscalaGlobalCurta()`: só os **TÍTULOS** (`0 Não pontua ·
1 Útil e local · … · 5 Ouro …`), explicitamente "só para LER a nota dos vizinhos, não responda por
ela". São as **definições** de 3★+ que travavam, não os rótulos. `DERRUBA`, curva da base e "na dúvida
fique na MENOR" ficam **intactos** — os freios contra inflação são os mesmos da medição anterior, para
que a diferença medida seja das âncoras e de mais nada.

⚠️ **Nada mudou na régua** (`especiais-regua.ts` segue fonte única do que uma ESTRELA é) nem na
consolidação, no piso de prova ou no revisor — as âncoras traduzem a mesma escala por eixo, e a nota
consolidada continua comparável com a humana. É a fronteira do plano ("não mexer na régua para fazer o
painel passar") respeitada de propósito.

Testes (5 novos, 2033 no total): as âncoras cobrem 0..5 em ordem e sem repetir · a âncora de cada nota
é **diferente** entre as lentes (se duas lentes dizem o mesmo, o eixo não é um eixo) · o prompt traz as
âncoras da lente e **não** as das outras · **nenhuma definição global de 3★ para cima aparece no
prompt** (é o gargalo, preso por teste) · a escala global aparece só em títulos.

**Pendente: medir.** `POST /api/admin/especiais/painel {dry:true, soComNotaHumana:true,
aplicarCota:false, limite:3}` na staging, comparando `nota_lentes` com a tabela do diagnóstico (os
mesmos 3 projetos: CRM 1/vaga, BB Indústria 2, Hub Criativo 1/vaga) — se as lentes continuarem em 1–2,
a hipótese das âncoras cai junto com as outras três. Passando disso, rodar o T7 nos 48 pares.
⚠️ A staging está com o build de OUTRA branch (Frente 1, doc assíncrona): **redeployar `edf400b4` com
esta branch antes de medir**, senão a rota do painel dá 404 (aconteceu em 27/08). ⚠️ `limite:6` estoura
o tempo da requisição — usar 2 ou 3.

## Critérios de aceitação

1. O painel **bate o baseline do agente único** no test set (48 especiais com nota humana): **MAE
   menor E % dentro de ±1 maior**, sem piorar o `erro_por_nota` das pontas. Não bateu → não vira
   padrão; entra como ferramenta de auditoria e o T7 registra o número.
2. A distribuição das recomendações é comparada com a **`CURVA_ESPECIAIS_AUDITADOS`** (≥3 = 41,7%,
   ≥5 = 12,5% — medida 26/08/2026), **NÃO** com a `CURVA_BASE`. ⚠️ Reescrito depois da medição: o
   critério antigo ("não ficar mais generosa que a `CURVA_BASE`") empurraria o painel a ser ainda
   mais duro que um juiz que já é conservador no topo — seria otimizar na direção errada. O que
   reprova aqui é **distância** da curva da população, para qualquer um dos dois lados.
3. Nenhuma escrita na coluna "Estrelas"; tudo em `especial_avaliacao` com `origem: 'painel-agentes'`.
4. Roda em lote, retomável, com teto de custo; **nada** entra no caminho pós-submissão.
5. Loop com teto absorvente provado por teste de simulação que NÃO converge.

## Fronteiras (não exceder)

- **Não mexer na régua** (`especiais-regua.ts` é fonte única) nem na `CURVA_BASE` para "fazer o painel
  passar" — isso é fraudar o próprio instrumento.
- **Não trocar o classificador pós-submissão** antes do T7 passar.
- **Não rotear por área** (lição 2) e **não deixar o LLM inventar a taxonomia** a cada corrida (decisão 1).
- Não tocar Sheets. Não `process.env` em escopo de módulo. Nunca lançar no caminho de background.

## Blast-radius

Arquivos novos: taxonomia de função, avaliadores, calibrador, revisor, orquestrador do painel, harness de
métricas · Tocados: `especial-classificador.functions.ts` (convivência), `worker.ts` (rotas/cron),
`especial_avaliacao` (nova `origem`, sem migração) · Invariantes: coluna Estrelas só por clique humano ·
anti-feedback-loop (rótulo humano vence) · embeddings só OpenAI · staging antes de prod ·
**Confiança: ALTA** na topologia (pipeline já executado), **MÉDIA** no ganho (é o que o T1/T7 medem).
