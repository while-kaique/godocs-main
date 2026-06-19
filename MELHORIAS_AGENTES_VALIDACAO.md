# Plano — Endurecimento dos Agentes de Validação (saving, receita, edição e Drive)

> Status: **planejado, não implementado.** Plano aprovado com o autor em 2026-06-19.
> Objetivo: tornar os agentes mais críticos na validação de saving/receita, capturar o
> "porquê" de divergências (ex: cargo que na verdade era serviço terceirizado), validar
> pontualmente as edições contra a versão anterior e manter um único documento por projeto
> no Drive.

## Decisões tomadas com o autor

1. **Arquitetura:** endurecer os prompts por fase + **diff determinístico** na edição. **Sem novo agente** no fluxo do chat (mantém latência/custo por turno; os prompts já são por fase, um por turno).
2. **Captura do "porquê" → por linha/cargo + Observações:** justificativa **por linha de saving** (cada cargo), resolvida **na própria conversa**, e a explicação da problemática composta na coluna **Observações** (staff-only), junto às demais informações importantes do parecer.
3. **Rigor:** **gate calibrado por materialidade** — bloqueia o avanço ao preview enquanto não fechar, dosando a intensidade pelo tamanho do ganho declarado.
4. **Reanálise na edição:** **acumular com resumo** — carregar adiante um resumo condensado do contexto/divergências da versão anterior (não o histórico cru infinito); o agente confirma se ainda vale ou atualiza; a reanálise nunca perde o que importa.
5. **Doc no Drive:** **documentação gerada = 1 arquivo por projeto, atualizado in-place** (PATCH via `fileId` guardado), nunca cria novo a cada edição. Os arquivos crus do usuário continuam como hoje.
6. **Bloqueio do Drive:** **construir agora**, atrás do mesmo tratamento de erro não-propagante de hoje; passa a funcionar assim que a gestão compartilhar a pasta (Editor) com a Service Account. (Bloqueio operacional documentado em `drive-pasta-e-acesso`.)

## Achados que dispensam mudança
- **Edição já grava SQLite imediatamente** e sincroniza para o Sheets (`submeterParaValidacao` → `runBackground` → `updateRowByProjectId`). O "SQLite de 1h em 1h" só vale para o **reverse sync** (edição feita direto na planilha). Nada a fazer no "atualizar os dois juntos".
- `ctx.revisao` (contexto da versão anterior) **já é injetado** nos prompts via `buildRevisaoBlock` (`orchestrator.ts:44`). Falta o **diff explícito** do que mudou.

---

## Frente 1 — Validação crítica de horas/saving
**Arquivo:** `src/lib/agents/orchestrator.ts` → `buildSavingPrompt` (~L425)

1. **Coerência cargo × tarefa (o caso "Sênior no chat"):**
   - Helper determinístico: sinalizar linhas com `cargo` caro (`Analista Sênior`, `Especialista / Gestor / Head`, da tabela `CARGOS` em `types.ts:41`) e/ou muitas horas → injetar bloco **"VALIDE POR QUE ESTE CARGO"**.
   - Instrução: quando o cargo destoar da natureza da tarefa descrita (`o_que_faz`/`fluxo`), o agente **deve** perguntar *"essa pessoa é interna ou foi um serviço contratado por fora? por que esse cargo específico?"* e **só seguir** após entender. Captura a explicação por linha (Frente 2).
2. **Cruzar metadados já preenchidos × justificativa:** estender a proibição de perguntas que contradigam dados já informados (hoje só para horas=0) para **cargo, tipo de saving e fluxo técnico aprovado**.
3. **Gate por materialidade:** divergência cargo↔tarefa de **alta materialidade não resolvida = não libera preview**; ganhos pequenos/plausíveis = confirma e segue (amarrar à diretiva já existente em `orchestrator.ts:561`).

## Frente 2 — Justificativa por linha → coluna Observações (staff-only)
**Arquivos:** `types.ts`, `orchestrator.ts`, `chat.functions.ts`, `analyzer.ts`

1. **Novo campo por linha:** `justificativa?: string` em `SavingLinha` (`types.ts:55`). Vive no `documentacao.conteudo` (JSON) — **sem coluna SQLite nova para o campo bruto**. O agente preenche ao resolver a divergência da linha.
2. **Composição em `observacoes`:** em `analisarProjetoFn` (`chat.functions.ts:~1078`), `observacoes` passa a ser **parecer do analisador + bloco "Contexto coletado na conversa"** (as justificativas por linha + divergências resolvidas). Sem sobrescrita — os dois convivem.
3. **Alimentar o analisador:** passar as justificativas/contexto no `buildUserMessage` (`analyzer.ts:230`) para o parecer já considerá-las.
4. Continua **staff-only** (não exibido ao usuário; vai à coluna Observações no Sheets). Regra de ouro mantida: **nenhum R$ de saving no texto visível ao usuário durante o chat**.

## Frente 3 — Validação pontual na edição (diff determinístico)
**Arquivo:** `src/lib/agents/orchestrator.ts` → `buildRevisaoBlock` (L44)

1. **Helper `computeRevisaoDiff(anterior, atual)`:** compara linhas de saving (por cargo: horas_antes/depois, linhas novas/removidas), campos da doc e valor de receita → lista textual **"MUDANÇAS DETECTADAS"**.
2. Injetar o diff no `buildRevisaoBlock` com a diretiva *"valide PONTUALMENTE só o que mudou; justifique a alteração; reaproveite o resto"*. Ex: só mudou horas do estagiário → o agente vai direto nisso.
3. **Reanálise sem perder contexto (acumular com resumo):** carregar adiante um resumo condensado das justificativas/divergências da versão anterior; o agente confirma ou atualiza; a composição de `observacoes` acumula o que importa (não duplica histórico cru).

## Frente 4 — Receita
**Arquivo:** `src/lib/agents/orchestrator.ts` → `buildReceitaPrompt` (~L255)
- Mesma postura cética: cruzar o racional com o que o projeto faz, capturar divergências, gate por materialidade. Blocos "RECEITA ≠ SAVING" e desafio de valor já existem — reforçar a captura do "porquê".

## Frente 5 — Analisador
**Arquivo:** `src/lib/agents/analyzer.ts`
- Receber as justificativas/contexto de divergências (Frente 2.3).
- Reforçar `saving_coerente` e/ou critério dinâmico de **coerência cargo↔tarefa**.

## Frente 6 — Documentação gerada no Drive (1 arquivo por projeto, in-place)
**Arquivos:** `src/lib/google/drive.ts`, `chat.functions.ts`, schema/migração
- **Renderizar a documentação gerada** (`DocumentacaoGerada` + memorial) num arquivo (markdown ou Google Doc) e subir ao Drive.
- **Persistir o `fileId`** numa coluna nova (`projetos.drive_doc_id`) — migração SQLite + leitura/escrita async (regra 6).
- **Update-in-place:** se já existe `drive_doc_id`, **PATCH** `/files/{id}` (uploadType=multipart) atualizando o conteúdo; senão cria e guarda o id. Nunca empilha duplicatas em edições.
- Manter o link na coluna J "URL" e em `arquivos_links`.
- **Erro não-propagante** (igual ao `uploadDocsToDrive` atual) — funciona quando a pasta for compartilhada com a SA.

---

## Arquivos tocados + regras obrigatórias
| Arquivo | Mudança |
|---|---|
| `src/lib/agents/orchestrator.ts` | prompts saving/receita, `buildRevisaoBlock`, novo `computeRevisaoDiff`, helper cargo-caro |
| `src/lib/agents/types.ts` | `justificativa?` em `SavingLinha` (+ campo de contexto agregado se necessário) |
| `src/lib/chat.functions.ts` | composição de `observacoes`; propagar contexto; persistir `drive_doc_id` |
| `src/lib/agents/analyzer.ts` | input do contexto + critério cargo↔tarefa |
| `src/lib/google/drive.ts` | render + create/PATCH in-place da doc gerada |
| `src/integrations/db/schema.ts` + migração | coluna `drive_doc_id` |
| `src/lib/testes/prompt-registry.ts` + `prompt-inspector.tsx` | **regra 3** — refletir prompts alterados |
| `worker.js` | **regra 1** — `npm run build:worker` e commitar |
| testes (Vitest) | **regra 2** — `npm run test`; cobrir `computeRevisaoDiff`, gate, composição de observações |
| `CLAUDE.md` / `docs/agents.md` / `docs/database.md` | **regra 7** — atualizar antes do PR (nova coluna, nova lógica) |

## Sequenciamento sugerido
1. **Frentes 1–2** (saving crítico + justificativa por linha + observações) — núcleo do pedido.
2. **Frente 3** (diff de edição) — depende do contexto por linha da Frente 2.
3. **Frentes 4–5** (receita + analisador) — reaproveitam padrões das anteriores.
4. **Frente 6** (Drive) — independente; construída pronta, ativa quando a pasta for compartilhada.

## Riscos / dependências
- **Bloqueio externo:** Frente 6 só funciona ponta a ponta após a gestão compartilhar a pasta do Drive (Editor) com a Service Account.
- **Latência:** mantida — sem chamadas LLM extras por turno (decisão 1).
- **Migração SQLite** (`drive_doc_id`): seguir padrão async (await + params).
- **Não regredir** a regra de ouro (sem R$ visível ao usuário) ao compor textos.
