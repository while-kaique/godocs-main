# Plano — Calibrar a régua do critério (`claro_nao`) + recuperação de linha ausente no `resyncGoogle`
**Status:** ✅ aprovado (Luis, 2026-07-30)

**Objetivo:** fazer o `claro_nao` disparar no caso-âncora que motivou a frente (nuvem de palavras) sem
afrouxar a proteção contra reprovação injusta, e fechar o gap em que um append perdido fica
irrecuperável — as duas pendências que sobraram antes de levar `staging/criterios-coautor` a produção.

## Contexto (o que a validação de 30/07 mostrou)

O cenário E2E `criterio-claro-nao` (`stg-crit-05`, projeto `35155594…`) submeteu, **chegou na planilha**
— prova de que o fix da cota (`cb8d677`) se sustenta — e o analisador classificou **zona cinzenta**, não
`claro_nao`. Status "Pendente" e `Motivo Reprovado` vazio: comportamento **correto para zona cinzenta**,
mas o caminho da reprovação segue sem exercício real e, em produção, tende a **nunca disparar**.

A justificativa gravada expõe as duas causas:

> _"A recorrência não está bem sustentada… o autor afirma que nada piora e que ninguém pediu de novo;
> por outro lado, **há um indicador de uso e um resultado verificável no material do evento**, então
> não é caso de claro_nao."_

1. **O entregável foi aceito como rastreabilidade.** "dá pra conferir no slide do evento" prova que a peça
   foi feita — não que um ponteiro mudou e segue sendo acompanhado. O prompt não distingue as duas coisas.
2. **O "use com PARCIMÔNIA" venceu a própria regra.** A regra de `claro_nao` já é _"falha evidente em
   recorrência **E** em rastreabilidade/contrafactual"_, e aqui **recorrência e contrafactual falharam
   juntos** — mas o "na dúvida escolha SEMPRE zona_cinzenta", sem exceção declarada, absorveu o caso.

Não é desvio de escopo: a própria `SPEC_CRITERIOS_PROJETO.md` já lista _"⏳ régua a calibrar com o Rafa
antes de produção"_ como pendência aberta.

## Tarefas

- **T1 — Rastreabilidade: separar entregável de indicador** (`src/lib/agents/analyzer.ts`, critério 3 da
  régua). Adicionar que o **próprio entregável NÃO é indicador** ("dá pra conferir no slide", "o arquivo
  gerado está lá", "o material mostra o resultado") — indicador é uma **métrica** (horas · custo · taxa de
  erro · prazo · receita) que se abra **hoje** num relatório/sistema/base e se compare antes × depois.
  Quando a única evidência oferecida é o artefato produzido, a rastreabilidade é **NÃO comprovada**.
  (guarda: teste de conteúdo do prompt + re-rodada do cenário E2E no T6)
- **T2 — Tornar explícito o par que reprova** (mesmas REGRAS DA CLASSIFICAÇÃO). `claro_nao` quando
  **recorrência falha E o contrafactual é negado** (rodou uma vez / sob encomenda **e** o autor indica que
  nada piora ou ninguém reclama) — sem buscar salvação numa evidência de que o entregável existiu. O
  "na dúvida → zona_cinzenta" **permanece**, com a exceção declarada: não se aplica quando esses dois
  critérios falham juntos. (guarda: teste de conteúdo do prompt)
- **T3 — Reforçar o exemplo-âncora** com a variante que enganou o analisador: a nuvem de palavras
  **continua `claro_nao` mesmo quando o autor diz que "o resultado dá pra ver no slide"**.
- **T4 — `updateRowByProjectId` informa se achou a linha** (`src/lib/google/sheets.ts`):
  `Promise<void>` → `Promise<boolean>` (`false` no caminho "ID não encontrado"). Aditivo — os 8 chamadores
  atuais ignoram o retorno. **Zero leitura extra** do Sheets (a busca do ID já acontece hoje) — requisito
  duro, dada a cota de 60 leituras/min compartilhada com produção.
- **T5 — Fallback para append na IDA** (`src/lib/google/sync.ts`): quando `modo === 'edicao'` e o update
  devolve `false`, **cair para `appendRow`** em vez do no-op silencioso, incluindo `Data Submissão`
  (a linha está sendo criada agora; hoje o ramo `edicao` omite a coluna de propósito) e logando como
  **recuperação**, não como caminho normal. (guarda: teste do decisor + `sync-padronizacao`)
- **T6 — Revalidar na staging:** rebuild + deploy no `edf400b4`, re-rodar `E2E_ONLY=criterio-claro-nao`
  e conferir na linha inteira (`GET /api/admin/dashboard/projetos/:id`) que agora vêm **Status
  "Reprovado" · Classificação · Motivo Reprovado**. Nenhum outro cenário deve mudar de classificação.
- **T7 — Docs/specs no mesmo PR** (regras 3 e 12): `prompt-registry.ts` (a descrição do analisador cita a
  régua), `SPEC_CRITERIOS_PROJETO.md` (a calibração e o que a validação mostrou),
  `SPEC_CORRECOES.md` (o gap do `resyncGoogle`: sintoma → causa → fix → onde aterrissou) e o `CLAUDE.md`
  no ponto do sync de IDA.

## Critérios de aceitação

1. O cenário `criterio-claro-nao` na staging fecha com **Status "Reprovado"**, `Classificação`
   começando por "Claro não" e `Motivo Reprovado` **não vazio e legível pelo autor**.
2. Nenhum dos guards de `normalizarClassificacao` é afrouxado: sem motivo → zona cinzenta · especial
   nunca reprova · materialidade > R$ 5k → zona cinzenta (D9 permanece intacto).
3. `resyncGoogle` num projeto cuja linha **não existe** na planilha passa a **criar** a linha; com a linha
   presente, o comportamento é idêntico ao de hoje (update in-place, nunca duplica).
4. Nenhuma leitura adicional do Sheets por chamada de sync.
5. `npm run test` verde (com testes novos para T1–T2 e T4–T5), `build` + `build:worker` OK,
   `worker.js` recomitado.

## Fronteiras (não exceder)

- **Nada de promoção determinística para `claro_nao`.** A calibração é **só de prompt** — `normalizarClassificacao`
  continua apenas **rebaixando** (D9). Forçar reprovação no código exigiria fabricar o `motivo_reprovacao`,
  que é texto visível ao autor.
- **Barrar submissão segue FORA** (D4) e a regra TEMPORÁRIA do "Pendente" continua valendo para todo o
  resto (D1).
- Não mexer nas perguntas da Etapa 2, no `MEMORIAL_ESQUELETO`, nas colunas da planilha, no cron de
  reconciliação (já corrigido em `cb8d677`) nem no `CHECK` de `projetos.status` (D8).
- Não tocar o sync **reverso** nem a `reconciliarExclusoes` — a carência de 1h fica como está.

## Riscos declarados

- **Falso positivo de reprovação.** Apertar o `claro_nao` aumenta a chance de reprovar projeto legítimo, e
  **o autor vê o motivo** (D10). Mitigação: o par exigido (recorrência **e** contrafactual falhando) é
  estreito; "SIMPLICIDADE NÃO REPROVA" permanece no prompt; a triagem humana sobrepõe no `/dashboard`; e o
  Rafa deve ser avisado no deploy. Se o T6 mostrar qualquer outro cenário virando `claro_nao`, o plano
  para e reavalia.
- **Ressurreição de linha apagada à mão.** O fallback do T5 vale para todo `modo === 'edicao'`, então um
  reenvio pode recriar uma linha que um admin apagou de propósito — e apagar do Sheets é justamente como
  se remove um projeto. Janela estreita (a `reconciliarExclusoes` purga o projeto do SQLite em 1h) e o
  usuário de fato reenviou. Aceito e registrado; a alternativa (checar existência antes) custaria leitura.

## Blast-radius

**Arquivos:** `src/lib/agents/analyzer.ts` (prompt) · `src/lib/google/sheets.ts` · `src/lib/google/sync.ts` ·
`src/lib/testes/prompt-registry.ts` · testes (`criterios-classificacao`, `sync-padronizacao` + novos) ·
`spec-docs/SPEC_CRITERIOS_PROJETO.md` · `spec-docs/SPEC_CORRECOES.md` · `CLAUDE.md`.
**Dependentes:** 8 chamadores de `updateRowByProjectId` (`dashboard-admin.functions.ts`,
`meus-projetos.functions.ts`, 3 pontos de `chat.functions.ts`, 2 de `sync.ts`) — todos ignoram o retorno,
mudança aditiva; `syncProjetoToGoogle` é o único ponto de escrita da IDA.
**Invariantes tocados:** D1 · D4 · D9 (preservados por construção) · cota do Sheets (nenhuma leitura nova) ·
"o write-back nunca escreve `Atualizado Em`" (não tocado).
**Confiança:** média — sem `docs/INDEX.md`/`invariants.md` no projeto, o mapeamento saiu do `CLAUDE.md` +
specs e da leitura direta dos arquivos; a sessão de código deve fazer a varredura completa de dependentes.

**Destino:** branch `staging/criterios-coautor` (a que está no ar na staging e vai a produção), em commits
separados por frente.
