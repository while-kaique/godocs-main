// Copia para um relatório de run os campos que descrevem o PROJETO, não o julgamento.
// Uso: node enriquecer-run.mjs /tmp/runN.json
//
// ⚠️ `especial` e `dossie` dizem o que o projeto É, e valem igual em qualquer run. Quando o
// runner ganha um campo novo no meio da noite, as runs já disparadas ficam sem ele e a página
// passa a mentir por omissão: sem `especial`, o rótulo "com nota humana" volta a dar a entender
// que a triagem estrelou centenas de especiais; sem `dossie`, os 30 projetos que não têm o que
// ler voltam a contar como discordância.
//
// A fonte é a baseline do run 1, que é versionada — não um arquivo temporário.
import { readFileSync, writeFileSync } from 'node:fs';

const ALVO = process.argv[2];
if (!ALVO) {
  console.error('uso: node enriquecer-run.mjs /tmp/runN.json');
  process.exit(2);
}
const BASE = 'docs/baselines/estrelas-2026-09-03-run1.json';
const base = new Map(JSON.parse(readFileSync(BASE, 'utf8')).linhas.map((l) => [l.id.toLowerCase(), l]));
const d = JSON.parse(readFileSync(ALVO, 'utf8'));

let esp = 0;
let dos = 0;
for (const l of d.linhas) {
  const b = base.get(l.id.toLowerCase());
  if (!b) continue;
  if (l.especial === undefined && b.especial !== undefined) {
    l.especial = b.especial;
    esp++;
  }
  if (l.dossie === undefined && b.dossie !== undefined) {
    l.dossie = b.dossie;
    dos++;
  }
}
writeFileSync(ALVO, JSON.stringify(d, null, 1));
console.log(`${ALVO}: ${esp} projetos ganharam "especial", ${dos} ganharam "dossie" (de ${d.linhas.length})`);
