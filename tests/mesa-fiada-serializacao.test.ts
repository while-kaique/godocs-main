/**
 * T5 (fiação da mesa LLM) — invariantes da SERIALIZAÇÃO dos votos gravados na auditoria.
 *
 * Dois contratos que a fiação não pode quebrar:
 *  1. **Byte-idêntico com a mesa LLM OFF**: sem `julgamentos`, o JSON de auditoria é o de sempre —
 *     a chave `julgamentos` nem aparece.
 *  2. **Sem vazamento no modo LLM**: com `julgamentos`, cada parecer entra ENXUTO
 *     (`dimensao`/`preocupa`/`confianca`/`origem`) — nunca o `argumento` livre nem os `sinais`
 *     (o texto do parecer vive no `motivo` da avaliação, não aqui), e nenhum R$ cru é serializado.
 */
import { describe, it, expect } from 'vitest';
import { serializarVotos, type VotosPainel } from '@/lib/avaliacao-normais.functions';
import { avaliarPlausibilidadeFTE } from '@/lib/agents/analyzer';
import { avaliarFinanceiro } from '@/lib/agents/avaliacao-financeira';
import { avaliarSinalRag, agregarVotos } from '@/lib/agents/agregador-avaliacao';
import { avaliarCetico } from '@/lib/agents/cetico-avaliacao';
import { conciliarComCetico } from '@/lib/deliberacao';
import type { JulgamentoEspecialista } from '@/lib/agents/especialista-avaliacao';

/** Monta um `VotosPainel` real (todos os votos pelas funções puras) — modo determinístico. */
function votosBase(): VotosPainel {
  const fte = avaliarPlausibilidadeFTE({
    horasTotais: 40,
    pessoasDeclaradas: 1,
    temMultiplo: false,
    especial: false,
    fluxoDireto: false,
    fator: 1.5,
  });
  const financeiro = avaliarFinanceiro({
    temSaving: true,
    temReceita: false,
    economiaReaisMes: 3000,
    economiaHorasMes: 40,
    materialidade: 3000,
  });
  const rag = avaliarSinalRag([{ similaridade: 0.72 }, { similaridade: 0.61 }]);
  const agregado = agregarVotos({ fte, financeiro, rag });
  const cetico = avaliarCetico({
    agregadoVeredito: agregado.veredito,
    fte: { implausivel: fte.implausivel, fte: fte.fte, pessoas: fte.pessoas },
    financeiro: { veredito: financeiro.veredito, confianca: financeiro.confianca },
    rag: {
      apoio: rag.apoio,
      confianca: rag.confianca,
      vizinhos: rag.vizinhos,
      topSimilaridade: rag.topSimilaridade,
    },
    fator: 1.5,
  });
  const conciliado = conciliarComCetico(agregado, cetico);
  return {
    fte,
    financeiro,
    rag,
    cetico,
    agregado,
    conciliado,
    vizinhos: 2,
    ehLider: false,
    ceticoRefuta: cetico.refuta,
  };
}

describe('serializarVotos — byte-idêntico com a mesa LLM OFF', () => {
  it('sem julgamentos, o JSON não traz a chave `julgamentos`', () => {
    const json = JSON.parse(serializarVotos(votosBase()));
    expect(json.julgamentos).toBeUndefined();
    expect('julgamentos' in json).toBe(false);
  });

  it('julgamentos vazio ([]) também não introduz a chave (guarda o `?.length`)', () => {
    const json = JSON.parse(serializarVotos({ ...votosBase(), julgamentos: [] }));
    expect('julgamentos' in json).toBe(false);
  });
});

describe('serializarVotos — modo mesa LLM (sem vazamento)', () => {
  const julgamentos: JulgamentoEspecialista[] = [
    {
      dimensao: 'fte',
      preocupa: true,
      argumento: 'FTE de 12 exige 12 pessoas e só há 1 declarada — implausível. Vale R$ 51.000.',
      confianca: 0.9,
      sinais: ['fte alto', 'valor/hora R$ 85 por cargo'],
      origem: 'llm',
    },
    {
      dimensao: 'cetico',
      preocupa: false,
      argumento: 'Nada a refutar; números coerentes.',
      confianca: 0.7,
      sinais: [],
      origem: 'deterministico',
    },
  ];

  it('serializa julgamentos ENXUTOS: só dimensao/preocupa/confianca/origem', () => {
    const json = JSON.parse(serializarVotos({ ...votosBase(), julgamentos }));
    expect(Array.isArray(json.julgamentos)).toBe(true);
    expect(json.julgamentos).toHaveLength(2);
    for (const j of json.julgamentos) {
      expect(Object.keys(j).sort()).toEqual(['confianca', 'dimensao', 'origem', 'preocupa']);
    }
    expect(json.julgamentos[0]).toMatchObject({
      dimensao: 'fte',
      preocupa: true,
      confianca: 0.9,
      origem: 'llm',
    });
  });

  it('nunca vaza o `argumento` nem R$ cru dos pareceres LLM', () => {
    const bruto = serializarVotos({ ...votosBase(), julgamentos });
    // A chave `argumento` NÃO é serializada em lugar nenhum (o texto do parecer vive no `motivo`).
    expect(bruto).not.toContain('argumento');
    // O texto livre dos pareceres (com R$ e valor/hora por cargo) NÃO pode aparecer na auditoria.
    expect(bruto).not.toContain('51.000');
    expect(bruto).not.toContain('valor/hora');
    // Os `sinais` do JULGAMENTO ficam de fora (os do voto cético determinístico seguem, à parte).
    const json = JSON.parse(bruto) as { julgamentos: Record<string, unknown>[] };
    for (const j of json.julgamentos) expect('sinais' in j).toBe(false);
  });
});
