// GRAVA a nota do agente (0–5) na coluna "Estrelas" da aba GoDocs para os projetos avaliados na rodada — decisão do dono
// do produto em 11/09/2026 ("mude as estrelas de todos os aprovados que vc rodou, evitando mudar o que humano decidiu").
// Uso: npx tsx --env-file=.env scripts/calibragem/gravar-estrelas-agente.mts <pasta> <protegidos.json> [--aplicar]
// PROTEGE (nunca escreve): (1) projeto com ação "estrelas" de HUMANO no admin_activity_log de prod; (2) célula atual ≥ 6
// (faixa do comitê); (3) célula atual diferente da cópia (mudada à mão depois de a cópia nascer); (4) agente na faixa 6-10
// (não crava número); (5) Status Descontinuado/Reprovado; (6) cérebro não avaliou (fallback).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAccessToken } from '../../src/lib/google/auth.ts';
const [PASTA, PROT] = [process.argv[2], process.argv[3]]; const APLICAR = process.argv.includes('--aplicar');
if (!PASTA || !PROT) throw new Error('uso: <pasta> <protegidos.json> [--aplicar]');
const sid = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk'; const PROD = 'GoDocs';
const tok = await getAccessToken(); const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const col = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const protegidos = new Set<string>((JSON.parse(readFileSync(PROT, 'utf8')) as string[]).map((x) => x.toLowerCase()));
const antes = new Map((JSON.parse(readFileSync(join(PASTA, 'antes.json'), 'utf8')).linhas as any[]).map((l) => [l.id.toLowerCase(), l]));
const rodada = new Map<string, any>();
for (const f of readdirSync(join(PASTA, 'projetos'))) { const d = JSON.parse(readFileSync(join(PASTA, 'projetos', f), 'utf8')); if (d.http === 200 && d.resultado?.ok) rodada.set(String(d.id).toLowerCase(), d); }
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(`'${PROD}'!A1:BZ`)}`, { headers: H });
const v = (await r.json()).values as string[][]; const h = v[0]; const ci = (n: string) => { const i = h.indexOf(n); if (i < 0) throw new Error(`coluna ${n}`); return i; };
const I = { id: ci('ID Projeto'), est: ci('Estrelas'), status: ci('Status'), nome: ci('Projeto') };
const motivos: Record<string, number> = {}; const muds: any[] = []; const revisar: any[] = []; const data: { range: string; values: string[][] }[] = [];
const pula = (m: string) => { motivos[m] = (motivos[m] ?? 0) + 1; };
v.slice(1).forEach((row, idx) => {
  const id = (row[I.id] ?? '').trim().toLowerCase(); if (!id) return;
  const d = rodada.get(id); if (!d) return; // não avaliado
  const a = antes.get(id); const atual = String(row[I.est] ?? '').trim(); const atualN = Number(atual);
  const status = String(row[I.status] ?? '').trim().toLowerCase();
  if (/descontinuad|reprovad/.test(status)) return pula('status fora do funil');
  if (protegidos.has(id)) return pula('estrela decidida por humano (log)');
  if (Number.isFinite(atualN) && atualN >= 6) return pula('célula ≥ 6 (comitê)');
  const antesV = String(a?.estrelas ?? '').trim();
  if (a && atual !== antesV && !(atual === '' && antesV === '0') && !(atual === '0' && antesV === '')) return pula('mudada à mão depois da cópia');
  const res = d.resultado; const e = res.estrela ?? {};
  if (res.junta?.flag6a10) return pula('agente 6-10 (comitê crava)');
  const nota = typeof e.estrelas_time === 'number' ? e.estrelas_time : e.estrelas;
  if (typeof nota !== 'number' || nota < 0 || nota > 5) return pula('agente sem nota 0-5');
  if (String(nota) === atual) return pula('já igual');
  // Revisão da transição (11/09): nota humana ≥3 é julgamento deliberado (0 é o estado inicial da coluna) — o agente
  // não a derruba 2+ níveis (Godash 5→1, Prazo Otimizado 4→0, Shipping hub 4→1); e nota humana ≥1 não sobe 3+ níveis
  // (Envio de Comprovante 1→5) salvo quando o eixo de TAMANHO fez o piso (Simulador de Custos, R$70k, 2→5).
  const prevN = Number(antesV || '0');
  if (Number.isFinite(prevN) && prevN >= 3 && nota <= prevN - 2) { revisar.push({ nome: row[I.nome], de: prevN, para: nota, motivo: 'queda ≥2 sobre nota humana ≥3' }); return pula('revisão manual: queda grande'); }
  if (Number.isFinite(prevN) && prevN >= 1 && nota >= prevN + 3 && !e.piso_impacto) { revisar.push({ nome: row[I.nome], de: prevN, para: nota, motivo: 'salto ≥3 sobre nota humana ≥1' }); return pula('revisão manual: salto grande'); }
  muds.push({ linha: idx + 2, id, nome: row[I.nome], de: atual, para: nota });
  data.push({ range: `'${PROD}'!${col(I.est)}${idx + 2}`, values: [[String(nota)]] });
});
const dist: Record<string, number> = {}; for (const m of muds) { const k = `${m.de || '∅'}→${m.para}`; dist[k] = (dist[k] ?? 0) + 1; }
console.log(JSON.stringify({ avaliados: rodada.size, mudancas: muds.length, pulados: motivos, transicoes: Object.fromEntries(Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 25)), aplicar: APLICAR }, null, 1));
console.log('REVISÃO MANUAL (não gravadas):'); for (const r of revisar) console.log(`  ${String(r.nome).slice(0, 44)} ${r.de}→${r.para} · ${r.motivo}`);
if (!APLICAR) { console.log('(dry) nada gravado'); process.exit(0); }
mkdirSync(join(PASTA, 'backup-godocs'), { recursive: true });
const bk = join(PASTA, 'backup-godocs', `GoDocs-estrelas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(bk, JSON.stringify({ header: h, rows: v.slice(1) })); console.log('backup:', bk);
for (let i = 0; i < data.length; i += 400) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 400) }) });
  const j = await res.json(); if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${JSON.stringify(j).slice(0, 300)}`); console.log(`lote ${i / 400 + 1}: ${j.totalUpdatedCells} células`);
}
writeFileSync(join(PASTA, 'estrelas-agente-gravadas.json'), JSON.stringify({ em: new Date().toISOString(), mudancas: muds }, null, 1)); console.log('OK');
