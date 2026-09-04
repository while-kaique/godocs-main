// Gera o artefato "Estrelas da Base": uma linha por projeto aprovado, com a nota do agente,
// a nota humana quando existe, e o PORQUÊ. Sem prosa em volta — a página é a tabela.
//
// Uso: node gerar-artefato.mjs saida.html run1.json run2.json ...
//
// ⚠️ As runs CONVIVEM na mesma página, com um seletor no topo, e a anterior nunca é apagada.
// Calibrar é comparar: uma página que só mostra a rodada mais recente esconde justamente a
// pergunta que interessa, que é o que mudou de uma para a outra e se o motivo escrito sustenta.
import { readFileSync, writeFileSync } from 'node:fs';

const SAIDA = process.argv[2];
const ARQUIVOS = process.argv.slice(3);
if (!SAIDA || ARQUIVOS.length === 0) {
  console.error('uso: node gerar-artefato.mjs saida.html run1.json [run2.json ...]');
  process.exit(2);
}

/** Um run carregado, já com as contas que a página mostra. */
function carregar(arquivo, indice) {
  const d = JSON.parse(readFileSync(arquivo, 'utf8'));
  const meta = d.meta ?? {};
  const linhas = d.linhas.filter((l) => l.agente != null);
  const falhas = d.falhas ?? [];
  const dist = {};
  for (const l of linhas) dist[l.agente] = (dist[l.agente] ?? 0) + 1;

  // ⚠️ "com nota humana" sozinho ENGANA: dá a entender que a triagem estrelou centenas de
  // ESPECIAIS. A base tem 59 especiais e centenas de normais com estrela, então a quebra é
  // parte do número, não um detalhe.
  const comHumana = linhas.filter((l) => l.humana != null);
  const espComHumana = comHumana.filter((l) => l.especial).length;

  // Projetos cujo dossiê não sustenta veredito (memorial que é só a conta) ficam FORA da
  // concordância: contá-los como acerto ou erro seria medir a documentação, não o agente.
  const comparaveis = comHumana.filter((l) => l.dossie !== 'insuficiente');
  const iguais = comparaveis.filter((l) => l.humana === l.agente).length;
  const perto = comparaveis.filter((l) => Math.abs(l.humana - l.agente) <= 1).length;

  return {
    id: 'r' + indice,
    rotulo: meta.run ?? `run ${indice + 1}`,
    juiz: meta.juiz ?? null,
    rodadoEm: meta.rodado_em ?? null,
    gravou: meta.gravou ?? null,
    linhas,
    falhas,
    dist,
    total: linhas.length,
    comHumana: comHumana.length,
    espComHumana,
    normComHumana: comHumana.length - espComHumana,
    comparaveis: comparaveis.length,
    iguais,
    perto,
  };
}

const RUNS = ARQUIVOS.map(carregar);
// A página abre na ÚLTIMA run: é a que se quer olhar. As anteriores ficam a um clique.
const ATUAL = RUNS[RUNS.length - 1];

const linhas = ATUAL.linhas;
const falhas = ATUAL.falhas;
const dist = ATUAL.dist;
const maxDist = Math.max(...Object.values(dist), 1);
const total = ATUAL.total;
const comHumana = linhas.filter((l) => l.humana != null);
const iguais = ATUAL.iguais;
const perto = ATUAL.perto;

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ⚠️ O índice de busca vai SEM ACENTO. Quem digita "orcamento" espera achar "orçamento", e
// quem digita "versta robo" espera achar "[VERSTA] Robo orçamento" — a busca casa por TERMO,
// não por substring contígua. As duas coisas têm de valer aqui e no JS, com a MESMA
// normalização, senão o índice e a consulta discordam.
const semAcento = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ⚠️ As linhas de TODAS as runs vão para o HTML de uma vez, marcadas com `data-run`. O
// seletor do topo só troca quais aparecem. É o que permite comparar sem recarregar nada e sem
// a página precisar de servidor.
/**
 * A faixa de escape aparece como FAIXA, não como número.
 *
 * ⚠️ De 6 a 10 o agente DECLARA a faixa e o número é sugestão dele; quem crava a estrela é o
 * comitê humano. Mostrar "7" na tabela apaga essa diferença.
 */
function rotuloNota(n) {
  return n >= 6 ? '6-10' : String(n);
}

// Para cada run, a nota que o MESMO projeto tinha na run anterior. É o que faz a tabela mostrar
// "0→2" em vez de obrigar a abrir duas páginas lado a lado: calibrar é comparar.
const anteriorPorRun = new Map();
RUNS.forEach((run, i) => {
  if (i === 0) return;
  const antes = new Map(RUNS[i - 1].linhas.map((l) => [l.id, l.agente]));
  anteriorPorRun.set(run.id, antes);
});

const linhasHtml = RUNS.map((run) => {
  const ordenadas = [...run.linhas].sort(
    (a, b) => b.agente - a.agente || a.nome.localeCompare(b.nome, 'pt-BR'),
  );
  return ordenadas
    .map((l) => {
      const insuf = l.dossie === 'insuficiente';
      // Divergência só conta onde ela SIGNIFICA algo: com dossiê insuficiente o agente não
      // discordou do humano, ele não teve o que ler.
      const div = !insuf && l.humana != null && Math.abs(l.humana - l.agente) >= 2;
      const classes = [div ? 'div' : '', insuf ? 'insuf' : ''].filter(Boolean).join(' ');
      const anterior = anteriorPorRun.get(run.id)?.get(l.id);
      const mudou = anterior != null && anterior !== l.agente;
      return `<tr data-run="${run.id}" data-n="${l.agente}" data-b="${esc(semAcento(l.nome + ' ' + l.area + ' ' + l.leitura))}"${classes ? ` class="${classes}"` : ''} hidden>
<td class="n"><span class="pill p${l.agente}">${rotuloNota(l.agente)}</span>${mudou ? `<span class="delta" title="na run anterior era ${anterior}">${anterior}→${l.agente}</span>` : ''}</td>
<td class="h">${l.humana != null ? l.humana : '<span class="vazio">—</span>'}${insuf ? '<span class="tag" title="O memorial deste projeto é só a conta do saving: não há dossiê que sustente veredito, então ele fica fora da concordância.">sem dossiê</span>' : ''}</td>
<td class="nome">${esc(l.nome)}<span class="area">${esc(l.area || '—')}</span></td>
<td class="pq">${esc(l.leitura)}</td></tr>`;
    })
    .join('\n');
}).join('\n');

// Estatística de cada run vai como DADO para o cliente: o seletor recalcula KPIs, barras e
// chips sem recarregar a página.
const STATS = RUNS.map((r) => ({
  id: r.id,
  rotulo: r.rotulo,
  juiz: r.juiz,
  rodadoEm: r.rodadoEm,
  gravou: r.gravou,
  total: r.total,
  comHumana: r.comHumana,
  espComHumana: r.espComHumana,
  normComHumana: r.normComHumana,
  comparaveis: r.comparaveis,
  iguais: r.iguais,
  perto: r.perto,
  falhas: r.falhas.length,
  dist: r.dist,
}));

const abas = RUNS.map(
  (r, i) =>
    `<button class="aba${i === RUNS.length - 1 ? ' on' : ''}" data-run="${r.id}" aria-pressed="${i === RUNS.length - 1}">${esc(r.rotulo)}</button>`,
).join('');

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
.runs{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:0 0 16px}
.runs .rot{font:600 11px/1 "IBM Plex Mono",monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--ink3);margin-right:4px}
.aba{padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink2);font:600 12.5px/1 inherit;cursor:pointer;white-space:nowrap}
.aba:hover{border-color:var(--blue);color:var(--ink)}
.aba[aria-pressed="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
:root[data-theme="dark"] .aba[aria-pressed="true"],:root:not([data-theme="light"]) .aba[aria-pressed="true"]{color:#0E141A}
.meta{font-size:12px;color:var(--ink3);margin:-6px 0 16px}
.delta{display:block;margin-top:3px;font:500 10.5px/1 "IBM Plex Mono",monospace;color:var(--div)}
.tag{display:block;margin-top:3px;font:500 10px/1.3 inherit;color:var(--ink3);cursor:help}
tr.insuf td.h{color:var(--ink3)}
@media(max-width:760px){.painel{grid-template-columns:1fr}td.nome{width:auto}}
</style>
<div class="wrap">
<header>
  <h1>Estrelas da Base</h1>
  <p class="sub">Todos os projetos <b>aprovados</b>, com a estrela que o agente indica e o porquê. A nota humana aparece quando existe, e o agente nunca a escreve. De 6 a 10 ele declara a faixa: o número é do comitê.</p>
  <div class="kpis">
    <div class="kpi"><b id="k-total">—</b><span>projetos avaliados</span></div>
    <div class="kpi"><b id="k-humana">—</b><span id="k-humana-sub">com nota humana</span></div>
    <div class="kpi"><b id="k-ident">—</b><span>nota idêntica</span></div>
    <div class="kpi"><b id="k-perto">—</b><span>dentro de 1★</span></div>
    <div class="kpi" id="k-falhas-box" hidden><b id="k-falhas">—</b><span>falhas de chamada</span></div>
  </div>
</header>

<div class="runs" role="group" aria-label="Escolher a rodada">
  <span class="rot">Rodada</span>${abas}
</div>
<p class="meta" id="meta"></p>

<div class="painel">
  <div class="barras" id="barras"></div>
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
    <p style="margin:10px 0 0;font-size:12.5px">A estrela é o <b>pagamento</b> do projeto. Por isso a página também serve para revisar quem <b>já foi pago</b>: o filtro <b>Contestações de preço</b> mostra os projetos que a triagem já estrelou e que o agente lê 2★ ou mais longe. A nota humana não muda por isso, e o agente nunca a escreve.</p>
  </div>
</div>

<div class="chips" id="chips" role="group" aria-label="Filtrar por estrela"></div>

<div class="ferramentas">
  <input type="search" id="q" placeholder="Buscar projeto, área ou motivo…" aria-label="Buscar">
  <button class="tog" id="soDiv" aria-pressed="false" title="Projetos que já receberam estrela da triagem e que o agente avalia 2★ ou mais longe. A nota humana não muda por isto: é lista para revisão de gente.">Contestações de preço (2★+)</button>
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
var STATS=__STATS__;
(function(){
  var corpo=document.getElementById('corpo'), q=document.getElementById('q'),
      soDiv=document.getElementById('soDiv'), conta=document.getElementById('conta'),
      nada=document.getElementById('nada'), linhas=[].slice.call(corpo.rows),
      abas=[].slice.call(document.querySelectorAll('.aba')),
      filtro=null, runAtual=STATS[STATS.length-1].id;

  function stat(id){ for(var i=0;i<STATS.length;i++) if(STATS[i].id===id) return STATS[i]; return STATS[0]; }
  function pct(a,b){ return b? Math.round(a/b*100)+'%' : '—'; }
  function rot(n){ return n>=6 ? '6-10' : String(n); }

  // ⚠️ Redesenha KPIs, barras e chips a cada troca de rodada. Sem isto, o seletor trocaria as
  // linhas e deixaria os números da rodada ANTERIOR no topo, que é pior que não ter seletor.
  function pintarRun(){
    var s=stat(runAtual);
    document.getElementById('k-total').textContent=s.total;
    document.getElementById('k-humana').textContent=s.comHumana;
    document.getElementById('k-humana-sub').textContent='com nota humana ('+s.espComHumana+' especiais, '+s.normComHumana+' normais)';
    document.getElementById('k-ident').textContent=pct(s.iguais,s.comparaveis);
    document.getElementById('k-perto').textContent=pct(s.perto,s.comparaveis);
    var fb=document.getElementById('k-falhas-box');
    fb.hidden=!s.falhas; document.getElementById('k-falhas').textContent=s.falhas;

    var partes=[];
    if(s.juiz) partes.push('juiz '+(s.juiz==='TIME'?'time de 5 lentes':'agente único'));
    if(s.gravou!=null) partes.push(s.gravou?'gravou no banco':'ensaio, não gravou');
    if(s.rodadoEm) partes.push('rodado em '+String(s.rodadoEm).replace('T',' ').slice(0,16)+' UTC');
    partes.push('concordância medida sobre '+s.comparaveis+' projetos, fora os de dossiê insuficiente');
    document.getElementById('meta').textContent=partes.join(' · ');

    var notas=Object.keys(s.dist).map(Number).sort(function(a,b){return a-b;});
    var max=1; notas.forEach(function(n){ if(s.dist[n]>max) max=s.dist[n]; });
    document.getElementById('barras').innerHTML=notas.map(function(n){
      return '<button class="barra" data-f="'+n+'" aria-pressed="false"><span class="bn">'+rot(n)+'</span><span class="bt"><span class="bf p'+n+'" style="width:'+(s.dist[n]/max*100)+'%"></span></span><span class="bq">'+s.dist[n]+'</span></button>';
    }).join('');
    var esc6=0; notas.forEach(function(n){ if(n>=6) esc6+=s.dist[n]; });
    document.getElementById('chips').innerHTML=
      '<button class="chip" data-f="" aria-pressed="true">Todas <b>'+s.total+'</b></button>'+
      notas.filter(function(n){return n<=5;}).map(function(n){
        return '<button class="chip" data-f="'+n+'" aria-pressed="false"><i class="dot p'+n+'"></i>'+n+'★ <b>'+s.dist[n]+'</b></button>';
      }).join('')+
      (esc6?'<button class="chip esc" data-f="6+" aria-pressed="false"><i class="dot p6"></i>6-10★ <b>'+esc6+'</b></button>':'');
    ligarFiltros();
  }

  var barras=[], chips=[];
  function ligarFiltros(){
    barras=[].slice.call(document.querySelectorAll('.barra'));
    chips=[].slice.call(document.querySelectorAll('.chip'));
    chips.forEach(function(c){c.addEventListener('click',function(){escolher(c.dataset.f===''?null:c.dataset.f)})});
    barras.forEach(function(b){b.addEventListener('click',function(){escolher(b.dataset.f)})});
  }
  // filtro: null = todas · '3' = exatamente 3 · '6+' = a faixa do escape inteira
  function casa(tr){
    if(tr.dataset.run!==runAtual) return false;
    if(filtro===null) return true;
    if(filtro==='6+') return Number(tr.dataset.n)>=6;
    return tr.dataset.n===filtro;
  }
  function pintar(){
    chips.forEach(function(c){var v=c.dataset.f===''?null:c.dataset.f; c.setAttribute('aria-pressed', String(v===filtro)); });
    barras.forEach(function(b){b.setAttribute('aria-pressed', String(b.dataset.f===filtro)); });
    abas.forEach(function(a){a.setAttribute('aria-pressed', String(a.dataset.run===runAtual)); });
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
    conta.textContent=n+' de '+stat(runAtual).total;
    nada.hidden=n>0;
  }
  function escolher(v){ filtro=(v===filtro||v==='')?null:v; aplicar(); }
  abas.forEach(function(a){a.addEventListener('click',function(){
    if(a.dataset.run===runAtual) return;
    runAtual=a.dataset.run; filtro=null; pintarRun(); aplicar();
  })});
  soDiv.addEventListener('click',function(){
    soDiv.setAttribute('aria-pressed',soDiv.getAttribute('aria-pressed')==='true'?'false':'true'); aplicar();
  });
  q.addEventListener('input',aplicar);
  pintarRun();
  aplicar();
})();
</script>`;

writeFileSync(SAIDA, html.replace('__STATS__', JSON.stringify(STATS)));
console.log(
  `${SAIDA} · ${RUNS.length} run(s) · ${RUNS.map((r) => `${r.rotulo}: ${r.total}`).join(' · ')} · ${Math.round(html.length / 1024)} KB`,
);
