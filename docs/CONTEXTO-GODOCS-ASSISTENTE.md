# GoDocs — Contexto operacional completo

> **Para quem é este documento:** um assistente/agente autônomo capaz de **operar o navegador por cliques**, como uma pessoa real, dentro da plataforma **GoDocs** do Gogroup.
> Ele descreve **o que o GoDocs é**, **o que existe hoje na plataforma** e, principalmente, **como submeter e conduzir um projeto ponta a ponta pela interface** — telas, campos, rótulos exatos de botão, validações, travas e o que fazer quando cada uma delas dispara.
>
> Última revisão do conteúdo: **01/09/2026**. Ambiente descrito: **produção** (`https://godocs.devgogroup.com/`).

---

## 1. O que é o GoDocs

O GoDocs é o **hub interno do Gogroup para documentar projetos de automação (RPA & IA)**.

Um funcionário que construiu uma automação entra no GoDocs e **submete o projeto**. A submissão produz duas coisas:

1. **Documentação técnica** do projeto (gerada por IA a partir dos arquivos/código enviados);
2. **Memorial de impacto financeiro** — quanto o projeto economiza (*saving*) e/ou quanto gera de receita, com o racional de como se chegou ao número.

Esses dados vão para o SQLite da aplicação e são sincronizados com uma **planilha do Google Sheets** (a fonte de verdade da gestão) e com um **grupo do Google Chat** (notificação). Um time interno (**equipe RPA**) faz a triagem, e o **líder direto** do autor dá um parecer prévio.

### A premissa nº 1 (a regra que mais barra gente)

O GoDocs documenta **ganho já realizado e medido**, de automação **já em produção**.

- ✅ Entra: automação **rodando hoje**, com ganho **já medido**.
- ❌ Não entra: ideia, projeto em construção, ou ganho **estimado para o futuro** (projeção).

Isso é cobrado em três lugares diferentes: na Etapa 1 (“este projeto já está em produção?”), por um gate determinístico dentro do chat (**ganho real × projetado**) e na triagem humana. Um agente que tentar submeter uma projeção **vai ser bloqueado no meio do chat** e perderá o trabalho.

### A régua de elegibilidade (“isto é projeto?”)

Três perguntas — a tela de apresentação as exibe antes do formulário:

| Eixo | Pergunta |
|---|---|
| **Recorrência** | Roda de novo sem alguém pedir — agendado, por evento ou em uso contínuo? |
| **Contrafactual** | Se desligar hoje, quem reclama e o que piora? |
| **Rastreabilidade** | Qual indicador se move e onde isso é conferido? (nomear relatório, painel, sistema ou base) |

O impacto **não precisa ser receita**: vale horas, custo, erro, retrabalho, fraude/risco ou prazo. Não saber uma delas não trava a submissão — o agente ajuda a montar a resposta e o que ficar em aberto vai para a revisão humana.

---

## 2. Acesso, identidade e permissões

- **URL de produção:** `https://godocs.devgogroup.com/`
- **Autenticação:** OAuth Google **no edge da plataforma (GoDeploy)** — *todas* as rotas exigem login, inclusive as de API. Não existe área pública. Se a sessão cair, a navegação volta para a tela de login do Google.
- **Identidade é automática:** o formulário **não pergunta nome nem e-mail**. Eles vêm da conta logada e aparecem como “Submetendo como …” (somente leitura) na Etapa 1. **O dono do projeto é sempre a conta logada** — não há como submeter “em nome de” outra pessoa pela interface.
- **Domínios aceitos** (para participantes): `@gocase`, `@gobeaute`, `@gogroup` (`.com` ou `.com.br`). Qualquer outro e-mail é recusado na validação da Etapa 1.

### Papéis de quem usa a plataforma

| Papel | O que vê / pode fazer |
|---|---|
| **Autor (dono)** | Submete, edita e reenvia o próprio projeto; delega edição; descontinua |
| **Participante** | Vê o projeto em modo leitura (`/projeto/<id>`); **não edita**, a menos que receba delegação |
| **Editor delegado** | Participante a quem o dono deu poder de editar/reenviar |
| **Líder direto** | Recebe a fila de **pré-aprovação** (`/aprovacoes`) dos liderados e dá parecer; lê o projeto, nunca edita |
| **Admin (equipe RPA)** | Triagem, dashboards, investigador, e-mails, FAQ, notas de especiais |

⚠️ **Ser participante vence o override de admin**: um admin que também é participante de um projeto **não** pode editá-lo.

### Isenção por cargo (fluxo direto de liderança)

Quem tem cargo de **coordenador para cima** (coordenador, gerente, head, diretor, superintendente, presidente, sócio, C-level — **supervisor não conta**) é **isento da pré-aprovação** e submete por um **fluxo direto, sem o agente conversacional**: a documentação é gerada em uma passada e o memorial é preenchido por **formulário determinístico, sem gates**. A permissão é reconferida no servidor pela Team Guide — o cliente sozinho não libera.

---

## 3. Mapa de telas (URLs)

### Do usuário comum

| URL | Tela | Para que serve |
|---|---|---|
| `/` | **Home** | Hub de ações: “Submeter projeto”, “Meus Projetos”, “Pré-aprovações do meu time” (só líder), “Perguntas frequentes”, “Área Admin” (só admin) |
| `/submeter` | **Formulário de submissão** | O fluxo principal, em 3 etapas + sub-etapa 2.5 |
| `/submeter?retomar=<id>` | Retomada | Reabre uma submissão em andamento (cross-device) |
| `/meus-projetos` | **Meus Projetos** | Lista com 4 filtros: Todos · Meus · Participo · Rascunhos. Ações por card |
| `/editar/<id>` | **Edição/reenvio** | Mesmo formulário, pré-preenchido. Quem não pode editar é redirecionado para `/projeto/<id>` |
| `/projeto/<id>` | **Ficha somente leitura** | Documentação + memorial **sem R$ de saving** |
| `/aprovacoes` | **Fila do líder** | Um projeto por vez, checklist de 3 perguntas + veredito |
| `/faq` e `/faq/<assunto>` | **FAQ** | Todo logado lê; admin edita inline |

### Do admin (equipe RPA)

| URL | Tela |
|---|---|
| `/dashboard` | **Triagem** — a linha da planilha por projeto, busca, filas de status, filtros que somam, ficha de detalhe, mudança de status e nota em estrelas |
| `/especiais` | **Comparador de projetos especiais** por nível de estrelas, com projeto-âncora por nível |
| `/aprovacoes-pendentes` | Painel de pré-aprovações pendentes, por autor |
| `/investigador` | Observabilidade: Submetidos · Edições · Abandonados · Pré-aprovação; timeline de cada submissão |
| `/areas` · `/usuarios` | Cadastro de áreas (sync Team Guide) e de admins |
| `/email-legados` | Disparo de e-mails em 3 segmentos (legado · reenvio · todos) |
| `/fluxos` | **Sandbox**: abre o formulário REAL em modo demonstração, sem tocar servidor/banco/planilha — ideal para o bot **treinar cliques com segurança** |
| `/testes` | Painel interno de testes de prompt/chat |

---

## 4. O que é “um projeto” no GoDocs — tipos e ciclo de vida

### 4.1 Tipos de projeto

Escolhidos na **Etapa 2.5**:

| Tipo | Significado | Consequência no fluxo |
|---|---|---|
| **Saving operacional** | Economia: horas humanas deixaram de ser gastas e/ou um gasto externo parou de ser pago | Passa pelo formulário de saving + memorial de saving |
| **Receita incremental** | O projeto faz entrar dinheiro que antes não entrava | Passa pelo formulário de receita + memorial de receita |
| **Ambos** | Saving **e** receita | Faz as duas fases, em sequência |
| **Especial** | Altíssimo impacto **sem** mensuração objetiva de saving/receita | **Pula todo o memorial financeiro**; vai direto para revisão final e recebe validação humana rigorosa (e nota em estrelas 0–10) |

### 4.2 Status de um projeto

Rótulos que aparecem nos cards e na coluna “Status” da planilha:

| Status | Significado |
|---|---|
| **Rascunho** | Nunca submetido; só existe internamente (não vai à planilha) |
| **Pendente** | Submetido, esperando triagem. ⚠️ **Hoje quase tudo fica “Pendente”** — há uma regra temporária que grava “Pendente” para todos na planilha enquanto o formulário está em validação |
| **Em análise / Em validação** | Alguém da triagem está olhando |
| **Aprovado** / **Validado** | Aceito |
| **Reenvio Pendente** | A triagem pediu correção — o autor deve editar e reenviar |
| **Reprovado** | Recusado de vez (com “Motivo Reprovado” visível ao autor) |
| **Descontinuado** | A automação não roda mais (marcado pelo próprio dono; deixa de contar como pendência) |

Em paralelo existe o **pré-status do líder**: `Pré-pendente` · `Pré-aprovado` · `Ajuste pedido` · `Pré-reprovado` · `Pré-aprovado (liderança)` (isento por cargo) · `Dispensado` (o analisador reprovou por critério antes de o líder olhar).

### 4.3 O que existe hoje na plataforma (ordem de grandeza)

- **~640 projetos** na planilha de produção (medição de 17/08/2026), entre submissões novas pelo app e **legados** importados da planilha antiga.
- **Legados** têm ID no formato `LEGADO-###` e a coluna “Atualizado Em” vazia — eles precisam ser **regularizados** (editados e reenviados pelo dono). O card mostra aviso âmbar com prazo.
- Projetos submetidos pelo app têm ID hexadecimal aleatório.
- Áreas cadastradas (~39): AZ, B2B Gobeauté, B2B Gocase, Contabilidade, CSC, CX, CX - Agentes, Dados, Departamento Pessoal, E-commerce, Facilities, Financeiro, Fiscal, FP&A, Gente e Gestão, Growth, Ilustração, Jurídico, Logística, M&A, Marketing de Influência, Offline (Administrativo/Lojas), Operações Gobeauté, Operações Gocase, Transportes, Qualidade, Manutenção, Expedição, Almoxarifado, Produção, Produto Gobeauté, Produto Gocase, Projetos e Integrações, RPA, Marketing - Branding, Sourcing & Procurement, Supply Gogroup, Tecnologia. A área do projeto é **derivada do e-mail do autor** via Team Guide.

### 4.4 Regra temporária ativa — janela de bloqueio de submissões

Houve uma **pausa de submissões NOVAS** entre **25/08 23h59 BRT e 01/09 00h00 BRT**. Nessa janela a home e a tela de apresentação exibiam a faixa “Submissão não permitida neste momento” e o botão ficava desabilitado; **reenvio/edição e triagem continuaram funcionando**.

➡️ **A janela terminou em 01/09/2026 00h00 BRT.** Se o bot encontrar essa faixa, é sinal de que a janela foi **reaberta/movida** por configuração — não insista: não há caminho alternativo pela interface. Relate ao humano.

---

## 5. O fluxo de submissão, passo a passo (o roteiro do bot)

Wizard de **3 etapas** (`Envio` → `Projeto` → `Agente`) com uma **sub-etapa 2.5** entre a 2 e a 3.

### 5.0 Tela de apresentação (“Antes de começar”)

Aparece **sempre** ao abrir `/submeter` do zero (não aparece em edição, em `?retomar=` nem quando há rascunho local salvo). Traz o que é o GoDocs, a régua de elegibilidade e as 3 etapas.

**Ação:** clicar em **“Ok, entendi”**.

---

### 5.1 Etapa 1 — Envio (dados do responsável e do time)

Blocos e campos:

| Campo | Tipo | Regra |
|---|---|---|
| **Submetendo como** | leitura | Nome + e-mail da conta logada. Se aparecer “Não foi possível identificar sua conta”, **pare e recarregue** — sem isso nada avança |
| **Esta solução é interna ou externa?** | 2 opções | **Interna** = construída com recursos próprios (Claude, Python, n8n…). **Externa** = usa serviço de terceiro com custo recorrente (o custo entra no cálculo do saving líquido) |
| **Este projeto já está em produção?** (interna) / **Essa ferramenta externa já está em uso?** (externa) | 3 opções | `🟢 Sim, já está em produção e sendo utilizado` · `🔧 Não, ainda está sendo desenvolvido` · `⏸️ Está pronto, mas ainda não é utilizado` |
| **Ferramentas utilizadas para construir o projeto** (só interna) | **multi-seleção**, grade 3×3 | `Claude AI` · `Claude Cowork` · `Claude Code` · `Python` · `n8n` · `GoDeploy` · `Apps Script` · `Vercel` · `Outros` |
| **Especifique a ferramenta** | texto | Obrigatório se marcou “Outros”. Limite dinâmico (o total gravado cabe em 200 caracteres) |
| **Nome do serviço externo** (só externa) | texto | Obrigatório |
| **Projeto desenvolvido em equipe?** | 2 opções | `👥 Sim, em equipe` / não |
| **Participantes** | autocomplete Team Guide | Só e-mails dos domínios permitidos |
| **Papel de cada participante** | select | `Coautor` (executou e esteve à frente — **máximo 1 por projeto**) · `Participante` (apoiou com entregas concretas) · `Contribuidor` (planejamento/decisões/ideias, sem execução) |
| **“O que essa pessoa fez?”** | texto por participante | **20 a 100 caracteres, obrigatório**. Não pode ser a descrição do papel copiada da legenda |

**Travas desta etapa (mensagens que o bot pode encontrar):**

- `Selecione se a solução é interna ou externa`
- `Apenas projetos em produção podem ser submetidos` / `Apenas ferramentas externas já em uso podem ser submetidas` → **é a premissa nº 1; não há como contornar**
- `Selecione ao menos uma ferramenta` · `Especifique a ferramenta utilizada`
- `Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos`
- `Escolha o papel de cada participante`
- `Só é possível ter 1 Coautor por projeto — deixe os demais como Participante ou Contribuidor`
- `Descreva o que <e-mail> fez no projeto (mínimo 20 caracteres)`
- `A descrição de <e-mail> só repete o texto do papel — conte o que essa pessoa fez de fato no projeto`

> **Na edição** (`/editar/<id>`) os dados do projeto ficam **somente leitura** e o foco é ajustar ferramenta, participantes, papéis e contribuições.

---

### 5.2 Etapa 2 — Dados do Projeto

| Campo | Regra |
|---|---|
| **Nome do Projeto** | mínimo 3 caracteres. Nome duplicado (mesmo nome, não-rascunho) é bloqueado no envio |
| **Data de Criação do Projeto** | calendário próprio (não é `input type=date`). Mínimo `01/01/2024`, **não pode ser futuro** |
| **Contexto de Negócio** | **mínimo 60 caracteres** |
| **Este projeto usa o AI Proxy?** | sim/não. (AI Proxy = gateway interno de IA, `ai-proxy.gogroupbr.com`. A resposta é cruzada com auto-detecção na documentação; divergência vira só observação, não muda status) |
| **Se desligar isso hoje, quem reclama?** | escolha `👤 Pessoas específicas` **ou** `👥 Um time/área inteiro`, e selecione ao menos um da Team Guide. **Obrigatório** |
| **Arquivos do Projeto** | **obrigatório ao menos 1**. Arraste, `📄 Selecionar arquivos` ou `📁 Selecionar pasta` (sobe a pasta inteira, com subpastas) |

**Sobre os arquivos** — é o insumo da documentação gerada por IA:

- Extensões aceitas: `.pdf .docx .doc .txt .md` + código/config `.json .ts .tsx .js .jsx .py .sql .sh .yaml .yml .toml .css .html`. `.zip` é aceito e descompactado no cliente.
- **10 MB por arquivo**; sem limite prático de quantidade.
- O limite real é **~200 mil tokens de conteúdo** (uma barra avisa: alerta em ~600 mil caracteres, bloqueio em ~800 mil). Se estourar, remova pastas/arquivos desnecessários (`Remover pasta inteira`).
- Assim que o primeiro arquivo entra, o app começa a **analisar a documentação em segundo plano** (“Analisando a documentação em segundo plano — pode continuar preenchendo” → “✅ Documentação analisada — pode avançar sem espera”). **Vale esperar esse ✅ antes de avançar** — economiza ~1 minuto de espera na etapa seguinte.

---

### 5.3 Etapa 2.5 — Tipo de Projeto

Pergunta: o projeto **não está diretamente ligado a ganho de receita ou redução de custos objetivamente mensuráveis**, destoando de um projeto padrão?

- **`📊 Não. É um projeto padrão…`** → escolher **Saving Operacional** e/ou **Receita Incremental** (pode marcar os dois) → segue para a Etapa 3.
- **`⭐ Sim. É um projeto de alto impacto, com difícil mensuração objetiva`** → **projeto especial**. Antes de qualquer coisa, aparecem **duas checagens em sequência**:

  1. *“Este projeto é, objetivamente (ou principalmente), um dashboard ou um painel de controle?”* — `Sim, é um dashboard ou painel` / `Não, não é um dashboard`
  2. *“O ganho principal deste projeto é prioritariamente organizacional?”* — `Sim, o ganho é organizacional` / `Não, o ganho principal é outro`

  ⚠️ **Qualquer “sim” BLOQUEIA o envio.** Um dashboard é uma *entrega* (o ganho está nas horas que ninguém gasta mais montando o relatório — mensurável pelo caminho normal); “organizar” é meio, não impacto. As saídas oferecidas são: voltar e marcar **“Não. É um projeto padrão…”** e informar o ganho, **ou** apurar o resultado e **voltar depois como projeto PADRÃO** — “especial” **não** é a porta para “ainda não tenho número”.

  Passando as duas, preenche-se **Contexto do Projeto Especial** (por que é de altíssimo impacto e por que não se encaixa em saving/receita). O especial **pula as etapas de verificação de saving e receita** e recebe **avaliação humana rigorosa**.

Botão de avanço: **“Analisar com Agente”** (fluxo normal) ou **“Continuar →”** (fluxo direto de liderança).

---

### 5.4 Etapa 3 — Agente (o chat)

É aqui que a maior parte do trabalho — e das travas — acontece. O chat tem **fases**:

```
doc → doc_preview → [compila documentação] → saving → saving_preview
    → receita → receita_preview → completo (revisão final)
```

**Mecânica da interface do chat:**

- Campo de texto (`Digite sua resposta…`), **Enter envia · Shift+Enter quebra linha**.
- Quando o agente oferece alternativas, elas aparecem como **botões clicáveis** acima do campo (“Selecione uma opção ou escreva sua resposta”). **Vários gates só saem por CLIQUE** — clicar é sempre mais confiável que digitar.
- As respostas **chegam streamando** (texto aparecendo aos poucos). Operações pesadas mostram o passo nomeado (ex.: “Compilando…”) e, no fim do memorial, o indicador **“Finalizando memorial…”** — nesse ponto o agente ainda está gerando a parte estruturada invisível; **espere o botão “Enviar para Triagem” habilitar**, não recarregue a página.
- Latência normal de um turno: **poucos segundos a ~60 s**; a compilação da documentação pode levar **~60 s**. Não interprete demora como travamento antes de ~2 minutos.
- Se algo falhar, o agente devolve uma mensagem de “instabilidade momentânea… nada se perdeu” — **basta reenviar a última mensagem**.

**Fase 1 — Documentação.** O extrator já pré-preencheu o que conseguiu ler dos arquivos; o agente pergunta **apenas o que ficou vazio** (dependências, o que configurar antes, pontos de atenção etc.). Ao fim, mostra um **preview da documentação** com **`Aprovar`** / **`Pedir ajustes`**.

**Fase 2 — Formulário determinístico de saving** (se o tipo inclui saving). Ver §6.

**Fase 3 — Chat de impacto.** O agente desafia os números, cobra o racional e roda os **gates** (§7). Ao fim entrega o **memorial** com a fala: *“**Memorial pronto!** Revise abaixo e me diga se ficou algum problema — eu ajusto. Se estiver tudo certo, é só enviar para a triagem.”* Botões **`Aprovar`** / **`Pedir ajustes`**.

**Fase 4 — Receita** (se o tipo inclui receita): formulário curto + chat + preview, mesma mecânica.

**Fase 5 — Revisão final.** Cards de *Documentação Técnica*, *Memorial de Saving* e/ou *Memorial de Receita*, cabeçalho **“Tudo pronto! Revise os documentos abaixo antes de enviar”** e o botão final **`Enviar para Triagem`**.
No card do memorial financeiro há **`Refazer`**, que reabre o formulário de saving/receita pré-preenchido **sem tocar na documentação**.

---

## 6. O formulário determinístico de saving e de receita

É um formulário, não chat — e sua estrutura é uma **árvore de decisão** que existe para evitar **dupla contagem**.

### 6.1 “Alguém já fazia ou mantinha isso manualmente antes?”

**Ramo A — Sim.**
- Tabela de linhas: **Selecione a função…** (cargo) + **Horas antes** + **Horas depois** (`Adicionar função` para mais linhas). Se ninguém precisa atuar depois, “horas depois” = 0.
- Pergunta adicional: *“Além das horas, a empresa deixou de pagar algum gasto em dinheiro?”* → se sim, lista de **custo evitado**. ⚠️ Só conta se for **distinto** do trabalho já contado nas horas; se o que parou de ser pago é justamente esse trabalho, responda **não**.

**Ramo B — Não.** → *“Por causa desta automação, a empresa deixou de pagar algum gasto?”*
- **Sim** → cadastra o **gasto eliminado** (`Gasto eliminado`, `Valor (R$)`, recorrência, justificativa; `Adicionar outro gasto`). Depois vem a pergunta 2c: *“Além desse gasto eliminado, a automação substitui um trabalho manual ADICIONAL — que ninguém fazia e que esse gasto NÃO cobria?”*
  - **Não** → **custo evitado puro** (0 horas).
  - **Sim** → custo evitado **+** horas contrafactuais distintas.
  - Há um link **“Em dúvida? Veja como saber se é o seu caso”** que abre um modal com 2 exemplos do que **não** conta e 2 do que conta.
- **Não** → *“e se alguém tivesse que fazer?”* → horas **contrafactuais** (horas antes estimadas, horas depois = 0).

**Sempre presentes:**
- **Recorrência do saving**: `mensal` · `pontual` · `trimestral` · `semestral`.
- *“A solução usa algum serviço externo pago para funcionar?”* → **custo do projeto** (chave de API, ElevenLabs, SaaS por uso). Esse valor **subtrai** do ganho. Não confundir com ferramenta evitada (que soma) nem com custo de solução externa.
- **Custo da ferramenta externa** (quando o escopo é externo): abatido para calcular o ganho líquido.

Botão: **`Iniciar análise`**.

### 6.2 Receita

- **Ganho de receita estimado** (R$).
- **Racional** em uma frase (“de onde vem essa receita”, ex.: *“as estampas com IA vendem esse valor por mês”*). O agente aprofunda a partir daí.

### 6.3 As contas que o sistema faz (o bot precisa entender, não calcular)

- **Fonte de verdade do saving são as HORAS das linhas** (cargo + horas antes/depois), nunca o texto do memorial. Multiplicadores (×lojas, ×pessoas) precisam entrar **dentro das linhas**, não só na prosa.
- **Custo evitado SOMA** ao ganho; **custo do projeto e custo externo SUBTRAEM**.
- Valores **pontuais entram pelo valor cheio** (sem dividir por 12). Custo externo marcado como **anual** é convertido ÷12. Trimestral/semestral entram pelo valor **cheio do período**.
- **Ganho total mensal = saving + (receita ÷ 10)** — regra de negócio, não soma simples.
- O **R$ por hora de cargo nunca é exibido ao submissor**; ele vê horas, e o valor entra no memorial de cálculo interno.
- Para submeter com saving, o **ganho líquido precisa ser > 0** (exceção: custo evitado puro).

---

## 7. Os gates determinísticos do chat (o que vai barrar o bot)

Estes **não são o LLM sendo chato** — são travas de código. Cada um faz **no máximo 1 ou 2 perguntas**, sai por **clique** e nunca entra em loop. Responder bem aqui é a diferença entre uma submissão que fecha em 10 minutos e uma que morre.

| # | Gate | Quando dispara | Pergunta / opções | Como sair |
|---|---|---|---|---|
| 1 | **Ganho real × projetado** | Alguma pista de projeção no texto (“projeção”, “expectativa”, “premissa”, “potencial”, “não foi medido”…) | `Já acontece hoje e o ganho foi medido` / `Ainda é expectativa — não foi medido` | Clicar na 1ª **só se for verdade**. A 2ª **bloqueia o preview** e oferece: voltar quando medido, ou marcar especial na Etapa 2 |
| 2 | **Jornada / base de horas** | Saving mensal com horas reais, antes do preview | *“a base padrão é 220h úteis/mês… alguém de fato trabalha ou usa esse processo nos fins de semana (uma pessoa, não a automação sozinha)?”* → `Não, só em dias úteis` / `Sim, há trabalho/uso humano no fim de semana` | Responder honestamente; fim de semana eleva o teto até ~300h |
| 3 | **Teto por pessoa (220h)** | Uma linha com horas acima do teto | *“esse total é de uma pessoa só ou representa várias pessoas/unidades?”* → `É uma pessoa só (vou corrigir as horas)` / `Representa várias pessoas/unidades` | Se for múltiplo, informar o número de pessoas/unidades; se for uma pessoa, corrigir para ≤ teto |
| 4 | **Alocação de ganhos (economia alta ≥ 44h/mês)** | Saving mensal total **ou** de um cargo ≥ 44h | *“pra onde foi esse tempo?”* — exige destino **concreto e nomeado** | Encaixar em **um** dos 5 destinos: **mais entrega · menos custo · menos erro/retrabalho · menos risco/fraude · menos prazo**. ❌ “ganhou produtividade”, “sobra tempo”, “foi para outras atividades” **são recusados** |
| 5 | **Critério `[1.3]/[1.4]`** | Falta “processo alterado” e/ou “ponteiro movido e onde verificar” | Quando só falta o ponteiro, vêm botões: `Custo (horas, headcount, contrato)` · `Receita (vendas, ticket, pedidos)` · `KPI da área (erro, retrabalho, prazo, risco)` · `Ainda não sei dizer` | Nomear o indicador **e onde se confere** (relatório, painel, sistema, base). “Ainda não sei dizer” é aceito e vai para revisão humana |
| 6 | **Custo evitado citado no chat** | Um valor em R$ aparece na conversa junto de vocabulário de gasto | `É gasto real — a empresa paga (ou pagava) isso e dá para conferir` / `É uma estimativa do que aconteceria` | ⚠️ Se for real, **o valor precisa ser cadastrado no campo de custo evitado do FORMULÁRIO** — valor citado só no chat **não é gravado** |
| 7 | **Sobreposição receita × custo evitado** | O mesmo dinheiro aparece nos dois lados | `São valores diferentes — pode seguir com a receita` / `É o mesmo dinheiro — quero corrigir` | Se for o mesmo dinheiro, voltar ao saving e remover o item |
| 8 | **Composição das horas** | Total de um cargo sem quebra | Exige quebra por atividade que **some** o total (ex.: “160h = at-x 4h + at-y 10h + at-z 146h”) | Fornecer a decomposição |

Além desses, o agente pode perguntar **uma vez** (sem gate, aceita discordância e nunca repete) sobre o **split carga real × ganho por escala**: quanto do total era trabalho humano que de fato acontecia e quanto é volume que só a automação cobre. O total continua virando R$ igual — é só transparência.

---

## 8. O que acontece depois do “Enviar para Triagem”

1. **Verificação de duplicata** (mesmo nome de projeto já submetido) — bloqueia com mensagem.
2. **Gravação** no banco + **sincronização com o Google Sheets** (linha nova, ou update in-place se for edição).
3. **Abertura da fila do líder** (pré-aprovação), salvo se o autor for isento por cargo, ou o projeto for especial.
4. **Aviso ao líder** por DM no Google Chat (entregue pelo bot do Gomoon), com link para `/aprovacoes`.
5. **Analisador IA em background**: complexidade, observações e classificação de critério (`claro_sim` · `zona_cinzenta` · `claro_nao`). `claro_nao` grava **“Reprovado”** e dispensa a fila do líder. Projeto **especial** e projeto de **líder** nunca são auto-reprovados.
6. **Notificação no grupo do Google Chat** quando o líder **pré-aprova** (com link direto para a ficha no `/dashboard`). Fila aberta não avisa; “ajuste”/“reprovado” não avisam.
7. **Triagem humana da RPA** no `/dashboard`: muda status, escreve observações/motivos, dá nota em **estrelas (0–10)**.

### Mensagens de bloqueio no envio (e o que fazer)

Toda mensagem de bloqueio diz o que aconteceu, **por que com os números do projeto** e termina em “Para corrigir…”. As mais comuns:

- **Saving sem ganho líquido** — as horas economizadas não cobrem o custo da ferramenta/do projeto declarado. Caminhos: conferir **valor e periodicidade** (o total do ano marcado como mensal é a pegadinha clássica), cadastrar o gasto eliminado em **custo evitado**, ou marcar como **especial**.
- **Receita zerada ou incompleta.**
- **Documentação ausente.**
- **Nome de projeto duplicado.**
- **Especial desqualificado** (dashboard/ganho organizacional).

O toast dura ~20 s e traz a orientação inteira — **leia antes de tentar de novo**.

---

## 9. Gerenciar projetos já enviados (`/meus-projetos`)

Filtros: **Todos · Meus · Participo · Rascunhos**. Cada card traz nome, status, badges e ações:

| Ação | Rótulo / botão | Quem pode |
|---|---|---|
| Editar e reenviar | **Editar** (leva a `/editar/<id>`) | dono, editor delegado, admin não-participante |
| Ver em leitura | abre `/projeto/<id>` | participante, líder |
| Delegar edição | **Quem pode editar** → modal “Distribuir o poder de edição” | dono ou delegado |
| Descontinuar | **Descontinuar projeto** (confirma) / **Reativar projeto** | quem pode editar |
| Excluir rascunho | **Excluir rascunho** | dono |

**Avisos que podem aparecer no card** (com “Ver motivo” / “Ver o que ajustar”):
1. **Regularização de legado** (âmbar) — projeto antigo sem “Atualizado Em”: basta **editar e salvar**.
2. **Reenvio solicitado** (vermelho) — status `Reenvio Pendente`: **corrigir e reenviar**.
3. **Projeto reprovado** (cinza) — com o motivo escrito pela triagem.

> **Reenviar = abrir `/editar/<id>`, ajustar e ir até “Enviar para Triagem” de novo.** Reenvio **reabre a fila do líder** e **reativa** um projeto descontinuado.

---

## 10. A fila do líder (`/aprovacoes`)

Slider de **um projeto por vez** (“3 de 12”, com um traço por projeto no topo; setas ←/→ navegam fora dos campos de texto). O card é auto-suficiente: dono, participantes com papel, saving **com R$** (exceção consciente — o gestor precisa do valor) e memorial expansível. Reenvio de projeto já visto aparece num **card de edição** com “O que mudou” (antes → agora).

**Antes de decidir, 3 perguntas sim/não obrigatórias:**

1. **O projeto move algum KPI da área?** *(vale qualquer indicador acompanhado: horas, custo, erro, prazo, risco…)*
2. **Se este projeto fosse desligado hoje, a área sentiria falta?**
3. **O saving declarado é coerente com o impacto que você vê na área?**

**Vereditos:** `Pré-aprovar` · `Pedir ajuste` · `Reprovar`.

Regras: qualquer **“não”** + “Pré-aprovar” **exige uma explicação escrita**; reprovar **exige comentário**; “saving não confere” **bloqueia** a pré-aprovação (o projeto volta ao autor). Pessoa com dois líderes gera duas linhas — **o primeiro que decide resolve para todos**.

---

## 11. Vocabulário essencial (glossário operacional)

| Termo | Significado |
|---|---|
| **Saving** | Economia: horas humanas + gastos que pararam de ser pagos, menos custos incorridos |
| **Receita incremental** | Dinheiro novo que o projeto faz entrar |
| **Custo evitado** | Gasto que a empresa **pagava e parou de pagar** por causa da automação (contrato, licença, terceiro, taxa, multa, juros — o **nome não importa**, a régua é “pagava e parou”). **Soma** |
| **Custo do projeto** | Serviço pago que a automação **consome para rodar** (API, SaaS por uso). **Subtrai** |
| **Custo externo** | Ferramenta de terceiro que **é** a solução (escopo externo). **Subtrai** |
| **Contrafactual** | “Ninguém fazia, mas se alguém tivesse que fazer, seriam X horas” — saving legítimo |
| **Custo evitado puro** | Ganho 100% de gasto externo eliminado, **sem horas** |
| **Memorial** | O texto que explica o cálculo do impacto, com seções fixas (contexto, saving por cargo, contratos evitados, custo da automação, resumo / seção de receita) |
| **Ponteiro movido** | Qual indicador mudou **e onde se confere** |
| **Projeto especial** | Alto impacto sem mensuração objetiva — pula o memorial financeiro, recebe nota em estrelas |
| **Legado** | Projeto importado da planilha antiga (`LEGADO-###`), pendente de regularização |
| **Pré-aprovação** | Parecer do líder direto, **antes** da triagem da RPA. Não é aprovação final |
| **Triagem** | A validação da equipe RPA no `/dashboard` — a palavra final |

---

## 12. Guia prático para o bot que opera por cliques

**Antes de tudo**
1. Treine e valide o roteiro em **`/fluxos`** (sandbox) — abre o formulário real em modo demonstração, **sem tocar servidor, banco ou planilha**. É o lugar certo para aprender a UI.
2. Garanta a sessão Google ativa; sem login, toda navegação vira redirect.

**Durante o preenchimento**
3. Tenha os insumos **antes de começar**: arquivos/pasta do projeto, nome, data de criação, contexto de negócio (≥60 caracteres), quem sentiria falta, participantes com papel e o que cada um fez (20–100 caracteres), horas por cargo antes/depois, valores de custo evitado e de custo do projeto com justificativa.
4. **Anexe os arquivos cedo** e espere “✅ Documentação analisada — pode avançar sem espera”.
5. **Prefira clicar nos botões de opção** a digitar — os gates saem por clique com interpretação garantida.
6. **Não recarregue a página durante o chat.** Rascunho e conversa são salvos localmente e a submissão retoma o mesmo projeto, mas recarregar no meio de um turno faz perder tempo. Se precisar retomar de outro dispositivo, use `/submeter?retomar=<id>`.
7. **Espere.** Turnos do agente levam segundos a ~60 s; a compilação da documentação, ~1 min. Só considere travado após ~2 min sem nenhum sinal (sem streaming, sem loader).
8. Se aparecer a faixa **“Nova versão disponível”**, recarregue **entre etapas**, nunca no meio de um turno.

**Sobre honestidade dos dados** *(isto não é preferência, é o produto)*
9. Nunca marcar “já está em produção” para um projeto que não está, nem “o ganho foi medido” para uma projeção. Os gates existem exatamente para isso, a triagem humana confere e um número falso na planilha é o pior resultado possível.
10. Nunca contar o **mesmo dinheiro duas vezes** (horas × contrato; custo evitado × receita). Na dúvida em “trabalho manual adicional”, responda **Não** — é a saída conservadora.
11. Valor de custo evitado **precisa** estar cadastrado no campo do formulário; citar no chat **não grava**.

**O que o bot NÃO deve fazer**
12. Não operar telas de **admin** (`/dashboard`, `/especiais`, `/investigador`, `/email-legados`, `/usuarios`, `/areas`) sem pedido explícito — elas **gravam de verdade** na planilha e disparam e-mails.
13. Não decidir na fila `/aprovacoes` por outra pessoa: o parecer do líder é um julgamento pessoal e fica registrado com o nome dele.
14. Não insistir contra um bloqueio (especial desqualificado, ganho projetado, saving sem ganho líquido): **não há caminho alternativo pela interface**. Relate a mensagem ao humano e proponha a correção que ela mesma indica.

---

## 13. Resumo de um roteiro completo, do zero ao envio

```
1.  Abrir https://godocs.devgogroup.com/  (login Google)
2.  Home → "Submeter projeto"
3.  Tela "Antes de começar" → "Ok, entendi"
4.  ETAPA 1: escopo (interna/externa) → "já está em produção?" = Sim
              → ferramentas (multi) → equipe? → participantes + papel + o que cada um fez
              → Avançar
5.  ETAPA 2: nome · data de criação · contexto (≥60 chars) · AI Proxy?
              → "quem reclama se desligar" (pessoas ou time)
              → anexar arquivos/pasta → esperar "✅ Documentação analisada"
              → Avançar
6.  ETAPA 2.5: "Não. É um projeto padrão…" → marcar Saving e/ou Receita
              → "Analisar com Agente"
7.  ETAPA 3 – doc: responder o que o agente perguntar → preview → "Aprovar"
8.  Formulário de saving: alguém fazia? → horas por cargo → custo evitado? → custo do projeto?
              → recorrência → "Iniciar análise"
9.  Chat de impacto: responder os gates (clique nos botões) → preview do memorial → "Aprovar"
10. (Se houver receita) formulário + chat + preview → "Aprovar"
11. Revisão final: conferir os cards → "Enviar para Triagem"
12. Acompanhar em /meus-projetos (status, avisos de reenvio, motivo de reprovação)
```

---

## 14. Onde o processo pode ser conferido depois

- **Planilha do Google Sheets** — fonte de verdade da gestão; colunas A→AV (status, saving, horas, memoriais, parecer do líder, classificação, motivos, estrelas). É o **único lugar onde se edita** o dado consolidado; o app espelha a planilha a cada 5 minutos.
- **Google Chat** — grupo de admin (avisado na pré-aprovação, com link direto para a ficha) e DM do líder (fila de pré-aprovação).
- **`/dashboard`** — a ficha completa de cada projeto para a triagem, com histórico de mudanças de status e de reenvios.
- **`/faq`** — a explicação do processo para o usuário final, mantida pelos admins.
