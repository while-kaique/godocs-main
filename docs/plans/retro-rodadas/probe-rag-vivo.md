# Retroativo probe-rag-vivo

Amostra: 12 projetos. Modelo: gpt-5.6-luna (especialistas) + gpt-5.6-sol (estrela, cético). Variante: probe: RAG VIVO (chave de embeddings corrigida) vs achatamento. Total comparado: 12.

## Gabarito
| Gabarito | Projetos |
|---|---|
| nota_humana | 4 |
| status_assentado | 3 |
| nao_auditado | 5 |
| fora | 0 |

## Saídas do time
| Saída | Projetos |
|---|---|
| aprovar | 0 |
| ajuste | 0 |
| humano | 8 |
| reprovar | 4 |

Humano: 66.7% dos projetos.

## Mérito (saída do time × Status humano)
| Balde | Projetos |
|---|---|
| acerto | 2 |
| conservador | 4 |
| erro grave | 0 |
| reprovação indevida | 0 |
| sem base | 6 |

Acurácia de mérito: 33.3%.
Por veredito: aprovar sem medição; ajuste sem medição.

## Estrelas
| Nota | Time | Humano | Escape (time) |
|---|---|---|---|
| 0 | 12 | 5 | |
| 1 | 0 | 1 | |
| 2 | 0 | 1 | |
| 3 | 0 | 1 | |
| 4 | 0 | 1 | |
| 5 | 0 | 0 | |
| 6+ | 0 | 0 | 0 |

Comparáveis: 7. Exato: 42.9%. Dentro de 1: 57.1%. Viés (time menos humano): -1.43.
Achatamento: SUSPEITO (4 quedas). Calibragem: achatado.

## Valor
Auditados: 0. Absurdos: 0.

## Alertas
- Achatamento suspeito: 100% das quedas caem no mesmo nível 0. Revisar a régua antes de aceitar qualquer queda (D12).
- Lote achatado: 100% até 3 estrelas e 0% acima.
- Saída humano em 67% dos projetos: acima do teto de 10%, humano tem de ser exceção.

## Contestações
- nenhuma

Custo estimado: 0.00 USD. Tokens: {}. Duração: 2.0 min.

## Projetos
| Projeto | Área | Esp | Humano | Time | Estrela H | Estrela T | Conf | Mérito |
|---|---|---|---|---|---|---|---|---|
| Report Semanal CX | CX |  | Aprovado | humano | 2 | 0 | media | conservador |
| Governança tecnologia Gobeaute | TECNOLOGIA |  | Pendente | humano |  | 0 | media | sem_base |
| Prazo Otimizado | TRANSPORTES | sim | Aprovado | humano | 4 | 0 | media | conservador |
| [R&S]DASH ACOMPANHAMENTO DIÁRIO | Gente e Gestão |  | Reprovado | reprovar | 0 | 0 | media | acerto |
| Programa de Indicação | Gogroup | Gente e Gestão | sim | Reenvio Pendente | humano | 1 | 0 | media | sem_base |
| Automação de Relatório de Malas | PRODUTO |  | Aprovado | humano | 0 | 0 | media | sem_base |
| Fluxo de Caixa FIP Gobeauty | FINANÇAS |  | Pendente | reprovar |  | 0 | media | sem_base |
| Automação da extração mensal de reenvios | CX |  | Reprovado | reprovar | 0 | 0 | media | acerto |
| Ferramenta de comentar nos posts | GROWTH | sim | Aprovado | humano | 3 | 0 | media | conservador |
| Alerta Conversão v3 — Funil + Canal Dedi | DADOS |  | Aprovado | humano | 0 | 0 | media | conservador |
| Envio de contratos para assinatura autom | GROWTH |  | Reprovado | reprovar | 0 | 0 | media | sem_base |
| Alertas de correções do Contas a Pagar e | FINANÇAS |  | Pendente | humano |  | 0 | media | sem_base |