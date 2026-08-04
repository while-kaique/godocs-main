# Spec — Registro de Correções (GoDocs)

> **Documento vivo.** Uma entrada por correção de bug relevante (regra 12 do `CLAUDE.md`:
> "Specs — consultar antes, atualizar a CADA implementação"). Formato fixo:
> **sintoma → causa-raiz → fix → onde aterrissou → status/PR**. Mais recente no topo.

---

## 2026-08-03 — `[1.4]` honesta e curta era lida como rótulo vazio (piso de 60 chars × registro de ausência)

**Status:** ✅ codada, testada (831 verdes) e validada na staging · **Branch:** `fix/piso-ausencia-fonte` · **PR:** [#226](https://github.com/while-kaique/godocs-main/pull/226)

⚠️ **O que a staging cobriu — e o que NÃO cobriu.** O run em `edf400b4` (04/08/2026, cenário "peça
única" com resposta curta e honesta no gate) confirmou o **#225** num chat real — o gate perguntou
**1×** (era 38), a submissão fechou em 6 turnos e a cadeia de reprovação chegou íntegra à aba
`STAGING` (`Status="Reprovado"`, `Motivo Reenvio` intacto em `"—"`). Mas **não exercitou este PR**:
mesmo com o usuário respondendo em 40 chars, o agente escreveu a `[1.4]` em prosa (~200 chars,
_"…Não há indicador formal para conferência…"_), que já passava na régua antiga. Ou seja, a seção
curta é **rara na prática** — o LLM tende a expandir. Este fix fecha o buraco quando ela aparece
(e tira o incentivo a inventar fonte); a garantia é a bateria de unidade, não o E2E.

**Sintoma:** uma seção `[1.4]` que **registra a ausência de fonte** — `**Ponteiro movido:** não há
indicador.` — era classificada como vaga por `secaoPonteiroVaga`. O gate então cobrava a seção de novo,
numa pergunta cuja **única resposta verdadeira já estava escrita ali**. Pior que a pergunta redundante: o
nudge `[SISTEMA]` manda o LLM **reescrever** a seção a partir da resposta do usuário — ou seja, empurra o
agente a **inventar uma fonte**, exatamente o que a régua de rastreabilidade quer evitar. Era a pendência
declarada na entrada do #225 (logo abaixo).

**Causa-raiz — um piso de comprimento para dois casos de tamanho natural diferente.** `secaoPonteiroVaga`
exigia **≥ `MIN_SECAO_CRITERIO` (60) chars E** casar `PISTA_ONDE_VERIFICAR`. Só que a `PISTA` mistura:

- **nomear** uma fonte ("no relatório de conciliação do Metabase") → texto longo, 60 chars é fácil;
- **registrar a ausência** ("não há indicador") → texto curto **por natureza**.

Com o piso único, a seção honesta ficava indistinguível do **rótulo vazio** que originou o gate
(`"**Ponteiro movido:** custo externo eliminado."`, a meia-seção do `custo-evitado-puro` em staging).
A decisão fechada da `SPEC_CRITERIOS_PROJETO` — _"aceita 'não sei onde conferir' → zona cinzenta, nunca
reprovação automática"_ — valia no analisador, mas o gate a contradizia antes de chegar lá.

**Fix:** extrair de `PISTA_ONDE_VERIFICAR` um subconjunto declarado, `REGISTRO_AUSENCIA_FONTE`, e
dispensar o piso quando ele casa — **o próprio registro da ausência é a substância**, não o comprimento.
Sem número mágico novo:

```ts
export function secaoPonteiroVaga(texto: string | null | undefined): boolean {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (REGISTRO_AUSENCIA_FONTE.test(t)) return false; // ausência registrada = seção escrita
  if (t.length < MIN_SECAO_CRITERIO) return true;
  return !PISTA_ONDE_VERIFICAR.test(t);
}
```

A regex é **estreita de propósito**: exige a negação (`não sei/soube/há/existe…`, `sem …`) ligada, **na
mesma oração**, ao objeto que faltou (fonte · indicador · onde · relatório · painel…). Negação sobre
outro assunto ("o time não gostava da rotina antiga") **não** fura o piso.

⚠️ **Pegadinha que custou uma rodada de teste:** `\b` em JS é **ASCII-only**. `\bn[ãa]o\s+(?:…|h[áa])\b`
**nunca** casaria `"não há indicador"`, porque entre o `á` e o espaço não existe fronteira de palavra —
os dois são não-word. Justamente a forma mais comum. Separador correto: `(?:\s+|$)`.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (`REGISTRO_AUSENCIA_FONTE` + short-circuit em
`secaoPonteiroVaga`) · `tests/gate-criterio-secoes.test.ts` (+5 testes: o caso do bug, 6 variantes de
registro de ausência abaixo do piso, **regressão da meia-seção** que segue reprovando, negação de outro
assunto, e a fonte nomeada intacta). A fixture do teste "converge em NO MÁXIMO 1 pergunta" trocou de
`"não há indicador"` para `"melhorou bastante a rotina"` — a antiga virou seção **válida** e deixaria o
teste de exercitar o pior caso.

**Escopo:** só a régua de qualidade da seção. **Não** mexe no anti-loop do #225 (o gate segue perguntando
uma vez só), nem no analisador — uma `[1.4]` que registra ausência continua indo para **zona cinzenta**,
que é o desfecho correto.

---

## 2026-08-03 — Gate do critério reperguntava 38× e travava a submissão (anti-loop anulado por snapshot)

**Status:** ✅ codada e testada (826 testes verdes, já com o #224) · **Branch:** `fix/loop-gate-criterio` · **PR:** [#225](https://github.com/while-kaique/godocs-main/pull/225)

**Sintoma:** reproduzido **em produção** em 03/08/2026 (projeto `471dd0c9…`, fase de saving). O gate do
critério repetiu a MESMA pergunta (`perguntaCriterioSecoes`) **38 vezes seguidas** e a submissão nunca
fechou: `submeter-validacao` devolvia **500 "sem ganho mensurável"**, porque a fase financeira jamais
completava. Atingia exatamente quem responde honestamente que **não há ponteiro nem fonte** — a população
que a regra "aceita 'não sei onde conferir' → zona cinzenta, nunca reprovação automática" existe para
proteger. O agente chegava a dizer _"me diga isso mesmo, que eu registro a ausência"_ e reperguntava.

**Causa-raiz — o anti-loop se anulava sozinho.** Em `chat.functions.ts`, dentro de UM MESMO turno:

1. `criterioAtual` é lido no topo de `enviarMensagem` (~1153) — um **snapshot**;
2. o ramo de resposta (~1267) marca `criterio_secoes: 'ok'` no **estado**;
3. o gate (~1580) relia **`criterioAtual`** — ainda `'pendente'` — e **re-armava `'pendente'`**.

O comentário acima do gate já dizia _"pergunta UMA vez só (anti-loop) — na volta, o turno de resposta
marca 'ok' aconteça o que acontecer"_. A intenção estava certa; a **segunda leitura do mesmo campo** a
anulava. Não era regra de negócio errada: era **acoplamento entre duas leituras**, invisível em teste de
unidade porque não vivia dentro de nenhuma das duas.

**Por que só travava quem não tem indicador:** a única saída do ciclo era o LLM escrever uma `[1.4]` que
passasse em `secaoPonteiroVaga`, que exige **≥60 chars E** casar `PISTA_ONDE_VERIFICAR`. A regex é generosa
(aceita `"não soube"`, `"sem fonte"`), mas a resposta honesta gera texto curto — `**Ponteiro movido:** não
há indicador.` **passa na regex e reprova no comprimento**. Quem tinha um Metabase para citar escrevia três
linhas, passava nos dois e nunca via o problema. _(Contorno usado em prod: responder de forma longa e
cooperativa.)_

**Fix:** o gate passou a ler o **estado vivo**, não o snapshot:

```ts
const criterioResolvido =
  faseCriterio === "saving"
    ? ((resultado.saving ?? estado.saving).criterio_secoes ?? null)
    : ((resultado.receita ?? estado.receita).criterio_secoes ?? null);
if (faseCriterio && deveBloquearPorCriterio(criterioResolvido, resultado.type)) { … }
```

O re-merge de `criterio_secoes` (~1337/1346) já roda **antes** do gate, então `resultado.saving` carrega o
`'ok'` do turno. A regra virou o **decisor puro `deveBloquearPorCriterio`** (`'ok'` nunca volta a bloquear;
só age sobre `preview`/`complete`) — testável sem subir o `enviarMensagem` inteiro. `criterioAtual` **fica**,
com um único uso legítimo e comentado: decidir se ESTE turno é a resposta à pergunta do gate.

**O que segura a qualidade depois da única pergunta:** o nudge `[SISTEMA]` (manda o LLM escrever a seção a
partir do que a pessoa respondeu) e a triagem humana. **Nunca uma segunda trava** — era ela que travava o
usuário. É o que a `SPEC_CRITERIOS_PROJETO` já mandava.

**Onde aterrissou:** `src/lib/chat.functions.ts` (`deveBloquearPorCriterio` + leitura viva no gate +
comentário-guarda no `criterioAtual`) · `tests/gate-criterio-secoes.test.ts` (+5 testes, incluindo a
**simulação turno a turno na ordem real** — `viva` converge em 1 pergunta, `snapshot` repergunta nos 40
turnos, travando o bug para sempre).

**Pendência proposta (NÃO incluída aqui):** afrouxar o piso de 60 chars de `secaoPonteiroVaga` quando o
texto **registra ausência explícita** — hoje uma resposta honesta e curta é indistinguível de rótulo
vazio. Com este fix ela deixou de travar alguém (o gate avalia uma vez só), então é qualidade, não
bloqueio. → **Resolvida** na entrada acima (`fix/piso-ausencia-fonte`, PR #226).
## 2026-08-03 — Gate do critério pedia "**(b)** …" ao usuário: alínea órfã de um roteiro que ele nunca viu

**Status:** ✅ mergeada · **Branch:** `fix/gate-criterio-ux` · **PR:** [#224](https://github.com/while-kaique/godocs-main/pull/224)

**Sintoma:** no meio da conversa do memorial de saving, o agente perguntava literalmente
_"**(b)** qual ponteiro isso moveu e onde dá pra conferir…"_ — começando numa alínea "(b)" sem que
nenhum "(a)" tivesse aparecido antes. O usuário não tem como saber o que é "(b)": as letras são de um
roteiro **interno**, nunca mostrado. Efeito colateral: a pergunta mais importante da régua de critério
chegava com cara de formulário truncado, e (diferente das irmãs jornada/teto/alocação) **sem botão nenhum**.

**Causa-raiz:** duas origens independentes, as duas de APRESENTAÇÃO — a lógica do gate estava certa.
1. **Texto do gate** (`perguntaCriterioSecoes`, `chat.functions.ts`): montava a mensagem como uma lista
   numerada por letras fixas — `"**(a)** que processo mudou…"` para a `[1.3]` e `"**(b)** qual ponteiro…"`
   para a `[1.4]` —, mas os dois itens são **condicionais e independentes**. No caso mais comum (a `[1.3]`
   escrita e só a `[1.4]` faltando — exatamente o `custo-evitado-puro` que originou o gate na staging), só
   o segundo item entrava e a mensagem **abria no "(b)"**. As letras só faziam sentido quando os dois
   buracos coexistiam.
2. **Prompt do agente** (bloco `[1.4]`, `orchestrator.ts`): o roteiro "COMO CONDUZIR" usa `a)`/`b)`/`c)` e
   **nada proibia copiá-los** para o chat — o LLM ecoava o roteiro cru. Os códigos `[x.y]` do memorial já
   tinham essa trava (+ a rede determinística `normalizarMarcadoresMemorial`); as letras do roteiro, não.
   Agravante: o bloco `[1.3]`/`[1.4]` era **digitado duas vezes** (saving e receita), idêntico caractere a
   caractere — corrigir num lado deixaria o outro para trás.

**Fix (3 pontos):**
- **Copy sem marcadores** (`perguntaCriterioSecoes`): 3 formatos, um por combinação de buracos, cada item
  legível sozinho. Só-ponteiro e só-processo viram **frase única**; os dois juntos viram **bullets** (`- `,
  que o `SimpleMarkdown` do chat já renderiza). A frase de escape "…em vez de inventar uma fonte" continua
  em todo formato que cobra o ponteiro — a ausência de fonte é resposta legítima (decisão fechada da
  `SPEC_CRITERIOS_PROJETO`).
- **Botões** (`OPCOES_PONTEIRO`, 4 opções: Custo · Receita · KPI da área · "Ainda não sei dizer"), **só
  quando o ÚNICO buraco é o ponteiro** — classificar é escolher de uma lista, mas "que processo mudou"
  precisa de prosa, e um clique ali fecharia o gate sem a seção `[1.3]`. ⚠️ Detalhe que quase passou:
  `formatResponse` **só serializa `options` quando `type === 'options'`** (e lê a pergunta de `question`,
  não de `content`) — com `type: 'question'` os botões sumiriam a caminho da tela.
- **`BLOCO_SECOES_CRITERIO`** (`orchestrator.ts`): as duas cópias do bloco `[1.3]`/`[1.4]` viraram **uma
  constante única**, interpolada em `buildSavingPrompt` e `buildReceitaPrompt` — mesma disciplina da
  `TAXONOMIA_DESTINO_GANHO`. A primeira linha é a trava **anti-vazamento** ("os marcadores são roteiro
  interno; NUNCA os escreva na mensagem ao usuário").

**Detalhe que preserva a rastreabilidade:** o clique num botão dá só a **classificação**, sem dizer onde o
número se confere — e a `[1.4]` sairia pela metade, que é a falha original do gate. Então o turno de
resposta calcula `precisaFonte` (`respostaTrouxeFonte`: **clique nunca conta como fonte**; texto digitado
passa pela mesma `PISTA_ONDE_VERIFICAR` do gate) e o nudge `[SISTEMA]` manda o agente completar a fonte na
ordem certa: propor o sistema/base que a doc aprovada já nomeia → senão perguntar **1×** → senão registrar
a ausência. ⚠️ O guard preciso importa: o rótulo _"KPI da área (erro, retrabalho, prazo, risco)"_ **casaria
a regex por acidente** (ela aceita "kpi") e daria a fonte por resolvida.

**Invariante preservado:** o gate determinístico continua perguntando **UMA vez só** — os botões não
adicionam turno, e o follow-up da fonte fica com o agente (que já tem anti-redundância e anti-loop no
roteiro). A contagem de perguntas por submissão não muda.

**Onde aterrissou:** `src/lib/chat.functions.ts` (`perguntaCriterioSecoes`, `OPCOES_PONTEIRO`,
`respostaTrouxeFonte`, `nudgeCriterioSecoes`, ramo de botões do gate) · `src/lib/agents/orchestrator.ts`
(`BLOCO_SECOES_CRITERIO`, `PISTA_ONDE_VERIFICAR` exportada) · `src/lib/testes/prompt-registry.ts`
(descrições de saving e receita) · `tests/gate-criterio-secoes.test.ts` (+14 testes: nenhum formato emite
alínea órfã, bullets quando faltam os dois, o clique não vale por fonte, bloco único nos 2 prompts).

---

## 2026-08-03 — Coluna "Motivo Reenvio" nascia em BRANCO, fora do padrão "texto vazio → —"

**Status:** codada e testada (805 testes verdes) · **Branch:** `fix/motivo-reenvio-traco` · **Plano:** [docs/plans/motivo-reenvio-traco-padrao.md](../docs/plans/motivo-reenvio-traco-padrao.md) · **PR:** _(a abrir)_

**Sintoma:** toda linha nova da planilha vinha com a célula **"Motivo Reenvio" vazia**, enquanto as outras
colunas de texto sem dado traziam **"—"** (`Observações`, `Motivo Reprovado`, `Análise Antiagente`,
`Memorial anterior`). Célula em branco na planilha é ambígua: não se distingue "ninguém pediu reenvio" de
"a escrita falhou". Havia o mesmo furo no `/dashboard`: o admin que **apagava** o motivo deixava a célula
em branco.

**Causa-raiz:** duas, ambas de **omissão do padrão**, não de lógica.
1. `padronizarLinha` (`src/lib/google/sync.ts`) converte toda coluna de TEXTO vazia em `"—"` — mas
   **"Motivo Reenvio" nunca entrava no payload** do append. Foi excluída de propósito, pelo motivo certo (o
   conteúdo é da triagem humana no `/dashboard`, e um update sobrescrevendo apagaria o texto do admin) —
   só que a exclusão foi aplicada ao **append** também, onde não há nada para preservar. O comentário no
   código ("como as colunas de Diff — o sistema nunca a escreve") equiparava a coluna às de Diff, que são
   manuais em **qualquer** momento; esta não é.
2. `definirStatusProjeto` (`src/lib/dashboard-admin.functions.ts`) gravava `motivo.trim()` **direto**, sem
   passar pelo padrão — motivo apagado virava `''`.

**Fix (3 pontos + doc):**
- **`sync.ts` — `syncSubmitToGoogle`:** `row['Motivo Reenvio'] = '—'` **só quando `p.modo !== 'edicao'`**
  (junto de `Data Submissão`), e também no **append de RECUPERAÇÃO** (linha ausente → a linha nasce agora,
  não há motivo de triagem a preservar). O **update in-place da edição continua sem tocar a coluna** — é o
  invariante que segura o texto do admin.
- **`dashboard-admin.functions.ts`:** helper puro **`ouTraco`** (inverso do `texto()`) aplicado a
  `Motivo Reenvio`, `Motivo Reprovado` e `Observações` na escrita e no patch de cache. A **auditoria**
  (`admin_status_log`) segue registrando `null` quando não há motivo — o "—" não vira texto de log.
- **`email-legados.functions.ts`:** `motivoDaCelula()` trata `"—"`/`"-"` como ausência ao ler
  **"Observações"** — o append já gravava "—" ali, então o e-mail de reenvio podia sair com _"Motivo: —"_.
  (Defeito latente encontrado junto, mesmo padrão.)
- **`CLAUDE.md`:** o gotcha 4 do "Critério de projeto" deixou de dizer "o sistema NUNCA escreve" e passou a
  declarar a distinção real: **conteúdo** é manual; o **append inicializa com "—"**; o **update nunca toca**.

**Onde aterrissou:** `src/lib/google/sync.ts` · `src/lib/dashboard-admin.functions.ts` ·
`src/lib/email-legados.functions.ts` · `tests/sync-motivo-reenvio-traco.test.ts` (novo — append inicializa,
edição não toca, recuperação inicializa, Diff intocadas) · `tests/dashboard-admin.test.ts` +
`tests/email-legados.test.ts` (casos novos) · `CLAUDE.md`.

**Fora do escopo (decisão):** **não** houve backfill das linhas legadas já em branco na planilha — daqui
pra frente as novas nascem com "—"; as antigas só mudam quando editadas (ou num backfill próprio, se o
Luis pedir).

---

## 2026-07-30 — Gate da Seção 2.4 recusava a resposta CERTA quando o ganho é "menos custo" + juiz do preview reinterrogava sem limite

**PR:** [#217](https://github.com/while-kaique/godocs-main/pull/217) (mergeado) · **Status:** ✅ corrigida — validada na staging `edf400b4` com o cenário-âncora ponta a ponta (agente pergunta **1×**, a resposta de redução de headcount é **aceita de primeira**, sem reinterrogação no preview, seção gravada e coluna AK preenchida) e **prod `674a3710` deployado** (2026-07-30) · **Branch:** `fix/gate-alocacao-taxonomia-e-materialidade` · **Plano:** [docs/plans/taxonomia-destino-ganho-e-anti-loop.md](../docs/plans/taxonomia-destino-ganho-e-anti-loop.md)

**Sintoma (2 defeitos independentes, medidos no baseline de 24 conversas reais):**
1. Saving alto cuja contrapartida foi **redução de headcount** (3 auxiliares). O usuário respondeu certo
   ("reduzimos 3 auxiliares, vagas não repostas") e levou **5 reperguntas** — o agente insistia por uma
   "entrega a mais" que não existe.
2. **13 perguntas pós-preview**: o LLM-juiz do preview reinterrogava o destino do ganho **mesmo depois** de o
   gate determinístico já ter coletado e registrado a resposta.

**Causa-raiz:** era **100% de prompt**, em **3 textos que redigitavam a mesma régua** definindo "resposta
completa" como o PAR _"atividades NOMEADAS **E** o que o time entrega **A MAIS**"_ — `blocoEconomiaAlta`
(`buildSavingPrompt`), `blocoEconomiaAltaPv` (`buildSavingPreviewPrompt`) e os 3 textos do gate em
`chat.functions.ts` (`perguntaAlocacaoGanhos` / `…Firme` / `nudgeAlocacaoGanhos`). Quando o ganho é **menos
custo** (vaga não reposta, equipe menor, contrato cancelado), a entrega **não aumenta** — fica igual com menos
gente — e a resposta certa lia como incompleta. O `blocoEconomiaAlta` citava "redução de equipe-vaga não
reposta" de passagem, num parêntese de exemplos, mas o **gate** da frase seguia exigindo o par, e é o gate que
decide. O 2º defeito: o juiz do preview **não tinha limite de recusas** e não sabia que o gate já havia
coletado. ⚠️ **`respostaAlocacaoVaga` NÃO era o culpado** — verificado: "redução de 3 auxiliares" tem número,
logo o predicado **aceita**. Ele não foi tocado (mexer afrouxaria a rede que pegou o boilerplate do Gostream).

**Fix:**
- **Fonte única `TAXONOMIA_DESTINO_GANHO`** (`orchestrator.ts`, ao lado de `LIMITE_ECONOMIA_ALTA`): declara os
  **5 destinos aceitos** — *mais entrega · menos custo · menos erro/retrabalho · menos risco/fraude · menos
  prazo* —, cada um com exemplo concreto, e a régua nova: **basta NOMEAR o destino e encaixá-lo em UM dos 5**.
  "A mesma emissão de notas por um time menor, com as 3 vagas não repostas" é resposta **completa**, sem
  entrega adicional e sem número. Os **3 pontos consomem a constante**; nenhum redigita a lista.
- **Anti-loop determinístico no juiz:** `buildSavingPreviewPrompt` **deixa de injetar** o bloco de economia
  alta quando `saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`. Supressão determinística, **não**
  persuasão ("recuse só 1 vez" é o tipo de garantia que falhou no Gostream) e **sem campo novo** no estado. O
  juiz segue ativo onde o gate não se aplica (contrafactual `'nao'`, custo evitado puro `'externo'`) — ali é a
  única rede.
- **Nada afrouxou na ponta vaga:** "ganhou produtividade" / "sobra tempo" / "foi para outras atividades" sem
  nome segue recusado 1x pelo gate, com o anti-loop de hoje intacto.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (constante + os 2 blocos + a supressão) ·
`src/lib/chat.functions.ts` (os 3 textos, agora **exportados** para o teste da fonte única) ·
`src/lib/testes/prompt-registry.ts` (regra 3 — a descrição afirmava a exigência antiga) ·
`tests/taxonomia-destino-ganho.test.ts` (**novo**, 14 testes: constante, os 5 consumidores interpolando-a,
supressão do bloco por estado, e guarda anti-afrouxamento do predicado) · `worker.js`.

**Fronteiras respeitadas (não se mexeu):** `respostaAlocacaoVaga` · `aplicaGateAlocacaoGanhos` ·
`LIMITE_ECONOMIA_ALTA` · gate da jornada/base 220h · split carga×escala · critério de projeto (`[1.3]`/`[1.4]`,
PR #216) · colunas do Sheets. O cabeçalho `### O que mudou após a automação` **permanece exato** —
`extrairAlocacaoGanhos` fatia por ele para a coluna "Alocação Ganhos" (AK).

---

## 2026-07-30 — Cron de reconciliação entrava em LOOP e estourava a cota do Google Sheets

**Sintoma.** Na staging, tudo que toca o Sheets começou a falhar com **429
`RESOURCE_EXHAUSTED`** (`ReadRequestsPerMinutePerUser`, 60/min): **707 erros** na janela de log,
o cron `POST /api/cron/reanalisar-pendentes` devolvendo **500** de forma contínua, e — o pior — o
**append de IDA de uma submissão nova falhando** (`[google/sync] Falha ao inserir na planilha:
Sheets header read falhou (429)`), deixando o projeto **fora da planilha**. Como
`reconciliarExclusoes` remove do SQLite todo projeto não-rascunho ausente do Sheet depois da
**carência de 1h**, o desfecho era **perda silenciosa da submissão**. ⚠️ A cota é do **mesmo
projeto GCP da produção** (`398963590019`), então a staging estava **degradando o Sheets de prod**.

**Causa-raiz.** Regressão introduzida pela própria feature do critério de projeto (a coluna nova
`Classificação`) em `reconciliarComplexidade` (`chat.functions.ts`). O critério de "já está
pronto, pula" passou a ser `!vazio(Complexidade) && !vazio(Classificação)` — **impossível de
satisfazer** para projeto ANTIGO: ele tem `Complexidade` preenchida na planilha, `Classificação`
vazia (coluna nova) e **nenhuma** `classificacao_avaliacao` no SQLite. O ramo de resync exigia só
`compSqlite || classifSqlite`, então entrava, escrevia **apenas** Complexidade/Observações (que já
estavam lá), a `Classificação` continuava vazia — e no minuto seguinte o mesmo projeto se
qualificava outra vez. **Para sempre.** Cada iteração custa uma leitura de cabeçalho
(`updateRowByProjectId` → `fetchHeaderMap`). Medido: **109 projetos distintos, 693 tentativas em 7
rodadas (~99 leituras/min)** contra a cota de 60/min — ou seja, o cron consumia a cota **inteira**
sozinho, permanentemente. O teto `maxReanalises = 15` **não** protegia: ele limita só as
re-análises, e o caminho percorrido era o de **resync**, que era ilimitado.

**Fix.** A decisão de o que fazer com cada projeto saiu do meio do loop e virou a função **pura**
`decidirReconciliacaoPlanilha` (exportada de `chat.functions.ts`), que devolve
`{ acao: 'nada' | 'resync' | 'reanalisar', colunas }`. A regra que garante **convergência**: só age
quando existe algo **realmente gravável** — coluna **vazia na planilha** *e* dado correspondente
**no SQLite** — ou quando cabe re-análise (SQLite vazio nas **duas** pontas). Nada a fazer →
`'nada'`, o projeto **não** conta como pendente e **não gera leitura**. De quebra, para de
reescrever coluna que já estava preenchida. `'—'` conta como vazio (é o que o sync grava sem dado).

**Onde aterrissou.** `src/lib/chat.functions.ts` (função pura nova + loop de
`reconciliarComplexidade` reescrito para consumi-la) · `tests/reconciliacao-convergencia.test.ts`
(**8 testes**, incluindo o caso exato do loop e a **estabilidade da 2ª passada**) · `worker.js`
recomitado. **769 testes verdes.** Commit `cb8d677` na branch `staging/criterios-coautor`.

**Status.** ✅ Corrigido e **deployado na staging** (`edf400b4`, 30/07 15:03). **Prova no ar:**
`POST /api/admin/reanalisar-pendentes` → `{"submetidos":569,"faltando":0,"ressincronizados":0,
"reanalisados":0}` em **15,8s**, **HTTP 200** (antes: ~109 por rodada e HTTP 500). ⚠️ **`origin/main`
nunca teve o bug** (`classifNaPlanilha` não existe lá) — **produção esteve limpa**; o único dano em
prod foi o colateral da cota compartilhada. **Ainda não mergeado**; vai a prod junto do critério.

**Gap ADJACENTE, achado e NÃO corrigido** (decisão do Luis: fora deste fix): **`resyncGoogle` não
recupera linha ausente.** Ele chama `syncSubmitToGoogle` com `modo: "edicao"` →
`updateRowByProjectId`; se a linha **não existe** na planilha, não acha nada, **não faz nada** e
ainda devolve **`ok:true`**. Logo, quando o append da IDA falha (cota/transiente), **não há caminho
de recuperação** — e o projeto é purgado depois da carência. Fix sugerido: **append** quando a linha
não existe, em vez de no-op silencioso.

---

## 2026-07-22 — Upload de `.zip` barrado como "extensão não suportada" na Etapa 2 (caso Rafael Lobo)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/aceitar-zip-submissao` · **Plano:** [docs/plans/aceitar-zip-submissao.md](../docs/plans/aceitar-zip-submissao.md)

**Sintoma:** ao anexar arquivos na Etapa 2 (documentação), o usuário recebia "extensão não suportada" e o
arquivo era descartado. Caso real: **Rafael Lobo** (`rafael@gocase.com`). Ele contornou subindo um arquivo
solto (`page.tsx`), mas o instinto natural — compactar a pasta do projeto num `.zip` — não funcionava.

**Causa-raiz:** o gate de upload aceita só uma **whitelist fixa** de extensões (`ACCEPTED_DOC_EXT` em
`src/lib/submeter/constants.ts`) e `.zip` não estava nela. A rejeição é **100% client-side** (`step2.tsx`,
função `addFiles`, ~linha 419) — o arquivo é descartado no navegador **antes** de qualquer chamada ao
servidor, então **não há trilha nos logs de prod** (confirmado: os logs só mostraram a submissão bem-sucedida
com `page.tsx`; o feedback de rejeição era um `toast.info` cinza, fácil de não perceber).

**Fix (client-side, sem tocar no servidor — decisão de produto: aceitar .zip):**
- **Novo módulo `src/lib/submeter/unzip.ts`** — descompacta `.zip` no navegador com **`fflate`** (async, não
  trava a UI). `expandirZips(File[])` expande cada `.zip` em seus arquivos internos; funções puras `ehZip`,
  `entradaZipVira` (descarta diretórios, vazios, `.DS_Store`, `__MACOSX/`). Cada arquivo interno vira um `File`
  com `webkitRelativePath` = caminho interno. Teto `MAX_ZIP_MB = 50` por `.zip`.
- **Hook em `addFiles` (`step2.tsx`)** — antes do loop de análise, se há `.zip` na entrada, chama
  `expandirZips` e substitui a lista. **Todo o resto do pipeline é reusado sem mudança:** o filtro de
  `node_modules`/pastas de dev, a whitelist de extensão (arquivos internos inválidos seguem rejeitados), o
  descarte de vazios, o dedup e o orçamento de tokens (~200k) valem naturalmente sobre os arquivos extraídos.
- **`accept` do input + texto de ajuda** — `.zip` adicionado ao seletor e à linha "Aceita: …".
- **Por que no cliente e não no worker:** `addFiles` é o funil único; expandir ali reaproveita todos os
  filtros e o gate de tokens que já existem client-side. No worker exigiria reimplementá-los e o gate de
  tokens ficaria cego (zip = 1 blob → risco de estourar o corte de 200k em silêncio).

**Onde aterrissou:** `src/lib/submeter/unzip.ts` (novo), `src/lib/submeter/step2.tsx` (hook + accept + texto),
`tests/unzip.test.ts` (novo, 15 casos), `package.json` (+`fflate ^0.8.3`, zero-deps). Sem `build:worker`
(mudança client-only). Suíte: 577 verdes.

**Fronteiras (fora do escopo):** não amplia a whitelist para imagens/planilhas/`.rar`/`.7z`; sem nested-zip
(zip dentro de zip é tratado como arquivo `.zip` interno e ignorado); sem mudança server-side.

---

## 2026-07-03 — Autocomplete de participantes não mostrava a lista da TeamGuide + sem feedback de carregando

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/autocomplete-participantes-lento`

**Sintoma:** no campo "Participantes e seus papéis" (Etapa 1), digitar um nome ("kai") NÃO abria a lista
dinâmica da TeamGuide — só aparecia o erro de validação "Insira um e-mail válido". E não havia nenhum
sinal de que a lista estava sendo carregada (parecia quebrado).

**Causa-raiz (DUAS somadas):**
1. **Infra (a de verdade):** `GET /api/participantes/sugestoes` caía, de forma **intermitente**, num erro de
   plataforma do Godeploy no cold start — `Internal error while starting up Durable Object storage caused
   object to be reset` → **502**. Nos logs, o mesmo erro batia em `/api/config` e `/api/auth/me` no MESMO
   instante: é o Durable Object que respalda o `env.DB` falhando ao subir, atingindo **TODAS** as rotas de
   API (esta rota nem toca o banco) — **não** é o handler, e não dá pra capturar no código. Recupera sozinho
   em 1-2 tentativas (às 17:03 o `/api/config` já voltava `ok`). Nessa janela, a lista vinha vazia.
2. **UX que escondia a falha:** o dropdown só abria com `suggestions.length > 0` e a lista só começava a
   carregar ao marcar "em equipe = sim". Sem estado de "carregando", uma lista vazia (por 502 ou por ainda
   estar carregando) era indistinguível de "quebrado": quem digitava caía no `onBlur`→`tryAdd("kai")` →
   falha do `EMAIL_RE` → "Insira um e-mail válido".

**Fix (frontend, sem tocar server — o 502 é infra, não código):**
- **Retry no cliente:** `buscarSugestoesComRetry` tenta o endpoint até 3× com backoff (400/800ms) antes de
  desistir — um 502 transitório do DO se auto-cura sozinho. Esgotado, reseta a promise (nova chance no
  próximo mount) e degrada suave (lista vazia, campo segue aceitando e-mail digitado).
- **Velocidade — prefetch:** `prefetchSugestoesParticipantes()` dispara o fetch (com retry) já no MOUNT da
  Etapa 1 (antes de marcar "em equipe"), então a lista costuma estar pronta quando o usuário digita. Reusa
  cache/promise de módulo (idempotente) + cache de 10 min do servidor (`getSugestoesParticipantes`).
- **Feedback — `loading`:** `useSugestoesParticipantes` devolve `{ pessoas, loading }`. O dropdown abre
  também enquanto `loadingSuggestions` e mostra uma linha SUTIL "Buscando e-mails na Team Guide…" (3
  pontinhos go-blue, `go-bounce`, neutralizado sob `prefers-reduced-motion`; `role="status"`/`aria-live`).

**Onde aterrissou:** `src/lib/submeter/participantes-sugestoes.ts` (retry + `prefetch…` + hook devolve
`loading`), `src/lib/submeter/step1.tsx` (prefetch no mount + passa `loadingSuggestions`),
`src/lib/submeter/form-components.tsx` (`ParticipantesPapeisInput`: abre no load + linha "buscando…").
Só frontend. ⚠️ O erro de DO no cold start é da PLATAFORMA (mais frequente na staging, "fria"); se persistir
em prod, é caso de abrir com o time do Godeploy — não é bug do app.

---

## 2026-07-03 — "Enviar para Triagem" liberado sem memorial de saving aprovado (edição especial→saving) → 500 "sem ganho mensurável" mascarado

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/enviar-sem-memorial-saving`

**Sintoma:** autor de projeto (caso real "Supply Lojas <> Estoque CDs" / Juan Silva, prod 03/07) edita e recebe
o toast genérico *"Erro ao enviar projeto. Tente novamente."* — preso. Nos `api_logs` do Investigador:
**6× `submeter-validacao` HTTP 500** com *"Não é possível submeter este projeto como saving sem ganho
mensurável"*. Não é o bug de LEGADO doc-ausente (ID hex, doc existe) nem o de base64 vazio.

**Causa-raiz:** o botão "Enviar para Triagem" (`FinalReview`, `step3-chat.tsx`) é gated **só** por
`chatComplete` — **não** exige o preview de memorial de saving aprovado. O **seed** (`submeter.tsx`,
`applySeed`) já liga `chatComplete` só quando `saving.memorial_calculo` existe; mas o **atalho de "reenviou
o formulário de saving sem mudar nada" no modo edição** (`handleSavingFormSubmit`) fazia
`setChatComplete(true)` **sem** essa checagem. Fluxo do caso: projeto ESPECIAL → na edição foi **convertido
para saving** (`atualizar-tipos`), doc re-aprovada (handoff doc→saving já liga `chatComplete`), form de
saving enviado (Assistente 75h→6h) → o agente fez a **pergunta do gate de composição** (memorial NÃO
gerado); ao **reabrir o form ("Editar dados") e reenviar igual**, o atalho marcou a conversa como concluída
→ botão "Enviar" apareceu com `documentacao.conteudo.saving` ausente → o gate do servidor
(`submeterParaValidacao`) leu `economia_reais_mes` ausente = 0 e lançou o 500. O cliente mascarava a
mensagem real. Reproduzido de forma determinística no staging (mesmo erro + mesma pergunta do gate).

**Fix (client-only — sem `worker.js`; o gate do servidor já barra corretamente):**
- **(a)** `handleSavingFormSubmit`: no atalho de reenvio idêntico da edição, só `setChatComplete(true)` se
  `approvedSavingPreview !== null` (espelha o guard que o ramo do fluxo "ambos" já tinha); sem preview
  aprovado, cai no chat da fase de saving (a pergunta pendente) para o memorial ser concluído.
- **(b)** `handleSubmitProjeto` (defesa em profundidade): antes de enviar, se o projeto não é especial e
  falta `approvedSavingPreview` (saving) ou `approvedReceitaPreview` (receita), barra com toast orientando a
  concluir o memorial e reabre o formulário — em vez de deixar o servidor devolver 500.
- **(c)** `handleSubmitProjeto` (catch): mostra a **mensagem real** do servidor
  (`Erro ao enviar projeto: <msg>`) em vez do genérico "Tente novamente" — orienta a ação se algo escapar.
- **(nota)** o seed de `approvedSavingPreview` a partir do memorial salvo já existe no `main` (necessário
  para (a)/(b) não quebrarem a edição legítima de quem não mexe no saving).

**Onde aterrissou:** `src/routes/submeter.tsx` (`handleSavingFormSubmit`, `handleSubmitProjeto`).
Testes: 534 passando. Sem mudança server-side.

---

## 2026-07-03 — Loop da pergunta "quantas horas a pessoa fazia à mão" (gate carga real × escala) na EDIÇÃO

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/loop-carga-escala-agente-conduz`

**Sintoma:** usuários relataram que, ao **editar** um projeto e chegar no memorial, o chat travava
repetindo **sem fim** a pergunta do split carga real × escala ("dessas Xh economizadas, quantas a pessoa
realmente fazia à mão?"). Mesmo respondendo ("eu já falei", "é assim e assado que as horas funcionam", ou
dando um valor), o agente **jogava a MESMA pergunta de novo** e nunca saía dela. Concentrado em edições.

**Causa-raiz:** a pergunta era um **GATE DETERMINÍSTICO** no backend, não uma pergunta do agente. Duas
camadas de forçamento em `chat.functions.ts`/`enviarMensagem`: (1) a branch de resposta
(`carga_escala==='pendente'`) parseava o texto do usuário e, quando ele **contestava o total** ou não dava
número limpo, refazia via escape (reset + nudge pro LLM recalcular); (2) o **gate de preview**
(`carga_escala!=='ok'`) **interceptava o preview/complete que o LLM produzia e o descartava**, recolocando
a pergunta fixa. Ou seja: por mais que o agente "raciocinasse" e tentasse seguir, um `if` do backend
sobrepunha a saída dele e re-perguntava. O escape (fix de 30/jun, `contestaTotalCargaReal`) **delegava a
terminação ao LLM** sem loop-breaker determinístico — e, na **edição**, o memorial pronto (linhas/total já
fixos) **ancora** o LLM a re-previewar o MESMO total, então o gate re-perguntava indefinidamente. A
pergunta ainda dizia "não o valor por dia", e o usuário de edição respondia "5 min por dia" → casava
`/por dia/` no `contestaTotalCargaReal` → escape → loop.

**Fix — o AGENTE conduz a pergunta (padrão saudável da verificação de "usa IA?"), sem forçamento:**
- **Prompt (`buildSavingPrompt`, `orchestrator.ts`):** o bloco "CARGA REAL × GANHO POR ESCALA" foi
  virado de "CONDUZIDA PELO SISTEMA — você NÃO pergunta" para **"VOCÊ conduz — pergunte 1×"**, espelhando
  a verificação de IA (`orchestrator.ts:159`): pergunta UMA vez com `type:"options"` (["fazia o volume
  todo à mão" → carga real=total/escala 0 · "só uma parte" → pergunta curta quanto, convertendo "por dia"
  · "não sei" → ajuda 1x, senão conservador]); confirma plausibilidade (escala >~60%) UMA vez; e — o
  ponto-chave — **aceita a discordância e SEGUE, NUNCA repete** a mesma pergunta (igual ao PASSO 3 da IA,
  onde contradição é registrada e não vira loop).
- **Backend (`chat.functions.ts`):** **removidos** o gate de preview que bloqueava/descartava o preview e
  as branches determinísticas de resposta (`carga_escala` 'pendente'/'confirmar_escala'), mais os helpers
  mortos (`perguntaCargaEscala`, `perguntaConfirmarEscala`, `interpretarConfirmacaoEscala`,
  `nudgeCargaEscala`, `nudgeRecalcularCargaEscala`, `OPCOES_CONFIRMAR_ESCALA`). Em `orchestrator.ts`,
  removidos os predicados que só serviam ao gate (`interpretarCargaReal`, `contestaTotalCargaReal`,
  `precisaConfirmarEscala`, `parseNumeroPtBR`, `LIMITE_ESCALA_ALTA`).
- **Rede de segurança NÃO-bloqueante (`resolverSplitCargaEscala`, `orchestrator.ts`):** como o forçamento
  saiu, o agente pode não capturar o split. Na **gravação** (`submeterParaValidacao` e `resyncGoogle`), se
  o split se aplica ('sim' recorrente com horas) e não veio, o backend assume o **conservador — carga real
  = total, escala 0** ("fazia o volume todo à mão"; nunca infla escala) e preenche
  `horas_carga_real`/`horas_escala`. Mantém as colunas "Saving Horas Real/Escalado" + a justificativa
  preenchidas **sem travar/repetir nada no chat**. O sync reverso horário NÃO passa por aí → **legados
  ociosos ficam como estão** (respeita a decisão 29/06 do 'nao'→0/total e do 'sim'-sem-split→0/0 no
  `derivarSplitHorasSheet`, que **não foi alterado**).

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (bloco do prompt + `resolverSplitCargaEscala`;
remoção dos predicados do gate), `src/lib/chat.functions.ts` (remoção do gate de preview, das branches e
dos helpers; chamada de `resolverSplitCargaEscala` no submit/resync), `src/lib/agents/types.ts`
(`carga_escala`/`carga_escala_racional` viram LEGADO), `src/lib/testes/prompt-registry.ts` (descrição
atualizada), `tests/saving-carga-escala.test.ts` (testes do novo desenho + `resolverSplitCargaEscala`).

**Decisão de design:** a pergunta deixou de ser uma armadilha determinística e passou a ser conduzida pelo
agente como qualquer outra pergunta saudável (opções, uma vez, aceita e segue). A garantia do DADO (não do
diálogo) migrou para uma rede conservadora na gravação — o chat nunca mais trava por causa do split.

---

## 2026-07-03 — Autocomplete de participantes cortado pela borda do card (só ~4 sugestões visíveis)

**PR:** #202 · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/dropdown-participantes-corte`

**Sintoma:** no campo **"E-mails dos participantes"** (Etapa 1, `ParticipantesPapeisInput`), ao digitar um nome genérico como **"Lucas"** a lista de sugestões da TeamGuide fica grande, mas aparecia **cortada** — só ~4 pessoas visíveis, com cara de espremido. A lista rolava internamente, mas o container ficava truncado na borda inferior do formulário.

**Causa-raiz:** o dropdown era `position: absolute` dentro do campo, e o **card central do formulário** (`submeter.tsx`, `<div ref={formCardRef} className="relative overflow-hidden …">`) tem **`overflow-hidden`** — necessário para o slide entre etapas e para arredondar a barra de gradiente do topo. Como o campo de participantes é o **último** da Etapa 1, a lista estourava a borda inferior do card e era **clipada por esse `overflow-hidden` ancestral**, não pela própria `max-h-60`.

**Fix (`src/lib/submeter/form-components.tsx`, `ParticipantesPapeisInput`):** o dropdown passou a ser renderizado num **portal no `<body>`** (`createPortal`) em **`position: fixed`**, ancorado à caixa do input — escapa do `overflow-hidden` e flutua acima de tudo. Um `useEffect` mede a caixa (`getBoundingClientRect`), calcula `left`/`width` e decide **abrir para baixo (padrão) ou para cima** quando não cabe embaixo e há mais espaço acima; `maxHeight` adaptativo (132–288px) conforme o espaço livre na janela, com scroll interno. Reposiciona em `scroll`(capture)/`resize` enquanto aberto. Mantido tudo do resto: estilo GoGroup, realce do termo, navegação por teclado (↑↓/Enter/Esc), `aria-*`, rodapé "Mostrando N de M" e a animação `go-slide-down` (neutralizada pelo global `prefers-reduced-motion`).

**Onde aterrissou:** `src/lib/submeter/form-components.tsx` (só frontend — **sem** rebuild de `worker.js`). Sem novos testes (mudança puramente de layout/posicionamento); `npm run test` (552) e `npm run build` verdes.

---

## 2026-07-02 — LEGADO especial→saving voltava a especial: sync reverso re-forçava `especial=1` da planilha (caso Hugo/legado-038, 2ª recorrência)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `worktree-fix-sync-reverso-legado-especial-conversao`

**Sintoma:** `hugo.santana@gobeaute.com.br` editou o legado **`legado-038` ("Base Custos - Gobeaute")** de **especial → saving**, preencheu o saving completo (6h40/mês, `Especialista+`) e submeteu — mas o projeto **caiu como especial DE NOVO** (pela 2ª vez). No SQLite: `tipos_projeto=['especial']`, `documentacao.saving=null` (a doc especial reconstruída **apagou** o saving). Nos logs, todos os turnos do chat de saving dele registravam `tipos: especial`.

**Causa-raiz:** é a **variante LEGADO** do bug "especial sticky" — o app-fix de 30/06 ([entrada abaixo](#2026-06-30--edição-de-projeto-especial--savingreceita-não-desmarcava-especial-sticky)) funciona, mas **não segura para legados**. `atualizarTipos` zera `especial` no SQLite **no ato** da conversão, porém a célula **"Especial?" da planilha só vira "Não" no SUBMIT**. Entre a conversão e o submit, o **cron horário de sync reverso** (`syncSheetsToSqlite` → `atualizarExistente`, `sync-reverse.ts`) lia a coluna **"Especial?"=Sim** ainda stale e **re-forçava `especial=1`/`tipos_projeto=['especial']`** — atropelando a conversão em andamento. O resto do chat rodava com `especial=1`, o `atualizarMetadados` (ramo especial) reconstruía a doc especial e o saving se perdia. Recorre para **qualquer legado especial editado para saving/receita** que sofra um sync reverso antes de submeter.

**Fix (`sync-reverse.ts`, `atualizarExistente`):** no sentido **"Especial?"=Sim → especial=1**, guardamos com `jaConvertidoParaFinanceiro(current)` — se o SQLite **já tem `tipos_projeto` não-especial** (saving/receita, gravado por `atualizarTipos`), a "Sim" da planilha é tratada como **STALE** e **não re-forçamos** especial (será corrigida para "Não" no próximo submit). O sentido oposto **"Não" → especial=0** (fix da Helen, anti-sticky) segue **aplicado incondicionalmente**. Guard estreito: um SQLite não-financeiro por deriva (`tipos=['especial']`) ainda é reconciliado para especial normalmente.

**Onde aterrissou:** `src/lib/google/sync-reverse.ts` (helper `jaConvertidoParaFinanceiro` + reestrutura do bloco "Especial?"; cobre `syncSheetsToSqlite` **e** `syncOwnerRowsFromSheet`, que reusam `atualizarExistente`). Server-side → `worker.js` rebuildado. Testes: `tests/sync-reverse.test.ts` (+2 — "Sim não clobber conversão financeira" e "guard estreito: Sim ainda re-força quando não-financeiro").

**Recuperação do legado-038 (feita antes do fix, 02/07):** replay do pipeline real (admin+cookie prod) — `atualizar-tipos([saving])` → `iniciar-saving` (linha `Especialista+`, 6h40/mês→0h, mensal, alguém fazia=sim, tudo à mão/escala 0, sem custo evitado/externo, `valor_hora=R$55,15` → **R$367,67/mês**) → gates (composição, jornada=dias úteis) → aprovar preview → `submeter-validacao(edicao)`. Depois `resyncGoogle` (escrita AWAITED do Sheet: "Especial?"=Não + saving) e `sync-sheets-now` (reverse sync manteve `tipos=['saving']`, provando o loop quebrado). Números vieram dos `form_events`/logs (form dizia 10h; ele corrigiu p/ 6h40 no chat — usado o 6h40 final).

**Nota:** trade-off aceito — uma conversão in-app **abandonada** (converteu p/ saving mas nunca submeteu) mantém `saving` no SQLite mesmo com a planilha ainda "Sim"; resolve-se no submit. Alternativa considerada (escrever "Não" no Sheet no ato do `atualizarTipos`, ida awaited) ficou de fora para manter o PR cirúrgico.

---

## 2026-07-02 — Retomada de rascunho despejava o TEXTO BRUTO dos arquivos (`=== arquivo ===`) no chat

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `feat/botao-recomecar-forms`

**Sintoma:** ao **retomar um rascunho** (Meus Projetos › Rascunhos › Continuar) o chat abria com o
**conteúdo cru de um arquivo enviado** despejado como mensagem — ex.: `=== CLAUDE.md === …` (o texto
inteiro de outro projeto usado como upload de teste). Ficava visível ao usuário. Descoberto testando o
novo botão **"Salvar rascunho"** (que redireciona pra home e depois retoma pela lista).

**Causa-raiz:** duas coisas somadas.
1. `getHistoricoMeuProjeto` (`meus-projetos.functions.ts`) devolvia **todas** as `chat_messages` cruas —
   inclusive `role:'doc'` (que guarda o texto concatenado dos arquivos, contexto do LLM montado em
   `extractTextFromMultipleFiles`, `=== nome === …`) e `role:'assistant'` gravado como
   `JSON.stringify(resultado)`. O map do frontend (`submeter.tsx`, caminho **cross-device / sem snapshot
   local**) renderizava tudo sem filtrar nem parsear → bolha com o dump do arquivo (e, nas respostas do
   agente, o JSON cru).
2. O caminho servidor do resume só é usado **quando não há snapshot local** (`loadDraft()` nulo). Antes
   era raro; o novo **"Salvar rascunho"** chama `clearDraft()` (para `/submeter` não retomar o mesmo
   rascunho) e **passou a forçar exatamente esse caminho** — tornando o bug pré-existente fácil de
   reproduzir.

**Fix:**
- **Backend (`getHistoricoMeuProjeto`):** filtra para **só `user`/`assistant`** (a role `'doc'` nunca sai
  do servidor) e, para `assistant`, **parseia o JSON** devolvendo o texto de exibição
  (`content ?? question`) + `options` + flags derivados (`isPreview = type==='preview'`,
  `isComplete = fase==='completo'`, `fase`) — mesma semântica do `formatResponse` da ida.
- **Frontend (`submeter.tsx`, resume cross-device):** lê os novos campos no `ChatMessage`, mantém um
  **filtro defensivo** (só `user`/`assistant`) contra dados legados, e alinha `chatFase`/`chatComplete`
  à última mensagem (senão a conversa retomada ficava presa na fase `doc`).

**Onde aterrissou:** `src/lib/meus-projetos.functions.ts` (`getHistoricoMeuProjeto` — tipo de retorno +
transform) e `src/routes/submeter.tsx` (map do histórico no efeito de mount). Server-side → `worker.js`
rebuildado. Sem mudança em `chat.functions.ts` (a gravação `role:'doc'` continua — é contexto legítimo do
LLM; o fix é **não exibir**).

**Notas:** o bug afeta qualquer retomada sem snapshot local (ex.: outro navegador), não só o novo botão —
o "Salvar rascunho" só o tornou comum. A role `'doc'` segue sendo gravada de propósito (o LLM precisa do
texto); o conserto é puramente de **exibição/serialização ao cliente**.

---

## 2026-07-01 — Gate ≥44h "O que mudou após a automação" era só prompt e escapou (projeto Gostream)

**PR:** _(a abrir)_ · **Status:** 🔜 validar no staging (`edf400b4`) → prod · **Branch:** `fix/gate-alocacao-ganhos`

**Sintoma:** o projeto **Gostream** (`legado-152`, R&S, **150h/mês**, `alguem_fazia='sim'`) fechou o
memorial **sem** que o usuário fosse perguntado pra onde foi o tempo liberado. A Seção 2.4 ("### O que
mudou após a automação") existia no memorial, mas preenchida com **exatamente** o boilerplate que a régua
manda RECUSAR: _"o tempo liberado foi realocado para outras atividades do time de R&S, sem necessidade de
manter essa rotina manual."_ Ninguém no chat viu a pergunta (confirmado puxando o `chat/historico` de prod
com o `E2E_COOKIE`).

**Causa-raiz:** o gate de economia alta (≥44h/mês) era **100% prompt** — o bloco "SEÇÃO 2.4" em
`buildSavingPrompt` + a rede de segurança (LLM-juiz) em `buildSavingPreviewPrompt`. Diferente dos gates de
**jornada**, **teto 220h** e **carga real × escala** (que são DETERMINÍSTICOS no backend e por isso
dispararam), este dependia do LLM obedecer. O LLM **auto-gerou** a seção vaga e previewou sem perguntar; a
rede de segurança do preview (também LLM) deixou passar na aprovação. Resultado: a única família de gate de
horas altas SEM trava determinística falhou silenciosamente.

**Fix (transformar em GATE DETERMINÍSTICO, nos moldes do carga×escala):**
- **Predicado** `aplicaGateAlocacaoGanhos(ctx, saving)` (`orchestrator.ts`): `alguem_fazia==='sim'` **&&**
  `tipo_saving==='mensal'` **&&** (total ≥ `LIMITE_ECONOMIA_ALTA(44)` OU um cargo ≥44h). Contrafactual
  (`'nao'`) e custo evitado puro (`'externo'`) NÃO entram (não houve tempo humano REAL liberado — a Seção
  2.4 ali segue só no prompt, sem bloqueio). Pontual/periódico fora (base ≠ mês).
- **Estado** `saving.alocacao_ganhos` (`null`→`pendente`→`reperguntado`→`ok`) + `alocacao_ganhos_racional`
  (resposta crua do usuário, backend-only, re-mesclada a cada turno). Em `types.ts`/`savingVazio`.
- **Gate em `enviarMensagem` (`chat.functions.ts`):** antes do preview, se a Seção 2.4 do memorial já for
  CONCRETA (`extrairAlocacaoGanhos` + `!respostaAlocacaoVaga`) → libera (`'ok'`); senão **bloqueia** e
  pergunta `perguntaAlocacaoGanhos` ("pra onde foi o tempo? nomeie as atividades / o que entrega a mais").
  No turno de resposta: se vier vaga (`respostaAlocacaoVaga`), **repergunta FIRME 1x** (`'reperguntado'`,
  anti-loop); senão captura o racional e injeta o nudge `[SISTEMA]` (`nudgeAlocacaoGanhos`) p/ o LLM
  escrever a seção a partir do que o usuário disse. Roda por ÚLTIMO (jornada→teto→split→alocação, 1/turno).
- **`respostaAlocacaoVaga(texto)`** (`orchestrator.ts`, puro): heurística CONSERVADORA — só marca vaga se
  curta demais OU bate em padrão vago ("realocado/outras atividades/sobra tempo/produtividade/eficiência")
  **e** não traz nada concreto junto (nº ou destino nomeado via "para/pra …"). Na dúvida, aceita (custo do
  falso-positivo = 1 pergunta a mais; a rede de segurança do preview + validação humana são backstops). NÃO
  é juiz de qualidade — é só o piso p/ forçar UMA reperguntada.

**Onde aterrissou:** `src/lib/agents/types.ts` (2 campos + `savingVazio`); `src/lib/agents/orchestrator.ts`
(`LIMITE_ECONOMIA_ALTA` exportado, `aplicaGateAlocacaoGanhos`, `respostaAlocacaoVaga`); `src/lib/chat.functions.ts`
(helpers `perguntaAlocacaoGanhos`/`…Firme`/`nudgeAlocacaoGanhos` + branches de resposta + re-merge + gate de
preview); `tests/gate-alocacao-ganhos.test.ts` (novo, 14 casos incl. o boilerplate do Gostream);
`tests/agents-types.test.ts` (shape 19→21). `worker.js` rebuildado. **Não muda prompt** (rule 3 N/A) — o
bloco 2.4 do prompt segue igual; o gate é backend. 532 testes verdes.

---

## 2026-07-01 — Favicon some do deploy (upload só varria `dist/assets/*`, não a raiz do `dist/`)

**PR:** _(a abrir)_ · **Status:** ✅ deployada (staging `edf400b4` + prod `674a3710`) · **Branch:** `fix/deploy-favicon-dist-root`

**Sintoma:** o **favicon** (ícone da aba) sumiu do app deployado. `index.html` referencia
`<link rel="icon" href="/favicon.svg">`, mas a aba do navegador ficava sem ícone.

**Causa-raiz (processo de deploy, não código do app):** o Vite copia `public/favicon.svg` para a
**raiz** do `dist/` (`dist/favicon.svg`), **fora** de `dist/assets/`. O runbook de deploy
(`CLAUDE.md` / `docs/deploy.md`) montava o upload e o manifest de assets varrendo **só** `dist/assets/*`
(`for f in dist/assets/*`). Resultado: `favicon.svg` **nunca era enviado nem registrado como asset**.
Com o SPA fallback (`not_found_handling: single-page-application`), `GET /favicon.svg` não encontrado
devolvia o `index.html` (HTML) em vez do SVG → o browser não usava como ícone → **favicon some**.
Confirmado pelo `assetManifest` do app: `/favicon.svg` estava **ausente**.

**Fix ("lista derivada do `dist/` real, nunca à mão"):** novo script `scripts/deploy-godeploy.sh` que
**varre `dist/` recursivamente** (`find dist -type f`) + `worker.js`, faz o upload multipart
(token via header `Authorization: Bearer`, não query param) e **imprime o `ASSETS_JSON`** com TODOS os
arquivos do `dist/` para o `updateApp`. Assim, `favicon.svg` — e qualquer futuro arquivo de `public/`
na raiz do `dist/` (ex.: `robots.txt`) — entra no deploy automaticamente, sem depender de lembrar de
listar. Runbooks (`CLAUDE.md` "Deploy rápido" e `docs/deploy.md`) reescritos para usar o script e alertar
contra varrer só `assets/*`.

**Onde aterrissou:** `scripts/deploy-godeploy.sh` (novo); `docs/deploy.md` e `CLAUDE.md` (seção Deploy
rápido). Validado: `assetManifest` de staging **e** prod agora contêm `/favicon.svg` (654 bytes) — antes
ausente. (Obs.: o edge exige OAuth, então `curl` anônimo em `/favicon.svg` dá 302→login; logado, o
browser recebe o SVG. Sem mudança de código do app — só do processo de deploy.)

---

## 2026-07-01 — Edição de LEGADO "ressuscita" a tela de aprovação final (rascunho local sobrepõe o servidor)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/edit-draft-legado-guard`

**Sintoma:** um legado (`legado-141`, "Regularizações - GoGroup") foi apagado do deploy para a dona
**reauditar do zero**. Ao reabrir `/editar/legado-141`, ela **caía de novo na etapa final de
aprovação** — como se nada tivesse sido apagado. Apagar os registros no servidor não resolvia: ao
reabrir, o estágio voltava.

**Causa-raiz:** no modo edição (`submeter.tsx`), o seed do servidor (`applySeed`) era **sobreposto
INCONDICIONALMENTE** por `rehydrateFromLocal(editDraft)` — o rascunho de edição salvo no
**localStorage do navegador** (`godocs:edicao-v1:<id>`), que guarda chat/fase/previews do ponto onde
a pessoa parou. Como o id do legado é fixo, qualquer limpeza no servidor era irrelevante: o navegador
recolocava o estágio final por cima. O fluxo de **retomar rascunho** já fazia o certo
(`submeter.tsx`: se `status !== 'rascunho'` → `clearDraft()`), mas o de **edição** não tinha guard.
Mesma família do 🐞 bug aberto "Documentação ainda não foi gerada": cliente afirmando um estágio
(`chatComplete`/`docPronta`) que o servidor nunca persistiu (legado entra por sync reverso **sem** a
linha `documentacao`, que só é gravada na aprovação do preview).

**Fix ("servidor manda"):** `deveDescartarDraftEdicao` (`draft-storage.ts`, puro/testável) — ao abrir
a edição, só reidrata o rascunho local se for **consistente** com o servidor. Se o rascunho diz que a
fase de doc terminou (`chatComplete` **ou** `approvedDocPreview != null`) mas o servidor **não tem doc
persistida** (`data.documentacao == null`), **descarta** o rascunho (`clearDraft`) em vez de reidratar.
Com o chat vazio, o caminho de re-init já existente dispara `atualizar-metadados` com `reset_doc:true`,
que faz `deleteChatMessagesByProjeto` (limpa o chat no servidor) e recomeça a auditoria **do zero** —
tudo **por código**, sem ação no navegador do usuário e sem cirurgia manual de dados. NÃO descarta
rascunhos legítimos: quem está no meio da fase de doc (sem preview aprovado) e edições de projetos que
JÁ têm doc no servidor são preservados.

**Onde aterrissou:** `src/lib/submeter/draft-storage.ts` (`deveDescartarDraftEdicao`);
`src/routes/submeter.tsx` (guard no branch de edição, antes de `rehydrateFromLocal`);
`tests/draft-storage.test.ts` (4 casos: descarta chatComplete/preview sem doc no servidor; preserva
reenvio normal e meio-de-doc). Mitiga também o caminho de rascunho do 🐞 bug aberto do legado
(o endurecimento **servidor** — `submeterParaValidacao` virar 4xx claro em vez de 500 — segue pendente).

---

## 2026-07-01 — Investigador sem NENHUM projeto visível — `/edicoes` estourando o limite de 32 MiB de RPC

**PR:** _(a abrir)_ · **Status:** 🔧 implementada (pendente validação no staging) · **Branch:** `fix/investigador-edicoes-rpc-limit`

**Sintoma:** o painel **Investigador** (admin) não mostrava **nenhum** projeto — abas Submetidos e
Abandonados vazias ("Nenhum projeto encontrado"), mesmo com projetos existindo. Nos logs de produção,
o endpoint `GET /api/admin/investigador/edicoes` logava, em **toda** requisição:
`[worker] GET /api/admin/investigador/edicoes: Serialized RPC arguments or return values are limited to
32MiB, but the size of this value was: 35088590 bytes.` (**35 MB** contra o teto de 32 MiB). O endpoint
`/projetos` em si respondia **200 OK** (15× no log) — ou seja, os dados existiam e a query de projetos
funcionava.

**Causa-raiz (dois problemas encadeados):**
1. **Servidor** — `getAllReenvios` (`client.server.ts`) fazia `SELECT v.*` de `projeto_versions`,
   trazendo os blobs **`snapshot_chat`** (conversa congelada inteira de cada reenvio), `snapshot_projeto`
   e `snapshot_doc` de **todos** os reenvios pela fronteira RPC do banco async do Godeploy. A soma
   estourava os 32 MiB → a chamada lançava → `/edicoes` falhava. `getEdicoesInvestigador` só usava esses
   blobs para **contar mensagens** (total/usuário/IA) e ler **`status`/`ganho_total_mensal`** — nunca
   devolvia os blobs em si. `snapshot_doc` não era usado para nada.
2. **Frontend** — `fetchData` (`investigador.tsx`) buscava `/projetos`, `/stats` e `/edicoes` num único
   `Promise.all`. Quando `/edicoes` rejeitava, o `Promise.all` inteiro rejeitava **antes** de qualquer
   `setProjetos`, o `catch {}` engolia o erro em silêncio e `projetos` ficava `[]` → **toda** a tela
   aparecia vazia por causa de **um** endpoint quebrado.

**Fix (determinístico, sem migração/coluna nova):**
1. **`getAllReenvios` para de trafegar os blobs** — troca `SELECT v.*` por colunas escalares +
   agregações no próprio SQL: contagens de mensagem via `json_each(COALESCE(snapshot_chat,'[]'))`
   (guarda o NULL das versões antigas → conta 0 sem erro) e `status`/`ganho_total_mensal` via
   `json_extract(snapshot_projeto, …)`. `snapshot_doc` sai de vez. Payload passa a ser só escalar
   (KB, não MB). `getEdicoesInvestigador` consome `msg_total`/`msg_user`/`msg_ia`/`snap_status`/
   `snap_ganho` (não parseia mais snapshot).
2. **`fetchData` usa `Promise.allSettled`** — cada endpoint popula seu estado independentemente; a
   falha de um não zera os outros (defesa em profundidade — se `/edicoes` voltar a crescer, Submetidos/
   Abandonados continuam aparecendo).

**Onde aterrissou:**
- `src/integrations/db/client.server.ts` — `getAllReenvios` reescrita (colunas escalares + `json_each`/
  `json_extract`; novo tipo de retorno, sem `snapshot_*` crus).
- `src/lib/investigador.functions.ts` — `getEdicoesInvestigador` consome os campos agregados.
- `src/routes/_authenticated/investigador.tsx` — `fetchData`: `Promise.all` → `Promise.allSettled`.
- `worker.js` rebuildado. Sem teste unitário novo (não há cobertura de `getAllReenvios`); SQL validado à
  parte contra `better-sqlite3` (contagens + `snapshot_chat` NULL). Os 504 testes seguem verdes.

**Notas / não-regressão:** as contagens `json_each`/`json_extract` foram conferidas no engine de dev
(better-sqlite3) — json1 é padrão e o D1/GoDeployDB também suporta; **validar no staging** (`edf400b4`)
antes de prod (regra 13) confirma o suporte no engine de produção.

---

## 2026-07-01 — Custo evitado e custo do projeto PONTUAIS deixam de ser mensalizados ÷12 (entram pelo valor CHEIO)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/custos-pontuais-valor-cheio`

**Natureza:** decisão de produto (não é bug de código). **Reverte deliberadamente** a "Exceção: custo evitado
pontual é mensalizado ÷12" que constava no `CLAUDE.md` e foi entregue com a F3 (`SPEC_FEATURES_NOVAS.md`).
Não é conserto por engano de uma decisão fechada — é uma mudança de regra pedida pela gestão.

**Sintoma/pedido:** o **custo evitado pontual** (e, por tabela, o **custo do projeto pontual**) era dividido por
12 antes de somar/abater no saving — divergindo de saving e receita pontuais, que sempre entraram pelo **valor
cheio**. A gestão pediu para **remover a divisão** e tratar o pontual igual aos demais (valor cheio).

**Causa (comportamento anterior):** a mensalização `recorrencia === 'pontual' ? valor / 12 : valor` vivia em
**4 lugares**: `custoEvitadoMensalFromItens` (`saving-calc.ts`, fonte da verdade no submit/resync),
`custoProjetoMensalFromItens` (delega ao anterior) e **inline** no `iniciarSaving` (`chat.functions.ts`, 2×:
custo evitado e custo do projeto, na persistência ao entrar na fase de saving).

**Fix:** removida a divisão por 12 nos 4 pontos — pontual passa a somar `it.valor` cheio, igual a mensal. A
recorrência marcada (mensal/pontual) continua persistida e exibida como **rótulo** ("Custo Mensal ou Pontual"),
mas **não altera mais o valor**. `recomputarSavingFinanceiro` já usava `custo_evitado_reais` cheio (não mudou).
**Fora de escopo (não tocado):** custo externo ANUAL (`custoPeriodicidade === 'anual'`, `submeter.tsx`) segue
÷12 (conversão anual→mensal, legítima); trimestral/semestral seguem valor cheio do período.

**Onde aterrissou:** `src/lib/agents/saving-calc.ts` (`custoEvitadoMensalFromItens` + comentários de
`custoProjetoMensalFromItens`/`recomputarSavingFinanceiro`), `src/lib/chat.functions.ts` (`iniciarSaving`, 2
somas inline + comentários), comentários em `src/integrations/db/schema.ts` e `src/lib/agents/types.ts`,
testes `tests/saving-calc.test.ts` (asserções pontuais atualizadas: 6000→6000, 1200→1200, mistos recalculados),
docs (`CLAUDE.md`, `docs/business-rules.md`, `docs/database.md`). `worker.js` **rebuildado** (mexeu em
server-side).

**Retroativo (backfill) — `POST /api/admin/retroativo-custos-pontuais`** (`retroativoCustosPontuais`,
`chat.functions.ts`, requireAdmin). Corrige projetos já preenchidos com o ÷12. Body `{dry?:boolean}` — **dry
default TRUE** (só relata `{projetos, flagged, metodo}`; `dry:false` aplica). Idempotente. NÃO reusa
`resyncGoogle`/`syncSubmitToGoogle` (dispararia 1 notificação Chat por projeto = spam em prod); escreve direto
via `updateRowByProjectId` (batch parcial, sem Chat). Dois caminhos:
- **CASO A** — submetido pelo app (tem `custo_evitado_itens`/`custo_projeto_itens`): re-deriva dos itens (cheio)
  + `recomputarSavingFinanceiro` (exato); atualiza doc.saving + colunas SQLite + Sheet (Custo Evitado, Custo do
  Projeto, Saving Reais, Ganho Total, Memorial de Saving, Atualizado Em).
- **CASO B** — legado sem itens (só via sync do Sheet, sem doc.saving), custo evitado PONTUAL PURO (0h,
  `alguem_fazia='externo'`, sem custo externo/projeto → `saving_reais == custo evitado ÷12`): recupera o valor
  original da justificativa `R$ X (pontual)` (método 1) ou fallback `×12` (só puro). Legado pontual NÃO-puro ou
  com custo do projeto pontual → `flagged` (revisão manual — não arrisca isolar).
- Invocação: edge exige OAuth → precisa de cookie de sessão do ambiente (staging tem sessão própria; prod usa
  `E2E_COOKIE` de `godocs.devgogroup.com`).

**Validação staging (`edf400b4`):** retroativo aplicado — 2 legados corrigidos via justificativa
(`legado-100` 264,33→3171,96; `legado-149` 19,52→234,19), 0 flagged, idempotente (re-run = 0 afetados).

---

## 2026-06-30 — Submissão/edição trava com `ZodError` `docs[].base64 too_small` quando há arquivo VAZIO (0 bytes)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/arquivo-vazio-base64-submissao`

**Sintoma:** ao **Enviar Projeto** (reportado num projeto **especial** em edição), toast vermelho cru:
`Erro ao enviar projeto: [ { "code": "too_small", "minimum": 1, "type": "string", "message":
"String must contain at least 1 character(s)", "path": [ "docs", 18, "base64" ] } ]`. A pessoa fica presa.
Confirmado em produção com **Mário Gonzaga Monteiro** (projeto "Prazo Otimizado", reenvio de edição).
O índice (`docs[18]`) varia conforme a posição do arquivo problemático.

**Causa-raiz:** um dos arquivos enviados tinha **0 bytes** (vazio — ex.: `__init__.py`, `.gitkeep`,
config em branco, que é comum ao reenviar a **pasta inteira** do projeto). Para arquivo vazio,
`readFileAsBase64` (`submeter/constants.ts`) faz `result.split(",")[1]` sobre `"data:...;base64,"` →
retorna **`""`**. O backend valida cada doc com `z.object({ base64: z.string().min(1), ... })`
(`chat.functions.ts`, schemas de `iniciar-submissao` **e** `atualizar-metadados`) → o base64 vazio
**reprova o payload inteiro** (não só aquele arquivo) com `ZodError` → toast cru. O `addFiles` do
`step2.tsx` validava extensão, tamanho-máximo, duplicidade e pastas ignoradas, **mas nunca o piso de
tamanho** — arquivo de 0 bytes era aceito normalmente. Atinge submissão nova **e** edição (todos os
caminhos montavam `docs` do mesmo jeito).

**Fix — 2 camadas (causa-raiz + rede de segurança):**
1. **`step2.tsx` (`addFiles`) barra arquivos de 0 bytes na seleção** — ramo `file.size === 0` na cadeia de
   rejeição (junto de "sem extensão"/"formato"/"excede MB"), com contador `emptyCount`, log e
   **toast informativo** (`"N arquivo(s) vazio(s) (0 bytes) ignorado(s) — sem conteúdo para documentar"`).
   Arquivo vazio não tem conteúdo a documentar → descartá-lo não perde nada. É o ponto onde os arquivos
   entram em `arquivos` (única fonte do estado).
2. **`constants.ts` — `filesToDocs(files)` + `descartarDocsVazios(docs)`** (rede de segurança): centralizam a
   montagem do payload `docs` e **filtram qualquer `base64 ""` remanescente** antes de enviar. Os 4 call-sites
   de `submeter.tsx` (`handleIniciarAgente`, `handleEnviarEspecial` criação **e** edição,
   `reprocessarComNovosArquivos`) passaram a usar `filesToDocs` (DRY + garantia uniforme). No ramo de edição
   especial, `docs` vira `[]` quando não sobra nada → cai no `reset_doc` (reusa os arquivos já enviados, sem
   reupload), preservando o comportamento. `readFileAsBase64` também ganhou `?? ""` (defensivo) no split.

O backend permanece estrito (`base64.min(1)` é guard correto) — o conserto é client-side, para nunca
**enviar** um doc vazio.

**Onde aterrissou:** `src/lib/submeter/step2.tsx` (rejeição de 0 bytes), `src/lib/submeter/constants.ts`
(`filesToDocs`/`descartarDocsVazios` + `?? ""`), `src/routes/submeter.tsx` (import + 4 call-sites usam
`filesToDocs`), teste de regressão `tests/docs-vazios.test.ts` (`descartarDocsVazios`). `worker.js` não muda
(funções client-side, tree-shaken do bundle do worker — `areas.functions.ts` só importa `AREAS`).

**Recuperação (não-código):** nenhuma. Os dados do projeto do Mário estão intactos (a submissão só não
completou); após o deploy, ao reenviar a pasta o arquivo vazio é descartado automaticamente e a submissão
conclui. Não há backfill.

---

## 2026-06-30 — Edição de projeto ESPECIAL → saving/receita não desmarcava `especial` (flag sticky de mão única)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/edicao-especial-vira-normal`

**Sintoma:** pessoas editavam um projeto submetido como **especial**, trocavam para **saving operacional**
(ou receita), passavam por todo o fluxo e reenviavam — mas o projeto **voltava como especial**: a coluna
**"Especial?" do Sheets continuava "Sim"** e internamente seguia `especial=1`. Confirmado em produção com
`hugo.santana@gobeaute.com.br` (`legado-038`) e `oscar.filho@gocase.com` (`3d27a2e3…`). Log do Hugo:
`16:20:52 atualizar-tipos → saving` e 3 s depois `atualizarMetadados` logando *"Projeto especial
legado-038: doc reconstruída sem IA, pronto para reenvio"* — o backend ignorou a troca, rodou o chat
inteiro como `tipos: especial`, e o analyzer recebeu só ~900 chars de contexto (o memorial de saving do
Hugo **não foi capturado**; o do Oscar, com ~8000 chars, provavelmente persistiu, só preso na flag).

**Causa-raiz:** a flag `especial` era **sticky de mão única** — havia caminhos que a marcavam `true`, mas
**nenhum** que a voltasse a `false` numa edição. Dois pontos somavam:
1. **`atualizarTipos` (`chat.functions.ts`)** gravava `tipos_projeto`/`tipo_projeto` ao trocar para
   saving/receita, mas **não tocava em `especial`** → o projeto seguia `especial=1`.
2. **`atualizarMetadados` (`chat.functions.ts`)** fazia `ehEspecial = data.especial === true ||
   ctxData?.especial === 1`. Como o banco ainda dizia `especial=1`, ele **re-forçava
   `especial=true`/`tipo_projeto='especial'`/`tipos_projeto=['especial']`, reconstruía a doc especial sem
   IA e dava `return` antecipado** — ignorando a conversão e pulando a coleta de saving. O frontend
   (`submeter.tsx`) ainda mandava `especial: true` fixo (handler especial) ou **nada** (fluxo normal),
   então o backend nunca recebia o sinal de "deixou de ser especial". No submit, o status e a coluna
   "Especial?" derivam de `projeto.especial === 1` → subia "Sim".

**Fix — 3 camadas (à prova de ordem de chamada):**
1. **`atualizarTipos` zera `especial`** ao escolher um tipo financeiro (escolher saving/receita = não-especial):
   `updateProjeto(..., { tipos_projeto, tipo_projeto: tipos[0], especial: false })`. É o ponto onde o
   usuário declara a natureza do impacto.
2. **`atualizarMetadados` respeita `especial: false` EXPLÍCITO** — quebra a stickiness do `ctxData`:
   `ehEspecial = data.especial === true || (data.especial !== false && ctxData?.especial === 1)`; e quando
   `data.especial === false && ctxData?.especial === 1`, zera a flag no banco (belt-and-suspenders com a
   camada 1, cobre a ordem em que metadados chega antes da troca de tipos). `especial === undefined`
   preserva o comportamento antigo (chamadas internas/cron, legado→especial).
3. **Frontend (`submeter.tsx`)** passa `especial: form.especial` em **todas** as chamadas de edição de
   `atualizar-metadados` (antes umas mandavam `true` fixo, outras nada). `false` = sinal de conversão.

Além da flag, a conversão **limpa `contexto_especial`** (`= null`) nos dois pontos (`atualizarTipos` e o ramo
de conversão de `atualizarMetadados`): o contexto especial não descreve mais o projeto. Como a coluna
**"Contexto do Projeto Especial"** (`sync.ts:254`) é `ouTraco(p.projeto.contexto_especial)`, zerar o campo a
faz virar **"—"** — edição fidedigna ao novo tipo. _(reportado após o fix inicial: o `Especial?` virava "Não"
mas o contexto antigo sobrevivia na coluna.)_

Como a coluna "Especial?" (`sync.ts`) deriva de `projeto.especial`, zerar a flag no banco + re-sync de
IDA já reflete **"Não"** no Sheets — sem alteração no mapeamento.

**Onde aterrissou:** `src/lib/chat.functions.ts` (`atualizarTipos`, `atualizarMetadados`),
`src/routes/submeter.tsx` (5 call-sites de `especial:`), teste de regressão em
`tests/atualizar-metadados-especial.test.ts` (atualizarTipos zera especial; atualizarMetadados com
`especial:false` converte sem reconstruir a doc especial).

**Recuperação (não-código):** Hugo (`legado-038`) e Oscar (`3d27a2e3…`) — flag a destravar e, no caso do
Hugo, memorial de saving a reconstruir do timeline (`chat_messages`/`form_events`/`snapshot_chat`). Sem
backfill geral; só os dois casos reportados (decisão do dono).

---

## 2026-06-30 — Agente "delirando": repete a MESMA pergunta da carga real (loop no gate de saving)

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/loop-carga-real-contestacao-total`

**Sintoma:** vários clientes relataram, na **validação de saving**, o agente "delirando" e repetindo
**verbatim** a mesma pergunta do split carga real × escala. Caso da captura: total calculado em
`0.5h/mês` (a partir de "5 min por dia para cada colaborador"); o gate pergunta "dessas **0.5h/mês**,
quantas a pessoa realmente fazia à mão?"; o usuário responde **"eu disse que era 5min por dia pra cada
colaborador. isso não é 0.5h por mês"** (corrigindo o TOTAL) → o agente repete a pergunta IDÊNTICA.
Usuário preso, sem saída. Recorrência de um problema "já resolvido" antes.

**Causa-raiz (duas, somadas):**
1. **O gate determinístico não tinha saída para CONTESTAÇÃO do total.** Na branch
   `carga_escala === 'pendente'` (`chat.functions.ts`/`enviarMensagem`), quando
   `interpretarCargaReal` devolve `null`, o backend **re-perguntava a mesma coisa SEM chamar o
   orquestrador**. A correção do usuário (que dizia que o *total* 0.5h estava errado, não a carga
   real) nunca chegava ao LLM que poderia recalcular → loop infinito.
2. **`interpretarCargaReal` destruía decimais** (`orchestrator.ts`): `.replace(/\./g, '')` tratava
   todo `.` como separador de milhar, então `"0.5"` → `"05"` → `5`, `"1.83"` → `183`. O próprio
   agente EXIBE "0.5h/mês" com ponto — qualquer resposta com decimal já entrava quebrada (virava
   `> total` → `null` → re-pergunta).

**Fix:**
- **(A) Parser pt-BR robusto `parseNumeroPtBR`** (`orchestrator.ts`, exportado/testável): `,` sempre
  decimal; `.` decimal por padrão (`0.5`→0.5, `1.83`→1.83), só vira milhar quando inequívoco (vários
  pontos, ou 1 ponto com exatamente 3 dígitos e inteiro ≠ 0 → `1.234`→1234). Usado em
  `interpretarCargaReal`.
- **(B) Escape do loop** (`chat.functions.ts`, branch do gate): novo predicado puro
  `contestaTotalCargaReal` (valor "por dia"/"por execução"/min/seg, correção explícita "está
  errado"/"não é isso", ou nº claramente acima do total) — com **precedência** sobre
  `interpretarCargaReal`. Quando o usuário contesta (ou não dá nº usável), o backend **reseta o estado
  do gate** (`carga_escala=null`, zera `horas_carga_real/escala`), injeta o nudge `[SISTEMA]`
  **`nudgeRecalcularCargaEscala`** (manda o LLM RECALCULAR o total a partir do que o usuário
  descreveu — ex.: min/dia × dias úteis × nº de pessoas — ou ajudar a quantificar) e **devolve o
  controle ao orquestrador** em vez de repetir a pergunta. A garantia do split não se perde: o **gate
  de preview** (mais abaixo, `carga_escala !== 'ok'`) reconduz a pergunta com o total já corrigido.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (`parseNumeroPtBR`, `contestaTotalCargaReal`,
`interpretarCargaReal`), `src/lib/chat.functions.ts` (branch `carga_escala==='pendente'` +
`nudgeRecalcularCargaEscala`), `tests/saving-carga-escala.test.ts` (decimais, parser, contestação).

**Decisão de design:** o gate determinístico continua GARANTINDO que o split seja perguntado (via gate
de preview), mas deixou de ser uma armadilha — quando o usuário discorda do número, o LLM volta ao
comando para recalcular. Não há loop infinito possível: contestação/resposta-sem-nº sempre escala
para o orquestrador; a captura determinística só ocorre quando há um nº de carga real plausível.

---

## 2026-06-30 — "Tipo de Receita" (e "Tipo de Saving") em branco no Sheets — erosão de `tipo_saving` pelo echo do LLM

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `fix/tipo-receita-preserva-form`

**Sintoma:** projeto `legado-260` ("Ticketsense gocase", linha 234 da planilha), editado como
saving **e** receita, salvou com a coluna **"Tipo de Receita" = "—"** (em branco). Na auditoria, o
`documentacao.conteudo.receita` estava `{ "valor_ganho_mensal": 1489.5, "tipo": "mensal",
"memorial_calculo": "## Memorial de Saving ..." }` — periodicidade na chave errada (`tipo` em vez de
`tipo_saving`) e a receita poluída com dados de saving (ver "Nota" abaixo).

**Causa-raiz:** `tipo_saving` (a periodicidade mensal/pontual/tri/semestral) é uma escolha do
**formulário** (definida em `iniciarSaving`/`iniciarReceita`), não algo que o LLM colete. Mas o
orquestrador (`orchestrator.ts`, parse do resultado) fazia `receita: (parsed.receita) ?? receita` —
**adotava o objeto ecoado pelo LLM inteiro**. O LLM frequentemente (a) **omite** `tipo_saving` no
echo, (b) devolve a receita como `{}`, ou (c) usa a chave legada `tipo`. Em qualquer caso
`tipo_saving` virava `undefined/null`, e como `extrairEstado` lê sempre a **última** mensagem do
assistant, o null **se propagava** por todos os turnos seguintes até o `complete` → `doc.receita`
(`chat.functions.ts:1311`) → submit → coluna "Tipo de Receita" vazia. O `saving.tipo_saving` tinha a
**mesma** vulnerabilidade (linha gêmea), só não aparecia tanto porque o prompt de saving ecoa o campo
com mais disciplina.

**Fix:** no `orchestrator.ts`, ao montar o `result`, `tipo_saving` deixa de vir do echo do LLM e passa
a ser **preservado do estado de entrada (form = fonte da verdade)** para saving e receita:
`tipo_saving: <entrada>.tipo_saving ?? <echo>.tipo_saving ?? <alias tipo do echo> ?? null`. Como a
preservação roda em **todo** turno do orquestrador (chamado por `iniciarReceita`/`iniciarSaving`/
`enviarMensagem`), o valor do form nunca mais é zerado por um echo desleixado, e o caso `{}` também
fica coberto (cai no valor de entrada). O alias `tipo` é rede de último recurso para estados já
erodidos. Determinístico, sem depender do prompt.

Além da erosão de `tipo_saving`, o `legado-260` revelou um problema **de produto** maior: o usuário
**não foi barrado** ao submeter como receita mesmo depois de o agente concluir que era saving. No chat,
o agente questionou os R$15 mil de receita (potencial não comprovado), o usuário concordou e pediu para
reclassificar como saving — mas isso aconteceu **dentro da fase de receita**: o agente coletou o saving
ali mesmo (1h30/dia → R$1.489,50) e completou, gravando um **"## Memorial de Saving" no slot de
receita**. Não havia gate determinístico (a) forçando a reclassificação nem (b) checando a completude
da receita antes do submit (o gate de "ganho zero" não pegou porque havia valor e o saving já deixava o
total positivo). Resultado: dado pela metade + saving disfarçado de receita.

**Fix — 3 camadas (todas determinísticas, no padrão dos gates de saving):**
1. **`tipo_saving` preservado do form** (`orchestrator.ts`, montagem do `result` em `runOrchestrator`):
   deixa de vir do echo do LLM — `tipo_saving: <entrada>.tipo_saving ?? <echo>.tipo_saving ??
   <alias tipo do echo> ?? null`, para saving e receita. Roda em **todo** turno (chamado por
   `iniciarReceita`/`iniciarSaving`/`enviarMensagem`), então o form nunca mais é zerado por um echo
   desleixado, e o caso `{}` fica coberto. Alias `tipo` = rede para estados já erodidos.
2. **Backstop de reclassificação no chat** (`enviarMensagem`): predicado puro `receitaMemorialEhSaving`
   (`orchestrator.ts`) detecta um memorial salvo no slot de receita que é saving / "não aplicável" /
   "reclassificado como saving". Quando bate, o backend **bloqueia o preview/complete da receita**,
   zera o memorial saving-shaped e devolve uma pergunta-guia (`MSG_RECLASSIFICAR_RECEITA`) mandando
   trocar o tipo do projeto para Saving — mantendo a fase em `receita`. Prompt sozinho não segurava.
3. **Gate de completude no submit** (`submeterParaValidacao`): projeto `receita_incremental` só submete
   com `valor_ganho_mensal > 0` **+** `tipo_saving` preenchido **+** memorial de receita não-vazio e
   não saving-shaped (mesmo predicado). Rede determinística final.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (preservação de `tipo_saving` no `result`;
predicado `receitaMemorialEhSaving`); `src/lib/agents/chat.functions.ts` (backstop em `enviarMensagem`;
gate de completude em `submeterParaValidacao`; const `MSG_RECLASSIFICAR_RECEITA`); testes em
`tests/orchestrator-prompts.test.ts` (4 — preservação de `tipo_saving`) e `tests/receita-memorial-saving.test.ts`
(6 — o predicado); `worker.js` rebuildado.

**Pendente (decisão de produto, fora deste fix):** a **correção retroativa da linha 234** do `legado-260`
no Sheets (a receita lá é um saving deslocado — periodicidade do form = mensal). Aguarda decisão da
equipe na validação (o projeto está "Pendente").

---

## 2026-06-29 — Gate de complexidade por IA (`tem_ia_como_funcionalidade`) MORTO em produção

**PR:** _(a abrir)_ · **Status:** 🔧 implementada · **Branch:** `docs/spec-complexidade-autonomia`

**Sintoma:** o gate determinístico documentado — "a resposta explícita do usuário sobre IA como
funcionalidade tem PRECEDÊNCIA sobre o `usa_ia` inferido pelo LLM" — **nunca disparava**. Na prática,
quem classificava a complexidade era **só** o `usa_ia` inferido; a resposta do usuário não tinha efeito.
Achado durante a revisão da redefinição de autonomia (ver [SPEC_COMPLEXIDADE_NIVEIS.md](SPEC_COMPLEXIDADE_NIVEIS.md), G0).

**Causa-raiz:** o sinal `tem_ia_como_funcionalidade` é coletado na fase *doc* e vive em `coletado`
(estado do orquestrador / JSON do `chat_messages`). Mas, na aprovação da doc, `compilarDocumentacao`
gera um `DocumentacaoGerada` cujo schema **não inclui** esse campo, e `upsertDocumentacao` persiste só
esse objeto. O analisador lê `documentacao.conteudo` (`getDocumentacao`, um `SELECT *` puro) — então
`conteudo.tem_ia_como_funcionalidade` chegava sempre `undefined → null`, e os gates de precedência
(`analyzer.ts`) eram código morto. Os testes só checavam string do prompt — nunca exercitavam o gate
com `conteudo` persistido real, então o bug passou batido.

**Fix:** em `chat.functions.ts`, na transição `doc_preview → saving/receita`, o `tem_ia_como_funcionalidade`
de `resultado.coletado` é carregado para o objeto persistido via `upsertDocumentacao` (spread sobre a
doc compilada). O merge da fase `completo` relê o `conteudo` já com o sinal e o preserva. Edições passam
pelo mesmo caminho. Legados/especiais (sem coleta) seguem `null` → inferência do LLM (retrocompat).

**Onde aterrissou:** `src/lib/chat.functions.ts` (upsert da doc aprovada). Cobertura indireta pelos
testes de `normalizarComplexidade` (precedência do `tem_ia` sobre `usa_ia`) em `tests/analyzer-complexidade.test.ts`.

---

## 2026-06-29 — "Saving Horas Escalado" sempre 0 p/ contrafactual + zeros ambíguos + splits inválidos

**PR:** _(a abrir)_ · **Status:** 🔧 implementada, em revisão · **Branch:** `fix/split-nao-contrafactual`

### Parte B — auditoria dos splits capturados: números inválidos / mal classificados

**Sintoma:** o chefe achou estranhos alguns valores de Real/Escalado **já preenchidos**. Auditei as
**26 linhas com split capturado** na planilha de produção.

**Achados:** a soma `Real+Escalado = Total` bate em todas (sem erro aritmético); o problema é
**semântico**, concentrado em **Escalado > 0** (quando o agente tenta *dividir*):
- 🔴 **`f4dd86…`** (`107.8h · real=108.2 · esc=0`): **carga real MAIOR que o total** (impossível) +
  conta errada no texto (49+73,6 ≠ 108,2). Caso "fez tudo" → real deve ser ≤ total. **Erro de número.**
- 🟠 **`legado-189`** (`22h · real=22 · esc=0`): os **números já estavam certos** (fez o volume todo),
  mas a **justificativa narrava** *"~1h por dia → 1h real / 21h escala"* — **inconsistência texto × número**
  por confusão dia × mês no raciocínio do agente. Justificativa corrigida; números mantidos.
- 🟡 **`legado-231`** (1/10) e **`faff95…`** (6/26): escala 91%/81% mal fundamentada (questionáveis,
  deixados p/ o time confirmar).
- ✅ Os 13 casos `'sim'` com escala 0 (fez o volume todo) e os 6 `'nao'` (100% escala) estão corretos.

**Causa-raiz:** o gate aceitava o nº da carga real **sem validar** e derivava `escala = total − real`
mecanicamente. Sem checagem de plausibilidade, "1h/dia" virava real=1 (escala fantasma); e o caminho
"split capturado pelo LLM" aceitava `real > total` (só conferia a SOMA, com tolerância 1h).

**Fix (trava de plausibilidade — "corrigir o agente que classifica errado"):**
- **`precisaConfirmarEscala(real,total)`** (`orchestrator.ts`, `LIMITE_ESCALA_ALTA=0.6`): escala ≥60%
  do total → exige **confirmação** (novo estado `carga_escala='confirmar_escala'`). 3 opções:
  confirma a escala / "fazia o volume todo" (→ real=total) / "corrigir" (reabre a pergunta).
- **Clamp `real ≤ total`** no caminho LLM-capturado (re-deriva a escala) → mata o `real>total`.
- **Pergunta da carga real reforça "total no MÊS, não por dia"** (`perguntaCargaEscala`).
- Pega `189` (escala 95% → confirma/corrige), `f4dd86` (clamp), e sinaliza `231`/`faff95`.

**Dados existentes:** os 2 erros claros (`legado-189`, `f4dd86`) foram corrigidos direto na planilha
para `real=total / escala=0` (colunas de transparência — não afeta R$). Durável quando reeditados
pós-deploy. Os 2 questionáveis ficaram p/ revisão do time RPA.

### Parte A — contrafactual ('nao') gravava 0/0 + zeros ambíguos

**Sintoma (relatado pela gestão):** o chefe estranhou a **veracidade** das colunas "Saving Horas
Real"/"Saving Horas Escalado". Dois pontos: (1) projetos onde **ninguém fazia** (`alguem_fazia='nao'`)
não tinham as horas contadas como escala; (2) **muitos** projetos com `alguem_fazia='sim'` saíam com
**Escalado=0** — parecia que a feature não media nada.

**Diagnóstico (planilha de produção, 298 linhas, fora E2E):**
- 213 linhas (71%) são **legado** com "Alguém Fazia?" vazio → split `0/0` (nunca passou pelo gate).
- `'sim'` (63): **60 com Escalado 0/null**. Destes, ~19 são **zeros legítimos** (a pessoa fazia o
  volume TODO à mão → escala 0 correta) e ~43 têm **AMBOS null** = split **nunca capturado** (legado
  + submissões pré-feature de 19–24/06). Para submissões **novas (25/06+) o gate captura** o split
  corretamente — a feature em si é confiável para o fluxo novo.
- `'nao'`/`'não'` (22): real sempre 0; **~6 linhas com Escalado=total** e justificativa manual
  ("Como Alguém Fazia=Não, todo o saving é escala") — **incoerente com o código**, que força 0 para
  `'nao'`. Eram preenchimentos manuais compensando a ausência da regra.

**Causa-raiz:** (a) **Coerência do `'nao'`** — `temSplit` em `sync.ts` exigia `alguem_fazia==='sim'`,
então contrafactual gravava `0/0`. Mas, por definição, **ninguém fazia à mão ⇒ carga real 0 e 100%
do saving é ganho por escala** → o esperado é `Real=0, Escalado=total`. (b) **Zeros ambíguos** — a
coluna numérica colapsa três situações no mesmo `0`: "sem escala" (real=total, legítimo), "não medido"
(legado/pré-feature, null→0) e contrafactual. Só a coluna de justificativa (vazia nos não-medidos)
desambiguava.

**Fix:** regra do `'nao'` virou **derivação determinística** (decisão de produto, Luis 29/06/2026:
`'nao'` → 100% escala). Helper puro `derivarSplitHorasSheet(alguemFazia, saving)` em `sync.ts`:
`'sim'` usa o split capturado pelo gate; **`'nao'` → `Real=0, Escalado=total`**; `'externo'`/legado-
sem-split/pontual → `0/0` (sem dado medido, não inventa). Roda em `syncSubmitToGoogle`, que é o
caminho de **submissão nova E de edição/resync** → vale **daqui pra frente** sem backfill (zeros
antigos só mudam quando o projeto for editado — decisão do dono). A justificativa do `'nao'` ganhou
fallback próprio em `derivarJustificativaCargaEscala` (em vez de "—" ao lado de um Escalado cheio).
⚠️ O **gate do chat** (`aplicaSplitCargaEscala`) **continua só `'sim'`** — no contrafactual não há o
que perguntar; a regra do `'nao'` é pura derivação no sync.

**Onde aterrissou:**
- `src/lib/google/sync.ts` — novo `derivarSplitHorasSheet` (exportado) + uso em `syncSubmitToGoogle`
  (substitui o `temSplit` inline).
- `src/lib/chat.functions.ts` — `derivarJustificativaCargaEscala`: branch `'nao'` (justificativa
  "100% escala").
- `tests/sync-padronizacao.test.ts` — 5 casos de `derivarSplitHorasSheet`.
- `CLAUDE.md` (seção carga×escala) + `SPEC_FEATURES_NOVAS.md` (F4) atualizados. `worker.js` rebuildado.

**Notas / não-regressão:**
- **NÃO** altera `saving_reais`/`ganho_total`/`linhas` — F4 segue: o TOTAL é o que vira R$ (decisão
  fechada). As colunas do split são só transparência.
- `aplicaSplitCargaEscala` e o prompt do gate ficam intactos → `tests/saving-carga-escala.test.ts`
  segue verde (`'nao'`/`'externo'` ainda FALSE no gate de conversa).
- Sem migração/coluna nova; sem backfill (decisão do dono — propaga por edição).

### Parte C — gate da carga real não entendia "100%" / "nada escalado"

**Sintoma (reportado, com print):** ao responder o gate da carga real com **"100% das horas eram na
mão"** (= tudo manual, nada escalado), o agente **não entendia e perguntava de novo** — o usuário
ficava repetindo algo que já tinha respondido.

**Causa-raiz:** `interpretarCargaReal` só reconhecia `tudo`/`o total` ou um **número de horas**. "100%"
caía no parser de números → **"100" > total** (ex.: total 35h) → rejeitado → `null` → **re-pergunta**.
E não havia tratamento para "nada escalado"/"sem escala"/"tudo na mão".

**Fix:** `interpretarCargaReal` movida p/ `orchestrator.ts` (pura/testável) e ampliada — reconhece, em
ordem: (1) **porcentagem** ("100%", "50% na mão", "100 por cento" → fração do total; última % vence,
cobre "não era 100%, era 50%"); (2) **"nada/sem/nenhuma escala"** e **"não foi escalado"** → carga real
= total; (3) "fez tudo à mão / tudo manual / volume todo / tudo real" (com guard de negação — "não fazia
tudo" NÃO vira total); (4) números (como antes). Também corrigido um **bug de tipo+lógica** no
`interpretarConfirmacaoEscala` do novo sub-gate: `selected_option` é índice **1-based** (`z.number()`),
não a string da opção — casava por `indexOf(string)` e os **botões nunca bateriam**. 6 testes novos
(`tests/saving-carga-escala.test.ts`), incl. o caso exato do print.

---

## 2026-06-26 — Edição de legado reiniciava a doc ao voltar da parte determinística

**PR:** #168 · **Status:** ✅ mergeada + deployada · **Branch:** `fix/reset-doc-edicao-legado`

**Sintoma (relatado):** uma usuária entrou para **editar um projeto legado**, passou da fase de
doc, preencheu a parte determinística e, já no chat com a IA, lembrou que precisava **adicionar
um analista** e voltou à parte determinística. Ao avançar de novo para o chat, **o sistema
reiniciou TUDO desde a doc** — como se a documentação tivesse mudado — e ela **teve que enviar os
arquivos novamente** (perdendo o saving já preenchido).

**Causa-raiz:** desync entre `arquivos: File[]` e `agentArquivosSig` em `handleContinuarAgente`
(`src/routes/submeter.tsx`). A detecção de "arquivos mudaram" era
`arquivosSig() !== agentArquivosSig`. Quando a página **remonta no meio da edição** (recurso
"reload não perde o chat"), o `rehydrateFromLocal` **restaura `agentArquivosSig`** do rascunho
(ex.: `"arquivo.json:11975"`), mas o `arquivos: File[]` **não pode ser restaurado** — objetos
`File` não serializam para o localStorage (não estão no `DraftSnapshot`). Resultado:
`arquivosSig()` vira `""`, a comparação dá "mudou" falsamente e força o reprocesso da doc.
Específico de **legado** porque legado **obriga upload** na edição (não tem doc/`arquivos_nomes`
prévios), então `agentArquivosSig` sempre fica preenchido — projeto já documentado não sobe
arquivo e não desincroniza. Como `reprocessarComNovosArquivos` é no-op sem `File[]`
(`if (arquivos.length === 0) return;`), o primeiro "Continuar com Agente" pós-remontagem só
**travava** (early-return, sem chamada ao servidor → invisível nos logs); para destravar, a
pessoa reenviava o arquivo, e aí o reprocesso rodava de verdade e zerava a doc + o saving.

**Fix:** só disparar a detecção quando há arquivo NOVO de fato — guard `arquivos.length > 0`:

```js
if (projetoId && arquivos.length > 0 && arquivosSig() !== agentArquivosSig) {
  await reprocessarComNovosArquivos();
  return;
}
```

Sem upload novo (inclusive pós-reload) → não reprocessa, segue o fluxo normal (reabre o form de
saving / preserva o chat). Com upload real → `arquivos.length > 0` + assinatura diferente →
reprocessa corretamente (comportamento legítimo mantido).

**Onde aterrissou:**
- `src/routes/submeter.tsx` — `handleContinuarAgente`: guard `arquivos.length > 0` nas DUAS
  detecções de troca de arquivos (ramo **padrão** e ramo **projeto especial**).
- Frontend-only (não toca `worker.js`/backend). Sem migração, sem coluna nova.

**Notas / não-regressão:**
- Diagnóstico só por código: a janela de logs do Godeploy (~1,5h) não capturou o incidente
  (variante "travada" não faz request); o padrão de risco aparece (ytalo.ferreira editando
  legado-194/196 com upload de arquivo).
- Sem teste unitário novo: a lógica é inline no componente e a base de testes é node-only (sem
  testing-library/jsdom). `reprocessarComNovosArquivos` continua com o early-return defensivo.

---

## Sync reverso desatualizado: `especial` preso e órfão "cinza" (caso Helen)

**Sintoma (2 relatos, 30/06/2026):**
1. **Status cinza** em "Meus Projetos" — `legado-148` ("AVD Central") existia no SQLite mas
   **não tinha linha no Sheet**; como o status na lista vem **só do Sheets**, sem linha → `null`
   → badge cinza ("—"). Não saía nunca.
2. **Especial preso** — `AVD Central v2` (`e4b1dcc3…`) estava `Especial?=Não` + saving completo
   (112h) no **Sheet**, mas no **SQLite** ainda `especial=1`/`tipos_projeto=['especial']`/
   `contexto_especial` cheio. Abria no fluxo de edição ESPECIAL errado e, ao trocar p/ não-especial
   no form, não puxava o saving (seed dava `tipoProjeto=[]`).

**Causa:**
1. `carimboMs` (carência da `reconciliarExclusoes`) usava `Date.parse`, que lê `submitted_at`
   pt-BR `"12/05/2026"` como **MM/DD → 5/dez/2026 (FUTURO)**. `agora − carimbo` < 0 → sempre
   "dentro da carência de 1h" → órfão **nunca** reconciliado. Pega qualquer legado órfão com
   `submitted_at` de **dia ≤ 12** (vira mês válido ao trocar).
2. O sync reverso **não propagava** `especial` nem `tipos_projeto` (só `contexto_especial` estava
   em `SAFE_UPDATE_FIELDS`, e o loop pula "—" porque `txt()→null`). O bug do "especial sticky"
   (pré-PR #181) deixou o SQLite preso, e o Sheet dizer "Não" nunca desfazia.

**Fix (`src/lib/google/sync-reverse.ts`):**
- `carimboMs` passa a usar `parseDataFlexivel` (lê `dd/mm/yyyy` corretamente) em vez de `Date.parse`.
- `atualizarExistente` reconcilia o tipo do projeto a partir do Sheet (fonte da verdade):
  `parseEspecialFlag('Especial?')` (1|0|**null** p/ vazio = não mexe); ao virar **não-especial**,
  deriva `tipos_projeto`/`tipo_projeto` de "Tipos Projeto" e **zera `contexto_especial`**; ao virar
  especial, `tipos=['especial']`.

**Onde aterrissou:**
- `src/lib/google/sync-reverse.ts` (`carimboMs`, `parseEspecialFlag`, `atualizarExistente`).
- `tests/sync-reverse.test.ts` — +3 casos (flip especial→não, "Especial?" vazia não apaga, órfão
  pt-BR removido com `vi.setSystemTime`). 489 testes verdes.

**Recuperação de dados (prod, via forçar sync):** `POST /api/admin/sync-sheets-now` rodou o novo
código: `e4b1dcc3` auto-curou (`especial=0`, `tipos=['saving']`, contexto null); `legado-148` (+
`legado-126` + 1 teste) removidos como órfãos. 0 órfãos restantes. Validado **ponta a ponta no
staging** (criar especial → flip p/ "Não" no Sheet → sync desmarca) antes do prod (regra 13).

**Notas:** decisão do dono — para a `AVD Central v2` foi só o fix de sync (não o replay completo),
então a doc segue sem `saving.linhas`; ao reeditar, a Helen refaz o saving no chat (o flag/tipo já
estão certos). A regra "Sheets é o banco principal; SQLite espelha em quase-tempo-real" guiou a
escolha.

---

## `resyncGoogle`/edição não recuperava linha ausente da planilha — append perdido ficava irrecuperável (30/07/2026)

**Sintoma.** Quando o **append da IDA** falha de vez (cota `429`/transiente), o projeto existe no SQLite mas
**não existe na planilha**. Qualquer tentativa de conserto pelo caminho normal — reenvio, edição,
`resyncGoogle` — usa `modo: 'edicao'` → `updateRowByProjectId`, que **não acha a linha, não faz nada e ainda
devolve sucesso** (`ok: true`). Não havia caminho de recuperação: passada a **carência de 1h**,
`reconciliarExclusoes` **purgava o projeto do SQLite** — perda silenciosa. Achado durante a validação em
staging do fix da cota (`cb8d677`), que produziu exatamente esse estado num projeto real do run.

**Causa.** `updateRowByProjectId` (`google/sheets.ts`) tratava "ID Projeto não encontrado" como um
`console.warn` + `return` **void**: o chamador não tinha como distinguir "atualizei" de "não havia o que
atualizar". E `syncSubmitToGoogle` (`google/sync.ts`) só apendava no `modo === 'novo'`.

**Fix.**
- `updateRowByProjectId` passa a devolver `Promise<boolean>`: **`false` SOMENTE no caminho "ID não
  encontrado"** (linha ausente, recuperável). Todo o resto → `true` = "nada a recuperar", **inclusive o abort
  por cabeçalho sem a coluna "ID Projeto"** — sem a coluna do ID não se pode afirmar que a linha falta, e
  apendar arriscaria **duplicar**. Mudança **ADITIVA**: os 8 chamadores atuais ignoram o retorno e seguem
  idênticos. ⚠️ **Zero leitura extra do Sheets** — a busca do ID já acontecia ali (requisito duro: a cota de
  60 leituras/min é compartilhada com produção).
- `syncSubmitToGoogle`, no `modo === 'edicao'`, quando o update reporta linha ausente, **cai para
  `appendRow`** (decisor puro `deveRecuperarPorAppend`), logando como **RECUPERAÇÃO** e incluindo
  **`Data Submissão`** (a linha está sendo criada agora; o ramo normal de edição omite essa coluna de
  propósito, para preservar a data original).

**Onde aterrissou:** `src/lib/google/sheets.ts` (`updateRowByProjectId`) ·
`src/lib/google/sync.ts` (`deveRecuperarPorAppend` + ramo de edição) ·
`tests/sheets-update-linha-ausente.test.ts` (retorno `true`/`false` + guarda de "nenhuma leitura adicional":
no máximo 2 GETs no caminho de update) · `tests/sync-recuperacao-linha-ausente.test.ts` (apenda com
`Data Submissão`; **não** apenda quando a linha existe — nunca duplica; `'novo'` segue só com append).
Plano: [`docs/plans/calibragem-regua-criterio-e-resync-append.md`](../docs/plans/calibragem-regua-criterio-e-resync-append.md).

**Risco aceito e registrado.** O fallback vale para todo `modo === 'edicao'`, então um reenvio pode
**recriar** uma linha que um admin apagou **de propósito** — e apagar do Sheets é justamente como se remove
um projeto. Janela estreita (a `reconciliarExclusoes` purga o projeto do SQLite em 1h) e o usuário de fato
reenviou. A alternativa (checar existência antes) custaria uma leitura por sync, contra a cota.

⚠️ **Variante do mesmo risco, apontada pela revisão de qualidade (severidade média, NÃO tratada):** `false`
significa _"não casei o ID na coluna"_, não _"a linha nunca existiu"_. Se a linha **existe** mas o ID foi
mexido à mão (apóstrofo/aspas à frente, ID trocado, linha movida de aba) — plausível numa planilha onde
legados entram manualmente — a edição passa a **criar uma 2ª linha** para o mesmo projeto, onde antes era
no-op; o mesmo vale para um append da 1ª submissão ainda **in-flight** num `waitUntil` concorrente.
**Mitigações que já existem:** o append de recuperação grava o `ID Projeto`, então a edição seguinte encontra
a linha (é **auto-limitante** — não vira uma linha por edição); o log sai como `RECUPERAÇÃO` com o id, e a
falha é rotulada pela **etapa** real (`atualizar` · `recuperar (append)` · `inserir`), não pelo modo. Cercos
desenhados e **não** implementados (custo × benefício, decisão de produto): condicionar o append a o SQLite
confirmar que a linha nunca aterrissou (`atualizado_em` ausente) ou marcar a linha recuperada para a triagem
do `/dashboard` detectar duplicata.

---

## Correção de triagem na planilha não chegava ao banco — reenvio revertia o conserto (04/08/2026)

**Sintoma.** No Sucesso.AI (Maria Ponciano), dois componentes de **receita** — "Ressarcimento das
transportadoras" (R$ 55.864,38) e "Receita retida em reenvio" (R$ 106.049,40) — foram declarados como itens
de **custo evitado** no saving e, no reenvio de 29/07, declarados **de novo** como receita incremental. O
mesmo dinheiro dos dois lados. A planilha foi corrigida à mão em 31/07 (Custo Evitado e Saving Reais
174.238,10 → 12.324,32; Ganho Total 190.429,48 → 28.515,70), **mas o SQLite não**: seguia com
`custo_evitado_reais = 174.238,10` e os 4 itens no JSON.

**Causa.** O sync reverso (`syncSheetsToSqlite`) só atualiza `SAFE_UPDATE_FIELDS` — as colunas financeiras
ficam de fora, e `custo_evitado_itens` **não tem coluna no Sheets**, então nunca poderia voltar por ali. Como
o formulário de edição seeda do SQLite (`getMeuProjeto`), **o próximo reenvio da autora reescreveria a
planilha com os 4 itens** e desfaria a correção sozinho. Correção manual sem contrapartida no banco é
temporária por construção.

**Fix.** `reconciliarFinanceiroDoSheet` (`src/lib/reconciliar-financeiro.ts`) + rota
`POST /api/admin/reconciliar-financeiro` (`requireAdmin`, body `{projetoId, dry?}`): puxa para o SQLite o
estado já validado na planilha — reconstrói os itens do texto de "Justificativa Custo Evitado"/"Custo do
Projeto" (formato gerado pelo próprio app: `• nome — R$ valor (recorrência). justificativa`), recomputa o
saving com `recomputarSavingFinanceiro` (horas seguem sendo a fonte de verdade) e regrava
`custo_evitado_itens`/`justificativa`, `saving_reais`, `ganho_total_mensal`, `memorial_calculo` e
`documentacao.conteudo.saving`.

**Invariantes que não podem regredir:**
- ⚠️ **Não escreve NADA no Sheets** — nem uma célula, em especial `Atualizado Em` (carimbo de sistema que
  regulariza legado). É mão única, planilha → banco.
- ⚠️ **FAIL-CLOSED em duas frentes:** linha da justificativa fora do formato → aborta (não vira item por
  adivinhação); soma dos itens ≠ célula de total → aborta pedindo que a planilha seja corrigida antes. Um
  palpite aqui grava número errado no banco que a gestão lê.
- ⚠️ **Receita entra com ÷10** (`ganhoTotalMensal`, mesma fórmula de `submeterParaValidacao`) — o Ganho Total
  **não é a soma simples**. Regra de negócio documentada em `docs/business-rules.md`, com teste explícito
  para ninguém "corrigir" por engano.
- `dry: true` devolve o diff sem gravar. **Usar sempre antes da escrita real.**

**Onde aterrissou:** `src/lib/reconciliar-financeiro.ts` · `src/worker.ts` (rota) ·
`tests/reconciliar-financeiro.test.ts` (parse do formato real da planilha, nome com hífen × travessão
separador, fail-closed, pontual pelo valor cheio, ÷10 da receita).

**Ponto cego de ORIGEM, ainda aberto (prevenção).** O bloco anti-dupla-contagem existente só compara
*horas × custo evitado*; **não há checagem custo evitado × receita**, e a fase de receita não relê os itens do
custo evitado. O agente chegou a estranhar a natureza do valor ("ressarcimento é saving operacional, não
receita incremental — confirme se devo excluir"), a autora reafirmou e ele aceitou (comportamento previsto:
argumenta 1×, aceita a discordância) — mas **nunca disse que o valor já estava contabilizado no saving**,
porque não olhou. Enquanto esse gate não existir, o padrão pode se repetir.
