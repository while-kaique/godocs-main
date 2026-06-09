// Extração de texto de arquivos enviados pelo usuário
// Suporta: TXT, MD, PDF, DOCX, DOC, JSON e arquivos de código (TS, JS, PY, etc.)

const MAX_CHARS_PER_FILE = 150_000;
const MAX_CHARS_TOTAL = 600_000;

const log = (...args: unknown[]) => console.log('[extract-text]', ...args);
const err = (...args: unknown[]) => console.error('[extract-text]', ...args);

// Extensões que são lidas diretamente como UTF-8
const TEXT_EXTS = new Set([
  'txt', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'py',
  'sql', 'sh', 'yaml', 'yml', 'toml', 'css', 'html', 'xml',
]);

export async function extractTextFromBase64(base64: string, fileName: string): Promise<string> {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const bufferSize = Math.round((base64.length * 3) / 4 / 1024);
  log(`Iniciando extração — arquivo: "${fileName}", ext: "${ext}", tamanho estimado: ~${bufferSize}KB`);

  const buffer = Buffer.from(base64, 'base64');
  log(`Buffer criado: ${buffer.length} bytes`);

  let text = '';

  try {
    if (TEXT_EXTS.has(ext)) {
      log(`Modo: texto puro UTF-8 (${ext})`);
      text = buffer.toString('utf-8');
      log(`Texto extraído: ${text.length} chars`);

    } else if (ext === 'pdf') {
      log('Modo: PDF — enviando ao OCR Worker (Cloudflare)...');
      const ocrUrl = process.env.OCR_WORKER_URL;
      const ocrToken = process.env.OCR_WORKER_TOKEN;
      if (!ocrUrl || !ocrToken) {
        throw new Error('OCR_WORKER_URL e OCR_WORKER_TOKEN devem estar definidos nas variáveis de ambiente');
      }
      const resp = await fetch(ocrUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          Authorization: `Bearer ${ocrToken}`,
        },
        body: buffer,
      });
      if (!resp.ok) {
        throw new Error(`OCR Worker retornou ${resp.status}: ${await resp.text()}`);
      }
      const json = await resp.json() as { text?: string; content?: string };
      text = json.text ?? json.content ?? '';
      log(`PDF extraído via OCR Worker: ${text.length} chars`);

    } else if (ext === 'docx' || ext === 'doc') {
      log('Modo: DOCX — importando mammoth...');
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      log(`DOCX extraído: ${result.value.length} chars`);
      text = result.value;

    } else {
      log(`Extensão desconhecida "${ext}" — tentando utf-8`);
      text = buffer.toString('utf-8');
      log(`Texto lido como utf-8: ${text.length} chars`);
    }
  } catch (e) {
    err(`Falha ao extrair texto do arquivo "${fileName}":`, e);
    err('Stack:', e instanceof Error ? e.stack : String(e));
    text = '';
  }

  // Normaliza e trunca por arquivo
  const rawLen = text.length;
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > MAX_CHARS_PER_FILE) {
    text = text.slice(0, MAX_CHARS_PER_FILE) + '\n\n[... arquivo truncado]';
    log(`Texto truncado de ${rawLen} para ${MAX_CHARS_PER_FILE} chars`);
  }

  log(`Extração finalizada: ${text.length} chars retornados`);
  return text;
}

/** Extrai e concatena texto de múltiplos arquivos com separadores claros */
export async function extractTextFromMultipleFiles(
  files: { base64: string; filename: string }[],
): Promise<string> {
  log(`Extraindo ${files.length} arquivo(s):`, files.map((f) => f.filename).join(', '));

  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const text = await extractTextFromBase64(f.base64, f.filename);
        if (text.trim().length === 0) {
          err(`Arquivo "${f.filename}" extraído com 0 chars (vazio ou formato não legível)`);
        }
        return { filename: f.filename, text, ok: true };
      } catch (e) {
        err(`Falha ao extrair "${f.filename}":`, e instanceof Error ? e.message : String(e));
        return { filename: f.filename, text: '', ok: false };
      }
    }),
  );

  // Resumo por arquivo: chars extraídos e status
  log('Resultado da extração por arquivo:');
  for (const r of results) {
    const status = !r.ok ? '❌ ERRO' : r.text.trim().length === 0 ? '⚠️ VAZIO' : '✅ OK';
    log(`  ${status} — "${r.filename}": ${r.text.length} chars`);
  }

  const comConteudo = results.filter((r) => r.text.trim().length > 0);
  const semConteudo = results.filter((r) => r.text.trim().length === 0);
  if (semConteudo.length > 0) {
    err(`${semConteudo.length} arquivo(s) sem conteúdo extraível:`, semConteudo.map((r) => r.filename).join(', '));
  }

  const parts = comConteudo.map((r) => `=== ${r.filename} ===\n\n${r.text}`);

  let combined = parts.join('\n\n---\n\n');

  if (combined.length > MAX_CHARS_TOTAL) {
    combined = combined.slice(0, MAX_CHARS_TOTAL) + '\n\n[... conteúdo total truncado]';
    log(`Total truncado para ${MAX_CHARS_TOTAL} chars`);
  }

  const tokensEstimados = Math.round(combined.length / 4);
  log(`Total combinado: ${combined.length} chars (~${tokensEstimados} tokens) de ${parts.length}/${files.length} arquivo(s) com conteúdo`);
  return combined;
}
