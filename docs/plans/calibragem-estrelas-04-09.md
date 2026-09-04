# Calibragem das estrelas — noite de 03 para 04/09/2026

> Ensaio antes de rodar em produção. **Nada aqui escreveu na planilha.** Os logs de cada rodada
> estão em `docs/baselines/runs/`, e a página com todas elas é o artefato "Estrelas da Base".

## O que estas rodadas eram para fazer

Achar defeito, deixar o RAG com cobertura, melhorar a análise dos agentes e fazer a confiança
significar algo. **Não** produzir um número bonito.

## Os defeitos encontrados, em ordem de gravidade

Todos apareceram RODANDO, nenhum lendo código.

| # | defeito | como apareceu | efeito |
|---|---|---|---|
| 1 | **Parse descartava resposta boa** | run 2 perdeu **418 de 648 (65%)** com "0 falhas" no relatório | os 8 primeiros que falharam foram de **0/8 para 8/8** depois do conserto |
| 2 | **Ponderação da régua lida como erro** | auditor acusava "50% abaixo" em **85% da base** | era `PESO_CUSTO_EVITADO = 0,5` funcionando; a lista de revisão seria 85% ruído |
| 3 | **RAG sem cobertura** | especial recebia 6 vizinhos, normal recebia **0** | o mapa de exemplares só tinha os 59 especiais, descartando 459 normais com nota |
| 4 | **Id de legado invisível** | 30 aprovados fora de toda rodada | e o dossiê dos demais nascia truncado, em silêncio |
| 5 | **Time decidindo sozinho oscilava 6★** | PIAPP deu 2, 5, 3, 7, 8 e 3 em seis chamadas iguais | virou ajuste de um degrau sobre a base: 8, 8, 8 |
| 6 | **Corrida na auditoria** | auditoria em 4 de 137 projetos, calada | escrevia em `linhas[último]` com 8 workers |
| 7 | **Auditor não sabia o número julgado** | parecia SUBIR valores | auditava o SQLite e era comparado contra a planilha |
| 8 | **Leitura de tabela duplicada** | duas leituras de `especial_avaliacao` por projeto | latência no caminho quente |

## O que melhorou, medido

**A compressão para perto de 1 desfez-se** quando o RAG passou a entregar vizinhos:

| nota da planilha | agente run 1 | agente run 3 |
|---|---:|---:|
| 0 | 0,77 | **0,45** |
| 3 | 2,33 | **2,50** |
| 10 | 6,00 | **7,00** |

Viés: **38 acima × 44 abaixo** na run 3, contra **200 × 59** na run 1.

E o caso que abriu a investigação, o Prisma, saiu de **0★ para 5★** — que é a nota da planilha —
assim que ele passou a ter o PIAPP e o VERSTA como vizinhos. A contradição "PIAPP cita o Prisma
mas o Prisma não pontua" era cobertura de índice, não critério.

## O que NÃO se resolveu

- **A confiança autodeclarada está invertida**: aderência de 78% na faixa "alta" contra **80% na
  "baixa"**. Um limiar em cima dela seria pior que sortear. A versão por consenso é a aposta, e a
  run 4 é o primeiro teste dela.
- **A "aderência" não é acurácia.** A coluna "Estrelas" tem procedência mista: 19 dos 62
  especiais com estrela batem exatamente com a recomendação gravada do agente, e as 459 notas de
  normais não passaram pelo app. Medimos consistência, não acerto. O corpus de julgamento humano
  é o que estas rodadas constroem.
- **~7% ainda voltam sem nota** na run 3. Caiu de 65%, não é zero.

## Para você decidir de manhã

1. **Apagar o secret `EMBEDDINGS_SOMENTE_LEITURA`** do app `674a3710`. Enquanto existir, especial
   novo submetido não ganha vetor.
2. **A branch está em prod e não no `main`.** Regra 14 do CLAUDE.md.
3. **O custo do time por projeto** (medido na run 4) diz se ele cabe no fluxo de submissão ao
   vivo ou se fica como auditoria em lote.
