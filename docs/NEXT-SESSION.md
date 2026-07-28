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

**Última sessão (2026-07-28, planejamento):** nova frente — **as perguntas do agente**. O pedido original
era um "agente porteiro" que barrasse submissões fora de critério (caso da **nuvem de palavras**); foi
**descartado** na conversa do Luis com o Rafa: os critérios ainda não estão fechados, e barrar sem critério
troca um problema por um pior. O alvo virou **cortar a redundância das perguntas** e embutir os 3 critérios
do Rafa (recorrência · contrafactual · rastreabilidade) nas perguntas que já existem. O **T1 foi executado
nesta sessão** (o Luis liberou o `E2E_COOKIE`): **24 conversas reais de prod** medidas em
[`analise-perguntas-agente.md`](analise-perguntas-agente.md) — **154 perguntas / 6,4 por submissão**, 62% na
fase saving, **34% vindas dos 4 gates**, 13 perguntas **depois** do preview. Dois achados que a leitura de
código não pegava: **A1** — o gate da alocação **só aceita "mais saída" e rejeita "menos custo"** (caso
`e57b287a`: usuário informou **redução de 3 auxiliares** → 5 reperguntas; `60b97477`: **corte de hora
extra** → 4), com o juiz do preview mandando recusar _"mesmo que o usuário diga aprovado"_ **sem contador
anti-loop**; **A2** — os gates **ignoram materialidade** (`897df986` economiza **0,05h/mês** e recebe o gate
das 220h/fim de semana), contra a regra que o próprio prompt já tem. **Nenhum código alterado.**

## Plano ativo
**→ [docs/plans/perguntas-agente-recorrencia-evidencia.md](plans/perguntas-agente-recorrencia-evidencia.md)**
· Status: **rascunho — NÃO aprovado** (o Luis pediu para medir antes de aprovar; a medição está feita, a
decisão dele ficou pendente no fim da sessão). **A fase de código vai recusar executar enquanto for
rascunho** (RF-03).

_(Antes desta:)_ **Nenhum plano `aprovado` pendente de código.** [`dashboard-admin-sheets`](plans/dashboard-admin-sheets.md)
está **✅ executado** (T1–T7). **Falta o T8, que não é código:** deploy no **STAGING `edf400b4`** → validar
no navegador → **PROD `674a3710`** → PR (regras 13 e 10). Nova frente de código → `/ggsd:plan` primeiro.

_(Executados recentes: [aceitar-zip-submissao](plans/aceitar-zip-submissao.md) ✅ mergeado+prod;
[ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ mergeado (PR #210);
[edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md) ✅ executado — resta a validação T5,
ver pré-req das colunas abaixo.)_

## Próximo passo (setado)
**Decidir com o Luis entre (a) aprovar o plano `perguntas-agente-recorrencia-evidencia` como está e (b)
escrever primeiro a proposta de régua dos 3 critérios (T2) com os casos reais medidos, para ele levar ao
Rafa.** Recomendação: **(b)** — a régua sai forte agora que há caso real de aprovado/reprovado, e ela é
pré-requisito de qualquer código que encoste nos critérios. **A1 e A2 não dependem da régua** e podem virar
a primeira fatia de código assim que o plano for aprovado.

⚠️ **`E2E_COOKIE` renovado no `.env` nesta sessão — expira 30/07/2026 22:41 UTC.** Os 24 JSONs de conversa
estão no scratchpad da sessão (volátil); refazer a coleta depois disso exige cookie novo.

🐞 **Pendência colateral achada (fora do escopo da frente):** `GET /api/admin/investigador/projetos` está
**quebrado em prod** — HTTP 503 Cloudflare `1102` (worker sem recursos), porque
`investigador.functions.ts:225-226` chama `getChatMessages` dentro do loop para **todos os 605 projetos**
(N+1). A aba de projetos do Investigador não abre. Mesmo gênero do bug de jul/2026 na aba Edições, mas por
CPU/tempo em vez do teto de RPC. Merece plano próprio.

### Próximo passo ANTERIOR (segue valendo, outra branch)
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

### ⛔ Tentado nesta sessão e BLOQUEADO (2026-07-28, 2ª rodada)
1. **Deploy no staging:** o Luis pediu; **não foi possível** — o **MCP do Godeploy não está conectado** na
   sessão (`getUploadToken`/`updateApp` inexistentes; conferido 2×). Artefatos prontos na branch. Reconectar
   o MCP e rodar o bloco do "Próximo passo" acima.
2. **Dar admin a `bruno.bezerra@gocase.com` em prod E staging:** o Luis pediu; **não foi possível**. Tentei
   `GET /api/admin/admins` em prod com o `E2E_COOKIE` do `.env` → **HTTP 302** (cookie expirado, o edge
   redireciona pro OAuth). **Caminho recomendado (resolve os 2 ambientes, sem tela):** acrescentar o e-mail
   ao secret **`ADMIN_EMAILS`** nos apps `674a3710` **e** `edf400b4` →
   `joao.gabriel@gocase.com,joaovictor.esteves@gocase.com,kaique.breno@gocase.com,luciano.cavalcante@gocase.com,bruno.bezerra@gocase.com`.
   Alternativa (só onde houver sessão de admin, sem redeploy): `POST /api/admin/admins`
   `{"email":"bruno.bezerra@gocase.com","nome":"Bruno Bezerra"}` — pelo console do navegador logado, ou
   renovar o `E2E_COOKIE` no `.env` e o Claude dispara.
3. **Achado (frente NOVA, a planejar):** **não existe tela para gerenciar admins** — os endpoints
   `/api/admin/admins` (GET/POST/remove) existem mas **nenhum componente os consome**, e o link
   **"Configurações"** da sidebar (`_authenticated/route.tsx`) aponta para **`/configuracoes`, que NÃO tem
   arquivo de rota** (link morto). Hoje só dá para virar admin via `ADMIN_EMAILS`. Rodar `/ggsd:plan` antes
   de codar (tela de admins e/ou consertar o link).

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
