/**
 * Dashboard do admin — a planilha como fonte de verdade, lida do ESPELHO.
 *
 * A tela original lia `getProjetosWithArea()` (SQLite) e por isso mostrava rascunho e
 * status interno desatualizado: o "Status" que vale é o da coluna do Sheets, mantido
 * à mão pela triagem (o sync reverso inclusive EXCLUI `status` dos campos que voltam
 * para o SQLite). A correção foi passar a listar **a planilha** — e isso continua valendo:
 * o que a tela mostra é a LINHA DA PLANILHA, nunca o estado interno de `projetos`.
 *
 * O que mudou (11/08/2026): a linha não vem mais de um `readAllRows()` no meio do request,
 * e sim do **espelho** da planilha no SQLite (`sheet-espelho.ts`), atualizado pelo cron de
 * 5 min e remendado na hora por toda escrita nossa. Com isso caiu o cache de 60 s com SWR
 * e a máquina de patches em memória, que existiam só para esconder uma leitura de ~2 s —
 * o remendo agora mora no banco (coluna `patch`), então vale para qualquer isolate.
 *
 * Consequências (as mesmas de antes, pelo mesmo motivo):
 * - **Rascunho não aparece** (nunca vai à planilha) — é o comportamento desejado.
 * - Colunas manuais (Diff Horas / Diff Saving, Observações da revisão) chegam junto: o
 *   espelho guarda a linha CRUA, inteira.
 * - Toda coluna é chaveada pelo NOME REAL do cabeçalho, então reordenar/inserir coluna
 *   na planilha não quebra a tela (mesma garantia de `google/sheets.ts`).
 * - `?refresh=1` deixou de "furar cache" e passou a **sincronizar de verdade** (lê a
 *   planilha agora e regrava o espelho) — é o botão "Atualizar" da triagem.
 */
import { z } from 'zod';
import { updateRowByProjectId, type SheetRow } from '@/lib/google/sheets';
import { insertAdminStatusLog, getAdminStatusLogs } from '@/integrations/db/client.server';
import {
  lerResumosEspelho,
  lerLinhaEspelho,
  espelharEscrita,
  statusEspelho,
} from '@/lib/sheet-espelho';
import { syncSheetsToSqlite } from '@/lib/google/sync-reverse';
import {
  texto,
  ouTraco,
  numero,
  chaveStatus,
  chaveBusca,
  mapResumo,
  ordenarPorDataDesc,
  contarPorStatus,
  type ProjetoDashboardResumo,
} from '@/lib/dashboard-resumo';

// Os mappers moram no módulo PURO `dashboard-resumo.ts` (o espelho recorta as MESMAS
// colunas, e um módulo de servidor importando esta tela criaria ciclo). Re-exportados aqui
// porque os call sites e os testes de sempre os esperam neste módulo — fonte única, sem
// nada redigitado.
export {
  texto,
  ouTraco,
  numero,
  chaveStatus,
  chaveBusca,
  mapResumo,
  ordenarPorDataDesc,
  contarPorStatus,
  COLUNAS_RESUMO,
  recortarResumo,
} from '@/lib/dashboard-resumo';
export type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Status que a tela pode GRAVAR na planilha, na ordem em que aparecem na triagem.
 * ⚠️ Estes textos precisam existir na validação de dados (dropdown) da coluna
 * "Status" — escrever um valor fora do dropdown não falha, mas deixa a célula
 * marcada como inválida para quem abre a planilha.
 */
export const STATUS_GRAVAVEIS = [
  'Pendente',
  'Em validação',
  'Aprovado',
  'Reenvio Pendente',
  'Reprovado',
  'Descontinuado',
] as const;
export type StatusGravavel = (typeof STATUS_GRAVAVEIS)[number];

export type ListagemDashboard = {
  projetos: ProjetoDashboardResumo[];
  contagem: Record<string, number>; // statusChave → total ('sem_status' quando vazio)
  total: number;
  /** ISO — quando a planilha foi lida pela última vez (a idade do ESPELHO, não do request). */
  lidoEm: string;
  /** O espelho passou de `ESPELHO_VELHO_MS` sem sincronizar → a tela avisa. */
  espelhoVelho: boolean;
  /** A última corrida do sync falhou (a anterior pode ter dado certo). */
  syncFalhou: boolean;
  /** Nunca sincronizou (banco novo / primeiro deploy) — a tela pede "Atualizar". */
  semEspelho: boolean;
};

export type DetalheDashboard = {
  id: string;
  /** Todas as células não-vazias da linha, chaveadas pelo nome real da coluna. */
  campos: Record<string, string>;
  /** Mudanças de status feitas por esta tela (a planilha não guarda autoria). */
  historico: {
    status_anterior: string | null;
    status_novo: string;
    observacoes: string | null;
    admin_email: string;
    created_at: string | null;
  }[];
};

// ─── Leitura do espelho ──────────────────────────────────────────────────────

/**
 * Idade a partir da qual a tela avisa que o espelho está velho. O cron roda a cada 5 min,
 * então 20 min sem sincronizar significa que **4 corridas** falharam ou pararam — é sinal
 * de problema, não de cadência. É o antídoto para o único jeito de esta arquitetura mentir:
 * o sync morrer em silêncio e a tela seguir mostrando dado velho com cara de novo.
 */
export const ESPELHO_VELHO_MS = 20 * 60 * 1000;

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Listagem da triagem — lê o ESPELHO da planilha (SQLite), nunca o Sheets em request e
 * nunca o estado interno de `projetos`.
 *
 * @param refresh `?refresh=1` — o botão "Atualizar" da tela. Não é mais "furar cache": roda
 *                um **sync de verdade** (lê a planilha, regrava o espelho) e só então lê.
 *                Falha do Sheets aqui **não** derruba a tela: o espelho anterior segue
 *                servindo e a resposta avisa por `syncFalhou`.
 */
export async function listarProjetosDashboard(refresh = false): Promise<ListagemDashboard> {
  if (refresh) {
    try {
      await syncSheetsToSqlite('manual');
    } catch (e) {
      // `syncSheetsToSqlite` já não propaga por si; este catch é o cinto do cinto.
      console.error('[dashboard-admin] sync manual falhou (servindo o espelho atual):', e);
    }
  }

  const [{ linhas, lidoEmMs }, saude] = await Promise.all([lerResumosEspelho(), statusEspelho()]);
  const projetos = linhas
    .map(mapResumo)
    .filter((p): p is ProjetoDashboardResumo => p != null)
    .sort(ordenarPorDataDesc);

  // A idade é do dado: preferimos o carimbo da última corrida OK e caímos no `lido_em` das
  // linhas (o espelho pode ter linhas de antes de `sync_runs` existir).
  const idadeRef = saude.ultimoSyncOkMs ?? lidoEmMs;
  return {
    projetos,
    contagem: contarPorStatus(projetos),
    total: projetos.length,
    lidoEm: new Date(idadeRef ?? Date.now()).toISOString(),
    espelhoVelho: idadeRef != null && Date.now() - idadeRef > ESPELHO_VELHO_MS,
    syncFalhou: saude.ultimaFalhou,
    semEspelho: idadeRef == null || projetos.length === 0,
  };
}

/**
 * Detalhe de um projeto: a linha INTEIRA da planilha (todas as células preenchidas), vinda
 * do espelho — inclusive as colunas MANUAIS (Diff Horas/Saving) e a justificativa do
 * parecer do líder, que a listagem não carrega. O frontend agrupa os campos; colunas que
 * não conhecemos aparecem numa seção "Outras colunas" em vez de desaparecerem.
 */
export async function getProjetoDashboard(id: string): Promise<DetalheDashboard> {
  z.string().min(1).max(120).parse(id);

  // As duas leituras são INDEPENDENTES e cada round-trip ao SQLite do Godeploy entra no tempo
  // de abrir a ficha — em série, o histórico só começava depois de a linha chegar.
  //
  // ⚠️ O `catch` do histórico fica DENTRO do `Promise.all`, e não num `try` em volta: ele é
  // acessório (auditoria fora do ar não pode impedir a triagem de abrir a ficha) e, no caminho
  // do 404, quem lança é a checagem da linha — uma rejeição solta do log viraria "unhandled
  // rejection" no worker, porque ninguém mais estaria esperando por ela.
  const [alvo, historico] = await Promise.all([
    lerLinhaEspelho(id),
    getAdminStatusLogs(id)
      .then((logs): DetalheDashboard['historico'] =>
        logs.map((l) => ({
          status_anterior: l.status_anterior,
          status_novo: l.status_novo,
          observacoes: l.observacoes,
          admin_email: l.admin_email,
          created_at: l.created_at,
        })),
      )
      .catch((e): DetalheDashboard['historico'] => {
        console.error('[dashboard-admin] falha ao ler histórico de status:', e);
        return [];
      }),
  ]);

  if (!alvo) {
    throw Object.assign(new Error('Projeto não encontrado na planilha.'), { status: 404 });
  }
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(alvo)) {
    const val = texto(v as string | undefined);
    if (val) campos[k] = val;
  }

  return { id, campos, historico };
}

const statusSchema = z.object({
  projeto_id: z.string().min(1).max(120),
  status: z.enum(STATUS_GRAVAVEIS),
  // Motivo da revisão: vai para a coluna "Observações", que é o texto que o disparo de
  // e-mails de reenvio manda para o dono. `undefined` = não mexer na célula.
  observacoes: z.string().max(4000).optional(),
  // Motivos em COLUNA PRÓPRIA (não sequestram "Observações", que é o parecer usado pelo
  // disparo de e-mails): `motivo_reenvio` acompanha "Reenvio Pendente" e `motivo_reprovado`
  // acompanha "Reprovado", sobrepondo o motivo escrito pelo analisador.
  // `undefined` = não mexer na célula.
  motivo_reenvio: z.string().max(4000).optional(),
  motivo_reprovado: z.string().max(4000).optional(),
});

/** Colunas que este módulo escreve — o teste garante que a lista não cresce por descuido. */
export const COLUNAS_ESCRITAS = [
  'Status',
  'Observações',
  // Motivos da triagem humana. "Motivo Reenvio" é escrita SÓ aqui (o sistema nunca a
  // toca); "Motivo Reprovado" também é escrita pelo analisador e a triagem sobrepõe.
  'Motivo Reenvio',
  'Motivo Reprovado',
] as const;

/**
 * Grava o status na planilha (a fonte de verdade da triagem) e registra quem mudou.
 *
 * ⚠️ NÃO escreve "Atualizado Em": aquela coluna é o carimbo da última escrita do
 * SISTEMA e é o que decide se um legado está regularizado (`pendente` em Meus
 * Projetos). Preenchê-la aqui marcaria como regularizado um legado que ninguém editou.
 *
 * ⚠️ Não mexe no `status` do SQLite: o sync reverso exclui `status` de propósito
 * (planilha manda) e o status interno pertence ao fluxo de submissão/análise. A
 * exceção conhecida é "Descontinuado", que o sync reverso reconhece e reflete na flag
 * `descontinuado` do projeto.
 */
export async function definirStatusProjeto(raw: unknown, adminEmail: string) {
  const { projeto_id, status, observacoes, motivo_reenvio, motivo_reprovado } =
    statusSchema.parse(raw);

  const linha = await lerLinhaEspelho(projeto_id);
  if (!linha) {
    throw Object.assign(new Error('Projeto não encontrado na planilha.'), { status: 404 });
  }

  const statusAnterior = texto(linha['Status']);
  const updates: Partial<Record<(typeof COLUNAS_ESCRITAS)[number], string>> = { Status: status };
  if (observacoes !== undefined) updates['Observações'] = ouTraco(observacoes);
  if (motivo_reenvio !== undefined) updates['Motivo Reenvio'] = ouTraco(motivo_reenvio);
  if (motivo_reprovado !== undefined) updates['Motivo Reprovado'] = ouTraco(motivo_reprovado);

  await updateRowByProjectId(projeto_id, updates);

  // Remenda o espelho com o que acabou de ser gravado: a tela reflete a mudança na hora,
  // sem esperar o cron. ⚠️ O remendo fica marcado com `escrito_em`, então um sync que
  // COMEÇOU antes desta escrita (e portanto leu a célula antiga) não a desfaz — era o
  // "status voltava atrás" que os patches em memória resolviam só dentro de um isolate.
  await espelharEscrita(projeto_id, updates);

  try {
    await insertAdminStatusLog({
      projeto_id,
      projeto_nome: texto(linha['Projeto']),
      status_anterior: statusAnterior,
      status_novo: status,
      // A auditoria guarda o texto que justificou a mudança: o parecer, se houver, ou
      // o motivo digitado no modal (reprovação/reenvio) — para o log não ficar mudo
      // quando o admin usa só a coluna de motivo.
      observacoes:
        observacoes?.trim() || motivo_reprovado?.trim() || motivo_reenvio?.trim() || null,
      admin_email: adminEmail,
    });
  } catch (e) {
    // Auditoria é registro paralelo — não pode desfazer uma escrita que já aconteceu.
    console.error('[dashboard-admin] falha ao registrar auditoria de status:', e);
  }

  return { ok: true, projeto_id, status, statusAnterior };
}
