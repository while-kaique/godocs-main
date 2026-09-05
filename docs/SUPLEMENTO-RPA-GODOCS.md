# GoDocs — Suplemento operacional para agente RPA

> **Complemento de `docs/CONTEXTO-GODOCS-ASSISTENTE.md`.** Cobre **apenas o que não está lá**: diferenças entre staging e produção, layout real da planilha, volume atual e como conferi-lo, onde vivem os prompts do agente, armadilhas de automação de browser, e o procedimento seguro de teste ponta a ponta.
>
> Levantado em **01/09/2026** contra o repositório e os apps reais (prod `674a3710` v314 · staging `edf400b4` v276).

---

## 1. Deltas de UI: STAGING × PRODUÇÃO

Os dois apps rodam **o mesmo código-base**, mas **não a mesma build nem as mesmas flags**. Hoje eles divergem em coisas que **mudam a ordem dos cliques** — um script de RPA calibrado em um dos dois **quebra no outro**.

| | Produção | Staging |
|---|---|---|
| URL | `https://godocs.devgogroup.com/` | `https://godocs-staging.devgogroup.com/` |
| App ID | `674a3710` | `edf400b4` |
| Build no ar | v314 | v276 |
| Aba da planilha | `GoDocs` (padrão) | `STAGING` (`GOOGLE_SHEETS_TAB`) |
| Google Chat | ativo (`GOOGLE_CHAT_WEBHOOK_URL`) | **mudo** — o secret não existe |
| Drive | pasta de produção | pasta própria |
| SQLite | próprio | próprio |
| Faixa no topo | — | **banner de staging** (`src/components/staging-banner.tsx`), discriminado pela env `GODOCS_ENV` |

### 1.1 A divergência que mais impacta o RPA: **ordem da Etapa 3**

Staging tem o secret **`REORDER_DOC_FINAL`** (criado 31/08/2026); **produção não tem**.

- **Produção (fluxo clássico):** Etapa 2.5 → *chat de documentação* → preview da doc → **Aprovar** → formulário de saving → chat de impacto → memorial → revisão final.
- **Staging (fluxo reordenado, “fatia C”):** `iniciar-submissao` **retorna na hora** (`reorder_doc_final: true`), o extrator e a compilação da doc rodam **100% em background**, e a Etapa 3 **abre direto no formulário de saving**. O **refino da documentação acontece por ÚLTIMO** — a transição `saving_preview`/`receita_preview` → `doc` é o que leva ao chat da doc, já no fim.

Consequência prática: em staging **não existe** a etapa “responder o chat da doc e aprovar o preview” no começo; procurar por ela trava o robô. Código: `src/lib/chat.functions.ts:921` (`usaReorder`), `src/lib/submeter/constants.ts` (`deveIrParaRefinoDoc`, `previewFinanceiroEhReceita`), `src/routes/submeter.tsx:531+`.

### 1.2 Outras diferenças ativas hoje

| Diferença | Onde | Efeito no robô |
|---|---|---|
| **Streaming das PERGUNTAS do agente** | só staging (branch `feat/streamar-perguntas`) | Em staging, também as **perguntas** aparecem token a token; em prod, só a prosa de preview/complete streama e as perguntas chegam de uma vez. Não use “texto parou de crescer” como sinal de fim |
| **Loading contínuo na entrada do agente** (fim do “degrau”) | só staging | Em prod há um intervalo sem loader ao entrar na Etapa 3 |
| **Cabeçalho doc × memorial (bug G)** | corrigido só em staging | Em prod, na virada para o refino, o cabeçalho pode dizer “Documentação Técnica” ainda com o memorial na tela |
| **Rótulo do loader de receita** | corrigido só em staging | Texto do loader difere |
| **`SUBMISSAO_BLOQUEIO_EXCECAO_EMAILS`** (allowlist de isenção durante janela de bloqueio) | só staging | Em staging, `/api/auth/me` pode devolver `bloqueioIsento: true` e o botão de submeter fica habilitado mesmo com janela ativa |
| **Janela de bloqueio de submissão** | **nenhum dos dois** tem `SUBMISSAO_BLOQUEIO_INICIO/FIM` hoje | Submissões abertas nos dois ambientes |
| **`PRE_APROVACAO_CONGELADA`** | **os dois** | ⚠️ A tela `/aprovacoes` existe, mas **decidir devolve HTTP 423**. Não tente concluir pré-aprovações por robô até o secret ser apagado |
| **`AVALIACAO_MESA_LLM`, `AVALIACAO_NORMAIS`, `AVALIACAO_REDATOR`, `FTE_FATOR_IMPLAUSIVEL`** | os dois | Mesa de avaliação LLM em **sombra**: escreve parecer e a coluna “Sombra” no `/dashboard`, **não muda status** |
| **`DOC_COMPILE_ASYNC`** | os dois (staging atualizado 31/08) | Compilação da doc fora do caminho crítico |
| **`JG_INGEST_URL` / push do rollup** | só prod | Staging não empurra dados para o Gomoon/João Gabriel |

> **Regra de ouro:** antes de rodar um script, cheque **em qual ambiente** está (banner de staging + domínio) e **confirme a ordem da Etapa 3 na primeira execução manual**. As flags mudam sem redeploy do cliente.

---

## 2. Mapa das colunas da planilha

⚠️ **Correção importante:** a documentação interna ainda diz “layout A→AV”. **Não é mais verdade.** O contrato hoje tem **53 colunas — A até BA**. Fonte única: `SHEET_COLUMNS` em `src/lib/google/sheets.ts`.

⚠️ **A posição não é o contrato.** Append, update e leitura resolvem a coluna **casando pelo NOME do cabeçalho real** (`fetchHeaderMap` + `chaveColuna`, casamento exato primeiro e normalizado depois). Inserir/reordenar colunas na planilha **não quebra** o sistema — mas **muda as letras**. Um robô que fixar “escreva em AD” vai gravar no lugar errado no dia em que alguém inserir uma coluna. **Sempre ancore pelo nome.**

| Letra | Nome da coluna | Quem escreve |
|---|---|---|
| A | Data Submissão | sistema (append) |
| B | ID Projeto | sistema — **chave de casamento de todas as operações** |
| C | Data Criação | formulário |
| D | Área | derivada do e-mail (Team Guide) |
| E | Nome Completo | conta logada |
| F | Email | conta logada — **fonte do ownership** |
| G | Projeto | formulário (nome) |
| H | Participantes | papel **Coautor** |
| I | Participantes 2 | papel **Participante** |
| J | Contribuidor | papel **Contribuidor** |
| K | Descrição | formulário |
| L | URL | link do Drive (documentação) |
| M | Ferramenta | multi-seleção unida por `" + "` |
| N | Escopo | interna/externa |
| O | Tipos Projeto | saving/receita/especial |
| P | Alguém Fazia? | `sim` / `nao` / `externo` |
| Q | **Estrelas** | **MANUAL** — só a ficha do `/dashboard` grava |
| R | Saving Horas | total de horas |
| S | Horas em Reais | R$ bruto das horas |
| T | Custo Evitado | R$ mensal |
| U | Justificativa Custo Evitado | itens (`• nome — R$ valor (recorrência). justificativa`) |
| V | Custo Mensal ou Pontual | recorrência do custo evitado |
| W | Saving Reais | **líquido** (horas + custo evitado − custos) |
| X | Tipo de Saving | mensal/pontual/trimestral/semestral |
| Y | Memorial de Saving | **só saving** (receita nunca entra aqui) |
| Z | Custo Externo Mensal | |
| AA | Receita Mensal | |
| AB | Tipo de Receita | |
| AC | Receita Memorial | **só receita** |
| AD | Status | sistema + triagem |
| AE | Ganho Total | `saving + receita ÷ 10` |
| AF | Complexidade | analisador |
| AG | Diff Horas / Antes | **MANUAL — nunca escrever** |
| AH | Diff Saving / Antes | **MANUAL — nunca escrever** |
| AI | Memorial anterior | sistema, só na edição |
| AJ | Observações | analisador (é o campo que o disparo de e-mails usa) |
| AK | Contexto do Projeto Especial | |
| AL | Especial? | |
| AM | Atualizado Em | **carimbo do sistema** — a triagem nunca escreve; vazio = legado pendente |
| AN | Alocação Ganhos | fatiada do memorial (gate ≥44h) |
| AO | Usa AI Proxy | |
| AP | Custo do Projeto | valor R$ (abate) |
| AQ | Justificativa Custo do Projeto | |
| AR | Custo do Projeto Mensal ou Pontual | |
| AS | Saving Horas Real | numérica (0 quando não se aplica) |
| AT | Saving Horas Escalado | numérica |
| AU | Justificativa Saving Escalado e Real | texto |
| AV | Análise Antiagente | crítico adversarial |
| AW | Motivo Reenvio | **MANUAL** — só a triagem escreve (o append apenas inicializa com `—`) |
| AX | Motivo Reprovado | sistema + triagem; **visível ao autor** |
| AY | Classificação | analisador (`Claro sim` / `Zona cinzenta` / `Claro não` + justificativa) |
| AZ | Aprovação do Líder | ⚠️ o cabeçalho real diz **“Aprovação do Lider”** (sem acento) — o casamento é tolerante |
| BA | Justificativa Aprovação do Líder | checklist detalhado + texto do líder |

**Colunas que um robô NUNCA deve tocar:** AG, AH (Diff), AM (Atualizado Em), AW (Motivo Reenvio) e Q (Estrelas, fora da ficha do dashboard). Escrever nelas corrompe controles que a gestão usa para auditar.

---

## 3. Volume atual de projetos e como conferir

**Não confie em número decorado** — ele muda todo dia. Última medição registrada: **~639–641 linhas** na planilha de produção (17/08/2026). O banco local do repositório (`godocs.db`, 44 projetos) é **de desenvolvimento** e não representa nada.

### Como conferir, do mais barato ao mais caro

| Método | Como | O que devolve |
|---|---|---|
| **1. `GET /api/admin/sync-status`** (admin) | qualquer aba logada como admin | `ultimaRun.total` = nº de linhas lidas da planilha na última sincronização; + `espelhados`, `criados`, `atualizados`, `idadeMs` e as 20 corridas recentes. **É a forma canônica** |
| **2. Cabeçalho do `/dashboard`** | visual | “Planilha sincronizada às HH:MM” (vira **aviso âmbar** após 20 min sem sync) |
| **3. Pílulas de status do `/dashboard`** | visual | contagem por fila — e, com filtros ligados, a contagem é **do recorte**, não do total |
| **4. `/investigador` → Stats** | `GET /api/admin/investigador/stats` | submetidos · edições · abandonados · pendentes de pré-aprovação |
| **5. `GET /api/meus-projetos/pendentes`** | qualquer usuário | contagem de pendências **do próprio usuário** (selo da home) |
| **6. A planilha** | direto no Sheets | verdade final; conta as linhas com “ID Projeto” preenchido |

⚠️ O espelho (`sheet_espelho`) é atualizado por cron **a cada 5 minutos**. Um projeto submetido agora aparece na planilha na hora, mas no `/dashboard` pode levar até ~5 min. **Não conclua “não gravou” antes disso** — confirme em `/meus-projetos` (que lê o espelho do dono e se auto-cura) ou force `?refresh=1` no dashboard.

⚠️ Os scripts de relatório (`scripts/dryrun-lider/relatorio-sheet.ts`, `ultimas-linhas.ts`, `peso-dashboard.ts`) leem a planilha direto via Service Account e **exigem `GOOGLE_SA_KEY_BASE64` + `GOOGLE_SHEETS_ID` no `.env` local** — que hoje **não estão** presentes neste checkout. Rodá-los sem isso falha; e sem `GOODLE_SHEETS_TAB`/`GODOCS_ENV` eles miram **PRODUÇÃO**.

---

## 4. Prompts de sistema: onde estão e o que dizem

Todos os prompts são **construídos em código** (não há arquivos `.txt` de prompt). Não existe “prompt único” — cada fase monta o seu.

### 4.1 O agente conversacional (orquestrador)

`src/lib/agents/orchestrator.ts` (~150 KB) — a função `runOrchestrator` escolhe o prompt de sistema pela **fase**:

| Fase | Builder | Linha |
|---|---|---|
| `doc` | `buildDocPrompt(ctx, coletado)` | `orchestrator.ts:201` |
| `doc_preview` | `buildDocPreviewPrompt(...)` | `:331` |
| `saving` | `buildSavingPrompt(...)` | `:969` |
| `saving` (custo evitado puro) | `buildSavingCustoEvitadoPrompt(...)` | `:906` |
| `saving_preview` | `buildSavingPreviewPrompt(saving)` | `:1354` |
| `receita` | `buildReceitaPrompt(...)` | `:441` |
| `receita_preview` | `buildReceitaPreviewPrompt(receita)` | `:572` |

**Blocos compartilhados (fonte única — não redigitar em outro lugar):**

- `buildRespostasFormulario(ctx)` — `:132` — injeta as respostas do formulário nos 4 prompts. **Campo novo no form entra aqui**, nunca solto num prompt.
- `buildDetalhesAprovados(...)` — `:180` — a doc herdada pelas fases financeiras.
- `buildRevisaoBlock(...)` — `:67` — bloco “CONTEXTO DE REVISÃO (EDIÇÃO)”.
- `TAXONOMIA_DESTINO_GANHO` — `:695` — os 5 destinos aceitos do gate ≥44h.
- `BLOCO_SECOES_CRITERIO` — seções `[1.3]`/`[1.4]` (processo alterado · ponteiro movido), com trava **anti-vazamento**: os códigos e as letras `a)`/`b)` são roteiro interno e é **proibido** aparecerem na mensagem ao usuário.
- `MEMORIAL_ESQUELETO` / `descreverEsqueletoMemorial(modo)` — `src/lib/agents/memorial-format.ts` — a estrutura obrigatória do memorial por modo (`saving` · `custo_evitado` · `receita`).

**Trecho-chave da abertura do prompt de documentação** (`buildDocPrompt`):

```
Você é o assistente de documentação de projetos de automação (RPA & IA) do GoGroup.

SITUAÇÃO ATUAL:
O sistema analisou automaticamente os arquivos enviados pelo usuário e extraiu os campos abaixo.
Os campos preenchidos refletem FIELMENTE o que está no código — o código é a verdade, confie no que foi extraído.
Porém, o código enviado pode ser PARCIAL (apenas trechos, um módulo, só o frontend, etc.) —
nesse caso, os campos preenchidos são corretos mas INCOMPLETOS.
Os campos em null representam informações que o código não revelou.
...
FERRAMENTAS INTERNAS DO GOGROUP (contexto para você): ...
METADADOS DO PROJETO: Nome / Data de criação / Responsável / Área / Ferramenta / Membros
ESTADO ATUAL DA COLETA: <JSON do que já foi coletado>
```

**Contrato de saída do agente** (`OrchestratorResult`, `src/lib/agents/types.ts:256`) — é isto que vira tela:

| `type` | Vira o quê na UI |
|---|---|
| `question` | mensagem + campo de texto livre |
| `options` | pergunta + **botões clicáveis** (`options: string[]`) |
| `preview` | bloco de preview + botões **Aprovar** / **Pedir ajustes** |
| `complete` | memorial fechado; habilita a revisão final |

⚠️ **Structured Outputs está morta no proxy** (o backend Codex ignora `response_format`), então o orquestrador usa **JSON mode + retry + recuperação por regex**: até 3 tentativas; esgotado, tenta extrair `type`/`content` por regex; senão devolve a mensagem de “instabilidade momentânea… nada se perdeu”, com o estado preservado.

### 4.2 Demais agentes

| Agente | Arquivo | Prompt |
|---|---|---|
| **Extrator** (lê os arquivos, map/reduce) | `src/lib/agents/extractor.ts` | `buildExtractorPrompt(:95)`, `buildConsolidatorPrompt(:124)` |
| **Compilador da doc** | `src/lib/agents/doc-compiler.ts` | `SYSTEM_PROMPT (:24)` — *“Você é um especialista em documentação de projetos de automação corporativa do GoGroup.”* |
| **Analisador** (complexidade + critério + observações) | `src/lib/agents/analyzer.ts` | `buildSystemPrompt(:98)`, `buildUserMessage(:329)` |
| **Validador** (critérios pontuados) | `src/lib/agents/validator.ts` | `buildValidatorPrompt(:72)` + `CRITERIOS_DEFAULT` |
| **Classificador de especiais** (RAG por embeddings) | `src/lib/agents/especial-classificador.ts` | `buildSystemPromptEspecial(:77)`, `buildUserMessageEspecial(:112)`; régua em `src/lib/especiais-regua.ts` |
| **Mesa de avaliação LLM** (sombra) | agentes de avaliação | flag `AVALIACAO_MESA_LLM`; grava parecer, **não muda status** |
| **Gates determinísticos** (não são LLM) | `src/lib/agents/ganho-projetado.ts`, `sobreposicao-receita.ts`, `custo-evitado-chat.ts`, `src/lib/chat.functions.ts` | perguntas e opções em constantes |

### 4.3 O painel `/testes` (inspecionar prompts sem submeter nada)

Rota admin **`/testes`** (`src/routes/_authenticated/testes/`), com duas abas:

- **Prompts da IA** (`/testes/prompts`) — renderiza **todos os prompts reais com dados mock**, por `src/lib/testes/prompt-registry.ts` (registry dinâmico que importa os builders de verdade). Cada entrada expõe `agent`, `functionName`, `filePath`, `fase`, `contextParams` e `llmParams` (`temperature`, `maxTokens`, `modelTier: fast|strong`, `jsonMode`). IDs registrados: `orchestrator.doc`, `orchestrator.doc_preview`, `orchestrator.saving`, `orchestrator.saving_custo_evitado`, `orchestrator.saving_preview`, `orchestrator.receita`, `orchestrator.receita_preview`, `extractor.map`, `extractor.reduce`, `compiler.system`, `analyzer.system`, `validator.system`.
- **Cenários de Teste** (`/testes/cenarios`) — simulação de chat (`chat-simulation.tsx`), inspetores de estado e de API (`state-inspector.tsx`, `api-inspector.tsx`), lançador de cenários (`scenarios.ts`).

⚠️ **Regra do repositório:** alterou prompt → **atualizar `prompt-registry.ts` e `prompt-inspector.tsx`** no mesmo commit. Se o painel mostrar um texto diferente do que o chat produz, o registry está desatualizado — a verdade é o builder no `orchestrator.ts`.

---

## 5. Seletores, esperas e armadilhas de RPA

### 5.1 Seletores

- ⚠️ **Não existe um único `data-testid` no código-fonte.** Ancore em **texto visível**, `role` e ordem no DOM. Os `aria-label` existem quase só no chat (`step3-chat.tsx`, 16 ocorrências) e em `form-components.tsx` (10).
- **Classes Tailwind não servem de âncora** — mudam a cada ajuste visual (`text-[13px]`, `go-radio-label`, `.go-grid-check*`).
- Rótulos com **emoji fazem parte do texto** (`🟢 Sim, já está em produção e sendo utilizado`, `👥 Sim, em equipe`, `📄 Selecionar arquivos`). Casar por *substring sem emoji* é mais robusto.
- Rótulos que **mudam de texto conforme o escopo**: com escopo *externo*, a pergunta de produção vira “Essa ferramenta externa já está em uso na solução?” e as opções falam “utilizada”, não “utilizado”. Case por prefixo, não por frase inteira.
- Componentes que **abrem em portal, fora da árvore do formulário** (procure no `body`, não dentro do `<form>`): modal de exemplos (`src/lib/submeter/exemplos-modal.tsx`, `createPortal`), calendário (`src/components/calendario/`), tooltips (`info-tooltip.tsx`), drawer de histórico e diálogos do Radix.
- **O calendário não é `<input type="date">`** — é componente próprio. Digitar a data no campo não funciona; é preciso navegar e clicar no dia. Grade **sempre de 42 células** e contas em **UTC** (exceto “hoje”, que usa o relógio local).
- **Botões de opção do chat**: clicar envia `selected_option` = **índice 1-based** junto do texto (`submeter.tsx:2385/2434`). Digitar o texto do botão também funciona (há fallback por regex), mas o clique é o caminho garantido — vários gates **só têm saída determinística por clique**.

### 5.2 Esperas (o que esperar, e por qual sinal)

| Momento | Sinal de pronto | Ordem de grandeza |
|---|---|---|
| Qualquer navegação/requisição | — | **~750 ms de overhead FIXO** do edge por requisição (é o gate de OAuth, não a rede). Conte requisições, não bytes |
| Upload → análise em background | texto muda para **“✅ Documentação analisada — pode avançar sem espera”** | segundos a ~1 min |
| Turno normal do agente | fim do streaming + campo de entrada reabilitado | 3–60 s |
| Compilação da documentação | loader nomeado (“Compilando…”) | **~60 s** |
| Fim do memorial | indicador **“Finalizando memorial…”** (aparece após ~2 s sem novo token) e depois o botão **“Enviar para Triagem”** habilitando | +10–30 s |
| Aparecer no `/dashboard` | cron do espelho | até **5 min** |
| Coluna “Complexidade”/“Classificação” | analisador em background + cron de 1 min | até **~5 min** |

**Estados de cabeçalho do chat** úteis como âncora (`step3-chat.tsx:2310`): `Documentação Técnica` / `Análise de Saving` / `Análise de Receita Incremental`, com status `Analisando e coletando informações...` · `Calculando a economia de horas do projeto...` · `Calculando a receita incremental do projeto...` · `Aguardando sua aprovação...` · `Submissão completa — pronto para envio`.

⚠️ **Não use “o texto parou de crescer” como fim de turno** — com streaming há pausas naturais (o maior intervalo saudável medido entre chunks é ~1,7 s) e, antes do primeiro token, o modelo “pensa” por até dezenas de segundos **sem emitir nada**. O timeout real do servidor é de 60 s até o primeiro conteúdo e 25 s de intervalo depois dele.

### 5.3 Armadilhas específicas desta aplicação

1. **Rascunho em `localStorage`.** `/submeter` salva o progresso e **retoma o mesmo `projetoId`**. Abrir `/submeter` com rascunho pendente **pula a tela de apresentação** e salta direto para a etapa onde parou (`setStep(d.step ?? 3)`). Um robô que espera sempre a tela “Antes de começar” quebra. Limpe o storage entre execuções ou trate os dois caminhos.
2. **Version skew.** O GoDeploy acumula assets; uma aba antiga nunca dá 404. O app mostra a faixa **“Nova versão disponível”** e **nunca recarrega sozinho**. Recarregue **entre etapas**, jamais no meio de um turno.
3. **Assets sem cache imutável** (`must-revalidate`): recarregar é sempre um round-trip completo. Recarregue o mínimo.
4. **Toast de bloqueio dura ~20 s** e traz a orientação inteira; ele é a única fonte do motivo do bloqueio no envio. Capture-o antes de sumir.
5. **Prefetch por hover no `/dashboard`**: passar o mouse sobre uma linha por 150 ms já dispara a requisição da ficha. Movimento errático do cursor gera carga inútil.
6. **`/aprovacoes` está congelada** (`PRE_APROVACAO_CONGELADA` nos dois ambientes): decidir devolve **423**. A tela abre normalmente — o erro só aparece ao salvar.
7. **Reenvio reabre a fila do líder** e **reativa** projeto descontinuado. Não use reenvio como “salvar rascunho”.
8. **Edição não é o mesmo formulário:** em `/editar/<id>` os dados do projeto ficam **somente leitura** e a tela de apresentação não aparece.
9. **Gates leem estado vivo, com teto de perguntas.** Cada gate faz no máximo 1–2 perguntas e tem estados terminais absorventes — **repetir a mesma resposta não “destrava”**; se a mesma pergunta reaparecer, algo mudou no estado, não é loop.
10. **Valor citado no chat não é gravado.** Custo evitado só existe se estiver **no campo do formulário**. O robô precisa cadastrar o item, não “dizer” o número.
11. **Coautor é único**; e a contribuição de cada participante (20–100 chars) **não pode ser a descrição do papel copiada** — há guard determinístico contra isso.
12. **Nome duplicado bloqueia o envio.** Em testes repetidos, varie o nome (é o que o prefixo `[E2E-<runId>]` resolve).

---

## 6. Receita segura de submissão de teste em STAGING

> **Regra 13 do projeto: nada vai a produção sem passar pela staging.** E o inverso vale para o robô: **teste só em staging** (`https://godocs-staging.devgogroup.com/`). Staging é isolada — aba `STAGING` da planilha, Drive próprio, SQLite próprio e **Google Chat mudo** —, com um guard (`assertNaoEhDefaultDeProd`) que **lança erro** se algum override faltar, justamente para não escrever em produção.

### 6.1 Antes de começar

1. Confirme o **banner de staging** no topo e o domínio `godocs-staging`.
2. Confirme a **ordem da Etapa 3** (staging hoje abre **direto no formulário de saving** — §1.1).
3. Faça login com a conta real (o edge exige OAuth). O ownership será dessa conta.

### 6.2 Nome do projeto — a decisão mais importante

Use **sempre** o prefixo de teste:

```
[E2E-<runId>] <título do teste>          ex.: [E2E-20260901-1530] Automação de teste RPA
```

O prefixo `[E2E-` faz três coisas (`ehProjetoTesteE2E`, `src/lib/google/chat.ts:7`):
- **cala a notificação do Google Chat** (mesmo onde ela estaria ativa);
- identifica as linhas na planilha e no Investigador;
- é a **chave da limpeza**.

Sem o prefixo, o projeto de teste vira indistinguível de um projeto real na planilha da gestão.

### 6.3 O que anexar

- **Um arquivo pequeno e sintético** — `.md` ou `.txt` de algumas dezenas de linhas descrevendo uma automação fictícia (o que faz, como roda, dependências, o que configurar antes). É o suficiente: o extrator preenche o que der e o agente pergunta o resto.
- Extensões aceitas: `.pdf .docx .doc .txt .md` + `.json .ts .tsx .js .jsx .py .sql .sh .yaml .yml .toml .css .html` (e `.zip`, descompactado no cliente). **10 MB por arquivo**; teto real de **~200 mil tokens** no conjunto.
- ❌ **Nunca anexe código ou documento real de cliente/produção** — o arquivo vai para o **Drive** e seu texto entra em **prompt de LLM**.

### 6.4 Que dados usar

| Campo | Use |
|---|---|
| Nome | `[E2E-<runId>] …` |
| Data de criação | uma data passada, ≥ `01/01/2024` |
| Contexto de negócio | ≥ 60 caracteres, **fictício e plausível** |
| Participantes | **de preferência nenhum** (“não, individual”). Se precisar testar papéis, use e-mails de colegas cientes — eles passam a ver o projeto |
| Quem sentiria falta | escolha **um time**, não pessoas (menos ruído) |
| Horas | números **pequenos e coerentes** (ex.: 1 cargo, 20h antes → 2h depois). Passar de **44h/mês** aciona o gate de alocação; passar de **220h por pessoa** aciona o gate de teto |
| Custo evitado / custo do projeto | valores redondos e baixos, com justificativa curta |
| Recorrência | `mensal` |

Para exercitar os gates de propósito, **use números pequenos e suba um por vez** — cada gate acionado é mais um ciclo de LLM (tempo e custo).

### 6.5 O que **NÃO** fazer

- ❌ Não rodar teste em **produção** (`674a3710`). O harness E2E aponta para produção **por padrão** (`E2E_BASE_URL`) — se for usá-lo, **sobrescreva a variável**.
- ❌ Não usar **dados reais** (nomes de clientes, contratos, valores verdadeiros, código proprietário).
- ❌ Não submeter sem o prefixo `[E2E-`.
- ❌ Não marcar **especial** só para “pular o memorial” — as duas checagens da Etapa 2.5 bloqueiam, e um especial de teste entra na fila de avaliação humana e na tela `/especiais`.
- ❌ Não decidir nada em **`/aprovacoes`** (congelada, 423) nem operar `/email-legados` (dispara e-mails de verdade).
- ❌ Não editar as colunas manuais da planilha (§2).
- ❌ Não deixar o teste para trás: **limpe** (§6.6).

### 6.6 Limpeza — a ordem importa

```bash
npm run e2e:cleanup -- <runId>     # planilha PRIMEIRO, depois SQLite
```

Remove as linhas da planilha (`deleteDimension`) e só então chama `POST /api/admin/e2e-cleanup` (admin), que apaga do SQLite todos os `[E2E-...]`.

⚠️ **Inverter a ordem ressuscita os projetos**: o sync reverso por dono recria no SQLite o que ainda está na planilha.
⚠️ Limpeza manual: apagar a linha da aba `STAGING` e rodar o endpoint de cleanup — nunca só um dos dois.
⚠️ Um projeto **não-rascunho** que suma da planilha é purgado do SQLite pelo sync após uma **carência de 1 h**.

---

## 7. Como validar um projeto depois — staging × produção

### 7.1 Em STAGING

| O que checar | Onde |
|---|---|
| A linha existe e as colunas estão certas | aba **`STAGING`** da planilha (mesma planilha de prod, outra aba) |
| Documentação e memorial como o autor vê | `/projeto/<id>` (leitura, **sem R$ de saving**) |
| Timeline completo da submissão (eventos do formulário, mensagens, versões) | `/investigador` → aba **Submetidos** → abrir o projeto |
| A ficha da triagem | `/dashboard` → buscar por nome/ID → abrir a linha |
| Sincronização em dia | `GET /api/admin/sync-status` ou o cabeçalho do `/dashboard` |
| Classificação/Complexidade | colunas AY/AF (podem levar ~5 min; há cron de reconciliação) |
| Google Chat | **não deve chegar nada** — staging é muda. Se chegou, o ambiente está mal configurado: **pare** |

### 7.2 Em PRODUÇÃO

Mesmos lugares, **aba `GoDocs`**, com três diferenças de peso:

1. **O Chat avisa de verdade.** O grupo de admin recebe a mensagem quando o líder **pré-aprova**, com deep link `…/dashboard?projeto=<id>`. Submissão de quem entra em fila **não** avisa; especial e isentos avisam na submissão.
2. **O líder é convocado.** A submissão abre a fila e dispara DM (via bot do Gomoon) — com `PRE_APROVACAO_CONGELADA` ativo a decisão está bloqueada, mas a fila e o aviso continuam existindo.
3. **Nada é descartável.** Um projeto de teste em produção entra em relatórios, no rollup enviado para fora (`JG_INGEST_URL`) e na fila de alguém. Excluir depois **não desfaz** as notificações já enviadas.

### 7.3 Checklist de validação de uma submissão (qualquer ambiente)

1. `/meus-projetos` — o card apareceu, com o status esperado?
2. Planilha — linha criada (**append**, projeto novo) ou **atualizada in-place** (edição, casada por “ID Projeto”)? Nunca as duas.
3. Coluna **L (URL)** — o link do Drive foi gerado?
4. Colunas financeiras — **R/S/T/W/AE** batem com o memorial e com a soma das linhas de horas?
5. **Y** só saving, **AC** só receita (nunca receita na Y).
6. **AM (Atualizado Em)** carimbada — é o que tira um legado da pendência.
7. **AY (Classificação)** e **AF (Complexidade)** preenchidas após alguns minutos.
8. **AZ/BA** — parecer do líder no estado esperado (`Pré-pendente`, `—` para isento/especial, ou `Dispensado`).
9. `/investigador` — o timeline mostra os eventos do formulário e as mensagens do chat?
10. **Reprovação automática**: se `Classificação = Claro não`, o Status vai a **“Reprovado”** (única exceção à regra temporária do “Pendente”) e o **Motivo Reprovado** precisa estar preenchido — o sistema nunca reprova sem motivo.
