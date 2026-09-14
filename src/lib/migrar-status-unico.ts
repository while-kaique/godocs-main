/**
 * Migração da planilha para a coluna ÚNICA de status — módulo PURO + rotina de escrita.
 *
 * ## O que ela faz
 * Recalcula a coluna `Status` de cada linha a partir do PAR antigo (`Status`,
 * `Aprovação do Líder`), usando a régua declarada em `status-funil.ts`. Nada aqui decide
 * nada: a decisão está na função pura `unificarStatus`, e esta rotina só a aplica.
 *
 * ## O que ela NÃO faz, de propósito
 * ⚠️ **Não apaga a coluna `Aprovação do Líder`.** Ela fica congelada, com o valor histórico:
 * é quem registra QUEM liberou o projeto, e apagar é irreversível numa planilha de 782
 * linhas. O que muda é ela deixar de ser régua do funil — quem lê o estado passa a ler o
 * `Status`. A `Justificativa Aprovação do Líder` continua sendo escrita normalmente (é o
 * checklist inteiro do líder, que a ficha mostra).
 *
 * ⚠️ **Não toca `Atualizado Em`.** É carimbo do sistema para o autor ("seu legado foi
 * regularizado"), e uma migração administrativa não é uma edição do projeto — o mesmo
 * invariante do write-back da triagem (gotcha 2 do `/dashboard`).
 *
 * ⚠️ **`dry` é o DEFAULT.** Gravar exige `{"dry": false}` explícito, como em
 * `converterParaCustoEvitadoPuro` e no `reabrir` da pré-aprovação.
 *
 * ## Por que ela é quase um no-op em produção
 * Medido em 14/09/2026 sobre as 782 linhas: 615 já são `Aprovado`, 144 `Reprovado` e 19
 * `Descontinuado` — e decisão final vence o parecer do líder, então essas 778 não mudam.
 * Sobram as 3 `Pendente` (que continuam `Pendente`, sem parecer) e o punhado que estiver em
 * `Reenvio Pendente`. Uma migração que reescreve tudo seria o risco; esta encosta no mínimo.
 */
import { lerResumosEspelho, espelharEscrita } from "@/lib/sheet-espelho";
import { updateRowByProjectId } from "@/lib/google/sheets";
import { COLUNA_ESTADO_LIDER } from "@/lib/aprovacoes-parecer";
import { unificarStatus } from "@/lib/status-funil";

/** Uma linha que a migração mudaria (ou mudou). */
export type MudancaStatus = {
  id: string;
  de: string;
  para: string;
  /** O que a coluna do líder dizia — é o que justifica a mudança. */
  parecer: string;
};

export type RelatorioMigracao = {
  ok: boolean;
  dry: boolean;
  /** Quantas linhas o espelho devolveu. */
  lidas: number;
  /** Quantas já estavam no vocabulário novo (nada a fazer). */
  inalteradas: number;
  mudancas: MudancaStatus[];
  /** Ids cuja escrita na planilha falhou (o resto seguiu). */
  falhas: string[];
  motivo?: string;
};

/**
 * Decide as mudanças a partir das linhas do espelho. PURA — é o que os testes exercitam.
 *
 * ⚠️ Linha sem `ID Projeto` é DESCARTADA, nunca "migrada para Pendente": sem id não há o que
 * endereçar, e inventar um destino para ela seria escrever na linha errada.
 */
export function planejarMigracao(linhas: readonly Record<string, string>[]): {
  mudancas: MudancaStatus[];
  inalteradas: number;
} {
  const mudancas: MudancaStatus[] = [];
  let inalteradas = 0;
  for (const linha of linhas) {
    const id = String(linha["ID Projeto"] ?? "").trim();
    if (!id) continue;
    const de = String(linha["Status"] ?? "").trim();
    const parecer = String(linha[COLUNA_ESTADO_LIDER] ?? "").trim();
    const para = unificarStatus(de, parecer);
    if (de === para) {
      inalteradas += 1;
      continue;
    }
    mudancas.push({ id, de: de || "(vazio)", para, parecer: parecer || "(vazio)" });
  }
  return { mudancas, inalteradas };
}

/**
 * Aplica (ou simula) a migração.
 *
 * ⚠️ Escreve UMA coluna por linha e remenda o espelho no mesmo passo (invariante 1 do
 * espelho: toda escrita nossa no Sheets espelha na hora, senão a tela mostra o valor velho
 * até o próximo cron).
 * ⚠️ **Falha de uma linha não derruba as outras.** Numa migração de centenas de linhas, parar
 * no meio deixa a base pela metade sem relatório de onde parou.
 */
export async function migrarStatusUnico(
  opts: { dry?: boolean; limite?: number } = {},
): Promise<RelatorioMigracao> {
  const dry = opts.dry !== false;
  try {
    const { linhas } = await lerResumosEspelho();
    const { mudancas, inalteradas } = planejarMigracao(
      linhas as unknown as Record<string, string>[],
    );
    const alvo = opts.limite ? mudancas.slice(0, opts.limite) : mudancas;
    const falhas: string[] = [];

    if (!dry) {
      for (const m of alvo) {
        const celula = { Status: m.para } as const;
        try {
          await updateRowByProjectId(m.id, celula);
          await espelharEscrita(m.id, celula);
        } catch (e) {
          console.error(`[migrar-status] falha em ${m.id}:`, e);
          falhas.push(m.id);
        }
      }
    }

    return { ok: true, dry, lidas: linhas.length, inalteradas, mudancas: alvo, falhas };
  } catch (e) {
    return {
      ok: false,
      dry,
      lidas: 0,
      inalteradas: 0,
      mudancas: [],
      falhas: [],
      motivo: e instanceof Error ? e.message : String(e),
    };
  }
}
