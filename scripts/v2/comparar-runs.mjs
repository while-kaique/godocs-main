// Compara runs de calibragem. Uso: node comparar-runs.mjs runA.json runB.json [runC.json ...]
//
// ⚠️ A pergunta desta ferramenta NÃO é "subiu ou desceu". É se o MOTIVO ESCRITO sustenta a
// mudança: por isso ela imprime a leitura dos dois lados, e não só os números. Um projeto que
// sai de 0 para 5 tem de trazer, na leitura nova, o fato que mudou o veredito.
import { readFileSync } from 'node:fs';

const arquivos = process.argv.slice(2);
if (arquivos.length < 1) {
  console.error('uso: node comparar-runs.mjs runA.json [runB.json ...]');
  process.exit(2);
}
const runs = arquivos.map((f) => {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  return { arquivo: f, meta: d.meta ?? {}, linhas: d.linhas.filter((l) => l.agente != null) };
});

const rot = (r) => r.meta.run ?? r.arquivo.replace(/.*\//, '');
// Dossiê insuficiente fica FORA de toda conta de acerto: ali o agente não discordou do humano,
// ele não teve o que ler. Contá-lo mede a documentação, não o agente.
const comparavel = (l) => l.humana != null && l.dossie !== 'insuficiente';

console.log('='.repeat(78));
for (const r of runs) {
  const c = r.linhas.filter(comparavel);
  const ident = c.filter((l) => l.humana === l.agente).length;
  const perto = c.filter((l) => Math.abs(l.humana - l.agente) <= 1).length;
  const acima = c.filter((l) => l.agente > l.humana).length;
  const abaixo = c.filter((l) => l.agente < l.humana).length;
  const dist = {};
  r.linhas.forEach((l) => (dist[l.agente] = (dist[l.agente] ?? 0) + 1));
  console.log(
    `${rot(r).padEnd(34)} n=${String(r.linhas.length).padStart(3)}  idêntica ${pct(ident, c.length)}  ±1 ${pct(perto, c.length)}  acima ${acima}  abaixo ${abaixo}`,
  );
  console.log(`  distribuição: ${Object.keys(dist).sort((a, b) => a - b).map((k) => `${k}★:${dist[k]}`).join(' ')}`);
}
function pct(a, b) {
  return b ? `${String(Math.round((a / b) * 100)).padStart(3)}%` : '  —';
}

// ── Acerto POR FAIXA DE CONFIANÇA ────────────────────────────────────────────
// ⚠️ A confiança só VALE se "alta" acertar mais que "média". Se as três faixas acertam igual,
// ela é decorativa, e qualquer limiar construído em cima dela é falso.
console.log('\n' + '='.repeat(78));
console.log('ACERTO POR FAIXA DE CONFIANÇA (dentro de ±1 da nota humana)');
for (const r of runs) {
  const c = r.linhas.filter(comparavel).filter((l) => l.confianca);
  if (!c.length) {
    console.log(`${rot(r)}: sem confiança gravada nesta run`);
    continue;
  }
  console.log(rot(r) + ':');
  for (const f of ['alta', 'media', 'baixa']) {
    const g = c.filter((l) => l.confianca === f);
    if (!g.length) continue;
    const ok = g.filter((l) => Math.abs(l.humana - l.agente) <= 1).length;
    console.log(`  ${f.padEnd(6)} n=${String(g.length).padStart(3)}  ±1 ${pct(ok, g.length)}`);
  }
}

// ── O que MUDOU entre a última e a penúltima ─────────────────────────────────
if (runs.length >= 2) {
  const a = runs[runs.length - 2];
  const b = runs[runs.length - 1];
  const antes = new Map(a.linhas.map((l) => [l.id, l]));
  const mudou = b.linhas.filter((l) => antes.has(l.id) && antes.get(l.id).agente !== l.agente);
  console.log('\n' + '='.repeat(78));
  console.log(`MUDARAM DE NOTA: ${mudou.length} de ${b.linhas.filter((l) => antes.has(l.id)).length} comparáveis`);

  // Estabilidade é sinal: rodada que mexe em quase tudo não calibrou, trocou de juiz.
  const grandes = mudou.filter((l) => Math.abs(l.agente - antes.get(l.id).agente) >= 2);
  console.log(`  saltos de 2★ ou mais: ${grandes.length}`);
  const paraPerto = mudou.filter(comparavel).filter((l) => {
    const d0 = Math.abs(antes.get(l.id).agente - l.humana);
    const d1 = Math.abs(l.agente - l.humana);
    return d1 < d0;
  }).length;
  const paraLonge = mudou.filter(comparavel).filter((l) => {
    const d0 = Math.abs(antes.get(l.id).agente - l.humana);
    const d1 = Math.abs(l.agente - l.humana);
    return d1 > d0;
  }).length;
  console.log(`  aproximaram do humano: ${paraPerto} · afastaram: ${paraLonge}`);

  console.log('\nOS 12 MAIORES MOVIMENTOS (leia o motivo, não o número):');
  mudou
    .sort((x, y) => Math.abs(y.agente - antes.get(y.id).agente) - Math.abs(x.agente - antes.get(x.id).agente))
    .slice(0, 12)
    .forEach((l) => {
      const a0 = antes.get(l.id);
      console.log(`\n  ${a0.agente} → ${l.agente}  (humano ${l.humana ?? '—'})  ${l.nome.slice(0, 52)}`);
      console.log(`    antes: ${(a0.leitura || '').slice(0, 150)}`);
      console.log(`    agora: ${(l.leitura || '').slice(0, 150)}`);
    });
}
