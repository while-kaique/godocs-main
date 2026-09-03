// RODADA do retroativo em SOMBRA (T19). Nada é escrito em prod, planilha ou SQLite real: o time roda
// sobre o dump da planilha, o log em árvore vai para um SQLite EM MEMÓRIA (o schema real, via
// initSchema) e sai como JSON, e o relatório vai para docs/plans/retro-rodadas/.
//
// Envs: RETRO_IN (corpus JSON do dump) · RETRO_N (tamanho da amostra; 0 = base inteira) · RETRO_SEED ·
// RETRO_MODEL_LEVE (especialistas; default gpt-5.6-luna) · RETRO_MODEL_FORTE (estrela e cético;
// default gpt-5.6-sol) · RETRO_CONC (concorrência, default 4) · RETRO_CICLO (nome) · RETRO_VARIANTE
// (rótulo livre do que mudou no prompt nesta rodada) · RETRO_IDS (lista de ids separados por vírgula
// para rodar só esses) · RETRO_TETO_USD (para quando o custo estimado passa disso).
import fs from 'node:fs';
import path from 'node:path';
import { it, expect } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SCRATCH = path.dirname(process.env.RETRO_IN ?? '/tmp/x');
const IN = process.env.RETRO_IN ?? '/tmp/retro-corpus-full.json';
const N = Number(process.env.RETRO_N ?? 30);
const SEED = Number(process.env.RETRO_SEED ?? 7);
const MODEL_LEVE = process.env.RETRO_MODEL_LEVE ?? 'gpt-5.6-luna';
const MODEL_FORTE = process.env.RETRO_MODEL_FORTE ?? 'gpt-5.6-sol';
const CONC = Number(process.env.RETRO_CONC ?? 4);
const VARIANTE = process.env.RETRO_VARIANTE ?? null;
const IDS = (process.env.RETRO_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TETO_USD = Number(process.env.RETRO_TETO_USD ?? 60);
const KEY = process.env.LLM_FALLBACK ?? process.env.LLM_API_KEY!;
const OUT_DIR = path.resolve(__dirname, '../../docs/plans/retro-rodadas');

// Preços ESTIMADOS por 1M tokens (in/out) — só para o teto de gasto; ajuste por env se souber o real.
const PRECO: Record<string, [number, number]> = {
  'gpt-5.6-luna': [Number(process.env.PRECO_LUNA_IN ?? 0.5), Number(process.env.PRECO_LUNA_OUT ?? 2)],
  'gpt-5.6-sol': [Number(process.env.PRECO_SOL_IN ?? 2.5), Number(process.env.PRECO_SOL_OUT ?? 10)],
  'gpt-5.4-mini': [0.4, 1.6],
};

type Row = Record<string, string>;
const g = (r: Row, k: string) => String(r[k] ?? '').trim();
const numPt = (s: string): number | null => {
  let t = s.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (!t || t === '—') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

it('retroativo em sombra — time de agentes sobre a base de prod', async () => {
  const { dossieDaLinhaPlanilha, dossieParaTexto } = await import('@/lib/avaliacao/dossie');
  const { avaliarComTime } = await import('@/lib/avaliacao/time');
  const { politicaDeLiberacao } = await import('@/lib/avaliacao/consenso');
  const { checarPlausibilidadeHoras, calcularImpactoBasico, buscarDuplicataNaLista } = await import('@/lib/avaliacao/ferramentas');
  const { classificarGabarito, compararProjeto, agregarRetroativo, amostrarEstratificado, relatorioParaMarkdown } = await import('@/lib/avaliacao/retroativo');
  const { gerarEmbeddingsLote, cosseno } = await import('@/lib/embeddings');
  const { criarDbMemoria } = await import('../../tests/helpers/db-memoria');
  const { abrirCiclo, fecharCiclo, registrarNoAgente } = await import('@/lib/agentes-log.functions');

  const rows: Row[] = JSON.parse(fs.readFileSync(IN, 'utf8'));
  console.log(`\ncorpus: ${rows.length} linhas · leve=${MODEL_LEVE} · forte=${MODEL_FORTE} · conc=${CONC}`);

  // ── gabarito + amostra ──
  const gabaritos = rows.map((r) => ({
    id: g(r, 'ID Projeto'),
    nome: g(r, 'Projeto'),
    area: g(r, 'Área') || null,
    especial: /^sim$/i.test(g(r, 'Especial?')),
    nota_humana: g(r, 'Estrelas') === '' ? null : numPt(g(r, 'Estrelas')),
    status: g(r, 'Status') || null,
    data_submissao: g(r, 'Data Submissão') || null,
    descontinuado: /descontinuad/i.test(g(r, 'Status')),
  }));
  const porId = new Map(rows.map((r) => [g(r, 'ID Projeto'), r]));
  const gabPorId = new Map(gabaritos.map((x) => [x.id, x]));
  const amostra = IDS.length
    ? gabaritos.filter((x) => IDS.includes(x.id))
    : amostrarEstratificado(gabaritos, { tamanho: N > 0 ? N : gabaritos.length, seed: SEED });
  console.log(`amostra: ${amostra.length} · gabarito: ${JSON.stringify(contar(amostra.map(classificarGabarito)))}`);

  // ── embeddings (cache) para os vizinhos ──
  const textoEmb = (r: Row) =>
    [
      `Projeto: ${g(r, 'Projeto')}`,
      `Descrição: ${g(r, 'Descrição')}`,
      g(r, 'Contexto do Projeto Especial') && g(r, 'Contexto do Projeto Especial') !== '—' ? `Por que é especial: ${g(r, 'Contexto do Projeto Especial')}` : '',
      `Memorial: ${g(r, 'Memorial de Saving').slice(0, 1500)}`,
      g(r, 'Receita Memorial') && g(r, 'Receita Memorial') !== '—' ? `Receita: ${g(r, 'Receita Memorial').slice(0, 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  const cachePath = path.join(SCRATCH, 'retro-embeddings.json');
  const cache: Record<string, number[]> = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  const faltam = rows.filter((r) => !cache[g(r, 'ID Projeto')]);
  if (faltam.length) {
    console.log(`embeddings a gerar: ${faltam.length}`);
    for (let i = 0; i < faltam.length; i += 64) {
      const lote = faltam.slice(i, i + 64);
      const embs = await gerarEmbeddingsLote(lote.map(textoEmb), { apiKey: KEY, modelo: process.env.LLM_EMBEDDINGS_MODEL ?? 'text-embedding-3-large' });
      lote.forEach((r, k) => { if (embs[k]) cache[g(r, 'ID Projeto')] = embs[k]!.vetor; });
      fs.writeFileSync(cachePath, JSON.stringify(cache));
    }
  }
  const referencia = gabaritos.filter((x) => !x.descontinuado && (classificarGabarito(x) === 'nota_humana' || classificarGabarito(x) === 'status_assentado') && cache[x.id]);
  const vizinhosDe = (id: string) => {
    const v = cache[id];
    if (!v) return [];
    return referencia
      .filter((x) => x.id !== id)
      .map((x) => ({ x, sim: cosseno(v, cache[x.id]) }))
      .filter((p) => p.sim >= 0.2)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 6)
      .map((p) => ({
        id: p.x.id,
        nome: p.x.nome,
        nota: typeof p.x.nota_humana === 'number' && p.x.nota_humana >= 1 ? p.x.nota_humana : null,
        status: p.x.status,
        similaridade: Number(p.sim.toFixed(3)),
        resumo: (g(porId.get(p.x.id)!, 'Descrição') || g(porId.get(p.x.id)!, 'Projeto')).slice(0, 220),
      }));
  };

  // ── LLM direto na OpenAI, modelo por papel, tokens contados ──
  const tokens: Record<string, { in: number; out: number }> = {};
  let custoUsd = 0;
  async function chamarLlm(mensagens: { role: string; content: string }[], papel: 'especialista' | 'estrela' | 'cetico'): Promise<string> {
    const model = papel === 'especialista' ? MODEL_LEVE : MODEL_FORTE;
    const body: Record<string, unknown> = { model, messages: mensagens, response_format: { type: 'json_object' } };
    let ultimoErro = '';
    for (let t = 0; t < 3; t++) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240_000),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
      if (!r.ok) {
        ultimoErro = `${r.status} ${(await r.text()).slice(0, 200)}`;
        if (r.status === 400 && /unsupported|not supported|response_format/i.test(ultimoErro)) delete body.response_format;
        await new Promise((s) => setTimeout(s, 1500 * (t + 1)));
        continue;
      }
      const j = await r.json();
      const u = j.usage ?? {};
      tokens[model] ??= { in: 0, out: 0 };
      tokens[model].in += u.prompt_tokens ?? 0;
      tokens[model].out += u.completion_tokens ?? 0;
      const [pi, po] = PRECO[model] ?? [1, 4];
      custoUsd += ((u.prompt_tokens ?? 0) * pi + (u.completion_tokens ?? 0) * po) / 1e6;
      return j.choices?.[0]?.message?.content ?? '';
    }
    throw new Error(`OpenAI ${model}: ${ultimoErro}`);
  }

  // ── log em árvore num SQLite EM MEMÓRIA (schema real) ──
  const db = await criarDbMemoria();
  const cicloNome = process.env.RETRO_CICLO ?? `r-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}-n${amostra.length}`;
  const cicloId = await abrirCiclo({ gatilho: 'retroativo', amostra: { n: amostra.length, seed: SEED, ids: amostra.map((a) => a.id) }, modelos: { leve: MODEL_LEVE, forte: MODEL_FORTE }, variante: VARIANTE });
  expect(cicloId).toBeTruthy();

  const liberacao = politicaDeLiberacao(null, {});
  const resultados: Record<string, unknown>[] = [];
  const comparacoes: ReturnType<typeof compararProjeto>[] = [];
  let feitos = 0;
  const t0 = Date.now();

  async function umProjeto(gab: (typeof gabaritos)[number]) {
    const row = porId.get(gab.id)!;
    const dossie = dossieDaLinhaPlanilha(row);
    if (!dossie) return;
    const vizinhos = vizinhosDe(gab.id);
    const todos = gabaritos.map((x) => ({ id: x.id, nome: x.nome, saving_reais: numPt(g(porId.get(x.id)!, 'Saving Reais')), receita_mensal: numPt(g(porId.get(x.id)!, 'Receita Mensal')), status: x.status }));
    const executar = async (nome: string, a: Record<string, unknown>) => {
      switch (nome) {
        case 'consultar_vizinhos': return vizinhos.slice(0, Number(a.k ?? 6));
        case 'consultar_cargo': return { cargo: null, aviso: 'TeamGuide indisponível no retroativo offline; julgue pelo dossiê.' };
        case 'historico_versoes': return { versoes: dossie.historico.versoes, atualizado_em: dossie.submissao.atualizado_em, aviso: 'retroativo offline: só a planilha' };
        case 'buscar_duplicata': return buscarDuplicataNaLista({ id: gab.id, nome: String(a.nome ?? gab.nome) }, todos);
        case 'checar_plausibilidade_horas': {
          const linhas = Array.isArray(a.linhas) && a.linhas.length ? (a.linhas as never[]) : dossie.financeiro.saving_horas !== null ? [{ cargo: '(total declarado na planilha)', horas_antes: dossie.financeiro.saving_horas, horas_depois: 0 }] : [];
          return checarPlausibilidadeHoras({ linhas, tipo_saving: (a.tipo_saving as string) ?? dossie.financeiro.tipo_saving });
        }
        case 'calcular_impacto': return calcularImpactoBasico({ saving_reais: (a.saving_reais as number) ?? dossie.financeiro.saving_reais, custo_evitado_reais: (a.custo_evitado_reais as number) ?? dossie.financeiro.custo_evitado_reais, custo_externo_mensal: (a.custo_externo_mensal as number) ?? dossie.financeiro.custo_externo_mensal, custo_projeto_mensal: (a.custo_projeto_mensal as number) ?? null, receita_mensal: (a.receita_mensal as number) ?? dossie.financeiro.receita_mensal });
        case 'ler_evidencia': return { link: a.link ?? null, texto: null, aviso: 'o texto do anexo não é persistido; só o link existe' };
        default: throw new Error(`ferramenta desconhecida ${nome}`);
      }
    };
    const registrar = async (no: Parameters<typeof registrarNoAgente>[0] extends infer T ? Omit<T, 'ciclo_id' | 'projeto_id'> : never) => {
      const r = await registrarNoAgente({ ...(no as object), ciclo_id: cicloId!, projeto_id: gab.id } as Parameters<typeof registrarNoAgente>[0]);
      return r?.id ?? null;
    };
    const ini = Date.now();
    const res = await avaliarComTime({ dossie, vizinhos, notaHumana: gab.nota_humana !== null && gab.nota_humana >= 1 ? gab.nota_humana : null, chamarLlm, executar, registrar, liberacao });
    const comp = compararProjeto(
      { id: gab.id, nome: gab.nome, area: gab.area, especial: gab.especial, saida: res.consenso.saida, veredito_merito: res.consenso.veredito_merito, estrela: res.consenso.estrela, escape: res.consenso.escape, confianca: res.consenso.confianca, valor_absurdo: res.consenso.valor?.absurdo ?? null, valor_sugerido: res.consenso.valor?.valor_sugerido ?? null, contestacao: res.consenso.contestacao, erros: res.erros.length, custo_usd: 0 },
      gab,
    );
    comparacoes.push(comp);
    resultados.push({ ...comp, veredito_merito: res.merito.veredito, criterio: res.estrela.criterio_aplicado, desqualificador: res.estrela.desqualificador, evidencias: res.estrela.evidencias, racional_estrela: res.estrela.racional, preocupacoes: res.merito.preocupacoes, perguntas: res.consenso.perguntas_ao_autor, motivos: res.consenso.motivos, divergencias: res.consenso.divergencias, cetico: res.cetico, rodadas: res.rodadas_debate, chamadas_llm: res.chamadas_llm, erros: res.erros, textos: res.textos, duracao_ms: Date.now() - ini, vizinhos: vizinhos.map((v) => `${v.nome} (${v.nota ?? '-'}★, ${v.status ?? '-'}, ${v.similaridade})`) });
    feitos++;
    console.log(`[${feitos}/${amostra.length}] ${gab.nome.slice(0, 40).padEnd(40)} humano=${gab.status ?? '-'}/${gab.nota_humana ?? '-'}★ → time=${res.consenso.saida}/${res.consenso.estrela}★ (${res.consenso.confianca}) mérito=${comp.merito} llm=${res.chamadas_llm} erros=${res.erros.length} · $${custoUsd.toFixed(2)}`);
    if (custoUsd > TETO_USD) throw new Error(`teto de gasto ${TETO_USD} USD atingido`);
  }

  // concorrência limitada
  const fila = [...amostra];
  await Promise.all(Array.from({ length: CONC }, async () => { while (fila.length) { const gab = fila.shift()!; try { await umProjeto(gab); } catch (e) { console.error(`ERRO ${gab.id}: ${e instanceof Error ? e.message : e}`); if (String(e).includes('teto de gasto')) fila.length = 0; } } }));

  // ── relatório ──
  const rel = agregarRetroativo(comparacoes);
  const meta = { ciclo: cicloNome, amostra: amostra.length, modelo: `${MODEL_LEVE} (especialistas) + ${MODEL_FORTE} (estrela, cético)`, variante: VARIANTE };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = [relatorioParaMarkdown(rel, meta), '', `Custo estimado: ${custoUsd.toFixed(2)} USD. Tokens: ${JSON.stringify(tokens)}. Duração: ${((Date.now() - t0) / 60000).toFixed(1)} min.`, '', '## Projetos', '| Projeto | Área | Esp | Humano | Time | Estrela H | Estrela T | Conf | Mérito |', '|---|---|---|---|---|---|---|---|---|', ...comparacoes.map((c) => `| ${c.nome.slice(0, 40)} | ${c.area ?? ''} | ${c.especial ? 'sim' : ''} | ${gabPorId.get(c.id)?.status ?? ''} | ${c.saida} | ${c.estrela.humana ?? ''} | ${c.estrela.time} | ${c.confianca} | ${c.merito} |`)].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, `${cicloNome}.md`), md);
  fs.writeFileSync(path.join(OUT_DIR, `${cicloNome}.json`), JSON.stringify({ meta, relatorio: rel, custoUsd, tokens, resultados }, null, 1));
  const logRows = db.prepare('SELECT * FROM agente_log ORDER BY created_at, id').all();
  fs.writeFileSync(path.join(OUT_DIR, `${cicloNome}-log.json`), JSON.stringify(logRows));
  await fecharCiclo(cicloId!, { status: 'concluido', metricas: { merito: rel.merito, saidas: rel.saidas, estrelas: rel.estrelas, custoUsd }, relatorio_path: `docs/plans/retro-rodadas/${cicloNome}.md` });
  console.log(`\n${md.split('## Projetos')[0]}`);
  console.log(`nós de log: ${logRows.length} · relatório: docs/plans/retro-rodadas/${cicloNome}.md`);
});

function contar(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}
