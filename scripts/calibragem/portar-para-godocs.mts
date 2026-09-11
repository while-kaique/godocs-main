// PORTA o resultado validado da aba de cópia para a aba GoDocs (prod), em LOTE, com backup.
// Uso: npx tsx --env-file=.env scripts/calibragem/portar-para-godocs.mts <pasta-da-rodada> [--aplicar]
// Sem --aplicar é DRY: só imprime o resumo do que mudaria. Com --aplicar: grava backup JSON da GoDocs e escreve.
// Régua: Estrela Agente + Confiança Agente em todas as linhas com resultado; Estrelas 0-5 só onde a nota humana
// (antes.json) era 0/vazia e o agente avaliou; Status só onde antes era Pendente e a cópia agora diz Aprovado/Reprovado
// (+ Motivo Reprovado nesse caso). Aprovado/Descontinuado/nota humana: intocados.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAccessToken } from '../../src/lib/google/auth.ts';
const PASTA = process.argv[2]; const APLICAR = process.argv.includes('--aplicar');
if (!PASTA) throw new Error('pasta da rodada obrigatória');
const sid = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const COPIA = 'Cópia de GoDocs 1', PROD = 'GoDocs';
const tok = await getAccessToken();
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const get = async (t: string, r: string) => { const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(`'${t}'!${r}`)}`, { headers: H }); const j = await res.json(); if (!res.ok) throw new Error(`GET ${t}!${r} ${res.status}: ${JSON.stringify(j).slice(0, 200)}`); return (j.values ?? []) as string[][]; };
const col = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

const antes = new Map((JSON.parse(readFileSync(join(PASTA, 'antes.json'), 'utf8')).linhas as any[]).map((l) => [l.id.toLowerCase(), l]));
// SÓ os ids que a rodada CORRIGIDA avaliou com sucesso (projetos/*.json com http 200 e ok): a cópia ainda carrega
// restos da rodada-baseline (v348) em quem não foi reavaliado, e esses NÃO podem ir para a GoDocs.
import { readdirSync } from 'node:fs';
const rodada = new Map<string, any>();
for (const f of readdirSync(join(PASTA, 'projetos'))) { const d = JSON.parse(readFileSync(join(PASTA, 'projetos', f), 'utf8')); if (d.http === 200 && d.resultado?.ok) rodada.set(String(d.id).toLowerCase(), d); }
console.log(`ids avaliados pela rodada corrigida: ${rodada.size}`);
const hC = (await get(COPIA, '1:1'))[0]; const rowsC = await get(COPIA, 'A2:BZ');
const hP = (await get(PROD, '1:1'))[0]; const rowsP = await get(PROD, 'A2:BZ');
if (hC.join('|') !== hP.join('|')) throw new Error('cabeçalhos da cópia e da GoDocs divergem — abortando');
const ci = (n: string) => { const i = hP.indexOf(n); if (i < 0) throw new Error(`coluna ${n} ausente`); return i; };
const I = { id: ci('ID Projeto'), status: ci('Status'), est: ci('Estrelas'), ea: ci('Estrela Agente'), ca: ci('Confiança Agente'), mot: ci('Motivo Reprovado'), nome: ci('Projeto') };
const copia = new Map(rowsC.map((r) => [(r[I.id] ?? '').trim().toLowerCase(), r]));

type Mud = { linha: number; nome: string; campo: string; de: string; para: string };
const muds: Mud[] = []; const cel: Record<string, { range: string; values: string[][] }[]> = {};
const set = (rowIdx: number, colIdx: number, v: string, nome: string, campo: string, de: string) => { muds.push({ linha: rowIdx + 2, nome, campo, de, para: v }); (cel[campo] ??= []).push({ range: `'${PROD}'!${col(colIdx)}${rowIdx + 2}`, values: [[v]] }); };
const vazio = (v: string | undefined) => { const t = String(v ?? '').trim(); return t === '' || t === '—' || t === '-'; };
let semResultado = 0;
rowsP.forEach((rp, idx) => {
  const id = (rp[I.id] ?? '').trim().toLowerCase(); if (!id) return;
  const rc = copia.get(id); const a = antes.get(id); const rd = rodada.get(id); if (!rc || !a || !rd) { semResultado++; return; }
  const nome = rp[I.nome] ?? id;
  const ea = rc[I.ea] ?? '', ca = rc[I.ca] ?? '';
  if (vazio(ea)) { semResultado++; return; } // o time não avaliou este id na rodada
  if ((rp[I.ea] ?? '') !== ea) set(idx, I.ea, ea, nome, 'Estrela Agente', rp[I.ea] ?? '');
  if ((rp[I.ca] ?? '') !== ca) set(idx, I.ca, ca, nome, 'Confiança Agente', rp[I.ca] ?? '');
  // Estrelas: só onde a nota humana ANTES era 0/vazia; grava a 0-5 que o agente pôs na cópia (nunca 6-10 → cópia mantém)
  // ⚠️ A nota humana pode ter mudado em PROD depois da cópia (Bruno mexeu na GoDocs de manhã): o "antes"
  // vale para a cópia, mas quem protege a GoDocs é a célula ATUAL dela. Só escreve onde AS DUAS são 0/vazias.
  const hum = Number(String(a.estrelas ?? '').trim()); const humP = Number(String(rp[I.est] ?? '').trim());
  const humOk = (Number.isFinite(hum) && hum >= 1) || (Number.isFinite(humP) && humP >= 1);
  const estC = String(rc[I.est] ?? '').trim();
  if (!humOk && estC !== '' && /^\d+$/.test(estC) && Number(estC) <= 5 && (rp[I.est] ?? '').trim() !== estC) set(idx, I.est, estC, nome, 'Estrelas', rp[I.est] ?? '');
  // Status: só onde ANTES era Pendente e a cópia decidiu
  // o Status vem do que a rodada CORRIGIDA gravou (status_gravado), nunca da coluna da cópia (pode ser resto da baseline)
  const stAntes = String(a.status ?? '').trim().toLowerCase(); const stC = String(rd.resultado?.status_gravado ?? '').trim(); const stP = String(rp[I.status] ?? '').trim();
  if (stAntes === 'pendente' && /^(Aprovado|Reprovado)$/.test(stC) && stP.toLowerCase() === 'pendente') {
    set(idx, I.status, stC, nome, 'Status', stP);
    if (stC === 'Reprovado' && !vazio(rc[I.mot])) set(idx, I.mot, rc[I.mot], nome, 'Motivo Reprovado', rp[I.mot] ?? '');
  }
});
const porCampo: Record<string, number> = {}; for (const m of muds) porCampo[m.campo] = (porCampo[m.campo] ?? 0) + 1;
console.log(JSON.stringify({ linhas_prod: rowsP.length, sem_resultado_na_copia: semResultado, mudancas: muds.length, por_campo: porCampo, aplicar: APLICAR }, null, 1));
for (const m of muds.filter((m) => m.campo === 'Status').slice(0, 40)) console.log(`  Status ${m.de} → ${m.para} · ${m.nome.slice(0, 50)}`);
if (!APLICAR) { console.log('(dry) nada gravado — rode com --aplicar'); process.exit(0); }
mkdirSync(join(PASTA, 'backup-godocs'), { recursive: true });
const bk = join(PASTA, 'backup-godocs', `GoDocs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(bk, JSON.stringify({ header: hP, rows: rowsP }));
console.log('backup:', bk);
const data = Object.values(cel).flat();
for (let i = 0; i < data.length; i += 400) {
  const lote = data.slice(i, i + 400);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: lote }) });
  const j = await res.json(); if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  console.log(`lote ${i / 400 + 1}: ${j.totalUpdatedCells} células`);
}
writeFileSync(join(PASTA, 'portado-para-godocs.json'), JSON.stringify({ em: new Date().toISOString(), mudancas: muds }, null, 1));
console.log('OK — mudanças registradas em portado-para-godocs.json');
