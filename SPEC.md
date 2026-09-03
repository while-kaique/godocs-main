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

### Fase 3 — GoDocs v2: submissão determinística sem agente no cliente
> Plano: `docs/plans/godocs-v2-submissao-deterministica.md` (branch `feat/godocs-v2`, ambiente
> `godocs-v2-staging` / aba `STAGING-V2`). A v1 em produção **não é alterada** por estes requisitos.
>
> **Régua das categorias:** a pergunta que decide é *"esse dinheiro estava saindo do caixa antes desta
> solução?"*. **Sim → saving efetivado** (a despesa existia e parou; é comprovável, por isso pede evidência
> e pesa 100%). **Não, ia começar a sair → custo evitado** (a despesa nunca nasceu; não há prova possível,
> por isso não pede evidência e pesa 50%). Hora liberada de quem continua na folha é **capacidade que se
> deixou de comprar**, não dinheiro no bolso: é custo evitado.

**Etapa 1 e Etapa 2**
- **RF-200** — QUANDO a pessoa preenche a Etapa 1, O SISTEMA DEVE não pedir data de criação, e DEVE tratar
  a **data de submissão** como a data que marca a existência do projeto.
- **RF-201** — QUANDO a pessoa está na Etapa 2, O SISTEMA DEVE oferecer as 4 categorias de ganho (saving
  efetivado · custo evitado · receita incremental · ganho imensurável) em seleção múltipla, e DEVE não
  perguntar se o projeto é especial.
- **RF-202** — SE a pessoa marca "ganho imensurável", ENTÃO O SISTEMA DEVE desmarcar as outras três; SE ela
  marca qualquer uma das outras três, ENTÃO O SISTEMA DEVE desmarcar "ganho imensurável".
- **RF-203** — QUANDO a pessoa conclui a Etapa 2, O SISTEMA DEVE iniciar a compilação da documentação em
  background, sem exibir progresso, sem pedir aprovação e sem bloquear o avanço para a Etapa 3.

**Etapa 3 — acordeão**
- **RF-204** — QUANDO a pessoa entra na Etapa 3, O SISTEMA DEVE exibir um bloco por categoria marcada, com
  o primeiro aberto e os demais fechados.
- **RF-205** — QUANDO a pessoa completa os campos obrigatórios de um bloco, O SISTEMA DEVE fechá-lo e abrir
  o próximo bloco ainda pendente.
- **RF-206** — ENQUANTO a pessoa navega pelo acordeão, O SISTEMA DEVE permitir abrir e fechar cada bloco por
  teclado, anunciar o estado por rótulo textual (nunca só por cor) e respeitar `prefers-reduced-motion`.

**Etapa 3 — campos por categoria**
- **RF-207** — QUANDO o bloco de saving efetivado está aberto, O SISTEMA DEVE pedir frequência, valor e
  evidência, e DEVE não pedir horas antes/depois.
- **RF-208** — SE a evidência tem anexo mas não tem texto, ENTÃO O SISTEMA DEVE recusar o bloco e explicar
  que a prova precisa vir acompanhada da explicação de por que aquele número é desta solução.
- **RF-209** — QUANDO a pessoa preenche a evidência do saving efetivado, O SISTEMA DEVE pedir, no mesmo
  bloco, desde quando o ganho passou a valer.
- **RF-210** — QUANDO o bloco de custo evitado está aberto, O SISTEMA DEVE pedir frequência, as horas antes
  e depois por função, o valor do que não foi contratado e o racional, e DEVE não pedir evidência.
- **RF-211** — SE a pessoa escolhe "Outro" como função na tabela de horas, ENTÃO O SISTEMA DEVE abrir um
  campo de descrição e explicar que "Outro" cobre casos como contrato e contratação.
- **RF-212** — QUANDO o bloco de receita incremental está aberto, O SISTEMA DEVE pedir frequência, valor,
  racional e tipo de receita.
- **RF-213** — QUANDO o bloco de ganho imensurável está aberto, O SISTEMA DEVE pedir apenas o racional, pelo
  mesmo campo de evidência (texto, anexo e imagem colada da área de transferência).
- **RF-214** — QUANDO a pessoa chega ao fim da Etapa 3, O SISTEMA DEVE pedir, num bloco único fora do
  acordeão, o custo para rodar a solução, em lista de itens com valor e frequência.

**Cálculo do impacto**
- **RF-215** — QUANDO o sistema calcula o impacto de um projeto, O SISTEMA DEVE registrar o Impacto Bruto
  como a soma sem pesos de saving efetivado, custo evitado e receita incremental.
- **RF-216** — QUANDO o sistema calcula o impacto, O SISTEMA DEVE registrar o Impacto Líquido como
  `1,0 × saving efetivado + 0,5 × custo evitado + 0,1 × receita incremental − custo para rodar`.
- **RF-217** — QUANDO o sistema mensaliza um valor, O SISTEMA DEVE dividi-lo pelo divisor da frequência
  **daquele bloco** (pontual ÷4 · mensal ÷1 · trimestral ÷3 · semestral ÷6), nunca por um divisor único do
  projeto.
- **RF-218** — SE uma categoria não foi marcada, ENTÃO O SISTEMA DEVE tratá-la como zero em todas as contas.
- **RF-219** — SE o projeto é de ganho imensurável, ENTÃO O SISTEMA DEVE registrar impacto zero e não somá-lo
  a nenhuma das três contas.
- **RF-220** — QUANDO o GoDocs envia dados de impacto ao Gomoon, O SISTEMA DEVE enviar o Impacto Líquido
  Mensal.

**Classificação e especial**
- **RF-221** — QUANDO um projeto é submetido, O SISTEMA DEVE recomendar em background uma estrela de 0 a 10
  para ele, qualquer que seja a categoria de ganho declarada.
- **RF-222** — SE um projeto tem estrela maior que zero, ENTÃO O SISTEMA DEVE tratá-lo como especial, sem
  que a pessoa que submete tenha declarado isso.
- **RF-223** — SE um projeto já tem nota dada por uma pessoa, ENTÃO O SISTEMA DEVE não reclassificá-lo e
  DEVE mantê-lo como referência para os demais.
- **RF-224** — ENQUANTO um projeto é classificado, O SISTEMA DEVE gravar a recomendação em tabela interna e
  DEVE não escrever a nota na planilha; só o clique de uma pessoa altera a nota.

**Submissão sem IA no caminho crítico**
- **RF-225** — ENQUANTO a pessoa preenche o formulário, O SISTEMA DEVE não fazer nenhuma chamada de modelo
  de linguagem que a faça esperar.
- **RF-226** — SE a documentação ainda não terminou de ser compilada quando a pessoa envia, ENTÃO O SISTEMA
  DEVE aceitar o envio e reconciliar a documentação depois, sem perdê-la e sem sobrescrever o financeiro.

**Ambiente**
- **RF-227** — ENQUANTO o sistema roda no ambiente da v2, O SISTEMA DEVE escrever apenas na aba `STAGING-V2`
  e DEVE não emitir mensagens de Google Chat nem avisos ao Gomoon.


## 5. Invariantes (regras que nunca podem quebrar)
> Destilados do `CLAUDE.md` (que continua sendo o detalhe). Cada um tem ponto de verdade + guarda.

- **INV-01 — Ownership: só o dono ou editor delegado edita; participante só visualiza; ser participante VENCE o override de admin.**
  - Ponto de verdade: `submeterParaValidacao(body, email)` (gate 403) + `podeEditar` em `meus-projetos.functions.ts`.
  - Guarda: `tests/ownership*.test.ts`.
- **INV-02 — R$ de saving nunca toca o LLM e o submissor nunca vê o financeiro de saving.**
  - Ponto de verdade: memorial duplo (LLM sem R$; `enriquecerMemorial()` injeta R$) + `ocultarReaisSaving`;
    na tela "Meus Projetos", `mapItem` devolve `ganho_total_mensal: null` (RF-108/109 — nem exibe nem serializa).
  - Guarda: `tests/saving-calc*.test.ts`, testes de prompt, teste de `mapItem` (`ganho_total_mensal === null`).
- **INV-03 — Horas são a fonte da verdade do ganho por horas (`linhas`); o total do memorial bate com a soma das linhas.**
  - Ponto de verdade: `recomputarSavingFinanceiro` / `avisarDivergenciaMemorialLinhas`.
  - Guarda: `tests/saving-calc*.test.ts`.
  - _(v2: as horas deixam de compor o saving e passam a compor o **custo evitado** — ver INV-11. A regra
    "o texto não é a fonte, as linhas são" permanece intacta, só muda a categoria que elas alimentam.)_
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

- **INV-10 — A fórmula do impacto tem fonte única; nenhum consumidor a reimplementa.** _(v2)_
  - Ponto de verdade: `src/lib/impacto.ts` (pesos e divisores como constantes nomeadas).
  - Guarda: `tests/impacto.test.ts` + ausência de literais `0.5`/`0.1`/`/ 10` espalhados nos consumidores.
- **INV-11 — Hora liberada é custo evitado (peso 50%), nunca saving efetivado.** _(v2)_
  - Ponto de verdade: a régua da Fase 3 — saving efetivado exige despesa que já saía do caixa e parou.
  - Guarda: teste de classificação dos casos-âncora (terceirizado dispensado × vaga não aberta).
- **INV-12 — Nenhuma chamada de modelo de linguagem bloqueia a submissão.** _(v2)_
  - Ponto de verdade: compilação da doc em `runBackground` + reconciliação por cron.
  - Guarda: teste de submissão sem provider de LLM configurado.
- **INV-13 — O agente nunca escreve a nota "Estrelas"; projeto com nota humana não é reclassificado.**
  - Ponto de verdade: `especial_avaliacao` / `projeto_avaliacao` (tabelas internas) + os 2 escritores humanos.
  - Guarda: `tests/especial-classificador.test.ts`.
- **INV-14 — O ambiente da v2 nunca escreve nas abas `GoDocs`/`STAGING` nem notifica Chat/Gomoon.** _(v2)_
  - Ponto de verdade: `GODOCS_ENV=v2-staging` + `assertNaoEhDefaultDeProd` (`src/lib/env.ts`).
  - Guarda: teste do guard + conferência da aba escrita após a primeira submissão.
- **INV-15 — Coluna nova no recorte do espelho exige bump da `VERSAO_RECORTE_RESUMO` no mesmo commit.**
  - Ponto de verdade: `src/lib/dashboard-resumo.ts`.
  - Guarda: sem o bump, o hash impede o re-espelhamento e o campo nasce vazio para sempre.

## 6. Fora de escopo
- Reescrever em EARS o que já está em `spec-docs/`/`CLAUDE.md` (decisão do init: SPEC fino).

## 7. Glossário
- **Owner:** dono do projeto (`responsavel_email`), quem pode editar por padrão.
- **Editor delegado:** participante autorizado pelo dono a editar/reenviar.
- **Memorial:** texto financeiro padronizado (saving/receita) gerado pelo chat, enriquecido com R$ no backend.
- **Sync reverso:** importação Sheets→SQLite (`syncSheetsToSqlite` / `syncOwnerRowsFromSheet`).
- **Saving efetivado** _(v2)_: despesa que já saía do caixa e parou por causa da solução. Comprovável; pesa 100%.
- **Custo evitado** _(v2)_: despesa que nunca chegou a existir, incluindo horas liberadas de quem continua na folha. Pesa 50%.
- **Ganho imensurável** _(v2)_: projeto sem valor mensurável; não entra na conta e é representado pela estrela.
- **Custo para rodar** _(v2)_: o que a empresa paga para a solução funcionar (plataforma, API, SaaS). Subtrai com peso 100%.
- **Impacto Líquido Mensal** _(v2)_: o impacto líquido com cada bloco mensalizado pela frequência dele. É o que o Gomoon recebe.
- **Legado:** projeto que entrou via sync reverso (id contém `legado`), sem passar pelo form completo.
