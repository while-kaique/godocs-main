// Google Drive API v3 — upload dos documentos enviados na submissão.
//
// Os arquivos vão para uma pasta compartilhada (GOOGLE_DRIVE_FOLDER_ID). O link
// (webViewLink) de cada arquivo é gravado na coluna "URL" da planilha e em
// projetos.arquivos_links.
//
// ⚠️ O upload usa OAuth de USUÁRIO (getDriveAccessToken), não a Service Account:
// Service Accounts não têm cota de storage e recebem 403 ao criar arquivos no
// Meu Drive. As credenciais OAuth (rpa_ia@gocase.com, dono da pasta) resolvem.
// uploadDocsToDrive NUNCA propaga erro: loga e segue, para não quebrar a submissão.

import { getDriveAccessToken } from './auth';

const DEFAULT_FOLDER_ID = '1e_Fk8EhFsv_W-3A3dRpMIa2Wg1pBHem_';
const UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink';

function getFolderId(): string {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID;
}

export type DriveDoc = { base64: string; filename: string };

// Extensão → MIME (suficiente para os tipos de documento aceitos no upload).
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function base64ToUint8Array(b64: string): Uint8Array {
  // Remove prefixo data-URL ("data:...;base64,") se presente.
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Upload de um arquivo via multipart/related. Retorna o webViewLink.
export async function uploadFileToDrive(doc: DriveDoc): Promise<{ id: string; link: string }> {
  const token = await getDriveAccessToken();
  const folderId = getFolderId();
  const boundary = `godocs-${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  const metadata = { name: doc.filename, parents: [folderId] };
  const mimeType = mimeFromFilename(doc.filename);

  const pre =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const post = `\r\n--${boundary}--`;

  // Cast: o lib.dom desta versão tipa BlobPart como ArrayBufferView<ArrayBuffer>,
  // incompatível com Uint8Array<ArrayBufferLike>. Em runtime é um BlobPart válido.
  const body = new Blob([pre, base64ToUint8Array(doc.base64) as unknown as BlobPart, post]);

  const resp = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Drive upload falhou (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { id: string; webViewLink?: string };
  const link = data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`;
  return { id: data.id, link };
}

// Sobe vários arquivos; retorna só os links que tiveram sucesso. Erros por
// arquivo são logados e não propagados (submissão não pode quebrar por causa do
// Drive — ver nota no topo do arquivo).
export async function uploadDocsToDrive(docs: DriveDoc[]): Promise<string[]> {
  const links: string[] = [];
  for (const doc of docs) {
    try {
      const { link } = await uploadFileToDrive(doc);
      links.push(link);
    } catch (e) {
      console.error(`[google/drive] Falha no upload de "${doc.filename}":`, e);
    }
  }
  return links;
}
