# Harness E2E — validação coluna-a-coluna

Exercita o fluxo de submissão/edição de ponta a ponta contra a aplicação (default:
**produção**) cobrindo um cartesiano amplo das dimensões do formulário e valida cada
coluna gerada na planilha (A→AS). São **24 cenários** organizados em grupos:

- **A — saving financeiro** (complexidade=automacao): custo evitado {não·mensal·pontual·**misto**}
  × custo externo {não·sim} = 8 células + multi-cargo.
- **B — receita**: pura mensal, pura pontual.
- **C — saving+receita**: mensal; saving+custo evitado+receita pontual.
- **D — complexidade** (classificação do analisador): `inteligencia` (IA classifica),
  `autonomia` (agente decide/age sozinho), e os cruzamentos com receita e saving+receita.
  O gate `tem_ia_como_funcionalidade` garante o piso: IA=Não → `automacao` (hard); IA=Sim →
  ≠`automacao` (hard). O nível fino (inteligencia↔autonomia) é julgamento do LLM → reportado
  como SOFT para revisão humana, junto com a coluna `Observações`.
- **E — especial** (pula saving/receita; analisador não roda → complexidade não validada).
- **F — edição / `Memorial anterior`**: F1 leve (recalcula horas), F2 reabre a conversa do
  agente (`atualizar-metadados` com doc nova → memorial novo), F3 reclassificação (base
  `automacao` + edição que adiciona IA → `inteligencia`). Cada edição usa uma **base dedicada**
  (`baseOnly`): a edição faz UPDATE in-place na mesma linha, então a base não é validada
  standalone (a linha reflete o estado pós-edição). O memorial pré-edição (M0) é capturado em
  tempo de run via `GET /api/meus-projetos/:id` e comparado contra a coluna `Memorial anterior`.

## Pré-requisitos (uma vez)

1. O **guard de Chat mudo** precisa estar deployado: projetos cujo nome começa com `[E2E-`
   **não** notificam o Google Chat (a gravação na planilha continua normal). Ver
   `src/lib/google/sync.ts` (`ehProjetoTesteE2E`).
2. O endpoint `POST /api/admin/e2e-cleanup` (admin) precisa estar deployado para a limpeza
   do SQLite.
3. `.env` na raiz com `GOOGLE_SA_KEY_BASE64`, `GOOGLE_SA_CLIENT_EMAIL` (ler/limpar planilha)
   e `LLM_BASE_URL` + `API_PROXY_TOKEN` (responder). Já presentes no projeto.
4. ⚠️ **`E2E_COOKIE`** no `.env` — o edge Godeploy exige OAuth para **TODAS** as rotas (inclusive
   `/api/*`). Logue em `godocs.devgogroup.com` e copie o header `cookie: SESSION=...`. Expira → renove.

## Uso

```bash
# 1. Roda todos os cenários (gera um runId; ou passe um). Grava .runs/<runId>.json
npm run e2e:run                 # runId automático (timestamp)
npm run e2e:run -- 20260619-1530

# 2. Valida coluna-a-coluna contra a planilha
npm run e2e:validate -- <runId>          # asserts determinísticos + poll Complexidade
npm run e2e:validate-llm -- <runId>      # LLM-juiz ("verificação da verificação")

# 3. Limpa os dados de teste (planilha PRIMEIRO, depois SQLite)
npm run e2e:cleanup -- <runId>
```

Duas camadas de validação: **`validate.mjs`** (asserts determinísticos — falha o teste) +
**`validate-llm.mjs`** (LLM-juiz, reporta divergências sutis). O harness já achou 3 bugs reais.

Variáveis opcionais: `E2E_BASE_URL` (default produção), `E2E_OWNER_EMAIL`
(default `luis.albuquerque@gocase.com`), `E2E_OWNER_NOME`.

## Como funciona

- **run.mjs** — para cada cenário: `iniciar-submissao` → dirige o chat com o **LLM responder**
  (`lib/responder.mjs`, reusa `llmChat` do app) até o preview, aprova, inicia as fases
  determinísticas (`iniciar-saving`/`iniciar-receita`) conforme o agente transiciona, e
  `submeter-validacao`. Captura o `ganho` retornado pela API.
- **validate.mjs** — lê a planilha (`lib/sheets.mjs`, Service Account), casa por `ID Projeto`
  e compara: (1) `expected.hard` (fórmula independente — falha o teste), (2) `expected.soft`
  (rótulos ambíguos — só reporta), (3) consistência **Ganho Total / Saving Reais planilha × API**,
  (4) **Complexidade** (gate hard + nível-fino soft) e (5) **Memorial anterior** (AF == M0
  capturado em run; M1 ≠ M0). A coluna `Complexidade` é preenchida pelo analisador em background
  (+ cron a cada 1 min), então o validador faz **poll** (relê a planilha até ~5 min) antes de
  comparar. Bases de edição (`baseOnly`) têm a validação standalone pulada.
- **cleanup.mjs** — remove as linhas da planilha (deleteDimension) e depois chama o
  endpoint admin que apaga do SQLite todos os `[E2E-...]`. Ordem importa: planilha antes do
  SQLite, senão o sync reverso por dono ressuscita os projetos.

## Tagging

Todo projeto de teste nasce com nome `[E2E-<runId>] <título>`. Esse prefixo identifica as
linhas na planilha/Investigador, é a chave da limpeza e o gatilho do mute de Chat.

## Reverter (quando a validação terminar)

- Remover o guard `ehProjetoTesteE2E` de `src/lib/google/sync.ts` e `chat.ts`.
- Remover o endpoint `/api/admin/e2e-cleanup` (`src/worker.ts`) e `deleteProjetosTesteE2E`
  (`src/integrations/db/client.server.ts`).
- `npm run build:worker` + commit + deploy. Apagar `scripts/e2e/`.
