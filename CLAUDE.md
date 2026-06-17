# GoDocs

Hub interno do Gogroup para documentar projetos de automação (RPA & IA). Funcionários submetem projetos via formulário de 3 etapas com chat IA que coleta documentação técnica + memorial de impacto financeiro (saving e/ou receita). Os dados ficam no SQLite local e são enviados ao n8n (webhook → Markdown/Drive/planilha) na submissão.

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
npm run build          # SPA em dist/
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
7. **Deploy Godeploy — assets dinâmicos** — o Vite gera hashes diferentes a cada `npm run build`. **NUNCA** reutilizar uma lista de assets de um build anterior. Sempre gerar a lista dinamicamente a partir do `dist/` real logo após o build:
   ```bash
   # Gerar lista de assets para o updateApp
   echo -n '["index.html"'; for f in dist/assets/*; do echo -n ',"assets/'"$(basename "$f")"'"'; done; echo ']'
   ```
   Se a lista de assets não bater com o `index.html`, o site fica em tela branca (o HTML referencia `.js`/`.css` que não existem no servidor).

## Documentação detalhada

| Documento | Conteúdo |
|---|---|
| [docs/backend.md](docs/backend.md) | Worker, rotas de API, funções server-side, LLM, extração de texto |
| [docs/frontend.md](docs/frontend.md) | Rotas, componentes, formulário de submissão, design system |
| [docs/database.md](docs/database.md) | Schema, tabelas, tipos, padrões de acesso, migrações |
| [docs/agents.md](docs/agents.md) | Sistema de agentes IA: orquestrador, extrator, compilador, analisador |
| [docs/business-rules.md](docs/business-rules.md) | Fluxo de submissão, fases do chat, cálculos de saving/receita, regras de negócio |
| [docs/deploy.md](docs/deploy.md) | Deploy no Godeploy, env vars, checklist pré-deploy |

## Convenções rápidas

- Path alias: `@/*` → `./src/*`
- shadcn/ui em `src/components/ui/` — não editar diretamente
- Funções server-only: `.server.ts` ou importam de `integrations/db/client.server`
- Forms: react-hook-form + zod; toasts via sonner
- Idioma da interface: PT-BR
- Identidade visual: `--go-blue` (#0059A9), `--go-lime` (#D7DB00), `--go-cream` (#FBF4EE), fonte Poppins
