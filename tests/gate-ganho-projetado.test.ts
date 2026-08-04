// Gate determinístico GANHO REAL × PROJETADO.
//
// Caso de origem (projeto `a2172a9ff26a…` / "Automação cadastro de novos cliente", Eduardo
// Santana, 28/07/2026 — R$ 10.000/mês de receita incremental): o agente perguntou DUAS
// vezes qual dado sustentava a conversão de 1%; o autor respondeu com honestidade que era
// "uma premissa conservadora, não é um número medido" e que "ainda não temos histórico"; o
// agente gerou o preview segundos depois, com a confissão COPIADA para dentro do memorial,
// e o valor foi aprovado e gravado como ganho realizado.
import { describe, it, expect } from 'vitest';
import {
  detectarGanhoProjetado,
  interpretarGanhoReal,
  deveBloquearPorProjecao,
  aplicaGateGanhoProjetado,
  ganhoRealResolvido,
  normalizarTexto,
  perguntaGanhoReal,
  perguntaGanhoRealFirme,
  mensagemGanhoProjetado,
  nudgeGanhoRealConfirmado,
  textosParaDeteccaoReceita,
  textosParaDeteccaoSaving,
  PISTAS_PROJECAO,
  OPCOES_GANHO_REAL,
  ESTADOS_TERMINAIS_GANHO_REAL,
  type EstadoGanhoReal,
} from '@/lib/agents/ganho-projetado';
import { blocoGanhoRealProjetado, buildReceitaPrompt } from '@/lib/agents/orchestrator';
import { receitaVazia, savingVazio, documentacaoVazia } from '@/lib/agents/types';
import type { ProjetoContexto } from '@/lib/agents/types';

// As falas REAIS do autor no caso de origem (mensagens 9 e 11 da conversa).
const FALA_AUTOR_REAL =
  'Sobre o 1%: é uma premissa conservadora, não é um número medido — ainda não temos ' +
  'histórico de checkout self-service porque ele é justamente o que o projeto habilita. ' +
  'Ancorei em dois dados reais: o volume de +1.000 leads/mês e a conversão da abordagem ' +
  'humana hoje de ~20%. Usei 1% de propósito pra ser piso — a ideia é validar com os ' +
  'primeiros meses e recalibrar.';

// O memorial que FOI APROVADO em produção, com a ressalva escrita dentro dele.
const MEMORIAL_APROVADO_EM_PROD =
  '## Memorial de Receita Incremental\n\n### Base de cálculo\n' +
  'Cálculo conservador: 1.000 leads/mês × 1% de conversão self-service × R$ 1.000 de ' +
  'pedido mínimo = R$ 10.000/mês.\nA taxa de 1% não é histórico medido; é uma premissa de ' +
  'piso, 20 vezes abaixo da conversão humana atual (~20%), para validar de forma ' +
  'conservadora a receita incremental.';

describe('detectarGanhoProjetado — o caso de origem', () => {
  it('pega a fala do autor ("não é um número medido", "ainda não temos histórico")', () => {
    const det = detectarGanhoProjetado([FALA_AUTOR_REAL]);
    expect(det).not.toBeNull();
    expect(det!.marcas).toContain('nao-e-medido');
    expect(det!.marcas).toContain('ainda-nao');
    expect(det!.marcas).toContain('premissa');
    expect(det!.trecho.length).toBeGreaterThan(10);
  });

  it('pega o MEMORIAL que foi aprovado em prod — a ressalva dentro do texto não salva', () => {
    const det = detectarGanhoProjetado([MEMORIAL_APROVADO_EM_PROD]);
    expect(det).not.toBeNull();
    expect(det!.marcas).toContain('nao-e-medido');
  });

  it('pega o racional curto do formulário (o campo que o agente recebe de entrada)', () => {
    const receita = { ...receitaVazia(), racional: 'Sendo pessimista, a expectativa é 1% de conversão.' };
    const det = detectarGanhoProjetado(textosParaDeteccaoReceita(receita, []));
    expect(det?.marcas).toContain('expectativa');
  });

  it('lê o memorial DO TURNO (o preview que o LLM acabou de escrever)', () => {
    const receita = { ...receitaVazia(), memorial_calculo: MEMORIAL_APROVADO_EM_PROD };
    expect(detectarGanhoProjetado(textosParaDeteccaoReceita(receita, []))).not.toBeNull();
  });

  it('lê o memorial de saving + as falas do usuário na fase', () => {
    const saving = { ...savingVazio(), memorial_calculo: 'Hoje leva 2h; antes levava 10h.' };
    expect(detectarGanhoProjetado(textosParaDeteccaoSaving(saving, []))).toBeNull();
    expect(
      detectarGanhoProjetado(
        textosParaDeteccaoSaving(saving, ['quando estiver rodando vai reduzir para 1h']),
      ),
    ).not.toBeNull();
  });
});

describe('detectarGanhoProjetado — sinais de projeção', () => {
  const positivos: [string, string][] = [
    ['a expectativa é economizar 40h/mês', 'expectativa'],
    ['a projeção é de R$ 8 mil por mês', 'projecao'],
    ['o ganho projetado é de 20h', 'projecao'],
    ['ainda não temos histórico para comprovar', 'sem-historico'],
    ['ainda não foi medido na prática', 'ainda-nao'],
    ['não foi medido ainda', 'nao-medido-nao-produzido'],
    ['não está em produção para todas as marcas', 'nao-medido-nao-produzido'],
    ['é uma premissa conservadora', 'premissa'],
    ['usei uma hipótese inicial de ticket', 'premissa'],
    ['quando estiver rodando o ganho aparece', 'quando-estiver'],
    ['a automação vai gerar mais pedidos', 'ganho-no-futuro'],
    ['deve reduzir o tempo pela metade', 'ganho-no-futuro'],
    ['vamos validar nos primeiros meses', 'a-validar'],
    ['pretendemos recalibrar depois', 'a-validar'],
    ['o potencial de receita é alto', 'potencial'],
    ['vamos cancelar o contrato na renovação', 'vamos-fazer'],
    ['a solução está em homologação', 'em-teste'],
    ['o endpoint ainda está em desenvolvimento', 'em-desenvolvimento'],
  ];
  for (const [texto, marca] of positivos) {
    it(`pega "${texto}" → ${marca}`, () => {
      const det = detectarGanhoProjetado([texto]);
      expect(det, texto).not.toBeNull();
      expect(det!.marcas, texto).toContain(marca);
    });
  }
});

describe('detectarGanhoProjetado — o que NÃO pode armar o gate', () => {
  // Falso positivo aqui custa uma pergunta a QUEM FEZ TUDO CERTO — e os dois primeiros
  // casos são os mais comuns do produto (memorial de saving normal e contrafactual).
  const negativos = [
    'Hoje o processo leva 2h; antes levava 10h por mês. A automação roda desde março.',
    'Ninguém fazia isso antes — a estimativa é de que alguém levaria 3h por lote. Estimo 45h/mês pelo equivalente manual.',
    'O contrato foi encerrado em maio e deixou de ser pago.',
    'A receita passou a entrar pelo checkout: 42 pedidos fechados no mês, ticket médio apurado de R$ 1.180.',
    'O backend deve validar o CNPJ antes de enviar ao CRM.',
    'A automação vai rodar todo dia às 6h da manhã.',
    '',
    'Reduziu o retrabalho: a taxa de erro caiu de 8% para 1% no painel de conciliação.',
  ];
  for (const texto of negativos) {
    it(`não arma com: "${texto.slice(0, 55)}…"`, () => {
      expect(detectarGanhoProjetado([texto]), texto).toBeNull();
    });
  }

  it('nenhuma pista casa a palavra "estimativa"/"estimo" sozinha (saving contrafactual)', () => {
    for (const p of PISTAS_PROJECAO) {
      expect(p.re.test('a estimativa e de 3h por lote e estimo 45h no mes'), p.marca).toBe(false);
    }
  });

  it('normalizarTexto tira acento e caixa (as pistas são escritas sem acento)', () => {
    expect(normalizarTexto('A EXPECTATIVA É  Alta')).toBe('a expectativa e alta');
  });
});

describe('interpretarGanhoReal', () => {
  it('clique vence: 1 = real, 2 = projetado', () => {
    expect(interpretarGanhoReal('qualquer coisa', 1)).toBe('real');
    expect(interpretarGanhoReal('qualquer coisa', 2)).toBe('projetado');
  });

  it('texto livre afirmativo → real', () => {
    expect(interpretarGanhoReal('já acontece, roda desde março e medimos no painel', null)).toBe('real');
    expect(interpretarGanhoReal('já foi medido sim', null)).toBe('real');
  });

  it('texto livre de expectativa → projetado', () => {
    expect(interpretarGanhoReal('ainda é uma expectativa', null)).toBe('projetado');
    expect(interpretarGanhoReal('não foi medido ainda', null)).toBe('projetado');
    expect(interpretarGanhoReal('é só uma premissa', null)).toBe('projetado');
  });

  it('a NEGAÇÃO vence a palavra-chave — "não foi medido" não pode virar "real"', () => {
    expect(interpretarGanhoReal('não foi medido', null)).toBe('projetado');
    expect(interpretarGanhoReal('não medimos isso', null)).toBe('projetado');
  });

  it('ambíguo → null (o chamador repergunta 1x e encerra)', () => {
    expect(interpretarGanhoReal('acho que sim', null)).toBeNull();
    expect(interpretarGanhoReal('', null)).toBeNull();
    expect(interpretarGanhoReal(null, null)).toBeNull();
  });
});

describe('deveBloquearPorProjecao — o decisor puro', () => {
  it('só mexe em preview/complete — pergunta do agente passa direto', () => {
    for (const tipo of ['question', 'options']) {
      expect(deveBloquearPorProjecao(null, tipo)).toBe(false);
      expect(deveBloquearPorProjecao('projetado', tipo)).toBe(false);
    }
  });

  it('bloqueia enquanto não houver resposta', () => {
    for (const estado of [null, undefined, 'pendente', 'reperguntado'] as (EstadoGanhoReal | null | undefined)[]) {
      expect(deveBloquearPorProjecao(estado, 'preview')).toBe(true);
      expect(deveBloquearPorProjecao(estado, 'complete')).toBe(true);
    }
  });

  it("'real' e 'nao_respondido' liberam para sempre", () => {
    expect(deveBloquearPorProjecao('real', 'preview')).toBe(false);
    expect(deveBloquearPorProjecao('real', 'complete')).toBe(false);
    expect(deveBloquearPorProjecao('nao_respondido', 'preview')).toBe(false);
    expect(deveBloquearPorProjecao('nao_respondido', 'complete')).toBe(false);
  });

  it("⛔ 'projetado' segue bloqueando — é a FUNÇÃO do gate, não um bug", () => {
    expect(deveBloquearPorProjecao('projetado', 'preview')).toBe(true);
    expect(deveBloquearPorProjecao('projetado', 'complete')).toBe(true);
  });

  it('os 3 estados terminais são os declarados (e ganhoRealResolvido concorda)', () => {
    expect([...ESTADOS_TERMINAIS_GANHO_REAL]).toEqual(['real', 'projetado', 'nao_respondido']);
    expect(ganhoRealResolvido(null)).toBe(false);
    expect(ganhoRealResolvido('pendente')).toBe(false);
    expect(ganhoRealResolvido('reperguntado')).toBe(false);
    for (const t of ESTADOS_TERMINAIS_GANHO_REAL) expect(ganhoRealResolvido(t)).toBe(true);
  });
});

describe('aplicaGateGanhoProjetado — escopo de fase', () => {
  it('vale nas DUAS famílias financeiras', () => {
    expect(aplicaGateGanhoProjetado('saving')).toBe('saving');
    expect(aplicaGateGanhoProjetado('saving_preview')).toBe('saving');
    expect(aplicaGateGanhoProjetado('receita')).toBe('receita');
    expect(aplicaGateGanhoProjetado('receita_preview')).toBe('receita');
  });
  it('não vale na documentação nem no fim do fluxo', () => {
    for (const f of ['doc', 'doc_preview', 'completo']) {
      expect(aplicaGateGanhoProjetado(f)).toBeNull();
    }
  });
});

describe('ANTI-LOOP — no máximo 2 perguntas, estados terminais absorventes', () => {
  // Espelha a máquina de estados do ramo de resposta em enviarMensagem.
  function proximoEstado(atual: EstadoGanhoReal, resposta: 'real' | 'projetado' | null): EstadoGanhoReal {
    return resposta ?? (atual === 'pendente' ? 'reperguntado' : 'nao_respondido');
  }

  it('pendente → ambíguo → reperguntado → ambíguo → nao_respondido (TERMINAL)', () => {
    const s1 = proximoEstado('pendente', null);
    expect(s1).toBe('reperguntado');
    const s2 = proximoEstado(s1, null);
    expect(s2).toBe('nao_respondido');
    expect(ganhoRealResolvido(s2)).toBe(true);
  });

  it('nenhum ramo devolve o estado para null/pendente (o risco do gate do teto)', () => {
    for (const atual of ['pendente', 'reperguntado'] as EstadoGanhoReal[]) {
      for (const r of ['real', 'projetado', null] as ('real' | 'projetado' | null)[]) {
        const proximo = proximoEstado(atual, r);
        expect(proximo, `${atual}+${r}`).not.toBeNull();
        expect(['reperguntado', 'real', 'projetado', 'nao_respondido']).toContain(proximo);
      }
    }
  });
});

describe('textos da conversa', () => {
  const det = detectarGanhoProjetado([FALA_AUTOR_REAL])!;

  it('a pergunta ancora na premissa da Etapa 1 e cita o trecho', () => {
    for (const modo of ['saving', 'receita'] as const) {
      const p = perguntaGanhoReal(det, modo);
      expect(p).toContain('Etapa 1');
      expect(p).toContain('já está em produção');
      expect(p).toContain(det.trecho);
      // Nada de apóstrofo/concatenação vazada no template.
      expect(p).not.toContain("' +");
    }
  });

  it('as opções são 2 e a ordem é FIXA (1 = real, 2 = projetado)', () => {
    expect(OPCOES_GANHO_REAL).toHaveLength(2);
    expect(interpretarGanhoReal(OPCOES_GANHO_REAL[0], 1)).toBe('real');
    expect(interpretarGanhoReal(OPCOES_GANHO_REAL[1], 2)).toBe('projetado');
  });

  it('a repergunta firme pede a base (há quanto tempo roda / como apurou)', () => {
    expect(perguntaGanhoRealFirme('receita')).toMatch(/há quanto tempo/i);
    expect(perguntaGanhoRealFirme('saving')).toMatch(/há quanto tempo/i);
  });

  it('a mensagem de bloqueio oferece as DUAS saídas — senão o gate vira beco sem saída', () => {
    for (const modo of ['saving', 'receita'] as const) {
      const m = mensagemGanhoProjetado(modo);
      expect(m).toMatch(/medi[çc]ão/i); // volte quando houver medição
      expect(m).toMatch(/especial/i); // ou submeta como projeto especial
      expect(m).toContain('Etapa 1');
    }
  });

  it('o nudge do "real" exige tempo de operação + como o número foi apurado', () => {
    const n = nudgeGanhoRealConfirmado('roda desde março, medimos no painel de pedidos');
    expect(n).toContain('[SISTEMA]');
    expect(n).toContain('roda desde março');
    expect(n).toMatch(/HÁ QUANTO TEMPO/);
    expect(n).toMatch(/PASSADO\/PRESENTE/);
  });
});

describe('prompt — o portão passa a existir na RECEITA (era o bug)', () => {
  const ctx: ProjetoContexto = {
    responsavel_nome: 'Eduardo Santana',
    responsavel_email: 'eduardo.santana@gobeaute.com.br',
    area: 'B2B GOBEAUTE',
    ferramenta: 'Claude',
    membros: [],
    nome_projeto: 'Automação cadastro de novos cliente',
    data_criacao: '2026-07-27',
    doc_texto: null,
    tipos_projeto: ['receita_incremental'],
  };

  it('buildReceitaPrompt injeta o portão GANHO REAL × PROJETADO', () => {
    const p = buildReceitaPrompt(ctx, documentacaoVazia(), { ...receitaVazia(), tipo_saving: 'mensal', valor_ganho_mensal: 10000 }, 'resumo');
    expect(p).toContain('GANHO REAL × PROJETADO');
    expect(p).toContain('PREMISSA Nº 1 do formulário');
    // A regra específica do caso: taxa de conversão escolhida não é base de cálculo.
    expect(p).toMatch(/TAXA DE CONVERSÃO \/ TICKET ESCOLHIDOS/);
  });

  it('o bloco é FONTE ÚNICA e se adapta aos 3 modos', () => {
    const saving = blocoGanhoRealProjetado('saving');
    const receita = blocoGanhoRealProjetado('receita');
    const ce = blocoGanhoRealProjetado('custo_evitado');
    for (const b of [saving, receita, ce]) {
      expect(b).toContain('GANHO REAL × PROJETADO');
      expect(b).toContain('PREMISSA Nº 1 do formulário');
      // A armadilha do caso de origem: escrever a ressalva no memorial e completar igual.
      expect(b).toMatch(/NUNCA "resolva"/);
    }
    // O "escopo" (não confundir com o "antes" contrafactual) é só do saving.
    expect(saving).toContain('saving contrafactual');
    expect(receita).not.toContain('saving contrafactual');
    expect(ce).not.toContain('saving contrafactual');
    expect(receita).toContain('receita nova JÁ ESTÁ ENTRANDO');
    expect(ce).toContain('JÁ foi cancelado ou reduzido NA PRÁTICA');
  });
});
