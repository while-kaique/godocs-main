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
