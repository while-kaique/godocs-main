// Snapshot de auditoria de um projeto (`projeto_versions.snapshot_projeto`).
//
// FONTE ÚNICA do formato do snapshot: é montado tanto no caminho REAL
// (`submeterParaValidacao`, `origem='real'`) quanto na RECONCILIAÇÃO
// (`reconciliarSnapshots`, `origem='reconciliado'`). Antes o objeto era digitado
// inline no submit; extraído para os dois caminhos nunca divergirem no que gravam.
//
// Módulo PURO (sem I/O, sem React): recebe uma linha de projeto (ou objeto com as
// mesmas chaves) e devolve o snapshot. Testável direto.

export type SnapshotProjeto = Record<string, unknown>;

/** tipos_projeto é guardado como JSON string no banco; snapshot guarda o array. */
function parseTipos(raw: unknown): unknown {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v == null ? [] : v;
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Monta o snapshot imutável do estado do projeto. Mantém EXATAMENTE as chaves que o
 * Investigador / `diff-versoes` leem — ao adicionar campo aqui, cobrir os leitores.
 */
export function montarSnapshotProjeto(p: Record<string, unknown>): SnapshotProjeto {
  return {
    nome: p.nome,
    descricao_breve: p.descricao_breve,
    ferramenta: p.ferramenta,
    tipos_projeto: parseTipos(p.tipos_projeto),
    especial: p.especial,
    area: p.area,
    saving_horas: p.saving_horas,
    saving_reais: p.saving_reais,
    horas_carga_real: p.horas_carga_real,
    horas_escala: p.horas_escala,
    tipo_saving: p.tipo_saving,
    memorial_calculo: p.memorial_calculo,
    ganho_total_mensal: p.ganho_total_mensal,
    custo_externo_mensal: p.custo_externo_mensal,
    alguem_fazia: p.alguem_fazia,
    custo_evitado: p.custo_evitado,
    custo_evitado_justificativa: p.custo_evitado_justificativa,
    custo_evitado_itens: p.custo_evitado_itens,
    status: p.status,
  };
}

// Campos comparados para decidir se o ESTADO EDITÁVEL do projeto divergiu do último
// snapshot (i.e. houve uma edição que não virou versão). Deliberadamente NÃO inclui
// `status`/`validated_*`: a validação humana e o sync da planilha mudam o status sem
// que o dono tenha "reeditado" — tratar isso como edição encheria a timeline de
// reenvios-fantasma. `memorial_calculo`/`custo_evitado_itens` ficam de fora por serem
// derivados/verbosos (ruído de comparação); os números que importam já entram abaixo.
const CHAVES_NUMERICAS = [
  "saving_reais",
  "ganho_total_mensal",
  "saving_horas",
  "custo_externo_mensal",
  // 0/1 — comparado como número para 0, null e "0" (json_extract / coluna default /
  // snapshot antigo sem a chave) nunca contarem como divergência entre si.
  "especial",
] as const;

const CHAVES_TEXTO = [
  "tipo_saving",
  "nome",
  "area",
  "alguem_fazia",
  "custo_evitado",
  "descricao_breve",
  "ferramenta",
] as const;

function normNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normTxt(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * `true` quando o estado atual do projeto divergiu do último snapshot nos campos
 * editáveis — sinal de que uma edição não foi capturada como versão. Aceita tanto o
 * objeto do `montarSnapshotProjeto` quanto a projeção escalar vinda de `json_extract`
 * (mesmos nomes de chave). Idempotente por construção: depois que a reconciliação
 * grava uma versão igual ao estado atual, a próxima passada não diverge mais.
 */
export function snapshotDiverge(
  atual: Record<string, unknown>,
  anterior: Record<string, unknown> | null | undefined,
): boolean {
  if (!anterior) return true;
  for (const k of CHAVES_NUMERICAS) {
    if (normNum(atual[k]) !== normNum(anterior[k])) return true;
  }
  for (const k of CHAVES_TEXTO) {
    if (normTxt(atual[k]) !== normTxt(anterior[k])) return true;
  }
  return false;
}
