// Extração de texto de arquivos enviados pelo usuário
// Suporta: TXT, MD, PDF, DOCX, DOC, JSON e arquivos de código (TS, JS, PY, etc.)

const MAX_CHARS_PER_FILE = 150_000;
const MAX_CHARS_TOTAL = 200_000;
const CHARS_PER_TOKEN = 4; // heurística: ~4 chars por token

const log = (...args: unknown[]) => console.log('[extract-text]', ...args);
const err = (...args: unknown[]) => console.error('[extract-text]', ...args);

const estTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
const ext = (filename: string) => (filename.split('.').pop() ?? '?').toLowerCase();

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
  const charsAntesTrunc = combined.length;
  let truncado = false;

  if (combined.length > MAX_CHARS_TOTAL) {
    combined = combined.slice(0, MAX_CHARS_TOTAL) + '\n\n[... conteúdo total truncado]';
    truncado = true;
    log(`⚠️ Total truncado de ${charsAntesTrunc} para ${MAX_CHARS_TOTAL} chars (perdidos ${charsAntesTrunc - MAX_CHARS_TOTAL} chars)`);
  }

  logAnaliseEficiencia(comConteudo, charsAntesTrunc, combined.length, truncado, files.length);

  const tokensEstimados = estTokens(combined.length);
  log(`Total combinado: ${combined.length} chars (~${tokensEstimados} tokens) de ${parts.length}/${files.length} arquivo(s) com conteúdo`);
  return combined;
}

/**
 * Log de análise interna pós-extração — ajuda a entender onde os tokens são
 * gastos e identificar oportunidades de eficiência (arquivos dominantes,
 * tipos que mais consomem, taxa de truncamento).
 */
function logAnaliseEficiencia(
  comConteudo: { filename: string; text: string }[],
  charsAntesTrunc: number,
  charsFinais: number,
  truncado: boolean,
  totalArquivos: number,
): void {
  if (comConteudo.length === 0) {
    log('📊 ANÁLISE: nenhum arquivo com conteúdo extraível.');
    return;
  }

  const tokensTotais = estTokens(charsAntesTrunc) || 1;

  // Ranking por consumo de chars (maiores primeiro)
  const ranking = comConteudo
    .map((r) => ({
      arquivo: r.filename,
      ext: ext(r.filename),
      chars: r.text.length,
      tokens: estTokens(r.text.length),
      pctTokens: `${((estTokens(r.text.length) / tokensTotais) * 100).toFixed(1)}%`,
    }))
    .sort((a, b) => b.chars - a.chars);

  // Agregação por extensão
  const porExtMap = new Map<string, { chars: number; arquivos: number }>();
  for (const r of comConteudo) {
    const e = ext(r.filename);
    const cur = porExtMap.get(e) ?? { chars: 0, arquivos: 0 };
    porExtMap.set(e, { chars: cur.chars + r.text.length, arquivos: cur.arquivos + 1 });
  }
  const porExt = [...porExtMap.entries()]
    .map(([e, v]) => ({
      ext: e,
      arquivos: v.arquivos,
      chars: v.chars,
      tokens: estTokens(v.chars),
      pctTokens: `${((estTokens(v.chars) / tokensTotais) * 100).toFixed(1)}%`,
    }))
    .sort((a, b) => b.chars - a.chars);

  console.log('\n┌─── 📊 ANÁLISE DE EFICIÊNCIA (pós-extração) ───────────────────');
  console.log(`│ Arquivos com conteúdo: ${comConteudo.length}/${totalArquivos}`);
  console.log(`│ Chars extraídos: ${charsAntesTrunc} (~${estTokens(charsAntesTrunc)} tokens)`);
  console.log(`│ Chars enviados à IA: ${charsFinais} (~${estTokens(charsFinais)} tokens)`);
  console.log(`│ Truncado: ${truncado ? `SIM — descartados ~${estTokens(charsAntesTrunc - charsFinais)} tokens` : 'não'}`);
  console.log(`│ Limite total: ${MAX_CHARS_TOTAL} chars (~${estTokens(MAX_CHARS_TOTAL)} tokens)`);
  console.log('│');
  console.log('│ Top arquivos por consumo de tokens:');
  ranking.slice(0, 10).forEach((r, i) => {
    console.log(`│   ${i + 1}. [${r.pctTokens.padStart(5)}] ~${r.tokens} tok — ${r.arquivo} (.${r.ext})`);
  });
  if (ranking.length > 10) {
    const resto = ranking.slice(10);
    const restoTokens = resto.reduce((acc, r) => acc + r.tokens, 0);
    console.log(`│   ...+${resto.length} arquivo(s) somando ~${restoTokens} tokens`);
  }
  console.log('│');
  console.log('│ Consumo por tipo de arquivo:');
  porExt.forEach((r) => {
    console.log(`│   .${r.ext.padEnd(5)} ${String(r.arquivos).padStart(3)} arq · ~${String(r.tokens).padStart(6)} tok · ${r.pctTokens}`);
  });
  console.log('└───────────────────────────────────────────────────────────────\n');
}
