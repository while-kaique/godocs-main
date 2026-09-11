# Rodada de calibragem — noite de 10→11/09/2026 (staging edf400b4 · aba "Cópia de GoDocs 1")

Pasta da rodada CORRIGIDA (a baseline anterior, no worker v348, está em `../noite-2026-09-11-v348/`).
`divergencias.md` e `resumo.json` saem de `scripts/calibragem/cruzar.mts`; `projetos/*.json` é a resposta do
`POST /api/admin/avaliacao/time-completo` por projeto; `fichas/` é a ficha do dashboard depois da avaliação;
`antes.json` é a cópia ANTES de qualquer escrita; `backup-godocs/` guarda a aba GoDocs antes de cada porte.

## O que mudou no código nesta rodada, e por quê (commits em `feat/calibragem-noite`)

| Problema medido | Correção (régua/trava, nunca só prompt) | Onde |
|---|---|---|
| Mesa lia "R$ 8.352" como horas | linha de impacto rotulada "valores em REAIS por mês, NÃO são horas" | `dossie.ts`, `avaliacao-normais.functions.ts` |
| Mesa deixava 71% em validação só por "faltar material" | `aplicarTravaMaterialMesa`: preocupação só de material vira ressalva | `agents/mesa-especialistas.ts` |
| 3 aprovados por humano reprovados por "fora de uso" sem citação | `VOCABULARIO_INVALIDEZ`: invalidez só com citação que a sustente | `avaliacao/consenso.ts` |
| Memorial (v1) vazava no embedding e no prompt | memorial fora de `textoParaEmbedding` e do dossiê | `especial-corpus.ts`, `dossie.ts` |
| Documentação compilada quase vazia | dossiê lê os `.md`/Docs do Drive (`lerTextoDocsDrive`, 3 arquivos, 9k chars) | `google/drive.ts`, `dossie.functions.ts` |
| RAG do time era lexical | vizinhos por embedding sobre a base inteira (`vizinhosPorEmbedding`, K=8, piso 0,2) + cache por isolate | `avaliacao/time.functions.ts`, `avaliacao-normais.functions.ts` |
| Denominador do eixo de impacto fixo | `totalBase` medido da própria aba | `avaliacao/time.ts`, `estrelas-regua.ts` |
| Robô orçamento/GoBrands presos em 5★ (listados como exemplo de 5★) | exemplos de 5★ trocados (Ticket Creator, DIFAL); âncoras 6-10 vivas no prompt (`ancorasComite`) | `estrelas-regua.ts`, `cerebro-estrela.ts` |
| Escape sem número na tela | `rotuloNotaAgente` devolve "6-10"; confiança alta quando é régua | `estrelas-regua.ts`, `consenso.ts` |
| Estrela do time não gravada em projeto ancorado / Status Aprovado | grava `Estrela Agente`/`Confiança Agente` sempre; `Estrelas` só quando não ancorado | `avaliacao-completa.functions.ts` |
| Réplica ao cético desabava ≥2 níveis (21 de 96) e levava o escape (10 de 15) | `reconciliarReplicaEstrela`: queda máx. 1 nível/volta; escape só cai por gatilho NOMEADO (`gatilho_refutado`) | `avaliacao/cetico-estrela.ts`, `time.ts` |
| Réplica SUBIA a nota / inventava escape (AVD Central 3→5+escape) | regra "a réplica não sobe" + `derrubarEscapePorGatilho` na 2ª volta do cético | idem |
| Worker estourava memória em concorrência ≥5 | embeddings decodificados uma vez por isolate (TTL 120 s) | `avaliacao-normais.functions.ts` |

## Porte para a aba GoDocs (prod) — `scripts/calibragem/portar-para-godocs.mts`

Só ids de `projetos/*.json` com HTTP 200; `Estrela Agente` e `Confiança Agente` em todos; `Estrelas` 0–5 só onde a
nota humana é 0/vazia na cópia E na célula atual da GoDocs; `Status` só de Pendente para o que a rodada gravou
(`status_gravado`) + `Motivo Reprovado`. Backup JSON da aba antes de cada escrita; `portado-para-godocs.json` lista
célula a célula. ⚠️ Incidente: o 1º porte (12:37 UTC) escreveu 1★ sobre o 2★ que o Bruno tinha dado ao «BID 2026»
em prod depois de a cópia nascer; revertido às 12:50 UTC e a régua da célula atual entrou no script.

## O que NÃO virou trava (decisão do dono do produto)

- **SendApp** 7★ humano × 5★ agente: o eixo de tamanho sobe até 5★; uma "entrada na faixa por share ≥ 10% da base"
  levaria o DIFAL (5★ humano, exemplo de 5★ da régua) junto.
- **Ferramenta de comentar nos posts** 8★ humano × 1★ agente: a doc do Drive diz "o time comenta manualmente nos
  posts", contradizendo a descrição ("comenta direto neles pela marca"). O agente citou a doc.

## Medição da trava da réplica (2 correções, o teto combinado) — 33 reavaliados às 13:10–13:40 UTC

- Colapsos sumiram: Gocreators 2★ → 3★ (humano 6), GoHunter 1★ → 3★ (humano 5), Envio de Comprovante 0★ → 5★.
- Faixa 6-10 humana (8 projetos): 2 saem 6-10 (PIAPP, Ferramenta de testes), 3 saem 5★ (Robô orçamento, SendApp,
  GoBrands), 2 saem 3–4★ (Gocreators, Gopilot), 1 sai 1★ (Ferramenta de comentar, contradição na doc).
- ⚠️ **A entrada na faixa é ESTOCÁSTICA no cérebro da estrela para especial sem número**: Robô orçamento e GoBrands
  saíram 6-10 na 1ª passada da trava (12:49–12:53 UTC) e 5★ na 2ª (13:1x), com o mesmo código e o mesmo dossiê.
  A trava impede a QUEDA; não força a SUBIDA (subir por trava seria inventar nota). Falsos 6-10 na passada: CTR Machine
  Admaker (4★ humano) e BB Indústria QC (3★ humano) — vão para o comitê com flag, não gravam estrela.
- Comparáveis com nota humana ≥1 nesta amostra: 28, dentro de ±1: 19 (68%).
- **Decisão pendente do dono do produto**: para especiais cuja âncora de comitê mais próxima tem similaridade alta,
  marcar "candidato ao comitê" (Pendente com flag) em vez de 5★ — é régua de VIZINHANÇA, não de prompt, e ainda não
  foi codada porque esgotou o teto de 2 correções para este problema.

## Números finais

Ver `divergencias.md` (canários no topo, faixas de impacto, tempo mediano por projeto, divergências humano × agente).
