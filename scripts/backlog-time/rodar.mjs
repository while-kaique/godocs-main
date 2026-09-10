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
// ⚠️ **O EDGE CORTA EM 300 s, EXATOS.** Medido em 10/09/2026: 6 falhas do lote, todas em
// 300358-300833 ms. Não é rede instável e re-tentar não resolve — quem passa de 5 min sempre
// falha. O timeout aqui fica um pouco ABAIXO disso para o erro chegar como nosso e não como
// conexão derrubada, e a concorrência é o botão que controla o tempo da passada: cada projeto já
// dispara 5 especialistas, e 3 em paralelo enfileiram no gateway (~8 slots) e empurram a passada
// de ~220 s para além do corte.
const TIMEOUT_MS = Number(process.env.BACKLOG_TIMEOUT_MS ?? 295_000);

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
// ⚠️ **RETOMA de onde parou.** O run já morreu duas vezes em 10/09/2026 (um `timeout` meu e o
// processo de fundo levando SIGKILL), e sem isto reiniciar significava re-rodar ~3 min por projeto
// já decidido — em 90 projetos, mais de uma hora de chamada de LLM jogada fora. Só conta como
// feito quem voltou **http 200**: falha de rede tem de ser re-tentada, não marcada como pronta.
const feitosAntes = new Set();
if (fs.existsSync(OUT)) {
  try {
    for (const r of JSON.parse(fs.readFileSync(OUT, 'utf8'))) if (r?.http === 200) feitosAntes.add(String(r.id));
  } catch {
    /* arquivo pela metade (morte no meio da escrita) → recomeça do zero, que é o lado seguro */
  }
}
// ⚠️ **PULAR os projetos que estouram o teto do edge SEMPRE.** Medido: `legado-254` e
// `e4b1dcc3…` falharam 4 vezes em 295-300 s, em concorrência 2, 3, 4 e 6 — não é carga, é a
// passada deles que não cabe. E como a retomada os coloca no INÍCIO da fila (nunca tiveram 200),
// cada reinício gastava 2×295 s neles antes de andar. Eles saem do lote e são tratados um a um.
const pular = new Set(String(process.env.BACKLOG_PULAR ?? '').split(',').map((x) => x.trim()).filter(Boolean));
const pendente = fila.filter(
  (r) => !feitosAntes.has(String(r['ID Projeto']).trim()) && !pular.has(String(r['ID Projeto']).trim()),
);
if (pular.size) console.log(`pulando ${pular.size} projeto(s) por decisão explícita: ${[...pular].join(', ')}`);
if (feitosAntes.size) console.log(`retomando: ${feitosAntes.size} já decidido(s), ${pendente.length} na fila`);
const alvo = LIMITE ? pendente.slice(0, LIMITE) : pendente;
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
      // `dry: false` grava a recomendação e (com a flag ligada) o Status do funil.
      // ⚠️ **SEM `forcar`**: 15 dos 90 têm nota HUMANA, e `forcar` a sobrescreveria. A âncora
      // protege a nota; o time roda e julga o mérito de qualquer forma.
      body: JSON.stringify({ projetoId: id, dry: false }),
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
if (fs.existsSync(OUT)) {
  try { feitos.push(...JSON.parse(fs.readFileSync(OUT, 'utf8')).filter((r) => r?.http === 200)); } catch { /* ignora */ }
}
let i = 0;
async function worker(n) {
  while (i < alvo.length) {
    const meu = i++;
    const r = await rodarUm(alvo[meu]);
    feitos.push(r);
    const v = r.resposta?.consenso?.saida ?? r.resposta?.saida ?? r.resposta?.erro ?? r.erro ?? '?';
    console.log(
      `[${feitos.length}/${feitosAntes.size + alvo.length}] w${n} ${r.id} · http ${r.http} · ${(r.ms / 1000).toFixed(0)}s · ${String(v).slice(0, 40)}`,
    );
    fs.writeFileSync(OUT, JSON.stringify(feitos, null, 1));
  }
}
await Promise.all(Array.from({ length: CONC }, (_, n) => worker(n + 1)));
console.log(`\nsalvo em ${OUT} · ${feitos.length} projeto(s)`);
