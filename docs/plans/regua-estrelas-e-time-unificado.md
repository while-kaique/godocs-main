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

## 6.1 T1 — VALIDAÇÃO CEGA (medida 02/09/2026, 484 não-especiais)

**Como foi feito.** `scripts/regua-t1/` — leitura pura da planilha de prod + aplicação da régua por
LLM (`gpt-5.4-mini` direto na OpenAI, `json_object`, 3 tentativas). O prompt é montado por
`descreverReguaAgente()` + `descreverEscape()` do `estrelas-regua.ts` (fonte única, sem redigitar
critério). O agente **não vê a nota humana**. Alvo: 484 projetos **não-especiais · com nota · não
descontinuados** — os que a sessão da régua nunca leu. Custo total: ~US$ 1,10, ~2 min.

Três variantes, para separar "a régua não discrimina" de "UM item do piso zera tudo". As variantes
B e C mexem **só no prompt do script**; `estrelas-regua.ts` não foi tocado.

| | 0★ | 1★ | 2★ | 3★ | 4★ | 5★ | escape |
|---|---|---|---|---|---|---|---|
| **Humano** (gabarito) | 400 | 59 | 16 | 7 | 2 | 0 | — |
| **A** — régua literal | **483** | 1 | 0 | 0 | 0 | 0 | 0 |
| **B** — A + a leitura da D1 dita no prompt | **483** | 1 | 0 | 0 | 0 | 0 | 0 |
| **C** — piso sem o item `mensuravel` | 63 | **288** | 125 | 4 | 3 | 0 | 0 |

### Achado 1 — a régua literal é INERTE fora do especial declarado
O desqualificador de piso **`mensuravel`** (*"o ganho é mensurável com o que está descrito — volta
como saving/receita"*) disparou em **484 de 484**. Não é acidente de amostra: **100% dos
não-especiais têm ganho medido > 0**, porque passar pelo memorial financeiro é o que os torna
não-especiais. E ele **também morde os especiais**: na variante A, **27 dos 65** caem a 0★,
incluindo os de nota humana alta.

⚠️ Como está escrito, o piso `mensuravel` e a **D6** (*"estrela vale para TODO projeto"*) não podem
ser verdade ao mesmo tempo. **Decisão do Luis** — não mexi na régua.

### Achado 2 — não é problema de prompt (variante B)
Dizer no prompt a intenção da **D1** (*ter número não zera; só zera se TUDO estiver capturado pelo
número*) mudou **1 projeto em 484**. O texto do piso é lido como binário — reescrevê-lo com mais
cuidado no prompt não resolve, porque o problema é o **critério**, não a redação dele.

### Achado 3 — sem esse item, a régua discrimina, mas achata em 1★–2★
Variante C: **60% em 1★ e 26% em 2★**; só **7 projetos em 484** acima de 2★. Pelo próprio
`detectarAchatamento` (D12), o lote é **achatamento suspeito** (um destino com 60% > `LIMIAR_ACHATAMENTO`).
A causa parece **MATERIAL, não de calibragem**: 3★/4★/5★ pedem *barreira*, *escolha que compromete
recurso* e *caminho pelo qual o resultado chega ao cliente* — e o material do não-especial é
memorial financeiro (cargo, horas, R$). O texto que sustentaria 3★+ não está escrito em lugar
nenhum. É o mesmo diagnóstico já registrado no painel de agentes dos especiais.

### Achado 4 — a FORMA bate; o "fundo" da escala é que está deslocado um degrau
Humano `83/12/3/1/0`, régua C `13/60/26/1/1`: as duas são fortemente concentradas no fundo com
cauda curta — a diferença é **onde fica o fundo**. A régua praticamente não usa o 0★ quando o item
`mensuravel` sai, e o humano quase só usa o 0★.

### Achado 5 — ⚠️ o gabarito humano está contaminado: `0` também quer dizer "ninguém auditou"
A coluna "Estrelas" é numérica e "sem nota" é gravado como **`0`** (já registrado no CLAUDE.md).
A taxa de projetos com nota ≥1 por mês de submissão prova que a triagem parou:

| mês | 2026-03 | 04 | 05 | 06 | **07** | 08 |
|---|---|---|---|---|---|---|
| projetos | 46 | 40 | 106 | 87 | **198** | 4 |
| com ≥1★ | 26% | 33% | 24% | 31% | **1,5%** | 100% |

Os **221 projetos de julho** não são "avaliados como zero", são **não avaliados**. No subconjunto
dos meses em que a triagem estava ativa (**n=263**) o gabarito muda de forma: humano `73/18/6/3/1`
contra régua C `17/57/25/0/0`. **Spearman 0,199** — ordenação fraca.

### Achado 6 — onde o humano de fato avaliou, a régua concorda
Restrito aos **84 não-especiais com nota humana ≥1**: **44% exato · 93% dentro de ±1**. Nos
especiais 1★–5★ (n=58): 24% exato · 66% dentro de ±1. O ruído do conjunto inteiro vem do bloco de
zeros do Achado 5, não da ordenação.

### Achado 7 — o §6 estava contaminado, e o viés é o esperado
Mesma régua (variante C) nos 65 especiais, contra o §6 escrito à mão por quem os havia lido:

| | 0★ | 1★ | 2★ | 3★ | 4★ | 5★ | escape |
|---|---|---|---|---|---|---|---|
| humano hoje (6–10 dobrado em 5) | 0 | 12 | 16 | 18 | 8 | 8 | — |
| **§6, à mão** | 0 | 21 | 18 | 9 | 7 | 9 | 2 |
| **régua C, cega** | 2 | 33 | 12 | 3 | 9 | 6 | 2 |

A régua aplicada às cegas roda **mais achatada** do que a mão que a escreveu produziu (1★: 33 vs 21;
3★: 3 vs 9). O escape achou 2 candidatos: **`Gocontent Machine` 6★** (bate com o §6) e
**`Portal de Ocorrências B2B` 6★** (novo, humano 2★).

### Achado 8 — a promoção `+1` é letra morta e a confiança auto-declarada é inútil
`dependente_nomeado` apareceu em **4 de 484** e a promoção foi aplicada **1 vez**. Ninguém escreve o
dependente nomeado na doc — a promoção só volta a existir se o dado for coletado.
E o LLM auto-declarou `alta` em **456 de 484**: em T4 a confiança tem de vir da pura
`confiancaDe()`, **nunca do modelo**.

### O que isto significa para T4 (cérebro B)
1. **O piso `mensuravel` precisa de decisão do Luis antes do T4** — com ele, o cérebro B devolve 0
   para tudo que não é especial declarado, e a D6 morre.
2. A confiança sai de `confiancaDe()`, não do LLM.
3. O corpus do RAG (T3) é o que pode desatar o achatamento do Achado 3 — sem vizinho com nota
   humana, o modelo não tem contra o que comparar.
4. **O gabarito do T7 tem de excluir os 221 de julho**, senão o retroativo vai medir contra
   "ninguém auditou".

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

---

## 11. Time AUTÔNOMO de triagem — direção do Luis (03/09/2026) e plano da sessão de código

**Alvo declarado pelo dono do produto:** aprovação de projetos **autônoma**. Ninguém gasta tempo com
triagem. Humano só na EXCEÇÃO. Os agentes raciocinam **como gente** (leem tudo, consultam, discutem,
podem ir contra o dado quando têm motivo), com critérios e guias, sem checklist engessado. O time
**aprende** das rodadas de retroativo: o output volta para quem ajusta prompt, exemplos e régua.

**Alinhamento com o painel irmão (`w14:p2`, 03/09):** HEAD `0c4978f`; suíte 2396 verde; única pendência
não commitada é a variante `e` do harness `scripts/regua-t1/aplicar.ts` (diagnóstico; **não** vazar para a
régua). Medição final nos 84 auditados de verdade: régua commitada = 10% exato / 79% ±1 / viés −0,94 /
**63 de 84 zerados pelo piso**; sem `apenas_mensuravel` no piso = 23% / 88% / −0,08; + ML fora do gate do
4★ = **30% / 88% / +0,07**. Nos 21 que escapam do piso: 38% exato / 81% ±1 → **a escada 1–5 funciona; o
portão na frente dela é que não**. 8 das 11 âncoras caem onde o Luis as pôs; Robo orçamento e GoBrands
caem em 2★ em toda variante (falta de MATERIAL: dependente nomeado não está na doc).

### 11.1 Decisões novas (D13–D19)

- **D13 — Aprovação autônoma é o alvo; humano é exceção.** Três saídas do time: `aprovar` ·
  `ajuste` (texto ao autor dizendo o que falta e por quê) · `humano` (só escape 6–10 e divergência que o
  debate não fechou). O modo SOMBRA deixa de ser fronteira e vira **fase 1**.
- **D14 — Raciocínio LIVRE, fecho MEDIDO.** Cada agente é um LLM com ferramentas, lê o dossiê inteiro,
  pode discordar e mudar de ideia. Quem autoriza o veredito a sair **sem humano** é a `politicaDeLiberacao`:
  lê a acurácia MEDIDA no retroativo por tipo de veredito e libera um por um. A confiança do agente é VOTO;
  a confiança do SISTEMA é histórico de acerto. Motivo: este repo mediu 3× que "prompt não segura" quando
  o agente decide sozinho sobre texto livre, e teve 2 loops entre agentes.
- **D15 — Debate com TETO.** Réplica do cético → resposta dos especialistas → consenso. **Máximo 2
  rodadas**, sobre a máquina de deliberação que já existe (`avancarDeliberacoesPendentes`, cron). O proxy
  dá ~60 s por chamada e um request não cabe um loop; o debate atravessa tiques de cron.
- **D16 — Escape 6–10 vai ao humano COM dossiê de comitê.** O agente indica a faixa (nunca a posição) e
  entrega: resumo do projeto, o gatilho de escape com evidência citada, os pares já notados em 6–10 (as 4
  âncoras congeladas, D9) lado a lado, e a frase "o time lê como acima/abaixo de X porque…". O comitê
  escolhe o número por comparação.
- **D17 — Sem logs de chat na v2.** O dossiê não depende de `chat_messages`. Fontes: campos determinísticos
  da v2 (`saving_efetivado_*`, `custo_evitado_nao_contratado`, `ganho_imensuravel_racional`, `custo_rodar_itens`,
  receita) + **texto extraído dos ANEXOS/evidências** + documentação gerada em background + `form_events` +
  `projeto_versions` + espelho da planilha + TeamGuide (cargo, time). Para a base v1 (retroativo) entram
  também memorial e `documentacao.conteudo`. O dossiê é **tolerante às duas formas**.
- **D18 — Critérios dos PADRÕES = plausibilidade com FERRAMENTA, não gate.** O padrão não tem estrela; o
  que se julga é mérito e valor: horas por pessoa × cargo × teto 220h, saving vs custo de rodar, receita
  incremental vs base, custo evitado vs contrato citado, duplicata (D8), evidência anexada sustenta o
  número. O agente **pergunta** ("500 h para uma pessoa: como?") via `ajuste`, não reprova calado.
- **D19 — Aprendizado é sobre a RÉGUA e o PROMPT, por mão humana.** Cada rodada de retroativo gera
  relatório; quem lê os erros ajusta constantes de `estrelas-regua.ts`, exemplos e prompts; o corpus do RAG
  cresce **só com nota humana** (`rotuloExemplar`). Nunca auto-treino sobre a própria saída (D12b).

- **D20 — A RÉGUA É GATE DETERMINÍSTICO E NENHUM CRITÉRIO MUDA (Luis, 03/09/2026).** Palavras dele:
  *"não quero que UM desses critérios seja diferente. O agente pode raciocinar em cima deles, mas não podem
  ser diferentes do que está aí como gate determinístico; raciocinar em cima disso e concluir através de um
  racional que faça sentido dado o contexto está ok."* Consequências: **(1)** o texto vigente é o de
  `estrelas-regua.ts` em `0c4978f` (conferido item a item contra o texto enviado pelo Luis: 7 desqualificadores
  do 0★ `Experimenta`, 1★ Informa · 2★ Executa · 3★ Garante · 4★ Decide · 5★ Assume, 6–10 `Muda o Jogo` com
  nota final humana por comparação); **(2)** as propostas do painel irmão — tirar `apenas_mensuravel` do piso e
  tirar ML do gate do 4★ — estão **REJEITADAS**; não repropor; **(3)** o que o agente PODE fazer é ler o
  "APENAS" com raciocínio: só zera quando argumenta, com citação do dossiê, que o projeto **se resume** ao número
  — ter saving não zera; **(4)** o custo medido de manter o critério fica registrado com honestidade: às cegas
  e sem dossiê, o piso zerou 63 de 84 auditados. **O caminho para fechar essa distância é MATERIAL e
  RACIOCÍNIO** (dossiê completo, `ganho_imensuravel_racional` da v2, evidências anexadas, vizinhos com nota
  humana, tools), medido em T19 — nunca afrouxar a régua. Se depois de T19 a distância persistir, o
  relatório mostra ONDE e o Luis decide; o agente não decide.

### 11.2 Arquitetura (o que muda em relação ao §7)

```
dossiê(projeto) ──► Cérebro A (mérito+valor)  ──┐
   │                 especialistas c/ tools      │
   │                 + cético                    ├──► debate (≤2 rodadas) ──► Cérebro C (consenso)
   └──────────────► Cérebro B (estrela)  ────────┘                              │
                     régua nova + RAG humano                          ┌─────────┼──────────┐
                                                                   aprovar   ajuste    humano
                                                                   (interno) (texto    (dossiê de
                                                                             ao autor)  comitê)
                                            politicaDeLiberacao ◄── acurácia medida por veredito
```

**Ferramentas dos agentes** (`src/lib/avaliacao/ferramentas.ts`, catálogo JSON, execução server-side,
puras/idempotentes, **máx. 4 chamadas por agente por rodada**): `consultar_vizinhos` (RAG, só nota humana) ·
`consultar_cargo` (TeamGuide espelho, fail-safe) · `historico_versoes` (o que mudou entre reenvios) ·
`buscar_duplicata` (D8, mesmo nome/escopo com ganho medido) · `checar_plausibilidade_horas` (teto 220h,
multiplicadores, jornada) · `calcular_impacto` (`impacto.ts`, bruto × líquido × mensal) ·
`ler_evidencia` (texto extraído de um anexo específico).

**Modelo por agente** (envs lidas LAZY, opt-in como o roteamento por fase): extração do dossiê,
especialistas por dimensão e lentes → **leve** (`LLM_MODEL_FAST`, `reasoning_effort=low`); cético,
consenso, texto ao autor e dossiê de comitê → **forte** (`LLM_MODEL`); embeddings → **direto na OpenAI**
(`text-embedding-3-large`, nunca no proxy). `minimal` segue proibido (502).

### 11.3 Tarefas da sessão de código (T11–T20; T1–T10 do §10 seguem válidas)

- **T11 — Dossiê** (`src/lib/avaliacao/dossie.ts` PURO + `dossie.functions.ts`): monta o contexto
  completo (D17), v1 e v2, sem chat; anexos com texto extraído (reusa `extract-text`); `form_events` e
  `projeto_versions` sem blobs em massa (teto 32 MiB RPC — por PK). *Aceite:* teste monta dossiê de um
  legado v1 e de uma linha v2 com os mesmos campos preenchidos/ausentes declarados.
- **T12 — Ferramentas** (`ferramentas.ts` + loop de tool-use bounded em `llm.ts` ou wrapper): catálogo
  acima; cada tool é função pura testável; o loop para em 4 chamadas ou no 1º erro e devolve o que tem.
  *Aceite:* teste do loop com tool que falha (agente conclui com o parcial) e do teto de 4.
- **T13 — Cérebro B na régua nova** (= T4): `especial-classificador.ts` monta o prompt de
  `descreverReguaAgente()`+`descreverEscape()`+`categorizacao-projeto.ts`, com tools; saída obrigatória
  `criterio_aplicado` · `evidencias[]` citadas · `tipo` · `nivel` · `escape?`; confiança por
  `confiancaDe()`, **nunca do modelo**. A régua entra INTACTA (D20): o ganho de acurácia tem de vir do
  dossiê, das ferramentas e do RAG com nota humana, não de mexer no critério.
- **T14 — Cérebro A com tools + auditoria de valor** (= T6 + D18): especialistas de
  `especialista-avaliacao.ts` recebem o dossiê e o catálogo; o Financeiro emite `valor_sugerido` +
  justificativa; entra a dimensão **plausibilidade** (horas × cargo × teto). *Aceite:* caso sintético
  "500 h, 1 pessoa" sai `ajuste` com pergunta concreta, não `reprovar`.
- **T15 — Debate com teto** (D15): réplica do cético e resposta dos especialistas como rodadas da
  deliberação existente; `MAX_RODADAS_DEBATE = 2`; teste de simulação com agentes que nunca concordam
  prova que fecha em 2 e cai em `humano`.
- **T16 — Cérebro C consenso** (= T5) `consenso-avaliacao.ts` PURO + `.functions` que nunca lança:
  concilia A×B, produz o objeto do §7 + `saida ∈ aprovar|ajuste|humano`; `politicaDeLiberacao(veredito,
  acuraciaMedida)` decide se a saída pode agir sozinha (D14). Sem medição → tudo em sombra.
- **T17 — Três textos prontos** (`avaliacao-textos.ts` PURO para o esqueleto, LLM forte para a prosa):
  justificativa interna · texto ao autor **sem R$ por hora** e terminando em "Para corrigir…"
  (mesma disciplina de `mensagens-submissao.ts`) · dossiê de comitê (D16). Teste varre o texto ao autor
  por `R$` de valor/hora.
- **T18 — Retroativo de 3 saídas + gabarito limpo** (= T7 + T9): estrela recomendada × nota humana,
  mérito × Status, auditoria de valor; **gabarito = só quem foi auditado** (nota ≥1, ou Status assentado
  em mês com triagem ativa; **os 221 de julho ficam FORA**); detector de achatamento (D12) e fila de
  contestações (D11) no relatório. Descontinuado fora (D7). Roda em `dry`, nunca grava
  `projeto_avaliacao` nem abre deliberação real.
- **T19 — Protocolo de iteração** (`scripts/avaliacao-retro/`): amostragem **estratificada** e
  reprodutível por seed → relatório JSON + MD por rodada em `docs/plans/retro-rodadas/`. Ordem obrigatória:
  **30** (10 especiais com nota humana · 10 padrões aprovados · 5 com ajuste/reprovado · 5 absurdos
  sintéticos) → ajustar até bater as metas → **100** → **300** → **base inteira**. Cada rodada registra
  modelo, variante da régua, custo e as metas. **Uma rodada no modelo forte antes de concluir qualquer
  teto** (o mini oscila entre corridas: Ticket Creator deu 5★ e 2★ em variantes vizinhas).
- **T20 — Painel sombra + liberação por veredito** (= T8): ficha do `/dashboard` mostra saída, critério,
  evidências, confiança e o texto que iria ao autor; flags `AVALIACAO_LIBERAR_APROVAR` /
  `AVALIACAO_LIBERAR_AJUSTE` (default OFF) só passam a agir quando a `politicaDeLiberacao` autoriza.
  "Estrelas" e "Status" continuam **só por clique humano** até a liberação.

- **T21 — Memória e LOG dos agentes em ÁRVORE (pedido do Luis, 03/09, PRIMEIRA a entrar).** Tabelas
  INTERNAS no SQLite do app (fora de `SAFE_UPDATE_FIELDS`, sem Sheets, comentário do schema **sem `;`**):
  - **`avaliacao_ciclos`** — a RAIZ: uma linha por rodada (retroativo ou avaliação real): data, gatilho,
    amostra e seed, modelo por papel, variante do prompt, métricas agregadas, caminho do relatório, status.
  - **`agente_log`** — um nó por passo de agente, **sempre pendurado num pai**: `id` · `ciclo_id` (raiz,
    obrigatório) · **`pai_id`** (nó que chamou; `NULL` só para o orquestrador do projeto dentro do ciclo) ·
    **`caminho`** (materialized path `ciclo/orquestrador/cerebroA/especialista-financeiro/tool-3`, para
    puxar a subárvore com UM `LIKE 'prefixo/%'`) · `profundidade` · `projeto_id` · `agente` (nome do
    papel) · `tipo` (`orquestrador|cerebro|especialista|cetico|consenso|tool|debate`) · `rodada` ·
    `entrada` (resumo) · `saida` (conclusão ÍNTEGRA, não resumida) · `tools_chamadas` (JSON: nome,
    argumentos, retorno) · `confianca` · `veredito` · `modelo` · `tokens_in/out` · `custo_usd` ·
    `duracao_ms` · `erro` · `created_at`.
  - **Regra de árvore, cobrada em código e em teste:** `registrarNoAgente` **recusa nó sem `pai_id`** que
    não seja o orquestrador do projeto, e recusa `pai_id` de outro ciclo. Nada fica solto: da raiz dá para
    chegar a toda tool chamada, e de qualquer tool dá para subir até o ciclo. **Nunca lança** para fora
    (auditoria não derruba a avaliação — régua de `registrarAtividade`); a recusa é logada e contada.
  - **Índices para consulta rápida:** `(ciclo_id, projeto_id)` · `(projeto_id, created_at)` ·
    `(agente, created_at)` · `(pai_id)` · `(caminho)` · `(veredito)`. Perguntas que têm de sair em uma
    consulta: *o que o cético concluiu no projeto X na rodada de terça* · *toda a subárvore do orquestrador
    do projeto X* · *todos os erros do especialista financeiro na última semana* · *quantos ciclos caíram
    em `humano` por mês*.
  - **Leitura:** `GET /api/admin/agentes/ciclos` · `GET /api/admin/agentes/arvore?ciclo=&projeto=`
    (devolve a árvore montada) · `GET /api/admin/agentes/log?agente=&desde=&veredito=` (`requireAdmin`).
    O script de rodada imprime o resumo do ciclo e o caminho do relatório.
  - Vetorizar o log fica **fora** até a busca por texto livre se provar necessária. Motivo do Luis: *"para
    não ficarmos às cegas e esquecer o que rodamos na terça, qual foi a conclusão da semana passada, por que
    o agente estava dando erro"* e *"divida em árvore: esse agente está conectado a tal, que está conectado a
    tal — não deixe solto para perdermos."*

**Ordem:** **T21** → T11 → T12 → T13/T14 (paralelas) → T16 → T15 → T17 → T18 → T19 (rodadas) → T20 → T10.

### 11.4 Metas (proposta — o Luis fixa os números)

| veredito | meta para LIBERAR sem humano | onde se mede |
|---|---|---|
| `aprovar` | ≥ 90% acerto e **0 `erro_grave`** em 300 auditados | T18 mérito × Status |
| `ajuste` | ≥ 85% dos ajustes pedidos coincidem com o que a triagem pediu | T18 × `Motivo Reenvio` |
| estrela 1–5 | ≥ 85% dentro de ±1 nos auditados; **sem achatamento** (D12) | T18 estrela × nota |
| escape 6–10 | recall 4/4 nas âncoras congeladas; ≤ 2 falsos positivos em 300 | T18 |
| `humano` | ≤ 10% dos projetos (é exceção) | T18 |

### 11.5 Perguntas que BLOQUEIAM (decisão do Luis, não do agente)

- **(a)** ~~Tirar `apenas_mensuravel` do piso 0★?~~ **RESPONDIDO pelo Luis (03/09): NÃO.** Ver D20.
- **(b)** ~~ML/estocástico sai do gate do 4★?~~ **RESPONDIDO pelo Luis (03/09): NÃO.** Ver D20.
- **(c)** Os números da tabela 11.4.
- **(d)** Onde o texto ao autor aterrissa na v2 (coluna `Motivo Reenvio`, campo próprio, ou só ficha).
- **(e)** Auditoria humana de ~50 projetos ao acaso entre os NÃO avaliados (maior alavanca: sem ela o
  retroativo mede contra "ninguém olhou").

### 11.6 Fronteiras

- Fase 1 é **SOMBRA**: nada grava "Estrelas" nem "Status" até a `politicaDeLiberacao` autorizar por veredito.
- Prod (`674a3710`) e staging v1 (`edf400b4`) **não são tocados**; retroativo lê espelho/SQLite e roda `dry`.
- Não mexer na `feat/godocs-v2`; o dossiê CONSOME os campos dela, não os define.
- Régua FECHADA (`0c4978f`): mudança só nas constantes, com ok do Luis. Não repropor o que o §4 descartou.
- Nenhum agente/gate da v1 é apagado (T9 da v2: desligar, não remover).
