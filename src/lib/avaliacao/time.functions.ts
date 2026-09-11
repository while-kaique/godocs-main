// Lado SERVER do time de avaliação (T15/T20): carrega o dossiê, monta as dependências reais (LLM por
// papel, executor de ferramentas, registrador do log em árvore) e roda `avaliarComTime`. NUNCA lança.
//
// ⚠️ Roteamento de modelo é OPT-IN por env e lido em RUNTIME (nunca em escopo de módulo): sem env,
// `model`/`reasoningEffort` ficam undefined e `llmChat` cai no `LLM_MODEL` de sempre — byte-idêntico.
// `minimal` fica fora da allowlist (o gateway devolve 502). Liberação em SOMBRA: sem acurácia medida,
// nenhuma saída age sozinha (D14).
import { carregarDossie } from '@/lib/avaliacao/dossie.functions';
import { avaliarComTime, NOTA_MIN_ANCORA_COMITE, type AncoraComite, type Executor, type VizinhoTime, type ResultadoTime, type Papel } from '@/lib/avaliacao/time';
import { abrirCiclo, fecharCiclo, registrarNoAgente } from '@/lib/agentes-log.functions';
import { llmChat } from '@/lib/llm';
import { getCargoDe } from '@/lib/areas/teamguide.server';
import { lerResumosEspelho } from '@/lib/sheet-espelho';
import { politicaDeLiberacao } from '@/lib/avaliacao/consenso';
import { carregarAcuraciaMedida } from '@/lib/avaliacao-calibragem.functions';
import { buscarDuplicataNaLista, checarPlausibilidadeHoras, calcularImpactoBasico } from '@/lib/avaliacao/ferramentas';
import { numero, texto, type Dossie } from '@/lib/avaliacao/dossie';
import type { Mensagem } from '@/lib/avaliacao/ferramentas';
import { cosseno } from '@/lib/embeddings';
import { garantirEmbeddings, carregarEmbeddingsBase } from '@/lib/avaliacao-normais.functions';
import { mapResumo, type ProjetoDashboardResumo } from '@/lib/dashboard-resumo';
import { chaveProjeto } from '@/lib/projeto-chave';

export type OpcoesTime = {
  cicloId?: string | null;
  gatilho?: string;
  liberacao?: { liberarAprovar?: boolean; liberarAjuste?: boolean };
};

export { modelosDoTime } from '@/lib/avaliacao/modelos';
import { modelosDoTime } from '@/lib/avaliacao/modelos';

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
      case 'ler_evidencia': {
        // O texto dos docs do Drive já está no dossiê (11/09/2026); a ferramenta devolve o que há.
        const link = typeof a.link === 'string' ? a.link : null;
        const doc = dossie.docs_drive.find((d) => !link || d.link === link || d.link.includes(link)) ?? dossie.docs_drive[0] ?? null;
        if (doc?.texto) return { link: doc.link, nome: doc.nome, texto: doc.texto, aviso: doc.aviso };
        return { link: link ?? null, texto: null, aviso: doc?.aviso ?? 'nenhum documento de texto legível no Drive para este projeto' };
      }
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

/** Piso de similaridade e K dos vizinhos por embedding do time (mesma régua do corpus da mesa). */
export const PISO_SIM_TIME = 0.2;
export const K_VIZINHOS_TIME = 8;

/** Uma linha do espelho reduzida ao que o vizinho precisa carregar. PURA. */
export function linhaParaVizinhoBase(r: LinhaEsp): { id: string; nome: string; status: string | null; nota: number | null; impacto: number | null; descricao: string } | null {
  const id = g(r, 'ID Projeto');
  if (!id) return null;
  const status = g(r, 'Status');
  if (/descontinuad/i.test(status ?? '')) return null;
  const notaCrua = numero(g(r, 'Estrelas'));
  const nota = notaCrua !== null && notaCrua >= 1 ? notaCrua : null;
  const decidido = /^(aprovad|reprovad)/i.test(status ?? '') || nota !== null;
  if (!decidido) return null;
  return {
    id,
    nome: g(r, 'Projeto') ?? id,
    status,
    nota,
    impacto: numero(g(r, 'Impacto Líquido Mensal')) ?? numero(g(r, 'Impacto Líquido')),
    descricao: g(r, 'Descrição') ?? '',
  };
}

/** Resumo do vizinho como o agente lê: TAMANHO na frente, depois o que faz. PURA. */
export function resumoDeVizinho(v: { status: string | null; impacto: number | null; descricao: string }): string {
  const tam = v.impacto !== null ? `impacto líquido mensal R$ ${v.impacto.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` : 'sem impacto declarado';
  return `[${v.status ?? 'sem status'} · ${tam}] ${v.descricao.slice(0, 180)}`;
}

/**
 * Vizinhos do time por EMBEDDING sobre a BASE INTEIRA decidida por gente (11/09/2026).
 *
 * ⚠️ Substitui `vizinhosLexicais` como caminho principal. O lexical (sobreposição de palavras em
 * nome+descrição) devolvia "sem vizinho" com frequência, e sem vizinho a confiança caía para baixa
 * por construção — foi a raiz de metade dos `humano`/`ajuste` do retroativo. Aqui a fonte é a
 * MESMA tabela que a mesa usa (`projeto_embedding`): um espaço vetorial, dois consumidores. O
 * cosseno é em JS (750 × 3072 é barato); Pinecone segue sendo do classificador.
 * ⚠️ Cada vizinho carrega o TAMANHO (impacto v2) no resumo: é o que o dono do produto pediu —
 * "esse projeto faz isso e move X" — para o agente posicionar por comparação, não só por função.
 * ⚠️ Nunca lança. Sem vetor do alvo (chave sem embedding, geração falhou) devolve `[]` e o
 * chamador cai no lexical.
 */
export async function vizinhosPorEmbedding(dossie: Dossie, linhas: LinhaEsp[]): Promise<VizinhoTime[]> {
  try {
    const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
    const resumoPorId = new Map(resumos.map((p) => [chaveProjeto(p.id), p]));
    const alvoId = chaveProjeto(dossie.id);
    let mapa = await carregarEmbeddingsBase();
    // Só o ALVO é garantido aqui (cap 1); a base é papel do backfill (`backfillEmbeddingsBase`).
    mapa = (await garantirEmbeddings([alvoId], resumoPorId, mapa, { capGeracao: 1 })).mapa;
    const alvo = mapa.get(alvoId)?.vetor ?? mapa.get(dossie.id)?.vetor;
    if (!alvo) return [];
    const out: VizinhoTime[] = [];
    for (const r of linhas) {
      const v = linhaParaVizinhoBase(r);
      if (!v || chaveProjeto(v.id) === alvoId) continue;
      const vetor = mapa.get(chaveProjeto(v.id))?.vetor ?? mapa.get(v.id)?.vetor;
      if (!vetor) continue;
      const sim = cosseno(alvo, vetor);
      if (!Number.isFinite(sim) || sim < PISO_SIM_TIME) continue;
      out.push({ id: v.id, nome: v.nome, nota: v.nota, status: v.status, similaridade: Number(sim.toFixed(2)), resumo: resumoDeVizinho(v) });
    }
    return out.sort((a, b) => b.similaridade - a.similaridade).slice(0, K_VIZINHOS_TIME);
  } catch {
    return [];
  }
}

/** Soma do `Impacto Líquido Mensal` dos APROVADOS — o denominador REAL do 2º eixo. PURA. */
export function totalImpactoAprovados(linhas: LinhaEsp[]): number | null {
  let total = 0;
  let n = 0;
  for (const r of linhas) {
    if (!/^aprovad/i.test(g(r, 'Status') ?? '')) continue;
    const v = numero(g(r, 'Impacto Líquido Mensal')) ?? numero(g(r, 'Impacto Líquido'));
    if (v !== null && v > 0) { total += v; n++; }
  }
  return n > 0 ? total : null;
}

/** Âncoras congeladas da faixa 6–10: todo projeto da base com nota HUMANA ≥ 6 (D9). */
function ancorasDe(linhas: LinhaEsp[]): AncoraComite[] {
  return linhas
    .map((r) => ({ nome: g(r, 'Projeto') ?? '', nota: numero(g(r, 'Estrelas')) ?? 0, resumo: (g(r, 'Descrição') ?? '').slice(0, 220), status: g(r, 'Status') }))
    .filter((a) => a.nome && a.nota >= NOTA_MIN_ANCORA_COMITE && !/descontinuad/i.test(a.status ?? ''))
    .map(({ nome, nota, resumo }) => ({ nome, nota, resumo }));
}

function candidatosDe(linhas: LinhaEsp[]) {
  return linhas
    .filter((r) => g(r, 'ID Projeto'))
    .map((r) => ({ id: g(r, 'ID Projeto')!, nome: g(r, 'Projeto') ?? '', saving_reais: numero(g(r, 'Saving Reais')), receita_mensal: numero(g(r, 'Receita Mensal')), status: g(r, 'Status') }));
}

/**
 * A réplica do mérito está desligada? Env lida em RUNTIME (nunca em escopo de módulo).
 * ⚠️ Motivo em `avaliarComTime.maxRodadasDebate`: é teto de infraestrutura (300 s do edge), não
 * opinião sobre a qualidade do debate.
 */
export function debateDoTimeDesligado(): boolean {
  const v = String(process.env.TIME_SEM_REPLICA ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'sim' || v === 'on';
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
  // Embedding primeiro (base inteira, com tamanho); lexical só como rede quando o alvo não tem vetor.
  const porEmbedding = await vizinhosPorEmbedding(dossie, linhas);
  const vizinhos = porEmbedding.length ? porEmbedding : vizinhosLexicais(dossie, linhas);
  const totalBaseImpacto = totalImpactoAprovados(linhas);
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

  // A política recebe a acurácia MEDIDA (T13/RF-242). ⚠️ Era `null` literal: a política existia
  // para ler medição e nunca recebia nenhuma, então o time ficava em sombra por argumento
  // hardcoded. Com o número real ela passa a dizer QUAL meta faltou — e as flags de liberação
  // seguem desligadas, então `age_sozinho` continua `false` (fronteira do plano).
  const liberacao = politicaDeLiberacao(await carregarAcuraciaMedida(), opts.liberacao ?? {});
  try {
    const resultado = await avaliarComTime({
      dossie,
      vizinhos,
      notaHumana: dossie.triagem.estrelas !== null && dossie.triagem.estrelas >= 1 ? dossie.triagem.estrelas : null,
      chamarLlm,
      executar,
      registrar: registrar as never,
      liberacao,
      ancoras: ancorasDe(linhas),
      totalBaseImpacto,
      // ⚠️ Env em RUNTIME, DEFAULT desligado (sem ela o teto é o de sempre). Ligada, desliga a
      // réplica do mérito, que é o que faz a passada caber nos 300 s do edge.
      // ⚠️ **PASSADA CURTA — é teto de INFRAESTRUTURA (300 s do edge), medido hoje.** O gargalo é
      // PROFUNDIDADE em série, não volume: 5 especialistas (com até 2 rodadas de ferramenta cada,
      // ou seja 3 chamadas em série) → cérebro da estrela (mais 3) → 2 céticos. Cortar os elos que
      // o FUNIL não usa mais:
      //   • a réplica do mérito (o mérito é da mesa desde a junta);
      //   • a 2ª rodada de ferramenta por agente (1 basta: a ferramenta é consulta, não conversa).
      // ⚠️ Isto NÃO mexe no que o dono do produto pediu: o cérebro da estrela continua lendo o
      // painel do impacto, e a nota continua saindo do time inteiro.
      ...(debateDoTimeDesligado() ? { maxRodadasDebate: 1, ferramentasPorAgente: 1 } : {}),
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
