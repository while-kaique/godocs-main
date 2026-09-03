# Sistema de Agentes IA

## ⚠️ ARQUIVO — o que a v2 tira do fluxo de submissão (e como recuperar)

> **A v2 DESLIGA o agente da submissão; ela NÃO apaga os agentes.** Decisão do Luis, 02/09/2026: *"não vamos
> excluir os agentes, vamos tirá-los do fluxo de submissão novo, mas vamos reaproveitá-los eventualmente"*.
> Esta seção existe para que o trabalho e a ARQUITETURA não se perdam quando a T9 desconectar o chat — e para
> que ninguém precise reconstruir por arqueologia o que já está escrito.

**Marco no git (o backup):** a tag **`arquivo/agentes-conversacionais-v1`** aponta para o último commit em que
todo o fluxo conversacional está VIVO e funcionando em produção. Recuperar qualquer arquivo é
`git show arquivo/agentes-conversacionais-v1:<caminho>`; ver a árvore inteira,
`git ls-tree -r arquivo/agentes-conversacionais-v1 src/lib/agents`.
⚠️ A tag é **local até a branch `feat/godocs-v2` ser pushada** (o gate de revisão barra o push hoje). Enquanto
isso, o backup vive no clone desta máquina + nesta seção.

**Regra de execução da T9:** arquivo que a T9 REMOVER do código efetivo é **copiado no MESMO commit** para
`docs/arquivo/agentes-conversacionais/` — nada fica só no histórico. Nenhum arquivo de agente/gate/prompt é
deletado sem o Luis pedir.

### Inventário do que compõe o fluxo conversacional (linhas em 02/09/2026)

| Arquivo | Linhas | O que carrega |
|---|---|---|
| `src/lib/chat.functions.ts` | 4597 | as rotas de conversa (`iniciarSubmissao`, `enviarMensagem`, `iniciarSaving`, `iniciarReceita`, `submeterParaValidacao`) **e os 7 gates determinísticos** |
| `src/lib/agents/orchestrator.ts` | 1757 | o orquestrador: prompts por fase, retry/regex, `TAXONOMIA_DESTINO_GANHO`, `BLOCO_SECOES_CRITERIO`, `blocoGanhoRealProjetado`, `mensagemMemorialPronto` |
| `src/lib/submeter/step3-chat.tsx` | 2800 | a TELA do chat + o `SavingForm` da v1 (a linguagem visual que a v2 reaproveita) |
| `src/lib/agents/analyzer.ts` | 921 | o analisador pós-submissão (complexidade, critério de projeto, `normalizarClassificacao`) |
| `src/lib/agents/custo-evitado-chat.ts` | 454 | gate do custo evitado declarado no chat (caso SmartOnline/DIFAL) |
| `src/lib/agents/ganho-projetado.ts` | 413 | gate ganho real × projetado (2 hooks, anti-loop) |
| `src/lib/agents/sobreposicao-receita.ts` | 273 | gate receita × custo evitado (caso Sucesso.AI) |
| `src/lib/agents/memorial-format.ts` | 325 | `MEMORIAL_ESQUELETO` — a estrutura do memorial por modo |
| `src/lib/agents/types.ts` | 446 | `CARGOS`/`valor_hora`, os 8 estados de gate, os tipos do financeiro da v1 |
| `src/lib/agents/{extractor,doc-compiler,doc-render,validator,saving-calc,email-agent}.ts` | 328·155·124·116·242·120 | extração, compilação e render da doc, validação, `resolverValorHora`, e-mails |

⚠️ **Fora do escopo da T9, e é importante não confundir:** os agentes de **avaliação** (mesa, cético,
especialista, agregador, redator) e os de **especiais** (classificador, lentes, calibrador, revisor) **não
têm nada a ver com o chat de submissão** — eles rodam pós-submissão, em batch/cron, e seguem em produção.

### Onde está o "por quê" de cada gate
Os 7 gates são a parte mais caro-de-reconstruir, e a razão de cada um (com o caso real que o originou) está
escrita no **`CLAUDE.md`**, seção *Memorial padronizado* — **fonte única, não reescrita aqui**: base CLT
220h/mês (jornada + teto por pessoa) · economia alta ≥44h (alocação dos ganhos) · carga real × ganho por
escala · ganho real × projetado · sobreposição receita × custo evitado · custo evitado declarado no chat ·
critério de projeto `[1.3]`/`[1.4]`. Cada bloco lá tem o *"origem: caso X"* que explica por que o prompt
sozinho não segurava — é essa memória que torna o código reaproveitável em vez de curioso.


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

Régua de **dois eixos** sobre o TRABALHO (não pela ferramenta nem por impacto) — ver [spec-docs/SPEC_COMPLEXIDADE_NIVEIS.md](../spec-docs/SPEC_COMPLEXIDADE_NIVEIS.md):

| Nível | Descrição |
|---|---|
| `automacao` | Determinístico: chega até a INFORMAÇÃO/output (extrai, calcula, mostra, alerta, recomenda) e entrega para um humano decidir/agir. Sem IA como funcionalidade **e** sem tomar a ação consequente. Dashboard/RPA/alerta-por-regra entram aqui, mesmo 24/7 ou de alto impacto. |
| `inteligencia` | Usa **IA como funcionalidade** (gera/classifica/extrai/transcreve/recomenda como parte do que entrega), mas o **humano conduz**: abre a tela/fila/chat e age sobre o output. |
| `autonomia` | Toma a **AÇÃO consequente na última ponta sozinho** (fecha o caso / atua sobre o objeto do processo, sem um humano confirmar) — **com OU sem IA** (a decisão pode ser IA ou árvore de lógica determinística). |

**Eixo AÇÃO tem precedência sobre o eixo IA:** a ação na ponta vem primeiro na árvore e define a autonomia, independente de IA (revertendo o gate antigo `usa_ia===false → automacao`). Dois sinais alimentam a decisão: `usa_ia` (eixo IA — automacao↔inteligencia) e `acao_autonoma` (eixo ação — → autonomia), normalizados por `normalizarComplexidade` (função pura): rebaixa autonomia sem ação consequente, força automacao sem IA, eleva automacao→inteligencia com IA — **nunca** força-promove autonomia. A resposta explícita do usuário (`tem_ia_como_funcionalidade`, coletada na fase doc) tem precedência sobre o `usa_ia` inferido.

### Classificação de CRITÉRIO DE PROJETO (elegibilidade — "isto é projeto?")

Julgamento **independente** da pontuação, pela régua **recorrência · contrafactual · rastreabilidade** — ver
[spec-docs/SPEC_CRITERIOS_PROJETO.md](../spec-docs/SPEC_CRITERIOS_PROJETO.md) e a
[régua para a gestão](criterios-projeto-recorrencia-evidencia.md). Entrada determinística da Etapa 2:
`contrafactual_afetados` (quem sentiria falta) + as seções "Processo alterado" e "Ponteiro movido e onde
verificar" do memorial. ⚠️ `ponteiro_movido`/`ponteiro_evidencia`/`contrafactual_reclamacao` são **LEGADO**:
saíram do formulário (o "o que piora" em 03/08/2026) e o analisador extrai o efeito de desligar da
doc/memorial — não voltar a cobrá-los no prompt. Saída: `classificacao_avaliacao` ∈ `claro_sim` | `zona_cinzenta` | `claro_nao`,
`classificacao_justificativa` (**sempre**) e `motivo_reprovacao` (só na reprovação, escrito para o AUTOR ler).

`normalizarClassificacao` (pura) rebaixa para `zona_cinzenta` quando a reprovação vem **sem motivo**, quando
o projeto é **especial**, quando a materialidade passa de **R$ 5k/mês** ou quando o valor é inválido — e
preenche a justificativa por fallback (a coluna `Classificação` nunca fica vazia). `decidirStatusSubmissao`
(pura) resolve o status interno **e** o rótulo da coluna Status juntos: `claro_nao` → `rejeitado` +
**"Reprovado"** (única exceção à regra TEMPORÁRIA do "Pendente"); `zona_cinzenta` → `em_validacao`;
`claro_sim` → fluxo atual. **Simplicidade não reprova** e a triagem humana sobrepõe tudo no `/dashboard`.

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
| Supervisor | 42,75 |
| Especialista+ | 55,15 |
