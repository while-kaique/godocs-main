# Régua de estrelas 0–10 + time unificado de agentes avaliadores

**Status:** régua ✅ **validada pelo Luis (02/09/2026)** · arquitetura dos agentes = planejamento aberto
**Branch:** `feat/avaliadores-unificados` · worktree `~/godocs-wt-avaliadores` (base `origin/main` `51f3fd2`)

---

## 1. O problema

A estrela existia, valia 0–10 e não tinha régua escrita. `PIAPP` era 10 porque era o maior, e todos os
outros foram posicionados por comparação com ele — nota sem denominador. A triagem humana não tinha
contra o que comparar, e o agente classificador (peça 4, em prod) recebia no prompt definições
CIRCULARES (`10 = "topo absoluto"`, `6 = "o mesmo do 5, com alcance acima da média"`), que não
discriminam nada.

Três causas medidas, em ordem de impacto:

1. **A régua do prompt era circular** — os critérios não existiam em lugar nenhum do código.
2. **O corpus do RAG eram 66 especiais e nenhum 0★** — os 498 projetos não-especiais já notados
   (incluindo 414 zeros) ficavam de fora, então o agente nunca viu o chão da escala e inflava.
3. **O eixo que decide a nota é o único que o formulário não pergunta** — alcance, autonomia,
   dependência. Está em prosa escrita pelo autor, que é parte interessada na nota.

---

## 2. Decisões fechadas (conversa com o Luis, 02/09/2026)

- **D1 — A estrela é para impacto DIFÍCIL DE MENSURAR.** Ganho mensurável tem fórmula própria
  (v2: `1,0·S + 0,5·CE + 0,1·R − C`) e não precisa de estrela. A estrela paga o que a fórmula não vê.
- **D2 — 1★ a 5★ é do AGENTE, determinístico, "tiro certo".** 6★ a 10★ é RARO e só sai por
  **comitê humano**; o agente reconhece o caso, encaminha e SUGERE a posição para ajudar o humano.
- **D3 — Nada vence dinheiro como motor da empresa, mas os CRITÉRIOS não citam valor.** Nenhuma
  faixa de R$ na régua: são projetos imensuráveis por definição.
- **D4 — Cada critério é AUTOSSUFICIENTE.** Proibido "o mesmo do anterior, porém…". Proibido
  adjetivo sem régua ("relevante", "material", "alto impacto").
- **D5 — Não se define critério olhando a base.** Régua derivada dos projetos existentes premia o
  formato deles e reprova quem é de outra área. Definir cego, conferir depois.
- **D6 — Estrela vale para TODO projeto, não só para o especial declarado.** A flag deixa de ser
  escolha do autor: quem recebe estrela É especial, por consequência.
- **D7 — Descontinuado é soft delete.** Fora de qualquer contagem, corpus ou avaliação.
- **D8 — Ressubmissão do mesmo escopo não pontua.** Verificável no espelho (existe outra linha do
  mesmo projeto com ganho medido? esta não recebe estrela).
- **D9 — Os 4 projetos com nota humana 6–10 são ÂNCORA CONGELADA** (Luis, 02/09/2026). A régua não
  os rebaixa, nem agora nem depois. Eles seguem no corpus como exemplares.
- **D11 — Discordância da âncora vira CONTESTAÇÃO registrada, nunca mudança de nota.** Quando o
  projeto tem nota humana e a régua chega a um nível menor, o agente grava
  `contestacao: { nota_humana, nota_regua, criterio_aplicado, gatilho_que_falhou, racional, evidencia }`
  — **racional CONCISO, no máximo 2 frases**, e o gatilho que falhou tem de ser NOMEADO com a
  citação da doc (ex.: *"o processo manual anterior existia — 300h/mês declaradas"*). Não altera
  nada, não aparece para o autor: vai para uma fila de revisão do comitê.
- **D12 — Queda em massa para a mesma prateleira é suspeita da RÉGUA, não dos projetos.** Muitos
  projetos convergindo para o mesmo nível é o sintoma de achatamento que esta frente existe para
  evitar (foi o defeito dos "10 critérios somados"). O relatório do retroativo é obrigado a emitir
  um **racional AGREGADO** acima das notas individuais: quando **mais de 50% das quedas apontam
  para o MESMO nível de destino**, o lote é marcado como *achatamento suspeito* e o critério é
  revisado antes de qualquer queda ser aceita.
- **D12b — O aprendizado é sobre a RÉGUA, nunca sobre os rótulos.** As análises acumuladas (e as
  contestações) alimentam o ajuste dos critérios e do prompt, por decisão humana. O corpus do RAG
  continua crescendo **só com nota humana** — aprender das próprias saídas é o feedback loop que a
  peça 4 já evita (`rotuloExemplar`).
- **D10 — Um time só de agentes.** Os times separados (padrões × especiais) se unem e entram em
  consenso sobre dar estrela ou não, e sobre o valor declarado.

---

## 3. A RÉGUA (fonte única — não redigitar em prompt nem em tela)

### 0★ — não recebe estrela
Basta um: o ganho é **mensurável** com o que está descrito (volta como saving/receita) · **ninguém
além do autor** usa de forma recorrente · é tarefa **simples e local** que uma planilha resolveria
sem mudar decisão · **não está em uso** (descontinuado, POC, parado) · é **ressubmissão** do mesmo
escopo.

### 1★ a 5★ — faixa do agente
**Princípio ordenador:** quanto da cadeia `informação → ação → consequência` o projeto assume.

| ★ | Verbo | Critério |
|---|---|---|
| **1** | **Informa** | Produz o insumo, não a ação. Entrega dado, visibilidade, alerta, registro ou esforço poupado; alguém lê e age. Sem ele, a informação volta a ser buscada à mão. |
| **2** | **Executa** | Assume a ação recorrente ponta a ponta e roda sem alguém iniciar. Não escolhe o que fazer — faz. **Volume não muda o nível.** |
| **3** | **Garante** | Assume a barreira: impede que o erro passe (valida, bloqueia, exige registro, torna auditável o que era julgamento de cada um). A consequência evitada recai sobre outra pessoa ou área, não sobre quem fez. |
| **4** | **Decide** | Assume a escolha que compromete recurso da empresa, por regra explícita e auditável. O erro dele tem consequência direta, mesmo que alguém aprove no fim. |
| **5** | **Responde pelo resultado** | Está no caminho pelo qual o resultado chega ao cliente, ao fornecedor ou ao mercado, e não há intermediário humano entre a falha dele e o prejuízo. Seu alcance passa da área que o criou. |

**+1 nível (teto 5★):** outro processo ou projeto passa a depender dele como fonte, com o
**dependente NOMEADO**. Não vale "poderá ser consultado" nem "abre portas para".

### 6★ a 10★ — escape (agente indica, comitê decide)
**Princípio ordenador:** deixa de medir quanto de um processo o projeto assume e passa a medir
**quantos processos existem por causa dele e quão irreversível é a dependência.**

**Gatilho — os DOIS têm de ser verdade:**
1. Existe atividade em curso hoje que **não existiria** sem ele. Não "seria mais lenta": não existiria.
2. Removê-lo **não devolve o estado anterior** — o jeito antigo deixou de existir como opção.

Faltando um, a nota é 5★.

| ★ | Verbo | Critério |
|---|---|---|
| **6** | **Habilita** | Torna possível um processo que não existia. Há gente fazendo algo novo por causa dele, não algo antigo melhor. |
| **7** | **Suporta** | Vários processos já rodam sobre ele, e nenhum deles tem alternativa em uso. |
| **8** | **Concentra** | Virou o único ponto por onde aquilo acontece na empresa. Não há caminho paralelo, nem manual. |
| **9** | **Redefine** | O padrão de operação mudou por causa dele — o jeito anterior deixou de ser referência para quem entra hoje. |
| **10** | **Funda** | Outros projetos existem só porque ele existe, e a empresa passa a organizar decisões em torno dele. |

**Saída obrigatória do agente no escape:** `faixa 6-10 · sugestão N★ · os 2 gatilhos, cada um com a
evidência CITADA da doc · o que falta para N+1 · confiança`. Sem evidência citada o escape não vale
— é o que impede o agente de mandar tudo ao comitê por entusiasmo.

---

## 4. O que foi DESCARTADO (não repetir)

| Tentativa | Por que caiu |
|---|---|
| **Faixas de R$/ano por estrela** | os limiares saíram errados por uma ordem de grandeza (o corte "< 60k = 1–2★" cobria 95% da base) e a régua não pode citar valor (D3). |
| **10 critérios binários somados (1 estrela cada)** | contagem de peso igual ACHATA: `CX - Ticket Creator` empatava com `PIAPP`, separados por duas ordens de grandeza. |
| **Escada por consequência do desligamento** | comprimia o topo inteiro em 5★, inclusive o `PIAPP`. |
| **Classe de artefato (dashboard/agente/plataforma) como campo do formulário** | (a) o agente INFERE a classe do nome+descrição+doc melhor que o autor a declara; (b) campo autodeclarado numa lista onde uma opção paga mais é convite à inflação. |
| **"Mais de uma marca" no critério do topo** | é traço da nossa empresa (grupo multi-marca), não de impacto: rejeitava `Remessa Conforme`, que abre uma vertical de receita própria. |
| **Critério "está em produção"** | é pré-requisito da submissão: 100% atende, logo não discrimina. |
| **Nível 1★ = "conveniência"** | a classe nascia vazia (o único ocupante estava descontinuado). |

---

## 5. Estado medido da base (planilha de prod, aba `GoDocs`, 02/09/2026)

- **734 linhas** · **567 com nota** · curva: `0★=414 · 1★=75 · 2★=32 · 3★=25 · 4★=10 · 5★=4 · 7★=2 · 8★=1 · 10★=1`. **Nunca houve 6★ nem 9★.**
- **`Especial? = Sim`: 71** → **6 descontinuados** → **65 ativos** (62 com nota, 3 nunca auditados).
- **Ganho anual** (`(Saving Reais + Receita/10) × 12`, 667 projetos > 0): mediana **R$ 5,7k** · p90 **R$ 41k** · p95 **R$ 74k** · p99 **R$ 204k** · topo **R$ 3,8M** (`SmartOnline`) · a base inteira soma **R$ 19,5M/ano**.
- **Armadilha real:** 3 dos zeros eram **duplicatas** — `Painel de S&OE`, `Bot de Faturamento` e
  `Hub Criativo` entraram como especial (ganho 0) e voltaram como **v2 não-especial com ganho
  medido**. Sempre conferir se existe outra linha do mesmo projeto (D8).
- **As notas humanas NÃO seguem dinheiro:** `Gocontent Machine` tem R$ 764k/mês validado em A/B e
  está em 4★; `CX - Ticket Creator` tem ~R$ 40k/mês estimado e está em 5★.

---

## 6. Aplicação da régua nova (medida, 65 ativos)

| | Hoje | Régua nova |
|---|---|---|
| 1★ Informa | 12 | 21 |
| 2★ Executa | 16 | 18 |
| 3★ Garante | 18 | 9 |
| 4★ Decide | 8 | 7 |
| 5★ Responde | 4 | 6+3 |
| 6–10★ | 4 | 1 (`PIAPP`) + 1 candidato (`Gocontent Machine`) |
| sem nota | 3 | 0 |

**Deslocamentos que exigem decisão:**
- `Robo orçamento` (8★), `GoBrands` (7★) e `CTR Machine` (7★) **não passam o gatilho** e caem para
  **5★**: tornaram algo mais rápido, não possível (o manual existia — 300h/mês, 6 dias por PR). → D9.
- `Gocontent Machine` **4★ → 6★** (a camada de conteúdo das 7 lojas não existia; o processo de
  11,5h por produto entre 5 times não é retomável).
- Sobem: `SAIBBI`, `Checklist de turno`, `Abastecimento de tinta`, `Assinatura de Romaneios`,
  `Order Bump` → **3★ Garante** (a fábrica era a lacuna da régua antiga).
- Caem: `Gopilot` 4★→1★ (só sugere) · `Robo subir vídeos` 5★→2★ (volume, nenhuma decisão) ·
  `Benchmark de Estampas` 4★→2★ (executa; quem decide o portfólio é gente) · `Argos` 3★→1★ (CDP
  sem dependente nomeado é base de dados).

⚠️ **Este §6 foi produzido por quem JÁ HAVIA LIDO os 65 especiais** — está contaminado por
construção. A validação honesta é aplicar a régua nos **498 não-especiais já notados**, que não
foram lidos, e conferir se a distribuição tem a mesma forma. **Tarefa T1.**

---

## 7. Arquitetura — 3 cérebros

O que já existe em `main` e é reaproveitado:

- **Mesa determinística de normais** (`avaliacao-normais.functions.ts`): 4 votos — FTE
  (`analyzer.ts`), Financeiro (`avaliacao-financeira.ts`), RAG de aprovados
  (`avaliacao-corpus.ts`), Cético (`cetico-avaliacao.ts`).
- **Especialistas LLM por dimensão** (`especialista-avaliacao.ts` + `.functions.ts`), ligados pela
  flag `AVALIACAO_MESA_LLM`; ponte pura em `mesa-especialistas.ts`; conciliação em
  `agregador-avaliacao.ts`; parecer em `mesa-parecer.ts`.
- **Classificador de especiais** (`agents/especial-classificador.ts` + `especial-corpus.ts` +
  `especiais-regua.ts`), RAG por embeddings (`embeddings.ts`, `pinecone.ts`).
- **Retroativo** (`avaliacao-retroativa.ts`): baldes `acerto` · `conservador` · `erro_grave` · `sem_base`.

### Cérebro A — MÉRITO (o que a mesa de normais já faz)
Pergunta: *o projeto é válido e o valor declarado é plausível?* Votos FTE + Financeiro + RAG de
aprovados + Cético. Saída: `aprovar` | `em_validacao` + **auditoria de valor** (o valor está
absurdo? qual seria o valor defensável e por quê).

### Cérebro B — ESTRELA (o classificador, reescrito na régua nova)
Pergunta: *qual nível da régua?* Aplica o piso 0★, os 5 critérios, a promoção `+1` e o gatilho do
escape. RAG: exemplares com **nota HUMANA** (nunca a própria recomendação — anti-feedback-loop,
`rotuloExemplar`), agora incluindo **os não-especiais** (é o chão da escala que faltava).

### Cérebro C — CONSENSO (novo, o único que vê tudo)
Não distingue especial de padrão. Recebe os pareceres de A e B e produz **um** veredito:

```
{ estrela: 0..5 | escape:{faixa:"6-10", sugestao:N},
  vale_estrela: bool,          // estrela >= 1  =>  o projeto É especial (D6)
  veredito_merito: "aprovar" | "em_validacao",
  valor: { absurdo: bool, valor_sugerido?: number, justificativa: string },
  criterio_aplicado: "informa|executa|garante|decide|responde|escape",
  evidencias: [ "citação da doc que sustenta o critério" ],
  confianca: "alta" | "media" | "baixa",
  divergencias: [ ... ] }
```

**Regras do consenso (fail-closed, herdadas do agregador):**
- **Divergência entre A e B, ou confiança baixa → fila humana.** O consenso nunca fecha um desfecho
  negativo sozinho.
- **Escape 6–10 sempre vai ao humano**, com a sugestão de posição.
- **Estrela nunca é gravada na coluna "Estrelas"** — a nota só muda por clique de gente.
- **Projeto com nota humana não é reclassificado** (é âncora e exemplar do corpus). Discordância
  vira **contestação** (D11): 2 frases, gatilho nomeado, evidência citada — nunca nota nova.
- **Sem evidência citada da doc, o critério não vale** — cai um nível ou vira `baixa`.

### Confiança — como se calcula (declarado, não sentido)
`alta` só quando: A e B concordam · o critério tem evidência citada · há vizinhos no RAG acima do
piso de similaridade. Falta um → `media`. Faltam dois, ou o texto do projeto é ausente/vago →
`baixa`. **Escape e `baixa` sempre vão ao humano.**

---

## 8. Retroativo e RAG

O retroativo tem **três** saídas por projeto, não uma:
1. **Estrela recomendada** vs. nota humana → distância `|rec − humana|` (novo balde, ao lado dos 4
   de `avaliacao-retroativa.ts`).
2. **Veredito de mérito** vs. Status humano → baldes `acerto` / `conservador` / `erro_grave`.
3. **Auditoria de valor** — o ganho declarado é absurdo? Com valor sugerido e justificativa, depois
   do racional dos especialistas e do consenso. Roda **também nos já aprovados**.

**Alimentação do RAG:** o resultado do retroativo **não** entra no corpus como rótulo (seria
aprender da própria saída). O corpus só cresce com **nota humana** — inclusive as que o comitê der
depois de revalidar os deslocamentos do §6.

---

## 9. Backlog do Luis (5.1–5.7) → onde cada item aterrissa

| Item | Onde | Estado |
|---|---|---|
| **5.1** Consolidar orquestrador + sub-agentes; ser crítico em aprovar × reprovar | Cérebro A (mesa que já existe) + **T5** (consenso) | aberto |
| **5.2** Campo "é feature de projeto existente?" na submissão | **fora desta worktree** — é fluxo de submissão (`feat/godocs-v2`) | fronteira |
| **5.3** Função AGLUTINADORA: projeto novo que é feature de projeto antigo | **T10** (novo) | aberto |
| **5.4** Categorização (tipo × nível) | `categorizacao-projeto.ts` | ✅ **feito** |
| **5.5** Critérios objetivos das estrelas 1–10 | `estrelas-regua.ts` (§3) | ✅ **feito** |
| **5.6** Agente avaliador nos especiais | **T4** (cérebro B na régua nova) | aberto |
| **5.7** Varredura dos já aprovados: aglutinar e recalcular impacto | **T7** + **T10** | aberto |

⚠️ **5.2 é a contraparte da 5.3 e vive na outra frente.** A aglutinação funciona sem ela (detecta
por similaridade), mas com o campo declarado ela fica muito mais barata. Quem for implementar o
formulário na `feat/godocs-v2` precisa saber que este lado consome isso.

⚠️ **O NÍVEL da 5.4 não é coluna nova:** é a `Complexidade` que já existe
(`automacao|inteligencia|autonomia`, decidida pelos 2 eixos do `analyzer.ts`) traduzida para o nome
que o produto usa, mais o degrau **Agêntico**, que está **TBD** — o rótulo foi aprovado, a
fronteira não. Enquanto o Luis não fechar, `normalizarCategoria` **rebaixa** `agentico` para
`autonomo`: nível com fronteira inventada é pior que nível a menos. A proposta registrada é
"monta o próprio plano e itera até o objetivo" × autônomo, que "age dentro de um escopo dado".

⚠️ **O TIPO é inferido, nunca declarado pelo autor** (decisão de 02/09): lista onde uma opção paga
mais é convite à inflação, e a inferência acertou a separação da base só pelos nomes. Para não
oscilar entre rodadas, o tipo sai de uma cascata de sinais binários com **precedência declarada**:
`agente > sistema > app > dashboard > automacao`.

## 10. Tarefas

- **T1 — Validação cega da régua.** Aplicar a régua nos **498 não-especiais já notados** (não
  lidos) e comparar a forma da distribuição com a do §6. Se sair torta, a régua foi moldada nos 65.
- **T2 — `estrelas-regua.ts`** (novo, PURO): os 5 critérios + piso 0 + gatilho e ranking do escape,
  como **FONTE ÚNICA** (prompt, tela e teste). Aposenta `NIVEIS` de `especiais-regua.ts`.
- **T3 — Corpus unificado:** `especial-corpus.ts` + `avaliacao-corpus.ts` passam a ler **todos** os
  projetos com nota humana, especiais e não. Bumpar o que precisar no espelho.
- **T4 — Cérebro B na régua nova:** reescrever o prompt de `especial-classificador.ts` a partir da
  T2; exigir `criterio_aplicado` + `evidencias` na saída.
- **T5 — Cérebro C (consenso):** módulo PURO de conciliação A×B + `.functions` que nunca lança.
- **T6 — Auditoria de valor:** estender o Financeiro para emitir `valor_sugerido` + justificativa.
- **T7 — Retroativo de 3 saídas** + relatório comparativo contra o gabarito humano.
- **T10 — Aglutinação (5.3/5.7):** detectar que o projeto novo é FEATURE de um já documentado —
  vizinho de altíssima similaridade + nome/escopo coincidente (o caso real das 3 duplicatas do §5).
  Saída: `aglutinar_em: <id>` + evidência, **sempre para confirmação humana** (aglutinar errado
  apaga um projeto do histórico de alguém). Na varredura dos aprovados, propõe também o impacto
  CONSOLIDADO do conjunto, nunca a soma cega.
- **T9 — Racional agregado + detector de achatamento (D12):** o relatório do retroativo emite,
  acima das notas, a distribuição das quedas por nível de destino e marca *achatamento suspeito*
  quando um único destino concentra mais de 50% delas. Fila de contestações (D11) no mesmo
  relatório, ordenada por confiança.
- **T8 — Painel:** coluna/ficha com estrela recomendada, critério aplicado, evidência e confiança —
  em SOMBRA, sem tocar "Estrelas".

## Fronteiras

- **Modo SOMBRA em tudo:** nada muda status nem grava "Estrelas".
- **Prod (`674a3710`) e staging v1 (`edf400b4`) não são tocados nesta frente.**
- Não misturar com a `feat/godocs-v2` (submissão determinística) — a régua é insumo dela, não o inverso.
- Descontinuado fora de tudo (D7). Ressubmissão não pontua (D8).
