# O time de agentes: o grafo contra o código (09/09/2026)

O desenho é `docs/anatomia-time-agentes.html`, e ele é o **alvo**, não o retrato. Este documento
compara os dois nó por nó e nomeia onde o código não faz o que o desenho afirma.

⚠️ **Régua deste documento:** cada ponta solta traz *onde está no código*, *o que se vê se ela
passar calada* e *o preço do conserto*. Ponta solta sem sintoma observável não entra na lista, e
"melhorar o prompt" não é conserto de ponta solta.

## O que FUNCIONA (o desenho diz a verdade)

| Nó / aresta do grafo | Onde vive | Confirmado |
|---|---|---|
| Dossiê como entrada ÚNICA, igual para todos, com lacunas declaradas | `avaliacao/dossie.ts` | sim |
| Orquestrador dispara os 5 especialistas **em paralelo** | `time.ts` → `Promise.all(DIMENSOES_MERITO…)` | sim |
| Cada especialista com suas ferramentas, loop de teto 2 | `ferramentas.ts`, `loopComFerramentas` | sim |
| Consolidação do mérito por quórum 2 + regra do dado duro | `cerebro-merito.ts` → `consolidarMerito` | sim |
| Cético → réplica com teto de 2 rodadas, e **o orquestrador redispara os 5** | `time.ts` (laço do debate) | sim |
| Cérebro da estrela + cético da estrela, 1 volta, com piso estrutural | `time.ts` → `rodarEstrela`/`rodarCeticoEstrela` | sim |
| Log em ÁRVORE, toda peça pendura num pai do mesmo ciclo | `agentes-log*.ts`, `agente_log` | sim |
| Catálogo de falhas TRANSVERSAL (qualquer peça reporta) | `agentes-falhas.ts`, relator instalado no worker DEPOIS do `__waitUntil` | sim |
| Piso e invalidez ANTES de todo o resto no consenso | `consenso.ts` (as 2 portas) | sim |
| `reprovar` nunca age sozinho (sem flag de liberação) | `consenso.ts` → `age_sozinho` | sim |

## O que NÃO FUNCIONA — 9 pontas soltas

### P1 · No time, o piso reprova por DINHEIRO SOZINHO ⛔ a mais grave
`consenso.ts:184` faz `abaixoDoPisoDeImpacto(ctx.impactoMensal)` e reprova. A régua **composta**
que o dono do produto definiu (impacto mensal `0 < x < 100` **E** nota `< 1`, e **sem nota avaliada
NÃO reprova**) mora só na MESA, em `materialidade-piso.ts` (`reprovaPeloPiso` + `notaParaOPiso`).

⚠️ E o time é justamente quem tem a nota **na mesma passada** (`b.nota` já está em `conciliar`).
**Sintoma se passar calado:** o time recomenda reprovar projeto de 2★–4★ com impacto baixo, que é
o caso que a régua composta existe para poupar (medido: o piso sozinho derrubaria 45 aprovados; com
a segunda perna, 29; com a inversão de 09/09, **1**). **Preço:** 1 arquivo, a régua já é fonte única.

### P2 · O cérebro da estrela é CEGO ao painel do impacto
`buildPromptEstrela({dossieTexto, vizinhos, ferramentasTexto, objecaoDoCetico})`. Os 5 julgamentos
do mérito **já existem** quando ele roda (rodada 1 na linha 329, cérebro na 407) e não entram no
prompt. Os dois cérebros julgam o mesmo dossiê em paralelo e nunca se falam antes do consenso.
**Sintoma:** a nota ignora que o financeiro achou o valor absurdo, que a evidência não fecha ou que
o precedente já tem duplicata. **Preço:** zero chamada nova, zero latência (a ordem já favorece).

### P3 · As 4 LENTES não estão no time
Nada em `src/lib/avaliacao/` importa `agents/especiais-lentes`. Elas rodam em dois lugares que não
são o fluxo: `especiais-painel.ts` (auditoria em lote, cron **não agendado**) e como AJUSTE do
classificador de 1 agente (`especial-classificador.functions.ts`), que desde 09/09 **não é mais
quem dá a nota**. **Sintoma:** o "time da estrela" do desenho é um cérebro decidindo só, sem time
embaixo. **Preço:** +4 chamadas leves por projeto (as 4 em paralelo, ~+40 s sobre os ~3 min).

⚠️ **Como amarrar sem quebrar o calibre da run 9:** a nota do cérebro é a BASE e as lentes
**AJUSTAM no máximo 1 degrau** (`AJUSTE_MAX_PAINEL`), só para cima, e piso nomeado zera de qualquer
altura. Medido: o painel decidindo sozinho deu **2, 5, 3, 7, 8 e 3** em seis chamadas idênticas para
o mesmo projeto; base + ajuste deu **8, 8, 8**. Não trocar isso por "as lentes decidem".

### P4 · Duas implementações do MESMO revisor da nota
No time o revisor é o papel `cetico_estrela` (`time.ts`); no painel de auditoria é
`agents/especiais-revisor.ts` + a máquina `especiais-convergencia.ts` (com o piso estrutural que
salvou o «[VERSTA] Robô orçamento» de fechar em 0★ sendo 8★ humano). Duas réguas para o mesmo
papel, e a que está no fluxo é a que **não** tem a máquina de convergência.

### P5 · As lições da triagem não chegam ao time
O grafo desenha `Lições da triagem → Dossiê` **em produção**. `licoesParaPrompt` é chamada pela
mesa (`avaliacao-normais.functions.ts:572`) e pelo classificador; `grep` em `src/lib/avaliacao/`
devolve **zero**. **Sintoma:** o 👎 da triagem treina a mesa e não treina o time.

### P6 · A evidência é ILEGÍVEL, e a ferramenta admite isso por escrito
`ler_evidencia` se descreve como *"Hoje o texto NÃO é persistido — a ferramenta devolve o link e o
aviso"*. `anexo_texto` **não existe em `src`**. **Sintoma:** o especialista de evidência julga prova
que não pode abrir, em **746 dos 750** projetos que têm anexo no Drive.
⚠️ **E o código dessa fatia está NÃO-COMMITADO** no worktree `~/godocs-wt-calibragem-c`
(`src/lib/visao-anexo.server.ts` + `src/lib/notificacao-agente.ts` + 10 arquivos modificados, entre
eles a fatia do card do Chat): um `git checkout` ali perde tudo. **Commitar isso vem antes de
qualquer coisa.**

### P7 · `ajuste` é uma 4ª saída que o desenho não tem
`conciliar` produz `aprovar | ajuste | humano | reprovar`; a decisão fechada são **3**
(`aprovar`/`reprovar` + `em_validacao` só na faixa 6-10). **Sintoma:** o desfecho de metade dos
casos em que o cético sustenta a refutação cai num balde que nenhuma tela lê como fila.

### P8 · Vazão: a base inteira não caberia
~3 min por projeto, `LOTE_MAX_PROJETOS = 1`, iterado pela TELA. 511 aprovados ≈ **25 h de aba
aberta**. **Sintoma:** "a base sem faltas" não acontece; o que acontece é a fila de 33 (abaixo do
piso e sem nota avaliada, ~1 h 40).

### P9 · Não existe medição válida depois dos consertos
Todo número que temos foi medido com a **mesa cega ao dinheiro** (41,4 % de erro grave) ou com o
**RAG morto** (12 projetos julgados sem um único vizinho, notas achatadas em 0★). Remedir é parte do
conserto, não passo opcional.

## O desenho em si: o que eu mudaria

1. **P1 e P3 não pedem mudança de traço.** O grafo já afirma a régua composta no nó `Piso de
   impacto` e já põe as 4 lentes sob o cérebro. Quem está errado é o código.
2. **`Junta as duas análises` deve sair de "fora de produção".** A fusão EXISTE: `conciliar` recebe
   mérito e estrela juntos. O que não existe é uma caixa separada com esse nome. Marcá-la como
   pendente faz o leitor perguntar por um módulo que não vai nascer.
3. **A aresta `Lições → Dossiê` é a única do desenho que afirma algo falso** (P5). Ela fica, porque
   é o alvo, mas o nó `Lições da triagem` passa a declarar no painel que hoje só alimenta a mesa.

## Ordem de conserto

| # | O quê | Por que nessa ordem |
|---|---|---|
| 0 | Commitar o que está solto em `~/godocs-wt-calibragem-c` | é trabalho pronto em risco de `checkout` |
| 1 | **P1** régua composta do piso no time | mais grave, mais barata, a régua já é fonte única |
| 2 | **P2** o cérebro vê o painel do impacto | zero latência, é o pedido literal do dono do produto |
| 3 | **P3 + P4** as 4 lentes dentro do time, um revisor só | a amarração; base + 1 degrau preserva o calibre |
| 4 | **P5** as lições chegam ao time | fecha o laço de aprendizado |
| 5 | **P7** colapsar `ajuste` em `humano` | alinha código e desenho nas 3 saídas |
| 6 | **P6** anexos legíveis (texto + visão) + backfill | material, e é o que mais muda a análise |
| 7 | **P8** cron de vazão · **P9** remedir a acurácia | só faz sentido com o resto no lugar |
