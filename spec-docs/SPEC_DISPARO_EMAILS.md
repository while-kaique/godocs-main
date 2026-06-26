# SPEC — Disparo de e-mails do admin (multi-público)

> Documento de **planejamento/decisão** (não doc técnica). O "como funciona" detalhado vive no
> `CLAUDE.md` (seção "Disparo de e-mails (painel admin)") e no código. Consultar/atualizar conforme
> a **regra 12**.

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

## Pré-requisitos / dependências externas

- Sheets precisa ter **"Status"** e **"Observações"** no cabeçalho (mapeamento por nome — ver
  [SPEC base de Sheets / CLAUDE.md]). A equipe precisa **marcar "Reenvio Pendente"** manualmente.
- Gmail API + DWD já configurados (mesma infra da cobrança de legados / `gmail.ts`).
