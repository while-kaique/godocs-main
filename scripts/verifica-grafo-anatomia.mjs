// VERIFICAÇÃO DE GEOMETRIA de docs/anatomia-time-agentes.html.  `node scripts/verifica-grafo-anatomia.mjs`
//
// ⚠️ Existe porque o defeito deste desenho não aparece no código, aparece na TELA: caixa escondida
// atrás de outra, seta cruzando bloco, rótulo em cima de rótulo. Foram 4 rodadas de "entrega e o
// Luis acha o defeito" antes disto. Roda o <script> do .html com um DOM mínimo e MEDE.
// ⚠️ Repete o recálculo de faixa/faixas por nó de origem que o DESENHO faz — sem isso, mede uma
// rota que não é a desenhada (e passa verde com o defeito na tela).
import {readFileSync} from 'node:fs';
const html = readFileSync(new URL('../docs/anatomia-time-agentes.html',import.meta.url),'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

const el = () => { const o = {
  setAttribute(){}, appendChild(){}, addEventListener(){},
  getBoundingClientRect: () => ({width:1400,height:800,left:0,top:0}),
  style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){}},
  closest: () => null, set innerHTML(v){}, get innerHTML(){return ''},
}; return o; };
globalThis.document = { getElementById: el, createElementNS: el, createElement: el };
globalThis.window = { addEventListener(){} };

const fn = new Function(js + '\nreturn {N,E,TIMES,rota,cy};');
const {N,E,TIMES,rota,cy} = fn();

const nos = Object.values(N).filter(n=>n.vista==='prod');
const bat = (a,b)=> a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h;
let erros = [];

// 1. caixa sobre caixa
for(let i=0;i<nos.length;i++) for(let j=i+1;j<nos.length;j++)
  if(bat(nos[i],nos[j])) erros.push(`CAIXA sobre CAIXA: ${nos[i].id} × ${nos[j].id}`);

// 2. seta cortando bloco (amostra a polilinha e vê se algum ponto cai dentro de um nó)
const pontos = d => { const out=[]; const cmds=d.match(/[ML][-\d. ]+/g)||[];
  const pts=cmds.map(c=>c.slice(1).trim().split(/\s+/).map(Number));
  for(let i=0;i<pts.length-1;i++){ const [x1,y1]=pts[i],[x2,y2]=pts[i+1];
    const n=Math.max(2,Math.ceil(Math.hypot(x2-x1,y2-y1)/6));
    for(let k=1;k<n;k++) out.push([x1+(x2-x1)*k/n, y1+(y2-y1)*k/n]); }
  return out; };
// ⚠️ O DESENHO recalcula faixa/faixas agrupando por nó de origem (leque ordenado por y do
// destino). Sem repetir isso aqui, a verificação mede uma rota que não é a desenhada.
const porOrigem={};
for(const e of E){ const a=N[e.de],b=N[e.para];
  if(!a||!b||a.vista!=='prod'||b.vista!=='prod') continue;
  if(e.volta) continue; if(b.x<a.x+a.w) continue;
  (porOrigem[e.de]=porOrigem[e.de]||[]).push(e); }
for(const lista of Object.values(porOrigem)){
  lista.sort((p,q)=>cy(N[p.para])-cy(N[q.para]));
  lista.forEach((e,i)=>{e.faixa=i;e.faixas=lista.length;}); }
const rotulos=[];
for(const e of E){ const a=N[e.de], b=N[e.para];
  if(!a||!b||a.vista!=='prod'||b.vista!=='prod') continue;
  const r = rota(a,b,e);
  for(const [x,y] of pontos(r.d)){
    for(const n of nos){ if(n.id===e.de||n.id===e.para) continue;
      if(x>n.x+2&&x<n.x+n.w-2&&y>n.y+2&&y<n.y+n.h-2){ erros.push(`SETA corta BLOCO: ${e.de}→${e.para} passa em ${n.id}`); break; } } }
  if(e.txt){ const w=e.txt.length*5.6+10; rotulos.push({txt:e.txt,x:r.lx-w/2,y:r.ly-8,w,h:17,de:e.de,para:e.para}); }
}
// 3. rótulo sobre rótulo (sem a guarda, que é aplicada só no desenho)
for(let i=0;i<rotulos.length;i++) for(let j=i+1;j<rotulos.length;j++)
  if(bat(rotulos[i],rotulos[j])) erros.push(`ROTULO sobre ROTULO (antes da guarda): "${rotulos[i].txt}" × "${rotulos[j].txt}"`);
// 4. rótulo sobre bloco
for(const l of rotulos) for(const n of nos)
  if(bat(l,n)) erros.push(`ROTULO sobre BLOCO: "${l.txt}" em ${n.id}`);
// 4b. rótulo DEPOIS da guarda de colisão (ela empurra 17px por vez e pode parar em cima de um bloco)
const postos=[];
for(const l of rotulos){ let y=l.y;
  for(let t=0;t<8;t++){ const c={x:l.x,y,w:l.w,h:l.h};
    if(!postos.some(q=>bat(c,q))) break;
    y += (t%2===0?1:-1)*17*Math.ceil((t+1)/2); }
  const fin={x:l.x,y,w:l.w,h:l.h}; postos.push(fin);
  for(const n of nos) if(bat(fin,n)) erros.push(`ROTULO pos-guarda sobre BLOCO: "${l.txt}" em ${n.id}`);
  for(const q of postos) if(q!==fin&&bat(fin,q)) erros.push(`ROTULO pos-guarda sobre ROTULO: "${l.txt}"`); }

// 5. nó fora da caixa do time a que pertence / dentro da caixa alheia
for(const t of TIMES){ const dentro = nos.filter(n=>bat(n,t));
  console.log(`\n${t.titulo}: ${dentro.map(n=>n.id).join(', ')}`); }
// 6. título da caixa do time sobre bloco
for(const t of TIMES){ const faixa={x:t.x+10,y:t.y+8,w:520,h:20};
  for(const n of nos) if(bat(faixa,n)) erros.push(`TITULO do time "${t.titulo}" em cima de ${n.id}`); }

console.log('\n=== ' + (erros.length? erros.length+' PROBLEMA(S)': 'nenhum problema geométrico') + ' ===');
[...new Set(erros)].forEach(e=>console.log(' •', e));
console.log(`\nnós: ${nos.length} · arestas: ${E.filter(e=>N[e.de]&&N[e.para]&&N[e.de].vista==='prod').length} · rótulos: ${rotulos.length}`);
