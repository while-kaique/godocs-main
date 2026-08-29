# NEXT-SESSION

## Plano ativo
`docs/plans/mesa-avaliacao-parecer-raciocinado.md` — mesa de avaliação de eco-de-gate a auditor raciocinado (escopo B, time LLM em SOMBRA). **Em execução via /ggsd:code.**

## O que esta sessão fez (28/08)
- **T2 concluído e commitado** (`772d423`, branch `feat/mesa-parecer-raciocinado`): nova função pura `agregarJulgamentos` em `src/lib/agents/agregador-avaliacao.ts` — chair sobre os `JulgamentoEspecialista[]` do T1. **Confiança = concordância direcional × confiança média** dos especialistas, matando o degrau fixo 0.85 e dando efeito real ao limiar (consenso inseguro → em_validacao). `agregarVotos` determinístico preservado byte-a-byte (dependentes: retroativa/avaliacao-normais).
- Verde: `tests/agregador-julgamentos.test.ts` 11 RED→verde; suíte **2267**; `tsc` sem erro novo (7 pré-existentes).
- **§9 fechada, sem bloqueio:** conformidade `conforme` 0.9; qualidade `sugestoes` 0.86. 1 achado baixo não aplicado (quórum n=1, inócuo em sombra) → decidir no T5.

## Próximo passo
**Codar T3 — deliberação multi-rodada (via /ggsd:code):** `MAX_RODADAS_DELIBERACAO` 2→5 em `deliberacao.ts`; o reducer passa a reagir a **argumento novo** por rodada (o cron vê os pareceres/objeções da rodada anterior e refina); para por consenso de qualidade ou esgota 5 → humano. ⚠️ **Persistir histórico por rodada:** trocar `upsertDeliberacao` de SOBRESCREVER para **APPEND** (parecer + confiança de cada rodada), sem `SELECT historico` em lote (teto 32 MiB RPC). RED primeiro.

## Pendências / avisos
- Revisão §9 do T2 **já rodou e passou** — envio (`/ggsd:ship`) não barra por isso. A feature NÃO fechou (faltam T3→T7), então o próximo é a próxima sessão de código, não o ship.
- **Alerta para o T5:** `voto.motivo` no prompt não pode carregar tarifa valor/hora oculta; e decidir o piso de quórum (só `aprovar` se n≥2 / n==painel) se a mesa sair da sombra ou receber painel parcial.
- Ordem restante: T3 → T4 (materialidade `saving+receita/10`, NÃO tocar `analyzer.ts:847`) → T5 (fiar os agentes) → T6 (UI rodadas) → T7 (retroativo = rede) → build:worker/staging/prod/PR.
