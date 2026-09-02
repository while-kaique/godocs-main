# NEXT-SESSION

## ✅ SESSÃO 02/09 — T1 e T2 do GoDocs v2 executadas

Branch **`feat/godocs-v2`**, na pasta **`/home/notebook/godocs-main`** (o worktree `godocs-v2` foi removido a
pedido do Luis — "pode ser tudo no mesmo lugar"). Suíte **2381 verde**, `tsc` só com os 7 erros pré-existentes
do `main`, `npm run build` + `build:worker` ok, `worker.js` commitado (regra 1).

### T1 — ambiente v2 isolado ✅ (menos a verificação com Google)
- App **`f9c9a7ff`** = `godocs-v2-staging` · https://f9c9a7ff.devgogroup.com/ · SQLite próprio zerado.
- 9 secrets: `GODOCS_ENV=v2-staging`, `GOOGLE_SHEETS_TAB=STAGING-V2`, `ADMIN_EMAILS`, `APP_BASE_URL` e a
  config de LLM (`sol` + `gpt-5.6-luna` + `LLM_REASONING_EFFORT_FAST=low`, valores do `CLAUDE.md`).
- **Mudo por AUSÊNCIA de secret** (é assim que o ambiente não fala com ninguém): Chat, Chat de Ajuda,
  Gomoon, push do JG e Drive (sem `GOOGLE_DRIVE_FOLDER_ID` o guard recusa e o `uploadDocsToDrive` engole →
  submissão segue sem link, nunca escreve na pasta real).
- ⚠️ **O achado que fez a T1 ser 5 arquivos, não 1:** `GODOCS_ENV=v2-staging` caía em **`'production'`** no
  parser (só `'staging'` era reconhecido), o que **desligava** o `assertNaoEhDefaultDeProd` e mandava
  Pinecone (namespace `prod`), Gomoon (`ambiente: 'producao'` → **DM em líder REAL**), rollup-push e o banner
  para o caminho de produção. Régua nova: **`isStaging()`** vale para os dois ambientes de teste, e
  **`rotuloAmbienteExterno()`** (`env.ts`) é a fonte única do rótulo que viaja para fora — estava digitado
  igual em 2 lugares.
- ⏳ **Pendente por decisão do Luis:** os 6 secrets sensíveis (`GOOGLE_SA_KEY_BASE64`, `GOOGLE_SA_CLIENT_EMAIL`,
  `TG_API_TOKEN`, `API_PROXY_TOKEN`, `LLM_API_KEY`, `LLM_FALLBACK`) **não** foram setados ("n precisa desses").
  Sem eles o app abre e o formulário roda, mas **nada sincroniza com a planilha** — então o critério de
  aceitação 8 da T1 (submissão de teste caindo na `STAGING-V2` e em nenhuma outra aba) **não foi verificado**.
  Quando for a hora do sync, é setar os 6 no `f9c9a7ff`.

### T2 — núcleo puro do impacto ✅
**`src/lib/impacto.ts`** (novo, PURO): `mensalizar`/`divisorDe`, `impactoBruto`, `impactoLiquido`,
`impactoLiquidoMensal` + `PESO_SAVING=1`/`PESO_CUSTO_EVITADO=0.5`/`PESO_RECEITA=0.1`/`DIVISOR_FREQUENCIA`.
**54 casos** em `tests/impacto.test.ts`. **Nenhum consumidor ainda** — trocar as 5 réplicas da v1 é a **T6**.
Duas guardas que os revisores acharam e que **não podem sair**:
- **frequência fora do enum LANÇA** (`divisorDe`, fail-closed). Era `NaN`, e o caminho da falha é o pior:
  `JSON.stringify(NaN)` → **`null`**, ou seja, campo de DINHEIRO nulo no payload do Gomoon em vez de erro, e
  um `NaN` num `reduce` de rollup zera o total da área. O vocabulário das fontes da v1 é MAIOR que o enum
  (`custoPeriodicidade` tem `'anual'` e `''`; `tipo_saving` pode ser `null`). ⚠️ **Nunca trocar por `?? 1`.**
- **custo negativo CLAMPA em 0** (como `somarItens`/`custoProjetoMensalFromItens` da v1 já fazem). Sem isso,
  `-500` num item de custo **aumentava** o impacto — a direção gameável.

### ⚠️ 3 pendências que são DECISÃO do Luis, não trabalho
1. **Editei o texto da T1 no plano APROVADO** (`godocs-v2-submissao-deterministica.md:128-135`), para registrar
   os 5 consumidores. O revisor de conformidade apontou, com razão, que mexer no plano aprovado **move a régua
   contra a qual ele verifica**. **Manter ou reverter?** (Daquele ponto em diante só mexi em `Status:`/progresso.)
2. **Os "3 exemplos da conversa"** que a T2 pede como guarda (`:142`) **não existem registrados** em lugar
   nenhum — nem no plano, nem no repo. Os 54 casos foram derivados da FÓRMULA. Se o Luis tiver os números
   daquela conversa, conferir contra eles: divergência apontaria erro de leitura da fórmula, não do teste.
3. **`PESO_RECEITA = 0.1` NÃO é peso novo** — é a mesma regra do `÷10` da v1, agora encodada em **duas** réguas
   independentes. Mudar o fator um dia exige tocar os dois lados, e o lado da v1 tem um "não corrigir aqui"
   que ninguém vai ligar a este arquivo.

### Amarra obrigatória para a T3
`impacto.ts` declara `Frequencia` e `DIVISOR_FREQUENCIA`. A T3 tem de **importar daqui**, nunca redeclarar —
senão a fonte única da fórmula nasce com duas cabeças. Bônus do revisor de reuso: esse `Frequencia` é o
**primeiro alias nomeado** da cadência no repo (hoje `tipo_saving` é união inline repetida em ~11 lugares:
`agents/types.ts:78,216,442` · `chat.functions.ts:609,662` · `submeter.tsx:2665,2768` ·
`step3-chat.tsx:885,1242,1455` · `constants.ts:739`) — vale considerá-lo o canônico da cadência.

## Plano ativo
**→ [docs/plans/godocs-v2-submissao-deterministica.md](plans/godocs-v2-submissao-deterministica.md)** · Status: ✅ aprovado (Luis, 02/09/2026) · **T1 e T2 executadas — próxima é a T3**

> Branch `feat/godocs-v2`, worktree `~/godocs-wt-v2`. Frente NOVA e isolada: o GoDocs v2 (submissão
> determinística sem agente no cliente). **Nada nesta branch toca prod (`674a3710`) nem o staging v1
> (`edf400b4`)** — o ambiente é o `godocs-v2-staging`, aba `STAGING-V2`. O handoff da frente anterior
> (mesa de avaliação) segue abaixo, preservado, e pertence à `main`.

## O que esta sessão fez (02/09) — planejamento, zero código
- Criou a branch `feat/godocs-v2` e a worktree `~/godocs-wt-v2` a partir de `origin/main` (`8b98cd4`).
- Fechou com o Luis as **8 decisões** da v2 (régua saving efetivado × custo evitado, fórmula com pesos,
  mensalização por bloco, fusão das duas linhas de custo, fim do agente no cliente, especial derivado de
  estrela, doc invisível em background, ambiente isolado) — registradas em D1..D8 no plano.
- Escreveu o plano aprovado `docs/plans/godocs-v2-submissao-deterministica.md` (roadmap T1..T9) e mapeou o
  blast-radius com 3 exploradores em paralelo (formulário · cálculo/Sheets · background).
- Cristalizou a spec: `SPEC.md` §4 **Fase 3** com **RF-200..RF-227** e os invariantes **INV-10..INV-15**,
  mais a emenda ao **INV-03** (na v2 as horas deixam de compor o saving e passam a compor o custo evitado).

## Próximo passo
**Codar a T2 — o núcleo puro do impacto (`src/lib/impacto.ts`) — com `/ggsd:code`**, escrevendo o teste antes:
pesos (`1,0` saving efetivado · `0,5` custo evitado · `0,1` receita) e divisores de frequência
(pontual 4 · mensal 1 · trimestral 3 · semestral 6) como constantes nomeadas, com os 3 exemplos da conversa
como casos. Em paralelo, a **T1** provisiona o app `godocs-v2-staging` e a aba `STAGING-V2`.

## Pendências / avisos
- **Nada nesta branch pode tocar prod (`674a3710`) nem o staging v1 (`edf400b4`)** — é a fronteira nº 1 do plano.
- Os 3 exploradores rodaram **sem `docs/INDEX.md`/`docs/invariants.md`** (não existem neste repo): confiança
  do mapeamento é **média**, e a sessão de código deve refazer a varredura profunda antes de mexer em
  `SHEET_COLUMNS` e na fórmula.
- **Cabeçalho real da aba `STAGING-V2` ainda não foi conferido** contra a proposta de colunas da T6 — usar
  `scripts/dryrun-lider/cabecalho-full.ts`.
- Assumido de olho aberto: com o chat fora, **os 7 gates conversacionais morrem** e nada barra número
  implausível no envio. A validação vira 100% pós-submissão; regras de backend são frente posterior.
- Os marcadores de gate em `.claude/` (`suite-status=verde`, `review-status=conforme`, `quality-status=limpo`)
  são herança da frente anterior; esta sessão não rodou suíte porque não tocou código.

---

---

# Handoff anterior (frente da mesa de avaliação — pertence à `main`)

## Plano ativo
`docs/plans/mesa-avaliacao-parecer-raciocinado.md` — mesa de avaliação de eco-de-gate a auditor raciocinado (escopo B, time LLM em SOMBRA). **Em execução via /ggsd:code.** T1–T7 concluídos e commitados; falta a revisão §9 fechar + o deploy do Luis.

## O que esta sessão fez (29/08) — T5, T6 e T7 fechados no código
- **T5 (fiação da mesa LLM)** em `src/lib/avaliacao-normais.functions.ts`, gated por `especialistasMesaLlmLigados()` (`AVALIACAO_MESA_LLM`, DEFAULT OFF):
  - `computarVotos`: quando LIGADO, monta `TextoProjeto` (via `montarEntradaSemanticaNormal`, `?? ''`) + `vizinhosTexto` (`nome — area`), roda `montarEntradasEspecialistas` (ponte T5) → `Promise.all(julgarComEspecialista)` (nunca lança) → `conciliarJulgamentos` como `conciliado` EFETIVO; `ceticoRefuta` = cético LLM `.preocupa`. OFF → determinístico byte-idêntico.
  - `VotosPainel` += `julgamentos?`/`ceticoRefuta`. `serializarVotos` EXPORTADO + grava julgamentos ENXUTOS (`dimensao/preocupa/confianca/origem`, sem `argumento`/R$; chave só quando há julgamentos → OFF byte-idêntico).
  - `avaliarComContexto` e `avancarDeliberacoesPendentes`: `ceticoRefuta` efetivo no sinal da deliberação + histórico grava o PARECER argumentado quando LIGADO; redator determinístico é PULADO no modo LLM (`&& !modoLlm`).
- **T6 (rodadas na ficha)**: `montarAvaliacaoSombra` deixou de descartar `historico` + novo `parseHistoricoDeliberacao` (fail-soft) em `dashboard-admin.functions.ts`; tipo `avaliacaoSombra.deliberacao.historico[]`; render das rodadas em `projeto-detalhe-dialog.tsx` (só quando ≥2 rodadas). Lote passa `undefined→[]` (mantém o invariante de NÃO `SELECT historico` em lote — 32 MiB RPC).
- **T7 (retroativo = rede)**: confirmado POR CONSTRUÇÃO — `avaliacao-retroativa.functions.ts` já roda `computarVotosDoProjeto` → mede a MESA NOVA (LLM) contra o veredito humano. Só o comentário-cabeçalho foi tornado explícito.
- Testes novos: `tests/mesa-fiada-serializacao.test.ts` (4) + `tests/mesa-historico-rodadas.test.ts` (5). **Suíte cheia 2293 verde**; `tsc` só os 7 erros pré-existentes (chat.functions/submeter/especiais-painel). `worker.js` rebuildado (regra 1).

## Próximo passo
**§9 FECHADA E LIMPA** (conformidade=`conforme` 0.92 · qualidade=`limpo` 0.86; 1 observação BAIXA não-bloqueante: render das rodadas só com ≥2 — decisão de UX consciente, deixada como está). Próximo é o **deploy**: **staging (`edf400b4`) → validar num projeto de receita real + um absurdo (500h) com `AVALIACAO_MESA_LLM` ligado SÓ na staging → prod (`674a3710`) → PR (`LuisEduardo100`)** + atualizar CLAUDE.md/spec. `/ggsd:ship` está liberado pela §9.

## Pendências / avisos
- **§9 do T5–T7 — QUALIDADE=`limpo` (0.86, zero achados), CONFORMIDADE ainda em background** ao fechar a sessão. Colher o veredito de conformidade antes do ship (o `/ggsd:ship` barra até `.review-status` fechar).
- **Byte-idêntico obrigatório com `AVALIACAO_MESA_LLM` OFF** — prod roda `AVALIACAO_NORMAIS` ON em sombra determinística; a fiação não pode alterar isso (testado em `mesa-fiada-serializacao`).
- **Custo aceito**: com a mesa LLM ligada são N chamadas LLM/rodada × até 5 rodadas em background (sombra, cron-bounded) — Decisão 2 do plano.
- **T6 no lote**: a ficha aberta pelo LOTE do /dashboard NÃO mostra as rodadas (historico não vem no lote); só a ficha individual (`getProjetoDashboard`) as traz. Decisão consciente (32 MiB RPC).
- Ordem restante: **§9 → staging/prod/PR → CLAUDE.md/spec**.
