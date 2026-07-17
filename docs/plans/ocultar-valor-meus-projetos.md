# Plano — Ocultar o valor (R$) do projeto nos cards de "Meus Projetos"
**Status:** rascunho (a aprovar via /ggsd:plan) — capturado 2026-07-17 (ADR-028 captura-e-adia)

**Pedido (Luis):** na tela **"Meus Projetos"**, remover a exibição do **valor em R$** do projeto no card
(badge verde tipo "R$ 1.020,00/mês"). O usuário não deve ver o valor financeiro ali.

## Contexto do código (varredura read-only 2026-07-17)
- O badge de valor é renderizado em **`src/routes/meus-projetos.tsx:708-712`**:
  ```tsx
  {p.ganho_total_mensal != null && p.ganho_total_mensal > 0 && (
    <span className="font-semibold" style={{ color: "#16a34a" }}>
      {fmtGanho(p.ganho_total_mensal)}
    </span>
  )}
  ```
- Formatador `fmtGanho` em **`meus-projetos.tsx:106`** → `"R$ …/mês"`.
- O dado vem de `p.ganho_total_mensal`, servido por `listarMeusProjetos`/`mapItem`
  (`src/lib/meus-projetos.functions.ts:26/73/215`).
- ⚠️ Alinha com **INV-02** (submissor não vê o financeiro de saving) — hoje há uma brecha: o card mostra
  `ganho_total_mensal` (que inclui saving/receita) na visão do próprio dono.

## Decisões a confirmar no /ggsd:plan (perguntar ao Luis)
1. **Esconder para TODOS** nessa tela, ou **só para não-admin** (admin/equipe RPA continua vendo)?
   _(a tela é a visão do dono; INV-02 sugere esconder do submissor. Provável: esconder para todos os
   não-admin; admin talvez mantenha.)_
2. Some **só o badge de R$** (mantém área + data + status) — confirmar que nada mais exibe R$ no card.
3. Verificar se o valor aparece em **outro lugar** da mesma tela (ex.: tooltip, filtro, aba) e no
   `/projeto/$id` read-only (a tela read-only já esconde R$ de saving — conferir receita/ganho_total).

## Escopo provável (client-only)
- Remover/gate o bloco `meus-projetos.tsx:708-712` (e talvez parar de enviar `ganho_total_mensal` ao client
  em `meus-projetos.functions.ts` se a decisão for esconder de todos — evita vazar o número no payload).
- Se for "só não-admin": usar o `isAdmin` já disponível na tela (conferir como `meus-projetos.tsx` sabe se é
  admin).
- **Guarda:** smoke — card sem o R$; teste se `mapItem`/serialização mudar. Staging antes de prod (regra 13).

## Fronteiras
- Não mexer no cálculo de ganho nem no Sheets; é só exibição (e, no máximo, não serializar o campo ao client).
- Não alterar a visão do **investigador/admin** fora do que a decisão 1 definir.
