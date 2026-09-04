// Análise CRÍTICA da rodada: a calibragem inflou? O escape virou porta larga?
// A pergunta não é "as notas subiram" — é "subiram por motivo que se sustenta".
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const l = d.linhas.filter((x) => x.agente != null);
const brl = (n) => n.toLocaleString('pt-BR');

const dist = {};
for (const x of l) dist[x.agente] = (dist[x.agente] ?? 0) + 1;
console.log(`${l.length} avaliados · ${d.falhas.length} falhas\n`);
console.log('DISTRIBUIÇÃO');
for (const k of Object.keys(dist).map(Number).sort((a, b) => a - b)) {
  const pct = ((dist[k] / l.length) * 100).toFixed(1);
  console.log(`  ${k}★ ${String(dist[k]).padStart(4)} (${pct.padStart(4)}%) ${'#'.repeat(Math.round(dist[k] / 8))}`);
}

const esc = l.filter((x) => x.agente >= 6);
console.log(`\nESCAPE 6-10: ${esc.length} projetos (${((esc.length / l.length) * 100).toFixed(1)}%)`);
for (const x of esc) console.log(`  ${x.agente}★ (humano ${x.humana ?? '-'})  ${x.nome.slice(0, 46)}`);

// ── controle 1: o escape é mesmo raro, ou virou porta larga? ────────────────
console.log('\n— CONTROLE: o escape virou porta larga?');
console.log(`  esperado: um punhado. ${esc.length > l.length * 0.05 ? 'ALERTA: acima de 5% da base' : 'ok, abaixo de 5%'}`);

// ── controle 2: concordância com a nota humana ─────────────────────────────
const ch = l.filter((x) => x.humana != null);
const ig = ch.filter((x) => x.humana === x.agente).length;
const um = ch.filter((x) => Math.abs(x.humana - x.agente) <= 1).length;
const acima = ch.filter((x) => x.agente > x.humana).length;
const abaixo = ch.filter((x) => x.agente < x.humana).length;
console.log(`\n— CONTROLE: contra a nota HUMANA (${ch.length} projetos)`);
console.log(`  idêntica ${ig} (${((ig / ch.length) * 100).toFixed(0)}%) · dentro de 1★ ${um} (${((um / ch.length) * 100).toFixed(0)}%)`);
console.log(`  agente ACIMA do humano: ${acima} · ABAIXO: ${abaixo}`);
console.log(`  ${acima > abaixo * 1.5 ? '  ALERTA: viés de inflação' : '  sem viés claro de inflação'}`);

// ── controle 3: quem invocou "plataforma" sem ter dependente nomeado ───────
const plat = l.filter((x) => /plataforma|api|mcp|integra/i.test(x.leitura || ''));
const platAlta = plat.filter((x) => x.agente >= 5);
console.log(`\n— CONTROLE: "plataforma" citada em ${plat.length} leituras · ${platAlta.length} com nota 5+`);

console.log('\nMAIORES DIVERGÊNCIAS (agente ACIMA do humano — risco de inflação)');
for (const x of ch.filter((y) => y.agente > y.humana).sort((a, b) => b.agente - b.humana - (a.agente - a.humana)).slice(0, 10))
  console.log(`  humano ${x.humana} → agente ${x.agente}  ${x.nome.slice(0, 42)}\n     ${(x.leitura || '').slice(0, 150)}`);

console.log('\nMAIORES DIVERGÊNCIAS (agente ABAIXO — risco de rebaixar bom projeto)');
for (const x of ch.filter((y) => y.agente < y.humana).sort((a, b) => b.humana - b.agente - (a.humana - a.agente)).slice(0, 8))
  console.log(`  humano ${x.humana} → agente ${x.agente}  ${x.nome.slice(0, 42)}\n     ${(x.leitura || '').slice(0, 150)}`);
