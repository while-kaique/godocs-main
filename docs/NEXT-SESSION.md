# NEXT-SESSION

## ✅ SESSÃO 02/09 (tarde) — T3 do GoDocs v2 executada

Branch **`feat/godocs-v2`**, pasta `/home/notebook/godocs-main`. Suíte **2548 verde** (baseline da sessão:
2381), `tsc` nos mesmos **7** erros pré-existentes do `main` (nenhum nos arquivos novos), `npm run build` +
`build:worker` ok, `worker.js` rebuildado (regra 1).

### O que entrou
- **`src/lib/ganhos.ts`** (NOVO, ~560 linhas, PURO) — o modelo declarado pelo formulário e a **ponte** até a
  fórmula da T2. Traz: `GANHO_CATEGORIAS`/`CATEGORIA_IMENSURAVEL`/`CATEGORIAS_MENSURAVEIS`; os tipos
  `SavingEfetivado`, `CustoEvitadoLinhaHoras`, `CustoEvitado`, `ReceitaIncremental`, `GanhoImensuravel`,
  `CustoRodarItem`/`CustoRodar`, `GanhosDeclarados`; as puras `categoriasValidas`, `alternarCategoria`,
  **3 pares de serialização** e `paraGanhosProjeto`.
- **19 colunas** em `projetos` (array `MIGRATIONS`, `schema.ts`) + os **19 campos** em `ProjetoRow`.
- **167 casos** de teste novos: `tests/ganhos.test.ts` (66) e `tests/ganhos-serial.test.ts` (97) — os dois
  escritos por **test-writers isolados, cegos à implementação** — e `tests/schema-colunas-v2.test.ts` (4).

### Duas decisões de seletor (autorizadas, não minhas)
1. **Os tipos nasceram em módulo PRÓPRIO**, não em `agents/types.ts` como a letra da T3 dizia — aquele
   arquivo é o que a **T9 demole**, mistura o financeiro com 8 estados de gate de conversa e é importado por
   26 arquivos. Registrado no cabeçalho de `ganhos.ts` com um "não conserte movendo de volta".
2. **A receita ganhou coluna própria.** Na v1 ela **não tinha nenhuma** (vivia só no blob
   `documentacao.conteudo.receita`) — e era exatamente por isso que o rollup do squad Intelli precisava ler
   a PLANILHA em vez do banco.

### O que os revisores mudaram (não foi só carimbo — eles derrubaram 2 coisas minhas)
- **A ponte não guardava o VALOR, só a frequência se guardava.** `impacto.ts` blinda a metade "frequência"
  com `divisorDe` e explica o porquê; a metade "valor" passava crua. Sintoma medido: o MESMO input com
  `valor: undefined` dava **líquido 0 e mensal `NaN`**, e `JSON.stringify(NaN)` vira **`null`** num campo de
  dinheiro indo ao Gomoon. Fechado com **`valorFinito`** (fail-closed, erro nomeando o campo) nos 5 números
  que atravessam. ⚠️ `0` e negativos **passam** de propósito (zero é legítimo; o clamp do custo é de
  `impacto.ts`) — há guarda-corpo de teste para isso.
- **Uma justificativa minha era FALSA.** Eu havia escrito que não validar na escrita protegia o salvamento
  de rascunho; o rascunho vive em `localStorage` e essa coluna só é escrita no **submit**. Texto corrigido, e
  o lado que importava foi fechado: item de **custo** malformado agora falha na escrita, porque custo que
  evapora **INFLA** o impacto — a mesma direção gameável que `impacto.ts` blinda com `Math.max(0, …)`.
- **O prefixo `custo_evitado_*` passou a nomear dois conceitos OPOSTOS** na mesma tabela. Pela régua D1, o
  *custo evitado da v1* é o **saving efetivado da v2**. Registrado como "ARMADILHA DE NOME" no `schema.ts`:
  quem fizer a T6 mapeia v1→saving efetivado, **nunca** v1→custo evitado.

### Waivers e pendências REGISTRADAS no código (não são esquecimento)
- **`initSchema` faz ~120 `db.exec` sequenciais por cold start** e a T3 somou 19. Waiver **aceito pelo
  revisor**: o conserto (ler `PRAGMA table_info` uma vez) reescreve o bootstrap compartilhado com **prod** e
  o staging v1, que a 1ª Fronteira proíbe tocar; N é fixo e a rede passou a ser o canário de schema.
- **T6:** `getProjetosWithArea` faz `SELECT p.*` sem `LIMIT` e passará a arrastar as 5 colunas de texto longo
  → trocar por lista explícita (padrão `PROJETO_INVESTIGADOR_COLS`).
- **T6:** as 3 colunas `impacto_*` são **cache de 16 fontes sem contrato de invalidação** — um único escritor
  grava ganho + os 3 no MESMO UPDATE, e **grave os 3 ou nenhum** (`impactoBruto` não usa divisor, mas
  `impactoLiquidoMensal` lança em `divisorDe`: frequência suja materializaria derivado PARCIAL).
- **Não tratado, de propósito:** um `tipos_projeto` da v1 lido como `ganho_categorias` devolveria lista
  **parcial** que `categoriasValidas` aprova (o literal `receita_incremental` é compartilhado). Os dois
  consertos possíveis **contradizem o contrato que o teste cego exige**, e a v2 nasce zerada sem migração.

### ⚠️ Uma pendência que é DECISÃO do Luis, não trabalho
O plano, na **linha 146**, ainda diz "Tipos em `agents/types.ts`/`submeter/constants.ts`" — a letra anterior
à decisão de seletor. Eu registrei a troca no cabeçalho do módulo e num bloco novo do plano, mas **não
reescrevi aquela linha**: a sessão anterior levou um apontamento justo por editar o plano aprovado, porque
isso move a régua contra a qual o revisor de conformidade verifica. **Reescrever a linha 146 ou deixar só o
ponteiro?**

---

## Plano ativo
**→ [docs/plans/godocs-v2-submissao-deterministica.md](plans/godocs-v2-submissao-deterministica.md)** ·
Status: ✅ aprovado (Luis, 02/09/2026) · **T1, T2 e T3 executadas — próximo é o BLOCO T4+T5**

> Branch `feat/godocs-v2`. Frente NOVA e isolada: **nada toca prod (`674a3710`) nem o staging v1
> (`edf400b4`)** — o ambiente é o **`f9c9a7ff`** (`godocs-v2-staging`), aba `STAGING-V2`.

## Próximo passo
**Codar o BLOCO T4+T5 com `/ggsd:code` e deployar no `f9c9a7ff`**, para o Luis validar de olho a submissão
inteira **até o botão "Submeter"**.

**Por que virou bloco (decisão do Luis, 02/09):** revisar fatia por fatia está demorando muito. Então T4
(componentes: `Acordeao` · `ListaItens` · `TabelaHoras` · `CampoEvidencia` com colar) e T5 (Etapas 1, 2 e 3
reescritas, sai a Etapa 2.5) andam juntas, e **os 3 revisores rodam UMA vez, no FIM do bloco**. O TDD-escala
**continua** — com a revisão adiada, é o teste antes do comportamento que segura a régua.

**O que esperar do ritmo:** os marcadores `.review-status`/`.quality-status` ficam **`pendente`** durante o
bloco, e `pendente` **barra o `git push` e o `/ggsd:ship`** de propósito. **Commit na branch e deploy no
`f9c9a7ff` NÃO são barrados** — o bloco anda; o que não anda é mandar para o `main` sem revisão.

**As 4 amarras que a T3 deixou** (todas escritas no cabeçalho de `src/lib/ganhos.ts`, item por item):
1. **A régua da Etapa 2 tem 2 endereços até a T5.** O "ao menos um tipo" e a exclusividade da v1 vivem
   INLINE e duplicados em `routes/submeter.tsx` (`:1611`, `:2109`, `:1556`), sobre o vocabulário ANTIGO.
   ⚠️ Apagar aquele par **no MESMO commit** em que ligar `categoriasValidas`, senão a régua nasce com duas
   cabeças.
2. **`custoEvitado.valorHoras` não tem origem decidida.** O canônico que converte hora em R$ é `CARGOS`
   (`agents/types.ts`) resolvido por **`resolverValorHora`** (`agents/saving-calc.ts`, que já carrega o fix
   do falso-zero). ⚠️ **Reusar aquele caminho** — escrever uma segunda tabela de valor/hora é a doença
   ("fórmula em 5 lugares") que esta frente existe para curar.
3. **Os componentes de checkbox entregam `onChange(string[])`**, então o call site **não sabe qual item foi
   clicado** e não dá para aplicar `alternarCategoria` por cima. Dar-lhes um **`onToggle(value)`** é
   pré-requisito para a exclusividade não ser reimplementada na tela.
4. **Decidir se `serializarLinhasHoras` passa a validar** (hoje só o de custo valida; a razão da assimetria
   está escrita, mas é decisão em aberto para quando o formulário escrever de verdade).

**O que NÃO entra no bloco, e o que isso significa na hora de validar:** a **T6** (planilha) fica fora, então
o clique em "Submeter" **grava no SQLite do v2 e não chega à aba `STAGING-V2`** — faltam a T6 *e* os 6
secrets do Google que foram dispensados na T1. Para validar **o fluxo e as telas** isso basta; para ver a
linha na planilha, é setar os 6 secrets + fazer a T6.

⚠️ **Deploy é só no `f9c9a7ff`.** Prod (`674a3710`) e staging v1 (`edf400b4`) seguem intocados.
