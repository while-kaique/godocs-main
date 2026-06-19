// Backfill retroativo de documentos ao Drive (projetos da nova versão, não-legado).
//
// Os bytes originais dos arquivos NÃO ficam em projetos/documentacao (lá só vai o
// texto extraído). A única cópia é o `api_logs.request_body` do iniciar-submissao,
// que guarda o JSON inteiro com o base64 dos docs. PORÉM o body é truncado em
// 500 KB (API_LOG_BODY_LIMIT) e os logs >30 dias são apagados pelo cron. Então só
// dá pra recuperar submissões recentes e de payload pequeno.
//
// Este módulo faz a AVALIAÇÃO (read-only): conta quantos são recuperáveis antes de
// qualquer upload. A execução do backfill é um passo separado.

import { getIniciarSubmissaoLogs, getProjetosLinkInfo } from '@/integrations/db/client.server';

export type BackfillStatus = 'recuperavel' | 'parcial' | 'perdido';

export type BackfillAssessItem = {
  projeto_id: string;
  nome: string | null;
  status: BackfillStatus;
  docs_completos: number; // nº de campos base64 íntegros (aspas fechadas) no body
  ja_tem_link: boolean; // já possui arquivos_links — não precisa de backfill
  created_at: string | null;
};

export type BackfillAssessment = {
  total_logs: number; // logs de iniciar-submissao com body
  projetos_com_log: number; // projetos distintos com log
  recuperaveis: number; // JSON íntegro + ≥1 doc completo
  parciais: number; // truncado, mas ≥1 doc completo extraível
  perdidos: number; // truncado sem doc completo / sem doc
  ja_com_link: number; // projetos com log que já têm arquivos_links
  projetos_sem_log: number; // não-legado, sem link e sem log (fora da retenção/500KB)
  itens: BackfillAssessItem[];
};

const TRUNC_MARKER = '…[truncado';
// Conta campos "base64":"..." com a aspa de fechamento presente (doc íntegro).
// Um base64 cortado no truncamento perde a aspa final → não casa.
const BASE64_FIELD_RE = /"base64"\s*:\s*"[^"]*"/g;

function countCompleteDocs(body: string): number {
  const m = body.match(BASE64_FIELD_RE);
  return m ? m.length : 0;
}

function isIntegro(body: string): boolean {
  if (body.includes(TRUNC_MARKER)) return false;
  try {
    const obj = JSON.parse(body) as { docs?: unknown };
    return Array.isArray(obj.docs) && obj.docs.length > 0;
  } catch {
    return false;
  }
}

function classify(body: string): { status: BackfillStatus; docs_completos: number } {
  const docs_completos = countCompleteDocs(body);
  if (isIntegro(body) && docs_completos > 0) return { status: 'recuperavel', docs_completos };
  if (docs_completos > 0) return { status: 'parcial', docs_completos };
  return { status: 'perdido', docs_completos };
}

export async function assessDocsBackfill(): Promise<BackfillAssessment> {
  const logs = await getIniciarSubmissaoLogs();
  const projetos = await getProjetosLinkInfo();

  const info = new Map<string, { nome: string | null; temLink: boolean }>();
  for (const p of projetos) {
    let temLink = false;
    try {
      const arr = p.arquivos_links ? JSON.parse(p.arquivos_links) : null;
      temLink = Array.isArray(arr) && arr.length > 0;
    } catch {
      temLink = false;
    }
    info.set(p.id, { nome: p.nome, temLink });
  }

  // Melhor log por projeto: mais docs completos; desempate pelo mais recente.
  const melhor = new Map<string, BackfillAssessItem>();
  for (const log of logs) {
    if (!log.projeto_id || !log.request_body) continue;
    const { status, docs_completos } = classify(log.request_body);
    const pinfo = info.get(log.projeto_id);
    const item: BackfillAssessItem = {
      projeto_id: log.projeto_id,
      nome: pinfo?.nome ?? null,
      status,
      docs_completos,
      ja_tem_link: pinfo?.temLink ?? false,
      created_at: log.created_at,
    };
    const atual = melhor.get(log.projeto_id);
    if (
      !atual ||
      docs_completos > atual.docs_completos ||
      (docs_completos === atual.docs_completos && (log.created_at ?? '') > (atual.created_at ?? ''))
    ) {
      melhor.set(log.projeto_id, item);
    }
  }

  const itens = [...melhor.values()];
  const recuperaveis = itens.filter((i) => i.status === 'recuperavel').length;
  const parciais = itens.filter((i) => i.status === 'parcial').length;
  const perdidos = itens.filter((i) => i.status === 'perdido').length;
  const ja_com_link = itens.filter((i) => i.ja_tem_link).length;

  // Projetos da nova versão (não-legado) que precisam de doc, sem link e sem log:
  // fora da janela de retenção / nunca logados → re-upload manual.
  const comLog = new Set(itens.map((i) => i.projeto_id));
  const projetos_sem_log = projetos.filter(
    (p) => !p.id.startsWith('legado') && !comLog.has(p.id) && !info.get(p.id)?.temLink,
  ).length;

  return {
    total_logs: logs.length,
    projetos_com_log: melhor.size,
    recuperaveis,
    parciais,
    perdidos,
    ja_com_link,
    projetos_sem_log,
    itens: itens.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
  };
}
