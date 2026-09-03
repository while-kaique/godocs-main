// CANÁRIO do cabeçalho da aba `STAGING-V2` — T6 do plano
// `docs/plans/godocs-v2-submissao-deterministica.md`, critério de aceitação 9:
// *"`chavesForaDoCabecalho` volta vazio contra o cabeçalho real de `STAGING-V2`"*.
//
// Por que existe: o casamento coluna↔valor é por NOME (`fetchHeaderMap`), e nome que não
// bate **não dá erro** — o `appendRow` só emite um `console.warn` e segue, gravando a
// linha SEM aquela célula. É o modo de falha mais caro desta base: a submissão parece ter
// dado certo, a planilha nasce com a coluna vazia, e ninguém descobre até alguém procurar
// o número. Foi assim que a coluna do parecer do líder ficou em branco em prod.
//
// A aba `STAGING-V2` já foi APLICADA em 02/09/2026: clone da `STAGING` com 578 linhas de
// dado, **17 renomeações in-place + 3 colunas novas** (A→BG, 59 colunas). Renomear
// cabeçalho não move célula, e o sync casa por nome — então as linhas antigas seguem
// legíveis sob o nome certo. O que falta é o `SHEET_COLUMNS` falar a mesma língua.
//
// ⚠️ O fixture abaixo é o cabeçalho REAL, transcrito na ordem, **inclusive as grafias
// erradas de propósito**: `Justificativa Aprovação do Lider` (sem acento no "Líder") é o
// nome que está lá. Não "corrija" o fixture — corrigir aqui esconde a divergência em vez
// de resolvê-la (a tolerância de acento/caixa de `chaveColuna` é REDE, não licença).
//
// ⚠️ Este arquivo NÃO repete o canário de nome duplicado — ele já vive em
// `tests/criterios-projeto.test.ts` ("não duplica nenhum nome de coluna").
import { describe, it, expect } from 'vitest';
import { SHEET_COLUMNS, chavesForaDoCabecalho, colLetter } from '@/lib/google/sheets';

/** O cabeçalho real da aba `STAGING-V2`, na ordem (A → BG). */
const CABECALHO_STAGING_V2 = [
  'Data Submissão', // A
  'ID Projeto', // B
  'Data Criação', // C  (morta — sem uso, não apagada)
  'Área', // D
  'Nome Completo', // E
  'Email', // F
  'Projeto', // G
  'Coautor', // H
  'Participante', // I
  'Contribuidor', // J
  'Descrição', // K
  'URL', // L
  'URL Godeploy', // M
  'Ferramenta', // N
  'Escopo', // O
  'Tipos de Ganho', // P  (era "Tipos Projeto")
  'Alguém Fazia?', // Q  (morta)
  'Estrelas', // R
  'Custo Evitado Horas', // S  (era "Saving Horas")
  'Custo Evitado Horas Reais', // T  (era "Horas em Reais")
  'Saving Efetivado', // U  (era "Custo Evitado" — o "antes" do par)
  'Evidência Saving Efetivado', // V  (era "Justificativa Custo Evitado")
  'Freq. Saving Efetivado', // W  (era "Custo Mensal ou Pontual")
  'Impacto Bruto', // X  (era "Saving Reais")
  'Freq. Custo Evitado', // Y  (era "Tipo de Saving")
  'Memorial de Saving', // Z  (morta)
  'Custo Externo Mensal', // AA (morta)
  'Receita Incremental', // AB (era "Receita Mensal")
  'Freq. Receita', // AC (era "Tipo de Receita")
  'Racional Receita', // AD (era "Receita Memorial")
  'Status', // AE
  'Aprovação do Líder', // AF
  'Justificativa Aprovação do Lider', // AG ⚠️ sem acento — é o nome REAL
  'Impacto Líquido', // AH (era "Ganho Total")
  'Complexidade', // AI
  'Diff Horas / Antes', // AJ (manual/morta)
  'Diff Saving / Antes', // AK (manual/morta)
  'Memorial anterior', // AL
  'Observações', // AM
  'Ganho Imensurável', // AN (era "Contexto do Projeto Especial")
  'Alocação Ganhos', // AO (morta)
  'Especial?', // AP (morta)
  'Saving Horas Escalado', // AQ (morta)
  'Saving Horas Real', // AR (morta)
  'Racional Custo Evitado', // AS (era "Justificativa Saving Escalado e Real")
  'Custo para Rodar', // AT (era "Custo do Projeto" — fusão D3)
  'Justificativa Custo para Rodar', // AU (era "Justificativa Custo do Projeto")
  'Freq. Custo para Rodar', // AV (era "Custo do Projeto Mensal ou Pontual")
  'Usa AI Proxy', // AW
  'Análise Antiagente', // AX
  'Motivo Reenvio', // AY
  'Motivo Reprovado', // AZ
  'Classificação', // BA
  'Atualizado Em', // BB
  'ID Pai', // BC
  'ID Feature', // BD
  'Saving Efetivado Agora', // BE ⚠️ NOVA — a 2ª ponta do par
  'Custo Evitado Não Contratado', // BF ⚠️ NOVA — a vaga/consultoria não contratada
  'Impacto Líquido Mensal', // BG ⚠️ NOVA — a normalização no tempo
  'Tipo de Projeto', // BH ⚠️ NOVA (03/09/2026) — eixo TIPO da categorização (item 5.4)
];

describe('cabeçalho real da aba STAGING-V2 (fixture)', () => {
  it('tem 60 colunas, de A a BH', () => {
    expect(CABECALHO_STAGING_V2).toHaveLength(60);
    expect(colLetter(CABECALHO_STAGING_V2.length - 1)).toBe('BH');
  });

  it('não tem nome repetido (nome ambíguo não recebe valor pelo índice tolerante)', () => {
    expect(new Set(CABECALHO_STAGING_V2).size).toBe(CABECALHO_STAGING_V2.length);
  });
});

describe('SHEET_COLUMNS × cabeçalho da STAGING-V2', () => {
  // O detector é a própria função pura que o `appendRow` usa para emitir o aviso —
  // testar por ela é testar o caminho real, não uma reimplementação do casamento.
  const foraDoCabecalho = () =>
    chavesForaDoCabecalho(
      CABECALHO_STAGING_V2,
      Object.fromEntries(SHEET_COLUMNS.map((nome) => [nome, 'x'])),
    );

  it('nenhum nome conhecido pelo código fica de fora do cabeçalho real', () => {
    // ⚠️ Cada nome nesta lista é uma célula que o sistema pensa que grava e que a
    // planilha nunca recebe — em silêncio, com um `console.warn` que ninguém lê.
    expect(foraDoCabecalho()).toEqual([]);
  });

  it.each([
    'Saving Efetivado Agora',
    'Custo Evitado Não Contratado',
    'Impacto Líquido Mensal',
  ])('a coluna NOVA "%s" é conhecida por SHEET_COLUMNS', (nome) => {
    expect(SHEET_COLUMNS as readonly string[]).toContain(nome);
  });

  // As 17 renomeações: o nome NOVO tem de estar no código, senão o dado das 578 linhas
  // continua lá e o sistema deixa de alcançá-lo.
  it.each([
    'Tipos de Ganho',
    'Saving Efetivado',
    'Evidência Saving Efetivado',
    'Freq. Saving Efetivado',
    'Custo Evitado Horas',
    'Custo Evitado Horas Reais',
    'Freq. Custo Evitado',
    'Racional Custo Evitado',
    'Custo para Rodar',
    'Freq. Custo para Rodar',
    'Justificativa Custo para Rodar',
    'Receita Incremental',
    'Freq. Receita',
    'Racional Receita',
    'Ganho Imensurável',
    'Impacto Bruto',
    'Impacto Líquido',
  ])('a coluna RENOMEADA "%s" é conhecida por SHEET_COLUMNS', (nome) => {
    expect(SHEET_COLUMNS as readonly string[]).toContain(nome);
  });

  // Contrapartida das renomeações: o nome da v1 aponta para um significado que não existe
  // mais nesta aba. Mantê-lo mapeado é convite a gravar o número certo na coluna errada
  // (`Custo Evitado` da v1 é o SAVING EFETIVADO da v2 — os dois conceitos trocaram de
  // nome entre si, que é o pior caso possível de confusão).
  it.each([
    'Tipos Projeto',
    'Saving Horas',
    'Horas em Reais',
    'Custo Evitado',
    'Justificativa Custo Evitado',
    'Custo Mensal ou Pontual',
    'Saving Reais',
    'Tipo de Saving',
    'Receita Mensal',
    'Tipo de Receita',
    'Receita Memorial',
    'Ganho Total',
    'Contexto do Projeto Especial',
    'Custo do Projeto',
    'Justificativa Custo do Projeto',
    'Custo do Projeto Mensal ou Pontual',
    'Justificativa Saving Escalado e Real',
    'Participantes',
    'Participantes 2',
  ])('o nome da v1 "%s" não sobrevive no SHEET_COLUMNS da v2', (nome) => {
    expect(SHEET_COLUMNS as readonly string[]).not.toContain(nome);
  });
});
