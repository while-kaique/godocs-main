# Spec — Widget de Ajuda & Suporte (GoDocs) · jun/2026

> **Documento de planejamento/decisão.** Decisões fechadas com o Luis em 2026-06-26.
> Versionado em `spec-docs/`. Não substitui `docs/` nem o `CLAUDE.md` — quando a feature
> for entregue, atualizar este status + o `CLAUDE.md` (regra 12) no MESMO PR.
>
> **Status global (2026-06-26): ✅ ENTREGUE E DEPLOYADO** (PR #160 + ajuste de copy). Em prod no
> app `674a3710`. Secret `GOOGLE_DRIVE_FOLDER_ID_AJUDA` configurado (pasta dedicada dos prints).
> **Pendência única do Luis:** adicionar o secret `GOOGLE_CHAT_WEBHOOK_URL_AJUDA` no Godeploy — sem
> ele o chamado é gravado no SQLite mas a notificação ao Chat é silenciosamente pulada (no-op).
> **Contato de retorno = direto pelo Google Chat** (não e-mail).
>
> **Onde aterrissou (mapa do código):**
> - Tabela `ajuda_chamados` → `src/integrations/db/schema.ts` (`CREATE TABLE IF NOT EXISTS`).
> - Helpers `insertAjudaChamado` / `getAjudaChamados` / `marcarChatStatusAjuda` (+ `AjudaChamadoRow`)
>   → `src/integrations/db/client.server.ts`.
> - `sendChatNotification(msg, { webhookUrl? })` generalizado (retorna `boolean`) + `buildAjudaMessage`
>   → `src/lib/google/chat.ts`.
> - `criarChamadoAjuda` + schema zod `ajudaSchema` → `src/lib/ajuda.functions.ts` (novo).
> - Rota `POST /api/ajuda` (autenticada, NÃO admin, fora de `/api/chat/`) → `src/worker.ts`.
> - Widget `AjudaWidget` → `src/components/ajuda/ajuda-widget.tsx`; montado em `src/routes/__root.tsx`
>   (irmão do `<Outlet/>`, antes do `<Toaster>`). Keyframe `go-pop-in` em `src/styles.css`.
> - Testes → `tests/ajuda-chat.test.ts` + `tests/ajuda-functions.test.ts` (16 testes).

## Visão geral

Um **botão flutuante de ajuda** (FAB) no canto inferior direito, presente em **todas as
páginas**, acima de tudo. A pessoa clica, abre um **painel estilo chat** com UI/UX limpa, escreve
a **dúvida** ou descreve o **problema/erro** que está enfrentando, opcionalmente **anexa um print**
da tela, e envia. O envio cai num **espaço dedicado do Google Chat** onde o Luis e o Kaique
acompanham — vendo **quem** enviou, **o tipo** (dúvida × problema), **a mensagem**, **a página**
de onde veio e o **link do print**.

**Objetivo:** dar um canal de feedback/suporte de baixo atrito dentro da plataforma, para captar
dúvidas e bugs reais dos usuários sem depender de eles procurarem o time por fora.

**Escopo isolado / baixo risco:** esta feature **NÃO toca** no orquestrador/LLM, no cálculo de
saving/receita, no sync com o Google Sheets, nem no fluxo de submissão. É um caminho novo e
paralelo (rota nova + tabela nova + componente novo + um webhook de Chat novo). O único código
existente que muda é uma **generalização** do `sendChatNotification` para aceitar um webhook
alternativo (ver abaixo).

---

## Decisões fechadas (com o Luis, 2026-06-26)

| # | Decisão | Escolha | Implicação |
|---|---------|---------|------------|
| D1 | **Direção** | **Mão única (envio)** | A pessoa envia; Luis+Kaique veem no espaço do Chat; o retorno acontece por fora, **direto pelo Google Chat** (a equipe chama a pessoa no Chat). **NÃO** há respostas voltando para o app. |
| D2 | **Categoria** | **Tipo: Dúvida · Problema/Erro · Sugestão** | Seletor de 3 opções (lista vertical, ícone + rótulo + descrição). Cada tipo tem **cabeçalho/emoji próprio** na mensagem do Chat (❓ DÚVIDA · 🐞 PROBLEMA/ERRO · 💡 SUGESTÃO) pra distinguir à primeira vista. Sem nível de urgência na v1. *(Atualizado 2026-06-26: era 2 opções; "Sugestão de melhoria" adicionada a pedido.)* |
| D3 | **Anexo (print)** | **Link do Google Drive** | Reaproveita `uploadFileToDrive` (drive.ts). A mensagem do Chat traz um **link clicável** para o print — segue webhook de **texto**, sem migrar para card v2. |
| D4 | **Registro** | **Banco (SQLite), sem painel agora** | Cada chamado é persistido (quem, quando, tipo, texto, página, link do print, status do envio). Habilita um painel admin futuro sem retrabalho. Sem tela admin na v1. |

### Decisões fechadas que NÃO podem ser "corrigidas" por engano

1. **Mão única é intencional (D1).** Não transformar em conversa bidirecional "porque parece
   incompleto". Duas vias é um item de backlog explícito com custo alto (ver "Futuro"); só fazer
   se o Luis pedir.
2. **Print vai como LINK de texto, não como imagem embutida (D3).** O webhook continua mandando
   `{ text }` plain. Não migrar para `cardsV2` sem decisão nova — embutir imagem exige URL público
   da imagem e muda o formato/manutenção. O link do Drive é suficiente para a v1.
3. **Sem painel admin na v1 (D4).** A tabela existe e guarda tudo, mas a leitura do dia a dia é
   pelo **espaço do Google Chat**. Não construir tela admin agora.

---

## Pré-requisitos operacionais (fora do código)

1. ✅ **Espaço do Google Chat criado** + Incoming Webhook gerado (espaço `AAQAl02Wtio`).
   O Luis já entregou a URL do webhook (2026-06-26).
2. ✅ **`.env` local** já tem `GOOGLE_CHAT_WEBHOOK_URL_AJUDA` (a URL crua **NÃO** entra aqui nem em
   nenhum arquivo versionado — `.env` é gitignored; placeholder em `.env.example`). ⚠️ A credencial
   (`key`+`token`) nunca deve ser commitada.
3. ⏳ **Secret no Godeploy (prod):** adicionar `GOOGLE_CHAT_WEBHOOK_URL_AJUDA` aos secrets do app
   `674a3710` antes do deploy — sem isso, o envio é silenciosamente pulado (mesmo comportamento
   defensivo do `GOOGLE_CHAT_WEBHOOK_URL` atual).
4. *(Opcional)* `GOOGLE_DRIVE_FOLDER_ID_AJUDA` — pasta separada do Drive para os prints, para não
   misturar com os documentos de projeto. Default: cai na pasta atual (`GOOGLE_DRIVE_FOLDER_ID`).
   O upload reusa o **OAuth de usuário** já configurado (`GOOGLE_OAUTH_*`), não a Service Account.

> ⚠️ Como em todo o projeto: **ler `process.env` SEMPRE dentro de função** (lazy), nunca em escopo
> de módulo (quebra o bootstrap do worker no Godeploy).

---

## Arquitetura — onde aterrissa (plano file-by-file)

### 1. Banco — nova tabela `ajuda_chamados`

`src/integrations/db/schema.ts` (no bloco `SCHEMA_SQL`, **CREATE TABLE IF NOT EXISTS** — é tabela
nova, não entra em `MIGRATIONS`, que é só para `ALTER` de tabela existente):

```sql
CREATE TABLE IF NOT EXISTS ajuda_chamados (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  usuario_email   TEXT NOT NULL,
  usuario_nome    TEXT,
  tipo            TEXT NOT NULL DEFAULT 'duvida',   -- 'duvida' | 'problema'
  mensagem        TEXT NOT NULL,
  pagina_url      TEXT,                              -- de onde a pessoa abriu o widget
  user_agent      TEXT,
  print_link      TEXT,                              -- webViewLink do Drive (se houver print)
  print_filename  TEXT,
  chat_status     TEXT DEFAULT 'pendente',           -- 'enviado' | 'falha'
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ajuda_chamados_email ON ajuda_chamados(usuario_email);
CREATE INDEX IF NOT EXISTS idx_ajuda_chamados_criado ON ajuda_chamados(created_at);
```

`src/integrations/db/client.server.ts`: helper `insertAjudaChamado(data)` (gera id, `INSERT`,
sempre passa params). Opcional, já mirando o futuro painel: `getAjudaChamados(limit?)` e
`marcarChatStatus(id, status)`.

### 2. Backend — Google Chat (generalizar o webhook)

`src/lib/google/chat.ts`:
- **Generalizar** `sendChatNotification(message, opts?: { webhookUrl?: string })` — quando
  `opts.webhookUrl` vier, usa ela; senão mantém `process.env.GOOGLE_CHAT_WEBHOOK_URL` (o caminho
  de projetos não muda). Defensivo: sem URL → warn + retorna (igual hoje).
- Novo builder `buildAjudaMessage(p)` no mesmo estilo dos `buildSubmitMessage`/`buildUpdateMessage`
  (separadores, emojis Unicode, `*negrito*`). Forma sugerida:

```
──────────────────────

❓ *Nova DÚVIDA no GoDocs*          (ou 🐞 *Novo PROBLEMA relatado no GoDocs*)

👤 *De:* Fulano de Tal (fulano@gocase.com)
📄 *Página:* /meus-projetos
🕒 *Quando:* 26/06/2026 14:32

📝 *Mensagem:*
<texto da pessoa>

🖼️ *Print:* <link do Drive>       (linha omitida quando não há anexo)

──────────────────────
```

  Emoji/label por tipo: **dúvida** → ❓/💬; **problema** → 🐞/🚨.

### 3. Backend — módulo de função `src/lib/ajuda.functions.ts`

- `zod` schema: `tipo` (enum `'duvida' | 'problema'`), `mensagem` (min 1, com teto, ex. 4000),
  `pagina_url?`, `user_agent?`, `print?: { base64, filename }` (opcional, validar tamanho).
- `criarChamadoAjuda({ email, nome?, tipo, mensagem, pagina_url?, user_agent?, print? })`:
  1. Se houver `print`: `uploadFileToDrive({ base64, filename })` dentro de try/catch
     **não-fatal** (loga e segue sem link — print é opcional, nunca derruba o chamado).
  2. `insertAjudaChamado(...)` no SQLite (fonte de verdade do registro).
  3. `runBackground(notificarAjudaChat(...))` — envia ao Chat via `sendChatNotification(msg,
     { webhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA })`; atualiza `chat_status`. **Fire-
     and-forget** com `waitUntil` (obrigatório no Godeploy, ver regra do `runBackground`).
  4. Retorna `{ id, ok: true }` rápido (não espera o Chat).
- Enriquecer o **nome** a partir do e-mail quando possível (ex.: olhar `responsavel_nome` de algum
  projeto do usuário); fallback = e-mail. `CurrentUser` só traz `{ email, isAdmin }`.

### 4. Backend — rota no `src/worker.ts`

- `POST /api/ajuda` — **autenticada, NÃO admin** (qualquer usuário logado pode pedir ajuda):
  - `const email = getEmailFromRequest(request)`; sem email → `errorJson('Não autorizado.', 401)`.
  - `readBody` → valida com o schema → `criarChamadoAjuda({ email, ... })` → `json(result)`.
  - **NÃO** colocar sob o prefixo `/api/chat/` (esse prefixo dispara o dispatcher de chat +
    `insertApiLog`). É um branch dedicado.

### 5. Frontend — componente do widget

`src/components/ajuda/ajuda-widget.tsx` (ou `src/components/ajuda-widget.tsx`):
- **FAB** fixo no canto inferior direito (`fixed bottom-...`, `z-[...]` acima de tudo, sem brigar
  com o `<Toaster position="top-right">`). Ícone lucide (`HelpCircle`/`MessageCircleQuestion`).
- Ao clicar, abre um **painel estilo chat** ancorado embaixo à direita (não um modal central;
  pode ser uma "card-popover"). Conteúdo:
  - **Seletor de tipo** Dúvida × Problema — segmented control / 2 cards selecionáveis com
    **rótulo + ícone** (estado **nunca só por cor** — acessibilidade; ver memória
    `feedback-checkbox-card-design`).
  - **Textarea** da mensagem (com placeholder orientando "descreva sua dúvida ou o problema…").
  - **Anexar print:** botão que abre `<input type="file" accept="image/*">`; suportar **colar
    (paste)** e **arrastar (drag-drop)** imagem; **thumbnail** de preview + remover. Converter via
    `readFileAsBase64` (já existe em `src/lib/submeter/constants.ts`).
  - **Enviar:** estado de loading; em sucesso → toast `toast.success` + limpa + fecha; em erro →
    `toast.error` com a mensagem do `ApiError`.
  - Envia via `apiFetch('/api/ajuda', { tipo, mensagem, pagina_url: window.location.pathname,
    user_agent: navigator.userAgent, print })`. O e-mail vem do header no backend (não precisa
    mandar do front; opcionalmente buscar nome via `/api/auth/me`).
- **Montagem:** em `src/routes/__root.tsx`, como **irmão do `<Outlet />`** (antes do `<Toaster>`),
  para aparecer em todas as páginas.

### 6. Frontend — qualidade obrigatória (regra 11 + identidade GoGroup)

- **Antes de desenhar/codar a UI, invocar a skill `frontend-design`** e seguir as diretrizes.
- Identidade: `--go-blue` (#0059A9), `--go-lime` (#D7DB00), `--go-cream` (#FBF4EE), **Poppins**.
- Piso de qualidade: **foco de teclado visível**, `prefers-reduced-motion` respeitado, **Esc**
  fecha, `role="dialog"`/`aria-modal`/`aria-label`, contraste OK, estado por **rótulo+ícone** (não
  só cor). Texto **PT-BR com acentos** (regra 4).

---

## O que esta feature NÃO faz (não-objetivos da v1)

- **Não** recebe respostas de volta no app (mão única — D1).
- **Não** embute a imagem no card do Chat (vai como link — D3).
- **Não** tem painel admin (D4) — leitura é no espaço do Chat.
- **Não** mexe no Sheets, no LLM, no saving/receita nem na submissão.
- **Não** notifica por e-mail (só Google Chat).

---

## Testes

- **Unit (Vitest):**
  - `buildAjudaMessage` — forma do texto por tipo (dúvida × problema), com e sem print (linha do
    print omitida quando ausente), escapando/limitando o texto.
  - `sendChatNotification` com `opts.webhookUrl` (usa a URL passada; sem URL → no-op).
  - schema zod de `/api/ajuda` (rejeita mensagem vazia, tipo inválido; aceita print opcional).
  - `insertAjudaChamado` (insere e lê de volta).
- **Manual (pós-deploy):** abrir o widget em páginas diferentes → enviar uma **dúvida sem print**
  e um **problema com print** → conferir (a) mensagem chega no espaço do Chat com tipo/página/link,
  (b) print abre no Drive, (c) linha gravada em `ajuda_chamados` com `chat_status='enviado'`.

---

## Checklist de entrega (regras do CLAUDE.md)

- [ ] **Worktree** próprio a partir do `main` atualizado (regra 8):
      `git worktree add -b feat/widget-ajuda ../godocs-widget-ajuda main` +
      `ln -sf /home/notebook/godocs-main/node_modules ../godocs-widget-ajuda/node_modules`.
- [ ] **`frontend-design`** invocada antes da UI (regra 11).
- [ ] **`npm run test`** verde (regra 2).
- [ ] **`npm run build:worker`** + **commitar o `worker.js`** (regra 1 — mexe em server-side).
- [ ] **`npm run build`** ok.
- [ ] Texto **PT-BR com acento** (regra 4).
- [ ] **`prompt-registry.ts`/`prompt-inspector.tsx`** — **N/A** (não muda prompt de IA, regra 3).
- [ ] **CLAUDE.md atualizado** antes do PR (regra 7): nova seção do widget + env
      `GOOGLE_CHAT_WEBHOOK_URL_AJUDA` (+ `GOOGLE_DRIVE_FOLDER_ID_AJUDA` se usado) + tabela
      `ajuda_chamados` + rota `POST /api/ajuda`.
- [ ] **Esta spec atualizada** no MESMO PR (regra 12): status → entregue, PR nº, "onde aterrissou".
- [ ] **`git fetch` + incorporar `origin/main`** antes de abrir o PR; rebuild de `worker.js`/`dist`
      após o merge (regra 10).
- [ ] **Secret no Godeploy** (`GOOGLE_CHAT_WEBHOOK_URL_AJUDA`) + espaço do Chat criado
      (pré-requisitos acima) antes do deploy.
- [ ] **Deploy Godeploy** com assets gerados dinamicamente do `dist/` real (regra 9).

---

## Status / tracking

| Etapa | Status |
|-------|--------|
| Spec aprovada (D1–D4) | ✅ 2026-06-26 |
| Espaço do Chat + webhook criados | ✅ 2026-06-26 (espaço `AAQAl02Wtio`; URL no `.env`) |
| Backend (tabela + rota + função + chat builder) | ✅ branch `feat/widget-ajuda` |
| Frontend (widget + montagem no root) | ✅ branch `feat/widget-ajuda` |
| Testes + builds | ✅ 16 testes novos; suíte 433 verde; `build` + `build:worker` ok |
| CLAUDE.md + spec atualizados | ✅ este PR |
| Secret `GOOGLE_CHAT_WEBHOOK_URL_AJUDA` no Godeploy | ⏳ (passo do Luis, antes do deploy) |
| Deploy Godeploy | ⏳ (passo do Luis) |

---

## Futuro / backlog (fora da v1 — só se o Luis pedir)

- **Conversa de duas vias (D1 invertida):** respostas no espaço do Chat voltam para a pessoa no
  app. Custo alto: Google Chat **REST API** (não webhook) + escopo de Chat na Service Account
  (domain-wide delegation) + receber eventos/respostas + mapear threads ↔ usuário + histórico por
  pessoa + polling/realtime no front. Provavelmente uma feature própria.
- **Painel admin** (estilo Investigador): listar/filtrar/marcar como resolvido os `ajuda_chamados`.
  A tabela já guarda tudo para isso.
- **Imagem embutida no card do Chat** (cardsV2) em vez de link.
- **Urgência** (normal/alta) e/ou **múltiplos anexos**.
- **Categoria mais rica** (ex.: dúvida × bug × sugestão).
