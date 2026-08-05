# Integração GoDocs → Gomoon → Google Chat (pré-aprovação do líder)

Documento de contrato para o time do **Gomoon**. Descreve o que o GoDocs envia, quando
envia, e o que o Gomoon precisa provisionar para entregar a mensagem por DM no Google
Chat do Workspace da empresa.

**Versão:** 1 · **Data:** 05/08/2026 · **Responsável GoDocs:** Luis Albuquerque

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

- **1 requisição por dia**, às **06:00 (horário de Brasília)**, disparada por cron no GoDocs.
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
      ]
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

Dúvidas? É só chamar o time de RPA & IA ou usar o botão de ajuda dentro do GoDocs.
```

⚠️ O texto reflete a **D20**: a isenção é por CARGO (coordenação para cima) — se a régua
mudar, esta mensagem muda junto.

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

_Situação em {{gerado_em → DD/MM}} às 06h. Se você já decidiu depois disso, pode
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

⚠️ **Falta o nosso lado (F3):** a agregada em `projeto_aprovacoes` (`GROUP BY
aprovador_email`) + o cron das 6h (UTC no Godeploy → `0 9 * * 1-5`) + o POST. Nada disso
existe ainda. Pedir ao João Victor: **o token de produção** e, se formos usar staging, o
**token separado** acima.
