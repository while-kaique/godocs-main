# NEXT-SESSION

## Plano ativo
`docs/plans/mesa-avaliacao-parecer-raciocinado.md` — mesa de avaliação de eco-de-gate a auditor raciocinado (escopo B, time LLM em SOMBRA). **Em execução via /ggsd:code.** T1–T4 concluídos e commitados (`da9dda1`); **T5 em andamento (ponte pura pronta, fiação pendente).**

## O que esta sessão fez (29/08) — T5 começou: ponte pura verde
- **Peça PURA nova `src/lib/agents/mesa-especialistas.ts` + `tests/mesa-especialistas.test.ts` (9/9 verde), suíte cheia 2284 verde** (2275 + 9):
  - `montarEntradasEspecialistas(votos, texto, vizinhosTexto)` — transforma os 4 votos determinísticos (fte/financeiro/rag/cetico) em `EntradaEspecialista[]`: cada especialista recebe o próprio voto como INPUT + os outros 3 em `outrosVotos`. `confiancaFte = implausivel?0.2:0.9` (espelha `agregarVotos`).
  - `conciliarJulgamentos(julgamentos, {especial,fluxoDireto,limiar?})` — delega a `agregarJulgamentos` (T2) + `grau`=`grauConfianca` + `ceticoRefutou`=cético `.preocupa` → `ResultadoConciliado`.
- **Ainda NÃO fiado** no orquestrador — a ponte existe mas não é chamada por ninguém em produção.

## Próximo passo
**T5 (fiação) — chamar a ponte no `src/lib/avaliacao-normais.functions.ts`**, gated por `especialistasMesaLlmLigados()` (OFF → byte-idêntico à sombra determinística de hoje, que roda em prod). Design detalhado no memory `mesa-avaliacao-qualidade-parecer.md` (seção "T5 EM ANDAMENTO"), resumo:
1. `computarVotos`: se `especialistasMesaLlmLigados()` → montar `TextoProjeto` (via `montarEntradaSemanticaNormal`, `?? ''`) + `vizinhosTexto` (`v.nome — v.area`) → `julgamentos = await Promise.all(entradas.map(julgarComEspecialista))` (nunca lança) → `conciliadoEfetivo = conciliarJulgamentos(...)`. OFF → determinístico intacto.
2. `VotosPainel` += `julgamentos?` + `ceticoRefuta` (efetivo). `serializarVotos` += julgamentos enxuto (sem `argumento`/R$).
3. `avaliarComContexto`: redator só quando `!especialistasMesaLlmLigados()`; deliberação sinal + historico motivo = parecer LLM quando ligado.
4. `avancarDeliberacoesPendentes`: idem (sinal `ceticoRefuta`, historico = parecer da rodada).
5. RED→verde (mockar LLM), suíte cheia, §8.1(faixa) + §9 revisores, `build:worker`.

## Pendências / avisos
- **Revisão §9 do incremento desta sessão NÃO rodou** (a ponte pura é auto-contida e não fiada, então não muda comportamento em prod) — mas ela roda junto com a fiação do T5, que é mudança de comportamento. `/ggsd:ship` **vai barrar** até §9 do T5 fechar.
- **Byte-idêntico obrigatório com `AVALIACAO_MESA_LLM` OFF** — prod roda `AVALIACAO_NORMAIS` ON em sombra determinística; a fiação não pode alterar isso.
- **Alerta T5:** `voto.motivo` no prompt não pode carregar tarifa valor/hora oculta; sem R$ cru no payload.
- Ordem restante: **T5 (fiação, §9)** → T6 (UI rodadas: parar `montarAvaliacaoSombra` de descartar historico) → T7 (retroativo = rede) → staging (`edf400b4`)/prod (`674a3710`)/PR (`LuisEduardo100`).
