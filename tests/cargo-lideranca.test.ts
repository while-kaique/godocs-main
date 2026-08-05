// D20 — a isenção de pré-aprovação é pelo CARGO (coordenador para cima).
//
// Os casos são REAIS, tirados da TeamGuide em 05/08/2026 (é o que fechou a decisão):
// a régua tem de reproduzir a cadeia que o Luis conferiu no organograma e blindar os
// falsos positivos que a palavra solta produzia.
import { describe, it, expect } from 'vitest';
import {
  ehCargoDeLideranca,
  CARGOS_LIDERANCA,
  EXCECOES_CARGO_LIDERANCA,
} from '@/lib/cargo-lideranca';

describe('ehCargoDeLideranca — a cadeia real da Fablícia', () => {
  it('analista e supervisora entram em fila; gerente para cima é isento', () => {
    // Fablícia → Kelly → João Conde → Rafael Menezes → Guilherme → Rafael Lobo.
    expect(ehCargoDeLideranca('Analista de Logistica PL')).toBe(false);
    expect(ehCargoDeLideranca('Supervisora de Transportes')).toBe(false);
    expect(ehCargoDeLideranca('Gerente de Transportes')).toBe(true);
    expect(ehCargoDeLideranca('Diretor de Operações')).toBe(true);
    expect(ehCargoDeLideranca('COO')).toBe(true);
    expect(ehCargoDeLideranca('CEO')).toBe(true);
  });

  it('a cadeia do Arnaldo: Diretor de Arte em fila, a Coordenadora dele isenta', () => {
    // A exceção que o Luis fechou olhando o organograma: "Diretor de Arte" é cargo de
    // criação, e quem pré-aprova o Arnaldo é a Aline (coordenadora), que é isenta.
    expect(ehCargoDeLideranca('Diretor de Arte PL II')).toBe(false);
    expect(ehCargoDeLideranca('Coordenadora de Ilustração e Cadastro PL')).toBe(true);
    expect(ehCargoDeLideranca('Diretor Executivo')).toBe(true);
  });
});

describe('ehCargoDeLideranca — supervisor NÃO isenta (régua do Luis)', () => {
  it.each([
    'Supervisor de Operações',
    'Supervisor de Operações JR II',
    'Supervisora de Logística',
    'Supervisor(a) de Pos Vendas PL',
    'Supervisora de Ilustração',
  ])('%s → em fila', (cargo) => {
    expect(ehCargoDeLideranca(cargo)).toBe(false);
  });
});

describe('ehCargoDeLideranca — quem lidera gente mas tem cargo de IC segue em fila', () => {
  // 22 pessoas assim na org; as duas primeiras têm 12 liderados cada. É intencional:
  // decide o CARGO, não o tamanho do time (foi por isso que o `liderados > 0` caiu).
  it.each([
    'Team Líder Cx',
    'Team Leader de Atendimento PL',
    'Tech Lead',
    'Staff Engineer Front-End',
    'Growth Lead',
    'Líder de Expedição II',
    'Especialista de Engenharia de Produto',
    'Product Manager SR',
  ])('%s → em fila', (cargo) => {
    expect(ehCargoDeLideranca(cargo)).toBe(false);
  });
});

describe('ehCargoDeLideranca — falsos positivos da palavra solta', () => {
  it('"Social"/"Sociais" não fazem de ninguém sócio', () => {
    // `soci` casava dentro de "Social" e "Sociais" — 3 pessoas viravam isentas.
    expect(ehCargoDeLideranca('Assistente de Social Media')).toBe(false);
    expect(ehCargoDeLideranca('Estagiário de Redes Sociais - Conteúdo De Futebol')).toBe(false);
    expect(ehCargoDeLideranca('Sócio')).toBe(true);
  });

  it('gerência de OFÍCIO (projetos/produto) é exceção; de gente, não', () => {
    expect(ehCargoDeLideranca('Gerente de Projetos')).toBe(false);
    expect(ehCargoDeLideranca('Gerente de Projetos B2B')).toBe(false);
    expect(ehCargoDeLideranca('Diretor de Produto')).toBe(false);
    expect(ehCargoDeLideranca('Gerente de produto')).toBe(false);
    // Coordenação NÃO é exceção (lideram 5 e 3 pessoas de fato — decisão 05/08/2026).
    expect(ehCargoDeLideranca('Coordenador de Projetos')).toBe(true);
    expect(ehCargoDeLideranca('Coordenadora de produtos')).toBe(true);
  });
});

describe('ehCargoDeLideranca — bordas', () => {
  it('júnior no cargo alto continua isento (letra da régua)', () => {
    expect(ehCargoDeLideranca('Coordenador de RPA JR')).toBe(true);
    expect(ehCargoDeLideranca('Coordenadora Fiscal JR')).toBe(true);
    expect(ehCargoDeLideranca('Gerente de Marketing Jr')).toBe(true);
  });

  it('sem cargo → em fila (o seguro é passar pelo líder)', () => {
    expect(ehCargoDeLideranca(null)).toBe(false);
    expect(ehCargoDeLideranca('')).toBe(false);
    expect(ehCargoDeLideranca('   ')).toBe(false);
    expect(ehCargoDeLideranca('Agente De Atendimento CX')).toBe(false);
  });

  it('acento, caixa e espaço a mais não mudam o veredito', () => {
    expect(ehCargoDeLideranca('HEAD DE OPERACOES')).toBe(true);
    expect(ehCargoDeLideranca('  coordenadora   de   design  ')).toBe(true);
    expect(ehCargoDeLideranca('Diretoria')).toBe(true);
  });

  it('as listas são declaradas e não se sobrepõem por acidente', () => {
    expect(CARGOS_LIDERANCA.length).toBeGreaterThan(0);
    expect(EXCECOES_CARGO_LIDERANCA.every((e) => e === e.toLowerCase())).toBe(true);
    // Toda exceção precisa conter uma palavra da lista alta — senão é linha morta.
    for (const e of EXCECOES_CARGO_LIDERANCA) {
      expect(CARGOS_LIDERANCA.some((c) => e.includes(c))).toBe(true);
    }
  });
});
