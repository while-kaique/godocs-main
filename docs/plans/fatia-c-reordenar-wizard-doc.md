# Plano — Fatia C: reordenar o wizard (doc paralela, refino no final)
**Status:** rascunho (aguarda o mapa do explorador + tarefas)

**Objetivo:** Tirar a documentação do caminho crítico da submissão reordenando o fluxo guiado — a doc compila em paralelo desde o anexo, o usuário responde `saving`/`receita` primeiro (com todos os gates), e o refino conversacional da doc acontece por último, sobre a doc já compilada. Fecha os ~44s de tela branca que sobram (o `complete` não-streamado do `doc_preview`), sem o usuário perder o refino guiado da doc.

## Contexto — o que já está pronto (reusar, não refazer)
- **A+B em PROD** (`origin/main` PR #307, v312): doc compilada em `runBackground` + modelo leve no extrator/compilador (`doc-async.ts`, `doc-modelo.ts`, `dispararDocBackground`). Plano-fonte: `docs/plans/submissao-doc-fora-do-caminho-critico.md` (§3 item C = esta fatia; o arquivo pode dizer "rascunho" por estar num branch stale — A+B foram executados).
- **Fluxo direto de liderança = template** (`podeFluxoDireto`/`fluxo_direto` em `chat.functions.ts`, `src/lib/submeter-direto.ts`, `handleContinuarDireto`/`modo_direto` em `submeter.tsx`): já compila a doc numa passada e pula o chat, indo ao formulário determinístico. A fatia C reusa o padrão de compilar-em-paralelo, mas MANTÉM a fase conversacional de saving/receita (gates) e ADICIONA um refino conversacional de doc no fim.

## Decisão de produto (fechada — Luis, 29/08)
Doc compila em **paralelo** às perguntas determinísticas; refino conversacional da doc **no FINAL**, sobre a doc já compilada. Nova ordem: extrator + compilação em bg desde o anexo → `saving`/`receita` (mantendo TODOS os gates) → refino conversacional da doc → submit.

## Fronteiras (não exceder) — defaults a confirmar na aprovação
- Só **submissão NOVA + projeto padrão**. Edição (`/editar/$id`), especial e liderança ficam FORA (edição re-seeda a doc; especial e liderança já pulam o agente).
- Durante saving/receita: indicador discreto "documentação sendo preparada"; falha na compilação → fallback determinístico (`buildDocEspecial`), refino no fim resolve.
- Refino no fim mantém a fase conversacional da doc (agente pergunta/ajusta), só reposicionada.
- NÃO mexer nos gates de saving (jornada/teto/≥44h/alocação/ganho projetado/sobreposição), no analisador, nem no contrato do envelope de streaming.

## Tarefas
- **A ESCREVER** com o mapa do explorador `ggsd:explorador` id `afc3ab027eef94990` (reordenação da máquina de fases). Rascunho de fatiamento provável: (T1) reordenar transições de `ChatFase` no orquestrador para começar em saving/receita e mover o refino de doc para o fim; (T2) `iniciarSubmissao` compila doc em bg e NÃO abre a fase `doc` no fluxo comum; (T3) nova fase de refino de doc pós-financeiro + garantia de doc no submit; (T4) frontend step 3 (ordem das telas + indicador + soltar `await bgPromiseRef`); (T5) sandbox `/fluxos` `demo-backend.ts` acompanha a nova ordem; (T6) testes; (T7) staging + medição; (T8) prod + merge + docs.

## Critérios de aceitação (rascunho)
1. Submissão nova padrão: usuário responde saving/receita antes de qualquer conversa de doc; o refino da doc aparece por último, sobre a doc já compilada; submit garante doc completa.
2. Sem regressão nos gates de saving/receita nem no analisador; doc final íntegra no Drive/analisador.
3. Sem os ~44s de espera em branco do turno de aprovação da doc.

## Blast-radius
Arquivos: `orchestrator.ts` (máquina de fases ~180-197, 1539-1604, 1688-1692), `chat.functions.ts` (846/859-891, 2346-2382, 2567, 3446), `submeter.tsx` (1362-1456, 1629-1634, 1737/1790), `demo-backend.ts`, `background.ts`, extrator/compilador. · Dependentes: consumidores da doc compilada são TODOS pós-fase-financeira (analisador `analyzer.ts:657`, submit `bloqueioDocAusente`, Drive, telas read-only, reconciliadores). · Invariantes: `buildDetalhesAprovados` usa SÓ `estado.coletado` (destrava a reordenação); garantia de doc no submit; intro/seed/rascunho exclusivos; regra 1 (rebuild `worker.js`). · Confiança: **média** (o mapa detalhado da reordenação vem do explorador `afc3ab027eef94990`, ainda não lido — o `/ggsd:code` faz a varredura completa).

## Pendente antes de aprovar
✅ **Limite do explorador resetou (30/08 20h). Explorador RE-LANÇADO em 30/08 23:06** com a mesma pergunta de mapeamento (máquina de fases + fatiamento) — `ggsd:explorador` id **`a8f09057b7e6bb769`**, rodando em background quando esta sessão fechou por pressão de contexto (~82%). Output em `/tmp/claude-1000/-home-notebook-godocs-main/8a172a48-9b01-4a3a-b4ee-4ad15c91554a/tasks/a8f09057b7e6bb769.output` (NÃO ler cru — SendMessage ao id se vivo, senão re-rodar a mesma pergunta, que está toda documentada aqui e na memória `frente1-fatiac-reordenar-wizard`).

**Próxima sessão:** ler a CONCLUSÃO do explorador `a8f09057b7e6bb769` (arquivos/funções/dependentes/invariantes/fatiamento sugerido) → transcrever para o Blast-radius → **preencher as Tarefas** (o rascunho T1–T8 na seção Tarefas é o esqueleto a confirmar/refinar) → aprovar via seletor. Esta fatia MUDA a verdade funcional (reordena comportamento visível) → oferecer "Aprovar e continuar para a spec".
