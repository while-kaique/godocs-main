// RODA O TIME DE AGENTES NO BACKLOG e monta o relatório. `node scripts/backlog-time/rodar.mjs`
//
// ⚠️ **Este script NUNCA escreve Status.** Ele chama a rota síncrona do time, que persiste a
// RECOMENDAÇÃO do agente (`Estrela Agente`, `Confiança Agente`, `especial_avaliacao`) e devolve o
// veredito — e só. Mudar o funil é uma segunda passada, explícita, depois de gente olhar a tabela
// (`aplicar.mjs`). Foi assim que a rodada de 04/09 aplicou 137 reprovações: relatório, decisão,
// escrita.
//
// ⚠️ **Concorrência 2 por decisão, não por preguiça:** o gateway do ai-proxy tem poucos slots e é
// COMPARTILHADO com o produto (o chat de submissão vive nele). Cada passada do time já dispara 5
// especialistas em paralelo, então 2 projetos = ~10 chamadas simultâneas. Subir isso derruba a
// latência de quem está submetendo projeto agora.
//
// ⚠️ O cookie sai do `.env` e vai SÓ para o host do GoDocs. Nunca é impresso.
import fs from 'node:fs';

const BASE = process.env.BACKLOG_BASE ?? 'https://godocs.devgogroup.com';
const CONC = Number(process.env.BACKLOG_CONC ?? 2);
const OUT = process.env.BACKLOG_OUT ?? '/tmp/backlog-time.json';
const CORPUS = process.env.BACKLOG_CORPUS ?? '/tmp/retro-corpus-full.json';
const LIMITE = Number(process.env.BACKLOG_LIMITE ?? 0); // 0 = todos
const TIMEOUT_MS = Number(process.env.BACKLOG_TIMEOUT_MS ?? 420_000);

const env = {};
for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) env[m[1]] = m[2];
}
const COOKIE = env.E2E_COOKIE;
if (!COOKIE) throw new Error('E2E_COOKIE ausente no .env');

// ── a fila: quem NÃO está aprovado nem reprovado, e não é descontinuado ──
// ⚠️ Descontinuado fica fora: o dono desligou a automação, e julgar mérito de algo desligado
// gasta chamada num veredito que ninguém vai aplicar (ver `src/lib/funil-status.ts`).
const rows = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
const fila = rows.filter((r) => {
  const s = String(r['Status'] ?? '').trim().toLowerCase();
  return s !== 'aprovado' && s !== 'reprovado' && s !== 'descontinuado';
});
const alvo = LIMITE ? fila.slice(0, LIMITE) : fila;
console.log(`fila: ${alvo.length} projeto(s) de ${rows.length} linhas · concorrência ${CONC} · base ${BASE}`);

async function rodarUm(row) {
  const id = String(row['ID Projeto']).trim();
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE}/api/admin/avaliacao/time-completo`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'Content-Type': 'application/json' },
      // `dry: false` grava a RECOMENDAÇÃO (nota + confiança do agente), nunca o Status.
      body: JSON.stringify({ projetoId: id, dry: false, forcar: true }),
      signal: ctl.signal,
    });
    const txt = await resp.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { /* html do edge, erro cru */ }
    return {
      id,
      nome: String(row['Nome do Projeto'] ?? '').trim(),
      status_atual: String(row['Status'] ?? '').trim(),
      impacto: String(row['Impacto Líquido Mensal'] ?? '').trim(),
      estrela_humana: String(row['Estrelas'] ?? '').trim(),
      http: resp.status,
      ms: Date.now() - t0,
      resposta: j ?? txt.slice(0, 400),
    };
  } catch (e) {
    return { id, nome: String(row['Nome do Projeto'] ?? '').trim(), http: 0, ms: Date.now() - t0, erro: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

const feitos = [];
let i = 0;
async function worker(n) {
  while (i < alvo.length) {
    const meu = i++;
    const r = await rodarUm(alvo[meu]);
    feitos.push(r);
    const v = r.resposta?.consenso?.saida ?? r.resposta?.saida ?? r.resposta?.erro ?? r.erro ?? '?';
    console.log(
      `[${feitos.length}/${alvo.length}] w${n} ${r.id} · http ${r.http} · ${(r.ms / 1000).toFixed(0)}s · ${String(v).slice(0, 40)}`,
    );
    fs.writeFileSync(OUT, JSON.stringify(feitos, null, 1));
  }
}
await Promise.all(Array.from({ length: CONC }, (_, n) => worker(n + 1)));
console.log(`\nsalvo em ${OUT} · ${feitos.length} projeto(s)`);
