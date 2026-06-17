# Regras de Negócio

## Fluxo de submissão (visão completa)

```
Usuário preenche Step 1 (dados) → Step 2 (projeto + upload) → Etapa 2.5 (tipo) → Step 3 (chat IA)

Etapa 2.5 (sub-tela entre Step 2 e Step 3 — mantém o wizard de 3 passos):
  Pergunta: "Seu projeto tem altíssimo impacto, mas não está ligado a ganho de
  receita ou saving operacional como um projeto padrão?"
  → SIM  = projeto ESPECIAL → coleta contexto_especial → fluxo especial (ver abaixo)
  → NÃO  = projeto padrão → escolhe saving/receita/ambos → fluxo padrão

No Step 3 (projeto padrão):
  Extrator pré-preenche 7 campos → Chat doc (pergunta só nulls)
  → Preview doc (aprovar/ajustar)
  → [compila documentação]
  → Formulário Saving/Receita
  → Chat impacto (valida/desafia dados)
  → Preview memorial (aprovar/ajustar)
  → Revisão final → "Enviar para Triagem"

No Step 3 (projeto ESPECIAL):
  Mesmo chat de documentação (doc → preview doc) → encerra direto na revisão final
  (pula saving/receita). Submete e NÃO dispara o analisador IA.

Pós-submissão:
  1. Verifica duplicata (mesmo nome, status != rascunho)
  2. Popula colunas de impacto no projeto
  3. Auto-aprova se área = RPA, senão em_validacao
     (projeto especial é exceção: SEMPRE em_validacao — validação humana)
  4. Notifica Google Chat
  5. Envia ao n8n (Markdown → Drive + planilha); especial vai com tipos_projeto=['especial'],
     status "Pendente" e os campos `especial` + `contexto_especial`
  6. Análise IA em background (complexidade + observações) — PULADA para projeto especial
```

## Projeto especial ("estrela do Mario Kart")

Projetos de altíssimo impacto que **não se encaixam** em saving nem receita incremental
(importantíssimos, grandes e raros). Fluxo diferenciado:

- Marcado na **Etapa 2.5** (resposta "Sim"); coleta `contexto_especial` (≥ 20 chars) —
  *por que* é alto impacto e *por que* não se encaixa em saving/receita.
- Gera documentação técnica normalmente (chat doc), mas **pula** as fases de saving/receita
  (orquestrador roteia `doc_preview → completo` quando não há saving nem receita).
- `tipo_projeto = 'especial'`, `tipos_projeto = ['especial']`, `especial = 1`.
- Status sempre `em_validacao` → "Pendente" na planilha. **Validação é humana**, não pelo analisador IA.

## Navegação entre steps

O usuário pode navegar livremente entre steps já completados sem perder o progresso do chat. Ao voltar para o Step 2 e avançar novamente:

- **Arquivos mudaram**: re-extrai texto, re-roda extractor, reinicia a fase doc
- **Metadados mudaram** (nome, área, ferramenta, etc.): persiste no banco
- **Tipo mudou** (saving ↔ receita): persiste a troca; se doc já aprovada, recomecça a fase de impacto no tipo correto

## Regras do chat

### Fase doc
- 1 pergunta por vez, cética
- Não reconfirma campos já extraídos
- Se todos 7 preenchidos → preview direto (zero perguntas)
- Na aprovação, gera resumo interno (3-5 frases) para contexto da fase 2

### Fase saving
- IA recebe linhas (cargo + horas) pré-preenchidas do formulário
- **Não pergunta** valores em R$, cargo, ou tipo_saving — já tem do form
- **Foco**: validar/desafiar as horas declaradas
  - Pede detalhamento passo a passo da rotina manual
  - Mensal: frequência × tempo por execução
  - Pontual: total de itens × tempo por item
  - Flagra discrepâncias (ex: "100 registros, 3 min cada = 5h, mas você disse 20h")
- **horas_antes = 0 é válido**: significa que ninguém fazia antes; automação faz algo novo
- Monta o memorial automaticamente

### Fase receita
- Se valor pré-preenchido no form: **desafia** ("como chegou em R$ X?")
- Se sem valor: coleta do zero via conversa
- Usa o `racional` do form como ponto de partida para aprofundar
- Agente escreve o memorial (usuário nunca redige)

## Cálculos financeiros

### Saving (`iniciarSaving`)
```
Para cada linha:
  valor_hora = CARGOS[cargo].valor  (lookup fixo)
  economia_horas = max(0, horas_antes - horas_depois)
  economia_reais = economia_horas × valor_hora

Total:
  economia_horas_mes = sum(economia_horas)
  economia_reais_mes = sum(economia_reais) - custo_externo_mensal
```

**Importante**: o cálculo em R$ **nunca é exibido ao usuário** — é métrica de gestão interna.

### Ganho total mensal (`submeterParaValidacao`)
```
saving_mensal = tipo_saving == 'pontual' ? saving_reais / 12 : saving_reais
receita_mensal = tipo == 'pontual' ? valor_ganho_mensal / 12 : valor_ganho_mensal
receita_equiv = receita_mensal / 10  (÷ 10)
ganho_total = saving_mensal + receita_equiv
```

### Memorial de cálculo
- Gerado pelo agente (não pelo usuário)
- Salvo com markdown em `documentacao.conteudo` (para preview no chat)
- Salvo **sem markdown** em `projetos.memorial_calculo` (para planilha) via `stripMarkdown`

## Regras de domínio

### Emails aceitos
Apenas `@gocase.com.br`, `@gobeaute.com.br`, `@gogroup.com.br`

### Auto-aprovação
Projetos da área "RPA" são aprovados automaticamente (`status = 'aprovado'`). Demais vão para `em_validacao`.

### Duplicatas
Bloqueada submissão se já existe projeto com mesmo nome e status != `rascunho`.

### Análise pós-submissão
- Roda em background (não bloqueia a submissão)
- Parecer salvo em `projetos.observacoes` — **staff-only, não exibido ao usuário**
- Complexidade salva em `projetos.complexidade`
- Card de análise no frontend: só mostra "Análise concluída" (sem parecer/pontuação)
- `beforeunload` impede saída acidental durante a análise

### Roles e permissões

| Role | Acesso |
|---|---|
| Admin Master | Tudo: usuários, áreas, projetos, investigador, testes |
| Leader | Dashboard com projetos das suas áreas |
| Sem role | Páginas públicas (home, submeter) |

### Ferramentas aceitas
n8n, Python, Google Apps Script, Claude + GoDeploy, Claude, Outros

### Integrações externas

| Serviço | Env var | Uso |
|---|---|---|
| n8n | `N8N_WEBHOOK_URL_SUBMIT` | Submissão → Markdown + Drive + planilha |
| n8n | `N8N_WEBHOOK_URL_UPDATE` | Observações pós-análise |
| Google Chat | `GOOGLE_CHAT_WEBHOOK_URL` | Notificação de novo projeto |
| Brevo | `BREVO_API_KEY` | Emails de aprovação/rejeição |
| OCR Worker | `OCR_WORKER_URL` | Extração de PDF |
| TeamGuide | `TG_API_TOKEN` | Sync de áreas |
