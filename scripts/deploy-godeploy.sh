#!/usr/bin/env bash
#
# Upload de deploy do GoDocs para o Godeploy.
#
# Varre TODO o conteúdo de dist/ (recursivo) + worker.js e:
#   1. faz o POST multipart no UPLOAD_URL (MCP getUploadToken)
#   2. imprime o manifest de assets (JSON) para colar no MCP updateApp
#
# Motivo de existir: a lista de arquivos é derivada do dist/ REAL, nunca
# mantida à mão. Assim, qualquer arquivo de public/ que o Vite copia para a
# raiz do dist/ (favicon.svg, robots.txt, etc.) entra no deploy automaticamente.
# (bug real: favicon.svg vivia em dist/ raiz, fora de dist/assets/, e o runbook
#  antigo só subia index.html + assets/* → /favicon.svg dava 404 e sumia.)
#
# Uso:
#   npm run build && npm run build:worker
#   scripts/deploy-godeploy.sh "<UPLOAD_TOKEN>" ["<UPLOAD_URL>"]
#
# O token e a URL vêm do MCP getUploadToken. O token é enviado como header
# Authorization: Bearer <token> (NÃO como query param). UPLOAD_URL é opcional
# (default: https://mcp.devgogroup.com/upload).
#
# Depois, no MCP updateApp, use:
#   appId    STAGING edf400b4  |  PROD 674a3710  (regra 13: staging ANTES de prod)
#   uploadId impresso abaixo (retornado pelo /upload)
#   entrypoint "worker.js"
#   assetConfig { "not_found_handling": "single-page-application" }
#   assets   -> o ASSETS_JSON impresso abaixo
#
set -euo pipefail

UPLOAD_TOKEN="${1:-}"
UPLOAD_URL="${2:-https://mcp.devgogroup.com/upload}"
if [ -z "$UPLOAD_TOKEN" ]; then
  echo "erro: informe o UPLOAD_TOKEN (MCP getUploadToken -> uploadToken)" >&2
  echo "uso: scripts/deploy-godeploy.sh \"<UPLOAD_TOKEN>\" [\"<UPLOAD_URL>\"]" >&2
  exit 2
fi

DIST="dist"
[ -f worker.js ] || { echo "erro: worker.js nao encontrado — rode 'npm run build:worker'" >&2; exit 1; }
[ -d "$DIST" ]   || { echo "erro: dist/ nao encontrado — rode 'npm run build'" >&2; exit 1; }

# Monta os -F: worker.js + cada arquivo de dist/ (path relativo SEM o prefixo dist/).
form_args=( -F "worker.js=@./worker.js" )
assets=()
while IFS= read -r f; do
  rel="${f#"$DIST"/}"                 # ex.: assets/foo.js, favicon.svg, index.html
  form_args+=( -F "${rel}=@./${f}" )
  assets+=( "$rel" )
done < <(find "$DIST" -type f | sort)

if [ "${#assets[@]}" -eq 0 ]; then
  echo "erro: dist/ esta vazio — rode 'npm run build'" >&2
  exit 1
fi

echo "Enviando ${#assets[@]} assets + worker.js para o Godeploy..." >&2
resp="$(curl -fsS -X POST "$UPLOAD_URL" -H "Authorization: Bearer $UPLOAD_TOKEN" "${form_args[@]}")"
echo "Resposta do /upload: $resp" >&2
echo >&2
echo "Cole o uploadId e o ASSETS_JSON abaixo no MCP updateApp:" >&2

# Manifest JSON (todos os arquivos do dist/; worker.js e o entrypoint, nao asset).
# Nomes sao paths de build (hash), sem caracteres que precisem de escape JSON.
json="["
first=1
for a in "${assets[@]}"; do
  if [ $first -eq 1 ]; then first=0; else json+=","; fi
  json+="\"$a\""
done
json+="]"
printf 'ASSETS_JSON=%s\n' "$json"
