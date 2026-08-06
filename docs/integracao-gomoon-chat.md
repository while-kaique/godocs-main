# Integração GoDocs → Gomoon → Google Chat (pré-aprovação do líder)

Documento de contrato para o time do **Gomoon**. Descreve o que o GoDocs envia, quando
envia, e o que o Gomoon precisa provisionar para entregar a mensagem por DM no Google
Chat do Workspace da empresa.

**Versão:** 2 · **Data:** 06/08/2026 · **Responsável GoDocs:** Luis Albuquerque

> **v2 (06/08/2026)** — duas mudanças, ambas nas seções **§13** e **§14**: o **texto da DM
> passa a vir pronto de nós** no campo `mensagem.texto` (o template do Gomoon fica como
> fallback) e o **anúncio de abertura da feature** ganha **endpoint próprio**, com chave de
> idempotência **sem data**. O resto do contrato (§1–§12) não muda.

---

## 1. O que é

No GoDocs, quem submete um projeto de automação passa por uma **pré-aprovação do líder
direto**: o líder abre a tela `/aprovacoes`, responde 3 perguntas de sim/não e dá o
parecer. A relação líder↔liderado é derivada da TeamGuide pelo GoDocs.

O que falta é **avisar o líder** que há gente do time dele esperando. Esse aviso é uma
**DM no Google Chat**, e a responsabilidade de entregá-la é do **Gomoon**.

Divisão de responsabilidade:

| Quem | Faz |
|---|---|
| **GoDocs** | Descobre quem lidera quem, quem tem projeto pendente e manda a relação 1×/dia |
| **Gomoon** | Guarda numa fila, monta a mensagem, decide a hora e entrega a DM pelo bot |

O GoDocs **não** fala mais com a API do Google Chat. O Gomoon **não** precisa da
TeamGuide, do banco do GoDocs, nem decidir quem é elegível.

---

## 2. O disparo

- **1 requisição por dia**, às **09:00 (horário de Brasília)**, disparada por cron no GoDocs
  (era 06:00 na v1 do contrato — mudou porque o Gomoon entrega a DM na hora do POST; ver §12).
- O corpo é um **snapshot completo do dia**: todos os líderes que têm pendência naquele
  momento, cada um com seus liderados.
- Dia sem nenhuma pendência: a requisição **acontece igual**, com `"lideres": []`. Silêncio
  é indistinguível de cron morto — a lista vazia é a confirmação de que o run rodou.

---

## 3. Contrato

### Requisição

```http
POST https://<host-do-gomoon>/api/godocs/lideres-pendentes
Authorization: Bearer <GOMOON_TOKEN>
Content-Type: application/json
```

```json
{
  "origem": "godocs",
  "ambiente": "producao",
  "gerado_em": "2026-08-05T09:00:00Z",
  "lideres": [
    {
      "email": "lucas.queiroz@gocase.com",
      "nome": "Lucas Queiroz",
      "url": "https://godocs.devgogroup.com/aprovacoes",
      "idempotency_key": "godocs:lucas.queiroz@gocase.com:2026-08-05",
      "liderados": [
        { "nome": "Ana Souza",  "email": "ana@gocase.com",   "projetos_pendentes": 2 },
        { "nome": "Bruno Lima", "email": "bruno@gocase.com", "projetos_pendentes": 3 }
      ],
      "mensagem": { "texto": "*Você tem projeto para pré-aprovar no GoDocs* 📋\n\nOi, Lucas! …" }
    }
  ]
}
```

| Campo | Tipo | Observação |
|---|---|---|
| `ambiente` | `"producao"` \| `"staging"` | Ver §6 — staging **não** pode notificar líder real |
| `gerado_em` | ISO 8601 UTC | Instante do snapshot. Usar na mensagem (§7) |
| `lideres[].email` | string | E-mail corporativo do destinatário da DM |
| `lideres[].nome` | string \| null | Nome de exibição, quando conhecido |
| `lideres[].url` | string | Link da tela de aprovação. Ver §5 |
| `lideres[].idempotency_key` | string | `godocs:<email>:<YYYY-MM-DD>`. Ver §4 |
| `lideres[].liderados[]` | array | Só quem tem projeto pendente. Nunca vazio |
| `liderados[].projetos_pendentes` | number ≥ 1 | Quantos projetos daquela pessoa esperam parecer |
| `lideres[].mensagem.texto` | string | **A DM já redigida**, em **HTML de cartão** (`<b>`/`<i>`), sem título nem link. Ver **§13** |

O total de projetos do líder é a **soma** dos `projetos_pendentes` dos liderados dele — não
mandamos o total pré-calculado. Se a mensagem precisar dos **nomes** dos projetos, avisem:
sai da mesma consulta.

### Resposta esperada

`200` com resultado **por item**, para o GoDocs logar quem não recebeu:

```json
{
  "ok": true,
  "resultados": [
    { "email": "lucas.queiroz@gocase.com", "ok": true,  "enfileirado_em": "2026-08-05T09:00:01Z" },
    { "email": "outro@gocase.com",         "ok": false, "codigo": "usuario_desconhecido" }
  ]
}
```

Códigos de erro úteis (legíveis por máquina, não só texto): `usuario_desconhecido`,
`dm_bloqueada`, `bot_nao_instalado`, `rate_limit`, `erro_interno`.

**Timeout:** responder em **até 10s**. Se o processamento for assíncrono, devolver `202`
com os itens aceitos — o GoDocs não espera a entrega da DM, só a confirmação de que a
fila recebeu.

---

## 4. Idempotência — snapshot, não incremento

Cada POST **substitui** o estado do dia. Se o cron falhar e repetir às 06h05, o líder
**não** pode receber duas DMs.

Regra: `idempotency_key = godocs:<email>:<YYYY-MM-DD>`.

- Chave que já existe na fila e **ainda não foi entregue** → **substituir** o item (o
  conteúdo novo é mais recente).
- Chave que já foi **entregue** → ignorar (não reenviar).
- Item de um batch anterior que nunca saiu → descartar quando chega batch novo.

---

## 5. O link é o mesmo para todos — e isso é intencional

`https://godocs.devgogroup.com/aprovacoes` monta a fila a partir de **quem está logado**:
o edge do GoDeploy exige OAuth do Workspace em todas as rotas e injeta a identidade do
usuário. O link já abre "a tela dele" sem ser personalizado.

⚠️ **A URL não é credencial.** Não existe (e não vamos criar) link mágico com token que
abra a fila de outra pessoa: o único jeito de ver a fila do Lucas é estar logado como
Lucas. O campo `url` vem por líder só para o formato não mudar caso um dia precise de
sufixo de rastreio (`?src=chat`).

Consequência prática para a mensagem: o botão pode ser um `openLink` simples.

---

## 6. Ambientes

O GoDocs tem dois apps com o mesmo código: **produção** e **staging**. A staging existe
para validar antes de produção e usa **dados simulados**.

⚠️ Se o disparo da staging cair na fila de produção do Gomoon, **teste nosso vira DM para
líder de verdade**. Precisa de uma das duas coisas:

1. **Token/endpoint separado** para staging (preferido), ou
2. O Gomoon honra `ambiente: "staging"` roteando tudo para **um destinatário de teste**
   fixo, ignorando os e-mails do payload.

Projetos de teste automatizado (nome com a tag `[E2E-…]`) já são filtrados na origem e
nunca aparecem no payload.

---

## 7. A mensagem (template do Gomoon)

⚠️ **Superado em parte pela §13 (06/08/2026): o texto passa a vir PRONTO de nós, em
`mensagem.texto`, e o template do Gomoon fica como fallback.** As 3 regras abaixo continuam
valendo — agora é a nossa redação que as cumpre.

O template é do Gomoon. Três regras que pedimos que sejam respeitadas:

1. **Nada de valores em R$.** O payload não os traz — e não deve trazer. O ganho
   financeiro do projeto é informação restrita à equipe; DM se lê por cima do ombro.
2. **Mostrar a data do snapshot** (de `gerado_em`), ex.: *"situação em 05/08 às 06h"*. O
   número pode envelhecer entre o nosso disparo das 6h e a entrega: se outro líder decidir
   no meio, a tela vai mostrar menos projetos que a mensagem. Com a data ao lado isso é
   informação; sem a data, parece sistema quebrado.
3. **Texto simples além do cartão.** A notificação do celular e clientes que não renderizam
   cartão mostram só o `text` — sem ele, quem lê no celular fica sem o link.

Esqueleto sugerido (validado com o líder que usou a tela):

> **Pré-aprovação pendente**
> Você tem **5 projetos** de **2 pessoas** do seu time esperando o seu parecer.
> • Ana Souza — 2 projetos
> • Bruno Lima — 3 projetos
> São 3 perguntas de sim/não e o seu parecer. A equipe RPA valida em paralelo — nada fica
> parado esperando você.
> *Situação em 05/08 às 06h.*
> [ **Abrir a fila** ]

---

## 8. O que o Gomoon precisa provisionar

1. **Endpoint** do §3, autenticado por bearer token (o GoDocs guarda o token como secret).
2. **Fila + agendador próprios**: hora do envio, retentativa, expiração de item velho.
3. **Chat app (bot) no Google Cloud** com a Chat API ativa, nome e avatar definidos.
4. ⚠️ **DM proativa** — o item que pode travar o projeto. Um bot só consegue mandar DM para
   quem já tem conversa com ele; na prática isso exige o **Chat app instalado para toda a
   organização** pelo admin do Workspace. **Confirmar com o admin antes de escrever
   código.** (A alternativa é impersonar uma caixa real por domain-wide delegation, o que
   faz a mensagem chegar como se fosse de uma pessoa, não do bot.)
5. **Resolução e-mail → usuário do Chat.** A API aceita `users/{email}`; se o fluxo precisar
   do id numérico, é o Admin SDK Directory (`admin.directory.user.readonly`).
6. **Log de entrega** consultável, para investigar "o líder diz que não recebeu".

---

## 9. Fora de escopo nesta versão

**Decidir dentro do Chat.** O botão apenas abre a tela. Se um dia houver "Pré-aprovar" no
próprio cartão, o Gomoon precisará tratar `CARD_CLICKED` e chamar uma API do GoDocs — e o
edge do GoDeploy exige OAuth em **todas** as rotas, inclusive `/api/*`, então uma chamada
de bot não passa sem um token de bypass dedicado. É um projeto próprio, não um ajuste.

---

## 10. O que precisamos de vocês para ligar

- [ ] URL do endpoint (produção e staging)
- [ ] Token de autenticação (e como rotacioná-lo)
- [ ] Confirmação do admin do Workspace sobre a DM proativa do bot (§8.4)
- [ ] Lista final dos códigos de erro devolvidos por item
- [ ] Como consultar o log de entrega

---

## 10. Os 2 modelos de mensagem (redigidos pelo GoDocs, 05/08/2026)

Pedido do Luis para passar ao João Victor. O template continua sendo **do Gomoon** (§7) —
estes são os corpos sugeridos, já obedecendo as 3 regras acima (sem R$, com a data do
snapshot, texto simples além do cartão).

### 10.1 Abertura da feature (anúncio, uma vez, para a empresa)

```
*Novidade no GoDocs: os projetos agora passam por uma pré-aprovação do líder* 🚀

A partir de agora, todo projeto submetido no GoDocs passa por uma *pré-aprovação
do líder direto* antes de chegar à validação do time de RPA & IA.

*Como funciona*
• Você submete seu projeto no GoDocs normalmente — o formulário não mudou.
• Seu líder direto é avisado por aqui e abre a fila dele em *GoDocs → Pré-aprovações*.
• Ele confere o que você registrou e responde três perguntas rápidas: o projeto move
  um indicador da área? a área sentiria falta se ele parasse de rodar? o ganho
  declarado faz sentido?
• Ele então *pré-aprova* ou *pede um ajuste*. Se pedir ajuste, você recebe exatamente
  o que precisa corrigir e reenvia o projeto.

*O que muda para você*
• A pré-aprovação *não substitui* a validação do time de RPA & IA — ela acontece
  antes, e traz o olhar de quem conhece a rotina da área de perto.
• Quem tem cargo de coordenação para cima não passa por essa etapa: o projeto segue
  direto para a validação.

*Por que estamos fazendo isso*
Para que cada projeto chegue à validação com o aval de quem vive o processo no dia a
dia — menos retrabalho para todo mundo e um impacto declarado mais fiel à realidade
da área.

*De onde vem a relação de líder e liderado*
A dupla líder ↔ liderado é lida direto do organograma da TeamGuide — o GoDocs não tem
uma lista própria. Se o seu líder aparecer errado, ou se você achar que não deveria
estar na lista de alguém, a correção precisa acontecer lá: fale com
<QUEM MANTÉM O ORGANOGRAMA> e, uma vez ajustado, as próximas submissões já saem com a
hierarquia certa.

Dúvidas? É só chamar o time de RPA & IA ou usar o botão de ajuda dentro do GoDocs.
```

⚠️ O texto reflete a **D20**: a isenção é por CARGO (coordenação para cima) — se a régua
mudar, esta mensagem muda junto.
⚠️ **`<QUEM MANTÉM O ORGANOGRAMA>` é um espaço a preencher** — não sabemos quem faz a
correção na TeamGuide (Gente e Gestão? o próprio líder?). O Luis define antes de enviar.
⚠️ A promessa é **"as próximas submissões"**, não correção retroativa: fila já aberta
mantém o líder antigo, porque as linhas de `projeto_aprovacoes` nascem na submissão.
⚠️ **A frase do "pede um ajuste" promete demais — verificado no código em 05/08/2026
(`src/routes/meus-projetos.tsx:767-784`).** O autor **vê** o selo *"Ajuste pedido pelo
líder"* + o texto do líder no **card de "Meus Projetos"** — mas **ninguém o avisa** (não
há DM nem e-mail; pendência aberta desde 03/08) e a tela de detalhe `/projeto/$id`
**não** mostra o parecer. Trocar "você recebe exatamente o que precisa corrigir" por:
_"Se pedir ajuste, o que precisa ser corrigido fica visível no seu projeto em *GoDocs →
Meus Projetos*, e é só ajustar e reenviar."_ **Pendente do Luis** (proposto, não aplicado).
Se quisermos avisar o autor de verdade, cabe no mesmo payload diário do Gomoon (uma lista
de autores com ajuste pedido) — não existe hoje.

### 10.2 Projeto pendente de pré-aprovação (recorrente, bot → líder)

Campos entre `{{ }}` são os do payload da §3.

```
*Você tem projeto para pré-aprovar no GoDocs* 📋

Oi, {{lideres[].nome}}! {{total}} projetos da sua equipe estão aguardando a sua
pré-aprovação:

• {{liderados[].nome}} — {{liderados[].projetos_pendentes}} projeto(s)
• {{liderados[].nome}} — {{liderados[].projetos_pendentes}} projeto(s)

São três perguntas rápidas por projeto, e você pode *pré-aprovar* ou *pedir ajuste*
na própria tela.

👉 {{lideres[].url}}

_Situação em {{gerado_em → DD/MM}} às 09h. Se você já decidiu depois disso, pode
ignorar esta mensagem._
```

Variações: **1 projeto só** → *"Você tem *1 projeto* da {{nome}} aguardando a sua
pré-aprovação"*, sem bullets; **1 liderado com vários** → mesma coisa, sem bullets.
⚠️ `{{total}}` é a **soma** dos `projetos_pendentes` — o payload não manda o total pronto.

---

## 11. A API do Gomoon JÁ EXISTE (recebido do João Victor em 05/08/2026)

Documento original: `C:\Users\Notebook\Downloads\Integração GoDocs → Gomoon → Google
Chat — como consumir a API.md` (fora do repo). O que ele fixa:

| Item | Valor |
|---|---|
| Endpoint | `POST https://gomoon.gogroupbr.com/api/godocs/lideres-pendentes` — **um só para os 2 ambientes** |
| Auth | `Authorization: Bearer <token>` |
| Erros | **400** na requisição inteira (JSON inválido, origem ≠ `godocs`, ambiente inválido, `gerado_em` não parseável, `lideres` não-array) · **401** token ausente/errado |
| Auditoria | o MESMO endpoint responde a **GET** com o mesmo token: últimos 50 itens, aceita `?email=` — é a resposta ao "o líder diz que não recebeu" (§8.6) |
| Staging | ele oferece **token separado** que força modo de teste no servidor, independente do payload (torna impossível a staging cutucar líder real) — **basta pedir** |
| Fora de escopo | decidir dentro do Chat (§9): o botão só abre a tela |

---

## 12. O nosso lado — IMPLEMENTADO (05/08/2026)

| Peça | Onde |
|---|---|
| Agregada da relação | `getPendenciasPorLider()` (`src/integrations/db/client.server.ts`) |
| Montagem do payload (PURA) | `montarPayloadLideresPendentes()` (`src/lib/gomoon-lideres.functions.ts`) |
| **Redação das 2 mensagens (PURA)** | **`src/lib/gomoon-mensagens.ts`** — ver §13/§14 |
| Envio | `notificarLideresPendentes()` — mesmo arquivo do payload |
| Cron | `POST /api/cron/notificar-lideres` (header `x-godeploy-cron`) |
| Manual (admin) | `POST /api/admin/notificar-lideres` — `{"dry":true}` monta e **não envia** |
| **Anúncio (uma vez)** | `anunciarPreAprovacao()` + `POST /api/admin/anunciar-pre-aprovacao` (**dry por default**) |
| Testes | `tests/gomoon-lideres.test.ts` · `tests/gomoon-mensagens.test.ts` · `tests/gomoon-pendencias-sql.test.ts` |

**Horário: 09:00 BRT** (decisão do Luis, 05/08/2026 — o João sugeriu 09h–10h porque a DM
sai na hora do POST e às 6h o líder recebia notificação de madrugada). O cron do Godeploy
é **UTC**: `0 12 * * 1-5`.

**Secrets** (Godeploy): `GOMOON_TOKEN` (obrigatório — sem ele o run não envia e diz por
quê), `GOMOON_LIDERES_URL` e `GOMOON_ANUNCIO_URL` (opcionais; os defaults já são as URLs de
produção do §11/§14). Setados
na **staging** (`edf400b4`) e no `.env` local em 05/08/2026; **faltam na produção**
(`674a3710`) — entram junto com o deploy de prod da feature.

⚠️ **`APP_BASE_URL` NÃO é uma origem limpa** — na staging ela vale
`https://godocs-staging.devgogroup.com/**meus-projetos**` (o disparo de e-mails usa o
link inteiro). Concatenar `/aprovacoes` nela gerava `…/meus-projetos/aprovacoes`, rota que
não existe: o líder cairia num 404 vindo da DM. O `origemDe()` descarta o caminho. Pego na
validação da staging, com teste de regressão.

### Validado na staging — 05/08/2026

| Passo | Resultado |
|---|---|
| `POST /api/admin/notificar-lideres {"dry":true}` | Payload montado, nada enviado |
| Envio real (`{"dry":false}`) | **HTTP 202**, `falhas: []` |
| Log de entrega (`GET` no endpoint do Gomoon) | `status: entregue`, `messageName` presente |
| ⚠️ Proteção do §6 | `destinatarioEfetivo: joaovictor.esteves@gocase.com` — o líder REAL nomeado no payload (Lucas Queiroz) **não** recebeu |
| Repetir o POST (cron rodando 2×) | `ja_entregues: 1`, `falhas: []` — **nenhuma 2ª DM** |

**Staging:** ficamos na **opção 2** do §6 — o campo `ambiente` deriva do `GODOCS_ENV`
(fonte única do ambiente no GoDocs) e o Gomoon roteia tudo para o destinatário de teste
dele. ⚠️ Isso significa que **o campo é a única proteção**: um `GODOCS_ENV` errado na
staging manda DM para líder real. Se um dia isso incomodar, o João emite o **token
separado** (opção 1) e a proteção passa a ser do lado dele, imune ao nosso payload.

**Decisões nossas que o contrato não fixava:**
- A relação sai da **própria fila** (`projeto_aprovacoes`), não de uma segunda consulta à
  TeamGuide — senão o payload poderia divergir do que a tela `/aprovacoes` mostra.
- Ficam de fora: **rascunho**, projeto **descontinuado**, linha **já decidida** e os
  projetos de teste **`[E2E-…]`** (o mute de Chat saiu do `abrirPreAprovacao` na D17, então
  excluí-los virou responsabilidade de quem monta o payload).
- A data da `idempotency_key` é o dia-calendário de **Brasília**, não o UTC: com o cron às
  09h BRT dá no mesmo, mas um disparo manual à noite cairia no "dia seguinte" em UTC e
  renderia uma segunda DM no mesmo dia.
- `notificarLideresPendentes` **nunca lança** — o chamador é um cron, e uma exceção viraria
  500 opaco no log. Toda falha volta como `ok:false` + `erro`, e o corpo da resposta é o
  relatório (quantos líderes/liderados/projetos, status HTTP, falhas por item).

⚠️ **Ainda pendente do João Victor:** o **token de produção** (§1 do documento dele — foi
enviado por canal separado; entra como secret nos dois apps).

---

## 13. Quem redige é o GoDocs — `mensagem.texto` (v2 do contrato, 06/08/2026)

**Decisão (Luis, 06/08/2026):** o texto da DM viaja **pronto** no payload, num campo novo
`mensagem.texto` por líder. O template do Gomoon vira **fallback**.

Por quê: o `total` é a **soma** dos liderados, a lista precisa de bullets na ordem certa, o
plural muda a frase (*1 projeto de Ana* × *5 projetos da sua equipe*) e a data sai em fuso
de **Brasília**. Pedir isso a um template do outro lado significaria um mini-engine lá e a
cópia morando em dois repos — com o texto pronto, mexer numa vírgula é deploy **nosso**.

**O que o Gomoon faz:**

1. **Aceita e PERSISTE** `lideres[].mensagem.texto` junto com o item da fila — não
   re-renderiza na hora de entregar.
2. **Na entrega:** se `mensagem.texto` existe, é ele que vai; se falta, cai no template
   interno. É isso que deixa os dois lados deployarem em **qualquer ordem**.
3. **Validação:** campo **opcional**, string, teto de ~4.000 chars (limite do Chat). Nada de
   `400` novo — a validação do §11 derruba o **lote inteiro**, e um texto comprido não pode
   matar o dia.
4. **Idempotência:** a regra do §4 já resolve — chave existente e **não entregue** →
   substitui o item, **inclusive o texto** (o novo é mais recente).
5. **Auditoria:** o `GET` passa a devolver o texto efetivamente enviado (é o que responde
   "recebeu, mas veio errado").
6. **Cartão:** se ele montar cartão, `mensagem.texto` é o corpo — não repetir o mesmo texto
   dentro e fora.

**Três regras sobre o texto (valem nos dois endpoints):**

- ⚠️ **A ENTREGA É EM CARTÃO (`cardsV2`), e por isso o markup é HTML** — `<b>`, `<i>`,
  `<u>`, `<s>`, `<a href>`; `\n` para quebra de linha; `•` e emoji literais. **Fechado em
  06/08/2026, depois do 1º disparo de staging chegar com asterisco cru na tela.** O Google
  Chat tem **duas sintaxes que não se conversam** e a nossa escolha tem de seguir a
  superfície de entrega, não o gosto:

  | Superfície | Negrito | Itálico | Quebra |
  |---|---|---|---|
  | mensagem de texto (campo `text`) | `*assim*` | `_assim_` | `\n` |
  | **cartão (`TextParagraph`) ← é o nosso caso** | `<b>assim</b>` | `<i>assim</i>` | `\n` ou `<br>` |

  Asterisco dentro de cartão **não** é interpretado: chega literal (`*Você tem projeto…*`).
  Não escapar o HTML, não reformatar. `[texto](url)` **não** renderiza em nenhuma das duas.
  ⚠️ **Se um dia a entrega deixar de ser cartão, avise** — `src/lib/gomoon-mensagens.ts`
  tem de voltar ao asterisco no mesmo deploy, senão a DM vira `<b>` visível.
- ⚠️ **O aviso ao líder TRAZ título e link na prosa** (decisão do Luis, 06/08/2026, contra
  a minha recomendação): o cartão já mostra cabeçalho ("📋 Pré-aprovação pendente") e o
  botão "Abrir a fila" (do campo `lideres[].url`), então **título e link aparecem 2× na
  mesma DM**. Ele foi avisado e manteve o formato do §10.2. **Se der para o Gomoon suprimir
  o cabeçalho do cartão quando vem `mensagem.texto`, a duplicação some sem mexer no texto**
  — vale perguntar ao João Victor.
- **Não prefixar nem sufixar mais nada** (saudação, assinatura, rodapé): o texto já tem
  abertura e fechamento, e o acréscimo sai duplicado. _(O prefixo
  `[STAGING — destinatário real: …]` é exceção combinada e só vale com `ambiente:"staging"`
  — em produção não pode aparecer.)_
- **Sem travessão (`—`) no ANÚNCIO** (pedido do Luis, 06/08/2026). Régua **nossa**, de
  redação, e só sobre a prosa do anúncio. ⚠️ **Os bullets do aviso ao líder mantêm o
  travessão** (`• Ana — 2 projetos`): é o formato do modelo dele no §10.2. Teste que
  segura as duas redações: `tests/gomoon-mensagens.test.ts`.

Nosso lado: **`src/lib/gomoon-mensagens.ts`** (módulo PURO, fonte única das duas redações) →
`renderMensagemLider()` é chamada dentro de `montarPayloadLideresPendentes`, **depois** de
ordenar os liderados (renderizar antes daria uma DM em ordem diferente da lista).

---

## 14. Anúncio de abertura — endpoint próprio (§13 v2, 06/08/2026)

A mensagem que **explica a feature para a empresa**, uma vez. ⚠️ **Não pode** viajar no
`/lideres-pendentes`: aquele é um snapshot que o cron repete todo dia — um anúncio pendurado
nele vira DM de anúncio diária.

```http
POST https://gomoon.gogroupbr.com/api/godocs/anuncio
Authorization: Bearer <GOMOON_TOKEN>
```

```json
{
  "origem": "godocs",
  "ambiente": "producao",
  "gerado_em": "2026-08-06T12:00:00Z",
  "anuncio": {
    "idempotency_key": "godocs:anuncio:pre-aprovacao-lider:v4",
    "destinatarios": "todos",
    "mensagem": { "texto": "<b>Novidade no GoDocs…</b> 🚀\n\n…" }
  }
}
```

- **`idempotency_key` SEM data** → entregar **uma vez por pessoa, para sempre**. POST
  repetido é no-op (`ja_entregue`), nunca segunda DM. É a diferença de regra em relação ao
  diário. Subir a **versão** no fim da chave é o único jeito de reabrir o disparo.
  ⚠️ **A versão em vigor é a `v4`** (06/08/2026). As três anteriores morreram queimadas
  **em teste**, sempre pelo mesmo motivo (chave sem data = no-op eterno depois do 1º
  disparo de staging): `v1` chegou com asterisco literal na tela, `v2` corrigiu o markup,
  `v3` foi uma "restauração" errada do texto longo, e **`v4` é o texto que o Luis colou**.
  Nenhuma pessoa da empresa recebeu nenhuma das três.
  Ninguém da empresa recebeu o `v1`.
- ⚠️ **`ambiente: "staging"` tem de ser honrado aqui também**, com o mesmo roteamento para o
  destinatário de teste. Sem isso, um teste nosso vira DM para a **empresa inteira** — risco
  muito maior que o do endpoint diário.
- **`destinatarios: "todos"`** = **o Gomoon expande** pelo diretório do Workspace (decisão do
  Luis, 06/08/2026: quem já resolve e-mail→usuário do Chat é ele). A forma de lista
  (`[{email, nome}]`) fica no contrato para um envio dirigido, mas não é a que usamos.
- Resposta e auditoria iguais às do diário (`202` + `resultados[]` por pessoa).

Nosso lado: `anunciarPreAprovacao()` (mesmo arquivo do diário) + **`POST
/api/admin/anunciar-pre-aprovacao`**. **NÃO tem cron** — é evento único, disparado à mão no
dia do rollout. ⚠️ **`dry` é o DEFAULT**: enviar exige `{"dry":false}` explícito, porque um
POST sem body falaria com a empresa toda.

O texto do anúncio é conferido contra o código por teste (`tests/gomoon-mensagens.test.ts`):
a isenção descrita é a **D20** (coordenação para cima, sem citar supervisor), a entrada da
fila é a **faixa "Pré-aprovações do meu time" da home** (não existe menu "GoDocs →
Pré-aprovações") e a frase do ajuste diz *"fica visível em Meus Projetos"* — **não** "você
recebe", porque o autor não é avisado por DM nem e-mail (pendência aberta).
