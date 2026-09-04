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

/**
 * Agrupa os motivos de recuo por CAUSA, com a contagem.
 *
 * ⚠️ Era `[...new Set(motivos)]`, e a deduplicação escondia a única informação que importa: na
 * run 8 foram **47 recuos** e o relatório mostrava **3 linhas**, o que me fez concluir (errado)
 * que 44 recuos não tinham motivo. Saber que a causa foi 429 do gateway, e não 502 de borda,
 * é a diferença entre pedir mais concorrência e caçar bug no nosso lado.
 */
function contarMotivos(motivos: string[]): string[] {
  const cont = new Map<string, number>();
  for (const m of motivos) {
    const chave = (m.match(/HTTP \d+(?:: [^\n{<]{0,60})?/) ?? [m.slice(0, 60)])[0].trim();
    cont.set(chave, (cont.get(chave) ?? 0) + 1);
  }
  return [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}x ${k}`);
}

const BASE = process.argv.includes('--staging')
  ? 'https://godocs-staging.devgogroup.com'
  : 'https://godocs.devgogroup.com';
const VALENDO = process.argv.includes('--go');
const COOKIE = process.env.E2E_COOKIE ?? '';
// Concorrência ADAPTATIVA (ver `_concorrencia.mts`): `CONC` é o PONTO DE PARTIDA, não o teto.
// A rodada sobe sozinha enquanto o gateway aguenta e recua pela metade ao primeiro 502 — que é
// o que permite ir mais rápido SEM atropelar produção, com quem divide os slots de Codex.
// ⚠️ O ai-proxy passou de 32 para 64 de concorrência (04/09/2026), com fila de 150.
//
// A conta que importa NÃO é projetos, é CHAMADAS: as 5 lentes rodam em paralelo dentro de cada
// projeto, então cada unidade que eu agendo vale ~7 chamadas simultâneas. Com 32 o pool
// estabilizava em 4 a 6 projetos (~28 a 42 chamadas); com 64 o espaço é o dobro. O ponto de
// partida sobe junto, e o pool continua recuando sozinho se o gateway devolver 502/503/429 —
// que é o que ele sabe fazer melhor do que eu adivinhar o número.
const CONC_INICIAL = Number(process.env.CONC ?? 16);
/**
 * ⚠️ O teto fica ACIMA do que os slots comportam, e o motivo NÃO é vazão.
 *
 * A vazão é `slots ÷ tempo médio da chamada`: fila mais funda não faz nada terminar antes, só
 * evita a recusa. O ganho de sobrecarregar de leve é OUTRO — enquanto houver excedente
 * esperando, nenhum slot fica ocioso entre uma chamada e outra, e o pool para de oscilar. Nas
 * runs 5 a 7 ele passava o tempo caindo de 8 para 4 e voltando, porque o excedente virava 502 e
 * era lido como saturação; com fila grande o excedente espera e a concorrência fica estável.
 *
 * Subir muito além disso é desperdício: as chamadas empilham, cada projeto demora mais e o
 * relógio total não muda.
 */
const CONC_MAX = Number(process.env.CONC_MAX ?? 32);
const CONC_MIN = Number(process.env.CONC_MIN ?? 4);
// ⚠️ 180s era baixo demais: o proxy tem FILA de 150, então esperar é normal e não é falha.
// Com o limite curto, a espera virava "timeout", o pool lia saturação e cortava a concorrência.
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 600_000);

type Rec = { estrelas_recomendada?: number; confianca?: string; leitura?: string; contestada?: boolean };
type Auditoria = {
  ok?: boolean;
  motivo?: string;
  ajustaria?: boolean;
  valor_declarado?: number | null;
  valor_sugerido?: number | null;
  justificativa?: string;
};
type Saida = {
  ok?: boolean;
  recomendacao?: Rec;
  motivo?: string;
  // resposta do TIME (`/painel-projeto`)
  julgamento?: { nota?: number; nota_lentes?: number; confianca?: string; avaliacoes?: { lente: string; nota: number; piso?: string | null }[] };
  base?: { nota?: number; leitura?: string };
  leitura?: string;
  incoerencias?: string[];
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

/**
 * Auditoria do VALOR declarado, além da estrela.
 *
 * ⚠️ Projeto NORMAL tem impacto em R$, e a estrela não diz nada sobre ele. A pergunta que
 * importa nesses é outra: o número que a pessoa submeteu se sustenta, ou o agente recomendaria
 * ajuste? Custa uma chamada a mais por projeto, então é OPT-IN. Só LÊ: a rota não grava nada, e
 * a sugestão do auditor só desce ou confirma.
 */
const AUDITAR_VALOR = process.env.AUDITAR_VALOR === '1';
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

console.log(`juiz ${JUIZ} (${ROTA})${AUDITAR_VALOR ? ' + auditoria de VALOR nos normais' : ''}`);
if (VALENDO) {
  const comNota = projetos.filter((p) => p.estrelas != null).length;
  console.log(`GRAVANDO recomendação em especial_avaliacao para os ${projetos.length}, incluindo ${comNota} que já têm nota humana (a coluna "Estrelas" NÃO é tocada)`);
}
console.log(`${projetos.length} projetos · concorrência adaptativa ${CONC_INICIAL}→${CONC_MAX} (piso ${CONC_MIN}) · ${VALENDO ? 'VALENDO' : 'ENSAIO'}\n`);

const notas = new Map<number, number>();
const linhas: Array<{
  id: string; nome: string; area: string; humana: number | null; especial?: boolean; agente: number | null;
  confianca?: string | null; leitura: string;
  valor_declarado?: number | null; valor_sugerido?: number | null; ajustaria?: boolean; auditoria?: string;
  base?: number | null; delta?: number; ajuste?: string; lentes?: { l: string; n: number; piso: string | null }[];
}> = [];
const falhas: Array<{ id: string; erro: string }> = [];
let feitos = 0;
const t0 = Date.now();

async function classificar(p: Alvo): Promise<void> {
  try {
    // ⚠️ Numa run que grava, grava para TODOS, inclusive quem já tem nota humana.
    //
    // O invariante "projeto com nota humana não é reclassificado" existe para o cartão não ficar
    // ruidoso, e `forcar` é a porta declarada para abri-lo em uso manual explícito. Decisão do
    // dono do produto (04/09/2026): a recomendação ao lado da nota de gente é justamente o que
    // torna a CONTESTAÇÃO DE PREÇO visível na tela, e o registro é reversível (vive em
    // `especial_avaliacao` com a origem marcada, dá para limpar ou sobrescrever).
    // ⚠️ O que continua intocável é a coluna "Estrelas": ela só muda por clique humano.
    const s = await post<Saida>(ROTA, {
      projetoId: p.id,
      dry: !VALENDO,
      forcar: true,
    });
    const nota = (JUIZ === 'TIME' ? s.julgamento?.nota : s.recomendacao?.estrelas_recomendada) ?? null;
    if (nota != null) notas.set(nota, (notas.get(nota) ?? 0) + 1);
    const linha = {
      id: p.id,
      nome: p.nome,
      area: p.area ?? '',
      humana: p.estrelas,
      especial: p.especial ?? false,
      agente: nota,
      // ⚠️ Sem isto a medição de "alta acerta mais que média?" fica impossível depois: a run é
      // dry, então nada vai para `especial_avaliacao` e a confiança se perde com o processo.
      confianca: (JUIZ === 'TIME' ? s.julgamento?.confianca : s.recomendacao?.confianca) ?? null,
      // ⚠️ No TIME é a leitura COMPOSTA que interessa, não a da base: a composta é a que vai ao
      // banco e à tela, e é ela que a verificação de coerência corrige.
      leitura: (JUIZ === 'TIME' ? (s.leitura ?? s.base?.leitura) : s.recomendacao?.leitura) ?? s.motivo ?? '',
      // Só no TIME: dá para auditar o ajuste depois sem reabrir cada projeto.
      ...(JUIZ === 'TIME'
        ? {
            base: s.base?.nota ?? null,
            delta: s.ajuste?.delta ?? 0,
            ajuste: s.ajuste?.motivo ?? '',
            // ⚠️ `a` é a CAIXA que a lente disse ter aplicado, e ela vai junto da nota de
            // propósito: a trava "a caixa vence o número" (`especiais-lentes.ts`) corrige em
            // silêncio quando o agente nomeia a âncora 2 e escreve 4, e sem gravar as duas não há
            // como saber se ela corrige três vezes ou trezentas. Trava que age sem deixar rastro
            // não é auditável, e auditar a trava é metade do trabalho da calibragem.
            lentes: (s.julgamento?.avaliacoes ?? []).map((a) => ({
              l: a.lente,
              n: a.nota,
              a: a.ancora ?? null,
              piso: a.piso ?? null,
            })),
          }
        : {}),
    };
    linhas.push(linha);

    // ⚠️ A auditoria vem DEPOIS e é isolada: falha nela não pode derrubar a estrela, que já
    // custou uma chamada. Sem isso, um 502 no auditor apagaria a nota do projeto inteiro.
    if (AUDITAR_VALOR && !p.especial) {
      try {
        // ⚠️ Escreve na REFERÊNCIA da linha deste projeto, nunca em `linhas[linhas.length-1]`.
        // Com 8 workers em paralelo, entre o push e a auditoria outro worker já empurrou a linha
        // dele, e o "último" não é o meu. Foi assim que a run 3 saiu com auditoria em 4 projetos
        // de 137: o guard `alvo.id === p.id` reprovava quase sempre, calado.
        const a = await post<Auditoria>('/api/admin/auditar-valor', { projetoId: p.id });
        if (a.ok) {
          linha.valor_declarado = a.valor_declarado ?? null;
          linha.valor_sugerido = a.valor_sugerido ?? null;
          linha.ajustaria = a.ajustaria ?? false;
          linha.auditoria = a.justificativa ?? '';
        }
      } catch {
        /* auditoria é acessória: sem ela o projeto fica sem a coluna, não sem nota */
      }
    }
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
console.log(`\n\nconcorrência: terminou em ${rel.alvoFinal} (pico ${rel.alvoMax}, piso ${rel.alvoMin}) · ${rel.recuos} recuos · ${rel.reentradas} re-tentativas · ${rel.esperas} esperas de fila`);
if (rel.motivos.length) console.log(`motivos dos recuos: ${contarMotivos(rel.motivos).slice(0, 5).join(' | ')}`);

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
    concorrencia: { final: rel.alvoFinal, pico: rel.alvoMax, piso: rel.alvoMin, recuos: rel.recuos, esperas: rel.esperas, motivos: contarMotivos(rel.motivos).slice(0, 8) },
  };
  await writeFile(destino, JSON.stringify({ meta, linhas, falhas, dist }, null, 1));
  console.log(`\nrelatório: ${destino}`);
}
