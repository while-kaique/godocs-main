# SPEC — Níveis de complexidade: redefinição de AUTONOMIA (ação na última ponta)

> **Status:** ✅ IMPLEMENTADO (branch `docs/spec-complexidade-autonomia`) — ver §13 "Onde aterrissou".
> **Data:** 2026-06-29 · **Autores da decisão:** Lucas Queiroz (gestor) + Luis/Kaique (RPA).
> **Origem:** slide GoGroup *"Agentes: quatro níveis cumulativos"* + conversa de alinhamento no Google Chat (Lucas × Kaique × Luis).
> **Escopo:** muda **como o decisor (`analyzer.ts`) classifica** um projeto em `automacao` / `inteligencia` / `autonomia`. NÃO mexe em saving/receita.

---

## 1. Por que existe esta spec

O fluxo atual de classificação foi **inspirado** num slide de 4 níveis cumulativos, mas o código acabou amarrando a classificação à **presença de IA**. O gestor (Lucas) revisou o conceito e apontou que o discriminador real da **autonomia** não é "tem IA?", e sim **"o sistema toma uma AÇÃO consequente na última ponta, sozinho?"**. Como a mudança **reverte uma regra cravada em código** (um gate determinístico), documentamos a decisão inteira **antes** de tocar no decisor — para validar o entendimento e ter um mapa claro do que vai mudar.

### O slide que inspirou (4 níveis cumulativos)

| Nível | Ganha em relação ao anterior |
|---|---|
| 0 · Skill simples | humano invoca e supervisiona |
| 1 · **Automação** | + trigger: roda sozinho |
| 2 · **Inteligência** | + julgamento: decide o caminho |
| 3 · **Autonomia** | + **execução: age com pouca ou nenhuma intervenção humana** |

> *"O nível 3 é onde mora o risco real — é o degrau que mais precisa de dono e governança."*

### O que o gestor esclareceu (a "linha tênue")

- *"Um agente autônomo: ele extrai, trata, analisa, **toma uma ação** com base em decisões — e essas decisões **podem vir de uma IA OU de uma árvore de lógica** que chega numa decisão."* → **autonomia não exige IA.**
- *"A construção de um dashboard é automação: extrai e centraliza, serve de output pra tomada de decisão, mas **não faz nada ativamente**."* → para na **etapa de informação**.
- Caso **margem diária do Hugo** (alto impacto): aponta produtos mal promocionados que afetam a margem → *"é automação **porque chega até a etapa de informação**. Se ele fosse autônomo, ele já conseguiria inclusive **tirar os cupons** do produto automaticamente."*
- *"A decisão até uma automação pode dar"* → ter decisão / `if-else` **não** eleva o nível.
- **Armadilha explícita:** *"se o trabalho era um dashboard, a IA pode entender que virou autonomia porque automatizou até a última ponta do dashboard — **mas não é**, porque um dashboard não toma decisão E ação."*
- Estado atual da base: *"sendo bem honesto, acho que **não tem nada autônomo** no que foi submetido, ou quase nada."*

---

## 2. Como o decisor classifica HOJE (estado atual do código)

Arquivo: **`src/lib/agents/analyzer.ts`**.

**Porta-mestra = "tem IA como funcionalidade?".** Dois gates determinísticos (rodam **depois** do LLM, sobrepõem a sugestão dele):

```
tem_ia_como_funcionalidade === true  && complexidade === 'automacao'  → eleva para 'inteligencia'
tem_ia_como_funcionalidade === false && complexidade !== 'automacao'  → REBAIXA para 'automacao'
usa_ia === false  && complexidade !== 'automacao'  → REBAIXA para 'automacao'
usa_ia === true   && complexidade === 'automacao'  → eleva para 'inteligencia'
```
(`analyzer.ts` ~`412-434`.)

**Consequência travada:** sem IA ⇒ **sempre** `automacao`. **`autonomia` é hoje impossível sem IA.** É exatamente isso que a decisão D1 abaixo derruba.

Sinais usados hoje:
- **`tem_ia_como_funcionalidade`** (`boolean|null`) — **resposta do usuário** na fase *doc*, tem **precedência**. Coletada em `buildDocPrompt` (`orchestrator.ts` ~`173-190`); campo em `DocumentacaoColetada` (`agents/types.ts:19`).
- **`usa_ia`** (`boolean`, ex-`ia_decide_caminho`) — **inferência do LLM analyzer**; usado quando `tem_ia_como_funcionalidade` é `null`. Campo em `ResultadoAnalise` (`agents/types.ts:206`).
- Enum `Complexidade = 'automacao' | 'inteligencia' | 'autonomia'` (`agents/types.ts:193`).
- Vai para a coluna **"Complexidade"** do Sheets (`sheets.ts:58`).

---

## 3. Decisões fechadas (2026-06-29)

### D1 — AUTONOMIA passa a ser definida por AÇÃO, **independente de IA** ✅
O critério-mestre da autonomia é **"executa uma ação consequente na última ponta, sozinho, com interferência humana mínima"**. A decisão por trás da ação **pode vir de IA OU de uma árvore de lógica determinística**.
- **Reverte** o gate atual: um sistema **100% determinístico** que age sozinho na ponta **pode** ser `autonomia`.
- **Inversamente:** um sistema cheio de IA que **só entrega informação** **NÃO** é autonomia (é `inteligencia` ou `automacao`).

### D2 — INTELIGÊNCIA continua atrelada a IA como funcionalidade ✅
O degrau do meio **não** muda de definição. Só sobe para `inteligencia` quando a automação **usa IA como funcionalidade** (gera/classifica/extrai/transcreve/recomenda) e **um humano age sobre o output**. `if-else` / árvore de lógica determinística que **só informa** continua `automacao` — coerente com *"a decisão até uma automação pode dar"* (ter decisão não eleva).

### D3 — Mantemos 3 níveis (não adotamos o "Skill simples") ✅
O enum segue `automacao | inteligencia | autonomia`. O GoDocs classifica **automações já concluídas e submetidas** — "Skill simples" (humano invoca e supervisiona a cada uso) não se aplica ao que entra no formulário. Evita mexer no enum, na coluna do Sheets e em toda a cadeia de testes.

---

## ★ O PRINCÍPIO — classifique pelo TRABALHO, nunca por exemplos

> Casos (dashboard, cupom, ticket…) servem para **conferir** o raciocínio, **nunca** para fundá-lo: enumerar casos até "bater tudo" é gato e rato e não fecha. A régua abaixo é **gap-free por construção** — classifica qualquer projeto por **duas propriedades invariantes do TRABALHO**, não por características de superfície.

**Pergunta A — JULGAMENTO:** para gerar a saída, o sistema precisa **interpretar algo aberto/ambíguo** (gerar texto, classificar conteúdo livre, extrair sentido, recomendar) que **nenhuma regra fixa escrita de antemão resolveria** — ou segue um **caminho determinístico** (regras / `if-else` / árvore de lógica, por mais complexa)?
- Determinístico → base **automação**.
- Exige julgamento (hoje, na prática, = IA) → base **inteligência**. *(detalhe em §4.1)*

**Pergunta B — FECHAMENTO DO CICLO:** quando o sistema termina, o **caso está concluído** (decidiu **e** executou a ação final que um humano tomaria, sem humano no loop) — ou entregou um **insumo** (informação / recomendação / alerta) que **ainda exige um humano decidir e agir** para o trabalho se concretizar?
- Entregou insumo p/ decisão humana → fica no nível da Pergunta A.
- Concluiu o caso sozinho → **autonomia** (sobrepõe a Pergunta A; com ou sem IA).

**Por que isso fecha todos os gaps:** A e B perguntam **o que o trabalho EXIGE**, não como o projeto **parece**. Os gaps nascem de classificar por superfície — então a régua **ignora deliberadamente** os red herrings abaixo (nomeá-los é o que fecha os buracos, não enumerar casos):

| Red herring (NÃO classifica) | Por quê é irrelevante |
|---|---|
| "roda sozinho / 24/7 / por trigger" | é **operação** — o incremento da *automação* no slide (*"+ trigger: roda sozinho"*), não a ação que fecha o ciclo |
| "usa IA / foi feito com Claude" | só conta se a IA faz **julgamento em runtime** (Pergunta A); **nunca** define autonomia |
| "eliminou trabalho humano / alto impacto / muitas integrações" | é **saving / engenharia**, não a natureza do trabalho |
| "tem decisão / `if-else`" | decisão **determinística** ≠ julgamento → continua automação |

**Distinção fina que cai fora do princípio (sem precisar de exemplo):** *conclui o caso* ≠ *entrega insumo* é por FUNÇÃO no trabalho, não pelo ato físico — por isso "responder o cliente e resolver o chamado" é autonomia e "mandar e-mail de alerta" não é, embora ambos "enviem mensagem".

> Regra operacional: responda **A** e **B** sobre o trabalho. Os exemplos da §8 são verificação, não a regra.

## 4. Definição NOVA dos 3 níveis

- **`automacao`** — dispara por trigger e segue caminho **determinístico** (mesmo com decisões/`if-else`). **Chega até a etapa de INFORMAÇÃO / output**: extrai, trata, centraliza, calcula, mostra, alerta, recomenda — e **entrega para um humano decidir/agir**. NÃO usa IA como funcionalidade **e** NÃO toma a ação consequente sozinho. *(Ex.: RPA que preenche planilha; dashboard de margem; n8n que move dados; alerta por regra.)*
- **`inteligencia`** — usa **IA como funcionalidade** (julgamento não-trivial: gera/classifica/extrai/recomenda como parte do que entrega) — mas **o humano ainda conduz**: abre a tela/fila/chat e age sobre o resultado. *(Ex.: IA que gera documentação; IA que classifica e roteia tickets e um analista trata a fila.)*
- **`autonomia`** — **toma a AÇÃO consequente na última ponta, sozinho**, com pouca ou nenhuma intervenção humana. A decisão por trás **pode ser IA ou lógica determinística**. *(Ex.: agente que recebe o chamado, decide e **responde o cliente** sozinho; sistema que detecta o problema de margem e **tira os cupons** do produto automaticamente.)*

> **Cumulatividade:** autonomia ⊃ a capacidade de informar/julgar — mas o **degrau que define** é a **execução da ação**, não a IA.

### 4.1 Os dois eixos — por que INTELIGÊNCIA continua atrelada a IA (D2)

A confusão nasce de tratar os 3 níveis como **uma régua só**. Na verdade são **dois eixos independentes**:

- **Eixo A — usa IA como funcionalidade?** (gera/classifica/extrai/recomenda com IA, não `if-else` determinístico) → separa **automação ↔ inteligência**.
- **Eixo B — toma a ação consequente sozinho na última ponta?** → **promove para autonomia**, sobrepondo o eixo A.

|  | **Só informa / humano toma a ação** | **Toma a AÇÃO de negócio na ponta (sem humano confirmar)** |
|---|---|---|
| **Sem IA (determinístico)** | `automacao` | `autonomia` |
| **Com IA como funcionalidade** | `inteligencia` | `autonomia` |

Leitura: a **coluna da direita inteira é autonomia** (D1 — IA é irrelevante quando o sistema age). A **coluna da esquerda** é dividida pela IA (D2 — sem IA é automação, com IA é inteligência).

⚠️ **"Rodar sozinho 24/7" NÃO coloca na coluna da direita.** Operar por trigger sem humano é o degrau da **automação** (no slide, nível 1 = *"+ trigger: roda sozinho"*) — é o **meio**, não a ação. A coluna da direita exige a **ação de negócio na ponta** (ver §6.1).

**Por que NÃO deixamos "decide o caminho" sozinho elevar para inteligência:** o próprio gestor disse *"a decisão até uma automação pode dar"*. Se qualquer `if-else`/árvore de lógica que "decide um caminho" virasse inteligência, **quase toda automação com regras** seria inteligência e o nível perderia o sentido. Por isso inteligência exige **julgamento não-trivial via IA** (gerar/classificar/extrair/recomendar), não decisão determinística.

**Discriminador inteligência ↔ autonomia:** NÃO é "tem IA?". É **quem toma a ação final** — o humano (inteligência) ou o próprio sistema (autonomia). Ex.: IA classifica o ticket → **analista responde** = inteligência; IA classifica → **sistema responde o cliente sozinho** = autonomia.

---

## 5. Árvore de decisão NOVA (ordem importa)

```
1. O sistema EXECUTA uma ação consequente na última ponta, sozinho
   (muda o estado do mundo / atua sobre o objeto do processo sem um humano confirmar)?
        SIM → AUTONOMIA   (independe de IA — decisão pode ser IA ou árvore de lógica)
        NÃO ↓
2. Usa IA como FUNCIONALIDADE (gera/classifica/extrai/recomenda) e um humano age sobre o output?
        SIM → INTELIGÊNCIA
        NÃO ↓
3.            → AUTOMAÇÃO   (determinístico; entrega informação/output ou ação trivial fixa)
```

A ordem **inverte** a árvore atual (que começava por "tem IA?"). Agora a **ação na última ponta** é a primeira pergunta e tem precedência sobre a IA.

---

## 6. Conceito-chave: "ação consequente na última ponta"

Este é o coração da mudança e a fonte da ambiguidade. Precisa estar **cravado no prompt** com exemplos.

**É ação consequente (→ autonomia)** — o sistema **atua sobre o objeto do processo / muda o estado do mundo** sem humano confirmar:
- tira/aplica cupom, ajusta preço, move estoque;
- responde o cliente / fecha o chamado;
- aprova ou reprova um pagamento/pedido;
- cria/edita/exclui registro num sistema externo como decisão final;
- posta, envia, dispara uma ação **que tem efeito**, não só informa.

**NÃO é ação consequente (→ no máximo automação/inteligência)** — **para na informação/output** para um humano decidir:
- gerar/atualizar dashboard, relatório, planilha;
- alerta / notificação / e-mail **informativo**;
- recomendação, ranking, classificação que vira **fila** para alguém tratar;
- "apontar que a margem caiu" sem agir sobre o produto.

> Regra de bolso: **se a saída final é INFORMAÇÃO para um humano, é automação (ou inteligência se houver IA). Se a saída final é uma AÇÃO que muda algo, é autonomia.**

### 6.1 "Rodar sozinho 24/7" NÃO é o critério (armadilha do coletor de dashboard)

Cuidado com a palavra **"age sozinho"**: um fluxo de **coleta de dados para dashboard** roda 24/7, dispara por agendamento, faz `extrai → trata → carrega o painel` **sem nenhum humano** — e mesmo assim é **automação**. "Operar sozinho por trigger" é a definição do **nível 1 (automação)** no próprio slide (*"+ trigger: roda sozinho"*); **não** é a de autonomia (*"+ execução: age"*, nível 3). Operar é o **meio**; tomar a ação consequente é o **fim**.

O pipeline de qualquer agente: `extrai → trata → analisa → [DECISÃO] → AÇÃO de negócio`.
- **Automação / inteligência** rodam 24/7 fazendo `extrai → trata → analisa → mostra` e **param antes da decisão+ação**. O coletor de dashboard vive aqui: `carregar no painel` é **operação/meio**, a saída é **informação**.
- **Autonomia** é a que também faz `[DECISÃO] → AÇÃO` na ponta — executa **a ação que um humano tomaria com base na informação** (tirar o cupom), atuando sobre o **objeto do processo**, sem confirmação humana.

**Dois testes determinísticos para o classificador:**
1. **Teste da saída final** — o último passo entrega **informação** (painel, relatório, alerta, recomendação, fila) ou **muda um estado de negócio** (cupom, pedido, ticket, conta)? Informação → não é autonomia, por mais 24/7 que rode.
2. **Teste do "e depois?"** — quando o sistema termina, **ainda falta um humano decidir e agir**? Sim → automação/inteligência. O sistema já fechou o caso → autonomia.

**Casos-limite (para não confundir):**
- **Alerta / e-mail automático** ("a margem caiu") → envia algo, mas é **informativo**: passa a bola para um humano decidir → **automação**.
- **Gravar resultado em planilha / banco / outro sistema** como parte do fluxo → é **persistência/meio**, não a ação de negócio final → **não eleva**.
- **Gate de aprovação humana no meio** (o sistema sugere, um humano confirma antes de executar) → **não** é autonomia (a ação tem confirmação humana) → inteligência (se IA) ou automação.

---

## 7. Guardrails / antipadrões (o freio anti-dashboard)

Estes precisam virar texto explícito no prompt do `analyzer.ts` (substituindo/ampliando o bloco atual de antipadrões):

1. **Eliminar/reduzir trabalho humano é SAVING (impacto), NÃO complexidade.** Um dashboard que **antes era feito por muita gente e hoje por ninguém** (24/7) continua `automacao` se **para na informação**. O fato de "não ter mais humano fazendo" se refere à **produção do output**, não à **tomada da ação** — não eleva para autonomia.
2. **"Automatizou até a última ponta do dashboard" ≠ autonomia.** A "última ponta" relevante é a **tomada de ação consequente**, não o fim do pipeline de dados. *"Um dashboard não toma decisão E ação."*
3. **Ter decisão / `if-else` não eleva nada** — *"a decisão até uma automação pode dar"*. O que separa é a **ação automática** sobre o objeto do processo.
4. **Sofisticação de engenharia / muitas integrações / alto impacto ≠ autonomia** (e ≠ inteligência). (Princípio que já existe para inteligência, agora reforçado para autonomia.)
5. **Decisão por IA não é pré-requisito de autonomia, mas também não é atalho:** IA que só gera output para um humano = `inteligencia`, nunca `autonomia`.

---

## 8. Exemplos canônicos (reescritos para o novo modelo)

| Projeto | Nível | Por quê |
|---|---|---|
| Dashboard de **margem diária do Hugo** (aponta produtos que derrubam a margem) | **automacao** | Chega até a **informação**; um humano decide e age. Não tira cupom sozinho. |
| O mesmo, mas que **tira os cupons do produto automaticamente** ao detectar a queda | **autonomia** | Toma a **ação consequente** na ponta, sozinho — mesmo que a decisão seja por regra (sem IA). |
| Painel que puxa pedidos do Protheus, notifica aprovadores e **monta e-mail** para o fornecedor | **automacao** | Orquestra dados e **informa**; nenhuma IA como feature; a ação final (aprovar) é humana. |
| n8n que **gera documentação por IA**; humano consulta | **inteligencia** | IA como funcionalidade; humano no loop, sem ação autônoma. |
| Robô que **classifica tickets por IA** e roteia para a fila; analista trata | **inteligencia** | IA classifica (feature); a ação é humana. |
| Agente que recebe o chamado, **decide e responde o cliente sozinho** | **autonomia** | Decide + **age** na ponta com intervenção humana mínima. |
| RPA determinístico que, ao detectar condição X, **aprova o pedido** sozinho no ERP | **autonomia** | Ação consequente automática **sem IA** (era impossível no modelo atual). |

---

## 9. Onde vai aterrissar no código (mapa para o PR de implementação)

> Marcado como **proposta** — a estrutura fina dos sinais é o item em aberto da §11.

1. **Prompt do analisador** — `src/lib/agents/analyzer.ts` (bloco "CLASSIFICAÇÃO DE COMPLEXIDADE", ~`174-213`):
   - Trocar a porta-mestra "tem IA?" pela **árvore da §5** (ação primeiro).
   - Reescrever a definição dos 3 níveis (§4), o conceito de "ação consequente" (§6) e os antipadrões (§7), com os exemplos da §8.
2. **Gates determinísticos** — `analyzer.ts` ~`412-434`:
   - O gate `usa_ia === false → automacao` **não pode mais** rebaixar quando houver **ação autônoma**. Introduzir um sinal de ação (ver §11) e reordenar: `ação autônoma → autonomia` tem precedência; senão `tem_ia → inteligencia`; senão `automacao`.
   - Manter D2: sem IA e sem ação → `automacao`.
3. **Novo(s) sinal(is)** — `agents/types.ts`:
   - Provável novo campo de **inferência do LLM** em `ResultadoAnalise` (ex.: `acao_autonoma: boolean`), espelhando o papel do `usa_ia`.
   - **Opcional** (a confirmar, §11): pergunta determinística na fase *doc* (`buildDocPrompt`, `orchestrator.ts` ~`173-190`) — algo como *"a automação executa uma ação sozinha (sem um humano confirmar)?"* — virando um campo em `DocumentacaoColetada` com **precedência**, no mesmo padrão de `tem_ia_como_funcionalidade`.
4. **Registro de prompt (regra 3 do CLAUDE.md)** — atualizar `src/lib/testes/prompt-registry.ts` e o `prompt-inspector.tsx`.
5. **Testes** — adicionar casos do §8 (em especial: determinístico-que-age = autonomia; dashboard-sem-humano = automação) à suíte de prompts/analyzer.
6. **Sheets** — coluna "Complexidade" (`sheets.ts:58`) **não muda** (mesmo enum, D3).
7. **Memória / docs** — atualizar a nota `complexidade-classificacao` e `docs/agents.md`.

---

## 10. Plano de validação (sugerido pelo gestor)

> *"Um critério para vocês saberem se deu certo seria **duplicar a base de dados e rodar uns testes** retroativos, e ver se os resultados se mantêm. Se ele categorizar algo como **autonomia**, entramos e olhamos o que levou ele a categorizar assim."*

1. Rodar o **decisor novo sobre os projetos já submetidos** (base de produção duplicada / cópia).
2. **Esperado:** quase nada deve virar `autonomia` (o gestor avalia que hoje "não tem nada autônomo, ou quase nada"). Um salto grande para autonomia é **sinal de regressão** (provável armadilha do dashboard).
3. Para **cada** projeto que o decisor marcar como `autonomia`, **auditar a justificativa** (`complexidade_justificativa`): confirmar que há **ação consequente na ponta**, não só "automatizou até o fim do dashboard".
4. Conferir que **dashboards/relatórios/alertas** continuam `automacao` mesmo quando eliminaram todo o trabalho humano de produção.
5. Pode reaproveitar o harness **`scripts/e2e/`** + LLM-juiz para auditar a coluna "Complexidade" coluna-a-coluna.

---

## 11. Decisões em aberto — RESOLVIDAS na implementação (2026-06-29)

- **Como capturar "ação consequente na última ponta"? → ESCOLHIDA a opção (a): só inferência do LLM** (`acao_autonoma` em `ResultadoAnalise`), com guardrails fortes no prompt (§6/§7) + auditoria obrigatória (§10). **NÃO** adotamos a (b) (pergunta determinística com precedência), apesar de recomendada inicialmente, pelo seguinte motivo (revisão crítica):
  - A pergunta autorrelatada *"sua automação toma uma ação sozinha?"* é o vetor **MAIS** propenso ao falso-positivo de autonomia que o gestor teme (o dono do dashboard responde "sim, roda 24/7 e age!" — a armadilha exata da §6.1), e a precedência **travaria** essa resposta errada. Diferente do `tem_ia` (factual/verificável), a pergunta de ação é difusa e lisonjeira.
  - **Assimetria justificada entre os dois eixos:** o eixo IA usa a pergunta determinística (confiável) — `tem_ia_como_funcionalidade`, com precedência; o eixo AÇÃO fica na inferência do LLM + auditoria (onde o autorrelato seria frágil). Se a auditoria §10 mostrar o LLM caindo no trap, adiciona-se a opção (c) — rebaixamento determinístico, só DEMOVE, nunca força-promove — sem re-arquitetura.
- **Bug G0 corrigido junto (pré-requisito):** descobriu-se que o gate determinístico de `tem_ia_como_funcionalidade` **nunca funcionou em produção** — o sinal era coletado na fase *doc* (em `coletado`) mas a doc compilada (`DocumentacaoGerada`) o descartava, e o analisador lê `documentacao.conteudo`. Quem classificava de fato era só o `usa_ia` inferido. A correção carrega o sinal para o `conteudo` persistido (ver §13).
- **Retrocompatibilidade:** submissões antigas têm `acao_autonoma` e `tem_ia_como_funcionalidade` `null` → caem na inferência do LLM; `normalizarComplexidade` não rebaixa com sinais `null`. Enum e coluna do Sheets inalterados (D3).

---

## 12. Riscos

- **Falso-autonomia (principal):** o decisor confundir "automatizou tudo / eliminou humano" com "age sozinho". Mitigado pelos guardrails §7, exemplos §8 e auditoria §10.
- **Reversão de gate:** ao afrouxar o `usa_ia === false → automacao`, um bug pode deixar passar autonomia indevida. Mitigado pela ordem explícita da árvore (§5) e testes (§9.5).
- **Subjetividade da "ação consequente":** é uma linha tênue reconhecida pelo próprio gestor; o critério "saída final = informação vs ação" (§6) é a régua para reduzir ambiguidade.

---

## 13. Onde aterrissou (implementação — PR #___)

> Branch `docs/spec-complexidade-autonomia` (spec + implementação no mesmo PR, regra 12). Opção (a) da §11.

1. **Prompt do analisador** — `src/lib/agents/analyzer.ts`, bloco "CLASSIFICAÇÃO DE COMPLEXIDADE": reescrito com as duas perguntas (A julgamento / B fechamento do ciclo), a árvore §5 (ação primeiro), as definições §4, o conceito de "ação consequente" §6 com os **três testes desempatadores** (write-como-decisão × persistência; resolve × avisa; confirmação ANTES × override DEPOIS), os red herrings, os antipadrões §7 e os exemplos §8. Pede os campos `usa_ia` (eixo IA) e `acao_autonoma` (eixo ação).
2. **Gate determinístico** — `analyzer.ts`: extraído para a função **pura/exportada `normalizarComplexidade`** (antes era inline em `analisarProjeto` — por isso o bug G0 passou batido). Reordenada (ação > IA): (1) rebaixa autonomia quando `acao_autonoma===false`; (2) os gates de IA só mexem em automacao↔inteligencia e **nunca** rebaixam autonomia (D1), preservando a régua do PR #94 (sem IA no runtime → automacao). `tem_ia_como_funcionalidade` (usuário) tem precedência sobre `usa_ia` (LLM). **Nunca** força-promove autonomia.
3. **Novo sinal** — `src/lib/agents/types.ts`: `acao_autonoma?: boolean | null` em `ResultadoAnalise`.
4. **Correção do plumbing (G0)** — `src/lib/chat.functions.ts`: na aprovação da doc (`doc_preview → saving/receita`), o `tem_ia_como_funcionalidade` coletado é carregado para o `conteudo` persistido (`upsertDocumentacao`), para o analisador enxergá-lo. Antes era descartado → gate de IA morto. Registrado em [SPEC_CORRECOES.md](SPEC_CORRECOES.md).
5. **Registro de prompt (regra 3)** — `src/lib/testes/prompt-registry.ts` atualizado (descrição da régua de dois eixos); `prompt-inspector.tsx` renderiza do registry (sem texto próprio).
6. **Testes (regra 2)** — `tests/analyzer-complexidade.test.ts`: asserts do prompt (árvore ação-primeiro, três testes, red herrings, exemplos) + **testes de unidade da função pura `normalizarComplexidade`** (D1 determinístico-que-age = autonomia; dashboard/alerta = automacao; IA+fila = inteligencia; confirmação pré-ação ≠ autonomia; retrocompat null; não-regressão PR#94; precedência do `tem_ia`). Suíte completa verde (468).
7. **Sheets** — coluna "Complexidade" **inalterada** (mesmo enum, D3).
8. **Validação retroativa (§10)** — harness em `scripts/retroativo/` (roda via vitest, puxa prod com `E2E_COOKIE`, escreve só na aba **`godocs_teste_retroativo`** — nunca na `GoDocs` oficial, sem backfill). **Smoke inicial** (3 submissões) pegou 1 falso-positivo de autonomia (o CRUD de aprovação "GoGroup Mobility", lido como ação autônoma) → corrigido com o **4º teste desempatador** ("QUEM dispara a ação — humano × sistema"); pós-fix os 3 voltaram a `automacao`. ⏳ **Run completo sobre a base ainda PENDENTE** (`RETRO_WRITE=1`) — fazer depois, com calma.

## Decisões fechadas que NÃO podem ser corrigidas por engano

- **D1 — autonomia NÃO exige IA.** Não "reintroduzir" o gate antigo `sem IA → automacao` como se fosse bug. Um sistema determinístico que age sozinho na ponta **é autonomia** de propósito.
- **D2 — inteligência exige IA como funcionalidade.** `if-else`/árvore de lógica que só informa **não** é inteligência (é automação).
- **D3 — são 3 níveis.** Não adicionar "skill simples" sem nova decisão.
- **Dashboard/relatório/alerta que para na informação = automação**, por mais impacto ou eliminação de trabalho humano que tenha. Não "promover" para autonomia.
