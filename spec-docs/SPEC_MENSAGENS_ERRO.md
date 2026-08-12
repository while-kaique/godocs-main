# SPEC — Mensagens de erro do fluxo de submissão: canal, tom e redação

**Data:** 12/08/2026 · **Status:** ✅ implementado (aguarda staging) · **Pedido:** Kaique (dono do produto)

> Documento NOVO (e não uma entrada em `SPEC_CORRECOES.md`) porque isto **não é um bug**: é uma
> política de produto sobre **qual canal cada erro usa** e **como cada texto é escrito**, que
> vale para todo erro futuro. As duas correções de fato que apareceram no caminho (a mensagem
> mandando a pessoa para a Etapa ERRADA) ganharam entrada própria em `SPEC_CORRECOES.md`.

## O problema

Praticamente todo erro da submissão terminava num **toast vermelho** no canto superior direito
(`richColors` do sonner), muitos com o prefixo **"Erro ao …:"**. Três consequências:

1. **Vermelho diz "o sistema quebrou"** — mesmo quando o problema é de preenchimento (custo
   digitado como mensal em vez de anual, memorial não concluído, nome repetido). A pessoa lê
   como falha nossa e reenvia igual, várias vezes (foi o caso SmartOnline/DIFAL: 6 tentativas
   em 25 min).
2. **Toast é efêmero e estreito.** A `mensagemSavingSemGanho` é um parágrafo com 3 caminhos de
   correção, exibido por 20s numa caixa de ~360px: some antes de ser lida e não pode ser
   reconsultada. O bloqueio mais importante do produto vivia no canal mais frágil.
3. **O prefixo empurra a orientação para fora da vista** — `Erro ao enviar projeto: <texto de
   400 caracteres>` corta justamente o "Para corrigir…". (Já havia sido removido no bloqueio de
   submissão; seguia em 9 outros toasts.)

## A régua (política de canal)

| Quem causou | Canal | Severidade visual |
|---|---|---|
| **Usuário**, num CAMPO | Erro inline no campo (`FieldError`) + `go-input-invalid` + shake | Vermelho contido, agora com **ícone** (estado nunca só por cor) |
| **Usuário**, bloqueando o ENVIO | **Painel âmbar persistente** (`AvisoBloqueio`) na tela onde está o botão + toast âmbar curto de 6s que só aponta para ele | Âmbar + ícone + rótulo "Envio pausado" |
| **Usuário**, dentro da conversa | **Fala do bot** no chat (padrão `mensagemCustoEvitadoPago`: texto do backend, sem LLM) | Bolha normal do assistente |
| **Sistema** (rede, 5xx, LLM, cota, sessão) | Toast **vermelho** | Vermelho — aqui ele é verdade |
| **Informativo** (arquivo ignorado, .zip expandido) | Toast `info`/`warning` | Neutro/âmbar |

### Por que o bloqueio de envio NÃO virou fala do bot

Era a alternativa considerada (o botão "Enviar para Triagem" fica na mesma tela do chat). Foi
descartada por dois motivos: **(a)** as `chat_messages` são persistidas no servidor e congeladas
em `snapshot_chat` por versão — injetar uma bolha só no cliente desincroniza o histórico e o
Investigador; **(b)** o envio é ação de FORMULÁRIO, não turno de conversa: o bot não tem turno
ali, e fabricar um faria a pessoa responder ao bot uma coisa que nenhum gate está esperando.
O painel fica **ancorado ao botão** que falhou, que é onde o olho está.

## Inventário — antes → depois

Bloqueios de envio (fonte única `src/lib/mensagens-submissao.ts`, agora **estruturados**):

| # | Bloqueio | Canal antes | Canal depois | Texto novo (título + resumo) |
|---|---|---|---|---|
| 1 | Saving sem ganho líquido (com custos) | toast vermelho 20s, 1 parágrafo de ~470 chars | painel âmbar + toast curto | **"Os custos declarados anulam o ganho deste saving"** — "O ganho LÍQUIDO ficou em R$ −868,30: as 60h/mês economizadas não cobrem os custos que você declarou — ferramenta externa (R$ 2.500,00/mês)." + 3 caminhos |
| 2 | Saving sem ganho algum | idem | idem | **"Este saving ainda não tem ganho registrado"** — "Nenhuma hora economizada e nenhum gasto externo eliminado." + 3 caminhos |
| 3 | Receita zerada | idem | idem | **"A receita deste projeto está em R$ 0,00"** — "Receita incremental só é enviada com o valor e o memorial que mostra como o número é apurado." + 2 caminhos |
| 4 | Receita incompleta | idem | idem | **"O memorial de receita está incompleto"** — "Receita incremental exige três coisas: periodicidade, valor e um memorial de RECEITA…" + 2 caminhos |
| 5 | Documentação ausente | idem | idem | **"A documentação deste projeto ainda não foi gerada"** + 1 caminho |
| 6 | Nome duplicado | toast âmbar 8s | painel âmbar + toast curto | **"Já existe um projeto submetido com o nome «X»"** + 2 caminhos |

Erros do fluxo que não bloqueiam o envio:

| Onde nasce | Texto antes | Depois |
|---|---|---|
| `submeter.tsx` `handleSubmitProjeto` (memorial de saving/receita não aprovado) | toast **vermelho** "Conclua o memorial de saving no chat (responda as perguntas até aprovar o preview) antes de enviar." | toast **âmbar**: "Falta aprovar o memorial de saving. Reabri o formulário de impacto — conclua as perguntas até o memorial aparecer." |
| `handleIniciarAgente` / `reprocessarComNovosArquivos` (orçamento de tokens) | vermelho "Conteúdo muito grande (~Xk tokens, limite ~200k). Remova arquivos…" | **âmbar**, mesma orientação (é escolha de arquivos, não falha) |
| `handleSendMessage` | vermelho "Erro ao enviar mensagem: {msg}" | vermelho, sem prefixo: "Sua mensagem não foi enviada. {msg} Nada do que você já respondeu se perdeu — reenvie a última mensagem." |
| `handleIniciarAgente` | "Erro ao iniciar análise: {msg}" | "Não foi possível iniciar o agente. {msg}" |
| `handleSavingFormSubmit` / `handleReceitaFormSubmit` | "Erro ao iniciar análise de impacto/receita: {msg}" | "Não foi possível iniciar a análise de impacto/receita. {msg} Os dados do formulário continuam preenchidos." |
| `reprocessarComNovosArquivos` | "Erro ao reprocessar os arquivos: {msg}" | "Não foi possível reprocessar os arquivos. {msg}" |
| `handleContinuarAgente` (3 pontos) | "Erro ao reavaliar a documentação / atualizar os dados / atualizar o tipo: {msg}" | mesmas frases sem "Erro ao": "Não foi possível reavaliar a documentação. {msg}" etc. |
| `handleContinuarAgente` (tipo não selecionado) | erro inline **+** toast vermelho duplicando | só o **inline** + shake (o toast era ruído sobre uma mensagem que já está na tela) |
| seed da edição | "Não foi possível carregar o projeto para edição." | + "Recarregue a página; se continuar, acione a equipe pelo botão de ajuda." |
| `step2.tsx` (arquivo > 10MB, .zip grande, .zip corrompido, muitos arquivos) | `toast.error` (vermelho) | `toast.warning` (âmbar) — é seleção de arquivo, não falha do sistema |
| `FieldError` | 11px vermelho, só texto | + ícone `AlertCircle` (a11y: estado nunca só por cor) |

## Decisões fechadas (não "corrigir" por engano)

- **D1 — A fonte única continua sendo `src/lib/mensagens-submissao.ts`** (módulo PURO). O que
  mudou é o FORMATO: cada bloqueio é um `BloqueioSubmissao { codigo, titulo, resumo, caminhos[] }`
  e `formatarBloqueio()` o serializa em texto. As funções `mensagem*()` de antes seguem
  exportadas (é o que vai na `Error.message`, nos `api_logs` e num cliente desatualizado) — **não
  redigitar texto em componente nenhum**.
- **D2 — Os caminhos de correção são ALTERNATIVAS, não passos.** Por isso `caminhos` é
  renderizado com marcadores, nunca numerado: "(1)(2)(3)" fazia parecer que era preciso fazer
  os três. O painel diz "Escolha um caminho".
- **D3 — Nunca expor o R$ das HORAS.** A explicação das horas é qualitativa ("as 60h/mês não
  cobrem"), a dos custos é numérica (a pessoa mesma os digitou). Teste explícito.
- **D4 — O bloqueio viaja ESTRUTURADO pela API**, no corpo do erro: `{ error, bloqueio }`
  (aditivo — quem só lê `error` continua funcionando), com **HTTP 400** em vez de 500. Erro de
  preenchimento nunca é 5xx: além do tom, 500 sujava a leitura do Investigador.
- **D5 — O painel some quando a pessoa age.** Ele é limpo ao reabrir o formulário de impacto
  ("Refazer"), ao mandar mensagem no chat e ao tentar enviar de novo — um bloqueio velho na tela
  ao lado de uma tentativa nova seria pior que nenhum aviso.
- **D6 — Vermelho continua existindo.** Falha de rede, 5xx, sessão expirada e LLM fora do ar
  seguem vermelhas: nesses casos o vermelho é informação correta, e amaciar tudo faria a pessoa
  não distinguir "eu preciso corrigir algo" de "tente de novo em 1 minuto".
- **D7 — Os textos dos gates de chat (sobreposição, ganho projetado, custo evitado no chat,
  jornada/teto, critério) NÃO foram tocados** além de zero mudança de redação: eles já são falas
  do bot no canal certo e cada um tem anti-loop testado.

## Onde aterrissou

| Arquivo | O que |
|---|---|
| `src/lib/mensagens-submissao.ts` | `BloqueioSubmissao` + `bloqueio*()` + `formatarBloqueio()` + `erroDeBloqueio()`; `mensagem*()` mantidas como serialização |
| `src/components/aviso-bloqueio.tsx` | painel âmbar (novo) — irmão de `aviso-pendencia.tsx` |
| `src/lib/chat.functions.ts` | os 5 `throw new Error(mensagem…)` viraram `throw erroDeBloqueio(bloqueio…)` |
| `src/worker.ts` | `errorJson` repassa `bloqueio` no corpo; status vem do erro (400) |
| `src/lib/api-client.ts` | `ApiError.bloqueio` |
| `src/routes/submeter.tsx` | estado `bloqueio`, toasts reescritos, painel na revisão final e na Etapa 2.5 (especial) |
| `src/lib/submeter/step3-chat.tsx` | `FinalReview` recebe e renderiza o painel acima do botão |
| `src/lib/submeter/form-components.tsx` | `FieldError` com ícone |
| `tests/mensagens-submissao.test.ts` | cobre a camada estruturada (códigos, caminhos, R$ das horas, etapa citada) |

## Pendente de decisão do usuário

- A **régua de canal** acima cobre a submissão. As telas de **admin** (`/dashboard`,
  `/usuarios`, `/areas`, `/email-legados`) seguem com `toast.error(e.message)` genérico: é
  público interno e o vermelho ali não induz o erro de leitura que motivou este trabalho.
  Uniformizar depois, se o Kaique quiser.
</content>
</invoke>
