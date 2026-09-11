# Rodada de calibragem — madrugada de 11/09/2026

**Onde rodou:** app de STAGING (`edf400b4`) apontado para a aba **"Cópia de GoDocs 1"** da planilha de prod
(770 ids, cabeçalho idêntico ao `GoDocs`), com ESCRITA REAL. A aba `GoDocs` e o app de prod não foram tocados.
`antes.json` é o retrato da cópia antes da primeira escrita (backup célula a célula).

**Código no ar durante a rodada:** worker **v348** = commit `99d4c4b` da branch `feat/calibragem-noite`
(vizinhos por embedding da base inteira com tamanho no resumo, memorial v1 fora do vetor e do dossiê, `Impacto
Líquido Mensal` como número único, `totalBase` real no 2º eixo, "6-10" na coluna quando há escape, confiança
alta na decisão por régua, modelo leve nos especialistas). Secrets: `AVALIACAO_MODELO_LEVE=gpt-5.6-luna` +
`low`, `AVALIACAO_MODELO_FORTE=gpt-5.6-sol`, `TIME_SEM_REPLICA=1`, `AGENTE_DECIDE_FUNIL=1`,
`AGENTE_FECHA_PENDENTE=0`, `EMBEDDINGS_SOMENTE_LEITURA=1` (após o backfill).

## O que os canários mostraram (03:44 UTC) e o que virou código

| Canário | Humano | Time (v348) | Achado | Correção (commit `0119ce0`, **não deployado**) |
|---|---|---|---|---|
| PIAPP | 10 | 6-10, conf alta | ✓ | — |
| SendApp | 7 | 5 (2º eixo), mesa `em_validacao` | mesa pede "equipe e horas por rotina; conferir memória de cálculo" | `aplicarTravaMaterialMesa`: preocupação sem sinal concreto vira ressalva |
| CX Hub | 3 (run 9) | 5, mesa `em_validacao` | mesa leu **R$ 31.604,82 como horas** | "R$" explícito + linha de horas no texto da mesa |
| AVD Central v2 | 4 | 3, mesa `em_validacao` | mesa leu **R$ 8.352 como "8.352 horas ≈ 38 pessoas"** | idem |
| Robô orçamento | 8 | 5, sem escape | estava como EXEMPLO de 5★ na régua | exemplos 6-10 saem do 5★ e viram `ESCAPE_MUDA_O_JOGO.exemplos`; cérebro recebe âncoras 6-10 vivas |
| GoBrands | 7 | 5, sem escape | idem | idem |

Outros dois achados da noite, também em `0119ce0`: projeto com estrela humana **não registrava** a recomendação
do time (o `return` da âncora vinha antes de gravar) — agora grava `Estrela Agente`/`Confiança Agente` e
devolve `estrelas_time`; e **OOM** com 8 avaliações em paralelo (`Worker exceeded memory limit` ×24: cada
avaliação decodificava a tabela inteira de embeddings duas vezes) — cache por isolate com TTL de 120 s.
Commit `d367c3a` (também não deployado): o dossiê passa a **ler o `.md` da documentação no Drive**
(`lerTextoDocsDrive`; 757 das 770 linhas têm link na coluna URL e ninguém lia o conteúdo).

⚠️ **Por que as correções não entraram na rodada:** o `updateApp` do MCP do GoDeploy falhou 14 vezes nesta
sessão com "Anthropic proxy: upstream closed the stream" (só a 1ª chamada da noite passou). Não é o app.
Qualquer janela do Claude com o MCP funcionando sobe a branch em um passo (`scripts/deploy-godeploy.sh` +
`updateApp` no `edf400b4`). Enquanto isso a base rodou no v348 com **3 em paralelo** (acima disso, OOM).

## Como ler `divergencias.md`

Gerado por `scripts/calibragem/cruzar.mts <esta pasta>`: canários no topo; depois SÓ as linhas em que humano
e agente discordam (estrela 2+ de distância, Aprovado→reprovaria, Reprovado→aprovaria); concordância por faixa
de impacto; tempo mediano. A estrela HUMANA é `Estrelas ≥ 1` na cópia que não seja o valor gravado pelo agente
na run 9 (05/09). Para projetos com âncora humana, a nota do TIME vem da ficha (`avaliacaoSombra.time`), porque
o v348 devolve a âncora no lugar dela. `fichas/` guarda essas leituras; `projetos/` tem um JSON por projeto.

## Para reverter

- Cópia: `antes.json` tem Status, Estrelas, Estrela Agente, Confiança Agente de cada linha antes da rodada.
- Staging: voltar `GOOGLE_SHEETS_TAB` para `STAGING-V2`, apagar `EMBEDDINGS_SOMENTE_LEITURA`, religar os crons
  `n2zkq1714fya`, `05xewgexkhjx`, `ncbmbt6trmfm`.
