# NEXT-SESSION

## 🔧 T1 EM PREPARO (02/09) — ambiente v2 isolado

**Worktree/space:** `/home/notebook/godocs-v2` (branch `feat/godocs-v2`, space Herdr `godocs-v2` = `w14`).
`node_modules` linkado p/ `../godocs-main/node_modules`, `.env` copiado. **Baseline: 2314 testes verdes.**

**Autorização do Luis (02/09):** criar o app `godocs-v2-staging` no Godeploy com **datasource novo**
está liberado — ele puxa da aba **`STAGING-V2`, que JÁ EXISTE na planilha**, e sobem as **mesmas
credenciais** da staging v1. Sem pendência de decisão.

### ⚠️ Achado do mapeamento (faz o T1 ser 5 arquivos, não 1)
`GODOCS_ENV=v2-staging` cai em **`'production'`** no parser de hoje (`env.ts:16` só reconhece
`'staging'`) — isso **desliga o guard** `assertNaoEhDefaultDeProd` e joga tudo no caminho REAL.
Pontos que leem o ambiente e precisam reconhecer o v2:

| Arquivo | Linha | Risco se não tratar |
|---|---|---|
| `src/lib/env.ts` | 12·16·21 | `GodocsEnv` + `getGodocsEnv` + `isStaging` — o guard do Sheet/Drive nunca dispara |
| `src/lib/pinecone.ts` | 82 | namespace volta `'prod'` → **contamina o índice de produção** |
| `src/lib/gomoon-lideres.functions.ts` | 371 | `ambiente: 'producao'` → **DM real para líder** (é a ÚNICA proteção, ver CLAUDE.md D-Gomoon) |
| `src/lib/rollup-push.functions.ts` | 180 | push outbound marcado como produção |
| `src/components/staging-banner.tsx` + `worker.ts` | 14·33 / 261 | faixa de ambiente não aparece no v2 (compara `=== 'staging'`) |

Direção proposta: `isStaging()` passa a ser **true** para `staging` E `v2-staging` (é o predicado que
carrega a segurança); os 3 sites `getGodocsEnv() === 'staging' ? … : 'producao'` passam a usar
`isStaging()`; a faixa compara `!== 'production'`. Teste vivo: `tests/env-staging.test.ts`.

**Isolamento é por env, não por código:** `GOOGLE_SHEETS_TAB=STAGING-V2` · `GOOGLE_SHEETS_ID` ·
`GOOGLE_DRIVE_FOLDER_ID` (o guard recusa cair no default de prod: `sheets.ts:13-17`).

**Próximo passo:** §7.1 test-writer sobre `tests/env-staging.test.ts` (red p/ `v2-staging`) → implementar
os 5 pontos → `createApp godocs-v2-staging` + secrets (`GODOCS_ENV=v2-staging`, aba `STAGING-V2`, Chat e
Gomoon mudos) → guarda do T1: submissão de teste escreve em `STAGING-V2` e **nunca** em `GoDocs`/`STAGING`.

### 🔒 Trava mecânica: esta pasta não toca prod nem staging v1
Hook **PreToolUse** em `/home/notebook/godocs-v2/.claude/settings.json` +
`.claude/hooks/guarda-app-v1.{sh,py}` (LOCAIS, no `.git/info/exclude` — nunca vão pro `main`):
qualquer tool MUTANTE do GoDeploy (`updateApp`·`deleteApp`·`setAppSecret`·`deleteAppSecret`·
`createCronJob`·`deleteCronJob`·`setCronJobEnabled`·`setAppOwner`·`setAppPrivate`·`setAppPublic`·
`setAppSlug`) com `appId` **`674a3710`** (prod) ou **`edf400b4`** (staging v1) é **barrada (exit 2)**.
`createApp` NÃO é barrado (é como o app do v2 nasce). **Fail-CLOSED**: JSON ilegível ou o próprio
guard quebrando ainda barram se o payload citar um id da v1 (testado com o python sabotado).
**Escopado** a esta pasta/branch — em `godocs-main` é no-op, para não travar o deploy legítimo da v1.
⚠️ Falta a trava SIMÉTRICA (barrar o app do v2 a partir do `godocs-main`): só dá para escrever
depois de o app existir, porque precisa do id. Fazer junto do T1.

## Plano ativo
**→ [docs/plans/godocs-v2-submissao-deterministica.md](plans/godocs-v2-submissao-deterministica.md)** · Status: ✅ aprovado (Luis, 02/09/2026)

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
