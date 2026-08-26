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
| 3 | Calibrador | **OBRIGATÓRIO e determinístico onde der.** Reescala a distribuição da RODADA contra `CURVA_BASE`. Rodada mais generosa que a curva = defeito do juiz, não da base (a própria régua diz isso). |
| 4 | Revisor adversarial | Sobre **toda nota ≥3** (é o que a força-tarefa fez, e 3★ já é top 4%). Prompt de REFUTAR, não de confirmar; empate mantém a nota MENOR. |
| 5 | Teto de voltas | **3**, absorvente. Não convergiu → grava a nota do calibrador + **`contestada: true`** (campo que já existe) e segue. ⚠️ Loop sem teto absorvente é o erro que este repo já cometeu 3× (gate `[1.4]`, carga×escala, ganho projetado). |
| 6 | Onde roda | **BATCH, jamais pós-submissão.** ~4 lentes × 3 voltas + roteador + calibrador + revisor ≈ **30–36 chamadas/projeto** contra 1 hoje. Rota admin + cron, paginada e retomável (mesmo padrão do backfill do Pinecone: `proximo_offset`). |
| 7 | Convive com o classificador de hoje? | **Sim.** O painel grava em `especial_avaliacao` com `origem` PRÓPRIA (`painel-agentes`); o classificador de 1 agente continua sendo o caminho pós-submissão e o fallback. Trocar o padrão só depois do T7. |
| 8 | Escreve nota? | **NUNCA.** Coluna "Estrelas" só por clique humano — invariante do projeto inteiro, não desta fatia. |

## Decisões que só a MEDIÇÃO fecha (T1 antes de T2)

- **Quantas lentes** (3 ou 4) e **quantas voltas** valem o custo. Se 2 lentes já batem o baseline, 4 é
  dinheiro fora.
- **Se o painel ganha do agente único.** ⚠️ É possível que não ganhe. O T7 é uma trava real: sem ganho
  medido, o painel **não vira o padrão** — vira ferramenta de auditoria em lote e o classificador segue.

## Tarefas

- **T1 — Harness de concordância (FAZER PRIMEIRO).** As **644 notas humanas** da coluna "Estrelas" são
  test set pronto. Medir o **agente ATUAL** contra elas: **MAE**, **% dentro de ±1**, matriz por faixa e
  a distribuição contra `CURVA_BASE`. Módulo PURO para as métricas + rota admin read-only. ⚠️ Sem este
  número não existe "melhorou" — existe opinião. (guarda: teste puro das métricas com casos fixos)
- **T2 — `TAXONOMIA_FUNCAO` + roteador.** Constante declarada (fonte única) + classificação da função do
  projeto usando os vizinhos do Pinecone como evidência. (guarda: teste puro; função estável entre
  corridas para o mesmo texto)
- **T3 — Avaliadores por lente.** N prompts derivados dos `CRITERIOS` da régua — **não redigitar a régua**,
  importar de `especiais-regua.ts`. Saída estruturada (nota + justificativa + o que a sustenta).
- **T4 — Calibrador.** Reescala a rodada contra `CURVA_BASE`. Parte PURA (a reescala) separada da parte
  LLM (a redação da leitura). (guarda: rodada artificialmente inflada volta para a curva)
- **T5 — Revisor adversarial + convergência.** Refuta toda nota ≥3; teto de 3 voltas absorvente; sem
  consenso → `contestada`. (guarda: simulação de N turnos que NÃO converge termina — o teste que pegou o
  loop do gate de sobreposição)
- **T6 — Orquestração + rota admin + cron.** `dry` default, paginado, retomável, nunca lança, teto de
  custo por corrida. (guarda: `dry` não grava nada)
- **T7 — Medir o PAINEL no mesmo harness do T1 e comparar.** ⚠️ **É a trava de subida.**
- **T8 — Staging → validar → prod (regra 13) + PR (regra 7).**

## Critérios de aceitação

1. O painel **bate o baseline do agente único** no test set das 644 notas (MAE menor **e** % dentro de ±1
   maior). Não bateu → não vira padrão; entra como ferramenta de auditoria e o T7 registra o número.
2. A distribuição das recomendações **não fica mais generosa que `CURVA_BASE`** — é o sintoma nº 1 de
   inflação, e a régua diz explicitamente que aí o defeito é do juiz.
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
