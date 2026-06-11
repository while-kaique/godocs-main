# Roteiro de Teste — Submissão de Saving (`n8n-audit`)

Roteiro pronto para preencher o fluxo `/submeter` de ponta a ponta com um cenário de **saving**.
Copie e cole cada campo. Quando chegar no **Agente IA (Fase 2 — Análise de Impacto)**, me mande
aqui as perguntas que ele fizer — eu gero as respostas usando a **Ficha do Cenário** no final
deste arquivo (é a "fonte da verdade" pra manter tudo coerente).

> Projeto de teste: **n8n-audit** — automação interna (n8n) que audita os workflows de n8n da
> empresa todo mês (credenciais vencidas, nós inativos, taxa de erro, padrão de nomenclatura,
> documentação) e gera um relatório consolidado. Substitui uma auditoria manual mensal.

---

## Step 1 — Envio

| Campo | Valor a preencher |
|---|---|
| **Esta solução é interna ou externa?** | 🏠 **Interna** |
| **Este projeto já está em produção?** | 🟢 **Sim, já está em produção e sendo utilizado** |
| **Nome Completo** | `Luis Albuquerque` |
| **E-mail** | `luis.albuquerque@gocase.com` |
| **Área** | **Tecnologia** |
| **Ferramenta Utilizada** | **n8n** |
| **Projeto desenvolvido em equipe?** | 👥 **Sim, em equipe** |
| **E-mails dos participantes** (chips) | `kaique.dev@gocase.com` · `marina.santos@gocase.com` |

> ⚠️ Domínios aceitos: apenas `@gocase`, `@gobeaute`, `@gogroup` (`.com` ou `.com.br`).

---

## Step 2 — Projeto

| Campo | Valor a preencher |
|---|---|
| **Este projeto gera saving, receita incremental ou ambos?** | ☑️ **💰 Saving** (só saving) |
| **Nome do Projeto** | `[Tecnologia] Auditoria Automática de Workflows n8n` |
| **Data de Criação do Projeto** | `2025-02-10` (qualquer data entre 01/01/2024 e hoje) |
| **Contexto de Negócio** (mín. 20 caracteres) | ver bloco abaixo |

> 💡 Como a ferramenta é **n8n**, o nome do projeto **deve começar com `[Área]`** entre
> colchetes (o form mostra um aviso amarelo se faltar) — por isso o `[Tecnologia]` no início.

### Contexto de Negócio (colar no textarea)

```
Automação em n8n que faz a auditoria mensal de todos os workflows de n8n da empresa.
Antes era um pente-fino manual feito pelo time de automação: exportar cada workflow,
conferir credenciais vencidas, nós desativados, taxa de erro nas últimas execuções,
aderência ao padrão de nomenclatura e se havia documentação. Hoje o n8n-audit varre
a API do n8n, aplica as regras automaticamente e gera um relatório consolidado no
Google Chat + planilha, restando ao time apenas revisar os apontamentos.
```

### Upload de arquivos (Step 2)

Para o teste, suba a pasta do próprio projeto **n8n-audit** (ou alguns arquivos representativos:
o JSON do workflow exportado, o `README.md` e os scripts). O filtro automático já ignora
`node_modules`, `.git`, locks etc. Se não tiver os arquivos à mão, o mínimo é o
**Contexto de Negócio** acima — mas com arquivos a pré-extração preenche mais campos sozinha.

> Depois do upload, clicar em **"Continuar com Agente"** / **"Iniciar Agente"**.

---

## Step 3 — Agente IA

### Fase 1 — Documentação Técnica (chat azul)

A IA roda a pré-extração e só pergunta o que ficou `null` (normalmente os campos de **negócio**:
*o que faz* e *atenção*). Respostas sugeridas se ela perguntar:

- **O que faz / qual o problema que resolve:**
  > Garante que os workflows de n8n não quebrem em silêncio. Antes, credencial vencida ou nó
  > desativado só era descoberto quando algo parava em produção. O n8n-audit detecta esses
  > problemas de forma proativa, todo mês, e ainda cobra padronização e documentação.

- **Atenção / riscos / limitações:**
  > Depende da API do n8n estar acessível e do token de leitura válido. Audita só o que está na
  > instância principal de n8n; workflows em instâncias separadas não entram. Se a estrutura do
  > export do n8n mudar numa atualização, as regras de parsing podem precisar de ajuste.

> Revisar o **preview da documentação** → clicar **Aprovar**. Vem a transição animada (3s) →
> entra na **Fase 2 (Saving)**.

### Formulário determinístico de Saving (`SavingForm`) — preencher ANTES do chat da fase 2

Uma **linha por pessoa/cargo** que executava a tarefa manualmente:

| # | Cargo (dropdown) | Horas/mês ANTES | Horas/mês DEPOIS |
|---|---|---|---|
| 1 | **Analista Pleno** | `16` | `2` |
| 2 | **Analista Júnior** | `12` | `0` |
| 3 | **Coordenador / Especialista** | `3` | `1` |

- **Mensal / Pontual:** **Mensal** (a auditoria roda todo mês)
- **Custo externo:** não se aplica (escopo interno) — deixar vazio

> ⚠️ O cálculo em **R$** nunca aparece na tela (é só métrica de backend). A IA vai **desafiar as
> horas**, não os valores. Clicar **"Iniciar análise"**.

### Fase 2 — chat de Análise de Impacto (chat lima)

**Aqui é onde você me chama.** Quando o agente fizer as perguntas pra entender/validar o saving
(detalhamento passo a passo da rotina manual, por que tantas horas, com que frequência etc.),
**cole as perguntas dele aqui** que eu devolvo respostas elaboradas e consistentes com a Ficha
abaixo.

---

## 📋 Ficha do Cenário (fonte da verdade — base das minhas respostas ao agente)

**O que era a auditoria manual (antes):**
Todo início de mês o time de automação fazia um pente-fino em ~80 workflows de n8n ativos.
Para cada workflow:
1. Exportar o JSON pela UI do n8n e abrir.
2. Conferir credenciais usadas e se alguma estava vencida/órfã.
3. Identificar nós desativados ou "esquecidos" (deadcode no fluxo).
4. Puxar o histórico de execuções e calcular a taxa de erro do mês.
5. Checar se o nome seguia o padrão `[Área] Nome` e se havia descrição/documentação.
6. Lançar tudo numa planilha de controle e abrir tickets pros donos dos workflows com problema.

**Quem fazia e quanto tempo (por mês):**

| Cargo | Antes | Depois | Papel |
|---|---|---|---|
| Analista Pleno | 16h | 2h | Executava a auditoria da maioria dos workflows + consolidava a planilha. Hoje só **revisa** o relatório gerado e valida apontamentos críticos. |
| Analista Júnior | 12h | 0h | Fazia a coleta braçal (export, taxa de erro, nomenclatura). Hoje **não toca mais** — automatizado 100%. |
| Coordenador / Especialista | 3h | 1h | Reunião de fechamento + priorização dos apontamentos. Hoje a reunião é mais curta porque o relatório já vem priorizado. |

**Totais (para coerência das respostas):**
- Economia de horas/mês: `(16−2) + (12−0) + (3−1)` = **28 h/mês**.
- Frequência: **mensal**, recorrente. Roda há vários meses, estável.
- ~80 workflows auditados por ciclo; ~6–8 min manuais por workflow no fluxo antigo (bate com as horas).

**Por que NÃO é zero depois (anti-extrapolação — para o agente não me acusar de inflar):**
Ainda há trabalho humano: revisar apontamentos que a regra marca como "atenção" mas exigem
julgamento (ex.: nó desativado de propósito), validar credenciais sensíveis e a reunião curta de
fechamento. Por isso Pleno e Coordenador mantêm um resíduo de horas.

**Ganhos qualitativos (se o agente perguntar além das horas):**
- Detecção proativa de falhas (antes só descobria quando quebrava em produção).
- Padronização e cobertura de documentação subiram.
- Cadência garantida: a auditoria não "fica pra depois" num mês corrido.

> Mantenha as horas da Ficha = as horas do `SavingForm`. Se o agente pedir para detalhar a rotina,
> use os 6 passos acima. Se desafiar o número, ancore em **~80 workflows × ~6–8 min**.
