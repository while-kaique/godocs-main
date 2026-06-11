# GoDocs — Como os Agentes de IA Funcionam (estado atual)

Documento de referência do funcionamento dos agentes de IA do GoDocs: o que cada um faz,
parâmetros, lógica, regras de negócio, o que puxa de contexto, como processa e o que salva.

> Base: código atual em `src/lib/agents/*`, `src/lib/chat.functions.ts`, `src/lib/llm.ts`.
> Idioma de toda saída ao usuário: **português brasileiro** com acentuação correta.

---

## 1. Visão geral — os 5 agentes

| # | Agente | Arquivo | Quando roda | Papel |
|---|---|---|---|---|
| 1 | **Extractor** | `agents/extractor.ts` | No início da submissão (1x) | Lê os arquivos e **pré-preenche os 7 campos** da doc |
| 2 | **Orquestrador** | `agents/orchestrator.ts` | A cada mensagem do chat | Conduz o chat por **fases** (doc → impacto), faz perguntas, gera previews |
| 3 | **Compilador** | `agents/doc-compiler.ts` | Na aprovação da doc | Consolida os campos na **documentação final estruturada** (6 seções) |
| 4 | **Validador** | `agents/validator.ts` | Triagem do admin | Aprova/rejeita a doc por **critérios** e dá um parecer |
| 5 | **E-mail** | `agents/email-agent.ts` | Após validação | Dispara e-mail de aprovação/rejeição (Brevo) |

Os agentes 1–3 rodam no **fluxo de submissão** (usuário). Os 4–5 rodam na **triagem** (admin).
Há ainda um **cálculo determinístico de saving** no backend (não é LLM) — descrito na seção 7.

Todos os agentes conversam com o LLM pela camada única `llm.ts`.

---

## 2. Camada LLM (`llm.ts`) — parâmetros e resiliência

Ponto único de chamada: `llmChat(messages, opts)`.

**Configuração (env vars):**
- `LLM_PROVIDER` — `openai` (default) ou `anthropic`
- `LLM_API_KEY` — chave do provider
- `LLM_MODEL` — modelo (default `gpt-4.1`)

**Opções por chamada (`LLMOptions`):**
- `temperature` (default 0.7) — cada agente define a sua (ver tabela abaixo)
- `maxTokens` (default **2048**) — vira `max_completion_tokens` (OpenAI) / `max_tokens` (Anthropic)
- `jsonMode` — liga `response_format: { type: 'json_object' }` (OpenAI)

**Resiliência a modelos novos (gpt-5+):** se a API responde `400` por parâmetro/valor não
suportado (ex.: `temperature` que só aceita o default, `max_tokens` legado), a camada
**remove o parâmetro, memoriza por modelo e re-tenta** (até 4 tentativas). Assim o mesmo
código roda em modelos diferentes sem quebrar.

> ⚠️ O default de `maxTokens` é 2048 — baixo para saídas longas. Agentes que produzem
> JSON grande (compilador, extractor-reduce) **passam `maxTokens` explícito** (8192).
> Esse foi o ponto que causava truncamento (ver seção 6).

---

## 3. Fluxo ponta a ponta

```
ETAPA 1 (Envio) + ETAPA 2 (Projeto + upload)
        │  metadados + arquivos
        ▼
┌─────────────────────────────────────────────────────────────┐
│ iniciarSubmissao()                                            │
│  1. cria projeto (projetos)                                   │
│  2. extrai texto de TODOS os arquivos (extractTextFromMulti)  │
│  3. AGENTE 1 — Extractor → pré-preenche os 7 campos           │
│  4. AGENTE 2 — Orquestrador (fase doc) → 1ª mensagem          │
└─────────────────────────────────────────────────────────────┘
        ▼
   ┌──────────────── FASE DOC (chat) ────────────────┐
   │ Orquestrador pergunta só os campos null,         │
   │ valida coerência ferramenta×arquivos, gera        │
   │ PREVIEW → usuário aprova                          │
   └──────────────────────────────────────────────────┘
        │ aprovou (doc_preview → complete)
        ▼
   AGENTE 3 — Compilador  → documentacao (6 seções)
   (compila ANTES de confirmar a transição; sem fallback)
        ▼
   Formulário determinístico (SavingForm) → cálculo R$ no backend
        ▼
   ┌──────────── FASE IMPACTO (chat) ────────────┐
   │ saving:  valida HORAS, monta memorial         │
   │ receita: coleta valor_ganho, monta memorial   │
   │ PREVIEW → usuário aprova → completo           │
   └───────────────────────────────────────────────┘
        ▼
   submeterParaValidacao()  → salva colunas financeiras,
   auto-aprova se área=RPA, notifica Google Chat
        ▼
═══════════ TRIAGEM (admin) ═══════════
   validarProjeto()
     → AGENTE 4 — Validador (aprovado/rejeitado + parecer)
     → AGENTE 5 — E-mail (Brevo)
     → status: validado | rejeitado
```

**Máquina de estados do chat (`ChatFase`):**
```
doc → doc_preview → ┬─ saving  → saving_preview  ─┐
                    └─ receita → receita_preview ─┴→ completo
```
- Só **saving** ou só **receita**: vai direto para a fase certa após a doc.
- **Ambos os tipos**: roda `saving → saving_preview → receita → receita_preview → completo`.
- O roteamento `doc_preview → saving|receita` e `saving_preview → receita|completo` é
  decidido lendo `tipos_projeto` **do banco** (atualizado se o usuário trocar o tipo na etapa 2).

---

## 4. Agente 1 — Extractor (`extractor.ts`)

**Objetivo:** ler a codebase/arquivos e preencher automaticamente os 7 campos, para o chat
**só perguntar o que o código não revela** (regras de negócio).

**Parâmetros:** `temperature: 0`, `jsonMode: true`, `maxTokens` 4096 (lote) / 8192 (consolidação).

**O que puxa:**
- `doc_texto` — conteúdo concatenado de todos os arquivos (já extraído).
- `ctx.descricao_breve` — **contexto de negócio escrito pelo usuário** na etapa 2.
- Metadados: `nome_projeto`, `ferramenta`, `area`.

**Lógica (estratégia por tamanho):**
- Conteúdo `<= 150.000 chars` → **1 chamada** (`extrairLote`).
- Conteúdo maior → **map-reduce**:
  1. `dividirEmLotes()` quebra por arquivo (separador `\n\n---\n\n`), lotes de ~150k chars;
  2. extrai cada lote **em paralelo** (`map`);
  3. `consolidar()` funde os parciais numa doc coesa (`reduce`).
- Se a consolidação do LLM vier vazia/truncada → **merge determinístico** dos lotes
  (`mergeDeterministico`) — nunca descarta o que já foi extraído.

**Regras de negócio:**
- Campos **técnicos** (`execucao`, `dependencias`, `fluxo`, `configurar_antes`): preencher
  sempre que estiver no código, com valores EXATOS (URLs, cron, env vars, nomes de workflow).
- Campos de **negócio** (`o_que_faz`, `atencao`): inferir o que der; podem ficar `null`.
- `nome_projeto`: cai para o nome do formulário se o código não revelar.

**Resiliência:** `parseFlexivel()` recupera campos via regex se o JSON vier truncado
(inclusive o último campo cortado); `norm()` converte a string `"null"`/`"n/a"` no `null` real.

**Os 7 campos (`DocumentacaoColetada`):**
`nome_projeto`, `o_que_faz`, `execucao`, `dependencias`, `fluxo`, `configurar_antes`, `atencao`.

---

## 5. Agente 2 — Orquestrador (`orchestrator.ts`)

**Entry:** `runOrchestrator(ctx, history, fase, coletado, saving, resumoProjeto, tipos_projeto, receita)`.

**Parâmetros:** `temperature 0.2` nas fases `doc`/`doc_preview`, `0.4` nas demais; `jsonMode: true`.
Respostas **sempre em JSON**: `{ type, content/question, coletado/saving/receita, options? }`.
`type` ∈ `question | options | preview | complete`.

**Transições automáticas (pós-resposta):**
- `type: preview` → bump de fase (`doc`→`doc_preview`, `saving`→`saving_preview`, `receita`→`receita_preview`).
- `type: complete`:
  - de `doc_preview` → `saving` se `tipos_projeto` inclui saving, senão `receita`;
  - de `saving_preview` → `receita` se também tem receita, senão `completo`;
  - de `receita_preview` → `completo`.
- Fallback: se o JSON vier truncado, recupera `type`/`content` via regex e ainda aplica a transição.

### Fase 1 — Documentação (`buildDocPrompt` / `buildDocPreviewPrompt`)

**O que puxa:** `descricao_breve` (contexto de negócio), todos os metadados, e o estado da
coleta (`coletado`, com os campos que o extractor preencheu vs. os que estão `null`).

**Regras de negócio:**
- **NÃO** reconfirma campos já extraídos do código; foca só nos `null`.
- **1 pergunta por vez**, direto ao ponto, **cética** com respostas vagas (aprofunda em vez de aceitar).
- Pergunta ambígua → oferece 3 opções concretas (`type: options`).
- **Validação de coerência (obrigatória):** cruza a `ferramenta` informada × nome × arquivos.
  Ex.: ferramenta "n8n" mas sem JSON de workflow → questiona se enviou os arquivos certos.
  Não bloqueia — aponta e segue com a resposta.
- Nunca inventa; quando os 7 campos têm informação, gera o **preview** em markdown.
- **Aprovação (`doc_preview` → complete):** o `content` vira um **resumo factual do projeto
  em 3–5 frases**. Esse resumo é guardado e usado como `resumoProjeto` (contexto da fase de impacto).

### Fase 2a — Saving (`buildSavingPrompt` / `buildSavingPreviewPrompt`)

**O que puxa:** `resumoProjeto` (da doc), detalhes técnicos aprovados (`o_que_faz`, `execucao`,
`fluxo`, `ferramenta`) e o objeto `saving` já pré-calculado (linhas por cargo, horas, tipo).

**Regras de negócio (o coração da validação):**
- **NUNCA menciona valores em R$** ao usuário — o cálculo é métrica de gestão (feito no backend).
  O agente foca **apenas nas HORAS**.
- **NUNCA aceita as horas "de cara":** exige o detalhamento da rotina manual passo a passo
  (quais tarefas, frequência, tempo de cada, quem executava).
- **Faz a conta:** ex. "50 cadastros × 15 min ≈ 12h"; se a hora informada destoar, aponta e pede explicação.
- **Desafia extrapolação:** se o fluxo técnico é simples mas as horas são altas, questiona.
  Se a estimativa de uma pessoa parece inflada, questiona aquela linha.
- Se o detalhamento mudar as horas reais, **atualiza** `horas_antes/horas_depois/economia_horas_mes`
  da linha e **recalcula** o total.
- Monta o `memorial_calculo` **automaticamente** (o usuário não escreve), justificando por pessoa/cargo.

### Fase 2b — Receita incremental (`buildReceitaPrompt` / `buildReceitaPreviewPrompt`)

**Regras de negócio:**
- Coleta `valor_ganho_mensal` (R$/mês, ou total se pontual) **via conversa**.
- **Desafia o valor** pedindo evidências concretas (receita antes vs. depois, base de comparação).
- Monta o `memorial_calculo` automaticamente; anti-extrapolação (ganho real e mensurável, não projeção otimista).

**Primeira mensagem de cada fase:** quando `history` está vazio, o orquestrador injeta uma
mensagem `[SISTEMA]` que adapta a abertura — ex.: se o extractor preencheu os 7 campos, manda
**gerar o preview direto** (zero perguntas); se preencheu parcialmente, cumprimenta e pergunta
só o campo null mais relevante.

---

## 6. Agente 3 — Compilador de documentação (`doc-compiler.ts`)

**Objetivo:** transformar os 7 campos coletados na **documentação final estruturada** de 6 seções
(`DocumentacaoGerada`). É o cerne do produto — é o que a triagem revisa.

**Parâmetros:** `temperature 0.3`, `jsonMode: true`, `maxTokens: 8192`, **até 3 tentativas**.

**O que puxa:** os 7 campos (`coletado`) + contexto (`responsavel_nome/email`, `area`, `ferramenta`, `membros`).

**Lógica e regra de negócio (sem fallback):**
- A doc **tem** que ser gerada pelo agente — **não há fallback determinístico**.
- Se o JSON vier truncado/inválido, **re-tenta** (reapresenta a resposta anterior pedindo JSON completo).
- Após 3 tentativas sem sucesso → **lança erro**.
- Quem chama é o `enviarMensagem`, na transição `doc_preview → impacto`: ele **compila e salva ANTES
  de confirmar a transição**. Se o compilador lançar, **nada é persistido** e o usuário continua no
  preview podendo **reaprovar** (o erro sobe até o front, que faz rollback e mostra toast).
  → Garante que nunca se avança com a doc vazia.

**Saída (`DocumentacaoGerada`):** `titulo`, `responsavel`, `ferramenta`, `membros`, `o_que_faz`,
`execucao`, `dependencias[]`, `fluxo[]` (com `condicoes`), `configurar_antes[]`, `atencao[]`,
`saving?`/`receita?` (anexados depois), `gerado_em`.

---

## 7. Cálculo de saving (determinístico, backend) — `iniciarSaving`

**Não é LLM.** Roda no backend quando o usuário submete o `SavingForm`. O **valor em R$ nunca
é exposto ao usuário** — só horas aparecem na tela.

Para cada linha (pessoa/cargo):
```
valor_hora          = CARGOS[cargo].valor_hora            (tabela de referência)
economia_horas_mes  = max(0, horas_antes − horas_depois)  (clampado em 0)
economia_reais_mes  = economia_horas_mes × valor_hora      (arredonda 2 casas)
```
Totais:
```
economia_horas_mes (total)  = Σ economia_horas_mes
economia_reais_mes (total)  = (Σ economia_reais_mes) − custo_externo_mensal
```

**Tabela `CARGOS` (R$/hora com encargos):**

| Cargo | R$/h |
|---|---|
| Estagiário | 10,78 |
| Assistente | 13,94 |
| Analista Júnior | 21,29 |
| Analista Pleno | 29,90 |
| Analista Sênior | 33,10 |
| Coordenador / Especialista | 55,15 |

Depois do cálculo, o orquestrador (fase saving) recebe esses valores prontos e só **valida as horas**.

---

## 8. Agente 4 — Validador (`validator.ts`) [triagem admin]

**Entry:** `validarDocumentacao(doc)` — disparado por `validarProjeto` (`POST /api/admin/validar-projeto`).

**Parâmetros:** `temperature 0.2`, `jsonMode: true`.

**O que puxa:** a `documentacao` salva + os **critérios** (configuráveis na tabela `configuracoes`,
chave `validation_criteria`; senão usa 6 defaults).

**Critérios default (com peso):**
1. Propósito claro — *obrigatório*
2. Trigger definido — *obrigatório*
3. Dependências completas — *obrigatório*
4. Fluxo lógico e completo — *obrigatório*
5. Configuração inicial documentada — *importante*
6. Riscos e limitações identificados — *desejável*

**Regra de aprovação:** todos os **obrigatórios** aprovados **e** ≥1 **importante** aprovado;
desejáveis são bônus. Retorna `{ resultado, parecer, criterios[], pontuacao 0-100 }`.

**O que salva:** linha em `validacoes` + `projetos.status` = `validado`/`rejeitado` + `validated_at`.

---

## 9. Agente 5 — E-mail (`email-agent.ts`) [triagem admin]

Após a validação, `validarProjeto` chama `enviarEmailAprovacao(doc, resultado)` ou
`enviarEmailRejeicao(...)` (Brevo — `BREVO_API_KEY` / `EMAIL_FROM`). Falha de e-mail é logada
mas **não derruba** a validação. Marca `validacoes.email_enviado`.

---

## 10. O que cada passo puxa e o que salva (resumo de dados)

| Passo / função | Puxa | Salva |
|---|---|---|
| `iniciarSubmissao` | metadados (etapas 1-2) + arquivos | `projetos`, `chat_messages` (msg `doc` com texto dos arquivos + 1ª msg do assistente) |
| **Extractor** | `doc_texto`, `descricao_breve`, metadados | (em memória) os 7 campos pré-preenchidos |
| `enviarMensagem` | `chat_messages` + `getProjetoContexto` (inclui `descricao_breve`, `data_criacao`) + `tipos_projeto` do banco | nova `chat_messages` (user + assistant); na aprovação da doc → `documentacao` |
| **Compilador** | `coletado` + ctx (responsável, área, ferramenta, membros) | `documentacao.conteudo` (DocumentacaoGerada) |
| `iniciarSaving`/`iniciarReceita` | ctx + dados do form (linhas/horas/tipo) | `chat_messages` (1ª msg da fase de impacto) |
| `submeterParaValidacao` | `documentacao` (saving/receita) | colunas financeiras em `projetos`; status (`aprovado` se RPA, senão `em_validacao`); notifica Google Chat |
| `validarProjeto` | `documentacao` + critérios | `validacoes`; `projetos.status` (validado/rejeitado) + e-mail |

> Correção recente importante: `getProjetoContexto` agora popula `descricao_breve` e
> `data_criacao` (antes vinham vazios) — então o **contexto de negócio do usuário chega de fato
> ao extractor e ao orquestrador**, evitando perguntas redundantes.

---

## 11. Tabela rápida de parâmetros por agente

| Agente | temperature | jsonMode | maxTokens | tentativas / fallback |
|---|---|---|---|---|
| Extractor (lote) | 0 | sim | 4096 | regex parse; merge determinístico no reduce |
| Extractor (consolidação) | 0 | sim | 8192 | merge determinístico se vazio |
| Orquestrador (doc) | 0.2 | sim | default (2048) | regex parse + transição no truncado |
| Orquestrador (impacto) | 0.4 | sim | default (2048) | regex parse + transição no truncado |
| Compilador | 0.3 | sim | 8192 | 3 tentativas, **sem fallback** → lança |
| Validador | 0.2 | sim | default (2048) | — |

---

## 12. Onde mexer

- **Prompts / regras de conduta dos agentes:** `src/lib/agents/orchestrator.ts` (chat),
  `extractor.ts` (pré-extração), `doc-compiler.ts` (doc final), `validator.ts` (critérios).
- **Cálculo de saving / tabela de cargos:** `CARGOS` em `agents/types.ts`; cálculo em `iniciarSaving` (`chat.functions.ts`).
- **Contexto que os agentes recebem:** `getProjetoContexto` em `chat.functions.ts` + `getProjetoContextoData` em `client.server.ts`.
- **Parâmetros de modelo / providers:** `src/lib/llm.ts` + env vars (`LLM_*`).
- ⚠️ Ao alterar qualquer um desses (são código de backend), rode `npm run build:worker` e
  comite o `worker.js`, além de `npm run test`.
```
