/**
 * BUG (08/09/2026) — a MESA lia o financeiro em vocabulário da **v1**, do SQLite
 * (`documentacao.conteudo.saving`), e ficava CEGA ao dinheiro em todo projeto da v2 e em todo
 * legado que só vive na planilha.
 *
 * Medido no retroativo de prod: **41,4% de erro grave** (12 de 29) — o agente aprovando o que a
 * triagem reprovou, porque `materialidade` dava 0, o financeiro devolvia "sem dados financeiros"
 * e o **piso de impacto nunca disparava**.
 *
 * ⚠️ Este é o bug IRMÃO do dossiê (corrigido no mesmo dia) no arquivo vizinho: lá o time autônomo,
 * aqui a mesa que roda em produção a cada submissão.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { financeiroDoProjeto, mapaDeLinhas } from '@/lib/avaliacao-normais.functions';
import { avaliarFinanceiro } from '@/lib/agents/avaliacao-financeira';
import { agregarVotos } from '@/lib/agents/agregador-avaliacao';
import type { SheetRow } from '@/lib/google/sheets';
import type { ResultadoPlausibilidadeFTE } from '@/lib/agents/analyzer';

/** A linha recortada de um projeto v2, como o espelho a guarda. */
const linhaV2 = (over: Record<string, string> = {}): SheetRow =>
  ({
    'ID Projeto': 'p-v2',
    Projeto: 'Projeto da v2',
    Status: 'Aprovado',
    'Tipos de Ganho': 'Saving efetivado, Custo evitado',
    'Custo Evitado Horas': '60',
    'Saving Efetivado': 'R$ 324.005,09',
    'Receita Incremental': 'R$ 0,00',
    'Impacto Líquido Mensal': 'R$ 18,16',
    'Impacto Líquido': 'R$ 999,00',
    ...over,
  }) as SheetRow;

describe('financeiroDoProjeto — a ponte v1 → v2', () => {
  it('linha v2 sem `documentacao`: os números CHEGAM (era tudo null)', () => {
    const f = financeiroDoProjeto(undefined, undefined, linhaV2());
    expect(f.horas).toBe(60);
    expect(f.custoEvitado).toBeCloseTo(324005.09, 2);
    expect(f.economiaReaisMes).toBeCloseTo(18.16, 2);
    expect(f.valorReceita).toBe(0);
    // As categorias da v2 são o que diz "há saving/receita declarados".
    expect(f.temSaving).toBe(true);
    expect(f.temReceita).toBe(false);
  });

  it('⚠️ usa `Impacto Líquido Mensal`, não `Impacto Líquido` — é a coluna do PISO', () => {
    // A rodada de 04/09 usou a MENSAL (136/137 batem ao centavo), e as duas divergem em projeto
    // que não é mensal. Pegar a errada faria o piso julgar outro número.
    const f = financeiroDoProjeto(undefined, undefined, linhaV2());
    expect(f.economiaReaisMes).toBeCloseTo(18.16, 2);
    expect(f.economiaReaisMes).not.toBeCloseTo(999, 2);
  });

  it('⚠️ a PLANILHA vence o SQLite v1 — régua e número saem da mesma fonte', () => {
    // CORRIGIDO em 09/09/2026. A 1ª versão do fix fazia o contrário ("v1 primeiro, quando
    // existe") e o piso seguia inerte justo em quem ele existe para pegar: a v2 PONDERA as horas
    // no `Impacto Líquido Mensal` e a v1 conta a hora pelo valor CHEIO, então o número v1 é ~10× o
    // v2 e passa longe do piso de R$ 100. Medido: os 11 `erro_grave` que sobraram no retroativo de
    // prod eram todos impacto v2 entre R$ 19,96 e R$ 90,61, nota 0 e Status Reprovado — e a mesa
    // aprovou os 11.
    const saving = { economia_horas_mes: 40, economia_reais_mes: 5000, custo_evitado_reais: 1200 };
    const receita = { valor_ganho_mensal: 800 };
    const f = financeiroDoProjeto(saving, receita, linhaV2());
    expect(f.horas).toBe(60);
    expect(f.economiaReaisMes).toBeCloseTo(18.16, 2);
    expect(f.custoEvitado).toBeCloseTo(324005.09, 2);
    expect(f.valorReceita).toBe(0);
  });

  it('o v1 é a REDE: linha sem a coluna da v2 cai no número do SQLite', () => {
    // As 4 colunas financeiras da v2 estão 100% preenchidas em prod (745/745 em 09/09/2026), então
    // este caminho é rede para a linha que perdesse a coluna — não é o caminho normal.
    const saving = { economia_horas_mes: 40, economia_reais_mes: 5000, custo_evitado_reais: 1200 };
    const receita = { valor_ganho_mensal: 800 };
    const semV2 = linhaV2({
      'Impacto Líquido Mensal': '',
      'Saving Efetivado': '—',
      'Receita Incremental': '',
      'Custo Evitado Horas': '0',
    });
    const f = financeiroDoProjeto(saving, receita, semV2);
    expect(f.horas).toBe(40);
    expect(f.economiaReaisMes).toBe(5000);
    expect(f.custoEvitado).toBe(1200);
    expect(f.valorReceita).toBe(800);
  });

  it('⚠️ o caso REAL dos 11: impacto v2 baixo + número v1 alto → REPROVA pelo v2', () => {
    // `9d46f0e8…` (Burndown Melhoria e Dados CX): 7,5h liberadas → `Impacto Líquido Mensal`
    // R$ 19,96 na v2, contra ~R$ 200 se a hora entrasse cheia. Nota 0, Status Reprovado.
    const linha = linhaV2({ 'Custo Evitado Horas': '7,50', 'Impacto Líquido Mensal': '19,96', 'Saving Efetivado': '0,00' });
    const f = financeiroDoProjeto({ economia_reais_mes: 199.5, economia_horas_mes: 7.5 }, undefined, linha);
    expect(f.economiaReaisMes).toBeCloseTo(19.96, 2);
    const fin = avaliarFinanceiro({
      temSaving: f.temSaving,
      economiaReaisMes: f.economiaReaisMes,
      economiaHorasMes: f.horas,
      materialidade: f.economiaReaisMes,
      estrela: 0,
    });
    expect(fin.reprovavel).toBe(true);
  });

  it('v1 com as horas nas LINHAS (sem o total) soma as linhas', () => {
    const saving = { linhas: [{ economia_horas_mes: 12 }, { economia_horas_mes: 8 }] };
    expect(financeiroDoProjeto(saving, undefined, undefined).horas).toBe(20);
  });

  it('sem SQLite e sem linha do espelho: tudo null, sem lançar', () => {
    const f = financeiroDoProjeto(undefined, undefined, undefined);
    expect(f).toEqual({
      horas: 0,
      economiaReaisMes: null,
      custoEvitado: null,
      valorReceita: null,
      temSaving: false,
      temReceita: false,
    });
  });
});

describe('o efeito na MESA: o piso volta a disparar', () => {
  const fteOk = { implausivel: false, fte: 1, pessoas: 2, motivo: null } as ResultadoPlausibilidadeFTE;
  const ragApoio = { apoio: true, confianca: 0.85, vizinhos: 3, topSimilaridade: 0.8, motivo: null };

  it('ANTES (cega): sem número, o financeiro diz "sem dados" e a mesa NÃO reprova', () => {
    const cego = avaliarFinanceiro({ temSaving: false, temReceita: false });
    expect(cego.veredito).toBe('inconclusivo');
    expect(cego.reprovavel).toBe(false);
    expect(agregarVotos({ fte: fteOk, financeiro: cego, rag: ragApoio }).veredito).not.toBe('reprovar');
  });

  it('DEPOIS: com o financeiro da linha v2 e nota 0, a mesa REPROVA pelo piso', () => {
    const f = financeiroDoProjeto(undefined, undefined, linhaV2());
    const fin = avaliarFinanceiro({
      temSaving: f.temSaving,
      temReceita: f.temReceita,
      economiaReaisMes: f.economiaReaisMes,
      economiaHorasMes: f.horas,
      custoEvitadoReais: f.custoEvitado,
      valorReceitaMensal: f.valorReceita,
      materialidade: f.economiaReaisMes,
      estrela: 0,
    });
    expect(fin.abaixoDoPiso).toBe(true);
    expect(fin.reprovavel).toBe(true);
    expect(agregarVotos({ fte: fteOk, financeiro: fin, rag: ragApoio }).veredito).toBe('reprovar');
  });

  it('e com nota 1 NÃO reprova, nem vendo o número (a régua é `< 1`)', () => {
    const f = financeiroDoProjeto(undefined, undefined, linhaV2());
    const fin = avaliarFinanceiro({
      temSaving: f.temSaving,
      economiaReaisMes: f.economiaReaisMes,
      materialidade: f.economiaReaisMes,
      estrela: 1,
    });
    expect(fin.abaixoDoPiso).toBe(true);
    expect(fin.reprovavel).toBe(false);
    expect(agregarVotos({ fte: fteOk, financeiro: fin, rag: ragApoio }).veredito).not.toBe('reprovar');
  });
});

describe('mapaDeLinhas — o índice por id', () => {
  it('indexa tolerante a caixa (legado vem em MAIÚSCULA da planilha)', () => {
    const m = mapaDeLinhas([linhaV2({ 'ID Projeto': 'LEGADO-057' })]);
    expect(m.get('legado-057')).toBeTruthy();
    expect(m.get('LEGADO-057')).toBeUndefined(); // a chave é sempre minúscula
  });

  it('linha sem ID não entra (separador, rodapé, lixo)', () => {
    expect(mapaDeLinhas([{ Projeto: 'sem id' } as SheetRow]).size).toBe(0);
  });
});

describe('chave canônica na entrada da mesa (09/09/2026)', () => {
  it('a mesa normaliza o id, como os outros leitores da avaliação', () => {
    // ⚠️ Medido em prod: `legado-057` reprovava pelo piso e `LEGADO-057` dava "projeto não
    // encontrado" — o MESMO projeto. A planilha guarda legado em MAIÚSCULA, o sync cria a linha em
    // minúscula, e o `=` do SQLite é sensível a caixa. O id que a TELA manda vem do espelho, ou
    // seja como está na planilha: sem isto o lote da triagem falharia calado em todo legado.
    const src = readFileSync('src/lib/avaliacao-normais.functions.ts', 'utf8');
    const fn = src.slice(src.indexOf('export async function avaliarProjetoNormal('));
    expect(fn.slice(0, 1400)).toMatch(/const projetoId = chaveProjeto\(projetoIdBruto\)/);
  });
});
