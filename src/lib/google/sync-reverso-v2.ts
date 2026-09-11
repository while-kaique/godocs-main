/**
 * SYNC REVERSO dos campos da **v2** (planilha → SQLite) + recálculo dos 3 impactos. Módulo PURO.
 *
 * ⚠️ Por que existe (11/09/2026, dono do produto): *"a planilha é fonte da verdade, tudo o que tem
 * lá é pra ser considerado no sqlite tb em caso da gente sair da planilha"*. Até aqui o sync reverso
 * copiava só campos da v1 (`SAFE_UPDATE_FIELDS`) e pulava as colunas renomeadas em linha v2 — então
 * mudar `Freq. Custo Evitado` na planilha (caso «Torre de Controle Supply», mensal → pontual) não
 * chegava ao banco, e o próximo reenvio do autor devolveria "mensal" à planilha.
 *
 * Duas coisas, e só duas:
 *  1. **Copiar** os blocos da v2 (saving efetivado, custo evitado, receita, imensurável, custo para
 *     rodar) para as colunas `projetos.*` da v2. Célula vazia NUNCA apaga (mesma régua do sync v1).
 *  2. **Recalcular** `impacto_bruto/liquido/liquido_mensal` pela MESMA fórmula da submissão
 *     (`impacto.ts`) a partir do que a planilha declara — é isso que faz "mudar a frequência" mover
 *     o Impacto Líquido Mensal sozinho. Quem decide se o recálculo vence a célula é o chamador
 *     (`sync-reverse.ts`, env em runtime); aqui só se calcula.
 *
 * O que NÃO se inventa: categoria (só título conhecido, ou o que o banco já tem, ou a inferência
 * pelos NÚMEROS — declarada em `origem`), frequência (só as 4 do enum; fora dele o bloco fica sem
 * recálculo e vira aviso) e itens do custo para rodar (a planilha só tem o TOTAL — vira UM item só
 * quando o banco não tem nenhum).
 */
import {
  DIVISOR_FREQUENCIA,
  impactoBruto,
  impactoLiquido,
  impactoLiquidoMensal,
  type Frequencia,
  type GanhosProjeto,
} from '@/lib/impacto';
import { GANHO_ROTULOS } from '@/lib/ganhos-rotulos';
import {
  CATEGORIA_IMENSURAVEL,
  GANHO_CATEGORIAS,
  desserializarCategorias,
  desserializarCustoRodar,
  serializarCategorias,
  serializarCustoRodar,
  type GanhoCategoria,
} from '@/lib/ganhos';

export type LinhaPlanilha = Partial<Record<string, string | undefined>>;
export type AtualV2 = Partial<{
  ganho_categorias: string | null;
  custo_rodar_itens: string | null;
}>;
export type Impactos = { bruto: number; liquido: number; liquidoMensal: number };
export type LeituraV2 = {
  /** Patch de colunas `projetos.*` (só o que a planilha traz preenchido). */
  colunas: Record<string, string | number>;
  /** O que entra na fórmula; `null` quando falta frequência/categoria para recalcular. */
  ganhos: GanhosProjeto | null;
  origemCategorias: 'planilha' | 'banco' | 'inferida' | null;
  avisos: string[];
};

/** Colunas da v2 na planilha (nomes da aba `GoDocs`, fonte única em `celulasGanhoV2`). */
export const COLUNAS_V2 = {
  categorias: 'Tipos de Ganho',
  savingAntes: 'Saving Efetivado',
  savingAgora: 'Saving Efetivado Agora',
  savingFreq: 'Freq. Saving Efetivado',
  savingEvidencia: 'Evidência Saving Efetivado',
  ceHorasValor: 'Custo Evitado Horas Reais',
  ceNaoContratado: 'Custo Evitado Não Contratado',
  ceFreq: 'Freq. Custo Evitado',
  ceRacional: 'Racional Custo Evitado',
  receitaValor: 'Receita Incremental',
  receitaFreq: 'Freq. Receita',
  receitaRacional: 'Racional Receita',
  imensuravel: 'Ganho Imensurável',
  custoRodarTotal: 'Custo para Rodar',
  custoRodarFreq: 'Freq. Custo para Rodar',
  custoRodarJust: 'Justificativa Custo para Rodar',
  impactoBruto: 'Impacto Bruto',
  impactoLiquido: 'Impacto Líquido',
  impactoMensal: 'Impacto Líquido Mensal',
} as const;

/** `"R$ 1.234,56"` / `"1234.5"` / `"—"` → número ou `null`. Mesma régua do `parseNum` do sync v1. */
export function numeroDaCelula(v: string | undefined): number | null {
  if (v == null) return null;
  let s = String(v).trim().replace(/r\$\s*/gi, '').replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function textoDaCelula(v: string | undefined): string | null {
  const t = String(v ?? '').trim();
  return t === '' || t === '—' || t === '-' ? null : t;
}

/** Só as 4 frequências do enum (`DIVISOR_FREQUENCIA`); qualquer outra coisa é `null`. */
export function frequenciaDaCelula(v: string | undefined): Frequencia | null {
  const t = textoDaCelula(v)?.toLowerCase() ?? '';
  const primeira = t.split(/\s*\+\s*|,/)[0]?.trim() ?? '';
  return Object.keys(DIVISOR_FREQUENCIA).includes(primeira) ? (primeira as Frequencia) : null;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * `"Saving efetivado, Custo evitado"` → categorias. Aceita o TÍTULO dos cards (o que a v2 escreve) ou
 * a CHAVE. ⚠️ Um token desconhecido invalida a célula inteira (`null`): o vocabulário LEGADO da v1
 * (`saving`, `receita`) é herança da migração e nunca vira categoria por adivinhação.
 */
export function categoriasDaCelula(v: string | undefined): GanhoCategoria[] | null {
  const t = textoDaCelula(v);
  if (!t) return null;
  const porTitulo = new Map<string, GanhoCategoria>();
  for (const c of GANHO_CATEGORIAS) {
    porTitulo.set(semAcento(GANHO_ROTULOS[c].titulo), c);
    porTitulo.set(semAcento(c), c);
  }
  const out: GanhoCategoria[] = [];
  for (const tok of t.split(/[,;]/)) {
    const c = porTitulo.get(semAcento(tok));
    if (!c) return null;
    if (!out.includes(c)) out.push(c);
  }
  return out.length ? out : null;
}

/** Categorias pelos NÚMEROS que a planilha traz (último recurso, declarado em `origemCategorias`). */
function inferirCategorias(l: LinhaPlanilha): GanhoCategoria[] {
  const out: GanhoCategoria[] = [];
  if ((numeroDaCelula(l[COLUNAS_V2.savingAntes]) ?? 0) > 0) out.push('saving_efetivado');
  if ((numeroDaCelula(l[COLUNAS_V2.ceHorasValor]) ?? 0) > 0 || (numeroDaCelula(l[COLUNAS_V2.ceNaoContratado]) ?? 0) > 0)
    out.push('custo_evitado');
  if ((numeroDaCelula(l[COLUNAS_V2.receitaValor]) ?? 0) > 0) out.push('receita_incremental');
  if (out.length === 0 && textoDaCelula(l[COLUNAS_V2.imensuravel])) out.push(CATEGORIA_IMENSURAVEL);
  return out;
}

export function lerGanhosV2DaLinha(l: LinhaPlanilha, atual: AtualV2 = {}): LeituraV2 {
  const colunas: Record<string, string | number> = {};
  const avisos: string[] = [];
  const num = (k: keyof typeof COLUNAS_V2) => numeroDaCelula(l[COLUNAS_V2[k]]);
  const txt = (k: keyof typeof COLUNAS_V2) => textoDaCelula(l[COLUNAS_V2[k]]);
  const freq = (k: keyof typeof COLUNAS_V2) => frequenciaDaCelula(l[COLUNAS_V2[k]]);

  // categorias — planilha > banco > inferência
  let categorias = categoriasDaCelula(l[COLUNAS_V2.categorias]);
  let origemCategorias: LeituraV2['origemCategorias'] = categorias ? 'planilha' : null;
  if (categorias) colunas.ganho_categorias = serializarCategorias(categorias);
  if (!categorias) {
    const doBanco = desserializarCategorias(atual.ganho_categorias);
    if (doBanco.length) { categorias = doBanco; origemCategorias = 'banco'; }
  }
  if (!categorias) {
    const inf = inferirCategorias(l);
    if (inf.length) { categorias = inf; origemCategorias = 'inferida'; }
  }

  // saving efetivado
  const sAntes = num('savingAntes'), sAgora = num('savingAgora'), sFreq = freq('savingFreq'), sEvid = txt('savingEvidencia');
  if (sAntes != null) colunas.saving_efetivado_valor_antes = sAntes;
  if (sAgora != null) colunas.saving_efetivado_valor_agora = sAgora;
  if (sFreq) colunas.saving_efetivado_frequencia = sFreq;
  else if (textoDaCelula(l[COLUNAS_V2.savingFreq])) avisos.push(`Freq. Saving Efetivado fora do enum: ${l[COLUNAS_V2.savingFreq]}`);
  if (sEvid) colunas.saving_efetivado_evidencia = sEvid;

  // custo evitado
  const ceHoras = num('ceHorasValor'), ceNao = num('ceNaoContratado'), ceFreq = freq('ceFreq'), ceRac = txt('ceRacional');
  if (ceHoras != null) colunas.custo_evitado_horas_valor = ceHoras;
  if (ceNao != null) colunas.custo_evitado_nao_contratado = ceNao;
  if (ceFreq) colunas.custo_evitado_frequencia = ceFreq;
  else if (textoDaCelula(l[COLUNAS_V2.ceFreq])) avisos.push(`Freq. Custo Evitado fora do enum: ${l[COLUNAS_V2.ceFreq]}`);
  if (ceRac) colunas.custo_evitado_racional = ceRac;

  // receita
  const rVal = num('receitaValor'), rFreq = freq('receitaFreq'), rRac = txt('receitaRacional');
  if (rVal != null) colunas.receita_incremental_valor = rVal;
  if (rFreq) colunas.receita_incremental_frequencia = rFreq;
  else if (textoDaCelula(l[COLUNAS_V2.receitaFreq])) avisos.push(`Freq. Receita fora do enum: ${l[COLUNAS_V2.receitaFreq]}`);
  if (rRac) colunas.receita_incremental_racional = rRac;

  // imensurável
  const im = txt('imensuravel');
  if (im) colunas.ganho_imensuravel_racional = im;

  // custo para rodar — a planilha só tem o TOTAL; vira um item só quando o banco não tem nenhum
  let itens = desserializarCustoRodar(atual.custo_rodar_itens);
  const total = num('custoRodarTotal');
  if (itens.length === 0 && total != null && total > 0) {
    itens = [{ nome: 'Custo para rodar (planilha)', valor: total, frequencia: freq('custoRodarFreq') ?? 'mensal', oQueE: txt('custoRodarJust') ?? '' }];
    colunas.custo_rodar_itens = serializarCustoRodar(itens);
  }

  // o que entra na fórmula
  let ganhos: GanhosProjeto | null = null;
  if (!categorias || categorias.length === 0) {
    avisos.push('sem categoria (célula, banco e números vazios) — impacto não recalculado');
  } else if (categorias.length === 1 && categorias[0] === CATEGORIA_IMENSURAVEL) {
    ganhos = { imensuravel: true };
  } else {
    const g: GanhosProjeto = {};
    let falta = false;
    if (categorias.includes('saving_efetivado')) {
      if (sFreq && sAntes != null) g.savingEfetivado = { valor: Math.max(0, sAntes - (sAgora ?? 0)), frequencia: sFreq };
      else { falta = true; avisos.push('saving efetivado sem frequência/valor na planilha'); }
    }
    if (categorias.includes('custo_evitado')) {
      if (ceFreq && (ceHoras != null || ceNao != null)) g.custoEvitado = { horas: ceHoras ?? 0, naoContratado: ceNao ?? 0, frequencia: ceFreq };
      else { falta = true; avisos.push('custo evitado sem frequência/valor na planilha'); }
    }
    if (categorias.includes('receita_incremental')) {
      if (rFreq && rVal != null) g.receita = { valor: rVal, frequencia: rFreq };
      else { falta = true; avisos.push('receita sem frequência/valor na planilha'); }
    }
    if (itens.length) g.custoRodar = itens.map((i) => ({ valor: i.valor, frequencia: i.frequencia }));
    ganhos = falta ? null : g;
  }

  return { colunas, ganhos, origemCategorias, avisos };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Os 3 impactos pela fórmula de `impacto.ts`, a 2 casas. `null` se a fórmula lançar (frequência fora do enum). */
export function recalcularImpactos(g: GanhosProjeto): Impactos | null {
  try {
    return { bruto: r2(impactoBruto(g)), liquido: r2(impactoLiquido(g)), liquidoMensal: r2(impactoLiquidoMensal(g)) };
  } catch {
    return null;
  }
}

/** Os 3 impactos como estão na planilha; `null` se faltar QUALQUER um (tudo-ou-nada, contrato do `schema.ts`). */
export function impactosDaLinha(l: LinhaPlanilha): Impactos | null {
  const b = numeroDaCelula(l[COLUNAS_V2.impactoBruto]);
  const q = numeroDaCelula(l[COLUNAS_V2.impactoLiquido]);
  const m = numeroDaCelula(l[COLUNAS_V2.impactoMensal]);
  return b != null && q != null && m != null ? { bruto: b, liquido: q, liquidoMensal: m } : null;
}

/** Divergência REAL, não de arredondamento: a planilha guarda 3+ casas (`5481.715`) e a fórmula grava 2. */
export function impactosDivergem(a: Impactos, b: Impactos, tol = 0.011): boolean {
  return Math.abs(a.bruto - b.bruto) >= tol || Math.abs(a.liquido - b.liquido) >= tol || Math.abs(a.liquidoMensal - b.liquidoMensal) >= tol;
}
