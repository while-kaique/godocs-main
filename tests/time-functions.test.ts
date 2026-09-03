// T15/T20 — Orquestração do TIME de avaliação, lado SERVIDOR (`src/lib/avaliacao/time.functions.ts`).
//
// Prende o contrato do módulo que liga o time PURO (`avaliarComTime`) às dependências do Worker:
// dossiê persistido (`carregarDossie`), log em árvore (`abrirCiclo`/`fecharCiclo`/`registrarNoAgente`),
// LLM roteado por PAPEL (leve p/ especialista, forte p/ estrela e cético — opt-in por env lida em
// RUNTIME), executor REAL das ferramentas (TeamGuide, espelho, vizinhos) e liberação em SOMBRA.
// NUNCA lança: toda falha vira `{ ok: false, motivo }` e o ciclo aberto aqui fecha com `status 'erro'`.
//
// Só rede/banco é mockado; `politicaDeLiberacao`, `buscarDuplicataNaLista`, `checarPlausibilidadeHoras`
// e `calcularImpactoBasico` são PUROS e rodam de verdade.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const carregarDossie = vi.fn<(id: string) => Promise<unknown>>();
const avaliarComTime = vi.fn<(args: Record<string, unknown>) => Promise<unknown>>();
const abrirCiclo = vi.fn<(c: Record<string, unknown>) => Promise<string | null>>();
const fecharCiclo = vi.fn<(id: string, fim: Record<string, unknown>) => Promise<boolean>>();
const registrarNoAgente = vi.fn<(no: Record<string, unknown>) => Promise<{ id: string; caminho: string } | null>>();
const llmChat = vi.fn<(mensagens: unknown[], opts?: Record<string, unknown>) => Promise<string>>();
const getCargoDe = vi.fn<(email: string) => Promise<string | null>>();
const lerResumosEspelho = vi.fn<() => Promise<{ linhas: Record<string, string>[]; lidoEmMs: number | null }>>();

vi.mock('@/lib/avaliacao/dossie.functions', () => ({
  carregarDossie: (...a: unknown[]) => carregarDossie(...(a as [string])),
}));
vi.mock('@/lib/avaliacao/time', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  avaliarComTime: (...a: unknown[]) => avaliarComTime(...(a as [Record<string, unknown>])),
}));
vi.mock('@/lib/agentes-log.functions', () => ({
  abrirCiclo: (...a: unknown[]) => abrirCiclo(...(a as [Record<string, unknown>])),
  fecharCiclo: (...a: unknown[]) => fecharCiclo(...(a as [string, Record<string, unknown>])),
  registrarNoAgente: (...a: unknown[]) => registrarNoAgente(...(a as [Record<string, unknown>])),
}));
vi.mock('@/lib/llm', () => ({
  llmChat: (...a: unknown[]) => llmChat(...(a as [unknown[], Record<string, unknown>])),
}));
vi.mock('@/lib/areas/teamguide.server', () => ({
  getCargoDe: (...a: unknown[]) => getCargoDe(...(a as [string])),
}));
vi.mock('@/lib/sheet-espelho', () => ({
  lerResumosEspelho: () => lerResumosEspelho(),
}));

import { modelosDoTime, executorPadrao, avaliarProjetoComTime } from '@/lib/avaliacao/time.functions';
import { dossieDaLinhaPlanilha, type Dossie } from '@/lib/avaliacao/dossie';
import type { VizinhoTime, ResultadoTime } from '@/lib/avaliacao/time';

// ── fixtures ─────────────────────────────────────────────────────────────────

const AUTOR = 'ana.silva@gocase.com';

function linhaPlanilha(over: Record<string, string> = {}): Record<string, string> {
  return {
    'ID Projeto': 'P1',
    Projeto: 'Robô de Conciliação',
    'Nome Completo': 'Ana Silva',
    Email: AUTOR,
    Área: 'Financeiro',
    Status: 'Pendente',
    'Saving Horas': '60',
    'Saving Reais': '8844',
    'Tipo de Saving': 'mensal',
    'Alguém Fazia?': 'sim',
    'Receita Mensal': '0',
    'Ganho Total': '8844',
    Estrelas: '0',
    ...over,
  };
}

function dossie(over: Record<string, string> = {}): Dossie {
  const d = dossieDaLinhaPlanilha(linhaPlanilha(over));
  if (!d) throw new Error('fixture: dossiê da planilha veio null');
  return d;
}

function vizinho(id: string): VizinhoTime {
  return { id, nome: `Vizinho ${id}`, nota: 3, status: 'Aprovado', similaridade: 0.9, resumo: 'r' };
}

function resultadoFake(saida: 'aprovar' | 'ajuste' | 'humano' = 'aprovar'): ResultadoTime {
  return {
    projeto_id: 'P1',
    consenso: { saida },
    rodadas_debate: 0,
    debate_fechou: true,
    textos: { interno: 'i', ao_autor: null, comite: null },
    chamadas_llm: 3,
    erros: [],
    log: { raiz_id: 'N1', nos: 3 },
  } as unknown as ResultadoTime;
}

type Deps = Parameters<typeof executorPadrao>[1];
function deps(over: Partial<Deps> = {}): Deps {
  return {
    getCargoDe: vi.fn(async () => 'Analista'),
    listarCandidatosDuplicata: vi.fn(async () => []),
    vizinhos: [vizinho('V1'), vizinho('V2')],
    ...over,
  };
}

const ENVS = ['AVALIACAO_MODELO_LEVE', 'AVALIACAO_MODELO_FORTE', 'AVALIACAO_REASONING_EFFORT_LEVE'] as const;
const envAntes: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENVS) {
    envAntes[k] = process.env[k];
    delete process.env[k];
  }
  carregarDossie.mockResolvedValue(dossie());
  avaliarComTime.mockResolvedValue(resultadoFake('aprovar'));
  abrirCiclo.mockResolvedValue('C9');
  fecharCiclo.mockResolvedValue(true);
  registrarNoAgente.mockResolvedValue({ id: 'N1', caminho: 'N1' });
  llmChat.mockResolvedValue('{}');
  getCargoDe.mockResolvedValue('Analista');
  lerResumosEspelho.mockResolvedValue({ linhas: [], lidoEmMs: null });
});

afterEach(() => {
  for (const k of ENVS) {
    if (envAntes[k] === undefined) delete process.env[k];
    else process.env[k] = envAntes[k];
  }
});

// ── 1. modelosDoTime ─────────────────────────────────────────────────────────

describe('modelosDoTime — roteamento por papel, opt-in por env', () => {
  it('sem env → tudo undefined (byte-idêntico ao padrão)', () => {
    expect(modelosDoTime({})).toEqual({
      especialista: undefined,
      estrela: undefined,
      cetico: undefined,
      effortEspecialista: undefined,
    });
  });

  it('leve vai ao especialista; forte à estrela E ao cético; effort só no especialista', () => {
    expect(
      modelosDoTime({
        AVALIACAO_MODELO_LEVE: 'gpt-5.6-luna',
        AVALIACAO_MODELO_FORTE: 'gpt-5.6-sol',
        AVALIACAO_REASONING_EFFORT_LEVE: 'low',
      }),
    ).toEqual({
      especialista: 'gpt-5.6-luna',
      estrela: 'gpt-5.6-sol',
      cetico: 'gpt-5.6-sol',
      effortEspecialista: 'low',
    });
  });

  it("'minimal' fica FORA da allowlist (gateway devolve 502) → effort undefined", () => {
    expect(modelosDoTime({ AVALIACAO_REASONING_EFFORT_LEVE: 'minimal' }).effortEspecialista).toBeUndefined();
    expect(modelosDoTime({ AVALIACAO_REASONING_EFFORT_LEVE: '' }).effortEspecialista).toBeUndefined();
    expect(modelosDoTime({ AVALIACAO_REASONING_EFFORT_LEVE: 'xhigh' }).effortEspecialista).toBe('xhigh');
  });

  it('sem argumento lê process.env em RUNTIME (mudar depois do import reflete)', () => {
    expect(modelosDoTime().especialista).toBeUndefined();
    process.env.AVALIACAO_MODELO_LEVE = 'modelo-runtime';
    expect(modelosDoTime().especialista).toBe('modelo-runtime');
  });
});

// ── 2. executorPadrao ────────────────────────────────────────────────────────

describe('executorPadrao — ferramentas reais sobre as deps', () => {
  it('consultar_cargo com email → getCargoDe(email) e { cargo }', async () => {
    const d = deps({ getCargoDe: vi.fn(async () => 'Coordenador') });
    const exec = executorPadrao(dossie(), d);
    await expect(exec('consultar_cargo', { email: 'x@gocase.com' })).resolves.toEqual({ cargo: 'Coordenador' });
    expect(d.getCargoDe).toHaveBeenCalledWith('x@gocase.com');
  });

  it('consultar_cargo sem email → usa o e-mail do autor do dossiê', async () => {
    const d = deps();
    const exec = executorPadrao(dossie(), d);
    await exec('consultar_cargo', {});
    expect(d.getCargoDe).toHaveBeenCalledWith(AUTOR);
  });

  it('consultar_cargo com TeamGuide lançando → { cargo: null, erro } sem propagar', async () => {
    const d = deps({
      getCargoDe: vi.fn(async () => {
        throw new Error('401 token vencido');
      }),
    });
    const exec = executorPadrao(dossie(), d);
    const r = (await exec('consultar_cargo', { email: 'x@gocase.com' })) as { cargo: unknown; erro: unknown };
    expect(r.cargo).toBeNull();
    expect(typeof r.erro).toBe('string');
  });

  it('buscar_duplicata → usa listarCandidatosDuplicata e acha o homônimo com saving>0', async () => {
    const d = deps({
      listarCandidatosDuplicata: vi.fn(async () => [
        { id: 'OUTRO', nome: 'Robô de Conciliação', saving_reais: 5000, receita_mensal: null, status: 'Aprovado' },
        { id: 'X', nome: 'Coisa diferente', saving_reais: 1, receita_mensal: null, status: null },
      ]),
    });
    const exec = executorPadrao(dossie(), d);
    const r = (await exec('buscar_duplicata', {})) as { id: string }[];
    expect(d.listarCandidatosDuplicata).toHaveBeenCalledTimes(1);
    expect(Array.isArray(r)).toBe(true);
    expect(r.map((x) => x.id)).toContain('OUTRO');
  });

  it('consultar_vizinhos com k:1 → 1 vizinho', async () => {
    const exec = executorPadrao(dossie(), deps());
    const r = (await exec('consultar_vizinhos', { k: 1 })) as unknown[];
    expect(r).toHaveLength(1);
  });

  it('checar_plausibilidade_horas → teto_por_pessoa 220', async () => {
    const exec = executorPadrao(dossie(), deps());
    const r = (await exec('checar_plausibilidade_horas', {})) as { teto_por_pessoa: number };
    expect(r.teto_por_pessoa).toBe(220);
  });

  it('calcular_impacto → ganho_total_mensal numérico', async () => {
    const exec = executorPadrao(dossie(), deps());
    const r = (await exec('calcular_impacto', {})) as { ganho_total_mensal: unknown };
    expect(typeof r.ganho_total_mensal).toBe('number');
  });

  it('historico_versoes → dossie.historico', async () => {
    const d = dossie();
    const exec = executorPadrao(d, deps());
    await expect(exec('historico_versoes', {})).resolves.toEqual(d.historico);
  });

  it('ler_evidencia → { link, texto: null, aviso } (texto de anexo não é persistido)', async () => {
    const exec = executorPadrao(dossie(), deps());
    const r = (await exec('ler_evidencia', { link: 'u' })) as { link: string; texto: unknown; aviso: unknown };
    expect(r.link).toBe('u');
    expect(r.texto).toBeNull();
    expect(typeof r.aviso).toBe('string');
  });

  it('ferramenta desconhecida → rejeita', async () => {
    const exec = executorPadrao(dossie(), deps());
    await expect(exec('nao_existe' as never, {})).rejects.toThrow();
  });
});

// ── 3–6. avaliarProjetoComTime ───────────────────────────────────────────────

type ArgsTime = {
  vizinhos: unknown[];
  registrar: (no: Record<string, unknown>) => Promise<string | null>;
  chamarLlm: (mensagens: unknown[], papel: string) => Promise<string>;
  liberacao: { aprovar: boolean; ajuste: boolean };
};
function argsCapturados(): ArgsTime {
  expect(avaliarComTime).toHaveBeenCalledTimes(1);
  return avaliarComTime.mock.calls[0][0] as unknown as ArgsTime;
}

describe('avaliarProjetoComTime — caminho feliz', () => {
  it('carrega o dossiê, abre o ciclo, roda o time, fecha concluído e devolve ok', async () => {
    const r = await avaliarProjetoComTime('P1');

    expect(carregarDossie).toHaveBeenCalledWith('P1');
    expect(abrirCiclo).toHaveBeenCalledTimes(1);
    expect(abrirCiclo.mock.calls[0][0]).toMatchObject({ gatilho: 'avaliacao' });
    expect(avaliarComTime).toHaveBeenCalledTimes(1);
    expect(fecharCiclo).toHaveBeenCalledTimes(1);
    expect(fecharCiclo.mock.calls[0][0]).toBe('C9');
    expect(fecharCiclo.mock.calls[0][1]).toMatchObject({ status: 'concluido' });
    expect(r).toEqual({ ok: true, ciclo_id: 'C9', resultado: resultadoFake('aprovar') });
  });

  it('registrar → registrarNoAgente com ciclo_id/projeto_id e devolve o id', async () => {
    await avaliarProjetoComTime('P1');
    const { registrar } = argsCapturados();
    const id = await registrar({ pai_id: null, agente: 'orquestrador', tipo: 'orquestrador' });
    expect(registrarNoAgente).toHaveBeenCalledTimes(1);
    expect(registrarNoAgente.mock.calls[0][0]).toMatchObject({
      ciclo_id: 'C9',
      projeto_id: 'P1',
      pai_id: null,
      agente: 'orquestrador',
      tipo: 'orquestrador',
    });
    expect(id).toBe('N1');
  });

  it('chamarLlm roteia por PAPEL: leve+effort no especialista, forte sem effort na estrela/cético, jsonMode sempre', async () => {
    process.env.AVALIACAO_MODELO_LEVE = 'gpt-5.6-luna';
    process.env.AVALIACAO_MODELO_FORTE = 'gpt-5.6-sol';
    process.env.AVALIACAO_REASONING_EFFORT_LEVE = 'low';
    await avaliarProjetoComTime('P1');
    const { chamarLlm } = argsCapturados();
    const msgs = [{ role: 'user', content: 'oi' }];

    await chamarLlm(msgs, 'especialista');
    await chamarLlm(msgs, 'estrela');
    await chamarLlm(msgs, 'cetico');

    expect(llmChat).toHaveBeenCalledTimes(3);
    const [opEsp, opEst, opCet] = llmChat.mock.calls.map((c) => c[1] ?? {});
    expect(opEsp).toMatchObject({ model: 'gpt-5.6-luna', reasoningEffort: 'low', jsonMode: true });
    expect(opEst).toMatchObject({ model: 'gpt-5.6-sol', jsonMode: true });
    expect(opEst.reasoningEffort).toBeUndefined();
    expect(opCet).toMatchObject({ model: 'gpt-5.6-sol', jsonMode: true });
    expect(opCet.reasoningEffort).toBeUndefined();
    expect(llmChat.mock.calls[0][0]).toBe(msgs);
  });

  it('sem envs de modelo, chamarLlm não fixa model nem reasoningEffort (cai no LLM_MODEL) mas mantém jsonMode', async () => {
    await avaliarProjetoComTime('P1');
    const { chamarLlm } = argsCapturados();
    await chamarLlm([{ role: 'user', content: 'oi' }], 'especialista');
    const op = llmChat.mock.calls[0][1] ?? {};
    expect(op.model).toBeUndefined();
    expect(op.reasoningEffort).toBeUndefined();
    expect(op.jsonMode).toBe(true);
  });

  it('liberação em SOMBRA: sem acurácia medida, aprovar e ajuste são false', async () => {
    await avaliarProjetoComTime('P1');
    const { liberacao } = argsCapturados();
    expect(liberacao.aprovar).toBe(false);
    expect(liberacao.ajuste).toBe(false);
  });

  it('opts.cicloId reaproveita o ciclo: não abre nem fecha, e registra com ele', async () => {
    const r = await avaliarProjetoComTime('P1', { cicloId: 'C1' });
    expect(abrirCiclo).not.toHaveBeenCalled();
    expect(fecharCiclo).not.toHaveBeenCalled();
    const { registrar } = argsCapturados();
    await registrar({ pai_id: null, agente: 'orquestrador', tipo: 'orquestrador' });
    expect(registrarNoAgente.mock.calls[0][0]).toMatchObject({ ciclo_id: 'C1', projeto_id: 'P1' });
    expect(r).toMatchObject({ ok: true, ciclo_id: 'C1' });
  });
});

describe('avaliarProjetoComTime — nunca lança', () => {
  it('dossiê inexistente → { ok:false, motivo } citando o id; o time não roda', async () => {
    carregarDossie.mockResolvedValue(null);
    const r = await avaliarProjetoComTime('P1');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inesperado');
    expect(r.motivo).toContain('P1');
    expect(avaliarComTime).not.toHaveBeenCalled();
  });

  it('carregarDossie rejeitando → { ok:false }', async () => {
    carregarDossie.mockRejectedValue(new Error('banco fora'));
    await expect(avaliarProjetoComTime('P1')).resolves.toMatchObject({ ok: false });
    expect(avaliarComTime).not.toHaveBeenCalled();
  });

  it("avaliarComTime rejeitando → { ok:false } e o ciclo fecha com status 'erro'", async () => {
    avaliarComTime.mockRejectedValue(new Error('explodiu'));
    const r = await avaliarProjetoComTime('P1');
    expect(r.ok).toBe(false);
    expect(fecharCiclo).toHaveBeenCalledTimes(1);
    expect(fecharCiclo.mock.calls[0][0]).toBe('C9');
    expect(fecharCiclo.mock.calls[0][1]).toMatchObject({ status: 'erro' });
  });

  it('abrirCiclo → null: o time roda mesmo assim e registrar devolve null SEM chamar registrarNoAgente', async () => {
    abrirCiclo.mockResolvedValue(null);
    const r = await avaliarProjetoComTime('P1');
    expect(avaliarComTime).toHaveBeenCalledTimes(1);
    const { registrar } = argsCapturados();
    const id = await registrar({ pai_id: null, agente: 'orquestrador', tipo: 'orquestrador' });
    expect(id).toBeNull();
    expect(registrarNoAgente).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, ciclo_id: null });
  });

  it('lerResumosEspelho rejeitando → vizinhos [] e o time roda', async () => {
    lerResumosEspelho.mockRejectedValue(new Error('espelho indisponível'));
    const r = await avaliarProjetoComTime('P1');
    expect(r.ok).toBe(true);
    const { vizinhos } = argsCapturados();
    expect(vizinhos).toEqual([]);
  });
});
