# Melhorias validadas com a gestão — backlog para a próxima sessão

Pontos validados com os gestores para evoluir o GoDocs. Cada item traz **objetivo**,
**porquê**, **onde mexer** e **cuidados**. Os itens que tocam UI **devem** usar a
skill `frontend-design` e respeitar o padrão de design do site (tokens `--go-blue`,
`--go-lime`, `--go-cream`, Poppins, componentes shadcn em `src/components/ui/`).

> **Contexto de origem:** este backlog foi aberto logo após a integração do `origin/main`
> (PRs #32 config Godeploy + extrator cético, #33 integração n8n) com os fixes locais
> de resiliência da doc / contexto de negócio / navegação do formulário. A submissão
> ("Enviar para Triagem") já dispara o webhook n8n via `N8N_WEBHOOK_URL` (prod).

---

## 1. Renomear "Serviço Externo Utilizado" → "Serviço Externo Contrato"

- **Objetivo:** trocar o label visível do campo de serviço externo.
- **Onde mexer:** `src/lib/submeter/step1.tsx:231` — `<FormLabel required>Serviço Externo Utilizado</FormLabel>`.
  - Revisar também textos relacionados para manter coerência: a mensagem de validação
    em `src/routes/submeter.tsx:151` ("Informe o nome do serviço externo") e qualquer
    placeholder/ajuda do mesmo campo.
- **Cuidados:** é só rótulo de UI — **não** renomear a coluna/estado `servico_externo`
  (DB e funções). Acentuação correta: "Serviço Externo Contrato".

---

## 2. Loading com etapa explícita quando o agente faz trabalho pesado

- **Objetivo:** quando o agente demora (compilação de documentação, extração, análise),
  mostrar **em que passo ele está** em vez do loading genérico de 3 pontinhos. O que as
  pessoas mais querem é *ver progresso* e ter certeza de que não travou.
- **Regra:** mensagem comum de chat (rápida) → 3 pontinhos é suficiente. Operação pesada
  (compilar doc, ler arquivos, montar memorial) → **loader com passo nomeado**
  ("Lendo arquivos…", "Compilando documentação…", "Analisando impacto…").
- **Onde mexer:** `src/lib/submeter/step3-chat.tsx` (estado de loading do chat) e
  provavelmente o backend para sinalizar a etapa atual: `src/lib/chat.functions.ts`
  (`enviarMensagem`, `iniciarSubmissao`) e `src/lib/agents/orchestrator.ts` /
  `extractor.ts` / `doc-compiler.ts`.
- **Cuidados de arquitetura:** hoje a API é request/response simples (`apiFetch`),
  **sem streaming**. Para progresso real em etapas, avaliar: (a) SSE/streaming do Worker,
  (b) ou um loader client-side com passos estimados disparado conforme o tipo de operação.
  Decidir a abordagem antes de implementar. **Usar skill `frontend-design`.**

---

## 3. Saving sem ninguém executando antes (e/ou depois)

- **Objetivo:** a etapa de saving ("quem participava — antes e depois") assume que havia
  alguém fazendo a tarefa manualmente. Mas há soluções que **geram saving sem ninguém
  fazer antes**, podem **não ter ninguém fazendo agora**, ou podem **passar a ter**.
  O formulário e o agente precisam acomodar esses cenários sem forçar "tinha alguém antes".
- **Onde mexer:** `SavingForm` em `src/lib/submeter/step3-chat.tsx:552` (UI multi-linha:
  cargo / horas antes / horas depois) e o prompt do agente de saving em
  `src/lib/agents/orchestrator.ts` (`buildSavingPrompt`) — que hoje **desafia as horas**
  e não pode insistir que existia execução manual prévia.
- **Estado atual:** a validação já é relaxada (aceita horas `>= 0`, inclusive 0 antes;
  ganho líquido clampado no backend). Falta a **UX/enquadramento** deixar claro o caso
  "ninguém antes" e o agente parar de cobrar detalhamento de uma rotina manual inexistente.
- **Cuidados:** **usar skill `frontend-design`**; manter o cálculo em R$ **só no backend**
  (nunca exibir taxa/h ao usuário, conforme regra atual).

---

## 4. Adaptação a idas e vindas entre etapas (inclusive metadados do agente)

- **Objetivo:** pessoas erram e voltam para corrigir as etapas. O agente e os passos
  seguintes **devem se adaptar** às mudanças — **inclusive os metadados que o agente lê**
  (descrição de negócio, arquivos, área, datas, tipo[s] de projeto).
- **Estado atual (parcial):** já existe `atualizarTipos` (`POST /api/chat/atualizar-tipos`)
  e o `enviarMensagem` relê `tipos_projeto` fresco do banco. A troca de tipo no meio do
  fluxo re-roteia o agente (`handleContinuarAgente` em `src/routes/submeter.tsx`).
- **Falta:** garantir que **todas** as mudanças de metadado se propaguem ao agente —
  ex.: editar a `descricao_breve` ou trocar os **arquivos** após o agente iniciar deve
  refletir no contexto (re-rodar o `extractor` quando os arquivos mudarem) e em
  `getProjetoContexto` (`src/lib/chat.functions.ts`). Hoje a propagação de
  `descricao_breve`/`data_criacao` já existe na leitura, mas não há re-sincronização
  quando o usuário altera depois de iniciar.
- **Onde mexer:** `src/routes/submeter.tsx` (handlers de navegação/edição),
  `src/lib/chat.functions.ts` (`getProjetoContexto`, persistência de mudanças),
  possivelmente novo endpoint análogo a `atualizar-tipos` para os demais metadados.
- **Cuidados:** se mexer em UI, **usar skill `frontend-design`**.

---

## 5. Reduzir latência do agente em respostas simples

- **Objetivo:** respostas simples às vezes demoram tanto quanto a compilação de doc.
  Para a **doc** a espera é compreensível; para um **turno simples de conversa**, não.
- **Investigar:** tamanho do prompt enviado por turno (todo o contexto/codebase vai em
  toda mensagem?), escolha de modelo, `max_completion_tokens`. Possíveis ganhos:
  - rotear turnos simples para um modelo mais rápido/barato (config em `src/lib/llm.ts`);
  - enxugar o system prompt por fase (`src/lib/agents/orchestrator.ts`);
  - streaming para reduzir latência **percebida** (casa com o item 2).
- **Onde mexer:** `src/lib/llm.ts`, `src/lib/agents/orchestrator.ts`.
- **Cuidados:** não degradar a qualidade da compilação da doc (que é fail-loud, 3 retries,
  sem fallback — decisão do produto). Otimizar só o caminho de turno simples.

---

## 6. Valor da receita também de forma determinística (upfront)

- **Objetivo:** hoje o `valor_ganho_mensal` da receita é coletado **só pelo agente**
  dentro do chat. Assim como o saving tem `SavingForm` determinístico, a receita deve
  pedir o **valor previamente pela pessoa** (além do toggle mensal/pontual). O agente
  então **desafia** esse valor, em vez de pedir do zero.
- **Estado atual:** `iniciarReceitaSchema` (`src/lib/chat.functions.ts:208`) só tem
  `projeto_id` + `tipo_saving` (mensal/pontual) — **não** coleta o valor. A `ReceitaForm`
  (em `src/lib/submeter/step3-chat.tsx`, renderizada ~linha 1172) só tem o toggle.
- **Onde mexer:**
  - `ReceitaForm` (`step3-chat.tsx`): adicionar campo de **valor mensal/ganho** + o toggle.
  - `iniciarReceitaSchema` + `iniciarReceita` (`chat.functions.ts`): receber e persistir o
    valor informado.
  - Prompt da receita (`buildReceitaPrompt` em `orchestrator.ts`): receber o valor
    pré-preenchido e **desafiá-lo** (pedir evidências), em vez de coletá-lo do zero —
    espelhando o que o saving já faz com as horas.
- **Cuidados:** **usar skill `frontend-design`** na `ReceitaForm`.

---

## Itens que tocam frontend (lembrete)

Pontos **1, 2, 3, 4 (se mexer em UI), 6** envolvem frontend → **usar a skill
`frontend-design`** e seguir o padrão visual do GoGroup. Pontos **2 e 5** têm também
trabalho de backend/arquitetura (streaming, modelo, prompt).

## Lembrete de processo (a cada mudança)

- Texto ao usuário em **pt-BR com acentuação correta**.
- `npm run test` + `npx tsc --noEmit` + `npm run lint`.
- Mexeu no backend? `npm run build:worker` e comitar o `worker.js`.
