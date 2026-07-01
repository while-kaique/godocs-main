# Spec — Registro de Correções (GoDocs)

> **Documento vivo.** Uma entrada por correção de bug relevante (regra 12 do `CLAUDE.md`:
> "Specs — consultar antes, atualizar a CADA implementação"). Formato fixo:
> **sintoma → causa-raiz → fix → onde aterrissou → status/PR**. Mais recente no topo.

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
