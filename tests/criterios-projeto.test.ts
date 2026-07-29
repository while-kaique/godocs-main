// Critério de projeto (recorrência · contrafactual · rastreabilidade) — colunas do
// Sheets + derivação da célula "Classificação".
// As invariantes da classificação em si vivem em `criterios-classificacao.test.ts`.
import { describe, it, expect } from 'vitest';
import { SHEET_COLUMNS } from '@/lib/google/sheets';
import { derivarClassificacaoSheet, CLASSIFICACAO_LABEL } from '@/lib/google/sync';
import {
  MEMORIAL_ESQUELETO,
  TITULOS_MEMORIAL,
  normalizarMarcadoresMemorial,
  descreverEsqueletoMemorial,
} from '@/lib/agents/memorial-format';
import { mapItem } from '@/lib/meus-projetos.functions';
import type { ProjetoRow } from '@/integrations/db/client.server';

describe('colunas novas no SHEET_COLUMNS (mapeamento por NOME)', () => {
  // ⚠️ A grafia tem de bater EXATAMENTE com o cabeçalho das abas GoDocs e STAGING —
  // nome que não bate é ignorado com aviso silencioso.
  it.each(['Motivo Reenvio', 'Motivo Reprovado', 'Classificação'])(
    'declara a coluna "%s"',
    (nome) => {
      expect(SHEET_COLUMNS).toContain(nome);
    },
  );

  it('não duplica nenhum nome de coluna', () => {
    expect(new Set(SHEET_COLUMNS).size).toBe(SHEET_COLUMNS.length);
  });
});

describe('derivarClassificacaoSheet', () => {
  it('monta "<Rótulo> — <justificativa>" para os 3 níveis', () => {
    expect(derivarClassificacaoSheet('claro_sim', 'Rotina mensal com indicador nomeado.')).toBe(
      'Claro sim — Rotina mensal com indicador nomeado.',
    );
    expect(derivarClassificacaoSheet('claro_nao', 'Peça única, sem recorrência.')).toBe(
      'Claro não — Peça única, sem recorrência.',
    );
    expect(derivarClassificacaoSheet('zona_cinzenta', 'Ganho real, fonte não verificável.')).toBe(
      'Zona cinzenta — Ganho real, fonte não verificável.',
    );
  });

  it('usa acentuação correta nos rótulos', () => {
    expect(CLASSIFICACAO_LABEL.claro_nao).toBe('Claro não');
    expect(CLASSIFICACAO_LABEL.zona_cinzenta).toBe('Zona cinzenta');
  });

  it('sem justificativa, grava só o rótulo (nunca deixa a célula vazia)', () => {
    expect(derivarClassificacaoSheet('claro_sim', '')).toBe('Claro sim');
    expect(derivarClassificacaoSheet('claro_sim', null)).toBe('Claro sim');
    expect(derivarClassificacaoSheet('claro_sim', '   ')).toBe('Claro sim');
  });

  it('classificação ausente/desconhecida → "—" (legado ou análise que não rodou)', () => {
    expect(derivarClassificacaoSheet(null, 'x')).toBe('—');
    expect(derivarClassificacaoSheet(undefined, undefined)).toBe('—');
    expect(derivarClassificacaoSheet('', '')).toBe('—');
    expect(derivarClassificacaoSheet('inventado_pelo_llm', 'x')).toBe('—');
  });

  it('tolera espaços em volta do valor', () => {
    expect(derivarClassificacaoSheet(' claro_nao ', 'Sem evidência.')).toBe(
      'Claro não — Sem evidência.',
    );
  });
});

// ── T2: seção "Processo alterado" no esqueleto (FONTE ÚNICA) ─────────────────
describe('MEMORIAL_ESQUELETO — Processo alterado', () => {
  it.each(['saving', 'custo_evitado', 'receita'] as const)(
    'o modo %s declara a seção como obrigatória',
    (modo) => {
      const secao = MEMORIAL_ESQUELETO[modo].find((s) => s.secao === 'Processo alterado');
      expect(secao).toBeDefined();
      expect(secao!.nivel).toBe('obrigatoria');
    },
  );

  it('a seção instrui a NÃO perguntar quando a doc já traz a magnitude (anti-redundância)', () => {
    for (const modo of ['saving', 'custo_evitado', 'receita'] as const) {
      const secao = MEMORIAL_ESQUELETO[modo].find((s) => s.secao === 'Processo alterado')!;
      expect(secao.conteudo).toMatch(/NÃO pergunte/i);
      expect(secao.conteudo).toMatch(/magnitude/i);
    }
  });

  it.each(['saving', 'custo_evitado', 'receita'] as const)(
    'o modo %s declara "Ponteiro movido e onde verificar" como obrigatória (rastreabilidade veio do form para o AGENTE)',
    (modo) => {
      const secao = MEMORIAL_ESQUELETO[modo].find(
        (s) => s.secao === 'Ponteiro movido e onde verificar',
      );
      expect(secao).toBeDefined();
      expect(secao!.nivel).toBe('obrigatoria');
      // Constrói o racional com a pessoa e aceita "não sei onde conferir" sem inventar fonte.
      expect(secao!.conteudo).toMatch(/COM o usuário/i);
      expect(secao!.conteudo).toMatch(/não souber onde conferir/i);
    },
  );

  it('o ponteiro tem título legível no checklist (1.4)', () => {
    expect(TITULOS_MEMORIAL['1.4']).toBe('Ponteiro movido e onde verificar');
    expect(normalizarMarcadoresMemorial('[1.4] custo — painel de conciliação')).toBe(
      '**Ponteiro movido e onde verificar:** custo — painel de conciliação',
    );
  });

  it('tem título legível no checklist (1.3) — os códigos nunca aparecem no texto', () => {
    expect(TITULOS_MEMORIAL['1.3']).toBe('Processo alterado');
    expect(normalizarMarcadoresMemorial('[1.3] mudou o fechamento diário')).toBe(
      '**Processo alterado:** mudou o fechamento diário',
    );
  });

  it('o esqueleto renderizado para o prompt inclui a seção', () => {
    expect(descreverEsqueletoMemorial('custo_evitado')).toContain('### Processo alterado');
  });
});

// ── T6: o AUTOR vê o motivo (mapItem) ───────────────────────────────────────
describe('mapItem — motivos visíveis ao autor', () => {
  const row = (over: Partial<ProjetoRow> = {}) =>
    ({ id: 'p1', nome: 'Proj', ...over }) as ProjetoRow & { area_nome: string | null };

  it('expõe o motivo da reprovação vindo da planilha', () => {
    const item = mapItem(row(), null, 'owner', true, 'Reprovado', {
      reprovado: 'Entrega única, sem indicador verificável.',
    });
    expect(item.motivo_reprovado).toBe('Entrega única, sem indicador verificável.');
  });

  it('a planilha (que pode ter sido sobreposta na triagem) vence o espelho SQLite', () => {
    const item = mapItem(
      row({ motivo_reprovacao: 'texto do analisador' }),
      null,
      'owner',
      true,
      'Reprovado',
      { reprovado: 'texto reescrito pela triagem' },
    );
    expect(item.motivo_reprovado).toBe('texto reescrito pela triagem');
  });

  it('sem motivo na planilha, cai no espelho SQLite do analisador', () => {
    const item = mapItem(row({ motivo_reprovacao: 'texto do analisador' }), null, 'owner', true);
    expect(item.motivo_reprovado).toBe('texto do analisador');
  });

  it('célula "—"/vazia não vira texto de motivo', () => {
    for (const vazio of ['—', '-', '', '   ']) {
      const item = mapItem(row(), null, 'owner', true, 'Pendente', {
        reprovado: vazio,
        reenvio: vazio,
      });
      expect(item.motivo_reprovado).toBeNull();
      expect(item.motivo_reenvio).toBeNull();
    }
  });

  it('"Motivo Reenvio" é só da planilha (o sistema nunca a escreve)', () => {
    const item = mapItem(row(), null, 'owner', true, 'Reenvio Pendente', {
      reenvio: 'projeto em manutenção; reenviar com os fixes',
    });
    expect(item.motivo_reenvio).toBe('projeto em manutenção; reenviar com os fixes');
  });
});
