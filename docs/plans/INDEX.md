# Planos — índice

> Índice dos planos de sessão (ADR-026, refinado pelo ADR-034). Cada plano vive em seu **arquivo próprio**
> `docs/plans/<slug>.md`; este índice é o mapa rasteável. O `docs/NEXT-SESSION.md` é o **ponteiro enxuto** que
> aponta o plano **ativo**. Planos paralelos (tópicos/branches distintos) coexistem aqui sem se sobrescrever.

## Como cultivar (instrucional — sem hook)
- O **`/ggsd:plan`** cria `docs/plans/<slug>.md` (`Status: rascunho → aprovado (quem, data)`), adiciona/atualiza
  a linha aqui e marca o **ativo** (◀), e atualiza o ponteiro no `NEXT-SESSION.md`.
- O **`/ggsd:code`** segue o ponteiro até o arquivo do plano e só coda se o `Status` lá for `✅ aprovado` (RF-03).
- O **`/ggsd:handoff`** marca o plano `executado`/arquiva, atualiza esta tabela e **move o ponteiro** para o
  próximo plano ativo (ou "nenhum — próximo é planejar X"). Nunca deixa um plano `aprovado` órfão.
- **Slug** em kebab-case, **sem prefixo de data** (o git guarda a data/histórico — RF-17). Ex.: `cadastro-contatos`.

## Planos
| Plano | Status | Resumo (1 linha) |
|---|---|---|
| [remover-arquivo-e-doc-background](remover-arquivo-e-doc-background.md) | ✅ concluído — mergeado (PR #211) + prod (2026-07-23) | Etapa 2 do /submeter: remover de verdade arquivo já enviado (F1) + processar doc em background ao subir arquivos (F2) + ajuste "adiantar o background" |
| [edicao-etapa1-participantes](edicao-etapa1-participantes.md) | executado (2026-07-17) | Etapa 1 (participantes + papéis) editável na edição — T1–T3 + R1/R2 feitos+staging, T4 limitação, T5 validação/prod pendente |
| [ocultar-valor-meus-projetos](ocultar-valor-meus-projetos.md) | executado (2026-07-17) | Tirar o badge de valor R$ dos cards de "Meus Projetos" — esconder p/ todos + não serializar (INV-02); T1–T3 codados, falta T4 staging→prod |
| [criterios-projeto-classificacao](criterios-projeto-classificacao.md) ◀ | 🟡 **codado (T1–T8) + na STAGING**, NÃO em prod/mergeado — agente validado; falta o caminho `claro_nao → Reprovado` (bloqueado pelo loop de cota, **corrigido 30/07** — re-rodar o cenário) | Critério de projeto (nota do Rafa): 2 perguntas-chave na Etapa 2 (moveu o ponteiro? + onde verificar · se desligar hoje quem reclama) + "que processo mudou e quanto" no agente; analisador classifica **claro sim / claro não / zona cinzenta** com justificativa SEMPRE; `claro não` → **Reprovado** na planilha + `Motivo Reprovado`; colunas novas `Classificação`/`Motivo Reprovado`/`Motivo Reenvio`; **formulário continua não barrando** |
| [loadings-dashboard-admin](loadings-dashboard-admin.md) | ✅ **concluído** (2026-07-28) — PR #215 mergeado, staging+prod | Tirar a espera percebida do `/dashboard`: stale-while-revalidate no servidor, cache de auth em `sessionStorage`, leitura da planilha em paralelo com o auth e skeleton no lugar do spinner (sem cache em SQLite — planilha segue fonte única) |
| [dashboard-admin-sheets](dashboard-admin-sheets.md) | ✅ executado (2026-07-28) — staging+prod deployados; **PR ainda não aberto** (bloqueio local do `gh pr create`) | Dashboard do admin vira triagem sobre a **planilha** (lia SQLite → mostrava rascunho e status errado): busca/filas/paginação, ficha com todas as colunas e mudança de status gravando no Sheets + auditoria `admin_status_log` |
| [perguntas-agente-recorrencia-evidencia](perguntas-agente-recorrencia-evidencia.md) | ✅ **aprovado** (Luis, 2026-07-28) — T1 já executado | Melhorar as perguntas dos agentes **e o fluxo de coleta** (onde cada informação é colhida: form × conversa × já sabido) embutindo recorrência/contrafactual/rastreabilidade (nota do Rafa); **barrar submissão está FORA em definitivo**; baseline medido em 24 conversas reais → `docs/analise-perguntas-agente.md` |
| [aceitar-zip-submissao](aceitar-zip-submissao.md) | ✅ executado (2026-07-22) | Aceitar upload de .zip na Etapa 2 — descompactar no cliente (fflate) e reusar o pipeline de addFiles (node_modules/whitelist/tokens); caso Rafael Lobo |
