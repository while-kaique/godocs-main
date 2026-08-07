# Plano — Dispensar a fila do líder quando o analisador reprova o projeto

**Status:** ✅ **executado** (2026-08-06) — T1–T8 entregues, **1155 testes verdes**, `worker.js` rebuildado,
spec **D29** + `CLAUDE.md` atualizados. **Falta a T9** (staging `edf400b4` → prod `674a3710` → PR).

> **Entregue além das Tarefas (autorizado pelo operador na sessão):** o mesmo fall-through que o "Risco nº 1"
> descreve existia em **mais duas telas** — o card do autor (`meus-projetos.tsx`, dizia *"Aguardando o líder"*)
> e o selo do aprovador (`projeto.$id.tsx`, dizia *"✓ Parecer registrado"* a quem nunca abriu o projeto). As 3
> superfícies foram tratadas. A união `Veredito` estava **copiada em 3 arquivos** e velha desde 04/08 (faltava
> `'ajuste'`): unificada — fechou 2 dos 7 erros de `tsc` pré-existentes do repo.
>
> **Adiado com motivo (ADR-028):** extrair `Veredito` para um módulo PURO (padrão `coluna-chave.ts`). Hoje o
> `import type` é apagado no build (bundle conferido, limpo); o risco é um refactor futuro perder o `type`.

**Objetivo:** quando o analisador classifica um projeto como `claro_nao` (→ `Status` = "Reprovado"), as linhas
**pendentes** da fila de pré-aprovação daquele projeto são **dispensadas** — o líder para de ser cobrado de um
parecer sobre algo que o sistema já recusou, e o projeto sai do backlog das DMs do Gomoon, do relatório de
espera por líder e da tela `/aprovacoes`.

## Contexto e por que ESTE desenho (medido em prod, 06/08/2026)

O `abrirPreAprovacao` roda no fim de `submeterParaValidacao` e o aviso ao Gomoon sai ali (D26); o analisador
só é disparado **depois**, pelo worker (`src/worker.ts:325-331`, `analisarEmBackground`). Ou seja hoje o líder
é convocado **antes de existir veredito**, e um projeto reprovado por critério continua na fila dele.

Medição em produção antes de decidir (595 linhas da planilha; 32 projetos com parecer de líder):

| Cruzamento | Qtd |
|---|---|
| `Status = Reprovado` (qualquer pré-status) | **0** |
| Fila com `Classificação = claro_nao` | **0** |
| Fila com classificação **vazia** (analisador cancelado) | **18 de 32 (56%)** |
| Fila com `zona_cinzenta` · `claro_sim` | 9 · 5 |

Duas consequências que fecham o desenho:

1. **O gate sequencial ("analisa → só então convoca") foi DESCARTADO** (decisão do Luis, 06/08/2026): com 56%
   dos projetos da fila **sem veredito nenhum**, um gate fail-open não faria nada em mais da metade dos casos
   e teria acoplado o caminho da submissão à parte mais instável do pipeline (o analisador é cancelado com
   frequência — é por isso que existe o cron `reanalisar-pendentes`). **Não** reordenar a submissão.
2. O desperdício é **estrutural, não corrente** (0 casos hoje). Logo a fatia é pequena e defensiva: fechar a
   fila quando o veredito chega, sem inventar dependência nova.

## Tarefas

- **T1 —** `dispensarAprovacoesPendentes(projetoId, comentario)` em `client.server.ts`: `UPDATE` para
  `veredito='dispensado'`, `decidido_por='sistema'`, `decidido_em=datetime('now')`, **`WHERE … AND veredito
  = 'pendente'`**. (guarda: teste de que linha já decidida por humano fica **intacta**)
- **T2 —** `Veredito` ganha `'dispensado'` e os 2 rótulos passam a tratá-lo **explicitamente**:
  `rotuloAprovacaoSheet` → `'Dispensado'`; `justificativaAprovacaoSheet` → texto próprio dizendo que a
  reprovação foi do **sistema** e como reabrir. ⚠️ **Precedência: parecer HUMANO vence a dispensa** (se um
  líder decidiu antes, o rótulo dele permanece). (guarda: teste dos 2 rótulos + precedência)
- **T3 —** `dispensarPreAprovacao(projetoId)` em `aprovacoes.functions.ts`: lê as linhas, no-op quando não há
  pendente, chama T1 e devolve `{ dispensou, rotuloSheet, justificativaSheet }`. **NUNCA lança** (D3).
  (guarda: teste de no-op em projeto sem fila e em projeto já decidido)
- **T4 —** Hook em `analisarProjetoFn` (`chat.functions.ts`), no ramo `reprovadoPorCriterio`: chama T3 dentro
  de `try/catch` e repassa os 2 rótulos ao `syncUpdateToGoogle`. (guarda: teste de que falha na dispensa não
  derruba a análise nem o sync)
- **T5 —** `UpdateSyncParams` + `syncUpdateToGoogle` (`google/sync.ts`) ganham `aprovacaoLider?` /
  `justificativaAprovacaoLider?`, escritas **só quando `!== undefined`** — a régua de 06/08 ( `undefined` =
  "não encoste"; a análise que **não** dispensou não pode zerar parecer). (guarda: teste de que a análise sem
  dispensa **não** inclui as 2 chaves no update)
- **T6 —** `chaveDoEstado`/`EstadoParecer` (`aprovacoes-parecer.ts`) reconhecem `'Dispensado'` e o chip
  (`parecer-lider.tsx`) ganha entrada própria — **rótulo + ícone**, nunca só cor (regra 11). Hoje o rótulo
  desconhecido já aparece cru (nada é engolido), então isto é acabamento, não correção.
- **T7 —** `reabrirPreAprovacoes` passa a tratar fila **toda dispensada** como reabrível **sem** `forcar:true`
  (dispensa do sistema não é parecer humano) — é o remédio para a triagem que **reverte** a reprovação.
  (guarda: teste de que fila com parecer humano segue exigindo `forcar`)
- **T8 —** Testes (`tests/aprovacoes-lider.test.ts` + novo caso no sync), `npm run test`,
  `npm run build:worker`, `worker.js` recomitado (regra 1), spec **D29** em `SPEC_APROVACAO_LIDER.md` e a
  linha no `CLAUDE.md` (regras 7/12).
- **T9 —** Deploy **staging `edf400b4`** → validação → **prod `674a3710`** → PR (regras 10/13).

## Critérios de aceitação

1. Projeto reprovado por critério (`claro_nao`) com fila aberta: as linhas pendentes viram `'dispensado'`, o
   projeto **desaparece** de `getPendenciasPorLider` (payload do Gomoon) e de `listarAprovacoesPendentes`.
2. A coluna `Aprovação do Líder` passa a dizer **`Dispensado`** (nunca `Pré-reprovado` — não foi o líder que
   reprovou) e a justificativa explica que a reprovação é do sistema.
3. Líder que **já** decidiu antes da análise mantém o parecer dele intacto, no banco e nas 2 colunas.
4. Análise que **não** reprova não escreve nada nas 2 colunas do líder (nem `—`).
5. Falha em qualquer parte da dispensa **não** derruba a análise, o sync nem a submissão.
6. Reenvio reabre a fila normalmente (D10, via `abrirAprovacoesPendentes` que apaga e reinsere).
7. `/dashboard` mostra o estado novo com rótulo + ícone; o teste de ida-e-volta do parecer (D19) segue verde.
8. `npm run test` verde e `worker.js` commitado.

## Fronteiras (não exceder)

- **NÃO** reordenar a submissão nem acoplar `abrirPreAprovacao`/aviso ao analisador (gate sequencial
  descartado — ver contexto).
- **NÃO** mexer em `decidirStatusSubmissao`, no `CHECK` de `projetos.status` nem na regra TEMPORÁRIA do
  "Pendente" (a exceção `claro_nao → Reprovado` fica como está).
- **NÃO** reabrir a fila automaticamente quando a triagem reverte a reprovação — o remédio desta fatia é o
  `reabrirPreAprovacoes` (T7), manual e de admin. Gatilho automático no write-back do dashboard fica FORA.
- **NÃO** atacar os 56% sem `Classificação` (analisador cancelado) — achado colateral, fatia própria.
- **NÃO** tocar `SAFE_UPDATE_FIELDS` nem o sync reverso (`projeto_aprovacoes` é interna).

## Blast-radius

**Arquivos:** `src/integrations/db/client.server.ts` · `src/lib/aprovacoes.functions.ts` ·
`src/lib/chat.functions.ts` (só `analisarProjetoFn`) · `src/lib/google/sync.ts` ·
`src/lib/aprovacoes-parecer.ts` · `src/components/dashboard/parecer-lider.tsx` · testes · `worker.js`.

**Dependentes conhecidos:** `getPendenciasPorLider` (Gomoon — já filtra `veredito='pendente'`, exclui sozinho)
· `listarAprovacoesPendentes` (fila) · `resumoAprovacaoPorProjeto` (card do autor) · `resolverAcessoAprovador`
(D28 — a linha continua existindo, então o líder **mantém** a leitura do projeto: desejado) ·
`rotuloAprovacaoSheet`/`justificativaAprovacaoSheet` (Sheets + parser do dashboard).

**Invariantes tocados:** D3 (nunca lança/bloqueia) · D4 (primeiro que decide resolve) · D10 (reenvio reabre) ·
D14 (coluna de estado só com estado) · D18/D19 (formato da justificativa + teste de ida-e-volta) · D26
(payload do Gomoon sem R$) · `undefined ≠ null` nas 2 colunas (06/08/2026).

**⚠️ Risco nº 1 (a regressão que este plano existe para evitar):** o fall-through atual de
`rotuloAprovacaoSheet` devolve **`Pré-reprovado`** para qualquer veredito que não seja
`pendente`/`aprovado`/`ajuste`. Sem o tratamento explícito da T2, a dispensa apareceria na planilha como
**"o líder reprovou"** — afirmação falsa sobre uma pessoa que nunca olhou o projeto.

**Confiança: média.** Este repo não tem `docs/INDEX.md` nem `docs/invariants.md` (RF-35): o mapa acima saiu de
leitura manual do código e do `CLAUDE.md`/`SPEC_APROVACAO_LIDER.md`. A **sessão de código faz a varredura
completa** dos dependentes reais de `Veredito`, `rotuloAprovacaoSheet` e `veredito ===/!== 'pendente'` antes de
editar.
