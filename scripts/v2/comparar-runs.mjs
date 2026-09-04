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

// ── Os BOLSÕES de divergência, por nota humana ───────────────────────────────
// ⚠️ A média esconde a forma do erro. No run 1 o viés agregado parecia moderado, e por baixo
// dele havia 173 projetos que o humano pôs em 0 e o agente subiu, contra 59 em que ele foi mais
// duro que o humano. São defeitos OPOSTOS e não se corrigem com o mesmo ajuste, então a tabela
// abaixo é a que diz o que calibrar.
console.log('\n' + '='.repeat(78));
console.log('ONDE O ERRO MORA (por nota humana, última run)');
{
  const r = runs[runs.length - 1];
  const c = r.linhas.filter(comparavel);
  const notas = [...new Set(c.map((l) => l.humana))].sort((a, b) => a - b);
  console.log('  humana   n   idêntica   agente ACIMA   agente ABAIXO   nota média do agente');
  for (const h of notas) {
    const g = c.filter((l) => l.humana === h);
    const ident = g.filter((l) => l.agente === h).length;
    const acima = g.filter((l) => l.agente > h).length;
    const abaixo = g.filter((l) => l.agente < h).length;
    const media = (g.reduce((a, l) => a + l.agente, 0) / g.length).toFixed(2);
    console.log(
      `  ${String(h).padStart(5)}  ${String(g.length).padStart(3)}   ${pct(ident, g.length)}      ${String(acima).padStart(4)}          ${String(abaixo).padStart(4)}              ${media}`,
    );
  }
}
// ── CONTESTAÇÕES: onde o PREÇO já pago talvez esteja errado ──────────────────
// ⚠️ A estrela é o pagamento do projeto especial, e projeto já aprovado JÁ FOI PAGO. Quando o
// agente diverge por 2 ou mais de uma nota que a triagem cravou, isso não é erro do agente a ser
// silenciado: é um caso para gente reabrir. O agente NÃO reescreve a nota (a coluna "Estrelas" só
// muda por clique humano) e a run nem grava recomendação por cima dela — o que ele faz é APONTAR,
// e apontar só serve se sair numa lista que alguém lê.
console.log('\n' + '='.repeat(78));
{
  const r = runs[runs.length - 1];
  const cont = r.linhas
    .filter(comparavel)
    .filter((l) => Math.abs(l.agente - l.humana) >= 2)
    .sort((a, b) => Math.abs(b.agente - b.humana) - Math.abs(a.agente - a.humana));
  const paraCima = cont.filter((l) => l.agente > l.humana).length;
  console.log(`CONTESTAÇÕES DE PREÇO: ${cont.length} projetos já avaliados divergem por 2★ ou mais`);
  console.log(`  o agente pagaria MAIS em ${paraCima} e MENOS em ${cont.length - paraCima}`);
  console.log('  (a nota humana não muda por isto; é lista para revisão de gente)\n');
  cont.slice(0, 20).forEach((l) => {
    const sinal = l.agente > l.humana ? 'subiria' : 'baixaria';
    console.log(`  humano ${l.humana} → agente ${l.agente}  (${sinal})  ${l.nome.slice(0, 46)}`);
    console.log(`     ${(l.leitura || '').slice(0, 160)}`);
  });
  if (cont.length > 20) console.log(`  … e mais ${cont.length - 20}. Lista inteira no artefato, filtro "Só divergências de 2★+".`);
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
