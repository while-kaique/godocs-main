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
  4. Sincroniza direto com Google Sheets (linha na planilha) + notifica Google Chat
     (via Service Account, `src/lib/google/` — substitui o antigo n8n); especial vai
     com tipos_projeto=['especial'], status "Pendente" e `especial` + `contexto_especial`
  5. Análise IA em background (complexidade + observações) — PULADA para projeto especial
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

### Fase saving (memorial padronizado)
- IA recebe linhas (cargo + horas) pré-preenchidas do formulário
- **Não pergunta** valores em R$, cargo, ou tipo_saving — já tem do form
- **Foco**: coletar pontos obrigatórios do memorial padronizado na ordem fixa
- **Estrutura fixa do memorial de saving:**
  - Seção 1 — Contexto: [1.1] Nome do projeto, [1.2] Resumo
  - Seção 2 — Saving de Pessoas: [2.1] Lista de pessoas, [2.2] Por pessoa (rotina, frequência, cálculo, antes/depois, economia), [2.3] Totais
  - Seção 3 — Contratos/Serviços Evitados: [3.1] O que, [3.2] Valor, [3.3] Rateio (ou N/A)
  - Seção 4 — Custo da Automação: [4.1] Ferramenta, [4.2] Monitoramento, [4.3] Total (ou N/A)
  - Seção 5 — Resumo: [5.1] Economia bruta de horas, [5.2] Tipo
- IA **insiste** até ter resposta para cada ponto. Se o usuário for raso, preenche com o que tem — mas nunca pula
- **horas_antes = 0 é válido**: significa que ninguém fazia antes; automação faz algo novo
- Monta o memorial automaticamente — usuário nunca redige
- **Memorial duplo**: o preview mostra o memorial SEM R$. O `projetos.memorial_calculo` (planilha) recebe a versão enriquecida com R$ via `enriquecerMemorial()` (backend injeta valor/hora × economia = R$)

### Fase receita (memorial padronizado)
- **Estrutura fixa do memorial de receita:**
  - Seção 6 — Receita Incremental: [6.1] O que gera, [6.2] Como aumenta, [6.3] Antes vs. depois, [6.4] Base de cálculo, [6.5] Valor, [6.6] Tipo
- Se valor pré-preenchido no form: **desafia** ("como chegou em R$ X?")
- Se sem valor: coleta do zero via conversa
- Usa o `racional` do form como ponto de partida para aprofundar
- IA **insiste** em cada ponto antes de gerar preview
- Agente escreve o memorial (usuário nunca redige)

## Cálculos financeiros

### Saving (`iniciarSaving` / `recomputarSavingFinanceiro`)
```
Para cada linha:
  valor_hora = CARGOS[cargo].valor  (lookup fixo)
  economia_horas = max(0, horas_antes - horas_depois)
  economia_reais = economia_horas × valor_hora

Custo evitado (ganho monetário além das horas — coletado no FORMULÁRIO de saving):
  Para cada ferramenta evitada (custo_evitado_itens):
    item_mensal = recorrencia == 'pontual' ? valor / 12 : valor
  custo_evitado_reais = sum(item_mensal)   // já mensalizado → entra cheio no recálculo

Total:
  economia_horas_mes = sum(economia_horas)
  economia_reais_mes = sum(economia_reais) + custo_evitado_reais - custo_externo_mensal
```

- **Custo evitado** = dinheiro que a empresa DEIXOU de gastar (ferramenta/serviço externo que a solução tornou desnecessário). É saving (soma), não receita. Distinto do `custo_externo_mensal` (custo INCORRIDO pela automação, que subtrai) e do `servico_externo` (ferramenta USADA pela automação).
- **Coletado no formulário de saving** (3º tópico, abaixo de "Alguém já fazia"): pergunta obrigatória Sim/Não; se Sim, lista incremental de ferramentas com `nome → valor → recorrência (mensal/pontual) → justificativa`. O backend (`iniciarSaving`) mensaliza cada item — **pontual ÷12**, mensal cheio — soma em `custo_evitado_reais` e persiste `custo_evitado` (sim/não), `custo_evitado_justificativa` (texto) e `custo_evitado_itens` (JSON).
- O agente NÃO pergunta mais custo evitado (vem do form): apenas reconhece e descreve qualitativamente no memorial, sem R$ (preserva os campos estruturados).
- **Importante**: o cálculo em R$ **nunca é exibido ao usuário** — é métrica de gestão interna. A versão do memorial salva na planilha (`projetos.memorial_calculo`) é enriquecida pelo backend com valores financeiros via `enriquecerMemorial()` — o LLM nunca gera R$ no texto visível.

### Ganho total mensal (`submeterParaValidacao`)
```
saving_mensal = saving_reais                 (valor cheio — já inclui custo evitado e abate custo externo)
receita_equiv = valor_ganho_mensal / 10      (÷ 10; NÃO mensaliza por 12, mesmo se pontual)
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
| Google Sheets | `GOOGLE_SA_KEY_BASE64`, `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_TAB` | Submissão → linha na planilha (Service Account, `src/lib/google/`). Substitui o antigo n8n |
| Google Chat | `GOOGLE_CHAT_WEBHOOK_URL` | Notificação de novo projeto / pós-análise |
| Brevo | `BREVO_API_KEY` | Emails de aprovação/rejeição |
| OCR Worker | `OCR_WORKER_URL` | Extração de PDF |
| TeamGuide | `TG_API_TOKEN` | Sync de áreas |
