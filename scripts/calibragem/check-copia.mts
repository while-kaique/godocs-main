// Confere a aba de cópia usada pela rodada de calibragem: existe, cabeçalho idêntico ao GoDocs, contagem.
import { getAccessToken } from '../../src/lib/google/auth.ts';
const id = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const ABA = process.argv[2] || 'Cópia de GoDocs 1';
const tok = await getAccessToken();
const get = async (path: string) => (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`, { headers: { Authorization: `Bearer ${tok}` } })).json() as Promise<any>;
const meta = await get('?fields=sheets(properties(title,sheetId,gridProperties(rowCount)))');
for (const s of meta.sheets ?? []) console.log('ABA', s.properties.title, 'gid', s.properties.sheetId, 'rows', s.properties.gridProperties?.rowCount);
const vals = async (t: string, r: string) => ((await get(`/values/${encodeURIComponent(`'${t}'!${r}`)}`)).values ?? []) as string[][];
const a = (await vals('GoDocs', '1:1'))[0] ?? []; const b = (await vals(ABA, '1:1'))[0] ?? [];
console.log('HEADER GoDocs', a.length, ABA, b.length);
const dif = a.map((h, i) => (h === b[i] ? null : `${i}: "${h}" vs "${b[i]}"`)).filter(Boolean);
console.log('DIF', dif.length ? dif : 'idênticos');
const cnt = async (t: string) => (await vals(t, 'B2:B')).filter((v) => (v[0] ?? '').trim()).length;
console.log('IDS GoDocs', await cnt('GoDocs'), ABA, await cnt(ABA));
const st = async (t: string) => { const rows = await vals(t, 'A2:BZ'); const hi = (await vals(t,'1:1'))[0]; const iS = hi.indexOf('Status'), iE = hi.indexOf('Estrelas'), iEA = hi.indexOf('Estrela Agente'); const c: Record<string, number> = {}; let est = 0, ea = 0; for (const r of rows) { const s = (r[iS] ?? '').trim() || '(vazio)'; c[s] = (c[s] ?? 0) + 1; if ((r[iE] ?? '').trim() && Number(r[iE]) >= 1) est++; if ((r[iEA] ?? '').trim() && r[iEA] !== '—') ea++; } return { status: c, estrelas_ge1: est, estrela_agente_preenchida: ea }; };
console.log(ABA, JSON.stringify(await st(ABA)));
