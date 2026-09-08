/**
 * Reescreve o MOTIVO REPROVADO dos projetos que a rodada de 04/09 reprovou por impacto
 * baixo, trocando o texto burocrático pelo veredito "experimentação".
 *
 * ## Por que existe
 * A rodada (`reprovar-impacto-baixo.mts`) gravou um motivo que expõe a régua como nota de
 * corte ("abaixo de R$ 100 e sem reconhecimento por estrela") e termina mandando 137
 * pessoas procurarem o time de RPA. Decisão do Luis (08/09/2026): dizer que o projeto foi
 * considerado uma EXPERIMENTAÇÃO, sem citar valor, encorajando a pessoa a seguir
 * investindo. Texto em `src/lib/motivo-reprovacao.ts` (FONTE ÚNICA, com teste de copy).
 *
 * ## Como o alvo é escolhido, e por que a dupla trava
 * Alvo = id está no **snapshot da rodada** `docs/baselines/rodadas/snapshot-reprovacao-04-09.json`
 * **E** a célula de motivo ainda é a da rodada (`ehMotivoDaRodada0409`).
 *
 * ⚠️ As duas travas são necessárias, e por motivos diferentes:
 *   - o snapshot sozinho não basta: alguém pode ter reescrito o motivo à mão desde 04/09, e
 *     sobrescrever isso apagaria o julgamento de uma pessoa;
 *   - a assinatura sozinha não basta: ela é uma busca por substring, e amarrar a escrita ao
 *     conjunto DECLARADO da rodada é o que impede o script de crescer sozinho se um dia
 *     outra coisa gravar um texto parecido.
 * Linha fora do alvo é **pulada e reportada por nome** (mesma disciplina do reverter).
 *
 * ⚠️ **Idempotente:** o texto novo não casa a assinatura, então rodar de novo não faz nada.
 *
 * ## Rollback
 * Snapshot do motivo anterior de CADA linha tocada, gravado ANTES da escrita. Sem ele o
 * script ABORTA (é a regra da rodada: retroativo sem volta é acidente).
 *
 * Uso:
 *   npx tsx scripts/v2/motivo-experimentacao.mts               # ENSAIO (default)
 *   npx tsx scripts/v2/motivo-experimentacao.mts --valendo     # escreve
 *   npx tsx scripts/v2/motivo-experimentacao.mts --reverter --valendo   # desfaz
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// ⚠️ Import RELATIVO ao próprio worktree. O script da rodada apontava para um caminho
// ABSOLUTO de outro worktree (`/home/notebook/godocs-wt-categoria-aglutinacao/src/...`),
// que quebra em qualquer máquina ou worktree diferente.
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../..');
const { getAccessToken } = await import(resolve(RAIZ, 'src/lib/google/auth.ts'));
const { MOTIVO_EXPERIMENTACAO, ehMotivoDaRodada0409 } = await import(
  resolve(RAIZ, 'src/lib/motivo-reprovacao.ts')
);

const SP = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const ABA = 'GoDocs';
const VALENDO = process.argv.includes('--valendo');
const REVERTER = process.argv.includes('--reverter');
const SNAPSHOT = resolve(RAIZ, 'docs/baselines/rodadas/snapshot-motivo-experimentacao.json');

const col = (i: number) => {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const daRodada = new Set<string>(
  JSON.parse(readFileSync(resolve(RAIZ, 'docs/baselines/rodadas/snapshot-reprovacao-04-09.json'), 'utf8'))
    .alvos.map((a: { id: string }) => String(a.id).toLowerCase()),
);
console.log(`snapshot da rodada: ${daRodada.size} projetos declarados`);

const tk = await getAccessToken();
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values/${ABA}`, {
  headers: { Authorization: `Bearer ${tk}` },
});
const { values = [] } = (await r.json()) as { values?: string[][] };
const [h, ...ls] = values;
const at = (n: string) => { const i = h.indexOf(n); if (i < 0) throw new Error(`coluna ausente: ${n}`); return i; };
const iId = at('ID Projeto'), iNome = at('Projeto'), iSt = at('Status'), iMot = at('Motivo Reprovado');

// ── Reversão: regrava o motivo ANTERIOR célula a célula, a partir do snapshot ──
// ⚠️ Pula (reportando por nome) a linha cuja célula já não é o texto novo: se alguém
// escreveu outra coisa depois, restaurar apagaria essa escrita mais recente.
if (REVERTER) {
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as {
    colMotivo: string;
    alvos: { linha: number; id: string; nome: string; motivoAntes: string }[];
  };
  const porLinha = new Map(ls.map((l, k) => [k + 2, l]));
  const volta: { range: string; values: string[][] }[] = [];
  for (const a of snap.alvos) {
    const atual = (porLinha.get(a.linha)?.[iMot] ?? '').trim();
    if (atual !== MOTIVO_EXPERIMENTACAO) {
      console.log(`  · PULADO ${a.id} ${a.nome.slice(0, 40)} → célula mudou depois`);
      continue;
    }
    volta.push({ range: `${ABA}!${snap.colMotivo}${a.linha}`, values: [[a.motivoAntes]] });
  }
  console.log(`\nreverter: ${volta.length} de ${snap.alvos.length}`);
  if (!VALENDO) { console.log('=== ENSAIO. Use --valendo. ==='); process.exit(0); }
  const rv = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: volta }),
  });
  const rr = (await rv.json()) as { totalUpdatedCells?: number; error?: { message: string } };
  if (rr.error) throw new Error(rr.error.message);
  console.log(`REVERTIDO: ${rr.totalUpdatedCells} células. Rode POST /api/admin/sync-sheets-now.`);
  process.exit(0);
}

type Alvo = { linha: number; id: string; nome: string; motivoAntes: string };
const alvos: Alvo[] = [];
const pulados: { id: string; nome: string; porque: string }[] = [];

ls.forEach((l, k) => {
  const id = (l[iId] ?? '').trim();
  if (!id || !daRodada.has(id.toLowerCase())) return;
  const nome = (l[iNome] ?? '').trim();
  const status = (l[iSt] ?? '').trim();
  const motivo = (l[iMot] ?? '').trim();
  if (status !== 'Reprovado') { pulados.push({ id, nome, porque: `status virou "${status || '(vazio)'}"` }); return; }
  if (motivo === MOTIVO_EXPERIMENTACAO) { pulados.push({ id, nome, porque: 'já tem o texto novo' }); return; }
  if (!ehMotivoDaRodada0409(motivo)) {
    pulados.push({ id, nome, porque: `motivo reescrito à mão: "${motivo.slice(0, 60)}"` });
    return;
  }
  alvos.push({ linha: k + 2, id, nome, motivoAntes: motivo });
});

console.log(`\nALVOS: ${alvos.length} · PULADOS: ${pulados.length}`);
if (pulados.length) {
  console.log('\nPulados (reportados por nome, como a rodada manda):');
  for (const p of pulados) console.log(`  · ${p.id} ${p.nome.slice(0, 40)} → ${p.porque}`);
}
console.log('\nTexto que será gravado:\n');
console.log(`  "${MOTIVO_EXPERIMENTACAO}"\n`);
console.log(`  (${MOTIVO_EXPERIMENTACAO.length} caracteres)`);

if (!VALENDO) {
  console.log('\n=== ENSAIO. Nada foi escrito. Use --valendo para gravar. ===');
  process.exit(0);
}
if (alvos.length === 0) { console.log('\nNada a fazer.'); process.exit(0); }

mkdirSync(dirname(SNAPSHOT), { recursive: true });
writeFileSync(
  SNAPSHOT,
  JSON.stringify({ aba: ABA, colMotivo: col(iMot), gravado_em: new Date().toISOString(), alvos }, null, 1),
);
console.log(`\nsnapshot: ${SNAPSHOT}`);

const data = alvos.map((a) => ({
  range: `${ABA}!${col(iMot)}${a.linha}`,
  values: [[MOTIVO_EXPERIMENTACAO]],
}));
const w = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SP}/values:batchUpdate`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  },
);
const res = (await w.json()) as { totalUpdatedCells?: number; error?: { message: string } };
if (res.error) throw new Error(res.error.message);
console.log(`\nESCRITO: ${res.totalUpdatedCells} células em ${alvos.length} projetos.`);
console.log('Agora rode POST /api/admin/sync-sheets-now para o espelho refletir.');
