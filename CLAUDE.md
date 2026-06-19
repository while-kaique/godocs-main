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
8. **Deploy Godeploy — assets dinâmicos** — o Vite gera hashes diferentes a cada `npm run build`. **NUNCA** reutilizar uma lista de assets de um build anterior. Sempre gerar a lista dinamicamente a partir do `dist/` real logo após o build:
   ```bash
   # Gerar lista de assets para o updateApp
   echo -n '["index.html"'; for f in dist/assets/*; do echo -n ',"assets/'"$(basename "$f")"'"'; done; echo ']'
   ```
   Se a lista de assets não bater com o `index.html`, o site fica em tela branca (o HTML referencia `.js`/`.css` que não existem no servidor).

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

**Saving (Seções 1-5):** Contexto → Saving de Pessoas (por cargo: rotina, frequência, cálculo, antes/depois) → Contratos/Serviços Evitados → Custo da Automação → Resumo

**Receita (Seção 6):** O que gera → Como aumenta → Antes vs. depois → Base de cálculo → Valor → Tipo

**Memorial duplo (opção B):** o LLM gera memorial SEM R$ (visível ao usuário). O backend injeta valores financeiros via `enriquecerMemorial()` em `saving-calc.ts` — a versão com R$ vai para `projetos.memorial_calculo` (planilha). R$ nunca toca o LLM.

**Pontual e o ÷12** — saving e receita pontual entram pelo valor cheio (NÃO dividem por 12). **Exceção: custo evitado** (coletado no formulário de saving) — cada ferramenta evitada com recorrência **pontual é mensalizada ÷12** antes de somar ao saving; mensal entra cheio.

**Custo evitado (3º tópico do form de saving):** pergunta obrigatória Sim/Não abaixo de "Alguém já fazia". Se Sim → lista incremental `nome → valor → recorrência → justificativa`. O backend mensaliza, soma em `custo_evitado_reais` (entra no `saving_reais`/`ganho_total`) e persiste as colunas `custo_evitado`, `custo_evitado_justificativa`, `custo_evitado_itens` (JSON). As duas primeiras vão ao Google Sheets; `custo_evitado_itens` é **só no banco** (não há coluna pra ele no layout atual da planilha). O agente não pergunta mais isso — só descreve qualitativamente, sem R$.

## Sync Google (Sheets + Chat + Drive) — bidirecional

- **Layout da planilha = fonte única de verdade** em `src/lib/google/sheets.ts` (`SHEET_COLUMNS`, colunas **A→AH** da aba `GoDocs`). Append/update/leitura derivam dele — mudou a planilha, muda só ali. Colunas `Diff Horas / Antes`, `Diff Saving / Antes` e `Memorial anterior` são **manuais** (o sistema nunca escreve nelas). Coluna **J "URL"** guarda o **link do Drive** do documento; **AH "Atualizado Em"** é o carimbo de última escrita do sistema.
- **Ida (SQLite → Sheets)** — submissão nova → append; edição → UPDATE in-place casando por `ID Projeto` (coluna B), via `updateRowByProjectId`. Nunca duplica linha numa edição. (`src/lib/google/sync.ts`)
- **Volta (Sheets → SQLite), de hora em hora** — `syncSheetsToSqlite()` (`src/lib/google/sync-reverse.ts`) lê toda a aba (`readAllRows`) e: (a) **cria** no SQLite legados que só existem na planilha (habilita "Meus Projetos"/edição); (b) **atualiza** projetos existentes só nos **campos seguros** (diff-aware; célula vazia nunca apaga dado). **`status` é excluído da volta** (a planilha grava sempre "Pendente" pela regra TEMPORÁRIA — sincronizar rebaixaria o status interno); `responsavel_*`/`membros` também ficam de fora (ownership). Rota cron `POST /api/cron/sync-sheets-to-sqlite` (header `x-godeploy-cron`) + disparo manual admin `POST /api/admin/sync-sheets-now`. Match por ID case-insensitive.
- **Drive (documentos)** — os arquivos enviados no upload são salvos no Google Drive via `uploadDocsToDrive` (`src/lib/google/drive.ts`), chamado em `iniciarSubmissao` e `atualizarMetadados` (cobre fluxo normal E especial). Os links (webViewLink) ficam em `projetos.arquivos_links` (JSON) e vão para a coluna **J "URL"** da planilha. Pasta: env `GOOGLE_DRIVE_FOLDER_ID` (default `1e_Fk8...`); scope `drive.file` em `auth.ts`. ⚠️ **A Service Account precisa de acesso Editor à pasta** — sem isso a API responde 403/404; `uploadDocsToDrive` NÃO propaga erro (loga e segue sem link), para nunca quebrar a submissão.
- **`waitUntil` obrigatório p/ fire-and-forget** — o sync de IDA para Sheets/Chat roda via `runBackground()` (`src/lib/background.ts`), que registra a promise no `ctx.waitUntil` exposto pelo worker em `globalThis.__waitUntil`. Sem isso, no runtime do Godeploy a promise não-aguardada é cancelada quando a Response retorna e o sync morre no meio.

## Convenções rápidas

- Path alias: `@/*` → `./src/*`
- shadcn/ui em `src/components/ui/` — não editar diretamente
- Funções server-only: `.server.ts` ou importam de `integrations/db/client.server`
- Forms: react-hook-form + zod; toasts via sonner
- Idioma da interface: PT-BR
- Identidade visual: `--go-blue` (#0059A9), `--go-lime` (#D7DB00), `--go-cream` (#FBF4EE), fonte Poppins
