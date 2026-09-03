# Calibragem das estrelas — o qualificador vira um TIME interno

> Handoff da sessão de 03/09/2026. A próxima sessão é dedicada a **calibrar** o qualificador de
> estrelas, rodando em paralelo (o loop rápido que esta sessão montou) e comparando contra a
> **baseline gravada** desta rodada.

---

## 1. Onde paramos

### O que roda hoje em prod

Um agente ÚNICO (`src/lib/agents/especial-classificador.ts`) recebe o dossiê + os vizinhos do
RAG e devolve `{nota, confiança, leitura, evidências do escape}`. Uma chamada de LLM por
projeto, ~20 s. Não escreve a coluna "Estrelas" — grava recomendação em `especial_avaliacao`.

Existe também o TIME completo em `src/lib/avaliacao/` (dossiê → 4 especialistas → cérebro do
mérito + cérebro da estrela → consolidação → 2 céticos → consenso), que roda em sombra pelos
crons. **Os dois caminhos leem a mesma régua** (`src/lib/estrelas-regua.ts`) — não criar uma
terceira.

### A régua (fechada pelo Luis em 03/09)

`0 Experimenta · 1 Informa · 2 Executa · 3 Garante · 4 Decide · 5 Assume`, cada nível com
critério **e exemplos reais da base**. A faixa **6–10 "Muda o Jogo"** é UM critério só: o agente
indica a faixa e o comitê humano crava o número.

### Os 4 defeitos consertados nesta sessão (todos MEDIDOS, nenhum de critério)

| # | defeito | como apareceu | conserto |
|---|---|---|---|
| 1 | A régua v2 não estava no caminho vivo | 734 projetos, **zero 6★ e zero 9★** | classificador passou a ler `estrelas-regua.ts` |
| 2 | O prompt abria com *"recomenda a estrela (0 a 5)"* e punha o escape como apêndice | só **8 de 65** leituras mencionavam o escape | escape virou **PASSO 1**, com `escape.por_que_nao` obrigatório |
| 3 | O porquê saía no vocabulário do código | *"falta prova de que o modo anterior deixou de existir"* | lista de palavras proibidas + a tradução de cada uma |
| 4 | Plataforma era reprovada por falta de confissão literal | PIAPP (10★ humano) → **2★** | **caso da plataforma** nomeado na régua: dependente NOMEADO satisfaz os 2 gatilhos |

⚠️ **Um erro meu que vale registrar para não repetir:** criei `especiais-regua-v2.ts`
duplicando a régua sem ver que `estrelas-regua.ts` já era exatamente ela. Antes de escrever
régua nova, **procure a que existe**.

---

## 2. A baseline — `docs/baselines/estrelas-2026-09-03-run1.json`

**616 de 646 aprovados**, 8min36 com concorrência 36, 2 falhas repescadas.

```
0★ 278 (45,1%)   1★ 148 (24,0%)   2★ 119 (19,3%)   3★ 39 (6,3%)
4★  11 ( 1,8%)   5★  16 ( 2,6%)   6★   4 ( 0,6%)   7★  1 (0,2%)
```

**Escape (5):** CTR Machine Admaker 7★ · PIAPP 6★ · ecom-metrics-hub 6★ · Integração Life of
Colour 6★ · Agente SDR Gobeaute 6★.

### Como ler a concordância — e a armadilha

Contra as 486 linhas "com nota humana", o agente fica acima 200× e abaixo 59× → parece
inflação. **É artefato:** 367 dessas 486 (76%) têm nota humana **0**, e 0 naquela coluna quase
sempre significa "ninguém avaliou", não "avaliei e vale zero".

Contra os **119 que alguém de fato avaliou** (nota > 0):

| | |
|---|---:|
| idêntica | 33 |
| agente acima | 27 |
| agente **abaixo** | **59** |
| dentro de 1★ | 88 (74%) |

**O agente é conservador**, fica abaixo 2,2× mais do que acima. Use SEMPRE o recorte
`humana > 0` para medir concordância; o outro engana.

---

## 3. O que a próxima sessão tem de investigar

### 3.1 Os 3 casos de "humano 0 → agente 5"

O Luis apontou este exatamente. Havia um humano no meio e a nota era 0.

- `CX Hub — Plataforma Central de Operações`
- `IARA + Central RA: Autoatendimento e Gestão`
- `Automação de subidas de vídeo nos canais das marcas`

**A pergunta não é "quem está certo".** É: aquele 0 foi um veredito ou uma célula que ninguém
tocou? Confira no `admin_activity_log` / `especial_avaliacao` se alguém gravou a nota, e em que
data. Se ninguém gravou, o "0" não é contraprova e esses 3 não são erro do agente.

### 3.2 Os 7 casos de "humano > 0 e agente +3 acima"

`Envio de Comprovante de Reembolso 1→5` · `Controle de Pedidos de Compra 2→5` · `CTR Machine
Admaker 4→7` · `Automação envio Reinf 2→5` · `ecom-metrics-hub 3→6` · `Integração Life of
Colour 2→6` · `Esteira de Hits 1→5`.

Estes têm nota humana real. São o material de calibragem mais valioso da base.

### 3.3 ⚠️ A contradição PIAPP × Prisma

O agente deu **6★ ao PIAPP** citando *"o Prisma já opera sobre ela"*, e **0★ ao Prisma** dizendo
*"o memorial descreve capacidades, mas não comprova campanhas em operação"*. Usou o Prisma como
prova de operação em curso e depois negou que o Prisma opere.

**É o argumento nº 1 a favor do time interno:** um agente único, julgando projeto a projeto em
chamadas independentes, não enxerga a própria contradição.

### 3.4 O escape virou "é plataforma"

**3 dos 5** entraram por "sustenta outros projetos nomeados". A regra que adicionei está
fazendo quase todo o trabalho da faixa. Decidir com o Luis: existe um segundo caminho de
entrada (muda o jeito de trabalhar sem ser infraestrutura de outros)?

### 3.5 Bug conhecido, não consertado — 30 projetos invisíveis

`LEGADO-049` devolve *"projeto sem contexto para classificar"*; `legado-049` passa. **A busca do
projeto é case-sensitive** onde o resto do repo trata ID como case-insensitive. Os 30 não
avaliados são todos `LEGADO-*` maiúsculo, e têm descrição na planilha. Conserto pequeno:
normalizar a chave em `classificarEspecialProjeto` / `montarEntradaSemantica`.

---

## 4. O trabalho da próxima sessão: o qualificador vira um TIME

Hoje a estrela sai de **um cérebro**. A proposta é subdividir, com contexto repartido e
adversariais entre eles, para que cada centímetro do texto do projeto seja lido por alguém.

### Desenho proposto (a validar com o Luis antes de codar)

```
                        ┌─ lente FUNÇÃO      (o que o projeto FAZ, na cadeia informação→ação→consequência)
  dossiê ─ repartido ──┼─ lente ALCANCE     (quem usa, quantos times, quem depende — o eixo do escape)
                        ├─ lente AUTONOMIA   (roda sozinho? decide? quem aprova? o que acontece se errar)
                        └─ lente LASTRO      (o que o texto PROVA × o que ele só promete)
                                   │
                          consolidação (regra fixa, sem média)
                                   │
                          cético da NOTA ──── volta 1× ao consolidador
                                   │
                          cético do ESCAPE (só quando indicado 6–10)
                                   │
                                nota + porquê
```

**Invariantes que já valem e não podem regredir:**

1. **Só rebaixa, nunca promove** — no código, não no prompt (`normalizarCeticoEstrela` clampa no
   teto da proposta). Um falso 8★ vira âncora congelada e contamina todo mundo depois.
2. **Escape sem as 2 citações → 5★**, checado por `escapeValido` antes de qualquer LLM.
3. **6–10 sempre vai ao humano** (`contestada: true`).
4. **Régua em fonte única** (`estrelas-regua.ts`). Lente nova interpola de lá, não redigita.
5. **O porquê em português comum** — teste `tests/porque-linguagem.test.ts` trava o jargão.

**O que o painel de agentes já mediu e NÃO deve ser retentado** (ver
`docs/plans/painel-agentes-especiais.md`): curva no prompt da lente · teto/margem por volta ·
soltar a consolidação · revisor só a partir de 4 · rejeição por eixo. E a lição que importa: dar
a **régua global** a cada lente fez **nenhuma** passar de 2★. Cada lente recebe as âncoras **do
eixo dela**.

⚠️ **Custo:** hoje são ~20 s e 1 chamada por projeto (8min36 para 616 com CONC=36). Um time de
4 lentes + 2 céticos é ~6× isso. Ou o time roda **só na faixa alta** (o agente único filtra), ou
a rodada completa passa de 45 min. **Decidir isso ANTES de codar.**

---

## 5. O loop rápido (funciona, use)

```bash
# roda a base inteira em paralelo (~8 min com CONC=36)
cd ~/godocs-wt-categoria-aglutinacao
APROVADOS=1 CONC=36 SAIDA_JSON=/tmp/run2.json \
  npx tsx --env-file=.env scripts/v2/classificar-paralelo.mts --go

# análise crítica: distribuição, escape, viés, "plataforma"
node scripts/v2/analisar.mjs /tmp/run2.json

# artefato (tabela + filtros por estrela + busca sem acento)
node scripts/v2/gerar-artefato.mjs /tmp/run2.json /tmp/run2.html
```

**Por que o paralelismo mora no cliente:** a rota de lote processa em SÉRIE (medido: 61 s para
2 projetos). `/api/admin/especiais/classificar` recebe um `projetoId`, então a concorrência é
controlável aqui. Falha vira **relatório**, nunca silêncio — 502 do gateway não é nota baixa, é
"ninguém perguntou", e há repescagem automática.

⚠️ **Todo ajuste de prompt exige deploy antes de rodar.** Nesta sessão parei duas rodadas no meio
por ter mudado o prompt depois de disparar. Ordem: ajusta → testa em 2 projetos → build → deploy
→ roda a base.

### Comparar run 2 contra a baseline

```bash
node -e "
const a=require('./docs/baselines/estrelas-2026-09-03-run1.json');
const b=require('/tmp/run2.json');
const m=new Map(a.linhas.map(x=>[x.id,x.agente]));
const mudou=b.linhas.filter(x=>m.has(x.id)&&m.get(x.id)!==x.agente);
console.log(mudou.length,'projetos mudaram de nota');
mudou.sort((x,y)=>Math.abs(y.agente-m.get(y.id))-Math.abs(x.agente-m.get(x.id)))
 .slice(0,25).forEach(x=>console.log(' ',m.get(x.id),'→',x.agente,x.nome.slice(0,44)));
"
```

**A pergunta ao comparar não é "subiu ou desceu".** É: *o motivo escrito sustenta a mudança?*
Um projeto que sai de 0★ para 5★ tem de trazer, na leitura, o fato do dossiê que mudou o
veredito — se a leitura não diz, a nota nova não vale.

---

## 6. Estado do resto (fechado nesta sessão, não é trabalho da próxima)

- **Planilha `GoDocs` migrada** para a v2: 59 colunas, 19 renomeações com o dado carregado
  junto (pares dinheiro↔frequência verificados um a um), `Impacto Bruto`/`Líquido`/`Líquido
  Mensal` recalculados. Backup em `docs/baselines/` e no `retroativo-impacto-GoDocs-*.json`.
- **Impacto, aprovados:** R$ 1.143.245 (v1) → R$ 882.427 (v2, −23%) → **R$ 622.748/mês**.
- **3 linhas** não recalculadas, precisam de decisão humana: `legado-141` e `f872b3d9…`
  (`Freq. Saving Efetivado = "Misto"`), `LEGADO-185` (R$ 73k de receita sem frequência).
- **Aglutinação:** 28 sugestões em prod, aguardando validação em `/aglutinacao`.
- **Chave de embeddings** (`LLM_EMBEDDINGS_KEY`) viva em prod, staging e `.env`.

### Artefatos

| | |
|---|---|
| Estrelas da Base (616 projetos) | https://claude.ai/code/artifact/69cdc62b-8cc6-4114-b1ab-7249d34c12d1 |
| Anatomia do Time de Agentes | https://claude.ai/code/artifact/710327b4-7695-440a-a17a-b3282118d966 |

### Pendências de processo

- **A branch `feat/categoria-aglutinacao` está em PROD mas NÃO no `main`** — regra 14. Merge
  pendente, com `git fetch origin` e rebuild antes.
- **CLAUDE.md não foi atualizado** com nada desta sessão (régua, 2 céticos, migração da aba).
