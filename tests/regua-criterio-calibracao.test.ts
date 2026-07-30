// Calibração da RÉGUA DE CRITÉRIO DE PROJETO no prompt do analisador.
//
// Origem: validação em staging — a nuvem de palavras (peça única, sob encomenda)
// saiu ZONA CINZENTA em vez de `claro_nao`, porque (a) o próprio entregável foi
// aceito como "indicador de rastreabilidade" ("dá pra ver no slide") e (b) o
// "na dúvida → zona cinzenta" absorveu a falha SIMULTÂNEA de recorrência e
// contrafactual. Estes testes encodam a calibração exigida no PROMPT (padrão de
// teste de conteúdo já usado em tests/analyzer-complexidade.test.ts).
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '@/lib/agents/analyzer';

/** Normaliza para asserção robusta: minúsculas, sem acento, espaços colapsados. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const PROMPT = buildSystemPrompt();

/** Fatia a seção da régua (do cabeçalho até o próximo cabeçalho de nível 2). */
function secaoRegua(): string {
  const i = PROMPT.indexOf('RÉGUA DE CRITÉRIO DE PROJETO');
  expect(i).toBeGreaterThan(-1);
  const resto = PROMPT.slice(i);
  const fim = resto.indexOf('\n## ');
  return fim > 0 ? resto.slice(0, fim) : resto;
}

const REGUA_N = norm(secaoRegua());

/** Linhas da régua que mencionam um termo (para asserções de co-ocorrência local). */
function linhasComTermo(termo: RegExp): string[] {
  return secaoRegua()
    .split('\n')
    .map(norm)
    .filter((l) => termo.test(l));
}

describe('A1 — o próprio entregável NÃO é indicador de rastreabilidade', () => {
  it('declara explicitamente que o artefato/entregável produzido não conta como indicador', () => {
    // A régua precisa NEGAR o entregável como evidência, não apenas descrever
    // o que é um bom indicador.
    expect(REGUA_N).toMatch(/(entregavel|artefato|material produzido|arquivo gerado)/);
    expect(REGUA_N).toMatch(/nao (conta|vale|serve|e) (como )?indicador/);

    const linhasEntregavel = linhasComTermo(/entregavel|artefato|arquivo gerado/);
    expect(linhasEntregavel.length).toBeGreaterThan(0);
    // A negação tem de estar NA MESMA passagem do entregável (senão o LLM não liga uma coisa à outra).
    expect(
      linhasEntregavel.some((l) => /nao (conta|vale|serve|e) (como )?indicador/.test(l)),
    ).toBe(true);
  });

  it('define indicador como MÉTRICA verificável hoje numa fonte, comparável antes × depois', () => {
    expect(REGUA_N).toMatch(/metrica/);
    // A taxonomia de métricas (horas · custo · erro · prazo · receita) segue disponível.
    for (const m of [/horas/, /custo/, /(taxa de )?erro/, /prazo/, /receita/]) {
      expect(REGUA_N).toMatch(m);
    }
    // "se abre HOJE num relatório/sistema/base"
    expect(REGUA_N).toMatch(/hoje/);
    expect(REGUA_N).toMatch(/(relatorio|sistema|base)/);
    // "compara antes × depois"
    expect(REGUA_N).toMatch(/antes\s*(x|×|vs\.?|e)\s*depois/);
  });

  it('quando a ÚNICA evidência é o próprio entregável, a rastreabilidade é NÃO comprovada', () => {
    expect(REGUA_N).toMatch(/(unica|so) evidencia/);
    const linhas = linhasComTermo(/(unica|so) evidencia/);
    expect(
      linhas.some(
        (l) =>
          /(entregavel|artefato|arquivo gerado|material)/.test(l) &&
          /nao (esta )?(comprovada|comprovado)|nao comprova/.test(l),
      ),
    ).toBe(true);
  });
});

describe('A2 — par explícito que reprova: recorrência falha E contrafactual negado', () => {
  it('declara o par (sem recorrência + contrafactual negado) como caso de claro_nao', () => {
    const linhasClaroNao = linhasComTermo(/claro_nao/);
    expect(linhasClaroNao.length).toBeGreaterThan(0);

    const parDeclarado = linhasClaroNao.some(
      (l) =>
        /recorrencia/.test(l) &&
        /contrafactual/.test(l) &&
        /(nada piora|ninguem reclama|nao piora|ninguem sente)/.test(l) &&
        /(rodou uma (unica )?vez|sob encomenda|peca unica)/.test(l),
    );
    expect(parDeclarado).toBe(true);
  });

  it('proíbe buscar salvação numa evidência de que o entregável existiu', () => {
    expect(REGUA_N).toMatch(
      /(sem (buscar|procurar) salvacao|nao (busque|procure) salvacao|nao basta (a )?(evidencia|prova) de que o entregavel)/,
    );
  });

  it('mantém o "na dúvida → zona_cinzenta" MAS declara a exceção quando os dois critérios falham juntos', () => {
    // O fallback conservador PERMANECE...
    expect(REGUA_N).toMatch(/(na duvida|em duvida)/);
    expect(REGUA_N).toMatch(/zona_cinzenta/);

    // ...com a exceção declarada para a falha SIMULTÂNEA.
    const linhasDuvida = linhasComTermo(/na duvida|em duvida|zona_cinzenta/);
    expect(
      linhasDuvida.some(
        (l) =>
          /(excecao|nao se aplica|salvo|exceto)/.test(l) &&
          /(juntos|ambos|os dois|simultane)/.test(l),
      ),
    ).toBe(true);
  });
});

describe('A3 — exemplo-âncora da nuvem de palavras reforçado', () => {
  it('segue claro_nao MESMO com o resultado visível no slide/material', () => {
    const linhas = linhasComTermo(/nuvem de palavras/);
    expect(linhas.length).toBeGreaterThan(0);
    const linha = linhas.join(' ');

    expect(linha).toMatch(/claro_nao/);
    expect(linha).toMatch(/(slide|material|apresentacao)/);
    expect(linha).toMatch(/(mesmo que|mesmo quando|ainda que|mesmo se|inclusive quando)/);
  });
});
