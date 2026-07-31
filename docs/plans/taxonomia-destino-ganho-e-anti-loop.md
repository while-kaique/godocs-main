# Plano — Taxonomia de destino do ganho (aceitar "menos custo") + anti-loop no juiz do preview

**Status:** ✅ aprovado (Luis, 2026-07-30)

**Objetivo:** parar de recusar respostas VÁLIDAS no gate da alocação de ganhos (Seção 2.4) — hoje o prompt
só reconhece "o time entrega A MAIS", então "reduzimos 3 auxiliares" leva reperguntas — e cortar a segunda
interrogação no preview, que hoje não tem limite de recusas.

## Contexto — o defeito, medido

O caso real: saving alto cuja contrapartida foi **redução de headcount** (3 auxiliares). O usuário respondeu
certo e levou **5 reperguntas**. A causa está em **3 textos de prompt** que definem "resposta completa" como
_"as atividades NOMEADAS para onde o tempo foi **E** o que o time passou a entregar **A MAIS**"_:

1. `src/lib/agents/orchestrator.ts` — `blocoEconomiaAlta` no `buildSavingPrompt` (a régua que o agente segue).
2. `src/lib/agents/orchestrator.ts` — `blocoEconomiaAltaPv` no `buildSavingPreviewPrompt` (o LLM-juiz do preview).
3. `src/lib/chat.functions.ts` — `perguntaAlocacaoGanhos` / `perguntaAlocacaoGanhosFirme` / `nudgeAlocacaoGanhos`
   (o texto que o gate determinístico manda ao usuário e ao LLM).

Quando o ganho é **menos custo** (vaga não reposta, contrato cancelado, equipe menor), a entrega **não aumenta**
— ela fica igual com menos gente. Pela régua atual isso lê como resposta incompleta, e os 3 textos empurram a
repergunta. O `blocoEconomiaAlta` até cita "redução de equipe-vaga não reposta" **de passagem**, dentro de um
parêntese de exemplos, mas o **gate** da frase ("(a) atividades NOMEADAS **e** (b) entregar A MAIS") continua
exigindo o par — e é o gate que decide.

⚠️ **O predicado NÃO é o culpado — não "consertar" `respostaAlocacaoVaga` por engano.** Verificado no código
(`orchestrator.ts:520`): "redução de 3 auxiliares" **não bate** no regex de vago (tem número → aceita).
O defeito é **100% de prompt**. Mexer no predicado seria consertar o que não está quebrado e afrouxar a
rede que pegou o boilerplate do caso Gostream.

**Segundo defeito, independente:** o juiz do preview (`blocoEconomiaAltaPv`) **não tem limite de recusas** —
ele reinterroga mesmo depois do gate determinístico já ter coletado e registrado o destino, e foi a origem
das 13 perguntas pós-preview do baseline.

### Decisões fechadas nesta sessão (não reabrir sem confirmar)
- **Jornada preguiçosa: FORA.** O gate da jornada **fica como está** — decisão do Luis nesta sessão, mesmo
  com o diagnóstico de que ele dispara sem consequência em 15 de 24 conversas (a resposta só define o `cap`
  do gate do teto; com o maior cargo em 12h/mês, é inerte). Reavaliar depois de re-medir o baseline pós-#216.
- **Split carga×escala: FORA** (decisão anterior do Luis, mantida).
- **Fundir jornada + teto numa pergunta só: FORA** (é o T3 estrutural do plano-pai; foi assim que nasceu o
  loop do split).
- **`respostaAlocacaoVaga` NÃO se mexe** (ver ⚠️ acima).
- **Anti-loop do juiz = supressão determinística**, não contador nem persuasão: o bloco do juiz sai do prompt
  quando o gate já coletou. Sem campo novo no estado, sem depender do LLM obedecer a um "recuse só 1 vez".

## Tarefas

- **T1 — Constante única `TAXONOMIA_DESTINO_GANHO`** em `src/lib/agents/orchestrator.ts` (exportada,
  módulo-level, ao lado de `LIMITE_ECONOMIA_ALTA`): declara os **5 destinos aceitos** do tempo liberado —
  **mais entrega · menos custo · menos erro/retrabalho · menos risco/fraude · menos prazo** — cada um com um
  exemplo concreto do que conta como resposta COMPLETA. O que passa a valer: uma resposta é completa quando
  **nomeia o destino concreto** e o **encaixa em um** dos 5 — _"a mesma entrega com um time menor"_ é
  **válida e completa**, sem entrega adicional nenhuma. Continua recusado só o que não nomeia nada
  ("produtividade", "sobra tempo", "outras atividades" sem dizer quais).
  _(guarda: teste novo assertando que a constante aparece nos 3 prompts e que nenhum deles exige "A MAIS"
  como condição única de aprovação.)_

- **T2 — Consumir a constante nos 3 pontos**, substituindo a exigência do par por "nomear + encaixar na
  taxonomia": (a) `blocoEconomiaAlta` no `buildSavingPrompt`, incluindo o **GATE** final e o par de exemplos
  ❌/✅ (somar um ✅ de *menos custo*); (b) `blocoEconomiaAltaPv` no `buildSavingPreviewPrompt`;
  (c) `perguntaAlocacaoGanhos`, `perguntaAlocacaoGanhosFirme` e `nudgeAlocacaoGanhos` em `chat.functions.ts`.
  Uma fonte, três consumidores — nenhum texto redigita a régua.
  _(guarda: `tests/gate-alocacao-ganhos.test.ts` estendido; a suíte inteira verde.)_

- **T3 — Anti-loop determinístico no juiz do preview:** `buildSavingPreviewPrompt` deixa de injetar
  `blocoEconomiaAltaPv` quando `saving.alocacao_ganhos` já é `'ok'` ou `'reperguntado'` — o gate
  determinístico já coletou o destino e já injetou o nudge que manda escrever a seção; reinterrogar é
  duplicar. O juiz **segue ativo** quando o gate não se aplica (`aplicaGateAlocacaoGanhos` falso —
  contrafactual `'nao'` e custo evitado puro `'externo'`), onde ele é a única rede.
  _(guarda: teste — com `alocacao_ganhos: 'ok'` o prompt do preview NÃO contém o bloco; com `null` contém.)_

- **T4 — Regra 3 (prompts alterados):** atualizar a descrição do `saving`/`saving_preview` em
  `src/lib/testes/prompt-registry.ts` e conferir `prompt-inspector.tsx` — a descrição atual afirma
  explicitamente que a resposta exige "o que o time passou a entregar A MAIS" e que respostas sem isso são
  recusadas; sem atualizar, o registry passa a mentir sobre o prompt.

- **T5 — Regra 1 + 2:** `npm run test` verde e `npm run build:worker` com o `worker.js` **commitado**
  (mudança server-side em `chat.functions.ts`/`orchestrator.ts`).

- **T6 — Regra 12 (spec):** registrar em `spec-docs/SPEC_CORRECOES.md` — sintoma (5 reperguntas na redução
  de 3 auxiliares + 13 perguntas pós-preview) → causa (régua de prompt exigindo o par "nomeado **e** a mais";
  juiz sem limite) → fix (taxonomia única + supressão do bloco) → onde aterrissou → PR. Atualizar também o
  bullet do Memorial no `CLAUDE.md` (regra 7), que hoje descreve a exigência antiga.

- **T7 — Regra 13 (staging primeiro):** deploy no **`edf400b4`** e validação no navegador com o cenário-âncora
  (**saving alto cuja contrapartida é redução de headcount**): a resposta tem de ser **aceita de primeira**,
  sem repergunta e sem reinterrogação no preview, e a seção "### O que mudou após a automação" tem de sair
  gravada. ⚠️ Conferir qual branch está no ar antes do `updateApp` (o deploy substitui a app inteira). Só
  depois, prod **`674a3710`**.

## Critérios de aceitação

1. Existe **uma** constante `TAXONOMIA_DESTINO_GANHO` e os **3** pontos a consomem — nenhum dos três
   redigita a lista de destinos aceitos nem exige "entregar A MAIS" como condição única.
2. Resposta do tipo **"a mesma entrega com um time menor / 3 auxiliares a menos / vaga não reposta"** passa
   **de primeira**: o gate marca `alocacao_ganhos: 'ok'`, o preview não reabre a pergunta, e a seção
   "### O que mudou após a automação" é gravada com o que a pessoa disse.
3. Com `saving.alocacao_ganhos ∈ {'ok','reperguntado'}` o prompt do preview **não** contém o bloco de
   economia alta; com `null` (ou quando o gate não se aplica) **contém**.
4. Nada afrouxou na ponta vaga: "ganhou produtividade" / "sobra tempo" / "foi para outras atividades" sem
   nome continua sendo recusado **uma vez** pelo gate (`perguntaAlocacaoGanhosFirme`), com o anti-loop de
   hoje intacto (2ª resposta aceita).
5. `respostaAlocacaoVaga`, `aplicaGateAlocacaoGanhos` e `LIMITE_ECONOMIA_ALTA` **inalterados**.
6. `npm run test` verde · `worker.js` rebuildado e commitado · `prompt-registry.ts` coerente com os prompts.
7. Validado em **staging** com o cenário-âncora **antes** de prod.

## Fronteiras (não exceder)

- **Gate da jornada / base 220h: NÃO SE MEXE** (decisão desta sessão) — nem o predicado
  `aplicaConfirmacaoBaseHoras`, nem `perguntaJornada`, nem `tetoPorJornada`.
- **Split carga×escala: NÃO SE MEXE.**
- **`respostaAlocacaoVaga` e `aplicaGateAlocacaoGanhos`: NÃO SE MEXE** — o defeito é de prompt.
- Não fundir jornada + teto; não tocar no critério de projeto (`[1.3]`/`[1.4]`, PR #216, em produção); não
  mexer no `analyzer.ts`; não mexer nas colunas do Sheets (a "Alocação Ganhos" AK segue derivada da mesma
  seção do memorial); **nada de barrar submissão**.
- Re-medir o baseline de perguntas pós-#216 **fica fora** desta fatia (é passo próprio).

## Blast-radius

**Arquivos:** `src/lib/agents/orchestrator.ts` (constante + `blocoEconomiaAlta` + `blocoEconomiaAltaPv`) ·
`src/lib/chat.functions.ts` (3 textos do gate) · `src/lib/testes/prompt-registry.ts` ·
`src/lib/testes/prompt-inspector.tsx` (conferir) · `tests/gate-alocacao-ganhos.test.ts` · `worker.js` ·
`spec-docs/SPEC_CORRECOES.md` · `CLAUDE.md`.

**Dependentes:** o gate determinístico de `enviarMensagem` (`chat.functions.ts:1038-1130`) lê o estado que
estes textos alimentam; `extrairAlocacaoGanhos` fatia a seção do memorial para a coluna **"Alocação Ganhos"
(AK)** do Sheets (a mudança de prompt muda o *conteúdo* da seção, não o contrato do fatiamento — o cabeçalho
`### O que mudou após a automação` **permanece exato**); `resyncGoogle` re-extrai.

**Invariantes:** projeto sem `docs/invariants.md`/`docs/INDEX.md` → **confiança MÉDIA** e sem consulta
mecânica (`scripts/ctx-route.sh` também não existe); as travas relevantes vieram da leitura direta do código
e do `CLAUDE.md` (bullet "O que mudou após a automação" e "Alocação Ganhos"). A sessão de código deve fazer a
varredura completa dos consumidores antes de editar. Sem `docs/INDEX.md` não há registro de componentes
canônicos a consultar (RF-32): a constante nova é o primeiro canônico deste assunto — não há equivalente a
reusar, e as 3 cópias da régua em prosa são justamente a duplicação que ela elimina.

**Confiança:** média (alta no diagnóstico — os 3 pontos foram lidos no `main` `39deaf9`; média na infra GGSD
ausente).
