// Reconciliação de SNAPSHOTS de auditoria (`projeto_versions`) — a REDE que fecha os
// furos do histórico de versões.
//
// Motivo: a versão é gravada só dentro de `submeterParaValidacao`, de forma
// NÃO-BLOQUEANTE (um erro ali não pode derrubar a submissão do usuário). Consequência:
// submissões cujo snapshot falhou ficam sem versão, e legados importados nunca tiveram
// uma. Sem "visão panorâmica completa de submissões e edições" confiável.
//
// Estratégia (espelha `reconciliarComplexidade`: o caminho quente segue não-bloqueante
// e o CRON é a rede): varre os projetos submetidos e garante que
//   1. todo submetido tenha ao menos a versão inicial (v1);
//   2. o ÚLTIMO snapshot reflita o estado editável atual — se divergiu, uma edição não
//      virou versão, então grava uma versão de reconciliação.
// Tudo que a reconciliação escreve é marcado `origem='reconciliado'` (nunca sobrescreve
// nem apaga um snapshot 'real'). Idempotente e convergente: depois de gravar uma versão
// igual ao estado atual, a próxima passada não encontra mais divergência.

import {
  getProjetosParaSnapshot,
  getUltimosSnapshotsResumo,
  getDocumentacaoConteudo,
  gravarVersaoProjeto,
  parseJson,
} from "@/integrations/db/client.server";
import { montarSnapshotProjeto, snapshotDiverge } from "@/lib/snapshot-projeto";

const log = (...a: unknown[]) => console.log("[reconciliarSnapshots]", ...a);
const err = (...a: unknown[]) => console.error("[reconciliarSnapshots]", ...a);

export type ReconciliacaoSnapshotsResultado = {
  submetidos: number;
  v1_criadas: number;
  reenvios_reconciliados: number;
  ja_ok: number;
  falhas: number;
};

/**
 * @param maxEscritas teto de versões gravadas por passada (bounda a rajada da 1ª
 *   execução; a convergência acontece ao longo de algumas passadas do cron).
 */
export async function reconciliarSnapshots(
  maxEscritas = 200,
): Promise<ReconciliacaoSnapshotsResultado> {
  const [projetos, ultimos] = await Promise.all([
    getProjetosParaSnapshot(),
    getUltimosSnapshotsResumo(),
  ]);

  let v1 = 0;
  let reenvios = 0;
  let jaOk = 0;
  let falhas = 0;

  for (const p of projetos) {
    if (v1 + reenvios >= maxEscritas) break;
    const id = String(p.id);
    const snapAtual = montarSnapshotProjeto(p);
    const anterior = ultimos.get(id);

    // Já tem versão e o estado bate → nada a fazer.
    if (anterior && !snapshotDiverge(snapAtual, anterior)) {
      jaOk++;
      continue;
    }

    try {
      const docRow = await getDocumentacaoConteudo(id);
      const doc = docRow?.conteudo
        ? (parseJson<Record<string, unknown>>(docRow.conteudo) ?? null)
        : null;
      const email = (p.responsavel_email as string | null) ?? null;

      if (!anterior) {
        // Sem nenhuma versão: reconstrói a inicial a partir do estado atual.
        await gravarVersaoProjeto(id, "submit_inicial", snapAtual, doc, email, null, "reconciliado");
        v1++;
      } else {
        // Estado editável divergiu do último snapshot: edição não capturada.
        await gravarVersaoProjeto(id, "reenvio", snapAtual, doc, email, null, "reconciliado");
        reenvios++;
      }
    } catch (e) {
      falhas++;
      err(`Falha ao reconciliar ${id}:`, e);
    }
  }

  const resultado: ReconciliacaoSnapshotsResultado = {
    submetidos: projetos.length,
    v1_criadas: v1,
    reenvios_reconciliados: reenvios,
    ja_ok: jaOk,
    falhas,
  };
  log(JSON.stringify(resultado));
  return resultado;
}
