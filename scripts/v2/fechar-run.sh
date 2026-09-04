#!/usr/bin/env bash
#
# Fecha uma rodada: enriquece o relatório, arquiva, compara com as anteriores e regera o
# artefato com TODAS as runs.
#
# Uso: scripts/v2/fechar-run.sh <numero-da-run> </tmp/runN.json>
#
# ⚠️ Existe para o ciclo não depender de eu lembrar a ordem às 4 da manhã. Cada passo aqui já
# custou um erro: relatório sem `especial` faz a página mentir por omissão; relatório em /tmp
# some; comparar sem arquivar perde o histórico que é a matéria-prima do ajuste fino.
set -euo pipefail

N="${1:-}"
ORIGEM="${2:-}"
if [ -z "$N" ] || [ -z "$ORIGEM" ]; then
  echo "uso: scripts/v2/fechar-run.sh <numero> <caminho-do-relatorio.json>" >&2
  exit 2
fi

DESTINO="docs/baselines/runs/run-${N}.json"
ARTEFATO="/tmp/claude-1000/-home-notebook-godocs-main/cd80ceb0-da2f-44d2-8477-2897cb2cedf6/scratchpad/estrelas.html"

echo "── 1. enriquecendo (especial, dossie) ──"
node scripts/v2/enriquecer-run.mjs "$ORIGEM"

echo "── 2. arquivando em $DESTINO ──"
mkdir -p docs/baselines/runs
cp "$ORIGEM" "$DESTINO"

echo "── 3. comparando com as rodadas anteriores ──"
ANTERIORES=(docs/baselines/estrelas-2026-09-03-run1.json)
for i in $(seq 2 "$N"); do
  [ -f "docs/baselines/runs/run-${i}.json" ] && ANTERIORES+=("docs/baselines/runs/run-${i}.json")
done
node scripts/v2/comparar-runs.mjs "${ANTERIORES[@]}" | tee "docs/baselines/runs/run-${N}-comparacao.txt"

echo "── 4. regerando o artefato com todas as rodadas ──"
node scripts/v2/gerar-artefato.mjs "$ARTEFATO" "${ANTERIORES[@]}"

echo
echo "pronto. falta: escrever docs/baselines/runs/run-${N}.md (o log do que mudou e por quê)"
echo "e publicar $ARTEFATO no artefato (favicon ⭐ explícito)."
