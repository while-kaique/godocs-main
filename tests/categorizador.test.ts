import { describe, it, expect } from 'vitest';
import {
  montarPromptCategorizacao,
  interpretarResposta,
  extrairJson,
  TAMANHO_LOTE,
} from '@/lib/agents/categorizador';
import { TIPOS_PROJETO, DEFINICAO_TIPO } from '@/lib/categoria-projeto';

const lote = [
  { id: 'legado-001', nome: 'Painel de margem diária', descricao: 'Consolida margem por SKU' },
  { id: 'LEGADO-002', nome: 'Bot de atendimento', descricao: 'Responde o cliente com IA' },
  { id: 'abc123', nome: 'Coisa', descricao: '' },
];

describe('prompt', () => {
  it('leva a régua da FONTE ÚNICA, não uma cópia', () => {
    const p = montarPromptCategorizacao(lote);
    for (const t of TIPOS_PROJETO) expect(p).toContain(DEFINICAO_TIPO[t]);
  });

  it('manda os ids exatos e oferece "indefinido" como saída legítima', () => {
    const p = montarPromptCategorizacao(lote);
    expect(p).toContain('legado-001');
    expect(p).toContain('LEGADO-002');
    expect(p).toContain('indefinido');
  });

  it('o lote é de 20 — ~30 chamadas para as 581 linhas', () => {
    expect(TAMANHO_LOTE).toBe(20);
    expect(Math.ceil(581 / TAMANHO_LOTE)).toBe(30);
  });
});

describe('extrairJson', () => {
  it('aceita cerca de ```json e texto solto em volta', () => {
    expect(extrairJson('claro!\n```json\n{"itens":[]}\n```\n')).toEqual({ itens: [] });
  });
  it('resposta ininteligível → null, não exceção', () => {
    expect(extrairJson('desculpe, não consigo')).toBeNull();
    expect(extrairJson('')).toBeNull();
  });
});

describe('interpretarResposta', () => {
  it('casa por ID, nunca por posição (o LLM reordena)', () => {
    const r = interpretarResposta(
      JSON.stringify({
        itens: [
          { id: 'LEGADO-002', tipo: 'agente', porque: 'responde o cliente' },
          { id: 'legado-001', tipo: 'dashboard', porque: 'consolida e mostra' },
        ],
      }),
      lote,
    );
    expect(r[0]).toMatchObject({ id: 'legado-001', tipo: 'dashboard', origem: 'llm' });
    expect(r[1]).toMatchObject({ id: 'LEGADO-002', tipo: 'agente', origem: 'llm' });
  });

  it('casa id com caixa diferente da enviada', () => {
    const r = interpretarResposta(JSON.stringify({ itens: [{ id: 'legado-002', tipo: 'agente' }] }), lote);
    expect(r[1].tipo).toBe('agente');
  });

  it('SEMPRE devolve um item por projeto do lote, na ordem', () => {
    const r = interpretarResposta(JSON.stringify({ itens: [{ id: 'abc123', tipo: 'app' }] }), lote);
    expect(r.map((x) => x.id)).toEqual(['legado-001', 'LEGADO-002', 'abc123']);
  });

  it('item que o LLM pulou cai no palpite determinístico', () => {
    const r = interpretarResposta(JSON.stringify({ itens: [] }), lote);
    expect(r[0]).toMatchObject({ tipo: 'dashboard', origem: 'deterministico' }); // "Painel"
    expect(r[1]).toMatchObject({ tipo: 'agente', origem: 'deterministico' }); // "Bot"
    expect(r[2]).toMatchObject({ tipo: null, origem: 'indefinido' }); // "Coisa", sem pista
  });

  it('"indefinido" do LLM não é tipo — cai na rede, e sem pista fica null', () => {
    const r = interpretarResposta(JSON.stringify({ itens: [{ id: 'abc123', tipo: 'indefinido' }] }), lote);
    expect(r[2].tipo).toBeNull();
  });

  it('resposta ininteligível não derruba o lote', () => {
    const r = interpretarResposta('o proxy caiu', lote);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.origem !== 'llm')).toBe(true);
  });
});
