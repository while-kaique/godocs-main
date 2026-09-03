// Lado SERVER do time de avaliação (T15/T20): carrega o dossiê, monta as dependências reais (LLM por
// papel, executor de ferramentas, registrador do log em árvore) e roda `avaliarComTime`. NUNCA lança.
//
// ⚠️ Roteamento de modelo é OPT-IN por env e lido em RUNTIME (nunca em escopo de módulo): sem env,
// `model`/`reasoningEffort` ficam undefined e `llmChat` cai no `LLM_MODEL` de sempre — byte-idêntico.
// `minimal` fica fora da allowlist (o gateway devolve 502). Liberação em SOMBRA: sem acurácia medida,
// nenhuma saída age sozinha (D14).
import { carregarDossie } from '@/lib/avaliacao/dossie.functions';
import { avaliarComTime, type Executor, type VizinhoTime, type ResultadoTime, type Papel } from '@/lib/avaliacao/time';
import { abrirCiclo, fecharCiclo, registrarNoAgente } from '@/lib/agentes-log.functions';
import { llmChat } from '@/lib/llm';
import { getCargoDe } from '@/lib/areas/teamguide.server';
import { lerResumosEspelho } from '@/lib/sheet-espelho';
import { politicaDeLiberacao } from '@/lib/avaliacao/consenso';
import { buscarDuplicataNaLista, checarPlausibilidadeHoras, calcularImpactoBasico } from '@/lib/avaliacao/ferramentas';
import { numero, texto, type Dossie } from '@/lib/avaliacao/dossie';
import type { Mensagem } from '@/lib/avaliacao/ferramentas';

export type OpcoesTime = {
  cicloId?: string | null;
  gatilho?: string;
  liberacao?: { liberarAprovar?: boolean; liberarAjuste?: boolean };
};

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function modelosDoTime(env?: Record<string, string | undefined>): {
  especialista: string | undefined;
  estrela: string | undefined;
  cetico: string | undefined;
  effortEspecialista: string | undefined;
} {
  const e = env ?? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {});
  const leve = e.AVALIACAO_MODELO_LEVE?.trim() || undefined;
  const forte = e.AVALIACAO_MODELO_FORTE?.trim() || undefined;
  const effortCru = e.AVALIACAO_REASONING_EFFORT_LEVE?.trim().toLowerCase() || '';
  return {
    especialista: leve,
    estrela: forte,
    cetico: forte,
    effortEspecialista: EFFORTS.has(effortCru) ? effortCru : undefined,
  };
}

export function executorPadrao(
  dossie: Dossie,
  deps: {
    getCargoDe: (email: string) => Promise<string | null>;
    listarCandidatosDuplicata: () => Promise<{ id: string; nome: string; saving_reais: number | null; receita_mensal: number | null; status: string | null }[]>;
    vizinhos: VizinhoTime[];
  },
): Executor {
  return async (nome, a) => {
    switch (nome) {
      case 'consultar_vizinhos': {
        const k = Number(a.k ?? 6);
        return deps.vizinhos.slice(0, Number.isFinite(k) && k > 0 ? k : 6);
      }
      case 'consultar_cargo': {
        const email = typeof a.email === 'string' && a.email.trim() ? a.email.trim() : dossie.autor.email ?? '';
        if (!email) return { cargo: null, erro: 'sem e-mail para consultar' };
        try {
          return { cargo: await deps.getCargoDe(email) };
        } catch (e) {
          return { cargo: null, erro: e instanceof Error ? e.message : String(e) };
        }
      }
      case 'historico_versoes':
        return dossie.historico;
      case 'buscar_duplicata': {
        const candidatos = await deps.listarCandidatosDuplicata();
        return buscarDuplicataNaLista({ id: dossie.id, nome: typeof a.nome === 'string' && a.nome.trim() ? a.nome : dossie.nome }, candidatos);
      }
      case 'checar_plausibilidade_horas': {
        const linhas =
          Array.isArray(a.linhas) && a.linhas.length
            ? (a.linhas as { cargo: string; horas_antes: number | null; horas_depois: number | null }[])
            : dossie.financeiro.linhas.length
              ? dossie.financeiro.linhas
              : dossie.financeiro.saving_horas !== null
                ? [{ cargo: '(total declarado)', horas_antes: dossie.financeiro.saving_horas, horas_depois: 0 }]
                : [];
        return checarPlausibilidadeHoras({ linhas, tipo_saving: (typeof a.tipo_saving === 'string' ? a.tipo_saving : null) ?? dossie.financeiro.tipo_saving });
      }
      case 'calcular_impacto': {
        const n = (v: unknown, fallback: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
        return calcularImpactoBasico({
          saving_reais: n(a.saving_reais, dossie.financeiro.saving_reais),
          custo_evitado_reais: n(a.custo_evitado_reais, dossie.financeiro.custo_evitado_reais),
          custo_externo_mensal: n(a.custo_externo_mensal, dossie.financeiro.custo_externo_mensal),
          custo_projeto_mensal: n(a.custo_projeto_mensal, null),
          receita_mensal: n(a.receita_mensal, dossie.financeiro.receita_mensal),
        });
      }
      case 'ler_evidencia':
        return { link: a.link ?? null, texto: null, aviso: 'o texto do anexo não é persistido pelo sistema; só o link existe' };
      default:
        throw new Error(`ferramenta desconhecida: ${String(nome)}`);
    }
  };
}

// ── vizinhos e candidatos a partir do ESPELHO (leitura só do SQLite, nunca do Sheets) ─────────────

type LinhaEsp = Record<string, string>;
const g = (r: LinhaEsp, k: string) => texto(r[k]);

function tokens(s: string): Set<string> {
  return new Set(
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4),
  );
}

/** Vizinhos por sobreposição lexical (nome + descrição) entre projetos já decididos por humanos. Best-effort; o RAG por embedding é a T3. */
function vizinhosLexicais(dossie: Dossie, linhas: LinhaEsp[]): VizinhoTime[] {
  const alvo = tokens(`${dossie.nome} ${dossie.descricao ?? ''}`);
  if (!alvo.size) return [];
  const out: VizinhoTime[] = [];
  for (const r of linhas) {
    const id = g(r, 'ID Projeto');
    if (!id || id === dossie.id) continue;
    const status = g(r, 'Status');
    const nota = numero(g(r, 'Estrelas'));
    const decidido = /^(aprovad|reprovad)/i.test(status ?? '') || (nota !== null && nota >= 1);
    if (!decidido || /descontinuad/i.test(status ?? '')) continue;
    const t = tokens(`${g(r, 'Projeto') ?? ''} ${g(r, 'Descrição') ?? ''}`);
    const inter = [...alvo].filter((x) => t.has(x)).length;
    const sim = inter / Math.max(1, Math.min(alvo.size, t.size));
    if (sim < 0.2) continue;
    out.push({ id, nome: g(r, 'Projeto') ?? id, nota: nota !== null && nota >= 1 ? nota : null, status, similaridade: Number(sim.toFixed(2)), resumo: (g(r, 'Descrição') ?? '').slice(0, 220) });
  }
  return out.sort((a, b) => b.similaridade - a.similaridade).slice(0, 6);
}

function candidatosDe(linhas: LinhaEsp[]) {
  return linhas
    .filter((r) => g(r, 'ID Projeto'))
    .map((r) => ({ id: g(r, 'ID Projeto')!, nome: g(r, 'Projeto') ?? '', saving_reais: numero(g(r, 'Saving Reais')), receita_mensal: numero(g(r, 'Receita Mensal')), status: g(r, 'Status') }));
}

export async function avaliarProjetoComTime(
  projetoId: string,
  opts: OpcoesTime = {},
): Promise<{ ok: true; ciclo_id: string | null; resultado: ResultadoTime } | { ok: false; motivo: string }> {
  let dossie: Dossie | null;
  try {
    dossie = await carregarDossie(projetoId);
  } catch (e) {
    return { ok: false, motivo: `dossiê de ${projetoId} não carregou: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!dossie) return { ok: false, motivo: `projeto ${projetoId} não encontrado (nem no banco, nem no espelho)` };

  let linhas: LinhaEsp[] = [];
  try {
    linhas = ((await lerResumosEspelho()).linhas ?? []) as LinhaEsp[];
  } catch {
    linhas = [];
  }
  const vizinhos = vizinhosLexicais(dossie, linhas);
  const executar = executorPadrao(dossie, { getCargoDe, listarCandidatosDuplicata: async () => candidatosDe(linhas), vizinhos });

  const abriuAqui = !opts.cicloId;
  let cicloId: string | null = opts.cicloId ?? null;
  if (abriuAqui) {
    try {
      cicloId = await abrirCiclo({ gatilho: opts.gatilho ?? 'avaliacao', amostra: { ids: [projetoId] }, modelos: modelosDoTime() as Record<string, string> });
    } catch {
      cicloId = null;
    }
  }

  const registrar = async (no: Parameters<typeof registrarNoAgente>[0] extends infer T ? Omit<T, 'ciclo_id' | 'projeto_id'> : never) => {
    if (!cicloId) return null;
    try {
      const r = await registrarNoAgente({ ...(no as object), ciclo_id: cicloId, projeto_id: projetoId } as Parameters<typeof registrarNoAgente>[0]);
      return r?.id ?? null;
    } catch {
      return null;
    }
  };

  const chamarLlm = async (mensagens: Mensagem[], papel: Papel): Promise<string> => {
    const m = modelosDoTime();
    const model = papel === 'especialista' ? m.especialista : papel === 'estrela' ? m.estrela : m.cetico;
    const reasoningEffort = papel === 'especialista' ? m.effortEspecialista : undefined;
    const o: { jsonMode: true; model?: string; reasoningEffort?: string } = { jsonMode: true };
    if (model) o.model = model;
    if (reasoningEffort) o.reasoningEffort = reasoningEffort;
    return llmChat(mensagens as never, o as never);
  };

  const liberacao = politicaDeLiberacao(null, opts.liberacao ?? {});
  try {
    const resultado = await avaliarComTime({
      dossie,
      vizinhos,
      notaHumana: dossie.triagem.estrelas !== null && dossie.triagem.estrelas >= 1 ? dossie.triagem.estrelas : null,
      chamarLlm,
      executar,
      registrar: registrar as never,
      liberacao,
    });
    if (abriuAqui && cicloId) {
      try {
        await fecharCiclo(cicloId, { status: 'concluido', metricas: { saida: resultado.consenso.saida, estrela: resultado.consenso.estrela, confianca: resultado.consenso.confianca, chamadas_llm: resultado.chamadas_llm, erros: resultado.erros.length } });
      } catch {
        /* auditoria não derruba o resultado */
      }
    }
    return { ok: true, ciclo_id: cicloId, resultado };
  } catch (e) {
    if (abriuAqui && cicloId) {
      try {
        await fecharCiclo(cicloId, { status: 'erro', metricas: { erro: e instanceof Error ? e.message : String(e) } });
      } catch {
        /* idem */
      }
    }
    return { ok: false, motivo: `o time falhou em ${projetoId}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
