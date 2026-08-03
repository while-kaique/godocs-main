# Plano — "Motivo Reenvio" segue o padrão "texto vazio → —"
**Status:** 🟡 **T1–T4 executados** (2026-08-03) — código, testes e docs prontos na branch
`fix/motivo-reenvio-traco` (commit `a6e19f1`, 805 testes verdes, `worker.js` rebuildado).
**T5 PENDENTE por decisão do Luis:** esperar a frente paralela (outra janela) antes de
staging `edf400b4` → prod `674a3710` → PR — `updateApp` substitui a app INTEIRA.

**Objetivo:** a coluna **"Motivo Reenvio"** deixa de nascer em BRANCO na planilha — o
append da IDA a inicializa com **"—"** e o write-back da triagem grava "—" quando o
admin limpa o motivo, sem nunca apagar um motivo escrito por humano.

### Contexto (o que houve)
Todas as colunas de TEXTO da planilha passam por `padronizarLinha` (`src/lib/google/sync.ts`):
vazio/`-`/`—` → **"—"**. "Motivo Reenvio" **nunca entra no payload** — foi excluída de
propósito (é da triagem humana no `/dashboard`, como as colunas de Diff), então a célula
fica **em branco** na linha nova. É o mesmo caso já resolvido para `Observações`,
`Motivo Reprovado`, `Análise Antiagente` e `Memorial anterior`, que o append inicializa
com "—" mesmo sem dado.

Segundo ponto: em `definirStatusProjeto` (`dashboard-admin.functions.ts`) o admin que
**apaga** o motivo grava `''` (string vazia) direto, sem passar por `padronizarLinha` →
volta a deixar a célula em branco.

### Tarefas
- **T1 —** `syncSubmitToGoogle` (`src/lib/google/sync.ts`): inicializar
  `row['Motivo Reenvio'] = '—'` **só no append** (`p.modo !== 'edicao'`, junto de
  `Data Submissão`) e também no **append de RECUPERAÇÃO** (a linha nasce agora).
  ⚠️ **NUNCA no update in-place da edição** — sobrescreveria o texto da triagem.
  (guarda: teste novo em `tests/` — append inclui `'Motivo Reenvio': '—'`; update de
  edição **não** inclui a chave.)
- **T2 —** `definirStatusProjeto` (`src/lib/dashboard-admin.functions.ts`): motivo
  limpo (`''` após `trim`) grava **"—"** em `Motivo Reenvio`/`Motivo Reprovado`
  (planilha + cache + patch), em vez de célula em branco.
  (guarda: teste — `motivo_reenvio: '  '` → grava `'—'`.)
- **T3 —** `email-legados.functions.ts` (`fonteReenvio`): tratar `'—'`/`'-'` como
  ausência ao ler **"Observações"** — hoje o append já grava "—" ali, então o e-mail de
  reenvio pode sair com _"Motivo: —"_. Correção de 1 linha, mesmo padrão do
  `mapItem`/`txt()`. (guarda: teste — linha com Observações `'—'` → `motivo: null`.)
- **T4 —** Atualizar `CLAUDE.md` (gotcha 4 do "Critério de projeto" e a seção de Sync)
  + `spec-docs/SPEC_CORRECOES.md` (sintoma → causa → fix → onde aterrissou → PR).
  O texto "o sistema NUNCA escreve" passa a ser **"a triagem é a única a escrever
  conteúdo; o append só inicializa com —"**.
- **T5 —** `npm run test` + `npm run build` + `npm run build:worker` (worker.js commitado,
  regra 1) → **staging `edf400b4`** → validar a linha na aba `STAGING` → **prod
  `674a3710`** → PR (regras 10/13).

### Critérios de aceitação
1. Projeto submetido do zero → linha nova na planilha com **"Motivo Reenvio" = "—"**
   (não em branco).
2. Reenvio/edição de projeto cujo "Motivo Reenvio" tem texto da triagem → o texto
   **permanece intacto** após o sync.
3. Admin apaga o motivo no `/dashboard` → célula fica **"—"**, não em branco.
4. Card de "Meus Projetos" e `/projeto/$id` **não** exibem bloco de motivo quando a
   célula é "—" (comportamento atual de `mapItem`, preservado).
5. E-mail de reenvio não mostra _"Motivo: —"_.
6. `npm run test` verde.

### Fronteiras (não exceder)
- **NÃO** retroagir a planilha (as ~887 linhas legadas com a célula em branco continuam
  em branco) — se o Luis quiser, é backfill próprio, à parte.
- **NÃO** mexer nas colunas de **Diff** (`Diff Horas/Antes`, `Diff Saving/Antes`): são
  manuais e permanecem 100% intocadas pelo sistema.
- **NÃO** mudar quem decide o conteúdo do motivo (triagem humana segue a única fonte).
- **NÃO** mexer no `status`/`Atualizado Em` nem em nada do fluxo de análise.

### Blast-radius
Arquivos: `src/lib/google/sync.ts` · `src/lib/dashboard-admin.functions.ts` ·
`src/lib/email-legados.functions.ts` · testes · `worker.js` (rebuild) ·
`CLAUDE.md`/`spec-docs/SPEC_CORRECOES.md` ·
Dependentes: `meus-projetos.functions.ts` (`mapItem` já normaliza "—" → null — **sem
mudança**), `sync-reverse.ts` (`txt()` já trata "—" → null — coluna fora de
`SAFE_UPDATE_FIELDS`, **sem efeito**), `/dashboard` (`texto()` já trata "—" → null) ·
Invariantes: gotcha 4 do "Critério de projeto" no `CLAUDE.md` ("Motivo Reenvio é MANUAL")
— **ajustado de propósito**, não por engano: o append só inicializa a célula vazia; o
conteúdo continua exclusivo da triagem · Confiança: **alta** (blast-radius **BAIXO**:
consumidores já tratam "—" como ausência).
