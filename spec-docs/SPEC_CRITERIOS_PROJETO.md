# SPEC — Critério de projeto: perguntas-chave, classificação da avaliação e reprovação com motivo

> **Documento de planejamento/decisão.** Decisões fechadas com o Luis em **2026-07-29**.
> Plano de execução: [`docs/plans/criterios-projeto-classificacao.md`](../docs/plans/criterios-projeto-classificacao.md).
> Régua para a gestão: [`docs/criterios-projeto-recorrencia-evidencia.md`](../docs/criterios-projeto-recorrencia-evidencia.md).
> Status: ✅ **implementado** (código + testes + build) · ⏳ validação em staging → prod · ⏳ **régua a
> calibrar com o Rafa antes de produção** (reprovar projeto é visível ao autor).

## 1. Problema

A gestão (Rafa) apertou o critério de projeto depois de submissões que não deveriam ter entrado — o
caso-símbolo é uma **nuvem de palavras** gerada uma vez para uma apresentação. A régua dele tem 3
critérios: **recorrência**, **contrafactual** e **rastreabilidade**; o impacto **não precisa ser receita**.

O sistema não colhia rastreabilidade nem contrafactual de forma estruturada, e o analisador só decidia
"aprovado / rejeitado" **por pontuação de qualidade da documentação** — não existia juízo de
**elegibilidade** ("isto é projeto?"). Um artefato de uso único, bem documentado, era aprovado.

## 2. Decisões fechadas (NÃO "corrigir" por engano)

- **D1 — `claro_nao` → `Reprovado` é a ÚNICA exceção à regra TEMPORÁRIA do "Pendente".** A regra do
  `CLAUDE.md` (gravar sempre "Pendente" na coluna Status) **permanece** para todo o resto — inclusive
  aprovados e zona cinzenta. Não encerrar a regra TEMPORÁRIA por conta desta feature.
- **D2 — O analisador decide; o humano sobrepõe** no `/dashboard`. Zona cinzenta → `em_validacao`.
- **D3 — A classificação é SEMPRE explicada**, qualquer que seja o resultado (D4 do Luis: _"é bom o agente
  explicar bem explicado o porquê da classificação, independente de qual for"_). A coluna `Classificação`
  nunca fica vazia — há fallback determinístico quando o LLM não devolve texto.
- **D4 — Barrar submissão no formulário continua FORA, em definitivo.** A reprovação é **pós-envio**.
  As 3 perguntas novas da Etapa 2 são de resposta **obrigatória**, mas **nenhuma resposta barra**:
  "Nenhum / ainda não sei" passa e vira sinal forte para o analisador.
- **D5 — Onde perguntar.** Ponteiro movido + onde verificar + contrafactual → **Etapa 2** (formulário
  determinístico). "Que processo mudou e quanto" → **agente** (seção do memorial).
- **D6 — 3 colunas novas na planilha**, criadas à mão pelo Luis nas abas `GoDocs` **e** `STAGING`:
  `Motivo Reenvio` (**só humano** — o sistema NUNCA escreve, como as colunas de Diff) ·
  `Motivo Reprovado` (sistema + triagem) · `Classificação` (sistema, sempre com texto).
- **D7 — `Observações` continua reservada ao parecer.** Os motivos vão em coluna PRÓPRIA. `Observações` é
  o texto que o **disparo de e-mails** do segmento `reenvio` usa como motivo — sequestrá-la quebraria o
  e-mail (ver `SPEC_DISPARO_EMAILS.md`).
- **D8 — Não mexer no `CHECK` de `projetos.status`** (`rascunho|em_validacao|validado|rejeitado|aprovado`):
  trocar exigiria rebuild da tabela. O discriminador real da reprovação é a coluna nova
  `projetos.classificacao_avaliacao`; `rejeitado` segue significando "não aprovado".
- **D9 — Os guards da normalização agem só sobre `claro_nao`.** Especial e materialidade alta impedem a
  **reprovação automática**; NÃO rebaixam um `claro_sim` legítimo (o gate de materialidade continua agindo
  no **status**, não na régua de elegibilidade).
- **D10 — O autor vê o motivo** (T6, confirmado pelo Luis): reprovar sem mostrar o porquê gera ticket de
  suporte. Motivo aparece no card de "Meus Projetos" e na tela read-only `/projeto/$id`.

## 3. Onde aterrissou

### 3.1 Etapa 2 — 2 perguntas determinísticas (padrão `usa_ai_proxy`)

| Pergunta | Campo | Coluna SQLite |
|---|---|---|
| "Este projeto moveu sensivelmente o ponteiro de quê?" (cards multi: Custo · Receita · KPI da área · Nenhum/ainda não sei) | `form.ponteiroMovido` | `ponteiro_movido` (lista `;`) |
| "Onde isso pode ser verificado?" (só quando há ponteiro concreto) | `form.ponteiroEvidencia` | `ponteiro_evidencia` |
| "Se desligar isso hoje, quem reclama — e o que piora?" | `form.contrafactualReclamacao` | `contrafactual_reclamacao` |

- UI: `src/lib/submeter/step2.tsx` · validação pura em `validarEtapa2` (`submeter/constants.ts`) ·
  opções em `PONTEIROS_MOVIDOS`.
- **"Nenhum" é mutuamente exclusivo** com os 3 ponteiros concretos e dispensa a evidência.
- As perguntas **não** entram em `camposMinimosDocProntos` — o processamento da doc em background continua
  disparando assim que o arquivo é anexado.
- **Reuso:** o card de checkbox (checkbox lateral + título + descrição) foi **extraído** da Etapa 2.5 para
  `CardCheckboxGroup` (`submeter/form-components.tsx`) e agora serve às duas telas — a marcação era
  duplicada. Feedback registrado: opção com descrição **nunca** é texto solto.

### 3.2 Agente — seção "Processo alterado"

`MEMORIAL_ESQUELETO` (`agents/memorial-format.ts`, **fonte única**) ganhou a seção **obrigatória nos 3
modos** (`saving`, `custo_evitado`, `receita`) + código `1.3` em `TITULOS_MEMORIAL`. Os prompts
(`orchestrator.ts`) trazem a instrução **anti-redundância**: se a documentação aprovada já descreve o
processo **e** a magnitude, o agente escreve a seção **sem perguntar**; só pergunta quando falta a
magnitude, no **máximo 1 pergunta**. (Baseline de 6,4 perguntas/submissão não deve piorar —
`docs/analise-perguntas-agente.md`.)

### 3.3 Analisador — classificação em 3 níveis

- Bloco de prompt **"RÉGUA DE CRITÉRIO DE PROJETO"** (`agents/analyzer.ts`): os 3 critérios, a taxonomia de
  impacto (horas · custo · erro · retrabalho · fraude/risco · prazo · receita), o aviso de que
  **simplicidade não reprova** e os exemplos-âncora (nuvem de palavras, cronômetro → `claro_nao`).
- Saída JSON nova: `classificacao_avaliacao` · `classificacao_justificativa` (SEMPRE) ·
  `motivo_reprovacao` (só `claro_nao`).
- **`normalizarClassificacao()`** — pura, espelho de `normalizarComplexidade`. Rebaixa para
  `zona_cinzenta` quando: (1) reprovação **sem motivo**; (2) projeto **especial**; (3) materialidade
  **> R$ 5k/mês**; (4) valor ausente/inválido. Justificativa vazia → **fallback determinístico**.
- **`decidirStatusSubmissao()`** — pura: decide o status interno **e** o rótulo da coluna Status de uma só
  vez (não duplicar a precedência em dois lugares — foi assim que os dois já divergiram).

| Classificação | Status interno | Coluna Status |
|---|---|---|
| `claro_nao` | `rejeitado` | **`Reprovado`** ← única exceção nova |
| `zona_cinzenta` | `em_validacao` | `Pendente` |
| `claro_sim` | fluxo atual (veredito/materialidade) | `Pendente` |

### 3.4 Sync + reconciliação

- `SHEET_COLUMNS` += as 3 colunas (mapeamento **por NOME** — grafia conferida nas duas abas em 29/07/2026:
  `AV Motivo Reenvio` · `AW Motivo Reprovado` · `AX Classificação`, acentos precompostos).
- `derivarClassificacaoSheet(classificacao, justificativa)` monta `"Claro não — <justificativa>"`; ausente
  → `"—"`. `syncSubmitToGoogle` grava as 2 do sistema no append/update; `syncUpdateToGoogle` as regrava
  quando o analisador conclui (parâmetros opcionais: `undefined` = não toca a célula).
- **`Motivo Reenvio` nunca é escrita pelo sync** — só pelo `/dashboard`.
- `reconciliarComplexidade` (cron de 1 min) passa a repor **`Classificação`/`Motivo Reprovado`** vazias,
  do espelho SQLite — mesma rede de segurança da Complexidade (a análise em background pode ser cancelada
  antes do sync).
- **Sync reverso:** nenhuma das 3 entra em `SAFE_UPDATE_FIELDS`. `Motivo Reenvio` vive **só** na planilha;
  `Classificação`/`Motivo Reprovado` são regravadas pelo sistema na próxima submissão/resync — **edição
  manual dessas duas é sobrescrita** (comportamento aceito).

### 3.5 `/dashboard` (triagem) e a visão do autor

- `COLUNAS_ESCRITAS` += `Motivo Reenvio`, `Motivo Reprovado`. O modal abre o campo de motivo conforme o
  status escolhido (`Reenvio Pendente` → "Motivo do reenvio"; `Reprovado` → "Motivo da reprovação",
  sobrepondo o do analisador). `Observações` **intacta**. A auditoria `admin_status_log` registra o motivo
  quando não há parecer.
- Ficha do projeto exibe `Classificação` + os 2 motivos.
- **Autor:** `mapItem` devolve `motivo_reprovado`/`motivo_reenvio`; o card de "Meus Projetos" ganhou o
  aviso **"Projeto reprovado"** (cinza-ardósia, ícone `Ban` — estado nunca só por cor) com o motivo, e a
  tela `/projeto/$id` mostra o bloco de motivo. Na LISTA os motivos vêm da planilha (incluem a
  sobreposição da triagem); no DETALHE, do espelho SQLite (uma sobreposição manual aparece lá após o
  próximo resync).

## 4. Testes

- `tests/criterios-classificacao.test.ts` — invariantes de `normalizarClassificacao` (nunca reprova sem
  motivo · especial · materialidade · valor inválido · fallback da justificativa) e a precedência de
  `decidirStatusSubmissao` (inclui um varredor "nunca devolve Reprovado para quem não é `claro_nao`").
- `tests/criterios-projeto.test.ts` — colunas no `SHEET_COLUMNS`, `derivarClassificacaoSheet`, a seção
  "Processo alterado" no esqueleto e os motivos em `mapItem`.
- `tests/validacao-etapa2.test.ts` — as 3 perguntas novas, com o caso central: **"Nenhum / ainda não sei"
  passa**.
- `tests/dashboard-admin.test.ts` — motivos em coluna própria **sem tocar** `Observações`/`Atualizado Em`.

## 5. Pendências

1. **Calibrar a régua com o Rafa** antes do deploy em produção (fronteira `claro_nao` × `zona_cinzenta`).
2. Validar em **staging (`edf400b4`)** os 3 cenários (nuvem de palavras → Reprovado · saving recorrente →
   Claro sim/Pendente · ganho sem fonte → Zona cinzenta) e conferir que **nenhuma outra coluna mudou**.
3. **Harness E2E** (`scripts/e2e/`) valida colunas A→AS — as 3 novas ainda não estão nos asserts.
4. Frente **paralela** [`perguntas-agente-recorrencia-evidencia`](../docs/plans/perguntas-agente-recorrencia-evidencia.md):
   **A1** (o gate da alocação precisa aceitar "menos custo" — a taxonomia de impacto escrita aqui é
   reaproveitável) e **A2** (materialidade nos gates) seguem pendentes de código.
