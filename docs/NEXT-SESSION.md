# NEXT-SESSION

## ✅ SESSÃO 02/09 (fim de tarde) — GoDocs v2: T4 + T5 no ar, sem agente no caminho

Branch **`feat/godocs-v2`**, pasta `/home/notebook/godocs-main`. Suíte **2773 verde** (baseline da sessão:
2548), `npm run build` ok, `tsc` em **4** erros pré-existentes (eram 7 — os 3 do `submeter.tsx` saíram junto
com o código v1). Três commits: `cc91cb0` (T4), `ba22928` (T5 parte 1), `dcd2bf2` (T5+T9-cliente).

**Está NO AR:** https://godocs-staging.devgogroup.com/ — dá para clicar da Etapa 1 até a revisão.

### O que mudou de ambiente (decisão do Luis, em seletor)
A frente **saiu do app isolado `f9c9a7ff`** e passou a subir na **staging v1 `edf400b4`**. Motivo factual:
`f9c9a7ff` tinha **9 dos 45 secrets** — sem `GOOGLE_SA_KEY_BASE64`, `GOOGLE_SHEETS_ID`,
`GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_OAUTH_*`, `TG_API_TOKEN`, `API_PROXY_TOKEN` e `LLM_API_KEY`, lá não há
TeamGuide (áreas/cargos/participantes), Drive, planilha nem proxy de LLM. **Prod (`674a3710`) intocada.**
- ⚠️ **A staging deixou de validar a v1** enquanto a v2 estiver lá (regra 13). Reverter = redeploy do `main`.
- ⚠️ Apaguei os secrets **`SUBMISSAO_BLOQUEIO_INICIO`/`_FIM` na staging** (sem isso não se inicia submissão).
  **Em prod eles continuam** — a pausa de lá não foi tocada.
- ⚠️ **`GOOGLE_SHEETS_TAB` da staging AINDA aponta para `STAGING`**, de propósito: hoje nada escreve na
  planilha, e trocar para `STAGING-V2` faria o cron de sync reverso **esvaziar o SQLite da staging** sem
  ganho nenhum. Trocar é passo da T6.

### O que entrou
- **T4 — os 4 componentes**, cada um com a régua num módulo PURO, porque o Vitest daqui roda
  `environment: 'node'` e só inclui `tests/**/*.test.ts`: **não renderiza componente**, então régua dentro do
  `.tsx` é régua sem teste. `acordeao-estado.ts` (33 casos) · `itens-lista.ts` (36) · `horas.ts` (67) ·
  `evidencia.ts` (31) + `acordeao.tsx` · `lista-itens.tsx` · `tabela-horas.tsx` · `campo-evidencia.tsx` +
  canário de a11y (21). Os 3 primeiros testes foram escritos por **test-writers cegos**.
- **T5 — Etapas 1, 2 e 3 reescritas.** `submeter.tsx` **3459 → 2194** linhas. Novos:
  `validacao-etapa3.ts` (59 casos), `step3-ganhos.tsx` (acordeão), `revisao-ganhos.tsx`, `ganhos-rotulos.ts`.
  A Etapa 2.5 foi **apagada** (`step25.tsx`, `tests/especial-triagem.test.ts`,
  `validarEtapa25Especial`/`motivoBloqueioEspecial`).
- **T9 (lado cliente) antecipada**, por decisão do Luis: saíram 1324 linhas de handlers de conversa e de
  especial, todo o estado que os alimentava, e o sandbox `/fluxos` colapsou de 3 fluxos para 1.

### Achados que corrigiram a letra do plano
1. `ListaItens` **não** estava "duplicado duas vezes dentro do `SavingForm`": era *uma* variável renderizada
   em 2 pontos; a duplicação real era ela × o bloco de custo do projeto inline, iguais salvo **12** detalhes
   de texto/prefixo — que viraram props.
2. `TabelaHoras` — a v1 **não tinha** "Outro", nem descrição, nem tooltip. É funcionalidade nova.
3. **`parseNumeroPtBR` não existe** neste repo. Escrevi `parseHorasBR`: usar `parseMoedaBR` em horas leria
   "12,5" como R$ 0,13.
4. O `onToggle` que faltava era do **`CardCheckboxGroup`** (opção com descrição), não do
   `GridCheckboxGroup` como o plano dizia.

### ⚠️ PENDÊNCIA QUE BARRA O ENVIO (registrada de propósito)
Os **3 revisores de contexto fresco NÃO rodaram** — é o ritmo acordado (rodam uma vez, no fim do bloco).
`.claude/.review-status` e `.claude/.quality-status` estão em **`pendente`**, e isso **barra o `git push` e o
`/ggsd:ship`**. Commit na branch e deploy na staging seguem livres. Para destravar: rodar
`ggsd:verificador-conformidade` e `ggsd:revisor-qualidade` (+ `ggsd:revisor-reuso`, que é só-sugestão) e
gravar os vereditos nos marcadores.
⚠️ **Algo apaga esses arquivos durante a sessão** — conferir que existem antes de confiar no gate.

### Duas decisões minhas que precisam do seu aval
1. **"Tipo de receita"**: o plano lista o campo mas não enumera os valores (na v1 aquela coluna guardava a
   RECORRÊNCIA). Declarei 5 opções em `TIPOS_RECEITA` (`ganhos-rotulos.ts`): venda nova · receita recuperada ·
   expansão do mesmo cliente · churn evitado · outro. Texto livre foi descartado porque a coluna vai a
   relatório, e texto livre em campo agregável vira 40 grafias do mesmo conceito.
2. **Rascunho da v1 volta com `ganhoCategorias: []`** — converter "saving" em "saving_efetivado" seria
   adivinhar a régua D1 no lugar da pessoa, e a régua D1 é justamente o que a v2 pergunta.

---

## Plano ativo
**→ [docs/plans/godocs-v2-submissao-deterministica.md](plans/godocs-v2-submissao-deterministica.md)** ·
Status: ✅ aprovado (Luis, 02/09/2026) · **T1..T5 executadas — falta T6, T7, T8 e a T9-servidor**

## Próximo passo
**Os ajustes que o Luis quer fazer no fluxo visual que está no ar** (a definir por ele no início da sessão) —
ele pediu explicitamente que viessem **antes da T7 e da T9**. Depois deles, na ordem: **T6** (é ela que fecha
o envio), T7, T8, T9-servidor.

**O que a T6 tem de entregar para o envio parar de quebrar:**
1. **`POST /api/submeter/ganhos`** — o cliente JÁ a chama (`submeter.tsx`, `handleSubmitProjeto`) com
   `{projeto_id, ganhos: GanhosDeclarados, anexos: [{base64, filename}]}`. Sem ela o envio dá 404.
   Ela grava as 19 colunas (via os 3 pares de serialização de `ganhos.ts`) e materializa os 3 `impacto_*`.
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
