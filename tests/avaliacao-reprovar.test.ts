/**
 * T15/T17 — o desfecho `reprovar` (D4), suas DUAS portas e todos os LEITORES do enum.
 *
 * ⚠️ A varredura de leitores é o coração deste arquivo: ampliar um enum de veredito neste repo já
 * fez `Dispensado` virar `Pré-reprovado` em 3 telas por fall-through. Cada leitor tem de ter
 * rótulo PRÓPRIO, e o desfecho não pode desaparecer no caminho.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { agregarVotos, agregarJulgamentos } from '@/lib/agents/agregador-avaliacao';
import type { ResultadoFinanceiro } from '@/lib/agents/avaliacao-financeira';
import type { ResultadoPlausibilidadeFTE } from '@/lib/agents/analyzer';
import { conciliar, invalidezComprovada, MOTIVOS_INVALIDEZ, ROTULO_DESQ, politicaDeLiberacao } from '@/lib/avaliacao/consenso';
import type { Liberacao } from '@/lib/avaliacao/consenso';
import { conciliarComCetico, avancarDeliberacao } from '@/lib/deliberacao';
import { decidirComTime } from '@/lib/agents/decisao-final';
import { compararComHumano, agregarAcuracia } from '@/lib/avaliacao-retroativa';
import { compararProjeto, agregarRetroativo } from '@/lib/avaliacao/retroativo';
import {
  rotuloVeredito,
  rotuloEstadoDeliberacao,
  rotuloResultadoRetroativo,
} from '@/lib/avaliacao-sombra-rotulos';
import { textoJustificativaInterna } from '@/lib/avaliacao/textos';
import { PISO_ZERO } from '@/lib/estrelas-regua';
import { motivoPisoDeImpacto } from '@/lib/materialidade-piso';

// ─── fixtures ────────────────────────────────────────────────────────────────

const fteOk: ResultadoPlausibilidadeFTE = { implausivel: false, fte: 1, pessoas: 2, motivo: null } as ResultadoPlausibilidadeFTE;
const finOk: ResultadoFinanceiro = { veredito: 'ok', confianca: 0.9, motivo: null, sinais: [], abaixoDoPiso: false };
const finPiso: ResultadoFinanceiro = {
  veredito: 'atencao',
  confianca: 0.3,
  motivo: motivoPisoDeImpacto(18.16),
  sinais: [motivoPisoDeImpacto(18.16)],
  abaixoDoPiso: true,
};
const ragApoio = { apoio: true, confianca: 0.85, vizinhos: 3, topSimilaridade: 0.8, motivo: null };

const LIBERADO: Liberacao = { aprovar: true, ajuste: true, motivos: [] };

function merito(over: Record<string, unknown> = {}) {
  return {
    veredito: 'aprovar',
    julgamentos: [],
    preocupacoes: [],
    perguntas_ao_autor: [],
    valor: null,
    ressalvas: [],
    sinais: { temEvidenciaCitada: true, temVizinhos: true },
    ...over,
  } as never;
}
function estrela(over: Record<string, unknown> = {}) {
  return {
    nota: 3,
    criterio_aplicado: 'garante',
    desqualificador: null,
    evidencias: ['Doc §2: "o robô valida o CPF antes de gravar".'],
    sem_evidencia: false,
    promocao: { aplicada: false, dependente: null },
    escape: { indicado: false, valido: false, evidencias: {} },
    tipo: 'controle',
    nivel: 'garante',
    racional: 'Garante a integridade do cadastro.',
    contestacao: null,
    ancora_congelada: false,
    sinais: { temEvidenciaCitada: true, temVizinhos: true },
    ...over,
  } as never;
}
const ctx = (over: Record<string, unknown> = {}) =>
  ({ debateFechou: true, ceticoRefuta: false, liberacao: LIBERADO, ...over }) as never;

// ─── porta (i): o piso, MECÂNICO ─────────────────────────────────────────────

describe('porta (i) — piso de impacto (RF-243)', () => {
  it('mesa determinística: financeiro abaixo do piso → veredito reprovar, com o motivo do piso', () => {
    const r = agregarVotos({ fte: fteOk, financeiro: finPiso, rag: ragApoio });
    expect(r.veredito).toBe('reprovar');
    expect(r.motivos.join(' ')).toContain('18,16');
    expect(r.isento).toBe(false);
  });

  it('sobrepõe a aprovação do painel LLM inteiro (rejeição mecânica vence o juízo)', () => {
    const tranquilos = [
      { dimensao: 'financeiro', preocupa: false, argumento: 'está tudo certo', confianca: 0.95 },
      { dimensao: 'plausibilidade_horas', preocupa: false, argumento: 'horas críveis', confianca: 0.95 },
      { dimensao: 'precedente', preocupa: false, argumento: 'igual aos aprovados', confianca: 0.9 },
      { dimensao: 'evidencia', preocupa: false, argumento: 'memorial coerente', confianca: 0.9 },
    ] as never;
    const semPiso = agregarJulgamentos({ julgamentos: tranquilos });
    expect(semPiso.veredito).toBe('aprovar');

    const comPiso = agregarJulgamentos({
      julgamentos: tranquilos,
      abaixoDoPiso: true,
      motivoPiso: motivoPisoDeImpacto(0.88),
    });
    expect(comPiso.veredito).toBe('reprovar');
    expect(comPiso.motivos.join(' ')).toContain('0,88');
  });

  it('ESPECIAL nunca é reprovado pelo piso — o isento vem antes', () => {
    const r = agregarVotos({ fte: fteOk, financeiro: finPiso, rag: ragApoio, especial: true });
    expect(r.veredito).toBe('isento');
    expect(agregarJulgamentos({ julgamentos: [], especial: true, abaixoDoPiso: true }).veredito).toBe('isento');
  });

  it('no time (consenso): impacto abaixo do piso → reprovar, mesmo com mérito aprovando', () => {
    const c = conciliar(merito(), estrela(), ctx({ impactoMensal: 18.16 }));
    expect(c.saida).toBe('reprovar');
    expect(c.motivos.join(' ')).toContain('18,16');
  });

  it('sem número declarado (null/0) o piso NÃO dispara', () => {
    expect(conciliar(merito(), estrela(), ctx({ impactoMensal: null })).saida).toBe('aprovar');
    expect(conciliar(merito(), estrela(), ctx({ impactoMensal: 0 })).saida).toBe('aprovar');
    expect(conciliar(merito(), estrela(), ctx()).saida).toBe('aprovar');
  });
});

// ─── porta (ii): invalidez NOMEADA e CITADA ──────────────────────────────────

describe('porta (ii) — projeto inválido, nomeado E citado (RF-244)', () => {
  it('a lista é FECHADA e sai do rótulo, sem redigitação', () => {
    expect([...MOTIVOS_INVALIDEZ].sort()).toEqual(['fora_de_uso', 'ressubmissao']);
    expect(Object.keys(ROTULO_DESQ).sort()).toEqual([...MOTIVOS_INVALIDEZ].sort());
  });

  it('fora_de_uso com evidência citada → reprovar, e o motivo cita o trecho', () => {
    const c = conciliar(
      merito(),
      estrela({ nota: 0, criterio_aplicado: 'piso_zero', desqualificador: 'fora_de_uso', evidencias: ['Planilha: "automação desligada em julho"'] }),
      ctx(),
    );
    expect(c.saida).toBe('reprovar');
    expect(c.motivos.join(' ')).toContain('automação desligada em julho');
    expect(c.motivos.join(' ')).toMatch(/fora de uso/i);
  });

  it('ressubmissao com evidência → reprovar', () => {
    const c = conciliar(
      merito(),
      estrela({ nota: 0, desqualificador: 'ressubmissao', evidencias: ['Doc: "mesmo escopo do projeto X"'] }),
      ctx(),
    );
    expect(c.saida).toBe('reprovar');
  });

  it('NOMEADO mas SEM citação → NÃO reprova', () => {
    expect(
      conciliar(merito(), estrela({ nota: 0, desqualificador: 'fora_de_uso', evidencias: [] }), ctx()).saida,
    ).not.toBe('reprovar');
    expect(
      conciliar(merito(), estrela({ nota: 0, desqualificador: 'fora_de_uso', evidencias: ['   '] }), ctx()).saida,
    ).not.toBe('reprovar');
    // `sem_evidencia` é o agente declarando que não achou nada: fecha a porta mesmo com texto.
    expect(
      conciliar(
        merito(),
        estrela({ nota: 0, desqualificador: 'fora_de_uso', evidencias: ['algo'], sem_evidencia: true }),
        ctx(),
      ).saida,
    ).not.toBe('reprovar');
  });

  it('CITADO mas sem motivo nomeado da lista → NÃO reprova', () => {
    expect(invalidezComprovada({ desqualificador: null, evidencias: ['citação'] })).toBe(false);
    expect(invalidezComprovada({ desqualificador: 'inventado', evidencias: ['citação'] })).toBe(false);
  });

  it('⚠️ os OUTROS 5 motivos do PISO_ZERO NÃO reprovam (D4.1: seriam metade da base)', () => {
    const naoReprovam = PISO_ZERO.map((p) => p.chave).filter((k) => !MOTIVOS_INVALIDEZ.includes(k));
    expect(naoReprovam.sort()).toEqual([
      'apenas_mensuravel',
      'experimentacao',
      'marginal',
      'simples_local',
      'so_o_autor',
    ]);
    for (const chave of naoReprovam) {
      const c = conciliar(
        merito(),
        estrela({ nota: 0, desqualificador: chave, evidencias: ['citação farta do material'] }),
        ctx(),
      );
      expect(c.saida, chave).not.toBe('reprovar');
    }
  });
});

// ─── sombra: reprovar nunca age sozinho ──────────────────────────────────────

describe('modo sombra (RF-246) — não existe caminho em que o time reprove sozinho', () => {
  it('reprovar não age sozinho nem com as duas flags de liberação ligadas', () => {
    const c = conciliar(merito(), estrela(), ctx({ impactoMensal: 10, liberacao: LIBERADO }));
    expect(c.saida).toBe('reprovar');
    expect(c.age_sozinho).toBe(false);
    expect(c.motivos.join(' ')).toMatch(/sombra/i);
  });

  it('a política de liberação não tem chave para reprovar', () => {
    const l = politicaDeLiberacao({ aprovar: { acerto: 1, erro_grave: 0, n: 999 } }, { liberarAprovar: true });
    expect(Object.keys(l).sort()).toEqual(['ajuste', 'aprovar', 'motivos']);
  });
});

// ─── os LEITORES do enum ─────────────────────────────────────────────────────

describe('todos os leitores do enum têm rótulo próprio (nenhum fall-through)', () => {
  it('rotuloVeredito conhece reprovar', () => {
    expect(rotuloVeredito('reprovar')).toBe('Reprovar');
  });

  it('rotuloEstadoDeliberacao conhece o estado terminal', () => {
    expect(rotuloEstadoDeliberacao('reprovado')).toBe('Reprovado pelo piso');
  });

  it('rotuloResultadoRetroativo conhece a reprovação indevida', () => {
    expect(rotuloResultadoRetroativo('reprovacao_indevida')).toBe('Reprovação indevida');
  });

  it('a justificativa interna do time nomeia a saída (não sai undefined no texto)', () => {
    const c = conciliar(merito(), estrela(), ctx({ impactoMensal: 18.16 }));
    const t = textoJustificativaInterna({
      projeto: { id: 'p1', nome: 'Projeto' },
      consenso: c,
      merito: merito(),
      estrela: estrela(),
    } as never);
    expect(t).toContain('Reprovar');
    expect(t).not.toContain('undefined');
  });

  it('conciliarComCetico PRESERVA a reprovação (o cético só desafia aprovações)', () => {
    const r = conciliarComCetico(
      { veredito: 'reprovar', confianca: 1, aplicarEmValidacao: false, divergencia: false, isento: false, motivos: ['piso'] },
      { refuta: true, confianca: 0.9, motivo: 'discordo' },
    );
    expect(r.veredito).toBe('reprovar');
    expect(r.ceticoRefutou).toBe(false);
  });

  it('avancarDeliberacao encerra em `reprovado` em vez de moer até em_validacao', () => {
    const d = avancarDeliberacao(
      { estado: 'deliberando', rodada: 1 },
      { agregadoVeredito: 'reprovar', divergencia: false, confianca: 1, ceticoRefuta: false },
    );
    expect(d.estado).toBe('reprovado');
    expect(d.veredito).toBe('reprovar');
    expect(d.encerrada).toBe(true);
    // idempotente: o cron pode passar de novo sem mudar nada.
    const outra = avancarDeliberacao({ estado: 'reprovado', rodada: 1 }, { agregadoVeredito: 'reprovar', divergencia: false, confianca: 1, ceticoRefuta: false });
    expect(outra.estado).toBe('reprovado');
    expect(outra.veredito).toBe('reprovar');
  });

  it('decidirComTime traduz reprovar em `reprovado` — NUNCA em aprovado', () => {
    const d = decidirComTime({ veredito: 'reprovar', consenso: true, especial: false, apontamentos: [] });
    expect(d.status).toBe('reprovado');
    expect(d.racional).toMatch(/piso/i);
  });
});

// ─── T17: a classe de erro espelhada ─────────────────────────────────────────

describe('T17 — reprovação indevida tem classe e taxa próprias (RF-247)', () => {
  it('os seis cruzamentos de veredito × Status humano', () => {
    expect(compararComHumano('aprovar', 'Aprovado')).toBe('acerto');
    expect(compararComHumano('em_validacao', 'Aprovado')).toBe('conservador');
    expect(compararComHumano('reprovar', 'Aprovado')).toBe('reprovacao_indevida');
    expect(compararComHumano('aprovar', 'Reprovado')).toBe('erro_grave');
    expect(compararComHumano('em_validacao', 'Reprovado')).toBe('acerto');
    expect(compararComHumano('reprovar', 'Reprovado')).toBe('acerto');
  });

  it('a taxa não se dilui em acerto', () => {
    const a = agregarAcuracia(['acerto', 'reprovacao_indevida', 'reprovacao_indevida', 'erro_grave']);
    expect(a.reprovacao_indevida).toBe(2);
    expect(a.acerto).toBe(1);
    expect(a.comparaveis).toBe(4);
    expect(a.taxa_reprovacao_indevida).toBeCloseTo(0.5, 5);
    expect(a.taxa_acerto).toBeCloseTo(0.25, 5);
  });

  it('no retroativo do TIME: saida reprovar contra humano aprovado → reprovacao_indevida + alerta', () => {
    const r = {
      id: 'p1', nome: 'P', area: null, especial: false, saida: 'reprovar', veredito_merito: 'aprovar',
      estrela: 2, escape: false, confianca: 'alta', valor_absurdo: null, valor_sugerido: null,
      contestacao: null, erros: 0, custo_usd: 0,
    } as never;
    const g = { id: 'p1', nome: 'P', area: null, especial: false, nota_humana: 3, status: 'Aprovado', data_submissao: '2026-08-01', descontinuado: false };
    const c = compararProjeto(r, g);
    expect(c.merito).toBe('reprovacao_indevida');

    const rel = agregarRetroativo([c]);
    expect(rel.merito.reprovacao_indevida).toBe(1);
    expect(rel.saidas.reprovar).toBe(1);
    expect(rel.alertas.join(' ')).toMatch(/reprova(ção|cao) indevida/i);
    // entra no denominador da acurácia (não é "sem base")
    expect(rel.merito.acuracia).toBe(0);
  });

  it('reprovar contra humano REPROVADO é acerto (nenhum dos dois auto-aprova)', () => {
    const r = {
      id: 'p2', nome: 'P2', area: null, especial: false, saida: 'reprovar', veredito_merito: 'aprovar',
      estrela: 0, escape: false, confianca: 'alta', valor_absurdo: null, valor_sugerido: null,
      contestacao: null, erros: 0, custo_usd: 0,
    } as never;
    const g = { id: 'p2', nome: 'P2', area: null, especial: false, nota_humana: null, status: 'Reprovado', data_submissao: '2026-08-01', descontinuado: false };
    expect(compararProjeto(r, g).merito).toBe('acerto');
  });
});

describe('as duas mesas têm a MESMA régua de piso (não dá para aprovar por um caminho e reprovar pelo outro)', () => {
  it('conciliarJulgamentos repassa o piso ao agregador', async () => {
    const { conciliarJulgamentos } = await import('@/lib/agents/mesa-especialistas');
    const tranquilos = [
      { dimensao: 'financeiro', preocupa: false, argumento: 'ok', confianca: 0.95 },
      { dimensao: 'fte', preocupa: false, argumento: 'ok', confianca: 0.95 },
      { dimensao: 'rag', preocupa: false, argumento: 'ok', confianca: 0.9 },
      { dimensao: 'cetico', preocupa: false, argumento: 'ok', confianca: 0.9 },
    ] as never;
    expect(conciliarJulgamentos(tranquilos, {}).veredito).toBe('aprovar');
    const comPiso = conciliarJulgamentos(tranquilos, {
      abaixoDoPiso: true,
      motivoPiso: motivoPisoDeImpacto(18.16),
    });
    expect(comPiso.veredito).toBe('reprovar');
    expect(comPiso.grau).toBe('alta');
  });

  it('o call site da mesa LLM realmente passa o piso (canário de fiação)', () => {
    const src = readFileSync('src/lib/avaliacao-normais.functions.ts', 'utf8');
    expect(src).toMatch(/abaixoDoPiso: financeiro\.abaixoDoPiso/);
  });
});
