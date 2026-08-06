# Plano — "too big" na submissão: campo `ferramenta` sem trava na UI

**Status:** 🟢 **T1+T2 CODADOS e testados** (2026-08-05) — aprovado pelo Luis na sessão ("corrija pelo menos
pra que ela tenha um feedback real"). Branch **`fix/erro-validacao-amigavel`**, commit **`b9fe98e`**, worktree
`.claude/worktrees/fix-too-big`, base `origin/main` `bac862b`. Suíte **943 verdes**.
⛔ **T4 (staging → prod) BLOQUEADO:** a staging está com a frente da **pré-aprovação do líder**, que não está
na `main`, e o `updateApp` substitui a app INTEIRA — deployar daqui apagaria a feature do líder. Decisão
pendente do Luis: **(a)** mergear esta branch por cima da do líder e validar as duas juntas · **(b)** esperar
a staging liberar · **(c)** abrir o PR (`/ggsd:ship`) e deployar na próxima janela.
**Origem:** caso real em PRODUÇÃO — Josiely Ferreira, 2026-08-05, ~17:32–17:40.
**Sessão de origem:** investigação (2026-08-05) — **zero código**, só leitura de logs + sondagem.

---

## 1. Sintoma

A Josiely tentou submeter o projeto "Análise Inteligente de Prazos" e o formulário devolveu um erro com a
palavra **"too big"** em inglês. Ela tentou **10 vezes** antes de conseguir.

Timeline em prod (`getAppLogs` do app `674a3710`, horário do log):

| Hora | O quê |
|---|---|
| 17:26 | abre `/submeter` (`/api/auth/me` + `/api/meus-projetos/pendentes` com o e-mail dela) |
| 17:32:08 / :21 / :29 / :43 | **4× `POST /api/chat/iniciar-submissao` com ZERO linha de log** |
| 17:33 | recarrega o `/submeter` |
| 17:34:19 / :30 / :36 / :38 | **4× de novo, ZERO log** |
| 17:38:44 / :56 | **2× de novo, ZERO log** |
| 17:40:10 | ✅ passa — projeto `1d37cb8155199ce91a3687dc7832c532` criado (ficou em `rascunho`) |

## 2. Causa (reproduzida)

**As 10 requisições morreram no `iniciarSubmissaoSchema.parse(rawData)`** — `src/lib/chat.functions.ts:611`.
A pista determinante: elas não têm **nenhuma** linha de log, e `iniciarSubmissao` loga
`"Iniciando para …"` **imediatamente depois** do parse. O parse do zod é o único ponto que estoura antes de
qualquer log; o `readBody` está fora do `try` interno e cairia no catch externo do `worker.ts:598`, que
**loga** (`console.error('[worker] …')`) — logo, não foi ele.

O campo que estourou é **`ferramenta`** (`z.string().max(200)`):

- O projeto que ela conseguiu salvar tem `ferramenta` com **126 chars**:
  `"Outros: Selenium, Python, Intelipost API, Metabase, Google Sheets/Apps Script, Cloudflare Workers/D1, HTML/CSS/JS, APIs de CEP"`
  — ela foi **cortando a lista de ferramentas** até passar.
- O input "✏️ Especifique a ferramenta" (`src/lib/submeter/step1.tsx:371`) **não tem `maxLength`** nem
  validação de comprimento em lugar nenhum do cliente (`validarEtapa1` não checa tamanho).
- O valor enviado é `"Outros: " + ferramentaOutra.trim()` (`src/routes/submeter.tsx:996-998`, 1041, 1287) →
  bastam **193 chars digitados** para estourar os 200 do schema.

**Reproduzido na staging** (`edf400b4`) com `ferramenta` de 201 chars:

```json
{"error":"[{ \"code\": \"too_big\", \"maximum\": 200, \"type\": \"string\",
  \"message\": \"String must contain at most 200 character(s)\", \"path\": [\"ferramenta\"] }]"}
HTTP 500
```

Esse JSON cru vai **inteiro** para o toast: o `apiFetch` (`src/lib/api-client.ts`) joga `data.error` literal
no `ApiError`. Daí o "too big" que ela viu.

**São 2 defeitos somados:**
1. **UI aceita mais do que o backend** (campo sem `maxLength` × `max(200)` no schema).
2. **Erro de validação sai como HTTP 500 com ZodError cru**, em inglês, em vez de 400 com texto legível em
   PT-BR. O `enviarMensagem` já tem esse guard amigável (`LIMITE_MENSAGEM_CHAT`); o `iniciarSubmissao` não.

## 3. O que foi DESCARTADO (não re-investigar)

- ❌ **Limite de payload do edge/Godeploy.** Sondei a staging com bodies de **1 / 4 / 8 / 10 / 12 / 20 MB** e
  **todos** chegaram ao worker (voltaram ZodError de campo faltando, não 413). O PDF dela tinha 265 KB.
- ❌ **`descricao_breve`** (604 chars no caso dela; a UI já trava em `maxLength={1000}`).
- ❌ **`contrafactual_reclamacao`** (UI trava em `maxLength={600}`).
- ❌ **OCR / extração de texto** (a extração do PDF dela rodou OK: 18.244 chars).

## 4. Ressalvas honestas (o que NÃO foi provado)

- As 10 requisições vazias **não trazem e-mail** (falharam antes de logar). A atribuição à Josiely é por
  **cerco de horário** — entre o `/api/auth/me` dela (17:33) e o sucesso dela (17:40) — e as outras
  `iniciar-submissao` da janela logaram tudo direito (Rian 17:19, Nádia 17:39:50).
- **Não deu para ler qual campo exatamente** estourou na tentativa dela: o `api_logs` guarda `error` +
  `request_body` (o `insertApiLog` do catch, `worker.ts:308`), mas só existe endpoint **por `id` de log**
  (`/api/admin/investigador/log/:id`) e o `id` é hex aleatório — não há listagem de logs recentes exposta, e
  o `projeto_id` é `null` nesses casos (o projeto nem foi criado). `ferramenta` é o candidato de longe mais
  provável (o valor final dela é uma lista de 126 chars, o campo é o único sem trava que ela de fato usou).
- Outros campos **sem trava na UI** que podem causar o mesmo erro: **`nome_projeto`** (`max(200)`,
  `step2.tsx:574`), **`servico_externo`** (`max(200)`, `step1.tsx:348`) e **`contrafactual_afetados`**
  (`max(1200)`, seleção **ilimitada** de pessoas — `serializarAfetados` em `constants.ts:290`; o dela tinha
  só 54 chars, mas ~36 pessoas estouram).

## 5. Fatias propostas

> ✅ **T1 e T2 entregues no commit `b9fe98e`** — o que de fato aterrissou (o T2 ficou MAIOR e melhor que o
> planejado: em vez de um guard só no `iniciarSubmissao`, virou um módulo puro ligado nos **2 catches** do
> `worker.ts`, cobrindo todas as rotas): `src/lib/erro-validacao.ts` (novo, `traduzirErroValidacao` — ZodError
> → **400** + frase PT-BR nomeando campo e limite, máx. 3 frases, e **`null` quando NÃO é validação** para
> falha real seguir 500) · `src/worker.ts` (2 catches; `api_logs` segue gravando o erro TÉCNICO) ·
> `maxLength` em `ferramentaOutra` **192** / `nome_projeto` 200 / `servicoExterno` 200 ·
> `tests/erro-validacao.test.ts` (5 casos, incl. os 201 chars do caso real + o guard do "não engolir") ·
> `worker.js` rebuildado · `SPEC_CORRECOES.md`. **T3 (cap no `AfetadosInput`) NÃO foi feito.**

**T1 — trava na UI (frontend).** `maxLength` nos inputs que hoje não têm, casando com o schema:
`ferramentaOutra` → **192** (porque o prefixo `"Outros: "` come 8), `nome_projeto` → 200, `servicoExterno`
→ 200. Contador de chars onde já houver o padrão (o `descricaoBreve` tem). Regra 11 → skill
`frontend-design` antes de tocar UI.

**T2 — guard amigável no backend.** No `iniciarSubmissao` (e no `atualizarMetadados`, mesmo schema de docs),
transformar `ZodError` em **400** com mensagem PT-BR nomeando o campo e o limite, no padrão do
`LIMITE_MENSAGEM_CHAT`. Nunca mais vazar ZodError cru para o toast. ⚠️ Mexe em `.functions.ts` → regra 1
(`npm run build:worker` + commitar o `worker.js`).

**T3 (opcional) — cap no `AfetadosInput`.** Limitar o nº de pessoas/times selecionáveis para o serializado
não passar de 1200 chars, com aviso claro.

**T4 — staging → prod.** Regra 13: `npm run test && npm run build && npm run build:worker` → `updateApp` no
**`edf400b4`** → validar no navegador (digitar 250 chars em "Especifique a ferramenta" e ver a trava) → só
então **`674a3710`**.

**Risco:** BAIXO (2 arquivos de frontend + 1 guard no backend; nenhuma mudança de dado ou de fluxo).

## 6. Achado colateral — proxy de LLM em timeout (frente SEPARADA)

Em **praticamente toda** chamada de LLM da janela inteira do log (não só nas dela):

```
[llm] Falha de TIMEOUT na chamada OpenAI: timeout após 25000ms (proxy não respondeu)
[llm] Proxy falhou/demorou — fallback p/ OpenAI direto
```

O fallback (`LLM_FALLBACK`, `gpt-5.4-mini`) está **salvando** as respostas — nada se perdeu —, mas **cada
turno do chat leva ~25 s a mais**. Isso é do gateway `ai-proxy.gogroupbr.com`, não deste bug. **Não foi
investigado** nesta sessão.

## 7. Comunicação

Avisar a Josiely que o projeto dela **entrou** (`1d37cb8155199ce91a3687dc7832c532`) mas ficou como
**`rascunho`** — não foi submetido. Ela precisa retomar e concluir.
