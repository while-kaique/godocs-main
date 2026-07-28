# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

**Última sessão:** 2026-07-28 (código) — **`/dashboard` do admin virou a tela de triagem sobre a PLANILHA**,
branch `feat/dashboard-admin-sheets`, commit `5ef927a`. A tela lia o **SQLite** (`getProjetos` →
`getProjetosWithArea`) e por isso mostrava **rascunho** e um **status que não é fonte de verdade** (o sync
reverso exclui `status` de propósito). Agora lê `readAllRows()`. Entregue: busca instantânea
(projeto/autor/e-mail/ID/área, sem acento, tokens em AND, atalho `/`), **filas de status com contagem ao
vivo**, ordenação, paginação 25/50/100, **ficha em overlay** com a linha inteira agrupada (coluna
desconhecida cai em "Outras colunas") e **mudança de status gravando no Sheets** + auditoria
`admin_status_log`. **620 testes verdes** (29 novos), `build` + `build:worker` OK, `worker.js` recomitado,
spec `spec-docs/SPEC_DASHBOARD_ADMIN.md` (D1–D8) + `CLAUDE.md`/`docs/` atualizados. Também **removido o
aviso do BUG ABERTO de edição de legado** do `CLAUDE.md` — o Luis confirmou que já foi resolvido.

_(Antes desta: 2026-07-22/23 — `aceitar-zip-submissao` executada, mergeada (PR #213) e em prod.)_

## Plano ativo
**Nenhum plano `aprovado` pendente de código.** [`dashboard-admin-sheets`](plans/dashboard-admin-sheets.md)
está **✅ executado** (T1–T7). **Falta o T8, que não é código:** deploy no **STAGING `edf400b4`** → validar
no navegador → **PROD `674a3710`** → PR (regras 13 e 10). Nova frente de código → `/ggsd:plan` primeiro.

_(Executados recentes: [aceitar-zip-submissao](plans/aceitar-zip-submissao.md) ✅ mergeado+prod;
[ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ mergeado (PR #210);
[edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md) ✅ executado — resta a validação T5,
ver pré-req das colunas abaixo.)_

## Próximo passo (setado)
**Deployar a branch `feat/dashboard-admin-sheets` no STAGING (`edf400b4`) e validar o novo `/dashboard` no
navegador** — só então prod (`674a3710`) e PR. ⚠️ **O MCP do Godeploy NÃO estava conectado na sessão**, por
isso o deploy não foi feito: reconectar o MCP (`getUploadToken` → `scripts/deploy-godeploy.sh
"<UPLOAD_TOKEN>"` → `updateApp` no `edf400b4`) ou o Luis roda o script. Artefatos já buildados na branch
(`dist/` + `worker.js` do commit `5ef927a`); se houver merge com `origin/main` antes do PR, **rebuildar**
(regra 10) — os hashes do Vite mudam a cada build (regra 9). PR como `LuisEduardo100` (conta WRITER — ver
memória `gh-pr-conta-writer`).

### O que validar na staging (roteiro curto)
1. `/dashboard` **não mostra nenhum rascunho** e o status de cada linha é o da coluna "Status" (vazio → "—").
2. Buscar por parte do nome do projeto **e** por autor — filtra na tecla, ignora acento; `/` foca, `Esc` limpa.
3. Filas de status (Pendente · Em validação · Reenvio pendente · Aprovado · Reprovado · Descontinuado ·
   Sem status) com contagem coerente; paginação e ordenação por Projeto/Autor/Ganho/Enviado.
4. Clicar numa linha → ficha com descrição e **todas** as colunas preenchidas; memoriais nos `<details>`.
5. Mudar o status + escrever um motivo → confere na aba **STAGING**: "Status" e "Observações" gravados,
   linha **não duplicada**, e **"Atualizado Em" INTACTA** (é o guard mais importante — aquela coluna é o
   carimbo do sistema que regulariza legado).

### ⚠️ Pendência que precisa de decisão do Luis (bloqueia o uso em prod, não o deploy)
**Os valores do dropdown da coluna "Status".** A tela grava `Pendente` · `Em validação` · `Aprovado` ·
`Reenvio Pendente` · `Reprovado` · `Descontinuado` (constante `STATUS_GRAVAVEIS`, um lugar só, em
`src/lib/dashboard-admin.functions.ts`). **"Reprovado" é palpite** — o código só conhecia `rejeitado`.
Escrever um texto fora do dropdown funciona, mas deixa a célula marcada como inválida para quem abre a
planilha. Confirmar os valores reais e ajustar a constante (+ `STATUS_TRIAGEM` no front e
`STATUS_FROM_LABEL` no sync reverso, se mudar).

### Pendência paralela (Fase 1, não é código) — colunas de papel no Sheets
⚠️ Criar **"Participantes 2"** e **"Contribuidor"** no cabeçalho das abas **STAGING** e **GoDocs (prod)** —
sem elas a IDA ignora com aviso e os papéis Participante/Contribuidor nunca chegam à fonte da verdade
("Coautor" já grava). Bloqueia o T5 de `edicao-etapa1-participantes`.

## Como retomar
1. Ler este handoff + `docs/plans/dashboard-admin-sheets.md` + `spec-docs/SPEC_DASHBOARD_ADMIN.md` (D1–D8).
2. No `CLAUDE.md`: seção **"Dashboard do admin = triagem"** (os 6 gotchas que não podem regredir) +
   "Ambiente de Staging" (regra 13).
3. Entrar no worktree `.claude/worktrees/dashboard-admin-sheets` (branch `feat/dashboard-admin-sheets`).

**Notas de ambiente desta sessão:**
- ⚠️ **`fflate` estava no `package.json` do main mas NÃO instalado** no `node_modules` da raiz → `npm run
  build` quebrava em `src/lib/submeter/unzip.ts` e 15 testes de unzip nem rodavam. Resolvido com
  `npm install` na raiz (605 → 620 testes).
- ⚠️ **Gate GGSD × worktree:** o `plan-gate.sh` só trata como `docs/**` os caminhos da **raiz** — `docs/`
  dentro do worktree conta como código. Escrever o plano na **raiz** destrava as edições **dentro** do
  worktree (regra 8 preservada); editar `docs/` do worktree exige `cp` via Bash.
- ⚠️ **`CLAUDE.md` está em 44,2 KB** (já estava em 43,9 KB antes desta sessão), acima do teto de 40 KB que
  o Claude Code avisa. Vale um passe de enxugamento (mover detalhe para `docs/`/`spec-docs/`).

**Perguntas em aberto:** ver `docs/open-questions.md` (nenhuma).
