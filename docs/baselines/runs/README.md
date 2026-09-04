# Rodadas de calibragem das estrelas

Cada run deixa **dois** arquivos aqui, e os dois são entrega:

| arquivo | o que é |
|---|---|
| `run-N.json` | o relatório cru: uma linha por projeto, com nota, leitura, confiança e, no time, a nota de cada lente e o ajuste aplicado |
| `run-N.md` | o **log da calibragem**: o que mudou em relação à run anterior, o que eu conclui lendo os casos, e o que ajustei antes da próxima |

> ⚠️ **O log é tão entrega quanto a nota.** O ajuste fino só é possível se cada volta deixar
> rastro do que foi mudado e por quê. Sem isso, duas rodadas depois ninguém sabe se a régua
> melhorou ou se o modelo teve um dia bom, e a calibragem vira chute com número.

## O que a "aderência" mede, e o que ela NÃO mede

A coluna "Estrelas" da planilha tem **procedência mista**: parte foi cravada por gente na
triagem, parte foi escrita em lote por um agente em rodadas anteriores. Medido em 04/09/2026:
dos 62 especiais com estrela, **19 batem exatamente com a recomendação gravada do agente** e 43
divergem; e as 459 notas de projetos NORMAIS não passaram pelo app (o log de atividades tem 12
ações de estrela no total).

Por isso o relatório fala em **aderência à planilha**, nunca em acerto. É medida de
consistência, e serve para ver se uma mudança de régua desloca a base em bloco. **Não é
gabarito.** O corpus de julgamento humano é o que estas rodadas estão construindo.

## Invariantes das rodadas

- Nenhuma run escreve na **planilha**. A coluna "Estrelas" só muda por clique humano.
- Runs de ensaio não gravam nada. A run final grava **recomendação** em `especial_avaliacao`,
  com a origem marcada, e é reversível.
- `EMBEDDINGS_SOMENTE_LEITURA=1` durante as rodadas: chamada de LLM vai pelo ai-proxy e é
  barata; embedding vai direto na OpenAI e se paga por chamada.
- Falha de chamada vira **relatório**, nunca nota. 502 é "ninguém perguntou", não "nota baixa".
