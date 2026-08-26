/**
 * CALIBRADOR do painel de agentes (T4) — módulo **PURO**: a reescala da rodada.
 *
 * ## Por que ele é obrigatório
 * Cada agente a mais num loop empurra a nota para CIMA. Na força-tarefa do JV foi o calibrador que
 * fez 99 projetos não passarem de 4★ (`especiais-seed.ts`); sem ele, três voltas viram inflação.
 *
 * ## As DUAS tarefas dele (a lição que o T1 mediu)
 * Um calibrador que só reescala a DISTRIBUIÇÃO arruma o histograma sem arrumar o PAR: ele pode
 * empurrar zeros para cima e notas altas para baixo e ainda "bater a curva". A matriz do T1 diz
 * onde dói: dos **17 zeros humanos, 12 saíram do zero**; dos **14 pratas, 10 caíram para bronze**.
 * Então aqui há dois mecanismos, e a ordem importa:
 *
 * 1. **PISO DE PROVA (por projeto, sem curva nenhuma)** — nota alta exige prova. É o que impede
 *    promover o lixo, não depende da composição do lote e não pode ser fraudado por sorte de
 *    amostra. Roda primeiro.
 * 2. **COTA POR FAIXA (por rodada, contra uma curva de referência)** — segura o topo quando a
 *    rodada inteira sai generosa. Só DESCE, começa pelos mais fracos e **preserva a ordem**.
 *
 * ## ⚠️ Duas armadilhas da curva de referência
 * - **A `CURVA_BASE` é a curva da BASE INTEIRA** (644 linhas, financeiros incluídos, 426 zeros) e
 *   **especiais AUDITADOS não se distribuem como ela** — no T2, só em `conteudo_criativo` as notas
 *   humanas foram `[0,0,0,1,2,2,3,3,3,4,5,5,7,10]` (6 de 14 são ≥3). Aplicar a curva da base como
 *   cota DURA sobre uma rodada de especiais rebaixaria prata correta. Daí `FATOR_TOLERANCIA` e
 *   `MIN_POR_FAIXA`, e daí a curva ser PARÂMETRO.
 * - **Usar as notas HUMANAS do test set como referência é VAZAMENTO** (calibrar contra o gabarito
 *   melhora o MAE do T7 e não generaliza para especial nenhum ainda não auditado). A referência
 *   tem de ser DECLARADA a priori. `curvaDeNotas` existe para declarar uma curva de outra
 *   população — nunca a do conjunto sob medição.
 *
 * ⚠️ Não escreve nada, não chama LLM (a redação da leitura é `agents/especiais-calibrador.ts`) e
 * **nunca PROMOVE**: rodada dura demais é problema do T3 (é lá que a média foi proibida), não se
 * conserta inflando aqui.
 *
 * ⚠️ Ele importa `LENTE_GATE` do módulo das lentes (fonte única da chave, em vez de redigitá-la),
 * e aquele módulo puxa o `llmChat` — então este arquivo é **server-side**: se um dia uma TELA
 * precisar da reescala, o que se move é a constante para um módulo sem LLM, não uma segunda cópia.
 */
import { CURVA_BASE, NOTA_MAX, percentilAcimaDe } from "@/lib/especiais-regua";
import { LIMIARES_GENEROSIDADE } from "@/lib/especiais-concordancia";
import {
  LENTE_GATE,
  type AvaliacaoLente,
  type Consolidado,
  type Evidencia,
} from "@/lib/agents/especiais-lentes";

// ─── Entrada ───────────────────────────────────────────────────────────────────

export type EntradaCalibragem = {
  projeto_id: string;
  /** A nota que saiu de `consolidarLentes`. */
  nota_preliminar: number;
  /** Nota da lente estrutural (`null` = ela falhou). */
  gate: number | null;
  gate_evidencia: Evidencia | null;
  /** Notas das lentes de VALOR (não-gate) que responderam. */
  notas_valor: number[];
};

/** Ponte do T3 para cá — evita que o chamador remonte a entrada à mão e erre o `gate`. */
export function entradaDeConsolidado(
  projeto_id: string,
  avaliacoes: AvaliacaoLente[],
  consolidado: Consolidado,
): EntradaCalibragem {
  return {
    projeto_id,
    nota_preliminar: consolidado.nota_preliminar,
    gate: consolidado.gate,
    gate_evidencia: consolidado.gate_evidencia,
    notas_valor: avaliacoes.filter((a) => a.lente !== LENTE_GATE).map((a) => a.nota),
  };
}

// ─── Mecanismo 1: piso de PROVA (por projeto) ──────────────────────────────────

/** Nota a partir da qual a prova do eixo estrutural tem de ser NOMEADA (≥3 = top 4% da base). */
export const NOTA_EXIGE_PROVA_NOMEADA = LIMIARES_GENEROSIDADE[0];
/** Nota a partir da qual um eixo forte sozinho não basta (≥5 = top 1%). */
export const NOTA_EXIGE_DOIS_EIXOS = LIMIARES_GENEROSIDADE[1];
/** Quantos eixos de VALOR precisam sustentar ≥`NOTA_EXIGE_PROVA_NOMEADA` para a nota passar de 4. */
export const EIXOS_VALOR_PARA_OURO = 2;

export type MotivoRebaixa = "prova_nao_nomeada" | "um_eixo_so" | "cota_da_faixa" | "fora_da_escala";

/**
 * Aplica os pisos de prova de UM projeto. Só desce.
 *
 * - **≥3 exige prova NOMEADA no eixo estrutural** — a régua põe evidência entre as condições do 3★,
 *   e o T3 deixa passar `gate 3 + prova vaga` (a margem do gate é 0 nesse caso, mas a própria nota
 *   do gate ainda vale 3). Sem prova nomeada o teto é `NOTA_EXIGE_PROVA_NOMEADA − 1`.
 * - **≥5 exige `EIXOS_VALOR_PARA_OURO` eixos de valor sustentando ≥3** — o 5★ da régua é
 *   conjuntivo ("plataforma **ou** produto interno, autonomia, várias áreas usando, ponteiro
 *   auditável"); um eixo forte sozinho é 4★, que é exatamente o que a faixa "Prata alta" descreve.
 */
export function aplicarPisosDeProva(e: EntradaCalibragem): {
  nota: number;
  motivos: MotivoRebaixa[];
} {
  const motivos: MotivoRebaixa[] = [];
  let nota = e.nota_preliminar;

  if (!Number.isFinite(nota)) return { nota: 0, motivos: ["fora_da_escala"] };
  if (nota < 0 || nota > NOTA_MAX) {
    nota = Math.max(0, Math.min(NOTA_MAX, Math.round(nota)));
    motivos.push("fora_da_escala");
  }

  if (nota >= NOTA_EXIGE_PROVA_NOMEADA && e.gate_evidencia !== "nomeada") {
    nota = NOTA_EXIGE_PROVA_NOMEADA - 1;
    motivos.push("prova_nao_nomeada");
  }

  if (nota >= NOTA_EXIGE_DOIS_EIXOS) {
    const fortes = e.notas_valor.filter((n) => n >= NOTA_EXIGE_PROVA_NOMEADA).length;
    if (fortes < EIXOS_VALOR_PARA_OURO) {
      nota = NOTA_EXIGE_DOIS_EIXOS - 1;
      motivos.push("um_eixo_so");
    }
  }

  return { nota, motivos };
}

// ─── Mecanismo 2: cota por faixa (por rodada) ──────────────────────────────────

/**
 * Quantas vezes a rodada pode passar do percentual da curva antes de a cota morder. ⚠️ Não é
 * frouxidão: a curva de referência é da base INTEIRA e uma página de 12 especiais auditados
 * legitimamente tem mais prata que ela (ver o cabeçalho).
 */
export const FATOR_TOLERANCIA = 2;

/**
 * Piso absoluto por faixa. Sem ele, uma página de 12 **nunca** poderia ter uma prata
 * (12 × 5,7% × 2 = 1,37 → 2, ok; mas ≥7★ daria 0,13 → 1 só por causa deste piso) — e cota que
 * proíbe a nota alta de existir é fraude na direção oposta à inflação.
 */
export const MIN_POR_FAIXA = 1;

export type Cota = {
  limiar: number;
  /** % da curva de referência em `limiar` ou acima. */
  referencia_pct: number;
  permitido: number;
  antes: number;
  depois: number;
};

/** Percentual de uma curva declarada (`{'0': 426, vazio: 100, …}`) em `nota` ou acima. */
export function percentilDaCurva(curva: Record<string, number>, nota: number): number {
  const total = Object.entries(curva)
    .filter(([k]) => k !== "vazio")
    .reduce((s, [, v]) => s + v, 0);
  if (total === 0) return 0;
  const acima = Object.entries(curva)
    .filter(([k]) => k !== "vazio" && Number(k) >= nota)
    .reduce((s, [, v]) => s + v, 0);
  return (acima / total) * 100;
}

/**
 * Monta uma curva de referência a partir de notas observadas. ⚠️ **Nunca** passe aqui as notas
 * humanas do conjunto que está sendo medido (vazamento — ver o cabeçalho); serve para DECLARAR a
 * curva de outra população (a força-tarefa, um período anterior, uma amostra separada).
 */
export function curvaDeNotas(notas: number[]): Record<string, number> {
  const curva: Record<string, number> = {};
  for (const n of notas) {
    const k = String(Math.max(0, Math.min(NOTA_MAX, Math.round(n))));
    curva[k] = (curva[k] ?? 0) + 1;
  }
  return curva;
}

/**
 * Quem sobrevive à cota, do mais FORTE para o mais fraco. A 1ª chave é a **nota**, de propósito:
 * assim a cota **nunca inverte a ordem** da rodada (quem estava acima continua acima). Prova e
 * eixos entram só como desempate, e o id fecha para a corrida ser reproduzível.
 */
export function compararForca(a: EntradaCalibragem, b: EntradaCalibragem): number {
  if (a.nota_preliminar !== b.nota_preliminar) return b.nota_preliminar - a.nota_preliminar;
  const na = a.gate_evidencia === "nomeada" ? 1 : 0;
  const nb = b.gate_evidencia === "nomeada" ? 1 : 0;
  if (na !== nb) return nb - na;
  if ((a.gate ?? 0) !== (b.gate ?? 0)) return (b.gate ?? 0) - (a.gate ?? 0);
  const fa = a.notas_valor.filter((n) => n >= NOTA_EXIGE_PROVA_NOMEADA).length;
  const fb = b.notas_valor.filter((n) => n >= NOTA_EXIGE_PROVA_NOMEADA).length;
  if (fa !== fb) return fb - fa;
  return a.projeto_id.localeCompare(b.projeto_id);
}

// ─── Resultado ─────────────────────────────────────────────────────────────────

export type LinhaCalibrada = {
  projeto_id: string;
  nota_antes: number;
  nota_depois: number;
  motivos: MotivoRebaixa[];
};

export type ResumoCalibragem = {
  total: number;
  /** Rótulo da curva usada — o relatório não pode ficar ambíguo sobre CONTRA O QUE calibrou. */
  curva_referencia: string;
  cota_aplicada: boolean;
  distribuicao_antes: Record<string, number>;
  distribuicao_depois: Record<string, number>;
  cotas: Cota[];
  rebaixados_por_prova: number;
  rebaixados_por_cota: number;
  /** A rodada CALIBRADA ainda é mais generosa que a referência em algum corte da régua. */
  mais_generosa: boolean;
};

export type ResultadoCalibragem = {
  linhas: LinhaCalibrada[];
  resumo: ResumoCalibragem;
};

export type OpcoesCalibragem = {
  /** Curva de referência DECLARADA. Default: `CURVA_BASE` (a base inteira). */
  curva?: Record<string, number>;
  rotuloCurva?: string;
  /** `false` mede a rodada contra a curva e RELATA, sem rebaixar por cota. Default `true`. */
  aplicarCota?: boolean;
  fatorTolerancia?: number;
};

function distribuicao(notas: number[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const n of notas) d[String(n)] = (d[String(n)] ?? 0) + 1;
  return d;
}

/**
 * Calibra a rodada: pisos de prova por projeto, depois a cota por faixa. **Nunca promove** e
 * **nunca inverte a ordem** (ver `compararForca`). Rodada vazia devolve resumo zerado — nunca
 * lança, porque isto roda em lote de background.
 */
export function calibrarRodada(
  entradas: EntradaCalibragem[],
  opts: OpcoesCalibragem = {},
): ResultadoCalibragem {
  const curva = opts.curva ?? CURVA_BASE;
  const rotuloCurva = opts.rotuloCurva ?? (opts.curva ? "curva declarada" : "CURVA_BASE");
  const aplicarCota = opts.aplicarCota !== false;
  const fator = opts.fatorTolerancia ?? FATOR_TOLERANCIA;
  const usaBase = curva === CURVA_BASE;

  // 1. pisos de prova, por projeto.
  const nota = new Map<string, number>();
  const motivos = new Map<string, MotivoRebaixa[]>();
  for (const e of entradas) {
    const r = aplicarPisosDeProva(e);
    nota.set(e.projeto_id, r.nota);
    motivos.set(e.projeto_id, r.motivos);
  }
  const rebaixados_por_prova = entradas.filter((e) =>
    (motivos.get(e.projeto_id) ?? []).some((m) => m !== "fora_da_escala"),
  ).length;

  // 2. cota por faixa, do corte MAIS ALTO para o mais baixo (rebaixar o topo muda as contagens
  //    dos cortes de baixo, e recontar depois é o que faz as duas cotas conviverem).
  const total = entradas.length;
  const ordenadas = [...entradas].sort(compararForca);
  const limiares = [...LIMIARES_GENEROSIDADE].sort((a, b) => b - a);
  const cotas: Cota[] = [];
  let rebaixados_por_cota = 0;

  for (const limiar of limiares) {
    const referencia_pct = usaBase ? percentilAcimaDe(limiar) : percentilDaCurva(curva, limiar);
    const permitido = Math.max(MIN_POR_FAIXA, Math.ceil((total * referencia_pct * fator) / 100));
    const acima = () => ordenadas.filter((e) => (nota.get(e.projeto_id) ?? 0) >= limiar);
    const antes = acima().length;

    if (aplicarCota) {
      // Do mais FRACO para o mais forte: a ordem da rodada fica preservada.
      const fracosPrimeiro = acima().reverse();
      let excedente = antes - permitido;
      for (const e of fracosPrimeiro) {
        if (excedente <= 0) break;
        nota.set(e.projeto_id, limiar - 1);
        motivos.set(e.projeto_id, [...(motivos.get(e.projeto_id) ?? []), "cota_da_faixa"]);
        rebaixados_por_cota++;
        excedente--;
      }
    }

    cotas.push({
      limiar,
      referencia_pct: Math.round(referencia_pct * 10) / 10,
      permitido,
      antes,
      depois: acima().length,
    });
  }
  cotas.sort((a, b) => a.limiar - b.limiar);

  const linhas: LinhaCalibrada[] = entradas.map((e) => ({
    projeto_id: e.projeto_id,
    nota_antes: e.nota_preliminar,
    nota_depois: nota.get(e.projeto_id) ?? 0,
    motivos: motivos.get(e.projeto_id) ?? [],
  }));

  const mais_generosa = cotas.some((c) => total > 0 && (c.depois / total) * 100 > c.referencia_pct);

  return {
    linhas,
    resumo: {
      total,
      curva_referencia: rotuloCurva,
      cota_aplicada: aplicarCota,
      distribuicao_antes: distribuicao(linhas.map((l) => l.nota_antes)),
      distribuicao_depois: distribuicao(linhas.map((l) => l.nota_depois)),
      cotas,
      rebaixados_por_prova,
      rebaixados_por_cota,
      mais_generosa,
    },
  };
}

// ─── Texto determinístico do rebaixamento ──────────────────────────────────────

const TEXTO_MOTIVO: Record<MotivoRebaixa, string> = {
  prova_nao_nomeada:
    "a nota exigia um lugar NOMEADO onde conferir o ponteiro, e o material não nomeou nenhum",
  um_eixo_so: `a faixa exigia ${EIXOS_VALOR_PARA_OURO} eixos de valor sustentando a nota, e só um sustentou`,
  cota_da_faixa:
    "a rodada inteira ficou mais generosa que a curva de referência neste corte, e esta foi a nota mais fraca acima dele",
  fora_da_escala: "a nota veio fora da escala e foi trazida para dentro dela",
};

/**
 * A frase do rebaixamento, montada dos motivos — o que o painel grava quando o LLM da redação
 * falha (ou quando ninguém quer gastar chamada). Sem motivo, diz que a nota passou intacta.
 */
export function explicarCalibragem(linha: LinhaCalibrada): string {
  const reais = linha.motivos.filter((m) => m !== "fora_da_escala");
  if (reais.length === 0) {
    return `Calibragem não mexeu na nota (${linha.nota_depois}★): ela já cabia na curva e na prova apresentada.`;
  }
  const porques = reais.map((m) => TEXTO_MOTIVO[m]).join("; ");
  return `Calibrada de ${linha.nota_antes}★ para ${linha.nota_depois}★ — ${porques}.`;
}
