// GoDocs v2 — a linha da planilha de um projeto que declarou o ganho pelo FORMULÁRIO
// determinístico da Etapa 3 (`docs/plans/godocs-v2-submissao-deterministica.md`, T6).
//
// O discriminador é `projetos.ganho_categorias` (JSON array, escrito só pelo formulário
// v2). Com ele preenchido, as células financeiras vêm das COLUNAS v2 de `projetos`; sem
// ele, a linha continua saindo do `saving`/`receita` do chat, exatamente como na v1.
//
// ⚠️ O caso que mais importa: num projeto v2 o `saving`/`receita` do chat chegam VAZIOS,
// e o caminho da v1 gravaria 0 nas células de dinheiro. Um projeto com impacto líquido
// de R$ 20.000 não pode sair da submissão com "Impacto Líquido = 0" na planilha.
//
// Os 3 impactos são MATERIALIZADOS: a fórmula tem uma fonte só (`src/lib/impacto.ts`) e
// o sync não é ela — as células copiam `impacto_bruto`/`impacto_liquido`/
// `impacto_liquido_mensal`. Por isso os valores da fixture abaixo são deliberadamente
// DIFERENTES do que uma recontagem no sync produziria: se alguém recalcular aqui, o
// teste acusa.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  appendRow: vi.fn().mockResolvedValue(undefined),
  updateRowByProjectId: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/google/chat', () => ({
  sendChatNotification: vi.fn().mockResolvedValue(undefined),
  buildSubmitMessage: vi.fn().mockReturnValue({}),
  ehProjetoTesteE2E: vi.fn().mockReturnValue(false),
}));

import { syncSubmitToGoogle } from '@/lib/google/sync';
import { appendRow } from '@/lib/google/sheets';
import {
  serializarCategorias,
  serializarLinhasHoras,
  serializarCustoRodar,
} from '@/lib/ganhos';
import { tituloGanho } from '@/lib/ganhos-rotulos';

// ─── fixtures ────────────────────────────────────────────────────────────────

const projetoBase = {
  nome: 'Robô de conciliação',
  responsavel_nome: 'Fulana',
  responsavel_email: 'fulana@gocase.com',
  ferramenta: 'n8n',
  escopo: 'interno',
  descricao_breve: 'concilia extratos',
  alguem_fazia: 'sim',
  custo_externo_mensal: 0,
  contexto_especial: null,
  especial: 0,
  custo_evitado: 'nao',
  custo_evitado_justificativa: null,
  custo_evitado_itens: null,
  arquivos_links: null,
  data_criacao_projeto: '2026-01-01',
  memorial_calculo: 'memo',
  complexidade: null,
  observacoes: null,
  // colunas v2 zeradas por padrão (projeto v1)
  ganho_categorias: null,
  saving_efetivado_valor_antes: null,
  saving_efetivado_valor_agora: null,
  saving_efetivado_frequencia: null,
  saving_efetivado_evidencia: null,
  custo_evitado_frequencia: null,
  custo_evitado_horas_linhas: null,
  custo_evitado_horas_valor: null,
  custo_evitado_nao_contratado: null,
  custo_evitado_racional: null,
  receita_incremental_valor: null,
  receita_incremental_frequencia: null,
  receita_incremental_racional: null,
  ganho_imensuravel_racional: null,
  custo_rodar_itens: null,
  impacto_bruto: null,
  impacto_liquido: null,
  impacto_liquido_mensal: null,
};

// Linhas de horas: 40→10 (30h), 12→2 (10h) e uma INVERTIDA 3→9, que clampa em 0.
// Total esperado de horas liberadas = 40 (a invertida não pode abater as outras).
const LINHAS_HORAS = serializarLinhasHoras([
  { funcao: 'Analista Fiscal', horasAntes: 40, horasDepois: 10 },
  { funcao: 'Assistente', horasAntes: 12, horasDepois: 2 },
  { funcao: 'Coordenador', horasAntes: 3, horasDepois: 9 },
]);

// Custo para rodar: 500 + um item NEGATIVO (-100), que clampa em 0. Soma = 500.
const CUSTO_RODAR = serializarCustoRodar([
  { nome: 'OpenAI', valor: 500, frequencia: 'mensal', oQueE: 'chamadas de API' },
  { nome: 'Crédito promocional', valor: -100, frequencia: 'mensal', oQueE: 'estorno' },
]);

// Projeto v2 COMPLETO: as 4 categorias marcadas.
//
// ⚠️ Os 3 impactos são valores MATERIALIZADOS e propositalmente distintos do que a
// fórmula devolveria para estes blocos (bruto seria 30.200 e líquido 20.500): o sync
// tem de COPIAR as colunas, não refazer a conta.
const projetoV2 = {
  ...projetoBase,
  ganho_categorias: serializarCategorias([
    'saving_efetivado',
    'custo_evitado',
    'receita_incremental',
    'imensuravel',
  ]),
  saving_efetivado_valor_antes: 20000,
  saving_efetivado_valor_agora: 5000,
  saving_efetivado_frequencia: 'mensal',
  saving_efetivado_evidencia: 'Fatura da consultoria encerrada em 03/2026.',
  custo_evitado_frequencia: 'trimestral',
  custo_evitado_horas_linhas: LINHAS_HORAS,
  custo_evitado_horas_valor: 3200,
  custo_evitado_nao_contratado: 8000,
  custo_evitado_racional: 'A vaga de assistente não foi aberta.',
  receita_incremental_valor: 4000,
  receita_incremental_frequencia: 'pontual',
  receita_incremental_racional: 'Cobranças recuperadas que ninguém recuperava.',
  ganho_imensuravel_racional: 'Risco de multa fiscal eliminado.',
  custo_rodar_itens: CUSTO_RODAR,
  impacto_bruto: 31234.5,
  impacto_liquido: 20000,
  impacto_liquido_mensal: 1666.25,
};

// Params de um submit v2: o chat NÃO produz mais saving/receita — eles chegam nulos, e
// o `ganhoTotalMensal` da v1 vem zerado. É exatamente aqui que o caminho da v1 gravaria 0.
const paramsV2 = {
  projetoId: 'p-v2',
  modo: 'novo' as const,
  projeto: projetoV2 as never,
  conteudo: {},
  saving: null,
  receita: null,
  membros: [],
  tiposProjeto: [] as string[],
  status: 'Pendente' as const,
  area: 'FISCAL',
  memorialLimpo: '—',
  receitaMemorialLimpo: '—',
  ganhoTotalMensal: 0,
  notificarChat: false,
};

// Params de um submit v1 (sem `ganho_categorias`): tudo vem do saving/receita do chat.
const paramsV1 = {
  ...paramsV2,
  projetoId: 'p-v1',
  projeto: projetoBase as never,
  saving: {
    economia_horas_mes: 132,
    economia_reais_mes: 8844,
    custo_evitado_reais: 3600,
    custo_projeto_reais: 250,
    tipo_saving: 'mensal',
    linhas: [{ economia_reais_mes: 5000 }, { economia_reais_mes: 3844 }],
  } as Record<string, unknown>,
  receita: { valor_ganho_mensal: 10000, tipo_saving: 'mensal' } as Record<string, unknown>,
  tiposProjeto: ['saving', 'receita_incremental'],
  memorialLimpo: 'memorial de saving',
  receitaMemorialLimpo: 'memorial de receita',
  ganhoTotalMensal: 9844,
};

const row = () =>
  (appendRow as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;

async function linhaDe(params: Parameters<typeof syncSubmitToGoogle>[0]) {
  await syncSubmitToGoogle(params);
  expect(appendRow).toHaveBeenCalledTimes(1);
  return row();
}

beforeEach(() => vi.clearAllMocks());

// ─── critério 1 e 2 — os 3 impactos são MATERIALIZADOS ───────────────────────

describe('v2 — os 3 impactos vêm das colunas materializadas', () => {
  it('grava exatamente `impacto_bruto`/`impacto_liquido`/`impacto_liquido_mensal`', async () => {
    const r = await linhaDe(paramsV2);
    expect(r['Impacto Bruto']).toBe(31234.5);
    expect(r['Impacto Líquido']).toBe(20000);
    expect(r['Impacto Líquido Mensal']).toBe(1666.25);
  });

  it('NÃO recalcula a fórmula no sync (o número da planilha é o da coluna)', async () => {
    const r = await linhaDe(paramsV2);
    // O que uma recontagem local produziria a partir dos blocos desta fixture.
    expect(r['Impacto Bruto']).not.toBe(30200);
    expect(r['Impacto Líquido']).not.toBe(20500);
  });

  it('⚠️ o impacto real SOBRESCREVE o zero da v1 (saving/receita do chat vazios)', async () => {
    // Este é o caso que quebra: com `saving: null` e `ganhoTotalMensal: 0`, o caminho da
    // v1 grava 0 nas células de dinheiro e o projeto some do rollup e do dashboard.
    const r = await linhaDe(paramsV2);
    expect(r['Impacto Líquido']).not.toBe(0);
    expect(r['Impacto Bruto']).not.toBe(0);
    expect(r['Impacto Líquido']).toBe(20000);
  });
});

// ─── critério 4 — as demais células saem das colunas v2 ──────────────────────

describe('v2 — as células dos blocos saem das colunas de `projetos`', () => {
  it('as DUAS pontas do saving efetivado (antes × agora)', async () => {
    const r = await linhaDe(paramsV2);
    expect(r['Saving Efetivado']).toBe(20000);
    expect(Number(r['Saving Efetivado Agora'])).toBe(5000);
  });

  it('custo evitado não contratado', async () => {
    const r = await linhaDe(paramsV2);
    expect(Number(r['Custo Evitado Não Contratado'])).toBe(8000);
  });

  it('as 3 frequências, cada uma do seu bloco (sem cruzar)', async () => {
    const r = await linhaDe(paramsV2);
    expect(String(r['Freq. Saving Efetivado'])).toMatch(/mensal/i);
    expect(String(r['Freq. Custo Evitado'])).toMatch(/trimestral/i);
    expect(String(r['Freq. Receita'])).toMatch(/pontual/i);
  });

  it('os racionais e a evidência', async () => {
    const r = await linhaDe(paramsV2);
    expect(r['Evidência Saving Efetivado']).toBe('Fatura da consultoria encerrada em 03/2026.');
    expect(r['Racional Custo Evitado']).toBe('A vaga de assistente não foi aberta.');
    expect(r['Racional Receita']).toBe('Cobranças recuperadas que ninguém recuperava.');
  });

  it('o ganho imensurável', async () => {
    const r = await linhaDe(paramsV2);
    expect(r['Ganho Imensurável']).toBe('Risco de multa fiscal eliminado.');
  });

  it('a receita incremental', async () => {
    const r = await linhaDe(paramsV2);
    expect(r['Receita Incremental']).toBe(4000);
  });
});

// ─── critério 5 — horas liberadas derivadas das linhas, cada uma clampada ────

describe('v2 — "Custo Evitado Horas" é o TOTAL derivado das linhas', () => {
  it('soma (antes − depois) por linha, com a linha INVERTIDA clampada em 0', async () => {
    // 30h + 10h + 0h (3→9 não pode abater as outras) = 40h.
    const r = await linhaDe(paramsV2);
    expect(r['Custo Evitado Horas']).toBe(40);
  });

  it('a linha invertida não abate as outras (não vira 34h)', async () => {
    const r = await linhaDe(paramsV2);
    expect(r['Custo Evitado Horas']).not.toBe(34);
  });
});

// ─── critério 6 — "Tipos de Ganho" com rótulos legíveis ──────────────────────

describe('v2 — "Tipos de Ganho" traz as categorias marcadas', () => {
  it('usa os rótulos legíveis, não as chaves internas', async () => {
    const r = await linhaDe(paramsV2);
    const celula = String(r['Tipos de Ganho']);
    for (const c of [
      'saving_efetivado',
      'custo_evitado',
      'receita_incremental',
      'imensuravel',
    ] as const) {
      expect(celula).toContain(tituloGanho(c));
    }
    expect(celula).not.toContain('saving_efetivado');
    expect(celula).not.toContain('receita_incremental');
  });

  it('só as categorias MARCADAS entram', async () => {
    const r = await linhaDe({
      ...paramsV2,
      projeto: {
        ...projetoV2,
        ganho_categorias: serializarCategorias(['custo_evitado']),
      } as never,
    });
    const celula = String(r['Tipos de Ganho']);
    expect(celula).toContain(tituloGanho('custo_evitado'));
    expect(celula).not.toContain(tituloGanho('receita_incremental'));
    expect(celula).not.toContain(tituloGanho('imensuravel'));
  });
});

// ─── critério 7 — "Custo para Rodar" soma os itens, negativo clampado ────────

describe('v2 — "Custo para Rodar" é a soma dos itens', () => {
  it('soma os itens, com valor NEGATIVO clampado em 0 (custo não infla o impacto)', async () => {
    const r = await linhaDe(paramsV2);
    expect(r['Custo para Rodar']).toBe(500);
    expect(r['Custo para Rodar']).not.toBe(400); // -100 não pode abater
  });
});

// ─── critério 3 — projeto v1 não muda em nada ────────────────────────────────

describe('v1 (sem `ganho_categorias`) — a linha sai como sempre saiu', () => {
  it('as células financeiras vêm do saving/receita do chat', async () => {
    const r = await linhaDe(paramsV1);
    expect(r['Custo Evitado Horas']).toBe(132); // era "Saving Horas"
    expect(r['Custo Evitado Horas Reais']).toBe(8844); // era "Horas em Reais" (soma das linhas)
    expect(r['Saving Efetivado']).toBe(3600); // era "Custo Evitado"
    expect(r['Impacto Bruto']).toBe(8844); // era "Saving Reais"
    expect(r['Receita Incremental']).toBe(10000); // era "Receita Mensal"
    expect(r['Impacto Líquido']).toBe(9844); // era "Ganho Total"
    expect(r['Custo para Rodar']).toBe(250); // era "Custo do Projeto"
    expect(r['Racional Receita']).toBe('memorial de receita'); // era "Receita Memorial"
    expect(String(r['Freq. Custo Evitado'])).toMatch(/mensal/i); // era "Tipo de Saving"
    expect(String(r['Freq. Receita'])).toMatch(/mensal/i); // era "Tipo de Receita"
  });

  it('os `tiposProjeto` do chamador continuam alimentando "Tipos de Ganho"', async () => {
    const r = await linhaDe(paramsV1);
    expect(String(r['Tipos de Ganho'])).toBe('saving, receita_incremental');
  });

  it('nenhuma coluna exclusiva da v2 nasce com conteúdo inventado', async () => {
    const r = await linhaDe(paramsV1);
    expect(r['Racional Custo Evitado']).toBe('—');
    expect(r['Ganho Imensurável']).toBe('—');
  });
});

// ─── critério 8 — a padronização continua valendo por cima ───────────────────

describe('v2 — padronização da linha (numérico vazio → 0, texto vazio → "—")', () => {
  // Só o custo evitado marcado: todo o resto é bloco NÃO preenchido.
  const soCustoEvitado = {
    ...paramsV2,
    projeto: {
      ...projetoBase,
      ganho_categorias: serializarCategorias(['custo_evitado']),
      custo_evitado_frequencia: 'mensal',
      custo_evitado_horas_linhas: LINHAS_HORAS,
      custo_evitado_horas_valor: 3200,
      custo_evitado_nao_contratado: 0,
      custo_evitado_racional: 'A vaga não foi aberta.',
      impacto_bruto: 11200,
      impacto_liquido: 5600,
      impacto_liquido_mensal: 5600,
    } as never,
  };

  it('colunas numéricas de bloco não marcado saem 0, nunca "—"', async () => {
    const r = await linhaDe(soCustoEvitado);
    expect(r['Saving Efetivado']).toBe(0);
    expect(r['Receita Incremental']).toBe(0);
    expect(r['Custo para Rodar']).toBe(0);
  });

  it('colunas de texto de bloco não marcado saem "—", nunca vazias', async () => {
    const r = await linhaDe(soCustoEvitado);
    expect(r['Evidência Saving Efetivado']).toBe('—');
    expect(r['Racional Receita']).toBe('—');
    expect(r['Ganho Imensurável']).toBe('—');
  });

  it('o bloco marcado é preservado inteiro', async () => {
    const r = await linhaDe(soCustoEvitado);
    expect(r['Custo Evitado Horas']).toBe(40);
    expect(r['Racional Custo Evitado']).toBe('A vaga não foi aberta.');
    expect(r['Impacto Líquido']).toBe(5600);
  });
});

// ─── leitura ESTRITA do critério 8 sobre as 3 colunas NOVAS ──────────────────
//
// "Saving Efetivado Agora", "Custo Evitado Não Contratado" e "Impacto Líquido Mensal"
// são colunas de DINHEIRO nascidas na v2. Pela régua da padronização ("coluna numérica
// vazia vira 0"), célula de dinheiro vazia deveria sair 0 — é o que o rollup e o
// dashboard somam. Bloco separado de propósito: se falhar, o que está em jogo é se essas
// 3 entraram em `COLUNAS_NUMERICAS`, não a montagem da linha v2.
describe('v2 — as 3 colunas NOVAS de dinheiro seguem a régua do numérico', () => {
  it('vazias saem 0, não "—"', async () => {
    const r = await linhaDe({
      ...paramsV2,
      projeto: {
        ...projetoBase,
        ganho_categorias: serializarCategorias(['imensuravel']),
        ganho_imensuravel_racional: 'Risco eliminado.',
      } as never,
    });
    expect(r['Saving Efetivado Agora']).toBe(0);
    expect(r['Custo Evitado Não Contratado']).toBe(0);
    expect(r['Impacto Líquido Mensal']).toBe(0);
  });
});
