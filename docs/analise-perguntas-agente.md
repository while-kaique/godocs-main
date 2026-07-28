# Análise — quantas perguntas o agente faz, e quais são redundantes

> Baseline empírico para a frente "perguntas do agente" (plano:
> [`plans/perguntas-agente-recorrencia-evidencia.md`](plans/perguntas-agente-recorrencia-evidencia.md), T1).
> Feito em **28/07/2026** sobre **conversas reais de produção**, não sobre o banco local (que só tem
> rascunho de teste).

## Método e fonte

- **Amostra:** as **24 submissões não-legado mais recentes** de prod — `submitted_at` de **25/07 a
  28/07/2026** (as duas primeiras do dia da coleta). 21 de saving, 1 de receita, 2 especiais.
- **Coleta:** `GET /api/admin/investigador/projetos/<id>` (traz `chat_messages` enriquecidas,
  `form_events`, `versions`), autenticado com o `E2E_COOKIE` do `.env`. IDs recentes tirados de
  `GET /api/admin/projetos` (605 registros).
- **Contagem:** uma "pergunta da IA" = mensagem `assistant` com `type` `question` ou `options`.
  `preview`/`complete` não contam. Os padrões (alocação, jornada, split, IA…) são casados por regex sobre
  o texto da pergunta — script guardado no scratchpad da sessão (`digest.cjs`, `pat.cjs`); o critério de
  cada regex está no próprio arquivo, então a contagem é reprodutível.
- ⚠️ **`GET /api/admin/investigador/projetos` (a lista do painel) está QUEBRADA em prod** — HTTP 503
  Cloudflare `1102` (worker sem recursos). Causa: `investigador.functions.ts:225-226` chama
  `getChatMessages` dentro do loop, para **todos os 605 projetos** (N+1). Mesmo gênero do bug de jul/2026
  na aba Edições, mas por CPU/tempo em vez do teto de RPC. **Não é escopo desta frente** — anotado como
  pendência à parte.

## Baseline

| Métrica | Valor |
|---|---|
| Conversas | 24 |
| Perguntas da IA (total) | **154** |
| Média por submissão | **6,4** |
| Máximo | **16** (Classificação Automática de NPS) · depois 14 e 12 |
| Mínimo | 1 (os 2 especiais — pulam a fase de impacto) |
| Perguntas na fase **doc** | 44 (29%) |
| Perguntas na fase **saving** | **96 (62%)** |
| Perguntas **depois** do preview de saving | **13**, concentradas em 4 conversas |
| Perguntas vindas dos 4 gates de sistema | **52 de 154 (34%)** |

Distribuição dos gates na amostra: alocação de ganhos **19** · jornada/base 220h **15** (+3 do
encadeamento "quais dias") · split carga×escala **14** · teto por pessoa **1**.

## Achados

### A1 — O gate da alocação de ganhos só aceita "mais saída" e rejeita "menos custo" ⛔ o mais grave

**O que acontece:** quando o saving é alto (≥44h/mês), o agente exige que o memorial diga *"o que o time
passou a entregar **A MAIS**"*. Quando o ganho real do projeto foi **redução de custo** — cortar hora
extra, reduzir headcount, deixar de repor vaga — a resposta correta do usuário **não cabe no formato
exigido**, e o agente repergunta indefinidamente, reformulando.

**Evidência (2 casos independentes, ambos com o ganho mais concreto que existe):**

- **`e57b287a` Conferência por bipagem Charlie** (48h/mês) — o usuário responde que houve **redução de 3
  auxiliares de expedição**. O agente repergunta **5 vezes** depois do preview. Na 4ª:
  _"A frase 'o time mantém a mesma quantidade de fechamento com um time menor' ainda está genérica…"_ —
  ou seja, **recusa explicitamente "mesma entrega com menos gente"**, que é o desfecho mais verificável
  possível.
- **`60b97477` Expedição B2B** (60h→50h/mês) — o usuário responde que o tempo liberado **reduziu carga e
  cortou horas extras, sem aumento de volume**. O agente repergunta **4 vezes** depois do preview.
- Também em `32bfb987` GoRender (3 perguntas de alocação) e `936f764e` (5).

**Causa, nas duas camadas:**

1. `orchestrator.ts:873` manda buscar _"O QUE essas pessoas passaram a entregar A MAIS agora — de
   preferência com NÚMERO"_ e `orchestrator.ts:883` transforma isso em **GATE** ("é PROIBIDO gerar o
   preview sem…"). A lista de destinos aceitáveis em `orchestrator.ts:872` **até menciona** "redução de
   equipe-vaga não reposta" e "serviço terceirizado CANCELADO" — mas a régua de aceitação que vem depois
   é só "entrega a mais", então a menção não se sustenta.
2. `buildSavingPreviewPrompt` repete a exigência **e manda recusar "mesmo que o usuário diga
   'aprovado'"** — e ali, diferente do gate determinístico, **não há contador anti-loop**. O
   `perguntaAlocacaoGanhosFirme` (`chat.functions.ts`) limita a **1** reperguntada; o juiz do preview não
   limita nada. É por isso que as 13 reperguntas caem todas na fase `saving_preview`.

**Ligação direta com a nota do Rafa:** _"Impacto não precisa ser receita. Horas, erro, retrabalho, fraude,
risco, prazo. Tudo vale, desde que seja recorrente e verificável."_ O gate hoje aceita **uma** família de
impacto e trava nas outras. Corrigir isso é implementar o ponto 4 dele — e é a correção de maior retorno
da frente inteira: sozinha, elimina ~13 das 154 perguntas e a pior experiência da amostra.

### A2 — Os gates não escalam com a materialidade (contradizem o próprio prompt)

**`897df986` Painel de Segurança do Trabalho** economiza **0,05h/mês — três minutos**. Ele recebe, ainda
assim: 4 turnos validando a rotina e o gate completo _"a base padrão que eu uso é de **220h úteis por
mês**… alguém trabalha ou usa esse processo nos fins de semana?"_. Quatro perguntas para validar 3 minutos.

Os predicados não olham magnitude: `aplicaConfirmacaoBaseHoras` (`orchestrator.ts:462`) e
`aplicaSplitCargaEscala` (`orchestrator.ts:480`) disparam com **qualquer** `horas_antes > 0`. O gate da
alocação (`:502`) é o único com limiar (≥44h).

Isso **contradiz uma regra que já está escrita no mesmo prompt** (`orchestrator.ts:1034`): _"CALIBRE A
PROFUNDIDADE PELA MATERIALIDADE… Para ganhos pequenos e plausíveis, NÃO burocratize"_. A regra vale para o
LLM; os gates determinísticos, adicionados depois, a ignoram. Jornada dispara em **15 de 24** conversas —
a maioria longe de qualquer teto.

### A3 — A pergunta de recorrência custa 3 turnos e ainda sai incompleta

**`62b60c15` Classificação de NPS** (16 perguntas, a maior da amostra) gasta três turnos consecutivos no
trigger: [1] _"me diga a agenda exata de execução"_ → [2] _"essa execução diária acontece de qual
forma?"_ → [3] _"qual é o horário fixo dessa execução diária?"_. `trigger` casa 13 vezes na amostra, com
2 turnos em 3 conversas.

Consequência para o plano: a **recorrência** (critério 1 do Rafa) não precisa de pergunta nova — precisa
de **uma** pergunta bem formulada, que colha numa só vez o que hoje leva três e mesmo assim não conclui se
"roda de novo sem alguém pedir".

### A4 — "Usa IA como funcionalidade" custa 2 turnos, mesmo quando já foi inferida

A pergunta aparece em **15 de 24** conversas e, quando a resposta é "sim", vem a segunda pedindo o
detalhamento (`ia_detalhe`: **11**). Em vários casos o agente **já sabia** e mesmo assim gasta os dois
turnos: `0c27f59f` PCP BIA (_"percebi que a BIA usa Claude/Anthropic ou Groq… é isso mesmo?"_),
`3508e811` (_"a IA gera a arte estilo Pixar… é isso mesmo?"_), `3b3a1a1f`, `3d3c3e6a`. É deliberado
(`orchestrator.ts:191`: _"NUNCA pule essa pergunta… a confirmação tem que vir do usuário"_), mas o preview
da doc **já é aprovado pelo usuário** logo depois — a confirmação pode viver lá, economizando 1-2 turnos
em quase toda submissão.

### A5 — Gates encadeiam pergunta sobre pergunta

O gate de jornada, quando a resposta é "sim, há trabalho no fim de semana", dispara imediatamente um
segundo turno perguntando **quais/quantos dias** (`e57b287a`, `60b97477`, `a521856e`). O de teto por
pessoa e o de split entram na sequência. Resultado: 2 a 4 perguntas do **sistema** em fila, logo depois
das perguntas do agente — exatamente o momento em que o usuário já espera terminar.

### A6 — A mensagem de instabilidade do LLM consome um turno visível

`62b60c15` traz _"Tive uma instabilidade momentânea… pode reenviar a última mensagem?"_ como turno de
pergunta. É o fallback do orquestrador funcionando, mas para o usuário conta como uma pergunta a mais (e,
naquela conversa, dentro da pior sequência da amostra). 1 caso em 24.

## Inventário — de onde sai cada pergunta

| Origem | Onde | Perguntas na amostra |
|---|---|---|
| Fase doc — 7 campos + trigger + riscos | `orchestrator.ts:98` `buildDocPrompt` | 44 |
| Verificação de IA (2 passos) | `orchestrator.ts:166-194` | 15 + 11 |
| Fase saving — rotina, frequência, composição, plausibilidade, "depois", reconciliação (9 blocos) | `orchestrator.ts:691-1087` `buildSavingPrompt` | 96 (inclui os gates abaixo) |
| Gate jornada / base 220h | pred. `orchestrator.ts:462` · pergunta `chat.functions.ts:789` | 15 (+3) |
| Gate teto por pessoa | `chat.functions.ts:842` | 1 |
| Gate split carga×escala | pred. `orchestrator.ts:480` · bloco `orchestrator.ts:780` | 14 |
| Gate alocação de ganhos | pred. `orchestrator.ts:502` · perguntas `chat.functions.ts:893/899` | 19 |
| Juiz do preview de saving (reprova sem limite) | `buildSavingPreviewPrompt` (`orchestrator.ts:1089`) | 13 (pós-preview) |
| Fase receita | `orchestrator.ts:266` | 1 |

## O que isso muda para os 3 critérios do Rafa

1. **Recorrência** — aproveita A3: substitui os 3 turnos de trigger por **uma** pergunta que já responde
   "roda de novo sem alguém pedir? quantas vezes?". Saldo esperado: **−1 a −2 turnos**.
2. **Contrafactual** — é a **correção do A1**. "Se desligar amanhã, o que piora?" é respondível por
   qualquer família de impacto (menos custo, menos erro, menos risco, menos prazo), enquanto "o que o time
   entrega a mais" só é respondível por uma. Trocar a régua de aceitação pela taxonomia do Rafa resolve o
   pior defeito da amostra. Saldo esperado: **−13 perguntas** nos casos afetados.
3. **Rastreabilidade** — é a pergunta **nova**, e resolve um problema que o A1 expõe: hoje o gate não tem
   como se satisfazer **objetivamente**, então recusa por insistência. "Em qual relatório/sistema/base isso
   é verificável?" tem resposta verificável — o gate ganha um critério de parada honesto, e quem valida
   ganha o ponteiro que hoje não existe. Custo: **+1 turno**, compensado pelos itens 1 e 2.

## Limites desta amostra (o que NÃO está concluído)

- **Enviesada para saving** (21/24) e para submissões **muito recentes** (4 dias). Não diz nada sobre
  receita (1 caso, 1 pergunta) nem sobre custo evitado puro.
- **Não mede abandono.** A aba "Abandonados" do Investigador (rascunho inativo > 1h) é onde a frustração
  apareceria como desistência, e não foi analisada. Vale como próxima medida: se as conversas que abandonam
  têm mais perguntas que as que concluem, isso quantifica o custo real da redundância.
- **Não mede edições/reenvios**, onde os gates já causaram loop documentado (`SPEC_CORRECOES.md`).
- Os padrões são casados por **regex sobre o texto**, não por rótulo estrutural: a contagem por gate é
  boa para ordem de grandeza, não exata.
- O `E2E_COOKIE` usado **expira em 30/07/2026 22:41 UTC**. Os 24 JSONs estão salvos no scratchpad da
  sessão; se a análise precisar ser refeita depois disso, o cookie tem de ser renovado.
