# Plano — Projeto como FEATURE de outro projeto (projeto vinculado pai↔filho)

> Status: **✅ IMPLEMENTADO até STAGING (24/08/2026)** — plano aprovado (8 questões respondidas), Partes A/B/C codadas, 1710 testes verdes. Aguarda deploy staging + push + revisão do peer (SEM prod, SEM PR). · Autor: sessão Claude 24/08/2026
> Base: `origin/main` @ `9976923`. Branch: `feat/projeto-vinculado`. Worktree: `~/godocs-wt-projeto-vinculado`.
> Entrega ATÉ STAGING (`edf400b4`) — SEM prod, SEM PR/merge (regra 13; revisão humana primeiro).

## O que a feature faz (decisões FECHADAS do Luis — não redecidir)

1. **Etapa 1 — marcação:** toggle "Projeto novo" × "Feature de um projeto existente" nos **3 fluxos**
   (padrão, especial, fluxo direto de liderança). Se "feature" → pergunta "está em produção?" →
   **autocomplete** do **projeto pai**.
2. **Autocomplete do pai:** fonte = **espelho `sheet_espelho`** (NUNCA `readAllRows`/Sheets no request).
   `GET /api/projetos/buscar?q=` (autenticado) → `{id, nome, autor}` de projetos NÃO-rascunho, filtro por
   nome sem acento. UI reusa o padrão do autocomplete de participantes.
3. **Persistência + colunas:**
   - SQLite: `projeto_pai_id` no FILHO; `projeto_filhos_ids` (JSON lista) no PAI.
   - Sheets (por NOME): **"ID Pai"** na linha do filho; **"ID Feature"** na linha do pai (ACUMULA lista,
     sem duplicar, via `updateRowByProjectId`).
   - **Nome do filho** ganha prefixo `[feature de <NOME do pai>]`.
4. **Aprovação SEQUENCIAL de 2 líderes:** 1º = líder do FILHO (fluxo atual); 2º = líder do DONO DO PAI,
   aberto **só após** o 1º ser APROVADO. Cada estágio com isenção por cargo independente.
5. **Gomoon:** o "vale menos" é 100% do lado do Gomoon. Só garantir o vínculo (colunas) disponível.
   `memorial`/ganho = da própria feature (não herda o do pai).

---

## Parte A — Etapa 1 (marcação) + autocomplete do pai

### A.1 Endpoint de busca do pai (novo)
- **`GET /api/projetos/buscar?q=<termo>`** em `src/worker.ts` (autenticado via `getEmailFromRequest`,
  401 sem e-mail; **não** admin), ao lado de `/api/participantes/sugestoes`.
- Server fn nova **`buscarProjetosPorNome(q)`** em `src/lib/meus-projetos.functions.ts` (ou módulo novo
  `src/lib/projetos-busca.functions.ts`): lê `lerResumosEspelho()` (SQLite, 1 leitura, NUNCA Sheets),
  filtra por "Projeto" contendo `q` sem acento (reusa `normalizar`/`chaveColuna`-style), exclui rascunho
  (o espelho nunca tem rascunho — a planilha não os recebe), devolve no máx. ~20 `{id, nome, autor}`
  (`ID Projeto`, `Projeto`, `Nome Completo`). `q` < 2 chars → `[]`.
- Pura + testável: extrair `filtrarProjetosPorNome(resumos, q)` (função pura) para o teste.

### A.2 Estado do formulário (`src/lib/submeter/constants.ts`)
- `FormData` ganha: `vinculo: "novo" | "feature" | ""` (default `"novo"`? — ver Questão Q5), `paiId: string`,
  `paiNome: string`, `paiProdStatus: "sim" | "dev" | "idle" | ""`.
  - `paiProdStatus` é **só frontend** (como `prodStatus`): gate de porta, não vai ao backend.
- `initialFormData` inclui os novos campos.

### A.3 UI da Etapa 1 (`src/lib/submeter/step1.tsx`)
- No **modo submissão NOVA** (não `readOnlyProjeto`), acima de "Dados do Responsável" (ou logo abaixo do
  gate de escopo): `RadioGroup` "Este projeto é..." → "🆕 Projeto novo" × "🧩 Feature de um projeto existente".
- Se `vinculo === "feature"`: `RadioGroup` "O projeto pai já está em produção?" (`paiProdStatus`) + um campo
  autocomplete **novo componente `ProjetoPaiInput`** (`form-components.tsx`, espelhando `AfetadosInput`:
  input + dropdown de sugestões via debounce ao `GET /api/projetos/buscar?q=`), que grava `paiId`+`paiNome`.
- Hook de busca novo `useBuscaProjetos` (`src/lib/submeter/projeto-pai-sugestoes.ts`), debounced.
- **Edição** (`readOnlyProjeto`): o vínculo NÃO é editável (mostra "Feature de: <paiNome>" read-only se houver;
  submissão nova é o único ponto que cria o vínculo — igual à decisão do Luis "só submissão NOVA").
- a11y (regra 11): foco visível, estado por rótulo+ícone (nunca só cor), PT-BR com acento. Invocar a skill
  `frontend-design` antes de codar a UI.

### A.4 Validação Etapa 1 (`src/lib/submeter/constants.ts` `validarEtapa1`)
- Se `vinculo === "feature"`: exigir `paiId` preenchido E `paiProdStatus === "sim"` (mesma régua do
  `prodStatus` do próprio projeto — pai tem de estar em produção). "feature" sem pai → erro.

---

## Parte B — Persistência + colunas (pai↔filho)

### B.1 SQLite (`src/integrations/db/schema.ts`)
- MIGRATIONS: `ALTER TABLE projetos ADD COLUMN projeto_pai_id TEXT` e
  `ALTER TABLE projetos ADD COLUMN projeto_filhos_ids TEXT` (JSON lista de ids). Comentário SEM `;`.
- `ProjetoRow` (client.server.ts) ganha os 2 campos.
- `InsertProjeto` + `insertProjeto`: aceitar/gravar `projeto_pai_id`.

### B.2 Fluxo de criação (`src/lib/chat.functions.ts` `iniciarSubmissao` + schema)
- `iniciarSubmissaoSchema`: `projeto_pai_id: z.string().max(64).optional()`.
- `iniciarSubmissao`: passa `projeto_pai_id` ao `insertProjeto`. **Prefixo do nome:** ao criar, se houver pai,
  resolve o NOME do pai (via `getProjetoById(paiId)` ou o `paiNome` enviado) e grava
  `nome = "[feature de <NOME do pai>] " + nome` (idempotente — não re-prefixar se já começa com `[feature de`).
  - Decisão: usar o **nome enviado pelo cliente** (`pai_nome`) como fallback, mas preferir o nome REAL do pai
    lido do SQLite/espelho (a fonte é o espelho/`getProjetoById`), para o prefixo não depender de texto do cliente.
- Frontend `submeter.tsx`: incluir `projeto_pai_id` no payload de `iniciar-submissao` nos **3 caminhos**
  (normal `handleAnalisar`, fluxo direto `handleContinuarDireto`, especial `handleEnviarEspecial`/`iniciar-submissao`).

### B.3 Cross-row no PAI (o ponto delicado da persistência)
- Ao SUBMETER a feature (`submeterParaValidacao`, `chat.functions.ts`), depois do sync do próprio projeto:
  - Atualiza o PAI no SQLite: `projeto_filhos_ids` recebe o id do filho (append sem duplicar) via novo helper
    `vincularFilhoAoPai(paiId, filhoId)` (client.server.ts) — lê a lista atual, adiciona se ausente, grava.
  - Atualiza a planilha do PAI: `updateRowByProjectId(paiId, { "ID Feature": <lista acumulada> })` +
    `espelharEscrita(paiId, {...})`. A lista acumulada: ler a célula "ID Feature" atual do **espelho**
    (`lerLinhaEspelho(paiId)`), somar o novo id (sem duplicar), regravar. Best-effort, `runBackground`,
    nunca derruba a submissão.
  - Escreve **"ID Pai"** na linha do FILHO: já entra pelo `syncSubmitToGoogle` (ver B.4).
- Novo módulo PURO `src/lib/projeto-vinculo.ts`: `acumularIdFeature(listaAtualCSV, novoId)` (dedup, ordem
  estável, separador — proponho `", "` como as colunas de participantes) + `parseIdsFeature`. Testável.

### B.4 Sheets — colunas novas
- `SHEET_COLUMNS` (`src/lib/google/sheets.ts`): adicionar **"ID Pai"** e **"ID Feature"** ao array.
- `SubmitSyncParams` + `syncSubmitToGoogle` (`google/sync.ts`): novo campo `idPai?: string | null` →
  `row["ID Pai"] = ouTraco(p.idPai)`. (A "ID Feature" do FILHO nunca é escrita pelo filho — é do pai.)
- `submeterParaValidacao`: passa `idPai: projeto.projeto_pai_id`.
- ⚠️ As 2 colunas serão criadas no cabeçalho das abas GoDocs/STAGING pelo Luis. **Confirmar por leitura do
  cabeçalho (`fetchHeaderMap` via um script dryrun) antes do deploy**; se faltarem no staging, a escrita é
  ignorada com aviso → **REPORTAR** (não criar as colunas).
- Display na listagem/dashboard: **FORA de escopo** por ora (não entra em `COLUNAS_RESUMO`, não bumpa
  `VERSAO_RECORTE_RESUMO`) — evita a dependência de re-espelhamento e mantém o payload da listagem enxuto.
  (Se o Luis quiser mostrar o vínculo na triagem, é um incremento separado.) — ver Questão Q4.

---

## Parte C — Aprovação SEQUENCIAL de 2 líderes ⚠️ (o ponto MAIS delicado — SPEC_APROVACAO_LIDER D1–D31)

### Contexto do risco
`projeto_aprovacoes` hoje modela UMA fila (líder do autor). TODAS as funções leitoras
(`rotuloAprovacaoSheet`, `justificativaAprovacaoSheet`, `resumoAprovacaoPorProjeto`, `getAprovacoesDoProjeto`,
`getAprovacoesPendentesDe`, `getPendenciasPorLider`, `getTodasAprovacoesPendentes`, `decidirAprovacoesDoProjeto`)
tratam "as linhas do projeto" como essa única fila. `decidirAprovacoesDoProjeto` resolve **TODAS** as pendentes
do projeto de uma vez (D4). Isso mexe em invariantes que rodam em PROD (D4/D12/D14/D29/D30).

### Desenho RECOMENDADO (a confirmar — ver Questões)
- **Coluna `estagio INTEGER NOT NULL DEFAULT 1`** em `projeto_aprovacoes` (MIGRATIONS ALTER; default 1 → todos
  os projetos e leituras existentes = estágio 1, ZERO mudança de comportamento). `AprovacaoRow.estagio`.
- **Estágio 1 (líder do autor):** exatamente o fluxo de hoje — `abrirPreAprovacao` no `submeterParaValidacao`,
  isenção por cargo (`ehLideranca`), rótulos e Sheets column "Aprovação do Líder" **inalterados** (só passam a
  filtrar `estagio === 1` — ver abaixo).
- **Estágio 2 (líder do dono do PAI):** nova `abrirPreAprovacaoProjetoPai(filhoId)`:
  - lê `projeto_pai_id` do filho → `getProjetoById(pai)` → `dono = pai.responsavel_email`;
  - isenção INDEPENDENTE: `ehLideranca(dono)` → estágio 2 satisfeito sem fila; sem líder (D6) → idem;
  - senão, insere linhas `estagio=2` (novo helper `abrirAprovacoesEstagio(filhoId, versao, autorEmail=dono, aprovadores, estagio=2)`).
  - ⚠️ `autor_email` da linha estágio-2 = o DONO DO PAI (é dele que a relação líder↔liderado do Gomoon deriva),
    e o `projeto_id` continua sendo o do FILHO (é o projeto que o líder do pai vai LER/decidir — D28 dá leitura).
- **Gatilho do estágio 2 (lazy):**
  - Se estágio 1 é **isento** (liderança/sem líder) E o filho tem pai → abre estágio 2 **na submissão**
    (dentro de `abrirPreAprovacao`/`submeterParaValidacao`, logo após resolver o estágio 1).
  - Se estágio 1 abre fila real → abre estágio 2 **em `decidirAprovacao`**, quando `veredito==='aprovado'` E a
    linha decidida é `estagio===1` E o filho tem pai E ainda não há linhas `estagio=2`. `ajuste`/`reprovado` →
    NÃO abre (requisito: 1º reprova → não chega ao 2º).
- **Escopo por estágio (o que muda nos leitores):**
  - `decidirAprovacoesDoProjeto` ganha parâmetro `estagio` → `... AND estagio = ?` (resolve só o estágio do
    decisor; preserva a serialização D30 `AND veredito='pendente'` e o retorno `number|null`). O decisor sabe o
    estágio pela própria linha pendente encontrada no gate.
  - A escrita da coluna Sheets **"Aprovação do Líder"** (estágio 1) e sua justificativa passam a computar sobre
    `linhas.filter(l => l.estagio === 1)` em `decidirAprovacao`, `dispensarPreAprovacao`, `reabrirPreAprovacoes`.
    Assim uma decisão de estágio 2 NUNCA sobrescreve a coluna do estágio 1.
  - Estágio 2 **não ganha coluna nova no Sheets** (proposto — Q3): seu veredito vive em `projeto_aprovacoes` +
    tela `/aprovacoes` + aviso Gomoon. (Se precisar auditoria na planilha, é coluna nova = header novo.)
- **O que "só funciona" sem tocar (porque keyam em `aprovador_email` + `veredito='pendente'`):**
  `getAprovacoesPendentesDe` (tela do líder do pai mostra o item), `getPendenciasPorLider` (Gomoon inclui o
  líder do pai), `contarAprovacoesPendentesDe`, `getTodasAprovacoesPendentes` (Investigador), `resolverAcessoAprovador`
  (D28 dá leitura ao líder do pai). O líder do pai usa a MESMA tela e o MESMO gate de decisão.

### C.1 Mensagem própria do estágio 2 (Gomoon — mesmo canal, D17)
- Copy nova em **`src/lib/gomoon-mensagens.ts`** (fonte única): `renderMensagemLiderFeature(...)` — CLARA, SEM
  hífen/traço, dizendo que é uma **NOVA FEATURE implementada no projeto <nome do pai>** e que aguarda o parecer dele.
  Markup HTML de card (`<b>`), `\n`, sem `<a href>` (D22). Sem R$ (invariante do payload).
- Aviso IMEDIATO do estágio 2 via novo `notificarLiderDoProjetoPai(filhoId, aprovadoresEstagio2, {nomeFilho, nomePai})`
  em `gomoon-lideres.functions.ts`, disparado no gatilho (submissão se isento; `decidirAprovacao` se lazy). Nunca lança;
  fire-and-forget `runBackground`; guard `[E2E-…]`; namespacing de idempotência por projeto (`chaveDeProjeto`).
  - ⚠️ NÃO reintroduz DM pelo GoDocs (D17). Só monta payload + POST ao Gomoon, como o fluxo atual.

### C.2 Invariantes D1–D31 a NÃO regredir
- D4 (1º decide resolve) — preservado DENTRO de cada estágio (`AND estagio=?`).
- D30 (1 msg por decisão) — `deveNotificarDecisao(linhasGravadas)` inalterado; `decidirAprovacoesDoProjeto`
  segue devolvendo `number|null`.
- D12/D14 (rótulo/justificativa Sheets do estágio 1) — computados só sobre `estagio===1`.
- D29 (dispensa) — `dispensarAprovacoesPendentes` deve dispensar por estágio? (proposto: dispensa AMBOS os
  estágios pendentes quando o analisador reprova o filho — o projeto morreu; ver Q6).
- D10 (reenvio reabre) — `abrirAprovacoesPendentes` faz DELETE incondicional por `projeto_id`: apaga estágios 1 E 2.
  Correto (reenvio recomeça a cadeia inteira do filho).
- D27 (especial não abre fila do PRÓPRIO projeto) — mantém-se; mas uma feature ESPECIAL ainda deve abrir estágio 2
  do PAI? (proposto: sim — o dono do pai precisa saber que puseram uma feature no projeto dele, mesmo especial;
  ver Q7).

---

## Pontos de risco (resumo)
1. **Cross-contaminação da coluna Sheets "Aprovação do Líder"** por decisão do estágio 2 → mitigado por filtro
   `estagio===1` nos 3 pontos de escrita. Precisa de teste.
2. **`decidirAprovacoesDoProjeto` com escopo de estágio** — mexe no ponto de serialização do D30. Aditivo, mas exige
   teste de corrida por estágio.
3. **Gatilho lazy** — abrir estágio 2 exatamente uma vez (idempotência: checar se já há `estagio=2` antes de abrir).
4. **Header do Sheets** ("ID Pai"/"ID Feature") pode não existir no staging → escrita ignorada com aviso.
5. **Prefixo do nome** — idempotência no reenvio (não duplicar `[feature de ...]`).

## Ordem de implementação
1. Parte B (schema + persistência + colunas) — base, sem UI.
2. Parte A (endpoint busca + Etapa 1 UI).
3. Parte C (sequencial) — só depois de B e A verdes e do OK humano sobre o desenho.
4. Testes por parte; `npm run test` verde no fim.
5. Build worker + commit; deploy STAGING; validar por manifest + logs. PARAR.

## Questões para o humano (confirmar ANTES da Parte C)
- **Q1 — Estágio via coluna `estagio` vs tabela separada?** Recomendo `estagio` (reusa toda a máquina; menos
  código; risco concentrado em ~3 filtros). Confirmar.
- **Q2 — Gatilho do estágio 2 quando o estágio 1 é ISENTO (liderança/sem líder):** abrir estágio 2 já na
  submissão. OK?
- **Q3 — Estágio 2 NÃO ganha coluna no Sheets** (fica em SQLite+tela+Gomoon). OK, ou o Luis quer uma coluna
  "Aprovação Líder Pai" (= mais 1 header a criar)?
- **Q4 — Vínculo NÃO aparece na listagem do /dashboard** (fora de COLUNAS_RESUMO). OK para v1?
- **Q5 — Default do toggle:** "Projeto novo" pré-selecionado (comportamento atual) — OK?
- **Q6 — Dispensa (D29):** analisador reprova o FILHO → dispensa estágios 1 E 2. OK?
- **Q7 — Feature ESPECIAL:** o filho especial não abre fila do próprio autor (D27), mas ABRE estágio 2 do dono
  do pai? Recomendo sim. Confirmar.
- **Q8 — Múltiplos líderes do dono do pai (D4):** estágio 2 também é "o 1º que decide resolve". OK.

## Testes previstos (regra 2)
- `tests/projeto-vinculo.test.ts`: `filtrarProjetosPorNome` (sem acento, min chars), `acumularIdFeature`
  (dedup, ordem), prefixo do nome (idempotente).
- Extensão de `tests/aprovacoes-lider.test.ts` (ou novo `tests/aprovacoes-sequencial.test.ts`): estágio 1
  aprova → abre estágio 2; estágio 1 reprova → NÃO abre; isenção por estágio independente; decisão de estágio 2
  não toca coluna do estágio 1; corrida por estágio.
- Persistência cross-row no pai (lista acumula sem duplicar).
