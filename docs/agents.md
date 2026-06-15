# Sistema de Agentes IA

O chat é orquestrado por uma máquina de estados que avança por fases, cada uma com um system prompt específico. Os agentes ficam em `src/lib/agents/`.

## Visão geral dos agentes

| Agente | Arquivo | Quando roda | Modelo |
|---|---|---|---|
| **Extrator** | `extractor.ts` | Antes do chat (1 chamada, temp 0) | `LLM_MODEL` (forte) |
| **Orquestrador** | `orchestrator.ts` | Cada turno do chat | `LLM_MODEL_FAST` se disponível |
| **Compilador** | `doc-compiler.ts` | Transição doc → impacto | `LLM_MODEL` (forte) |
| **Analisador** | `analyzer.ts` | Pós-submissão (background) | `LLM_MODEL` (forte) |
| **Validador** | `validator.ts` | Validação admin | `LLM_MODEL` (forte) |

## Máquina de estados (ChatFase)

```
doc → doc_preview → [transição 3s] → saving → saving_preview → receita → receita_preview → completo
```

- Só saving: doc → doc_preview → saving → saving_preview → completo
- Só receita: doc → doc_preview → receita → receita_preview → completo
- Ambos: saving primeiro, depois receita
- Roteamento decidido por `tipos_projeto` (array lido do banco a cada turno)

## Extrator (`extractor.ts`)

Pré-preenche os 7 campos da documentação a partir do material enviado (código ou docs — ambos aceitos).

### 7 campos (DocumentacaoColetada)
`nome_projeto`, `o_que_faz`, `execucao`, `dependencias`, `fluxo`, `configurar_antes`, `atencao`

### Regras de ceticismo
- **Campos técnicos** (`execucao`, `dependencias`, `fluxo`, `configurar_antes`): só o que é explícito no material
- **`o_que_faz`**: só se revela **propósito de negócio** (para quem, resolve qual problema) — descrição técnica pura fica null
- **`atencao`**: só riscos **concretos e específicos** do projeto — genéricos ("API pode falhar") ficam null
- **Na dúvida, retorna null** — campos null vão para o chat

### Estratégia para docs grandes
- ≤ 150k chars: chamada única
- \> 150k chars: **map-reduce** — divide em lotes respeitando fronteiras de arquivo, extrai em paralelo, consolida via LLM (fallback: merge determinístico com dedup)

### Parsing robusto (`parseFlexivel`)
- Tenta JSON strict → regex por campo se falhar → recupera JSON truncado no EOF
- Normaliza strings "null"/"n/a"/"none" para null real

## Orquestrador (`orchestrator.ts`)

6 system prompts (um por fase): `buildDocPrompt`, `buildDocPreviewPrompt`, `buildSavingPrompt`, `buildSavingPreviewPrompt`, `buildReceitaPrompt`, `buildReceitaPreviewPrompt`.

### Entry point
```typescript
runOrchestrator(ctx, history, fase, coletado, saving, resumoProjeto, tipos_projeto, receita)
```

### Comportamento no primeiro turno (histórico vazio)
| Situação | Comportamento |
|---|---|
| Todos 7 campos preenchidos | Gera **preview direto** (zero perguntas) |
| 5+ preenchidos | Saudação + pergunta sobre campos null |
| Parcialmente preenchido | Pergunta o campo mais importante |
| Nada preenchido | Inicia conversa |
| Saving com dados do form | Mostra dados declarados, pede detalhamento da rotina |
| Receita com valor pré-preenchido | **Desafia** o valor ("como chegou em R$ X?") |

### Respostas
Sempre JSON: `{ type, content/question, coletado/saving/receita, options? }`

Tipos:
- `question`: pergunta aberta
- `options`: pergunta com 3 opções
- `preview`: documentação/memorial formatado para aprovação
- `complete`: fase aprovada, avança

### Transições automáticas
- `type: 'preview'` → avança fase (doc → doc_preview, saving → saving_preview, etc.)
- `type: 'complete'` → próxima fase baseada em `tipos_projeto`

### Retry e parsing
- Até 3 tentativas se LLM retorna vazio
- JSON truncado: regex fallback extrai campos parciais
- Erro irrecuperável: retorna stub com mensagem de recuperação

### Temperatures
- doc / doc_preview: 0.2 (determinístico)
- saving / receita: 0.4 (conversacional)

### Regras de linguagem
- **Nunca expor nomes de campos internos** (`o_que_faz`, `fluxo`, `coletado`) ao usuário
- Linguagem natural de conversa entre colegas
- 1 pergunta por vez, cética (não aceita respostas vagas)

## Compilador (`doc-compiler.ts`)

Compila os campos coletados em `DocumentacaoGerada` (JSON estruturado com 6 seções).

- **Sem fallback**: se falhar após 3 tentativas, **throw** (documentação é obrigatória)
- Temperature: 0.3; max tokens: 8192
- Valida presença de `o_que_faz` ou `titulo`
- Seta `gerado_em` (ISO timestamp) se ausente

## Analisador (`analyzer.ts`)

Roda em background após submissão. Avalia qualidade da documentação + impacto.

### 10 critérios hardcoded
1. Propósito de negócio claro
2. Trigger definido (como e quando executa)
3. Dependências completas
4. Fluxo lógico sem lacunas
5. Configuração documentada
6. Riscos específicos (não genéricos)
7. Saving coerente (horas justificadas)
8. Ferramenta compatível com o descrito
9. Descrição alinhada com documentação
10. Completude geral

### Critérios dinâmicos
2-3 adicionais específicos do projeto (ex: "tratamento de dados sensíveis").

### Classificação de complexidade
| Nível | Descrição |
|---|---|
| `automacao` | Sem IA significativa; RPA direto |
| `inteligencia` | Usa IA para análise/decisão, mas requer intervenção humana |
| `autonomia` | Elimina/reduz drasticamente intervenção humana com IA |

### Resultado
- Aprova se ≥ 50% dos pontos
- Postura: **tende a aprovar** (plataforma existe para registrar, não barrar)
- Avalia todos os critérios mas retorna só os **top 4 hardcoded + 4 dinâmicos** (max 8)
- Parecer salvo em `projetos.observacoes` (staff-only, **não exibido ao usuário**)

## Validador (`validator.ts`)

Validação manual por admin com critérios configuráveis (carregados do DB ou defaults).

- 6 critérios default com pesos: `obrigatorio`, `importante`, `desejavel`
- Aprova se todos obrigatórios + ≥1 importante passam
- Score 0-100

## Email (`email-agent.ts`)

Templates de aprovação/rejeição via Brevo (`BREVO_API_KEY`).

- Aprovação: banner verde, tabela resumo, parecer do analista
- Rejeição: banner âmbar, critérios que falharam, próximo passo ("time de RPA entrará em contato")

## Tabela de cargos (`CARGOS` em `types.ts`)

| Cargo | R$/hora |
|---|---|
| Estagiário | 10,78 |
| Assistente | 13,94 |
| Analista Júnior | 21,29 |
| Analista Pleno | 29,90 |
| Analista Sênior | 33,10 |
| Especialista / Gestor / Head | 55,15 |
