# Plano — Ocultar o valor (R$) do projeto nos cards de "Meus Projetos"
**Status:** ✅ aprovado (Luis, 2026-07-17)

**Objetivo:** na tela "Meus Projetos", o dono (e qualquer usuário) deixa de ver o valor R$ do projeto
no card, e o número **nem trafega** ao client — fechando a brecha do INV-02, sem tocar cálculo/Sheets.

## Decisões fechadas (via /ggsd:plan, Luis, 2026-07-17)
1. **Esconder para TODOS** nessa tela (client-only), inclusive admin. _(Admin continua vendo o R$ no
   **investigador**, que usa funções próprias — fora deste escopo.)_
2. **Não serializar:** `mapItem` devolve `ganho_total_mensal: null` — o número não chega ao navegador
   (defesa em profundidade; não dá pra ler no devtools/Network).

## Contexto do código (varredura read-only confirmada 2026-07-17)
- Badge de valor: **`src/routes/meus-projetos.tsx:708-712`** (`p.ganho_total_mensal > 0` → `fmtGanho`).
  É o **único** ponto da tela que usa `ganho_total_mensal` (grep confirma).
- Origem do dado: `mapItem` (**`src/lib/meus-projetos.functions.ts:215`**), compartilhado por
  `listarMeusProjetos` (lista) e `getMeuProjeto` (detalhe/seed de edição).
- **Seguro nular em `mapItem`:**
  - `submeter.tsx:96` só **declara** o campo no tipo do seed — nunca lê/computa (grep confirma).
  - `/projeto/$id` read-only já esconde R$ ("visão do cliente", `projeto.$id.tsx:252`).
  - **Investigador** usa `investigador.functions.ts` (não passa por `mapItem`) → admin segue vendo.
  - Banco/Sheets/analyzer usam o valor persistido (`chat.functions.ts`, `sync-reverse.ts`) — intactos.
  - **Nenhum teste** referencia `ganho_total_mensal` (grep em `tests/`).
- Invariante: **INV-02** (`SPEC.md:82`) — o submissor não vê o financeiro de saving. Hoje o card vaza
  `ganho_total_mensal` (saving + receita) ao dono. _(Nota: esconder TODO R$ vai um degrau além do
  INV-02, que fala só de saving — vira regra da tela "Meus Projetos": dono não vê R$ ali.)_

### Tarefas
- **T1 — Server: não serializar o valor.** Em `mapItem` (`meus-projetos.functions.ts:215`), trocar
  `ganho_total_mensal: p.ganho_total_mensal` por `ganho_total_mensal: null`, com comentário curto
  citando INV-02 e a decisão "esconder p/ todos" (por que o número não trafega ao client).
  (guarda: teste unitário novo em `tests/` afirma que `mapItem(...).ganho_total_mensal === null`.)
- **T2 — Front: remover o badge.** Apagar o bloco `meus-projetos.tsx:708-712` (fica morto com o campo
  sempre `null`, mas remover explicita a intenção e limpa `fmtGanho` se ficar sem uso — conferir
  `fmtGanho` em `meus-projetos.tsx:104` e remover se órfão).
  (guarda: `npm run build` compila sem “declarado e não usado”; smoke visual — card sem R$.)
- **T3 — Testes + build.** `npm run test` verde (incl. o novo teste do T1). **Sem `build:worker`**
  necessário? ⚠️ `meus-projetos.functions.ts` é server-side (importado pelo `worker.ts`) → **rodar
  `npm run build:worker` e commitar o `worker.js`** (regra 1).
- **T4 — Staging antes de prod (regra 13).** Deploy no `edf400b4`, validar no navegador (card sem R$;
  Network sem o número) → só então prod `674a3710`.

### Critérios de aceitação
1. O card de "Meus Projetos" **não exibe** nenhum valor em R$ (nem badge verde), para qualquer usuário.
2. A resposta de `/api/meus-projetos` (lista e detalhe) traz `ganho_total_mensal: null` — o número não
   aparece no payload/Network.
3. **Admin continua vendo** o ganho no **investigador** (não regrediu — funções separadas).
4. Cálculo de ganho, persistência no SQLite e sync com o Sheets **inalterados** (o valor real segue no
   banco e na planilha).
5. `npm run test` verde; `npm run build` e `npm run build:worker` OK; `worker.js` commitado.
6. Validado em **staging** antes de prod.

### Fronteiras (não exceder)
- **Não** mexer no cálculo de `ganho_total_mensal` (`chat.functions.ts`), no sync (`sync.ts`/
  `sync-reverse.ts`) nem no Sheets.
- **Não** alterar a visão do **investigador/admin** nem o `/projeto/$id` (já esconde R$).
- **Não** mexer em ownership/edição/filtros — só a exibição e a serialização do valor.

### Blast-radius
Arquivos: `src/lib/meus-projetos.functions.ts` (mapItem), `src/routes/meus-projetos.tsx` (badge) ·
Dependentes: `listarMeusProjetos`/`getMeuProjeto` (o campo vira `null` p/ ambos; seed de edição não o
usa) · Invariantes: **INV-02** (reforçado; e cria a regra "Meus Projetos não exibe R$ ao dono") ·
Confiança: **alta** (BAIXO) — 2 arquivos, ponto único, sem teste dependente, verificações feitas.
