# SPEC — Disparo de e-mails do admin (multi-público)

> Documento de **planejamento/decisão** + **como funciona** (movido do `CLAUDE.md` em 2026-06-30 para
> enxugar o arquivo de instruções; o `CLAUDE.md` mantém só um resumo + ponteiro). Consultar/atualizar
> conforme a **regra 12**.

**Status:** implementado na branch `feat/disparo-emails-multi-publico` (2026-06-26). Pendente:
merge/deploy + criação das colunas no Sheets já cobertas (usa "Status"/"Observações" existentes).

## Contexto / problema

A tela admin `/email-legados` nasceu para **um** público: cobrar donos de **legados** não
regularizados. O time precisava também (a) **cobrar quem está em "Reenvio Pendente"** com uma
mensagem que diga **o que corrigir**, e (b) poder **disparar para qualquer responsável** (comunicado
geral). Em vez de 3 telas, virou **uma tela com seletor de público**, reusando toda a máquina de
lote/chunk/cancelamento já existente.

## Decisões fechadas (NÃO "corrigir" por engano)

- **D1 — 3 segmentos** (`Audiencia ∈ 'legado' | 'reenvio' | 'todos'`), cada um com **lista própria
  ao vivo**, **template próprio** e **histórico "enviado em" escopado por segmento**.
- **D2 — Reenvio inclui o MOTIVO** da revisão por projeto (coluna **"Observações"** do Sheets,
  gerada pelo analisador) → `projetos[].motivo`, renderizado "Motivo: …" **só** no segmento reenvio.
- **D3 — "Reenvio Pendente" é lido do Sheets (Status MANUAL).** A equipe marca o status à mão; o sync
  grava sempre "Pendente" (regra TEMPORÁRIA). Logo, ler `Status ∈ {reenvio pendente, rejeitado}` do
  Sheets é **proposital** e **independente** da regra TEMPORÁRIA — NÃO trocar por leitura do SQLite.
- **D4 — Payload congelado no lote.** O lote congela `{recipients, template, audiencia}` no disparo; o
  chunk **não relê** Sheets/SQLite (robustez + sem race). Trade-off **aceito**: é mail-merge
  ponto-no-tempo — quem regularizar **durante** o envio ainda recebe. NÃO reintroduzir "pular quem
  saiu da lista" recomputando por chunk (foi removido de propósito).
- **D5 — `todos` não vem marcado por padrão** (broadcast acidental é o risco maior). legado/reenvio
  vêm com "quem ainda não recebeu (ou falhou)" pré-marcado.
- **D6 — Rota/prefixo `/api/admin/email-legados/*` mantidos por compat** (nome legado). Só
  generalizados (preview `?audiencia=`; body com `audiencia`). Renomear rota fica fora de escopo.

## Onde aterrissou

- Backend: `src/lib/email-legados.functions.ts` — `Audiencia`, `listarDestinatarios`/`getPreviewDisparo`
  (dispatcher `fonteLegado`/`fonteReenvio`/`fonteTodos`), `getTemplate`/`salvarTemplate` (chaves
  `email_<aud>_*`), `renderEmailDisparo`, `iniciarDisparo` (congela payload), `processarChunkLote`,
  `enviarEmailTeste(adminEmail, audiencia)`, `normalizarAudiencia`.
- DB: `src/integrations/db/client.server.ts` — `createEmailLote(total, admin, alvos, audiencia, payload)`,
  `insertEmailDisparo({…, audiencia})`, `getUltimosDisparosPorEmail(audiencia?)`. Migrações em
  `schema.ts`: `email_lotes.audiencia/payload`, `email_disparos.audiencia`.
- Worker: `src/worker.ts` — rotas `/api/admin/email-legados/*` (preview/template/teste/enviar/chunk/
  progresso/cancelar), todas `requireAdmin`.
- Frontend: `src/routes/_authenticated/email-legados.tsx` — seletor de segmento (segmented control
  acessível: ícone+rótulo+acento, foco visível, `motion-reduce`), estado por segmento (preserva
  edição/seleção ao trocar), preview com motivo. Nav label "Disparo de e-mails" em `route.tsx`.
- Testes: `tests/email-legados.test.ts`.

## Como funciona (operacional — gotchas que não podem regredir)

Tela admin `/email-legados` (`_authenticated`; prefixo mantido por compat — D6) dispara por **3 segmentos**
(`Audiencia ∈ 'legado'|'reenvio'|'todos'`, `src/lib/email-legados.functions.ts`), cada um com lista ao
vivo, template próprio e histórico de envio escopado. Alvo = dono; **1 e-mail/pessoa** (dedup). Lógica:
`listarDestinatarios`/`getPreviewDisparo` (dispatcher `fonteLegado`/`fonteReenvio`/`fonteTodos`),
`getTemplate`/`salvarTemplate`, `renderEmailDisparo` (escapa HTML), `iniciarDisparo`, `processarChunkLote`.
Placeholders `{{nome}}`/`{{projetos}}`/`{{prazo}}`/`{{link}}`.

- **`reenvio` lê Status MANUAL do Sheets** (`Status ∈ {reenvio pendente, rejeitado}`) — proposital e
  **independente da regra TEMPORÁRIA** que grava "Pendente"; **não** trocar por SQLite (D3). Inclui o
  **motivo** por projeto (coluna "Observações" → `projetos[].motivo`).
- **Envio em LOTES/chunks dirigido pelo FRONT** (`email_lotes`), NÃO background — o Godeploy mata
  `waitUntil` longo (travava ~28 de 76). `POST .../enviar` cria o lote e **congela o `payload`**
  (`{recipients, template, audiencia}`, D4); o front chama `POST .../chunk/:loteId` em sequência
  (`CHUNK_SIZE` 8, cursor `processados`, resumível). Chunk **não relê** Sheets/SQLite (mail-merge
  ponto-no-tempo). Cancelar via `POST .../cancelar/:loteId`. Backend recomputa a lista no disparo
  (não confia no front).
- **Gmail API via Service Account + DWD** (`sendGmail`, `google/gmail.ts`) impersona `GMAIL_SENDER`
  (default `rpa_ia@gocase.com`). ⚠️ Pré-requisito Workspace: **domain-wide delegation** com escopo
  `gmail.send` + Gmail API ligada — senão `401 unauthorized_client`. (≠ aprovação/rejeição, que seguem
  no Brevo.)
- Rotas `/api/admin/email-legados/*` todas `requireAdmin`. Log `email_disparos` (1 linha/destinatário,
  com `audiencia`). ⚠️ Reenvio depende de "Status"/"Observações" no cabeçalho do Sheets.

## Pré-requisitos / dependências externas

- Sheets precisa ter **"Status"** e **"Observações"** no cabeçalho (mapeamento por nome — ver
  [SPEC base de Sheets / CLAUDE.md]). A equipe precisa **marcar "Reenvio Pendente"** manualmente.
- Gmail API + DWD já configurados (mesma infra da cobrança de legados / `gmail.ts`).
