# Pré-aprovação do líder (integração TeamGuide) — 03/08/2026

> Status: **🟢 F0 + F1 implementadas** (03/08/2026). ⚠️ **A F2 (envio da DM) foi
> REMOVIDA do GoDocs em 05/08/2026 — ver D17**: notificar o líder passou a ser do
> **Gomoon**, e o que fica aqui é abrir a fila. Pendente: o cron/POST para o Gomoon
> (não codado), validação na staging → prod (regra 13) e as colunas do Sheets (P2).
> Autor do plano: sessão Claude de 03/08/2026, a partir de investigação **ao vivo**
> contra `https://api.teamguide.app` com o `TG_API_TOKEN` do `.env`.

O liderado submete um projeto no GoDocs; o **líder direto** é avisado por **DM no
Google Chat** (entregue pelo bot do **Gomoon**, D17) e **aprova dentro do próprio
GoDocs** — a DM é só o carteiro, nunca o lugar da decisão. A relação líder↔liderado
vem da **TeamGuide**.

---

## 1. Decisões fechadas (não "corrigir" sem confirmar)

| # | Decisão | Por quê |
|---|---|---|
| **D1** | **A aprovação mora no GoDocs**, não no Chat/e-mail. | Aprovação é **estado do projeto** (precisa de auditoria, versão, aparecer na triagem, reabrir no reenvio) e o líder precisa do memorial na frente pra decidir — não cabe em cartão de Chat. A tela read-only `/projeto/$id` já existe. |
| **D2** | **DM privada no Google Chat** é o canal de notificação (decisão do chefe do Luis, 03/08/2026). E-mail fica como alternativa futura, **não** implementar junto. | Adesão: líder não abre o GoDocs espontaneamente. DM é mais direta que e-mail no dia a dia da Gogroup. |
| **D3** | **NÃO bloqueia a triagem da RPA** — pré-aprovação roda **em paralelo**. | Líder de férias/ausente congelaria o projeto e o autor não saberia por quê. O selo do líder é informação *a mais* pra triagem, não portão. |
| **D4** | Pessoa em 2+ times → **todos os líderes derivados veem na fila, o primeiro que decidir resolve**. | 2 pessoas hoje estão em 2+ times (Joaquim Quinderé, Aline Montenegro em 3). Unanimidade travaria fácil; escolher "o time mais profundo" erraria quando a alocação secundária é a relevante. |
| **D5** | Área das pessoas nos nós de diretoria/passthrough = **nome do próprio nó** (`N1`, `BIZOPS`, `OPERAÇÕES`, `TIME JOAQUIM QUINDERE`…). | Fiel ao TeamGuide, zero nome inventado. Rejeitado: rótulo sintético "DIRETORIA" (não existe na fonte) e herdar a área de um filho (enganoso — Bruno Bezerra não é de "DADOS"). |
| **D6** | **Autor sem líder** (só `rafael@gocase.com`, CEO) → projeto **não** entra em fila de aprovação nenhuma; vai direto pra triagem, sem erro e sem DM. | O topo da cadeia não tem quem aprove. Silenciar é o comportamento correto, não uma exceção a tratar. |
| **D7** | A relação líder↔liderado é derivada de **`/teams` + membros**, **não** dos endpoints de liderança da TeamGuide. | Os endpoints "óbvios" (`/employees/{id}/leaders`, `/leaders/{id}/led`, `/employees/{id}/teams`) devolvem **403** com o nosso token (ver §2). A derivação pela árvore funciona hoje e cobre 431/432 pessoas. |
| **D8** | ⚠️ **SUPERADA pela D17 (05/08/2026)** — não há mais envio de DM neste código; a submissão só abre a fila (o princípio "notificação nunca derruba a submissão" continua valendo, agora por construção). Texto original: Falha de DM **nunca** derruba a submissão (best-effort em `runBackground`). ⚠️ **A DM deixou de ser muda na staging em 03/08/2026** (decisão do Luis, para validar o fluxo real com o líder dele): o `edf400b4` ganhou `GOOGLE_CHAT_DM_ENABLED=true` + `CHAT_SA_*` + `GOOGLE_CHAT_DM_SUBJECT`. Consequência: **submeter na staging manda Chat de verdade para uma pessoa de verdade** — o link da mensagem usa o `APP_BASE_URL` da staging. Prod segue **sem** os secrets (DM no-op) até a decisão de ligar lá. | Mesmo padrão do widget de ajuda e do `sendChatNotification`. Submissão é o caminho crítico; notificação não é. |
| **D9** | ⚠️ **SUPERADA pela D17 (05/08/2026)** — a credencial de Chat saiu do GoDocs junto do `chat-dm.ts`; quem autentica no Chat agora é o Gomoon. As linhas `CHAT_SA_*`/`GOOGLE_CHAT_DM_*` do `.env` e dos secrets do `edf400b4` viraram **faxina**. Texto original: A DM sai de uma **credencial de Chat própria** (`CHAT_SA_*` no `.env`, impersonando `GOOGLE_CHAT_DM_SUBJECT` = `rpa_ia@gocase.com`), com **fallback para `GOOGLE_SA_*`** — o mesmo padrão do `GMAIL_SA_*`. | ✅ **Validada ao vivo em 03/08/2026**: a troca de JWT por `access_token` com `sub=rpa_ia@gocase.com` e os 2 escopos de Chat retornou OK (sem enviar mensagem). Logo a **F2 não está mais bloqueada** — a DWD da SA `godocs@` virou **faxina** (apagar 2 linhas do `.env`), não pré-requisito. ⚠️ A credencial fica **só no `.env`/secrets**; nada de chave em doc (ver §5.5). |
| **D10** | Aprovação é **por versão** do projeto: reenvio do liderado volta o veredito a pendente. | Aprovar a v1 não pode carimbar uma v2 com números diferentes. O `projeto_versions` já existe pra ancorar isso. |
| **D11** | **Quem já É liderança está ISENTO** de pré-aprovação (decisão do Luis, 03/08/2026): o projeto dele não entra em fila nenhuma e não gera DM. Só o liderado "de fato" (quem não lidera time) precisa de aprovação — e quem aprova é o **líder direto**, nunca o líder do líder. | Não faz sentido uma liderança esperar o líder maior liberar o projeto dela. Ex.: o Lucas (coordenador de RPA) aprova o projeto do Luis (liderado dele), e o projeto do **Lucas** sai sem depender do Bruno; o Bruno, que também lidera, é isento pelo mesmo motivo. **Régua:** aparecer como `leader` de algum time ATIVO na TeamGuide (`ehLideranca`) — e não "tem liderados no índice", porque um time recém-criado pode ter líder e nenhum membro. |
| **D12** | **Os 3 casos sem fila têm rótulo PRÓPRIO na coluna `Aprovação do Líder`** (decisão do Luis, 03/08/2026): liderança → **`Pré-aprovado (liderança)`** · autor sem líder → `Sem líder na TeamGuide` · TeamGuide fora → `Aprovação indisponível (integração)`. Nada disso toca a coluna `Status` nem o comportamento (segue sem fila e sem DM — D11/D6/D3). | Antes os 3 gravavam o mesmo `—` e a auditoria não distinguia a **isenção legítima** de uma **falha de integração** — mesmos sintoma e cara na planilha, causas opostas. O rótulo da liderança diz o **efeito** ("do lado do líder, liberado"), não um parecer: ninguém decidiu nada, porque o líder é o próprio autor — por isso `(liderança)` fica explícito no texto e a coluna `Status` continua "Pendente" pela regra temporária. Mora na função pura `rotuloIsencaoSheet(motivo)`; o `motivo` já vinha pronto do `abrirPreAprovacao`. **O card do autor NÃO ganha selo** (a feature segue invisível para quem é isento). |

| **D13** | **A tela é auto-suficiente e o parecer tem CHECKLIST** (ressalvas do Lucas, 03/08/2026): (a) a nomenclatura é **pré-aprovação** em toda a interface e na planilha (`Pré-aprovado`/`Ajuste pedido`, nunca `Aprovado`/`Reprovado`); (b) o card traz **dono, participantes com papel, saving (R$ + horas), descrição e o memorial expansível** — sem precisar abrir outra tela; (c) antes de decidir o líder responde **3 perguntas de sim/não** — *move KPI da área? · a área sentiria falta se fosse desligado? · o saving é coerente com o impacto?* —, **obrigatórias no servidor** e anexadas ao rótulo da planilha. Um "não" **não** reprova nada sozinho. | O Lucas abriu a tela e disse: "aparece mas a visualização não tá legal", "não é uma aprovação e sim uma **pré**-aprovação", "o gestor tem que responder algumas perguntas com sim e não" e "o card já tem que vir com as principais informações — dono, participantes, valor total de saving, memorial… pra ser o mais fácil, rápido e intuitivo possível pro líder". Sem as 3 perguntas o parecer é um carimbo e não informa a triagem; com o card cego o líder abandonava a fila para caçar dados. **As perguntas moram em `src/lib/aprovacoes-checklist.ts` (FONTE ÚNICA, módulo puro)** — consumido pela tela e pelo rótulo do Sheets. Elas são obrigatórias **nos dois** vereditos (aprovar e pedir ajuste), cobradas pelo `decidirSchema` (o frontend só desabilita o botão). ⚠️ O saving aparece **com R$** para o líder: é exceção consciente ao "cliente não vê R$ de saving" (o gestor precisa do número para responder a 3ª pergunta) e valeu a pena confirmar. **Pré-visualização de admin:** `/aprovacoes?como=<e-mail>` abre a fila de outra pessoa (só admin, ignorado para os demais) para validar a tela sem ser o líder — se o admin decidir nesse modo, o `decidido_por` gravado é **o do admin**, nunca o do líder. |
| **D14** | **DUAS colunas no Sheets: estado × justificativa** (decisão do Luis, 03/08/2026, commit `dc53193` — decisão que já estava no código e faltava aqui). **`Aprovação do Líder`** guarda **só o estado**, filtrável e sem texto livre — `Pré-aprovado` · `Pré-pendente` · `Pré-reprovado` · `—` —, e todo o detalhe (quem decidiu, quando, as 3 respostas do checklist, comentário do ajuste) vai na coluna **`Justificativa Aprovação do Líder`**. Puras e únicas: `rotuloAprovacaoSheet`/`justificativaAprovacaoSheet` (com fila) e `rotuloIsencaoSheet`/`justificativaIsencaoSheet` (sem fila). | Uma coluna com estado **e** prosa não filtra nem soma: a triagem não conseguia contar quantos projetos estão pré-aprovados sem ler cada célula. A D12 sobrevive intacta: liderança → estado `Pré-aprovado` + o motivo na justificativa; sem líder / TeamGuide fora → `—` no estado + justificativa própria (a distinção isenção × falha de integração continua legível). ⚠️ **A coluna `Justificativa Aprovação do Líder` precisa existir no cabeçalho** das abas `GoDocs` e `STAGING`, além da `Aprovação do Líder` — sem ela o valor é ignorado com aviso e o resto do sync segue. ⚠️ **Atualizado em 05/08/2026 (D18):** o cabeçalho real de prod/staging tem `Justificativa Aprovação do **Lider**` (sem acento) e o valor vinha sendo DESCARTADO; o casamento de nome passou a tolerar acento/caixa e o conteúdo da coluna deixou de ser resumo. |
| **D15** | **A fila é um SLIDER de um projeto por vez** (pedido do Luis, 04/08/2026): barra de posição no topo (`3 de 12` + um traço por projeto), **um** card na tela e, ao decidir, salto automático para o próximo **sem parecer**. ⚠️ **O total NÃO encolhe quando o líder decide** — a fila exibida é a de quando ele abriu a tela: o item decidido **fica** no slider em modo leitura (faixa "Você pré-aprovou…" + checklist desabilitado), e o `useEffect` que sincroniza com o servidor é **append-only** (só acrescenta projeto novo, nunca remove). | Com 12 projetos empilhados o líder rolava a tela procurando onde parou e não sabia quanto faltava — o oposto do "mais fácil, rápido e intuitivo possível" do D13. **Por que o total é estável:** se a lista encolhesse a cada parecer, "3 de 12" viraria "3 de 11" no meio do caminho (a referência de progresso mudaria de significado a cada clique) e o líder não poderia voltar para rever o que registrou. O cache do React Query **perde** o item decidido (a fila do servidor não o traz mais) — quem preserva é o estado local do slider. Navegação: botões no topo e no pé do card + setas `←`/`→` do teclado (ignoradas dentro de campos de texto, senão brigariam com o cursor da caixa de ajuste). Fila **> 20** projetos → os traços viram barra de progresso (40 traços de 3px não se clicam nem se leem). Animação reusa `go-step-in`/`go-step-in-back` das etapas do formulário (mesmo gesto de "avançar" do resto do produto) e o **estado nunca fica só na cor do traço**: a contagem "2 pré-aprovados · 1 ajuste pedido" está escrita e cada traço tem `aria-label`/`title` com nome do projeto + situação. |
| **D16** | **"Não" no checklist + pré-aprovar → a explicação é OBRIGATÓRIA** (pedido do Luis, 04/08/2026). Clicar em **Pré-aprovar** com qualquer uma das 3 perguntas em "Não" **não grava direto**: abre uma caixa ("Por que você pré-aprova mesmo com 'Não' em …?") e o texto entra no **mesmo campo `comentario`**, indo para a coluna **`Justificativa Aprovação do Líder`** junto do resumo do checklist (D14). Régua na FONTE ÚNICA `exigeJustificativa(veredito, respostas)` / `temNaoNoChecklist` (`src/lib/aprovacoes-checklist.ts`), consumida pela tela **e cobrada no servidor** (`decidirAprovacao` → 400) — o frontend nunca é a garantia. Pedir ajuste continua exigindo texto sempre; checklist todo "Sim" continua pré-aprovando em 1 clique. | Um "Não" segue **não sendo veto** (D13), mas passava batido: o líder marcava "o saving não é coerente" e carimbava sem uma palavra, e a triagem recebia a contradição sem explicação — o oposto do motivo de existir o checklist (transformar o parecer em informação). Reusa o campo `comentario` em vez de criar coluna nova: os dois textos são "o que o líder escreveu ao decidir", e a justificativa já concatena checklist + comentário. |
| **D17** | **A ENTREGA da DM sai do GoDocs e vira responsabilidade do GOMOON** (decisão do Luis, 05/08/2026). O GoDocs **não fala mais com a API do Google Chat**: `src/lib/google/chat-dm.ts`, o disparo dentro do `abrirPreAprovacao` e os construtores de mensagem/cartão (`mensagemDmAprovacao`, `corpoDmAprovacao`) foram **removidos**, junto dos secrets `GOOGLE_CHAT_DM_ENABLED` / `CHAT_SA_*` / `GOOGLE_CHAT_DM_SUBJECT`. No lugar entra **1 POST/dia às 6h (BRT)** com um **snapshot da RELAÇÃO** líder↔liderados-com-pendência (por líder: e-mail, nome, `url` da fila e os liderados com a contagem de projetos); o Gomoon enfileira, monta a mensagem, decide a hora e entrega pelo bot dele. Contrato completo em **`docs/integracao-gomoon-chat.md`**. ⚠️ **A submissão não notifica mais nada** — ela só ABRE a fila; e o mute dos projetos `[E2E-…]` passa a ser de quem monta o payload (por isso o teste agora afirma que projeto E2E **entra** na fila). **Ainda NÃO codado:** a agregada (`GROUP BY aprovador_email`), o cron e o POST. | O que quebrava era sempre a **entrega**, e ela dependia de coisas que não são nossas: a DWD de Chat existe só na SA `planilha-jg@` (a `godocs@` dá `401 unauthorized_client`), o `spaces:setup` + JWT na mão eram 190 linhas de infra alheia ao produto, e retentativa exigiria estado de entrega no nosso SQLite — estado que não é nosso. Quem sabe se o cartão renderizou, se o bot está instalado e se vale retentar é quem fala com o Chat. **Ganho de segurança:** mandando só a relação, é **impossível** um valor de saving vazar numa DM (o payload não carrega R$). **Preço aceito:** o número envelhece entre o snapshot das 6h e a entrega deles (o 1º líder que decide resolve para todos — D4), então a mensagem precisa dizer "situação em DD/MM às 06h"; e a copy do cartão passa a ser mantida por eles. |
| **D18** | **A justificativa grava TUDO o que o líder respondeu — e o casamento de coluna tolera acento** (pedido do Luis, 05/08/2026: *"a justificativa tem que salvar tudo que vier do usuário, as respostas (sim, não e as justificativas) de forma devida"*). Duas mudanças: **(a)** o texto da coluna `Justificativa Aprovação do Líder` deixou de ser uma linha resumida em códigos (`Move KPI: sim · …`) e passou a ser o parecer inteiro, **uma linha por item**: assinatura (`Pré-aprovado por <nome> (<e-mail>) em dd/mm/aaaa`), **cada PERGUNTA do checklist escrita por extenso com o que ele marcou** (`O projeto move algum KPI da área? — não`) e o texto livre **rotulado pelo que ele é** (`O que precisa ser ajustado` · `Motivo da reprovação` · `Justificativa do "não" em Move KPI e Sentiria falta` · `Comentário do líder`). Fonte única do texto das perguntas segue em `aprovacoes-checklist.ts` (`detalharChecklist`, `rotuloChecklist`); a montagem em `justificativaAprovacaoSheet`/`rotuloComentarioSheet`. **(b)** `chaveColuna`/`resolverColunaLetra` (`google/sheets.ts`): o nome da coluna casa primeiro **exato** e, na falta, **normalizado** (minúsculas, sem acento, espaços colapsados), no `updateRowByProjectId` **e** no `appendRow`. | **(a)** O que chegava à triagem era um resumo em rótulos internos e, pior, um texto solto sem dizer se era pedido de ajuste, motivo de recusa ou explicação de um "não" — com **dois** "nãos" nem dava para saber a qual pergunta ele respondia (o campo `comentario` é um só, D16). Agora a célula é auto-explicativa para quem nunca viu a tela. **(b)** Isto era um **bloqueio de ida a prod**: o cabeçalho tem `…do Lider` (sem acento) e o código escreve `…do Líder`; como o mapeamento era por nome EXATO, a chave não casava e a justificativa era **ignorada com aviso** — o estado aparecia em AE e quem decidiu, quando, o checklist e a explicação **não apareciam em lugar nenhum** (confirmado ao vivo em 04 e 05/08). Corrigir por código em vez de renomear a coluna evita mexer num cabeçalho de prod que alimenta ida, volta e o dashboard de triagem — e protege de qualquer outra letra fora do lugar no futuro. **Fail-safe:** dois cabeçalhos que normalizam igual (ambíguo) NÃO casam pelo índice tolerante — só por nome exato —, então nunca se grava na coluna errada. Conferido contra o cabeçalho REAL de produção (53 colunas): exato **não** casa, tolerante resolve **AF** (`scripts/dryrun-lider/hdr.ts`). |
| **D19** | **O parecer do líder aparece DIVIDIDO na ficha de triagem do `/dashboard`** (pedido do Luis, 05/08/2026: *"para que não tenhamos que entrar na planilha e ver de forma feia a pré-aprovação"*). A ficha ganha a seção **"Pré-aprovação do líder"**, logo abaixo da caixa de decisão: chip de estado (`Pré-aprovado` · `Ajuste pedido` · `Pré-reprovado` · `Pré-pendente` · `Sem parecer`), quem decidiu + quando, **uma linha por pergunta do checklist com o sim/não** e o texto livre num bloco citado com o rótulo da D18. Na **TABELA** entra a coluna **"Pré-status"** ao lado de "Status" (pedido do Luis logo depois: dar para saber se o líder já decidiu **sem abrir ficha por ficha**) — só o rótulo curto, com o **mesmo chip** da ficha (`ChipEstadoParecer`, compacto); projeto sem fila fica **"—" quieto**, não um chip "Sem parecer" repetido em centenas de linhas. ⚠️ A **justificativa** (multi-linha) **NÃO** entra na listagem: ela é KB por projeto e a listagem é enxuta por decisão (gotcha 4 do dashboard). Selo **"Respondeu 'não' no checklist"** quando há qualquer "não" — é a contradição que a triagem precisa ver primeiro (pré-aprovado *com* "não", D16). ⚠️ **A fonte é a LINHA DA PLANILHA, não a tabela `projeto_aprovacoes`**: o detalhe já traz a linha inteira, então a seção não custa nenhuma leitura nova e mantém a invariante do dashboard ("lê `readAllRows`, nunca o SQLite"). O parser puro `interpretarParecerLider` (`src/lib/aprovacoes-parecer.ts`) desmonta o texto que a D18 monta, reconhecendo as perguntas pela FONTE ÚNICA `CHECKLIST_APROVACAO` (não redigita nenhuma). As duas colunas saem de "Outras colunas" por **chave tolerante** — com `Set` de nome exato, o cabeçalho `…do Lider` faria a célula multi-linha aparecer crua de novo logo abaixo. `chaveColuna` mudou de casa para o módulo PURO `src/lib/coluna-chave.ts` (`google/sheets.ts` importa e reexporta) porque a tela roda no CLIENTE e `google/sheets.ts` é server-only. | Antes desta seção, as duas colunas caíam no balde "Outras colunas" da ficha: o estado como um campo qualquer e a justificativa da D18 (multi-linha) como um bloco de texto corrido num grid de 2 colunas — na prática a triagem abria a planilha para ler o parecer, exatamente o que a D18 tentou evitar. Ler da planilha em vez do SQLite também faz a seção funcionar para linha criada por outro ambiente, legado importado ou fila reaberta à mão. **Nada é engolido:** linha que o parser não reconhece (parecer com a redação ANTIGA de uma pergunta, anotação escrita à mão na célula) aparece como veio. **Trava do formato:** `tests/dashboard-parecer-lider.test.ts` faz **ida-e-volta** — gera o texto com `justificativaAprovacaoSheet` e lê com o parser —, então mudar a escrita sem mexer no leitor quebra o teste em vez de degradar a tela em silêncio. |
| **D20** | **A ISENÇÃO passa a ser pelo CARGO — coordenador para cima** (decisão do Luis, 05/08/2026, substitui a régua da **D11**). Régua: **todo mundo responde ao líder que tiver**; isenta quem tem cargo de **coordenador · gerente · head · diretor/diretoria · superintendente · presidente · sócio · C-level**. **Supervisor NÃO isenta.** Fonte única: `ehCargoDeLideranca` em **`src/lib/cargo-lideranca.ts`** (módulo PURO), com `CARGOS_LIDERANCA` (casa por **palavra inteira**) e `EXCECOES_CARGO_LIDERANCA` (gerência de OFÍCIO: `Diretor de Arte`, `Gerente/Diretor de Projetos`, `Gerente/Diretor de Produto`). `ehLideranca` agora só pergunta o cargo (`getCargoDe`, sobre `/employees/refs` cacheado por isolate). Cargo vazio / pessoa fora da TeamGuide → **entra em fila** (lado seguro). | A régua D11 (`leader` de um time ATIVO) isentava quem **não lidera ninguém**: a TeamGuide pendura **um nó por pessoa** na árvore (`[TRANSPORTES] TIME FABRICIA LIMA`), então a **analista** Fablícia Lima figurava como líder do time dela mesma e o projeto saía `Pré-aprovado (liderança)` sem ninguém olhar — **21 das 64 linhas pendentes** caíam nisso (05/08/2026). Cadeia correta, conferida no organograma: Fablícia (Analista) → **Kelly (Supervisora, aprova)** → **João Conde (Gerente, ISENTO)** → Diretor → COO → CEO. ⚠️ **`liderados > 0` foi DESCARTADO de propósito**: 22 pessoas com cargo de IC lideram gente de fato (`Team Líder Cx` tem 12 liderados) e **seguem em fila** — decide o CARGO, não o tamanho do time. ⚠️ **Cargo NÃO serve para achar quem lidera** (por isso a régua é só de isenção). ⚠️ O `soci` solto casava dentro de "Social"/"Sociais" e fazia 3 pessoas virarem sócias — daí o match por palavra. ⚠️ Não dá para inferir a exceção pelo sufixo de senioridade: `Coordenadora de Ilustração e Cadastro **PL**` é coordenadora de verdade (isenta). A justificativa do Sheets passou a dizer **"cargo de liderança (coordenador ou acima)"**, senão a triagem lê "liderança" achando que a pessoa tem equipe. Testes: `tests/cargo-lideranca.test.ts` (casos reais nomeados) + bloco D20 em `tests/teamguide-lideranca.test.ts`. |
| **D27** | **Projeto ESPECIAL não abre fila de pré-aprovação** (decisão do Luis, 06/08/2026). `abrirPreAprovacao` devolve `isento` com motivo `'especial'` → coluna `Aprovação do Líder` = `—` e justificativa própria (*"Projeto especial — sem pré-aprovação do líder (vai direto à validação da RPA)"*). ⚠️ O guard roda **ANTES** da TeamGuide: é flag do próprio projeto (`especial = 1`), não depende de integração externa — trocar a ordem gastaria uma chamada externa para nada. | Projeto especial **não tem memorial financeiro**, então a 3ª pergunta do checklist ("o saving é coerente com o impacto?") não teria o que julgar, e o destino dele sempre foi a **validação humana da RPA** (é o que a flag significa). Estava só no código e no handoff — entrou aqui pela regra 12. Teste: *"projeto ESPECIAL não abre fila, nem consulta a TeamGuide (D27)"* em `tests/aprovacoes-lider.test.ts`. |
| **D28** | **O líder convocado à fila LÊ o projeto em `/projeto/$id`** (correção de bug, 06/08/2026). O acesso de leitura passa a ter uma **3ª porta**: além de owner e participante, quem tem **linha em `projeto_aprovacoes`** para aquele projeto. A porta dá **só leitura** — `podeEditar` não muda (edição é do owner e dos `editores_delegados`, gotcha 8) — e o papel devolvido é **`'aprovador'`**, que a tela usa para o selo ("Aguarda seu parecer" / "Parecer registrado", rótulo + ícone) e para o link de volta apontar para `/aprovacoes`. Regras da porta: **(a)** linha **JÁ DECIDIDA também dá leitura** (o card segue oferecendo a doc depois do parecer — D15 —, e quem acabou de aprovar não pode levar 403 no que aprovou); **(b)** a checagem é **só SQLite, nunca a TeamGuide** — a liderança ao vivo é a régua de quem ENTRA na fila, não de quem já foi convocado, e uma reorganização de time não pode apagar o acesso a um projeto que a pessoa tem em mãos; **(c)** só é consultada quando owner/participante/admin falham (zero I/O extra para eles); **(d)** falha de leitura do banco → **sem acesso** (nunca "concede na dúvida"). Puro: `resolverAcessoAprovador(linhas, email)`; I/O: `acessoDeAprovador(projetoId, email)`. | **Bug em PRODUÇÃO**, achado pelo Estevão Vidal em 06/08/2026 (*"não to conseguindo abrir a página de 'Ler a documentação completa' no godocs pra aprovar um projeto"*, print com **"Acesso negado."**): o card da fila oferece o link, mas o gate era `ehOwner \|\| ehParticipante` e o líder **não é nenhum dos dois** → **403**. Era a **T3 do plano F1** e o **critério de aceitação nº 2**, que a spec afirmava cumprido; o `/ggsd:ship` barrou o merge do PR #235 exatamente nisso (`diverge-alta`, confiança 0,74). Custo real: 28 líderes foram convidados a `/aprovacoes` e quem clicava batia no erro. **Por que a linha da fila é prova suficiente:** é a MESMA régua do gate de `decidirAprovacao` (só grava se existir linha para (projeto, e-mail)) — quem pode **decidir** com base nela pode **ler** com base nela; o contrário (poder decidir sem poder ler a doc) é que era incoerente. Testes: bloco *"getMeuProjeto — o líder LÊ o projeto e NÃO edita"* + `resolverAcessoAprovador` em `tests/aprovacoes-lider.test.ts` (inclui: estranho segue levando 403, projeto sem fila não abre para ninguém, autor intocado). |
| **D31** | **EDIÇÃO tem CARD PRÓPRIO: o que mudou na frente, o que não mudou colapsado** (pedido do Kaique, 17/08/2026). O card do D13/D15 passa a ser o card da **submissão nova**; quando o item da fila é um **reenvio** (`projeto_aprovacoes.versao > 1`), a tela monta o `CardEdicao`: cabeçalho dizendo qual versão está em julgamento e contra qual está comparando, **"O que mudou"** aberto (uma linha por campo, `antes → agora`, com **chip de variação** nos números), **texto longo colapsado** (memorial, descrição, documentação — abre em ANTES/AGORA empilhados) e **"Ver o que não mudou (N campos)"** fechado. A **zona do parecer é a MESMA** (checklist + bloqueio + caixa de texto, componente único `ZonaParecer`) — o card muda o que se LÊ, nunca o que se cobra. Quem escolhe o card é o **servidor** (`ItemAprovacao.edicao`), não o líder. Comparação PURA em **`src/lib/diff-versoes.ts`** (catálogo `CAMPOS_VERSAO`); rótulos/formatação em **`src/lib/projeto-rotulos.ts`** (fonte única com a tela). | O card de submissão mostra tudo com o mesmo peso — é o certo para quem lê o projeto pela 1ª vez e o **errado** no reenvio: o líder já leu, e reler a mesma parede de texto para achar de memória o que mudou é o caminho mais curto para o carimbo (o oposto do D13, "fácil, rápido e intuitivo"). Nos números o que decide o parecer não é o valor, é o **salto** entre versões: a 3ª pergunta do checklist ("o saving é coerente?") só tem resposta honesta se "R$ 5.400 → R$ 7.290" estiver escrito. **Decisões dentro da decisão:** **(1)** compara a versão da fila com a **imediatamente anterior**, não com "a última que este líder aprovou" — `abrirAprovacoesPendentes` **DELETA** as linhas anteriores a cada reenvio (D10), então o histórico de pareceres por versão não existe para consultar; **(2)** o **chip de variação é NEUTRO** (azul nas duas direções, com ícone ▲/▼ e `aria-label`) — na 1ª versão era verde/âmbar e estava errado duas vezes: **custo externo** subindo saía verde, e um saving que dobra é o que o líder tem de **duvidar**, não celebrar; **(3)** delta numérico só sai quando a **recorrência não mudou** ("120 h/mês → 120 h/trimestre" não é variação de zero, é outra unidade); **(4)** campo vazio nas duas versões **não aparece nem como "sem mudança"**; **(5)** sem snapshot da versão anterior (o `gravarVersaoProjeto` é não-bloqueante, e legado importado nunca teve v1) a tela **diz isso** e mostra o card completo — nunca um "antes" inventado; **(6)** a comparação **não cobre** participantes nem anexos (não estão no snapshot de versão) e o card **declara essa lacuna** por escrito, porque silêncio ali pareceria garantia. ⚠️ O catálogo é **separado do `CAMPOS_DIFF` do Investigador de propósito** (auditoria × parecer do gestor: lá `status` interno entra, aqui é ruído). Testes: `tests/diff-versoes.test.ts` (14 casos, incluindo os itens 1–5). |
| **D32** | **Cadastro torto na TeamGuide se corrige por uma lista DECLARADA de overrides, não por `if` no fluxo** (pedido do Kaique, 26/08/2026). Fonte única PURA **`src/lib/lideranca-override.ts`**: `OVERRIDES_LIDERANCA` é uma lista de `{ liderado, ignorar[], motivo }` e `filtrarLideresOverride(email, lideres)` a aplica. Ligada em **UM** ponto — `construirIndiceLideranca` (`areas/teamguide.server.ts`) —, para os **dois** lados do índice ficarem coerentes: quem sai da lista de líderes de alguém também não recebe essa pessoa como liderado. Régua: o override só **REMOVE** líder errado, **nunca inventa** um — quem fica é o próximo líder que a árvore já devolve. ⚠️ **FAIL-SAFE:** se a remoção esvaziaria a lista, o override é **IGNORADO** — `sem_lider` ISENTA o projeto de pré-aprovação (D3), e ninguém pode virar isento por causa de um remendo nosso. ⚠️ A TeamGuide **não é tocada** (decisão do Kaique: *"na teamguide não tocamos nisso até alguém ajeitar"*) — o organograma é lido por outros sistemas (gomoon-dash, derivação de área). Entrada 1: `lucas.braide@gocase.com` ignora `wellington.brito@gobeaute.com.br`. ⚠️ **Exceção POR PROJETO (27/08/2026):** o remendo é por PESSOA, mas o Lucas pediu que no projeto **"Quiz de Vendas Apice"** (`4790ee41286dffa0b9ff13117596295f`) o líder seja o **Wellington mesmo** — daí o campo `exceto_projetos`, que faz a entrada se calar naquele id e a árvore voltar a mandar (Wellington + Eughenio; D4 resolve com o primeiro que decidir). Mecânica: o índice passa a guardar também os líderes **CRUS** (`lideresBrutosPorEmail`) e **`getLideresDe(email, { projetoId })`** refiltra a partir deles; sem `projetoId` (índice geral, scripts de diagnóstico) o override vale inteiro, e por isso `abrirPreAprovacao` e o `dry` de `reabrirPreAprovacoes` **sempre** passam o id — esquecer ali deixa a ressalva inerte, com teste que cobra a chamada. Testes: `tests/lideranca-override.test.ts`. | Caso real: o projeto **"Automação de Report de CRO"** (Lucas Braide, submetido 17/08/2026) abriu fila para o **Wellington**, um **Tech Lead** — e não para o **Eughenio**, líder do nó `TECNOLOGIA`. A derivação estava CERTA para o dado do dia: a TeamGuide aloca o Lucas dentro do `[TECNOLOGIA] TIME WELLINGTON`, e o time `PM (Gocase)` (onde o Lucas é o líder, o que faz a régua subir ao pai `TECNOLOGIA` → Eughenio) só foi **criado em 19/08/2026 14:08** (`createdAt` da API), 2 dias DEPOIS da submissão. Ou seja: a fila é um **retrato do momento da submissão** e não se recalcula quando a árvore muda — quem reabre é `POST /api/admin/aprovacoes/reabrir` (`forcar:true`). Sem o override, reabrir hoje convoca **os dois** (a árvore devolve Wellington + Eughenio), o que é exatamente o que se queria evitar. **Por que uma lista e não um `if`:** o remendo tem de ser **encontrável e removível** — cada entrada carrega o motivo e a data, e o dia em que o cadastro for arrumado lá a linha morre daqui sem ninguém precisar caçar `if` em `teamguide.server.ts`. |
---

## 2. O que a API TeamGuide realmente entrega (verificado ao vivo, 03/08/2026)

⚠️ **Os endpoints de liderança estão 403 com o `TG_API_TOKEN` atual** — não são
uma opção, e pedir token novo seria dependência de infra:

| Endpoint | Resultado real |
|---|---|
| `GET /employees/{id}/leaders` | **403** `"You aren't allowed to detail this employee"` |
| `GET /employees/{id}/teams` | **403** (mesma mensagem) |
| `GET /leaders/{id}/led` | **403** `"You are not allowed to access this resource"` |
| `GET /leaders/is-direct-leader-of` · `is-led-by` | Relativos ao **dono do token**, não a um terceiro → inúteis aqui |
| `GET /employees/me/leaders` · `/teams/leader/me` | `200` mas **`[]`** (o token não é de uma pessoa com liderança) |

**O que funciona (é a base do plano):**

| Fonte | Custo | O que dá |
|---|---|---|
| `GET /teams` | 1 call, 129 times ativos | `id`, `name`, `teamParent`, **`leader: {id, name}`** → a árvore inteira |
| `GET /teams/25419/members?directOnly=false&pageNumber=N&pageSize=100` | ~5 calls | 432 pessoas com `contactEmail` + **`teamsIds`** |
| `GET /employees/emails/{email}` | 1 call | `{exists, employeeId}` — resolve o e-mail direto, sem busca por nome |

**Regra de derivação:** *líder de P = líder do time de P; se P **é** o líder daquele
time, sobe pro time pai e repete.*

Rodada nas 432 pessoas: **431 têm líder; exatamente 1 não tem — `rafael@gocase.com`
(CEO, time `N1`, cujo pai `Gogroup` não tem líder)**. Confere com a realidade (D6).
Amostras validadas: `luis.albuquerque@` → Lucas Gonçalves Queiroz (RPA) ·
`adyla.martins@` (que **é** líder de FACILITIES) → subiu certo pra Simony Morais
(GENTE E GESTÃO).

---

## 3. Dois bugs achados na integração atual (`src/lib/areas/teamguide.server.ts`)

### 3.1 🐛 Paginação morta — toda listagem lê só os 25 primeiros (✅ corrigido na F0)

`fetchMembersByText` pagina com `?page=N`. No OpenAPI o parâmetro `page` é um
**objeto** (`{pageNumber, pageSize}`), ou seja os nomes reais são
**`pageNumber`/`pageSize`** — `?page=N` é **ignorado** e a API devolve sempre a
primeira página. Verificado: `?page=0` e `?page=1` retornam as **mesmas** 25
pessoas; `?pageNumber=1` retorna outras. `pageSize` tem **teto de 100** (pedir 1000
devolve 100).

O loop de 20 páginas nunca avança e o `break` de `batch.length < 25` nunca dispara
(sempre vêm 25 cheios). Não explodiu até hoje porque o `text=` estreita o resultado
pra menos de 25 na maioria dos casos — mas é uma bomba armada para qualquer
listagem mais larga.

### 3.2 🐛 "ÁREA NÃO IDENTIFICADA" — 10 pessoas, não só o Rafael (✅ corrigido na F0)

O `buildAreaIndex` cobre **121 dos 129 times**. Os **8 descobertos são exatamente
os nós que a regra declara "não são área"** — as raízes de domínio e os
passthrough:

- **Diretoria/raízes:** `Gogroup` (25419), `N1` (43685, Rafael Lobo), `N1 - GUILHERME NOBREGA` (43688), `N1 - LUIS LIVERI` (43689)
- **Passthrough:** `BIZOPS` (46642, Bruno Bezerra), `MKT | PRODUTO | B2B GOCASE` (46645, Pedro Glycério), `OPERAÇÕES` (43732, Rafael Menezes), `TIME JOAQUIM QUINDERE` (48320)

Quem está alocado **no** nó guarda-chuva (e não num filho) cai no vazio — **10
pessoas**: Rafael Lobo, Guilherme Nóbrega, Joaquim Quinderé, Bruno Bezerra, Rafael
Menezes, Leandro Dias, Ricardo Maurique, Claudinei Zunfrilli, Luísa Souza, Rafael
Craveiro.

**Fix (D5):** segunda camada de fallback no índice — nó ainda descoberto mapeia
para **si mesmo** (nome do próprio nó), aplicada **depois** da camada de área
normal. Os 422 que já resolvem não mudam.

> Corolário: `deriveAreaFromEmail` deve parar de buscar por **nome** (tokens do
> local-part do e-mail, com dedução frágil) e usar `GET /employees/emails/{email}`
> + o índice de membros. Hoje um homônimo ou um e-mail que não siga
> `nome.sobrenome@` erra silenciosamente.

---

## 4. Plano de implementação

### F0 — Base TeamGuide (`src/lib/areas/teamguide.server.ts`) — ✅ **implementada 03/08/2026**

> Como aterrissou: `fetchTeamMembers` (paginação real) · 2ª camada em `buildAreaIndex`
> (nó descoberto → próprio nome) · `raizesDeCobertura` (de onde os membros são lidos —
> genérica porque um ciclo na árvore zeraria a lista de "sem pai") · caches
> `cacheTimes`/`cacheMembros`/`cacheLideranca` por isolate, só em sucesso ·
> `buildLiderancaIndex`/`getLideresDe`/`getLideradosDe`. Testes:
> `tests/teamguide-lideranca.test.ts` (16 casos) + `tests/areas-teamguide.test.ts`.
> ⚠️ O índice devolvido por `buildLiderancaIndex()` são **2 mapas**
> (`lideresPorEmail`/`lideradosPorEmail`), não o `Map<email, {employeeId,…}>` que o
> item 4 abaixo previa — os dois lados saem do mesmo índice, como planejado.

1. `tgGet` ganha helper de paginação com **`pageNumber`/`pageSize=100`**, parando
   por página parcial **ou** por página sem ids novos (defesa contra param
   ignorado — foi exatamente o modo de falha do bug 3.1).
2. `buildAreaIndex` ganha a **camada de fallback** (nó descoberto → próprio nome).
3. `deriveAreaFromEmail` reescrita sobre `GET /employees/emails/{email}` + índice
   de membros; mantém a assinatura e o `null` de saída (o chamador segue decidindo
   o aviso).
4. **Novo:** `buildLiderancaIndex()` → `Map<email, { employeeId, times: number[], lideres: {email, nome}[] }>`,
   derivado de `/teams` + membros, com o algoritmo de D7 e cache por isolate
   (mesma vida do cache de token).
5. **Novo:** `getLideresDe(email)` e `getLideradosDe(email)` — os dois lados, um
   índice só.

**Testes** (`tests/teamguide-lideranca.test.ts`, funções puras sobre fixture da
árvore real): os 10 casos de área sem cobertura, Rafael sem líder, o caso
"líder do próprio time sobe pro pai" (Adyla), multi-time (Joaquim/Aline), e a
paginação parando em página repetida.

### F1 — Aprovação dentro do GoDocs — ✅ **implementada 03/08/2026**

> Como aterrissou (arquivos): `src/lib/aprovacoes.functions.ts` (novo, coração da
> feature) · tabela `projeto_aprovacoes` em `src/integrations/db/schema.ts` + helpers em
> `client.server.ts` · rotas em `src/worker.ts` · tela `src/routes/aprovacoes.tsx` (nova)
> + faixa de entrada em `src/routes/index.tsx` + selo no card em `meus-projetos.tsx` ·
> coluna `Aprovação do Líder` em `google/sheets.ts` (+ `aprovacaoLider` no payload de
> `google/sync.ts`) · gancho em `submeterParaValidacao` (`chat.functions.ts`).
> Testes: `tests/aprovacoes-lider.test.ts` (16 casos) + os 5 novos de `ehLideranca`
> em `tests/teamguide-lideranca.test.ts`.

- **Tabela `projeto_aprovacoes`** (`CREATE TABLE IF NOT EXISTS`, padrão do
  `ajuda_chamados`): `projeto_id`, `versao`, `autor_email`, `aprovador_email`,
  `aprovador_nome`, `veredito` (`pendente|aprovado|reprovado`), `comentario`,
  `decidido_por`, `criado_em`, `decidido_em`. **Interna** — fora de
  `SAFE_UPDATE_FIELDS`, não sofre sync reverso. `ON DELETE CASCADE` do projeto.
  ⚠️ **Nenhum comentário do `SCHEMA_SQL` pode conter ponto-e-vírgula** — o `initSchema`
  divide o SQL por `;` e um deles no meio de um comentário parte o `CREATE TABLE` ao
  meio (aconteceu nesta implementação: `db-async`/`sync-reverse` quebraram em bloco).
- **`src/lib/aprovacoes.functions.ts`**:
  - `abrirPreAprovacao(projetoId)` — chamada no `submeterParaValidacao`. Resolve a
    isenção (D11 → `ehLideranca`), depois os líderes (D6 → `getLideresDe`), regrava a
    fila (D10: apaga a rodada anterior e insere pendentes) e dispara a DM em
    `runBackground`. **NUNCA lança** (D3): devolve `{isento, motivo, rotuloSheet}` e a
    submissão segue igual se a TeamGuide estiver fora.
  - `listarAprovacoesPendentes(email)` → `{ lidera, itens }` (o `lidera` é o gate de
    exibição no frontend; cai para "tem pendência?" se a TeamGuide falhar).
  - `decidirAprovacao(email, body)` com **gate server-side**: só grava se existir linha
    PENDENTE para (projeto, e-mail) — a linha veio da TeamGuide na submissão, então ela
    É a prova de que quem decide lidera o autor. Reprovar **exige comentário** (é o
    texto que o autor lê). D4: grava em TODAS as linhas pendentes do projeto.
  - `resumoAprovacaoPorProjeto(ids)` — 1 query (IN) para os cards do autor.
  - `rotuloAprovacaoSheet(linhas)` — função **pura**, único lugar que redige os rótulos
    de fila (pendente/aprovado/reprovado).
  - `rotuloIsencaoSheet(motivo)` — função **pura**, único lugar que redige os rótulos dos
    3 casos SEM fila (D12). ⚠️ Não redigitar esses textos no `semFila` nem no chamador.
  - `montarParticipantes(membros, papeis, autor)` — função **pura**: lista do card com
    nome legível + papel, sem o autor e sem repetição (D13).
- **`src/lib/aprovacoes-checklist.ts`** — módulo **PURO** (sem import de servidor) com as
  **3 perguntas** do checklist do gestor (D13), `checklistCompleto` e `resumirChecklist`.
  FONTE ÚNICA: a tela e o rótulo do Sheets leem daqui. ⚠️ Ao mudar o texto de uma
  pergunta, altere a constante — não redigite na tela.
- **Rotas** (`src/worker.ts`, autenticadas, **não** admin):
  `GET /api/aprovacoes/pendentes` · `POST /api/aprovacoes/decidir`.
- **Frontend**: rota própria **`/aprovacoes`** ("Pré-aprovações do meu time") em vez da 5ª
  aba de "Meus Projetos" — a fila é um fluxo de decisão (ler doc → aprovar/pedir ajuste
  com comentário), e a lista de "Meus Projetos" é derivada de um único fetch com
  contagem por filtro (encaixar outra fonte ali era cirurgia num arquivo de 43 KB por
  zero ganho de UX). Entrada: faixa na home, visível **só a quem lidera**. O card abre
  `/projeto/$id` read-only (memorial **sem R$** — a regra vale também pro líder; o R$ que o
  líder precisa para a 3ª pergunta está no card, D13). ⚠️ **O acesso do líder a essa tela só
  passou a existir em 06/08/2026 (D28)** — antes o gate era `ehOwner || ehParticipante` e o
  link do card devolvia **403**.
  Estado por **rótulo + ícone**, nunca só cor. O card é **auto-suficiente** (D13): dono,
  participantes com papel, saving em destaque, descrição e memorial expansível — abrir a
  documentação completa virou opção, não pré-requisito. O bloco "Seu parecer" só libera
  os botões com as **3 respostas** marcadas.
  **Slider (D15, 04/08/2026):** a lista empilhada virou **um projeto por vez**. Estado no
  `AprovacoesPage`: `fila` (append-only, estável) + `decididos` (id → veredito) + `indice`;
  `BarraFila` desenha a posição e os traços; `CardAprovacao` recebe `decidido` e, quando
  vem preenchido, troca os botões pela faixa do parecer + "Ir para o próximo sem parecer".
- **Sheets:** coluna **`Aprovação do Líder`** (mapeada por nome) — `"Pendente com X"` no
  append, `"Aprovado por X em dd/mm/aaaa"` / `"Reprovado por X em dd/mm/aaaa — motivo"`
  quando o líder decide, `"—"` quando não se aplica. ⚠️ **A coluna precisa existir no
  cabeçalho** das abas `GoDocs` e `STAGING` (pré-requisito P2 do Luis) — sem ela o valor
  é ignorado com aviso e o resto do sync segue normal.

### F2 — envio da DM — ❌ **REMOVIDA do GoDocs em 05/08/2026 (D17)**

Foi implementada em 03/08/2026 (`src/lib/google/chat-dm.ts` + `corpoDmAprovacao`, DM real
validada na staging e recebida pelo Lucas) e **desmontada em 05/08/2026**: entregar a DM
é do **Gomoon**. O que saiu do repo: `src/lib/google/chat-dm.ts`, o disparo dentro do
`abrirPreAprovacao`, `mensagemDmAprovacao`/`corpoDmAprovacao`/`urlDaFila` e as assertivas
de DM em `tests/aprovacoes-lider.test.ts`.

⚠️ **Não reimplementar aqui.** O caminho novo é o **F3**.

### F3 — POST diário da relação para o Gomoon — ⏳ **não codado** (contrato fechado)

Contrato em **[docs/integracao-gomoon-chat.md](../docs/integracao-gomoon-chat.md)** (documento
escrito para o time do Gomoon; é a fonte). Resumo do que falta construir do nosso lado:

- **Agregada** em `projeto_aprovacoes`: `WHERE veredito='pendente'` + `GROUP BY
  aprovador_email`, devolvendo por líder os liderados (`autor_email`) e a contagem de
  projetos. O `contarAprovacoesPendentesDe` (já existente, hoje sem chamador) é o
  embrião — a agregada nova o substitui em uma consulta.
- **Cron** diário → **`0 12 * * 1-5` = 09h BRT** (o cron do Godeploy é UTC). ⚠️ Este bullet
  dizia `0 9` (6h BRT), o horário que a D17 imaginou; o horário acordado com o Gomoon virou
  **09h–10h BRT** e o código usa `0 12` (ver §8 e `docs/integracao-gomoon-chat.md`). A
  contradição entre os dois números vivia dentro desta spec — se mudar o horário, mude nos
  **três** lugares (aqui, §8 e o contrato).
- **POST** com o snapshot completo (`lideres: []` em dia sem pendência), `Authorization:
  Bearer` de um secret novo, e chave de idempotência `godocs:<email>:<YYYY-MM-DD>`.
- **Excluir os projetos `[E2E-…]`** ao montar o payload — o mute deixou de existir no
  `abrirPreAprovacao` (é lá que estava, via `ehProjetoTesteE2E`).
- **Sem R$ no payload**, por decisão: o dado sensível não sai do app.


---

## 5. Gotchas que não podem regredir

1. **Nunca ler `process.env` em escopo de módulo** (convenção do `CLAUDE.md`) — o
   token da TeamGuide e as envs de Chat só dentro de função. O `getToken()` atual
   já faz certo; manter.
2. **A cota da TeamGuide é compartilhada** com os outros consumidores (mesmo
   padrão da cota do Sheets): `buildLiderancaIndex` é ~6 calls, então **cachear**
   e nunca chamar por item numa listagem.
3. **`descontinuado` e ownership não mudam**: a fila de aprovação não é ownership.
   Líder **não** ganha direito de editar o projeto do liderado (isso é
   `editores_delegados`, decisão separada).
4. **A DM não é fonte de verdade de nada** — se a mensagem falhar, a aprovação
   continua pendente no GoDocs e visível na aba. Nunca gravar estado a partir do
   retorno do Chat.
5. **A isenção de liderança (D11) mora em UM lugar só** — `ehLideranca` (derivado do
   `leader` dos times) + a checagem no topo de `abrirPreAprovacao`. Não espalhar
   "quem é líder" por outros pontos: se a régua mudar (ex.: passar a valer só de
   coordenador pra cima), ela muda ali.
6. **A pré-aprovação NUNCA bloqueia a submissão** (D3): `abrirPreAprovacao` não
   propaga erro e o status do projeto/planilha não depende do veredito do líder.
   Se um dia isso virar portão, é decisão de produto — não efeito colateral.
7. **`GOOGLE-CHAT-DM.md` contém chave privada em texto puro** e foi adicionado ao
   `.gitignore` nesta sessão (junto com `openapi.json`). ⚠️ **Não commitar, não
   colar o conteúdo em spec/doc/PR.** Se já tiver circulado, rotacionar a chave da
   SA no GCP.

---

## 6. Pendências fora do código

| # | Pendência | Dono |
|---|---|---|
| ~~P1~~ | ~~**DWD da SA `godocs@admin-n8n-study`**~~ — **RESOLVIDA por outro caminho (03/08/2026)**: a credencial `CHAT_SA_*` do `.env` já tem os escopos `chat.spaces` + `chat.messages.create` com `sub=rpa_ia@gocase.com`, validada ao vivo (D9). Pedir a DWD da SA `godocs@` virou opcional — se um dia sair, é só apagar as 2 linhas `CHAT_SA_*` e cair no fallback `GOOGLE_SA_*`. | — (era: Admin do Workspace) |
| P2 | Criar a coluna **`Aprovação do Líder`** no cabeçalho das abas `GoDocs` e `STAGING`. | Luis |
| ~~P3~~ | ~~Confirmar que `rpa_ia@gocase.com` tem **Google Chat ativo**~~ — **caducou com a D17**: não impersonamos mais caixa nenhuma. | — |
| ~~P4~~ | ~~**Gomoon (D17):** URL, token, DM proativa, códigos de erro, log de entrega~~ — **RESPONDIDA em 05/08/2026** pelo João Victor: a API está **em produção** (`POST https://gomoon.gogroupbr.com/api/godocs/lideres-pendentes`); o **Bot Gomoon é admin-installed** no Workspace via Marketplace privado (DM 1:1 já materializada com 1.082 contas — não precisou de DWD); erros e log de entrega em `docs/integracao-gomoon-chat.md` §11–12. **Resta só o token** (enviado por canal separado, entra como secret). | Luis + time Gomoon |
| P5 | **Faxina de secrets:** apagar `GOOGLE_CHAT_DM_ENABLED`, `CHAT_SA_CLIENT_EMAIL`, `CHAT_SA_KEY_BASE64` e `GOOGLE_CHAT_DM_SUBJECT` do `edf400b4` e do `.env` local (inertes desde a D17). | Luis |
| P6 | **Secret `GOMOON_TOKEN`** nos apps `edf400b4` (staging) e `674a3710` (prod) + **cron `0 12 * * 1-5`** (09h BRT) apontando para `POST /api/cron/notificar-lideres`. | Luis |

**F0 e F1 não dependem de nada disso** e podem ir a staging → prod antes. **F3** (o POST
diário) está **implementada** (05/08/2026 — ver §8 abaixo) e depende só da P6.

---

## 8. F3 — o POST diário ao Gomoon (implementado 05/08/2026)

Detalhe completo (contrato dos 2 lados, decisões, invariantes) em
[docs/integracao-gomoon-chat.md](../docs/integracao-gomoon-chat.md) §11–12. Resumo:

| Peça | Onde |
|---|---|
| Agregada líder×liderado | `getPendenciasPorLider()` — `src/integrations/db/client.server.ts` |
| Payload (PURO) + envio | `src/lib/gomoon-lideres.functions.ts` |
| Cron (09h BRT = `0 12 * * 1-5` UTC) | `POST /api/cron/notificar-lideres` |
| Manual/admin (`{"dry":true}` não envia) | `POST /api/admin/notificar-lideres` |
| Testes | `tests/gomoon-lideres.test.ts` · `tests/gomoon-pendencias-sql.test.ts` |

**Decisões fechadas que NÃO podem ser "corrigidas" por engano:**

- **A relação sai da FILA (`projeto_aprovacoes`), não da TeamGuide.** A fila já foi escrita
  a partir dela na submissão; reconsultar aqui criaria uma segunda régua e um jeito de o
  payload divergir do que a tela `/aprovacoes` mostra.
- **Nenhum valor em R$ no payload** — só nome, e-mail e contagem. É o que torna impossível
  vazar saving numa DM que se lê por cima do ombro. Há teste varrendo o JSON.
- **Dia sem pendência dispara igual, com `lideres: []`.** Silêncio é indistinguível de cron
  morto. Não "otimizar" pulando o POST.
- **A data da `idempotency_key` é o dia de Brasília**, não o UTC (disparo noturno viraria
  "amanhã" e renderia uma 2ª DM no mesmo dia).
- **`notificarLideresPendentes` nunca lança** — o chamador é cron; o corpo da resposta É o
  relatório.
- **09h BRT, não 6h** (o Gomoon entrega a DM na hora que recebe o POST; às 6h o líder
  recebia notificação de madrugada).
- **Staging protegida só pelo campo `ambiente`** (opção 2 do contrato, derivado do
  `GODOCS_ENV`). ⚠️ `GODOCS_ENV` errado na staging = DM para líder real. O token separado
  que fecharia isso estruturalmente está disponível a pedido do João Victor.

---

## 9. D21 — quem REDIGE as mensagens é o GoDocs (06/08/2026)

**Decisão do Luis (06/08/2026):** o texto das DMs vai **pronto** no payload; o Gomoon
entrega. Contrato **v2** em [docs/integracao-gomoon-chat.md](../docs/integracao-gomoon-chat.md)
§13–§14 (foi o que o Luis passou ao João Victor para ele implementar do lado dele).

**Por que a inversão** (o §7 do contrato dizia "o template é do Gomoon"): o `total` é a
**soma** dos liderados, a lista quer bullets na ordem certa, o plural muda a frase e a data
sai em fuso de Brasília. Isso do outro lado significaria um mini-engine de template lá e a
cópia morando em dois repos. Com o texto pronto, mexer numa vírgula é deploy **nosso**.

| Peça | Onde |
|---|---|
| **Redação (PURA, fonte única)** | **`src/lib/gomoon-mensagens.ts`** |
| Aviso diário ao líder | `renderMensagemLider()` → `lideres[].mensagem.texto` do payload |
| Anúncio de abertura (1×, empresa) | `TEXTO_ANUNCIO_PRE_APROVACAO` + `ANUNCIO_CHAVE` |
| Envio do anúncio | `anunciarPreAprovacao()` + `POST /api/admin/anunciar-pre-aprovacao` |
| Testes | `tests/gomoon-mensagens.test.ts` (+ os 2 do payload) |

**Decisões fechadas que NÃO podem ser "corrigidas" por engano:**

- **O anúncio NÃO viaja no payload diário.** Endpoint próprio (`/api/godocs/anuncio`), chave
  `godocs:anuncio:pre-aprovacao-lider:<versão>` **SEM data** → o Gomoon entrega **1× por
  pessoa, para sempre**. Pendurado no snapshot diário, o anúncio viraria DM de anúncio **todo
  dia**. Mexer na redação **não** reenvia nada; só **subir a versão** reabre o disparo — ver
  **D22** (a versão em vigor é a **`v2`**; o `v1` foi queimado ainda em teste).
- **`dry` é o DEFAULT do anúncio** (`anunciarPreAprovacao` e a rota): enviar exige
  `{"dry":false}`. É a única rota do repo em que um POST distraído fala com a empresa inteira.
- **A audiência é resolvida pelo Gomoon** (`destinatarios: "todos"`) — quem já resolve
  e-mail→usuário do Chat é ele. Não montamos lista de funcionários.
- **A mensagem é renderizada DEPOIS de ordenar os liderados** — renderizar antes daria uma DM
  com os bullets em ordem diferente da lista do payload.
- **Nenhum valor em R$ nos textos** (o teste do payload varre o JSON, e o texto agora está
  dentro dele). No anúncio a varredura é por **valor** (`R$`, "N mil/reais"), não pela palavra:
  o texto explica que o líder confere "o ganho declarado".
- **O texto do anúncio é conferido contra o app por teste**: isenção = **D20** (coordenação
  para cima, sem citar supervisor) · entrada da fila = **faixa "Pré-aprovações do meu time" da
  home** (não existe menu "GoDocs → Pré-aprovações") · o ajuste **"fica visível em Meus
  Projetos"**, e **não** "você recebe" — o autor não é avisado por DM nem e-mail (pendência
  aberta desde 03/08; se um dia for avisado, cabe no mesmo payload diário).
- **O Gomoon mantém o template dele como fallback** (se `mensagem` faltar) — é o que deixa os
  dois lados deployarem em qualquer ordem.

---

## 10. D22 — o markup é HTML de CARTÃO, não `*asterisco*` (06/08/2026)

**O que aconteceu:** o 1º disparo real na staging chegou ao Google Chat com o markup **cru na
tela** — `*Você tem projeto para pré-aprovar no GoDocs*`, asterisco e tudo. Não era falta de
formatação nossa nem bug do Gomoon: **o contrato v2 (D21) não fixava a SUPERFÍCIE de entrega**,
e cada lado assumiu uma.

O Google Chat tem **duas sintaxes que não se conversam**, e o Gomoon entrega o nosso texto
dentro de um **cartão** (`cardsV2` → `TextParagraph`):

| Superfície | Negrito | Itálico | Quebra |
|---|---|---|---|
| mensagem de texto (campo `text`) | `*assim*` | `_assim_` | `\n` |
| **cartão (`TextParagraph`) ← é o nosso caso** | `<b>assim</b>` | `<i>assim</i>` | `\n` ou `<br>` |

**Decisões fechadas que NÃO podem ser "corrigidas" por engano:**

- **A redação usa HTML de cartão** (`<b>`, `<i>`, `<u>`, `<s>`, `<a href>`) em `gomoon-mensagens.ts`.
  ⚠️ **A sintaxe segue a superfície, não o gosto:** se um dia a entrega deixar de ser cartão, este
  arquivo tem de voltar ao asterisco **no mesmo deploy** — senão a DM passa a exibir `<b>` literal.
  Dois testes prendem isso (um por mensagem), e o contrato pede que o Gomoon **avise** se mudar.
- **`\n` fica, `<br>` não.** O cartão do Gomoon preserva a quebra de linha — conferido no print do
  disparo de 06/08. Trocar por `<br>` sem necessidade só acopla mais ao renderizador dele.
- **O aviso ao líder NÃO traz título nem link na prosa.** O cartão já mostra o **cabeçalho**
  ("📋 Pré-aprovação pendente") e o **botão "Abrir a fila"** — que sai do campo `lideres[].url`,
  por isso ele **continua no payload**. Escrever os dois no texto fazia a mesma frase e o mesmo
  link aparecerem **2× na mesma DM**. O **anúncio mantém o título**, porque lá o cabeçalho do
  cartão é genérico ("GoDocs").
- **`ANUNCIO_VERSAO` está em `v2`, e bump NÃO é número de build.** Cada versão nova **fala com a
  empresa de novo**. O `v1` foi entregue ao **destinatário de teste** no 1º disparo de staging e,
  como a chave não tem data, virou **no-op eterno** — o texto corrigido não tinha como ser
  revalidado sem uma versão nova. Ninguém da empresa recebeu o `v1`; **`v2` é a versão que vai
  para produção**. O valor está **pinado no teste de propósito**: subir obriga a editar o teste,
  e é essa a fricção. Histórico das versões no comentário de `ANUNCIO_VERSAO`.
- **Re-disparar o aviso diário no MESMO dia não reentrega** (`ja_entregues: 1`) — é o §4 do
  contrato funcionando, não falha. Para revalidar texto no mesmo dia, o Gomoon precisa limpar a
  chave `godocs:<email>:<YYYY-MM-DD>` do lado dele; senão, espera-se o disparo seguinte.

---

## 7. Próximos passos (código pronto — 03/08/2026)

1. **Staging** (`edf400b4`, regra 13): validar a submissão de um liderado (fila abre +
   coluna "Pendente com X"), a de uma liderança (isento, coluna "—"), a fila em
   `/aprovacoes`, o aprovar e o pedir-ajuste. **Nenhuma notificação sai** (D17).
2. **Coluna do Sheets** (P2) antes de validar a planilha — sem ela o valor é ignorado
   com aviso (o resto do sync não quebra).
3. **Prod** (`674a3710`) — travado até a validação com a diretoria (decisão do Luis,
   03/08/2026). O rollout do aviso ao líder é **independente** da tela: só acontece
   quando a F3 existir e o Gomoon tiver o endpoint de pé (P4).

---

## 11. D26 — o aviso ao líder passa a ser IMEDIATO (06/08/2026)

**Decisão do Luis:** o líder é avisado **na submissão**, não no dia seguinte às 09h.

**Premissa que estava errada na D17:** tratamos a integração como "API diária". Não é — a
§9 do doc do Gomoon diz *"entregamos a DM na hora em que recebemos o POST"*. A cadência
sempre foi escolha nossa (o cron + a data dentro da chave de idempotência). Por isso a
mudança **não exige nada do Gomoon**: mesmo endpoint, mesmo payload, mesmo token.

### O que foi codado

- **`notificarLideresDoProjeto(projetoId, aprovadores, {nomeProjeto, dry})`**
  (`src/lib/gomoon-lideres.functions.ts`) — monta o payload só dos líderes daquele projeto,
  com o **backlog** de cada um, e envia.
- **`chaveDeProjeto(email, projetoId)`** → `godocs:<email>:<projetoId>`. A montagem do payload
  ganhou o parâmetro `chaveDe` para os dois disparos compartilharem a mesma função pura.
- **Call site**: `submeterParaValidacao` (`chat.functions.ts`), via `runBackground`, logo após
  `abrirPreAprovacao` e só quando `!isento && aprovadores.length`.
- **`enviarPayload`** extraído: token, POST, leitura do `resultados[]` e log são compartilhados
  pelo imediato e pelo diário — não podem divergir.

### Decisões fechadas que NÃO podem ser "corrigidas" por engano

1. **A chave é por PROJETO, não por dia.** Com a chave diária, a 2ª submissão do dia para o
   mesmo líder volta `ja_entregue` e a DM some **em silêncio**. Trocar de volta reintroduz o bug.
2. **Manda o backlog do líder, não só o projeto que disparou.** É deliberado: devolve o efeito
   de lembrete que o digest dava, e usa a mesma agregada da tela `/aprovacoes`.
3. **Guard `[E2E-…]` explícito no caminho imediato.** A agregada filtrar o projeto **não basta** —
   sem o guard, a submissão de teste dispara a DM do backlog do líder.
4. **Não manda `lideres: []`.** Lista vazia é invariante do CRON, não deste caminho.
5. **O cron diário NÃO foi apagado** — está implementado, testado e apenas não agendado. As
   chaves são independentes, então os dois convivem se um dia quisermos os dois.
6. **`abrirPreAprovacao` é AGUARDADO no caminho quente da submissão — de propósito.** O review
   do PR #235 sugeriu jogá-la em `runBackground` para tirar a ida à TeamGuide da resposta do
   submit (achado de baixa severidade). **Recusado, 06/08/2026:** o `syncSubmitToGoogle` que
   vem logo depois consome `preAprovacao.rotuloSheet`/`justificativaSheet`, então ela só sai do
   caminho quente **junto com o sync** — e aí o **append da linha na planilha** passaria a
   esperar a TeamGuide dentro do mesmo `waitUntil`. Esse append é o ponto frágil conhecido do
   sistema (append morto por cota já purgou projeto depois da carência de 1h — ver o bullet de
   RECUPERAÇÃO no `CLAUDE.md`); atrasá-lo para economizar ~1–2 s de uma resposta que já leva
   segundos é trocar latência por risco de perder projeto. Se um dia o custo incomodar, a forma
   segura é derivar o rótulo **dentro** do sync (lendo `projeto_aprovacoes`), não adiantar o sync.

### Aberto

- O heartbeat sumiu junto com o cron: silêncio agora é indistinguível de integração quebrada.
- Perguntas ao João Victor (§16 de `docs/integracao-gomoon-chat.md`): descarte de item em retry
  quando chega POST novo, volume, e quem dispara o anúncio de abertura.

## 12. D29 — o analisador reprovou: a fila do líder é DISPENSADA (06/08/2026)

**Problema.** `abrirPreAprovacao` e o aviso ao Gomoon rodam no fim de `submeterParaValidacao`;
o analisador só é disparado **depois**, pelo worker (`src/worker.ts:325-331`). O líder é
convocado **antes de existir veredito** — e um projeto que o analisador reprova por critério
(`claro_nao` → `Status` "Reprovado") continuava na fila dele, no backlog das DMs seguintes e no
relatório de espera por líder.

**Medição em produção ANTES de codar** (595 linhas da planilha; 32 projetos com parecer):
`Status = Reprovado` **0** · fila com `claro_nao` **0** · fila **sem `Classificação` nenhuma**
**18/32 (56%)** · `zona_cinzenta` 9 · `claro_sim` 5.

**Duas decisões que saíram daí (Luis, 06/08/2026):**

1. **O gate sequencial ("analisa → só então convoca") foi DESCARTADO.** Com 56% da fila sem
   veredito nenhum, um gate fail-open seria inerte em mais da metade dos casos e teria acoplado
   o caminho da submissão à parte mais instável do pipeline (o analisador é cancelado com
   frequência — é por isso que existe o cron `reanalisar-pendentes`). **Não reordenar a
   submissão.**
2. O desperdício é **estrutural, não corrente** (0 casos hoje). Logo a fatia é pequena e
   defensiva: fechar a fila quando o veredito chega, sem inventar dependência nova.

**Como funciona.** No ramo `reprovadoPorCriterio` de `analisarProjetoFn` (`chat.functions.ts`),
`dispensarPreAprovacao` (`aprovacoes.functions.ts`) fecha a fila: as linhas **`pendente`** de
`projeto_aprovacoes` viram `veredito = 'dispensado'`, `decidido_por = 'sistema'`. O projeto some
sozinho de `listarAprovacoesPendentes`, de `getPendenciasPorLider` (payload do Gomoon) e de
`contarAprovacoesPendentesDe` — as três já filtram `veredito = 'pendente'`.

**Invariantes que não podem regredir:**

1. ⚠️ **`Dispensado` NUNCA pode virar `Pré-reprovado`.** O fall-through antigo de
   `rotuloAprovacaoSheet` devolvia `Pré-reprovado` para qualquer veredito fora de
   `pendente`/`aprovado`/`ajuste` — a planilha afirmaria que **o líder reprovou** um projeto que
   ele nunca abriu, com o nome e o e-mail dele na célula do lado. A régua é o predicado
   `ehParecerHumano` (`veredito !== 'pendente' && !== 'dispensado'`), e ele vive nas **3**
   funções do arquivo (`rotuloAprovacaoSheet`, `justificativaAprovacaoSheet`,
   `resumoAprovacaoPorProjeto`) — não redigitar `!== 'pendente'` numa quarta.
2. **Precedência: parecer HUMANO vence a dispensa, em qualquer ordem das linhas.** A análise
   roda depois da submissão e pode chegar quando o líder já opinou; o `AND veredito = 'pendente'`
   do `UPDATE` protege a linha dele no banco, e os rótulos protegem as 2 colunas. No
   `resumoAprovacaoPorProjeto` a régua tem **2 níveis**: humano vence sempre, a dispensa só vence
   uma linha ainda `pendente`.
3. **Nunca lança (D3).** `dispensarPreAprovacao` devolve `{dispensou:false}` quando falhou
   **ANTES de gravar** (falhou depois → invariante 4 abaixo); o
   hook em `analisarProjetoFn` ainda a envolve num `try/catch`. A análise, o sync e a submissão
   não caem por causa disto.
4. ⚠️ **Falha DEPOIS de gravar não vira "não fez nada".** Só a re-leitura pode falhar após o
   `UPDATE`; devolver `dispensou:false` ali omitiria as 2 colunas e deixaria a planilha em
   `Pré-pendente` com a fila já fechada no SQLite — o projeto morto seguiria contando no relatório
   de espera, que é o que esta fatia existe para corrigir. **Nada reconcilia essas 2 colunas
   depois** (`reconciliarComplexidade` não as escreve; `resyncGoogle` é manual). Por isso o
   caminho de recuperação cai no rótulo constante do caso comum — fila inteira dispensada, que
   é o que o `UPDATE` acabou de fazer. ⚠️ **Trade-off aceito:** num duplo-fault (um líder decide
   ENTRE a leitura e o `UPDATE` **e** a re-leitura cai), as 2 colunas recebem `Dispensado` por
   cima do parecer dele. O **banco** fica correto (o `AND veredito = 'pendente'` nunca tocou a
   linha do líder) e um `resyncGoogle` reconcilia as colunas; o caso comum — planilha travada em
   `Pré-pendente` para sempre — é bem mais provável que este.
5. **`undefined` ≠ `null` também no `syncUpdateToGoogle`** (mesma régua de 06/08 do submit): a
   análise que **não** dispensou manda `undefined` e a coluna é **omitida** — escrever ali
   apagaria o parecer que o líder já deu. `null` → `—`.
6. **A re-leitura antes de montar o rótulo NÃO é round-trip gratuito:** é ela que faz o rótulo
   respeitar o líder que decidiu **entre** a leitura e o `UPDATE`. Não "otimizar" removendo.
7. **Reabertura:** fila **toda dispensada** é reabrível por `reabrirPreAprovacoes` **sem**
   `forcar: true` (dispensa do sistema não é parecer humano) — é o remédio para a triagem que
   reverte a reprovação. Fila com parecer humano **segue exigindo** `forcar`. A reabertura
   **não** é automática: gatilho no write-back do `/dashboard` ficou FORA de propósito.
8. **Reenvio reabre normalmente (D10):** `abrirAprovacoesPendentes` faz `DELETE` incondicional
   antes de inserir.
9. **O líder mantém a LEITURA do projeto (D28):** a linha continua existindo, então
   `resolverAcessoAprovador` segue concedendo acesso — desejado.
10. **3 superfícies dizem o estado novo, com rótulo + ícone (nunca só cor):** o chip
    `ChipEstadoParecer` do `/dashboard`, o card do autor em "Meus Projetos" e o selo do aprovador
    em `/projeto/$id`. ⚠️ Nas **três** o fall-through anterior afirmava algo falso — "Pré-reprovado",
    "Aguardando o líder" e "✓ Parecer registrado" sobre alguém que nunca abriu o projeto. Ampliar
    o enum `veredito` de novo obriga a varrer os **leitores**, não só os escritores.
11. **`Dispensado` entra no harness de ida-e-volta** (`tests/dashboard-parecer-lider.test.ts`,
    `comoNaPlanilha`) e não como literal solto: renomear o rótulo no produtor tem de **quebrar
    teste**, não fazer o chip cair calado em `sem_parecer`.

**Fora desta fatia (de propósito):** os **56%** da fila sem `Classificação` (analisador cancelado)
— achado colateral maior, fatia própria; o cron `reanalisar-pendentes` repõe Complexidade e
Observações, **não** a Classificação. E a triagem que grava "Reprovado" **à mão** no `/dashboard`
**não** dispensa a fila — só o analisador dispensa.

## 12. D30 — o alerta do grupo do Chat passa a ser disparado pela PRÉ-APROVAÇÃO (11/08/2026)

**Pedido do Luis:** *"as notificações que rolam a cada submissão ou edição no grupo do Google Chat
eu quero que só ocorram agora quando houver uma pré-aprovação do líder. Pois só a pessoa submeter ou
editar e não tiver aprovação do líder ou validação nós vamos desconsiderar. Continuar mostrando
submissão de projetos especiais de forma normal, porém de forma mais enxuta e objetiva."*

**Régua (FONTE ÚNICA `decidirMomentoNotificacao`, `src/lib/notificacao-chat.ts` — módulo PURO):**
o alerta sai quando o projeto está **liberado do lado do líder**.

| Estado de `abrirPreAprovacao` | Quando o grupo é avisado |
|---|---|
| `isento: false` (fila REALMENTE aberta) | **Cala** na submissão; dispara no veredito `aprovado` |
| `especial` (D27) | Na submissão, mensagem **própria e enxuta**, sem nota |
| `lideranca` · `sem_lider` · `teamguide_indisponivel` | Na submissão, **com a nota** dizendo por que não há parecer |
| motivo `null` **ou futuro/desconhecido** (`default`) | Na submissão, com nota genérica |

### 3 decisões tomadas na abertura (seletor)

1. **Quem nunca terá parecer NOTIFICA na submissão, sinalizado.** Silenciar sumiria com esses
   projetos do grupo **para sempre**, e a integração da TeamGuide já caiu antes. A linha do
   *porquê* existe para a triagem não ler a mensagem como pré-aprovação de um líder que não existiu.
2. **`ajuste`/`reprovado` NÃO notificam** — é literalmente o "desconsiderar" do pedido; fica entre
   líder e autor.
3. **A 2ª mensagem por submissão foi SUPRIMIDA** — o `🚨 Novo fluxo de automação cadastrado –
   Análise Pendente` que o `syncUpdateToGoogle` disparava pós-análise era a mesma notificação por
   submissão com outra roupa; mantê-la anularia a mudança. Passa a ser **1 mensagem por projeto**.

### Gotchas que não podem regredir

1. ⚠️ **Só `isento === false` cala.** O `default:` do switch **notifica** — projeto sem ninguém
   para aprová-lo não pode ficar invisível. Um motivo novo no enum entra sem quebrar nada, mas
   entra pelo lado seguro. Teste: 1 caso por motivo + `null` + motivo `as never`.
2. ⚠️ **`notificarChat` é OBRIGATÓRIO em `SubmitSyncParams`** (não opcional-com-default): são 2
   chamadores hoje (`submeterParaValidacao`, `resyncGoogle`) e um terceiro que nascesse
   notificaria o grupo por acidente. `resyncGoogle` passa **`false`** (reparo administrativo não
   avisa ninguém).
3. ⚠️ **`buildUpdateMessage` foi REMOVIDO** de `google/chat.ts` e o bloco de Chat saiu do
   `syncUpdateToGoogle` — **não reimplementar**. O `projectName` do payload sobrou só para o log
   de falha da escrita.
4. ⚠️ **A pré-aprovação NÃO reusa `resyncGoogle`** para remontar o payload: aquele caminho também
   **ESCREVE** a linha inteira na planilha (e mexe em "Atualizado Em"), então a notificação
   regravaria o projeto. Daí o `src/lib/notificacao-projeto.functions.ts`, que só **LÊ**
   (`getProjetoById` + `getDocumentacao`).
5. ⚠️ **O aviso é acessório e nunca derruba a decisão do líder** (mesma régua do D3):
   `notificarChatPreAprovacao` **nunca lança** (devolve `false`) e o gatilho em `decidirAprovacao`
   vai por `runBackground` + `Promise.resolve().then(...)` — que converte até um throw **síncrono**
   em rejeição — mais `catch`. Teste explícito dos dois modos de falha.
6. ⚠️ **Mute de `[E2E-…]` vale nos DOIS caminhos** (o do sync e o da pré-aprovação).
7. **Mensagem do especial ENXUTA:** saíram Ferramenta, Participantes, Data da submissão e os
   separadores; descrição e "por que é especial" vão **truncados** (`LIMITE_TRECHO_ESPECIAL`).
   O que já era omitido (saving/receita/escopo/tipos) segue omitido.
8. **Nada de backfill:** projetos já submetidos antes desta mudança não recebem alerta retroativo.
9. ⚠️ **UMA mensagem por decisão, e "não sei" NOTIFICA** (12/08/2026). O gate de
   `decidirAprovacao` é **check-then-act** — lê a linha `pendente` por `SELECT` e só depois grava —,
   então duplo clique, retry do cliente ou **dois líderes da mesma fila (D4)** passavam os DOIS pelo
   gate e disparavam DUAS mensagens no grupo que a triagem lê. Antes da D30 a corrida era inofensiva
   (o efeito era um write-back idempotente no Sheets); com o alerta pendurado ali, virou duplicata.
   Quem serializa **já existia**: o `UPDATE … AND veredito = 'pendente'` — quem chega depois escreve
   **0 linhas**. Faltava o número chegar ao gatilho: `decidirAprovacoesDoProjeto` passou a devolver
   `Promise<number | null>` (helper `execContando`, ao lado do `exec` que segue `void` para os outros
   26 call sites) e o predicado PURO **`deveNotificarDecisao`** (mesmo módulo `notificacao-chat.ts`)
   decide. ⚠️ **`null` = "o adaptador não reportou" → NOTIFICA**, o mesmo default invertido do gotcha 1:
   `ExecResult` promete `{ rowsWritten: number }`, mas **nenhum caminho de produção lia esse campo**
   até esta fatia (só o wrapper de dev e os fakes de teste), então o `env.DB` do Godeploy nunca foi
   exercitado nisso — um `rowsWritten > 0` cru sobre um `undefined` daria `false` **sempre** e o alerta
   morreria **calado em prod**, trocando "2 mensagens" por "nenhuma", que é pior e invisível.
   ⚠️ O write-back das 2 colunas do Sheets fica **incondicional** (é idempotente; a última escrita é a
   correta) — só o aviso é condicionado. **Nada de tabela/coluna de idempotência**: o ponto de
   serialização já estava lá. Testes: corrida de 2 líderes · duplo clique · 3 retries · 2 projetos
   distintos em paralelo (guarda contra "consertar" calando tudo) · adaptador cego em 4 formatos
   (`undefined`, `{}`, não-numérico, `NaN`) · unidade do predicado.

**Fora desta fatia (de propósito):** o webhook do **widget de Ajuda**
(`GOOGLE_CHAT_WEBHOOK_URL_AJUDA`) e o próprio `sendChatNotification`; as **DMs do Gomoon** ao líder
(outro canal, outro contrato); `Status`, colunas do Sheets, `projeto_aprovacoes` e o fluxo de
decisão do líder — só o **canal Chat** mudou.
