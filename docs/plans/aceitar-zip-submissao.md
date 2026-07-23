# Plano — Aceitar upload de .zip na submissão (Etapa 2)
**Status:** ✅ executado (2026-07-22) — código completo (T1–T5), 577 testes verdes, conformidade "conforme". Falta só deploy staging→prod (regra 13) e PR.

**Objetivo:** Permitir que o usuário anexe um `.zip` na Etapa 2; o app descompacta **no cliente** e
expande em arquivos individuais que passam pelo pipeline de `addFiles` já existente (filtro
`node_modules`/pastas de dev, whitelist de extensão, descarte de vazios, dedup, orçamento de tokens).

**Contexto/causa:** Hoje o `.zip` é barrado como "extensão não suportada" no gate client-side
(`step2.tsx:419` contra `ACCEPTED_DOC_EXT`). Caso real: Rafael Lobo (`rafael@gocase.com`) — a rejeição
é 100% client-side (não há trilha no servidor). Decisão de produto: **aceitar .zip** (não só melhorar UX).

### Tarefas
- **T1 — Módulo de unzip** `src/lib/submeter/unzip.ts` (NOVO): `expandirZips(File[]) → { files, ... }` via
  `fflate.unzip` (async, não trava a UI); funções puras `ehZip`, `entradaZipVira` (descarta diretórios,
  vazios, `.DS_Store`, `__MACOSX/`); teto `MAX_ZIP_MB=50` por .zip; cria `File` com `webkitRelativePath` =
  caminho interno (para o filtro por caminho funcionar). NÃO aplica whitelist/node_modules (é do pipeline).
  (guarda: `tests/unzip.test.ts` monta um zip com `fflate.zipSync` e afirma expansão + descarte)
- **T2 — Hook em `addFiles`** (`step2.tsx`): no início, se algum arquivo for `.zip`, chama `expandirZips`
  ANTES do loop; substitui a lista; toasts de resultado (N descompactados / .zip grande ignorado / falhou).
  Resto do pipeline **inalterado** — os arquivos internos já fluem pelos filtros existentes.
  (guarda: build + `npm run test` verdes; validação manual no navegador em staging)
- **T3 — `accept` + texto de ajuda** (`step2.tsx`): adicionar `.zip` ao `accept` do `<input>` de arquivos
  (não o de pasta) e à linha "Aceita: …" (`step2.tsx:636`). PT-BR com acento (regra 4).
- **T4 — Dependência**: `fflate` no `package.json` (já instalado no worktree: `^0.8.3`, zero-deps).
- **T5 — Spec** (regra 12): registrar em `spec-docs/SPEC_CORRECOES.md` (sintoma → causa → fix → onde
  aterrissou → PR).

### Critérios de aceitação
1. Anexar um `.zip` contendo arquivos válidos (`.ts`, `.py`, `.pdf`, …) resulta nesses arquivos na lista,
   e um `.zip` com `node_modules/` dentro tem essa pasta ignorada automaticamente.
2. Arquivos internos com extensão fora da whitelist continuam rejeitados (mesma regra de sempre).
3. `.zip` acima de 50MB é ignorado com aviso claro; `.zip` corrompido não quebra a tela (toast de erro).
4. `npm run test` e `npm run build` verdes. Nenhuma mudança server-side (sem `build:worker`).

### Fronteiras (não exceder)
- **Sem** descompactar no worker (decisão: client-side reusa o pipeline; ver conversa).
- **Sem** ampliar a whitelist de extensões nem suportar `.rar`/`.7z`/imagens.
- **Sem** nested-zip (zip dentro de zip) — raro; entra como arquivo `.zip` interno e é ignorado.
- **Sem** mexer no server/extract-text (arquivos chegam individuais, como hoje).

### Blast-radius
Arquivos: `src/lib/submeter/unzip.ts` (novo) · `src/lib/submeter/step2.tsx` (addFiles + accept + texto) ·
`tests/unzip.test.ts` (novo) · `package.json` (+fflate) · `spec-docs/SPEC_CORRECOES.md`.
Dependentes: `step2.tsx` é usado no fluxo de submissão nova e edição; `addFiles` é o funil único dos 3
pontos de entrada (drop/arquivos/pasta) — a jusante nada muda.
Invariantes: nenhum formal (sem `docs/invariants.md`). Reusa filtros existentes.
Confiança: **média-alta** (sem `docs/INDEX.md` → RF-35, mas o caminho foi lido direto e é bem entendido).
Reuso: nenhum unzip canônico existe (grep confirmou) → criar `unzip.ts` do zero é justificado.
