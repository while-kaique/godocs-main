# O que conta como projeto no GoDocs — recorrência · contrafactual · rastreabilidade

**Status:** rascunho para **calibrar com o Rafa** · escrito em 29/07/2026
⚠️ Esta página é a régua que o sistema passou a aplicar. **Reprovar um projeto é visível ao autor** — então
o texto abaixo deve ser validado com a gestão **antes** do deploy em produção.

## Por que existe

O GoDocs existe para **registrar e documentar** automações — não para barrar gente. Mas submissões que são
**peça única sem evidência** (o caso-símbolo: uma **nuvem de palavras** gerada uma vez para uma
apresentação) poluem a base e disputam a fila de validação com automação de verdade. A régua abaixo separa
as duas coisas com 3 perguntas.

**Projeto simples continua muito bem-vindo.** Um script de 20 linhas que roda todo dia e economiza 2h/mês é
projeto. O que não é projeto é a entrega que aconteceu uma vez e não deixou rastro. _Aprendizado não é
submissão._

## Os 3 critérios

| # | Critério | A pergunta | Reprova quando |
|---|---|---|---|
| 1 | **Recorrência** | Roda de novo **sem alguém pedir** (agendado, por evento, em uso contínuo)? | Foi feito uma vez, sob encomenda, e ninguém executa de novo |
| 2 | **Contrafactual** | Se **desligar hoje**, quem reclama e o que piora? | "Ninguém reclamaria" / "nada mudaria" |
| 3 | **Rastreabilidade** | Qual **indicador** mudou, e em qual **relatório/sistema/base** isso é verificável? | Não há indicador nomeado nem onde conferir |

**O impacto NÃO precisa ser receita.** Qualquer uma destas famílias vale, desde que recorrente e
verificável: **horas** de trabalho humano · **custo** (headcount, hora extra, contrato, licença) · **erro**
(taxa de falha, retrabalho) · **fraude/risco** evitado · **prazo/SLA** (tempo de ciclo) · **receita**.

> Nota de origem: a régua anterior do sistema só aceitava impacto do tipo "o time entrega **mais**", e por
> isso **rejeitava** quem informava "gasta-se **menos**" (redução de 3 auxiliares, corte de hora extra) —
> medido em 24 conversas reais de produção, esse defeito custou 13 reperguntas
> ([analise-perguntas-agente.md](analise-perguntas-agente.md), achado A1). A taxonomia acima existe para
> corrigir isso: **menos custo** é resposta válida.

## Resposta vaga × resposta aceitável

| Critério | ❌ Vaga (não fecha o critério) | ✅ Aceitável |
|---|---|---|
| Recorrência | "roda automaticamente", "é executado sempre que preciso" | "roda todo dia às 7h, disparado por schedule no n8n" · "dispara a cada pedido novo, ~400/mês" |
| Contrafactual | "o time sentiria falta", "seria ruim" | "o Fiscal reclama no mesmo dia: o fechamento volta a ser feito à mão em 2 planilhas e atrasa a contabilidade" |
| Rastreabilidade | "dá para ver no sistema", "os números melhoraram" | "painel *Conciliação diária* no Metabase" · "relatório de horas do Protheus" · "base `pedidos_cancelados`" |
| Impacto | "o tempo foi realocado para outras atividades" | "as 3 horas/dia foram para hunting e entrevistas — o time passou a fazer 2-3 entrevistas a mais por dia" |

## Exemplos reais (o que passa e o que não passa)

**Recorrência**
- ✅ **Passa** — "Classificação Automática de NPS" (`62b60c15`): roda em agenda diária, sobre o fluxo de
  respostas que continua entrando.
- ❌ **Não passa** — **nuvem de palavras** feita uma vez a partir das respostas de uma pesquisa, para uma
  apresentação. Rodou, entregou, encerrou.

**Contrafactual**
- ✅ **Passa** — corte de hora extra (`60b97477`) e redução de 3 auxiliares (`e57b287a`): desligar devolve
  a despesa na folha do mês seguinte — alguém reclama, e dá para apontar quem.
- ❌ **Não passa** — planilha/cronômetro montado para medir uma atividade numa ocasião específica: se
  desaparecer, ninguém percebe.

**Rastreabilidade**
- ✅ **Passa** — projetos que nomeiam o relatório onde o número aparece (fechamento, conciliação, base de
  pedidos): quem valida abre e confere.
- ❌ **Não passa** — automação em produção há meses, com ganho descrito de forma convincente, mas sem saber
  dizer **onde** conferir → **zona cinzenta**, não reprovação: vai para validação humana.

## Como o sistema aplica (resumo)

1. Na **Etapa 2** do formulário o autor responde: *"moveu o ponteiro de quê?"* (custo · receita · KPI ·
   **nenhum/ainda não sei**), *"onde isso pode ser verificado?"* e *"se desligar hoje, quem reclama?"*.
   ⚠️ **Nada disso barra a submissão** — "nenhum / ainda não sei" é resposta válida e passa.
2. O **agente** registra no memorial a seção **"Processo alterado"** (o que mudou e quanto) — e **não**
   pergunta quando a documentação aprovada já traz a magnitude.
3. **Depois do envio**, o analisador classifica em **claro sim · zona cinzenta · claro não**, **sempre
   explicando o porquê** (coluna `Classificação` da planilha).
4. **Claro não** → status **`Reprovado`** + `Motivo Reprovado` (texto escrito para o autor ler, que ele vê
   na tela do projeto). **Zona cinzenta** → validação humana. **Claro sim** → segue o fluxo normal.
5. **A triagem humana sobrepõe qualquer decisão** no `/dashboard`.

## Salvaguardas (o que o sistema NUNCA faz)

- **Nunca reprova sem motivo** — sem texto de motivo, a reprovação é rebaixada para zona cinzenta.
- **Nunca reprova projeto especial** (a rota de alto impacto sem mensuração objetiva continua válida).
- **Nunca reprova sozinho acima de R$ 5 mil/mês** de impacto — vai para decisão humana.
- **Nunca reprova por simplicidade, tamanho ou valor baixo.**
- **Na dúvida, zona cinzenta** (a instrução dada ao analisador é explícita).

## O que ainda depende de decisão da gestão

1. **Calibrar a fronteira** claro não × zona cinzenta: hoje a instrução é conservadora (reprova só quando
   falta recorrência **e** evidência). Apertar ou afrouxar é decisão de produto.
2. **Projeto pontual legítimo** (uma migração que rodou uma vez e resolveu um problema real): a régua atual
   o aceita quando há evidência. Confirmar se é isso que a gestão quer.
3. **Barrar submissão no formulário continua FORA** — a decisão é sempre pós-envio.
