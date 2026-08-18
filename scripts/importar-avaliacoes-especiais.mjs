#!/usr/bin/env node
/**
 * Importa o lote de recomendações de estrelas da FORÇA-TAREFA para dentro do GoDocs.
 *
 * O pipeline que produz as notas (avaliadores por cluster de área → calibrador → revisor
 * adversarial) roda FORA do app e entrega um JSON. Este script só empurra o resultado para
 * `POST /api/admin/especiais/avaliacoes`, que grava na tabela interna `especial_avaliacao`.
 *
 * ⚠️ Nada disso vira nota: a coluna "Estrelas" da planilha só muda por clique de gente na
 * tela `/especiais`. O que entra aqui é SUGESTÃO + a leitura que a justifica.
 *
 * Uso:
 *   E2E_COOKIE="<cookie>" node scripts/importar-avaliacoes-especiais.mjs \
 *     <caminho-do-json> [--base https://godocs-staging.devgogroup.com] [--origem forca-tarefa-18-08]
 *
 * O cookie é necessário porque o edge do Godeploy exige OAuth em TODAS as rotas (inclusive
 * /api/*) — é o mesmo `E2E_COOKIE` do harness de E2E.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith('--'));
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : padrao;
};

const base = opt('base', 'https://godocs-staging.devgogroup.com');
const origem = opt('origem', 'forca-tarefa');
const modelo = opt('modelo', '');
const dry = args.includes('--dry');
const cookie = process.env.E2E_COOKIE;

if (!arquivo) {
  console.error('uso: node scripts/importar-avaliacoes-especiais.mjs <json> [--base URL] [--origem NOME] [--dry]');
  process.exit(2);
}
if (!cookie && !dry) {
  console.error('erro: E2E_COOKIE não definido (o edge exige OAuth em /api/*).');
  process.exit(2);
}

const bruto = JSON.parse(readFileSync(arquivo, 'utf-8'));
// Aceita tanto o JSON inteiro da força-tarefa quanto uma lista solta de avaliações.
const projetos = Array.isArray(bruto) ? bruto : (bruto.projetos ?? []);

const avaliacoes = projetos
  .filter((p) => p.id && p.estrelas_recomendada != null)
  .map((p) => ({
    projeto_id: String(p.id),
    estrelas_recomendada: Number(p.estrelas_recomendada),
    confianca: ['alta', 'media', 'baixa'].includes(p.confianca) ? p.confianca : 'media',
    leitura: p.leitura_auditoria ?? p.leitura ?? undefined,
    contestada: Boolean(p.contestada),
  }));

const dist = avaliacoes.reduce((m, a) => ({ ...m, [a.estrelas_recomendada]: (m[a.estrelas_recomendada] ?? 0) + 1 }), {});
console.log(`${avaliacoes.length} recomendações · distribuição:`, dist);
console.log(`destino: ${base} · origem: "${origem}"${modelo ? ` · modelo: ${modelo}` : ''}`);

if (dry) {
  console.log('--dry: nada foi enviado.');
  process.exit(0);
}

const r = await fetch(`${base}/api/admin/especiais/avaliacoes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ origem, modelo: modelo || undefined, avaliacoes }),
});
const texto = await r.text();
if (!r.ok) {
  console.error(`falhou (${r.status}):`, texto.slice(0, 400));
  process.exit(1);
}
console.log('ok:', texto);
