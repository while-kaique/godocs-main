# Run 4 — TIME de 5 lentes + auditoria · 58 projetos

`run-4.json` · **58 de 58 com nota (100%)** · 0 falhas · 22s por projeto · dry

## O achado da noite: a confiança por consenso FUNCIONA

Aderência dentro de ±1 da nota da planilha:

| confiança | n | run 3 (autodeclarada) | run 4 (**por consenso**) |
|---|---:|---:|---:|
| alta | 7 | 78% | **100%** |
| média | 12 | 58% | **92%** |
| baixa | 33 | 80% | **61%** |

A autodeclarada estava **invertida**: "baixa" aderia mais que "alta". A derivada do consenso é
**monotônica**. Pela primeira vez existe um limiar utilizável: alta e média se sustentam, baixa
pede olho humano.

⚠️ `n=7` na faixa alta. É indicativo, não conclusivo. Mas o mecanismo é observável e explicável
(as 5 lentes divergindo entre si, e a base discordando das lentes), não uma opinião do modelo
sobre si mesmo.

## O time também é mais confiável que o agente sozinho

**58/58 com nota**, contra 93% do agente na run 3. A redundância das lentes mais a repescagem
cobrem a variação de formato que derrubava o agente.

## O defeito que esta rodada revelou, e é sério

O **piso zerou três projetos de nota alta**, e um deles é âncora da própria régua:

| projeto | planilha | base | final | piso alegado |
|---|---:|---:|---:|---|
| Ferramenta de testes de novos produtos | 7 | 5 | **0** | `ressubmissao` |
| Benchmark de Estampas | 4 | 3 | **0** | `so_o_autor` |
| **GoPrice** | 4 | 4 | **0** | `experimentacao` |

O GoPrice é o **exemplo de 4★ da régua** (`CRITERIOS_ESTRELA`, nível "Decide"). Uma lente o
chamou de experimentação e derrubou o projeto inteiro, por cima das outras quatro.

**Zerar é a afirmação mais forte que uma lente faz, e não custava nada.** O escape exige duas
citações literais; o piso não exigia nenhuma. Agora exige o trecho copiado em `sustentacao`, e o
prompt pede isso com todas as letras. Sem trecho, a alegação vira apenas a nota baixa daquele
eixo — que já é a forma correta de dizer "neste eixo o projeto não sustenta".

⚠️ Isto é a terceira vez nesta sessão que a resposta certa foi **exigir prova em código**, e não
pedir melhor no prompt: no escape, no piso, e na sugestão de alta do auditor.

## O ajuste fino está fazendo o que promete

36 dos 58 tiveram a nota movida pelas lentes, **sempre em um degrau**. Nenhum salto. A faixa 6-10
seguiu vindo do escape (CTR Machine, base 7, mantido).
