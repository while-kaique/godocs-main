// RODADA DE CALIBRAGEM — dirige o time de agentes da STAGING sobre a aba de cópia, com ESCRITA REAL.
//
// Uso: CAL_BASE_URL=https://godocs-staging.devgogroup.com CAL_CONC=5 npx tsx --env-file=.env scripts/calibragem/rodar-noite.mts [pasta-saida]
// Precisa de E2E_COOKIE no .env (cookie SESSION do edge). Resumível: pula ids que já têm JSON na pasta.
// Ordem: canários → Pendentes → com estrela humana ≥1 → resto. Descontinuado fica fora (não é etapa do funil).
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAccessToken } from '../../src/lib/google/auth.ts';

const BASE = process.env.CAL_BASE_URL || 'https://godocs-staging.devgogroup.com';
const COOKIE = process.env.E2E_COOKIE || '';
const CONC = Math.max(1, Number(process.env.CAL_CONC || 5));
const ABA = process.env.CAL_ABA || 'Cópia de GoDocs 1';
const LIMITE = Number(process.env.CAL_LIMITE || 0); // 0 = todos
const TIMEOUT_MS = 330_000;
const OUT = process.argv[2] || `docs/baselines/rodadas/noite-${new Date().toISOString().slice(0, 10)}`;
if (!COOKIE) throw new Error('E2E_COOKIE ausente no .env');
mkdirSync(join(OUT, 'projetos'), { recursive: true });

const CANARIOS = [/^sendapp$/i, /^cx hub/i, /avd central v2/i, /^piapp$/i, /rob[oô] (de )?or[çc]amento/i, /^gobrands$/i];

// ── snapshot ANTES (a régua da comparação) ──
const sid = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const tok = await getAccessToken();
// Leitura com RETRY: a cota do Sheets (60 leituras/min, compartilhada com prod) devolve 429 depois de uma
// rajada, e `values` vem vazio — o driver morria em `header.indexOf`. 4 tentativas com espera crescente.
const vals = async (r: string): Promise<string[][]> => {
  for (let t = 1; t <= 4; t++) {
    try {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(`'${ABA}'!${r}`)}`, { headers: { Authorization: `Bearer ${tok}` } });
      const j = (await res.json()) as { values?: string[][]; error?: unknown };
      if (res.ok && Array.isArray(j.values)) return j.values;
      console.log(`[noite] leitura ${r} falhou (HTTP ${res.status}) — tentativa ${t}/4`);
    } catch (e) { console.log(`[noite] leitura ${r} erro — tentativa ${t}/4: ${e instanceof Error ? e.message : String(e)}`); }
    await new Promise((ok) => setTimeout(ok, 20_000 * t));
  }
  throw new Error(`Sheets não respondeu a leitura de ${r} após 4 tentativas`);
};
const header = (await vals('1:1'))[0];
const rows = await vals('A2:BZ');
const col = (n: string) => header.indexOf(n);
const c = { id: col('ID Projeto'), nome: col('Projeto'), status: col('Status'), est: col('Estrelas'), ea: col('Estrela Agente'), ca: col('Confiança Agente'), imp: col('Impacto Líquido Mensal'), cat: col('Tipos de Ganho'), esp: col('Especial?') };
type Linha = { id: string; nome: string; status: string; estrelas: string; estrelaAgente: string; confiancaAgente: string; impacto: string; categorias: string; especial: string };
const antes: Linha[] = rows.map((r) => ({ id: (r[c.id] ?? '').trim(), nome: r[c.nome] ?? '', status: (r[c.status] ?? '').trim(), estrelas: r[c.est] ?? '', estrelaAgente: r[c.ea] ?? '', confiancaAgente: r[c.ca] ?? '', impacto: r[c.imp] ?? '', categorias: r[c.cat] ?? '', especial: r[c.esp] ?? '' })).filter((l) => l.id);
const antesPath = join(OUT, 'antes.json');
if (!existsSync(antesPath)) writeFileSync(antesPath, JSON.stringify({ aba: ABA, capturado_em: new Date().toISOString(), linhas: antes }, null, 2));
console.log(`[noite] ${antes.length} linhas na aba "${ABA}" · saída em ${OUT}`);

// ── fila ordenada ──
const eCanario = (l: Linha) => CANARIOS.some((re) => re.test(l.nome.trim()));
const ePendente = (l: Linha) => /^pendente$/i.test(l.status);
const temEstrela = (l: Linha) => Number(l.estrelas) >= 1;
const fora = (l: Linha) => /descontinuad/i.test(l.status);
let fila = [
  ...antes.filter(eCanario),
  ...antes.filter((l) => !eCanario(l) && ePendente(l)),
  ...antes.filter((l) => !eCanario(l) && !ePendente(l) && temEstrela(l)),
  ...antes.filter((l) => !eCanario(l) && !ePendente(l) && !temEstrela(l)),
].filter((l) => !fora(l));
// CAL_SO_STATUS="Aprovado,Pendente" restringe a fila aos status listados (a entrega das estrelas é dos aprovados).
const soStatus = (process.env.CAL_SO_STATUS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
if (soStatus.length) fila = fila.filter((l) => eCanario(l) || soStatus.includes(l.status.trim().toLowerCase()));
// Só conta como FEITO quem tem resposta 2xx/4xx: falha 5xx fica para a próxima passada.
// CAL_ORDEM=critico: dentro da fila, primeiro quem tem nota humana ≥ 4, depois impacto líquido desc.
if (process.env.CAL_ORDEM === 'critico') {
  const imp = (l: Linha) => { const n = Number(String(l.impacto ?? '').replace(/R\$/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const crit = (l: Linha) => (eCanario(l) ? 3 : Number(l.estrelas) >= 4 ? 2 : imp(l) >= 1000 ? 1 : 0);
  fila = [...fila].sort((a, b) => crit(b) - crit(a) || imp(b) - imp(a));
}
const feitos = new Set(
  readdirSync(join(OUT, 'projetos'))
    .filter((f) => { try { return (JSON.parse(readFileSync(join(OUT, 'projetos', f), 'utf8')).http ?? 599) < 500; } catch { return false; } })
    .map((f) => f.replace(/\.json$/, '')),
);
fila = fila.filter((l) => !feitos.has(l.id.toLowerCase()));
if (LIMITE > 0) fila = fila.slice(0, LIMITE);
if (process.env.CAL_SO_FILA) { console.log(fila.slice(0, 12).map((l) => `${l.id} ${l.status}/${l.estrelas || '-'} ${l.nome.slice(0, 50)}`).join('\n')); console.log(`[noite] (só fila) total ${fila.length}`); process.exit(0); }
console.log(`[noite] fila: ${fila.length} (canários ${antes.filter(eCanario).length}, pendentes ${antes.filter(ePendente).length}, com estrela ${antes.filter(temEstrela).length}) · já feitos ${feitos.size} · conc ${CONC}`);

// ── execução ──
const log = (s: string) => { const linha = `${new Date().toISOString()} ${s}`; console.log(linha); writeFileSync(join(OUT, 'progresso.log'), linha + '\n', { flag: 'a' }); };
async function avaliar(l: Linha) {
  const t0 = Date.now();
  for (let tent = 1; tent <= 2; tent++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${BASE}/api/admin/avaliacao/time-completo`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: JSON.stringify({ projetoId: l.id }), signal: ctrl.signal });
      clearTimeout(timer);
      const txt = await r.text();
      let body: unknown = null; try { body = JSON.parse(txt); } catch { body = { raw: txt.slice(0, 500) }; }
      const ms = Date.now() - t0;
      const out = { id: l.id, nome: l.nome, antes: l, http: r.status, ms, tentativa: tent, resultado: body };
      // 5xx só é persistido na 2ª tentativa (registro da falha); a 1ª tenta de novo.
      if (r.status < 500 || tent === 2) writeFileSync(join(OUT, 'projetos', `${l.id.toLowerCase()}.json`), JSON.stringify(out, null, 2));
      const j = (body as any)?.junta; const e = (body as any)?.estrela; const m = (body as any)?.mesa;
      log(`${r.status} ${Math.round(ms / 1000)}s ${l.id} «${l.nome.slice(0, 40)}» antes=${l.status}/${l.estrelas || '-'} → junta=${j?.status ?? '?'} 6-10=${j?.flag6a10 ? 'S' : 'N'} estrela=${e?.estrelas ?? e?.motivo ?? '?'} mesa=${m?.veredito ?? m?.motivo ?? '?'} conf=${j?.confianca ?? '?'} gravado=${(body as any)?.status_gravado ?? '-'}`);
      if (r.status < 500) return;
    } catch (err) {
      clearTimeout(timer);
      log(`ERRO ${l.id} tentativa ${tent}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
let idx = 0; const t00 = Date.now();
await Promise.all(Array.from({ length: CONC }, async () => { while (idx < fila.length) { const l = fila[idx++]; await avaliar(l); } }));
log(`FIM ${fila.length} projetos em ${Math.round((Date.now() - t00) / 60000)} min`);
