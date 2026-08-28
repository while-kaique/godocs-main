# NEXT-SESSION

## Plano ativo
`docs/plans/agentes-avaliacao-autonomos.md` (fatia A executada) + `docs/plans/submissao-doc-fora-do-caminho-critico.md` (Frente 1 executada). **Nenhum plano novo aberto** — o próximo passo é CÓDIGO de UI, não planejar.

## O que esta sessão fez (28/08/2026)
Deploy do **time de agentes em prod, modo SOMBRA VISÍVEL** (decisão do Luis: medir+ver, NÃO autônomo) + **Frente 1 (doc async)** junto.
- Integrei `feat/agentes-avaliacao-teamc` (A+B+C) + `feat/submissao-doc-async` sobre `origin/main` (bc09004) nesta branch `integ/agentes-avaliacao-prod` (@99d2ef9). O teamc já continha o rollup/áreas do JG — nada perdido.
- **2078 testes verdes**, `worker.js` + `dist` rebuildados e commitados. CLAUDE.md sem conflito.
- Verificado no código: veredito do agregador = `aprovar | em_validacao | isento` (NUNCA auto-reprova; "mandar pra RPA" = `em_validacao`). B/C só gravam `projeto_avaliacao` (sombra). Fatia A/FTE muda status conservador, ligada por default.

## Próximo passo
**Construir a superfície de visualização "Agente" no `/dashboard`** (coluna na tabela + bloco na ficha, lendo `projeto_avaliacao` via mapa lateral por id — padrão `/especiais`). Pontos de injeção exatos (file:line) na memória `deploy-time-agentes-sombra-visivel.md`. Depois: setar flags (`AVALIACAO_NORMAIS=1`, `AVALIACAO_REDATOR=1`, `DOC_COMPILE_ASYNC=1`, `DOC_MECANICO_MODEL=gpt-5.6-luna`, `DOC_MECANICO_EFFORT=low`) → criar crons (`avaliar-normais`, `deliberar-avaliacoes`, `avaliacao-retroativa`) → **STAGING `edf400b4` PRIMEIRO** (regra 13) → prod `674a3710` → merge main (regra 14).

## Pendências / ressalvas
- Superfície `/dashboard` ainda NÃO codada — é a fatia em aberto.
- Deploy ainda não tocou staging nem prod. Cookie da staging em `~/godocs-main/.env` (`E2E_COOKIE`).
- ⚠️ worker STALE morde no Godeploy — exigir sinal de RUNTIME nos logs após deploy.
