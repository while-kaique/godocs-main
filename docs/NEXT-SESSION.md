# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-30, parte 7 — **planejamento, sem código**: o escopo fechado na parte 6 virou
**plano aprovado** ([taxonomia-destino-ganho-e-anti-loop](plans/taxonomia-destino-ganho-e-anti-loop.md)),
com **duas mudanças de escopo decididas pelo Luis nesta sessão** (ver "Sessão de 2026-07-30 (parte 7)"):
a **jornada preguiçosa saiu** e o **anti-loop do juiz** ganhou desenho determinístico.

> **▶ PRÓXIMO PASSO:** **`/ggsd:code` da fatia A1** — o plano está **aprovado** e o ponteiro `## Plano ativo`
> aponta pra ele, então o `plan-gate` **libera** a edição de código (foi o que barrou as partes 6 e 7). A
> worktree já existe e está **vazia**: `.claude/worktrees/fix-gates-a1a2`, branch
> `fix/gate-alocacao-taxonomia-e-materialidade`, criada de `origin/main` (`39deaf9`). ⚠️ O nome da branch
> ainda diz "materialidade" (era o escopo A2, hoje fora) — o conteúdo é **taxonomia + anti-loop**.

> **▶ Pendências da frente anterior (3 humanas + 1 técnica), ainda válidas:**
> 1. **Avisar o Rafa** — a reprovação automática está em prod e o **motivo é visível ao autor** (D10). A
>    **calibração da régua com ele** segue pendente (agora pós-deploy).
> 2. **Limpar as 15 linhas `[E2E-…]` da planilha da STAGING** — **não dá pelo script como está**: a planilha da
>    staging é **arquivo próprio** cujo `GOOGLE_SHEETS_ID` é **secret do app** (o `.env` local tem o de prod).
>    Com o ID em mão: `GOOGLE_SHEETS_ID=<id-staging> node --experimental-strip-types scripts/e2e/cleanup.mjs <runId>`
>    (**planilha ANTES do SQLite**). IDs listados abaixo.
> 3. **Causa-raiz do analisador morrendo no `waitUntil`** segue **aberta** — hoje o destrave é
>    `POST /api/admin/reanalisar-pendentes` (40–70s). Precisa de plano próprio (`/ggsd:plan`).
> 4. `CLAUDE.md` está em **~48k chars**, acima do teto de 40k — vale uma poda.

## Sessão de 2026-07-30 (parte 7) — o escopo virou plano aprovado, com 2 mudanças de escopo

**Nenhum código alterado** (sessão de planejamento; Gate D armado do começo ao fim). O plano está em
[docs/plans/taxonomia-destino-ganho-e-anti-loop.md](plans/taxonomia-destino-ganho-e-anti-loop.md),
**✅ aprovado (Luis, 2026-07-30)**.

**1. O defeito foi confirmado no código, e o culpado NÃO é quem se pensava.** A recusa de "menos custo" está
em **3 textos de prompt** que definem resposta completa como _"atividades NOMEADAS **E** o que o time entrega
**A MAIS**"_: `blocoEconomiaAlta` (`buildSavingPrompt`), `blocoEconomiaAltaPv` (`buildSavingPreviewPrompt`) e
os 3 textos do gate em `chat.functions.ts` (`perguntaAlocacaoGanhos` / `…Firme` / `nudgeAlocacaoGanhos`).
Quando o ganho é **menos custo**, a entrega **não aumenta** — e a resposta certa lê como incompleta. O
`blocoEconomiaAlta` cita "redução de equipe-vaga não reposta" **de passagem**, num parêntese de exemplos, mas
o **gate** da frase segue exigindo o par — e é o gate que decide. ⚠️ Confirmado que **`respostaAlocacaoVaga`
(`orchestrator.ts:520`) NÃO reprova** "redução de 3 auxiliares" (tem número → aceita): o defeito é **100% de
prompt**, e o predicado **não se mexe** (mexer afrouxaria a rede que pegou o boilerplate do Gostream).

**2. Mudança de escopo — a jornada preguiçosa FICOU DE FORA (decisão do Luis).** O diagnóstico foi
apresentado (o gate da jornada só define o `cap` do gate do teto, então com o maior cargo em 12h/mês a
resposta é **inerte** — disparou em 15 de 24 conversas sem mudar nada) junto de um desenho **melhor que o
limiar de 176h**: perguntar a jornada **sob demanda**, exatamente quando alguma linha passa de **220h** (o
*menor* cap possível — logo, o único momento em que a resposta muda o resultado), sem número arbitrário e sem
o risco que motivava a margem de 80%. **O Luis optou por deixar o gate como está.** O limiar de 176h,
portanto, **não é mais pendência** — a decisão foi tomada. Reavaliar só **depois de re-medir** o baseline
pós-#216.

**3. Anti-loop do juiz do preview — desenho fechado (determinístico).** O juiz não tem limite de recusas e
reinterroga mesmo depois do gate determinístico já ter coletado o destino (origem das 13 perguntas
pós-preview do baseline). Fix escolhido: `buildSavingPreviewPrompt` **deixa de injetar** o
`blocoEconomiaAltaPv` quando `saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`. **Sem campo novo no
estado e sem depender do LLM obedecer** a um "recuse só 1 vez" (persuasão é o tipo de garantia que já falhou
no Gostream). O juiz **segue ativo** onde o gate não se aplica (contrafactual `'nao'`, custo evitado puro
`'externo'`), que é onde ele é a única rede.

**4. Fronteiras duras registradas no plano:** jornada/base 220h · split carga×escala · `respostaAlocacaoVaga`
· `aplicaGateAlocacaoGanhos` · `LIMITE_ECONOMIA_ALTA` — **nada disso se mexe**. Fusão jornada+teto e
re-medição do baseline seguem fora. **Confiança do blast-radius: média** — este repo **não tem**
`docs/INDEX.md`, `docs/invariants.md` nem `scripts/ctx-route.sh`, então o mapeamento saiu de leitura direta
do código; a sessão de código deve varrer os consumidores antes de editar.

**5. Não esquecer na sessão de código:** regra 3 (`prompt-registry.ts` **afirma hoje** a exigência antiga do
"A MAIS" — sem atualizar, o registry passa a mentir), regra 1 (`worker.js` rebuildado e commitado), regra 12
(`SPEC_CORRECOES.md`) e regra 13 (**staging `edf400b4` antes de prod**, com o cenário-âncora da redução de
headcount tendo de passar **de primeira**). O cabeçalho `### O que mudou após a automação` **permanece
exato** — `extrairAlocacaoGanhos` fatia por ele para a coluna "Alocação Ganhos" (AK).

## Sessão de 2026-07-30 (parte 6) — o que o agente pergunta hoje, e o que ainda falta podar

**Nenhum código alterado** (o `plan-gate` recusou — ver Próximo passo). Sessão de leitura sobre
`origin/main` `39deaf9`, não sobre o doc de 28/07 — a diferença importa, porque o `#216` mexeu nas perguntas.

**1. Inventário do que a pessoa é perguntada HOJE** (levantado do código, não do baseline velho):
- **Form** — Etapa 1: equipe + papel por participante (Coautor único). Etapa 2: nome · data · contexto de
  negócio · AI Proxy · **"se desligar isso hoje, quem reclama?"** (pessoa/time da Team Guide) · **"e o que
  piora?"** · arquivos. Etapa 2 financeira: "alguém já fazia?" → horas antes/depois · recorrência · custo
  evitado · custo do projeto.
- **Chat/doc** — só os campos que o extrator não tirou do código, + "usa IA como funcionalidade?" e, se sim,
  "em que parte a IA entra?" (2 turnos, sempre).
- **Chat/memorial** — as duas seções novas do critério: **`[1.3]` Processo alterado** e **`[1.4]` Ponteiro
  movido e onde verificar**, nos 3 modos, com gate determinístico anti-loop (`perguntaCriterioSecoes`).
- **Gates de sistema** — jornada/220h → teto por pessoa → split carga×escala → alocação de ganhos.

**2. Prestação de contas da frente [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md):**
**T1** ✅ (baseline) · **T2** ✅ (virou o plano do critério e foi executado inteiro, PR #216) ·
**T3 e T4 ABERTOS**. Confirmado **no código do `main`**, não presumido: `orchestrator.ts` segue exigindo
_"o QUE passaram a entregar A MAIS"_ e o juiz do preview segue mandando recusar **sem contador anti-loop**;
`aplicaConfirmacaoBaseHoras` e `aplicaSplitCargaEscala` seguem disparando com qualquer `horas_antes > 0`.

**3. Achado desta sessão — o gate da jornada não tem consequência própria** (`chat.functions.ts:1435-1490`):
a única coisa que a resposta faz é definir o `cap` do gate do teto (`tetoPorJornada`: 220h dias úteis / até
~300h com trabalho humano no fim de semana). Com o maior cargo em 12h/mês, a resposta é **inerte** — o teto
nunca é atingido nos dois cenários. É por isso que ele disparou em 15 de 24 conversas sem mudar nada.

**4. Escopo fechado da próxima fatia (decisões do Luis nesta sessão):**
- **A1 — taxonomia de destino do ganho + anti-loop.** Constante única `TAXONOMIA_DESTINO_GANHO` consumida
  pelos **3** lugares (bloco 2.4 do `buildSavingPrompt`, juiz do `buildSavingPreviewPrompt`, perguntas do
  gate em `chat.functions.ts`): aceitar **mais entrega · menos custo · menos erro/retrabalho ·
  menos risco/fraude · menos prazo** — _"a mesma entrega com um time menor"_ passa a ser resposta **válida e
  completa**. O juiz do preview ganha limite de **1 recusa** (hoje não tem — daí as 13 perguntas
  pós-preview). ⚠️ `respostaAlocacaoVaga` **já aceita** "redução de 3 auxiliares" (não bate no regex vago):
  o defeito é 100% de **prompt**, não do predicado — não "consertar" o predicado por engano.
- **Jornada preguiçosa** — só perguntar quando alguma linha tem `horas_antes` **≥ 176h/mês** (80% do teto;
  a margem cobre o usuário corrigir as horas para cima no meio da conversa). **⏳ falta o Luis confirmar o
  número.**
- **Split carga×escala fica COMO ESTÁ** — decisão explícita do Luis nesta sessão. Não mexer.
- **Fundir jornada + teto numa pergunta só ficou FORA** desta fatia (é o T3 estrutural; foi assim que nasceu
  o loop do split). Reavaliar **depois de re-medir**.
- ⚠️ **Re-medir antes de podar mais:** o baseline de **6,4 perguntas/submissão** é de **28/07, ANTES** do
  #216 — que somou `[1.3]`/`[1.4]` **e** passou a injetar o contrafactual e a doc aprovada em todos os
  prompts (`buildRespostasFormulario`). O saldo é desconhecido; rodar o mesmo script sobre as submissões
  pós-#216 custa pouco.

## ✅ Critério de projeto — EM PRODUÇÃO (PR #216 mergeado, `main` `39deaf9`)
A calibração da régua (**só prompt**, `analyzer.ts`) foi provada ao vivo na staging: o cenário
`criterio-claro-nao` (a **nuvem de palavras**, o caso do Rafa que motivou a frente) fechou em **Status
"Reprovado"**, `Classificação` = _"Claro não — a recorrência falha… o contrafactual também falha… **a
rastreabilidade do artefato existe, mas não compensa a falta do par**"_ e **`Motivo Reprovado`** legível, com
caminho de volta pro autor. Os dois furos diagnosticados na parte 3 fecharam: o **entregável** deixou de valer
como rastreabilidade e a **falha simultânea** (recorrência **e** contrafactual) virou exceção declarada ao
"na dúvida → zona_cinzenta". `normalizarClassificacao` **intacta** (segue só rebaixando — D9).

**Guarda de falso-positivo passou** (run `20260730-1300`, staging): `saving-puro` → **Claro sim** ·
`custo-evitado-puro` → **Claro sim** · `complexidade-autonomia` → **Claro sim** · `receita-pura` →
**Zona cinzenta**. **Nenhum** cenário legítimo virou `claro_nao`. 783 testes, `build` + `build:worker` OK,
prod conferido (entry servido = build novo, favicon 200, `/api/auth/me` OK).

## ⚠️ ARMADILHA que custou 3 projetos de teste EM PRODUÇÃO — ler antes de rodar E2E
`scripts/e2e/lib/env.mjs` resolve o `.env` em `../../../.env` e, **quando não acha, cai em PROD**
(`https://godocs.devgogroup.com`). **Worktree não tem `.env`** → dois runs foram pra produção e submeteram 3
projetos `[E2E-20260730-1256]` na planilha real (removidos com `cleanup.mjs`, planilha antes do SQLite; prod
voltou a **0** linhas E2E e 563 no total). **Sempre** exportar explicitamente:

```bash
export E2E_BASE_URL=https://godocs-staging.devgogroup.com
export E2E_COOKIE=$(grep '^E2E_COOKIE=' /home/notebook/godocs-main/.env | sed 's/^E2E_COOKIE=//')
```

…e **conferir a linha `🚀 E2E run … contra <URL>`** antes de deixar rodar. Corolário: **nunca** pipar o run
pra `tail` — a saída fica presa e o run **parece morto enquanto está submetendo**.

## 🐞 Achado pré-existente (NÃO investigar como bug novo)
`saving-multicargo` estoura os **40 turnos** em loop de repergunta da **Seção 2.4** quando o respondedor do
E2E não tem o dado ("o briefing não detalha"). **Falha idêntica no código de prod**, sem a frente — não é
regressão. O gate determinístico da 2.4 tem anti-loop; quem repergunta sem limite é a rede LLM-juiz do
`buildSavingPreviewPrompt`.

## 🧹 Linhas `[E2E-…]` a remover da planilha da STAGING (15)
`d8ba3c3e8744ae84b969700ac757171b` · `ec2563e8f6ea9c5d25997765e32d97a8` · `dc17203497483353a6d232f46da60a79` ·
`0db1fc6f734db2a17ae455b539fce365` · `1f2355c3dd0e30843b73125ff3238fa3` · `35155594eafce787b872b598b7d96945` ·
`e67a44f3b4fb1dc1b1464c7408f80cfa` · `565aebd32a41f5a50064bef308de6817` · `a35cd24e885d088b43068347400e2dc7` ·
`993b3741bad60bd43da5f1518ec2b6f3` · `ef85becf58e866e62e88a672f6c6a176` · `8eef40970185448a2509572ed734c812` ·
`fccdeceedad244127c29df30a80d75b1` · `c8de6939bcfdf5ba35847bad4f8b2447` · `f688432cf4628579cff8b3686c52e9f8`

⚠️ A aba `STAGING` recebeu **cópia de dados reais de prod** (decisão do Luis, 30/07) — contra a regra de
"dados simulados". Vale considerar repovoar com dado sintético.

## ⚠️ Risco médio ACEITO que viaja com a frente
`false` = "não achei o ID" **≠** "a linha nunca existiu": ID mexido à mão na planilha (ou append in-flight)
pode gerar **2ª linha** em vez de no-op no fallback de recuperação da IDA. Auto-limitante (o append grava o
`ID Projeto`). Detalhe em `spec-docs/SPEC_CORRECOES.md`.

## ✅ O fix da cota se sustentou sob submissão real (`stg-crit-05`)
Re-rodado o cenário `criterio-claro-nao` no worktree `staging-criterios-coautor` → projeto
`35155594eafce787b872b598b7d96945` (R$ 27,88, 2h, pontual). **A linha CHEGOU na planilha** — era exatamente
o que falhava antes (`429` no append + purga após a carência de 1h). `POST /api/admin/reanalisar-pendentes`
devolveu `{"submetidos":570,"faltando":1,"reanalisados":1}` em **38s / HTTP 200** (antes: ~109 projetos por
rodada e HTTP 500). `Complexidade` = `automacao`, coluna **`Classificação` gravada** com justificativa, e as
2 seções novas do memorial (`Processo alterado` · `Ponteiro movido e onde verificar`) presentes.

## 🐞 A RÉGUA NÃO REPROVA O CASO QUE A MOTIVOU — plano aprovado, código pendente
O veredito do cenário foi **zona cinzenta**, não `claro_nao`: Status "Pendente" e `Motivo Reprovado` vazio —
**correto para zona cinzenta**, mas significa que o caminho da reprovação segue sem exercício real e, em
prod, tende a **nunca disparar**. E o cenário é a **nuvem de palavras**, o caso do Rafa que motivou a frente
inteira e que está escrito como few-shot de `claro_nao` no próprio prompt (`analyzer.ts:265`).

A justificativa gravada entrega as 2 causas: _"a recorrência não está bem sustentada… o autor afirma que
nada piora e que ninguém pediu de novo; **por outro lado, há um indicador de uso e um resultado verificável
no material do evento**, então não é caso de claro_nao"_. Ou seja: **(1)** o analisador aceitou o
**entregável** (o slide) como **rastreabilidade** — prova que a peça foi feita, não que um ponteiro mudou; e
**(2)** o "use com PARCIMÔNIA / na dúvida SEMPRE zona_cinzenta" absorveu um caso em que **recorrência E
contrafactual falharam juntos**, que a própria regra já mandava reprovar. Parte disso é artefato do
respondedor do E2E (ele inventou uma evidência plausível), mas **não tudo** — a régua cedeu mesmo com o
contrafactual negado. A `SPEC_CRITERIOS_PROJETO.md` já listava _"régua a calibrar com o Rafa antes de
produção"_ como pendência: é esta.

⚠️ **A parte determinística está OK** e não é o problema: `claro_nao → rejeitado + "Reprovado"` tem teste
(AC1 em `tests/criterios-classificacao.test.ts`) e a escrita das colunas foi provada ao vivo. O que falta é
o LLM **chegar** a `claro_nao`. **Decisão do Luis nesta sessão: calibrar ANTES de prod** (revê o "subir tudo,
calibrar depois" de mais cedo, agora que se sabe que a reprovação pode nunca disparar) — e **levar o fix do
`resyncGoogle` junto**. Plano aprovado: ver "Plano ativo".

_(Contexto da sessão anterior:)_ **2026-07-30, parte 2** (validação em staging — **achou e corrigiu um bug crítico**). O deploy de prod estava aprovado pelo Luis ("subir tudo, calibrar a régua do Rafa depois",
escopo do form mantido como validado), mas foi **parado por um achado** que ele não conhecia.

## 🐞 LOOP DE RECONCILIAÇÃO QUE ESTOURAVA A COTA DO SHEETS — corrigido, commit `cb8d677`
**Regressão da própria branch do critério** (⚠️ `origin/main` está LIMPO — `classifNaPlanilha` não existe
lá; prod nunca teve o bug). Em `reconciliarComplexidade` (`chat.functions.ts`) a coluna nova
`Classificação` fez o critério de "já está pronto" virar `Complexidade preenchida E Classificação
preenchida` — **impossível de satisfazer** para projeto ANTIGO: tem Complexidade na planilha,
`Classificação` vazia (coluna nova) e **nada** de classificação no SQLite, então o cron escrevia só a
Complexidade (que já estava lá), a Classificação seguia vazia e ele voltava no minuto seguinte. **Para
sempre.** Medido nos logs da staging: **109 projetos distintos, 693 tentativas em 7 rodadas (~99 leituras
de cabeçalho por minuto)** contra a cota de **60 leituras/min** do Sheets.

**Danos reais observados** (e que iriam a prod): **707 erros 429**; o **append da submissão do run 3
morreu** (`[google/sync] Falha ao inserir na planilha: 429`) → o projeto **nunca chegou à planilha**; e,
passada a **carência de 1h**, `reconciliarExclusoes` **apagaria o projeto do SQLite** — perda silenciosa.
⚠️ A cota é do **mesmo projeto GCP da produção** (`398963590019`), então a staging estava **degradando o
Sheets de prod**; o cron da staging foi pausado durante o diagnóstico e **religado** após o fix.

**Fix:** a decisão virou a função **pura** `decidirReconciliacaoPlanilha` — só age quando há algo
**realmente gravável** (coluna vazia na planilha **E** dado no SQLite) ou quando cabe re-análise (SQLite
vazio nas duas pontas); nada a fazer → não conta como pendente e **não gera leitura**. **8 testes de
convergência** (`tests/reconciliacao-convergencia.test.ts`), incluindo estabilidade da 2ª passada.
**769 testes verdes**, `build` + `build:worker` OK, `worker.js` recomitado, **staging redeployada 15:03**.
✅ **PROVA no ar:** `POST /api/admin/reanalisar-pendentes` → `{"submetidos":569,"faltando":0,
"ressincronizados":0,"reanalisados":0}` em **15,8s** e **HTTP 200** (antes: ~109/rodada e HTTP 500).

## 🐞 2º gap ACHADO e NÃO corrigido (decisão do Luis: fora deste fix)
**`resyncGoogle` não recupera linha ausente:** ele usa `modo: "edicao"` → `updateRowByProjectId`; se a
linha não existe na planilha, **não acha nada, não faz nada e ainda devolve `ok:true`**. Ou seja: quando o
append da IDA falha (cota/transiente), **não existe caminho de recuperação** e o projeto é purgado após 1h.
Fix sugerido: cair para **append** quando a linha não existe, em vez de no-op silencioso.

## ✅ Validado nesta sessão (lado do AGENTE, item 1 do pedido)
O `stg-crit-02` (que ficou em voo na sessão anterior) **fechou com sucesso** nos 2 cenários — e o
`receita-pura` **não** estourou os 40 turnos, o risco que o handoff anterior apontava. Rodou **no worktree**,
logo **com** as 2 correções do harness. A ficha do `/dashboard` confirma no memorial gravado as duas seções
novas (`Processo alterado` + `Ponteiro movido e onde verificar`) e o **comportamento 3** intacto: _"Não foi
informado no briefing um relatório, painel, sistema ou base específica para conferência desse número;
portanto, a ausência de fonte nomeada fica registrada explicitamente, **sem inventar referência**"_.

## ⚠️ Ainda NÃO validado: `claro_nao → "Reprovado"` (item 2 do pedido)
O cenário novo `criterio-claro-nao` **rodou e submeteu** (`f97856f5…`, ganho R$27,88/mês, 40 turnos não
estourados) — mas a linha **não chegou na planilha** por causa do bug acima, então o caminho da reprovação
**não pôde ser conferido**. Com o fix no ar, **basta re-rodar o cenário**. O analisador em si **funciona**:
os 2 projetos do `stg-crit-02` têm `complexidade` gravada no SQLite (`autonomia`/`automacao`) — o que
falhava era só a escrita na planilha.

## 🧭 Descobertas de método que economizam tempo na próxima sessão
- ⚠️ **A staging tem `GOOGLE_SHEETS_ID` PRÓPRIO** (secret separado) — **não** é a "planilha de prod
  compartilhada" que o `CLAUDE.md` descreve. Ler a planilha da staging com o `.env` local (ID de prod) dá
  **0 linhas** e parece bug do produto. **Caminho certo:** `GET /api/admin/dashboard/projetos` (listagem) e
  **`GET /api/admin/dashboard/projetos/:id`** (a **linha INTEIRA**, é onde `Classificação`/`Motivo
  Reprovado` aparecem). O `read-criterio.mjs` do scratchpad **mede a planilha errada** — corrigir ou largar.
- O cron `reanalisar-pendentes` **dispara sim na staging** (o handoff anterior dizia que não) — ele
  devolvia **500 por cota**, não silêncio.
- `/api/admin/investigador/projetos` **não** expõe `classificacao_avaliacao`; `/api/meus-projetos` expõe
  `motivo_reprovado`/`motivo_reenvio` em **snake_case**.

_(Antes desta:)_ **2026-07-30 (validação em staging — critério de projeto)** — pedido do Luis: **validar por
E2E na staging que o agente pergunta o que o planejamento definiu, antes de levar TUDO a produção**.

**✅ O GATE T8 FUNCIONOU — os 2 cenários que falhavam na rodada de 29/07 passaram** (run `stg-crit-01`,
staging `edf400b4`, `inspect-perguntas.mjs`):

| Cenário | 29/07 (só prompt) | 30/07 (com o gate T8) |
|---|---|---|
| `custo-evitado-puro` | ❌ `[1.4]` gravada **pela metade** (só `**Ponteiro movido:** custo externo`, sem o "onde verificar") nas 2 rodadas | ✅ `[1.3]` **e** `[1.4]` completas — ponteiro (custo externo do contrato) **+** onde conferir (histórico de cancelamento/faturamento + Portal) |
| `receita-pura` | ❌ `[1.3]` **ausente**; `[1.4]` ausente numa das rodadas | ✅ `[1.3]` **e** `[1.4]` presentes |

Mais: **0 repetição** de pergunta de ponteiro/fonte · **2,5 perguntas/submissão** (baseline de prod **6,4**)
— as seções novas **não engordaram o funil**. E o comportamento 3 (o mais importante) se manteve: no
`receita-pura` o agente **registrou a ausência da fonte em vez de inventar uma** — _"O briefing não informou
relatório, painel, sistema ou base específica para conferência desse número"_ → vira **zona cinzenta**, nunca
reprovação automática. ⚠️ **A decisão do PREFIXO se provou load-bearing**: o agente gravou o título como
`### Ponteiro movido e conferência` (não o título exato) — com casamento por título exato o gate teria lido
`null` e reperguntado à toa. **Não "corrigir" o prefixo.**

**Também verificado nesta sessão:** (a) a staging roda **exatamente** `staging/criterios-coautor` — o entry
`index-CLeuBaiL.js` do `/index.html` ao vivo bate com o `dist/` local (é assim que se confere qual branch
está no ar, ver a armadilha do deploy que apagou a Etapa 2); (b) **761 testes verdes** na branch de
integração, que já contém **todo** o `origin/main` (`ad64895`) — é superset limpo para prod; (c) as 3 colunas
do critério (`Classificação` · `Motivo Reprovado` · `Motivo Reenvio`) **existem no cabeçalho das DUAS abas**,
`STAGING` **e** `GoDocs` — o pré-requisito de prod está cumprido (mapeamento é por nome; nome errado é
ignorado com aviso silencioso).

**2 buracos do harness E2E corrigidos** (commitados na branch de integração) — os dois faziam o teste medir a
coisa errada: **(1)** o `metaPadrao` **nunca enviava** `contrafactual_afetados`/`contrafactual_reclamacao`, as
perguntas-chave da Etapa 2 — sem elas o agente roda **cego ao contrafactual**, exatamente o cenário que o
roteiro manda não medir (é `buildRespostasFormulario` que as entrega aos 4 prompts); **(2)** **nenhum cenário
cobria `claro_nao`** — o único caminho que grava **"Reprovado"** na planilha e o que mais precisa de
validação, porque o autor vê. Criado o cenário **`criterio-claro-nao`** (nuvem de palavras: rodou 1×, sem
recorrência, ninguém reclama, materialidade minúscula de propósito — acima de R$5k/mês o invariante de
`normalizarClassificacao` rebaixa para zona cinzenta e o teste não provaria nada).

⚠️ **O lado do ANALISADOR (item 2 do pedido) segue SEM validação** — pelo mesmo motivo de 29/07, não por bug
do código novo: a análise morre no `waitUntil` (timeout de 25s do proxy → fallback OpenAI → *tasks
cancelled*) e o cron de 1 min **não dispara na staging**. A rota de destrave existe
(`POST /api/admin/reanalisar-pendentes`, `requireAdmin`, idempotente) e **foi chamada**, mas devolveu **500 por
cota do Google Sheets** (`ReadRequestsPerMinutePerUser`, 60/min — estourada pelas minhas próprias leituras da
planilha + o run). **É transitório: esperar ~1 min e repetir.** A causa-raiz do `waitUntil` continua aberta
(decisão do Luis entre aterrissar a análise no request do submit ou disparar do front em lotes).

⚠️ **Divergência de escopo registrada:** o pedido do Luis listou **3** perguntas para o **formulário**
("que processo mudou e quanto" · "moveu ponteiro de custo/receita/KPI" · "se desligar hoje quem reclama").
Pela decisão de **29/07** só o **contrafactual** ficou na Etapa 2 ("quem reclama" + "o que piora"); as outras
duas são conduzidas pelo **agente** no chat e é isso que o gate T8 cobre — foi assim que validei. Se o Luis
quiser as três **no form**, é mudança nova e precisa ser dita **antes** do deploy de prod.

_(Antes desta:)_ **2026-07-30 (código, avulsa — fora do plano ativo)** — pedido direto do Luis:
**Coautor único por projeto**. Cada projeto tem **1 autor** (o submissor/dono, que não escolhe papel) e
**no máximo 1 Coautor** (`coexecutor`); Participante e Contribuidor seguem **sem limite**. Implementação
**100% cliente** (nada de schema, sync ou colunas do Sheets — `derivarColunasPapeis` continua aceitando
lista por causa dos legados): helpers puros `PAPEL_COAUTOR`/`coautoresSelecionados()`/`limitarCoautorUnico()`
em `src/lib/submeter/constants.ts`; `validarEtapa1` bloqueia 2+ Coautores nos dois modos (submissão nova e
edição); no seletor (`ParticipantesPapeisInput`) a opção **Coautor SAI da lista** dos demais quando alguém já
a tem (`papeisDisponiveis` — a 1ª versão mostrava a opção *desabilitada* com "(já definido)" e o **Luis pediu
para removê-la da view**); nota informativa abaixo do campo explica a ausência; o **seed da edição**
(`applySeed`, `submeter.tsx`) aplica `limitarCoautorUnico` — legado importado do Sheets pode trazer vários
e-mails na coluna "Participantes", então mantém o 1º e **limpa o papel dos demais** para o usuário
reclassificar (em vez de travar a edição num estado que ele não criou). Branch **`feat/coautor-unico`**
(`da91207` + `0ff9f6b`, sobre `main` `ad64895`), 8 testes novos em `tests/validacao-etapa1.test.ts`,
**667 verdes**; `CLAUDE.md` + `spec-docs/SPEC_FEATURES_NOVAS.md` atualizados. **✅ VALIDADO pelo Luis no
staging.** ⚠️ **Armadilha real desta sessão, que não pode repetir:** o **staging estava rodando a branch
NÃO-mergeada `feat/criterios-projeto-classificacao`** (as perguntas-chave da Etapa 2), e o primeiro deploy —
buildado de `origin/main` — **apagou aquelas perguntas da tela** (o `updateApp` substitui a app INTEIRA).
Corrigido com a branch de integração **`staging/criterios-coautor`** (= `feat/criterios-projeto-classificacao`
+ merge do coautor; conflito só em duas linhas de `import`), **761 testes verdes**, `build` + `build:worker`
OK, **staging redeployado** com as duas frentes. **Prod (`674a3710`) NÃO foi tocado em nenhum momento.**
**Regra que vale daqui pra frente: antes de deployar no staging, descobrir QUAL branch está no ar e mergear a
sua sobre ela.**

_(Antes desta:)_ **Última sessão:** 2026-07-29 (planejamento) — nova frente, pedida pelo Luis: **apertar o critério de
projeto** (o pedido do Rafa, caso da **nuvem de palavras**). Plano ✅ **aprovado** em
[`docs/plans/criterios-projeto-classificacao.md`](plans/criterios-projeto-classificacao.md). Escopo: (a) **2
perguntas determinísticas na Etapa 2** — "moveu sensivelmente o ponteiro de custo/receita/KPI?" + "onde isso
pode ser verificado?" (rastreabilidade, que hoje **não existe** em lugar nenhum) e "se desligar hoje, quem
reclama e o que piora?" (contrafactual); (b) **"que processo mudou e quanto?"** vira seção obrigatória do
`MEMORIAL_ESQUELETO`, perguntada pelo **agente** só quando a doc não traz a magnitude; (c) o **analisador
classifica** em **claro sim / claro não / zona cinzenta**, **sempre** explicando o porquê, com
`normalizarClassificacao()` puro (nunca reprova sem motivo; especial nunca reprova automático; >R$5k → zona
cinzenta); (d) `claro não` grava **`Reprovado`** na coluna Status — **única exceção** à regra TEMPORÁRIA do
"Pendente", que continua valendo para todo o resto; (e) 3 colunas **já criadas pelo Luis** na planilha
(`Classificação` sempre preenchida · `Motivo Reprovado` · `Motivo Reenvio`, esta **só humana**); (f) modal de
triagem do `/dashboard` grava os motivos em coluna própria, **sem tocar em `Observações`** (que o disparo de
e-mails usa). **Barrar submissão continua FORA em definitivo** — a reprovação é pós-envio, no analisador.
Achado que economiza trabalho: **`Reprovado` já existe** em `STATUS_GRAVAVEIS` e no `StatusBadge` (PR #214), e
**`usa_ai_proxy` é o padrão exato a clonar** para as perguntas novas da Etapa 2. **Nenhum código alterado.**

_(Antes desta:)_ **2026-07-28 (código)** — **`/dashboard` do admin virou a tela de triagem sobre a PLANILHA**,
branch `feat/dashboard-admin-sheets`, commit `5ef927a`. A tela lia o **SQLite** (`getProjetos` →
`getProjetosWithArea`) e por isso mostrava **rascunho** e um **status que não é fonte de verdade** (o sync
reverso exclui `status` de propósito). Agora lê `readAllRows()`. Entregue: busca instantânea
(projeto/autor/e-mail/ID/área, sem acento, tokens em AND, atalho `/`), **filas de status com contagem ao
vivo**, ordenação, paginação 25/50/100, **ficha em overlay** com a linha inteira agrupada (coluna
desconhecida cai em "Outras colunas") e **mudança de status gravando no Sheets** + auditoria
`admin_status_log`. **620 testes verdes** (29 novos), `build` + `build:worker` OK, `worker.js` recomitado,
spec `spec-docs/SPEC_DASHBOARD_ADMIN.md` (D1–D8) + `CLAUDE.md`/`docs/` atualizados. Também **removido o
aviso do BUG ABERTO de edição de legado** do `CLAUDE.md` — o Luis confirmou que já foi resolvido.

_(Antes desta: 2026-07-22/23 — `aceitar-zip-submissao` executada, mergeada (PR #213) e em prod.)_

**Última sessão (2026-07-28, planejamento):** nova frente — **as perguntas do agente**. O pedido original
era um "agente porteiro" que barrasse submissões fora de critério (caso da **nuvem de palavras**); foi
**descartado** na conversa do Luis com o Rafa: os critérios ainda não estão fechados, e barrar sem critério
troca um problema por um pior. O alvo virou **cortar a redundância das perguntas** e embutir os 3 critérios
do Rafa (recorrência · contrafactual · rastreabilidade) nas perguntas que já existem. O **T1 foi executado
nesta sessão** (o Luis liberou o `E2E_COOKIE`): **24 conversas reais de prod** medidas em
[`analise-perguntas-agente.md`](analise-perguntas-agente.md) — **154 perguntas / 6,4 por submissão**, 62% na
fase saving, **34% vindas dos 4 gates**, 13 perguntas **depois** do preview. Dois achados que a leitura de
código não pegava: **A1** — o gate da alocação **só aceita "mais saída" e rejeita "menos custo"** (caso
`e57b287a`: usuário informou **redução de 3 auxiliares** → 5 reperguntas; `60b97477`: **corte de hora
extra** → 4), com o juiz do preview mandando recusar _"mesmo que o usuário diga aprovado"_ **sem contador
anti-loop**; **A2** — os gates **ignoram materialidade** (`897df986` economiza **0,05h/mês** e recebe o gate
das 220h/fim de semana), contra a regra que o próprio prompt já tem. **Nenhum código alterado.**

**Última sessão (2026-07-28, operação + planejamento):** fechou o **T8 do dashboard** e abriu a frente dos
**loadings**. (a) `feat/dashboard-admin-sheets` deployada no **staging `edf400b4`**, validada no navegador pelo
Luis e depois em **prod `674a3710`** — mesmos artefatos/hashes nos dois; branch no remoto (`990250e`); **o PR
não foi aberto** porque o `gh pr create` é bloqueado pelo classificador de permissões local (corpo pronto,
conta `gh` em `LuisEduardo100`). (b) **Admin concedido via secret `ADMIN_EMAILS`** (rotaciona sem redeploy):
`bruno.bezerra@gocase.com` em prod **e** staging, `luiza.rios@gocase.com` em prod; `.env` sincronizado.
⚠️ Registrado que **admin não é granular** — dá acesso a TODAS as telas do grupo `_authenticated`
(dashboard, investigador, email-legados, areas, usuarios, testes) + override de edição. (c) O relato "**só 1
descontinuado**" **não era bug**: a tela lê 100% do Sheets. Medido via Service Account — aba **GoDocs**
478 Aprovado / 40 Pendente / 15 Reenvio Pendente / **11 Descontinuado** (544 linhas com ID); aba **STAGING**
287 / 32 / 23 / **1** (343 linhas), ou seja a staging é uma **cópia antiga**. De quebra: a coluna "Status"
está em **posições diferentes** nas duas abas (índice 29 vs 30) e o mapeamento por nome absorveu.
⚠️ **Dado novo para a decisão do dropdown:** `Reprovado` e `Em validação` **não existem em nenhuma das 887
linhas** — os 4 valores reais são Aprovado · Pendente · Reenvio Pendente · Descontinuado. (d) Planejada e
**aprovada** a frente dos loadings (ver Plano ativo). **Nenhum código alterado nesta sessão.**

## Plano ativo
**→ [docs/plans/taxonomia-destino-ganho-e-anti-loop.md](plans/taxonomia-destino-ganho-e-anti-loop.md)** ·
Status: ✅ **aprovado** (Luis, 2026-07-30)

Implementa a fatia **A1** da frente
[perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md) (T3): constante
única `TAXONOMIA_DESTINO_GANHO` (5 destinos — mais entrega · **menos custo** · menos erro/retrabalho · menos
risco/fraude · menos prazo) consumida pelos **3** textos que hoje exigem o par _"nomeado **E** entregar A
MAIS"_, + **anti-loop determinístico** no juiz do preview (o bloco sai do prompt quando
`saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`).

⚠️ **A jornada preguiçosa saiu do escopo** — decisão do Luis nesta sessão: o gate da jornada **fica como
está**, mesmo com o diagnóstico de que a resposta é inerte em 15 de 24 conversas (ela só define o `cap` do
gate do teto). Reavaliar **depois** de re-medir o baseline pós-#216. Os itens estruturais (registro de "já
respondido", orçamento de perguntas, fusão dos 4 gates, T4) seguem para depois da re-medição.

Os dois planos da frente do critério estão **concluídos e em produção**
(`calibragem-regua-criterio-e-resync-append` + `criterios-projeto-classificacao`, PR #216 mergeado,
`main` `39deaf9`). O que sobrou dela é **humano**: avisar o Rafa e **calibrar a régua com ele** usando casos
reais — reprovar projeto é visível ao autor (D10).

Frentes candidatas à próxima sessão, nenhuma planejada ainda (entram por `/ggsd:plan`):
- **causa-raiz do analisador morrendo no `waitUntil`** — hoje mitigado pelo cron de 1 min em prod
  (`reanalisar-pendentes`, conferido ativo e 200), que em troca **pressiona a cota do Sheets** (60 leituras/min
  compartilhadas com a staging). Caminho quente de submissão: não mexer sem plano;
- **poda do `CLAUDE.md`** (~48k chars, teto 40k);
- **repovoar a aba `STAGING` com dado sintético** (ela recebeu cópia de dados reais de prod).

**Plano anterior (a frente que este destrava)**
**→ [docs/plans/criterios-projeto-classificacao.md](plans/criterios-projeto-classificacao.md)** ·
Status: ✅ aprovado (Luis, 2026-07-29) e **CODADO** na branch `feat/criterios-projeto-classificacao`
(T1–T8, até `9ce9b09`/`28cdb01`) — **no staging, ainda NÃO validado pelo Luis nem em prod**; era essa branch
que estava no ar quando o deploy de 30/07 a sobrescreveu (ver "Última sessão").
Critério de projeto: perguntas-chave na Etapa 2 + classificação em 3 níveis no analisador + reprovação com
motivo nas colunas novas. **Barrar submissão segue FORA em definitivo** (a reprovação é pós-envio).

**⚠️ Frente PARALELA, não sobrescrita — [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** ·
Status: ✅ **aprovado (Luis, 2026-07-28)**, T1 executado, **ainda pendente de código**: **A1** (o gate da
alocação precisa aceitar "menos custo", não só "mais saída" — + anti-loop no juiz do preview) · **A2**
(materialidade nos gates) · **T4** (fluxo de coleta). Coexiste com o plano ativo (ADR-026) e é **adjacente**:
a taxonomia de impacto escrita no T3 do plano ativo deve ser reaproveitável pelo A1. O **T2** (régua do Rafa)
foi **absorvido** pelo T7 do plano ativo — não fazer duas vezes.

_[loadings-dashboard-admin](plans/loadings-dashboard-admin.md) saiu de ativo: **✅ CONCLUÍDO** — T1–T5 no commit
`3b93c65` e o **T6 fechado em 2026-07-28**: staging validada → **prod `674a3710`** → **PR #215 mergeado**
(`main` = `ad64895`). Nada pendente nessa frente._

### Sessão de código 2026-07-28 (loadings do /dashboard) — o que ficou
Codados T1–T5: **SWR** em `lerPlanilha` (cache vencido volta na hora + revalidação em `runBackground`,
single-flight preservado, `revalidando` no payload) · **auth em `sessionStorage`** (`src/lib/auth-cache.ts`,
TTL 5 min, revalidação em background) · **prefetch** da planilha em paralelo ao `/api/auth/me`
(`src/lib/dashboard-prefetch.ts`) · **skeleton** (`components/dashboard/skeleton-linhas.tsx`) com filas
visíveis e chip "Atualizando em segundo plano". **658 testes verdes** (+38), `worker.js` recomitado, spec
**D9/D10** + `CLAUDE.md` (gotchas 3 e 7).
O revisor de qualidade em contexto fresco pegou **1 ALTA já corrigida**: a correção da linha no cache era
apagada pela revalidação em voo → o status recém-decidido voltava atrás por até 60 s. Corrigido com patch
por projeto reaplicado nas leituras iniciadas antes da escrita + guarda de época/sequência; `?refresh=1`
não herda leitura em voo; `STALE_MAX_MS` (10× TTL) volta a bloquear se o Sheets falhar; prefetch com teto
de 15 s. Conformidade: `diverge-baixa` (nada fora das Fronteiras).
⚠️ **`CLAUDE.md` está em ~45k chars** (limite recomendado 40k, já estava 44,2k no `main`) — vale uma sessão
de enxugamento.

Melhorar os **loadings do `/dashboard`** (pedido do Luis em 2026-07-28, escopo escolhido por ele): SWR no
servidor · cache de auth em `sessionStorage` · leitura em paralelo com o auth · skeleton. **Cache em SQLite
ficou FORA por decisão dele** (não reintroduzir SQLite no caminho de leitura). Sai de um worktree sobre a
branch `feat/dashboard-admin-sheets` (os arquivos não existem no `main` ainda).

**⚠️ Frente PARALELA, não sobrescrita —
[perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** · Status:
✅ **aprovado (Luis, 2026-07-28)** — T1 já executado; **pronto para `/ggsd:code`**. Escopo ampliado por ele
no fim da sessão: além das perguntas, entra o **fluxo de coleta** (T4 — onde cada informação deve ser
colhida: formulário × conversa × já sabido), e **barrar submissão está FORA em definitivo** (se voltar,
exige plano próprio). Ordem de ataque: **A1** (taxonomia de impacto + anti-loop no juiz do preview) e **A2**
(materialidade nos gates) primeiro — não dependem da régua do Rafa; **T2** (régua) em paralelo, para ele levar. Não é bloqueada por este plano nem o
bloqueia — as duas coexistem (ADR-026). **A fase de código recusa executar qualquer plano em rascunho** (RF-03).

_(Antes desta:)_ **Nenhum plano `aprovado` pendente de código.** [`dashboard-admin-sheets`](plans/dashboard-admin-sheets.md)
está **✅ executado** (T1–T7). **Falta o T8, que não é código:** deploy no **STAGING `edf400b4`** → validar
no navegador → **PROD `674a3710`** → PR (regras 13 e 10). Nova frente de código → `/ggsd:plan` primeiro.

_(Executados recentes: [aceitar-zip-submissao](plans/aceitar-zip-submissao.md) ✅ mergeado+prod;
[ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ mergeado (PR #210);
[edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md) ✅ executado — resta a validação T5,
ver pré-req das colunas abaixo.)_

## Próximo passo (setado)
**→ Codar o plano aprovado com `/ggsd:code`: T1–T3 (calibrar a régua do `claro_nao`, só prompt) e
T4–T5 (`resyncGoogle` recupera linha ausente por append), na branch `staging/criterios-coautor`.**

```bash
cd .claude/worktrees/staging-criterios-coautor   # a branch que está NO AR na staging
# T1-T3: src/lib/agents/analyzer.ts (régua) · T4: src/lib/google/sheets.ts · T5: src/lib/google/sync.ts
npm run test && npm run build && npm run build:worker   # + comitar worker.js (regra 1)
```
**Depois, na ordem:** (1) **T6 — deploy no staging `edf400b4`** e re-rodar o cenário, esperando agora
**Status "Reprovado" · Classificação "Claro não…" · Motivo Reprovado preenchido**:
```bash
E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING \
  E2E_ONLY=criterio-claro-nao npm run e2e:run -- stg-crit-06
curl -H "Cookie: $E2E_COOKIE" \
  https://godocs-staging.devgogroup.com/api/admin/dashboard/projetos/<ID>   # a linha INTEIRA
```
⚠️ **NÃO use o `read-criterio.mjs`** do scratchpad — ele lê a planilha de **PROD** (a staging tem
`GOOGLE_SHEETS_ID` próprio). Analisador não gravou (waitUntil)? `POST /api/admin/reanalisar-pendentes`
(~38s, não estoura mais a cota). (2) **limpar os runs** — `npm run e2e:cleanup -- stg-crit-05` (e `01`/`02`/
`03`, e o `04` que ficou parcial de um run abortado), **planilha ANTES do SQLite**, senão o sync reverso
ressuscita. (3) **prod `674a3710`** (`getUploadToken` novo — `uploadId` é **single-use** — e o script recebe
o **TOKEN**, não a URL). (4) **PR** via `/ggsd:ship` (conta `gh` em `LuisEduardo100`).
⚠️ **Avisar o Rafa logo após o deploy:** reprovar projeto é **visível ao autor** (D10), e a régua vai ao ar
recém-calibrada, sem rodada de calibração com ele.

### _(Passos da sessão anterior — o que sobrou deles)_
**Fechar a validação do critério e levar as DUAS frentes a produção** (o Luis respondeu a pergunta que estava
aberta: quer **prod recebendo todas as mudanças**, depois de validar o critério por E2E na staging). O lado do
**agente já está validado** (tabela no topo). Falta, nesta ordem:

1. **Terminar o run `stg-crit-02`** (`receita-pura` + `custo-evitado-puro`) — ficou **em voo** no fim da
   sessão, preso num vai-e-vem longo da fase **doc** do `receita-pura` (o respondedor do E2E responde "não
   está no briefing" e o agente repergunta; pode bater no `MAX_TURNS`). Log em
   `.../scratchpad/e2e-stg-crit-02.log`. ⚠️ **Não é bloqueio da validação** — o `stg-crit-01` já cobriu os
   dois cenários com sucesso; se o `stg-crit-02` estourar turnos, isso é achado do **respondedor**, não do
   produto.
2. **Rodar o run 2 com os campos novos** (o harness já foi corrigido e commitado):
   `E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING
   E2E_ONLY=criterio-claro-nao,receita-pura npm run e2e:run -- stg-crit-03` — este é o que valida o
   **item 2 do pedido** (classificação em 3) e o caminho **`claro_nao` → "Reprovado" + Motivo Reprovado**.
3. **Destravar o analisador:** esperar ~1 min (cota do Sheets) e repetir
   `POST /api/admin/reanalisar-pendentes`; depois ler `Classificação`/`Motivo Reprovado`/`Status` na aba
   `STAGING` (script pronto em `.../scratchpad/read-criterio.mjs`).
4. **Limpar** os projetos de teste: `npm run e2e:cleanup -- stg-crit-01` (e `stg-crit-02`/`stg-crit-03`)
   — **planilha ANTES do SQLite**, senão o sync reverso ressuscita.
5. **Prod `674a3710`** com a branch de integração `staging/criterios-coautor` (já é superset do `main`):
   `npm run test && npm run build && npm run build:worker` → `scripts/deploy-godeploy.sh <TOKEN>` → `updateApp`.
   ⚠️ `getUploadToken` novo (o `uploadId` é single-use) e o script recebe o **TOKEN**, não a URL.
6. **PR** via `/ggsd:ship` (conta `gh` em `LuisEduardo100`).

⚠️ **Antes do passo 5, ver a divergência de escopo das 3 perguntas do formulário** registrada no bloco da
última sessão — se o Luis quiser as três **no form** (e não duas no agente), isso muda o que vai a prod.
⚠️ **Gate humano ainda de pé:** a régua do Rafa (T7) **deve ser calibrada com ele antes do deploy em
produção** — reprovar projeto é visível ao autor.

_(Resolvido — era o "PRIMEIRO" desta seção:)_ o staging hoje carrega **duas** frentes
(Coautor único, já validado + critério de projeto, ainda **não** validado por ele). Decidir com ele:
**(1)** subir a prod **só o Coautor único** (`feat/coautor-unico` rebaseada no `main`) e abrir o PR dela,
deixando o critério de projeto só no staging; ou **(2)** esperar a validação do critério de projeto e subir as
duas juntas. **Não subir prod antes dessa resposta.** Quando vier, o caminho do Coautor é: rebase no `main`
→ `npm run test && build && build:worker` → **deploy prod `674a3710`** → `/ggsd:ship` (PR).
⚠️ Ao deployar staging de novo, cheque antes qual branch está no ar (foi o erro desta sessão) e use uma branch
de integração; worktrees vivos: `.claude/worktrees/coautor-unico` e `.claude/worktrees/staging-criterios-coautor`
(este com `node_modules` por **symlink** para o outro).

**DEPOIS — Executar o plano [criterios-projeto-classificacao](plans/criterios-projeto-classificacao.md)** com
`/ggsd:code`, T1 → T7. Worktree novo a partir de **`origin/main` (`ad64895`)** — a branch atual
`docs/plano-loadings-dashboard-admin` é **só de docs e está ATRÁS do main** (o `/dashboard` de triagem e o
`dashboard-admin.functions.ts` **não existem** nela; só no `main`).

**Antes de escrever a primeira linha, nesta ordem:**
1. **Conferir a grafia exata** dos 3 cabeçalhos novos (`Classificação`, `Motivo Reprovado`, `Motivo Reenvio`)
   nas abas **`GoDocs`** e **`STAGING`** — o Luis já criou as colunas, mas o mapeamento é **por nome** e um
   acento diferente faz a coluna ser **ignorada com aviso**, silenciosamente. As duas abas já divergem em
   posição de coluna.
2. Ler o plano ativo inteiro + a seção **"Decisões fechadas que NÃO podem ser corrigidas por engano"**
   (`spec-docs/`, regra 12).
3. Invocar a skill **`frontend-design`** antes da UI da Etapa 2 e do modal de triagem (regra 11).

**Ordem sugerida de execução:** T4 (colunas/sync — desbloqueia a verificação) → T1 (Etapa 2) → T3 (analisador
+ `normalizarClassificacao`) → T2 (memorial/agente) → T5 (`/dashboard`) → T6 (motivo visível ao autor — **é
julgamento do Claude, confirmar com o Luis se mantém**) → T7 (régua de 1 página pro Rafa).

**2 pontos de atenção que o Luis já conhece e não devem ser "corrigidos" por engano:**
- **Não** encerrar a regra TEMPORÁRIA do `Pendente` (decisão D1: a única exceção é `claro_nao → Reprovado`).
- **Não** mexer no `CHECK` de `projetos.status` (exigiria rebuild da tabela); o discriminador da reprovação é a
  coluna nova `classificacao_avaliacao`.
- ⚠️ A régua do Rafa tinha **gate humano** no plano de 28/07 ("nenhum código encosta na régua antes do OK
  dele"). O Luis mandou codar; a régua sai no mesmo PR (T7) e **deve ser calibrada com o Rafa antes do deploy
  em produção** — reprovar projeto é visível ao autor.

✅ **T6 dos loadings encerrado em 2026-07-28:** branch já estava 0 atrás do `origin/main`; 658 testes + `build`
+ `build:worker` verdes (`worker.js` inalterado); **staging `edf400b4`** validada no navegador pelo Luis;
**prod `674a3710`** com os mesmos artefatos (`index-D76hNGpt.js` conferido no `index.html` de prod via
`E2E_COOKIE`); **PR #215 mergeado** → `main` = `ad64895`, espelhando prod.
⚠️ Gotchas do deploy que custaram tempo: `scripts/deploy-godeploy.sh` recebe o **TOKEN** como 1º argumento (URL
com `?token=` → **401**) e o `uploadId` é **single-use** (novo `getUploadToken` entre staging e prod).
Nesta sessão `gh pr create`/`gh pr merge` **funcionaram** — o bloqueio local do classificador não se repetiu.

⚠️ **PR #214 (dashboard de triagem) foi MERGEADO** no `main` (`e878bc1`) nesta sessão; o worktree
`dashboard-admin-sheets` e a branch local foram removidos.
