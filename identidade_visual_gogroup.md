# Identidade visual Gogroup · onde ela mora agora

Este arquivo deixou de ser o guia. Ele era uma extração do **render** de um template institucional, não do Brandbook, e por isso carregava a paleta errada (azul `#0059A9` no lugar do oficial `#2659a5`) e não tinha metade da marca: acentos, régua de contraste, regras de logo e grafia.

## A fonte agora é a skill `gogroup-design`

| Onde | O quê |
|---|---|
| `~/.claude/skills/gogroup-design/SKILL.md` | Régua de **decisão**: paleta oficial, contraste aprovado/reprovado, tipografia, forma, checklist pode/não pode |
| `…/references/brandbook.md` | Brandbook Oficial 2026 completo (58 páginas) |
| `…/references/tokens.css` | Custom properties oficiais |
| `…/references/componentes.css` | Componentes-assinatura da marca |
| `…/references/impeccable.md` | Como alimentar o Impeccable |

A skill dispara sozinha em tarefa de UI. Para chamar à mão: `/gogroup-design`.

## O que vale para ESTE repositório

**[`DESIGN.md`](DESIGN.md)** descreve o GoDocs como ele é hoje (tokens reais, vocabulário `.go-*`, componentes de domínio) e lista, no fim, as **divergências conhecidas** entre o que está no `styles.css` e o Brandbook.

**[`PRODUCT.md`](PRODUCT.md)** descreve quem usa, em que modo e com que voz.

Os dois são o contexto que o [Impeccable](https://impeccable.style/docs/) lê antes de cada comando.

## A divergência que ainda é decisão aberta

O `styles.css` usa `--go-blue: #0059A9`; o Brandbook manda `#2659a5`. Trocar repinta a aplicação inteira, então é decisão de produto, não refactor. Enquanto não for decidido, **o valor que está no código é o que vale para o GoDocs** e a divergência fica registrada no `DESIGN.md`.

> Regra 11 do `CLAUDE.md` (invocar a skill antes de codar UI) segue valendo. O que mudou é qual skill: `gogroup-design` para a marca, `frontend-design` para direção estética.
