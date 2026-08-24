// Projeto como FEATURE de outro projeto — helpers PUROS (sem I/O).
import { describe, it, expect } from 'vitest';
import {
  prefixarNomeFeature,
  parseIdsFeature,
  acumularIdFeature,
  serializarIdsFeatureSheet,
  filtrarProjetosPorNome,
  normalizarBusca,
} from '@/lib/projeto-vinculo';

describe('prefixarNomeFeature', () => {
  it('prefixa o nome do filho com o NOME do pai', () => {
    expect(prefixarNomeFeature('Robô de NF', 'Portal Fiscal')).toBe(
      '[feature de Portal Fiscal] Robô de NF',
    );
  });

  it('é IDEMPOTENTE: não reprefixar no reenvio (nome já começa com "[feature de ")', () => {
    const uma = prefixarNomeFeature('Robô de NF', 'Portal Fiscal');
    expect(prefixarNomeFeature(uma, 'Portal Fiscal')).toBe(uma);
    // Mesmo se o pai mudar de nome, não empilha prefixo.
    expect(prefixarNomeFeature(uma, 'Outro Pai')).toBe(uma);
  });

  it('sem nome do pai devolve o nome como está (não inventa "[feature de ]")', () => {
    expect(prefixarNomeFeature('Robô de NF', '')).toBe('Robô de NF');
    expect(prefixarNomeFeature('Robô de NF', null)).toBe('Robô de NF');
  });
});

describe('acumularIdFeature / parseIdsFeature / serializar', () => {
  it('acumula sem duplicar (case-insensitive) e preserva a ordem', () => {
    let lista = acumularIdFeature(null, 'abc');
    expect(lista).toEqual(['abc']);
    lista = acumularIdFeature(lista, 'def');
    expect(lista).toEqual(['abc', 'def']);
    // duplicata (mesmo id, outra caixa) não entra
    lista = acumularIdFeature(lista, 'ABC');
    expect(lista).toEqual(['abc', 'def']);
  });

  it('parseIdsFeature aceita JSON array (SQLite) e CSV (célula do Sheets)', () => {
    expect(parseIdsFeature('["a","b"]')).toEqual(['a', 'b']);
    expect(parseIdsFeature('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(parseIdsFeature('a; b')).toEqual(['a', 'b']);
    expect(parseIdsFeature('—')).toEqual([]);
    expect(parseIdsFeature(null)).toEqual([]);
  });

  it('acumula a partir de uma célula CSV existente do Sheets', () => {
    expect(acumularIdFeature('a, b', 'c')).toEqual(['a', 'b', 'c']);
    expect(acumularIdFeature('a, b', 'a')).toEqual(['a', 'b']); // já lá
  });

  it('serializa para a célula "ID Feature" com o separador padrão', () => {
    expect(serializarIdsFeatureSheet(['a', 'b', 'c'])).toBe('a, b, c');
    expect(serializarIdsFeatureSheet([])).toBe('');
  });
});

describe('filtrarProjetosPorNome (autocomplete do pai)', () => {
  const projetos = [
    { id: '1', nome: 'Portal Fiscal', autor: 'Ana' },
    { id: '2', nome: 'Robô de Reembolsos', autor: 'Bruno' },
    { id: '3', nome: 'Automação de Faturamento', autor: 'Caio' },
  ];

  it('casa sem acento e sem caixa', () => {
    expect(filtrarProjetosPorNome(projetos, 'automacao').map((p) => p.id)).toEqual(['3']);
    expect(filtrarProjetosPorNome(projetos, 'FISCAL').map((p) => p.id)).toEqual(['1']);
  });

  it('q com menos de 2 caracteres devolve []', () => {
    expect(filtrarProjetosPorNome(projetos, 'a')).toEqual([]);
    expect(filtrarProjetosPorNome(projetos, '')).toEqual([]);
  });

  it('substring casa no meio do nome', () => {
    expect(filtrarProjetosPorNome(projetos, 'reembolso').map((p) => p.id)).toEqual(['2']);
  });

  it('respeita o limite', () => {
    expect(filtrarProjetosPorNome(projetos, 'o', 2)).toHaveLength(0); // 'o' < 2 chars? não: 1 char → []
    expect(filtrarProjetosPorNome(projetos, 'de', 1)).toHaveLength(1);
  });

  it('normalizarBusca colapsa espaços e tira acento', () => {
    expect(normalizarBusca('  Automação   Fiscal ')).toBe('automacao fiscal');
  });
});
