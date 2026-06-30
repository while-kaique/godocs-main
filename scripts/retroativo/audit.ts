// Validação retroativa §10 (SPEC_COMPLEXIDADE_NIVEIS): roda o classificador NOVO de
// complexidade sobre a base REAL de projetos submetidos (puxada de produção via o
// admin API com E2E_COOKIE — SEM deploy) e escreve ANTIGA × NOVA na aba dedicada
// `godocs_teste_retroativo` (NUNCA na aba GoDocs oficial; sem backfill).
//
// Rodar (da raiz do worktree):
//   npx vitest run --config scripts/retroativo/vitest.config.ts
// Flags (env): RETRO_LIMIT=<n> (processa só os n primeiros — smoke); RETRO_WRITE=1
// (escreve no Sheets; sem a flag, só imprime no console — dry-run seguro).
//
// Importa o MESMO código do analyzer (buildSystemPrompt/buildUserMessage/
// normalizarComplexidade) + llmChat — o alias `@/` é resolvido pelo vitest.config
// deste diretório. NÃO usa o DB (só as funções puras + LLM), então o client.server
// (lazy) nunca é tocado.

import '../e2e/lib/env.mjs'; // PRIMEIRO: carrega o .env para process.env
import { it } from 'vitest';
import { buildSystemPrompt, buildUserMessage, normalizarComplexidade } from '@/lib/agents/analyzer';
import { llmChat } from '@/lib/llm';
import { readAllRows, getAccessToken, SPREADSHEET_ID } from '../e2e/lib/sheets.mjs';
import { BASE_URL } from '../e2e/lib/env.mjs';

const COOKIE = process.env.E2E_COOKIE?.trim() || '';
const LIMIT = process.env.RETRO_LIMIT ? Number(process.env.RETRO_LIMIT) : Infinity;
const WRITE = process.env.RETRO_WRITE === '1';
const CONCURRENCY = Number(process.env.RETRO_CONCURRENCY || 4);
const TAB = 'godocs_teste_retroativo';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── GET autenticado ao admin de prod (mesma estratégia de cookie do e2e/api.mjs) ──
async function adminGet(path: string): Promise<any> {
  if (!COOKIE) throw new Error('E2E_COOKIE ausente no .env');
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: COOKIE },
    redirect: 'manual',
  });
  if (resp.status >= 300 && resp.status < 400) {
    throw new Error(`${path} → ${resp.status}: sessão não autenticada (E2E_COOKIE expirado?)`);
  }
  const text = await resp.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    throw new Error(`${path} → ${resp.status}: resposta não-JSON: ${text.slice(0, 160)}`);
  }
  if (!resp.ok) throw new Error(`${path} → ${resp.status}: ${data?.error ?? text.slice(0, 200)}`);
  return data;
}

// ── Classificação com o código NOVO (sem tocar o DB) ──
async function classificar(proj: any) {
  const conteudo = (proj.documentacao?.[0]?.conteudo ?? {}) as Record<string, unknown>;
  const docMsg = (proj.chat_messages ?? []).find((m: any) => m.role === 'doc');
  const docTexto: string | null = docMsg?.content ?? null;

  const sys = buildSystemPrompt();
  const user = buildUserMessage(proj as Record<string, unknown>, conteudo, docTexto);
  const raw = await llmChat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { jsonMode: true, temperature: 0.2, maxTokens: 4096 },
  );
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) parsed = JSON.parse(m[1].trim());
  }
  const norm = normalizarComplexidade({
    complexidade: parsed.complexidade,
    usa_ia: parsed.usa_ia,
    acao_autonoma: parsed.acao_autonoma,
    tem_ia_como_funcionalidade: conteudo.tem_ia_como_funcionalidade as boolean | null | undefined,
  });
  return {
    complexidade: norm.complexidade,
    usa_ia: norm.usa_ia,
    acao_autonoma: parsed.acao_autonoma ?? null,
    llm_sugeriu: parsed.complexidade ?? null,
    ajuste: norm.ajuste,
    justificativa: parsed.complexidade_justificativa ?? '',
  };
}

// ── Sheets: garante a aba e escreve (Service Account) ──
async function ensureTab(token: string) {
  const meta = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets.properties(title)`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const existe = (meta.sheets ?? []).some((s: any) => s.properties?.title === TAB);
  if (existe) return;
  const resp = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
  });
  if (!resp.ok) throw new Error(`addSheet falhou (${resp.status}): ${await resp.text()}`);
  console.log(`[retroativo] aba "${TAB}" criada.`);
}

async function escreverSheet(linhas: string[][]) {
  const token = await getAccessToken();
  await ensureTab(token);
  // limpa e reescreve
  await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${TAB}'!A:Z`)}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const resp = await fetch(
    `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: linhas }),
    },
  );
  if (!resp.ok) throw new Error(`Sheets write falhou (${resp.status}): ${await resp.text()}`);
}

// ── Pool simples de concorrência ──
async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

it('reclassifica a base submetida e escreve em godocs_teste_retroativo', async () => {
  console.log(`\n[retroativo] base=${BASE_URL} · LIMIT=${LIMIT} · WRITE=${WRITE} · CONCURRENCY=${CONCURRENCY}`);

  // 1) baseline: lê a aba GoDocs oficial (ID + nome + complexidade ANTIGA)
  const rows = await readAllRows();
  const candidatos = rows
    .map((r) => ({
      id: String(r['ID Projeto'] ?? '').trim(),
      nome: String(r['Projeto'] ?? '').trim(),
      complexidadeOld: String(r['Complexidade'] ?? '').trim() || '—',
      status: String(r['Status'] ?? '').trim(),
    }))
    .filter((r) => r.id);
  // Submissões do app (ID hex aleatório) têm doc compilada; legados importados via
  // Sheets em geral NÃO têm doc no SQLite → primeiro as não-legado (o smoke acerta docs).
  candidatos.sort((a, b) => {
    const la = /legado/i.test(a.id) ? 1 : 0;
    const lb = /legado/i.test(b.id) ? 1 : 0;
    return la - lb;
  });
  const nLegado = candidatos.filter((c) => /legado/i.test(c.id)).length;
  console.log(`[retroativo] ${candidatos.length} linhas com ID (${candidatos.length - nLegado} app + ${nLegado} legado).`);

  // 2) puxa o detalhe de cada projeto e classifica; pula quem não tem doc real
  const alvos = candidatos.slice(0, LIMIT === Infinity ? candidatos.length : LIMIT);
  const pulados: { id: string; motivo: string }[] = [];

  const resultados = (await pool(alvos, CONCURRENCY, async (c, i) => {
    try {
      const proj = await adminGet(`/api/admin/projetos/${encodeURIComponent(c.id)}`);
      const conteudo = proj.documentacao?.[0]?.conteudo;
      if (!conteudo || !conteudo.o_que_faz) {
        pulados.push({ id: c.id, motivo: 'sem documentacao/o_que_faz (legado importado sem doc)' });
        return null;
      }
      const r = await classificar(proj);
      const mudou = c.complexidadeOld.toLowerCase() !== r.complexidade.toLowerCase();
      console.log(
        `[${i + 1}/${alvos.length}] ${c.id} "${c.nome.slice(0, 40)}" : ${c.complexidadeOld} → ${r.complexidade}` +
        `${mudou ? '  ⚠️ MUDOU' : ''}${r.complexidade === 'autonomia' ? '  🤖 AUTONOMIA' : ''}`,
      );
      return { ...c, ...r, mudou };
    } catch (e: any) {
      pulados.push({ id: c.id, motivo: e.message?.slice(0, 120) ?? 'erro' });
      return null;
    }
  })).filter(Boolean) as any[];

  // 3) resumo
  const dist = (key: 'complexidadeOld' | 'complexidade') =>
    resultados.reduce((acc: Record<string, number>, r) => {
      const k = String(r[key]).toLowerCase();
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  const autonomias = resultados.filter((r) => r.complexidade === 'autonomia');
  console.log(`\n[retroativo] classificados: ${resultados.length} · pulados: ${pulados.length}`);
  console.log('[retroativo] distribuição ANTIGA:', JSON.stringify(dist('complexidadeOld')));
  console.log('[retroativo] distribuição NOVA  :', JSON.stringify(dist('complexidade')));
  console.log(`[retroativo] viraram AUTONOMIA: ${autonomias.length}`);
  for (const a of autonomias) {
    console.log(`   🤖 ${a.id} "${a.nome.slice(0, 50)}" — acao_autonoma=${a.acao_autonoma} — ${String(a.justificativa).slice(0, 200)}`);
  }
  if (pulados.length) console.log('[retroativo] pulados:', JSON.stringify(pulados.slice(0, 30), null, 1));

  // 4) escreve no Sheets (só com RETRO_WRITE=1)
  if (WRITE && resultados.length) {
    const header = ['ID', 'Projeto', 'Complexidade ANTIGA', 'Complexidade NOVA', 'Mudou?', 'usa_ia', 'acao_autonoma', 'LLM sugeriu', 'Ajuste do gate', 'Justificativa (nova)'];
    const linhas = resultados.map((r) => [
      r.id, r.nome, r.complexidadeOld, r.complexidade, r.mudou ? 'SIM' : '', String(r.usa_ia ?? ''),
      String(r.acao_autonoma ?? ''), String(r.llm_sugeriu ?? ''), r.ajuste ?? '', String(r.justificativa ?? ''),
    ]);
    await escreverSheet([header, ...linhas]);
    console.log(`\n[retroativo] ✅ ${resultados.length} linhas escritas na aba "${TAB}".`);
  } else if (!WRITE) {
    console.log('\n[retroativo] (dry-run — defina RETRO_WRITE=1 para escrever no Sheets)');
  }
}, 1_800_000);
