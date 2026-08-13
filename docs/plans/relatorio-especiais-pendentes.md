# Plano — Relatório de projetos ESPECIAIS pendentes há mais de 15 dias
**Status:** ✅ aprovado (Luis, 13/08/2026)

**Objetivo:** uma aba dedicada na planilha de produção listando os projetos **especiais** com
Status `Pendente` há **mais de 15 dias**, para a gestão ver o que a triagem ainda não olhou.

**Por que especial é uma fila à parte:** projeto especial **não abre fila de líder** (D27) e **pula
o memorial financeiro** — a **validação humana da RPA é a única porta** por onde ele passa. Um
especial parado é um projeto que ninguém olhou, e hoje nada o denuncia.

### Tarefas
- **T1 —** `scripts/dryrun-lider/relatorio-especiais.ts` + `especiais.config.ts`, clonando a
  mecânica do irmão `relatorio-espera.ts` (guarda: dry-run imprime o resumo sem escrever nada).
- **T2 —** Dry-run contra a planilha de PROD e conferência de olho dos números (guarda: total de
  especiais × pendentes × acima do corte batem com o que a aba `GoDocs` mostra).
- **T3 —** Escrita real na aba com `ESPECIAIS_WRITE=1` (guarda: rodar 2× não duplica — a aba é
  limpa e regravada).

### Critérios de aceitação
1. A aba existe na planilha de prod, com uma linha por projeto especial pendente há > 15 dias,
   ordenada do mais antigo para o mais novo.
2. Colunas: Dias pendentes · Projeto · Autor · E-mail · Área · Data Submissão · Tipos Projeto ·
   ID Projeto · Documentação (Drive).
3. Cabeçalho declara o relógio usado (`Data Submissão`) e o corte, porque isso muda a leitura do
   número — em LEGADO a fila nunca abriu e o número é a idade da pendência.
4. Projetos `[E2E-…]` ficam fora (não são trabalho de ninguém).
5. Pendente sem data legível não some: vai num bloco à parte, nunca somado ao corte.
6. Sem a flag de escrita, é dry-run — nada toca o Sheets.

### Fronteiras (não exceder)
- **Não** escreve na aba `GoDocs` — só na aba nova e dedicada.
- **Não** vira rota/cron/tela do app: é script de operação sob demanda, como os 2 irmãos.
- **Não** mexe em `SHEET_COLUMNS`, no sync nem em nada do runtime.
- `Reenvio Pendente` fica **fora** (a triagem já olhou e devolveu — a bola está com o autor);
  aparece só na contagem do console.

### Blast-radius
Arquivos: 2 novos em `scripts/dryrun-lider/` (nenhum arquivo existente alterado) ·
Dependentes: nenhum (script fora do `npm run test`, fora do bundle do worker) ·
Invariantes: nenhum de runtime; consome `readAllRows`/`getAccessToken`/`parseDataFlexivel`
como os irmãos, e respeita a **cota de leitura do Sheets compartilhada com prod** (1 leitura por
execução) · Confiança: **alta** (padrão já executado 2×: `relatorio-sheet.ts` e `relatorio-espera.ts`).

### Reuso (RF-32)
Reusa o **canônico** dos relatórios em aba dedicada (`relatorio-espera.ts`): leitura por
`readAllRows`, `parseDataFlexivel` para o relógio, `ehProjetoTesteE2E` para o mute, e o bloco de
escrita `addSheet`/`clear`/`PUT` — inclusive a decisão de **limpar valores em vez de apagar a aba**
(apagar destruiria comentários que a gestão deixe nela). Nada criado do zero além da consulta em si.
