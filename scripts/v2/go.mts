/**
 * "GO" da v2 — encadeia, NA ORDEM CERTA, tudo que depende da chave de embeddings.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/v2/go.mts            # ENSAIO: não grava nada
 *   npx tsx --env-file=.env scripts/v2/go.mts --go       # vale
 *   npx tsx --env-file=.env scripts/v2/go.mts --staging  # aponta pra staging
 *
 * Pré-requisitos (o script CONFERE os dois e para com a razão, não com um stack trace):
 *   1. `LLM_EMBEDDINGS_KEY` com SALDO — hoje a conta devolve 429 credit_balance_exhausted.
 *   2. `E2E_COOKIE` válido — o edge do Godeploy exige OAuth em TODAS as rotas, `/api/*`
 *      incluído; sem cookie vivo tudo vira 302 para a tela de login.
 *
 * ⚠️ A ORDEM não é estética. O reembedding vem ANTES do backfill do Pinecone porque o
 * SQLite guarda vetores de TODOS os modelos já usados, e um único vetor de dimensão
 * diferente faz o Pinecone recusar o LOTE INTEIRO com 400 (foi o 1º backfill da staging,
 * 26/08: 49 vetores → 0 upsertados). E a aglutinação vem antes da classificação porque
 * "este projeto é feature daquele" muda quem é vizinho de quem.
 */

const PROD = 'https://godocs.devgogroup.com';
const STAGING = 'https://godocs-staging.devgogroup.com';

const args = new Set(process.argv.slice(2));
const valendo = args.has('--go');
const base = args.has('--staging') ? STAGING : PROD;
const cookie = process.env.E2E_COOKIE ?? '';

const t0 = Date.now();
const passo = (n: string) => console.log(`\n▸ ${n}`);
const linha = (s: string) => console.log(`   ${s}`);

/** POST autenticado numa rota admin. Devolve o JSON, ou lança com a razão legível. */
/** Uma rota de LLM pode passar de um minuto; o default do fetch derruba antes. */
const TIMEOUT_MS = 300_000;

async function chamar<T>(rota: string, corpo: unknown = {}, tentativa = 1): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${base}${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(corpo),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // ⚠️ Uma falha de rede aqui NÃO é "não havia o que fazer": desistir em silêncio faria o
    // relatório final dizer 0 sobre uma base que ninguém processou. Uma nova tentativa, e
    // depois disso o erro sobe.
    if (tentativa < 2) {
      linha(`… ${rota} falhou (${e instanceof Error ? e.message : String(e)}), tentando de novo`);
      return chamar<T>(rota, corpo, tentativa + 1);
    }
    throw new Error(`${rota}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (r.status === 302 || r.status === 307) {
    throw new Error(`E2E_COOKIE vencido (o edge redirecionou ${rota} para o login).`);
  }
  const txt = await r.text();
  if (!r.ok) throw new Error(`${rota} → HTTP ${r.status}: ${txt.slice(0, 200)}`);
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`${rota} devolveu algo que não é JSON: ${txt.slice(0, 200)}`);
  }
}

// ─── Porta 1: a chave tem saldo? ────────────────────────────────────────────
async function conferirChave(): Promise<void> {
  const chave = process.env.LLM_EMBEDDINGS_KEY || process.env.LLM_FALLBACK || '';
  if (!chave) throw new Error('LLM_EMBEDDINGS_KEY ausente do ambiente.');
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-large', input: 'ping' }),
  });
  if (r.ok) {
    const j = (await r.json()) as { data: Array<{ embedding: number[] }> };
    linha(`✓ chave viva · dim ${j.data[0].embedding.length}`);
    return;
  }
  const j = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const code = j.error?.code ?? String(r.status);
  if (code === 'credit_balance_exhausted') {
    throw new Error(
      'a chave AUTENTICA mas a organização está sem crédito (429 credit_balance_exhausted).\n' +
        '   Não adianta gerar outra chave na mesma conta — é saldo, não credencial.\n' +
        '   Adicione crédito em platform.openai.com/settings/organization/billing.',
    );
  }
  throw new Error(`chave recusada: ${code} · ${j.error?.message ?? ''}`);
}

// ─── Porta 2: o cookie está vivo? ───────────────────────────────────────────
async function conferirCookie(): Promise<void> {
  if (!cookie) throw new Error('E2E_COOKIE ausente do .env.');
  const r = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie }, redirect: 'manual' });
  if (r.status !== 200) {
    throw new Error(
      `E2E_COOKIE vencido (/api/auth/me → ${r.status}). Renove copiando o cookie de uma aba logada.`,
    );
  }
  const me = (await r.json()) as { email?: string; isAdmin?: boolean };
  if (!me.isAdmin) throw new Error(`o cookie é de ${me.email}, que não é admin.`);
  linha(`✓ sessão de ${me.email} (admin)`);
}

async function main(): Promise<void> {
  console.log(`\n═══ GO da v2 · ${base} · ${valendo ? 'VALENDO' : 'ENSAIO (nada grava)'} ═══`);

  passo('0. Portas');
  await conferirChave();
  await conferirCookie();

  // 1) Reembedding — repõe os vetores no modelo corrente. `forcar` trata vetor de outro
  //    modelo como velho, que é justamente o que precisa sair antes do Pinecone.
  // ⚠️ **NÃO existe passo de "reembeddar"** — e não é economia de código, é medição: com a
  // base já embeddada, `classificar-pendentes {forcar:true}` devolveu `embeddings_gerados: 0`
  // e gastou 61 s em 2 projetos, TUDO em LLM. O hash do texto (`hashTexto`) impede re-embeddar
  // o que não mudou, então um passo separado só rodaria a classificação DUAS vezes. Se o
  // MODELO de embedding mudar, aí sim: reembeddar vem antes do backfill do Pinecone (vetor de
  // outra dimensão derruba o lote inteiro com 400) — mas isso é uma troca de modelo, não uma
  // rodada normal.

  // 2) Pinecone — índice e depois backfill paginado. `descartados_dim` > 0 significa que
  //    ainda há vetor de outro modelo: o passo 1 não cobriu tudo.
  passo('2. Pinecone: índice + backfill');
  await chamar('/api/admin/especiais/pinecone/indice', { criar: true });
  let offset = 0;
  let enviados = 0;
  let descartados = 0;
  for (let volta = 0; volta < 50; volta++) {
    const b = await chamar<{
      upsertados?: number;
      descartados_dim?: number;
      proximo_offset?: number | null;
    }>('/api/admin/especiais/pinecone/backfill', { dry: !valendo, offset });
    enviados += b.upsertados ?? 0;
    descartados += b.descartados_dim ?? 0;
    if (b.proximo_offset == null) break;
    offset = b.proximo_offset;
  }
  linha(`upsertados=${enviados} descartados_por_dimensao=${descartados}`);
  if (descartados > 0) {
    linha('⚠️ sobrou vetor de outro modelo — rode o passo 1 com forcar antes de confiar nos vizinhos.');
  }

  // 3) Aglutinação — quem é feature de quem. Sempre SUGESTÃO: o vínculo só é gravado
  //    pelo aceite humano em /aglutinacao. Por isso não passa `valendo` adiante.
  // ⚠️ Em LOTES resumíveis (`pular`/`proximo_pular`): ~100 pares × ~2 s de LLM não cabem numa
  // requisição só, e requisição longa morre no Godeploy. A lista de candidatos é
  // DETERMINÍSTICA (TF-IDF + vetores gravados), então recomputá-la a cada lote dá a mesma
  // ordem e o `pular` cai sempre no mesmo lugar.
  passo('3. Aglutinação: varrer e julgar os pares');
  const LOTE_AGL = 8;
  let pular = 0;
  let julgados = 0;
  let sugestoes = 0;
  let falhasAgl = 0;
  for (let volta = 0; volta < 60; volta++) {
    const ag = await chamar<{
      julgados?: number;
      restantes?: number;
      proximo_pular?: number;
      falhas?: number;
      total_com_candidatos?: number;
      sugestoes?: unknown[];
    }>('/api/admin/aglutinacao/varredura', { dry: !valendo, max: LOTE_AGL, pular });
    julgados += ag.julgados ?? 0;
    sugestoes += ag.sugestoes?.length ?? 0;
    falhasAgl += ag.falhas ?? 0;
    if (volta === 0) linha(`${ag.total_com_candidatos ?? '?'} projetos com candidato`);
    process.stdout.write(`   … ${julgados} julgados · ${sugestoes} sugestões\r`);
    if (!ag.restantes || ag.proximo_pular == null) break;
    pular = ag.proximo_pular;
  }
  linha(`julgados=${julgados} sugestões=${sugestoes} falhas=${falhasAgl}`);
  // ⚠️ Falha de chamada NÃO é "não é feature": sem olhar este número, uma rajada de 502 do
  // proxy passaria por "a base não tem features".
  if (falhasAgl > 0) linha(`⚠️ ${falhasAgl} pares não foram julgados (falha de chamada) — rode de novo.`);
  linha('→ valide em /aglutinacao (o vínculo só grava por clique humano).');

  // 4) Estrelas — agora COM vizinhos, que é a diferença medida (3,6★ sem × 4,9★ com).
  // ⚠️ `forcar: true` REABRE quem já tem recomendação — é o que faz a régua NOVA valer sobre a
  // base inteira; sem ele a rota responde "nenhum especial pendente", porque todos já foram
  // classificados sob a régua antiga. A coluna "Estrelas" (a nota HUMANA) segue intocada: o
  // agente só escreve em `especial_avaliacao`.
  // Em lotes de 4: ~30 s de LLM por projeto, e requisição longa morre no edge.
  passo('4. Classificar as estrelas dos especiais (régua nova)');
  const LOTE_CLS = 4;
  const notas: Record<string, number> = {};
  let classificados = 0;
  for (let volta = 0; volta < 40; volta++) {
    const cl = await chamar<{
      candidatos?: number;
      classificados?: number;
      resultados?: Array<{ ok?: boolean; recomendacao?: { estrelas_recomendada?: number } }>;
    }>('/api/admin/especiais/classificar-pendentes', { dry: !valendo, forcar: true, limite: LOTE_CLS });
    const n = cl.classificados ?? 0;
    classificados += n;
    for (const r of cl.resultados ?? []) {
      const e = r.recomendacao?.estrelas_recomendada;
      if (typeof e === 'number') notas[String(e)] = (notas[String(e)] ?? 0) + 1;
    }
    process.stdout.write(`   … ${classificados} classificados\r`);
    if (n === 0) break;
  }
  linha(`classificados=${classificados}`);
  const dist = Object.entries(notas).sort((a, b) => Number(a[0]) - Number(b[0]));
  linha(`distribuição: ${dist.map(([k, v]) => `${k}★:${v}`).join(' · ') || '(nenhuma)'}`);
  const escape = dist.filter(([k]) => Number(k) >= 6).reduce((a, [, v]) => a + v, 0);
  linha(`na faixa 6-10 ("Muda o Jogo"): ${escape}`);

  // 5) Re-auditoria — só relatório, nunca escreve. Roda mesmo em ensaio.
  passo('5. Re-auditar as notas humanas contra os vizinhos');
  const ra = await chamar<{ linhas?: unknown[]; ok?: boolean; erro?: string }>(
    '/api/admin/especiais/reauditar',
    {},
  );
  linha(ra.ok === false ? `não rodou: ${ra.erro}` : `analisados=${ra.linhas?.length ?? '?'}`);

  console.log(
    `\n═══ fim · ${Math.round((Date.now() - t0) / 1000)}s · ${valendo ? 'gravado' : 'ENSAIO, nada gravado'} ═══\n`,
  );
}

main().catch((e: Error) => {
  console.error(`\n✗ parou: ${e.message}\n`);
  process.exit(1);
});
