# 🔜 Handoff — próxima sessão (GoDocs)

> Deixa a próxima sessão pronta pra começar. **Atualizar SEMPRE ao fim de cada sessão.**
> Este doc é o **ponteiro enxuto** (ADR-026/034): o plano detalhado mora em `docs/plans/<slug>.md`; o índice
> em `docs/plans/INDEX.md`. Ver também `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` e `spec-docs/`.

> ## 🚨 04/08 (fim da tarde) — a fila do líder foi APAGADA por cópia de prod na aba STAGING, e recuperada
>
> **Sintoma:** o Luis copiou prod → aba `STAGING` (para eu rodar o dry-run líder↔liderado), depois restaurou
> a versão de testes — e a tela do líder continuou vazia. **Não era bug da tela.** A fila mora em
> `projeto_aprovacoes`, tabela INTERNA (o Sheets é só espelho do veredito), e `projeto_id` é
> `REFERENCES projetos(id) **ON DELETE CASCADE**`: os IDs de teste sumiram da aba → `reconciliarExclusoes`
> removeu os projetos (passada a carência de 1h) → **a fila foi em cascata**. Restaurar a aba recria o
> PROJETO (como legado, via sync reverso), **nunca a fila** — quem abre fila é o `abrirPreAprovacao`, chamado
> só no fim do `submeterParaValidacao`. Diagnóstico confirmado ANTES de mexer:
> `GET /api/aprovacoes/pendentes?como=lucas.queiroz@gocase.com` → `{"lidera":true,"itens":[]}`.
>
> **Recuperação (commit `eff631e`, staging `edf400b4` deployada às 13:45):** nova rota
> **`POST /api/admin/aprovacoes/reabrir`** (`requireAdmin`) + `reabrirPreAprovacoes` em
> `aprovacoes.functions.ts`. Aceita `projetoIds` **OU** `autorEmail` (**fail-closed** — não existe "reabre
> tudo"), é **`dry` por DEFAULT** (escrever exige `dry:false`) e **NUNCA sobrescreve parecer já dado**:
> projeto que já tem linha (pendente OU decidida) é ignorado salvo `forcar:true` — porque
> `abrirAprovacoesPendentes` **deleta** as linhas do projeto antes de inserir, e um reabrir cego apagaria o
> veredito do líder. Espelha `Aprovação do Líder`/`Justificativa…` no Sheets como o submit faz.
> **Aplicado:** 4 projetos do Luis voltaram à fila do Lucas (`itens: 4`, conferido pela API). ⚠️ **Saíram 4
> DMs reais** para o Lucas (DM ligada na staging e nenhum projeto tem a tag `[E2E-`, que é o que muta).
> ⚠️ Rota ainda **não** está em prod nem em PR.
>
> 🔒 **Regra nova (aprendizado):** cópia de prod por cima da aba STAGING **sempre** mata a fila, mesmo
> restaurando depois. Se precisar de dados de prod lá, **apendar** preservando as linhas de teste — e, se
> acontecer de novo, recuperar pela rota acima em vez de refazer submissões.
>
> ## 📋 Dry-run líder↔liderado (04/08, LEITURA PURA — o Luis AINDA NÃO LEU)
>
> Rodado sobre a aba STAGING (580 linhas, já com a cópia de prod) + TeamGuide ao vivo (430 pessoas, 107
> lideranças), aplicando a régua real (`construirIndiceLideranca` + `ehLideranca`). Script:
> `scratchpad/dryrun-lider.mjs` (SA do `.env` + `/teams` + membros paginados; **some com o scratchpad**).
> **76 pendentes** (`Pendente` 63 + `Reenvio Pendente` 13) = **43 com líder** (26 líderes) + **23 isentos por
> liderança (30% da fila!)** + **10 fora da TeamGuide**. Filas grandes: Natalia Pavão 6 · Murilo Guimarães 4 ·
> Igor Morais 3 · Vinicius Elias 3. Único caso de **2 líderes** (D4): os 2 do Samuel Campos (Samir Labib +
> Stefany Costa). Coluna `Aprovação do Líder` **vazia em 580/580**. Nenhum líder recebendo projeto de área
> estranha — as atribuições fazem sentido.
> ⛔ **BLOQUEIO ACHADO (precisa de ação humana):** o cabeçalho tem **`Justificativa Aprovação do Lider`**
> — *sem acento* — e o código escreve `'Justificativa Aprovação do Líder'`. Mapeamento é por nome exato →
> chave não casa → **a justificativa é descartada com aviso** (o rótulo de estado casa certo). Corrigir o
> acento na **STAGING e conferir na aba `GoDocs` de prod** antes de subir a feature.
> ⚠️ **10 sem DM:** 6 reenvios do **Glauco Bezerra** (`glaucolb@gobeaute.com.br`, e-mail fora do padrão) +
> Michael Dias ×2 e Gesiel Silva (já `ÁREA NÃO IDENTIFICADA`) + Jhenyfer Silva. Corrigir o cadastro na
> TeamGuide resolve os 10 de uma vez.
>
> 🔁 **A staging foi atropelada 3× no MESMO dia (04/08: ~09:40, 14:10 e o redeploy meu no meio).** A causa é
> estrutural, não descuido: `updateApp` **substitui a app inteira** e a branch da pré-aprovação **não está no
> `main`** — então QUALQUER deploy de outra frente apaga a tela `/aprovacoes`, e quem descobre é o Lucas, no
> 404. O 2º atropelamento (14:10, "main mergeado — investigador N+1 + reconciliação + gate de sobreposição")
> deu **404 de verdade**, não o redirect silencioso pra home do 1º — o `assetConfig` do build alheio difere.
> **Restaurado às 14:32** mergeando os 3 commits novos do `main` (`aacaa20`/`0dddda5`/`f417d5b`; só o
> `worker.js` conflita → `npm run build:worker`), **931 testes**, rota e fila (3 itens) conferidas no ar.
> ⏳ **DECISÃO PENDENTE DO LUIS** — 3 opções oferecidas: (1) combinar com o Kaique que ele mergeie a branch
> antes de deployar staging; (2) **app de staging separado só p/ esta validação** (recomendado se o Lucas for
> olhar hoje — é o único que garante que ele não bata em 404 no meio da avaliação; custo: dobrar os secrets);
> (3) aceitar e redeployar quando cair (~10 min cada). **Dados nunca correm risco** — o SQLite persiste entre
> deploys; só o código é trocado.
> ⚠️ Ele perguntou se eu "subi os testes E2E pra staging": **não** — os E2E são scripts locais; o que foi
> criado lá são 2 **projetos** (dados) via a API real. Nenhum código de teste foi deployado.

> ⏳ **AGUARDANDO SEU OLHAR (04/08 15:39):** a home passou a aceitar **`?como=<e-mail>`** (pré-visualização de
> ADMIN, o servidor ignora o param para os demais) — antes a faixa decidia só pelo e-mail de quem está logado
> e o Luis, que não lidera time, **nunca** conseguia ver a "view do chefe". Link dado a ele:
> `https://godocs-staging.devgogroup.com/?como=lucas.queiroz@gocase.com`; o `?como=` **viaja no clique** da
> faixa (prop `search` do `Link`), senão abriria a fila vazia do admin. Commit `HEAD` (código +
> staging deployada), **931 testes**; falta o veredito visual dele e, se aprovar, **1 linha na spec** (é
> extensão do D13, que já registrava o `?como=` da tela). ⚠️ **No modo preview os botões gravam de verdade** —
> decidir ali põe o e-mail do ADMIN em `decidido_por`, não o do líder.

**Última sessão:** 2026-08-04 (tarde) — **a fila do líder virou um SLIDER de 1 projeto por vez** (pedido do
Luis). Mudança de UI pequena e fechada, **só na tela `/aprovacoes`**; nada de servidor mudou (sem
`build:worker`). Commits `0eeaf89` (código) + `6110630` (spec/CLAUDE.md), **931 testes verdes**, staging
`edf400b4` redeployada às 11:46 e o bundle conferido no ar (`getAppFile` → `BarraFila`/`decididos` presentes).

1. **O problema:** com 12 projetos empilhados o líder rolava a tela procurando onde parou e não sabia quanto
   faltava — o oposto do "mais fácil, rápido e intuitivo possível" que motivou o D13.
2. **O que existe agora:** barra no topo com **`3 de 12`** + **um traço por projeto** (colorido pelo parecer
   já dado, clicável para saltar), **um** card na tela e, ao decidir, **salto automático para o próximo sem
   parecer** + scroll ao topo.
3. ⚠️ **A decisão que mais importa não regredir — o total NÃO encolhe ao decidir.** O `useEffect` que
   sincroniza com o servidor é **append-only** (só acrescenta projeto novo) e o item decidido **fica** no
   slider em modo leitura (faixa "Você pré-aprovou…" + checklist desabilitado). Se a lista encolhesse,
   `3 de 12` viraria `3 de 11` no meio do caminho e o líder perderia a referência de progresso — além de não
   poder voltar para rever o próprio parecer. O cache do React Query **perde** o item (a fila do servidor não
   o traz mais); quem preserva é o estado local (`fila` + `decididos` + `indice`).
4. **Navegação em 3 vias:** botões no topo, botões no pé do card ("Projeto anterior" / "Decidir depois") e
   as setas `←`/`→` do teclado — **ignoradas dentro de `INPUT`/`TEXTAREA`**, senão brigariam com o cursor da
   caixa de ajuste. Fila **> 20** projetos → os traços viram barra de progresso (40 traços de 3px não se
   clicam nem se leem).
5. **A11y/identidade:** animação reusa `go-step-in`/`go-step-in-back` das etapas do formulário (mesmo gesto
   de "avançar" do produto) e o estado **nunca fica só na cor do traço** — a contagem "2 pré-aprovados ·
   1 ajuste pedido" está escrita e cada traço tem `aria-label`/`title` com nome do projeto + situação.
6. ⚠️ **Numeração das decisões da spec estava com um buraco:** o **D14** (duas colunas no Sheets, estado ×
   justificativa) vivia só no código (`dc53193`) e na memória, **nunca na spec** — foi escrito agora, e o
   slider ficou como **D15**. Conferir a tabela da spec antes de inventar o próximo número.
7. **Pergunta do Luis respondida (sem código):** a entrada da tela **não** depende da DM — é a faixa na
   **home** (`src/routes/index.tsx:289`), visível só para quem `lidera` na TeamGuide, e ela aparece **mesmo
   com a fila vazia**. Não existe item de menu: de outra tela, o líder tem que voltar em "← Início".
   **Oferta em aberto:** atalho fixo no cabeçalho com o número de pendentes (mudança pequena).
8. **Onde aterrissou:** `src/routes/aprovacoes.tsx` (novo componente `BarraFila`; `CardAprovacao` ganhou
   `decidido`/`proximoPendente`/`podeVoltar`/`podeAvancar` e uma Zona 3 de navegação) ·
   `spec-docs/SPEC_APROVACAO_LIDER.md` (D14 + D15 + nota no F1) · `CLAUDE.md` (seção da pré-aprovação).
9. ⚠️ **O `CLAUDE.md` está em 62 kB** — muito acima do teto de 40 k em que o Claude Code avisa (ver
   memória `claude-md-limite-40k`). Não mexi além do parágrafo da feature; **vale uma faxina em sessão
   própria**, movendo detalhe para `docs/`/`spec-docs/`.
10. **O que NÃO mudou:** nenhum arquivo de servidor, nenhuma rota de API, nenhum teste novo (a mudança é de
    apresentação — o `decidirAprovacao` e o checklist obrigatório seguem intactos). Prod continua **sem** a
    feature e a branch segue **sem push e sem PR** (trava da diretoria).

---

## Sessão de 2026-08-04 (manhã) — staging atropelada de novo, restaurada, e fila do líder populada
com 2 projetos mockados.** Zero mudança de comportamento no produto: a sessão foi diagnóstico + integração +
seed de dados.

1. **O sintoma:** nem o Luis nem o Lucas abriam `/aprovacoes` na staging. **Causa:** um deploy de outra
   frente (Kaique) sobrescreveu o `edf400b4` com um build **sem a rota** — `updateApp` troca a app inteira.
   ⚠️ **O sintoma engana:** `/aprovacoes` responde **200** (é o fallback SPA servindo o `index.html`) e o
   TanStack, sem a rota no bundle, devolve o usuário pra `/`. Nada de 404 na cara.
2. **Diagnóstico sem navegador (vale guardar):** `getAppFile(edf400b4, asset, /index.html)` → pega o
   `index-<hash>.js` → `grep aprovacoes` nele. Zero ocorrências = build errado no ar. Comparar com o
   `dist/` local fecha o caso em 2 comandos.
3. **Integração:** mergeado `origin/main` (11 commits do Kaique, PRs **#224–#227** — gate do critério +
   seção `[1.4]`) na branch. **Só o `worker.js` conflitou** (artefato de build) → resolvido com
   `npm run build:worker`. **891 testes verdes** (861 meus + 30 dele).
4. **Staging redeployada** (`edf400b4` apenas; prod `674a3710` **não** foi tocada) e a rota confirmada no ar.
5. ⚠️ **Armadilha de smoke test que custou um redeploy inteiro:** `curl` **sem `Accept: text/html`** dá
   **404** em toda rota profunda — o fallback SPA só atende requisição de navegação. Isso **não** é
   regressão nem `assetConfig` faltando. Sempre mandar o header ao testar rota de SPA por curl.
6. **Fila do Lucas populada com 2 mockados** (pedido do Luis: ver a tela com mais de um pendente), criados
   pelo **fluxo real** do formulário — chat com o agente, memorial gerado, gates de jornada/critério
   passando —, não por INSERT no banco. Script em scratchpad (não versionado), reusando
   `scripts/e2e/lib/{api,responder}.mjs`.
   - ⚠️ **Nome SEM o prefixo `[E2E-`** de propósito: `ehProjetoTesteE2E` silencia a DM, e o Luis quis a
     **DM real** pro Lucas. Efeito colateral: **o `e2e-cleanup` não pega esses 2** — a limpeza é manual, e
     **planilha ANTES do SQLite** (senão o sync reverso ressuscita).
   - ⚠️ **O harness aponta pra PROD por default** (`E2E_BASE_URL` ausente → `godocs.devgogroup.com`) e a
     **worktree não tem `.env`** — foi assim que 3 projetos de teste caíram em prod em 30/07. O script novo
     **aborta** se o BASE_URL não for o da staging.
   - Fila atual (3 itens, todos do Luis): **Alerta de ruptura de estoque** (15h, R$ 1.519,35, custo evitado
     R$ 1.200 — o card com mais números) · **Baixa automática de NF-e** (34h, R$ 857, 2 cargos no memorial) ·
     **n8n audit** (40h, R$ 431,20 — o que já existia).
7. **Aberto para o Luis confirmar:** se as 2 DMs chegaram ao Lucas e **se o link delas abre a staging**
   (`mensagemDmAprovacao` usa `APP_BASE_URL`, que está setado no `edf400b4`, mas o valor do secret não é
   legível — se apontar pra prod, o Lucas cai numa app sem a tela).
8. ⚠️ **Se o Lucas decidir via `?como=`, o `decidido_por` grava o ADMIN**, não ele — para a validação valer
   como o gestor, ele entra com a própria conta em `/aprovacoes`.

**Última sessão anterior:** 2026-08-03 (noite) — **atendeu as ressalvas do Lucas na tela de pré-aprovação (D13).**
O Lucas abriu `/aprovacoes` na staging e apontou 4 coisas: "a visualização não tá legal", "não é uma
aprovação e sim uma **pré**-aprovação", "o gestor tem que responder algumas perguntas com sim e não" e "o
card já tem que vir com as principais informações — dono, participantes, valor total de saving, memorial".
Tudo implementado no commit **`1d3aeb2`** (856 testes verdes, +6 novos; `worker.js` rebuildado; **staging
`edf400b4` redeployada às 16:26**):

1. **Nomenclatura pré-aprovação** em toda a UI, na home, no card do autor e na planilha
   (`Pré-aprovado` / `Ajuste pedido` / `Pré-aprovação pendente com…` — nunca mais `Aprovado`/`Reprovado`).
2. **Card auto-suficiente:** dono (+ área), participantes **com papel**, **saving em destaque (R$ + horas,
   unidade por cadência)**, descrição e **memorial expansível** dentro do card. Ler a doc completa virou opção.
3. **Checklist do gestor — 3 perguntas sim/não** (*move KPI da área? · a área sentiria falta se fosse
   desligado? · o saving é coerente com o impacto?*), **obrigatórias no servidor** (`decidirSchema`) nos DOIS
   vereditos e anexadas ao rótulo do Sheets. Um "não" **não** reprova sozinho (a tela diz isso). Textos em
   **`src/lib/aprovacoes-checklist.ts`** — módulo PURO, FONTE ÚNICA (tela + Sheets), não redigitar.
4. **`/aprovacoes?como=<e-mail>` — pré-visualização só de ADMIN** da fila de outra pessoa: foi assim que o
   Luis viu a tela "como o Lucas". Decidindo nesse modo, o **`decidido_por` grava o admin**, nunca o líder.

**Rodada 2 da mesma sessão (16:35, staging redeployada, 859 testes)** — 4 ajustes pedidos pelo Luis depois
de ver a tela: (a) o card mostra **todos os números do ganho** (ganho total em destaque + recorrência ao lado;
horas economizadas, saving em R$, custo evitado, receita mensal e custo externo com "−", cada linha só quando
existe) nas MESMAS fontes do sync do Sheets — custo evitado e receita saem do JSON da `documentacao`
(`extrairNumeros`, pura, 3 testes), pois não há coluna em `projetos`; (b) **"Ler a documentação completa" abre
em nova aba** (`<a target="_blank">`, não `<Link>`) p/ não perder o checklist marcado; (c) **sem participantes
a coluna nem aparece**; (d) saiu da DM a frase "a triagem da equipe RPA segue em paralelo…".

⚠️ **Exceção consciente que precisa de confirmação:** o líder vê o **saving em R$** — sem o número não há
como responder a 3ª pergunta. Isso contraria "cliente não vê R$ de saving"; reverter para só-horas é 1 linha.
⚠️ **`CLAUDE.md` está em 52 kB** (limite prático 40 kB) — pré-existente, merece PR de enxugamento próprio.
⚠️ **A DM da staging é REAL** — submeter lá para testar notifica o Lucas de verdade.

_Sessão anterior:_ 2026-08-03 (manhã) — **planejamento da pré-aprovação do líder (integração TeamGuide) + entrega
conjunta das 2 frentes fechadas na STAGING**. Investigação ao vivo da API TeamGuide (os endpoints de
liderança dão **403**; a relação líder↔liderado sai de `/teams` + membros), spec nova
`spec-docs/SPEC_APROVACAO_LIDER.md` (D1–D10), plano **F0 aprovado** (não codado) e staging `edf400b4`
deployada com `fix/motivo-reenvio-traco` + os docs desta frente. **PR ainda não aberto** — espera a
validação humana.

> ✅ **DESBLOQUEADO (16:53:37) — staging no ar com o build INTEGRADO.** `origin/main` mergeado na branch
> (já continha `fix/remove-pergunta-o-que-piora`, a frente que havia atropelado a staging às 16:40 — ninguém
> perdeu nada); conflito só no `worker.js` (gerado), resolvido por rebuild. **861 testes verdes**, commits
> `bc3b77a` (+ merge). ⚠️ **LIÇÃO DE DIAGNÓSTICO:** `curl` sem `Accept: text/html` devolve **404 em TODAS** as
> rotas SPA (`/meus-projetos` inclusive) — o fallback do Godeploy só vale para requisições de NAVEGAÇÃO. Meu
> teste inicial era inválido; com `-H "Accept: text/html" -H "Sec-Fetch-Mode: navigate"` a rota responde 200.
> O 404 que o Luis viu no navegador era real e vinha do atropelo, não da tela. ⚠️ Antes de deployar staging,
> rode `getApp(edf400b4)` e compare `updatedAt`/descrição.
>
> 🆕 **Rodada 3 (17:01, staging `edf400b4`, commit `58aab6c`, 861 testes)** — ajustes do Luis vendo a tela:
> as **2 boxes de explicação saíram** (o essencial virou 1 linha no header; o aviso de pré-visualização de
> admin virou destaque lime na mesma linha), **header baixo** (108px, onda 26px) para o card caber sem rolar,
> **resumo da ANÁLISE AUTOMÁTICA** (`analises.resumo`, subquery pela mais recente) abaixo do ganho total e
> **um card por número** (horas · recorrência · saving R$ · custo evitado · receita · custo externo com "−"),
> com **"Não declarado"** quando o campo está vazio (antes a linha desaparecia).
>
> ❓ **Perguntas do Luis respondidas (podem virar pedido):** pré-aprovar/pedir ajuste gravam o veredito em
> todas as linhas do projeto + a coluna `Aprovação do Líder` (com o checklist no texto), tiram o item da fila
> e mostram o selo no card do autor; **`Status` não é tocado** e a triagem da RPA segue. Um **"não" no
> checklist NÃO bloqueia** a pré-aprovação (viaja no texto para a triagem). **O pedido de ajuste NÃO notifica
> o autor** — ele descobre ao abrir o GoDocs. ⚠️ **Adição pequena em aberto: DM ao AUTOR quando o líder pede
> ajuste** (o Luis perguntou; eu ofereci e ele não respondeu ainda).
>
> 🆕 **Rodada 4 (17:06, commit `a786f6c`)** — header ficou só com "← Início" + título e um **`i` (InfoTooltip)**
> ao lado de "Pré-aprovações do meu time" explicando a página em 3 frases **sem travessões** (pedido explícito
> do Luis); a linha de subtítulo saiu inteira, levando com ela o aviso de pré-visualização de admin; o rótulo
> virou só **"Resumo do projeto"** (sem "(análise automática)").
>
> 🆕 **Rodada 5 (17:11, commit `dc53193`) — DUAS COLUNAS no Sheets (combinado com o Luis):**
> **`Aprovação do Líder`** passa a guardar **SÓ o estado** (`Pré-aprovado` · `Pré-pendente` ·
> `Pré-reprovado`), e o detalhe (quem, quando, as 3 respostas do checklist, comentário) vai na coluna
> **NOVA `Justificativa Aprovação do Líder`**. Funções puras novas: `justificativaAprovacaoSheet` e
> `justificativaIsencaoSheet` (a D12 sobrevive: liderança = `Pré-aprovado` + motivo na justificativa;
> sem líder / TeamGuide fora = `—` no estado + motivo próprio). Tela: **7 cards no mesmo nível** (ganho
> total com barra lime, horas, recorrência, saving, custo evitado, receita, custo externo) e o **resumo
> do projeto abaixo deles, em largura cheia**.
> ⚠️ **PENDÊNCIA HUMANA NOVA (Luis):** criar a coluna **`Justificativa Aprovação do Líder`** no cabeçalho
> das abas **`GoDocs` e `STAGING`** — sem ela o valor é ignorado com aviso (o resto do sync segue).
>
> 🆕 **Rodada 6 (17:18 e 17:24, commits `76ffe84` / `6e93636` / `bb96b06`) — 3 correções vistas pelo Luis
> na tela + a régua do resumo.** (a) O **"i" do tooltip sumia**: era `var(--go-blue)` a 55% **sobre o header
> azul**; ganhou `tone="claro"` (branco + disco translúcido, alvo de 20px) no `InfoTooltip` — prop aditiva,
> as outras telas não mudam. (b) Os **7 cards de número** eram brancos sobre o card branco com borda de 10%;
> foram para o azul-acinzentado das outras boxes (fundo 5%, borda 12%). (c) **"Resumo do projeto" passou a
> vir do MEMORIAL** (`[1.2]`, nova pura `extrairResumoMemorial`), com o resumo da análise como fallback, e
> renderiza por `SimpleMarkdown` (os `**` crus sumiram da tela).
> ⚠️ **A primeira tentativa do (c) não funcionou e o motivo importa:** o memorial do "n8n audit" grava os
> rótulos em **TEXTO PURO** (`Resumo: …`), sem `**` nem `###` — o `tituloDaLinha` não os enxerga, a extração
> voltava `null` e a tela caía no fallback. O fix é o `extrairRotuloTextoPuro`, deliberadamente **FORA** do
> `extrairSecaoMemorial`: aquele alimenta os **gates determinísticos** do critério de projeto e da
> carga×escala, e afrouxar o casamento de título lá mudaria o que esses gates enxergam. **Não mover para lá.**
> 867 testes verdes (+6). ⚠️ **Prettier reformata `aprovacoes.functions.ts` inteiro** (o arquivo usa aspas
> simples, o config usa duplas) — não rodar nele, o diff vira ruído.
>
> 🛑 **DECISÃO DO LUIS (03/08, fim da rodada 6): NADA vai para prod nem para o repo por ora** — a ida a
> produção será validada **com a diretoria** antes. Tudo está commitado na branch
> `worktree-plano-aprovacao-lider-teamguide` (24 commits à frente do `origin/main`), **sem push e sem PR**.
> A staging segue no ar com o build atual para a demonstração.
>
> **▶ PRÓXIMO PASSO — o Luis olhar a tela na staging (redeploy 16:35) em
> `https://godocs-staging.devgogroup.com/aprovacoes?como=lucas.queiroz@gocase.com` (pré-visualização de
> admin da fila do Lucas — a fila real tem o projeto "n8n audit" do Luis, 40 h/mês · R$ 431,20) e, com o ok
> dele, deployar **prod `674a3710`** e abrir o PR.** Se ele quiser o saving só em horas, é 1 linha antes de
> subir. O código de **F0 + F1 + F2 + D11/D12/D13 está pronto e commitado** na branch
> `worktree-plano-aprovacao-lider-teamguide`: tabela `projeto_aprovacoes` (+3 colunas do checklist),
> `aprovacoes.functions.ts`, `aprovacoes-checklist.ts`, rotas `/api/aprovacoes/*`, tela **`/aprovacoes`** +
> faixa na home (só p/ quem lidera), selo no card do autor, coluna **`Aprovação do Líder`** no Sheets e a DM
> (`google/chat-dm.ts`) — **ligada na staging**, no-op em prod (sem os secrets).
>
> **D11 escrita na spec** (decisão do Luis): quem **já é liderança** (aparece como `leader` de um time ativo
> na TeamGuide → `ehLideranca`) fica **ISENTO** — não entra em fila e não recebe DM. Só o liderado de fato
> precisa, e quem aprova é o **líder direto**, nunca o líder do líder.
>
> **Esclarecido com o Luis (03/08, fim da sessão):** para uma **liderança** (ex.: Lucas Queiroz), "isento"
> significa **ninguém vê fila nenhuma** — sem DM, coluna `—`, e o projeto vai **direto para a triagem da
> RPA**, como era antes da feature. Se um dia quiserem que o projeto de uma liderança também apareça para
> alguém (o líder dela, ou a diretoria), a régua está concentrada em **um ponto**: a checagem de
> `ehLideranca` no topo de `abrirPreAprovacao`.
>
> **✅ DECIDIDO (03/08) — rótulo da isenção na planilha → D12 na spec.** Os 3 casos sem fila deixaram de
> compartilhar o `—`: liderança → **`Pré-aprovado (liderança)`** · autor sem líder → `Sem líder na
> TeamGuide` · TeamGuide fora → `Aprovação indisponível (integração)`. Mora na função pura
> **`rotuloIsencaoSheet(motivo)`** (`aprovacoes.functions.ts`), consumida pelo `semFila`; o `motivo` já
> vinha pronto. **Comportamento inalterado** — liderança continua sem fila e sem DM, e o card do autor
> **não** ganha selo (decisão do Luis: a feature é invisível para quem é isento). ⚠️ A coluna `Status`
> NÃO é tocada pela feature em nenhum caso (segue "Pendente" pela regra temporária). 848 testes verdes,
> `worker.js` rebuildado. **Este rótulo entra na validação da staging** (caso 2 abaixo).
>
> **✅ STAGING PRONTA PARA O TESTE REAL (03/08, 15:39)** — `edf400b4` redeployada com o worker atual
> (inclui a D12) e a **DM LIGADA**: secrets `GOOGLE_CHAT_DM_ENABLED=true`, `CHAT_SA_CLIENT_EMAIL`,
> `CHAT_SA_KEY_BASE64`, `GOOGLE_CHAT_DM_SUBJECT=rpa_ia@gocase.com`. Cadeia validada ao vivo (troca de
> JWT + `spaces:setup` + post; DM de teste recebida pelo Luis). Aprovador esperado do Luis:
> **Lucas Goncalves Queiroz / lucas.queiroz@gocase.com** (`leader` do time RPA `43718`; o Luis é membro
> direto e não lidera time → não cai na isenção). ⚠️ **Submeter na staging manda Chat REAL para o
> Lucas.** Prod continua sem os secrets (DM no-op) e sem a feature.
>
> **O que validar na staging:** (1) submissão de um liderado → fila abre + coluna "Pendente com X";
> (2) submissão de uma liderança → coluna **"Pré-aprovado (liderança)"** e nenhuma fila/DM; (3) `/aprovacoes` lista, aprova e pede ajuste
> (comentário obrigatório na reprovação); (4) o autor vê o selo no card. **Pré-requisito do Luis (P2):**
> criar a coluna **`Aprovação do Líder`** no cabeçalho das abas `GoDocs` e `STAGING`.

> _Passo anterior:_ **validar o "—" RODANDO EM PRODUÇÃO** (`https://godocs.devgogroup.com/`, deploy
> 2026-08-03 13:00). Decisão do Luis: a aprovação do "—" acontece em prod, não na staging. Depois dela:
> **codar a F0** (plano aprovado) e **escrever a D11** em `spec-docs/SPEC_APROVACAO_LIDER.md` — a fila do
> líder vira **entrada própria no menu com selo de contagem** (visível só a quem lidera alguém), **não** a
> 5ª aba de "Meus Projetos" que a spec ainda descreve.
>
> ✅ **ENTREGUE em 2026-08-03:** staging `edf400b4` (12:38) → **PR #221 mergeado** (`main` `c65e5a1`) → **prod
> `674a3710`** (13:00), servindo `index-CzawDJZX.js` — mesmo artefato nos dois ambientes, sem rebuild no meio.
> Nada pendente de envio.
>
> ⚠️ **Aprendizado desta sessão (custou um commit indevido na `main` local, revertido sem push):** no
> diretório RAIZ, **nunca `git add -A`** — ele arrasta `.claude/worktrees/` como 8 repos git embutidos. O
> `.gitignore` passa a cobri-los; ainda assim, use caminhos explícitos no `git add`.

<details><summary>Instruções da validação em staging (superadas pela decisão de validar em prod)</summary>
> No `/dashboard`: apagar um motivo/parecer deve gravar **"—"** (não branco) e projeto novo nasce com
> "Motivo Reenvio" = "—". A staging grava na aba **`STAGING`** (planilha própria, não a de prod).
> Depois do merge: prod `674a3710`. `gh` precisa da conta **`LuisEduardo100`** (a `rpaiagogroup` é read-only).
> Só **depois** disso a **F0** entra em código (plano já aprovado).

</details>

> **O que validar (e o que NÃO existe ainda):** o único comportamento novo na staging é o **"—"** da coluna
> "Motivo Reenvio" — append e append de recuperação nascem com "—" (`sync.ts:411/440`), o **update da edição
> nunca toca** a coluna (é manual, `sync.ts:147`), apagar motivo/parecer no `/dashboard` grava "—", e o e-mail
> de reenvio não sai mais com o literal "Motivo: —". ⚠️ **Sem backfill**: linhas legadas já em branco
> **continuam em branco** (fronteira do plano, não esquecimento) — preencher o histórico é retroativo à parte.
> Da frente da **pré-aprovação do líder** subiu **só documentação** (spec, `.gitignore`, docs vivos) —
> **zero mudança de comportamento**: nada de `projeto_aprovacoes`, aba de aprovações ou `chat-dm.ts`, e as 10
> pessoas seguem em "ÁREA NÃO IDENTIFICADA" com a paginação lendo 25.

<details><summary>Sessões anteriores (histórico)</summary>

**Sessão de 2026-07-31** — **OPERAÇÃO em produção, sem mudança de código**: 3 diagnósticos
(lógica da classificação de elegibilidade · projeto da Nyara que **desapareceu** de "Meus Projetos" ·
**dupla contagem de R$ 161.913,78** no Sucesso.AI da Maria) e **1 correção aplicada em prod** (planilha +
SQLite). Ver "Sessão de 2026-07-31" abaixo.

> **▶ PRÓXIMO PASSO — varrer o Drive × planilha para achar outros projetos purgados como o da Nyara**
> (read-only, sem código: comparar os arquivos da pasta `1e_Fk8…` contra os IDs/nomes da aba `GoDocs`) **e
> decidir a recuperação dela** — reenvio pela app ou recriação manual da linha a partir da doc do Drive.
> É perda de dado **silenciosa**: some das duas fontes sem aviso, e só reclamação do autor revela.
> **Candidato a frente de CÓDIGO** (exige `/ggsd:plan`): **gate anti-dupla-contagem `custo evitado × receita`**
> — hoje o único bloco anti-dupla-contagem compara *horas × custo evitado*, e a fase de receita **não relê**
> os itens do custo evitado; foi exatamente o buraco do Sucesso.AI.

</details>

## Plano ativo
**→ [docs/plans/teamguide-lideranca-e-areas.md](plans/teamguide-lideranca-e-areas.md)** · Status: ✅ **executado** (código na branch `worktree-plano-aprovacao-lider-teamguide`, 2026-08-03)

> **F0 + F1 + F2** da pré-aprovação do líder (spec: `spec-docs/SPEC_APROVACAO_LIDER.md`, D1–**D12**):
> índice de liderança da TeamGuide + os 2 bugs do caminho (paginação morta · "ÁREA NÃO IDENTIFICADA" em
> 10 pessoas) + tabela/rotas/tela `/aprovacoes` + DM. **Codado e na staging.** O que resta do plano é
> **validação humana**, depois prod e PR — não há fatia de código pendente. 🛑 **Desde 03/08 à noite a ida
> a prod está TRAVADA até a validação com a DIRETORIA** (decisão do Luis): branch commitada, sem push/PR.
> **04/08:** o `origin/main` (PRs #224–#227) foi mergeado na branch e a staging redeployada; a fila do Lucas
> tem **3 itens pendentes** (2 mockados criados de propósito) esperando ele abrir com a **própria conta**.
> **04/08 (tarde):** a fila virou **slider de 1 projeto por vez** (D15 — ver "Última sessão"), redeployada;
> continua sendo a MESMA validação humana pendente, agora com a tela nova.
> ⚠️ Os hooks do GGSD resolvem o projeto pela **raiz** do repo — os docs vivos e a flag
> `.claude/.planning-mode` ficam aqui; o código vai para worktree (regra 8). Ver "Nota de ambiente" no plano.

### ⏭️ ANTES da F0 — entrega conjunta das 2 frentes fechadas (decisão do Luis, 2026-08-03)
Duas frentes estão **prontas e não entregues**, e vão **juntas** (deploy de staging substitui a app INTEIRA —
subir uma sozinha apaga a outra):
1. **`fix/motivo-reenvio-traco`** (commit `a6e19f1`, worktree `.claude/worktrees/fix-motivo-reenvio-traco`) —
   o T5 do plano [motivo-reenvio-traco-padrao](plans/motivo-reenvio-traco-padrao.md).
2. **`worktree-plano-aprovacao-lider-teamguide`** (commit `81da73d`) — só docs: `spec-docs/SPEC_APROVACAO_LIDER.md`
   + `.gitignore` (o `GOOGLE-CHAT-DM.md` tem **chave privada de SA em texto puro** e estava rastreável).

**Sequência:** juntar as duas + `origin/main` → `npm run test` → `build` + `build:worker` → **staging
`edf400b4`** → **validação humana do Luis** → **PR + merge**. Prod (`674a3710`) fica para depois da
validação. ⚠️ Conferir qual branch está no ar na staging antes de subir.

**Estado desta fatia:** branch `fix/motivo-reenvio-traco` no worktree
`.claude/worktrees/fix-motivo-reenvio-traco`, commit **`a6e19f1`** — `sync.ts` (append e append de
recuperação inicializam a coluna com "—"; **update da edição NUNCA a toca**), `ouTraco` no write-back do
`/dashboard` (motivo/parecer apagado grava "—"), `motivoDaCelula` no `email-legados` (o e-mail de reenvio
podia sair com _"Motivo: —"_ — defeito latente achado junto), `CLAUDE.md` (gotcha 4 reescrito),
`SPEC_CORRECOES.md` e 3 arquivos de teste. **805 testes verdes**, `worker.js` rebuildado e commitado.
**Sem backfill** das linhas legadas já em branco (fronteira registrada no plano).

⚠️ **Estes docs (`NEXT-SESSION.md`, `plans/INDEX.md`, `plans/motivo-reenvio-traco-padrao.md`) estão
NÃO-COMMITADOS de propósito:** o diretório principal está em `main` (RF-18 proíbe commitar lá) e a frente
paralela está trabalhando nele — nenhuma operação de git foi feita aqui para não atropelá-la. Quem retomar:
commite-os junto do T5 (ou na branch da frente que estiver ativa).

_Antes desta fatia:_ **Nenhum** — nenhum plano em `aprovado` esperando execução (todos os de `docs/plans/INDEX.md` estão
concluídos/executados, e o `perguntas-agente-recorrencia-evidencia` segue 🟡 parcial com T3/T4 abertos por
decisão do Luis). O próximo passo desta sessão é **operacional** (varredura Drive × planilha), não precisa de
plano. Voltar a codar → `/ggsd:plan` primeiro (candidato: gate anti-dupla-contagem `custo evitado × receita`).

> **Contexto de código herdado — nenhuma frente aberta (decisão do Luis, 2026-07-30).** O GoDocs está com o
> backlog de implementação **zerado por ora**: a fatia A1 fechou (PRs #217/#218 mergeados; staging, prod e
> `main` sincronizados) e o **A2 foi DESCARTADO** — ver abaixo. O que resta é **humano**: (1) alinhar com o
> **Bruno** as 2 pendências de decisão da seção seguinte (onde as perguntas-chave de critério vivem · a
> "exceção projetos especiais" no limite de 1 coautor) e (2) calibrar a régua do critério com o **Rafa**,
> agora que ela reprova em produção e o autor vê o motivo.
> **Antes de abrir qualquer código novo:** existe **1 commit de docs à frente do `main`** nesta branch
> (`docs/plano-loadings-dashboard-admin`) — abrir PR ou levá-lo junto do próximo.
> **Se e quando voltar a codar**, as fatias ainda vivas, em ordem de valor: **(a) auto-preenchimento da
> Seção 2.4** (o agente escreve o destino do ganho SEM perguntar e INVENTA — suja o memorial e a coluna
> "Alocação Ganhos" com fala que não é do usuário; é qualidade de dado, o que a gestão lê) · **(b) piso
> `respostaAlocacaoVaga`** (recusa resposta válida misturada com filler — custa 1 repergunta; fronteira que
> exige confirmação do Luis). Qualquer uma começa com `/ggsd:plan`.

### ❌ A2 (materialidade nos gates) — DESCARTADO em 2026-07-30 (decisão do Luis)
Era: pendurar um piso de materialidade em `aplicaConfirmacaoBaseHoras`/`aplicaSplitCargaEscala`, que hoje
disparam com qualquer `horas_antes > 0` (um projeto de 0,05h/mês leva o gate das 220h). **Fora** porque:
**(1)** é o mesmo diagnóstico da "jornada preguiçosa", que o Luis **já havia recusado** em 30/07 — aprovar o
A2 reabriria aquela decisão; **(2)** o ganho é de **1–2 perguntas baratas** (a jornada aparece como opção
clicável, e o split **deixou de ser gate determinístico** em 03/07 — metade do alvo já estava desarmada);
**(3)** pendurar materialidade no teto das 220h **enfraquece** um guard que existe para barrar número
impossível — troca ruim (risco de dado errado por menos um clique). Reabrir exige plano próprio.

## ⏳ Pendentes de DECISÃO do Luis — cobrança do Bruno (chat, 2026-07-30)

Conferência dos pontos **em azul** da mensagem do chefe contra o código **em produção** (os azuis foram
entregues no **PR #216**, não nesta sessão; a A1/PR #217 é a fatia seguinte):

| Ponto do Bruno | Estado real | Pendência |
|---|---|---|
| 1) perguntas-chave de critério **no forms** | ✅ as 3 existem, mas só *"se desligar hoje quem reclama?"* está **no formulário** (Etapa 2). *"que processo mudou e quanto"* e *"moveu ponteiro de custo/receita/KPI"* são conduzidas pelo **AGENTE** (seções `[1.3]`/`[1.4]`) — decisão **R1 do Luis, 29/07**: rastreabilidade não se resolve com checkbox | **DECIDIR:** manter no agente (como está) ou levar para o formulário como ele escreveu. ⚠️ Voltar aos cards de ponteiro na Etapa 2 é explicitamente proibido hoje no `CLAUDE.md` |
| 2) classificar avaliação em 3 | ✅ `claro_sim`/`zona_cinzenta`/`claro_nao` em prod, calibrado (a nuvem de palavras **é reprovada**), `claro_nao` → "Reprovado" + Motivo | nenhuma (só a pendência humana: calibrar com o Rafa) |
| 3) máx. **1 coautor** *(exceção projetos especiais)* | ✅ limite implementado (`coautoresSelecionados`/`limitarCoautorUnico`, `constants.ts`) — ⚠️ **SEM a exceção para projeto especial** e a trava é **client-side** (o sync reverso ainda pode trazer 2+ coautores num legado) | **ESPECIFICAR a exceção** antes de codar; decidir se precisa de trava server-side |

**Não-azuis, seguem abertos:** % participante 75→50 · % contribuidor 50→25 · rotina com lideranças
(discutir zona cinzenta + relatório de inconsistências).

## Sessão de 2026-07-31 — operação em produção: 3 diagnósticos + 1 correção de dado

**Sessão sem mudança de código.** Nenhum arquivo de `src/` tocado, nenhum deploy. O que mudou foi **dado
de produção** (planilha + SQLite) e estes docs.

### 1. Como a coluna "Classificação" decide (só explicação, nada mexido)
Duas camadas. O **LLM** julga por 3 critérios (recorrência · contrafactual · rastreabilidade) e o prompt
(`analyzer.ts:252-278`) dá o desfecho: `claro_sim` = os 3 se sustentam (ou 2 + o 3º inferível) · `claro_nao`
= falha **evidente** em recorrência **E** rastreabilidade/contrafactual, "com PARCIMÔNIA" · `zona_cinzenta`
= **default de qualquer dúvida**, com a **exceção declarada** do par recorrência+contrafactual falhando
junto (foi o que passou a reprovar a nuvem de palavras). Depois, `normalizarClassificacao` (pura,
`analyzer.ts:512`) **só rebaixa** — nunca promove — e age **apenas sobre `claro_nao`**: sem motivo → cinzenta
· especial → cinzenta · materialidade > R$ 5k/mês → cinzenta · valor inválido → cinzenta.
⚠️ **O `motivo_reprovacao` é escrito pelo próprio agente**, não por um humano: sai no mesmo JSON, e o prompt
avisa o LLM da consequência de omiti-lo. O guard só pega o caso em que ele **desobedece o formato**.

### 2. Nyara Sato — "Consulta fiscal - IE e IM" desapareceu de "Meus Projetos" (ABERTO)
**Ela está certa: o projeto existiu e sumiu.** Não está na planilha (571 linhas), não está no SQLite de prod
(635 linhas, incl. os 64 rascunhos), nem como participante. A **única prova sobrevivente** é a doc no Drive:
`2026-07-29_180014_Consulta_fiscal_-_IE_e_IM_FINANÇAS.md` (id `1MZeuSJWJhXvjgqGKHNQErq9bnLJZkP5a`, 46 KB,
pasta de prod `1e_Fk8…`), com "Responsável: Nyara Sato" e a documentação inteira — **submissão em 29/07/2026
às 15:00** (18:00 UTC, carimbo no nome do arquivo).

**Mecanismo** (o modo de falha já documentado no `CLAUDE.md` → Sync Google): o append da IDA morreu → a linha
nunca nasceu na planilha → passada a **carência de 1h**, a `reconciliarExclusoes` purgou do SQLite em cascata.
O guard `deveRecuperarPorAppend` só age **numa edição/reenvio** — ela nunca reeditou, o purge chegou primeiro.
⚠️ **A causa do append falhado NÃO foi confirmada** (cota `429` é hipótese): o log do Godeploy só guarda ~3h
(janela lida: 31/07 14:34→17:17 UTC) e a submissão foi anteontem.

**Aberto:** (a) decidir recuperação — reenvio dela (a doc do Drive acelera a Etapa 2) **ou** recriar a linha
na planilha e deixar o sync reverso importar; o **memorial financeiro não está na doc**, tem de vir dela de
novo. (b) **varrer Drive × planilha** para achar outras vítimas — é o próximo passo desta sessão.

### 3. Maria Ponciano / Sucesso.AI — dupla contagem de R$ 161.913,78 (CORRIGIDO em prod)
Projeto `110f199139399ccd797af95aee10f165`, **linha 385** da aba `GoDocs`. O **mesmo dinheiro** estava dos
dois lados: os itens *"Ressarcimento das transportadoras"* (R$ 55.864,38) e *"Receita retida em reenvio"*
(R$ 106.049,40) no **custo evitado** E somados na **Receita Mensal** (R$ 161.913,78 = exatamente os dois).

**Por que "não atualizou":** no reenvio de 29/07 ela **só reabriu a etapa de receita**. Os `form_events` do dia
são `tipos` (16:30) → `receita` (16:34) → `submit` (16:57) — **nenhum evento `saving`**. O formulário só grava o
que é reaberto, então os 4 itens do custo evitado foram reenviados idênticos. **Não foi falha de sync:** a v3
gravou, `Atualizado Em` avançou, as colunas de receita nasceram certas. Trilha das 3 versões: v1 (08/07) 381h
/R$ 5.311,14 → v2 (22/07) custo evitado puro R$ 174.238,10 → v3 (29/07) + receita.

**O agente detectou e avisou** (16:36): _"os R$ 55.864,38 são ressarcimento/cobrança de transportadora — isso
é saving operacional, não receita incremental… confirme se devo excluir"_. Ela **reafirmou** que era receita e
ele aceitou — comportamento previsto (argumenta 1×, aceita a discordância). **Ponto cego real:** o bloco
anti-dupla-contagem só compara *horas × custo evitado*; **não existe checagem custo evitado × receita**, e a
fase de receita não relê os itens do custo evitado.

**Correção aplicada** (5 células via Service Account + `POST /api/admin/sync-sheets-now` → `atualizados:1,
removidos:0`):

| Coluna | Antes | Depois |
|---|---|---|
| Custo Evitado (T385) | R$ 174.238,10 | **R$ 12.324,32** |
| Saving Reais (W385) | R$ 174.238,10 | **R$ 12.324,32** |
| Ganho Total (AE385) | R$ 190.429,48 | **R$ 28.515,70** |
| Justificativa Custo Evitado (U385) | 4 itens | 2 itens |
| Memorial de Saving (Y385) | totais de 174.238,10 | 12.324,32 |

Intocadas: Receita Mensal, Receita Memorial, Tipo de Receita, Status, Observações, Atualizado Em, Saving
Horas, `Alguém Fazia?`. Verificado nas 3 camadas (planilha, SQLite, dashboard com `?refresh=1`).

⚠️ **RESÍDUO ABERTO — a correção é reversível por acidente:** `projetos.custo_evitado_itens` (JSON só-banco)
**ainda tem os 4 itens** — não está em `SAFE_UPDATE_FIELDS` e não tem coluna no Sheets, então o sync reverso
não o alcança. **Se ela reeditar, o form seeda os 4 de volta e o custo evitado retorna a R$ 174.238,10.**
Fechar exige ela remover os 2 itens no form (recomendado, sem código) ou um endpoint admin novo.

⚠️ **Sem nota de correção nas células** (decisão do Luis, 31/07): a primeira versão da correção gravou uma
nota datada em U385/Y385 explicando a remoção dos 2 itens — **foi retirada**. O histórico da correção mora
NESTE doc e na memória, **nunca no texto que a gestão lê na planilha**.

⚠️ Também aberto: `Alguém Fazia?` = "sim" na planilha, mas o estado do saving é `alguem_fazia:'externo'` desde
a v2 — as **381h/mês** da Assistente da v1 (R$ 5.311,14) viraram 0h e não aparecem em lugar nenhum.

**Não é bug (para não "consertar" por engano):** `Ganho Total` **não é a soma** — receita entra com **÷10**
("fator de equivalência"), igual nos dois caminhos (`submeterParaValidacao` e `resyncGoogle`, `chat.functions.ts`).

**Varredura feita:** dos 11 projetos com receita > 0, **9** têm saving e receita juntos, mas **só o Sucesso.AI**
tinha sobreposição de valores. Nenhuma outra vítima deste padrão.

### 4. GoProduct (Emanuele Correia) — MESMA falha da Nyara, pega a tempo e RECUPERADO
O `sync-sheets-now` da correção acima devolveu `"85d3a9d728fdb909f0b2b290d37b7d88: ausente do Sheets, mas
recente — mantido (carência)"`: **GoProduct** (PRODUTO), submetido **31/07 16:36** local, estava no SQLite e
**não** na planilha — o mesmo append morto que purgou o projeto da Nyara, ainda **dentro da carência de 1h**.
Recuperado com `GET /api/admin/resync-google?projeto_id=…`, que desde o PR #216 **cai para append** quando a
linha não existe: **apendado na linha 574**, Status "Pendente". Sem isso, o projeto seria purgado em ~20 min.
⚠️ **Isto confirma que a falha NÃO é evento isolado da Nyara** — é recorrente e silenciosa. Reforça o próximo
passo (varredura Drive × planilha) e sugere uma segunda frente: **detecção automática** do SQLite-sem-linha
(o `reconciliarExclusoes` já sabe quem está nesse estado — hoje só loga a carência e depois apaga).

### Artefatos desta sessão (scratchpad, não versionados)
`sheets-lib.mjs` (acesso mínimo ao Sheets por Service Account) · `fix-sucesso.mjs` (dry-run por default,
`--apply` grava) · **`backup-sucesso-row.json`** (linha 385 inteira antes da edição — reversível célula a célula).

## Sessão de 2026-07-30 (parte 9) — T7 da A1: staging → prod → repo

**O que rodou:**
1. **Testes + build na worktree `fix-gates-a1a2`:** 797 verdes; `npm run build` + `npm run build:worker`
   reproduziram o `worker.js` já commitado (sem diff) — sinal de que o commit `b390c62` estava íntegro.
2. **Staging `edf400b4` deployada** com o `dist/` inteiro via `scripts/deploy-godeploy.sh`. A conferência de
   "qual branch está no ar" foi feita por comparação de branches: **todas** as branches locais menos as duas
   pendentes já estavam contidas no `origin/main` (`39deaf9`), e a `fix/gate-…` estava 0 commits atrás dele —
   logo o build é superset do que estava no ar, sem risco de apagar feature de outra branch.
3. **Validação ponta a ponta na staging** (não só navegador): driver descartável no scratchpad reusando
   `scripts/e2e/lib/{api,responder,env}.mjs`. O cenário-âncora **não** entrou em `scripts/e2e/scenarios.mjs`
   porque o **gate de plano** recusa editar código sem plano ativo aprovado — a trava **não** foi contornada.
   ⚠️ **Versionar o cenário no harness é passo próprio.**
   - **Run 1** (doc com contexto rico): o agente **nunca perguntou** o destino — auto-preencheu a Seção 2.4 e
     **inventou** "menos prazo / menos retrabalho". Ver o achado no próximo passo (b).
   - **Run 2** (briefing negando explicitamente qualquer efeito de prazo/erro): o gate **perguntou 1×**, a
     resposta de headcount foi **aceita de primeira**, **zero** reinterrogação no preview, e a seção saiu
     gravada com a fala do usuário, enquadrada como *menos custo*. Planilha `STAGING`: 160h · R$ 2.230,40 ·
     **AK preenchida** · split 160/0 · `Classificação` claro_sim.
   - Limpeza: `POST /api/admin/e2e-cleanup` na staging (19 projetos `[E2E-…]` removidos).
4. **Prod `674a3710` deployado** depois da staging (regra 13); os dois ambientes servem o mesmo entry
   `index-CzawDJZX.js`, conferido via `GET /` com cookie.
5. **Repo sincronizado:** `fix/gate-alocacao-taxonomia-e-materialidade` e
   `docs/plano-loadings-dashboard-admin` empurradas; PRs **#217** e **#218** abertos e **mergeados** (o `gh pr merge` foi barrado pelo classificador na 1ª
   tentativa e liberado pelo operador; a #218 exigiu resolver conflito de docs contra o `main` do #216).

**Armadilhas encontradas (para não repetir):**
- ⚠️ **`E2E_COOKIE` expirado dá 302 em staging E prod** e o harness morre no 1º POST com "sessão não
  autenticada". Cheque com `curl -H "Cookie: $E2E_COOKIE" <url>/api/auth/me` **antes** de rodar. Renovado
  nesta sessão (`.env` da raiz **e** da worktree — `scripts/e2e/lib/env.mjs` lê o `.env` da raiz do worktree).
- ⚠️ **Detector de "repergunta" ingênuo dá falso NEGATIVO:** (a) o `content` do **preview** contém o memorial
  inteiro, então um regex de tema casa o texto do memorial e conta como "pergunta"; (b) o memorial gravado
  **não** tem os `###` (o `normalizarMarcadoresMemorial` os remove), então procurar
  `### O que mudou após a automação` não acha a seção que **está lá**. Case pelo título sem `#`.
- ⚠️ O **gate de plano** (`plan-gate.sh`) barra edição de **código** — inclusive `scripts/e2e/*.mjs` — quando
  o `## Plano ativo` do `NEXT-SESSION.md` não aponta plano `aprovado`. Docs passam.

---

**Sessão anterior:** 2026-07-30, parte 7 — **planejamento, sem código**: o escopo fechado na parte 6 virou
**plano aprovado** ([taxonomia-destino-ganho-e-anti-loop](plans/taxonomia-destino-ganho-e-anti-loop.md)),
com **duas mudanças de escopo decididas pelo Luis nesta sessão** (ver "Sessão de 2026-07-30 (parte 7)"):
a **jornada preguiçosa saiu** e o **anti-loop do juiz** ganhou desenho determinístico.

> ~~**▶ PRÓXIMO PASSO:** `/ggsd:code` da fatia A1~~ → **FEITO na parte 8** (T1–T6). A worktree
> `.claude/worktrees/fix-gates-a1a2` (branch `fix/gate-alocacao-taxonomia-e-materialidade`, de `origin/main`
> `39deaf9`) tem o commit `b390c62`. ⚠️ O nome da branch ainda diz "materialidade" (era o escopo A2, hoje
> fora) — o conteúdo é **taxonomia + anti-loop**.

> **▶ Pendências da frente anterior (3 humanas + 1 técnica), ainda válidas:**
> 1. **Avisar o Rafa** — a reprovação automática está em prod e o **motivo é visível ao autor** (D10). A
>    **calibração da régua com ele** segue pendente (agora pós-deploy).
> 2. **Limpar as 15 linhas `[E2E-…]` da planilha da STAGING** — **não dá pelo script como está**: a planilha da
>    staging é **arquivo próprio** cujo `GOOGLE_SHEETS_ID` é **secret do app** (o `.env` local tem o de prod).
>    Com o ID em mão: `GOOGLE_SHEETS_ID=<id-staging> node --experimental-strip-types scripts/e2e/cleanup.mjs <runId>`
>    (**planilha ANTES do SQLite**). IDs listados abaixo.
> 3. **Causa-raiz do analisador morrendo no `waitUntil`** segue **aberta** — hoje o destrave é
>    `POST /api/admin/reanalisar-pendentes` (40–70s). Precisa de plano próprio (`/ggsd:plan`).
> 4. `CLAUDE.md` está em **~48k chars**, acima do teto de 40k — vale uma poda.

## Sessão de 2026-07-30 (parte 8) — fatia A1 codada (T1–T6), staging pendente

**Commit:** `b390c62` na `fix/gate-alocacao-taxonomia-e-materialidade` (worktree `fix-gates-a1a2`, sobre
`origin/main` `39deaf9`). **797 testes verdes** (783 + 14 novos). `worker.js` rebuildado e commitado.

**1. Fonte única.** `TAXONOMIA_DESTINO_GANHO` (`orchestrator.ts`, ao lado de `LIMITE_ECONOMIA_ALTA`) declara os
**5 destinos aceitos** — *mais entrega · menos custo · menos erro/retrabalho · menos risco/fraude · menos
prazo* —, cada um com exemplo concreto, e a régua nova: **basta NOMEAR o destino e encaixá-lo em UM dos 5**.
Os **3 pontos** a interpolam (`blocoEconomiaAlta`, `blocoEconomiaAltaPv` e os 3 textos do gate em
`chat.functions.ts`, que passaram a ser **exportados** para o teste da fonte única). Nenhum redigita a lista —
e o teste garante isso derivando **em runtime** as linhas da constante e exigindo-as em cada consumidor.

**2. Anti-loop determinístico.** `buildSavingPreviewPrompt` deixa de injetar o bloco de economia alta quando
`saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`. Sem campo novo, sem persuasão. O juiz **segue ativo**
onde o gate não se aplica (`'nao'`/`'externo'`), que é onde ele é a única rede.

**3. Fronteiras respeitadas (verificado por revisor de contexto fresco):** `respostaAlocacaoVaga`,
`aplicaGateAlocacaoGanhos` e `LIMITE_ECONOMIA_ALTA` **inalterados** (zero hunks); jornada/220h, split
carga×escala, critério `[1.3]`/`[1.4]`, `analyzer.ts` e colunas do Sheets intocados; o cabeçalho
`### O que mudou após a automação` **permanece exato** (é por ele que a coluna AK é fatiada).

**4. ⚠️ O que a execução descobriu e NÃO corrigiu (registrado no plano, item (a)):** o piso
`respostaAlocacaoVaga` ainda marca como VAGA a resposta que **mistura** destino válido com filler — medido:
*"não repusemos a vaga, o time menor dá conta com essa otimização"*, *"as divergências caíram, ficou mais
eficiente"*, *"o fechamento ficou mais rápido, sobra tempo"* → vaga. As frases **limpas** dos 5 destinos
passam. Custo: **1 repergunta firme** (a 2ª resposta é sempre aceita), não os 5 do caso do Rafa. Alinhar o
piso é **fatia própria** — o predicado é fronteira dura deste plano e mexer nele exige decisão do Luis.

**5. Ressalvas dos revisores (não bloqueantes, no commit e no plano):** conformidade **diverge-baixa** (link do
plano na spec só resolve quando esta branch de docs mergear; a guarda saiu em arquivo novo em vez de estender
`tests/gate-alocacao-ganhos.test.ts`) · qualidade **sugestoes** (além do item 4: a taxonomia inteira vai no
texto exibido ao usuário e é reinjetada no histórico a cada turno, ~300 tokens — caberia derivar uma projeção
curta para o chat da mesma fonte).

**6. Não esquecer no T7:** conferir a branch no ar antes do `updateApp` (substitui a app inteira) · o
`E2E_COOKIE`/`E2E_BASE_URL` (a worktree não tem `.env`, e o harness cai em **PROD** por default) · `tsc` tem
**5 erros pré-existentes** (idênticos sem o diff — não são regressão).

## Sessão de 2026-07-30 (parte 7) — o escopo virou plano aprovado, com 2 mudanças de escopo

**Nenhum código alterado** (sessão de planejamento; Gate D armado do começo ao fim). O plano está em
[docs/plans/taxonomia-destino-ganho-e-anti-loop.md](plans/taxonomia-destino-ganho-e-anti-loop.md),
**✅ aprovado (Luis, 2026-07-30)**.

**1. O defeito foi confirmado no código, e o culpado NÃO é quem se pensava.** A recusa de "menos custo" está
em **3 textos de prompt** que definem resposta completa como _"atividades NOMEADAS **E** o que o time entrega
**A MAIS**"_: `blocoEconomiaAlta` (`buildSavingPrompt`), `blocoEconomiaAltaPv` (`buildSavingPreviewPrompt`) e
os 3 textos do gate em `chat.functions.ts` (`perguntaAlocacaoGanhos` / `…Firme` / `nudgeAlocacaoGanhos`).
Quando o ganho é **menos custo**, a entrega **não aumenta** — e a resposta certa lê como incompleta. O
`blocoEconomiaAlta` cita "redução de equipe-vaga não reposta" **de passagem**, num parêntese de exemplos, mas
o **gate** da frase segue exigindo o par — e é o gate que decide. ⚠️ Confirmado que **`respostaAlocacaoVaga`
(`orchestrator.ts:520`) NÃO reprova** "redução de 3 auxiliares" (tem número → aceita): o defeito é **100% de
prompt**, e o predicado **não se mexe** (mexer afrouxaria a rede que pegou o boilerplate do Gostream).

**2. Mudança de escopo — a jornada preguiçosa FICOU DE FORA (decisão do Luis).** O diagnóstico foi
apresentado (o gate da jornada só define o `cap` do gate do teto, então com o maior cargo em 12h/mês a
resposta é **inerte** — disparou em 15 de 24 conversas sem mudar nada) junto de um desenho **melhor que o
limiar de 176h**: perguntar a jornada **sob demanda**, exatamente quando alguma linha passa de **220h** (o
*menor* cap possível — logo, o único momento em que a resposta muda o resultado), sem número arbitrário e sem
o risco que motivava a margem de 80%. **O Luis optou por deixar o gate como está.** O limiar de 176h,
portanto, **não é mais pendência** — a decisão foi tomada. Reavaliar só **depois de re-medir** o baseline
pós-#216.

**3. Anti-loop do juiz do preview — desenho fechado (determinístico).** O juiz não tem limite de recusas e
reinterroga mesmo depois do gate determinístico já ter coletado o destino (origem das 13 perguntas
pós-preview do baseline). Fix escolhido: `buildSavingPreviewPrompt` **deixa de injetar** o
`blocoEconomiaAltaPv` quando `saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`. **Sem campo novo no
estado e sem depender do LLM obedecer** a um "recuse só 1 vez" (persuasão é o tipo de garantia que já falhou
no Gostream). O juiz **segue ativo** onde o gate não se aplica (contrafactual `'nao'`, custo evitado puro
`'externo'`), que é onde ele é a única rede.

**4. Fronteiras duras registradas no plano:** jornada/base 220h · split carga×escala · `respostaAlocacaoVaga`
· `aplicaGateAlocacaoGanhos` · `LIMITE_ECONOMIA_ALTA` — **nada disso se mexe**. Fusão jornada+teto e
re-medição do baseline seguem fora. **Confiança do blast-radius: média** — este repo **não tem**
`docs/INDEX.md`, `docs/invariants.md` nem `scripts/ctx-route.sh`, então o mapeamento saiu de leitura direta
do código; a sessão de código deve varrer os consumidores antes de editar.

**5. Não esquecer na sessão de código:** regra 3 (`prompt-registry.ts` **afirma hoje** a exigência antiga do
"A MAIS" — sem atualizar, o registry passa a mentir), regra 1 (`worker.js` rebuildado e commitado), regra 12
(`SPEC_CORRECOES.md`) e regra 13 (**staging `edf400b4` antes de prod**, com o cenário-âncora da redução de
headcount tendo de passar **de primeira**). O cabeçalho `### O que mudou após a automação` **permanece
exato** — `extrairAlocacaoGanhos` fatia por ele para a coluna "Alocação Ganhos" (AK).

## Sessão de 2026-07-30 (parte 6) — o que o agente pergunta hoje, e o que ainda falta podar

**Nenhum código alterado** (o `plan-gate` recusou — ver Próximo passo). Sessão de leitura sobre
`origin/main` `39deaf9`, não sobre o doc de 28/07 — a diferença importa, porque o `#216` mexeu nas perguntas.

**1. Inventário do que a pessoa é perguntada HOJE** (levantado do código, não do baseline velho):
- **Form** — Etapa 1: equipe + papel por participante (Coautor único). Etapa 2: nome · data · contexto de
  negócio · AI Proxy · **"se desligar isso hoje, quem reclama?"** (pessoa/time da Team Guide) · **"e o que
  piora?"** · arquivos. Etapa 2 financeira: "alguém já fazia?" → horas antes/depois · recorrência · custo
  evitado · custo do projeto.
- **Chat/doc** — só os campos que o extrator não tirou do código, + "usa IA como funcionalidade?" e, se sim,
  "em que parte a IA entra?" (2 turnos, sempre).
- **Chat/memorial** — as duas seções novas do critério: **`[1.3]` Processo alterado** e **`[1.4]` Ponteiro
  movido e onde verificar**, nos 3 modos, com gate determinístico anti-loop (`perguntaCriterioSecoes`).
- **Gates de sistema** — jornada/220h → teto por pessoa → split carga×escala → alocação de ganhos.

**2. Prestação de contas da frente [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md):**
**T1** ✅ (baseline) · **T2** ✅ (virou o plano do critério e foi executado inteiro, PR #216) ·
**T3 e T4 ABERTOS**. Confirmado **no código do `main`**, não presumido: `orchestrator.ts` segue exigindo
_"o QUE passaram a entregar A MAIS"_ e o juiz do preview segue mandando recusar **sem contador anti-loop**;
`aplicaConfirmacaoBaseHoras` e `aplicaSplitCargaEscala` seguem disparando com qualquer `horas_antes > 0`.

**3. Achado desta sessão — o gate da jornada não tem consequência própria** (`chat.functions.ts:1435-1490`):
a única coisa que a resposta faz é definir o `cap` do gate do teto (`tetoPorJornada`: 220h dias úteis / até
~300h com trabalho humano no fim de semana). Com o maior cargo em 12h/mês, a resposta é **inerte** — o teto
nunca é atingido nos dois cenários. É por isso que ele disparou em 15 de 24 conversas sem mudar nada.

**4. Escopo fechado da próxima fatia (decisões do Luis nesta sessão):**
- **A1 — taxonomia de destino do ganho + anti-loop.** Constante única `TAXONOMIA_DESTINO_GANHO` consumida
  pelos **3** lugares (bloco 2.4 do `buildSavingPrompt`, juiz do `buildSavingPreviewPrompt`, perguntas do
  gate em `chat.functions.ts`): aceitar **mais entrega · menos custo · menos erro/retrabalho ·
  menos risco/fraude · menos prazo** — _"a mesma entrega com um time menor"_ passa a ser resposta **válida e
  completa**. O juiz do preview ganha limite de **1 recusa** (hoje não tem — daí as 13 perguntas
  pós-preview). ⚠️ `respostaAlocacaoVaga` **já aceita** "redução de 3 auxiliares" (não bate no regex vago):
  o defeito é 100% de **prompt**, não do predicado — não "consertar" o predicado por engano.
- **Jornada preguiçosa** — só perguntar quando alguma linha tem `horas_antes` **≥ 176h/mês** (80% do teto;
  a margem cobre o usuário corrigir as horas para cima no meio da conversa). **⏳ falta o Luis confirmar o
  número.**
- **Split carga×escala fica COMO ESTÁ** — decisão explícita do Luis nesta sessão. Não mexer.
- **Fundir jornada + teto numa pergunta só ficou FORA** desta fatia (é o T3 estrutural; foi assim que nasceu
  o loop do split). Reavaliar **depois de re-medir**.
- ⚠️ **Re-medir antes de podar mais:** o baseline de **6,4 perguntas/submissão** é de **28/07, ANTES** do
  #216 — que somou `[1.3]`/`[1.4]` **e** passou a injetar o contrafactual e a doc aprovada em todos os
  prompts (`buildRespostasFormulario`). O saldo é desconhecido; rodar o mesmo script sobre as submissões
  pós-#216 custa pouco.

## ✅ Critério de projeto — EM PRODUÇÃO (PR #216 mergeado, `main` `39deaf9`)
A calibração da régua (**só prompt**, `analyzer.ts`) foi provada ao vivo na staging: o cenário
`criterio-claro-nao` (a **nuvem de palavras**, o caso do Rafa que motivou a frente) fechou em **Status
"Reprovado"**, `Classificação` = _"Claro não — a recorrência falha… o contrafactual também falha… **a
rastreabilidade do artefato existe, mas não compensa a falta do par**"_ e **`Motivo Reprovado`** legível, com
caminho de volta pro autor. Os dois furos diagnosticados na parte 3 fecharam: o **entregável** deixou de valer
como rastreabilidade e a **falha simultânea** (recorrência **e** contrafactual) virou exceção declarada ao
"na dúvida → zona_cinzenta". `normalizarClassificacao` **intacta** (segue só rebaixando — D9).

**Guarda de falso-positivo passou** (run `20260730-1300`, staging): `saving-puro` → **Claro sim** ·
`custo-evitado-puro` → **Claro sim** · `complexidade-autonomia` → **Claro sim** · `receita-pura` →
**Zona cinzenta**. **Nenhum** cenário legítimo virou `claro_nao`. 783 testes, `build` + `build:worker` OK,
prod conferido (entry servido = build novo, favicon 200, `/api/auth/me` OK).

## ⚠️ ARMADILHA que custou 3 projetos de teste EM PRODUÇÃO — ler antes de rodar E2E
`scripts/e2e/lib/env.mjs` resolve o `.env` em `../../../.env` e, **quando não acha, cai em PROD**
(`https://godocs.devgogroup.com`). **Worktree não tem `.env`** → dois runs foram pra produção e submeteram 3
projetos `[E2E-20260730-1256]` na planilha real (removidos com `cleanup.mjs`, planilha antes do SQLite; prod
voltou a **0** linhas E2E e 563 no total). **Sempre** exportar explicitamente:

```bash
export E2E_BASE_URL=https://godocs-staging.devgogroup.com
export E2E_COOKIE=$(grep '^E2E_COOKIE=' /home/notebook/godocs-main/.env | sed 's/^E2E_COOKIE=//')
```

…e **conferir a linha `🚀 E2E run … contra <URL>`** antes de deixar rodar. Corolário: **nunca** pipar o run
pra `tail` — a saída fica presa e o run **parece morto enquanto está submetendo**.

## 🐞 Achado pré-existente (NÃO investigar como bug novo)
`saving-multicargo` estoura os **40 turnos** em loop de repergunta da **Seção 2.4** quando o respondedor do
E2E não tem o dado ("o briefing não detalha"). **Falha idêntica no código de prod**, sem a frente — não é
regressão. O gate determinístico da 2.4 tem anti-loop; quem repergunta sem limite é a rede LLM-juiz do
`buildSavingPreviewPrompt`.

## 🧹 Linhas `[E2E-…]` a remover da planilha da STAGING (15)
`d8ba3c3e8744ae84b969700ac757171b` · `ec2563e8f6ea9c5d25997765e32d97a8` · `dc17203497483353a6d232f46da60a79` ·
`0db1fc6f734db2a17ae455b539fce365` · `1f2355c3dd0e30843b73125ff3238fa3` · `35155594eafce787b872b598b7d96945` ·
`e67a44f3b4fb1dc1b1464c7408f80cfa` · `565aebd32a41f5a50064bef308de6817` · `a35cd24e885d088b43068347400e2dc7` ·
`993b3741bad60bd43da5f1518ec2b6f3` · `ef85becf58e866e62e88a672f6c6a176` · `8eef40970185448a2509572ed734c812` ·
`fccdeceedad244127c29df30a80d75b1` · `c8de6939bcfdf5ba35847bad4f8b2447` · `f688432cf4628579cff8b3686c52e9f8`

⚠️ A aba `STAGING` recebeu **cópia de dados reais de prod** (decisão do Luis, 30/07) — contra a regra de
"dados simulados". Vale considerar repovoar com dado sintético.

## ⚠️ Risco médio ACEITO que viaja com a frente
`false` = "não achei o ID" **≠** "a linha nunca existiu": ID mexido à mão na planilha (ou append in-flight)
pode gerar **2ª linha** em vez de no-op no fallback de recuperação da IDA. Auto-limitante (o append grava o
`ID Projeto`). Detalhe em `spec-docs/SPEC_CORRECOES.md`.

## ✅ O fix da cota se sustentou sob submissão real (`stg-crit-05`)
Re-rodado o cenário `criterio-claro-nao` no worktree `staging-criterios-coautor` → projeto
`35155594eafce787b872b598b7d96945` (R$ 27,88, 2h, pontual). **A linha CHEGOU na planilha** — era exatamente
o que falhava antes (`429` no append + purga após a carência de 1h). `POST /api/admin/reanalisar-pendentes`
devolveu `{"submetidos":570,"faltando":1,"reanalisados":1}` em **38s / HTTP 200** (antes: ~109 projetos por
rodada e HTTP 500). `Complexidade` = `automacao`, coluna **`Classificação` gravada** com justificativa, e as
2 seções novas do memorial (`Processo alterado` · `Ponteiro movido e onde verificar`) presentes.

## 🐞 A RÉGUA NÃO REPROVA O CASO QUE A MOTIVOU — plano aprovado, código pendente
O veredito do cenário foi **zona cinzenta**, não `claro_nao`: Status "Pendente" e `Motivo Reprovado` vazio —
**correto para zona cinzenta**, mas significa que o caminho da reprovação segue sem exercício real e, em
prod, tende a **nunca disparar**. E o cenário é a **nuvem de palavras**, o caso do Rafa que motivou a frente
inteira e que está escrito como few-shot de `claro_nao` no próprio prompt (`analyzer.ts:265`).

A justificativa gravada entrega as 2 causas: _"a recorrência não está bem sustentada… o autor afirma que
nada piora e que ninguém pediu de novo; **por outro lado, há um indicador de uso e um resultado verificável
no material do evento**, então não é caso de claro_nao"_. Ou seja: **(1)** o analisador aceitou o
**entregável** (o slide) como **rastreabilidade** — prova que a peça foi feita, não que um ponteiro mudou; e
**(2)** o "use com PARCIMÔNIA / na dúvida SEMPRE zona_cinzenta" absorveu um caso em que **recorrência E
contrafactual falharam juntos**, que a própria regra já mandava reprovar. Parte disso é artefato do
respondedor do E2E (ele inventou uma evidência plausível), mas **não tudo** — a régua cedeu mesmo com o
contrafactual negado. A `SPEC_CRITERIOS_PROJETO.md` já listava _"régua a calibrar com o Rafa antes de
produção"_ como pendência: é esta.

⚠️ **A parte determinística está OK** e não é o problema: `claro_nao → rejeitado + "Reprovado"` tem teste
(AC1 em `tests/criterios-classificacao.test.ts`) e a escrita das colunas foi provada ao vivo. O que falta é
o LLM **chegar** a `claro_nao`. **Decisão do Luis nesta sessão: calibrar ANTES de prod** (revê o "subir tudo,
calibrar depois" de mais cedo, agora que se sabe que a reprovação pode nunca disparar) — e **levar o fix do
`resyncGoogle` junto**. Plano aprovado: ver "Plano ativo".

_(Contexto da sessão anterior:)_ **2026-07-30, parte 2** (validação em staging — **achou e corrigiu um bug crítico**). O deploy de prod estava aprovado pelo Luis ("subir tudo, calibrar a régua do Rafa depois",
escopo do form mantido como validado), mas foi **parado por um achado** que ele não conhecia.

## 🐞 LOOP DE RECONCILIAÇÃO QUE ESTOURAVA A COTA DO SHEETS — corrigido, commit `cb8d677`
**Regressão da própria branch do critério** (⚠️ `origin/main` está LIMPO — `classifNaPlanilha` não existe
lá; prod nunca teve o bug). Em `reconciliarComplexidade` (`chat.functions.ts`) a coluna nova
`Classificação` fez o critério de "já está pronto" virar `Complexidade preenchida E Classificação
preenchida` — **impossível de satisfazer** para projeto ANTIGO: tem Complexidade na planilha,
`Classificação` vazia (coluna nova) e **nada** de classificação no SQLite, então o cron escrevia só a
Complexidade (que já estava lá), a Classificação seguia vazia e ele voltava no minuto seguinte. **Para
sempre.** Medido nos logs da staging: **109 projetos distintos, 693 tentativas em 7 rodadas (~99 leituras
de cabeçalho por minuto)** contra a cota de **60 leituras/min** do Sheets.

**Danos reais observados** (e que iriam a prod): **707 erros 429**; o **append da submissão do run 3
morreu** (`[google/sync] Falha ao inserir na planilha: 429`) → o projeto **nunca chegou à planilha**; e,
passada a **carência de 1h**, `reconciliarExclusoes` **apagaria o projeto do SQLite** — perda silenciosa.
⚠️ A cota é do **mesmo projeto GCP da produção** (`398963590019`), então a staging estava **degradando o
Sheets de prod**; o cron da staging foi pausado durante o diagnóstico e **religado** após o fix.

**Fix:** a decisão virou a função **pura** `decidirReconciliacaoPlanilha` — só age quando há algo
**realmente gravável** (coluna vazia na planilha **E** dado no SQLite) ou quando cabe re-análise (SQLite
vazio nas duas pontas); nada a fazer → não conta como pendente e **não gera leitura**. **8 testes de
convergência** (`tests/reconciliacao-convergencia.test.ts`), incluindo estabilidade da 2ª passada.
**769 testes verdes**, `build` + `build:worker` OK, `worker.js` recomitado, **staging redeployada 15:03**.
✅ **PROVA no ar:** `POST /api/admin/reanalisar-pendentes` → `{"submetidos":569,"faltando":0,
"ressincronizados":0,"reanalisados":0}` em **15,8s** e **HTTP 200** (antes: ~109/rodada e HTTP 500).

## 🐞 2º gap ACHADO e NÃO corrigido (decisão do Luis: fora deste fix)
**`resyncGoogle` não recupera linha ausente:** ele usa `modo: "edicao"` → `updateRowByProjectId`; se a
linha não existe na planilha, **não acha nada, não faz nada e ainda devolve `ok:true`**. Ou seja: quando o
append da IDA falha (cota/transiente), **não existe caminho de recuperação** e o projeto é purgado após 1h.
Fix sugerido: cair para **append** quando a linha não existe, em vez de no-op silencioso.

## ✅ Validado nesta sessão (lado do AGENTE, item 1 do pedido)
O `stg-crit-02` (que ficou em voo na sessão anterior) **fechou com sucesso** nos 2 cenários — e o
`receita-pura` **não** estourou os 40 turnos, o risco que o handoff anterior apontava. Rodou **no worktree**,
logo **com** as 2 correções do harness. A ficha do `/dashboard` confirma no memorial gravado as duas seções
novas (`Processo alterado` + `Ponteiro movido e onde verificar`) e o **comportamento 3** intacto: _"Não foi
informado no briefing um relatório, painel, sistema ou base específica para conferência desse número;
portanto, a ausência de fonte nomeada fica registrada explicitamente, **sem inventar referência**"_.

## ⚠️ Ainda NÃO validado: `claro_nao → "Reprovado"` (item 2 do pedido)
O cenário novo `criterio-claro-nao` **rodou e submeteu** (`f97856f5…`, ganho R$27,88/mês, 40 turnos não
estourados) — mas a linha **não chegou na planilha** por causa do bug acima, então o caminho da reprovação
**não pôde ser conferido**. Com o fix no ar, **basta re-rodar o cenário**. O analisador em si **funciona**:
os 2 projetos do `stg-crit-02` têm `complexidade` gravada no SQLite (`autonomia`/`automacao`) — o que
falhava era só a escrita na planilha.

## 🧭 Descobertas de método que economizam tempo na próxima sessão
- ⚠️ **A staging tem `GOOGLE_SHEETS_ID` PRÓPRIO** (secret separado) — **não** é a "planilha de prod
  compartilhada" que o `CLAUDE.md` descreve. Ler a planilha da staging com o `.env` local (ID de prod) dá
  **0 linhas** e parece bug do produto. **Caminho certo:** `GET /api/admin/dashboard/projetos` (listagem) e
  **`GET /api/admin/dashboard/projetos/:id`** (a **linha INTEIRA**, é onde `Classificação`/`Motivo
  Reprovado` aparecem). O `read-criterio.mjs` do scratchpad **mede a planilha errada** — corrigir ou largar.
- O cron `reanalisar-pendentes` **dispara sim na staging** (o handoff anterior dizia que não) — ele
  devolvia **500 por cota**, não silêncio.
- `/api/admin/investigador/projetos` **não** expõe `classificacao_avaliacao`; `/api/meus-projetos` expõe
  `motivo_reprovado`/`motivo_reenvio` em **snake_case**.

_(Antes desta:)_ **2026-07-30 (validação em staging — critério de projeto)** — pedido do Luis: **validar por
E2E na staging que o agente pergunta o que o planejamento definiu, antes de levar TUDO a produção**.

**✅ O GATE T8 FUNCIONOU — os 2 cenários que falhavam na rodada de 29/07 passaram** (run `stg-crit-01`,
staging `edf400b4`, `inspect-perguntas.mjs`):

| Cenário | 29/07 (só prompt) | 30/07 (com o gate T8) |
|---|---|---|
| `custo-evitado-puro` | ❌ `[1.4]` gravada **pela metade** (só `**Ponteiro movido:** custo externo`, sem o "onde verificar") nas 2 rodadas | ✅ `[1.3]` **e** `[1.4]` completas — ponteiro (custo externo do contrato) **+** onde conferir (histórico de cancelamento/faturamento + Portal) |
| `receita-pura` | ❌ `[1.3]` **ausente**; `[1.4]` ausente numa das rodadas | ✅ `[1.3]` **e** `[1.4]` presentes |

Mais: **0 repetição** de pergunta de ponteiro/fonte · **2,5 perguntas/submissão** (baseline de prod **6,4**)
— as seções novas **não engordaram o funil**. E o comportamento 3 (o mais importante) se manteve: no
`receita-pura` o agente **registrou a ausência da fonte em vez de inventar uma** — _"O briefing não informou
relatório, painel, sistema ou base específica para conferência desse número"_ → vira **zona cinzenta**, nunca
reprovação automática. ⚠️ **A decisão do PREFIXO se provou load-bearing**: o agente gravou o título como
`### Ponteiro movido e conferência` (não o título exato) — com casamento por título exato o gate teria lido
`null` e reperguntado à toa. **Não "corrigir" o prefixo.**

**Também verificado nesta sessão:** (a) a staging roda **exatamente** `staging/criterios-coautor` — o entry
`index-CLeuBaiL.js` do `/index.html` ao vivo bate com o `dist/` local (é assim que se confere qual branch
está no ar, ver a armadilha do deploy que apagou a Etapa 2); (b) **761 testes verdes** na branch de
integração, que já contém **todo** o `origin/main` (`ad64895`) — é superset limpo para prod; (c) as 3 colunas
do critério (`Classificação` · `Motivo Reprovado` · `Motivo Reenvio`) **existem no cabeçalho das DUAS abas**,
`STAGING` **e** `GoDocs` — o pré-requisito de prod está cumprido (mapeamento é por nome; nome errado é
ignorado com aviso silencioso).

**2 buracos do harness E2E corrigidos** (commitados na branch de integração) — os dois faziam o teste medir a
coisa errada: **(1)** o `metaPadrao` **nunca enviava** `contrafactual_afetados`/`contrafactual_reclamacao`, as
perguntas-chave da Etapa 2 — sem elas o agente roda **cego ao contrafactual**, exatamente o cenário que o
roteiro manda não medir (é `buildRespostasFormulario` que as entrega aos 4 prompts); **(2)** **nenhum cenário
cobria `claro_nao`** — o único caminho que grava **"Reprovado"** na planilha e o que mais precisa de
validação, porque o autor vê. Criado o cenário **`criterio-claro-nao`** (nuvem de palavras: rodou 1×, sem
recorrência, ninguém reclama, materialidade minúscula de propósito — acima de R$5k/mês o invariante de
`normalizarClassificacao` rebaixa para zona cinzenta e o teste não provaria nada).

⚠️ **O lado do ANALISADOR (item 2 do pedido) segue SEM validação** — pelo mesmo motivo de 29/07, não por bug
do código novo: a análise morre no `waitUntil` (timeout de 25s do proxy → fallback OpenAI → *tasks
cancelled*) e o cron de 1 min **não dispara na staging**. A rota de destrave existe
(`POST /api/admin/reanalisar-pendentes`, `requireAdmin`, idempotente) e **foi chamada**, mas devolveu **500 por
cota do Google Sheets** (`ReadRequestsPerMinutePerUser`, 60/min — estourada pelas minhas próprias leituras da
planilha + o run). **É transitório: esperar ~1 min e repetir.** A causa-raiz do `waitUntil` continua aberta
(decisão do Luis entre aterrissar a análise no request do submit ou disparar do front em lotes).

⚠️ **Divergência de escopo registrada:** o pedido do Luis listou **3** perguntas para o **formulário**
("que processo mudou e quanto" · "moveu ponteiro de custo/receita/KPI" · "se desligar hoje quem reclama").
Pela decisão de **29/07** só o **contrafactual** ficou na Etapa 2 ("quem reclama" + "o que piora"); as outras
duas são conduzidas pelo **agente** no chat e é isso que o gate T8 cobre — foi assim que validei. Se o Luis
quiser as três **no form**, é mudança nova e precisa ser dita **antes** do deploy de prod.

_(Antes desta:)_ **2026-07-30 (código, avulsa — fora do plano ativo)** — pedido direto do Luis:
**Coautor único por projeto**. Cada projeto tem **1 autor** (o submissor/dono, que não escolhe papel) e
**no máximo 1 Coautor** (`coexecutor`); Participante e Contribuidor seguem **sem limite**. Implementação
**100% cliente** (nada de schema, sync ou colunas do Sheets — `derivarColunasPapeis` continua aceitando
lista por causa dos legados): helpers puros `PAPEL_COAUTOR`/`coautoresSelecionados()`/`limitarCoautorUnico()`
em `src/lib/submeter/constants.ts`; `validarEtapa1` bloqueia 2+ Coautores nos dois modos (submissão nova e
edição); no seletor (`ParticipantesPapeisInput`) a opção **Coautor SAI da lista** dos demais quando alguém já
a tem (`papeisDisponiveis` — a 1ª versão mostrava a opção *desabilitada* com "(já definido)" e o **Luis pediu
para removê-la da view**); nota informativa abaixo do campo explica a ausência; o **seed da edição**
(`applySeed`, `submeter.tsx`) aplica `limitarCoautorUnico` — legado importado do Sheets pode trazer vários
e-mails na coluna "Participantes", então mantém o 1º e **limpa o papel dos demais** para o usuário
reclassificar (em vez de travar a edição num estado que ele não criou). Branch **`feat/coautor-unico`**
(`da91207` + `0ff9f6b`, sobre `main` `ad64895`), 8 testes novos em `tests/validacao-etapa1.test.ts`,
**667 verdes**; `CLAUDE.md` + `spec-docs/SPEC_FEATURES_NOVAS.md` atualizados. **✅ VALIDADO pelo Luis no
staging.** ⚠️ **Armadilha real desta sessão, que não pode repetir:** o **staging estava rodando a branch
NÃO-mergeada `feat/criterios-projeto-classificacao`** (as perguntas-chave da Etapa 2), e o primeiro deploy —
buildado de `origin/main` — **apagou aquelas perguntas da tela** (o `updateApp` substitui a app INTEIRA).
Corrigido com a branch de integração **`staging/criterios-coautor`** (= `feat/criterios-projeto-classificacao`
+ merge do coautor; conflito só em duas linhas de `import`), **761 testes verdes**, `build` + `build:worker`
OK, **staging redeployado** com as duas frentes. **Prod (`674a3710`) NÃO foi tocado em nenhum momento.**
**Regra que vale daqui pra frente: antes de deployar no staging, descobrir QUAL branch está no ar e mergear a
sua sobre ela.**

_(Antes desta:)_ **Última sessão:** 2026-07-29 (planejamento) — nova frente, pedida pelo Luis: **apertar o critério de
projeto** (o pedido do Rafa, caso da **nuvem de palavras**). Plano ✅ **aprovado** em
[`docs/plans/criterios-projeto-classificacao.md`](plans/criterios-projeto-classificacao.md). Escopo: (a) **2
perguntas determinísticas na Etapa 2** — "moveu sensivelmente o ponteiro de custo/receita/KPI?" + "onde isso
pode ser verificado?" (rastreabilidade, que hoje **não existe** em lugar nenhum) e "se desligar hoje, quem
reclama e o que piora?" (contrafactual); (b) **"que processo mudou e quanto?"** vira seção obrigatória do
`MEMORIAL_ESQUELETO`, perguntada pelo **agente** só quando a doc não traz a magnitude; (c) o **analisador
classifica** em **claro sim / claro não / zona cinzenta**, **sempre** explicando o porquê, com
`normalizarClassificacao()` puro (nunca reprova sem motivo; especial nunca reprova automático; >R$5k → zona
cinzenta); (d) `claro não` grava **`Reprovado`** na coluna Status — **única exceção** à regra TEMPORÁRIA do
"Pendente", que continua valendo para todo o resto; (e) 3 colunas **já criadas pelo Luis** na planilha
(`Classificação` sempre preenchida · `Motivo Reprovado` · `Motivo Reenvio`, esta **só humana**); (f) modal de
triagem do `/dashboard` grava os motivos em coluna própria, **sem tocar em `Observações`** (que o disparo de
e-mails usa). **Barrar submissão continua FORA em definitivo** — a reprovação é pós-envio, no analisador.
Achado que economiza trabalho: **`Reprovado` já existe** em `STATUS_GRAVAVEIS` e no `StatusBadge` (PR #214), e
**`usa_ai_proxy` é o padrão exato a clonar** para as perguntas novas da Etapa 2. **Nenhum código alterado.**

_(Antes desta:)_ **2026-07-28 (código)** — **`/dashboard` do admin virou a tela de triagem sobre a PLANILHA**,
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

**Última sessão (2026-07-28, operação + planejamento):** fechou o **T8 do dashboard** e abriu a frente dos
**loadings**. (a) `feat/dashboard-admin-sheets` deployada no **staging `edf400b4`**, validada no navegador pelo
Luis e depois em **prod `674a3710`** — mesmos artefatos/hashes nos dois; branch no remoto (`990250e`); **o PR
não foi aberto** porque o `gh pr create` é bloqueado pelo classificador de permissões local (corpo pronto,
conta `gh` em `LuisEduardo100`). (b) **Admin concedido via secret `ADMIN_EMAILS`** (rotaciona sem redeploy):
`bruno.bezerra@gocase.com` em prod **e** staging, `luiza.rios@gocase.com` em prod; `.env` sincronizado.
⚠️ Registrado que **admin não é granular** — dá acesso a TODAS as telas do grupo `_authenticated`
(dashboard, investigador, email-legados, areas, usuarios, testes) + override de edição. (c) O relato "**só 1
descontinuado**" **não era bug**: a tela lê 100% do Sheets. Medido via Service Account — aba **GoDocs**
478 Aprovado / 40 Pendente / 15 Reenvio Pendente / **11 Descontinuado** (544 linhas com ID); aba **STAGING**
287 / 32 / 23 / **1** (343 linhas), ou seja a staging é uma **cópia antiga**. De quebra: a coluna "Status"
está em **posições diferentes** nas duas abas (índice 29 vs 30) e o mapeamento por nome absorveu.
⚠️ **Dado novo para a decisão do dropdown:** `Reprovado` e `Em validação` **não existem em nenhuma das 887
linhas** — os 4 valores reais são Aprovado · Pendente · Reenvio Pendente · Descontinuado. (d) Planejada e
**aprovada** a frente dos loadings (ver Plano ativo). **Nenhum código alterado nesta sessão.**

## Plano ativo
**Nenhum plano ativo.** O último — [taxonomia-destino-ganho-e-anti-loop](plans/taxonomia-destino-ganho-e-anti-loop.md)
— está **✅ executado** (T1–T7, prod deployado, PR #217). O próximo passo é **mergear #217/#218** e depois
**planejar** a fatia escolhida (A2 · auto-preenchimento da Seção 2.4 · piso `respostaAlocacaoVaga`) com
`/ggsd:plan`. Referência do que a A1 entregou:

Implementa a fatia **A1** da frente
[perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md) (T3): constante
única `TAXONOMIA_DESTINO_GANHO` (5 destinos — mais entrega · **menos custo** · menos erro/retrabalho · menos
risco/fraude · menos prazo) consumida pelos **3** textos que hoje exigem o par _"nomeado **E** entregar A
MAIS"_, + **anti-loop determinístico** no juiz do preview (o bloco sai do prompt quando
`saving.alocacao_ganhos` já é `'ok'`/`'reperguntado'`).

⚠️ **A jornada preguiçosa saiu do escopo** — decisão do Luis nesta sessão: o gate da jornada **fica como
está**, mesmo com o diagnóstico de que a resposta é inerte em 15 de 24 conversas (ela só define o `cap` do
gate do teto). Reavaliar **depois** de re-medir o baseline pós-#216. Os itens estruturais (registro de "já
respondido", orçamento de perguntas, fusão dos 4 gates, T4) seguem para depois da re-medição.

Os dois planos da frente do critério estão **concluídos e em produção**
(`calibragem-regua-criterio-e-resync-append` + `criterios-projeto-classificacao`, PR #216 mergeado,
`main` `39deaf9`). O que sobrou dela é **humano**: avisar o Rafa e **calibrar a régua com ele** usando casos
reais — reprovar projeto é visível ao autor (D10).

Frentes candidatas à próxima sessão, nenhuma planejada ainda (entram por `/ggsd:plan`):
- **causa-raiz do analisador morrendo no `waitUntil`** — hoje mitigado pelo cron de 1 min em prod
  (`reanalisar-pendentes`, conferido ativo e 200), que em troca **pressiona a cota do Sheets** (60 leituras/min
  compartilhadas com a staging). Caminho quente de submissão: não mexer sem plano;
- **poda do `CLAUDE.md`** (~48k chars, teto 40k);
- **repovoar a aba `STAGING` com dado sintético** (ela recebeu cópia de dados reais de prod).

**Plano anterior (a frente que este destrava)**
**→ [docs/plans/criterios-projeto-classificacao.md](plans/criterios-projeto-classificacao.md)** ·
Status: ✅ aprovado (Luis, 2026-07-29) e **CODADO** na branch `feat/criterios-projeto-classificacao`
(T1–T8, até `9ce9b09`/`28cdb01`) — **no staging, ainda NÃO validado pelo Luis nem em prod**; era essa branch
que estava no ar quando o deploy de 30/07 a sobrescreveu (ver "Última sessão").
Critério de projeto: perguntas-chave na Etapa 2 + classificação em 3 níveis no analisador + reprovação com
motivo nas colunas novas. **Barrar submissão segue FORA em definitivo** (a reprovação é pós-envio).

**⚠️ Frente PARALELA, não sobrescrita — [perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** ·
Status: ✅ **aprovado (Luis, 2026-07-28)**, T1 executado, **ainda pendente de código**: **A1** (o gate da
alocação precisa aceitar "menos custo", não só "mais saída" — + anti-loop no juiz do preview) · **A2**
(materialidade nos gates) · **T4** (fluxo de coleta). Coexiste com o plano ativo (ADR-026) e é **adjacente**:
a taxonomia de impacto escrita no T3 do plano ativo deve ser reaproveitável pelo A1. O **T2** (régua do Rafa)
foi **absorvido** pelo T7 do plano ativo — não fazer duas vezes.

_[loadings-dashboard-admin](plans/loadings-dashboard-admin.md) saiu de ativo: **✅ CONCLUÍDO** — T1–T5 no commit
`3b93c65` e o **T6 fechado em 2026-07-28**: staging validada → **prod `674a3710`** → **PR #215 mergeado**
(`main` = `ad64895`). Nada pendente nessa frente._

### Sessão de código 2026-07-28 (loadings do /dashboard) — o que ficou
Codados T1–T5: **SWR** em `lerPlanilha` (cache vencido volta na hora + revalidação em `runBackground`,
single-flight preservado, `revalidando` no payload) · **auth em `sessionStorage`** (`src/lib/auth-cache.ts`,
TTL 5 min, revalidação em background) · **prefetch** da planilha em paralelo ao `/api/auth/me`
(`src/lib/dashboard-prefetch.ts`) · **skeleton** (`components/dashboard/skeleton-linhas.tsx`) com filas
visíveis e chip "Atualizando em segundo plano". **658 testes verdes** (+38), `worker.js` recomitado, spec
**D9/D10** + `CLAUDE.md` (gotchas 3 e 7).
O revisor de qualidade em contexto fresco pegou **1 ALTA já corrigida**: a correção da linha no cache era
apagada pela revalidação em voo → o status recém-decidido voltava atrás por até 60 s. Corrigido com patch
por projeto reaplicado nas leituras iniciadas antes da escrita + guarda de época/sequência; `?refresh=1`
não herda leitura em voo; `STALE_MAX_MS` (10× TTL) volta a bloquear se o Sheets falhar; prefetch com teto
de 15 s. Conformidade: `diverge-baixa` (nada fora das Fronteiras).
⚠️ **`CLAUDE.md` está em ~45k chars** (limite recomendado 40k, já estava 44,2k no `main`) — vale uma sessão
de enxugamento.

Melhorar os **loadings do `/dashboard`** (pedido do Luis em 2026-07-28, escopo escolhido por ele): SWR no
servidor · cache de auth em `sessionStorage` · leitura em paralelo com o auth · skeleton. **Cache em SQLite
ficou FORA por decisão dele** (não reintroduzir SQLite no caminho de leitura). Sai de um worktree sobre a
branch `feat/dashboard-admin-sheets` (os arquivos não existem no `main` ainda).

**⚠️ Frente PARALELA, não sobrescrita —
[perguntas-agente-recorrencia-evidencia](plans/perguntas-agente-recorrencia-evidencia.md)** · Status:
✅ **aprovado (Luis, 2026-07-28)** — T1 já executado; **pronto para `/ggsd:code`**. Escopo ampliado por ele
no fim da sessão: além das perguntas, entra o **fluxo de coleta** (T4 — onde cada informação deve ser
colhida: formulário × conversa × já sabido), e **barrar submissão está FORA em definitivo** (se voltar,
exige plano próprio). Ordem de ataque: **A1** (taxonomia de impacto + anti-loop no juiz do preview) e **A2**
(materialidade nos gates) primeiro — não dependem da régua do Rafa; **T2** (régua) em paralelo, para ele levar. Não é bloqueada por este plano nem o
bloqueia — as duas coexistem (ADR-026). **A fase de código recusa executar qualquer plano em rascunho** (RF-03).

_(Antes desta:)_ **Nenhum plano `aprovado` pendente de código.** [`dashboard-admin-sheets`](plans/dashboard-admin-sheets.md)
está **✅ executado** (T1–T7). **Falta o T8, que não é código:** deploy no **STAGING `edf400b4`** → validar
no navegador → **PROD `674a3710`** → PR (regras 13 e 10). Nova frente de código → `/ggsd:plan` primeiro.

_(Executados recentes: [aceitar-zip-submissao](plans/aceitar-zip-submissao.md) ✅ mergeado+prod;
[ocultar-valor-meus-projetos](plans/ocultar-valor-meus-projetos.md) ✅ mergeado (PR #210);
[edicao-etapa1-participantes](plans/edicao-etapa1-participantes.md) ✅ executado — resta a validação T5,
ver pré-req das colunas abaixo.)_

## Próximo passo (setado)
**→ Codar o plano aprovado com `/ggsd:code`: T1–T3 (calibrar a régua do `claro_nao`, só prompt) e
T4–T5 (`resyncGoogle` recupera linha ausente por append), na branch `staging/criterios-coautor`.**

```bash
cd .claude/worktrees/staging-criterios-coautor   # a branch que está NO AR na staging
# T1-T3: src/lib/agents/analyzer.ts (régua) · T4: src/lib/google/sheets.ts · T5: src/lib/google/sync.ts
npm run test && npm run build && npm run build:worker   # + comitar worker.js (regra 1)
```
**Depois, na ordem:** (1) **T6 — deploy no staging `edf400b4`** e re-rodar o cenário, esperando agora
**Status "Reprovado" · Classificação "Claro não…" · Motivo Reprovado preenchido**:
```bash
E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING \
  E2E_ONLY=criterio-claro-nao npm run e2e:run -- stg-crit-06
curl -H "Cookie: $E2E_COOKIE" \
  https://godocs-staging.devgogroup.com/api/admin/dashboard/projetos/<ID>   # a linha INTEIRA
```
⚠️ **NÃO use o `read-criterio.mjs`** do scratchpad — ele lê a planilha de **PROD** (a staging tem
`GOOGLE_SHEETS_ID` próprio). Analisador não gravou (waitUntil)? `POST /api/admin/reanalisar-pendentes`
(~38s, não estoura mais a cota). (2) **limpar os runs** — `npm run e2e:cleanup -- stg-crit-05` (e `01`/`02`/
`03`, e o `04` que ficou parcial de um run abortado), **planilha ANTES do SQLite**, senão o sync reverso
ressuscita. (3) **prod `674a3710`** (`getUploadToken` novo — `uploadId` é **single-use** — e o script recebe
o **TOKEN**, não a URL). (4) **PR** via `/ggsd:ship` (conta `gh` em `LuisEduardo100`).
⚠️ **Avisar o Rafa logo após o deploy:** reprovar projeto é **visível ao autor** (D10), e a régua vai ao ar
recém-calibrada, sem rodada de calibração com ele.

### _(Passos da sessão anterior — o que sobrou deles)_
**Fechar a validação do critério e levar as DUAS frentes a produção** (o Luis respondeu a pergunta que estava
aberta: quer **prod recebendo todas as mudanças**, depois de validar o critério por E2E na staging). O lado do
**agente já está validado** (tabela no topo). Falta, nesta ordem:

1. **Terminar o run `stg-crit-02`** (`receita-pura` + `custo-evitado-puro`) — ficou **em voo** no fim da
   sessão, preso num vai-e-vem longo da fase **doc** do `receita-pura` (o respondedor do E2E responde "não
   está no briefing" e o agente repergunta; pode bater no `MAX_TURNS`). Log em
   `.../scratchpad/e2e-stg-crit-02.log`. ⚠️ **Não é bloqueio da validação** — o `stg-crit-01` já cobriu os
   dois cenários com sucesso; se o `stg-crit-02` estourar turnos, isso é achado do **respondedor**, não do
   produto.
2. **Rodar o run 2 com os campos novos** (o harness já foi corrigido e commitado):
   `E2E_BASE_URL=https://godocs-staging.devgogroup.com GOOGLE_SHEETS_TAB=STAGING
   E2E_ONLY=criterio-claro-nao,receita-pura npm run e2e:run -- stg-crit-03` — este é o que valida o
   **item 2 do pedido** (classificação em 3) e o caminho **`claro_nao` → "Reprovado" + Motivo Reprovado**.
3. **Destravar o analisador:** esperar ~1 min (cota do Sheets) e repetir
   `POST /api/admin/reanalisar-pendentes`; depois ler `Classificação`/`Motivo Reprovado`/`Status` na aba
   `STAGING` (script pronto em `.../scratchpad/read-criterio.mjs`).
4. **Limpar** os projetos de teste: `npm run e2e:cleanup -- stg-crit-01` (e `stg-crit-02`/`stg-crit-03`)
   — **planilha ANTES do SQLite**, senão o sync reverso ressuscita.
5. **Prod `674a3710`** com a branch de integração `staging/criterios-coautor` (já é superset do `main`):
   `npm run test && npm run build && npm run build:worker` → `scripts/deploy-godeploy.sh <TOKEN>` → `updateApp`.
   ⚠️ `getUploadToken` novo (o `uploadId` é single-use) e o script recebe o **TOKEN**, não a URL.
6. **PR** via `/ggsd:ship` (conta `gh` em `LuisEduardo100`).

⚠️ **Antes do passo 5, ver a divergência de escopo das 3 perguntas do formulário** registrada no bloco da
última sessão — se o Luis quiser as três **no form** (e não duas no agente), isso muda o que vai a prod.
⚠️ **Gate humano ainda de pé:** a régua do Rafa (T7) **deve ser calibrada com ele antes do deploy em
produção** — reprovar projeto é visível ao autor.

_(Resolvido — era o "PRIMEIRO" desta seção:)_ o staging hoje carrega **duas** frentes
(Coautor único, já validado + critério de projeto, ainda **não** validado por ele). Decidir com ele:
**(1)** subir a prod **só o Coautor único** (`feat/coautor-unico` rebaseada no `main`) e abrir o PR dela,
deixando o critério de projeto só no staging; ou **(2)** esperar a validação do critério de projeto e subir as
duas juntas. **Não subir prod antes dessa resposta.** Quando vier, o caminho do Coautor é: rebase no `main`
→ `npm run test && build && build:worker` → **deploy prod `674a3710`** → `/ggsd:ship` (PR).
⚠️ Ao deployar staging de novo, cheque antes qual branch está no ar (foi o erro desta sessão) e use uma branch
de integração; worktrees vivos: `.claude/worktrees/coautor-unico` e `.claude/worktrees/staging-criterios-coautor`
(este com `node_modules` por **symlink** para o outro).

**DEPOIS — Executar o plano [criterios-projeto-classificacao](plans/criterios-projeto-classificacao.md)** com
`/ggsd:code`, T1 → T7. Worktree novo a partir de **`origin/main` (`ad64895`)** — a branch atual
`docs/plano-loadings-dashboard-admin` é **só de docs e está ATRÁS do main** (o `/dashboard` de triagem e o
`dashboard-admin.functions.ts` **não existem** nela; só no `main`).

**Antes de escrever a primeira linha, nesta ordem:**
1. **Conferir a grafia exata** dos 3 cabeçalhos novos (`Classificação`, `Motivo Reprovado`, `Motivo Reenvio`)
   nas abas **`GoDocs`** e **`STAGING`** — o Luis já criou as colunas, mas o mapeamento é **por nome** e um
   acento diferente faz a coluna ser **ignorada com aviso**, silenciosamente. As duas abas já divergem em
   posição de coluna.
2. Ler o plano ativo inteiro + a seção **"Decisões fechadas que NÃO podem ser corrigidas por engano"**
   (`spec-docs/`, regra 12).
3. Invocar a skill **`frontend-design`** antes da UI da Etapa 2 e do modal de triagem (regra 11).

**Ordem sugerida de execução:** T4 (colunas/sync — desbloqueia a verificação) → T1 (Etapa 2) → T3 (analisador
+ `normalizarClassificacao`) → T2 (memorial/agente) → T5 (`/dashboard`) → T6 (motivo visível ao autor — **é
julgamento do Claude, confirmar com o Luis se mantém**) → T7 (régua de 1 página pro Rafa).

**2 pontos de atenção que o Luis já conhece e não devem ser "corrigidos" por engano:**
- **Não** encerrar a regra TEMPORÁRIA do `Pendente` (decisão D1: a única exceção é `claro_nao → Reprovado`).
- **Não** mexer no `CHECK` de `projetos.status` (exigiria rebuild da tabela); o discriminador da reprovação é a
  coluna nova `classificacao_avaliacao`.
- ⚠️ A régua do Rafa tinha **gate humano** no plano de 28/07 ("nenhum código encosta na régua antes do OK
  dele"). O Luis mandou codar; a régua sai no mesmo PR (T7) e **deve ser calibrada com o Rafa antes do deploy
  em produção** — reprovar projeto é visível ao autor.

✅ **T6 dos loadings encerrado em 2026-07-28:** branch já estava 0 atrás do `origin/main`; 658 testes + `build`
+ `build:worker` verdes (`worker.js` inalterado); **staging `edf400b4`** validada no navegador pelo Luis;
**prod `674a3710`** com os mesmos artefatos (`index-D76hNGpt.js` conferido no `index.html` de prod via
`E2E_COOKIE`); **PR #215 mergeado** → `main` = `ad64895`, espelhando prod.
⚠️ Gotchas do deploy que custaram tempo: `scripts/deploy-godeploy.sh` recebe o **TOKEN** como 1º argumento (URL
com `?token=` → **401**) e o `uploadId` é **single-use** (novo `getUploadToken` entre staging e prod).
Nesta sessão `gh pr create`/`gh pr merge` **funcionaram** — o bloqueio local do classificador não se repetiu.

⚠️ **PR #214 (dashboard de triagem) foi MERGEADO** no `main` (`e878bc1`) nesta sessão; o worktree
`dashboard-admin-sheets` e a branch local foram removidos.
