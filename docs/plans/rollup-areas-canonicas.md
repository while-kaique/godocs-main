# Plano — Canonicalizar a dimensão `area` do rollup pro Gabriel

Status: aprovado

## Problema
O push do rollup histórico pro app do squad Intelli (João Gabriel) manda hoje **~41 áreas**,
mas a dimensão está poluída: variantes de caixa/acento da MESMA área contam separadas
(`GENTE E GESTÃO` × `Gente e Gestão`, `SUPPLY GOGROUP` × `Supply Gogroup` …), renomes legado
(`LOJAS`/`LOJAS - ADM`, `SUPPLY CHAIN`/`SUPPLY GOGROUP`), e grafias diferentes da lista canônica
de 23 áreas que o Gabriel usa. Não infla os TOTAIS (saving/receita batem com o /dashboard), só
suja a dimensão que ele consome.

## Objetivo (decisões do Luis, 27/08)
Canonicalizar o nome da área **antes** de agregar o rollup: dedup de caixa/acento + os renomes
que fundem + alinhar a grafia às 23 do Gabriel — **sem mudar total nenhum e sem descartar nada**.
- Manter genéricos (não fatiar): `Produto`, `Operações`, `Finanças`.
- Manter como estão os 4 pequenos: `Contabilidade`, `GENTE E GESTÃO | CX`, `Produção`, `BIZOPS`.
- Manter as nossas que o Gabriel não conta: `RPA`, `Pós-venda`.
- Manter os 2 não-área: `ÁREA NÃO IDENTIFICADA` (R$20k, ~9 aprovados) e `N1 - LUIS LIVERI` (R$585).
Nada é dropado → o total geral fica IDÊNTICO ao de hoje.

## Blast-radius: BAIXO
- **Ponto único de escrita:** `src/lib/rollup-backfill.ts` linha 43 — a área entra do espelho ali
  (`area: texto(row["Área"])`). Canonicalizar nesse ponto deixa a tabela persistida
  `rollup_saving_receita`, o `lerRollupMensal`, o `montarSerieCumulativa` e o push todos limpos.
- **Novo módulo PURO:** `src/lib/area-canonico.ts` (`canonicalizarArea` + tabela `ALIAS_AREA`).
- **Downstream inalterado:** `agregarRollupMensal` já agrupa por `${periodo} ${area} ${tipo}`, então
  variantes que viram o mesmo nome **somam** automaticamente (total preservado). `montarSerieCumulativa`
  e `rollup-push.functions.ts` recebem a área já canônica — não tocar.
- **Reprocessamento:** o push chama `recalcularRollupBackfill()` antes de ler; a tabela é substituída
  inteira (idempotente). Nenhuma migração de schema.
- Nada de UI, nada de Sheets (mão única — o rollup só LÊ o espelho), nada de gate de chat.

## Mapa de canonicalização (slug → nome canônico)
Chave = slug (sem acento, minúsculo, kebab). Slug NÃO listado → passthrough (trim do nome cru:
área nova futura nunca é dropada nem mangled). Vazio/nulo → `""` (o agregador aplica o default
`ÁREA NÃO IDENTIFICADA`, como já faz hoje).

Renome/dedup/alinhar grafia:
- `az`→`AZ Buy` · `csc`→`Projetos/CSC` · `juridico`→`Jurídico/Compliance` · `fpea`→`FP&A e Tesouraria`
- `b2b-gobeaute`→`B2B Gobeaute` · `b2b-gocase`→`B2B Gocase` · `gente-e-gestao`→`Gente & Gestão`
- `sourcing-e-procurement-gobeaute`→`Sourcing & Procurement Gobeaute` · `transportes`→`Transportes`
- `supply-chain`→`Supply Chain` · `supply-gogroup`→`Supply Chain`  (fundem)
- `operacoes-gocase`→`Operações Gocase` · `operacoes-gocase-administrativo`→`Operações Gocase` (fundem)
- `operacoes-gobeaute`→`Operações Gobeaute`
- `lojas`→`Lojas` · `lojas-adm`→`Lojas`  (fundem)
- `tecnologia`→`Tecnologia` · `tecnologia-projetos`→`Tecnologia`  (fundem)
- `desenvolvimento-produto-gobeaute`→`Produto Gobeaute`
- `growth`→`Growth` · `cx`→`CX` · `dados`→`Dados` · `marketing`→`Marketing`

Mantidos (grafia própria, decisão explícita — não fatiar/dropar):
- `produto`→`Produto` · `operacoes`→`Operações` · `financas`→`Finanças`
- `contabilidade`→`Contabilidade` · `producao`→`Produção` · `bizops`→`BIZOPS`
- `gente-e-gestao-cx`→`GENTE E GESTÃO | CX` · `rpa`→`RPA` · `pos-venda`→`Pós-venda`
- `area-nao-identificada`→`ÁREA NÃO IDENTIFICADA` · `n1-luis-liveri`→`N1 - LUIS LIVERI`
- `squad-b2b`→`Squad B2B`

## Critérios de aceite
1. `canonicalizarArea` funde variantes de caixa/acento (`"Gente e Gestão"`→`"Gente & Gestão"`),
   os renomes que fundem (`"LOJAS - ADM"`/`"LOJAS"`→`"Lojas"`; `"SUPPLY CHAIN"`/`"SUPPLY GOGROUP"`→`"Supply Chain"`),
   e faz passthrough de slug desconhecido (`"Nova Área X"`→`"Nova Área X"`), vazio→`""`.
2. Dry-run do push em staging: nº de áreas cai de ~41 para **~30**; **soma de saving/receita por
   área preservada** (a soma das variantes vai para o canônico), grand total idêntico.
3. Nada descartado: `ÁREA NÃO IDENTIFICADA` e `N1 - LUIS LIVERI` continuam presentes.
4. Suíte verde (novo `tests/area-canonico.test.ts` + as existentes de rollup).

## Tarefas (TDD)
- T1 (red): `tests/area-canonico.test.ts` — variantes→canônico, merge, passthrough, vazio.
- T2 (green): `src/lib/area-canonico.ts` (`ALIAS_AREA` + `canonicalizarArea`).
- T3: aplicar em `rollup-backfill.ts` linha 43.
- T4: `npm run test` verde; `build` + `build:worker`.
- T5: deploy STAGING `edf400b4` → `sync-sheets-now` → `rollup-backfill` → dry-run `rollup-push`
  (conferir áreas ~30 + totais) → prod `674a3710` → PR via `LuisEduardo100` (regra 14).

⚠️ Revisão GGSD (§9) a rodar antes do handoff.
