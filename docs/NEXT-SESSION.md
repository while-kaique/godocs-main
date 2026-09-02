# NEXT-SESSION

## ✅ SESSÃO 02/09 (noite) — GoDocs v2: a Etapa 3 do jeito da v1 + cabeçalho da planilha

Branch **`feat/godocs-v2`**, pasta `/home/notebook/godocs-main`. Suíte **2800 verde** (entrou a sessão com
2773), `npm run build` ok, `tsc` nos **4** erros pré-existentes. **No ar:** staging **`edf400b4`** version
**291** (https://godocs-staging.devgogroup.com/). **Prod (`674a3710`) intocada.**

### O que o Luis pediu, olhando o fluxo no ar — e o que mudou
1. **A Etapa 3 tinha sido recriada do zero.** Reclamação literal: *"você criou um design do 0 em cima de
   referência nenhuma… podia ter reaproveitado muita coisa da v1"*. Voltou a linguagem da v1: **painel lime**
   por bloco, **revelação progressiva** (`revelacao.ts`, PURO + 16 casos — cada resposta abre a próxima
   pergunta), frequência em **4 abas lado a lado** (era dropdown), rótulo curto + ajuda de uma linha, e as
   pílulas `.go-btn-back`/`-next`/`-submit` no lugar dos botões que eu havia estilizado à parte.
   ⚠️ Virou regra de trabalho: **tela nova ADAPTA a v1**, não recria (o padrão está em
   `identidade_visual_gogroup.md` + `styles.css` + `step3-chat.tsx`, que é a v1 viva).
2. **Tipos de ganho em TELA PRÓPRIA** (`selecao-ganho.tsx`), 1ª tela da Etapa 3 — eram um campo no fim da
   Etapa 2. A régua saiu de `validarEtapa2` e virou `validarSelecaoGanho`: portão não pode cobrar campo que a
   etapa não mostra.
3. **Saving efetivado = "quanto era" + "quanto é agora"**; o *"desde quando"* saiu. Uma despesa pode ter caído
   de 20k para 5k, e o saving são os 15k — um valor só aceitava 20k de ganho num contrato ainda pago. O ganho
   é DERIVADO (`savingLiquido`, clampado em 0), nunca um 3º campo. Colunas novas
   `saving_efetivado_valor_antes/_agora`.
4. ⚠️ **As 4 categorias passam a combinar, o imensurável incluído** — revoga a RF-202 e o critério nº 2 do
   plano. Um projeto pode ter saving medido E ganho sem número; marcar os dois é insumo para o agente
   investigar. **`paraGanhosProjeto` só devolve `imensuravel: true` quando ele é a ÚNICA categoria** —
   devolvê-lo na mistura ZERARIA um saving comprovado.
5. **Receita = o bloco da PROD:** frequência (só **Mensal/Pontual**) · valor · racional com anexo/print. A
   lista "de onde vem essa receita" que eu havia declarado sem estar no plano saiu do modelo, da tela, da
   coluna e dos testes.
6. Custo para rodar com **sim/não** antes da lista (não abre mais linha em branco para todo projeto); tooltip
   no "não contratado"; cabeçalho da tabela vira **"Horas antes/Horas depois"**.

### ✅ Cabeçalho da aba `STAGING-V2` — ESCRITO (59 colunas, A→BG)
**17 renomeações in-place + 3 colunas novas.** Decisão do Luis: **reaproveitar, não criar**. Dois achados
derrubaram a proposta antiga do plano:
- **A aba não está vazia:** é clone da `STAGING`, com **578 linhas de dado**. Zerá-la esvaziaria o SQLite da
  staging no 1º sync reverso (a planilha é a fonte do que aparece).
- **Quase tudo já existia:** a régua D1 só renomeou conceitos — o **`Custo Evitado` da v1** (a empresa pagava
  e parou) é o **saving efetivado** da v2, e o **saving por HORAS** da v1 é o **custo evitado** da v2.

Novas de verdade só as 3 perguntas que a v1 nunca fez: **`Saving Efetivado Agora`** ·
**`Custo Evitado Não Contratado`** · **`Impacto Líquido Mensal`**. Mapeamento completo no plano, seção
*Cabeçalho da aba `STAGING-V2`*. ⚠️ `STAGING` (55 colunas) e `GoDocs` (55) **não foram tocadas**, e o
`GOOGLE_SHEETS_TAB` da staging **continua em `STAGING`** — nada escreve na aba nova até a T6.

### Sobre o item 5.8 (impacto bruto × líquido + mensalização)
**Decidido e codado na régua, pendente na fiação.** `src/lib/impacto.ts` já tem bruto × líquido, os
deflatores (100% saving · 50% custo evitado · 10% receita), custo para rodar subtraindo 100% e a
mensalização `pontual ÷4 · mensal ÷1 · trimestral ÷3 · semestral ÷6`, por bloco. **Ninguém escreve** os 3
`impacto_*` e **nada envia** o líquido mensal por projeto ao Gomoon (o push que existe é o rollup do João
Gabriel: saving e receita crus e separados, contrato diferente). É a T6 que entrega.

### ⚠️ PENDÊNCIA QUE BARRA O ENVIO
Os **3 revisores de contexto fresco NÃO rodaram** neste bloco (é o ritmo acordado: rodam uma vez, no fim).
Os marcadores `.claude/.review-status` e `.claude/.quality-status` estão **ausentes/`pendente`**, e isso
**barra o `git push` e o `/ggsd:ship`** — commit na branch e deploy na staging seguem livres. Destravar:
rodar `ggsd:verificador-conformidade` + `ggsd:revisor-qualidade` (+ `ggsd:revisor-reuso`, só-sugestão) e
gravar os vereditos nos marcadores. ⚠️ Algo apaga esses arquivos durante a sessão — confira que existem
antes de confiar no gate.

### Uma dívida de diagnóstico
O **erro do "Próximo" no fluxo REAL** (não no `/fluxos`) nunca foi diagnosticado: o `iniciar-submissao`
responde sem exceção nos logs da staging, mas foi chamado **4× em sequência** — cara de resposta 400 que o
cliente engole e retenta (`dispararDocBackground` zera a `sig` no `catch` e o efeito redispara). O caminho é
ler o `api_logs` do projeto. Não bloqueia a T6, mas some junto com ela se a causa for a rota que falta.

## Plano ativo
**→ [docs/plans/godocs-v2-submissao-deterministica.md](plans/godocs-v2-submissao-deterministica.md)** ·
Status: ✅ aprovado (Luis, 02/09/2026) · **T1..T5 executadas e ajustadas · T6 começada (só o cabeçalho da
planilha) — falta o resto da T6, T7, T8 e a T9-servidor**

## Próximo passo
**Codar a T6 com `/ggsd:code`** — é ela que faz o botão "Submeter" funcionar (o cliente já chama
`POST /api/submeter/ganhos`, que **não existe** → 404) e é ela que entrega o item **5.8** ao Gomoon. Depois,
na ordem: **T7** (doc invisível), **T8** (estrelas para todo projeto) e **T9-servidor** — que é
**DESLIGAR** o agente do fluxo de submissão, ⚠️ **não apagá-lo**: *"não vamos excluir os agentes, vamos
tirá-los do fluxo de submissão novo, mas vamos reaproveitá-los eventualmente"* (Luis, 02/09/2026). O código
do orquestrador, dos 7 gates e dos prompts **fica**; sai só o que ficar de fato órfão.
✅ **O backup já existe:** tag **`arquivo/agentes-conversacionais-v1`** (último commit com tudo vivo;
`git show <tag>:<caminho>` recupera) + a seção **ARQUIVO** em `docs/agents.md` com o inventário e a
arquitetura. ⚠️ A tag é **local** até a branch ser pushada. **Regra da T9:** arquivo removido do código
efetivo é copiado para `docs/arquivo/agentes-conversacionais/` no **mesmo commit** — nada fica só no
histórico.

⚠️ **Régua de trabalho para a T6 em diante (Luis, 02/09/2026): não criar nada sem necessidade — reaproveitar
o que existe.** Foi o que já derrubou 2 propostas minhas nesta sessão (14 colunas novas na planilha viraram 3,
e a Etapa 3 redesenhada do zero voltou à linguagem da v1). Na T6 isso significa: a rota nova é **fiação** —
`paraGanhosProjeto` + `impacto.ts` + `resolverValorHora`/`CARGOS` + os pares de serialização de `ganhos.ts`
já existem e é para chamá-los, não reescrevê-los.

⚠️ **Antes de qualquer envio:** a **revisão de contexto fresco do bloco não rodou** (marcadores
`.review-status`/`.quality-status` ausentes/`pendente`), e ela **barra o `git push` e o `/ggsd:ship``** — o
commit na branch e o deploy na staging não são barrados. Rodar `ggsd:verificador-conformidade` +
`ggsd:revisor-qualidade` (+ `ggsd:revisor-reuso`, só-sugestão) e gravar os vereditos destrava.

**O que a T6 tem de entregar para o envio parar de quebrar:**
1. **`POST /api/submeter/ganhos`** — o cliente JÁ a chama (`submeter.tsx`, `handleSubmitProjeto`) com
   `{projeto_id, ganhos: GanhosDeclarados, anexos: [{base64, filename}]}`. Sem ela o envio dá 404.
   Ela grava as colunas da v2 (via os 3 pares de serialização de `ganhos.ts`) e materializa os 3
   `impacto_*`. ⚠️ O saving efetivado agora são **duas** colunas (`_valor_antes`/`_valor_agora`) e o ganho é
   a diferença (`savingLiquido`); `saving_efetivado_valor`, `_desde` e `receita_incremental_tipo` são
   **LEGADO e não se escreve nelas**.
   ⚠️ **Grave os 3 ou nenhum**, no MESMO UPDATE do ganho: `impactoBruto` não usa divisor mas
   `impactoLiquidoMensal` passa por `divisorDe`, que **lança** — frequência suja materializaria derivado
   PARCIAL, que é pior que derivado nenhum (o relatório soma o que existe).
   ⚠️ `custoEvitado.valorHoras` chega **0** do cliente de propósito: o R$ da hora é derivado no servidor
   (`resolverValorHora`, `saving-calc.ts`), que é o único lugar onde o valor por cargo existe.
2. **`submeterParaValidacao`** ainda cobra os gates financeiros da v1 (`economia_reais_mes > 0` etc.) — vai
   recusar um projeto v2. Tem de passar a ler as colunas novas.
3. **As 5 réplicas da fórmula** (`chat.functions.ts:3910`, `:4227`, `:4416`, `reconciliar-financeiro.ts:96`,
   `avaliacao-normais.functions.ts:282`) passam a chamar `impacto.ts`.
4. ✅ **A linha 1 da `STAGING-V2` JÁ FOI REESCRITA** (02/09/2026): 59 colunas, **17 renomeações in-place +
   3 novas**, decisão do Luis de **reaproveitar** em vez de criar. O mapeamento completo (e os 2 achados que
   derrubaram a proposta antiga — a aba tem **578 linhas de dado**, não está vazia; e o "custo evitado" da v1
   é o **saving efetivado** da v2) está no plano, seção *Cabeçalho da aba `STAGING-V2`*.
   **Falta:** o `SHEET_COLUMNS` da T6 usar EXATAMENTE esses nomes, e só então trocar o `GOOGLE_SHEETS_TAB` da
   staging (hoje ainda em `STAGING`, de propósito — nada escreve na aba nova até a T6).
5. **Bump da `VERSAO_RECORTE_RESUMO`** se entrar coluna nova em `COLUNAS_RESUMO` — sem ele o campo nasce
   vazio para sempre.

**T7** é pequena e o cliente já está pronto para ela: `iniciarSubmissao` ainda inicia conversa no servidor.
O cliente **ignora** a resposta (só usa o `projeto_id`), então hoje isso custa só a latência do LLM no
avanço da Etapa 2 — e é por isso que o critério de aceitação nº 1 do plano ainda não fecha.
