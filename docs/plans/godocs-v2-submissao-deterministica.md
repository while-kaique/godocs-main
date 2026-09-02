# Plano — GoDocs v2: submissão determinística sem agente no cliente

**Status:** ✅ aprovado (Luis, 02/09/2026) · **em execução — T1 e T2 executadas em 02/09** (branch `feat/godocs-v2`,
suíte 2381 verde; revisores: conformidade `diverge-baixa`, qualidade `sugestoes`, reuso `duplicacao-intencional` —
nenhum barrante). T1 fechada menos a verificação com Google (secrets sensíveis dispensados pelo Luis). Próxima: **T3**.

**Objetivo:** substituir a coleta conversacional de ganho por um formulário determinístico de 4 categorias
(saving efetivado · custo evitado · receita incremental · ganho imensurável), com nova fórmula de impacto,
documentação gerada invisivelmente em background e classificação de estrelas feita do nosso lado — tudo
num ambiente isolado (`godocs-v2-staging`, aba `STAGING-V2`), sem tocar prod nem o staging atual.

---

## Contexto e decisões fechadas (conversa de 02/09/2026, Luis)

### D1 — A régua que separa saving efetivado de custo evitado
A pergunta que decide é uma só: **esse dinheiro estava saindo do caixa antes desta solução?**

- **Saving efetivado** — havia uma linha de custo saindo e ela parou (contrato cancelado, licença que não
  se paga mais, terceirizado dispensado, multa/juros que pararam). É comprovável num extrato, fatura ou
  contrato encerrado. **Por isso pede evidência e pesa 100%.**
- **Custo evitado** — a despesa nunca nasceu (vaga que não foi aberta, consultoria que não foi contratada,
  volume novo que exigiria mais gente, horas liberadas de quem continua na folha). Não existe extrato
  porque não existe linha que sumiu. **Por isso não pede evidência e pesa 50%.**

Corolário registrado: **hora liberada de gente que continua empregada não é dinheiro no bolso**, é capacidade
que se deixou de precisar comprar. É por isso que a tabela de horas antes/depois vive no **custo evitado**, e
não no saving. Efeito colateral aceito: hora liberada deixa de valer 100% (era assim na v1) e passa a valer 50%.

### D2 — Fórmula do impacto
```
CE = CE_horas + CE_naocontratado                    (os dois braços do custo evitado)

Impacto Bruto           =     S  +     CE  +     R
Impacto Líquido         = 1,0·S  + 0,5·CE  + 0,1·R  − C
Impacto Líquido Mensal  = 1,0·m(S) + 0,5·m(CE) + 0,1·m(R) − m(C)

m(x) = x ÷ { pontual 4 · mensal 1 · trimestral 3 · semestral 6 }
```
- **Cada bloco é mensalizado pela frequência DELE**, não pelo projeto: é possível ter saving mensal e receita
  pontual no mesmo projeto, e aí não existe divisor único.
- **Custo para rodar (`C`) subtrai com peso 100%** — é caixa saindo com a mesma certeza do saving efetivado;
  descontar custo certo por menos de 100% inflaria o projeto.
- **Bloco não marcado entra como zero.** A fórmula não muda com o número de categorias marcadas.
- **Ganho imensurável fica fora de toda conta** — não tem número; o que o representa é a estrela.
- O `÷10` da receita da v1 vira `×10%`: mesma coisa, nome diferente.
- **Pontual passa a dividir por 4** (a validade padrão do projeto). ⚠️ Isso **inverte conscientemente** a
  decisão de 01/07/2026 ("pontual entra pelo valor cheio"), que segue valendo na v1.
- O **Gomoon recebe o Impacto Líquido Mensal**.

### D3 — Fusão das duas linhas de custo
`custo externo mensal` (a plataforma paga onde a solução roda, hoje condicional ao escopo "externo") e
`custo do projeto` (API/SaaS por uso, lista de itens) viram **um só campo: "custo para rodar"**, em lista
incremental. Economicamente sempre foram a mesma coisa e ninguém os distinguia — manter os dois só reproduz
a dúvida. O campo condicional da Etapa 1 desaparece.

### D4 — Fim do agente no caminho do usuário
Nenhuma chamada de LLM bloqueia a submissão. Some o chat, some a etapa de aprovação da documentação, somem
todos os gates conversacionais. **A pessoa não sente que existe uma doc sendo processada nos fundos.**

Consequência assumida de olho aberto: **na v2 nada barra número implausível na hora do envio.** Os gates de
hoje (jornada/220h, teto por pessoa, ≥44h e alocação, ganho real × projetado, sobreposição receita × custo
evitado, custo evitado citado no chat, dupla contagem, critério `[1.3]`/`[1.4]`) vivem todos no caminho do
chat e morrem junto com ele. A validação passa a ser inteiramente **pós-submissão** (analisador, mesa de
avaliação, triagem humana). Regras de backend novas entram depois, numa frente própria.

### D5 — Especial deixa de ser declarado pelo usuário
Sai a Etapa 2.5 (checkbox de especial + as 2 perguntas de triagem). **Especial passa a ser derivado:
estrela > 0.** A estrela é recomendada pelo classificador e confirmada por clique humano — o invariante
"agente nunca escreve a coluna Estrelas" permanece.

**Ganho imensurável é o novo especial**, mas sem o mesmo peso: pode ser julgado errado, e nesse caso a pessoa
edita e informa o ganho, ou o projeto de fato ganha estrelas. O classificador precisa amarrar isso bem.

### D6 — Documentação em background, invisível
Dispara ao sair da Etapa 2 (é quando anexos e descrição já existem) e roda enquanto a pessoa preenche a
Etapa 3. Se a pessoa terminar antes, a submissão **não espera**: a doc continua e é reconciliada por cron.
Sem etapa de aprovação, sem loader dedicado, sem o usuário saber que existe.

### D7 — Ambiente isolado
App novo `godocs-v2-staging` (datasource zerado), aba **`STAGING-V2`** na planilha já existente, Google Chat
mudo, Gomoon desligado. Nada toca `674a3710` (prod) nem `edf400b4` (staging da v1).

### D8 — A estrela vale para todo projeto
Decidido no gate de ambiguidade (02/09, Luis): **o classificador avalia todo projeto submetido**, não só o
de ganho imensurável. A estrela passa a significar **relevância do projeto**, independente de ter número —
um projeto com saving bem medido pode ganhar estrela e, com isso, ser especial. O invariante de sempre
continua: o agente **recomenda** em tabela interna, e a nota só muda por clique humano.

### Decisões ainda em aberto (não bloqueiam o MVP)
- Cabeçalho real da aba `STAGING-V2` ainda não conferido contra a proposta da T6.
- Racional de negócio do fator 10% da receita nunca foi registrado em lugar nenhum (só a proibição de
  "corrigir"). Herdado como está.

---

## Fluxo alvo

**Etapa 1** — identidade, projeto, participantes e papéis. Sai o campo "data de criação": a data que vale
passa a ser a **data de submissão** (só se submete o que está em produção).

**Etapa 2** — dados do projeto, anexos, escopo, ferramentas + **checkbox das 4 categorias de ganho**.
Sai a Etapa 2.5 inteira. Ao avançar, dispara a compilação da doc em background.

Regra do checkbox: saving efetivado, custo evitado e receita incremental **combinam livremente**;
**ganho imensurável é exclusivo** (marcá-lo desmarca os outros e vice-versa).

**Etapa 3** — um **acordeão com um bloco por categoria marcada**, o primeiro aberto. Completou um bloco, ele
fecha e o próximo abre. No fim, o bloco "custo para rodar" (fora do acordeão) e a revisão.

| Bloco | Campos |
|---|---|
| Saving efetivado | frequência · valor · **evidência** (texto obrigatório + anexo/colar) · desde quando (dentro da evidência) |
| Custo evitado | frequência · tabela horas antes/depois por função (com "Outro" + descrição + tooltip) · valor não contratado · racional |
| Receita incremental | frequência · valor · racional · tipo de receita |
| Ganho imensurável | racional via o mesmo componente de evidência (texto + anexo + colar imagem) |
| Custo para rodar | lista incremental: item · valor · frequência · o que é |

**Não-funcionais:** mobile-first, SPA, sem loading longo ou travado, reaproveitando a linguagem visual atual.
Texto novo enxuto, em linguagem natural, sem travessão nem hífen decorativo.

---

## Tarefas

> Este plano é o **roadmap da frente**, não de uma sessão. Cada tarefa vira uma sessão de `/ggsd:code`
> própria, na ordem abaixo — T2 e T3 antes de qualquer UI, T9 só no fim. A ordem não é sugestão: a T5
> depende do modelo da T3, e a T6 depende da fórmula da T2 ser fonte única.

- **T1 — Ambiente v2 isolado.** Criar app `godocs-v2-staging` no Godeploy (datasource novo, zerado), secrets
  com `GODOCS_ENV=v2-staging`, aba `STAGING-V2` como alvo do sync, Chat e Gomoon desligados. Estender o guard
  `assertNaoEhDefaultDeProd` (`src/lib/env.ts`) para reconhecer o ambiente novo — **e todos os
  consumidores que comparam com a literal `'staging'`**, que são o trabalho de verdade: `pinecone.ts`
  (namespace ia para `prod` e contaminaria o índice de produção), `gomoon-lideres.functions.ts` e
  `rollup-push.functions.ts` (campo `ambiente` saía `producao` → DM em líder REAL e escrita na série de
  prod) e `staging-banner.tsx` (o v2 subiria sem faixa, visualmente idêntico a prod). A régua passa a ser
  `isStaging()`/`rotuloAmbienteExterno()`, nunca a comparação literal.
  *(guarda: deploy sobe, `/api/auth/me` responde, e uma submissão de teste escreve em `STAGING-V2` — nunca em `GoDocs`/`STAGING`)*

- **T2 — Núcleo puro do impacto** (`src/lib/impacto.ts`, novo). `mensalizar(valor, frequência)`,
  `impactoBruto`, `impactoLiquido`, `impactoLiquidoMensal`, com os pesos como constantes nomeadas
  (`PESO_SAVING=1`, `PESO_CUSTO_EVITADO=0.5`, `PESO_RECEITA=0.1`) e `DIVISOR_FREQUENCIA`. **Fonte única.**
  Escrito antes de qualquer UI, com teste primeiro.
  *(guarda: `tests/impacto.test.ts` — os 3 exemplos da conversa, blocos ausentes = zero, frequências mistas, imensurável fora da conta)*

- **T3 — Modelo de dados dos 4 ganhos.** Tipos em `agents/types.ts`/`submeter/constants.ts`
  (`GanhoCategoria`, `SavingEfetivado`, `CustoEvitado`, `ReceitaIncremental`, `GanhoImensuravel`, `CustoRodar`),
  colunas SQLite novas + migração, e a regra pura de exclusividade do checkbox
  (`categoriasValidas`, imensurável XOR o resto).
  *(guarda: teste da exclusividade + ida-e-volta de serialização)*

- **T4 — Componentes que faltam** (extraídos, não improvisados no passo):
  `Acordeao` (disclosure genérico, teclado + `aria-expanded` + reduced-motion) · `ListaItens`
  (nome/valor/frequência/descrição — hoje duplicado inline duas vezes dentro do `SavingForm`) ·
  `TabelaHoras` (função com opção "Outro" + descrição + tooltip) · `CampoEvidencia` (texto obrigatório +
  anexo + **colar imagem**, estendendo o `onPaste` que só existe em `ajuda-widget.tsx:142`).
  Reusar sem recriar: `form-components.tsx` (Radio/Card/GridCheckbox, `InfoTooltip`), `CampoData`,
  `ExemplosCampoAjuda`, `formatMoedaBR`/`parseMoedaBR`, `draft-storage`.
  *(guarda: teste de unidade por componente + a11y mínima; nenhum `useState` novo dentro de `SavingForm`)*

- **T5 — Etapas 1, 2 e 3 reescritas.** Etapa 1 sem "data de criação". Etapa 2 com o checkbox de 4 e sem a
  2.5 (arquivo `step25.tsx` sai; `validarEtapa25Especial`/`motivoBloqueioEspecial` saem junto). Etapa 3 =
  acordeão dos blocos marcados + custo para rodar + revisão, substituindo `SavingForm` e o `Step3Chat`.
  **Validação da Etapa 3 vira função pura fora do componente** (hoje é `validate()` interno, não testável).
  *(guarda: `tests/validacao-etapa3.test.ts` novo + os testes de etapa 1/2 seguem verdes)*

- **T6 — Persistência, planilha e leitura.** `SHEET_COLUMNS` novo (proposta abaixo), montagem da linha em
  `sync.ts`, `COLUNAS_NUMERICAS`, `SAFE_UPDATE_FIELDS`, `COLUNAS_RESUMO` + **bump da `VERSAO_RECORTE_RESUMO`**
  (sem ele o campo nasce vazio para sempre), agrupamento financeiro da ficha
  (`projeto-detalhe-dialog.tsx:158`, casa por nome literal) e `rollup-backfill` (lê `Saving Reais`, que deixa
  de existir). **A fórmula tem 5 réplicas hoje** (`chat.functions.ts:3910`, `:4227`, `:4416`,
  `reconciliar-financeiro.ts:96`, `avaliacao-normais.functions.ts:282`) — todas passam a chamar a T2.
  *(guarda: `chavesForaDoCabecalho` contra o cabeçalho real de `STAGING-V2` + suíte de sync verde)*

- **T7 — Doc invisível em background.** Ligar `DOC_COMPILE_ASYNC` como caminho principal, disparar na saída
  da Etapa 2, remover a fase `doc_preview` e o turno de aprovação, e garantir a ordem: o analisador não pode
  rodar sobre placeholder. Reusar `recompilarDocsPendentes` + cron `recompilar-docs-pendentes` como fila.
  *(guarda: submissão sem esperar IA; doc pendente é reconciliada pelo cron; `CHAVES_PROTEGIDAS_DOC` continua impedindo a doc de sobrescrever o financeiro)*

- **T8 — Estrelas para todo projeto (D8).** Estender a **mesa de avaliação de normais** (`avaliacao-normais.functions.ts`
  + `projeto_avaliacao`, que já tem RAG, cron, deliberação e a coluna "Sombra"), não o classificador de
  especiais. Especial passa a ser derivado de estrela > 0 e o corpus deixa de ser só-especiais.
  *(guarda: recomendação gravada sem tocar a coluna "Estrelas"; projeto com nota humana continua sendo âncora, nunca reclassificado)*

- **T9 — Limpeza do que morreu.** Remover chat de submissão, orquestrador conversacional, os 7 gates, prompts
  e testes órfãos. **Feito por último**, depois que o fluxo novo estiver verde no staging v2 — apagar antes
  deixa a v2 sem rede e sem referência.
  *(guarda: suíte verde e nenhum import morto)*

### Proposta de cabeçalho da aba `STAGING-V2` (a conferir contra o real)

*Saem (12):* Data Criação · Alguém Fazia? · Especial? · Contexto do Projeto Especial · Alocação Ganhos ·
Saving Horas Escalado · Saving Horas Real · Justificativa Saving Escalado e Real · Tipo de Saving ·
Custo Mensal ou Pontual · Diff Horas/Antes · Diff Saving/Antes

*Entram (14):* Saving Efetivado · Freq. Saving Efetivado · Saving Efetivado Desde · Evidência Saving Efetivado ·
Freq. Custo Evitado · Custo Evitado Horas · Racional Custo Evitado · Freq. Receita · Ganho Imensurável ·
Custo para Rodar · Freq. Custo para Rodar · Impacto Bruto · Impacto Líquido · Impacto Líquido Mensal

*Renomeiam:* Tipos Projeto → **Tipos de Ganho** · Memorial de Saving → **Parecer dos Validadores** ·
Custo do Projeto + Custo Externo Mensal → **Custo para Rodar** (fusão, D3) · Receita Mensal → **Receita Incremental**

*Ficam:* identidade e papéis · Descrição · URL · URL Godeploy · Ferramenta · Escopo · Usa AI Proxy ·
Custo Evitado · Justificativa Custo Evitado · Horas em Reais · Tipo de Receita · Receita Memorial ·
Status · Estrelas · Classificação · Complexidade · Observações · Motivo Reenvio · Motivo Reprovado ·
Análise Antiagente · Aprovação do Líder · Justificativa Aprovação do Lider · Memorial anterior ·
Atualizado Em · **ID Pai** · **ID Feature**

---

## Critérios de aceitação

1. Uma submissão completa vai da Etapa 1 ao envio **sem uma única chamada de LLM no caminho crítico**, e o
   tempo percebido não depende do proxy.
2. Marcar ganho imensurável desmarca as outras 3, e marcar qualquer uma das 3 desmarca o imensurável.
3. Com 1, 2 ou 3 categorias marcadas, `Impacto Líquido` bate com a T2 no teste e na planilha; blocos não
   marcados entram como zero.
4. Frequências diferentes entre blocos produzem o mensalizado correto por bloco (não um divisor de projeto).
5. O acordeão abre o próximo bloco ao completar o anterior, funciona por teclado e respeita `prefers-reduced-motion`.
6. O campo de evidência aceita texto, anexo e imagem colada, e **recusa anexo sem texto**.
7. A documentação é gerada sem que o usuário perceba, e uma submissão feita antes de ela terminar não trava
   nem perde a doc (o cron reconcilia).
8. Nenhuma escrita chega às abas `GoDocs` ou `STAGING`, e nenhuma DM/mensagem de Chat sai do ambiente v2.
9. `chavesForaDoCabecalho` volta vazio contra o cabeçalho real de `STAGING-V2`.
10. Suíte verde e `worker.js` commitado.

## Fronteiras (não exceder)

- **Prod (`674a3710`) e staging v1 (`edf400b4`) não são tocados** nesta frente, em nenhuma tarefa.
- **Não** se reimplementam os gates removidos nem se inventam gates novos: a validação é pós-submissão.
  Regras de backend são uma frente posterior.
- **Não** se mexe no fluxo de edição/reenvio além do necessário para ele não quebrar; a paridade completa
  edição↔submissão é fatia própria.
- **Não** se migram dados da v1 para o modelo novo (a v2 nasce com base zerada).
- **Não** se mexe em `/dashboard`, `/especiais`, `/aprovacoes` além do que a T6/T8 exigem para não quebrar.
- Nada de merge para `main` antes do fluxo estar validado no staging v2.

## Blast-radius

**ALTO** — atravessa 6 subsistemas. Mapeado por 3 exploradores (formulário · cálculo/Sheets · background).

**Arquivos (núcleo):** `src/routes/submeter.tsx` (3459) · `src/lib/submeter/step2.tsx` (1010) ·
`step25.tsx` (543, sai) · `step3-chat.tsx` (2800, do qual `SavingForm` = ~1330) · `constants.ts` (844) ·
`form-components.tsx` (1560) · `src/lib/agents/saving-calc.ts` · `src/lib/chat.functions.ts` ·
`src/lib/google/sheets.ts` + `sync.ts` + `sync-reverse.ts` · `src/lib/dashboard-resumo.ts` ·
`src/integrations/db/schema.ts` · `src/worker.ts` · `src/lib/agents/doc-async.ts` ·
`src/lib/avaliacao-normais.functions.ts`

**Dependentes que quebram em silêncio (os perigosos):**
- `chavesForaDoCabecalho` — coluna renomeada e não renomeada na planilha vira **`console.warn`, não erro**.
- `VERSAO_RECORTE_RESUMO` sem bump — as ~600 linhas não re-espelham e o campo novo **nasce vazio para sempre**.
- `projeto-detalhe-dialog.tsx:158` casa colunas financeiras por **nome literal**; renomeada, some da seção
  e reaparece crua em "Outras colunas".
- `client.server.ts:711` faz `json_extract('$.ganho_total_mensal')` em SQL cru — renomear a chave do
  snapshot não dá erro de tipo.
- `tests/calendario-ui.test.ts:15` lê `step2.tsx` **como texto**: mover/reescrever o arquivo falha o canário.
- `meus-projetos.functions.ts:263` força `ganho_total_mensal: null` — todo campo de ganho novo precisa
  nascer `null` no payload do autor (invariante "cliente não vê R$ de saving").
- `sync-reverso` com célula vazia **nunca apaga**: coluna renomeada degrada em silêncio.

**Invariantes que sobrevivem à v2:**
- Agente **nunca** escreve a coluna "Estrelas"; a nota só muda por clique humano.
- Projeto com nota humana **não é reclassificado** (é âncora e exemplar do corpus).
- `runBackground`/`ctx.waitUntil` obrigatório para fire-and-forget (senão o Godeploy cancela).
- Comentário no `SCHEMA_SQL` **não pode conter `;`** (o `initSchema` divide por `;`).
- **Nunca** `process.env` em escopo de módulo (`constants.ts` é importado pelo worker via `orchestrator.ts`).
- Financeiras vazias gravam `0`, texto vazio grava `—` (`padronizarLinha`/`COLUNAS_NUMERICAS`).
- R$ de saving continua escondido do autor.
- Nunca `SELECT` de blobs de snapshot em massa (teto de 32 MiB de RPC).

**Confiança: média.** O worktree não tem `docs/INDEX.md`, `docs/invariants.md` nem `scripts/ctx-route.sh`;
o mapeamento veio de varredura direta e do `CLAUDE.md`. A sessão de código deve refazer a varredura
profunda dos dependentes reais antes de mexer em `SHEET_COLUMNS` e na fórmula.

**Lacunas declaradas pelos exploradores:** cabeçalho real de `STAGING-V2` não conferido (usar
`scripts/dryrun-lider/cabecalho-full.ts`) · `validate()` interno do `SavingForm` não lido campo a campo ·
cadência real dos crons vive na plataforma, não no repo · quais campos de `documentacao.conteudo` o
analisador exige (decide se a doc pode aterrissar depois dele).
