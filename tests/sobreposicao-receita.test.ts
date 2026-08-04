// Gate de SOBREPOSIÇÃO receita × custo evitado.
//
// Caso de origem (Sucesso.AI / Maria Ponciano): "Ressarcimento das transportadoras"
// (R$ 55.864,38) e "Receita retida em reenvio" (R$ 106.049,40) entraram como itens de
// custo evitado no saving e, no reenvio, DE NOVO como receita incremental
// (R$ 161.913,78 = a soma dos dois). O agente estranhou a NATUREZA do valor, avisou, a
// autora repetiu o número sem explicar e ele passou.
import { describe, it, expect } from 'vitest';
import {
  detectarSobreposicaoReceita,
  interpretarSobreposicao,
  deveBloquearPorSobreposicao,
  aplicaGateSobreposicao,
  sobreposicaoResolvida,
  extrairValores,
  normalizarTexto,
  lerItensCustoEvitado,
  perguntaSobreposicao,
  OPCOES_SOBREPOSICAO,
  type EstadoSobreposicao,
} from '@/lib/agents/sobreposicao-receita';

// Os 4 itens reais que estavam no custo evitado do Sucesso.AI.
const ITENS_SUCESSO_AI = JSON.stringify([
  { nome: 'Disparos Proativos - Agente Scooto', valor: 9474.32, recorrencia: 'mensal' },
  { nome: 'Disparo 2 cadência', valor: 2850, recorrencia: 'mensal' },
  { nome: 'Ressarcimento das transportadoras', valor: 55864.38, recorrencia: 'mensal' },
  { nome: 'Receita retida em reenvio', valor: 106049.4, recorrencia: 'mensal' },
]);

// O racional que a autora escreveu na etapa de receita.
const RACIONAL_SUCESSO_AI =
  'Receita retida em reenvio (antes todos os pedidos devolvidos eram reembolsados): R$ 106.049,40\n' +
  'Ressarcimento das transportadoras (Agora fica claro quais pedidos podemos solicitar extravio): R$ 55.864,38';

describe('detecção — o caso real que originou o gate', () => {
  it('pega a sobreposição do Sucesso.AI', () => {
    const det = detectarSobreposicaoReceita(ITENS_SUCESSO_AI, 161913.78, RACIONAL_SUCESSO_AI);
    expect(det).not.toBeNull();
    // Só os DOIS itens de receita — os dois custos evitados legítimos ficam de fora.
    expect(det!.itens.map((i) => i.nome).sort()).toEqual([
      'Receita retida em reenvio',
      'Ressarcimento das transportadoras',
    ]);
    expect(det!.total).toBeCloseTo(161913.78, 2);
    expect(det!.via).toBe('valor+nome');
  });

  it('pega mesmo sem o racional citar os valores (só os nomes)', () => {
    const det = detectarSobreposicaoReceita(
      ITENS_SUCESSO_AI,
      161913.78,
      'Vem do ressarcimento das transportadoras e da receita retida em reenvio.',
    );
    expect(det!.itens).toHaveLength(2);
    expect(det!.via).toBe('nome');
  });

  it('pega quando a receita é exatamente a SOMA de todos os itens, sem pistas de texto', () => {
    const itens = JSON.stringify([
      { nome: 'Contrato A', valor: 1000 },
      { nome: 'Contrato B', valor: 2000 },
    ]);
    const det = detectarSobreposicaoReceita(itens, 3000, 'ganho novo do projeto');
    expect(det!.itens).toHaveLength(2);
    expect(det!.via).toBe('valor');
  });

  it('pega um item isolado cujo valor é o total da receita', () => {
    const itens = JSON.stringify([{ nome: 'Licença Zendesk', valor: 4200 }]);
    const det = detectarSobreposicaoReceita(itens, 4200, 'vendas a mais');
    expect(det!.itens).toHaveLength(1);
  });
});

describe('detecção — não pode armar à toa', () => {
  it('projeto sem custo evitado nunca arma', () => {
    expect(detectarSobreposicaoReceita('[]', 50000, 'qualquer coisa')).toBeNull();
    expect(detectarSobreposicaoReceita(null, 50000, 'qualquer coisa')).toBeNull();
    expect(detectarSobreposicaoReceita('json quebrado {', 50000, 'x')).toBeNull();
  });

  it('valores e nomes diferentes não armam', () => {
    const det = detectarSobreposicaoReceita(
      ITENS_SUCESSO_AI,
      33000,
      'aumento de conversão no checkout após o novo fluxo',
    );
    expect(det).toBeNull();
  });

  it('nome curto NÃO casa — senão qualquer racional armaria o gate', () => {
    // "Frete" (5 chars) aparece em quase todo racional de e-commerce.
    const itens = JSON.stringify([{ nome: 'Frete', valor: 999 }]);
    const det = detectarSobreposicaoReceita(itens, 12345, 'economia de frete e mais vendas');
    expect(det).toBeNull();
  });

  it('item sem nome ou com valor zero é descartado', () => {
    const itens = JSON.stringify([
      { nome: '', valor: 500 },
      { nome: 'Serviço X', valor: 0 },
    ]);
    expect(lerItensCustoEvitado(itens)).toEqual([]);
  });
});

describe('helpers de texto', () => {
  it('normalizarTexto tira acento e preserva dígitos', () => {
    // ⚠️ Regressão: uma versão do regex de acentos comia dígitos (classe [0300-036f]).
    expect(normalizarTexto('Ressarcimento das TRANSPORTADORAS 123')).toBe(
      'ressarcimento das transportadoras 123',
    );
    expect(normalizarTexto('cadência')).toBe('cadencia');
  });

  it('extrairValores lê os montantes pt-BR do texto livre', () => {
    expect(extrairValores(RACIONAL_SUCESSO_AI)).toEqual([106049.4, 55864.38]);
  });
});

describe('interpretação da resposta', () => {
  it('clique decide (índice fixo: 1 = seguir, 2 = corrigir)', () => {
    expect(interpretarSobreposicao(OPCOES_SOBREPOSICAO[0], 1)).toBe('confirmado');
    expect(interpretarSobreposicao(OPCOES_SOBREPOSICAO[1], 2)).toBe('ajustar');
  });

  it('texto livre reconhecível', () => {
    expect(interpretarSobreposicao('são coisas diferentes, o ressarcimento é novo', null)).toBe(
      'confirmado',
    );
    expect(interpretarSobreposicao('é o mesmo dinheiro, vou corrigir', null)).toBe('ajustar');
  });

  it('"não são diferentes" NÃO vira confirmação', () => {
    // Pegadinha: a string contém "diferentes"; a checagem de 'ajustar' vem antes.
    expect(interpretarSobreposicao('não, é a mesma coisa', null)).toBe('ajustar');
  });

  it('texto ambíguo devolve null (o chamador repergunta 1×)', () => {
    expect(interpretarSobreposicao('R$ 161.913,78', null)).toBeNull();
    expect(interpretarSobreposicao('', null)).toBeNull();
    expect(interpretarSobreposicao(null, null)).toBeNull();
  });
});

describe('⚠️ ANTI-LOOP — o requisito mais importante deste gate', () => {
  it('estados terminais nunca mais bloqueiam', () => {
    for (const t of ['confirmado', 'ajustar', 'nao_respondido'] as EstadoSobreposicao[]) {
      expect(sobreposicaoResolvida(t)).toBe(true);
      expect(deveBloquearPorSobreposicao(t, 'preview')).toBe(false);
      expect(deveBloquearPorSobreposicao(t, 'complete')).toBe(false);
    }
  });

  it('estados não-terminais bloqueiam preview/complete', () => {
    expect(deveBloquearPorSobreposicao(null, 'preview')).toBe(true);
    expect(deveBloquearPorSobreposicao('pendente', 'complete')).toBe(true);
    expect(deveBloquearPorSobreposicao('reperguntado', 'preview')).toBe(true);
  });

  it('pergunta intermediária do agente NUNCA é bloqueada', () => {
    expect(deveBloquearPorSobreposicao(null, 'question')).toBe(false);
    expect(deveBloquearPorSobreposicao(null, 'options')).toBe(false);
  });

  // Espelha a máquina de estados do `enviarMensagem`. `consomeResposta=false` simula o
  // caso em que OUTRO gate (a cadeia de `else if`) engoliu o turno de resposta — foi aí
  // que a 1ª versão deste gate re-armava 'pendente' e entrava em loop.
  function simular(respostaDoUsuario: string, turnos: number, consomeResposta = true) {
    let estado: EstadoSobreposicao | null = null;
    let perguntas = 0;
    for (let t = 0; t < turnos; t++) {
      if (consomeResposta && (estado === 'pendente' || estado === 'reperguntado')) {
        const resp = interpretarSobreposicao(respostaDoUsuario, null);
        estado =
          estado === 'pendente' && resp === null ? 'reperguntado' : (resp ?? 'nao_respondido');
      }
      if (deveBloquearPorSobreposicao(estado, 'preview')) {
        // Ramo de bloqueio, MONOTÔNICO: 'reperguntado' encerra, nunca volta a 'pendente'.
        if (estado === 'reperguntado') estado = 'nao_respondido';
        else {
          perguntas++;
          estado = estado === 'pendente' ? 'reperguntado' : 'pendente';
        }
      }
    }
    return { perguntas, estado };
  }

  it('usuário ininteligível 20 turnos seguidos → no máximo 2 perguntas', () => {
    // Foi assim que o [1.4] fez 38 perguntas em prod e o carga×escala travou a edição.
    const { perguntas, estado } = simular('sei lá', 20);
    expect(perguntas).toBeLessThanOrEqual(2);
    expect(sobreposicaoResolvida(estado)).toBe(true);
  });

  it('REGRESSÃO: outro gate consumindo o turno de resposta NÃO re-arma o gate', () => {
    // Sem a trava de monotonicidade isto fazia uma pergunta por turno, para sempre.
    const { perguntas, estado } = simular('sei lá', 20, false);
    expect(perguntas).toBeLessThanOrEqual(2);
    expect(estado).toBe('nao_respondido');
  });

  it('SIMULAÇÃO: quem responde na 1ª leva UMA pergunta só', () => {
    let estado: EstadoSobreposicao | null = null;
    let perguntas = 0;
    if (deveBloquearPorSobreposicao(estado, 'preview')) {
      perguntas++;
      estado = 'pendente';
    }
    estado = interpretarSobreposicao(OPCOES_SOBREPOSICAO[0], 1)!; // clicou
    if (deveBloquearPorSobreposicao(estado, 'preview')) perguntas++;
    expect(perguntas).toBe(1);
    expect(estado).toBe('confirmado');
  });
});

describe('escopo — onde o gate se aplica', () => {
  const receita = { valor_ganho_mensal: 1000 } as never;

  it('só nas fases de receita', () => {
    expect(aplicaGateSobreposicao(receita, 'receita')).toBe(true);
    expect(aplicaGateSobreposicao(receita, 'receita_preview')).toBe(true);
    expect(aplicaGateSobreposicao(receita, 'saving')).toBe(false);
    expect(aplicaGateSobreposicao(receita, 'doc')).toBe(false);
  });

  it('sem receita declarada não se aplica', () => {
    expect(aplicaGateSobreposicao({ valor_ganho_mensal: 0 } as never, 'receita')).toBe(false);
    expect(aplicaGateSobreposicao(undefined, 'receita')).toBe(false);
  });
});

describe('texto da pergunta', () => {
  it('nomeia a inconsistência e cobra uma escolha (não é só um aviso)', () => {
    const det = detectarSobreposicaoReceita(ITENS_SUCESSO_AI, 161913.78, RACIONAL_SUCESSO_AI)!;
    const q = perguntaSobreposicao(det);
    expect(q).toContain('custo evitado');
    expect(q).toContain('Ressarcimento das transportadoras');
    expect(q).toContain('contados duas vezes');
    expect(q).toContain('certeza');
    // Valores formatados em pt-BR (milhar com ponto, centavos com vírgula).
    expect(q).toContain('R$ 55.864,38');
    expect(q).toContain('R$ 106.049,40');
  });
});
