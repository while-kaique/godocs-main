// O TIME de avaliação — orquestração com debate de teto (T15). Dependências INJETADAS (LLM,
// executor de ferramentas, registrador de log): o mesmo módulo roda no Worker (com llmChat e
// registrarNoAgente) e no harness do retroativo (OpenAI direto, banco em memória).
//
// Fluxo: raiz orquestrador → 4 especialistas do mérito (com ferramentas) → cérebro da estrela →
// consolida A → cético → se refuta uma aprovação, UMA réplica (D15: MAX_RODADAS_DEBATE = 2) →
// consenso (C) → textos. Cada passo vira um nó do log em ÁRVORE (T21); nada solto: sem raiz não se
// registra filho. NUNCA lança: LLM que cai vira fallback declarado e erro listado.
import {
  loopComFerramentas,
  descreverFerramentas,
  type Mensagem,
  type NomeFerramenta,
  type PassoLoop,
} from '@/lib/avaliacao/ferramentas';
import { dossieParaTexto, type Dossie } from '@/lib/avaliacao/dossie';
import {
  DIMENSOES_MERITO,
  buildPromptMerito,
  normalizarJulgamentoMerito,
  julgamentoFallback,
  consolidarMerito,
  type SaidaMerito,
  type JulgamentoMerito,
  type DimensaoMerito,
} from '@/lib/avaliacao/cerebro-merito';
import {
  buildPromptEstrela,
  normalizarSaidaEstrela,
  saidaEstrelaFallback,
  type SaidaEstrela,
} from '@/lib/avaliacao/cerebro-estrela';
import { conciliar, type Consenso, type Liberacao } from '@/lib/avaliacao/consenso';
import { textoJustificativaInterna, textoAoAutor, dossieDeComite } from '@/lib/avaliacao/textos';
import type { TipoNo } from '@/lib/agentes-log';

export type Papel = 'especialista' | 'estrela' | 'cetico';
export type ChamarLlm = (mensagens: Mensagem[], papel: Papel) => Promise<string>;
export type Executor = (nome: NomeFerramenta, args: Record<string, unknown>) => Promise<unknown>;
export type NoParaRegistrar = {
  pai_id: string | null;
  agente: string;
  tipo: TipoNo;
  rodada?: number;
  entrada?: string | null;
  saida?: string | null;
  tools_chamadas?: unknown[] | null;
  confianca?: string | null;
  veredito?: string | null;
  modelo?: string | null;
  erro?: string | null;
  duracao_ms?: number | null;
};
export type Registrador = (no: NoParaRegistrar) => Promise<string | null>;
export type VizinhoTime = { id: string; nome: string; nota: number | null; status: string | null; similaridade: number; resumo: string };

export const MAX_RODADAS_DEBATE = 2;
export const FERRAMENTAS_POR_AGENTE = 2;

export type ResultadoCetico = { refuta: boolean; motivo: string | null; sinais: string[]; fallback: boolean };

export type ResultadoTime = {
  projeto_id: string;
  merito: SaidaMerito;
  estrela: SaidaEstrela;
  cetico: ResultadoCetico;
  consenso: Consenso;
  rodadas_debate: number;
  debate_fechou: boolean;
  textos: { interno: string; ao_autor: string | null; comite: string | null };
  chamadas_llm: number;
  erros: string[];
  log: { raiz_id: string | null; nos: number };
};

// ── cético ───────────────────────────────────────────────────────────────────

export function buildPromptCetico(args: { dossieTexto: string; julgamentos: JulgamentoMerito[]; estrela: SaidaEstrela }): Mensagem[] {
  const system = `Você é o CÉTICO adversarial do time de avaliação do GoDocs. Sua tarefa é TENTAR DERRUBAR a aprovação, não conferi-la: procure a condição-limite que os especialistas deixaram passar (horas raspando o teto, valor inflado, evidência que é só o próprio entregável, duplicata, ganho projetado em vez de medido). Você lê o dossiê, os julgamentos dos especialistas e a estrela recomendada. Se não encontrar nada concreto, diga que não refuta: refutar sem motivo nomeado é ruído.

FORMATO DE RESPOSTA — responda APENAS com um objeto JSON:
{ "refuta": <bool>, "motivo": "<uma frase concreta com a evidência, ou null>", "sinais": ["<condição-limite detectada>", "..."] }`;
  const user = [
    'DOSSIÊ DO PROJETO:',
    args.dossieTexto,
    '',
    'JULGAMENTOS DOS ESPECIALISTAS:',
    ...args.julgamentos.map((j) => `- ${j.dimensao} (${j.preocupa ? 'PREOCUPA' : 'sem preocupação'}${j.fallback ? ', sem resposta' : ''}): ${j.argumento}`),
    '',
    `ESTRELA RECOMENDADA: ${args.estrela.nota} (${args.estrela.criterio_aplicado}). Racional: ${args.estrela.racional}`,
    '',
    'Tente derrubar a aprovação. Responda no formato pedido.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function normalizarCetico(bruto: unknown): ResultadoCetico | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const refuta = o.refuta === true || (typeof o.refuta === 'string' && /^(true|sim|s|yes|1)$/i.test(o.refuta.trim()));
  const motivo = typeof o.motivo === 'string' && o.motivo.trim() ? o.motivo.trim() : null;
  const sinais = Array.isArray(o.sinais) ? o.sinais.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  return { refuta, motivo, sinais, fallback: false };
}

function ceticoFallback(): ResultadoCetico {
  return { refuta: false, motivo: null, sinais: [], fallback: true };
}

// ── orquestração ─────────────────────────────────────────────────────────────

function extrairJsonSeguro(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    const i = raw.indexOf('{');
    const f = raw.lastIndexOf('}');
    if (i >= 0 && f > i) {
      try {
        return JSON.parse(raw.slice(i, f + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function json(v: unknown): string | null {
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

export async function avaliarComTime(args: {
  dossie: Dossie;
  vizinhos: VizinhoTime[];
  notaHumana: number | null;
  chamarLlm: ChamarLlm;
  executar: Executor;
  registrar: Registrador;
  liberacao: Liberacao;
  ferramentasPorAgente?: number;
}): Promise<ResultadoTime> {
  const { dossie, vizinhos } = args;
  const maxTools = args.ferramentasPorAgente ?? FERRAMENTAS_POR_AGENTE;
  const erros: string[] = [];
  let chamadas = 0;
  let nos = 0;

  const chamar = (papel: Papel) => async (mensagens: Mensagem[]) => {
    chamadas++;
    return args.chamarLlm(mensagens, papel);
  };

  // Log em árvore: sem raiz, nenhum filho é registrado (nada fica solto).
  const registrarSeguro = async (no: NoParaRegistrar, exigePai: boolean): Promise<string | null> => {
    if (exigePai && !no.pai_id) return null;
    try {
      const id = await args.registrar(no);
      if (id) nos++;
      return id ?? null;
    } catch (e) {
      erros.push(`log: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const t0 = Date.now();
  const raizId = await registrarSeguro(
    { pai_id: null, agente: 'orquestrador', tipo: 'orquestrador', rodada: 1, entrada: `projeto ${dossie.id}: ${dossie.nome}` },
    false,
  );
  if (!raizId && !erros.some((e) => e.startsWith('log:'))) erros.push('log: a raiz do orquestrador não foi registrada; filhos não serão gravados');

  const dossieTexto = dossieParaTexto(dossie, { comReais: true });
  const ferramentasTexto = descreverFerramentas();
  const vizinhosMerito = vizinhos.map((v) => ({ id: v.id, nome: v.nome, status: v.status, similaridade: v.similaridade, resumo: v.resumo }));
  const vizinhosEstrela = vizinhos
    .filter((v) => typeof v.nota === 'number')
    .map((v) => ({ id: v.id, nome: v.nome, nota: v.nota as number, similaridade: v.similaridade, resumo: v.resumo }));
  const temVizinhos = vizinhos.length > 0;

  const registrarTools = async (paiId: string | null, passos: PassoLoop[]) => {
    for (const p of passos) {
      await registrarSeguro(
        { pai_id: paiId, agente: p.nome, tipo: 'tool', entrada: json(p.args), saida: json(p.retorno), erro: p.erro, duracao_ms: p.duracao_ms },
        true,
      );
    }
  };

  async function rodarEspecialista(
    dimensao: DimensaoMerito,
    paiId: string | null,
    rodada: number,
    outros?: JulgamentoMerito[],
    replicaDoCetico?: string | null,
  ): Promise<JulgamentoMerito> {
    const ini = Date.now();
    const prompt = buildPromptMerito({ dimensao, dossieTexto, vizinhos: vizinhosMerito, ferramentasTexto, outrosJulgamentos: outros, replicaDoCetico });
    const loop = await loopComFerramentas({ chamarLlm: chamar('especialista'), mensagensIniciais: prompt, executar: args.executar, maxChamadas: maxTools });
    let julgamento: JulgamentoMerito | null = null;
    let erro: string | null = null;
    if (loop.motivo_fim === 'concluiu') julgamento = normalizarJulgamentoMerito(loop.resultado, dimensao);
    if (!julgamento) {
      erro = `especialista ${dimensao}: ${loop.motivo_fim === 'concluiu' ? 'saída inválida' : loop.motivo_fim}`;
      erros.push(erro);
      julgamento = julgamentoFallback(dimensao, erro);
    }
    const noId = await registrarSeguro(
      {
        pai_id: paiId,
        agente: `especialista-${dimensao}`,
        tipo: 'especialista',
        rodada,
        entrada: `dimensão ${dimensao}${outros ? ' (réplica)' : ''}`,
        saida: json(julgamento),
        tools_chamadas: loop.passos.map((p) => ({ nome: p.nome, args: p.args, retorno: p.retorno, erro: p.erro })),
        veredito: julgamento.fallback ? 'fallback' : julgamento.preocupa ? 'preocupa' : 'ok',
        erro,
        duracao_ms: Date.now() - ini,
      },
      true,
    );
    await registrarTools(noId, loop.passos);
    return julgamento;
  }

  async function rodarRodada(paiId: string | null, rodada: number, outros?: JulgamentoMerito[], replicaDoCetico?: string | null) {
    return Promise.all(DIMENSOES_MERITO.map((d) => rodarEspecialista(d, paiId, rodada, outros, replicaDoCetico)));
  }

  async function rodarCetico(julgamentos: JulgamentoMerito[], estrela: SaidaEstrela, paiId: string | null, rodada: number): Promise<ResultadoCetico> {
    const ini = Date.now();
    let cet: ResultadoCetico | null = null;
    let erro: string | null = null;
    try {
      const raw = await chamar('cetico')(buildPromptCetico({ dossieTexto, julgamentos, estrela }));
      cet = normalizarCetico(extrairJsonSeguro(raw));
      if (!cet) erro = 'cético: saída inválida';
    } catch (e) {
      erro = `cético: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!cet) {
      erros.push(erro ?? 'cético: falhou');
      cet = ceticoFallback();
    }
    await registrarSeguro(
      { pai_id: paiId, agente: 'cetico', tipo: 'cetico', rodada, saida: json(cet), veredito: cet.fallback ? 'fallback' : cet.refuta ? 'refuta' : 'aceita', erro, duracao_ms: Date.now() - ini },
      true,
    );
    return cet;
  }

  // ── rodada 1 ──
  let julgamentos = await rodarRodada(raizId, 1);

  // ── cérebro B ──
  let estrela: SaidaEstrela;
  {
    const ini = Date.now();
    const prompt = buildPromptEstrela({ dossieTexto, vizinhos: vizinhosEstrela, ferramentasTexto });
    const loop = await loopComFerramentas({ chamarLlm: chamar('estrela'), mensagensIniciais: prompt, executar: args.executar, maxChamadas: maxTools });
    const ctx = { temVizinhos, notaHumana: args.notaHumana };
    let erro: string | null = null;
    let saida: SaidaEstrela | null = null;
    if (loop.motivo_fim === 'concluiu') saida = normalizarSaidaEstrela(loop.resultado, ctx);
    if (!saida) {
      erro = `estrela: ${loop.motivo_fim === 'concluiu' ? 'saída inválida' : loop.motivo_fim}`;
      erros.push(erro);
      saida = saidaEstrelaFallback(erro, ctx);
    }
    estrela = saida;
    const noId = await registrarSeguro(
      {
        pai_id: raizId,
        agente: 'cerebro-estrela',
        tipo: 'cerebro',
        rodada: 1,
        saida: json(estrela),
        tools_chamadas: loop.passos.map((p) => ({ nome: p.nome, args: p.args, retorno: p.retorno, erro: p.erro })),
        veredito: `${estrela.nota}`,
        erro,
        duracao_ms: Date.now() - ini,
      },
      true,
    );
    await registrarTools(noId, loop.passos);
  }

  // ── consolida + cético (+ réplica com teto) ──
  let merito = consolidarMerito(julgamentos, { temVizinhos });
  let cetico = await rodarCetico(julgamentos, estrela, raizId, 1);
  let rodadas = 1;
  while (cetico.refuta && merito.veredito === 'aprovar' && rodadas < MAX_RODADAS_DEBATE) {
    rodadas++;
    const debateId = await registrarSeguro(
      { pai_id: raizId, agente: 'debate', tipo: 'debate', rodada: rodadas, entrada: `réplica ao cético: ${cetico.motivo ?? 'sem motivo'}` },
      true,
    );
    julgamentos = await rodarRodada(debateId, rodadas, julgamentos, cetico.motivo ?? 'refutou sem motivo nomeado');
    merito = consolidarMerito(julgamentos, { temVizinhos });
    cetico = await rodarCetico(julgamentos, estrela, debateId, rodadas);
  }
  const debateFechou = !(cetico.refuta && merito.veredito === 'aprovar');

  // ── consenso ──
  const consenso = conciliar(merito, estrela, { debateFechou, ceticoRefuta: cetico.refuta, liberacao: args.liberacao });
  await registrarSeguro(
    { pai_id: raizId, agente: 'consenso', tipo: 'consenso', rodada: rodadas, saida: json(consenso), veredito: consenso.saida, confianca: consenso.confianca, duracao_ms: Date.now() - t0 },
    true,
  );

  // ── textos ──
  const projeto = { id: dossie.id, nome: dossie.nome };
  const interno = textoJustificativaInterna({ projeto, consenso, merito, estrela });
  const ao_autor = consenso.saida === 'ajuste' ? textoAoAutor({ projeto, consenso, merito }) : null;
  const comite =
    consenso.saida === 'humano'
      ? dossieDeComite({
          projeto,
          consenso,
          merito,
          estrela,
          pares: vizinhos.filter((v) => typeof v.nota === 'number' && (v.nota as number) >= 6).map((v) => ({ nome: v.nome, nota: v.nota as number, resumo: v.resumo })),
          resumoProjeto: dossie.descricao ?? dossie.documentacao.o_que_faz ?? dossie.nome,
        })
      : null;

  return {
    projeto_id: dossie.id,
    merito,
    estrela,
    cetico,
    consenso,
    rodadas_debate: rodadas,
    debate_fechou: debateFechou,
    textos: { interno, ao_autor, comite },
    chamadas_llm: chamadas,
    erros,
    log: { raiz_id: raizId, nos },
  };
}
