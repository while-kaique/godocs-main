# Retroativo probe-time-estrela

Amostra: 3 projetos. Modelo: gpt-5.6-luna (especialistas) + gpt-5.6-sol (estrela, cético). Variante: probe: tempo/custo por projeto do TIME inteiro. Total comparado: 3.

## Gabarito
| Gabarito | Projetos |
|---|---|
| nota_humana | 2 |
| status_assentado | 1 |
| nao_auditado | 0 |
| fora | 0 |

## Saídas do time
| Saída | Projetos |
|---|---|
| aprovar | 0 |
| ajuste | 0 |
| humano | 2 |
| reprovar | 1 |

Humano: 66.7% dos projetos.

## Mérito (saída do time × Status humano)
| Balde | Projetos |
|---|---|
| acerto | 1 |
| conservador | 2 |
| erro grave | 0 |
| reprovação indevida | 0 |
| sem base | 0 |

Acurácia de mérito: 33.3%.
Por veredito: aprovar sem medição; ajuste sem medição.

## Estrelas
| Nota | Time | Humano | Escape (time) |
|---|---|---|---|
| 0 | 3 | 1 | |
| 1 | 0 | 0 | |
| 2 | 0 | 1 | |
| 3 | 0 | 0 | |
| 4 | 0 | 1 | |
| 5 | 0 | 0 | |
| 6+ | 0 | 0 | 0 |

Comparáveis: 3. Exato: 33.3%. Dentro de 1: 33.3%. Viés (time menos humano): -2.00.
Achatamento: SUSPEITO (2 quedas). Calibragem: achatado.

## Valor
Auditados: 0. Absurdos: 0.

## Alertas
- Achatamento suspeito: 100% das quedas caem no mesmo nível 0. Revisar a régua antes de aceitar qualquer queda (D12).
- Lote achatado: 100% até 3 estrelas e 0% acima.
- Saída humano em 67% dos projetos: acima do teto de 10%, humano tem de ser exceção.

## Contestações
- nenhuma

Custo estimado: 0.00 USD. Tokens: {}. Duração: 0.7 min.

## Projetos
| Projeto | Área | Esp | Humano | Time | Estrela H | Estrela T | Conf | Mérito |
|---|---|---|---|---|---|---|---|---|
| [R&S]DASH ACOMPANHAMENTO DIÁRIO | Gente e Gestão |  | Reprovado | reprovar | 0 | 0 | baixa | acerto |
| Prazo Otimizado | TRANSPORTES | sim | Aprovado | humano | 4 | 0 | baixa | conservador |
| Report Semanal CX | CX |  | Aprovado | humano | 2 | 0 | baixa | conservador |