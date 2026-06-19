# Harness E2E — validação coluna-a-coluna

Exercita o fluxo de submissão/edição de ponta a ponta contra a aplicação (default:
**produção**) cobrindo os cenários financeiros (saving puro, custo evitado mensal/pontual,
custo externo, multi-cargo, receita pura/pontual, saving+receita, especial, edição) e
valida cada coluna gerada na planilha (A→AJ).

## Pré-requisitos (uma vez)

1. O **guard de Chat mudo** precisa estar deployado: projetos cujo nome começa com `[E2E-`
   **não** notificam o Google Chat (a gravação na planilha continua normal). Ver
   `src/lib/google/sync.ts` (`ehProjetoTesteE2E`).
2. O endpoint `POST /api/admin/e2e-cleanup` (admin) precisa estar deployado para a limpeza
   do SQLite.
3. `.env` na raiz com `GOOGLE_SA_KEY_BASE64`, `GOOGLE_SA_CLIENT_EMAIL` (ler/limpar planilha)
   e `LLM_BASE_URL` + `API_PROXY_TOKEN` (responder). Já presentes no projeto.

## Uso

```bash
# 1. Roda todos os cenários (gera um runId; ou passe um). Grava .runs/<runId>.json
npm run e2e:run                 # runId automático (timestamp)
npm run e2e:run -- 20260619-1530

# 2. Valida coluna-a-coluna contra a planilha
npm run e2e:validate -- <runId>

# 3. Limpa os dados de teste (planilha PRIMEIRO, depois SQLite)
npm run e2e:cleanup -- <runId>
```

Variáveis opcionais: `E2E_BASE_URL` (default produção), `E2E_OWNER_EMAIL`
(default `luis.albuquerque@gocase.com`), `E2E_OWNER_NOME`.

## Como funciona

- **run.mjs** — para cada cenário: `iniciar-submissao` → dirige o chat com o **LLM responder**
  (`lib/responder.mjs`, reusa `llmChat` do app) até o preview, aprova, inicia as fases
  determinísticas (`iniciar-saving`/`iniciar-receita`) conforme o agente transiciona, e
  `submeter-validacao`. Captura o `ganho` retornado pela API.
- **validate.mjs** — lê a planilha (`lib/sheets.mjs`, Service Account), casa por `ID Projeto`
  e compara: (1) `expected.hard` (fórmula independente — falha o teste), (2) `expected.soft`
  (rótulos ambíguos — só reporta), (3) consistência **Ganho Total / Saving Reais planilha × API**.
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
