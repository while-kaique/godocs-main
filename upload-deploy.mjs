/**
 * Script de upload para o GoDeploy — gerado pelo Claude
 * Executa: node upload-deploy.mjs
 * Requer Node.js 18+
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOAD_TOKEN = '9a40598e-dc61-40d3-ae81-b2fd592b82a8';
const UPLOAD_URL = 'https://mcp.devgogroup.com/upload';

// Coleta todos os arquivos do dist/ + worker.js
function collectFiles() {
  const files = [];

  // worker.js (backend)
  files.push({ name: 'worker.js', path: path.join(__dirname, 'worker.js') });

  // dist/assets/* e dist/index.html (SPA frontend)
  const distDir = path.join(__dirname, 'dist');
  function walk(dir, base = '') {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      if (fs.statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        // Usa o caminho sem o prefixo "dist/"
        files.push({ name: rel, path: full });
      }
    }
  }
  walk(distDir);

  return files;
}

async function upload() {
  const files = collectFiles();
  console.log(`Enviando ${files.length} arquivos...`);

  const form = new FormData();
  for (const f of files) {
    const content = fs.readFileSync(f.path);
    form.append(f.name, new Blob([content]), f.name);
    process.stdout.write(`  + ${f.name} (${Math.round(content.length / 1024)}KB)\n`);
  }

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('Erro no upload:', res.status, text);
    process.exit(1);
  }

  const { uploadId } = JSON.parse(text);
  console.log('\n✅ Upload concluído!');
  console.log('uploadId:', uploadId);
  console.log('\nCopie o uploadId acima e cole no chat do Claude para finalizar o deploy.');
}

upload().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
