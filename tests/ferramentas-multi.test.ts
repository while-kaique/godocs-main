// Multi-seleção de ferramentas (12/08/2026) × a coluna de UMA string.
//
// O campo virou multi-seleção, mas `projetos.ferramenta` (banco e Sheets) continua sendo
// UMA string de 200 chars. Todo o risco mora nas 3 funções puras que fazem a ponte:
// - `serializarFerramentas`   — lista → string (o que vai para a planilha)
// - `desserializarFerramentas` — string → lista (o que a EDIÇÃO reabre)
// - `limiteFerramentaOutra`   — quantos chars ainda cabem em "Outros: …"
//
// O que este arquivo protege, em ordem de dano:
// 1. Ida-e-volta: o que a pessoa marcou tem de reabrir IGUAL na edição. Sem isso, editar
//    um projeto para trocar um participante apagaria/trocaria a ferramenta em silêncio.
// 2. Valores LEGADOS de quando o campo era escolha única ("Claude", "Claude + GoDeploy")
//    e da planilha ("python" minúsculo, "Power Automate" fora da lista).
// 3. O cap dinâmico de "Outros" — um cap fixo volta a estourar o zod de 200 chars DEPOIS
//    de tudo preenchido (a família do bug do caso Josiely, ver `erro-validacao.ts`).
import { describe, it, expect } from 'vitest';
import {
  FERRAMENTAS,
  FERRAMENTA_MAX,
  FERRAMENTAS_OPCOES,
  serializarFerramentas,
  desserializarFerramentas,
  limiteFerramentaOutra,
} from '@/lib/submeter/constants';

describe('serializarFerramentas — lista → a string que vai para o Sheets', () => {
  it('uma escolha vira a string crua (nada de separador sobrando)', () => {
    expect(serializarFerramentas(['Python'], '')).toBe('Python');
  });

  it('nenhuma escolha vira string vazia', () => {
    expect(serializarFerramentas([], '')).toBe('');
  });

  it('junta com " + " — o MESMO separador do valor legado "Claude + GoDeploy"', () => {
    expect(serializarFerramentas(['Claude Code', 'GoDeploy'], '')).toBe('Claude Code + GoDeploy');
  });

  // A ordem é a canônica da lista, NÃO a dos cliques: o `metaChanged` do wizard compara
  // strings, e ordem por clique faria a mesma escolha parecer mudança (reprocessando o
  // agente de graça).
  it('a ordem é a da lista, não a dos cliques', () => {
    const a = serializarFerramentas(['GoDeploy', 'n8n', 'Claude Code'], '');
    const b = serializarFerramentas(['Claude Code', 'GoDeploy', 'n8n'], '');
    expect(a).toBe(b);
    // Ordem canônica ATUAL = ordem visual da grade (coluna 1 = Claudes, 2 = Python/n8n/GoDeploy,
    // 3 = Apps Script/Vercel/Outros). Ver FERRAMENTAS_OPCOES.
    expect(a).toBe('Claude Code + n8n + GoDeploy');
  });

  it('"Outros" viaja como "Outros: <texto>" e fica no fim', () => {
    expect(serializarFerramentas(['Outros', 'n8n'], 'Retool')).toBe('n8n + Outros: Retool');
  });

  // A grade é preenchida por COLUNA, então a ordem visual (= canônica) começa pelos Claudes.
  it('a ordem canônica abre pela família Claude (1ª coluna da grade)', () => {
    expect(serializarFerramentas(['Vercel', 'Claude.ai'], '')).toBe('Claude.ai + Vercel');
  });

  it('"Outros" sem texto não inventa prefixo', () => {
    expect(serializarFerramentas(['Outros'], '   ')).toBe('Outros');
  });
});

describe('desserializarFerramentas — a string do banco → os chips da edição', () => {
  it('quebra pelo separador', () => {
    expect(desserializarFerramentas('n8n + Python')).toEqual({
      ferramentas: ['n8n', 'Python'],
      ferramentaOutra: '',
    });
  });

  it('vazio/null não viram chip nenhum', () => {
    expect(desserializarFerramentas(null).ferramentas).toEqual([]);
    expect(desserializarFerramentas('').ferramentas).toEqual([]);
  });

  // O valor legado mais comum da planilha. Sem esta conversão o projeto reabriria com
  // ZERO chips e a pessoa teria de redescobrir com o que ela mesma construiu.
  it('"Claude + GoDeploy" (escolha única antiga) vira Claude Code + GoDeploy', () => {
    expect(desserializarFerramentas('Claude + GoDeploy').ferramentas).toEqual([
      'Claude Code',
      'GoDeploy',
    ]);
  });

  it('"Claude" sozinho vira Claude Code (o Claude que CONSTRÓI)', () => {
    expect(desserializarFerramentas('Claude').ferramentas).toEqual(['Claude Code']);
  });

  it('caixa da planilha não importa ("python" → "Python")', () => {
    expect(desserializarFerramentas('python').ferramentas).toEqual(['Python']);
  });

  it('"Outros: X" volta separado no campo de texto', () => {
    expect(desserializarFerramentas('n8n + Outros: Retool')).toEqual({
      ferramentas: ['n8n', 'Outros'],
      ferramentaOutra: 'Retool',
    });
  });

  // Legado importado do Sheets traz ferramenta que nunca esteve na lista. Ela é mantida
  // como chip EXTRA (o seletor a desenha) — descartar aqui faria o dado desaparecer da
  // tela e, no próximo salvamento, da planilha.
  it('preserva valor fora da lista em vez de descartar', () => {
    expect(desserializarFerramentas('Power Automate').ferramentas).toEqual(['Power Automate']);
    expect(desserializarFerramentas('n8n + VBA').ferramentas).toEqual(['n8n', 'VBA']);
  });

  it('não duplica quando a string repete a mesma ferramenta', () => {
    expect(desserializarFerramentas('n8n + n8n').ferramentas).toEqual(['n8n']);
  });
});

describe('ida-e-volta: marcar → gravar → reabrir devolve a MESMA escolha', () => {
  // ⚠️ Os casos estão na ordem CANÔNICA (= a visual da grade), porque é nela que a volta
  // entrega: a ida normaliza a ordem de propósito. Marcar em outra ordem também reabre igual
  // — é o teste logo abaixo desta lista.
  const casos: { ferramentas: string[]; outra: string }[] = [
    { ferramentas: ['Python'], outra: '' },
    { ferramentas: ['Claude Code', 'n8n'], outra: '' },
    { ferramentas: ['Claude.ai', 'Claude Cowork', 'Claude Code'], outra: '' },
    { ferramentas: ['GoDeploy', 'Google Apps Script', 'Vercel'], outra: '' },
    { ferramentas: ['n8n', 'Outros'], outra: 'Retool' },
    { ferramentas: ['Power Automate'], outra: '' },
  ];

  for (const caso of casos) {
    it(`[${caso.ferramentas.join(', ')}]${caso.outra ? ` + "${caso.outra}"` : ''}`, () => {
      const gravado = serializarFerramentas(caso.ferramentas, caso.outra);
      expect(desserializarFerramentas(gravado)).toEqual({
        ferramentas: caso.ferramentas,
        ferramentaOutra: caso.outra,
      });
    });
  }

  // Clicar fora de ordem não perde nem embaralha nada: a volta entrega a ordem canônica.
  it('marcar em ordem qualquer reabre na ordem canônica, com o mesmo conjunto', () => {
    const gravado = serializarFerramentas(['Outros', 'GoDeploy', 'Claude.ai'], 'Retool');
    expect(desserializarFerramentas(gravado)).toEqual({
      ferramentas: ['Claude.ai', 'GoDeploy', 'Outros'],
      ferramentaOutra: 'Retool',
    });
  });

  it('TODAS as opções marcadas cabem nos 200 chars da coluna', () => {
    const todas = serializarFerramentas([...FERRAMENTAS], '');
    expect(todas.length).toBeLessThanOrEqual(FERRAMENTA_MAX);
    expect(desserializarFerramentas(todas).ferramentas).toEqual([...FERRAMENTAS]);
  });
});

describe('limiteFerramentaOutra — cap dinâmico do campo "Especifique"', () => {
  it('só "Outros" marcado reproduz o cap antigo de 192', () => {
    expect(limiteFerramentaOutra(['Outros'])).toBe(192);
  });

  it('cada ferramenta marcada come do orçamento', () => {
    expect(limiteFerramentaOutra(['n8n', 'Outros'])).toBe(192 - 'n8n + '.length);
  });

  it('a grade de 9 opções tem 3 linhas exatas (3 colunas)', () => {
    expect(FERRAMENTAS_OPCOES.length % 3).toBe(0);
  });

  // A garantia que importa: escrever o cap INTEIRO nunca estoura os 200 chars do zod.
  it('gastar o cap inteiro mantém a string dentro do limite', () => {
    for (const conhecidas of [['Outros'], ['n8n', 'Outros'], [...FERRAMENTAS]]) {
      const cap = limiteFerramentaOutra(conhecidas);
      const texto = 'x'.repeat(cap);
      expect(serializarFerramentas(conhecidas, texto).length).toBeLessThanOrEqual(FERRAMENTA_MAX);
    }
  });
});

describe('a lista de opções em si', () => {
  // O pedido que originou a feature: "Claude" deixou de ser uma opção só e virou 3
  // superfícies. Voltar a ter um "Claude" genérico desfaz a razão da mudança.
  it('as 3 superfícies do Claude existem e o "Claude" genérico não', () => {
    expect(FERRAMENTAS).toContain('Claude.ai');
    expect(FERRAMENTAS).toContain('Claude Cowork');
    expect(FERRAMENTAS).toContain('Claude Code');
    expect(FERRAMENTAS).not.toContain('Claude');
  });

  // A opção combinada era um artefato da escolha ÚNICA; com multi-seleção ela seria um
  // chip que significa dois chips.
  it('a opção combinada "Claude + GoDeploy" saiu da lista', () => {
    expect(FERRAMENTAS).not.toContain('Claude + GoDeploy');
    expect(FERRAMENTAS).toContain('GoDeploy');
  });

  it('nenhum rótulo contém o separador (senão a string não voltaria a quebrar certo)', () => {
    for (const f of FERRAMENTAS) expect(f).not.toContain(' + ');
  });

  it('as 3 superfícies do Claude compartilham a família (é ela que agrupa na tela)', () => {
    const claude = FERRAMENTAS_OPCOES.filter((o) => o.familia === 'Claude');
    expect(claude).toHaveLength(3);
    for (const o of claude) expect(o.variante).toBeTruthy();
  });
});
