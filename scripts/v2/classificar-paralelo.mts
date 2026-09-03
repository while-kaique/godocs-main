/**
 * Classifica os especiais em PARALELO, um projeto por requisição.
 *
 * ⚠️ Por que não `classificar-pendentes` com `limite`: ela processa em SÉRIE dentro de uma
 * requisição só — medido em prod, 61 s para 2 projetos (~30 s de LLM cada). Com 65 especiais
 * isso é meia hora, e requisição longa ainda morre no edge. A rota `/classificar` recebe UM
 * `projetoId`, então o paralelismo mora aqui, no cliente, onde dá para limitar.
 *
 * ⚠️ A concorrência é BAIXA de propósito. O gateway do proxy tem ~8 slots de Codex
 * compartilhados com produção: saturá-lo devolve 502 e transforma "não é feature" em "não deu
 * para perguntar". Por isso `CONCORRENCIA` fica abaixo disso, e falha vira RELATÓRIO, nunca
 * silêncio.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/v2/classificar-paralelo.mts          # ensaio
 *   npx tsx --env-file=.env scripts/v2/classificar-paralelo.mts --go     # grava
 */

const BASE = process.argv.includes('--staging')
  ? 'https://godocs-staging.devgogroup.com'
  : 'https://godocs.devgogroup.com';
const VALENDO = process.argv.includes('--go');
const COOKIE = process.env.E2E_COOKIE ?? '';
const CONCORRENCIA = Number(process.env.CONC ?? 6);
const TIMEOUT_MS = 180_000;

type Rec = { estrelas_recomendada?: number; confianca?: string; leitura?: string; contestada?: boolean };
type Saida = { ok?: boolean; recomendacao?: Rec; motivo?: string };

async function post<T>(rota: string, corpo: unknown): Promise<T> {
  const r = await fetch(`${BASE}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify(corpo),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (r.status === 302 || r.status === 307) throw new Error('E2E_COOKIE vencido');
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 160)}`);
  return JSON.parse(t) as T;
}

type Alvo = { id: string; nome: string; estrelas: number | null; area?: string };
let projetos: Alvo[];
if (process.env.APROVADOS === '1') {
  // Todos os APROVADOS da planilha (especiais e normais). O classificador aceita os dois:
  // ele julga o que o projeto FAZ, e a régua é a mesma.
  const { getAccessToken } = await import('/home/notebook/godocs-wt-categoria-aglutinacao/src/lib/google/auth');
  const SP = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
  const tk = await getAccessToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values/GoDocs`, {
    headers: { Authorization: `Bearer ${tk}` },
  });
  const { values = [] } = (await r.json()) as { values?: string[][] };
  const [h, ...ls] = values;
  const c = (n: string) => h.indexOf(n);
  const iId = c('ID Projeto'), iNome = c('Projeto'), iSt = c('Status'), iEst = c('Estrelas'), iAr = c('Área');
  projetos = ls
    .filter((l) => (l[iSt] ?? '').trim().toLowerCase() === 'aprovado' && (l[iId] ?? '').trim())
    .map((l) => ({
      id: (l[iId] ?? '').trim(),
      nome: (l[iNome] ?? '').trim(),
      estrelas: (l[iEst] ?? '').trim() ? Number((l[iEst] ?? '').replace(',', '.')) : null,
      area: (l[iAr] ?? '').trim(),
    }));
} else {
  const lista = (await (
    await fetch(`${BASE}/api/admin/especiais`, { headers: { Cookie: COOKIE }, signal: AbortSignal.timeout(120_000) })
  ).json()) as { projetos?: Alvo[] };
  projetos = lista.projetos ?? [];
}
console.log(`${projetos.length} especiais · concorrência ${CONCORRENCIA} · ${VALENDO ? 'VALENDO' : 'ENSAIO'}\n`);

const notas = new Map<number, number>();
const linhas: Array<{ id: string; nome: string; area: string; humana: number | null; agente: number | null; leitura: string }> = [];
const falhas: Array<{ id: string; erro: string }> = [];
let feitos = 0;
const t0 = Date.now();

async function trabalhar(fila: typeof projetos): Promise<void> {
  for (;;) {
    const p = fila.shift();
    if (!p) return;
    try {
      const s = await post<Saida>('/api/admin/especiais/classificar', {
        projetoId: p.id,
        dry: !VALENDO,
        forcar: true,
      });
      const nota = s.recomendacao?.estrelas_recomendada ?? null;
      if (nota != null) notas.set(nota, (notas.get(nota) ?? 0) + 1);
      linhas.push({ id: p.id, nome: p.nome, area: p.area ?? '', humana: p.estrelas, agente: nota, leitura: s.recomendacao?.leitura ?? s.motivo ?? '' });
    } catch (e) {
      // ⚠️ Falha NÃO é nota 0: sem esta lista, uma rajada de 502 viraria "a base é toda baixa".
      falhas.push({ id: p.id, erro: e instanceof Error ? e.message : String(e) });
    }
    feitos++;
    process.stdout.write(`   ${feitos}/${projetos.length} · ${Math.round((Date.now() - t0) / 1000)}s\r`);
  }
}

const fila = [...projetos];
await Promise.all(Array.from({ length: CONCORRENCIA }, () => trabalhar(fila)));

// ⚠️ REPESCAGEM. Concorrência alta satura o gateway e devolve 502 — e um 502 NÃO é "nota
// baixa", é "ninguém perguntou". Sem esta volta, subir a concorrência trocaria tempo por
// buracos silenciosos no relatório. Uma passada só, com metade da concorrência.
if (falhas.length) {
  console.log(`\n\nrepescando ${falhas.length} falhas com concorrência ${Math.ceil(CONCORRENCIA / 2)}…`);
  const refazer = falhas.map((f) => projetos.find((p) => p.id === f.id)!).filter(Boolean);
  falhas.length = 0;
  feitos = 0;
  const fila2 = [...refazer];
  await Promise.all(Array.from({ length: Math.ceil(CONCORRENCIA / 2) }, () => trabalhar(fila2)));
}

console.log(`\n\nfeitos em ${Math.round((Date.now() - t0) / 1000)}s · falhas: ${falhas.length}`);
const dist = [...notas.entries()].sort((a, b) => a[0] - b[0]);
console.log(`distribuição: ${dist.map(([k, v]) => `${k}*:${v}`).join(' · ')}`);
const escape = dist.filter(([k]) => k >= 6).reduce((a, [, v]) => a + v, 0);
console.log(`faixa 6-10 ("Muda o Jogo"): ${escape}\n`);

console.log('MAIORES NOTAS DO AGENTE:');
for (const l of linhas.filter((l) => (l.agente ?? 0) >= 4).sort((a, b) => (b.agente ?? 0) - (a.agente ?? 0)).slice(0, 20))
  console.log(`  ${l.agente}* (humano ${l.humana ?? '-'})  ${l.nome.slice(0, 52)}`);

console.log('\nMAIORES DIVERGÊNCIAS contra a nota humana:');
const div = linhas
  .filter((l) => l.humana != null && l.agente != null)
  .map((l) => ({ ...l, d: Math.abs((l.humana as number) - (l.agente as number)) }))
  .sort((a, b) => b.d - a.d)
  .slice(0, 12);
for (const l of div) console.log(`  humano ${l.humana} × agente ${l.agente}  ${l.nome.slice(0, 48)}`);

if (falhas.length) {
  console.log('\nFALHAS (não são nota baixa — ninguém perguntou):');
  for (const f of falhas.slice(0, 10)) console.log(`  ${f.id}: ${f.erro.slice(0, 90)}`);
}

const destino = process.env.SAIDA_JSON;
if (destino) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(destino, JSON.stringify({ linhas, falhas, dist }, null, 1));
  console.log(`\nrelatório: ${destino}`);
}
