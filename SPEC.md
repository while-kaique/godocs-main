# SPEC — GoDocs

> Fonte da verdade **funcional** (o quê / por quê). Nenhum código é escrito antes de a seção correspondente estar acordada.
> Notação de requisitos: **EARS** — testável e legível por quem não é técnico.
>
> ⚠️ **Este SPEC é FINO, por decisão (init GGSD).** A verdade funcional detalhada já mora em dois lugares
> maduros deste repo, que continuam sendo a fonte de detalhe:
> - **`CLAUDE.md`** — regras obrigatórias, gates do memorial, sync Google, ownership, convenções.
> - **`spec-docs/`** — specs de planejamento/decisão (`SPEC_FEATURES_NOVAS.md`, `SPEC_CORRECOES.md`,
>   `SPEC_STAGING.md`, `SPEC_WIDGET_AJUDA.md`, `SPEC_DISPARO_EMAILS.md`, `SPEC_COMPLEXIDADE_NIVEIS.md`).
>
> Aqui ficam só a **visão**, os **papéis**, os **fluxos macro** e os **invariantes formais** (INV-xx),
> destilados do `CLAUDE.md`. Requisitos de features NOVAS entram em EARS na §4, seção por seção.

## 1. Visão geral

Hub interno do Gogroup para documentar projetos de automação (RPA & IA). Funcionários submetem projetos via
formulário de 3 etapas com um chat IA que coleta documentação técnica + memorial de impacto financeiro
(saving e/ou receita). Os dados são gravados no **Google Sheets (fonte da verdade)** e refletidos num SQLite
local (reflexo/cache) via sync bidirecional; a submissão também notifica o Google Chat via Service Account.

### Objetivos
- Padronizar e centralizar a documentação de automações, com memorial financeiro auditável.
- Permitir que o dono (e delegados) editem/reenviem seus projetos sem quebrar o sync com o Sheets.

### Não-objetivos
- Não substitui `CLAUDE.md` nem `docs/`; não é manual de operação da plataforma.

## 2. Papéis
| Papel | Quem é | O que faz |
|---|---|---|
| Submissor (owner) | Funcionário autor do projeto (`responsavel_email`) | Submete e edita/reenvia o próprio projeto |
| Participante | Pessoa em `membros` sem ser owner — **Coautor · Participante · Contribuidor** | Visualiza; se for editor delegado, edita/reenvia como o dono |
| Editor delegado | Participante ∈ `editores_delegados` ∩ `membros` | Edita/reenvia em nome do dono |
| Admin / equipe RPA | `isAdmin(email)` (`ADMIN_EMAILS` ∪ tabela `admins`) | Painel investigador, disparo de e-mails, gestão; **não** edita se for participante |
| IA (agentes) | Orquestrador, extrator, compilador, analisador (`src/lib/agents/`) | Conduz o chat, extrai texto, compila doc, analisa complexidade |

## 3. Fluxos
- **Submissão (3 etapas):** Etapa 1 (metadados/participantes) → Etapa 2 (form de saving/receita) → Etapa 3
  (chat IA de documentação + memorial → revisão final → submeter).
- **Edição/reenvio:** dono/delegado abre `/editar/$id`, altera, reenvia. A edição expõe as **3 etapas**
  (Envio, Projeto, Agente); a Etapa 1 permite editar **participantes e papéis** (ver §4, RF-100+).
- **Sync Google (bidirecional):** IDA SQLite→Sheets (append/update in-place por ID); VOLTA horária + on-demand
  Sheets→SQLite (`SAFE_UPDATE_FIELDS` + ownership + reconciliação de exclusão). **Sheets é a fonte da verdade.**

## 4. Requisitos funcionais (EARS)
> `QUANDO <gatilho>, O SISTEMA DEVE <comportamento>` · `ENQUANTO <estado>, O SISTEMA DEVE …` · `SE <condição>, ENTÃO O SISTEMA DEVE …`
>
> _(As features/correções já entregues estão descritas em `spec-docs/`. Requisitos de features NOVAS,
> planejadas via `/ggsd:plan`, entram aqui em EARS — uma seção por escopo.)_

### Fase 1 — Etapa 1 editável na tela de edição (participantes + papéis)
> Plano: `docs/plans/edicao-etapa1-participantes.md`. Papéis: Coautor (`coexecutor`) · Participante
> (`planejador`) · Contribuidor (`contribuidor`). O autor (owner) nunca entra na lista de participantes.

- **RF-100** — QUANDO o dono ou um editor delegado abre a tela de edição (`/editar/$id`), O SISTEMA DEVE
  exibir as 3 etapas (Envio · Projeto · Agente) e permitir navegar até a Etapa 1 (topo e botão "Voltar").
- **RF-101** — ENQUANTO o usuário está na Etapa 1 em modo edição com "em equipe = sim", O SISTEMA DEVE
  permitir adicionar, remover e (re)definir o papel de cada participante, mantendo o autor fora da lista.
- **RF-102** — SE um participante está sem papel escolhido (modo "em equipe = sim"), ENTÃO O SISTEMA DEVE
  bloquear o avanço da Etapa 1 e exigir a escolha do papel de cada participante.
- **RF-103** — SE o projeto é legado (sem `ferramenta`/`escopo`/`prodStatus` preenchidos) e está em modo
  edição, ENTÃO O SISTEMA DEVE permitir avançar da Etapa 1 para a 2 exigindo apenas identidade detectada e
  participantes/papéis válidos (domínios `@gocase`/`@gobeaute`/`@gogroup`) — sem travar por aqueles campos.
- **RF-104** — QUANDO o usuário altera participantes/papéis e reenvia, O SISTEMA DEVE persistir
  `membros`/`membros_papeis` e escrever as 3 colunas de papel (`Participantes`, `Participantes 2`,
  `Contribuidor`) no Google Sheets (fonte da verdade) via UPDATE in-place por `ID Projeto`, sem duplicar linha.
- **RF-105** — SE quem reenvia não é o dono nem um editor delegado (inclusive admin que seja participante),
  ENTÃO O SISTEMA DEVE recusar o reenvio com 403 (ownership — INV-01 preservado).
- **RF-106** — QUANDO a Etapa 1 é usada numa submissão NOVA (não-edição), O SISTEMA DEVE manter o
  comportamento atual inalterado (validação cheia de `escopo`/`prodStatus`/`ferramenta`).
- **RF-107** _(condicional — T4, opcional)_ — SE o projeto é especial e a edição altera **apenas**
  participantes/papéis, ENTÃO O SISTEMA DEVE persistir a alteração sem resetar a documentação já gerada.
  _(Se a implementação não for trivial, vira limitação registrada — a doc do especial pode ser reavaliada.)_

### Fase 2 — "Meus Projetos" não exibe o valor R$ ao dono
> Plano: `docs/plans/ocultar-valor-meus-projetos.md`. Decisão (Luis, 2026-07-17): esconder para **todos**
> nessa tela (inclusive admin) e **não serializar** o número ao client. Reforça o INV-02 e, indo um degrau
> além (cobre também receita), estabelece a regra "a tela Meus Projetos não mostra R$ ao dono". Afeta
> **apenas** a tela "Meus Projetos" — o investigador (admin) segue exibindo o financeiro.

- **RF-108** — ENQUANTO qualquer usuário (dono, participante ou admin) visualiza a lista "Meus Projetos",
  O SISTEMA DEVE não exibir nenhum valor em R$ (ganho, saving ou receita) nos cards de projeto.
- **RF-109** — QUANDO a API de "Meus Projetos" serializa um projeto ao client (lista e detalhe/seed de
  edição), O SISTEMA DEVE devolver `ganho_total_mensal` como `null`, de modo que o número não trafegue ao
  navegador (não legível no payload/Network).
- **RF-110** — SE o usuário é admin e acessa o painel **investigador**, ENTÃO O SISTEMA DEVE continuar
  exibindo o ganho/financeiro — esta regra afeta somente a tela "Meus Projetos".
- **RF-111** — QUANDO o valor deixa de ser exibido/serializado, O SISTEMA DEVE manter inalterados o cálculo
  de `ganho_total_mensal`, sua persistência no SQLite e o sync com o Google Sheets (o valor real continua no
  banco e na planilha).

## 5. Invariantes (regras que nunca podem quebrar)
> Destilados do `CLAUDE.md` (que continua sendo o detalhe). Cada um tem ponto de verdade + guarda.

- **INV-01 — Ownership: só o dono ou editor delegado edita; participante só visualiza; ser participante VENCE o override de admin.**
  - Ponto de verdade: `submeterParaValidacao(body, email)` (gate 403) + `podeEditar` em `meus-projetos.functions.ts`.
  - Guarda: `tests/ownership*.test.ts`.
- **INV-02 — R$ de saving nunca toca o LLM e o submissor nunca vê o financeiro de saving.**
  - Ponto de verdade: memorial duplo (LLM sem R$; `enriquecerMemorial()` injeta R$) + `ocultarReaisSaving`;
    na tela "Meus Projetos", `mapItem` devolve `ganho_total_mensal: null` (RF-108/109 — nem exibe nem serializa).
  - Guarda: `tests/saving-calc*.test.ts`, testes de prompt, teste de `mapItem` (`ganho_total_mensal === null`).
- **INV-03 — Horas são a fonte da verdade do saving (`linhas`); o total do memorial bate com a soma das linhas.**
  - Ponto de verdade: `recomputarSavingFinanceiro` / `avisarDivergenciaMemorialLinhas`.
  - Guarda: `tests/saving-calc*.test.ts`.
- **INV-04 — Sync Google mapeia colunas por NOME (cabeçalho real), nunca por posição.**
  - Ponto de verdade: `fetchHeaderMap`/`SHEET_COLUMNS` em `src/lib/google/sheets.ts`.
  - Guarda: `tests/sheets-mapping*.test.ts`.
- **INV-05 — Rascunhos nunca vão ao Sheets; a edição/IDA nunca duplica linha (UPDATE in-place por ID Projeto).**
  - Ponto de verdade: `updateRowByProjectId` / `google/sync.ts`.
  - Guarda: `tests/sync*.test.ts`.
- **INV-06 — `worker.js` commitado sempre que se mexe em server-side (`.functions.ts`/`worker.ts`).**
  - Ponto de verdade: `npm run build:worker` (regra 1 do `CLAUDE.md`).
  - Guarda: revisão pré-PR / CI.
- **INV-07 — Nada de código vai a produção sem passar pela staging (`edf400b4`) antes (regra 13).**
  - Ponto de verdade: fluxo de deploy; guard `assertNaoEhDefaultDeProd` em `src/lib/env.ts`.
  - Guarda: runbook `docs/staging.md`.
- **INV-08 — Nunca ler `process.env` em escopo de módulo (só dentro de função, em request).**
  - Ponto de verdade: padrão `auth.ts`/`gmail.ts` (acesso lazy).
  - Guarda: convenção documentada no `CLAUDE.md` (derrubou o worker no passado).
- **INV-09 — Todo texto visível ao usuário em PT-BR com acentuação.**
  - Ponto de verdade: revisão de copy.
  - Guarda: regra 4 do `CLAUDE.md`.

## 6. Fora de escopo
- Reescrever em EARS o que já está em `spec-docs/`/`CLAUDE.md` (decisão do init: SPEC fino).

## 7. Glossário
- **Owner:** dono do projeto (`responsavel_email`), quem pode editar por padrão.
- **Editor delegado:** participante autorizado pelo dono a editar/reenviar.
- **Memorial:** texto financeiro padronizado (saving/receita) gerado pelo chat, enriquecido com R$ no backend.
- **Sync reverso:** importação Sheets→SQLite (`syncSheetsToSqlite` / `syncOwnerRowsFromSheet`).
- **Legado:** projeto que entrou via sync reverso (id contém `legado`), sem passar pelo form completo.
