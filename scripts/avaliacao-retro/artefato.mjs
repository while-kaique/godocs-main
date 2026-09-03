// Gera o artefato HTML (visão enxuta) a partir do JSON de uma rodada do retroativo.
//   node scripts/avaliacao-retro/artefato.mjs docs/plans/retro-rodadas/<ciclo>.json <saida.html> [conclusoes.json]
import fs from 'node:fs';

const [, , entrada, saida, conclusoesPath] = process.argv;
const j = JSON.parse(fs.readFileSync(entrada, 'utf8'));
const conclusoes = conclusoesPath ? JSON.parse(fs.readFileSync(conclusoesPath, 'utf8')) : { titulo: 'Retroativo do time de agentes', linhas: [], rodadas: [] };
const R = j.resultados;
const rel = j.relatorio;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
const est = (n) => (n === null || n === undefined ? '' : String(n));
const saidaRotulo = { aprovar: 'Aprovar', ajuste: 'Ajuste', humano: 'Humano' };
const meritoRotulo = { acerto: 'acerto', conservador: 'conservador', erro_grave: 'erro grave', sem_base: 'sem base' };

const linhas = R.map((r) => `<tr data-saida="${r.saida}" data-merito="${r.merito}">
<td class="nome">${esc(r.nome)}</td><td>${esc(r.area ?? '')}</td><td class="c">${r.especial ? 'sim' : ''}</td>
<td>${esc(j.resultados && r.gabarito === 'fora' ? 'descontinuado' : (r.statusHumano ?? ''))}</td>
<td class="c num">${est(r.estrela.humana)}</td>
<td><span class="chip s-${r.saida}">${saidaRotulo[r.saida]}</span></td>
<td class="c num">${r.estrela.time}${r.escape ? ' <span class="esc">6 a 10</span>' : ''}</td>
<td class="c"><span class="conf c-${r.confianca}">${r.confianca}</span></td>
<td><span class="mer m-${r.merito}">${meritoRotulo[r.merito]}</span></td>
</tr>`).join('\n');

const rodadasHtml = (conclusoes.rodadas ?? []).map((x) => `<tr><td>${esc(x.ciclo)}</td><td class="c num">${x.n}</td><td class="c num">${x.aprovar}</td><td class="c num">${x.ajuste}</td><td class="c num">${x.humano}</td><td class="c num">${esc(x.merito)}</td><td class="c num">${esc(x.estrela1)}</td><td class="c num">${esc(x.erro_grave)}</td><td>${esc(x.mudou)}</td></tr>`).join('\n');

const html = `<title>${esc(conclusoes.titulo)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--paper:#FBF4EE;--ink:#1C2733;--ink-2:#5B6572;--line:#E6DCD3;--card:#FFFFFF;--blue:#0059A9;--blue-ink:#004B8E;--lime:#D7DB00;--lime-ink:#5F6200;--ok:#1F7A4D;--ok-bg:#E4F3EA;--warn:#8A5A00;--warn-bg:#FBEFD6;--bad:#A3322A;--bad-bg:#F9E3E0;--mute-bg:#EFE9E3;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#131A21;--ink:#EEF1F4;--ink-2:#A6B0BC;--line:#2A343F;--card:#1B242E;--blue:#6FB0F0;--blue-ink:#9CCBFA;--lime:#D7DB00;--lime-ink:#E4E76A;--ok:#7CD3A0;--ok-bg:#1B3A2B;--warn:#F0C168;--warn-bg:#3E3216;--bad:#F19A92;--bad-bg:#442222;--mute-bg:#252F3A;}}
:root[data-theme="dark"]{--paper:#131A21;--ink:#EEF1F4;--ink-2:#A6B0BC;--line:#2A343F;--card:#1B242E;--blue:#6FB0F0;--blue-ink:#9CCBFA;--lime:#D7DB00;--lime-ink:#E4E76A;--ok:#7CD3A0;--ok-bg:#1B3A2B;--warn:#F0C168;--warn-bg:#3E3216;--bad:#F19A92;--bad-bg:#442222;--mute-bg:#252F3A;}
body{background:var(--paper);color:var(--ink);font:15px/1.5 "IBM Plex Sans",system-ui,sans-serif;margin:0}
main{max-width:1180px;margin:0 auto;padding:36px 28px 64px;display:grid;gap:28px}
h1{font:600 28px/1.15 Poppins,system-ui,sans-serif;margin:0;text-wrap:balance;letter-spacing:-.01em}
h2{font:600 15px/1.2 Poppins,system-ui,sans-serif;margin:0 0 10px;color:var(--blue-ink);text-transform:uppercase;letter-spacing:.06em}
.sub{color:var(--ink-2);margin:6px 0 0}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);padding:16px 18px;border-radius:6px}
.kpi b{display:block;font:500 30px/1 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;color:var(--ink)}
.kpi span{color:var(--ink-2);font-size:13px}
.kpi .bar{display:flex;height:8px;margin-top:10px;border-radius:2px;overflow:hidden;background:var(--mute-bg)}
.kpi .bar i{display:block}
.i-aprovar{background:var(--ok)}.i-ajuste{background:var(--warn)}.i-humano{background:var(--bad)}
ol.conc{margin:0;padding-left:22px;display:grid;gap:8px;max-width:72ch}
ol.conc li{padding-left:4px}
.filtros{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.filtros button{font:500 13px Poppins,system-ui,sans-serif;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:6px 12px;border-radius:999px;cursor:pointer}
.filtros button[aria-pressed="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
.filtros button:focus-visible{outline:3px solid var(--lime);outline-offset:2px}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th{font:600 11.5px/1.2 Poppins,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-2);text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0}
td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
td.nome{font-weight:500;max-width:340px}
.c{text-align:center}.num{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
.chip,.mer,.conf{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap}
.s-aprovar{background:var(--ok-bg);color:var(--ok)}.s-ajuste{background:var(--warn-bg);color:var(--warn)}.s-humano{background:var(--bad-bg);color:var(--bad)}
.m-acerto{background:var(--ok-bg);color:var(--ok)}.m-conservador{background:var(--warn-bg);color:var(--warn)}.m-erro_grave{background:var(--bad-bg);color:var(--bad)}.m-sem_base{background:var(--mute-bg);color:var(--ink-2)}
.c-alta{color:var(--ok)}.c-media{color:var(--warn)}.c-baixa{color:var(--bad)}
.esc{font:500 10px Poppins;background:var(--lime);color:#2B2D00;padding:1px 6px;border-radius:999px;vertical-align:middle}
.small{font-size:12.5px;color:var(--ink-2)}
tr[hidden]{display:none}
@media (max-width:760px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:24px 16px}}
@media (prefers-reduced-motion: no-preference){.filtros button{transition:background .15s,color .15s}}
</style>
<main>
<header>
<h1>${esc(conclusoes.titulo)}</h1>
<p class="sub">${esc(j.meta.ciclo)} · ${j.meta.amostra} projetos da base de prod, em sombra · ${esc(j.meta.modelo)}${j.meta.variante ? ' · ' + esc(j.meta.variante) : ''}</p>
</header>
<section class="kpis">
<div class="kpi"><span>Saída do time</span><b>${rel.saidas.aprovar} · ${rel.saidas.ajuste} · ${rel.saidas.humano}</b><span>aprovar · ajuste · humano</span><div class="bar"><i class="i-aprovar" style="width:${(rel.saidas.aprovar/rel.total*100)||0}%"></i><i class="i-ajuste" style="width:${(rel.saidas.ajuste/rel.total*100)||0}%"></i><i class="i-humano" style="width:${(rel.saidas.humano/rel.total*100)||0}%"></i></div></div>
<div class="kpi"><span>Mérito bate com a triagem</span><b>${pct(rel.merito.acuracia)}</b><span>${rel.merito.acerto} acertos, ${rel.merito.conservador} conservadores, ${rel.merito.erro_grave} erro grave, ${rel.merito.sem_base} sem base</span></div>
<div class="kpi"><span>Estrela dentro de 1 da humana</span><b>${pct(rel.estrelas.dentro_de_1)}</b><span>${rel.estrelas.n_comparaveis} comparáveis · exato ${pct(rel.estrelas.exato)} · viés ${rel.estrelas.vies === null ? 'n/a' : rel.estrelas.vies.toFixed(2)}</span></div>
<div class="kpi"><span>Escape 6 a 10 indicado</span><b>${rel.estrelas.escape}</b><span>${rel.valor.absurdos} valor absurdo em ${rel.valor.auditados} auditados · US$ ${Number(j.custoUsd).toFixed(2)}</span></div>
</section>
<section><h2>Conclusões</h2><ol class="conc">${(conclusoes.linhas ?? []).map((l) => `<li>${esc(l)}</li>`).join('')}</ol></section>
${rodadasHtml ? `<section><h2>Rodadas</h2><div class="tbl"><table><thead><tr><th>Rodada</th><th class="c">N</th><th class="c">Aprovar</th><th class="c">Ajuste</th><th class="c">Humano</th><th class="c">Mérito</th><th class="c">Estrela ±1</th><th class="c">Erro grave</th><th>O que mudou</th></tr></thead><tbody>${rodadasHtml}</tbody></table></div></section>` : ''}
<section>
<h2>Projetos</h2>
<div class="filtros" role="group" aria-label="Filtrar por saída">
<button aria-pressed="true" data-f="todos">Todos (${rel.total})</button>
<button aria-pressed="false" data-f="aprovar">Aprovar (${rel.saidas.aprovar})</button>
<button aria-pressed="false" data-f="ajuste">Ajuste (${rel.saidas.ajuste})</button>
<button aria-pressed="false" data-f="humano">Humano (${rel.saidas.humano})</button>
<button aria-pressed="false" data-f="erro_grave">Erro grave (${rel.merito.erro_grave})</button>
</div>
<div class="tbl"><table>
<thead><tr><th>Projeto</th><th>Área</th><th class="c">Especial</th><th>Triagem humana</th><th class="c">Estrela humana</th><th>Saída do time</th><th class="c">Estrela do time</th><th class="c">Confiança</th><th>Mérito</th></tr></thead>
<tbody>${linhas}</tbody></table></div>
<p class="small">Mérito compara a saída do time com o Status da triagem: acerto quando concordam, conservador quando o time pede mais de um aprovado, erro grave quando aprova um reprovado, sem base quando a triagem não decidiu ou o projeto é de julho de 2026 sem auditoria.</p>
</section>
</main>
<script>
document.querySelectorAll('.filtros button').forEach(function(b){b.addEventListener('click',function(){
 document.querySelectorAll('.filtros button').forEach(function(x){x.setAttribute('aria-pressed','false')});b.setAttribute('aria-pressed','true');
 var f=b.dataset.f;document.querySelectorAll('tbody tr[data-saida]').forEach(function(tr){tr.hidden=!(f==='todos'||tr.dataset.saida===f||(f==='erro_grave'&&tr.dataset.merito==='erro_grave'))});
});});
</script>`;
fs.writeFileSync(saida, html);
console.log(`artefato: ${saida} (${(fs.statSync(saida).size / 1024).toFixed(0)} KB, ${R.length} linhas)`);
