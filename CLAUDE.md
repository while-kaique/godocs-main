# GoDocs

Hub interno do Gogroup para documentar projetos de automação (RPA & IA). Funcionários submetem projetos via formulário de 3 etapas com chat IA que coleta documentação técnica + memorial de impacto financeiro (saving e/ou receita). Os dados ficam no SQLite local e são sincronizados diretamente com o Google Sheets (planilha) + Google Chat (notificação) na submissão, via Service Account (`src/lib/google/`).

> ⚠️ **TEMPORÁRIO — Status sempre "Pendente" na planilha**
> Enquanto validamos a eficácia do formulário, o sync para o Google Sheets grava **"Pendente"** na coluna Status de **todos** os projetos — inclusive os auto-aprovados (RPA) e os aprovados pelo agente analisador. O status interno (SQLite/dashboard) continua correto e inalterado; só o Sheets é afetado.
> Pontos marcados com `// TEMPORÁRIO` em `src/lib/chat.functions.ts` (`submeterParaValidacao` e `analisarProjeto`). **Reverter** para `status === 'aprovado' ? 'Aprovado' : ...` quando a validação terminar.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, TanStack Router (file-based SPA), Tailwind v4, shadcn/ui |
| Backend | Cloudflare Worker (`src/worker.ts`) servindo `/api/*` |
| Banco | SQLite via `GoDeployDB` — prod: `env.DB` Godeploy (async), dev: `better-sqlite3` |
| IA | Abstração LLM (`llm.ts`) — OpenAI / Anthropic; modelo rápido opcional (`LLM_MODEL_FAST`) |
| Build | Vite 7, TypeScript strict, npm |
| Deploy | Godeploy (SPA estática + Worker + datasource SQLite) |

## Comandos

```bash
npm run dev            # testes + dev server
npm run test           # testes (Vitest)
npm run build          # SPA em dist
npm run build:worker   # bundle worker.js (esbuild)
npm run lint / format  # eslint / prettier
```

## Regras obrigatórias

1. **`worker.js` commitado** — ao mexer em qualquer `.functions.ts`, `worker.ts`, ou código server-side: `npm run build:worker` e comitar o `worker.js` atualizado
2. **Testes** — rodar `npm run test` após qualquer modificação no código
3. **Prompts da IA alterados** — atualizar `src/lib/testes/prompt-registry.ts` e `prompt-inspector.tsx` para refletir a mudança
4. **Português com acentuação** — todo texto visível ao usuário DEVE ter acentos corretos (`producao` → `produção`, `area` → `área`)
5. **`routeTree.gen.ts`** — auto-gerado, não editar
6. **Banco async** — sempre `await` e sempre passar params (mesmo `[]`)
7. **CLAUDE.md atualizado antes de cada PR** — antes de criar um PR, verificar se as mudanças feitas exigem atualização do CLAUDE.md (novas regras, convenções alteradas, seções adicionadas/removidas). Não precisa atualizar a cada prompt — só antes de subir o PR.
8. **Sempre trabalhar em worktree (uma branch por correção)** — para QUALQUER tarefa que modifique arquivos (correção, feature, refactor, ajuste de docs), criar um worktree git isolado com uma branch nova **antes** de editar, e fazer todo o trabalho lá. Motivo: é comum haver mais de uma sessão do Claude mexendo neste repo ao mesmo tempo (vários chats abertos no terminal/VSCode); editar direto na pasta principal atropela os arquivos das outras sessões. O worktree isola o checkout em disco, então cada chat trabalha numa branch própria sem conflito. Tarefas puramente de leitura/diagnóstico (sem edição) não precisam de worktree.
9. **Deploy Godeploy — assets dinâmicos** — o Vite gera hashes diferentes a cada `npm run build`. **NUNCA** reutilizar uma lista de assets de um build anterior. Sempre gerar a lista dinamicamente a partir do `dist/` real logo após o build:
   ```bash
   # Gerar lista de assets para o updateApp
   echo -n '["index.html"'; for f in dist/assets/*; do echo -n ',"assets/'"$(basename "$f")"'"'; done; echo ']'
   ```
   Se a lista de assets não bater com o `index.html`, o site fica em tela branca (o HTML referencia `.js`/`.css` que não existem no servidor).
10. **`git pull` antes de abrir PR** — sempre que o usuário pedir para abrir um PR, fazer `git fetch origin` + incorporar o `origin/main` na branch (merge/rebase) **antes** de subir, e rebuildar o `worker.js`/`dist` após o merge. Motivo: várias sessões mexem no repo ao mesmo tempo (regra 8) e o `main` costuma andar — abrir PR sem sincronizar gera conflito/PR desatualizado.

## Deploy rápido (Godeploy)

App ID: `674a3710` · URL: `https://godocs.devgogroup.com/`

```bash
# 1. Build
npm run test && npm run build && npm run build:worker

# 2. Upload (obter token, subir arquivos, anotar o uploadId)
# Usar MCP tool getUploadToken → pegar uploadUrl
# Montar o curl com TODOS os arquivos de dist/ + worker.js:
curl -X POST "$UPLOAD_URL" \
  -F "worker.js=@./worker.js" \
  -F "index.html=@./dist/index.html" \
  $(for f in dist/assets/*; do echo -F "\"assets/$(basename "$f")=@./$f\""; done)

# 3. Deploy (usar MCP tool updateApp)
# appId: 674a3710
# uploadId: <id retornado no passo 2>
# assets: gerar dinamicamente — NUNCA copiar de um build anterior:
echo -n '["index.html"'; for f in dist/assets/*; do echo -n ',"assets/'"$(basename "$f")"'"'; done; echo ']'
# assetConfig: { "not_found_handling": "single-page-application" }
# description: "Hub interno do Gogroup para documentar projetos de automação (RPA & IA)"
# entrypoint: "worker.js"
```

**Regras críticas do deploy:**
- Assets sem prefixo `dist/` (correto: `assets/foo.js`, errado: `dist/assets/foo.js`)
- SPA fallback obrigatório (`not_found_handling: "single-page-application"`)
- Lista de assets DEVE ser gerada do `dist/` real (hashes mudam a cada build)
- Detalhes completos em [docs/deploy.md](docs/deploy.md)

## Documentação detalhada

| Documento | Conteúdo |
|---|---|
| [docs/backend.md](docs/backend.md) | Worker, rotas de API, funções server-side, LLM, extração de texto |
| [docs/frontend.md](docs/frontend.md) | Rotas, componentes, formulário de submissão, design system |
| [docs/database.md](docs/database.md) | Schema, tabelas, tipos, padrões de acesso, migrações |
| [docs/agents.md](docs/agents.md) | Sistema de agentes IA: orquestrador, extrator, compilador, analisador |
| [docs/business-rules.md](docs/business-rules.md) | Fluxo de submissão, fases do chat, cálculos de saving/receita, regras de negócio |
| [docs/deploy.md](docs/deploy.md) | Deploy no Godeploy, env vars, checklist pré-deploy |

## Memorial padronizado

O memorial de cálculo segue uma estrutura fixa com pontos obrigatórios. A IA insiste até ter resposta para cada ponto — nunca pula.

**Saving (Seções 1-5):** Contexto → Saving de Pessoas (por cargo: rotina, frequência, cálculo, **composição das horas**, antes/depois) → Contratos/Serviços Evitados → Custo da Automação → Resumo

**Composição das horas (obrigatória no ponto 2.2):** o total de horas de cada cargo NÃO pode ficar como número solto — o agente coleta e registra no memorial a **quebra do total por atividade**, cada uma com sua parcela de horas, somando exatamente o total (ex.: "160h que compõem: at-x 4h, at-y 10h, at-z 146h"). É **gate antes do preview** (proibido gerar preview com o total de um cargo sem a quebra das atividades) e vale também no caso contrafactual/"ninguém fazia" (quebra do equivalente manual estimado). Regra no `buildSavingPrompt` (`orchestrator.ts`).

**Receita (Seção 6):** O que gera → Como aumenta → Antes vs. depois → Base de cálculo → Valor → Tipo

**Títulos legíveis (não códigos `[x.x]`):** as numerações `[1.1]`/`[2.2]`/`[6.1]`… são o **checklist interno** do orquestrador — NÃO devem aparecer no texto do memorial (ninguém que lê a aprovação sabe o que `[2.2]` significa). Os prompts de preview (saving/receita) instruem o LLM a usar **título legível** por ponto: cabeçalho `### ...` por seção + rótulo em negrito (`**O que fazia:**`, `**Serviço evitado:**`) nos itens. Rede de segurança determinística (cobre legados e escorregões do LLM): `normalizarMarcadoresMemorial()` em `src/lib/agents/memorial-format.ts` (mapa `TITULOS_MEMORIAL`) troca qualquer `[x.y]`/intervalo `[x.y-x.z]` residual pelo título — idempotente, aplicada no `enriquecerMemorial` (planilha), na tela read-only (`projeto.$id.tsx`, que renderiza via `SimpleMarkdown`) e no preview do chat (`cleanPreviewContent`).

**Memorial duplo (opção B):** o LLM gera memorial SEM R$ (visível ao usuário). O backend injeta valores financeiros via `enriquecerMemorial()` em `saving-calc.ts` — a versão com R$ vai para `projetos.memorial_calculo` (planilha). R$ nunca toca o LLM.

**Horas = fonte de verdade (`linhas`):** o backend grava o saving recomputando sempre das `linhas` (cargo + `horas_antes`/`horas_depois`) via `recomputarSavingFinanceiro` — o texto do memorial NÃO é a fonte. Por isso o total escrito no memorial DEVE bater com a soma de (`horas_antes` − `horas_depois`) das linhas, e **multiplicadores** (por loja/unidade/colaborador) entram **dentro das linhas**, não só na prosa (o prompt do orquestrador instrui isso). Guard log-only `avisarDivergenciaMemorialLinhas` (`chat.functions.ts`) registra aviso quando o total do texto diverge do gravado — não bloqueia. (Bug de origem: agente ajustava "90h→270h (3 lojas)" só no texto e a planilha recebia 90h.)

**Ganho real × projetado (portão em `buildSavingPrompt`):** o GoDocs documenta **só ganhos já realizados** (automação em produção + "depois" medido) — é a 1ª premissa do formulário. O prompt do saving tem um **portão obrigatório** que detecta sinais de projeção ("a expectativa é", "a projeção é", "deve reduzir/cair", verbos no futuro/condicional para o ganho, ferramenta ainda não em produção / "depois" nunca medido). Ao detectar, a IA **para e pergunta uma vez** se a redução já acontece e foi medida na prática: confirmou produção + medição → segue e escreve o memorial em **passado/presente** ("passou a levar 30 min"), **proibida** linguagem de projeção no texto; for só expectativa → **não gera preview**, orienta voltar quando medido ou ir como **projeto especial**. ⚠️ O portão mira o **"depois"** projetado — NÃO confunde com o "antes" estimado do **saving contrafactual** (esse é legítimo; lá a automação já roda). (Caso de origem: memorial cheio de "a expectativa é fazer em 2h"/"a projeção é reduzir para 30 min" — ganho não realizado vazou como saving consolidado.)

**Plausibilidade entre cargos (`buildSavingPrompt`):** a validação por cargo agrupa numa pergunta só as linhas do **mesmo** cargo (ex.: 7× "analista sênior" → uma pergunta para o grupo), mas trata cargos **distintos** separadamente — o agente se questiona sobre a função plausível de cada cargo (head aprova/supervisiona, analista executa, estagiário apoia). Quando ≥2 cargos distintos aparecem com `horas_antes` iguais/parecidas sobre o **mesmo processo descrito**, o agente **questiona** (volume cheio por pessoa × compartilhado; senioridades diferentes gastando o mesmo tempo?) e usa a resposta — **sem assumir** divisão nem reescrever horas sozinho. Previne o erro de o usuário descrever **um** processo, marcar **N** cargos no formulário, e o memorial replicar o processo inteiro em cada cargo (somando N× o mesmo trabalho e inflando o total). É só persuasão via prompt — não há gate determinístico no backend.

**Colunas de memorial na planilha (V vs Z):** a coluna **"Memorial de Saving" (V)** recebe **só a parte de saving** (`memorialSavingLimpo` = `enriquecerMemorial(saving, undefined, ['saving'])`, com R$) — em projeto só-receita fica `—`. A coluna **"Receita Memorial" (Z)** recebe só a receita. ⚠️ Antes a V recebia o memorial **unificado** (saving+receita), então a receita vazava na coluna de saving (corrigido em `chat.functions.ts`, 2 fluxos). O `projetos.memorial_calculo` (banco) **segue unificado** — alimenta `Memorial anterior`/auditoria.

**Pontual e o ÷12** — saving e receita pontual entram pelo valor cheio (NÃO dividem por 12). **Exceção: custo evitado** (coletado no formulário de saving) — cada ferramenta evitada com recorrência **pontual é mensalizada ÷12** antes de somar ao saving; mensal entra cheio.

**"Alguém já fazia?" → "Não" coleta o equivalente manual (saving contrafactual):** no form de saving, ao marcar **"Não, ninguém fazia"**, a tabela NÃO pergunta mais "quem dedica tempo à automação hoje" (modelo antigo, que gravava `horas_antes=0` → saving de horas zero). Agora pergunta **"qual seria o equivalente em trabalho manual?"** — quantas horas/mês o trabalho levaria **se alguém tivesse que fazer à mão** e qual cargo seria responsável. Esse valor é gravado em **`horas_antes`** (com `horas_depois = 0`, campo nem aparece) — é **saving contrafactual** (o trabalho que a automação evita). O orquestrador recebe `alguem_fazia` via `ProjetoContexto` (`ctx.alguem_fazia`) e, quando `'nao'`, **valida a estimativa** (volume × tempo) em vez de pedir o passo a passo de uma rotina que nunca existiu (`comoAbrir` no `buildSavingPrompt`). UI/lógica em `src/lib/submeter/step3-chat.tsx` (toggle inverte qual coluna some); submit força `horas_depois=0` no modo "nao" (`submeter.tsx`). (Antes: "Não" gravava `horas_antes=0` e só coletava horas de monitoramento — que não geravam saving.)

**Custo evitado (3º tópico do form de saving):** pergunta obrigatória Sim/Não abaixo de "Alguém já fazia". Se Sim → lista incremental `nome → valor → recorrência → justificativa`. O backend mensaliza, soma em `custo_evitado_reais` (entra no `saving_reais`/`ganho_total`) e persiste as colunas `custo_evitado` ('sim'/'nao'), `custo_evitado_justificativa`, `custo_evitado_itens` (JSON). No Google Sheets: a coluna **"Custo Evitado"** recebe o **VALOR R$ mensal** (`custo_evitado_reais`, **`0` quando não há** — coluna numérica, consistente com "Custo Externo Mensal"/"Receita Mensal") — NÃO o 'sim/não'; **"Justificativa Custo Evitado"** segue igual; a **recorrência marcada** (mensal/pontual/Misto) vai na coluna **"Custo Mensal ou Pontual"** (derivada de `custo_evitado_itens`). `custo_evitado_itens` é **só no banco**. O agente não pergunta mais isso — só descreve qualitativamente, sem R$.

## Sync Google (Sheets + Chat + Drive) — bidirecional

- **Mapeamento por NOME (não por posição)** em `src/lib/google/sheets.ts`. `SHEET_COLUMNS` lista os **nomes** de coluna que o sistema lê/escreve (layout atual: **A→AJ** da aba `GoDocs`), mas append/update/`readAllRows` resolvem a posição em runtime lendo o **cabeçalho real** (linha 1, via `fetchHeaderMap`) e casando por nome. Reordenar/inserir colunas na planilha NÃO quebra o sync — basta o nome bater (chave ausente → ignorada com aviso, nunca grava na coluna errada). Colunas `Diff Horas / Antes` e `Diff Saving / Antes` são **manuais** (o sistema nunca escreve nelas). **`Memorial anterior`** é escrita **só na edição**: recebe o `memorial_calculo` da versão imediatamente anterior (lido antes do update; sempre o último, não o histórico todo) — em submissão nova fica em branco. Coluna **"URL"** guarda o **link do Drive**; **"Atualizado Em"** é o carimbo de última escrita do sistema; **"Horas em Reais"** = R$ bruto das horas (antes de custo evitado/externo); **"Saving Reais"** = líquido total. ⚠️ Antes mapeava por posição fixa — reordenação manual na planilha gravava tudo deslocado (bug da linha 268).
- **Ida (SQLite → Sheets)** — submissão nova → append; edição → UPDATE in-place casando por `ID Projeto` (coluna B), via `updateRowByProjectId`. Nunca duplica linha numa edição. (`src/lib/google/sync.ts`)
- **Volta (Sheets → SQLite), de hora em hora** — `syncSheetsToSqlite()` (`src/lib/google/sync-reverse.ts`) lê toda a aba (`readAllRows`) e: (a) **cria** no SQLite legados que só existem na planilha (habilita "Meus Projetos"/edição); (b) **atualiza** projetos existentes só nos **campos seguros** (diff-aware; célula vazia nunca apaga dado). **`status` é excluído da volta** (a planilha grava sempre "Pendente" pela regra TEMPORÁRIA — sincronizar rebaixaria o status interno). ⚠️ **Ownership AGORA sincroniza do Sheets** (fonte da verdade): `Email`→`responsavel_email`, `Nome Completo`→`responsavel_nome` e `Participantes`→`membros` entram no `SAFE_UPDATE_FIELDS`/`atualizarExistente` — editar essas colunas na planilha reatribui dono/participantes no GoDocs (antes ficavam de fora p/ "proteger ownership"; mudou a pedido — Sheets é a fonte única). `membros` é tratado fora da tabela `SAFE_UPDATE_FIELDS` (parse de lista→array). Vale a regra "célula vazia não apaga" (Email/Participantes vazios mantêm o atual). Rota cron `POST /api/cron/sync-sheets-to-sqlite` (header `x-godeploy-cron`) + disparo manual admin `POST /api/admin/sync-sheets-now`. Match por ID case-insensitive.
- **Sync sob demanda por dono (Sheets é fonte da verdade de "Meus Projetos")** — `listarMeusProjetos(email)` chama `syncOwnerRowsFromSheet(email)` (`sync-reverse.ts`) **antes** de ler o SQLite: lê a aba, filtra as linhas onde `Email` (col F) === email OU `Participantes` (col H) contém o email (case-insensitive), e cria/atualiza só essas no SQLite — o legado da planilha aparece na hora, sem esperar o cron. Falha de leitura cai de volta no SQLite (try/catch). Match de email é case-insensitive em todo lado (`getProjetosByOwnerEmail` usa `LOWER()`, `ehOwner`/`ehParticipante` comparam `.toLowerCase()`).
- **Ownership: owner edita, participante só visualiza** — em `meus-projetos.functions.ts`: **owner** = `responsavel_email` (quem submeteu); **participante** = está em `membros` mas não é owner. `temAcesso` = owner OU participante (leitura). **Só o owner edita**; participante apenas visualiza — e **ser participante VENCE o override de admin**: um admin que também é participante do projeto NÃO edita (vê como participante); o override de admin só vale para projetos em que ele não tem papel (`podeEditar = ehOwner || (ehAdmin && !ehParticipante)`). `listarMeusProjetos` marca o `papel` de cada item; `getMeuProjeto` retorna `papel` + `podeEditar`. Gate server-side definitivo: `submeterParaValidacao(body, email)` bloqueia (403) reenvio de quem não é owner — e também bloqueia admin que seja participante. Frontend: `meus-projetos.tsx` tem 4 filtros — **Todos** (padrão, owner+participante submetidos) · **Meus** (owner) · **Participo** (participante, só "Visualizar") · **Rascunhos**; `/editar/$id` redireciona quem não pode editar para `/projeto/$id`; `/projeto/$id` é a tela **read-only** (memorial SEM R$, via `documentacao.conteudo`; botão Editar só aparece com `podeEditar`). **Mudança de owner → acionar a equipe RPA** (disclaimer via tooltip `(i)`). O aviso "só o autor edita" aparece nos filtros **Participo** E **Todos** (quando há projeto de participação). Componentes: `components/info-tooltip.tsx`, `components/status-badge.tsx`. **Pendência de legado: owner E participante VEEM** (mensagem difere por papel — só o owner pode regularizar/reenviar; participante recebe "acione o autor/equipe RPA"); o **selo da home** (`contarPendentes`) conta os pendentes do usuário — **owner E participante**. A home busca o selo em 2 passos: rápido (SQLite, aparece na hora) e, se vier 0, confirma com o Sheets (`?sync=1` → `syncOwnerRowsFromSheet` antes de contar — cobre o caso de o SQLite ainda não ter o legado do usuário). **`apiFetch`** trata resposta não-JSON (página HTML de erro/timeout do edge) com mensagem clara em vez de "Unexpected token '<'". ⚠️ A edição seeda **todos** os campos da 1ª submissão, inclusive custo evitado (`custo_evitado`/`custo_evitado_itens` precisam estar no retorno de `getMeuProjeto` — o seed em `submeter.tsx` os lê).
- **Status em "Meus Projetos" vem SÓ do Sheets (fonte da verdade) — nunca do SQLite** — `listarMeusProjetos` usa a coluna **"Status" do Sheets** para o badge, normalizada em minúsculas (`StatusBadge` aceita `pendente`/`reenvio pendente` além das chaves internas). **Rascunho** é estado interno do app (nunca vai ao Sheets) → mantém `'rascunho'`. **Submetido ausente na planilha** (gap de sync) ou leitura falhou → `null` → badge mostra "—" (NÃO cai no status do SQLite). ⚠️ Como o Sheets grava sempre **"Pendente"** (regra TEMPORÁRIA), submetidos aparecem como "Pendente" até a regra ser encerrada.
- **Dois estados de pendência distintos em Meus Projetos** (`meus-projetos.tsx`, componente `AvisoPendencia`): (1) **Regularização de legado** — âmbar, ícone `CalendarClock`, prazo **30/06/2026**, ação "editar e salvar" (flag `pendente` = legado sem "Atualizado Em"); (2) **Reenvio solicitado** — vermelho, ícone `RotateCcw`, sem prazo, ação "corrigir e reenviar" (status `reenvio pendente`/`rejeitado`). São conceitos diferentes e a copy não os mistura (legado = "atualize/regularize"; reenvio = "corrija e reenvie").
- **Admin: fonte única, SEM hardcode** — `isAdmin(email)` em `src/lib/auth.functions.ts` é a **única** porta de verdade: `ADMIN_EMAILS` (env, lista separada por vírgula, bootstrap canônico — secret no Godeploy) **∪** tabela `admins` (CRUD dinâmico no painel). TODOS os checks de admin DEVEM usar `isAdmin()` (`requireAdmin` no worker, `getMeuProjeto`, gate de `submeterParaValidacao`) — nunca `getAdminByEmail` direto (a inconsistência entre lista hardcoded e banco já deixou um ex-admin removido continuar editando). Para remover um admin de bootstrap, edite `ADMIN_EMAILS`; dinâmicos, pelo painel.
- **Rascunhos (Meus Projetos)** — `/submeter` persiste o rascunho em localStorage (`src/lib/submeter/draft-storage.ts`) e RETOMA o mesmo `projetoId` ao atualizar/voltar (não cria órfão); limpa ao submeter. `?retomar=<id>` reabre um rascunho específico (cross-device usa `GET /api/chat/historico/:id`). A tela `meus-projetos.tsx` tem abas **Submetidos** (padrão) e **Rascunhos** (secundária); rascunhos nunca vão para o Sheets (a IDA só roda na submissão). Na aba Rascunhos é possível **excluir** um rascunho (`DELETE /api/meus-projetos/:id` → `excluirRascunho` → `excluirProjetoCascade`; só status `rascunho`, gate de ownership, toast de confirmação).
- **Legado pendente** — projeto **LEGADO** (id no padrão `LEGADO-233`, importado antes do formulário) cuja coluna **"Atualizado Em"** está vazia/`—` no Sheets → precisa ser editado/reenviado para regularizar (a edição preenche o "Atualizado Em"). ⚠️ **Só conta legado**: projetos submetidos pelo app (id aleatório hex) NUNCA são pendentes, mesmo sem "Atualizado Em" (`ehLegado(id)` = id contém `legado`, case-insensitive). O "Atualizado Em" é **espelhado na coluna SQLite `projetos.atualizado_em`** (migração em `schema.ts`): o sync reverso popula (`criarLegado` + `SAFE_UPDATE_FIELDS`) e a submissão (IDA) marca na hora em `submeterParaValidacao` — célula vazia/legado fica `null` = pendente. `listarMeusProjetos` usa o valor recém-lido da planilha (cai no espelho SQLite se a leitura falhar, nunca marca tudo como pendente). A tela "Meus Projetos" mostra aviso por linha pendente; a home tem selo via `GET /api/meus-projetos/pendentes` (`contarPendentes`), que lê **só do SQLite** (sem tocar no Sheets) → selo **instantâneo** (~1s vs ~9s da leitura da planilha). Prazo de regularização (`PRAZO_LEGADO` em `meus-projetos.functions.ts`): **30/06/2026**.
- **Drive (documentos)** — os arquivos enviados no upload são salvos no Google Drive via `uploadDocsToDrive` (`src/lib/google/drive.ts`), chamado em `iniciarSubmissao` e `atualizarMetadados` (cobre fluxo normal E especial). Os links (webViewLink) ficam em `projetos.arquivos_links` (JSON) e vão para a coluna **J "URL"** da planilha. Pasta: env `GOOGLE_DRIVE_FOLDER_ID` (default `1e_Fk8...`, dona `rpa_ia@gocase.com`). ⚠️ **O upload usa OAuth de USUÁRIO** (`getDriveAccessToken` em `auth.ts`, envs `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`), NÃO a Service Account — Service Accounts não têm cota de storage e recebem 403 ao criar arquivos no Meu Drive. `uploadDocsToDrive` NÃO propaga erro (loga e segue sem link), para nunca quebrar a submissão.
- **`waitUntil` obrigatório p/ fire-and-forget** — o sync de IDA para Sheets/Chat roda via `runBackground()` (`src/lib/background.ts`), que registra a promise no `ctx.waitUntil` exposto pelo worker em `globalThis.__waitUntil`. Sem isso, no runtime do Godeploy a promise não-aguardada é cancelada quando a Response retorna e o sync morre no meio.
- **Reconciliação de "Complexidade" (cron)** — o analisador roda em background (`ctx.waitUntil`) após o submit e às vezes é **cancelado** antes de gravar a Complexidade/Observações na planilha → a coluna ficava vazia de forma intermitente. Mitigações: (1) o sync da análise é **aguardado** dentro de `analisarProjetoFn` (não FAF aninhado); (2) o cron **`POST /api/cron/reanalisar-pendentes`** (a cada 1 min, `reconciliarComplexidade` em `chat.functions.ts`) varre os projetos submetidos com Complexidade vazia na planilha e conserta: repõe do SQLite (sem Chat) se já analisado, ou re-roda o analisador se não. Idempotente; nunca sobrescreve Complexidade preenchida. Disparo só pelo scheduler do Godeploy (header `x-godeploy-cron` é removido em chamadas externas).

## Investigador (painel admin)

- **3 abas**: **Submetidos** (`submitted_at != null`, abre a submissão original) · **Edições** (1 linha por reenvio, com chat/API/métricas da edição) · **Abandonados** (rascunho nunca submetido e inativo há **> 1h** — diagnóstico de travamentos). Sem "tempo de submissão"/"tempo médio" (inflavam com o form aberto).
- **`form_events` é APPEND-ONLY** ⚠️ — os valores marcados no formulário (saving mensal, horas, custo evitado, receita, metadados) chegam por payloads e **não viram `chat_messages`**; são gravados em `form_events` por `chat.functions.ts` (helper `gravarEvento`, não-bloqueante) para aparecerem no timeline do Investigador. **Ao mexer nas limpezas de chat (`deleteChatMessages*`), NUNCA apague `form_events`** — é uma tabela separada justamente para sobreviver às limpezas e preservar o histórico de "voltar etapa" (`voltou: true`).
- **`snapshot_chat`** em `projeto_versions` — `submeterParaValidacao` congela a conversa de cada versão (via `gravarVersaoProjeto`). Forward-only: versões antigas (NULL) caem no chat atual. As abas usam o snapshot da versão; métricas/eventos por versão são fatiados pela janela `[versão anterior, versão]`.

## Testes E2E em produção (validação coluna-a-coluna)

Harness em **`scripts/e2e/`** para validar de ponta a ponta os cálculos de saving/receita e o
preenchimento das colunas A→AJ da planilha, fazendo submissões/edições reais contra produção e
comparando cada coluna com o valor esperado. **Cartesiano amplo (~24 cenários)**: saving (custo
evitado não/mensal/pontual/**misto** × custo externo), receita pura/pontual, saving+receita,
complexidade (automacao/**inteligencia**/**autonomia** + cruzamentos), especial, e edições (leve,
memorial novo, reclassificação) com bases dedicadas. Útil para validar mudanças nas regras
financeiras **antes/depois de mexer no fluxo**. Detalhes em [scripts/e2e/README.md](scripts/e2e/README.md).

```bash
npm run e2e:run -- <runId>        # roda os cenários (E2E_ONLY=<key> roda só 1, p/ sanidade)
npm run e2e:validate -- <runId>   # asserts determinísticos: colunas × esperado + poll da Complexidade
npm run e2e:validate-llm -- <runId>  # LLM-juiz: audita coluna a coluna (acha o que os asserts não pegam)
npm run e2e:cleanup -- <runId>    # remove as linhas de teste (planilha → SQLite)
# scripts/e2e/dump.mjs <runId>    # despeja todas as colunas A→AJ de um run, p/ auditoria manual
```

- **Duas camadas de validação:** (1) `validate.mjs` = asserts determinísticos (fórmula independente
  + consistência planilha×API + gate de Complexidade + comparação do `Memorial anterior`); (2)
  `validate-llm.mjs` = **LLM-juiz** ("verificação da verificação") que recebe a linha completa + a
  ficha do cenário e sinaliza divergências semânticas que os asserts fixos não pegam (qualidade do
  memorial, vazamento entre colunas, coerência das Observações). Achou 3 bugs reais já corrigidos.

- **Pré-requisito: `E2E_COOKIE` no `.env`.** O gateway Godeploy exige **OAuth no edge para TODAS as
  rotas** (inclusive `/api/*`) — sem sessão, leva `302 → /auth/login`. Logue em
  `godocs.devgogroup.com` (como admin, ex. `luis.albuquerque@gocase.com`), copie o header
  `cookie:` (formato `SESSION=...`) e ponha em `E2E_COOKIE="SESSION=..."`. O harness replica o
  cookie; o edge injeta o `x-godeploy-user-email` a partir dele (cobre chat e admin). O cookie
  expira — se der 302 no meio, renove.
- **Tag `[E2E-<runId>]`** no nome de todo projeto de teste: identifica/filtra na planilha e no
  Investigador, é a chave da limpeza e o **gatilho do mute de Google Chat** (`ehProjetoTesteE2E`
  em `chat.ts`/`sync.ts` — projetos `[E2E-` NÃO notificam o time; a gravação na planilha é normal).
- **Roda contra a aba GoDocs REAL** (o worker escreve onde `GOOGLE_SHEETS_TAB` aponta). As linhas
  ficam marcadas e são removidas no fim. **Ordem da limpeza importa: planilha primeiro, depois
  SQLite** (`POST /api/admin/e2e-cleanup`) — senão o sync reverso por dono ressuscita do Sheets.
- O chat é dirigido por um **LLM responder** (`lib/responder.mjs`, reusa `llmChat`); a validação lê
  a planilha via Service Account (`lib/sheets.mjs`). Cenários e valores esperados em `scenarios.mjs`.
- ⚠️ O guard de Chat mudo e o endpoint `e2e-cleanup` são **temporários** (escopo `[E2E-]`); reverter
  quando a validação por testes não for mais necessária (ver README).

## Convenções rápidas

- Path alias: `@/*` → `./src/*`
- shadcn/ui em `src/components/ui/` — não editar diretamente
- Funções server-only: `.server.ts` ou importam de `integrations/db/client.server`
- Forms: react-hook-form + zod; toasts via sonner
- Idioma da interface: PT-BR
- Identidade visual: `--go-blue` (#0059A9), `--go-lime` (#D7DB00), `--go-cream` (#FBF4EE), fonte Poppins
