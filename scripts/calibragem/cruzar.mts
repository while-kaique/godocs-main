// CRUZAMENTO da rodada: antes (cópia) × depois (resultado do time) × gabarito humano.
// Uso: npx tsx --env-file=.env scripts/calibragem/cruzar.mts <pasta-da-rodada> [run-9.json]
// Saída: <pasta>/divergencias.md e <pasta>/resumo.json. Lê também a aba de cópia AGORA (estado depois).
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAccessToken } from '../../src/lib/google/auth.ts';

const PASTA = process.argv[2]; if (!PASTA) throw new Error('pasta da rodada obrigatória');
const RUN9 = process.argv[3] || 'docs/baselines/runs/run-9.json';
const ABA = process.env.CAL_ABA || 'Cópia de GoDocs 1';
const antes = JSON.parse(readFileSync(join(PASTA, 'antes.json'), 'utf8')).linhas as any[];
const antesPorId = new Map(antes.map((l) => [l.id.toLowerCase(), l]));
const run9: Map<string, number> = new Map();
if (existsSync(RUN9)) { const r = JSON.parse(readFileSync(RUN9, 'utf8')); const walk = (o: any) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.id === 'string' && typeof o.agente === 'number' && 'humana' in o) run9.set(o.id.toLowerCase(), o.agente); else Object.values(o).forEach(walk); } }; walk(r); }
const num = (v: any) => { const s = String(v ?? '').trim().replace(/R\$/g,'').replace(/\./g,'').replace(',','.'); const n = Number(s); return s && Number.isFinite(n) ? n : null; };
// estrela HUMANA = Estrelas ≥1 na cópia que NÃO seja o número que o agente gravou na run 9 (05/09)
const humana = (l: any) => { const e = num(l.estrelas); if (e === null || e < 1) return null; const r9 = run9.get(l.id.toLowerCase()); return r9 !== undefined && r9 === e ? null : e; };

// depois: a aba agora
const sid = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const tok = await getAccessToken();
const vals = async (r: string) => ((await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(`'${ABA}'!${r}`)}`, { headers: { Authorization: `Bearer ${tok}` } })).json()).values ?? []) as string[][];
const h = (await vals('1:1'))[0]; const rows = await vals('A2:BZ'); const ci = (n: string) => h.indexOf(n);
const depois = new Map(rows.map((r) => [(r[ci('ID Projeto')] ?? '').trim().toLowerCase(), { status: r[ci('Status')] ?? '', estrelas: r[ci('Estrelas')] ?? '', estrelaAgente: r[ci('Estrela Agente')] ?? '', conf: r[ci('Confiança Agente')] ?? '', motivo: (r[ci('Motivo Reprovado')] ?? '').slice(0, 300) }]));

// resultados do driver (só respostas < 500)
const itens = readdirSync(join(PASTA, 'projetos')).map((f) => JSON.parse(readFileSync(join(PASTA, 'projetos', f), 'utf8'))).filter((it: any) => (it.http ?? 599) < 500);

// A recomendação do TIME em projeto com âncora humana só vive na FICHA nesta rodada (v348 devolve a âncora
// em `estrela.estrelas`). Busca `avaliacaoSombra.time` de quem tem nota humana, com cache em disco.
const BASE = process.env.CAL_BASE_URL || 'https://godocs-staging.devgogroup.com';
const COOKIE = process.env.E2E_COOKIE || '';
const fichasDir = join(PASTA, 'fichas'); if (!existsSync(fichasDir)) mkdirSync(fichasDir, { recursive: true });
async function timeDaFicha(id: string): Promise<{ estrela: number | null; escape: boolean; confianca: string | null; saida: string | null } | null> {
  const f = join(fichasDir, `${id}.json`);
  let d: any = null;
  if (existsSync(f)) { try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { d = null; } }
  if (!d && COOKIE) {
    try { const r = await fetch(`${BASE}/api/admin/dashboard/projetos/${id}`, { headers: { Cookie: COOKIE } }); if (r.ok) { d = await r.json(); writeFileSync(f, JSON.stringify(d)); } } catch { d = null; }
  }
  const t = d?.avaliacaoSombra?.time; if (!t) return null;
  return { estrela: typeof t.estrela === 'number' ? t.estrela : null, escape: t.escape === true, confianca: t.confianca ?? null, saida: t.saida ?? null };
}
const faixa = (imp: number | null) => imp === null ? 'sem número' : imp < 100 ? '< 100' : imp < 1000 ? '100–1k' : imp < 10000 ? '1k–10k' : '≥ 10k';
type Lin = { id: string; nome: string; imp: number | null; statusAntes: string; statusDepois: string; hum: number | null; agente: string; conf: string; junta: string; flag: boolean; mesa: string; ms: number; http: number; porques: string[] };
const linhas: Lin[] = [];
for (const it of itens) {
  const r0 = it.resultado ?? {};
  const a0 = antesPorId.get(it.id.toLowerCase()) ?? it.antes;
  let agenteFicha: string | null = null; let flagFicha: boolean | null = null; let confFicha: string | null = null;
  if (humana(a0 ?? {}) !== null || String(r0?.estrela?.motivo ?? '').includes('âncora')) {
    const t = await timeDaFicha(it.id);
    if (t && t.estrela !== null) { agenteFicha = t.escape ? '6-10' : String(t.estrela); flagFicha = t.escape; confFicha = t.confianca; }
  }
  linhas.push(((it: any) => { const a = antesPorId.get(it.id.toLowerCase()) ?? it.antes; const d = depois.get(it.id.toLowerCase()); const r = it.resultado ?? {}; return { id: it.id, nome: it.nome, imp: num(a?.impacto), statusAntes: a?.status ?? '', statusDepois: d?.status ?? '', hum: humana(a ?? {}), agente: agenteFicha ?? (typeof r?.estrela?.estrelas_time === 'number' ? String(r.estrela.estrelas_time) : (d?.estrelaAgente && d.estrelaAgente !== '—' ? d.estrelaAgente : String(r?.estrela?.estrelas ?? ''))), conf: confFicha ?? d?.conf ?? r?.junta?.confianca ?? '', junta: r?.junta?.status ?? '?', flag: flagFicha ?? !!r?.junta?.flag6a10, mesa: r?.mesa?.veredito ?? r?.mesa?.motivo ?? '?', ms: it.ms, http: it.http, porques: r?.junta?.porques ?? [] }; })(it));
}

const agNum = (s: string) => s.includes('-') ? 6 : num(s);
const div: string[] = []; const res: any = { total: linhas.length, http_erros: linhas.filter((l) => l.http >= 400).length, tempo_mediano_s: 0, por_faixa: {}, estrela: { comparaveis: 0, exatas: 0, dentro_de_1: 0, agente_menor_2plus: 0, agente_maior_2plus: 0 }, status: { aprovado_humano_reprovado_agente: 0, reprovado_humano_aprovado_agente: 0, pendente_decidido: {} }, canarios: [] };
const ms = linhas.map((l) => l.ms).sort((a, b) => a - b); res.tempo_mediano_s = ms.length ? Math.round(ms[Math.floor(ms.length / 2)] / 1000) : 0;
for (const l of linhas) {
  const f = faixa(l.imp); res.por_faixa[f] ??= { n: 0, junta: {} }; res.por_faixa[f].n++; res.por_faixa[f].junta[l.junta] = (res.por_faixa[f].junta[l.junta] ?? 0) + 1;
  const a = agNum(l.agente);
  if (l.hum !== null && a !== null) { res.estrela.comparaveis++; const d = a - l.hum; if (d === 0) res.estrela.exatas++; if (Math.abs(d) <= 1) res.estrela.dentro_de_1++; if (d <= -2) { res.estrela.agente_menor_2plus++; div.push(`| ${l.nome.slice(0, 40)} | ${l.imp ?? '—'} | ★ humano ${l.hum} → agente ${l.agente} | ${l.junta}${l.flag ? ' (6-10)' : ''} | ${l.conf} | ${(l.porques[0] ?? '').slice(0, 120)} |`); } if (d >= 2) { res.estrela.agente_maior_2plus++; div.push(`| ${l.nome.slice(0, 40)} | ${l.imp ?? '—'} | ★ humano ${l.hum} → agente ${l.agente} (subiu) | ${l.junta} | ${l.conf} | ${(l.porques[0] ?? '').slice(0, 120)} |`); } }
  if (/^aprovado$/i.test(l.statusAntes) && l.junta === 'Reprovado') { res.status.aprovado_humano_reprovado_agente++; div.push(`| ${l.nome.slice(0, 40)} | ${l.imp ?? '—'} | Aprovado (humano) → agente REPROVARIA | ★${l.agente} | ${l.conf} | ${(l.porques[0] ?? '').slice(0, 120)} |`); }
  if (/^reprovado$/i.test(l.statusAntes) && l.junta === 'Aprovado') { res.status.reprovado_humano_aprovado_agente++; div.push(`| ${l.nome.slice(0, 40)} | ${l.imp ?? '—'} | Reprovado (humano) → agente APROVARIA | ★${l.agente} | ${l.conf} | ${(l.porques[0] ?? '').slice(0, 120)} |`); }
  if (/^pendente$/i.test(l.statusAntes)) res.status.pendente_decidido[l.statusDepois || l.junta] = (res.status.pendente_decidido[l.statusDepois || l.junta] ?? 0) + 1;
  if (/^sendapp$|^cx hub|avd central v2|^piapp$|rob[oô] (de )?or[çc]amento/i.test(l.nome.trim())) res.canarios.push({ nome: l.nome, imp: l.imp, humano: l.hum, agente: l.agente, junta: l.junta, flag6a10: l.flag, conf: l.conf, mesa: l.mesa, porque: l.porques.slice(0, 3) });
}
const md = [`# Rodada ${PASTA} — divergências humano × agente`, '', `Projetos: ${res.total} · erros HTTP: ${res.http_erros} · tempo mediano: ${res.tempo_mediano_s}s`, '', '## Canários', ...res.canarios.map((c: any) => `- **${c.nome}** · impacto ${c.imp ?? '—'} · humano ${c.humano ?? '—'} · agente ${c.agente} · junta ${c.junta}${c.flag6a10 ? ' (6-10)' : ''} · conf ${c.conf} · mesa ${c.mesa}\n  - ${c.porque.join('\n  - ')}`), '', `## Estrelas (${res.estrela.comparaveis} comparáveis com nota humana): exatas ${res.estrela.exatas} · ±1 ${res.estrela.dentro_de_1} · agente 2+ abaixo ${res.estrela.agente_menor_2plus} · agente 2+ acima ${res.estrela.agente_maior_2plus}`, '', `## Status: aprovado→reprovaria ${res.status.aprovado_humano_reprovado_agente} · reprovado→aprovaria ${res.status.reprovado_humano_aprovado_agente} · pendentes decididos ${JSON.stringify(res.status.pendente_decidido)}`, '', '## Por faixa de impacto', ...Object.entries(res.por_faixa).map(([f, v]: any) => `- ${f}: n=${v.n} · ${JSON.stringify(v.junta)}`), '', '## Linhas divergentes (só o que discorda)', '| Projeto | Impacto | Divergência | Junta | Conf | 1º porquê |', '|---|---|---|---|---|---|', ...div].join('\n');
writeFileSync(join(PASTA, 'divergencias.md'), md); writeFileSync(join(PASTA, 'resumo.json'), JSON.stringify(res, null, 2));
console.log(md.split('\n').slice(0, 40).join('\n'));
