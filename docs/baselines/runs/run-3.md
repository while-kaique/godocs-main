# Run 3 — agente + RAG + auditoria de valor · amostra fixa de 196

`run-3.json` · 182 de 196 com nota (93%) · 30 min · dry

## Por que ela substituiu o time no cronograma

A run 2 perdeu 65% da base por bug de parse, então não havia linha de base válida do agente.
Comparar o time contra ela mediria o meu bug, não o ganho das lentes. A run 3 é essa linha de
base, na amostra estratificada que as próximas repetem.

## O que o RAG fez, e é o achado da rodada

A run 1 comprimia tudo para perto de 1: inflava o piso e esmagava o topo. Com os vizinhos
funcionando, a escala voltou.

| nota da planilha | agente run 1 | agente run 3 |
|---|---:|---:|
| 0 | 0,77 | **0,45** |
| 3 | 2,33 | **2,50** |
| 10 | 6,00 | **7,00** |

E o viés virou equilíbrio: **38 acima × 44 abaixo**, contra 200 × 59 na run 1.

⚠️ A amostra é estratificada, com as faixas altas super-representadas de propósito, então o
"idêntica 42%" **não** se compara com os 47% da run 1, que rodou a base inteira. O que se
compara é a tabela por faixa acima, e a distribuição, que agora chega a 6★, 7★ e 8★.

## Três defeitos que esta rodada revelou

1. **Corrida na auditoria de valor.** Ela escrevia em `linhas[linhas.length-1]`, e com 8 workers
   o "último" não é o meu. Resultado: auditoria em **4 projetos de 137**, calada. Agora escreve
   na referência da própria linha.
2. **O auditor não sabia qual número julgar.** O dossiê traz os valores do SQLite e a planilha
   traz o declarado; no `legado-041` a planilha diz R$ 976,39 e a conta do memorial dá
   R$ 1.952,77. Ele parecia estar SUBINDO o valor quando falava de outro número. O declarado
   agora vai explícito, e sugestão acima dele é descartada em código, não confiada ao prompt.
3. **⚠️ O maior: a ponderação da régua v2 virava "discrepância".** Medido: **503 de 593
   aprovados (85%) têm o Líquido em exatamente metade do Bruto**, porque
   `PESO_CUSTO_EVITADO = 0,5` — custo evitado é despesa que nunca nasceu, sem extrato, e vale
   metade. O auditor comparava a aritmética crua do memorial com o Líquido ponderado e concluía
   "está 50% abaixo", em 85% da base. Uma lista de revisão em que 85% dos itens são a régua
   funcionando não é lista de revisão, é ruído com cara de achado — e era o que eu ia entregar.
   O contexto agora traz Bruto, Líquido e a regra dos pesos.

Depois do conserto, o `legado-027` passou a CONFIRMAR o declarado (R$ 161,70 → R$ 161,70)
refazendo a conta, em vez de acusar falta.

## Ainda em aberto

- **14 de 196 sem nota** (7%). Caiu de 65% na run 2, mas não é zero.
- **Confiança quase toda "baixa"** (137 de 182). Nesta rodada ela é a AUTODECLARADA pelo modelo,
  porque o consenso entre lentes só existe no caminho do time. As próximas medem a de verdade.

## A medição da confiança — e ela reprova

Aderência dentro de ±1 da nota da planilha, por faixa de confiança **autodeclarada pelo modelo**:

| confiança | n | dentro de ±1 |
|---|---:|---:|
| alta | 23 | 78% |
| média | 12 | 58% |
| **baixa** | 107 | **80%** |

**"Baixa" adere MAIS que "alta".** A confiança que sai do próprio modelo não é só pouco
informativa: nesta amostra ela está levemente INVERTIDA. Qualquer limiar construído em cima dela
seria pior que sortear — e limiar de confiança é exatamente o que se queria usar para decidir o
que a triagem olha primeiro.

Isso não é surpresa e já tinha precedente medido neste repo (T1: o modelo se declarou "alta" em
456 de 484). É a razão de a confiança do time vir do CONSENSO — as 5 lentes divergindo entre si
e a base discordando das lentes — em vez da autodeclaração. A run 4 é o primeiro teste dessa
versão, e a pergunta é a mesma: **"alta" adere mais que "baixa"?** Se não aderir, o problema não
é o método de derivar, é a premissa de que dá para saber a certeza sem gabarito.
