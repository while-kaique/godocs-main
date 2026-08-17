// Comparação entre duas versões de um projeto — FONTE ÚNICA do "antes → depois" que o
// líder lê quando o que cai na fila de pré-aprovação é uma EDIÇÃO (reenvio), não uma
// submissão nova.
//
// Por que existe (pedido do Kaique, 17/08/2026): o card da fila foi desenhado para quem
// lê o projeto pela PRIMEIRA vez — ele mostra tudo, e tudo com o mesmo peso. No reenvio o
// líder já leu o projeto; o que ele precisa é a diferença. Mostrar o card inteiro de novo
// obriga a comparar de memória, que é exatamente o que ninguém faz: o líder relê a mesma
// parede de texto e carimba.
//
// ⚠️ Módulo PURO (sem React, sem import de servidor): roda no `listarAprovacoesPendentes`
// (servidor) e é testado direto. A régua de "o que é um campo" mora no catálogo
// `CAMPOS_VERSAO` — ao adicionar campo ao snapshot de versão (`gravarVersaoProjeto`, em
// `chat.functions.ts`), acrescente AQUI, senão a mudança fica invisível para o líder.
//
// ⚠️ NÃO é o mesmo catálogo do Investigador (`CAMPOS_DIFF`, em `investigador.tsx`), e a
// duplicação é deliberada: lá o público é AUDITORIA (inclui `status` interno, fala em
// "Status interno"/"Projeto especial" e nunca some com campo nenhum); aqui o público é o
// GESTOR decidindo um parecer — campo interno é ruído, e o que importa é o valor do ganho
// com a unidade certa. Unificar os dois faria um catálogo servir mal aos dois leitores.

import {
  fmtHoras,
  fmtReais,
  fmtSimNao,
  fmtTiposProjeto,
  sufixoReais,
  TIPO_SAVING_LABEL,
} from "./projeto-rotulos";

/** Uma versão como ela foi congelada em `projeto_versions`. */
export type SnapshotVersao = {
  /** `snapshot_projeto` já parseado (as colunas de `projetos` no momento do envio). */
  projeto: Record<string, unknown>;
  /** `snapshot_doc` já parseado (o `conteudo` da documentação). Pode faltar. */
  doc: Record<string, unknown> | null;
};

export type EstadoMudanca = "alterado" | "adicionado" | "removido" | "igual";

/** Variação de um campo numérico entre as duas versões (o chip ▲/▼ do card). */
export type DeltaCampo = {
  /** depois − antes (negativo = caiu). */
  valor: number;
  /** Já formatado com sinal e unidade: "+42 h/mês", "− R$ 1.200/mês". */
  texto: string;
  direcao: "subiu" | "caiu";
};

export type CampoComparado = {
  chave: string;
  rotulo: string;
  antes: string | null;
  depois: string | null;
  estado: EstadoMudanca;
  /** Texto de prosa (memorial, documentação): o card colapsa antes/depois. */
  longo: boolean;
  /** Só em campo numérico com número nas DUAS versões e mesma recorrência. */
  delta: DeltaCampo | null;
};

export type ComparacaoVersoes = {
  /** Campos que mudaram (alterado/adicionado/removido), na ordem do catálogo. */
  mudancas: CampoComparado[];
  /** Campos com valor e sem mudança — vão para o bloco colapsado do card. */
  iguais: CampoComparado[];
};

type ValorCampo = { texto: string | null; numero?: number | null };

type CampoVersao = {
  chave: string;
  rotulo: string;
  ler: (v: SnapshotVersao) => ValorCampo;
  longo?: boolean;
  /**
   * Campo numérico cuja unidade depende da recorrência (`tipo_saving`): o delta só é
   * calculado quando a recorrência é a MESMA nas duas versões — "120 h/mês → 120
   * h/trimestre" não é uma variação de 0, é outra unidade.
   */
  unidadeDependeDaRecorrencia?: boolean;
  /** Como o delta é escrito ("+42 h/mês" x "+ R$ 1.200/mês"). */
  formatarDelta?: (delta: number, v: SnapshotVersao) => string;
};

// ─── Leitura dos valores ─────────────────────────────────────────────────────

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function numero(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && isFinite(n) ? n : null;
}

function tipoSaving(v: SnapshotVersao): string | null {
  return texto(v.projeto.tipo_saving);
}

/** Campo do `conteudo` da documentação (`snapshot_doc.documentacao.<chave>`). */
function docTexto(v: SnapshotVersao, chave: string): string | null {
  const doc = v.doc?.documentacao;
  if (!doc || typeof doc !== "object") return null;
  return texto((doc as Record<string, unknown>)[chave]);
}

/**
 * Itens de custo evitado em texto estável ("• nome — R$ valor (recorrência)"), um por
 * linha. Estável importa: a comparação é de STRING, então a ordem e o formato precisam ser
 * determinísticos para não acusar mudança onde não houve.
 */
function itensCustoEvitado(v: unknown): string | null {
  const bruto = typeof v === "string" ? seguroJson(v) : v;
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  const linhas = bruto
    .map((item) => {
      const o = (item ?? {}) as Record<string, unknown>;
      const nome = texto(o.nome) ?? "Item sem nome";
      const valor = fmtReais(numero(o.valor)) ?? "sem valor";
      const rec = texto(o.recorrencia);
      return `• ${nome} — ${valor}${rec ? ` (${rec})` : ""}`;
    })
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  return linhas.join("\n");
}

function seguroJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** `tipos_projeto` pode vir como array (snapshot novo) ou string JSON (legado). */
function tiposProjeto(v: unknown): string | null {
  return fmtTiposProjeto(typeof v === "string" ? seguroJson(v) : v);
}

// ─── Catálogo: o que o líder compara ─────────────────────────────────────────
//
// A ordem é a ordem do card. Ganho primeiro: é o que muda de parecer.

export const CAMPOS_VERSAO: CampoVersao[] = [
  {
    chave: "ganho_total_mensal",
    rotulo: "Ganho total",
    ler: (v) => ({
      texto: fmtReais(numero(v.projeto.ganho_total_mensal), sufixoReais(tipoSaving(v))),
      numero: numero(v.projeto.ganho_total_mensal),
    }),
    unidadeDependeDaRecorrencia: true,
    formatarDelta: (d, v) => `${fmtReais(Math.abs(d), sufixoReais(tipoSaving(v))) ?? "—"}`,
  },
  {
    chave: "saving_horas",
    rotulo: "Horas economizadas",
    ler: (v) => ({
      texto: fmtHoras(numero(v.projeto.saving_horas), tipoSaving(v)),
      numero: numero(v.projeto.saving_horas),
    }),
    unidadeDependeDaRecorrencia: true,
    formatarDelta: (d, v) => fmtHoras(Math.abs(d), tipoSaving(v)) ?? "—",
  },
  {
    chave: "saving_reais",
    rotulo: "Saving em R$",
    ler: (v) => ({
      texto: fmtReais(numero(v.projeto.saving_reais), sufixoReais(tipoSaving(v))),
      numero: numero(v.projeto.saving_reais),
    }),
    unidadeDependeDaRecorrencia: true,
    formatarDelta: (d, v) => fmtReais(Math.abs(d), sufixoReais(tipoSaving(v))) ?? "—",
  },
  {
    chave: "custo_externo_mensal",
    rotulo: "Custo externo",
    ler: (v) => ({
      texto: fmtReais(numero(v.projeto.custo_externo_mensal), sufixoReais(tipoSaving(v))),
      numero: numero(v.projeto.custo_externo_mensal),
    }),
    unidadeDependeDaRecorrencia: true,
    formatarDelta: (d, v) => fmtReais(Math.abs(d), sufixoReais(tipoSaving(v))) ?? "—",
  },
  {
    chave: "tipo_saving",
    rotulo: "Recorrência do ganho",
    ler: (v) => ({ texto: TIPO_SAVING_LABEL[tipoSaving(v) ?? ""] ?? tipoSaving(v) }),
  },
  {
    chave: "horas_carga_real",
    rotulo: "Horas que alguém já fazia",
    ler: (v) => ({
      texto: fmtHoras(numero(v.projeto.horas_carga_real), tipoSaving(v)),
      numero: numero(v.projeto.horas_carga_real),
    }),
    unidadeDependeDaRecorrencia: true,
    formatarDelta: (d, v) => fmtHoras(Math.abs(d), tipoSaving(v)) ?? "—",
  },
  {
    chave: "horas_escala",
    rotulo: "Horas de ganho por escala",
    ler: (v) => ({
      texto: fmtHoras(numero(v.projeto.horas_escala), tipoSaving(v)),
      numero: numero(v.projeto.horas_escala),
    }),
    unidadeDependeDaRecorrencia: true,
    formatarDelta: (d, v) => fmtHoras(Math.abs(d), tipoSaving(v)) ?? "—",
  },
  {
    chave: "alguem_fazia",
    rotulo: "Alguém já fazia à mão",
    ler: (v) => ({ texto: fmtSimNao(v.projeto.alguem_fazia) }),
  },
  {
    chave: "custo_evitado",
    rotulo: "Tem custo evitado",
    ler: (v) => ({ texto: fmtSimNao(v.projeto.custo_evitado) }),
  },
  {
    chave: "custo_evitado_itens",
    rotulo: "Gastos eliminados",
    ler: (v) => ({ texto: itensCustoEvitado(v.projeto.custo_evitado_itens) }),
    longo: true,
  },
  {
    chave: "custo_evitado_justificativa",
    rotulo: "Justificativa do custo evitado",
    ler: (v) => ({ texto: texto(v.projeto.custo_evitado_justificativa) }),
    longo: true,
  },
  { chave: "nome", rotulo: "Nome do projeto", ler: (v) => ({ texto: texto(v.projeto.nome) }) },
  { chave: "area", rotulo: "Área", ler: (v) => ({ texto: texto(v.projeto.area) }) },
  {
    chave: "ferramenta",
    rotulo: "Ferramenta",
    ler: (v) => ({ texto: texto(v.projeto.ferramenta) }),
  },
  {
    chave: "tipos_projeto",
    rotulo: "Tipo de ganho declarado",
    ler: (v) => ({ texto: tiposProjeto(v.projeto.tipos_projeto) }),
  },
  {
    chave: "descricao_breve",
    rotulo: "Descrição do projeto",
    ler: (v) => ({ texto: texto(v.projeto.descricao_breve) }),
    longo: true,
  },
  {
    chave: "memorial_calculo",
    rotulo: "Memorial do cálculo",
    ler: (v) => ({ texto: texto(v.projeto.memorial_calculo) }),
    longo: true,
  },
  // Documentação técnica: vem do `snapshot_doc`. É o que o líder abre em
  // "Ler a documentação completa" — mudança aqui muda o que ele leu na versão passada.
  {
    chave: "doc_o_que_faz",
    rotulo: "Documentação · o que a automação faz",
    ler: (v) => ({ texto: docTexto(v, "o_que_faz") }),
    longo: true,
  },
  {
    chave: "doc_execucao",
    rotulo: "Documentação · como executa",
    ler: (v) => ({ texto: docTexto(v, "execucao") }),
    longo: true,
  },
  {
    chave: "doc_fluxo",
    rotulo: "Documentação · fluxo",
    ler: (v) => ({ texto: docTexto(v, "fluxo") }),
    longo: true,
  },
  {
    chave: "doc_dependencias",
    rotulo: "Documentação · dependências",
    ler: (v) => ({ texto: docTexto(v, "dependencias") }),
    longo: true,
  },
  {
    chave: "doc_configurar_antes",
    rotulo: "Documentação · o que configurar antes",
    ler: (v) => ({ texto: docTexto(v, "configurar_antes") }),
    longo: true,
  },
  {
    chave: "doc_atencao",
    rotulo: "Documentação · pontos de atenção",
    ler: (v) => ({ texto: docTexto(v, "atencao") }),
    longo: true,
  },
];

// ─── Comparação ──────────────────────────────────────────────────────────────

/**
 * Compara duas versões campo a campo.
 *
 * Regras:
 * • campo vazio nas DUAS versões não aparece (nem como "sem mudança") — o líder não
 *   precisa saber que um campo que nunca existiu continua não existindo;
 * • `null → valor` é **Adicionado**, `valor → null` é **Removido** (não são "alterado":
 *   remover o memorial é um evento diferente de reescrevê-lo);
 * • delta numérico só quando há número nos dois lados E a recorrência não mudou —
 *   comparar "h/mês" com "h/trimestre" produziria um número que não quer dizer nada.
 */
export function compararVersoes(
  anterior: SnapshotVersao,
  atual: SnapshotVersao,
): ComparacaoVersoes {
  const mudancas: CampoComparado[] = [];
  const iguais: CampoComparado[] = [];

  for (const campo of CAMPOS_VERSAO) {
    const a = campo.ler(anterior);
    const d = campo.ler(atual);
    if (a.texto === null && d.texto === null) continue;

    let estado: EstadoMudanca;
    if (a.texto === null) estado = "adicionado";
    else if (d.texto === null) estado = "removido";
    else if (a.texto === d.texto) estado = "igual";
    else estado = "alterado";

    const linha: CampoComparado = {
      chave: campo.chave,
      rotulo: campo.rotulo,
      antes: a.texto,
      depois: d.texto,
      estado,
      longo: !!campo.longo,
      delta: estado === "igual" ? null : calcularDelta(campo, a, d, anterior, atual),
    };
    (estado === "igual" ? iguais : mudancas).push(linha);
  }

  return { mudancas, iguais };
}

function calcularDelta(
  campo: CampoVersao,
  a: ValorCampo,
  d: ValorCampo,
  anterior: SnapshotVersao,
  atual: SnapshotVersao,
): DeltaCampo | null {
  if (typeof a.numero !== "number" || typeof d.numero !== "number") return null;
  if (
    campo.unidadeDependeDaRecorrencia &&
    (tipoSaving(anterior) ?? null) !== (tipoSaving(atual) ?? null)
  ) {
    return null;
  }
  const valor = d.numero - a.numero;
  if (valor === 0) return null;
  const escrito = campo.formatarDelta?.(valor, atual) ?? Math.abs(valor).toLocaleString("pt-BR");
  return {
    valor,
    texto: `${valor > 0 ? "+" : "−"} ${escrito}`,
    direcao: valor > 0 ? "subiu" : "caiu",
  };
}

/** Quantos campos mudaram / quantos ficaram iguais — usado no cabeçalho do card. */
export function resumirComparacao(c: ComparacaoVersoes): {
  mudou: number;
  igual: number;
  temTextoLongoAlterado: boolean;
} {
  return {
    mudou: c.mudancas.length,
    igual: c.iguais.length,
    temTextoLongoAlterado: c.mudancas.some((m) => m.longo),
  };
}
