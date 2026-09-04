// T15 — O TIME de avaliação com debate de teto (`src/lib/avaliacao/time.ts`).
//
// Prende a ORQUESTRAÇÃO pura do time unificado (plano `docs/plans/regua-estrelas-e-time-unificado.md`,
// §11.2 arquitetura · §11.3 T15 · D15 debate ≤ 2 rodadas): 4 especialistas do mérito (cada um num
// `loopComFerramentas` com teto de tools) → cérebro B da estrela → cético → réplica SÓ quando o cético
// refuta uma aprovação e ainda há rodada → consenso → os 3 textos. Tudo com dependências INJETADAS
// (LLM, executor de ferramentas, registrador do log em árvore), então aqui só há fakes e `vi.fn`.
//
// O que NÃO pode regredir:
//  - o debate fecha em NO MÁXIMO 2 rodadas mesmo com cético que nunca aceita, e cai em `humano`
//    (este repo já teve 2 loops entre agentes — o teto é por construção, não por prompt);
//  - o log é ÁRVORE: 1 raiz `orquestrador`, e NENHUM outro nó nasce solto (`pai_id` null);
//  - o time NUNCA lança: LLM que rejeita vira fallback declarado, log que falha vira erro listado,
//    ferramenta que falha volta ao especialista como `tool_result.erro`;
//  - o texto ao autor só existe no `ajuste` e NUNCA carrega R$ (valor/hora é escondido do submissor);
//  - escape 6–10 vai ao comitê com dossiê que nomeia os pares já notados na faixa.
import { describe, it, expect, vi } from 'vitest';
import {
  avaliarComTime,
  buildPromptCetico,
  normalizarCetico,
  MAX_RODADAS_DEBATE,
  type ChamarLlm,
  type Executor,
  type Registrador,
  type VizinhoTime,
} from '@/lib/avaliacao/time';
import { dossieDaLinhaPlanilha } from '@/lib/avaliacao/dossie';
import type { Dossie } from '@/lib/avaliacao/dossie';
import { normalizarJulgamentoMerito, type JulgamentoMerito } from '@/lib/avaliacao/cerebro-merito';
import { normalizarSaidaEstrela } from '@/lib/avaliacao/cerebro-estrela';
import type { Liberacao } from '@/lib/avaliacao/consenso';
import type { Mensagem } from '@/lib/avaliacao/ferramentas';

// ── fixtures ─────────────────────────────────────────────────────────────────

const NOME_PROJETO = 'Robô de Conciliação Bancária';

function dossie(): Dossie {
  const d = dossieDaLinhaPlanilha({
    'ID Projeto': 'T15-TIME-001',
    Projeto: NOME_PROJETO,
    'Nome Completo': 'Fulana da Silva',
    Email: 'fulana@gocase.com',
    Área: 'Financeiro',
    Descrição: 'Concilia extratos bancários contra o ERP e aponta divergências.',
    Status: 'Pendente',
    Estrelas: '0',
    'Especial?': 'Não',
    'Memorial de Saving': '### Contexto\nUm analista conciliava extratos à mão, 120 h por mês.',
    'Saving Horas Real': '120',
    'Saving Horas Escalado': '0',
  });
  expect(d).not.toBeNull();
  return d!;
}

const VIZINHOS: VizinhoTime[] = [
  { id: 'v1', nome: 'Conciliação Fiscal', nota: 3, status: 'Aprovado', similaridade: 0.91, resumo: 'Concilia notas.' },
  { id: 'v2', nome: 'Robô de Extratos', nota: null, status: 'Reprovado', similaridade: 0.77, resumo: 'Lê extratos.' },
];

const VIZINHOS_COM_ANCORA: VizinhoTime[] = [
  ...VIZINHOS,
  { id: 'v3', nome: 'Plataforma Prisma', nota: 10, status: 'Aprovado', similaridade: 0.7, resumo: 'Plataforma de IA da casa.' },
];

const SEM_LIBERACAO: Liberacao = { aprovar: false, ajuste: false, motivos: [] };

const MOTIVO_CETICO = 'as horas não batem com o cargo descrito';

/** Conclusão bem-comportada de um especialista; cada teste sobrescreve só o que exercita. */
function concluirEspecialista(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    acao: 'concluir',
    resultado: {
      preocupa: false,
      argumento: 'Horas coerentes com o cargo e com o memorial.',
      evidencias: ['conciliava extratos à mão, 120 h por mês'],
      pergunta_ao_autor: null,
      valor: null,
      ...over,
    },
  });
}

/** Conclusão bem-comportada da estrela (nota 3 com evidência). */
function concluirEstrela(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    acao: 'concluir',
    resultado: {
      nota: 3,
      criterio_aplicado: 'Garante',
      desqualificador: null,
      evidencias: ['conciliava extratos à mão'],
      dependente_nomeado: null,
      escape: { indicado: false, evidencias: {} },
      tipo: 'automacao',
      nivel: 'deterministico',
      racional: 'Garante a conciliação sem intervenção humana.',
      ...over,
    },
  });
}

function ceticoAceita(): string {
  return JSON.stringify({ refuta: false, motivo: null, sinais: [] });
}
function ceticoRefuta(): string {
  return JSON.stringify({ refuta: true, motivo: MOTIVO_CETICO, sinais: ['horas acima do usual'] });
}

type Papel = 'especialista' | 'estrela' | 'cetico';
type CtxEspecialista = { dimensao: string; replica: boolean; ultima: string; n: number; user: string };
type Cenario = {
  especialista?: (ctx: CtxEspecialista) => string | Promise<string>;
  estrela?: (ctx: { ultima: string; n: number }) => string | Promise<string>;
  cetico?: (ctx: { n: number }) => string | Promise<string>;
  cetico_estrela?: (ctx: { n: number }) => string | Promise<string>;
};

/**
 * LLM fake que decide pelo PAPEL e pela última mensagem: a dimensão sai do system do
 * `buildPromptMerito` (`dimensão "<nome>"`), a réplica sai do user (`RÉPLICA`/`debate`).
 */
/** Resposta padrão do cético da ESTRELA: não refuta, mantém a nota proposta. */
const ceticoEstrelaAceita = () => JSON.stringify({ refuta: false, nota_sugerida: 0, motivo: null, sinais: [] });

function fakeLlm(c: Cenario = {}) {
  const contagem: Record<Papel, number> = { especialista: 0, estrela: 0, cetico: 0, cetico_estrela: 0 };
  const chamadas: { papel: Papel; mensagens: Mensagem[] }[] = [];
  const fn = vi.fn(async (mensagens: Mensagem[], papel: Papel): Promise<string> => {
    contagem[papel]++;
    chamadas.push({ papel, mensagens: [...mensagens] });
    const system = mensagens[0]?.content ?? '';
    const user = mensagens.find((m) => m.role === 'user')?.content ?? '';
    const ultima = mensagens[mensagens.length - 1]?.content ?? '';
    if (papel === 'especialista') {
      const dimensao = /dimensão "([a-z_]+)"/.exec(system)?.[1] ?? '?';
      const replica = /réplica|debate/i.test(user);
      return (c.especialista ?? (() => concluirEspecialista()))({ dimensao, replica, ultima, n: contagem.especialista, user });
    }
    if (papel === 'estrela') return (c.estrela ?? (() => concluirEstrela()))({ ultima, n: contagem.estrela });
    // O 2º cético (o da ESTRELA) aceita por padrão — como o do mérito. Cenário que quiser
    // exercitar a volta passa `cetico_estrela`.
    if (papel === 'cetico_estrela')
      return (c.cetico_estrela ?? ceticoEstrelaAceita)({ n: contagem.cetico_estrela });
    return (c.cetico ?? ceticoAceita)({ n: contagem.cetico });
  });
  return { fn: fn as unknown as ChamarLlm, mock: fn, contagem, chamadas };
}

type NoRegistrado = Parameters<Registrador>[0] & { id: string };

/** Registrador fake: ids únicos e sequenciais, guarda cada nó na ordem em que foi pedido. */
function fakeRegistrador(opts: { falhar?: 'rejeita' | 'null' } = {}) {
  let seq = 0;
  const nos: NoRegistrado[] = [];
  const fn = vi.fn(async (no: Parameters<Registrador>[0]): Promise<string | null> => {
    if (opts.falhar === 'rejeita') throw new Error('log indisponível');
    if (opts.falhar === 'null') return null;
    const id = `no-${++seq}`;
    nos.push({ ...no, id });
    return id;
  });
  return { fn: fn as unknown as Registrador, mock: fn, nos };
}

function fakeExecutor(impl?: Executor) {
  const fn = vi.fn(impl ?? (async (nome: string) => ({ ok: true, ferramenta: nome })));
  return { fn: fn as unknown as Executor, mock: fn };
}

function rodar(over: Partial<Parameters<typeof avaliarComTime>[0]> = {}) {
  const llm = fakeLlm();
  const reg = fakeRegistrador();
  const exe = fakeExecutor();
  return avaliarComTime({
    dossie: dossie(),
    vizinhos: VIZINHOS,
    notaHumana: null,
    chamarLlm: llm.fn,
    executar: exe.fn,
    registrar: reg.fn,
    liberacao: SEM_LIBERACAO,
    ...over,
  });
}

// ── 1. caminho feliz ─────────────────────────────────────────────────────────

describe('avaliarComTime — caminho feliz (4 especialistas + estrela + cético, sem réplica)', () => {
  it('faz 6 chamadas de LLM (4 especialistas, 1 estrela, 1 cético), fecha em 1 rodada e aprova', async () => {
    const llm = fakeLlm();
    const r = await rodar({ chamarLlm: llm.fn });

    expect(r.projeto_id).toBe('T15-TIME-001');
    // 7 = 4 especialistas + 1 estrela + 1 cético do mérito + 1 cético da ESTRELA (03/09/2026).
    expect(r.chamadas_llm).toBe(7);
    expect(llm.contagem).toEqual({ especialista: 4, estrela: 1, cetico: 1, cetico_estrela: 1 });
    expect(r.rodadas_debate).toBe(1);
    expect(r.debate_fechou).toBe(true);
    expect(r.cetico.refuta).toBe(false);
    expect(r.merito.veredito).toBe('aprovar');
    expect(r.merito.julgamentos).toHaveLength(4);
    expect(r.merito.julgamentos.every((j) => !j.fallback)).toBe(true);
    expect(r.estrela.nota).toBe(3);
    expect(r.consenso.saida).toBe('aprovar');
    expect(r.erros).toEqual([]);
  });

  it('textos: interno sempre; ao_autor e comite ficam null quando a saída é aprovar', async () => {
    const r = await rodar();
    expect(r.textos.interno.trim().length).toBeGreaterThan(0);
    expect(r.textos.interno).toContain(NOME_PROJETO);
    expect(r.textos.ao_autor).toBeNull();
    expect(r.textos.comite).toBeNull();
  });

  it('cada especialista recebe o prompt da SUA dimensão (as 4 dimensões, uma vez cada, sem réplica)', async () => {
    const llm = fakeLlm();
    await rodar({ chamarLlm: llm.fn });
    const dims = llm.chamadas
      .filter((c) => c.papel === 'especialista')
      .map((c) => /dimensão "([a-z_]+)"/.exec(c.mensagens[0].content)?.[1]);
    expect([...dims].sort()).toEqual(['evidencia', 'financeiro', 'plausibilidade_horas', 'precedente']);
    for (const c of llm.chamadas.filter((c) => c.papel === 'especialista')) {
      const user = c.mensagens.find((m) => m.role === 'user')?.content ?? '';
      expect(user).not.toMatch(/réplica|debate/i);
      expect(user).toContain(NOME_PROJETO);
    }
  });
});

// ── 2. árvore do log ─────────────────────────────────────────────────────────

describe('avaliarComTime — log em ÁRVORE (nada solto)', () => {
  it('raiz orquestrador PRIMEIRO; 4 especialistas, 1 cérebro, 1 cético e 1 consenso pendurados nela', async () => {
    const reg = fakeRegistrador();
    const r = await rodar({ registrar: reg.fn });

    expect(reg.nos.length).toBeGreaterThan(0);
    const raiz = reg.nos[0];
    expect(raiz.tipo).toBe('orquestrador');
    expect(raiz.pai_id).toBeNull();
    expect(r.log.raiz_id).toBe(raiz.id);
    expect(r.log.nos).toBe(reg.nos.length);

    const porTipo = (t: string) => reg.nos.filter((n) => n.tipo === t);
    expect(porTipo('orquestrador')).toHaveLength(1);
    expect(porTipo('especialista')).toHaveLength(4);
    expect(porTipo('cerebro')).toHaveLength(1);
    // 2 céticos: o do MÉRITO e o da ESTRELA. Os dois gravam com tipo 'cetico'.
    expect(porTipo('cetico')).toHaveLength(2);
    expect(porTipo('consenso')).toHaveLength(1);
    expect(porTipo('tool')).toHaveLength(0);
    expect(porTipo('debate')).toHaveLength(0);
    expect(reg.nos).toHaveLength(9); // + o nó do cético da ESTRELA

    for (const n of porTipo('especialista')) expect(n.pai_id).toBe(raiz.id);
    expect(porTipo('cerebro')[0].pai_id).toBe(raiz.id);
    expect(porTipo('cetico')[0].pai_id).toBe(raiz.id);
    expect(porTipo('consenso')[0].pai_id).toBe(raiz.id);
    expect(porTipo('consenso')[0].veredito).toBe(r.consenso.saida);

    // Nenhum nó além da raiz nasce solto.
    expect(reg.nos.filter((n) => n.pai_id === null)).toHaveLength(1);
  });

  it('especialista que pediu 1 ferramenta gera 1 nó tool filho do NÓ DO ESPECIALISTA', async () => {
    const llm = fakeLlm({
      especialista: ({ dimensao, ultima }) => {
        if (dimensao !== 'plausibilidade_horas') return concluirEspecialista();
        if (/tool_result/.test(ultima)) return concluirEspecialista({ argumento: 'Conferido pela ferramenta: dentro do teto.' });
        return JSON.stringify({ acao: 'tool', nome: 'checar_plausibilidade_horas', args: { tipo_saving: 'mensal' } });
      },
    });
    const reg = fakeRegistrador();
    const r = await rodar({ chamarLlm: llm.fn, registrar: reg.fn });

    const tools = reg.nos.filter((n) => n.tipo === 'tool');
    expect(tools).toHaveLength(1);
    const idsEspecialistas = new Set(reg.nos.filter((n) => n.tipo === 'especialista').map((n) => n.id));
    expect(tools[0].pai_id).not.toBeNull();
    expect(idsEspecialistas.has(tools[0].pai_id as string)).toBe(true);
    expect(reg.nos.filter((n) => n.pai_id === null)).toHaveLength(1);
    expect(r.log.nos).toBe(reg.nos.length);
    expect(r.chamadas_llm).toBe(8); // o especialista com ferramenta falou 2×, e há 2 céticos
  });
});

// ── 3. debate com teto ───────────────────────────────────────────────────────

describe('avaliarComTime — debate com TETO (D15, MAX_RODADAS_DEBATE = 2)', () => {
  it('a constante do teto é 2', () => {
    expect(MAX_RODADAS_DEBATE).toBe(2);
  });

  it('cético refuta a aprovação → réplica dos 4 especialistas + novo cético (11 chamadas, 2 rodadas, nó debate)', async () => {
    const llm = fakeLlm({ cetico: ({ n }) => (n === 1 ? ceticoRefuta() : ceticoAceita()) });
    const reg = fakeRegistrador();
    const r = await rodar({ chamarLlm: llm.fn, registrar: reg.fn });

    expect(r.chamadas_llm).toBe(12); // + o cético da estrela
    expect(llm.contagem).toEqual({ especialista: 8, estrela: 1, cetico: 2, cetico_estrela: 1 });
    expect(r.rodadas_debate).toBe(2);
    expect(r.debate_fechou).toBe(true);
    expect(r.cetico.refuta).toBe(false);
    expect(r.consenso.saida).toBe('aprovar');

    // Rodada 1 sem réplica; rodada 2 com réplica (outrosJulgamentos + motivo do cético).
    const esp = llm.chamadas.filter((c) => c.papel === 'especialista');
    const userDe = (c: { mensagens: Mensagem[] }) => c.mensagens.find((m) => m.role === 'user')?.content ?? '';
    const semReplica = esp.filter((c) => !/réplica|debate/i.test(userDe(c)));
    const comReplica = esp.filter((c) => /réplica|debate/i.test(userDe(c)));
    expect(semReplica).toHaveLength(4);
    expect(comReplica).toHaveLength(4);
    for (const c of comReplica) expect(userDe(c)).toContain(MOTIVO_CETICO);

    // Árvore: nó debate (rodada 2) filho da raiz; os 4 especialistas da réplica filhos dele.
    const raiz = reg.nos[0];
    expect(raiz.tipo).toBe('orquestrador');
    const debates = reg.nos.filter((n) => n.tipo === 'debate');
    expect(debates).toHaveLength(1);
    expect(debates[0].pai_id).toBe(raiz.id);
    expect(debates[0].rodada).toBe(2);
    const especialistas = reg.nos.filter((n) => n.tipo === 'especialista');
    expect(especialistas).toHaveLength(8);
    expect(especialistas.filter((n) => n.pai_id === raiz.id)).toHaveLength(4);
    expect(especialistas.filter((n) => n.pai_id === debates[0].id)).toHaveLength(4);
    expect(reg.nos.filter((n) => n.tipo === 'cetico')).toHaveLength(3); // 2 do mérito (réplica) + 1 da estrela
    expect(reg.nos.filter((n) => n.pai_id === null)).toHaveLength(1);
  });

  it('cético que NUNCA aceita: fecha em 2 rodadas (nunca 3), debate_fechou=false e saída humano', async () => {
    const llm = fakeLlm({ cetico: ceticoRefuta });
    const r = await rodar({ chamarLlm: llm.fn });

    expect(r.rodadas_debate).toBe(MAX_RODADAS_DEBATE);
    expect(llm.contagem).toEqual({ especialista: 8, estrela: 1, cetico: 2, cetico_estrela: 1 });
    expect(r.chamadas_llm).toBe(12); // + o cético da estrela
    expect(r.cetico.refuta).toBe(true);
    expect(r.merito.veredito).toBe('aprovar');
    expect(r.debate_fechou).toBe(false);
    expect(r.consenso.saida).toBe('humano');
    expect(r.textos.interno.length).toBeGreaterThan(0);
  });
});

// ── 4. cético refuta mas o mérito já pedia ajuste → sem réplica ──────────────

describe('avaliarComTime — cético refuta um AJUSTE: não há o que debater', () => {
  it('sem réplica, saída ajuste, texto ao autor presente e SEM R$', async () => {
    const llm = fakeLlm({
      cetico: ceticoRefuta,
      especialista: ({ dimensao }) => {
        if (dimensao === 'plausibilidade_horas') {
          return concluirEspecialista({
            preocupa: true,
            argumento: '120 h para um analista é o limite; falta dizer se é uma pessoa só.',
            pergunta_ao_autor: 'As 120 h por mês são de UMA pessoa ou de várias? O valor/hora do cargo é R$ 147,40/hora.',
          });
        }
        if (dimensao === 'financeiro') {
          return concluirEspecialista({
            preocupa: true,
            argumento: 'O ganho declarado supõe R$ 17.688 ao mês, acima da curva do cargo.',
            pergunta_ao_autor: 'Qual a periodicidade real do saving: mensal ou total do ano?',
            valor: { absurdo: false, valor_sugerido: null, justificativa: 'Depende da periodicidade.' },
          });
        }
        return concluirEspecialista();
      },
    });
    const r = await rodar({ chamarLlm: llm.fn });

    expect(r.merito.veredito).toBe('ajuste');
    expect(r.cetico.refuta).toBe(true);
    expect(r.rodadas_debate).toBe(1);
    expect(r.chamadas_llm).toBe(7); // + o cético da estrela
    expect(r.debate_fechou).toBe(true);
    expect(r.consenso.saida).toBe('ajuste');
    expect(r.textos.ao_autor).not.toBeNull();
    expect(r.textos.ao_autor!).toMatch(/Para corrigir/);
    expect(r.textos.ao_autor!).not.toMatch(/R\$/);
    expect(r.textos.comite).toBeNull();
  });
});

// ── 5. ferramentas ───────────────────────────────────────────────────────────

describe('avaliarComTime — ferramentas dos especialistas', () => {
  it('especialista pede checar_plausibilidade_horas e conclui → executar recebe esse nome', async () => {
    const llm = fakeLlm({
      especialista: ({ dimensao, ultima }) => {
        if (dimensao !== 'plausibilidade_horas') return concluirEspecialista();
        if (/tool_result/.test(ultima)) return concluirEspecialista();
        return JSON.stringify({ acao: 'tool', nome: 'checar_plausibilidade_horas', args: { tipo_saving: 'mensal' } });
      },
    });
    const exe = fakeExecutor();
    const r = await rodar({ chamarLlm: llm.fn, executar: exe.fn });

    expect(exe.mock).toHaveBeenCalledTimes(1);
    expect(exe.mock.mock.calls[0][0]).toBe('checar_plausibilidade_horas');
    expect(r.merito.julgamentos.find((j) => j.dimensao === 'plausibilidade_horas')?.fallback).toBe(false);
    expect(r.erros).toEqual([]);
  });

  it('teto ferramentasPorAgente: 1 — especialista que pediria 2 ferramentas só executa 1', async () => {
    const llm = fakeLlm({
      especialista: ({ dimensao, ultima }) => {
        if (dimensao !== 'plausibilidade_horas') return concluirEspecialista();
        // Só conclui quando o loop avisa que o limite acabou; senão pede mais uma ferramenta.
        if (/limite de chamadas/i.test(ultima)) return concluirEspecialista();
        return JSON.stringify({ acao: 'tool', nome: 'checar_plausibilidade_horas', args: {} });
      },
    });
    const exe = fakeExecutor();
    const r = await rodar({ chamarLlm: llm.fn, executar: exe.fn, ferramentasPorAgente: 1 });

    expect(exe.mock).toHaveBeenCalledTimes(1);
    expect(r.merito.julgamentos).toHaveLength(4);
    expect(r.consenso).toBeDefined();
  });

  it('default do teto é 2 por agente: o mesmo especialista insistente executa 2 e para', async () => {
    const llm = fakeLlm({
      especialista: ({ dimensao, ultima }) => {
        if (dimensao !== 'plausibilidade_horas') return concluirEspecialista();
        if (/limite de chamadas/i.test(ultima)) return concluirEspecialista();
        return JSON.stringify({ acao: 'tool', nome: 'checar_plausibilidade_horas', args: {} });
      },
    });
    const exe = fakeExecutor();
    await rodar({ chamarLlm: llm.fn, executar: exe.fn });
    expect(exe.mock).toHaveBeenCalledTimes(2);
  });
});

// ── 6. resiliência: NUNCA lança ──────────────────────────────────────────────

describe('avaliarComTime — resiliência (nunca lança)', () => {
  it('LLM rejeita só para a estrela → estrela em fallback (nota 0, racional acusa), o resto segue, 1 erro citando estrela', async () => {
    const llm = fakeLlm({
      estrela: async () => {
        throw new Error('proxy caiu');
      },
    });
    const r = await rodar({ chamarLlm: llm.fn });

    expect(r.estrela.nota).toBe(0);
    expect(r.estrela.racional).toMatch(/fallback/i);
    expect(r.estrela.sem_evidencia).toBe(true);
    expect(r.merito.veredito).toBe('aprovar');
    expect(r.merito.julgamentos.every((j) => !j.fallback)).toBe(true);
    expect(r.consenso).toBeDefined();
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatch(/estrela/i);
  });

  it('LLM rejeita para TODOS → não lança; 4 julgamentos em fallback; sem julgamento válido a saída é humano; erros ≥ 6', async () => {
    const chamarLlm: ChamarLlm = async () => {
      throw new Error('LLM indisponível');
    };
    const r = await rodar({ chamarLlm });

    expect(r.merito.julgamentos).toHaveLength(4);
    expect(r.merito.julgamentos.every((j) => j.fallback)).toBe(true);
    expect(r.estrela.nota).toBe(0);
    expect(r.cetico.fallback).toBe(true);
    expect(r.consenso.saida).toBe('humano');
    expect(r.erros.length).toBeGreaterThanOrEqual(6);
    expect(r.textos.interno.length).toBeGreaterThan(0);
  });

  it('registrador REJEITA → não lança; raiz null; só a raiz foi tentada (nada de filho solto); erro cita "log"', async () => {
    const reg = fakeRegistrador({ falhar: 'rejeita' });
    const r = await rodar({ registrar: reg.fn });

    expect(r.log.raiz_id).toBeNull();
    expect(r.log.nos).toBe(0);
    expect(reg.mock).toHaveBeenCalledTimes(1);
    expect(reg.mock.mock.calls[0][0].tipo).toBe('orquestrador');
    expect(r.erros.some((e) => /log/i.test(e))).toBe(true);
    // O time continua avaliando mesmo sem log.
    expect(r.consenso.saida).toBe('aprovar');
    expect(r.chamadas_llm).toBe(7); // + o cético da estrela
  });

  it('registrador devolve null para a raiz → mesmo comportamento: nenhum filho registrado, raiz null', async () => {
    const reg = fakeRegistrador({ falhar: 'null' });
    const r = await rodar({ registrar: reg.fn });

    expect(r.log.raiz_id).toBeNull();
    expect(r.log.nos).toBe(0);
    expect(reg.mock).toHaveBeenCalledTimes(1);
    expect(r.erros.some((e) => /log/i.test(e))).toBe(true);
    expect(r.consenso).toBeDefined();
  });

  it('executar rejeita → o especialista recebe tool_result.erro, conclui normalmente e isso NÃO vira erro do time', async () => {
    const ultimas: string[] = [];
    const llm = fakeLlm({
      especialista: ({ dimensao, ultima }) => {
        if (dimensao !== 'plausibilidade_horas') return concluirEspecialista();
        if (/tool_result/.test(ultima)) {
          ultimas.push(ultima);
          return concluirEspecialista({ argumento: 'Ferramenta indisponível; julguei pelo dossiê.' });
        }
        return JSON.stringify({ acao: 'tool', nome: 'checar_plausibilidade_horas', args: {} });
      },
    });
    const exe = fakeExecutor(async () => {
      throw new Error('ferramenta fora do ar');
    });
    const r = await rodar({ chamarLlm: llm.fn, executar: exe.fn });

    expect(exe.mock).toHaveBeenCalledTimes(1);
    expect(ultimas).toHaveLength(1);
    expect(JSON.parse(ultimas[0]).tool_result).toEqual({ erro: 'ferramenta fora do ar' });
    const j = r.merito.julgamentos.find((x) => x.dimensao === 'plausibilidade_horas');
    expect(j?.fallback).toBe(false);
    expect(r.erros).toEqual([]);
  });
});

// ── 7. escape 6–10 → comitê ──────────────────────────────────────────────────

describe('avaliarComTime — escape 6 a 10 vai ao comitê com dossiê', () => {
  const estrelaComEscape = () =>
    concluirEstrela({
      nota: 5,
      criterio_aplicado: 'Assume',
      escape: {
        indicado: true,
        evidencias: {
          nao_existiria: 'a conciliação diária em D+0 só existe porque o robô roda',
          sem_volta: 'o time de fechamento foi realocado e a rotina manual deixou de existir',
        },
      },
    });

  it('estrela 5 com os 2 gatilhos → consenso humano com escape=true e dossiê de comitê citando "comitê" e "6 a 10"', async () => {
    const llm = fakeLlm({ estrela: estrelaComEscape });
    const r = await rodar({ chamarLlm: llm.fn });

    expect(r.estrela.escape.indicado).toBe(true);
    expect(r.estrela.escape.valido).toBe(true);
    expect(r.consenso.escape).toBe(true);
    expect(r.consenso.saida).toBe('humano');
    expect(r.textos.comite).not.toBeNull();
    expect(r.textos.comite!).toMatch(/comitê/i);
    expect(r.textos.comite!).toContain('6 a 10');
    expect(r.textos.ao_autor).toBeNull();
  });

  it('com um vizinho de nota humana 10, o dossiê de comitê nomeia esse par', async () => {
    const llm = fakeLlm({ estrela: estrelaComEscape });
    const r = await rodar({ chamarLlm: llm.fn, vizinhos: VIZINHOS_COM_ANCORA });

    expect(r.consenso.saida).toBe('humano');
    expect(r.textos.comite).not.toBeNull();
    expect(r.textos.comite!).toContain('Plataforma Prisma');
  });
});

// ── 8. nota humana chega ao cérebro B ────────────────────────────────────────

describe('avaliarComTime — notaHumana repassada ao cérebro da estrela', () => {
  it('notaHumana 8 → saída da estrela com ancora_congelada=true', async () => {
    const r = await rodar({ notaHumana: 8 });
    expect(r.estrela.ancora_congelada).toBe(true);
  });

  it('sem nota humana → ancora_congelada=false', async () => {
    const r = await rodar({ notaHumana: null });
    expect(r.estrela.ancora_congelada).toBe(false);
  });
});

// ── 9. cético: prompt e normalização ─────────────────────────────────────────

describe('buildPromptCetico / normalizarCetico', () => {
  function julgamentos(): JulgamentoMerito[] {
    const js = [
      normalizarJulgamentoMerito(
        { preocupa: false, argumento: 'ARG-PLAUSIBILIDADE horas dentro do teto', evidencias: ['120 h'] },
        'plausibilidade_horas',
      ),
      normalizarJulgamentoMerito({ preocupa: false, argumento: 'ARG-FINANCEIRO valor na curva', evidencias: [] }, 'financeiro'),
      normalizarJulgamentoMerito({ preocupa: false, argumento: 'ARG-PRECEDENTE parecido com o aprovado', evidencias: [] }, 'precedente'),
      normalizarJulgamentoMerito({ preocupa: true, argumento: 'ARG-EVIDENCIA sem anexo', evidencias: [] }, 'evidencia'),
    ];
    for (const j of js) expect(j).not.toBeNull();
    return js as JulgamentoMerito[];
  }

  it('devolve [system, user]; system se apresenta como cético e pede o JSON {refuta, motivo, sinais}', () => {
    const estrela = normalizarSaidaEstrela(
      { nota: 3, criterio_aplicado: 'Garante', evidencias: ['x'], racional: 'r' },
      { temVizinhos: true, notaHumana: null },
    )!;
    const msgs = buildPromptCetico({ dossieTexto: `DOSSIÊ-MARCADOR ${NOME_PROJETO}`, julgamentos: julgamentos(), estrela });

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect(msgs[0].content).toMatch(/cético/i);
    expect(msgs[0].content).toContain('"refuta"');
    expect(msgs[0].content).toContain('"motivo"');
    expect(msgs[0].content).toContain('"sinais"');
  });

  it('user carrega o dossiê, o argumento de CADA julgamento e a nota da estrela', () => {
    const estrela = normalizarSaidaEstrela(
      { nota: 3, criterio_aplicado: 'Garante', evidencias: ['x'], racional: 'r' },
      { temVizinhos: true, notaHumana: null },
    )!;
    const msgs = buildPromptCetico({ dossieTexto: `DOSSIÊ-MARCADOR ${NOME_PROJETO}`, julgamentos: julgamentos(), estrela });
    const user = msgs[1].content;

    expect(user).toContain('DOSSIÊ-MARCADOR');
    expect(user).toContain('ARG-PLAUSIBILIDADE');
    expect(user).toContain('ARG-FINANCEIRO');
    expect(user).toContain('ARG-PRECEDENTE');
    expect(user).toContain('ARG-EVIDENCIA');
    expect(user).toMatch(/\b3\b/);
  });

  it('normalizarCetico: coage refuta, mantém motivo, sinais não-lista vira [] e fallback=false', () => {
    expect(normalizarCetico({ refuta: 'true', motivo: 'x', sinais: 'a' })).toEqual({
      refuta: true,
      motivo: 'x',
      sinais: [],
      fallback: false,
    });
  });

  it('normalizarCetico: null → null; refuta ausente → false; motivo vazio → null; sinais lista de strings preservada', () => {
    expect(normalizarCetico(null)).toBeNull();
    expect(normalizarCetico(undefined)).toBeNull();
    expect(normalizarCetico('texto solto')).toBeNull();
    expect(normalizarCetico({ motivo: 'só motivo' })).toEqual({ refuta: false, motivo: 'só motivo', sinais: [], fallback: false });
    expect(normalizarCetico({ refuta: true, motivo: '' })).toEqual({ refuta: true, motivo: null, sinais: [], fallback: false });
    expect(normalizarCetico({ refuta: true, motivo: '   ' })?.motivo).toBeNull();
    expect(normalizarCetico({ refuta: false, sinais: ['a', 'b'] })?.sinais).toEqual(['a', 'b']);
  });
});

// ── 10. variante 4 (D13 emendada, 03/09): refutação sustentada COM pergunta vira AJUSTE ─────────
// Regressão registrada depois da rodada 3 do retroativo (8 dos 9 humanos eram "debate não fechou" com
// o cético apontando contradição concreta e respondível). Sem pergunta, segue humano (caso 3 acima).

describe('avaliarComTime — refutação sustentada do cético COM pergunta vira ajuste (D13 emendada)', () => {
  it('cético refuta nas 2 rodadas com pergunta_ao_autor → ajuste, texto ao autor traz a pergunta sem R$', async () => {
    const llm = fakeLlm({
      cetico: () =>
        JSON.stringify({
          refuta: true,
          motivo: 'O memorial divide o tempo posterior por dois: 2.200 × 30 s = 66.000 s, não 33.000 s.',
          sinais: ['erro de conta'],
          pergunta_ao_autor: 'O tempo depois da automação é 66.000 segundos por mês (18,3 h) ou 33.000? O valor/hora é R$ 73,00/hora.',
        }),
    });
    const r = await rodar({ chamarLlm: llm.fn });
    expect(r.cetico.refuta).toBe(true);
    expect(r.rodadas_debate).toBe(MAX_RODADAS_DEBATE);
    expect(r.merito.veredito).toBe('ajuste');
    expect(r.debate_fechou).toBe(true);
    expect(r.consenso.saida).toBe('ajuste');
    expect(r.textos.ao_autor).not.toBeNull();
    expect(r.textos.ao_autor!).toContain('66.000 segundos');
    expect(r.textos.ao_autor!).not.toMatch(/R\$/);
  });
});

// ── 11. D16: as âncoras congeladas entram no dossiê de comitê mesmo sem vizinho ≥ 6 ─────────────

describe('avaliarComTime — dossiê de comitê traz as âncoras congeladas (D16)', () => {
  it('sem vizinho de nota ≥ 6, as âncoras passadas aparecem como pares do comitê', async () => {
    const llm = fakeLlm({
      estrela: () =>
        concluirEstrela({
          nota: 5,
          criterio_aplicado: 'Assume',
          escape: {
            indicado: true,
            evidencias: { nao_existiria: 'a conciliação em D+0 só existe porque o robô roda', sem_volta: 'a rotina manual deixou de existir' },
          },
        }),
    });
    const r = await rodar({
      chamarLlm: llm.fn,
      vizinhos: VIZINHOS,
      ancoras: [{ nome: 'PIAPP', nota: 10, resumo: 'Plataforma de IA da casa.' }],
    });
    expect(r.consenso.saida).toBe('humano');
    expect(r.textos.comite).not.toBeNull();
    expect(r.textos.comite!).toContain('PIAPP (10 estrelas)');
    expect(r.textos.comite!).not.toMatch(/sem par|nenhum par/i);
  });
});
