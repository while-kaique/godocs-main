# Spec — Registro de Correções (GoDocs)

> **Documento vivo.** Uma entrada por correção de bug relevante (regra 12 do `CLAUDE.md`:
> "Specs — consultar antes, atualizar a CADA implementação"). Formato fixo:
> **sintoma → causa-raiz → fix → onde aterrissou → status/PR**. Mais recente no topo.

---

## 2026-06-29 — "Saving Horas Escalado" sempre 0 p/ contrafactual + zeros ambíguos + splits inválidos

**PR:** _(a abrir)_ · **Status:** 🔧 implementada, em revisão · **Branch:** `fix/split-nao-contrafactual`

### Parte B — auditoria dos splits capturados: números inválidos / mal classificados

**Sintoma:** o chefe achou estranhos alguns valores de Real/Escalado **já preenchidos**. Auditei as
**26 linhas com split capturado** na planilha de produção.

**Achados:** a soma `Real+Escalado = Total` bate em todas (sem erro aritmético); o problema é
**semântico**, concentrado em **Escalado > 0** (quando o agente tenta *dividir*):
- 🔴 **`f4dd86…`** (`107.8h · real=108.2 · esc=0`): **carga real MAIOR que o total** (impossível) +
  conta errada no texto (49+73,6 ≠ 108,2). Caso "fez tudo" → real deve ser ≤ total. **Erro de número.**
- 🟠 **`legado-189`** (`22h · real=22 · esc=0`): os **números já estavam certos** (fez o volume todo),
  mas a **justificativa narrava** *"~1h por dia → 1h real / 21h escala"* — **inconsistência texto × número**
  por confusão dia × mês no raciocínio do agente. Justificativa corrigida; números mantidos.
- 🟡 **`legado-231`** (1/10) e **`faff95…`** (6/26): escala 91%/81% mal fundamentada (questionáveis,
  deixados p/ o time confirmar).
- ✅ Os 13 casos `'sim'` com escala 0 (fez o volume todo) e os 6 `'nao'` (100% escala) estão corretos.

**Causa-raiz:** o gate aceitava o nº da carga real **sem validar** e derivava `escala = total − real`
mecanicamente. Sem checagem de plausibilidade, "1h/dia" virava real=1 (escala fantasma); e o caminho
"split capturado pelo LLM" aceitava `real > total` (só conferia a SOMA, com tolerância 1h).

**Fix (trava de plausibilidade — "corrigir o agente que classifica errado"):**
- **`precisaConfirmarEscala(real,total)`** (`orchestrator.ts`, `LIMITE_ESCALA_ALTA=0.6`): escala ≥60%
  do total → exige **confirmação** (novo estado `carga_escala='confirmar_escala'`). 3 opções:
  confirma a escala / "fazia o volume todo" (→ real=total) / "corrigir" (reabre a pergunta).
- **Clamp `real ≤ total`** no caminho LLM-capturado (re-deriva a escala) → mata o `real>total`.
- **Pergunta da carga real reforça "total no MÊS, não por dia"** (`perguntaCargaEscala`).
- Pega `189` (escala 95% → confirma/corrige), `f4dd86` (clamp), e sinaliza `231`/`faff95`.

**Dados existentes:** os 2 erros claros (`legado-189`, `f4dd86`) foram corrigidos direto na planilha
para `real=total / escala=0` (colunas de transparência — não afeta R$). Durável quando reeditados
pós-deploy. Os 2 questionáveis ficaram p/ revisão do time RPA.

### Parte A — contrafactual ('nao') gravava 0/0 + zeros ambíguos

**Sintoma (relatado pela gestão):** o chefe estranhou a **veracidade** das colunas "Saving Horas
Real"/"Saving Horas Escalado". Dois pontos: (1) projetos onde **ninguém fazia** (`alguem_fazia='nao'`)
não tinham as horas contadas como escala; (2) **muitos** projetos com `alguem_fazia='sim'` saíam com
**Escalado=0** — parecia que a feature não media nada.

**Diagnóstico (planilha de produção, 298 linhas, fora E2E):**
- 213 linhas (71%) são **legado** com "Alguém Fazia?" vazio → split `0/0` (nunca passou pelo gate).
- `'sim'` (63): **60 com Escalado 0/null**. Destes, ~19 são **zeros legítimos** (a pessoa fazia o
  volume TODO à mão → escala 0 correta) e ~43 têm **AMBOS null** = split **nunca capturado** (legado
  + submissões pré-feature de 19–24/06). Para submissões **novas (25/06+) o gate captura** o split
  corretamente — a feature em si é confiável para o fluxo novo.
- `'nao'`/`'não'` (22): real sempre 0; **~6 linhas com Escalado=total** e justificativa manual
  ("Como Alguém Fazia=Não, todo o saving é escala") — **incoerente com o código**, que força 0 para
  `'nao'`. Eram preenchimentos manuais compensando a ausência da regra.

**Causa-raiz:** (a) **Coerência do `'nao'`** — `temSplit` em `sync.ts` exigia `alguem_fazia==='sim'`,
então contrafactual gravava `0/0`. Mas, por definição, **ninguém fazia à mão ⇒ carga real 0 e 100%
do saving é ganho por escala** → o esperado é `Real=0, Escalado=total`. (b) **Zeros ambíguos** — a
coluna numérica colapsa três situações no mesmo `0`: "sem escala" (real=total, legítimo), "não medido"
(legado/pré-feature, null→0) e contrafactual. Só a coluna de justificativa (vazia nos não-medidos)
desambiguava.

**Fix:** regra do `'nao'` virou **derivação determinística** (decisão de produto, Luis 29/06/2026:
`'nao'` → 100% escala). Helper puro `derivarSplitHorasSheet(alguemFazia, saving)` em `sync.ts`:
`'sim'` usa o split capturado pelo gate; **`'nao'` → `Real=0, Escalado=total`**; `'externo'`/legado-
sem-split/pontual → `0/0` (sem dado medido, não inventa). Roda em `syncSubmitToGoogle`, que é o
caminho de **submissão nova E de edição/resync** → vale **daqui pra frente** sem backfill (zeros
antigos só mudam quando o projeto for editado — decisão do dono). A justificativa do `'nao'` ganhou
fallback próprio em `derivarJustificativaCargaEscala` (em vez de "—" ao lado de um Escalado cheio).
⚠️ O **gate do chat** (`aplicaSplitCargaEscala`) **continua só `'sim'`** — no contrafactual não há o
que perguntar; a regra do `'nao'` é pura derivação no sync.

**Onde aterrissou:**
- `src/lib/google/sync.ts` — novo `derivarSplitHorasSheet` (exportado) + uso em `syncSubmitToGoogle`
  (substitui o `temSplit` inline).
- `src/lib/chat.functions.ts` — `derivarJustificativaCargaEscala`: branch `'nao'` (justificativa
  "100% escala").
- `tests/sync-padronizacao.test.ts` — 5 casos de `derivarSplitHorasSheet`.
- `CLAUDE.md` (seção carga×escala) + `SPEC_FEATURES_NOVAS.md` (F4) atualizados. `worker.js` rebuildado.

**Notas / não-regressão:**
- **NÃO** altera `saving_reais`/`ganho_total`/`linhas` — F4 segue: o TOTAL é o que vira R$ (decisão
  fechada). As colunas do split são só transparência.
- `aplicaSplitCargaEscala` e o prompt do gate ficam intactos → `tests/saving-carga-escala.test.ts`
  segue verde (`'nao'`/`'externo'` ainda FALSE no gate de conversa).
- Sem migração/coluna nova; sem backfill (decisão do dono — propaga por edição).

### Parte C — gate da carga real não entendia "100%" / "nada escalado"

**Sintoma (reportado, com print):** ao responder o gate da carga real com **"100% das horas eram na
mão"** (= tudo manual, nada escalado), o agente **não entendia e perguntava de novo** — o usuário
ficava repetindo algo que já tinha respondido.

**Causa-raiz:** `interpretarCargaReal` só reconhecia `tudo`/`o total` ou um **número de horas**. "100%"
caía no parser de números → **"100" > total** (ex.: total 35h) → rejeitado → `null` → **re-pergunta**.
E não havia tratamento para "nada escalado"/"sem escala"/"tudo na mão".

**Fix:** `interpretarCargaReal` movida p/ `orchestrator.ts` (pura/testável) e ampliada — reconhece, em
ordem: (1) **porcentagem** ("100%", "50% na mão", "100 por cento" → fração do total; última % vence,
cobre "não era 100%, era 50%"); (2) **"nada/sem/nenhuma escala"** e **"não foi escalado"** → carga real
= total; (3) "fez tudo à mão / tudo manual / volume todo / tudo real" (com guard de negação — "não fazia
tudo" NÃO vira total); (4) números (como antes). Também corrigido um **bug de tipo+lógica** no
`interpretarConfirmacaoEscala` do novo sub-gate: `selected_option` é índice **1-based** (`z.number()`),
não a string da opção — casava por `indexOf(string)` e os **botões nunca bateriam**. 6 testes novos
(`tests/saving-carga-escala.test.ts`), incl. o caso exato do print.

---

## 2026-06-26 — Edição de legado reiniciava a doc ao voltar da parte determinística

**PR:** #168 · **Status:** ✅ mergeada + deployada · **Branch:** `fix/reset-doc-edicao-legado`

**Sintoma (relatado):** uma usuária entrou para **editar um projeto legado**, passou da fase de
doc, preencheu a parte determinística e, já no chat com a IA, lembrou que precisava **adicionar
um analista** e voltou à parte determinística. Ao avançar de novo para o chat, **o sistema
reiniciou TUDO desde a doc** — como se a documentação tivesse mudado — e ela **teve que enviar os
arquivos novamente** (perdendo o saving já preenchido).

**Causa-raiz:** desync entre `arquivos: File[]` e `agentArquivosSig` em `handleContinuarAgente`
(`src/routes/submeter.tsx`). A detecção de "arquivos mudaram" era
`arquivosSig() !== agentArquivosSig`. Quando a página **remonta no meio da edição** (recurso
"reload não perde o chat"), o `rehydrateFromLocal` **restaura `agentArquivosSig`** do rascunho
(ex.: `"arquivo.json:11975"`), mas o `arquivos: File[]` **não pode ser restaurado** — objetos
`File` não serializam para o localStorage (não estão no `DraftSnapshot`). Resultado:
`arquivosSig()` vira `""`, a comparação dá "mudou" falsamente e força o reprocesso da doc.
Específico de **legado** porque legado **obriga upload** na edição (não tem doc/`arquivos_nomes`
prévios), então `agentArquivosSig` sempre fica preenchido — projeto já documentado não sobe
arquivo e não desincroniza. Como `reprocessarComNovosArquivos` é no-op sem `File[]`
(`if (arquivos.length === 0) return;`), o primeiro "Continuar com Agente" pós-remontagem só
**travava** (early-return, sem chamada ao servidor → invisível nos logs); para destravar, a
pessoa reenviava o arquivo, e aí o reprocesso rodava de verdade e zerava a doc + o saving.

**Fix:** só disparar a detecção quando há arquivo NOVO de fato — guard `arquivos.length > 0`:

```js
if (projetoId && arquivos.length > 0 && arquivosSig() !== agentArquivosSig) {
  await reprocessarComNovosArquivos();
  return;
}
```

Sem upload novo (inclusive pós-reload) → não reprocessa, segue o fluxo normal (reabre o form de
saving / preserva o chat). Com upload real → `arquivos.length > 0` + assinatura diferente →
reprocessa corretamente (comportamento legítimo mantido).

**Onde aterrissou:**
- `src/routes/submeter.tsx` — `handleContinuarAgente`: guard `arquivos.length > 0` nas DUAS
  detecções de troca de arquivos (ramo **padrão** e ramo **projeto especial**).
- Frontend-only (não toca `worker.js`/backend). Sem migração, sem coluna nova.

**Notas / não-regressão:**
- Diagnóstico só por código: a janela de logs do Godeploy (~1,5h) não capturou o incidente
  (variante "travada" não faz request); o padrão de risco aparece (ytalo.ferreira editando
  legado-194/196 com upload de arquivo).
- Sem teste unitário novo: a lógica é inline no componente e a base de testes é node-only (sem
  testing-library/jsdom). `reprocessarComNovosArquivos` continua com o early-return defensivo.
