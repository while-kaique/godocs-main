# GoDocs v2 → Gomoon: o que muda do lado de lá (item 5.8)

> **Público:** quem mantém o [`rpa-ia-gogroup/gomoon`](https://github.com/rpa-ia-gogroup/gomoon).
> **Status (03/09/2026):** o lado do GoDocs está codado na branch `feat/categoria-aglutinacao`
> (sobre `feat/godocs-v2`) e **rodando só na aba `STAGING-V2`**. As abas `GoDocs` (prod) e
> `STAGING` **não foram tocadas** — nada quebrou ainda, e este documento existe para que nada
> quebre quando forem.
>
> Levantado por leitura do repo do Gomoon em 03/09/2026 (só leitura — nenhum commit lá).

O item 5.8 do plano diz: *"Retirar do gomoon os cálculos de impacto e avaliação de combos.
GoDocs já entregar cálculo de impacto final. Subdividir memória de cálculo em impacto bruto e
impacto líquido."*

São **duas** frentes independentes, e a primeira é urgente mesmo que a segunda nunca aconteça.

---

## 1. ⚠️ URGENTE — a v2 renomeia colunas que o ingest lê por NOME

O `scripts/ingestDynamic.ts` lê a aba por **nome de coluna** (`r["Ganho Total"]`, …) e o
`fetchSheets.ts` tipa essas 23+ colunas. A v2 fez **17 renomeações in-place** na aba: renomear
cabeçalho não move célula (as 578 linhas seguem lá), mas o nome antigo deixa de existir.

**Coluna ausente não dá erro** — `r["Ganho Total"]` vira `undefined`, `parseBrNumber` devolve
`0`, e o ingest grava zero. O modo de falha é o pior possível: o dashboard zera o impacto de
todo mundo, em silêncio, e ninguém descobre até alguém procurar o número.

| O ingest lê hoje | Passa a se chamar | Observação |
|---|---|---|
| `Ganho Total` | **`Impacto Líquido`** | ⚠️ e a CONTA mudou — ver §2 |
| `Saving Reais` | **`Impacto Bruto`** | ⚠️ e passou a incluir a receita — ver §2 |
| `Horas em Reais` | **`Custo Evitado Horas Reais`** | o saving por horas da v1 virou *custo evitado* na v2 |
| `Custo Evitado` | **`Saving Efetivado`** | o custo evitado da v1 (a empresa pagava e parou) virou *saving efetivado* |
| `Justificativa Custo Evitado` | **`Evidência Saving Efetivado`** | |
| `Custo Mensal ou Pontual` | **`Freq. Saving Efetivado`** | usada por `saving-periodicidade.ts` |
| `Tipo de Saving` | **`Freq. Custo Evitado`** | usada por `saving-periodicidade.ts` |
| `Receita Mensal` | **`Receita Incremental`** | |
| `Tipo de Receita` | **`Freq. Receita`** | |
| `Receita Memorial` | **`Racional Receita`** | |
| `Custo do Projeto` | **`Custo para Rodar`** | |
| `Custo do Projeto Mensal ou Pontual` | **`Freq. Custo para Rodar`** | |
| `Justificativa Custo do Projeto` | **`Justificativa Custo para Rodar`** | |
| `Justificativa Saving Escalado e Real` | **`Racional Custo Evitado`** | |
| `Tipos Projeto` | **`Tipos de Ganho`** | |
| `Contexto do Projeto Especial` | **`Ganho Imensurável`** | |
| `Participantes` / `Participantes 2` | **`Coautor`** / **`Participante`** | `parseParticipantes` lê as duas |

**Sugestão (baratíssima e sem coordenação de deploy):** um `pick(r, nomeNovo, nomeAntigo)` no
`ingestDynamic.ts` que tenta o nome novo e cai no antigo. Com ele, os dois repos podem subir em
qualquer ordem — o mesmo truque do `r["Especial?"] ?? r["Projeto Especial"]` que já existe aí.

**Colunas MORTAS na v2** (seguem na aba, com o dado antigo, mas nada mais as escreve):
`Alguém Fazia?` · `Especial?` · `Alocação Ganhos` · `Saving Horas Real` · `Saving Horas Escalado`
· `Custo Externo Mensal` · `Memorial de Saving` · `Data Criação`.
⚠️ O ingest lê `Especial?` (`isEspecial`) e `Alguém Fazia?` (`parseSemBaseline`) — em projeto v2
elas ficam paradas no valor legado.

---

## 2. A conta mudou — não é só nome

Não basta remapear: **os números significam outra coisa**.

```
CE = CE_horas + CE_naocontratado

Impacto Bruto          =     S  +     CE  +     R                 ← soma crua, "de fachada"
Impacto Líquido        = 1,0·S  + 0,5·CE  + 0,1·R  − C
Impacto Líquido Mensal = 1,0·m(S) + 0,5·m(CE) + 0,1·m(R) − m(C)   ← é ESTE que vocês consomem

m(x) = x ÷ { pontual 4 · mensal 1 · trimestral 3 · semestral 6 }   ← por BLOCO, não por projeto
```

Três diferenças que mudam resultado:

1. **`Impacto Bruto` ≠ `Saving Reais`.** Na v1 era só o saving; na v2 é `S + CE + R`, **a receita
   está DENTRO**. Somar `Impacto Bruto` com `Receita Incremental` conta a receita duas vezes.
2. **Pesos.** Saving efetivado 100% (é linha de custo que parou — tem extrato), custo evitado
   **50%** (despesa que nunca nasceu, não há extrato), receita 10% (é a mesma régua do ÷10 da v1,
   com outro nome), e **custo para rodar abate 100%** (caixa saindo, mesma certeza do saving).
3. **Mensalização por BLOCO, e pontual ÷4** (a validade padrão do projeto). Isso **inverte** de
   propósito a decisão de 01/07/2026 ("pontual entra pelo valor cheio"), que segue valendo na v1.
   Um projeto pode ter saving mensal e receita pontual ao mesmo tempo — um divisor de PROJETO
   erra nesses casos, que é justamente o que `saving-periodicidade.ts` já tinha descoberto.

### Efeito medido na base real (`STAGING-V2`, 581 linhas, 03/09/2026)

| | antes (régua v1) | depois (régua v2) |
|---|---|---|
| Impacto Bruto | R$ 899.893,79 | **R$ 2.033.008,53** |
| Impacto Líquido | R$ 1.035.313,02 | **R$ 793.047,72** |
| Impacto Líquido Mensal | R$ 0,00 (coluna nunca preenchida) | **R$ 694.628,30** |

O líquido cai ~23% — é o peso de 50% no custo evitado, que na v1 entrava inteiro.

---

## 3. O que dá para APAGAR do Gomoon quando o GoDocs entregar o número

Este é o "retirar os cálculos de impacto" do 5.8. **Só depois** que a aba de prod estiver na v2 e
com o retroativo rodado:

| Arquivo | O que fazer |
|---|---|
| `src/lib/saving-periodicidade.ts` | **some inteiro.** As 3 regras (`auditor` / `componente` / `legado`) existiam para adivinhar o divisor a partir dos componentes — o GoDocs passa a entregar `Impacto Líquido Mensal` já mensalizado por bloco. O caso emblemático do arquivo (AVD Central: processo semestral + assinatura mensal) é exatamente o que a mensalização por bloco resolve na origem. |
| `src/lib/mensalizacao-sync.ts` | **some junto.** Sem régua a reaplicar, o `recomputeMensalizacao` fica sem função. ⚠️ Decidir o destino do **override de periodicidade do auditor** (`tipo_saving_override` + `/admin/periodicidade`): ou o override migra para o GoDocs (que é onde o dado nasce), ou vira uma coluna de ajuste que o GoDocs respeita. Enquanto ele existir aí, `Impacto Líquido Mensal` e `effective_ganho_total` vão divergir. |
| `scripts/ingestDynamic.ts` | `effective = ganho/12 se pontual` sai; `effectiveGanhoTotal` passa a ser **cópia** de `Impacto Líquido Mensal`. |
| `src/app/api/impacto/route.ts` + `src/lib/impacto-export.ts` | parar de recompor `saving + 10%×receita` e o resíduo. ⚠️ **A separação saving × receita é do contrato de vocês** (o Bruno e o João pedem os dois eixos) e o GoDocs **não** entrega essa quebra hoje: ele entrega bruto, líquido e líquido mensal. Se a quebra tiver de continuar, é preciso combinar 2 colunas a mais (parcela de saving e parcela de receita já mensalizadas) — **me diga e eu adiciono**, é barato do nosso lado. |
| `docs/api-impacto.md` | a seção "A regra, em 5 passos" descreve a régua v1; passa a apontar para cá. |

### "Avaliação de combos"

Interpretei como o **empilhamento multiplicativo** de `src/lib/multipliers.ts`
(`impacto_R$ = Π fatores de pessoa × Σ [ganho × Π fatores de projeto]`). ⚠️ **Isso NÃO sai
com o 5.8**: é régua de **SCORE de pessoa** (quem usa ai-proxy, quem usa GoDeploy, complexidade,
especial), não de impacto financeiro. O GoDocs entrega o **dinheiro**; o multiplicador é como
vocês transformam dinheiro em pontos, e essa decisão é do Gomoon. **Se a intenção do 5.8 for
outra, me corrija** — foi a única leitura que a base de código sustenta.

---

## 4. ⚠️ Um bug que já existe hoje, independente de tudo acima

O nível de projeto ganhou um 4º degrau: **`agentico`** (acima de `autonomia`) — o sistema que
decide o próprio caminho, escolhe as ferramentas e itera, em vez de percorrer um roteiro fixo.
Ele é gravado na **mesma coluna `Complexidade`** (reaproveitada de propósito, para não duplicar
dado nem quebrar o `parseCategoria`).

Só que, do lado de vocês:

```ts
// scripts/ingestDynamic.ts
function parseCategoria(raw: unknown): "automacao" | "inteligencia" | "autonomia" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "inteligencia" || s === "inteligência") return "inteligencia";
  if (s === "autonomia") return "autonomia";
  return "automacao";                      // ← "agentico" cai AQUI
}
```

O fallback silencioso faz o nível **mais alto** ser pontuado como o **mais baixo** (×1, quando
`autonomia` já vale ×1,5). Precisa de três coisas:

1. `agentico` no pg enum `complexidade_categoria` (migração — é `ADD VALUE`, aditivo);
2. o ramo no `parseCategoria`;
3. um multiplicador `complexidade_agentico` em `DEFAULT_MULTIPLIERS` (o fator é decisão de
   vocês; `autonomia` está em 1,5).

⚠️ Enquanto (1) não existir, mandar `agentico` para a coluna em PROD faz o ingest rebaixar o
projeto calado. **Por isso o `agentico` ainda não está em prod** — ele só é escrito na aba
`STAGING-V2`.

---

## 5. Colunas NOVAS que a aba passou a ter

| Coluna | O que é |
|---|---|
| `Impacto Líquido Mensal` | o número do §2 — **é o que substitui o `effective_ganho_total`** |
| `Saving Efetivado Agora` | a 2ª ponta do par (o saving é a DIFERENÇA antes − agora) |
| `Custo Evitado Não Contratado` | a vaga não aberta / a consultoria não contratada |
| `Tipo de Projeto` | Agente · Sistema · App · Dashboard · Automação (eixo NOVO, ≠ Complexidade) |
| `ID Pai` / `ID Feature` | vínculo entre projetos (feature de um projeto existente) |

`Tipo de Projeto` e `ID Pai` podem interessar ao dashboard de vocês (agrupar por tipo, não
contar duas vezes um projeto que é feature de outro) — mas **nada disso é requisito do 5.8**.

---

## 6. Ordem sugerida da virada

1. **(Gomoon, agora)** o `pick(nomeNovo, nomeAntigo)` do §1 + o `agentico` do §4. Aditivo, não
   quebra nada, e a partir daí a ordem de deploy deixa de importar.
2. **(GoDocs)** v2 vai a prod: renomeia o cabeçalho da aba `GoDocs` e roda o retroativo do
   impacto (o mesmo que rodou na staging, com backup e dry-run).
3. **(Gomoon)** trocar o cálculo pelo consumo de `Impacto Líquido Mensal` e apagar o §3 — depois
   de conferir que o total da API bate com o da planilha.

Dúvida em qualquer ponto, o número de referência é sempre o da planilha: ela continua sendo a
fonte da verdade e o único lugar onde a triagem edita.
