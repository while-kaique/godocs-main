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
import { assertNaoEhDefaultDeProd } from '../env';

// Timeout de cada chamada ao Drive: o resumo da doc passou a ser gravado também dentro do laço do
// cron `recompilarDocsPendentes` (até 20 projetos por corrida) — um Drive pendurado não pode segurar
// a corrida inteira. Falha cai no catch de quem chama (best-effort, nunca lança).
const DRIVE_TIMEOUT_MS = 15_000;

const DEFAULT_FOLDER_ID = '1e_Fk8EhFsv_W-3A3dRpMIa2Wg1pBHem_';
const UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink';

function getFolderId(): string {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID;
  // Em staging, recusa cair na pasta de produção (env faltando) → não sobe no Drive real.
  assertNaoEhDefaultDeProd(folderId, DEFAULT_FOLDER_ID, 'GOOGLE_DRIVE_FOLDER_ID (pasta do Drive)');
  return folderId;
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
// `opts.folderId` permite gravar numa pasta diferente da padrão (ex.: o widget de
// Ajuda usa GOOGLE_DRIVE_FOLDER_ID_AJUDA p/ não misturar prints com docs de projeto).
export async function uploadFileToDrive(
  doc: DriveDoc,
  opts?: { folderId?: string },
): Promise<{ id: string; link: string }> {
  const token = await getDriveAccessToken();
  const folderId = opts?.folderId || getFolderId();
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

  const resp = await fetch(UPLOAD_URL, { signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS),
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

// Extrai o fileId de um webViewLink do Drive (".../d/<id>/view" ou "?id=<id>").
function fileIdFromLink(link?: string | null): string | null {
  if (!link) return null;
  return link.match(/\/d\/([^/?]+)/)?.[1] ?? link.match(/[?&]id=([^&]+)/)?.[1] ?? null;
}

// Salva o RESUMO da documentação gerada (markdown) como UM ÚNICO documento no
// Drive e retorna o webViewLink. Se `linkExistente` aponta para um doc já criado,
// ATUALIZA o conteúdo dele in-place (mesmo link) — assim editar o projeto N vezes
// não cria N arquivos. Se não existir (ou o update falhar), cria um novo.
// Nunca propaga erro (loga e retorna null) — a submissão não pode quebrar.
export async function upsertResumoDoc(
  filename: string,
  markdown: string,
  linkExistente?: string | null,
): Promise<string | null> {
  try {
    const token = await getDriveAccessToken();
    const fileId = fileIdFromLink(linkExistente);

    // 1) Atualização in-place (conteúdo) de um doc já existente.
    if (fileId) {
      const patchUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true&fields=id,webViewLink`;
      const resp = await fetch(patchUrl, { signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS),
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/markdown; charset=UTF-8' },
        body: markdown,
      });
      if (resp.ok) {
        const d = (await resp.json()) as { id: string; webViewLink?: string };
        return d.webViewLink ?? linkExistente ?? `https://drive.google.com/file/d/${d.id}/view`;
      }
      console.error(`[google/drive] PATCH do resumo falhou (${resp.status}) — criando novo.`);
      // cai para criar um novo abaixo
    }

    // 2) Criação de um novo doc (multipart/related, text/markdown UTF-8).
    const boundary = `godocs-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const metadata = { name: filename, parents: [getFolderId()], mimeType: 'text/markdown' };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${markdown}\r\n--${boundary}--`;
    const resp = await fetch(UPLOAD_URL, { signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!resp.ok) throw new Error(`Drive upload (resumo) falhou (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
    const d = (await resp.json()) as { id: string; webViewLink?: string };
    return d.webViewLink ?? `https://drive.google.com/file/d/${d.id}/view`;
  } catch (e) {
    console.error('[google/drive] Falha no upsert do resumo da documentação:', e);
    return null;
  }
}


// ─── LEITURA do texto dos documentos do Drive (11/09/2026) ─────────────────────────────────────
//
// ⚠️ Por que existe: a documentação compilada de cada projeto vive num `.md` no Drive (a coluna
// "URL" da planilha tem link em 757 das 770 linhas), e até aqui NINGUÉM a lia — o dossiê do time
// carregava só o link e a ferramenta `ler_evidencia` devolvia "texto não persistido". O agente
// julgava evidência que não podia abrir. Decisão do dono do produto: "veja os dados de evidências".
//
// Best-effort e bounded: falha em um arquivo vira aviso, nunca exceção; teto de caracteres total
// para o prompt não estourar; só tipos de TEXTO (markdown, txt, json, csv) e Google Docs (export
// text/plain). PDF/imagem ficam de fora (o texto deles nunca foi persistido) e são listados.
export const TETO_TEXTO_DRIVE = 9000;
const TETO_POR_ARQUIVO = 6000;
const MAX_ARQUIVOS_DRIVE = 3;

export type DocDrive = { link: string; nome: string | null; mime: string | null; texto: string | null; aviso: string | null };

export function extrairFileId(link: string): string | null {
  return fileIdFromLink(link);
}

export async function lerTextoDocsDrive(
  links: readonly string[],
  opts: { max?: number; teto?: number } = {},
): Promise<DocDrive[]> {
  const max = opts.max ?? MAX_ARQUIVOS_DRIVE;
  const teto = opts.teto ?? TETO_TEXTO_DRIVE;
  const out: DocDrive[] = [];
  let usado = 0;
  let token: string;
  try {
    token = await getDriveAccessToken();
  } catch (e) {
    return links.slice(0, max).map((link) => ({ link, nome: null, mime: null, texto: null, aviso: `sem token do Drive: ${e instanceof Error ? e.message : String(e)}` }));
  }
  for (const link of links.slice(0, max)) {
    const id = fileIdFromLink(link);
    if (!id) { out.push({ link, nome: null, mime: null, texto: null, aviso: 'link sem id de arquivo do Drive' }); continue; }
    try {
      const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS),
      });
      if (!meta.ok) { out.push({ link, nome: null, mime: null, texto: null, aviso: `metadados HTTP ${meta.status}` }); continue; }
      const m = (await meta.json()) as { name?: string; mimeType?: string; size?: string };
      const mime = m.mimeType ?? null;
      const ehTexto = !!mime && /^(text\/|application\/json|application\/x-yaml)/.test(mime);
      const ehGoogleDoc = mime === 'application/vnd.google-apps.document';
      if (!ehTexto && !ehGoogleDoc) { out.push({ link, nome: m.name ?? null, mime, texto: null, aviso: 'tipo sem texto extraível (não é markdown/texto/Google Docs)' }); continue; }
      const url = ehGoogleDoc
        ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`
        : `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS) });
      if (!r.ok) { out.push({ link, nome: m.name ?? null, mime, texto: null, aviso: `conteúdo HTTP ${r.status}` }); continue; }
      let texto = (await r.text()).replace(/\r\n/g, '\n').trim();
      const restante = teto - usado;
      const limite = Math.min(TETO_POR_ARQUIVO, restante);
      if (limite <= 0) { out.push({ link, nome: m.name ?? null, mime, texto: null, aviso: 'teto de texto do dossiê atingido' }); continue; }
      const cortado = texto.length > limite;
      if (cortado) texto = `${texto.slice(0, limite - 1)}…`;
      usado += texto.length;
      out.push({ link, nome: m.name ?? null, mime, texto, aviso: cortado ? `texto cortado em ${limite} caracteres` : null });
    } catch (e) {
      out.push({ link, nome: null, mime: null, texto: null, aviso: `falha ao ler: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return out;
}
