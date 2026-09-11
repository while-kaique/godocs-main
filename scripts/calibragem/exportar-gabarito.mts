// Exporta de PROD o que GENTE decidiu (auditoria `admin_activity_log`): estrelas e status por humano.
// Uso: npx tsx --env-file=.env scripts/calibragem/exportar-gabarito.mts [saida.json]
const BASE = process.env.GAB_BASE_URL || 'https://godocs.devgogroup.com';
const COOKIE = process.env.E2E_COOKIE || '';
if (!COOKIE) throw new Error('E2E_COOKIE ausente');
const OUT = process.argv[2] || 'docs/baselines/rodadas/gabarito-atividades.json';
const itens: unknown[] = [];
let cursor: string | null = null; let paginas = 0;
do {
  const u = new URL(`${BASE}/api/admin/atividades`); u.searchParams.set('limit', '200'); if (cursor) u.searchParams.set('cursor', cursor);
  const r = await fetch(u, { headers: { Cookie: COOKIE } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { itens?: unknown[]; items?: unknown[]; proximoCursor?: string | null; cursor?: string | null };
  const lote = j.itens ?? j.items ?? [];
  itens.push(...lote); cursor = j.proximoCursor ?? null; paginas++;
  console.log(`página ${paginas}: ${lote.length} (total ${itens.length})`);
} while (cursor && paginas < 100);
const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, JSON.stringify({ exportado_em: new Date().toISOString(), total: itens.length, itens }, null, 2));
const acoes: Record<string, number> = {}; for (const i of itens as any[]) acoes[i.acao] = (acoes[i.acao] ?? 0) + 1;
console.log('por ação:', JSON.stringify(acoes));
