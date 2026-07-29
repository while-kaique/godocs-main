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
