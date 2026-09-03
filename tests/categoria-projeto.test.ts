import { describe, it, expect } from 'vitest';
import {
  TIPOS_PROJETO,
  NIVEIS_PROJETO,
  ROTULO_TIPO,
  ROTULO_NIVEL,
  DEFINICAO_TIPO,
  normalizarTipo,
  palpitarTipo,
  resolverTipoProjeto,
  coerirTipoComNivel,
  rebaixarAgenticoSemSinal,
  grauDoNivel,
  tipoParaSheet,
} from '@/lib/categoria-projeto';

describe('eixo TIPO — a lista e os rótulos', () => {
  it('tem os 5 tipos do plano, com rótulo e definição para cada um', () => {
    expect([...TIPOS_PROJETO]).toEqual(['agente', 'sistema', 'app', 'dashboard', 'automacao']);
    for (const t of TIPOS_PROJETO) {
      expect(ROTULO_TIPO[t]).toBeTruthy();
      expect(DEFINICAO_TIPO[t].length).toBeGreaterThan(40);
    }
  });

  it('normaliza rótulo, acento, caixa e sinônimo de uma palavra', () => {
    expect(normalizarTipo('Automação')).toBe('automacao');
    expect(normalizarTipo('  DASHBOARD ')).toBe('dashboard');
    expect(normalizarTipo('Painel')).toBe('dashboard');
    expect(normalizarTipo('chatbot')).toBe('agente');
    expect(normalizarTipo('RPA')).toBe('automacao');
    expect(normalizarTipo('')).toBeNull();
    expect(normalizarTipo('coisa que não existe')).toBeNull();
  });
});

describe('palpite determinístico', () => {
  it('respeita a PRECEDÊNCIA, não a contagem de ocorrências', () => {
    // "painel" aparece 3× e "agente" 1× — quem vence é o agente (precedência).
    const texto = 'Agente que responde o cliente. Tem painel de acompanhamento, painel de fila e painel de SLA.';
    expect(palpitarTipo(texto)?.tipo).toBe('agente');
  });

  it('devolve a pista que casou, para o painel de validação poder explicar', () => {
    expect(palpitarTipo('Robô que preenche a planilha do fiscal')?.tipo).toBe('automacao');
    expect(palpitarTipo('Robô que preenche a planilha do fiscal')?.evidencia).toMatch(/rob/i);
  });

  it('texto vazio ou sem pista nenhuma não inventa tipo', () => {
    expect(palpitarTipo('')).toBeNull();
    expect(palpitarTipo('   ')).toBeNull();
    expect(palpitarTipo('Coisa qualquer sem vocabulário conhecido')).toBeNull();
  });
});

describe('resolverTipoProjeto — LLM primeiro, determinístico como rede', () => {
  it('o LLM vence o palpite quando responde algo válido', () => {
    const r = resolverTipoProjeto({ sugestaoLLM: 'sistema', texto: 'painel de indicadores' });
    expect(r.tipo).toBe('sistema');
    expect(r.origem).toBe('llm');
  });

  it('LLM mudo ou com lixo cai no palpite determinístico', () => {
    const r = resolverTipoProjeto({ sugestaoLLM: null, texto: 'Dashboard de margem diária' });
    expect(r.tipo).toBe('dashboard');
    expect(r.origem).toBe('deterministico');
    expect(r.evidencia).toBeTruthy();
  });

  it('sem LLM e sem pista, fica INDEFINIDO em vez de chutar', () => {
    const r = resolverTipoProjeto({ sugestaoLLM: undefined, texto: 'xyz' });
    expect(r.tipo).toBeNull();
    expect(r.origem).toBe('indefinido');
  });
});

describe('guards — só rebaixam, nunca promovem', () => {
  it("'agente' sem IA em runtime vira automação (o menu de respostas fixas não é agente)", () => {
    const r = coerirTipoComNivel('agente', { ia_efetiva: false });
    expect(r.tipo).toBe('automacao');
    expect(r.ajuste).toMatch(/agente/);
  });

  it('sinal null NÃO mexe no tipo (submissão antiga sem o campo)', () => {
    expect(coerirTipoComNivel('agente', { ia_efetiva: null }).tipo).toBe('agente');
    expect(coerirTipoComNivel('agente', {}).tipo).toBe('agente');
  });

  it('nenhum guard PROMOVE: automação com IA não vira agente sozinha', () => {
    expect(coerirTipoComNivel('automacao', { ia_efetiva: true }).tipo).toBe('automacao');
  });
});

describe('eixo NÍVEL — reaproveita a Complexidade e ganha o 4º degrau', () => {
  it('os 3 valores legados continuam sendo os mesmos slugs gravados na planilha', () => {
    expect([...NIVEIS_PROJETO]).toEqual(['automacao', 'inteligencia', 'autonomia', 'agentico']);
    expect(ROTULO_NIVEL.automacao).toBe('Determinístico');
    expect(ROTULO_NIVEL.agentico).toBe('Agêntico');
  });

  it('a escala vai do mais simples ao mais alto', () => {
    expect(grauDoNivel('automacao')).toBeLessThan(grauDoNivel('inteligencia'));
    expect(grauDoNivel('autonomia')).toBeLessThan(grauDoNivel('agentico'));
  });

  it('agentico exige ação consequente E IA — senão rebaixa', () => {
    expect(rebaixarAgenticoSemSinal('agentico', { acao_autonoma: false, ia_efetiva: true }).nivel).toBe('inteligencia');
    expect(rebaixarAgenticoSemSinal('agentico', { acao_autonoma: false, ia_efetiva: false }).nivel).toBe('automacao');
    expect(rebaixarAgenticoSemSinal('agentico', { acao_autonoma: true, ia_efetiva: false }).nivel).toBe('autonomia');
  });

  it('sinal ausente não rebaixa (confia no LLM, como o freio da autonomia)', () => {
    expect(rebaixarAgenticoSemSinal('agentico', {}).nivel).toBe('agentico');
    expect(rebaixarAgenticoSemSinal('agentico', { acao_autonoma: null, ia_efetiva: null }).nivel).toBe('agentico');
  });

  it('não mexe em nível que não é agentico', () => {
    expect(rebaixarAgenticoSemSinal('autonomia', { acao_autonoma: false, ia_efetiva: false }).nivel).toBe('autonomia');
  });
});

describe('célula da planilha', () => {
  it('sem tipo grava "—", o padrão do repo (nunca vazio)', () => {
    expect(tipoParaSheet(null)).toBe('—');
    expect(tipoParaSheet(undefined)).toBe('—');
    expect(tipoParaSheet('dashboard')).toBe('Dashboard');
  });
});

describe('gotcha do `\\b` ASCII-only', () => {
  it('pista terminada em letra acentuada casa mesmo assim ("robô" seguido de espaço)', () => {
    // `/\brob[ôo]\b/` NUNCA casaria: em JS o `ô` já é não-palavra, então não há fronteira
    // depois dele. É o mesmo erro que deixou `nao foi medid\b` inerte nas PISTAS_PROJECAO.
    expect(palpitarTipo('Robô que roda de madrugada')?.tipo).toBe('automacao');
    expect(palpitarTipo('robô')?.tipo).toBe('automacao');
    // ...e continua não casando dentro de outra palavra.
    expect(palpitarTipo('robôtica de bancada')).toBeNull();
  });
});
