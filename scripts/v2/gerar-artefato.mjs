// Gera o artefato "Estrelas da Base": uma linha por projeto aprovado, com a nota do agente,
// a nota humana quando existe, e o PORQUÊ. Sem prosa em volta — a página é a tabela.
import { readFileSync, writeFileSync } from 'node:fs';

const ENTRADA = process.argv[2];
const SAIDA = process.argv[3];
const d = JSON.parse(readFileSync(ENTRADA, 'utf8'));
const linhas = d.linhas.filter((l) => l.agente != null);
const falhas = d.falhas ?? [];

const dist = {};
for (const l of linhas) dist[l.agente] = (dist[l.agente] ?? 0) + 1;
const maxDist = Math.max(...Object.values(dist), 1);
const total = linhas.length;
const comHumana = linhas.filter((l) => l.humana != null);
const iguais = comHumana.filter((l) => l.humana === l.agente).length;
const perto = comHumana.filter((l) => Math.abs(l.humana - l.agente) <= 1).length;

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ⚠️ O índice de busca vai SEM ACENTO. Quem digita "orcamento" espera achar "orçamento", e
// quem digita "versta robo" espera achar "[VERSTA] Robo orçamento" — a busca casa por TERMO,
// não por substring contígua. As duas coisas têm de valer aqui e no JS, com a MESMA
// normalização, senão o índice e a consulta discordam.
const semAcento = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const ordenadas = [...linhas].sort((a, b) => b.agente - a.agente || a.nome.localeCompare(b.nome, 'pt-BR'));

const linhasHtml = ordenadas
  .map((l) => {
    const div = l.humana != null && Math.abs(l.humana - l.agente) >= 2;
    return `<tr data-n="${l.agente}" data-b="${esc(semAcento(l.nome + ' ' + l.area + ' ' + l.leitura))}"${div ? ' class="div"' : ''}>
<td class="n"><span class="pill p${l.agente}">${l.agente}</span></td>
<td class="h">${l.humana != null ? l.humana : '<span class="vazio">—</span>'}</td>
<td class="nome">${esc(l.nome)}<span class="area">${esc(l.area || '—')}</span></td>
<td class="pq">${esc(l.leitura)}</td></tr>`;
  })
  .join('\n');

const notasPresentes = Object.keys(dist).map(Number).sort((a, b) => a - b);
const escapeQtd = notasPresentes.filter((n) => n >= 6).reduce((a, n) => a + dist[n], 0);
// Chips: "Todas" + uma por estrela de 0 a 5 + um agrupado para 6–10 (poucos, e a faixa
// interessa junta: é a que vai ao comitê). Cada um traz a CONTAGEM ao lado.
const chips =
  `<button class="chip on" data-f="" aria-pressed="true">Todas <b>${total}</b></button>` +
  notasPresentes
    .filter((n) => n <= 5)
    .map((n) => `<button class="chip" data-f="${n}" aria-pressed="false"><i class="dot p${n}"></i>${n}★ <b>${dist[n]}</b></button>`)
    .join('') +
  (escapeQtd
    ? `<button class="chip esc" data-f="6+" aria-pressed="false"><i class="dot p6"></i>6–10★ <b>${escapeQtd}</b></button>`
    : '');

const barras = Object.keys(dist)
  .map(Number)
  .sort((a, b) => a - b)
  .map(
    (n) =>
      `<button class="barra" data-f="${n}" aria-pressed="false"><span class="bn">${n}★</span><span class="bt"><span class="bf p${n}" style="width:${(dist[n] / maxDist) * 100}%"></span></span><span class="bq">${dist[n]}</span></button>`,
  )
  .join('');

const html = `<title>Estrelas da Base</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
:root{--paper:#FBF4EE;--ink:#16202B;--ink2:#5A6674;--ink3:#8D97A3;--line:#E7DCD2;--card:#fff;--blue:#0059A9;--lime:#D7DB00;--mute:#F1EBE5;--div:#B8541E;--div-bg:#FBEDE3;
--s0:#B9B2AB;--s1:#8AA6BE;--s2:#5E8FBF;--s3:#2E76B4;--s4:#0059A9;--s5:#7E8A00;--s6:#5F6200;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#111820;--ink:#EDF1F5;--ink2:#A3AEBB;--ink3:#7B8592;--line:#28323D;--card:#19222C;--blue:#74B3F2;--mute:#212B36;--div:#E9A277;--div-bg:#33231A;
--s0:#5C646D;--s1:#3E5B76;--s2:#3A6E9C;--s3:#3E86C4;--s4:#74B3F2;--s5:#B9BE3A;--s6:#D7DB00;}}
:root[data-theme="dark"]{--paper:#111820;--ink:#EDF1F5;--ink2:#A3AEBB;--ink3:#7B8592;--line:#28323D;--card:#19222C;--blue:#74B3F2;--mute:#212B36;--div:#E9A277;--div-bg:#33231A;
--s0:#5C646D;--s1:#3E5B76;--s2:#3A6E9C;--s3:#3E86C4;--s4:#74B3F2;--s5:#B9BE3A;--s6:#D7DB00;}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font:14.5px/1.5 "IBM Plex Sans",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:30px 18px 60px}
h1{font:700 30px/1.1 Poppins,sans-serif;margin:0;letter-spacing:-.02em}
.sub{color:var(--ink2);margin:8px 0 0;max-width:70ch}
header{border-bottom:3px solid var(--lime);padding-bottom:20px;margin-bottom:22px}
.kpis{display:flex;flex-wrap:wrap;gap:26px;margin:18px 0 0}
.kpi b{display:block;font:700 24px/1 Poppins,sans-serif;color:var(--blue)}
.kpi span{font-size:12px;color:var(--ink3)}
.painel{display:grid;grid-template-columns:minmax(240px,1fr) 2fr;gap:22px;align-items:start;margin-bottom:20px}
.barras{display:grid;gap:5px}
.barra{display:grid;grid-template-columns:34px 1fr 38px;align-items:center;gap:9px;background:none;border:0;padding:3px 4px;border-radius:6px;cursor:pointer;font:inherit;color:inherit;text-align:left}
.barra:hover{background:var(--mute)}
.barra[aria-pressed="true"]{background:var(--mute);outline:2px solid var(--blue)}
.bn{font:500 12px/1 "IBM Plex Mono",monospace;color:var(--ink2)}
.bt{height:12px;background:var(--mute);border-radius:3px;overflow:hidden}
.bf{display:block;height:100%}
.bq{font:500 12px/1 "IBM Plex Mono",monospace;color:var(--ink3);text-align:right}
.p0{background:var(--s0)}.p1{background:var(--s1)}.p2{background:var(--s2)}.p3{background:var(--s3)}.p4{background:var(--s4)}.p5{background:var(--s5)}
.p6,.p7,.p8,.p9,.p10{background:var(--s6)}
.legenda{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;font-size:13px;color:var(--ink2)}
.legenda b{color:var(--ink)}
.legenda ul{margin:8px 0 0;padding-left:17px;display:grid;gap:3px}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:11px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--line);border-radius:20px;background:var(--card);color:var(--ink2);font:500 12.5px/1 inherit;cursor:pointer;white-space:nowrap}
.chip:hover{border-color:var(--blue);color:var(--ink)}
.chip b{font:600 12.5px "IBM Plex Mono",monospace;color:var(--ink3)}
.chip[aria-pressed="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
.chip[aria-pressed="true"] b{color:rgba(255,255,255,.8)}
:root[data-theme="dark"] .chip[aria-pressed="true"],:root:not([data-theme="light"]) .chip[aria-pressed="true"]{color:#0E141A}
:root[data-theme="dark"] .chip[aria-pressed="true"] b,:root:not([data-theme="light"]) .chip[aria-pressed="true"] b{color:rgba(14,20,26,.7)}
.chip .dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.chip[aria-pressed="true"] .dot{background:currentColor!important;opacity:.55}
.chip.esc{border-color:var(--s6)}
.ferramentas{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
input[type=search]{flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit}
input[type=search]:focus{outline:2px solid var(--blue);outline-offset:1px}
.tog{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink2);font:500 12.5px/1 inherit;cursor:pointer}
.tog[aria-pressed="true"]{border-color:var(--div);color:var(--div);background:var(--div-bg)}
.conta{font:500 12px/1 "IBM Plex Mono",monospace;color:var(--ink3)}
.tabela{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
table{width:100%;border-collapse:collapse}
th{text-align:left;font:600 11px/1 "IBM Plex Mono",monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--ink3);padding:11px 12px;border-bottom:1px solid var(--line);background:var(--mute);position:sticky;top:0;z-index:1}
td{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
tr.div td.h{color:var(--div);font-weight:600}
td.n{width:46px}
.pill{display:inline-block;min-width:26px;padding:3px 0;border-radius:5px;text-align:center;color:#fff;font:600 13px/1.2 Poppins,sans-serif}
:root[data-theme="dark"] .pill,:root:not([data-theme="light"]) .pill{color:#0E141A}
td.h{width:52px;font:500 13px "IBM Plex Mono",monospace;color:var(--ink2)}
.vazio{color:var(--ink3)}
td.nome{width:250px;font-weight:600;font-size:13.5px}
.area{display:block;font-weight:400;font-size:11px;color:var(--ink3);margin-top:2px}
td.pq{font-size:13px;color:var(--ink2);line-height:1.5}
.nada{padding:26px;text-align:center;color:var(--ink3)}
@media(max-width:760px){.painel{grid-template-columns:1fr}td.nome{width:auto}}
</style>
<div class="wrap">
<header>
  <h1>Estrelas da Base</h1>
  <p class="sub">Todos os projetos <b>aprovados</b>, com a estrela que o agente indica e o porquê. A nota humana aparece quando existe — o agente nunca a escreve.</p>
  <div class="kpis">
    <div class="kpi"><b>${total}</b><span>projetos avaliados</span></div>
    <div class="kpi"><b>${comHumana.length}</b><span>com nota humana</span></div>
    <div class="kpi"><b>${comHumana.length ? Math.round((iguais / comHumana.length) * 100) : 0}%</b><span>nota idêntica</span></div>
    <div class="kpi"><b>${comHumana.length ? Math.round((perto / comHumana.length) * 100) : 0}%</b><span>dentro de 1★</span></div>
    ${falhas.length ? `<div class="kpi"><b>${falhas.length}</b><span>falhas de chamada</span></div>` : ''}
  </div>
</header>

<div class="painel">
  <div class="barras">${barras}</div>
  <div class="legenda">
    <b>A régua</b>
    <ul>
      <li><b>0 Experimenta</b> — só o autor usa, é local, ou está parado</li>
      <li><b>1 Informa</b> — produz o insumo; alguém lê e age</li>
      <li><b>2 Executa</b> — assume a ação recorrente, sem ninguém iniciar</li>
      <li><b>3 Garante</b> — impede o erro de passar, para outra área</li>
      <li><b>4 Decide</b> — escolhe comprometendo recurso, de forma estocástica</li>
      <li><b>5 Assume</b> — está no caminho até o cliente, sem humano no meio</li>
      <li><b>6–10 Muda o Jogo</b> — o agente indica a faixa; o número é do comitê</li>
    </ul>
  </div>
</div>

<div class="chips" role="group" aria-label="Filtrar por estrela">${chips}</div>

<div class="ferramentas">
  <input type="search" id="q" placeholder="Buscar projeto, área ou motivo…" aria-label="Buscar">
  <button class="tog" id="soDiv" aria-pressed="false">Só divergências de 2★+</button>
  <span class="conta" id="conta"></span>
</div>

<div class="tabela">
<table>
<thead><tr><th>Agente</th><th>Humano</th><th>Projeto</th><th>Por quê</th></tr></thead>
<tbody id="corpo">
${linhasHtml}
</tbody>
</table>
<div class="nada" id="nada" hidden>Nenhum projeto com esse filtro.</div>
</div>
</div>
<script>
(function(){
  var corpo=document.getElementById('corpo'), q=document.getElementById('q'),
      soDiv=document.getElementById('soDiv'), conta=document.getElementById('conta'),
      nada=document.getElementById('nada'), linhas=[].slice.call(corpo.rows),
      barras=[].slice.call(document.querySelectorAll('.barra')),
      chips=[].slice.call(document.querySelectorAll('.chip')), filtro=null;
  // filtro: null = todas · '3' = exatamente 3 · '6+' = a faixa do escape inteira
  function casa(tr){
    if(filtro===null) return true;
    if(filtro==='6+') return Number(tr.dataset.n)>=6;
    return tr.dataset.n===filtro;
  }
  function pintar(){
    chips.forEach(function(c){var v=c.dataset.f===''?null:c.dataset.f; c.setAttribute('aria-pressed', String(v===filtro)); });
    barras.forEach(function(b){b.setAttribute('aria-pressed', String(b.dataset.f===filtro)); });
  }
  function sa(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
  function aplicar(){
    // cada palavra vale um "contém", e TODAS precisam aparecer — ordem não importa
    var termos=sa(q.value).split(/\s+/).filter(Boolean),
        sd=soDiv.getAttribute('aria-pressed')==='true', n=0;
    linhas.forEach(function(tr){
      var b=tr.dataset.b, achou=true;
      for(var i=0;i<termos.length;i++){ if(b.indexOf(termos[i])<0){achou=false;break;} }
      var ok=casa(tr)&&achou&&(!sd||tr.classList.contains('div'));
      tr.hidden=!ok; if(ok)n++;
    });
    pintar();
    conta.textContent=n+' de '+linhas.length;
    nada.hidden=n>0;
  }
  function escolher(v){ filtro=(v===filtro||v==='')?null:v; aplicar(); }
  chips.forEach(function(c){c.addEventListener('click',function(){escolher(c.dataset.f===''?null:c.dataset.f)})});
  barras.forEach(function(b){b.addEventListener('click',function(){escolher(b.dataset.f)})});
  soDiv.addEventListener('click',function(){
    soDiv.setAttribute('aria-pressed',soDiv.getAttribute('aria-pressed')==='true'?'false':'true'); aplicar();
  });
  q.addEventListener('input',aplicar);
  aplicar();
})();
</script>`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} · ${total} projetos · ${Math.round(html.length / 1024)} KB`);
