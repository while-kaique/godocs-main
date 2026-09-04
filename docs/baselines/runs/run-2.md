# Run 2 — agente + RAG restaurado · **INVÁLIDA COMO MEDIDA**

`docs/baselines/runs/run-2.json` · 648 projetos · 66 min · 04/09/2026 04:20 UTC · dry

## O que ela é

**Não é uma medida da régua. É a evidência de um bug meu.** Das 648 chamadas, **418 (65%)
voltaram sem nota**, e o relatório fecha com **0 falhas** — porque o servidor respondeu
`ok:false`, não deu erro. Uma rodada que perde dois terços da base e ainda se declara sem falha
é pior que uma rodada que quebra: ela parece um resultado.

Fica arquivada COMO ESTÁ. Refazer por cima apagaria a evidência.

## A causa, em três camadas

O formato de saída do LLM não é garantido (Structured Outputs está morta no proxy), e eu tinha
três defeitos empilhados no parse:

1. **A ordem do guard de eco.** O prompt manda `PROJETO A AVALIAR: {"projeto": {...}}` e o modelo
   devolve o projeto JUNTO com a resposta. Eu rejeitava pela mera presença da chave `projeto`,
   exigindo a chave canônica. `{"projeto": {...}, "recomendacao": 3}` virava falha **por uma
   chave a mais**.
2. **A lista fechada de apelidos.** Prod devolveu `{"projeto":"Robo subir vídeos","nota_recomendada":5}`
   e `nota_recomendada` não estava na lista. Caçar apelido um a um é jogo perdido contra um
   formato que não é garantido. Virou régua: nome de chave que fale de nota/estrela/recomendação
   **e** valor dentro da escala. As duas condições juntas impedem um `notas_dos_vizinhos: 12` de
   virar a estrela do projeto.
3. **Onde procurar.** Eu olhava o topo e três chaves escolhidas a dedo; o modelo aninha onde
   quer, inclusive dentro do `projeto` ecoado. Agora procura em todo objeto um nível abaixo.

E uma quarta coisa, que não é parse: **a falha é ESTOCÁSTICA.** O `legado-031` respondeu no
formato canônico numa chamada e ecoou a entrada na seguinte, com minutos de diferença. Entrou
uma segunda tentativa quando a resposta vem inutilizável, que é o padrão que o `orchestrator.ts`
já usa neste repo.

**Verificação:** os 8 primeiros projetos que falharam na run 2 saíram de **0 de 8** para **8 de
8** depois dos quatro consertos.

## O que dá para aproveitar

Dos 230 que responderam, e sempre lembrando que a amostra é enviesada (respondeu quem calhou de
formatar certo):

| | run 1 | run 2 (parcial) |
|---|---:|---:|
| idêntica à planilha | 47% | 58% |
| dentro de ±1 | 76% | 78% |
| agente acima × abaixo | 200 × 59 | 51 × 23 |

A compressão para perto de 1 diminuiu: no run 1 a nota média do agente para "planilha 0" era
0,77 e agora é 0,63, e a faixa alta parou de ser esmagada em bloco (aparecem 7★ e 8★). Isso é
compatível com o RAG restaurado dando escala, mas **não confirmo com esta rodada**: com 65% da
base ausente, qualquer número aqui é sugestão, não medida.

## Mudança de plano para a run 3

A run 3 deixa de ser o time e passa a ser **o agente + RAG na amostra fixa de 196**, que é a
medida que a run 2 deveria ter dado e não deu. Sem uma linha de base válida do agente, comparar
o time contra ela mediria o bug do parse, não o ganho das lentes.

Sequência revista: **3** agente na amostra · **4** time na MESMA amostra · **5** time na base
inteira, gravando.
