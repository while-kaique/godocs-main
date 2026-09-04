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

import { rodarPoolAdaptativo } from './_concorrencia.mts';

const BASE = process.argv.includes('--staging')
  ? 'https://godocs-staging.devgogroup.com'
  : 'https://godocs.devgogroup.com';
const VALENDO = process.argv.includes('--go');
const COOKIE = process.env.E2E_COOKIE ?? '';
// Concorrência ADAPTATIVA (ver `_concorrencia.mts`): `CONC` é o PONTO DE PARTIDA, não o teto.
// A rodada sobe sozinha enquanto o gateway aguenta e recua pela metade ao primeiro 502 — que é
// o que permite ir mais rápido SEM atropelar produção, com quem divide os slots de Codex.
const CONC_INICIAL = Number(process.env.CONC ?? 24);
const CONC_MAX = Number(process.env.CONC_MAX ?? 72);
const CONC_MIN = Number(process.env.CONC_MIN ?? 4);
const TIMEOUT_MS = 180_000;

type Rec = { estrelas_recomendada?: number; confianca?: string; leitura?: string; contestada?: boolean };
type Saida = {
  ok?: boolean;
  recomendacao?: Rec;
  motivo?: string;
  // resposta do TIME (`/painel-projeto`)
  julgamento?: { nota?: number; nota_lentes?: number; confianca?: string; avaliacoes?: { lente: string; nota: number; piso?: string | null }[] };
  base?: { nota?: number; leitura?: string };
  ajuste?: { delta?: number; motivo?: string };
};

/**
 * Qual juiz roda: o classificador de 1 agente (`AGENTE`, o do run 1) ou o TIME de lentes
 * (`TIME`), que usa aquele como base e ajusta em um degrau.
 *
 * ⚠️ Uma rota por juiz, mas UM script: o que muda entre eles é a forma da resposta, não o
 * paralelismo, o relatório nem a repescagem. Dois scripts divergiriam no primeiro ajuste, e a
 * comparação entre as duas rodadas passaria a medir a diferença entre os scripts.
 */
const JUIZ = (process.env.JUIZ ?? 'AGENTE').toUpperCase() === 'TIME' ? 'TIME' : 'AGENTE';
const ROTA = JUIZ === 'TIME' ? '/api/admin/especiais/painel-projeto' : '/api/admin/especiais/classificar';

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

type Alvo = { id: string; nome: string; estrelas: number | null; area?: string; especial?: boolean };
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
  const iEsp = c('Especial?');
  projetos = ls
    .filter((l) => (l[iSt] ?? '').trim().toLowerCase() === 'aprovado' && (l[iId] ?? '').trim())
    .map((l) => ({
      id: (l[iId] ?? '').trim(),
      nome: (l[iNome] ?? '').trim(),
      estrelas: (l[iEst] ?? '').trim() ? Number((l[iEst] ?? '').replace(',', '.')) : null,
      area: (l[iAr] ?? '').trim(),
      // ⚠️ Vai para o relatório porque "com nota humana" sem essa quebra ENGANA: dá a entender
      // que a triagem estrelou centenas de especiais, quando são 59 especiais e 459 normais.
      especial: /^s/i.test((l[iEsp] ?? '').trim()),
    }));
} else {
  const lista = (await (
    await fetch(`${BASE}/api/admin/especiais`, { headers: { Cookie: COOKIE }, signal: AbortSignal.timeout(120_000) })
  ).json()) as { projetos?: Alvo[] };
  projetos = lista.projetos ?? [];
}
// Recorte por id: completar uma baseline exige rodar SÓ o que faltou, sem repassar por cima
// dos que já têm nota (a rodada é cara e reescrever o que já está medido apaga a comparação).
if (process.env.SOMENTE_IDS) {
  const alvo = new Set(process.env.SOMENTE_IDS.split(/[,\s]+/).filter(Boolean).map((x) => x.toLowerCase()));
  projetos = projetos.filter((p) => alvo.has(p.id.toLowerCase()));
  console.log(`recorte SOMENTE_IDS: ${projetos.length} de ${alvo.size} ids pedidos`);
}

console.log(`juiz ${JUIZ} (${ROTA})`);
if (VALENDO) {
  const semNota = projetos.filter((p) => p.estrelas == null).length;
  console.log(`gravando em ${semNota} projetos SEM nota humana; os outros ${projetos.length - semNota} são medidos mas não gravados`);
}
console.log(`${projetos.length} projetos · concorrência adaptativa ${CONC_INICIAL}→${CONC_MAX} (piso ${CONC_MIN}) · ${VALENDO ? 'VALENDO' : 'ENSAIO'}\n`);

const notas = new Map<number, number>();
const linhas: Array<{
  id: string; nome: string; area: string; humana: number | null; especial?: boolean; agente: number | null;
  confianca?: string | null; leitura: string;
  base?: number | null; delta?: number; ajuste?: string; lentes?: { l: string; n: number; piso: string | null }[];
}> = [];
const falhas: Array<{ id: string; erro: string }> = [];
let feitos = 0;
const t0 = Date.now();

async function classificar(p: Alvo): Promise<void> {
  try {
    // ⚠️ `dry` é decidido POR PROJETO, não pela run.
    //
    // Numa run que grava, quem JÁ TEM nota humana continua em ensaio: a nota de gente é verdade
    // e âncora, e escrever uma recomendação por cima dela é o ruído que o invariante
    // "projeto com nota humana não é reclassificado" existe para evitar (o PIAPP é 10 e o
    // agente não vai sugerir 3 no cartão dele). Mas a nota AINDA é calculada, porque sem ela não
    // há como medir concordância justamente onde existe gabarito.
    const temNotaHumana = p.estrelas != null;
    const s = await post<Saida>(ROTA, {
      projetoId: p.id,
      dry: !VALENDO || temNotaHumana,
      forcar: true,
    });
    const nota = (JUIZ === 'TIME' ? s.julgamento?.nota : s.recomendacao?.estrelas_recomendada) ?? null;
    if (nota != null) notas.set(nota, (notas.get(nota) ?? 0) + 1);
    linhas.push({
      id: p.id,
      nome: p.nome,
      area: p.area ?? '',
      humana: p.estrelas,
      especial: p.especial ?? false,
      agente: nota,
      // ⚠️ Sem isto a medição de "alta acerta mais que média?" fica impossível depois: a run é
      // dry, então nada vai para `especial_avaliacao` e a confiança se perde com o processo.
      confianca: (JUIZ === 'TIME' ? s.julgamento?.confianca : s.recomendacao?.confianca) ?? null,
      leitura: (JUIZ === 'TIME' ? s.base?.leitura : s.recomendacao?.leitura) ?? s.motivo ?? '',
      // Só no TIME: dá para auditar o ajuste depois sem reabrir cada projeto.
      ...(JUIZ === 'TIME'
        ? {
            base: s.base?.nota ?? null,
            delta: s.ajuste?.delta ?? 0,
            ajuste: s.ajuste?.motivo ?? '',
            lentes: (s.julgamento?.avaliacoes ?? []).map((a) => ({ l: a.lente, n: a.nota, piso: a.piso ?? null })),
          }
        : {}),
    });
  } catch (e) {
    // ⚠️ Falha NÃO é nota 0: sem esta lista, uma rajada de 502 viraria "a base é toda baixa".
    // O pool re-tenta a saturação sozinho; o que chega aqui já esgotou as tentativas.
    falhas.push({ id: p.id, erro: e instanceof Error ? e.message : String(e) });
    throw e; // devolve ao pool para ele decidir recuar/re-enfileirar
  }
}

const rel = await rodarPoolAdaptativo({
  itens: projetos,
  inicial: CONC_INICIAL,
  maximo: CONC_MAX,
  minimo: CONC_MIN,
  tarefa: async (p) => {
    // Uma re-tentativa do pool não pode deixar a falha anterior no relatório.
    const i = falhas.findIndex((f) => f.id === p.id);
    if (i >= 0) falhas.splice(i, 1);
    await classificar(p);
  },
  aoProgredir: (f, t, alvo) => {
    feitos = f;
    process.stdout.write(`   ${f}/${t} · ${Math.round((Date.now() - t0) / 1000)}s · conc ${alvo}    \r`);
  },
});
console.log(`\n\nconcorrência: terminou em ${rel.alvoFinal} (pico ${rel.alvoMax}, piso ${rel.alvoMin}) · ${rel.recuos} recuos · ${rel.reentradas} re-tentativas`);

// ⚠️ REPESCAGEM. O pool já re-tenta a saturação, mas uma rajada longa pode esgotar as
// tentativas de um item. Uma passada final, conservadora, para 502 nunca virar buraco no
// relatório — a diferença entre "não é feature" e "ninguém perguntou".
if (falhas.length) {
  console.log(`\nrepescando ${falhas.length} falhas em ritmo conservador…`);
  const refazer = falhas.map((f) => projetos.find((p) => p.id === f.id)!).filter(Boolean);
  falhas.length = 0;
  await rodarPoolAdaptativo({
    itens: refazer,
    inicial: CONC_MIN,
    maximo: Math.max(CONC_MIN, 8),
    minimo: 2,
    tarefa: classificar,
  });
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
  // ⚠️ O relatório carrega COMO foi rodado, não só o resultado. Sem isso, comparar duas runs
  // vira adivinhação sobre o que mudou entre elas: juiz, se gravou, quando, quantas falhas.
  const meta = {
    run: process.env.RUN_ROTULO ?? null,
    juiz: JUIZ,
    rota: ROTA,
    gravou: VALENDO,
    rodado_em: new Date().toISOString(),
    projetos: projetos.length,
    falhas: falhas.length,
    duracao_s: Math.round((Date.now() - t0) / 1000),
    concorrencia: { final: rel.alvoFinal, pico: rel.alvoMax, piso: rel.alvoMin, recuos: rel.recuos },
  };
  await writeFile(destino, JSON.stringify({ meta, linhas, falhas, dist }, null, 1));
  console.log(`\nrelatório: ${destino}`);
}
