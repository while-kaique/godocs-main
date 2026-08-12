# SPEC — Página de FAQ (índice de assuntos → um documento por assunto, leitura para todos, edição para admin)

**Status:** ✅ implementada (11/08/2026) · ♻️ **remodelada em 12/08/2026 (D13 — documento único)** ·
⏳ pendente validar na staging · branch `feat/faq-page`
**Aterrissou em:** `src/lib/faq/conteudo.ts` (PURO, `FAQ_SEED` + `chaveSlug`) ·
**`src/lib/faq/markdown.ts`** (PURO, parser do markdown leve) · `src/lib/faq.functions.ts` ·
`src/integrations/db/schema.ts` (+`client.server.ts`) · `src/worker.ts` (`/api/faq`, `/api/admin/faq/*`) ·
`src/routes/faq*.tsx` (índice, documento e o redirect do endereço legado) · `src/components/faq/*`
(+**`faq-documento.tsx`**) · `src/routes/index.tsx` (bloco novo na home) ·
`src/lib/submeter/step25.tsx` (link) · `tests/faq.test.ts` (23 casos)
**Pedido:** substituir, na home, o campo de "etapas" por uma **página de FAQ** — membros só leem,
admin edita (adiciona, remove, atualiza). Lista de **categorias** → cada categoria com **títulos
grandes** e **descrições menores** abaixo. A primeira categoria é **"Tipos de Projeto"**, com a
descrição REAL do que é um **projeto especial** — mais palavras do que cabe no formulário. Tem de
ser **cheia de rotas** (`/faq/tipos_projetos/especiais`), para que um link leve direto à resposta.

---

## 1. O que sai e o que entra

| Onde | Hoje | Depois |
|---|---|---|
| `src/routes/index.tsx` (home) | Card branco **"Ciclo de vida do projeto"** — pílulas `Em análise → Aprovado / ou Reenvio Pendente`, setas e o rodapé "Líderes e administradores acompanham…" (linhas ~369–448) | Bloco **"Perguntas frequentes"**: lista as categorias do FAQ com título + resumo, cada uma linkando para `/faq/<categoria>` |
| — | não existe | `/faq`, `/faq/$categoria`, `/faq/$categoria/$item` |
| — | não existe | `GET /api/faq` (qualquer logado) + `/api/admin/faq/*` (`requireAdmin`) |
| — | não existe | tabelas `faq_categorias` e `faq_itens` |

⚠️ O conteúdo do "Ciclo de vida do projeto" **não é jogado fora**: vira a categoria semeada
**"Acompanhamento e status"** (D8). O que sai da home é o *widget*, não a informação.

---

## 2. Decisões fechadas

### D1 — Conteúdo mora no SQLite, mas NASCE de uma constante em código
Tabelas `faq_categorias`/`faq_itens` são a fonte de verdade em runtime (o admin precisa poder
adicionar/remover/atualizar de verdade). O texto inicial mora em **`FAQ_SEED`**
(`src/lib/faq/conteudo.ts`, módulo **PURO**) e é semeado de forma **idempotente por slug**:
- slug ausente na tabela → INSERT;
- slug presente → **não toca em nada** (nem título, nem corpo, nem ordem).

Motivo: o texto do "projeto especial" é conteúdo redigido com cuidado e precisa entrar no ar junto
com o deploy, sem alguém digitar em produção; e depois de o admin editar, um deploy novo **não pode
sobrescrever** a edição dele. ⚠️ Corolário: mudar o texto de `FAQ_SEED` depois do 1º deploy **não
muda o que está no ar** — a partir daí a edição é pelo painel. Se um dia for preciso reimpor o texto
do código, isso é uma decisão nova (rota explícita de "restaurar do código"), nunca um efeito
colateral do seed.

### D2 — Slug canônico com `_`, resolução TOLERANTE
Os slugs canônicos são os do pedido: `tipos_projetos`, `especiais`. A resolução usa um normalizador
PURO `chaveSlug(s)` (minúsculas, sem acento, `-`↔`_` colapsados) — igual em espírito ao
`chaveColuna` do Sheets. Assim `/faq/tipos-projetos/especiais`, `/faq/Tipos_Projetos/Especiais` e
`/faq/tipos_projetos/especiais` abrem a **mesma** página.
⚠️ Sem redirect para o canônico: um 301/302 na SPA só adiciona um salto e um jeito novo de quebrar
o link; a rota simplesmente resolve.
⚠️ O slug do item é **único dentro da categoria**, não global (`.../tipos_projetos/especiais` e um
futuro `.../glossario/especiais` convivem).

### D3 — Deep link é PÁGINA, não âncora
`/faq/tipos_projetos` renderiza uma página própria (título grande + documento). Motivo: o link vai
circular em Google Chat, e-mail e dentro do formulário — âncora (`#especiais`) depende de o acordeão
estar aberto e de o scroll acertar; página é determinística e dá título de aba próprio.
⚠️ **Revisado pela D13:** a unidade de deep link é o **assunto**, não o tópico. O endereço antigo
`/faq/$categoria/$item` continua existindo **só como redirect** para o assunto.

### D4 — Leitura para todo logado, escrita só admin, gate SERVER-SIDE
`GET /api/faq` exige apenas o e-mail do edge (como `/api/areas`, o edge Godeploy já exige OAuth em
tudo). Toda escrita vive em `/api/admin/faq/*` atrás de **`requireAdmin`**. A UI usa
`/api/auth/me` só para decidir **o que pinta** (botões de editar) — nunca como autorização.

### D5 — Edição INLINE na própria `/faq`
Quem é admin vê, na mesma página que todos leem: "＋ Nova categoria", e por bloco os controles
✏️ editar · ↑↓ reordenar · 🗄 arquivar. A edição abre um dialog (padrão do
`DistribuirEdicaoModal`/`ConfirmEspecialModal`: overlay com blur, Esc fecha, foco preso).
Motivo: o admin edita vendo o resultado; não há tela nova para manter no painel.

### D6 — Remover é ARQUIVAR (soft delete)
`arquivado INTEGER DEFAULT 0`. O item arquivado sai da leitura pública e continua no banco; o admin
vê os arquivados numa seção recolhida e pode restaurar. Motivo: os links do FAQ vão circular fora do
app (Chat, e-mail, formulário) — um DELETE por engano quebraria link vivo e perderia texto redigido.
⚠️ Arquivar categoria arquiva os itens dela em cascata lógica (a leitura pública filtra pelos dois).
Existe DELETE de verdade? Não na v1 — nem rota.

### D7 — Ordem é MANUAL (`ordem INTEGER`), não alfabética
O FAQ tem ordem didática ("Tipos de Projeto" vem primeiro). Reordenar é ↑/↓ trocando `ordem` entre
vizinhos (uma rota `POST /api/admin/faq/reordenar`). Empate de `ordem` → desempata por `criado_em`.

### D8 — O "Ciclo de vida do projeto" migra para dentro do FAQ
Segunda categoria semeada: **"Acompanhamento e status"** (`acompanhamento`), com os itens
`em-analise`, `aprovado`, `reenvio-pendente` — o mesmo conteúdo das pílulas da home, agora com
espaço para explicar o que a pessoa deve fazer em cada estado.
Motivo: a informação era útil na home; o pedido é tirar o *widget* de lá, não apagar o conteúdo.
_(Se a preferência for home enxuta e FAQ só com "Tipos de Projeto", basta remover esta categoria do
`FAQ_SEED` — nada mais no plano depende dela.)_

### D9 — O formulário passa a LINKAR o FAQ (é o motivo do pedido de rotas)
Na Etapa 2.5 (`src/lib/submeter/step25.tsx`), abaixo da pergunta de projeto especial, entra
"**O que conta como projeto especial?**" → `/faq/tipos_projetos/especiais` (abre em **nova aba**:
`target="_blank"` — clicar não pode custar o formulário meio preenchido de quem está no meio da
submissão). O mesmo link entra no modal de confirmação.
⚠️ O texto do formulário **não é substituído** pelo link: a pergunta segue autocontida (a pessoa
decide sem sair), o FAQ é o aprofundamento.

### D10 — Corpo é TEXTO PURO, sem markdown e sem HTML — ♻️ SUBSTITUÍDA PELA D13
Renderizava com `whitespace-pre-wrap`. Sem lib de markdown e **sem `dangerouslySetInnerHTML`** — o
corpo é digitado por um humano no painel e ir para HTML cru abriria XSS armazenado por conta de uma
formatação. A própria D10 previa a saída: "negrito/lista, se um dia forem necessários, são decisão
nova (renderer próprio, allowlist fechada)". É exatamente o que a **D13** fez.
⚠️ O que NÃO mudou e não pode mudar: **`dangerouslySetInnerHTML` continua proibido** no FAQ.

### D11 — Tabelas INTERNAS: nada de Sheets, nada de sync reverso
`faq_categorias`/`faq_itens` são conteúdo do app, não dado de projeto: **fora** de
`SAFE_UPDATE_FIELDS`, sem coluna na planilha, sem participação em `syncSheetsToSqlite` /
`reconciliarExclusoes`. ⚠️ Consequência operacional: o conteúdo do FAQ **não** viaja entre staging e
prod — o seed é o que garante que os dois nascem iguais; edições feitas na staging ficam na staging
(e é bom que fiquem).

### D12 — Sem cache, sem prefetch
`GET /api/faq` é uma leitura de SQLite (hoje **1** SELECT) — nada do custo do Sheets que justificou o
cache SWR do dashboard. Adicionar cache aqui é complexidade sem sintoma.

### D13 — A parte interna é UM DOCUMENTO, não uma lista de tópicos (12/08/2026)
**Pedido do Kaique, olhando a 1ª versão no localhost:** cards só no índice; dentro do assunto, um
texto único no formato `TÍTULO → explicação → TÍTULO 2 → explicação 2`, editável pelo admin. E os
textos estavam **longos demais** — objetivos e diretos, sem ficar chatos de ler.

**O que muda:**
1. **Um nível a menos.** O conteúdo mora em **`faq_categorias.corpo`** (coluna nova). A tabela
   `faq_itens` fica **LEGADO**: nada lê nem escreve, e ela continua de pé porque guarda os textos da
   1ª versão (remover é arquivar — jamais `DROP`). Saíram `salvarItem`, a rota
   `POST /api/admin/faq/item` e as 5 funções de item do `client.server.ts`.
2. **Markdown leve com allowlist FECHADA** — `src/lib/faq/markdown.ts` (PURO) devolve blocos
   tipados e `faq-documento.tsx` monta **elementos React** a partir deles. Aceita `## título`,
   `### subtítulo`, `- item`, `1. item`, `> destaque` e `**negrito**`. ⚠️ Todo o resto é parágrafo
   **literal**: `<b>` e `<script>` chegam ao React como texto e são escapados. É o que permite dar
   formatação ao admin **sem** reabrir o XSS armazenado que a D10 barrava (o proibido segue proibido:
   nenhum `dangerouslySetInnerHTML` no FAQ). Teste explícito com `<script>`.
3. **Seed com BACKFILL.** O seed segue idempotente por slug (D1) e ganhou uma exceção estreita: se o
   assunto **já existe com o corpo vazio**, ele grava o texto do código. ⚠️ Sem isso, todo banco que
   já tinha "Tipos de Projeto" ficaria com o documento **vazio para sempre** (o slug está presente, e
   a regra da D1 é não tocar em slug presente). A trava é dupla — o `WHERE corpo IS NULL OR
   trim(corpo) = ''` no SQL e a checagem em memória —, porque passar por cima do documento do admin é
   exatamente o que a D1 existe para impedir. Teste cobre os dois lados (preenche vazio · não
   sobrescreve o do admin).
4. **"Ver como usuário"** (pedido no mesmo dia): botão no cabeçalho que apaga TODOS os controles de
   admin e deixa a página como o liderado a vê, com uma faixa "Voltar a editar". ⚠️ O interruptor é
   **um só** (`podeEditar` no contexto, = `ehAdmin && !verComoUsuario`): se cada tela combinasse as
   duas flags, uma esqueceria e o modo de visualização mostraria um botão de admin. O editor também
   ganhou **Pré-visualizar**, porque escrever markdown sem ver o resultado é adivinhação.
5. **O card do índice diz o que tem dentro** — os títulos de 1º nível do documento
   ("Saving operacional · Receita incremental · …") em vez de uma contagem de tópicos, que não
   informava nada.
6. **Textos reescritos.** "Tipos de Projeto" saiu de ~9.000 caracteres em 3 páginas para **~2.400 em
   uma**, cobrindo saving · receita · especial · ganho real × projetado · na dúvida. ⚠️ Há um **teste
   de teto (4.500 caracteres por assunto)**: assunto que cresce além disso quer ser **dois assuntos**,
   não um texto mais longo — é o que impede o FAQ de voltar a ser cansativo.
7. **O link da Etapa 2.5 passou a apontar para `/faq/tipos_projetos`** (o assunto), e
   `/faq/tipos_projetos/especiais` **redireciona** (`beforeLoad` + `replace`), porque esse endereço já
   foi colado em Chat e e-mail e um 404 ali é link morto para quem só queria ler a resposta.

**Visual (regra 11):** documento em coluna única com medida travada em **68ch** (linha longa era
metade do cansaço), cada seção aberta por um título com **filete lima à esquerda** (o ritmo de
escaneamento), bullets com marcador quadrado azul e `>` como placa creme com borda azul. Sem sumário:
com o texto nesse tamanho, os títulos já são o sumário.

### D14 — "Voltar" guarda UMA versão, e restaurar CONSOME o slot (12/08/2026)
**Pedido do Kaique:** em vez de um estado de rascunho, "salve a versão imediatamente anterior no
banco sempre, assim se cometermos um erro é só apertar em voltar, aparecer um popup de confirmação
avisando que essa versão será perdida e então retornar pro texto antigo. Não precisa salvar todos,
só o imediatamente anterior."

- Coluna **`faq_categorias.versao_anterior`** (JSON: `titulo`/`resumo`/`corpo` + `em`/`por`). Não é
  histórico e não é auditoria — é **um** passo atrás.
- `salvarCategoria` grava o snapshot do estado atual antes de sobrescrever. ⚠️ **Só quando algo
  REALMENTE mudou** (comparação por `trim`): salvar sem alterar nada gravaria um snapshot idêntico e
  **queimaria o slot** — o admin perderia o texto bom para onde ainda queria voltar, sem ter mudado
  uma letra.
- `desfazerFaq` (rota `POST /api/admin/faq/desfazer`, `requireAdmin`) aplica o snapshot e **limpa** o
  slot. Descartar o texto atual é o combinado — é o que o modal avisa em negrito —, e limpar impede
  que o botão vire um alterna-entre-duas-versões. Sem snapshot → **400 com a razão**; o botão não
  pinta nesse caso, mas o gate real é no servidor.
- O snapshot **não vai no payload de quem só lê** (`versao_anterior` só é serializado com
  `admin: true`): é ferramenta de edição, não conteúdo.
- JSON corrompido no banco devolve `null` em vez de derrubar a leitura do FAQ — o pior caso é o botão
  "Voltar" não aparecer.
- O modal mostra **o título, a data/autor e a prévia** do texto que voltará (`FaqDocumento` com
  `comAncoras={false}`, senão os ids colidiriam com os da página atrás).

### D15 — Rodapé "Atualizado em … por …" (12/08/2026)
FAQ interno envelhece e quem lê precisa saber se o texto ainda vale. `atualizado_em`/`atualizado_por`
passaram a ir no payload e viram uma linha discreta no pé do documento, montada pela FONTE ÚNICA
PURA **`src/lib/faq/formato.ts`** (`linhaAtualizacaoFaq`). ⚠️ **Só a DATA** — o carimbo é UTC e o
leitor é de Brasília; mostrar hora exigiria conversão de fuso para responder pergunta que ninguém
faz. O autor **`seed`** não é pessoa: vira só "Atualizado em DD/MM/AAAA". Sem carimbo, a linha não
aparece.

### D16 — Busca no índice + âncora por seção (12/08/2026)
- **Busca** (`filtrarAssuntosFaq`, mesmo módulo puro): casa em título, resumo **e no corpo**, porque
  quem chega no FAQ chega com um termo ("220h", "custo evitado"), não com o nome do assunto. Sem
  acento e sem caixa via `chaveColuna` (o normalizador do Sheets e do slug). Duas palavras exigem
  **as duas** (E, não OU — com OU, dois termos devolveriam mais resultados que um). O campo só pinta
  com mais de um assunto publicado; com um card, busca é ruído.
- **Âncora por seção**: cada `##` recebe `id` derivado por `chaveSlug`, com sufixo quando o título
  repete (dois `#pendente` na mesma página levariam sempre ao primeiro). Ao lado do título há um
  "copiar link desta seção", visível no hover **e no foco de teclado** (`focus-visible`) — escondido
  só por `group-hover`, ele existiria apenas para quem usa mouse.
- ⚠️ **O scroll até a âncora tem DOIS passes** (`requestAnimationFrame` + `setTimeout`): o texto vem
  de `GET /api/faq`, então o alvo não existe no 1º render, e a **restauração de scroll do router**
  roda depois da montagem e engole um scroll único. Foi exatamente o que aconteceu na 1ª versão
  (validado no navegador: a página abria no topo).

### D17 — O FAQ é linkado nos pontos de dor, e NUNCA dentro do chat (12/08/2026)
**Pedido do Kaique, corrigindo o plano no meio:** *"ele não deve ficar no chatbot, ele deve aparecer
de maneira minimalista em algum lugar do fluxo de submissão de forma discreta"*.

- **Fluxo de submissão** — uma linha no `PageFooter` (`src/lib/submeter/layout.tsx`): "Dúvidas?
  Perguntas frequentes ↗". Escolhido porque esse rodapé já aparece na **intro e em todas as etapas**,
  então um único ponto cobre o fluxo inteiro sem inventar card nem banner.
- **`AvisoPendencia`** (card de Meus Projetos + `/projeto/$id`) — "O que cada status significa ↗"
  apontando para a **seção** do documento conforme o tom (`#reprovado`, `#reenvio_pendente`), o que
  só é possível por causa da D16. Fica **fora** da tira clicável: link dentro de `<button>` é HTML
  inválido e roubaria o alvo de clique.
- ⚠️ **Nada nos textos de gate, nada nas mensagens de bloqueio da submissão e nada na conversa com o
  agente** — decisão explícita. Aqueles textos são fonte única, já testados por conteúdo, e o custo
  de mexer neles é alto para o retorno.
- Todos abrem em **nova aba**: clicar não pode custar um formulário meio preenchido nem o lugar na
  lista.
- ⚠️ Os ids das seções vêm dos TÍTULOS do documento: renomear "Reprovado" no painel muda o id e o
  link cai no topo da página (**degrada, não quebra**). Há teste que trava os 2 ids que os avisos
  usam.

---

## 3. Conteúdo semeado (o texto que vai no ar)

### Categoria 1 — "Tipos de Projeto" (`tipos_projetos`)
Resumo: _"O que o GoDocs entende por projeto de saving, de receita incremental e por projeto
especial — e como escolher na Etapa 2."_

#### Item `especiais` — título **"Projeto Especial"**
Resumo (descrição menor sob o título): _"Altíssimo impacto, sem um número em reais que se sustente.
O que é, o que não é, e o que muda na sua submissão."_

Corpo (texto puro; este é o rascunho a semear):

> Um projeto especial é um projeto de **altíssimo impacto para a empresa cujo ganho não se traduz,
> hoje, em um número em reais que se sustente** — nem como saving operacional (horas humanas ou
> custos que deixaram de existir), nem como receita incremental atribuível.
>
> A palavra que importa é **atribuível**. Não é "eu não calculei", nem "dá trabalho levantar": é que
> o efeito do projeto existe, é grande e é visível, mas não há um antes × depois em R$ que consiga
> ser defendido sem inventar premissa. Exemplos do tipo de coisa que cai aqui: um projeto que gera
> muito engajamento nas redes; um projeto que aumenta vendas sem que se consiga separar o que veio
> dele; um projeto que melhora a qualidade do produto ou da entrega; uma reestruturação da base de
> conhecimento da empresa que, por si só, não economiza uma hora, mas viabiliza dezenas de
> automações depois. Na prática interna, Piapp e o Agente Autônomo de Comentários são os dois
> exemplos que a equipe usa como referência.
>
> **O que NÃO é projeto especial**
>
> - Projeto com ganho mensurável que ninguém mediu ainda. Se existe contrato encerrado, nota que
>   parou de ser paga, horas de gente que deixaram de ser gastas ou um indicador que se move e é
>   conferível, o projeto é de saving ou de receita — e o caminho é levantar o número, não marcar
>   especial.
> - Projeto que ainda não está rodando. O GoDocs documenta ganho **já realizado**: se a automação
>   não está em produção, ou o ganho é uma projeção para o próximo trimestre, o projeto não entra —
>   nem como especial. Volte quando estiver rodando e medido.
> - Projeto pequeno que só é difícil de medir. "Especial" é sobre impacto alto o suficiente para
>   valer uma avaliação humana dedicada, não sobre a dificuldade da conta.
>
> **O que muda na sua submissão quando você marca "Sim"**
>
> 1. Você **pula as etapas financeiras**: não há memorial de saving nem de receita, e o agente não
>    vai pedir horas por cargo, frequência ou base de cálculo.
> 2. Você **pula o analisador automático**: nenhuma classificação de complexidade ou de
>    elegibilidade é gerada para o projeto.
> 3. A validação passa a ser **humana e rigorosa**. Alguém da equipe de RPA & IA entra em contato
>    com você para entender o projeto e decidir. Não há aprovação automática.
> 4. O projeto **não entra na fila de pré-aprovação do seu líder** — sem memorial financeiro, não há
>    o que ele avaliar; vai direto para a validação da equipe de RPA & IA.
>
> **O que continua sendo obrigatório**
>
> A documentação técnica completa (o que o projeto faz, como roda, dependências, o que observar) e o
> campo **"Contexto do Projeto Especial"**. Nesse campo, escreva três coisas: (a) qual é o impacto,
> em termos concretos e verificáveis por outra pessoa; (b) por que ele não se converte em saving ou
> receita sem inventar premissa; (c) o que esse projeto destrava — o que passou a ser possível por
> causa dele. Quanto mais concreto, menos idas e voltas na validação.
>
> **Na dúvida, escolha "Não"**
>
> Se você acha que existe um número e só não sabe como chegar nele, siga como projeto padrão: o
> agente conduz a coleta e, se no meio do caminho ficar claro que não há ganho mensurável, isso
> aparece na validação. Marcar especial para evitar a conta atrasa o seu projeto, porque a avaliação
> humana é mais lenta que a automática.

#### Item `saving` — título **"Saving Operacional"**
Resumo: _"Economia gerada pela automação: horas humanas que deixaram de ser gastas e custos
externos que deixaram de ser pagos."_
Corpo: o que entra (horas por cargo com antes × depois, contratos/serviços encerrados), o que
subtrai (custo do projeto: API/SaaS por uso), a base CLT de 220h/mês como teto por pessoa, e o
recado de que o ganho tem de ser **real e medido**, não projetado. _(Redigir na implementação, no
mesmo tom do item acima; conteúdo já está em `docs/business-rules.md`.)_

#### Item `receita` — título **"Receita Incremental"**
Resumo: _"Aumento de receita gerado pela automação, com base de cálculo que outra pessoa consiga
conferir."_
Corpo: o que gera, como aumenta, antes × depois, base do número, e o aviso de dupla contagem — o
mesmo dinheiro não pode ser declarado como custo evitado **e** como receita. _(Idem.)_

### Categoria 2 — "Acompanhamento e status" (`acompanhamento`) — D8
Itens `em-analise`, `aprovado`, `reenvio-pendente`: o que cada estado significa, quem age e o que a
pessoa deve fazer (no caso do reenvio: corrigir e reenviar, o motivo aparece no card de Meus
Projetos e em `/projeto/$id`).

---

## 4. Plano de implementação (file-by-file)

### 4.1 Banco — `src/integrations/db/schema.ts`
```sql
CREATE TABLE IF NOT EXISTS faq_categorias (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  slug       TEXT NOT NULL UNIQUE,
  titulo     TEXT NOT NULL,
  resumo     TEXT,
  ordem      INTEGER NOT NULL DEFAULT 0,
  arquivado  INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now')),
  atualizado_por TEXT
);

CREATE TABLE IF NOT EXISTS faq_itens (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  categoria_id TEXT NOT NULL REFERENCES faq_categorias(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  titulo     TEXT NOT NULL,
  resumo     TEXT,
  corpo      TEXT,
  ordem      INTEGER NOT NULL DEFAULT 0,
  arquivado  INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now')),
  atualizado_por TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_itens_slug ON faq_itens(categoria_id, slug);
CREATE INDEX IF NOT EXISTS idx_faq_itens_categoria ON faq_itens(categoria_id);
```
⚠️ **Nenhum ponto-e-vírgula dentro de comentário** neste arquivo (o `initSchema` divide o SQL por
`;` e parte o `CREATE TABLE` ao meio — pegadinha já registrada no `CLAUDE.md`).

### 4.2 Módulo PURO — `src/lib/faq/conteudo.ts` (novo)
- `type FaqItem`, `type FaqCategoria` (com `itens: FaqItem[]`).
- `FAQ_SEED: FaqCategoria[]` — **FONTE ÚNICA** do conteúdo inicial (seção 3 desta spec).
- `chaveSlug(s: string): string` — minúsculas, sem acento, `-`/`_`/espaço → `_`, colapsa repetidos.
- `resolverCategoria(arvore, slug)` / `resolverItem(categoria, slug)` — casamento **exato primeiro,
  normalizado depois** (mesmo espírito de `chaveColuna`/`resolverColunaLetra`).
- Sem `import` de nada server-only: a tela roda no cliente e usa estas funções.

### 4.3 Acesso a dados — `src/integrations/db/client.server.ts`
- `getFaqArvore({ incluirArquivados }): Promise<FaqCategoria[]>` — 2 SELECTs (`ORDER BY ordem,
  criado_em`) e montagem em memória; **nunca** N+1 por categoria.
- `insertFaqCategoria` / `updateFaqCategoria` / `insertFaqItem` / `updateFaqItem` /
  `setArquivadoFaqCategoria` / `setArquivadoFaqItem` / `trocarOrdemFaq…`.
- `semearFaq()` — idempotente por slug (D1).
- ⚠️ Banco async: `await` sempre e params sempre presentes (mesmo `[]`) — regra 6.

### 4.4 Regras de negócio — `src/lib/faq.functions.ts` (novo)
- `listarFaq({ admin }: { admin: boolean })` — chama `semearFaq()` na primeira leitura do isolate e
  devolve a árvore (admin recebe também os arquivados, marcados).
- `salvarCategoria(email, body)` / `salvarItem(email, body)` — zod (`titulo` 1–120, `resumo` ≤ 300,
  `corpo` ≤ 20 000, `slug` opcional → derivado do título por `chaveSlug`), erro 400 com a 1ª
  mensagem (padrão `erro400` de `ajuda.functions.ts`); grava `atualizado_por`.
- `arquivarFaq(email, {tipo, id, arquivar})`, `reordenarFaq(email, {tipo, id, direcao})`.
- ⚠️ Slug **imutável depois de criado** (o dono do link é o mundo externo). Renomear título não muda
  slug; trocar o slug só criando item novo.

### 4.5 Rotas de API — `src/worker.ts`
```
GET  /api/faq                    → e-mail do edge obrigatório (401 sem ele)
GET  /api/admin/faq              → requireAdmin (inclui arquivados)
POST /api/admin/faq/categoria    → requireAdmin (cria/atualiza)
POST /api/admin/faq/item         → requireAdmin (cria/atualiza)
POST /api/admin/faq/arquivar     → requireAdmin
POST /api/admin/faq/reordenar    → requireAdmin
```
⚠️ Rebuildar e **comitar `worker.js`** (regra 1).

### 4.6 Rotas da SPA — `src/routes/`
- `faq.tsx` — rota-layout: `loader` busca `/api/faq` **uma vez**, renderiza cabeçalho + breadcrumb +
  `<Outlet/>`. Sem isso, cada nível refaz a chamada.
- `faq.index.tsx` — `/faq`: lista de categorias (título grande + resumo + nº de tópicos).
- `faq.$categoria.index.tsx` — `/faq/$categoria`: título grande da categoria + lista dos itens
  (título grande, resumo menor abaixo — o formato pedido).
- `faq.$categoria.$item.tsx` — `/faq/$categoria/$item`: título grande, resumo, corpo, irmãos.
- Slug desconhecido → estado "não encontrado" com link para `/faq` (nunca tela branca).
- `head:` por rota (título de aba = título do item) — o padrão que a home já usa.
- ⚠️ `routeTree.gen.ts` é **auto-gerado** (regra 5): rodar `npm run dev`/`build` para regenerar e
  comitar o resultado; não editar à mão.

### 4.7 Componentes — `src/components/faq/`
- `faq-lista.tsx` (cards de categoria/item, título grande + descrição menor), `faq-corpo.tsx`
  (`whitespace-pre-wrap`), `faq-editor-dialog.tsx` (form admin), `faq-admin-controles.tsx`.
- Identidade GoGroup (`--go-blue`, `--go-lime`, `--go-cream`, Poppins) e piso de a11y: foco de
  teclado visível, `prefers-reduced-motion`, estado nunca só por cor (arquivado leva rótulo
  "Arquivado", não só cinza). ⚠️ Invocar a skill **`frontend-design`** antes de codar a UI (regra 11).

### 4.8 Home — `src/routes/index.tsx`
- Remover a `<section>` do "Ciclo de vida do projeto" (~369–448), os helpers `StatusPill` e
  `StepArrow` e os imports que ficarem órfãos (`Clock`, `CheckCircle2`, `RotateCcw`, `Zap`).
- Entrar com o bloco "Perguntas frequentes": mesma moldura branca, lista das categorias (título +
  resumo) linkando para `/faq/<slug>`, e um "Ver todas as perguntas" para `/faq`.
- A frase "Líderes e administradores acompanham todas as submissões na área administrativa" **fica
  na home** (é navegação, não FAQ) — realocada para o rodapé do bloco novo.

### 4.9 Formulário — `src/lib/submeter/step25.tsx` (D9)
Link "O que conta como projeto especial?" → `/faq/tipos_projetos/especiais`, `target="_blank"`
`rel="noopener noreferrer"`, abaixo do parágrafo de exemplos e dentro do modal de confirmação.

### 4.10 Testes — `tests/faq.test.ts` (Vitest, regra 2)
1. `chaveSlug`/`resolverItem`: `tipos-projetos`, `Tipos_Projetos`, `tipos projetos` e
   `tipos_projetos` resolvem a mesma categoria; slug inexistente devolve `undefined`.
2. Seed **idempotente**: rodar `semearFaq()` 2× não duplica; e com o título editado no banco, o 2º
   seed **não** restaura o texto do código (D1).
3. Soft delete: item arquivado sai de `listarFaq({admin:false})` e continua em `{admin:true}`;
   categoria arquivada esconde os itens dela.
4. Slug imutável: `salvarItem` com slug diferente do gravado não altera o slug.
5. Gate: `salvarItem` exige admin (fixar `isAdmin` em **`false`** no teste — ele lê `ADMIN_EMAILS` do
   ambiente e o override de admin faz o teste do 403 passar por engano; pegadinha já registrada).
6. `FAQ_SEED` tem a categoria `tipos_projetos` com o item `especiais` (o link do formulário e o da
   home não podem apontar para o vazio).

### 4.11 Documentação (regras 7 e 12)
- `docs/frontend.md`: rotas do FAQ + onde fica a edição admin.
- `CLAUDE.md`: parágrafo curto na seção de convenções — "FAQ: conteúdo em SQLite, seed idempotente
  em `src/lib/faq/conteudo.ts`, slug imutável, remover = arquivar, tabelas internas (fora do sync)".
- Esta spec + linha na tabela do `spec-docs/README.md`.

### 4.12 Deploy (regras 1, 9, 10, 13)
`npm run test && npm run build && npm run build:worker` → **staging `edf400b4`** → validar
`/faq/tipos_projetos/especiais` e a edição inline no navegador → **só então prod `674a3710`**.
Antes do PR: `git fetch origin` + incorporar `origin/main` e rebuildar (regra 10); conferir que o
`CLAUDE.md` não ficou com marcador de conflito (regra 7).

---

## 5. Riscos e como o plano os cobre

| Risco | Cobertura |
|---|---|
| Deploy novo sobrescreve o texto que o admin ajustou | Seed idempotente por slug (D1) + teste 2 |
| Link `/faq/tipos_projetos/especiais` quebra depois de uma edição | Slug imutável (§4.4) + arquivar em vez de deletar (D6) + teste 4 |
| Link do formulário aponta para categoria/item que não existe | Teste 6 sobre o `FAQ_SEED` |
| Alguém colar HTML no corpo | Texto puro, sem `dangerouslySetInnerHTML` (D10) |
| Membro editar FAQ pela DevTools | Escrita só em `/api/admin/faq/*` com `requireAdmin` (D4) + teste 5 |
| Conteúdo divergir entre staging e prod | Aceito e explícito (D11): o seed iguala o nascimento, edições são por ambiente |
| Informação do ciclo de vida se perder da home | Migra para a categoria "Acompanhamento e status" (D8) |

---

## 6. Estimativa

| Etapa | Tempo |
|---|---|
| Schema + acesso a dados + `faq.functions.ts` + rotas de API | ~1h |
| Rotas da SPA + leitura (3 níveis) | ~1h30 |
| Edição inline do admin (dialog, reordenar, arquivar) | ~1h30 |
| Redigir os corpos de `saving`, `receita` e da categoria "Acompanhamento" | ~30min |
| Testes | ~45min |
| Home + link do formulário + docs | ~45min |
| Build, staging, validação, prod | ~45min |
| **Total** | **~6h30 (um dia de trabalho, com a validação em staging)** |
