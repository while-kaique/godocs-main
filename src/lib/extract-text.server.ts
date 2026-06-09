// Extração de texto de arquivos enviados pelo usuário
// Suporta: TXT, MD, PDF, DOCX, DOC

const MAX_CHARS = 50_000;

const log = (...args: unknown[]) => console.log('[extract-text]', ...args);
const err = (...args: unknown[]) => console.error('[extract-text]', ...args);

export async function extractTextFromBase64(base64: string, fileName: string): Promise<string> {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const bufferSize = Math.round((base64.length * 3) / 4 / 1024);
  log(`Iniciando extração — arquivo: "${fileName}", ext: "${ext}", tamanho estimado: ~${bufferSize}KB`);

  const buffer = Buffer.from(base64, 'base64');
  log(`Buffer criado: ${buffer.length} bytes`);

  let text = '';

  try {
    if (ext === 'txt' || ext === 'md') {
      log('Modo: texto puro (utf-8)');
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
      log('mammoth importado. Chaves do módulo:', Object.keys(mammoth));
      log('Extraindo texto do DOCX...');
      const result = await mammoth.extractRawText({ buffer });
      log(`DOCX extraído: ${result.value.length} chars`);
      if (result.messages.length > 0) {
        log('Avisos do mammoth:', result.messages);
      }
      text = result.value;

    } else if (ext === 'json') {
      log('Modo: JSON — lendo como texto puro');
      text = buffer.toString('utf-8');
      log(`JSON lido: ${text.length} chars`);

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

  // Normaliza espaços e trunca
  const rawLen = text.length;
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + '\n\n[... documento truncado]';
    log(`Texto truncado de ${rawLen} para ${MAX_CHARS} chars`);
  }

  log(`Extração finalizada: ${text.length} chars retornados`);
  return text;
}
