# Spec — Registro de Correções (GoDocs)

> **Documento vivo.** Uma entrada por correção de bug relevante (regra 12 do `CLAUDE.md`:
> "Specs — consultar antes, atualizar a CADA implementação"). Formato fixo:
> **sintoma → causa-raiz → fix → onde aterrissou → status/PR**. Mais recente no topo.

---

## 2026-08-24 — `resyncGoogle` corrompia 2 colunas de projeto-FEATURE (parecer do estágio errado + zerava "ID Pai")

**Status:** ✅ corrigido (aguarda re-revisão + aprovação p/ prod) · **Branch:** `feat/projeto-vinculado`

**Sintoma (2 bugs, achados em revisão de código).** No reparo administrativo `resyncGoogle`
(regrava a linha inteira da planilha a partir do banco), num **projeto-feature** (vínculo
pai↔filho, aprovação sequencial de 2 líderes): **(1)** a coluna **"Aprovação do Líder"** — que é
do **estágio 1** — recebia o parecer do **estágio 2** quando o estágio 1 é ISENTO (autor é
liderança) e as únicas linhas em `projeto_aprovacoes` são do estágio 2; **(2)** a coluna
**"ID Pai"** era zerada para **"—"** a cada resync, apagando o vínculo de feature.

**Causa-raiz (a mesma para os dois).** O `resyncGoogle` não recebeu a disciplina de
estágio/`undefined` dos escritores primários. **(1)** ele recomputava `aprovacaoLider`/
justificativa de `getAprovacoesDoProjeto(...)` **sem** filtrar `estagio === 1` — os outros 3
escritores (`abrirPreAprovacao`, `decidirAprovacao`, `dispensarPreAprovacao`) já filtram. **(2)**
em `google/sync.ts`, `row['ID Pai'] = ouTraco(p.idPai)` era **incondicional** (sem o guard
`undefined` ≠ `null` que protege as colunas do líder logo acima), e o `resyncGoogle` chamava
`syncSubmitToGoogle({modo:'edicao'})` **sem** passar `idPai` → `ouTraco(undefined) = "—"`. Como
"ID Pai" **não** está em `SAFE_UPDATE_FIELDS`, nada restaurava o valor.

**Fix.** **(1)** `resyncGoogle` (`chat.functions.ts`) filtra
`getAprovacoesDoProjeto(...).filter(l => Number(l.estagio) === 1)` antes de
`rotuloAprovacaoSheet`/`justificativaAprovacaoSheet` (mesmo predicado dos primários). **(2)**
defesa em profundidade: em `google/sync.ts` a coluna "ID Pai" ganhou o guard `undefined` ≠ `null`
(`if (p.idPai !== undefined || p.modo !== 'edicao')` → `undefined` OMITE, `null` grava "—"); e o
`resyncGoogle` passa `idPai: projeto.projeto_pai_id ?? null`, **restaurando** ativamente o vínculo.

**"ID Feature" (lista de filhos na linha do PAI) — verificado, NÃO tocado.** Ela é escrita **só**
cross-row, por um `updateRowByProjectId(paiId, {"ID Feature": ...})` PARCIAL (nunca faz parte do
`row` de `syncSubmitToGoogle`), e updates parciais deixam colunas omitidas intactas. Logo um
resync do pai (via `syncSubmitToGoogle`) **não pode zerá-la**. "ID Pai" e "ID Feature" confirmadas
**fora** de `SAFE_UPDATE_FIELDS` (sync reverso não as toca).

**Onde aterrissou.** `src/lib/chat.functions.ts` (`resyncGoogle`), `src/lib/google/sync.ts`
(guard da coluna "ID Pai"). **Testes:** `tests/resync-vinculo-lider.test.ts` (novo — resync com
estágio 1 isento não vaza estágio 2; controle com estágio 1 pendente; restaura/`null` do "ID Pai")
e casos de "ID Pai"/"ID Feature" em `tests/sync-aprovacao-lider-colunas.test.ts`. Suíte: verde.

---

## 2026-08-19 — Projeto que deixou de ser especial mantinha o "porquê é especial" na planilha e na tela

**Status:** ✅ corrigido · **Branch:** `fix/contexto-especial-orfao`

**Sintoma.** Projetos convertidos de **especial → saving/receita** aparecem no Sheets com
`Especial? = "Não"`, `Tipos Projeto = saving` e a coluna **"Contexto do Projeto Especial"
ainda com o texto inteiro do "porquê este projeto não tem ganho mensurável"** — que
contradiz o memorial de saving da mesma linha. Dois casos reais confirmados em prod
(19/08/2026): **"Farol de Ciência do Código de Conduta"** (`29899445b2da…`, Izadora Gomes)
e **"GoStream - Checklist Proposta"**. O texto também continuava visível em `/projeto/$id`
(bloco "Contexto (projeto especial)"), ou seja, o resíduo estava no **SQLite**, não só na
planilha — provado pelo carimbo `Atualizado Em` de 13/08 no Farol: aquela reescrita monta a
linha INTEIRA a partir do banco, e mesmo assim a célula saiu preenchida.

**Causa-raiz — bug de ORDEM, não de regra faltando.** A limpeza existia em dois pontos e os
dois eram condicionais:

1. `atualizarTipos` zera `especial` **e** `contexto_especial` — mas só roda quando o form
   detecta troca de tipos;
2. `atualizarMetadados` zerava os dois **só quando o banco ainda estava `especial === 1`**.

No fluxo real do formulário (`submeter.tsx`), o `atualizarTipos` é chamado **ANTES** do
`atualizarMetadados` no mesmo clique. Quando o segundo chega, a flag já é 0 → o guard não
dispara → e o passo de persistência dele (`campos.contexto_especial = data.contexto_especial`)
**REGRAVA** o texto que o payload do form ainda carregava. A limpeza acontecia e era desfeita
uma linha depois. O sync reverso também não conserta: o ramo que limpa o contexto só roda
quando a planilha e o banco **divergem** na flag — aqui os dois já dizem "não especial".

**Fix (2 camadas).**

- **Causa-raiz:** o guard de `atualizarMetadados` deixou de exigir `especial === 1` no banco —
  com `especial: false` EXPLÍCITO no request, contexto especial preenchido é sempre resíduo
  (`temContextoResidual`). Roda DEPOIS da persistência dos campos, então o regravamento não
  sobrevive.
- **Rede final, independente de ordem e de qual rota o form chamou:** `submeterParaValidacao`
  limpa o resíduo antes do sync, no banco **e** no objeto em memória (é ele que o
  `syncSubmitToGoogle` serializa). Decisor PURO `deveLimparContextoEspecialOrfao(especial,
  contexto)` — `especial !== 1 && contexto.trim() !== ''`. Idempotente (não gera UPDATE a cada
  reenvio) e não bloqueia a submissão (try/catch).

**Onde aterrissou.** `src/lib/chat.functions.ts` (guard de `atualizarMetadados`, decisor puro
+ rede em `submeterParaValidacao`); testes em `tests/atualizar-metadados-especial.test.ts`
(o novo caso reproduz a ORDEM REAL tipos→metadados e falha sem o fix).

⚠️ **Linhas já gravadas não se corrigem sozinhas** — a célula do Sheets só é reescrita na
próxima IDA (reenvio/resync) do projeto. **Complemento (mesmo dia):** o `resyncGoogle`
reescreve a linha INTEIRA a partir do banco, então sem a mesma limpeza ele REGRAVARIA o
resíduo — e é justamente o resync a ferramenta de conserto das linhas antigas. A limpeza
virou o helper `limparContextoEspecialOrfao` (banco + objeto em memória, idempotente, nunca
lança) e é chamada nos **dois** pontos que reescrevem a linha: `submeterParaValidacao` e
`resyncGoogle` (`GET /api/admin/resync-google?projeto_id=…`).

---

## 2026-08-13 — abrir uma linha do `/dashboard` ainda esperava ~1 s DEPOIS do espelho

**Status:** ✅ corrigido · **Branch:** `feat/espelho-e-perf-navegacao` (mesma do espelho, por
decisão do Luis — 1 PR só) · **Plano:** `docs/plans/detalhe-triagem-abre-instantaneo.md`

**Sintoma.** Com o espelho no ar, a **listagem** do `/dashboard` ficou rápida (deixou de ler o
Google Sheets no request), mas **clicar numa linha para abrir a ficha de triagem continuava
esperando** — o overlay abria com o spinner *"Carregando a linha da planilha…"* por ~1 s, e
fechar e reabrir a MESMA ficha esperava de novo, igual.

**Causa-raiz — duas, e a primeira é a que dominava.**
1. **Uma requisição inteira no caminho crítico do clique.** O `ProjetoDetalheDialog` só disparava
   o `apiFetch` no `useEffect` do `id`, isto é, **depois** do clique. E neste ambiente qualquer
   rota do GoDocs custa **~750–800 ms de overhead FIXO da plataforma** (o gate de OAuth do edge)
   antes de o nosso código rodar — número já medido e registrado no `CLAUDE.md` (a mesma máquina
   fala com `cloudflare.com` em 55 ms, e `/favicon.svg`, que não faz trabalho nenhum, custa ~800 ms).
   Ou seja: **a espera não era a planilha nem o SQLite** — o espelho já tinha resolvido isso, a
   ficha é um `SELECT` por PRIMARY KEY (`lerLinhaEspelho`). Era a **CONTAGEM de requisições**, a
   mesma lição do code-splitting (49 → 19 assets), aplicada a DADO em vez de JS.
2. **Duas leituras SQLite em SÉRIE no servidor.** `getProjetoDashboard` fazia
   `await lerLinhaEspelho(id)` e só então `await getAdminStatusLogs(id)` — independentes entre si,
   mas o histórico só começava depois de a linha chegar (cada round-trip é RPC de Durable Object).

**Fix.**
- **Servidor:** as 2 leituras num `Promise.all`. ⚠️ O `catch` do histórico foi para **DENTRO** do
  `Promise.all`, não num `try` em volta: ele é acessório (auditoria fora do ar não impede a ficha
  de abrir) e, no caminho do 404, quem lança é a checagem da linha — uma rejeição solta do log
  viraria *unhandled rejection* no worker, porque ninguém mais estaria esperando por ela.
- **Cliente:** novo `src/lib/dashboard-detalhe-cache.ts`, irmão do `dashboard-prefetch.ts` (herda
  as decisões dele; **não** foi enfiado no mesmo módulo porque a semântica difere de propósito —
  aquele é um slot ÚNICO de consumo único para a listagem, este é um mapa por id, multi-consumo,
  com invalidação). O `hover`/`focus` da `<tr>` agenda a ficha com **150 ms** (a régua do
  `defaultPreloadDelay` do router) e o `mouseleave`/`blur` cancela; o clique consome a requisição
  **já em voo**.

**Invariantes declarados (o que não pode regredir).** Erro **NUNCA** fica cacheado (403/rede/edge
soltam a entrada, senão a tela herdaria a falha e não tentaria de novo) · **TTL de 30 s**, curto de
propósito: a ficha semeia os campos **Observações / Motivo Reenvio / Motivo Reprovado** que a
triagem **regrava**, e servir ficha velha alargaria a janela de sobrescrever texto mais novo da
planilha · **`invalidarDetalhe` depois de gravar** e **`limparDetalhes` no `?refresh=1`** (que
sincroniza de verdade) · **timer único** para a tabela inteira, então atravessar 25 linhas rolando
**não** vira 25 requisições · cache **em memória, por aba** — a decisão de produto de 28/07/2026
(*"cache da listagem em SQLite/localStorage é FORA"*) segue intacta: isto é a **ficha**, não a
listagem, e não persiste nada.

⚠️ **Por que este I/O no hover não contradiz o *"`preload` NÃO pode disparar I/O"*** (as 2 travas
do link "Dashboard", `docs/deploy.md`): lá o hover disparava `/api/admin/dashboard/projetos` numa
época em que essa rota **lia o Google Sheets**, cuja cota de 60 leituras/min é compartilhada com
prod. Aqui o alvo é o **espelho** (SQLite local), sem cota nenhuma. A condição que inverte o
veredito está escrita no cabeçalho do módulo: **se a rota do detalhe voltar a ler a planilha, o
prefetch por hover sai no MESMO commit.**

**Onde aterrissou.** `src/lib/dashboard-admin.functions.ts` (só `getProjetoDashboard`) ·
`src/lib/dashboard-detalhe-cache.ts` (novo) ·
`src/components/dashboard/projeto-detalhe-dialog.tsx` · `src/routes/_authenticated/dashboard.tsx` ·
`tests/dashboard-detalhe-cache.test.ts` (15 casos: hover→clique = 1 fetch, hover curto não busca,
N linhas deixam 1 intenção viva, erro não cacheado, invalidação ao gravar, TTL, teto do cache) ·
`CLAUDE.md` (gotcha **3b** do Dashboard do admin) · `worker.js` rebuildado. **1443 testes verdes**
(baseline 1428).

**Ficou FORA (declarado):** render progressivo dos campos do resumo enquanto a ficha carrega (é
fatia de UI) e qualquer cache persistente.

---

## 2026-08-12 — REVERTIDA: a mensagem do CHAT do ganho projetado foi reescrita sem ser o alvo do pedido

**Status:** ⏪ revertida no mesmo dia · **Branch:** `revert/mensagem-chat-ganho-projetado` ·
**desfaz o PR #255**

**O que aconteceu.** O pedido era esclarecer o **"Ou espere a medição"** que aparece no **card de
bloqueio do projeto ESPECIAL na Etapa 2.5** — `bloqueioEspecialDashboard()` /
`bloqueioEspecialOrganizacional()` em `src/lib/mensagens-submissao.ts`, cujos 2 caminhos são
_"Marque «Não. É um projeto padrão…» e informe o ganho"_ × _"Ou espere a medição"_. A frase
"espere a medição" existe **nos dois lugares**, e a reescrita (PR #255) caiu no errado: as mensagens
do **chat** (`mensagemGanhoProjetado`/`mensagemGanhoProjetadoRepetida`, `agents/ganho-projetado.ts`),
que **não** estavam em discussão e já estavam boas. Chegou a ir a staging + prod e foi revertida no
mesmo dia.

**Fix.** `git checkout 79554c6 --` dos 2 arquivos: textos do chat e teste voltaram **idênticos** ao
aprovado (a mudança era 100% copy — nenhuma mecânica do gate foi tocada em nenhum momento, então o
revert também não toca). `CLAUDE.md` passou a registrar que **o texto do chat está aprovado como
está** e que o pedido de clareza era do card da Etapa 2.5.

**Lição (não é sobre este texto).** Duas telas diferentes usam a MESMA frase-chave. Copy pedida por
citação vem sempre do que a pessoa VÊ, não do arquivo — então **procure a frase no repo inteiro e
confirme QUAL superfície é** antes de editar: `git grep "espere a medi"` devolvia
`mensagens-submissao.ts` em 1 segundo, e perguntar "é este card da Etapa 2.5?" custava uma linha.

**Onde aterrissou.** `src/lib/agents/ganho-projetado.ts` + `tests/gate-ganho-projetado.test.ts`
(restaurados) · `CLAUDE.md` (bullet do gate) · `worker.js` rebuildado · deploy staging → prod.

---

## 2026-08-12 — Pergunta de custo evitado só falava de "contrato, serviço ou licença" (quem evitava MULTA não se reconhecia)

**Status:** ✅ codada e testada · **Branch:** `fix/texto-custo-evitado` · **PR:** _(pendente)_

**Sintoma.** A pergunta do formulário de saving era **"Essa automação eliminou um gasto externo
(contrato, serviço ou licença)?"**, com o apoio *"Um contrato/serviço de terceiro que a empresa deixou de
pagar… (ex: um agente terceirizado, uma licença SaaS)"*. Quem eliminou um gasto que **não tem esse nome**
— o caso real é a **multa e juros de DIFAL** paga todo mês pelo financeiro (projeto "Plataforma
SmartOnline", Stefany, 10/08/2026) — lia a pergunta, não se reconhecia em nenhum dos três rótulos e
**deixava de cadastrar o corte de gasto**, por medo de "não se encaixar". O ganho ia embora antes de
qualquer gate: o R$ do custo evitado vem dos **itens do formulário** (`custoEvitadoMensalFromItens`), então
gasto não cadastrado é gasto que não existe para a planilha.

**Causa-raiz.** Enquadramento estreito na COPY, repetido em cascata: os três pontos do formulário, os
prompts do agente (perfil do custo evitado puro, Seção 3 do saving, bloco "CUSTO EVITADO") e o
`MEMORIAL_ESQUELETO` nomeavam **exemplos** (contrato · serviço · licença) no lugar da **régua** (dinheiro
que a empresa pagava e parou de pagar por causa desta automação). Exemplo em lugar de régua vira teto: o
usuário lê a lista como enumeração fechada. O detector do gate de custo evitado no chat já cobria
`multa`/`juros`/`mora` (foi escrito a partir do caso DIFAL), mas **não** `taxa`/`tarifa`/`hora extra`.

**Fix.** Copy genérica e objetiva, com a régua explícita e os rótulos como exemplos:

| Onde | Antes | Depois |
|---|---|---|
| Form, ramo "ninguém fazia" | "Essa automação eliminou um gasto externo (contrato, serviço ou licença)?" | "**Por causa desta automação, a empresa deixou de pagar algum gasto?**" + apoio "Não importa o nome do gasto — contrato, licença, serviço de terceiro, taxa, multa, juros: se a empresa **pagava e parou de pagar** por causa disto, cadastre aqui." |
| Form, lista do ramo "Não" | "Qual gasto externo foi eliminado?" | "**Qual gasto a empresa deixou de pagar?**" + "Liste cada gasto que parou de sair do caixa, com valor e recorrência — este é o ganho do projeto." |
| Form, ramo "Sim, alguém fazia" | "Além das horas, a automação eliminou algum gasto externo DISTINTO (contrato/serviço/licença)?" | "**Além das horas, a empresa deixou de pagar algum gasto em dinheiro?**" + apoio que mantém o anti-dupla-contagem ("…**diferente** do trabalho já contado nas horas acima. Se o que parou de ser pago é justamente esse trabalho, responda **Não**") |
| Botões dos 2 ramos | "Sim, eliminou"/"Não eliminou" · "Sim, evitou"/"Não evitou" | "Sim, deixou de pagar"/"Não deixou" (mesmo verbo da pergunta nos dois ramos) |
| Cabeçalho/campos da lista | "Ferramenta / serviço" · "Ex: Zapier" · "Adicionar item evitado" | "Gasto eliminado" · "Ex: multa por atraso · licença do Zapier" · "Adicionar outro gasto" (+ `aria-label`s e o erro "Adicione ao menos um gasto eliminado") |
| Prompts (`orchestrator.ts`) | perfil puro "ELIMINOU um gasto externo (contrato/serviço/licença de terceiro)"; Seção 3 "[3.1] Serviço/contrato evitado"; bloco "CUSTO EVITADO" listando licença/serviço | "DEIXAR DE PAGAR um gasto em dinheiro — o rótulo não importa (…taxa, multa, juros, retrabalho pago)"; "[3.1] **Gasto eliminado**: QUAL gasto a empresa pagava e parou de pagar"; régua única "pagava e parou de pagar por causa desta automação". Os 3 pontos de validação do perfil puro passam a falar de **gasto** (REALIDADE = "já parou/caiu de fato", ESCOPO = "o que cobria **ou por que existia**", ex. da multa) |
| `MEMORIAL_ESQUELETO` | "(a) QUAL contrato/serviço foi evitado" | "(a) QUAL gasto a empresa deixou de pagar, com o rótulo que ele tem de verdade (…)" |
| `mensagemCustoEvitadoPago` | "no campo de custo evitado" | aponta a pergunta como ela aparece na tela ("o gasto que a empresa deixou de pagar (o custo evitado) — vale qualquer gasto, inclusive multa e juros") |

**`TERMOS_GASTO` (detector do gate) — 2 termos novos, os dois AMBÍGUOS:** `taxa|tarifa|encargo` e
`hora extra|sobreaviso|adicional noturno`. Ambíguo = só arma acompanhado de um `VERBOS_EVITADO`, porque
**"taxa de conversão", "taxa de erro" e "taxa/hora" aparecem em conversa de saving toda hora** e não são
gasto (`forte: true` ali armaria o gate em qualquer projeto que citasse um R$ — o mesmo cuidado do "Frete"
com ≥8 chars no gate de sobreposição). ⚠️ **`retrabalho` ficou FORA de propósito:** "evitamos retrabalho" é
a frase mais comum da fase, e retrabalho evitado é **tempo** — já contado nas horas; perguntar por ele como
gasto evitado convidaria à dupla contagem. Retrabalho **pago a terceiro** cai em `terceiro`/`contrato`.

**O que NÃO mudou (de propósito).** O nome da seção do memorial **"Contratos/Serviços Evitados"** e as
chaves `custo_evitado_*` — `extrairJustificativaCargaEscala` e os extratores/colunas do Sheets casam por
esses nomes; renomear a seção quebraria parser e planilha sem ganho nenhum para o usuário (o rótulo interno
não é lido por quem preenche). A árvore do formulário, os valores `sim/nao/externo` e a mecânica dos gates
seguem idênticas — a mudança é 100% de texto + vocabulário do detector.

**Onde aterrissou.** `src/lib/submeter/step3-chat.tsx` (3 perguntas, 4 botões, cabeçalho/placeholders/
`aria-label`s/erro da lista) · `src/lib/agents/orchestrator.ts` (`buildSavingCustoEvitadoPrompt`, Seção 3 e
bloco "CUSTO EVITADO" de `buildSavingPrompt`) · `src/lib/agents/memorial-format.ts` (`MEMORIAL_ESQUELETO`,
modos `saving` e `custo_evitado`) · `src/lib/agents/custo-evitado-chat.ts` (`TERMOS_GASTO`,
`mensagemCustoEvitadoPago`) · `src/lib/testes/prompt-registry.ts` (regra 3) · `tests/custo-evitado-chat.test.ts`
(4 testes novos: taxa com verbo arma · taxa sem verbo NÃO arma · hora extra arma · retrabalho fica fora) ·
`worker.js` rebuildado. `npm run test`: **87 arquivos, 1210 testes, verdes**.

---

## 2026-08-06 — Líder levava "Acesso negado." ao abrir a documentação do projeto que precisa aprovar

**Status:** ✅ codada e testada · **Branch:** `worktree-plano-aprovacao-lider-teamguide` · **PR:** #235

**Sintoma.** O Estevão Vidal, líder, escreveu no Chat: *"não to conseguindo abrir a página de 'Ler a
documentação completa' no godocs pra aprovar um projeto"* — o print mostra `/projeto/323278fc…` com a
tela read-only montada (cabeçalho "Projeto", selo "SOMENTE LEITURA") e, no corpo, **"Acesso negado."**.
Acontecia com **todo** líder: 28 deles tinham acabado de ser convidados a `/aprovacoes` pela DM do Gomoon.

**Causa-raiz.** O gate de leitura do detalhe (`getMeuProjeto`, `meus-projetos.functions.ts`) era
`temAcesso = ehOwner || ehParticipante` → **403** para o líder, que não é nenhum dos dois. O card da fila
(`src/routes/aprovacoes.tsx`) oferecia o link mesmo assim. Era a **T3 do plano F1** e o **critério de
aceitação nº 2** ("abre `/projeto/$id` **sem 403**"), que a `SPEC_APROVACAO_LIDER.md` afirmava cumprido —
a tarefa nunca foi implementada e o texto da spec envelheceu como se tivesse sido. O `/ggsd:ship` do PR
#235 pegou exatamente isto (revisor de conformidade em contexto fresco: `diverge-alta`, confiança 0,74) e
**barrou o merge**; o relato do Estevão chegou no mesmo dia, do lado do usuário.

**Fix (D28).** Uma **3ª porta** de leitura, escopada: quem tem **linha em `projeto_aprovacoes`** para
aquele projeto abre o detalhe. Puro `resolverAcessoAprovador(linhas, email)` + I/O `acessoDeAprovador`
(`aprovacoes.functions.ts`); `getMeuProjeto` só consulta essa porta quando owner/participante/admin falham
(zero I/O extra para eles) e devolve `papel: 'aprovador'`. **`podeEditar` não muda** — quando o acesso vem
só da fila, `temAcesso` e `ehAdmin` são falsos por construção, então a expressão de edição já dá `false`
sem cláusula nova (gotcha 8: líder não vira editor; isso é `editores_delegados`). Na tela: selo
**"Aguarda seu parecer" / "Parecer registrado"** (rótulo + ícone, nunca só cor) e o link de voltar aponta
para **`/aprovacoes`** em vez de "Meus Projetos".

**Decisões dentro do fix** (as duas mereciam pergunta e foram resolvidas pelo lado seguro):
- **Linha JÁ DECIDIDA também dá leitura.** O slider mantém o item decidido em modo leitura (D15) e o link
  continua ali — expirar o acesso no clique do parecer devolveria o mesmo 403 logo depois de aprovar.
- **Nunca consulta a TeamGuide.** A liderança ao vivo é a régua de quem **entra** na fila, não de quem já
  foi convocado a decidir; além de custar latência na abertura do detalhe, uma reorganização de time
  apagaria o acesso a um projeto que a pessoa tem em mãos. A linha da fila já é a prova — é a MESMA régua
  do gate de `decidirAprovacao`.

**Onde aterrissou.** `src/lib/aprovacoes.functions.ts` (predicado puro + wrapper) ·
`src/lib/meus-projetos.functions.ts` (3ª porta, `Papel` ganha `'aprovador'`) ·
`src/routes/projeto.$id.tsx` (selo + origem do link) · `tests/aprovacoes-lider.test.ts`
(6 casos do predicado puro + 5 de `getMeuProjeto`: líder pendente lê e não edita, líder que já decidiu
segue lendo, estranho e projeto-sem-fila seguem em 403, autor intocado) ·
`spec-docs/SPEC_APROVACAO_LIDER.md` (D28 + a linha que afirmava o critério cumprido).

⚠️ **Achado colateral do teste** (vale para quem escrever teste de ownership aqui): `isAdmin` lê
`ADMIN_EMAILS` do **ambiente**, e a máquina de quem roda os testes pode ter a variável exportada — o
primeiro fixture usava um líder que era admin, o override de admin abria o projeto e o teste do 403
**passava por engano**. O bloco novo fixa `isAdmin` em `false` via `vi.mock`.

---

## 2026-08-06 — Coluna "Aprovação do Líder" nascia VAZIA nos novos submetidos + o re-sync APAGAVA o parecer

**Status:** ✅ codada e testada (1118 verdes) · **Branch:** `fix/pre-pendente-sempre-e-traco` → `worktree-plano-aprovacao-lider-teamguide` · **PR:** #235

**Sintoma.** Reportado pelo Luis: "os novos submetidos estão sendo submetidos com essa linha sem nenhum
status" — a coluna **`Aprovação do Líder` (AE)** chegava **em branco** na planilha (nem `Pré-pendente`, nem
`—`), e a **`Justificativa Aprovação do Lider` (AF)** também vinha **sem o `—`**.

**Causa-raiz — duas, e só a 2ª é bug de código:**

1. **A prod estava rodando um build SEM a feature.** Um deploy de outra frente subiu o `main` (que não tem
   `aprovacoes.functions.ts`) por cima do deploy da D26 — `getApp(674a3710)` mostrava **version 227**,
   `updatedAt 2026-08-06 16:24 UTC`, e `GET /api/aprovacoes/pendentes` devolvia **404**. Sem o código, o
   `syncSubmitToGoogle` nunca recebia as 2 chaves → `orderValuesByHeaders` escrevia `''` → **célula em
   branco**. Não era mapeamento de coluna: o cabeçalho real de prod tem `AE "Aprovação do Líder"` e
   `AF "Justificativa Aprovação do Lider"`, **sem ambiguidade** (conferido nesta sessão). Restaurado no
   **version 228** (`updatedAt 17:08 UTC` = 14:08 BRT) — daí em diante a célula nasce preenchida.
   ⚠️ O `—` que aparece na AF das linhas de 03–05/08 **não** foi o sistema (a feature não estava no ar):
   foi preenchimento manual da planilha. A última linha da janela (E2E de 14:07 BRT, 1 min antes do
   restore) tem as **duas** células vazias — a assinatura exata do build sem feature.
2. **`resyncGoogle` apagava o parecer do líder.** Ele chama `syncSubmitToGoogle` **sem** passar
   `aprovacaoLider`/`justificativaAprovacaoLider`, e a linha fazia `ouTraco(p.aprovacaoLider)` sem condição
   — `undefined` virava **`—`** e o `updateRowByProjectId` gravava isso **por cima do parecer que o líder já
   tinha dado** (estado + assinatura + checklist + comentário). O re-sync é justamente a ferramenta de
   RECUPERAÇÃO (linha morta por cota 429), então rodá-lo para salvar um projeto destruía a pré-aprovação
   dele. A coluna é espelho da tabela interna `projeto_aprovacoes`; quem não conhece a fila não pode zerá-la.

**Fix.**
- **`undefined` ≠ `null` nessas 2 colunas** (`SubmitSyncParams`, `sync.ts`): `null` = "não se aplica" → grava
  `—`; **`undefined` = "não sei, não encoste"** → a coluna é **omitida do update**. No **append** a omissão
  não existe — a linha nasce agora e a célula tem de nascer com `—` (padrão "texto vazio → —"), inclusive no
  **append de RECUPERAÇÃO** (foi o teste que pegou esse ramo: ele monta a linha a partir do `row` do modo
  `edicao`, que já não trazia as chaves).
- **`resyncGoogle` passa o estado REAL**, derivado de `getAprovacoesDoProjeto` pelas funções puras que já
  existem (`rotuloAprovacaoSheet`/`justificativaAprovacaoSheet`). Sem fila → `undefined` (preserva a célula).
  O re-sync **não reabre fila** — isso é `reabrirPreAprovacoes`.

**Decisões do Luis (06/08/2026), tomadas neste fix:**
- **`Pré-pendente` só quando a fila REALMENTE abre.** As D12/D20/D27 ficam de pé: autor coordenador+ →
  `Pré-aprovado`; especial · sem líder · TeamGuide fora → `—`. Escrever `Pré-pendente` em toda linha faria a
  coluna dizer "esperando o líder" em projeto que **nunca** aparece na fila de ninguém, e quebraria o
  relatório de espera por líder. O que a planilha ganha é a garantia de **nunca ficar vazia**.
- **Sem retroativo:** a condição vale **só para os novos submetidos**. Os projetos da janela sem-feature
  (incluindo o "Hub de Importação"/Gustavo Castro, 13:41 BRT) **não** são regularizados por backfill.

**Onde aterrissou.** `src/lib/google/sync.ts` (tipo + linha condicional + ramo de recuperação) ·
`src/lib/chat.functions.ts` (`resyncGoogle` deriva da fila) · `tests/sync-aprovacao-lider-colunas.test.ts`
(**novo**, 6 casos: append com fila · append sem estado · append `null` · edição regravando · **re-sync não
toca** · recuperação nasce preenchida) · scripts de leitura pura `scripts/dryrun-lider/ultimas-linhas.ts` e
`cabecalho-full.ts` (fora do `npm run test`).

---

## 2026-08-05 — Parecer do líder chegava MUTILADO na planilha (coluna sem acento + justificativa resumida)

**Status:** ✅ codada e testada (945 verdes) · **Branch:** `worktree-plano-aprovacao-lider-teamguide` · **PR:** pendente

**Sintoma.** O líder pré-aprovava/pedia ajuste em `/aprovacoes`, a coluna **`Aprovação do Líder` (AE)**
mudava de estado normalmente — e a coluna **`Justificativa Aprovação do Líder` (AF)** ficava **vazia**: quem
decidiu, quando, as 3 respostas do checklist e o texto que o líder escreveu não apareciam em lugar nenhum.
E, no que chegava (staging antiga), o detalhe era um resumo em rótulos internos (`Move KPI: sim · Sentiria
falta: não`) com o texto livre concatenado **sem dizer o que era** — com dois "nãos" no checklist (D16) era
impossível saber a qual pergunta a explicação respondia.

**Causa-raiz.** Duas, independentes:
1. **Nome da coluna com uma letra de diferença.** O cabeçalho real de **prod E staging** é
   `Justificativa Aprovação do **Lider**` (sem acento no "i") e o código escreve `…do **Líder**` (regra 4).
   O mapeamento do sync é por **NOME EXATO** (`fetchHeaderMap`): chave que não casa é **ignorada com aviso** e
   o resto da escrita segue — falha 100% silenciosa para quem usa o app. Conferido ao vivo em 04 e 05/08/2026.
2. **Formato pobre por decisão antiga.** `justificativaAprovacaoSheet` produzia uma linha só, com
   `resumirChecklist` (rótulos curtos) e o `comentario` colado no fim sem rótulo.

**Fix.**
- `google/sheets.ts`: `chaveColuna` (minúsculas, sem acento via NFD, espaços colapsados) +
  `resolverColunaLetra` (exato **primeiro**, normalizado como rede) usados no `updateRowByProjectId`; o
  `appendRow`/`orderValuesByHeaders` casam pelo mesmo critério, e `chavesForaDoCabecalho` mantém o aviso só
  para o que realmente não existe. **Fail-safe:** chave AMBÍGUA (2 cabeçalhos que normalizam igual) é
  descartada do índice tolerante — só casa por nome exato, para nunca gravar na coluna errada.
- `aprovacoes-checklist.ts`: `detalharChecklist` (a PERGUNTA como o líder a leu + a resposta) e
  `rotuloChecklist` — os textos seguem na FONTE ÚNICA.
- `aprovacoes.functions.ts`: `justificativaAprovacaoSheet` virou multi-linha (assinatura com nome **e**
  e-mail + uma linha por pergunta + texto livre) e `rotuloComentarioSheet` nomeia o texto conforme o
  veredito/checklist (`O que precisa ser ajustado` · `Motivo da reprovação` · `Justificativa do "não" em …` ·
  `Comentário do líder`).

**Onde aterrissou.** `src/lib/google/sheets.ts`, `src/lib/aprovacoes-checklist.ts`,
`src/lib/aprovacoes.functions.ts`, `scripts/dryrun-lider/hdr.ts` (o diagnóstico agora prova exato **e**
resolvido), testes em `tests/sheets-mapping.test.ts` (+5) e `tests/aprovacoes-lider.test.ts` (+4, e os 4
antigos passaram a afirmar o formato novo). Decisão: **D18** de `SPEC_APROVACAO_LIDER.md`.

**Verificação.** 945 testes verdes + leitura ao vivo do cabeçalho de **produção** (53 colunas):
`Aprovação do Líder` → AE (exato) e `Justificativa Aprovação do Líder` → **AF só pelo match tolerante**
(`npx vitest run --config scripts/dryrun-lider/vitest.config.ts`). ⚠️ Com isto, o **⛔ bloqueio de ida a
prod** por causa do acento **deixa de existir** — não é preciso renomear o cabeçalho.
---


---

## 2026-08-05 — Erro "too big" em inglês travou a submissão 10× (caso Josiely): campo sem `maxLength` + ZodError cru no toast

**Status:** ✅ codada e testada (943 verdes) · **Branch:** `fix/erro-validacao-amigavel` · ⏳ staging pendente
(a staging está ocupada pela frente da pré-aprovação do líder — `updateApp` substitui a app inteira)

**Sintoma:** a Josiely tentou submeter "Análise Inteligente de Prazos" e recebeu um erro vermelho
com **`[{"code":"too_big","maximum":200,…}]`** — JSON cru, em inglês, sem dizer QUAL campo corrigir.
Tentou **10×** (17:32/17:34/17:38 de 05/08) e só passou às 17:40, depois de encurtar a lista de
ferramentas por tentativa e erro. Nos logs de prod as 10 requisições aparecem **sem NENHUMA linha de
log** (a pista que resolveu o caso).

**Causa-raiz:** duas falhas somadas.
1. O input "✏️ Especifique a ferramenta" (`step1.tsx`) **não tinha `maxLength`**, mas o schema tem
   `ferramenta: z.string().max(200)` — e o valor enviado é `"Outros: " + texto`, então **193 chars
   digitados** já estouram. Mesmo furo em `nome_projeto` e `servico_externo` (200 cada).
2. O `ZodError` subia pelo `errorJson(err.message, 500)` e o `apiFetch` joga `data.error` **literal**
   no toast. Como o `parse` é a primeira instrução de `iniciarSubmissao` (antes do 1º `log`), a
   requisição morria sem deixar rastro no log — só no `api_logs`, que não tem endpoint de listagem.

**Fix:** módulo PURO `src/lib/erro-validacao.ts` (`traduzirErroValidacao`) traduz ZodError →
**400 + frase em PT-BR nomeando o campo e o limite** ("Ferramenta utilizada: texto muito longo — o
limite é 200 caracteres."), no máximo 3 frases + contador. Ligado nos **dois** catches do `worker.ts`
(dispatcher `/api/chat/*` e catch geral) — cobre todas as rotas de uma vez. Devolve `null` para erro
que **não** é de validação, então falha real segue 500 (não engolimos bug de servidor como erro do
usuário), e o `api_logs` continua gravando o erro **técnico** para o Investigador. Mais as travas de
`maxLength` na tela: `ferramentaOutra` **192** (200 − os 8 do prefixo `"Outros: "`), `nome_projeto`
200, `servicoExterno` 200.

**Onde aterrissou:** `src/lib/erro-validacao.ts` (novo) · `src/worker.ts` (2 catches) ·
`src/lib/submeter/step1.tsx` · `src/lib/submeter/step2.tsx` · `tests/erro-validacao.test.ts` (5 casos,
incl. o caso real de 201 chars e o guard de "não engolir erro que não é validação") · `worker.js`.

**Descartado (não re-investigar):** limite de payload do edge/Godeploy — sondei a staging com bodies
de **1/4/8/10/12/20 MB** e todos chegaram ao worker. O PDF dela tinha 265 KB.

**Achado colateral (frente SEPARADA):** o proxy de LLM estourou o timeout de **25 s em praticamente
TODA chamada** na janela inteira do log, caindo no fallback OpenAI direto — nada se perde, mas são
+25 s por turno do chat, para todos. Não investigado.

**Plano:** `docs/plans/fix-ferramenta-too-big-submissao.md`

---

## 2026-08-05 — Gate do [1.4] "Ponteiro movido" nunca perguntava: o LLM respondia por conta própria, apontando pro próprio arquivo da automação

**Status:** ✅ codada e testada (938 verdes) · **Branch:** `fix/gate-ponteiro-verbo-generico` · ⏳ staging pendente

**Sintoma:** simulando de novo o caso-âncora "nuvem de palavras" (o mesmo que originou toda a
régua de critério — ver `SPEC_CRITERIOS_PROJETO.md`), a IA nunca perguntou **"qual ponteiro este
projeto moveu, e onde conferir?"** — a pergunta do gate `[1.4]`. O memorial saiu com:

> Ponteiro movido: tempo operacional da área... Isso pode ser conferido no próprio CSV
> exportado do formulário e no arquivo PNG gerado pela automação.

— citando o CSV de entrada e o PNG de saída **da própria automação** (o entregável) como
"onde conferir", não um ponteiro real de custo/receita/KPI.

**Causa-raiz:** `secaoPonteiroVaga` (`orchestrator.ts`) só força a pergunta quando a seção
`[1.4]` que o **próprio LLM** escreveu no preview é "vaga" — curta ou sem nenhuma palavra da
lista `PISTA_ONDE_VERIFICAR`. Essa lista incluía verbos soltos (`onde`, `conferi`, `verific`,
`acompanh`, `rastrea`) que casam **qualquer** frase que fale de verificação, mesmo sem nomear
fonte alguma. A palavra "conferi**do**" bastou para o regex marcar a seção como preenchida —
o LLM respondeu por conta própria, e o gate nunca chegou a perguntar.

**Fix (1 arquivo, regex only — não muda prompt nem estado):** removidos da
`PISTA_ONDE_VERIFICAR` os verbos sem substantivo companheiro; sobrou só a lista de
substantivos de fonte (relatório, painel, sistema, planilha, base, Metabase, ERP…) + os
padrões de registro de ausência (`REGISTRO_AUSENCIA_FONTE`, checado antes e intocado). ⚠️ **Não
é o mesmo caso do "no sistema" × "no Metabase"** (decisão fechada da `SPEC_CRITERIOS_PROJETO.md`
— nomear vago ainda é nomear, "sistema" continua passando): aqui o problema é a ausência de
**qualquer** substantivo, não a qualidade do nome.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (`PISTA_ONDE_VERIFICAR`) ·
`tests/gate-criterio-secoes.test.ts` (2 casos novos, incl. reprodução literal do texto acima).
**Sem mudança de prompt, de estado ou de fluxo do agente** — só a régua textual do gate.

---

## 2026-08-04 — Ganho PROJETADO virou receita apurada: o agente perguntou 2×, ouviu "não é um número medido" e gerou o preview igual

**Status:** ✅ codada, testada (925 verdes) e **validada na staging** — a staging REPROVOU a 1ª versão do fix e a correção está no adendo abaixo · **Branch:** `fix/gate-ganho-projetado`

**⚠️ ADENDO — a STAGING reprovou a primeira versão do fix (04/08/2026).** Vale mais que o fix
em si, porque é a lição transferível: **um gate que só hooka `preview`/`complete` fica inerte
exatamente quando o prompt passa a funcionar.**

O que a staging mostrou (cenário oficial `receita-pura`, dirigido pelo LLM responder, projeto
`0d719dec…`): com o portão reforçado, o agente **parou de previewar** e começou a **negociar**:

```
🤖 IA: "Não consigo finalizar como receita incremental realizada, porque você confirmou
        que os 80 pedidos/mês e a margem de R$100 são estimativas do briefing…"
   Opções: Encerrar a submissão sem registrar receita | Reclassificar como especial
```

— repetido **~15 turnos**, histórico crescendo de 38 para 56 mensagens, oferecendo caminhos que
o chat **não executa** (quem encerra ou reclassifica é a pessoa, no formulário), e a submissão
morrendo em `500 "Não é possível submeter receita incremental"`. Nos logs do worker, **nenhuma**
linha `Ganho real × projetado`: o gate nunca rodou.

**Causa do erro de desenho:** copiei o hook do `sobreposicao-receita`, onde o LLM **quer**
previewar (o gate intercepta o preview). Aqui é o oposto — o prompt ensina o LLM a **recusar**,
então `resultado.type` nunca é `preview`/`complete` e a condição do gate nunca fecha. O prompt
virou a única autoridade, e prompt sem estado terminal = loop, exatamente o que o gate existia
para evitar. Nenhum teste de unidade podia pegar isso: o defeito vivia no **acoplamento entre o
prompt e o hook**, não dentro de nenhum dos dois.

**Correção (3 partes):**

1. **`devePreemptarPorProjecao(estado, temPista)`** — o gate assume o turno **ANTES** da chamada
   de LLM, quando há pista e o estado é `null`. Uma pergunta, dois botões, estado terminal — e
   economiza a chamada. O hook antigo (`deveBloquearPorProjecao`, pós-orquestrador) **fica**, como
   backstop para a pista que nasce dentro do memorial do próprio turno (o caso de origem).
   Novo ramo para o estado `'projetado'`: qualquer mensagem recebe
   `mensagemGanhoProjetadoRepetida` (curta — repetir o texto longo lê como loop) **sem chamar o
   LLM**; a única coisa que reabre é a pessoa AFIRMAR a medição (`interpretarGanhoReal → 'real'`).
2. **O prompt proíbe o LLM de conduzir a decisão** — mesmo padrão da jornada-base ("o sistema faz
   essa pergunta, você não"): sem oferecer caminhos, sem repetir a recusa, apenas reagir aos avisos
   `[SISTEMA]`.
3. **Guarda de NEGAÇÃO nas pistas afirmativas** (`negavel: true` + `NEGACAO_ANTES`). Um pré-flight
   do detector sobre os **29 cenários E2E reais** apontou 1 falso positivo: o briefing do
   `custo-evitado-puro` diz _"já foi cancelado na prática (**não é projeção**, já aconteceu)"_ — a
   palavra-gatilho dentro de uma negação que afirma o contrário. Depois da guarda: **0 de 29** armam
   o gate à toa. As pistas que JÁ SÃO negação (`nao-e-medido`, `sem-historico`, `ainda-nao`) não
   levam o flag — nelas a negação é o próprio sinal.

**Também corrigido: os briefings de receita da suíte E2E.** Eles diziam só "gera R$8000/mês de
receita incremental", sem afirmar medição — então o responder respondia com honestidade
("estimativa do briefing") e o portão passava a recusar, quebrando `receita-pura`. Como todo
cenário representa um projeto **em produção** (a premissa da Etapa 1), os 6 racionais e 3 briefings
de receita passaram a declarar desde quando roda e **onde o número é apurado**. É leitura correta do
cenário, não afrouxamento do gate.

**Validação na staging (2ª rodada, `edf400b4`, 04/08/2026):**

| Cenário | Resultado |
|---|---|
| A — reprodução do caso real (falas do autor, 1% "não medido") | gate perguntou **1×** (2 botões, ancorado na Etapa 1) → clique em "ainda é expectativa" → **BLOQUEOU** com as duas saídas → **nenhum** preview/complete → submissão barrada |
| B — regressão, receita medida de verdade | gate **não apareceu** → preview → complete → submetido com `valor_ganho_mensal = 8000`, memorial em passado/presente ("passou a recuperar… Antes… depois") |

Harness novo: `scripts/e2e/validar-ganho-projetado.mjs` (respostas SCRIPTADAS com as falas reais
do caso, em vez do LLM responder — o ponto é exercitar o caminho exato que falhou). Aborta se
`E2E_BASE_URL` não for a staging. 23 projetos de teste limpos via `/api/admin/e2e-cleanup`.

**Sintoma.** O projeto **"Automação cadastro de novos cliente"** (`a2172a9ff26a6a26cdd073b91efdb86d`,
Eduardo Santana / B2B GOBEAUTE, submetido 28/07/2026) entrou na planilha com **R$ 10.000/mês de receita
incremental** — um número que o próprio autor declarou, por escrito e no chat, **não ter sido medido**.
A conversa (15 mensagens, recuperada pelo Investigador) é inequívoca:

- **msg 8** — o agente desconfia: _"existe checkout/pedido direto na LP ou esse valor vem de leads que
  passam a converter mais depois?"_
- **msg 10** — insiste: _"que dado real ou evidência sustenta o 1% de conversão usado na conta?"_
- **msg 11** — o autor responde com total honestidade: _"é uma premissa conservadora, **não um número
  medido** — **ainda não temos histórico** de checkout self-service porque ele é justamente o que o
  projeto habilita… a ideia é validar com os primeiros meses e recalibrar."_
- **msg 12 (14 segundos depois)** — o agente gera o **preview** e **copia a confissão para dentro do
  memorial**: _"A taxa de 1% não é histórico medido; é uma premissa de piso, 20 vezes abaixo da conversão
  humana atual."_
- **msg 13/14** — "Aprovado" → `complete`. `valor_ganho_mensal = 10000`, `tipo_saving = mensal`.

Agravante: a **documentação aprovada no mesmo projeto** dizia que o endpoint `POST /api/b2b-leads` — a
peça que recebe o lead e viabiliza o pedido — **ainda precisava ser implementada**, e que 3 das LPs
estavam pendentes. O mecanismo que gera a receita não existia em produção. O analisador chegou a
registrar o risco (_"pode superestimar o ganho se não houver fechamento realmente automatizado"_) e
**aprovou 11/13**.

**Causa-raiz — duas falhas somadas.**

1. **`buildReceitaPrompt` era o ÚNICO dos três prompts financeiros SEM o portão "real × projetado".**
   `buildSavingPrompt` e `buildSavingCustoEvitadoPrompt` tinham o bloco completo (detectar sinais →
   parar → perguntar 1× → não previewar se for expectativa). A receita tinha **duas linhas genéricas**
   sob "REGRAS ANTI-EXTRAPOLAÇÃO" (_"deve refletir ganho REAL… não projeções otimistas"_) — o bastante
   para o LLM **questionar** (ele questionou, duas vezes), nada para **barrar**.
2. **Prompt sozinho não segura** — a mesma lição do Gostream (gate ≥44h), do custo evitado puro e do
   Sucesso.AI (sobreposição): o agente percebe, avisa, e completa igual. Aqui houve um agravante novo:
   ele "resolveu" o conflito **escrevendo a ressalva dentro do memorial**, o que dá aparência de rigor e
   não desconta nada — a planilha recebe o valor como ganho apurado e a gestão soma.

E, atravessando as duas: a **premissa nº 1 do formulário** (a pergunta da Etapa 1 _"este projeto já está
em produção?"_, que o `validarEtapa1` usa para **bloquear** o avanço quando a resposta não é "sim") era
**invisível ao agente**. `prodStatus` vive só no frontend — não está no payload, no SQLite, no
`ProjetoContexto` nem em prompt nenhum. O agente nunca pôde dizer "você declarou que já está rodando".

**Fix — prompt em fonte única + gate determinístico.**

- **`blocoGanhoRealProjetado(modo)`** (`agents/orchestrator.ts`) — FONTE ÚNICA do portão nos 3 modos
  (`saving` · `custo_evitado` · `receita`). Os dois blocos que existiam eram digitados à mão e agora saem
  da constante; a receita **passa a ter portão**. O texto ancora explicitamente na premissa da Etapa 1,
  manda **cruzar com a doc aprovada** (peça essencial pendente ⇒ ganho não realizado) e **proíbe** a saída
  que o caso tomou (ressalva no memorial + preview). Reforço específico de receita: taxa de conversão /
  ticket **escolhidos** são premissas, não base de cálculo.
- **`agents/ganho-projetado.ts`** — gate determinístico, espelhando o módulo do `sobreposicao-receita`
  (PR #230): `detectarGanhoProjetado` varre **memorial do turno + falas do usuário na fase + racional do
  formulário** contra a lista DECLARADA `PISTAS_PROJECAO` (16 pistas, cada uma com rótulo para log/teste).
  Havendo pista, o backend troca o preview/complete por **uma pergunta de 2 botões**.
  Estado `saving.ganho_real` / `receita.ganho_real` (backend-only, re-mesclado a cada turno):
  `null → 'pendente' → 'reperguntado' → terminal`.
  - `'real'` → libera **para sempre** + nudge `[SISTEMA]` exigindo memorial em passado/presente, **há
    quanto tempo roda** e **onde o número é medido**.
  - `'projetado'` → **BLOQUEIA o preview** com a mensagem que oferece as **duas saídas reais**: voltar
    quando houver medição, ou marcar **especial** na Etapa 2 (validação 100% humana, sem memorial).
  - 2 respostas ambíguas → `'nao_respondido'`: libera, mas o memorial carrega _"Não foi confirmado se o
    ganho já está medido na prática — conferir na triagem."_
- Rede adicional de prompt em `buildReceitaPreviewPrompt` (não permite `complete` no "aprovado" quando o
  memorial ainda tem linguagem de projeção), **suprimida** quando o gate já resolveu — reinterrogar o que
  o gate coletou foi a origem das perguntas pós-preview no gate de economia alta.

**Anti-loop (o repo já queimou 2×: as 38 perguntas do `[1.4]` e o forçamento do carga×escala).** Quatro
travas por construção: **(a)** no máximo 2 perguntas; **(b)** estados terminais **absorventes** (nenhum
ramo volta a `null`/`'pendente'` — é onde o gate do teto guarda risco); **(c)** saída por **CLIQUE**, não
por juízo do LLM sobre texto livre; **(d)** o bloqueio lê o **estado VIVO**, nunca o snapshot do topo do
turno. Ausência de pista marca `'real'` para não reavaliar a cada turno.

⚠️ **`'projetado'` bloqueia o preview para sempre — e isso é a função do gate, não um bug.** Não é beco
sem saída: reenviar o formulário determinístico da fase financeira chama `iniciarSaving`/`iniciarReceita`,
que apaga as mensagens da fase e **zera** o estado; e marcar o projeto como especial na Etapa 2 desvia do
memorial. As duas saídas estão escritas na mensagem de bloqueio (com teste que garante isso).

**Decisões de precisão do detector (para não punir quem fez certo).** Um falso positivo custa **uma**
pergunta de dois botões, então a lista pode ser generosa — mas ficaram **de fora** de propósito:
`"estimativa"`/`"estimo"` soltos (é a palavra do **saving contrafactual** legítimo, o caso mais comum do
produto) e futuro genérico (`"o backend deve validar"`, `"vai rodar todo dia"`) — o futuro só conta colado
a **verbo de ganho** (`vai gerar`, `deve reduzir`). Há teste de regressão para os 8 negativos.

⚠️ **O `\b` do JS é ASCII-only** — a mesma armadilha do gate `[1.4]`: um radical seguido de fronteira de
palavra (`nao foi medid` + fronteira) **nunca** casa `"medido"`, porque a fronteira exige um
não-caractere depois do `d`. Nenhuma pista leva fronteira no fim.

**Onde aterrissou.**

| Arquivo | O quê |
|---|---|
| `src/lib/agents/ganho-projetado.ts` | **novo** — módulo do gate: pistas, detector, pergunta/interpretação, nudges, decisores puros |
| `src/lib/agents/orchestrator.ts` | `blocoGanhoRealProjetado(modo)` (fonte única); portão injetado em `buildReceitaPrompt`; os 2 blocos inline substituídos; `blocoProjecao` no preview de receita |
| `src/lib/agents/types.ts` | `ganho_real` em `SavingColetado` e `ReceitaColetada` (+ `savingVazio`/`receitaVazia`) |
| `src/lib/chat.functions.ts` | ramo de resposta (1º da cadeia) + gate de bloqueio (antes da jornada) + re-merge nos dois lados |
| `src/lib/testes/prompt-registry.ts` | descrições de `saving` e `receita` atualizadas (regra 3) |
| `tests/gate-ganho-projetado.test.ts` | **novo** — 54 casos, incluindo as falas e o memorial REAIS do projeto de origem |
| `tests/agents-types.test.ts` | guard de nº de chaves de `savingVazio` (22 → 23) |

**Lição que não pode regredir.** Quando o agente **avisa e passa**, o aviso não é uma trava — vira
justificativa. E quando o autor é **honesto** sobre a incerteza, o sistema precisa honrar a honestidade
**barrando o número**, não registrando a ressalva junto do valor: quem lê a planilha soma a coluna, não o
memorial.

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

## Investigador levava minutos e mentia nos contadores ("0 submetidos" com 289 edições) — N+1 de chat derrubava `/projetos` (04/08/2026)

**Sintoma.** O painel `/investigador` demorava **minutos** para listar — quando listava. Ao carregar,
mostrava **0 Submetidos · 289 Edições · 0 Abandonados**, o que é impossível: todo reenvio pressupõe uma
submissão. Console do navegador: `500` seguido de vários `503` em
`/api/admin/investigador/projetos`.

**Causa.** Duas, somadas.

1. **N+1 no servidor.** `getProjetosInvestigador` (`investigador.functions.ts`) fazia
   `await getChatMessages(p.id)` **dentro do laço de projetos** — um round-trip por projeto, sequencial,
   com `SELECT *` trazendo o **`content` inteiro** de cada mensagem, só para calcular 4 escalares (fase
   atual, 3 contagens e a última atividade). Com centenas de projetos o request nunca terminava: nos logs
   do Godeploy toda chamada saía `canceled` (uma como `Network connection lost.`), enquanto `/stats` e
   `/edicoes` respondiam `ok` em 100% das vezes. Agravantes: `chat_messages` **não tinha índice em
   `projeto_id`** (cada uma das N consultas varria a tabela inteira) e `getProjetosWithArea()` fazia
   `SELECT p.*`, arrastando `memorial_calculo` e demais blobs de TODOS os projetos para uma listagem que
   não os exibe. O `getProjetoInvestigadorDetalhes` ainda carregava a tabela inteira para um `.find()`.
2. **Falha silenciosa no front.** As 3 abas não têm a mesma fonte: `Submetidos`/`Abandonados` filtram a
   lista `projetos` (`isSubmetido` = `!!submitted_at`), e `Edições` vem de `/edicoes`, endpoint separado.
   Com `/projetos` morto, `projetos` ficava `[]` e o `Promise.allSettled` — que existe justamente para uma
   falha não zerar as outras listas — **engolia o erro**: `setLoading(false)` rodava igual e a tela
   apresentava "0" como se fosse resposta legítima. Daí a combinação impossível.

**Fix.**
- **Uma query agregada** para o chat de todos os projetos (`getChatMetricsPorProjeto`,
  `client.server.ts`): contagens via `SUM(CASE …)`, `MAX(created_at)` para a última atividade e a fase
  pela última mensagem do assistente que declara uma (`ROW_NUMBER() OVER (PARTITION BY projeto_id …)` +
  `json_extract`). ⚠️ O `json_valid` vai dentro de um **`CASE`**, não num `AND`: o `content` nem sempre é
  JSON e `json_extract` sobre texto solto lança erro — o `CASE` garante a ordem de avaliação que o `AND`
  não garante.
- **Listagem enxuta** (`getProjetosParaInvestigador`): só as ~15 colunas exibidas, sem blobs. Detalhe usa
  `getProjetoWithAreaById` (busca direta por id; ali o `p.*` é barato, uma linha).
- **Índice** `idx_chat_messages_projeto_id` — toda leitura de chat filtra por `projeto_id`.
- **Front:** guard de requisição em voo (`emVooRef`) para o polling de 8s parar de **empilhar** chamadas
  sobre um endpoint já sobrecarregado, e banner de falha (`falhas`) — o dado velho continua na tela, mas
  rotulado como incompleto, para que "0" nunca mais seja lido como verdade.

**Onde aterrissou:** `src/integrations/db/client.server.ts` (`getProjetosParaInvestigador`,
`getProjetoWithAreaById`, `getChatMetricsPorProjeto`, `PROJETO_INVESTIGADOR_COLS`) ·
`src/integrations/db/schema.ts` (índice) · `src/lib/investigador.functions.ts` (`faseAtualDeMetricas`,
laço sem I/O) · `src/routes/_authenticated/investigador.tsx` (guard + banner) ·
`tests/investigador-n1.test.ts` (guarda de regressão: `getChatMessages` **não** pode ser chamado pela
listagem; mapeamento das métricas; `faseAtualDeMetricas` espelhando o `inferFaseAtual`).

**Validação (staging, 575 projetos).** Todas as chamadas a `/api/admin/investigador/projetos` saíram
`outcome: ok` — zero `canceled` —, a lista renderizou de imediato e os rascunhos abandonados exibiram
`0/1 msgs`, "Parou em: Documentação" e "inativo há 11h14min", confirmando que contagem, fase
(`json_extract`) e `ultima_atividade` vêm corretas do datasource do Godeploy. O SQL foi exercitado antes
em `better-sqlite3` com `content` não-JSON, mensagem `complete` sem fase e empate de `created_at`.

⚠️ **Mesma lição do `getAllReenvios`** (bug de jul/2026 que zerava o Investigador): nesta tela, **agregue no
SQL e trafegue só escalar**. Não reintroduzir `getChatMessages` por projeto na listagem.

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

---

## Motivo da reprovação ilegível no card de "Meus Projetos" (05/08/2026)

**Sintoma.** O autor de um projeto reprovado via o motivo escrito pelo analisador/triagem como um bloco de
texto cinza minúsculo e apertado, e o card ficava desproporcionalmente alto. Relato do usuário: *"a
justificativa fica um texto cinza de forma gigante e apertada, horrível de ler"*.

**Causa.** Três problemas somados no mesmo bloco (`AvisoPendencia`, então local a `meus-projetos.tsx`):

1. **Tipografia e medida.** 11px com `leading-snug` (~1,375) e `#334155` a 90% de opacidade sobre fundo
   tingido. O bloco ocupava a largura disponível sem teto de medida → 120+ caracteres por linha em desktop.
2. **Zero hierarquia.** O texto institucional ("a análise concluiu que…") e o motivo REAL saíam no MESMO
   tamanho, num único `<span>` corrido, com "Motivo:" como rótulo *run-in*. O que o autor precisa ler estava
   enterrado no que ele não precisa.
3. **Sem teto de altura.** A coluna "Motivo Reprovado" aceita **4000 caracteres** (`dashboard-admin.functions.ts`)
   e a triagem escreve texto livre com quebras de linha. Um único projeto reprovado deixava o card ~8x mais
   alto que os vizinhos e a lista deixava de ser escaneável.

E um quarto, que só apareceu no ambiente real (o mock em largura livre não reproduziu): o bloco vivia
**dentro da coluna esquerda** do cabeçalho do card, que a fileira de 4 botões da direita esmaga para ~250px.
Qualquer teto de medida era irrelevante — o texto virava uma tira de ~30 caracteres por linha. O mesmo
esmagamento cortava o **nome do projeto** em ~28 caracteres, numa "barreira invisível": o espaço à direita do
nome está livre (os botões ficam na linha de baixo), mas o flex não reflui em volta do texto.

**Fix.** `AvisoPendencia` extraído para `src/components/aviso-pendencia.tsx` como fonte única dos 3 tons
(legado · reenvio · reprovado), consumido pela lista e por `/projeto/$id` — que redigiam blocos separados,
com tamanhos divergentes (11px × 12,5px). O bloco foi reposicionado como **parecer**, não alerta:

- **Estado padrão = tira de UMA LINHA** (ícone + veredito + "Ver motivo"/"Ver o que ajustar"); o parecer abre
  no clique. A tira INTEIRA é o `<button aria-expanded>` — alvo de clique generoso e um único stop de teclado.
- Aberto: o motivo ganha **superfície própria** (placa clara sobre o painel tingido), **13px/1.6 em slate-800**
  e medida travada em **72ch**; o texto institucional vai para baixo, em 11,5px.
- **Ordem invertida:** veredito → motivo → texto institucional.
- Os avisos saíram da linha do cabeçalho (agora abaixo, na largura inteira do card) e o **nome do projeto
  ganhou linha própria**.
- Rótulo da placa nomeia QUEM escreveu ("Parecer da análise") em vez de repetir "reprovado", que o selo de
  status e o título da tira já dizem.

**Decisões que não podem regredir:**
- ⚠️ **Não abrir por padrão.** Foi a primeira tentativa (painel aberto com clamp de 4 linhas +
  `ResizeObserver` medindo o transbordo) e o usuário **reprovou**: *"o card fica gigante com essa aba cinza"*.
  O clamp resolvia o texto de 4000 caracteres, mas não o volume no estado de repouso. Com tudo colapsado, a
  lógica de medição deixou de existir — não a reintroduza.
- ⚠️ **O nome do projeto NÃO volta para a linha dos botões** (o truncate voltaria a cortar em ~28 chars). O
  `truncate` fica como rede para nome absurdo, agora em ~90 caracteres.
- ⚠️ **Estado nunca só por cor** (regra 11): ícone + rótulo escrito em todos os tons.

**Onde aterrissou:** `src/components/aviso-pendencia.tsx` (novo) · `src/routes/meus-projetos.tsx` ·
`src/routes/projeto.$id.tsx` · `CLAUDE.md` (bullet "Três estados de pendência").

**Ponto cego de validação.** A tela `/projeto/$id` **não foi exercitada no staging**: ela não lê o Sheets (por
decisão, ver comentário em `meus-projetos.functions.ts`) e usa o espelho SQLite `motivo_reprovacao` escrito
pelo analisador; os projetos semeados para o teste visual existiam só na planilha, então o bloco não
renderizava lá. O componente é o mesmo da lista, mas a tela de detalhe só foi verificada por leitura de
código. Mobile também só por raciocínio de CSS (o `resize_window` do Chrome não pegou).

## Zona cinzenta indevida: campo LEGADO vazio derrubava a rastreabilidade de TODA submissão nova (05/08/2026)

**Sintoma.** "Bot de Faturamento V2" (Mario Monteiro, submetido 05/08/2026 13:14) saiu **Zona cinzenta**
mesmo tendo **aprovado com 11/13** na régua de qualidade e mesmo tendo eliminado um contrato de equipe
terceirizada de **R$ 3.600/mês**. A justificativa gravada na coluna `Classificação` dizia, textualmente, que
o memorial *"não aponta um indicador nomeado e verificável **com ponteiro movido preenchido**"*.

**Causa 1 — o campo LEGADO vazio era lido como "o autor não respondeu".** `buildUserMessage` mandava
`ponteiro_movido: null` e `ponteiro_evidencia: null` em **toda** submissão. Esses campos são **LEGADO** desde
03/08/2026 (os cards saíram da Etapa 2 e nada mais os escreve), então chegam `null` sempre — não por omissão
do autor, mas porque a pergunta não existe mais. O prompt até avisa que são legado e que a rastreabilidade
vem da seção do memorial, mas o payload contradizia o prompt: presente-e-nulo lê como ausência de resposta,
não como campo aposentado. Isso enviesava **todas** as submissões novas para zona cinzenta, não só esta.

**Causa 2 — o analisador recebia o total do custo evitado, mas não o nome do contrato.** O payload trazia
`custo_evitado_reais: 3600` e nada mais: `custo_evitado_itens` (que nomeia *"Equipe Terceirizada — R$ 3.600,00
(mensal)"*) nunca era enviado, ao contrário do `custo_projeto_itens`, que já ia. E a régua não declarava que
contrato encerrado **é** indicador — então o modelo procurou painel/KPI, não achou, e rebaixou. Um contrato
que parou de ser pago é o eixo **custo** da própria taxonomia do analisador, e é mais auditável que dashboard.

**Fix (3 edições, 2 delas determinísticas — mexem no INPUT, não na persuasão):**

1. `ponteiro_movido`/`ponteiro_evidencia` só entram no payload quando **realmente preenchidos** (spread
   condicional). Submissão legada com o campo escrito segue valendo como resposta do autor; submissão nova
   simplesmente não menciona o campo. **Zero mudança de prompt** — a frase que já existia lá ("só existem em
   submissões da época da pergunta no formulário") passou a ser literalmente verdadeira.
2. `custo_evitado_itens` passou a ser enviado dentro de `memorial_saving`, espelhando exatamente o
   `custo_projeto_itens` vizinho (mesmo `parseJson`, mesma forma) — nenhum conceito novo para o modelo.
3. **Uma frase** no critério 3 da régua, encostada no aviso do "próprio entregável NÃO conta" (que é onde o
   modelo estava lendo quando errou): contrato/serviço externo **ENCERRADO** é indicador nomeado, conferível
   e já é um antes × depois; não se rebaixa por faltar painel ou KPI.

**Por que NÃO virou gate determinístico.** `normalizarClassificacao` é declaradamente *só rebaixa, nunca
promove*. Promover `zona_cinzenta → claro_sim` por existir custo evitado quebraria a invariante e passaria
batido um custo evitado inventado. E o custo de um falso `zona_cinzenta` é **uma triagem humana** — não é
usuário travado, diferente do loop do `[1.4]` ou do ganho projetado virando receita apurada. As duas correções
determinísticas já tiram um sinal falso e colocam um verdadeiro; só a terceira é prompt, e é regra, não
persuasão.

**Onde aterrissou:** `src/lib/agents/analyzer.ts` (`buildUserMessage` × 2 + `buildSystemPrompt` × 1) ·
`src/lib/testes/prompt-registry.ts` (descrição, regra 3) · `tests/analyzer-rastreabilidade-custo.test.ts`
(novo, 8 casos: campo omitido quando nulo/vazio, enviado quando preenchido, itens nomeados no payload,
e a régua nova sem afrouxar a trava do entregável) · `CLAUDE.md`.

**Achado adjacente, NÃO corrigido aqui (inversão Real/Escalado).** O mesmo projeto gravou
`Saving Horas Real = 0` e `Escalado = 10`, com a justificativa automática *"Ninguém fazia esta tarefa
manualmente… a carga humana real é 0h"* — mas a conversa e o memorial dizem que o Supervisor gastava 10h/mês
(conferência 3h + ajustes/filtros 4h + pós-processamento 2h + consolidação 1h) e hoje gasta 0. Causa: o ramo
**2c** da árvore ("há trabalho manual ADICIONAL que o contrato não cobria?" → **Sim**) mapeia para
`alguem_fazia='nao'` (`submeter.tsx`), e aí `derivarSplitHorasSheet` aplica a regra do contrafactual
(`Real=0, Escalado=TOTAL`). Só que essas horas eram **reais**. O ramo é distinguível sem migração
(`'nao'` **+ com** custo evitado **+ com** linhas = 2c; `'nao'` **sem** custo evitado = contrafactual puro),
mas o `'nao' → Real=0/Escalado=TOTAL` é **decisão fechada de 29/06/2026** — confirmar a intenção de produto
antes de mexer.

## Custo evitado de R$ 324 mil citado no chat: nem questionado, nem gravado — e o erro de submissão mentia sobre a causa (10/08/2026)

**Sintoma (o que a usuária viu).** Stefany Costa, "Plataforma SmartOnline — Captura de XMLs e Recolhimento de
DIFAL" (projeto `dba1cc1c23eb…`, FINANÇAS). Ao aprovar o memorial, o envio morria com:

> "Não é possível submeter este projeto como saving sem ganho mensurável. O ganho precisa vir de uma redução
> concreta de horas OU de um custo externo evitado…"

O memorial aprovado na tela tinha **60h/mês** de redução (Analista Júnior 30h + Analista Sênior 30h, ambos
para 0h). Ela tentou **6 vezes em 25 minutos** (18:37, 18:37, 18:38, 18:59, 19:00, 19:02), reabriu a fase de
saving duas vezes e chegou a trocar o tipo do projeto para receita e voltar — a mensagem dizia que faltava
exatamente o que estava na tela, então não havia o que corrigir.

**Causa A — a mensagem descrevia o gate errado.** O gate é sobre o ganho **LÍQUIDO**
(`economia_reais_mes = horas + custo evitado − custo externo − custo do projeto ≤ 0`), e o texto fixo nunca
mencionava o abatimento. Como o projeto é de escopo externo (Plataforma SmartOnline), o formulário da Etapa 2
**exigiu** o custo da ferramenta; qualquer valor ≥ R$ 1.631,70/mês (o valor das 60h pela tabela `CARGOS`)
zera o líquido. A pessoa não tinha como descobrir isso pela mensagem.

**Causa B — o maior ganho do projeto foi aceito sem uma pergunta e depois descartado.** No meio da fase de
saving ela escreveu *"além dos analistas, quero incluir o saving de quanto **iríamos pagar** de multa e juros
de difal, por não recolher no vencimento"* e, no turno seguinte, **R$ 324.005,09/mês** (média de DIFAL do grupo
de R$ 2.234.517,87 × 14,5% de multa + SELIC). O agente respondeu só *"me informe o valor médio pago e a
periodicidade"* e no turno seguinte **já devolveu o PREVIEW** (log das 18:54:56) — nenhuma pergunta sobre a
natureza do valor. Três redes existiam e nenhuma cobria este caminho:

- a validação de **realidade/atribuição/escopo** do custo evitado (`buildSavingCustoEvitadoPrompt` + backstop
  de `iniciarSaving`) só roda no custo evitado **PURO** (`alguem_fazia === 'externo'`); aqui havia 60h junto,
  então o prompt caiu no bloco de **anti-dupla-contagem** — que trata de sobreposição, não de veracidade;
- o gate **ganho real × projetado** não armou: `PISTAS_PROJECAO` não tem o contrafactual "iríamos pagar" /
  "seria pago", e ela escreveu "histórico real … observado", que lê como medido. (O "ainda está em andamento"
  que ela disse na fase **doc** está fora do escopo do detector, que varre memorial + falas da fase financeira.);
- e no submit o `custo_evitado_reais` é re-derivado dos **ITENS do formulário**
  (`custoEvitadoMensalFromItens`) — com o formulário vazio, virou `null` e o memorial saiu com
  "Custo evitado: N/A". **O valor nunca foi gravado.** Ou seja: o agente coletou um número que o backend não
  tem como persistir, e o líquido continuou sendo só 60h − custo da ferramenta.

⚠️ **A multa é REAL** — o financeiro paga DIFAL em atraso todo mês (confirmado com o autor do projeto). O
defeito não é o número: é ninguém ter perguntado. Para o sistema, "iríamos pagar" tinha a mesma cara de uma
projeção, e ele seguiu como se estivesse tudo resolvido.

**Fix 1 — gate determinístico do custo evitado declarado no chat** (`src/lib/agents/custo-evitado-chat.ts`,
estado `saving.custo_evitado_chat`). `detectarCustoEvitadoNoChat` varre as falas do usuário NESTA fase: valor
em R$ na **mesma** mensagem que vocabulário de gasto (`TERMOS_GASTO`) e — quando o termo é ambíguo
("contrato", "licença", que podem ser o CUSTO do projeto) — também um verbo de evitação (`VERBOS_EVITADO`,
que inclui o contrafactual "iríamos pagar"). Valor já cadastrado como item do formulário **não** arma (lá o
caminho é o certo). Casou → troca preview/complete por **1 pergunta de 2 botões**: *"É gasto real — a empresa
paga (ou pagava) isso e dá para conferir"* × *"É uma estimativa do que aconteceria"*. `'pago'` injeta nudge
[SISTEMA] cobrando as DUAS coisas que faltaram (a seção "Contratos/Serviços Evitados" com o que é, desde
quando parou e **onde se confere**; e o aviso, em uma frase, de que o valor precisa ser cadastrado no campo de
CUSTO EVITADO do formulário, porque valor citado só na conversa não é gravado). `'estimado'` proíbe somar e
segue pelas horas. ⚠️ **Nenhum estado bloqueia para sempre** — diferente do gate de ganho projetado, aqui o
projeto segue pelas horas, que são medidas. ANTI-LOOP pelas 4 travas de sempre: máx. 2 perguntas, máquina
**monotônica** `null→pendente→reperguntado→terminal`, saída por **CLIQUE** e leitura do **estado VIVO** (nunca
o snapshot do topo do turno — o loop de 38 perguntas do `[1.4]`). Fica FORA do custo evitado puro, que já tem
a sua validação. Teste: simulação de 20 turnos ininteligíveis + os falsos positivos que ele não pode ter
(percentual/horas viram valor; "contrato custa R$ X" sem verbo de evitação).

**Fix 2 — mensagens de bloqueio alinhadas com a causa e com direcionamento**
(`src/lib/mensagens-submissao.ts`, módulo PURO, fonte única dos 5 bloqueios). `mensagemSavingSemGanho` é
MONTADA com os números do projeto e se adapta: com custos declarados, diz que *"as 60h/mês economizadas não
cobrem os custos que você declarou na Etapa 2 — ferramenta externa (R$ 2.500,00/mês)"* e ensina o que fazer
(conferir valor **e periodicidade** — a pegadinha do total do ANO marcado como mensal; cadastrar o gasto
eliminado no campo de CUSTO EVITADO, avisando que valor citado só na conversa não é gravado; ou marcar o
projeto como ESPECIAL); sem ganho nenhum, mantém o texto antigo, que só estava certo nesse caso. ⚠️ **O R$ das
HORAS não aparece** — valor/hora por cargo é escondido do usuário de propósito (`step3-chat.tsx`), então a
explicação é qualitativa de um lado e numérica do outro (os custos foram digitados pela própria pessoa).
Idem para receita zerada, receita incompleta, doc ausente e nome duplicado: todas terminam em "Para
corrigir…". No frontend, o toast perdeu o prefixo "Erro ao enviar projeto:" (empurrava a orientação para fora
da vista) e ganhou 20s de duração.

**Onde aterrissou:** `src/lib/agents/custo-evitado-chat.ts` (novo) · `src/lib/mensagens-submissao.ts` (novo) ·
`src/lib/agents/types.ts` (`custo_evitado_chat` + `savingVazio`) · `src/lib/chat.functions.ts` (detecção,
turno de resposta, re-merge do estado, bloqueio do preview, 5 mensagens de submissão) ·
`src/routes/submeter.tsx` (toast) · `src/lib/testes/prompt-registry.ts` (regra 3) ·
`tests/custo-evitado-chat.test.ts` + `tests/mensagens-submissao.test.ts` (novos, 34 casos) ·
`tests/agents-types.test.ts` (contrato de campos) · `CLAUDE.md`.

**Ponto cego que segue aberto.** O valor de custo evitado continua entrando **só pelo formulário** (decisão de
arquitetura: o R$ é escondido do LLM e os itens são a fonte da verdade, inclusive para o gate de sobreposição
receita × custo evitado). O gate agora AVISA a pessoa, mas não transporta o número do chat para o formulário —
se ela ignorar o aviso, o valor continua não sendo gravado. Fazer o transporte exigiria o LLM escrever em
`custo_evitado_itens`, o que reabre a porta que a decisão de 04/08/2026 fechou.

### Validação em chat real (staging, 11/08/2026) — 2 defeitos que os unitários não pegariam

Os 3 cenários rodaram ponta a ponta no staging (`edf400b4`), pela API autenticada da própria
página. **O gate armou no caso real** e a mensagem de submissão saiu com os números certos
(`R$ -868,30` = 60h − R$ 2.500 da ferramenta). Dois defeitos apareceram:

**(a) A pergunta citava a BASE DE CÁLCULO, não o ganho.** Com a fala real — *"média de
recolhimento de DIFAL das 7 empresas (R$ 2.234.517,87/mês) … o custo evitado é de
R$ 324.005,09/mês"* — o detector pegava o MAIOR valor e perguntava por *"R$ 2.234.517,87 de gasto
evitado"*: um número que a autora nunca chamou de gasto evitado. Fix: `escolherValorDoGasto` —
vence o valor mais **próximo** (em caracteres) de um termo de `TERMOS_GASTO`; empate → o maior.
Só afeta o TEXTO da pergunta (nenhum R$ entra em cálculo por aqui), mas era o suficiente para a
pessoa achar que o sistema não entendeu nada.

**(b) O nudge não segurou — de novo.** Confirmado "é gasto real", o agente devolveu o preview no
MESMO turno com **"Contratos/Serviços Evitados: N/A"** e **sem** avisar que o valor precisa ir ao
formulário. Ignorou as duas instruções do nudge. É a 3ª vez que este repo paga por isso (Gostream
no gate ≥44h; o portão do ganho projetado). E o aviso é a metade ÚTIL do gate: sem ele a pessoa
confirma que o gasto é real e segue sem saber que o número não será gravado. Fix: no turno do
clique, o backend responde **ele mesmo** (`mensagemCustoEvitadoPago`, sem chamada de LLM) com o
aviso e a pergunta "onde esse número pode ser conferido?"; o nudge do memorial entra no turno
SEGUINTE, uma única vez, com a resposta da pessoa. Isso exigiu o estado `'pago_registrado'` —
sem ele o nudge seria reinjetado a cada turno e o LLM repetiria o aviso para sempre.

**O que passou intacto:** o ramo `'estimado'` (R$ 45.000 citados como estimativa **não** entraram
no memorial, custo evitado ficou N/A e o saving seguiu pelas 18h/mês) e a ausência de falso
positivo (*"o contrato do Metabase custa R$ 3.600,00 por mês e continua sendo pago"* — termo
ambíguo sem verbo de evitação — não armou o gate em nenhum turno, até o preview).

**Onde aterrissou:** `src/lib/agents/custo-evitado-chat.ts` (`escolherValorDoGasto`,
`extrairValoresComPosicao`, `mensagemCustoEvitadoPago`, estado `'pago_registrado'`) ·
`src/lib/agents/types.ts` · `src/lib/chat.functions.ts` (ramo (7b) novo) ·
`src/lib/testes/prompt-registry.ts` · `tests/custo-evitado-chat.test.ts` (+6 casos) · `CLAUDE.md`.

## Fallback do LLM era a REGRA, não a exceção — e trocava o modelo por baixo (11/08/2026)

**Sintoma.** Ao trocar o `LLM_MODEL` de prod para `gpt-5.6-sol`, a pergunta do Luis foi: *"sempre
que o proxy demora mais de 25s vai para a IA mesmo? Ler documentação e montar memorial demoram
bastante — esses sempre vão cair no fallback?"*. Sim. Medindo uma hora de logs de produção
(18:01→19:05, 50 chamadas de LLM): **29 abortaram nos 25s = 58%**.

| Etapa | Chamadas | Fallback |
|---|---|---|
| `atualizar-metadados` | 4 | **100%** |
| fase `doc` | 2 | **100%** |
| `doc_preview` (compilar doc) | 9 | 67% |
| fase `saving` (montar memorial) | 30 | 50% |
| `saving_preview` (turno curto) | 3 | 0% |

**Causa.** `LLM_TIMEOUT_MS` era **25s para os dois lados** e a chamada **não é streaming**: o
`AbortController` mede o tempo de gerar a **resposta inteira**, não o primeiro byte. Então o
timeout funcionava como régua de **TAMANHO**, não de saúde do proxy — um memorial de ~3.800
caracteres não sai em 25s. A distribuição prova: os turnos longos caíam quase sempre, os curtos
nunca.

**Por que isso importa além da latência.** No fallback o modelo passa a ser o
`LLM_FALLBACK_MODEL` (default `gpt-5.4-mini`). Ou seja, **a metade pesada do produto —
documentação e memorial — rodava no modelo do plano B mesmo com outro modelo em `LLM_MODEL`**.
Trocar de modelo não surtia efeito justamente onde a qualidade mais importa, e o log dizia
"Falha de TIMEOUT" como se fosse instabilidade do gateway.

**Fix.** Relógios próprios: **proxy 60s** (`LLM_TIMEOUT_PROXY_MS`) e **fallback 25s**
(`LLM_TIMEOUT_FALLBACK_MS`). Aguardar `fetch` não consome CPU no Worker, e a espera de quem está
na tela **já era maior** — a pessoa pagava os 25s do proxy **mais** a geração inteira no
fallback. O fallback fica curto de propósito: a `api.openai.com` direta é rápida (é o proxy que
é lento) e os memoriais dele fechavam dentro dos 25s; assim o pior caso não é esperar 60s duas
vezes quando o proxy está realmente pendurado.

**O que NÃO foi feito na época (decisão do Luis) — ✅ ENTREGUE DEPOIS (24/08/2026).** Streaming,
que resolveria de raiz: o relógio passaria a medir o **primeiro byte**, o fallback voltaria a ser
só plano B, a pessoa veria o texto aparecendo em ~2s em vez de encarar 40s de tela parada, e
pararíamos de pagar DUAS gerações nos turnos que hoje abortam. O custo era o contrato: o
orquestrador consome um JSON **completo** (`{type, content, saving…}`), então streamear até a tela
exige buffer + parse incremental ou mudar o protocolo. → **Feito como projeto separado** e hoje em
produção atrás da flag `LLM_STREAMING` (default OFF): a prosa (`content`) streama token a token e o
envelope estrutural resolve no fim, depois dos gates; o timeout virou **por stall** (primeiro-byte +
gap entre chunks) no lugar de régua de tamanho. Ver **`SPEC_FEATURES_NOVAS.md` → "Streaming SSE das
respostas do chat"** e `docs/plans/streaming-latencia-ia.md`. ⚠️ O caso de fallback do memorial não
sumiu de todo: o modelo pesado do Codex às vezes "pensa" >25s antes do 1º content e o gap-timer o
joga no gpt-5.4-mini — mas isso NÃO é a régua-de-tamanho de antes (que pegava a maioria dos turnos
longos).

**Onde aterrissou:** `src/lib/llm.ts` (2 constantes + comentários) ·
`tests/llm-fallback.test.ts` (teste de regressão com fake timers: 25s NÃO derruba mais o proxy,
60s derruba e cai no fallback) · `CLAUDE.md`.

## "Memorial aprovado!" prometia uma aprovação que não existe (12/08/2026)

**Sintoma.** Ao fechar o memorial financeiro, o agente respondia **"Memorial aprovado! Sua submissão
está completa e será enviada para análise."** — e o usuário ficava sem saber o que tinha acontecido:
a frase afirma **duas** coisas que não são verdade nessa altura. (1) Nada foi **APROVADO**: a triagem
humana da RPA só olha o projeto depois de submetido, e o parecer do líder também. (2) A submissão
**não** está completa: a tela seguinte é a revisão final, com o botão **"Enviar para Triagem"** ainda
por clicar. Ou seja, a mensagem soava a veredito da empresa e a "já enviei", justo no ponto em que o
usuário ainda tem trabalho a fazer.

**Causa.** A frase é **copy do LLM**: ela vem do exemplo de `type:"complete"` dentro dos prompts de
preview financeiro (`orchestrator.ts`), e o modelo a copia literalmente. Estava **digitada 3×** — uma
em cada prompt (`buildSavingPreviewPrompt`, `buildSavingCustoEvitadoPrompt`,
`buildReceitaPreviewPrompt`) —, sem fonte única, prontas para divergir. O sentido pretendido era
"eu, o agente, consegui montar seu memorial de forma válida", mas o texto escolhido dizia outra coisa.
Note que a tela de revisão final **já** usava o tom certo ("Tudo pronto! / Revise os documentos abaixo
antes de enviar") — só a fala do bot destoava.

**Fix.** FONTE ÚNICA `mensagemMemorialPronto(modo)` (`src/lib/agents/orchestrator.ts`, junto das outras
constantes de prompt), consumida pelos 3 prompts por interpolação:

> **Memorial pronto!** Revise abaixo e me diga se ficou algum problema — eu ajusto. Se estiver tudo
> certo, é só enviar para a triagem.

(`modo: 'receita'` troca só o título para "Memorial de receita pronto!".) Nenhum estado interno mudou —
`type:'complete'`, `approvedSavingPreview`, `preview_aprovado`, `chatComplete`, os botões "Aprovar"/
"Pedir ajustes" e o chip "Aprovado" do card da revisão final continuam iguais: "aprovado" ali é o
registro do **clique do usuário**, não uma afirmação sobre a empresa. ⚠️ A frase **não pode ter aspas
duplas** — ela é interpolada DENTRO do exemplo de JSON do prompt (`{"type":"complete","content":"…"}`)
e uma aspa quebraria o exemplo (há teste para isso).

⚠️ **Limite conhecido, aceito:** isto é **prompt, não gate** — o LLM pode redigir a frase à sua
maneira. Diferente dos casos de "prompt não segura" deste repo (Gostream, ganho projetado,
SmartOnline), aqui a falha é **cosmética** (uma frase antiga), não um número errado gravado na
planilha; por isso não se trocou o `content` do turno por texto determinístico do backend, que
apagaria os ajustes que o agente às vezes descreve no mesmo `content`.

**Onde aterrissou:** `src/lib/agents/orchestrator.ts` (constante + 3 interpolações) ·
`src/lib/testes/prompt-registry.ts` (3 descrições — regra 3; o `prompt-inspector.tsx` renderiza os
prompts REAIS via `getPromptText`, então não tem literal a atualizar) ·
`tests/orchestrator-prompts.test.ts` (3 asserts novos: os 3 prompts usam a fonte única · nenhum diz
"Memorial aprovado!"/"Sua submissão está completa" · a frase não tem aspas duplas) ·
`tests/agents-types.test.ts` (fixture) · `CLAUDE.md`.

## Navegação lenta entre páginas: ~750 ms de overhead da plataforma × requisições demais (12/08/2026)

**Sintoma.** Trocar de página no GoDocs levava **7–8 s**. Reclamação sem número; a primeira hipótese
óbvia ("o bundle está pesado") estava **errada**.

**Medição (prod, edge GIG/Rio, conexão já quente).** O baseline externo separa rede de plataforma:

| O quê | Tempo |
|---|---|
| `https://cloudflare.com/cdn-cgi/trace` (rede do usuário) | **55 ms** |
| `/favicon.svg` do GoDocs (arquivo estático) | **~800 ms** |
| `/api/auth/me` (endpoint que não faz trabalho nenhum) | **~800 ms** |
| `/api/meus-projetos` | **~3.000 ms** |

**Causa.** Três coisas se multiplicando:

1. **~750 ms fixos por requisição, cobrados pela plataforma Godeploy** — não é rede (a mesma máquina
   fala com a Cloudflare em 55 ms) e não é código nosso: um favicon estático custa o mesmo que uma
   rota de API. É o preço do gate de OAuth que o edge roda em TODAS as rotas. **Não temos como
   baixá-lo** — o que dá para mudar é o número de vezes que ele é pago.
2. **Requisições demais.** O build emitia **49–52 chunks, 23 deles com menos de 2 KB**: cada ícone do
   `lucide-react` é um módulo próprio e, usado em 2+ rotas, o Rollup o promove a chunk compartilhado
   (`chevron-left` = **131 bytes**; `auth` = **41 bytes**). `/meus-projetos` puxava **14 arquivos** e
   levava ~4 s **só de JS**. O peso total (1,4 MB) nunca foi o problema.
3. **Cascata.** O `fetch` de `/api/meus-projetos` só começava **depois** que o chunk da rota chegava,
   e ele mesmo gastava ~3 s porque `listarMeusProjetos` fazia `syncOwnerRowsFromSheet` (leitura da
   planilha inteira) antes de qualquer coisa. 4 s + 3 s em série.

**Fix.**

- **`vite.config.ts`** — `lucide-react` inteiro num chunk `vendor-icons` (18 KB, 6 KB gzip, cacheado
  entre todas as rotas) + `experimentalMinChunkSize: 20_000` para fundir o resto do miudinho.
  **49 → 19 assets, zero abaixo de 2 KB, mesmo peso total.**
- **`src/router.tsx`** — `defaultPreload: 'intent'` + `defaultPreloadDelay: 150`: o chunk da rota é
  baixado no **hover**, não no clique.
  ⚠️ **Hover não pode disparar I/O — e foi preciso DUAS travas.** A primeira tentativa checava só a
  flag `preload` do `beforeLoad` de `_authenticated` antes de `iniciarPrefetchDashboard()`. **Não
  funcionou, e o staging provou:** passar o mouse pelo item "Dashboard" da sidebar seguia disparando
  `/api/admin/dashboard/projetos`. Causa: no router-core,
  `resolvePreload = !!(preload && !matchStores.has(matchId))` — a flag só vale `true` para um match
  **NOVO**. Quem já está numa tela admin tem o layout `_authenticated` **montado**, então o
  `beforeLoad` do PAI roda com `preload: false` mesmo no hover (e com `location.pathname` já
  apontando para o destino). Fix: manter a flag (ela cobre quem entra na área admin **vindo de fora**,
  onde o layout é match novo) **e** pôr `preload={false}` no link "Dashboard" da sidebar.
  ⚠️ **Não** mover o `iniciarPrefetchDashboard()` para o `beforeLoad` do próprio `/dashboard`, onde a
  flag funcionaria: os `beforeLoad` rodam em série pai→filho, então ele passaria a esperar o
  `/api/auth/me` — a fila indiana que o PR #215 tinha desfeito.
- **`src/lib/meus-projetos-cache.ts` (novo)** — TTL 60 s + *single-flight* + *stale-while-revalidate*
  em volta de `syncOwnerRowsFromSheet`, por dono. ⚠️ **O sync NÃO podia simplesmente ir para o
  background**: Status, Motivo Reprovado, Motivo Reenvio e Atualizado Em saem dessas MESMAS linhas
  (`meus-projetos.functions.ts:289-302`) — a tela abriria com Status "—" e sem o aviso de reenvio.
  ⚠️ **Leitura que falhou nunca entra no cache**: `syncOwnerRowsFromSheet` devolve `rows: []` tanto
  para "a planilha não respondeu" quanto para "usuário sem projeto", então ganhou o campo aditivo
  **`leituraOk`** — cachear o primeiro caso apagaria o Status de todo mundo por um minuto.
  ⚠️ Quem **escreve** na planilha invalida o cache do dono (`submeterParaValidacao`,
  `descontinuarProjeto`), senão o projeto recém-submetido apareceria com Status "—" por até 60 s.

**Decisão fechada respeitada.** O cache é **em memória do isolate**, igual ao do `/dashboard`
(PR #215). A decisão de produto de 28/07/2026 — *"cache da listagem em SQLite/localStorage é FORA"* —
continua valendo e **não** foi tocada.

**O que NÃO deu para fazer.** Os assets hasheados são servidos com
`cache-control: public, max-age=0, must-revalidate` — refetch devolve **200, nunca 304**, então cada
navegação rebaixa tudo de novo. Nome com hash é imutável por construção e deveria ser
`max-age=31536000, immutable`. O `assetConfig` do `updateApp` do Godeploy só expõe `html_handling` e
`not_found_handling`, e o worker não recebe binding de assets (`env.ASSETS` não existe lá) — **é
pedido para a plataforma**, não código nosso. Enquanto não houver, o item 1 (menos arquivos) é o que
compensa.

**Resultado medido no staging.** Troca de página: **zero requisições de JS** (o chunk chega no hover)
e `/api/meus-projetos` em **~1,1 s** contra os ~800 ms do piso da plataforma — ou seja, ~280 ms de
trabalho real, contra os ~3 s de antes.

**Onde aterrissou:** `vite.config.ts` · `src/router.tsx` · `src/routes/_authenticated/route.tsx` ·
`src/lib/meus-projetos-cache.ts` (novo) · `src/lib/meus-projetos.functions.ts` ·
`src/lib/google/sync-reverse.ts` (`leituraOk`) · `src/lib/chat.functions.ts` (invalidação) ·
`tests/meus-projetos-cache.test.ts` (12 casos) · `docs/deploy.md` · `CLAUDE.md`.

---

## `/dashboard` lento em produção — era o PAYLOAD, não a planilha (17/08/2026)

**Sintoma (Luis).** "Na `/dashboard` em prod está demorando muito para carregar os projetos,
parece que ele ainda está buscando da planilha."

**Causa.** Não era leitura da planilha — a listagem lê o **espelho** (SQLite) desde 11/08. Era
**volume**. Medido em prod com `scripts/dryrun-lider/peso-dashboard.ts` (639 projetos):

| | antes | depois |
|---|---|---|
| resposta de `/api/admin/dashboard/projetos` | **563,6 KB** | **346,1 KB** (−38%) |
| `linha_resumo` guardado no espelho | 460,9 KB | 257,8 KB (−44%) |

O maior item era **`observacoes`: 160 KB, 28% da resposta** — o parecer do analisador, que a
**tabela nunca desenhou** e que a ficha já relê do detalhe. Junto saíram `Atualizado Em`,
`Saving Horas` e `Ferramenta` (esta última **continua sendo lida**, porque alimenta o índice
de busca, mas não viaja como campo próprio).

**Fix.** `ProjetoDashboardResumo`/`mapResumo` perdem os 4 campos; `COLUNAS_RESUMO` perde
`Observações`, `Atualizado Em` e `Saving Horas` (o espelho passa a guardar menos, e a leitura
do SQLite encolhe conforme o cron reescreve as linhas). `aplicarStatusSalvo` deixa de espelhar
as observações na listagem.

**Régua que fica.** *Campo que a listagem não DESENHA não entra no resumo* — aqui cada campo é
multiplicado por ~600. Canário em `tests/dashboard-filtros.test.ts` (a lista de chaves do
resumo é travada); para remedir, `npx vitest run --config scripts/dryrun-lider/peso-dashboard.config.ts`.

**O que NÃO foi feito, e por quê.** Não se forçou a reescrita do espelho inteiro para colher os
203 KB do `linha_resumo` de uma vez: a gravação é *hash-gated* e um rewrite total voltaria ao
tempo da primeira corrida (~23 s). Ele encolhe sozinho conforme as linhas mudam.

---

## Coluna "Estrelas" não era editável pelo app (17/08/2026)

**Sintoma.** A planilha tem a coluna **"Estrelas"** (Q) — nota de 0 a 5 que a triagem dá ao
projeto —, mas o código não a conhecia: aparecia como texto cru em "Outras colunas" na ficha e
só dava para editar abrindo a planilha.

**Fix.** `'Estrelas'` entra em `SHEET_COLUMNS` (para o `updateRowByProjectId` alcançá-la por
NOME) e em `COLUNAS_ESCRITAS`; `statusSchema` ganha `estrelas` (inteiro 0–5, **opcional**); a
ficha ganha um `radiogroup` de 5 estrelas ao lado do Status, salvo pelo mesmo botão.

**Decisões fechadas.**
1. **Coluna MANUAL** — nenhum fluxo automático escreve nela (nem append, nem analisador, nem
   sync reverso). Esta ficha é o único ponto do sistema que grava lá.
2. **`undefined` = não encostar.** Quem só muda o status não pode zerar a nota de outra pessoa
   (mesma régua das 2 colunas do líder).
3. **Não passa por `ouTraco`.** A coluna é numérica e "sem nota" é **`0`** — o valor que 426 das
   639 linhas de prod já têm. Gravar "—" a transformaria em texto e quebraria soma/ordenação.
4. **Notas legadas fora da escala são preservadas.** Existem 7, 8 e 10 (1 linha cada); a ficha
   mostra "na planilha está 8 — salvar substitui" em vez de apagar em silêncio.
5. **Fora do resumo da listagem**, de propósito: não é desenhada na tabela, e o item acima
   acabou de tirar 217 KB de campos não desenhados do payload.
6. **Clicar de novo na estrela atual zera** — tirar a nota sem um botão "limpar" extra.

**Testes.** 4 casos em `tests/dashboard-admin.test.ts` (grava número · `0` nunca vira "—" ·
quem só muda status não toca a coluna · recusa fora de 0–5).

### Revisão no MESMO dia — a escala não tem teto, e passa a ser filtrável (17/08/2026)

**Sintoma.** Duas coisas, ditas pelo Luis depois de usar a ficha: (a) *"tire o limite de 5
estrelas, podemos dar N estrelas"* — o teto tratava as notas 7/8/10 que JÁ existem na planilha
como legado a substituir, e o `setEstrelas(Math.min(nota, 5))` fazia o salvar **rebaixar** a
nota de outra pessoa (a decisão 4 acima avisava, mas avisar não segura); (b) não havia como
**filtrar por quantidade de estrelas**, que é justamente o que a nota serve para fazer.

**Fix.** (a) `max(5)` sai do `statusSchema` — sobra `MAX_ESTRELAS_GRAVAVEL = 100`, sanidade de
CÉLULA e não escala; a fileira da ficha nasce com 5, cresce até a nota gravada e ganha um botão
**"+ estrela"** (que já dá a estrela que abre — pedir 2 cliques faria parecer quebrado); o
rótulo passa a ser "8 estrelas" em vez de "8/5". (b) `estrelas` entra no
`ProjetoDashboardResumo` + `COLUNAS_RESUMO`, vira **coluna ordenável** na tabela e **filtro por
FAIXA** (`estrelasMin`/`estrelasMax`, `casaEstrelas`).

**Decisões fechadas.**
1. **A decisão 5 acima é REVERTIDA de propósito** — `estrelas` entra no resumo porque agora é
   DESENHADA (coluna) e filtrável. O canário do payload (`tests/dashboard-filtros.test.ts`)
   passou a conhecer a chave: é um número curto, não um blob como `observacoes`.
2. **Faixa com pontas ABERTAS, não lista de opções.** Sem teto na escala, um `<select>` de
   "1★/2★/3★…" reinventaria o teto. Só a mínima = "1 ou mais"; **`0 a 0` = a fila do que ninguém
   avaliou**, porque **célula vazia conta como 0** (tratá-la como "fora de toda faixa" deixaria
   essa fila inalcançável). Conta como UMA dimensão no "Limpar filtros".
3. **`VERSAO_RECORTE_RESUMO` entra no `hashLinha`.** O espelho é *hash-gated*: sem bumpar, as
   ~600 linhas que ninguém editou ficariam com o recorte ANTIGO e a coluna nasceria vazia **para
   sempre**. O re-espelhamento é único, na 1ª corrida do cron depois do deploy.
4. **Célula vazia é "—" na tabela, ≠ `0`**: "ainda não avaliei" não é "avaliei e não dei
   estrela" (a ordenação segue a mesma régua, vazio abaixo do zero).
5. **O número é o que se lê.** Ninguém conta 12 estrelas desenhadas — daí o número ao lado na
   ficha e a célula da tabela ser `★ n`, não N ícones.

**Testes.** `tests/dashboard-admin.test.ts` (aceita 8; recusa negativo, fracionado e > 100) +
6 casos de faixa em `tests/dashboard-filtros.test.ts` (pontas abertas · inclusiva · nota > 5 ·
vazio = 0 · AND com as outras dimensões · uma dimensão no contador).

---

## Contagem do campo de pré-status não casava com os outros filtros (17/08/2026)

**Sintoma.** Relato do Luis: *"a contagem do pré-status, no casamento dela com os outros filtros,
às vezes indica contagem errada"*. Com "Especiais" (ou período/área/estrelas) ligado, o campo dizia
"Pré-pendente (26)" e escolher esse estado abria uma lista de 3.

**Causa.** `pareceresDisponiveis(projetos)` contava sobre a listagem **crua**, enquanto as pílulas
de status já contavam sobre o **recorte** (`contarPorPilula`). Duas réguas para a mesma pergunta.

**Fix.** A contagem passa a respeitar todas as dimensões **menos a própria** (`parecer`), via a
função pura nova **`casaFiltrosExceto(p, f, dimensão)`** — que também virou o corpo do
`contarPorPilula` (ele tinha a lista de dimensões digitada à mão, e uma dimensão nova teria de ser
lembrada em dois lugares).

**Decisões fechadas.**
1. **Ignorar a própria dimensão é obrigatório**, não detalhe: contando com ela, escolher
   "Pré-pendente" zeraria os outros estados e o campo viraria uma lista de um item.
2. **O estado selecionado nunca sai do campo**, mesmo com 0 no recorte — um `<select>` cujo `value`
   não está entre as `<option>` renderiza **em branco**, e a pessoa perde como desfazer.
3. **Filtro novo entra em `casaFiltrosExceto` no mesmo commit**, senão ele recorta a lista sem
   recortar as contagens (é este bug de novo).

**Testes.** 6 casos em `tests/dashboard-filtros.test.ts`, incluindo o invariante que o bug violava:
**a contagem do campo == o tamanho da lista filtrada** por aquele estado.

---

## Filtro de estrelas "muito default" — pílula + painel em vez de dois campos numéricos (17/08/2026)

**Sintoma.** *"Ficou feio, deixe mais modernizado mas sem fugir do padrão de design da página. Tá
muito default embora funcional."* A 1ª versão do filtro eram dois `<input type="number">` crus
dentro de uma pílula, na mesma barra em que todo o resto fala por pílulas e trilhos.

**Fix.** `src/components/dashboard/filtro-estrelas.tsx`: gatilho igual ao do `SeletorPeriodo`
(ativo = preenchido em `--go-blue`, com "×" embutido) abrindo um **painel ancorado** com a
**fileira de estrelas como controle** (clicar na 3ª pede "3 ou mais"; clicar de novo desfaz),
dois atalhos (Qualquer · Sem nota) e a **faixa exata** embaixo.

**Decisões fechadas.**
1. **Reusa o `Popover` do calendário** (exportado para isso). Dois popovers na mesma barra abririam,
   fechariam e posicionariam diferente — duplicação que se paga em bug.
2. **A faixa exata FICA.** Ela é o que preserva a escala aberta (pedir "6 a 10"); trocar tudo por
   uma escada "1+/2+/3+" deixaria a tela mais bonita tirando função. ⚠️ **REVISTA em 18/08/2026**
   (entrada "Escala de estrelas fechada em 10", abaixo): com a escala fechada em 10 e as 10 na
   tela, a faixa exata perdeu o que ela preservava e SAIU — a premissa desta decisão caiu, não a
   régua dela.
3. **Estado nunca só por cor:** a pílula diz "3+"/"2–4"/"Sem nota" em texto (fonte única
   `rotuloFaixaEstrelas`) e o painel repete em frase (`descreverFaixaEstrelas`).
4. **O widget nativo do `number` sai, o `type="number"` fica** (`.go-nota-campo`): as setas do
   teclado continuam funcionando; só as setinhas desenhadas do navegador saem. ⚠️ **Obsoleta em
   18/08/2026** — os campos saíram e a classe foi removida.
5. **Na tabela, vazio e `0` se parecem** (cinza "—"/"0") e só nota ≥ 1 ganha o chip dourado: um chip
   de destaque com "0" gritaria em centenas de linhas. A distinção vazio ≠ 0 segue na ficha e na
   ordenação.

---

## Escala de estrelas fechada em 10 — todas visíveis, e os campos "de/até" saem (18/08/2026)

**Pedido.** *"O máximo de estrela do GoDocs é 10 estrelas, então já quero que fique visível na
tela de edição as 10 estrelas e no filtro, quando eu clico pra abrir o select, fique as 10
estrelas ali já visível, e tire as boxes de 0 até N e deixe só o clique em estrelas."*

**O que havia.** A escala era **aberta** (17/08): a fileira nascia com 5 e crescia por um botão
"+ estrela"; quem quisesse pedir "6 a 10" no filtro digitava nos dois `<input type="number">` da
"faixa exata". Metade da escala usável ficava atrás de um clique de descoberta, nos dois lugares.

**Fix.** `ESCALA_ESTRELAS = 10` na ficha (`projeto-detalhe-dialog.tsx`) e `DEGRAUS = 10` no painel
do filtro (`filtro-estrelas.tsx`); o botão "+" e o bloco "Faixa exata" saem, e a classe
`.go-nota-campo` sai do `styles.css` com eles. As 10 ficam em **duas linhas de 5** (`grid-cols-5`
nos dois lugares): em fileira corrida ninguém distingue a 7ª da 8ª de relance, e a quebra em 5 + 5
dá o ponto de apoio da conta. Nota legada acima de 10 vira uma 3ª linha, sem caso especial.

**Decisões fechadas.**
1. **10 é teto de ESCALA, não recorte de VALOR.** A fileira ainda cresce além de 10 quando a nota
   GRAVADA é maior (legado da escala aberta): `Math.max(ESCALA_ESTRELAS, valor)`. Recortar aqui é o
   `Math.min(nota, 5)` do 1º dia de volta — o "salvar status" **rebaixaria** a nota de outra pessoa.
2. **O `MAX_ESTRELAS_GRAVAVEL = 100` do zod FICA.** É sanidade de célula, não escala; baixá-lo a 10
   faria a triagem levar **400** ao salvar o status de uma linha legada com nota 12.
3. **O estado do filtro continua sendo faixa** (`estrelasMin`/`estrelasMax`): a URL e o rótulo
   ("2–4", "até 3") seguem entendendo teto — o que saiu foi o **jeito de pedi-lo pela tela**. Se
   um dia a triagem quiser teto de novo, é um gesto de clique a projetar, não estes 2 campos.
4. **Duas linhas de 5, não uma de 10** (ajuste do Luis no mesmo dia, sobre a 1ª versão com só um
   respiro depois da 5ª): a quebra de linha é o que torna a contagem desnecessária.
5. **A pergunta do clique continua sendo "N ou mais"** — o clique não virou
   "exatamente N", que é o filtro que quase ninguém quer.

---

## Ficha ainda parava em "Carregando a linha da planilha…" logo depois de buscar (17/08/2026)

**Sintoma.** Com o lote da página já implementado, buscar um projeto e clicar nele **ainda**
mostrava o spinner por ~1 s. Relato do Luis: *"era pra ficar mais rápido como um SPA"*.

**Causa.** `semearLote` só criava as entradas do cache **quando o lote CHEGAVA**. A busca troca
a página visível, o lote da nova página sai (após os 120 ms de debounce) e o clique acontece
*durante* a viagem: `obterDetalhe` não achava entrada nenhuma e abria uma **2ª requisição pela
MESMA ficha** — mais ~750 ms de overhead fixo do edge, em paralelo com o lote que já a trazia.

**Fix.** O lote é registrado no cache **em voo**: cada id ganha, na hora, uma entrada apontando
para a promise do lote. Clique e hover no meio da viagem passam a esperar a requisição que já
existe. Id que o lote não devolveu (teto de 30, projeto fora do espelho) cai no caminho
individual — nunca num `undefined` servido como ficha. E o `pointerdown` da linha aquece na
hora, sem os 150 ms do hover (quem clica direto não paga a intenção).

**Invariantes preservados.** Falha (do lote OU do individual) **não fica retida** no cache; id
com ficha fresca não é resemeado (não atropela requisição em voo); TTL de 30 s inalterado.

**Testes.** 2 casos novos em `tests/dashboard-detalhe-cache.test.ts` (clique durante o lote =
1 requisição só · id ausente do lote não vira ficha vazia nem entrada retida).

---

## Abrir a ficha e entrar no `/dashboard` — duas esperas de ~750 ms cada (17/08/2026)

**Sintoma (Luis).** *"Você subiu a att no SQLite que melhora o carregamento dos projetos quando
eu abro eles dentro do dashboard? Até quando eu entro na dashboard, 'verificando permissões'
demora um pouco também — ninguém gosta de esperar muito loading."*

**Diagnóstico.** As duas telas já liam o **espelho (SQLite)** — nenhuma lia a planilha. O que
sobrava era a **contagem de requisições**, cada uma com ~750 ms de overhead fixo do edge:

1. **Abrir uma ficha** = 1 requisição por projeto. O prefetch por hover (13/08) só cobre quem
   passa o mouse e espera 150 ms; clique direto, teclado e deep link pagavam integral.
2. **Entrar no `/dashboard`** = o `beforeLoad` dava `await` no `/api/auth/me`, prendendo a rota
   em *"Verificando permissões…"*, e **só então** o dashboard montava e começava a própria
   carga: duas esperas em fila para um clique só.

**Fix 1 — a página visível é semeada em UMA requisição.** `semearLote` (cliente) +
`POST /api/admin/dashboard/projetos/lote` → `getProjetosDashboardLote`. Medição em prod (641
linhas): ficha **5,5 KB em média**, mediana 4,7, p90 9,4, maior 29 — uma página de 25 ≈ **137 KB**.
Abrir qualquer linha daquela página passa a custar **zero requisição**. Teto `LOTE_MAX_FICHAS = 30`.
Servidor: **2 consultas por `IN`** (`lerLinhasEspelho` + `getAdminStatusLogsPorIds` — nova), nunca
uma por projeto (o erro que já derrubou o Investigador).

*Invariantes preservados do cache de detalhe:* lote que **falha não vira entrada**; id com ficha
fresca não é resemeado (não atropela requisição em voo); mesmo TTL de 30 s; em memória, por aba.

**Fix 2 — a tela não espera o auth para pintar.** O veredito virou **promessa** no contexto
(`{ user: null, verificacao: buscarAuth() }`) e o `GuardaAcesso` redireciona quem não é admin.
O gate REAL sempre foi o `requireAdmin` server-side — o `beforeLoad` nunca protegeu dado, só
decidia o que pintar (é o que o cabeçalho de `auth-cache.ts` já dizia).

**Decisões fechadas.**
1. **Não-admin vê o esqueleto por instantes** — aceito: nenhuma chamada de dados responde sem
   `requireAdmin`, e a alternativa é cobrar ~750 ms de TODO admin em toda entrada.
2. **`user` do contexto passa a ser anulável.** `usuarios.tsx` usava `user.email` e quebraria numa
   entrada direta; virou `user?.email`.
3. **Nada de `await` no `beforeLoad`** — o teste de `dashboard-loadings-ui` passou a proibir
   qualquer `await` antes do prefetch (antes ele só checava a ORDEM).
4. **O histórico do lote é acessório**: falha dele não derruba o lote (a ficha abre sem o
   histórico), senão a tela voltaria ao caminho de 25 requisições por causa da auditoria.
5. **Projeto ausente do espelho fica FORA do lote** em vez de entrar como ficha vazia — a
   abertura cai no caminho individual e mostra o 404 de verdade.

**Testes.** 4 casos novos em `tests/dashboard-detalhe-cache.test.ts` (semeia e não busca de novo ·
não atropela requisição em voo · falha não vira entrada · lista vazia não dispara) e 3 em
`tests/calendario-ui.test.ts` (a tela não espera o auth · o redirect continua · o lote depende dos
ids). Medição reproduzível: `scripts/dryrun-lider/peso-ficha.ts`.
