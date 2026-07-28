# SPEC — Dashboard do admin: triagem sobre a planilha

> **Documento de planejamento/decisão.** Decisões fechadas com o Luis em **2026-07-28**.
> Plano de execução: [`docs/plans/dashboard-admin-sheets.md`](../docs/plans/dashboard-admin-sheets.md).
> Status: ✅ **implementado** (código + testes + build) · ⏳ validação em staging → prod.

## 1. Problema

`/dashboard` era uma lista de 110 linhas lendo `getProjetos()` → `getProjetosWithArea()` — **SQLite**.
Dois sintomas relatados pelo Luis:

1. **Rascunho aparecia** em "Todos os Projetos". Rascunho é estado interno do app e **nunca** vai à
   planilha; numa tela de triagem ele é ruído puro.
2. **O status estava errado.** O `status` do SQLite não é fonte de verdade: o sync reverso o **exclui**
   de propósito (`SAFE_UPDATE_FIELDS`), porque quem manda é a coluna **"Status"** do Sheets, mantida à
   mão por quem valida. "Meus Projetos" já lia o Sheets; o dashboard do admin, não.

Consequência prática: **a validação acontecia na planilha**, não no app — sem busca decente, sem filtro
por fila, sem ver a linha inteira de um projeto num lugar organizado.

## 2. Decisões fechadas (NÃO "corrigir" por engano)

- **D1 — A planilha é a fonte da listagem.** A tela lê `readAllRows()` (`google/sheets.ts`), a mesma
  leitura que o disparo de e-mails usa. **Não voltar a ler o SQLite**: seria reintroduzir o bug.
  Efeitos aceitos e desejados: rascunho não aparece; colunas manuais ("Diff Horas / Antes",
  "Diff Saving / Antes", "Observações") chegam de graça; um projeto que falhou o append de IDA não
  aparece aqui (é o mesmo buraco que a reconciliação de exclusão já trata).
- **D2 — Write-back só na planilha.** Mudar o status escreve **"Status"** (+ **"Observações"** quando há
  motivo) via `updateRowByProjectId` — UPDATE in-place por `ID Projeto`, nunca duplica linha. É a mesma
  semântica de editar a célula à mão, inclusive na consequência: pela regra **TEMPORÁRIA**, um reenvio
  futuro volta a gravar "Pendente" por cima. Isso **não** é bug desta tela.
- **D3 — "Atualizado Em" é intocável.** Aquela coluna é o carimbo da última escrita do **sistema** e é o
  que decide se um legado está regularizado (`pendente` em Meus Projetos). Marcar status **não** é editar
  o projeto; preenchê-la aqui daria baixa numa pendência que ninguém resolveu. Guard em teste
  (`tests/dashboard-admin.test.ts`, "NUNCA escreve Atualizado Em").
- **D4 — O `status` do SQLite não é tocado.** Pertence ao fluxo de submissão/análise, e o sync reverso o
  ignora. A única ponte que existe segue sendo a que já existia: "Descontinuado" na planilha → flag
  `descontinuado` no SQLite (mão única, `sync-reverse.ts`).
- **D5 — Cache de 60 s com single-flight.** Ler a planilha custa ~1–3 s. N admins abrindo a tela ao mesmo
  tempo geram **uma** leitura; o botão "Atualizar" (`?refresh=1`) fura o cache. Depois de gravar um
  status, a linha é **corrigida no cache** em vez de reler tudo — a tela reflete na hora.
- **D6 — Payload em duas camadas.** A listagem manda só campos de tabela; memoriais e justificativas
  (vários KB por projeto) só no detalhe, que sai do mesmo cache. **Não** engordar a listagem: com ~300
  projetos, mandar memorial junto passaria de 1 MB para exibir 25 linhas.
- **D7 — Busca no cliente, índice no servidor.** `mapResumo` pré-computa `busca` (minúsculas, **sem
  acento**) com nome do projeto, autor, e-mail, ID, área e ferramenta; o cliente filtra por token em AND.
  Responde na tecla. Buscar no servidor seria mais lento e não mais correto.
- **D8 — Auditoria própria.** A planilha não guarda autoria de célula. Tabela **`admin_status_log`**
  (projeto, de → para, motivo, admin, quando) responde "quem aprovou isto?". É registro paralelo: se a
  gravação da auditoria falhar, a escrita na planilha **não** é desfeita.

## 3. O que a tela faz

| Recurso | Como |
|---|---|
| Lista | Todos os projetos da planilha, mais recente primeiro (`Data Submissão`, pt-BR ou ISO via `parseDataFlexivel`; sem data vai ao fim). |
| Filas de status | Pílulas com **contagem ao vivo**: Todos · Pendente · Em validação · Reenvio pendente · Aprovado · Reprovado · Descontinuado · Sem status. Fila vazia não é exibida (a não ser que esteja selecionada). Rótulos legados agregam na pílula equivalente (`rejeitado`→Reenvio pendente, `validado`→Aprovado). |
| Busca | Instantânea (debounce 120 ms), tokens em AND, ignora acento/caixa. Atalho `/` foca; `Esc` limpa. |
| Ordenação | Projeto · Autor · Ganho total · Enviado (clique no cabeçalho alterna a direção; `aria-sort`). |
| Paginação | 25/50/100 por página, janela com elipses, contador "N–M de T". |
| Detalhe | Overlay (`Dialog`) com a **linha inteira** agrupada: Descrição → Identificação → Saving e horas → Custos e receita → Análise → Memoriais (`<details>`) → **Outras colunas** → Histórico de triagem. |
| Decisão | No topo do overlay: `select` de status + campo de motivo → "Salvar na planilha". Botão desabilitado quando nada mudou. |

**Régua de triagem (elemento de identidade):** cada linha tem 3 px de borda esquerda na cor do status, e
a pílula ativa usa a mesma cor — a composição da fila fica legível de relance. Estado **nunca só por
cor**: rótulo + ícone sempre presentes (`StatusBadge`).

## 4. Onde aterrissou

| Arquivo | O quê |
|---|---|
| `src/lib/dashboard-admin.functions.ts` | **novo** — cache single-flight, `mapResumo`, `listarProjetosDashboard`, `getProjetoDashboard`, `definirStatusProjeto`, `STATUS_GRAVAVEIS`, parsers puros. |
| `src/routes/_authenticated/dashboard.tsx` | **reescrito** — tabela densa, pílulas, busca, ordenação, paginação. |
| `src/components/dashboard/projeto-detalhe-dialog.tsx` | **novo** — overlay da ficha + decisão de status. Grupos de colunas por NOME; coluna desconhecida cai em "Outras colunas". |
| `src/components/dashboard/status-triagem.ts` | **novo** — vocabulário (rótulo/cor/ícone/ordem) e agregação de rótulos legados. |
| `src/components/dashboard/tabela-utils.ts` | **novo** — busca/ordenação/janela de páginas puras (testáveis sem React). |
| `src/components/status-badge.tsx` | +`reprovado` (vermelho + `XCircle`) e +`em validação`. Chaves existentes intactas. |
| `src/lib/google/sync-reverse.ts` | +`reprovado` → `rejeitado` em `STATUS_FROM_LABEL`. |
| `src/integrations/db/schema.ts` · `client.server.ts` | tabela `admin_status_log` + `insertAdminStatusLog` / `getAdminStatusLogs`. |
| `src/worker.ts` | `GET /api/admin/dashboard/projetos[?refresh=1]` · `GET /api/admin/dashboard/projetos/:id` · `POST /api/admin/dashboard/status` — todas `requireAdmin`. |
| `tests/dashboard-admin.test.ts` | 29 testes (mapeamento, cache/single-flight, filas, busca, paginação, write-back + guard do "Atualizado Em"). |

## 5. Pendências / pré-requisitos operacionais

1. ⚠️ **Dropdown da coluna "Status"** — a tela grava `Pendente` · `Em validação` · `Aprovado` ·
   `Reenvio Pendente` · `Reprovado` · `Descontinuado` (`STATUS_GRAVAVEIS`). Se algum desses textos
   **não** estiver na validação de dados da coluna, a escrita funciona mas a célula fica marcada como
   inválida para quem abre a planilha. **Confirmar/ajustar o dropdown** (ou a constante) antes de usar
   em prod. A regra é uma lista só, num lugar só.
2. **Validação em staging** (`edf400b4`) antes de prod (`674a3710`) — regra 13.
3. Sem tela para o histórico de `admin_status_log` fora do detalhe do projeto (não pedido).

## 6. Fora de escopo (decidido)

Editar dados do projeto pela tela (memorial, horas, saving) · e-mail automático ao mudar status (já
existe `/email-legados`) · paginação/busca server-side · mexer na regra TEMPORÁRIA que grava "Pendente"
na IDA.
