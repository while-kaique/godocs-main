// Retroativo de 3 saídas + gabarito LIMPO (T18). Módulo PURO.
//
// Compara o que o time decidiu com o que os humanos decidiram — mérito × Status, estrela × nota,
// auditoria de valor — e agrega o relatório do ciclo. O gabarito é classificado ANTES de comparar:
// nota 0 gravada em mês em que a triagem parou (julho/2026, Achado 5 do §6.1) não é zero, é "ninguém
// olhou", e não entra em comparação nenhuma; descontinuado fica fora de tudo (D7). D12: queda em massa
// para o mesmo nível acusa a régua, não os projetos — o relatório emite o alerta de achatamento.
import { detectarAchatamento, conferirCalibragem } from '@/lib/estrelas-regua';
import type { AcuraciaMedida, MedicaoVeredito } from '@/lib/avaliacao/consenso';

export type LinhaGabarito = {
  id: string;
  nome: string;
  area: string | null;
  especial: boolean;
  nota_humana: number | null;
  status: string | null;
  data_submissao: string | null;
  descontinuado: boolean;
};

export type ConfiancaGabarito = 'nota_humana' | 'status_assentado' | 'nao_auditado' | 'fora';

/** Meses em que a triagem parou: nota 0 ali NÃO é zero, é "ninguém olhou". */
export const MESES_SEM_TRIAGEM = ['2026-07'];

function mesDe(data: string | null): string | null {
  if (!data) return null;
  const iso = data.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const br = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}`;
  return null;
}

function statusAssentado(status: string | null): 'aprovado' | 'reprovado' | null {
  const s = (status ?? '').trim().toLowerCase();
  if (s.startsWith('aprovad')) return 'aprovado';
  if (s.startsWith('reprovad')) return 'reprovado';
  return null;
}

export function classificarGabarito(l: LinhaGabarito): ConfiancaGabarito {
  if (l.descontinuado) return 'fora';
  if (typeof l.nota_humana === 'number' && l.nota_humana >= 1) return 'nota_humana';
  const mes = mesDe(l.data_submissao);
  if (mes && MESES_SEM_TRIAGEM.includes(mes)) return 'nao_auditado';
  if (statusAssentado(l.status)) return 'status_assentado';
  return 'nao_auditado';
}

export type ResultadoProjeto = {
  id: string;
  nome: string;
  area: string | null;
  especial: boolean;
  saida: 'aprovar' | 'ajuste' | 'humano';
  veredito_merito: 'aprovar' | 'ajuste' | 'humano';
  estrela: number;
  escape: boolean;
  confianca: 'alta' | 'media' | 'baixa';
  valor_absurdo: boolean | null;
  valor_sugerido: number | null;
  contestacao: unknown | null;
  erros: number;
  custo_usd: number;
};

export type Merito = 'acerto' | 'conservador' | 'erro_grave' | 'sem_base';

export type ComparacaoProjeto = {
  id: string;
  nome: string;
  area: string | null;
  especial: boolean;
  gabarito: ConfiancaGabarito;
  merito: Merito;
  estrela: { humana: number | null; time: number; distancia: number | null; dentro_de_1: boolean | null };
  escape: boolean;
  saida: ResultadoProjeto['saida'];
  confianca: ResultadoProjeto['confianca'];
  valor_absurdo: boolean | null;
  contestou: boolean;
};

export function compararProjeto(r: ResultadoProjeto, g: LinhaGabarito): ComparacaoProjeto {
  const gabarito = classificarGabarito(g);
  const confiavel = gabarito === 'nota_humana' || gabarito === 'status_assentado';
  const status = statusAssentado(g.status);
  let merito: Merito = 'sem_base';
  if (confiavel && status) {
    if (status === 'aprovado') merito = r.saida === 'aprovar' ? 'acerto' : 'conservador';
    else merito = r.saida === 'aprovar' ? 'erro_grave' : r.saida === 'ajuste' ? 'acerto' : 'conservador';
  }
  const humana = g.nota_humana;
  const comparavel = confiavel && typeof humana === 'number';
  const distancia = comparavel ? Math.abs(r.estrela - (humana as number)) : null;
  return {
    id: r.id,
    nome: r.nome,
    area: r.area,
    especial: r.especial,
    gabarito,
    merito,
    estrela: { humana, time: r.estrela, distancia, dentro_de_1: distancia === null ? null : distancia <= 1 },
    escape: r.escape,
    saida: r.saida,
    confianca: r.confianca,
    valor_absurdo: r.valor_absurdo,
    contestou: r.contestacao !== null && r.contestacao !== undefined,
  };
}

export type RelatorioRetroativo = {
  total: number;
  por_gabarito: Record<ConfiancaGabarito, number>;
  merito: { acerto: number; conservador: number; erro_grave: number; sem_base: number; acuracia: number | null };
  acuracia_por_veredito: AcuraciaMedida;
  estrelas: {
    distribuicao_time: Record<string, number>;
    distribuicao_humana: Record<string, number>;
    escape: number;
    exato: number | null;
    dentro_de_1: number | null;
    vies: number | null;
    n_comparaveis: number;
  };
  achatamento: ReturnType<typeof detectarAchatamento>;
  calibragem: ReturnType<typeof conferirCalibragem>;
  saidas: Record<'aprovar' | 'ajuste' | 'humano', number>;
  humano_pct: number | null;
  valor: { absurdos: number; auditados: number };
  contestacoes: { id: string; nome: string; humana: number | null; time: number }[];
  alertas: string[];
};

/** Acima disto o humano deixou de ser exceção (meta do §11.4). */
export const TETO_HUMANO_PCT = 0.1;

function medicao(cs: ComparacaoProjeto[]): MedicaoVeredito | undefined {
  const validos = cs.filter((c) => c.merito !== 'sem_base');
  if (!validos.length) return undefined;
  const acertos = validos.filter((c) => c.merito === 'acerto').length;
  return { acerto: acertos / validos.length, erro_grave: validos.filter((c) => c.merito === 'erro_grave').length, n: validos.length };
}

export function agregarRetroativo(comparacoes: ComparacaoProjeto[]): RelatorioRetroativo {
  const total = comparacoes.length;
  const por_gabarito: Record<ConfiancaGabarito, number> = { nota_humana: 0, status_assentado: 0, nao_auditado: 0, fora: 0 };
  const merito = { acerto: 0, conservador: 0, erro_grave: 0, sem_base: 0, acuracia: null as number | null };
  const saidas = { aprovar: 0, ajuste: 0, humano: 0 };
  const distribuicao_time: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const distribuicao_humana: Record<string, number> = {};
  const quedas: number[] = [];
  const dists: { d: number; dif: number }[] = [];
  let escape = 0;
  let absurdos = 0;
  let auditados = 0;
  const contestacoes: RelatorioRetroativo['contestacoes'] = [];

  for (const c of comparacoes) {
    por_gabarito[c.gabarito] += 1;
    merito[c.merito] += 1;
    saidas[c.saida] += 1;
    const chaveT = String(Math.max(0, Math.min(5, Math.round(c.estrela.time))));
    distribuicao_time[chaveT] = (distribuicao_time[chaveT] ?? 0) + 1;
    if (typeof c.estrela.humana === 'number') {
      const chaveH = c.estrela.humana >= 6 ? '6+' : String(Math.max(0, Math.round(c.estrela.humana)));
      distribuicao_humana[chaveH] = (distribuicao_humana[chaveH] ?? 0) + 1;
    }
    if (c.escape) escape += 1;
    if (c.valor_absurdo !== null) {
      auditados += 1;
      if (c.valor_absurdo) absurdos += 1;
    }
    if (c.contestou) contestacoes.push({ id: c.id, nome: c.nome, humana: c.estrela.humana, time: c.estrela.time });
    if (c.estrela.distancia !== null && typeof c.estrela.humana === 'number') {
      dists.push({ d: c.estrela.distancia, dif: c.estrela.time - c.estrela.humana });
      if (c.estrela.humana > c.estrela.time) quedas.push(c.estrela.time);
    }
  }

  const julgados = merito.acerto + merito.conservador + merito.erro_grave;
  merito.acuracia = julgados ? merito.acerto / julgados : null;
  const n = dists.length;
  const achatamento = detectarAchatamento(quedas);
  const calibragem = conferirCalibragem(comparacoes.map((c) => c.estrela.time));
  const humano_pct = total ? saidas.humano / total : null;

  const alertas: string[] = [];
  if (achatamento.suspeito) {
    alertas.push(
      `Achatamento suspeito: ${(achatamento.proporcao * 100).toFixed(0)}% das quedas caem no mesmo nível ${achatamento.destino}. Revisar a régua antes de aceitar qualquer queda (D12).`,
    );
  }
  if (calibragem.desvio) {
    alertas.push(`Lote ${calibragem.desvio}: ${(calibragem.proporcaoAte3 * 100).toFixed(0)}% até 3 estrelas e ${(calibragem.proporcaoAcimaDe3 * 100).toFixed(0)}% acima.`);
  }
  if (humano_pct !== null && humano_pct > TETO_HUMANO_PCT) {
    alertas.push(`Saída humano em ${(humano_pct * 100).toFixed(0)}% dos projetos: acima do teto de ${TETO_HUMANO_PCT * 100}%, humano tem de ser exceção.`);
  }
  if (merito.erro_grave > 0) {
    alertas.push(`${merito.erro_grave} erro grave: o time aprovou projeto que o humano reprovou. Aprovar não pode agir sozinho.`);
  }

  return {
    total,
    por_gabarito,
    merito,
    acuracia_por_veredito: {
      aprovar: medicao(comparacoes.filter((c) => c.saida === 'aprovar')),
      ajuste: medicao(comparacoes.filter((c) => c.saida === 'ajuste')),
    },
    estrelas: {
      distribuicao_time,
      distribuicao_humana,
      escape,
      exato: n ? dists.filter((x) => x.d === 0).length / n : null,
      dentro_de_1: n ? dists.filter((x) => x.d <= 1).length / n : null,
      vies: n ? dists.reduce((s, x) => s + x.dif, 0) / n : null,
      n_comparaveis: n,
    },
    achatamento,
    calibragem,
    saidas,
    humano_pct,
    valor: { absurdos, auditados },
    contestacoes,
    alertas,
  };
}

// ── amostragem estratificada e determinística ─────────────────────────────────

type Estrato = 'especial_com_nota' | 'padrao_aprovado' | 'reprovado' | 'sem_status' | 'outros';

function estratoDe(l: LinhaGabarito): Estrato {
  if (l.especial && (l.nota_humana ?? 0) >= 1) return 'especial_com_nota';
  if (statusAssentado(l.status) === 'reprovado') return 'reprovado';
  if (!l.especial && statusAssentado(l.status) === 'aprovado') return 'padrao_aprovado';
  if (l.status === null || l.status === undefined || l.status.trim() === '') return 'sem_status';
  return 'outros';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralhar<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Amostra determinística por seed, round-robin entre estratos; descontinuado nunca entra (D7). */
export function amostrarEstratificado(linhas: LinhaGabarito[], opts: { tamanho: number; seed: number }): LinhaGabarito[] {
  const vivos = linhas.filter((l) => !l.descontinuado);
  if (opts.tamanho <= 0) return [];
  if (opts.tamanho >= vivos.length) return vivos;
  const rnd = mulberry32(opts.seed);
  const ordem: Estrato[] = ['especial_com_nota', 'padrao_aprovado', 'reprovado', 'sem_status', 'outros'];
  const filas = new Map<Estrato, LinhaGabarito[]>();
  for (const e of ordem) filas.set(e, []);
  for (const l of vivos) filas.get(estratoDe(l))!.push(l);
  for (const e of ordem) filas.set(e, embaralhar(filas.get(e)!, rnd));
  const out: LinhaGabarito[] = [];
  while (out.length < opts.tamanho) {
    let andou = false;
    for (const e of ordem) {
      const fila = filas.get(e)!;
      if (fila.length && out.length < opts.tamanho) {
        out.push(fila.shift()!);
        andou = true;
      }
    }
    if (!andou) break;
  }
  return out;
}

// ── relatório ────────────────────────────────────────────────────────────────

function pct(v: number | null): string {
  return v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}
function num(v: number | null, casas = 2): string {
  return v === null || Number.isNaN(v) ? 'n/a' : v.toFixed(casas);
}

export function relatorioParaMarkdown(
  r: RelatorioRetroativo,
  meta: { ciclo: string; amostra: number; modelo: string; variante: string | null },
): string {
  const l: string[] = [];
  l.push(`# Retroativo ${meta.ciclo}`);
  l.push('');
  l.push(`Amostra: ${meta.amostra} projetos. Modelo: ${meta.modelo}. Variante: ${meta.variante ?? 'sem variante'}. Total comparado: ${r.total}.`);
  l.push('');
  l.push('## Gabarito');
  l.push('| Gabarito | Projetos |');
  l.push('|---|---|');
  for (const [k, v] of Object.entries(r.por_gabarito)) l.push(`| ${k} | ${v} |`);
  l.push('');
  l.push('## Saídas do time');
  l.push('| Saída | Projetos |');
  l.push('|---|---|');
  l.push(`| aprovar | ${r.saidas.aprovar} |`);
  l.push(`| ajuste | ${r.saidas.ajuste} |`);
  l.push(`| humano | ${r.saidas.humano} |`);
  l.push('');
  l.push(`Humano: ${pct(r.humano_pct)} dos projetos.`);
  l.push('');
  l.push('## Mérito (saída do time × Status humano)');
  l.push('| Balde | Projetos |');
  l.push('|---|---|');
  l.push(`| acerto | ${r.merito.acerto} |`);
  l.push(`| conservador | ${r.merito.conservador} |`);
  l.push(`| erro grave | ${r.merito.erro_grave} |`);
  l.push(`| sem base | ${r.merito.sem_base} |`);
  l.push('');
  l.push(`Acurácia de mérito: ${pct(r.merito.acuracia)}.`);
  const ap = r.acuracia_por_veredito.aprovar;
  const aj = r.acuracia_por_veredito.ajuste;
  l.push(`Por veredito: aprovar ${ap ? `${pct(ap.acerto)} em ${ap.n} (${ap.erro_grave} erro grave)` : 'sem medição'}; ajuste ${aj ? `${pct(aj.acerto)} em ${aj.n}` : 'sem medição'}.`);
  l.push('');
  l.push('## Estrelas');
  l.push('| Nota | Time | Humano | Escape (time) |');
  l.push('|---|---|---|---|');
  for (const k of ['0', '1', '2', '3', '4', '5']) l.push(`| ${k} | ${r.estrelas.distribuicao_time[k] ?? 0} | ${r.estrelas.distribuicao_humana[k] ?? 0} | |`);
  l.push(`| 6+ | 0 | ${r.estrelas.distribuicao_humana['6+'] ?? 0} | ${r.estrelas.escape} |`);
  l.push('');
  l.push(`Comparáveis: ${r.estrelas.n_comparaveis}. Exato: ${pct(r.estrelas.exato)}. Dentro de 1: ${pct(r.estrelas.dentro_de_1)}. Viés (time menos humano): ${num(r.estrelas.vies)}.`);
  l.push(`Achatamento: ${r.achatamento.suspeito ? 'SUSPEITO' : 'não'} (${r.achatamento.total} quedas). Calibragem: ${r.calibragem.desvio ?? 'ok'}.`);
  l.push('');
  l.push('## Valor');
  l.push(`Auditados: ${r.valor.auditados}. Absurdos: ${r.valor.absurdos}.`);
  l.push('');
  l.push('## Alertas');
  if (r.alertas.length) for (const a of r.alertas) l.push(`- ${a}`);
  else l.push('- nenhum');
  l.push('');
  l.push('## Contestações');
  if (r.contestacoes.length) for (const c of r.contestacoes) l.push(`- ${c.nome} (${c.id}): humana ${c.humana ?? 'n/a'}, time ${c.time}`);
  else l.push('- nenhuma');
  return l.join('\n').replace(/—/g, ',');
}
