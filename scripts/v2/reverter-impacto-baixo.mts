/**
 * ROLLBACK da rodada retroativa de reprovação (`reprovar-impacto-baixo.mts`).
 *
 * Restaura, célula a célula, o Status e o Motivo Reprovado que cada linha tinha ANTES da rodada,
 * a partir do snapshot que o script de aplicação grava obrigatoriamente antes de escrever.
 *
 * ⚠️ **Restaura o valor ANTERIOR, não um valor fixo.** Escrever "Aprovado" de volta em todo mundo
 * seria adivinhar: a rodada só toca quem estava "Aprovado" hoje, mas o Motivo Reprovado pode ter
 * texto anterior da triagem, e sobrescrevê-lo com vazio apagaria trabalho humano.
 *
 * ⚠️ **Só reverte a linha que ainda está como a rodada a deixou.** Se alguém mexeu no Status
 * depois (a triagem reavaliou, o autor reenviou), a linha é PULADA e reportada: rollback que
 * atropela decisão posterior é pior que rollback nenhum.
 *
 * Uso:
 *   npx tsx scripts/v2/reverter-impacto-baixo.mts            # ENSAIO (default)
 *   npx tsx scripts/v2/reverter-impacto-baixo.mts --valendo  # restaura
 */
import { readFileSync } from 'node:fs';
import { getAccessToken } from '/home/notebook/godocs-wt-categoria-aglutinacao/src/lib/google/auth';

const SP = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const SNAPSHOT = process.env.SNAPSHOT ?? '/tmp/rep/snapshot-reprovacao.json';
const VALENDO = process.argv.includes('--valendo');

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as {
  aba: string; colStatus: string; colMotivo: string; gravado_em: string;
  alvos: { linha: number; id: string; nome: string; statusAntes: string; motivoAntes: string }[];
};
console.log(`snapshot de ${snap.gravado_em} · ${snap.alvos.length} linhas · ${VALENDO ? 'VALENDO' : 'ENSAIO'}`);

const tk = await getAccessToken();
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values/${snap.aba}`, {
  headers: { Authorization: `Bearer ${tk}` },
});
const { values = [] } = (await r.json()) as { values?: string[][] };
const [h, ...ls] = values;
const iSt = h.indexOf('Status'), iId = h.indexOf('ID Projeto');

const restaurar: { range: string; values: string[][] }[] = [];
const pulados: string[] = [];
for (const a of snap.alvos) {
  const l = ls[a.linha - 2];
  // A linha pode ter se movido (alguém inseriu/ordenou): confere o ID antes de escrever nela.
  if (!l || (l[iId] ?? '').trim().toLowerCase() !== a.id.toLowerCase()) {
    pulados.push(`${a.nome} — linha mudou de lugar`);
    continue;
  }
  if ((l[iSt] ?? '').trim().toLowerCase() !== 'reprovado') {
    pulados.push(`${a.nome} — status agora é "${(l[iSt] ?? '').trim()}", alguém mexeu depois`);
    continue;
  }
  restaurar.push({ range: `${snap.aba}!${snap.colStatus}${a.linha}`, values: [[a.statusAntes]] });
  restaurar.push({ range: `${snap.aba}!${snap.colMotivo}${a.linha}`, values: [[a.motivoAntes]] });
}
console.log(`a restaurar: ${restaurar.length / 2} linhas · pulados: ${pulados.length}`);
for (const p of pulados.slice(0, 15)) console.log(`   ⚠ ${p}`);

if (!VALENDO) { console.log('\nENSAIO — nada escrito.'); process.exit(0); }
const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values:batchUpdate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW', data: restaurar }),
});
const jw = await w.json();
if (!w.ok) { console.error('FALHOU:', JSON.stringify(jw).slice(0, 400)); process.exit(1); }
console.log(`células restauradas: ${jw.totalUpdatedCells}`);
