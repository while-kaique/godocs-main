# Run 5 — TIME + auditoria · base inteira · **gravou**

`run-5.json` · 573 de 648 com nota (88%) · 0 falhas · 4h19 · 551 auditados

É o ensaio da rodada de produção: time de 5 lentes, auditoria de valor nos normais, e gravação
de recomendação em `especial_avaliacao`. **A coluna "Estrelas" não foi tocada.**

## O resultado que se sustentou em escala

A confiança por consenso, agora com n de verdade:

| confiança | run 4 (n=52) | **run 5 (n=425)** |
|---|---:|---:|
| alta | 100% (n=7) | **94% (n=64)** |
| média | 92% (n=12) | **89% (n=150)** |
| baixa | 61% (n=33) | **60% (n=211)** |

Monotônica nas duas, e a run 5 tem massa suficiente para a ordem não ser sorte. **Existe um
limiar utilizável:** alta e média se sustentam perto de 90%, baixa cai para 60% e é onde o olho
humano precisa ir primeiro.

⚠️ Lembrando o que isso mede: **aderência à planilha**, não acerto. A coluna "Estrelas" tem
procedência mista. É medida de consistência.

## O que PIOROU, e é o achado que você precisa ver

**O time esmaga o topo mais que o agente sozinho.**

| nota da planilha | agente (run 3) | **time (run 5)** |
|---|---:|---:|
| 10 | 7,00 | **4,00** |
| 8 | 5,00 | **4,00** |
| 7 | 5,00 | **4,50** |
| 5 | 3,25 | **3,00** |

O ajuste de um degrau não explica isso sozinho: quem derruba é o **piso**, e a lente estrutural
como teto. O **GoPrice foi zerado de novo** por `experimentacao`, agora com trecho citado — é o
exemplo de 4★ da própria régua, e é a segunda vez na mesma noite.

A exigência de citação **reduziu muito** o estrago: de 3 em 58 na run 4 (5,2%) para 5 em 573
(0,9%), e dos 300 projetos zerados pelo piso, **238 (79%) têm nota 0 ou 1 na própria planilha** —
ou seja, na imensa maioria ele concorda com a triagem. Mas não zerou o problema no topo.

**Isto é o que impede o time de ser promovido a decisor.** Como está, ele é excelente para
CONFIANÇA e cobertura, e pior que o agente sozinho para reconhecer projeto de alto valor.

## O resto dos números

- **Cobertura 88%** (573 de 648). O agente sozinho fez 93% na amostra; o time fez 100% em 58.
  A queda em escala pede investigação: pode ser saturação do gateway ao longo de 4h.
- **Auditoria de valor:** 551 auditados, **75 propondo ajuste** (todos para BAIXO, por trava de
  código). É a lista de revisão financeira, filtro "Valor a revisar" no artefato.
- **Contestações de estrela:** 104 projetos já avaliados divergem por 2★ ou mais.
- **302 de 573** tiveram a nota movida pelo time, sempre em um degrau.

## Para a próxima volta

1. **O piso no topo.** Citação não bastou. O caminho provável é o mesmo do escape: exigir que o
   piso seja corroborado por MAIS DE UMA lente, ou proibi-lo quando a base entrou alta.
2. **A queda de cobertura em escala** (88% contra 100% em lote pequeno).
3. **Confiança já dá para usar hoje**, mesmo sem resolver 1 e 2: filtrar por "alta" entrega
   recomendação com 94% de aderência.
