# Roteiro de validação em staging — critério de projeto (`[1.3]`/`[1.4]`)

> Serve à decisão da **pendência 3**: o ponto `[1.4]` precisa de gate determinístico, ou o prompt
> segura sozinho? Rodar em **staging (`edf400b4`)**, com dados simulados.
> Contexto: [`SPEC_CRITERIOS_PROJETO.md`](../spec-docs/SPEC_CRITERIOS_PROJETO.md) ·
> baseline de perguntas: [`analise-perguntas-agente.md`](analise-perguntas-agente.md).

## O que significa "o agente acerta sem trava"

Cinco comportamentos observáveis, por conversa. Sem gate, quem os garante é só o prompt.

| # | Comportamento | Como falha | Gravidade |
|---|---|---|---|
| **1** | A seção **"Ponteiro movido e onde verificar"** existe no memorial | Fecha o preview sem a seção. **Silencioso** — nada bloqueia; o analisador lê a ausência como rastreabilidade não comprovada e joga para `zona_cinzenta`, então o esquecimento do agente vira triagem manual injusta para o autor | **ALTA** |
| **2** | A fonte é **nomeada** | Aceita "no sistema", "no ERP", "na planilha" | ALTA |
| **3** | Aceita "não sei onde conferir" e **registra isso** | **Inventa** uma fonte plausível para fechar a seção — pior que a ausência, cria evidência falsa que a triagem não desconfia | **ALTA** |
| **4** | Não repete: (a) e (b) no máximo 1× cada | Loop (a lição do split carga×escala, que travou a edição) | MÉDIA |
| **5** | Não pergunta o que já está respondido | Pergunta o ponteiro tendo o contrafactual no prompt, ou a magnitude que a doc já traz | MÉDIA |

## Cenários (8)

Cada um: submeter em staging, conferir o chat no Investigador, o texto do memorial e a coluna
`Classificação` na aba `STAGING`.

| # | Cenário | Esperado |
|---|---|---|
| 1 | **Doc rica** (dependências nomeiam Metabase) + contrafactual claro ("time Fiscal volta a conferir à mão") | **0 perguntas** de `[1.3]`/`[1.4]` — deduz custo/horas do contrafactual e propõe o Metabase para confirmar |
| 2 | **Doc pobre** (só "roda um script"), contrafactual vago | Pergunta (a) e (b), **1× cada** |
| 3 | Respondo **"Ainda não sei dizer"** no ponteiro | Aceita, registra na seção, **segue**; analisador → `zona_cinzenta` |
| 4 | Respondo **"no sistema"** na fonte | Insiste **1×** pelo nome; se eu repetir vago, registra o que tenho e segue |
| 5 | **Nuvem de palavras** (peça única, sem recorrência) | `claro_nao` → coluna Status **"Reprovado"** + `Motivo Reprovado` legível ao autor |
| 6 | **Saving recorrente** bem documentado | `claro_sim` → Status "Pendente" |
| 7 | **Contrafactual** (`alguem_fazia='nao'`) | As duas seções existem; sem gate de jornada/teto (fora do escopo do contrafactual) |
| 8 | **Só receita** | As duas seções existem também no modo receita |

Em todos: contar as perguntas da IA e comparar com a baseline de **6,4/submissão**.

## Regra de decisão

- **Ponto 1 falhando — mesmo 1× em 8** → **fazer o gate**. Prompt-only já falhou 2× neste repo no
  mesmo formato (Gostream/Seção 2.4; custo evitado puro, que exigiu backstop em `iniciarSaving`), e
  aqui a consequência recai sobre o autor.
- **Pontos 2 ou 3 falhando** com alguma frequência → **fazer o gate**, versão barata: extrai a seção
  antes do preview; fonte nomeada → libera; ausente/vaga → bloqueia e pergunta **1× só**, depois
  segue. ~30 linhas em `enviarMensagem`, clonando `alocacao_ganhos`.
- **Ponto 4 falhando** → o gate **pioraria**; corrigir no prompt.
- **Tudo passando** → o gate cai de prioridade; a rede fica sendo o analisador puxando para zona
  cinzenta.

⚠️ **Limite do método:** 8 conversas escritas por quem conhece o prompt **não** são amostra
estatística e enviesam a favor do agente. Serve para pegar falha grosseira (pontos 1 e 3), não para
atestar "acerta sempre". Se o ponto 1 passar em 8/8, o gate ainda é recomendável: custo baixo, modo
de falha silencioso.

⚠️ **Pré-requisito:** rodar **depois** do bloco `buildRespostasFormulario` — validar um agente cego
ao contrafactual mediria o prompt errado.

---

## RESULTADO — executado em 2026-07-29 (staging `edf400b4`, runs `stg-ctx-01` + `stg-ctx-02`)

**7 conversas** medidas via E2E (`E2E_ONLY=saving-puro,custo-evitado-puro,receita-pura[,especial]`,
`GOOGLE_SHEETS_TAB=STAGING`) + `scripts/e2e/inspect-perguntas.mjs`.

| Ponto | Veredito | Evidência |
|---|---|---|
| **1** — `[1.4]` existe | ❌ **falhou 1×** | ausente no `receita-pura` do `stg-ctx-02` (presente no `stg-ctx-01`) |
| **2** — fonte nomeada | ❌ **falhou 2×** | `custo-evitado-puro` gravou só a metade da seção — `**Ponteiro movido:** custo externo eliminado.`, **sem** o "onde verificar" — nas DUAS rodadas |
| **3** — aceita "não sei" e registra | ✅ | `saving-puro`/`stg-ctx-01`: _"não foi informada uma planilha, relatório ou base específica com nome próprio para conferência"_ — **não inventou fonte** |
| **4** — não repete | ✅ | 0 repetições de (a)/(b) em 7 conversas |
| **5** — não pergunta o já sabido | ✅ | **0** perguntas de ponteiro — deduziu do contrafactual/doc, como projetado |
| `[1.3]` no modo receita (cenário 8) | ❌ **falhou 2×** | ausente no `receita-pura` nas duas rodadas |
| Perguntas/submissão | ✅ | **1,8–2,7** contra baseline de **6,4** — as duas seções novas não engordaram o funil |

O `especial` (`stg-ctx-02`) sai sem as duas seções **por construção** (pula o chat, não tem memorial
financeiro) — não conta como falha.

### Decisão (Luis, 2026-07-29): **FAZER O GATE**
Pela própria regra acima (ponto 1 falhando ainda que 1×), na versão barata: extrair as seções antes do
preview; concreta → libera; ausente/vaga → **bloqueia e pergunta 1× só**, depois segue. Clonar
`alocacao_ganhos` em `enviarMensagem`. O modo **receita** é o caso reprodutível — começar por ele.

### ⚠️ Achados de método (não repetir o erro)
1. **O `inspect-perguntas.mjs` mentia** — lia `{messages:[…]}` com `content` em JSON, mas
   `/api/chat/historico/:id` devolve **array achatado** com `content` em **texto puro** e
   `options`/`fase`/`isPreview` como campos irmãos. Reportava **0 pergunta e 0 memorial em toda
   conversa** — falso negativo silencioso que levava à conclusão oposta ("o agente não faz nada").
   Corrigido nesta sessão.
2. **O ponto 3 foi validado sem humano no navegador** — ao contrário do que o handoff supunha: o
   respondedor do E2E se esquivou por conta própria ("não há nome de planilha para citar") e o agente
   registrou a ausência honestamente.
3. **O lado do ANALISADOR segue SEM validação** (`Classificação`, `Reprovado`, `Motivo Reprovado`):
   nos 7 projetos a coluna saiu `—` porque a análise **morre antes de gravar**, não por bug do código
   novo. Log da staging, idêntico nos 7: `[llm] Falha de TIMEOUT … 25000ms (proxy não respondeu)` →
   `fallback p/ OpenAI direto` → **`waitUntil() tasks did not complete … have been cancelled`**.
   `Complexidade` fica vazia junto — é o modo de falha conhecido. A rede seria o cron
   `reanalisar-pendentes`, mas na staging ele estava **disabled**; habilitado às 17:02 (`ejrje7my8g4c`),
   continuou `last=never` com o `next` escorregando — **o cron de 1 min não dispara na staging**.
