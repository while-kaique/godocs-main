// Dossiê do projeto — lado server (T11). Junta as 6 fontes persistidas e monta via
// `montarDossie`. NUNCA lança: fonte que falha vira LACUNA declarada. NÃO toca em
// `chat_messages` (D17 — na v2 não há chat; o dossiê não pode depender dele).
import {
  getProjetoById,
  getDocumentacaoConteudo,
  getVersoesRecentesDe,
  getFormEventsByProjeto,
} from '@/integrations/db/client.server';
import { lerLinhaEspelho } from '@/lib/sheet-espelho';
import { chaveProjeto } from '@/lib/projeto-chave';
import { getCargoDe } from '@/lib/areas/teamguide.server';
import { montarDossie, type Dossie, type FontesDossie } from '@/lib/avaliacao/dossie';

async function tenta<T>(p: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await p();
  } catch (e) {
    console.warn('[dossie] fonte falhou (vira lacuna):', e instanceof Error ? e.message : e);
    return fallback;
  }
}

export async function carregarDossie(projetoIdBruto: string): Promise<Dossie | null> {
  // ⚠️ Id do legado chega da planilha em MAIÚSCULA (`LEGADO-049`) e o sync reverso grava a
  // linha em minúscula. O `lerLinhaEspelho` normaliza sozinho, os 3 leitores do SQLite não —
  // então, sem isto, o dossiê de um legado nasce SÓ com o espelho: sem `projetos`, sem
  // documentação, sem versões. Lacuna silenciosa, e o agente julga o que sobrou.
  const projetoId = chaveProjeto(projetoIdBruto);
  const projeto = (await tenta(async () => (await getProjetoById(projetoId)) ?? null, null)) as
    | Record<string, unknown>
    | null;

  const [docRow, versoes, eventos, espelho] = await Promise.all([
    tenta(async () => (await getDocumentacaoConteudo(projetoId)) ?? null, null),
    tenta(async () => (await getVersoesRecentesDe([projetoId])) ?? [], [] as unknown[]),
    tenta(async () => (await getFormEventsByProjeto(projetoId)) ?? [], [] as unknown[]),
    tenta(async () => (await lerLinhaEspelho(projetoId)) ?? null, null),
  ]);

  if (!projeto && !espelho) return null;

  const email =
    (typeof projeto?.responsavel_email === 'string' && projeto.responsavel_email) ||
    (espelho as Record<string, string> | null)?.Email ||
    null;
  // undefined = não consultada (lacuna 'teamguide'); null = consultada, sem cargo.
  let cargoAutor: string | null | undefined = undefined;
  if (email) {
    try {
      cargoAutor = await getCargoDe(email);
    } catch (e) {
      console.warn('[dossie] TeamGuide falhou (vira lacuna):', e instanceof Error ? e.message : e);
      cargoAutor = undefined;
    }
  }

  const fontes: FontesDossie = {
    projeto,
    documentacao: (docRow as { conteudo?: string } | null)?.conteudo ?? null,
    espelho: espelho as Record<string, string> | null,
    versoes: (versoes as FontesDossie['versoes']) ?? [],
    eventos: (eventos as FontesDossie['eventos']) ?? [],
    cargoAutor,
  };
  return montarDossie(fontes);
}
