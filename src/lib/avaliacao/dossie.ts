// Dossiê do projeto — o que o time de agentes LÊ (T11, D17). Módulo PURO: monta um objeto
// `Dossie` a partir de fontes JÁ carregadas, sem I/O e sem env.
//
// Por quê: cada agente da mesa via um recorte diferente do projeto (o contexto enxuto do
// prompt, a linha da planilha, a doc). Julgamento como o de um humano exige ver TUDO de uma
// vez — e declarar o que NÃO está lá. Na v2 não há logs de chat (D17): as fontes são os campos
// determinísticos, a documentação compilada em background, o espelho da planilha, as versões,
// os eventos de formulário e o cargo na TeamGuide. O texto extraído dos anexos NUNCA é
// persistido (só transita na submissão), por isso `texto_anexos` é lacuna permanente até a v2
// passar a guardá-lo. Campos v2 (`saving_efetivado_*`, `ganho_imensuravel_racional`…) podem
// não existir no schema desta branch — o dossiê é tolerante à ausência (lacuna `v2`).
//
// Regra de ouro: JSON podre, célula vazia ou fonte ausente NUNCA lançam. Viram null/[] +
// lacuna declarada. Um dossiê que mente completude é pior que um dossiê curto.
import { chaveColuna } from '@/lib/coluna-chave';

export type FontesDossie = {
  projeto: Record<string, unknown> | null;
  documentacao: string | null;
  espelho: Record<string, string> | null;
  versoes: { versao_num: number; acao: string; snapshot_projeto: string | null; created_at: string | null }[];
  eventos: { tipo: string; fase: string | null; dados: string | null; created_at: string | null }[];
  cargoAutor: string | null | undefined;
};

export type Lacuna = 'projeto' | 'documentacao' | 'espelho' | 'versoes' | 'texto_anexos' | 'v2' | 'teamguide';

export type Dossie = {
  fonte: 'app' | 'planilha';
  id: string;
  nome: string;
  area: string | null;
  autor: { nome: string | null; email: string | null; cargo: string | null };
  submissao: { data: string | null; versao: number; reenvios: number; atualizado_em: string | null; descontinuado: boolean };
  classificacao: { especial: boolean; tipos: string[]; complexidade: string | null; ferramenta: string | null; escopo: string | null };
  descricao: string | null;
  documentacao: {
    presente: boolean;
    o_que_faz: string | null;
    execucao: string | null;
    fluxo: string[];
    dependencias: string[];
    atencao: string[];
    configurar_antes: string[];
  };
  financeiro: {
    saving_horas: number | null;
    saving_reais: number | null;
    tipo_saving: string | null;
    alguem_fazia: string | null;
    linhas: { cargo: string; horas_antes: number | null; horas_depois: number | null }[];
    custo_evitado_reais: number | null;
    custo_evitado_itens: unknown[];
    custo_projeto_itens: unknown[];
    custo_externo_mensal: number | null;
    receita_mensal: number | null;
    tipo_receita: string | null;
    ganho_total_mensal: number | null;
    memorial_saving: string | null;
    memorial_receita: string | null;
    observacoes_analisador: string | null;
    horas_carga_real: number | null;
    horas_escala: number | null;
    justificativa_carga_escala: string | null;
    alocacao_ganhos: string | null;
  };
  v2?: {
    saving_efetivado_antes: number | null;
    saving_efetivado_agora: number | null;
    saving_efetivado_frequencia: string | null;
    saving_efetivado_evidencia: string | null;
    custo_evitado_nao_contratado: number | null;
    ganho_imensuravel_racional: string | null;
    custo_rodar_itens: unknown[];
  };
  triagem: {
    status: string | null;
    estrelas: number | null;
    classificacao: string | null;
    motivo_reprovado: string | null;
    motivo_reenvio: string | null;
    aprovacao_lider: string | null;
    justificativa_lider: string | null;
  };
  contexto: { contrafactual_afetados: string[]; membros: string[]; anexos_links: string[]; contexto_especial: string | null };
  historico: {
    versoes: { versao_num: number; acao: string; created_at: string | null }[];
    mudancas_ultimo_reenvio: { campo: string; antes: unknown; depois: unknown }[] | null;
    eventos: { tipo: string; fase: string | null; created_at: string | null }[];
  };
  lacunas: Lacuna[];
};

const CHAVES_V2 = [
  'saving_efetivado_valor_antes',
  'saving_efetivado_valor_agora',
  'saving_efetivado_frequencia',
  'saving_efetivado_evidencia',
  'custo_evitado_nao_contratado',
  'ganho_imensuravel_racional',
  'custo_rodar_itens',
] as const;

// ── helpers de leitura tolerante ──────────────────────────────────────────────

/** Texto limpo: vazio e travessão viram null. */
export function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === '—' || s === '-') return null;
  return s;
}

/** Número vindo do banco (number) ou da planilha em pt-BR ("R$ 1.234,56", "120,5", "300"). */
export function numero(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || s === '—' || s === '-') return null;
  s = s.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function jsonSeguro(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function lista(v: unknown): unknown[] {
  const j = jsonSeguro(v);
  return Array.isArray(j) ? j : [];
}

function listaStrings(v: unknown): string[] {
  return lista(v).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
}

function separarLista(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/[,;+\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function separarLinks(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Leitor por NOME de coluna, exato primeiro e normalizado depois (a régua de `chaveColuna`). */
function leitorPlanilha(row: Record<string, string> | null): (nome: string) => string | null {
  if (!row) return () => null;
  const porChave = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    const ch = chaveColuna(k);
    if (!porChave.has(ch)) porChave.set(ch, v);
  }
  return (nome: string) => {
    if (nome in row) return texto(row[nome]);
    return texto(porChave.get(chaveColuna(nome)));
  };
}

function par(chave: unknown, valor: unknown): string {
  const a = texto(chave) ?? '';
  const b = texto(valor) ?? '';
  return b ? `${a}: ${b}` : a;
}

type Doc = Record<string, unknown>;

function lerDocumentacao(raw: string | null): { presente: boolean; doc: Doc | null } {
  if (!raw) return { presente: false, doc: null };
  const j = jsonSeguro(raw);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { presente: false, doc: null };
  return { presente: true, doc: j as Doc };
}

function linhasDoc(doc: Doc | null): Dossie['financeiro']['linhas'] {
  const saving = doc?.saving as Doc | undefined;
  const ls = Array.isArray(saving?.linhas) ? (saving!.linhas as Doc[]) : [];
  return ls
    .filter((l) => l && typeof l === 'object')
    .map((l) => ({
      cargo: texto(l.cargo) ?? '',
      horas_antes: numero(l.horas_antes),
      horas_depois: numero(l.horas_depois),
    }));
}

function compararSnapshots(
  versoes: FontesDossie['versoes'],
): { campo: string; antes: unknown; depois: unknown }[] | null {
  if (versoes.length < 2) return null;
  const ord = [...versoes].sort((a, b) => a.versao_num - b.versao_num);
  const ant = jsonSeguro(ord[ord.length - 2].snapshot_projeto);
  const atu = jsonSeguro(ord[ord.length - 1].snapshot_projeto);
  if (!ant || !atu || typeof ant !== 'object' || typeof atu !== 'object') return null;
  const a = ant as Doc;
  const b = atu as Doc;
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: { campo: string; antes: unknown; depois: unknown }[] = [];
  for (const k of [...chaves].sort()) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) {
      out.push({ campo: k, antes: a[k] ?? null, depois: b[k] ?? null });
    }
  }
  return out;
}

// ── construção ───────────────────────────────────────────────────────────────

function construir(f: FontesDossie, opts: { lacunaProjeto: boolean }): Dossie | null {
  const p = f.projeto;
  const g = leitorPlanilha(f.espelho);
  if (!p && !f.espelho) return null;

  const lacunas = new Set<Lacuna>();
  if (!p && opts.lacunaProjeto) lacunas.add('projeto');
  if (!f.espelho) lacunas.add('espelho');
  lacunas.add('texto_anexos');

  const id = texto(p?.id) ?? g('ID Projeto');
  if (!id) return null;

  const status = g('Status');
  const versoesOrd = [...f.versoes].sort((a, b) => a.versao_num - b.versao_num);
  const versaoMax = versoesOrd.length ? versoesOrd[versoesOrd.length - 1].versao_num : 1;
  if (versoesOrd.length === 0) lacunas.add('versoes');

  const { presente, doc } = lerDocumentacao(f.documentacao);
  if (!presente) lacunas.add('documentacao');

  if (f.cargoAutor === undefined) lacunas.add('teamguide');

  const temV2 = !!p && CHAVES_V2.some((k) => k in p && p[k] !== undefined);
  if (!temV2) lacunas.add('v2');

  const d: Dossie = {
    fonte: p ? 'app' : 'planilha',
    id,
    nome: texto(p?.nome) ?? g('Projeto') ?? '',
    area: texto(p?.area_nome) ?? texto(p?.area) ?? g('Área'),
    autor: {
      nome: texto(p?.responsavel_nome) ?? g('Nome Completo'),
      email: texto(p?.responsavel_email) ?? g('Email'),
      cargo: f.cargoAutor ?? null,
    },
    submissao: {
      data: texto(p?.submitted_at) ?? g('Data Submissão'),
      versao: versaoMax,
      reenvios: Math.max(0, versaoMax - 1),
      atualizado_em: texto(p?.atualizado_em) ?? g('Atualizado Em'),
      descontinuado: p ? numero(p.descontinuado) === 1 : /descontinuad/i.test(status ?? ''),
    },
    classificacao: {
      especial: p ? numero(p.especial) === 1 : /^sim$/i.test(g('Especial?') ?? ''),
      tipos: p ? listaStrings(p.tipos_projeto) : separarLista(g('Tipos Projeto')),
      complexidade: g('Complexidade') ?? texto(p?.complexidade),
      ferramenta: texto(p?.ferramenta) ?? g('Ferramenta'),
      escopo: texto(p?.escopo) ?? g('Escopo'),
    },
    descricao: texto(p?.descricao_breve) ?? g('Descrição'),
    documentacao: {
      presente,
      o_que_faz: texto(doc?.o_que_faz),
      execucao: texto(doc?.execucao),
      fluxo: (Array.isArray(doc?.fluxo) ? (doc!.fluxo as Doc[]) : []).map((x) => par(x?.etapa, x?.descricao)),
      dependencias: (Array.isArray(doc?.dependencias) ? (doc!.dependencias as Doc[]) : []).map((x) =>
        par(x?.servico, x?.descricao),
      ),
      atencao: (Array.isArray(doc?.atencao) ? (doc!.atencao as Doc[]) : []).map((x) => par(x?.titulo, x?.descricao)),
      configurar_antes: (Array.isArray(doc?.configurar_antes) ? (doc!.configurar_antes as unknown[]) : [])
        .map((x) => texto(x) ?? '')
        .filter(Boolean),
    },
    financeiro: {
      saving_horas: numero(p?.saving_horas) ?? numero(g('Saving Horas')),
      saving_reais: numero(p?.saving_reais) ?? numero(g('Saving Reais')),
      tipo_saving: texto(p?.tipo_saving) ?? g('Tipo de Saving'),
      alguem_fazia: texto(p?.alguem_fazia) ?? g('Alguém Fazia?'),
      linhas: linhasDoc(doc),
      custo_evitado_reais: numero(p?.custo_evitado_reais) ?? numero(g('Custo Evitado')),
      custo_evitado_itens: lista(p?.custo_evitado_itens),
      custo_projeto_itens: lista(p?.custo_projeto_itens),
      custo_externo_mensal: numero(p?.custo_externo_mensal) ?? numero(g('Custo Externo Mensal')),
      receita_mensal: numero(g('Receita Mensal')) ?? numero(p?.receita_mensal),
      tipo_receita: g('Tipo de Receita') ?? texto(p?.tipo_receita),
      ganho_total_mensal: numero(p?.ganho_total_mensal) ?? numero(g('Ganho Total')),
      memorial_saving: g('Memorial de Saving') ?? texto(p?.memorial_calculo),
      memorial_receita: g('Receita Memorial'),
      observacoes_analisador: g('Observações'),
      horas_carga_real: numero(g('Saving Horas Real')),
      horas_escala: numero(g('Saving Horas Escalado')),
      justificativa_carga_escala: g('Justificativa Saving Escalado e Real'),
      alocacao_ganhos: g('Alocação Ganhos'),
    },
    triagem: {
      status,
      estrelas: numero(g('Estrelas')),
      classificacao: g('Classificação'),
      motivo_reprovado: g('Motivo Reprovado'),
      motivo_reenvio: g('Motivo Reenvio'),
      aprovacao_lider: g('Aprovação do Líder'),
      justificativa_lider: g('Justificativa Aprovação do Líder'),
    },
    contexto: {
      contrafactual_afetados: listaStrings(p?.contrafactual_afetados),
      membros: listaStrings(p?.membros),
      anexos_links: p ? listaStrings(p.arquivos_links) : separarLinks(g('URL')),
      contexto_especial: texto(p?.contexto_especial) ?? g('Contexto do Projeto Especial'),
    },
    historico: {
      versoes: versoesOrd.map((v) => ({ versao_num: v.versao_num, acao: v.acao, created_at: v.created_at })),
      mudancas_ultimo_reenvio: compararSnapshots(f.versoes),
      eventos: f.eventos.map((e) => ({ tipo: e.tipo, fase: e.fase, created_at: e.created_at })),
    },
    lacunas: [...lacunas],
  };

  if (temV2 && p) {
    d.v2 = {
      saving_efetivado_antes: numero(p.saving_efetivado_valor_antes),
      saving_efetivado_agora: numero(p.saving_efetivado_valor_agora),
      saving_efetivado_frequencia: texto(p.saving_efetivado_frequencia),
      saving_efetivado_evidencia: texto(p.saving_efetivado_evidencia),
      custo_evitado_nao_contratado: numero(p.custo_evitado_nao_contratado),
      ganho_imensuravel_racional: texto(p.ganho_imensuravel_racional),
      custo_rodar_itens: lista(p.custo_rodar_itens),
    };
  }
  return d;
}

export function montarDossie(f: FontesDossie): Dossie | null {
  return construir(f, { lacunaProjeto: true });
}

/** Dossiê só da linha da planilha (retroativo/legado). Sem doc, versões, anexos, v2 e TeamGuide. */
export function dossieDaLinhaPlanilha(row: Record<string, string>): Dossie | null {
  return construir(
    { projeto: null, documentacao: null, espelho: row, versoes: [], eventos: [], cargoAutor: undefined },
    { lacunaProjeto: false },
  );
}

// ── serialização para prompt ──────────────────────────────────────────────────

const DESCRICAO_LACUNA: Record<Lacuna, string> = {
  projeto: 'linha de projetos não encontrada no banco (só a planilha)',
  documentacao: 'documentação compilada não encontrada',
  espelho: 'linha da planilha (espelho) não encontrada',
  versoes: 'sem versões registradas (submissão única ou legado)',
  texto_anexos: 'texto dos anexos não é persistido (só os links)',
  v2: 'campos do formulário v2 ausentes',
  teamguide: 'cargo do autor não consultado na TeamGuide',
};

function ocultarReais(s: string | null): string | null {
  if (!s) return s;
  return s.replace(/R\$\s?[\d.,]+/g, '[valor omitido]').replace(/R\$/g, '[valor omitido]');
}

function fmt(n: number | null, unidade = ''): string {
  if (n === null) return '—';
  return `${Number.isInteger(n) ? n : n.toFixed(2)}${unidade}`;
}

function bloco(titulo: string, linhas: (string | null)[]): string {
  const uteis = linhas.filter((l): l is string => !!l && l.trim().length > 0);
  return `## ${titulo}\n${uteis.length ? uteis.join('\n') : '(vazio)'}\n`;
}

/**
 * Texto para o prompt. `comReais` DESLIGADO por padrão: o R$ do saving (valor/hora por cargo) é
 * escondido do usuário por decisão de produto, e o memorial de saving vai junto porque carrega
 * R$ dentro. Ligue só para agentes internos que auditam VALOR.
 */
export function dossieParaTexto(d: Dossie, opts: { comReais?: boolean } = {}): string {
  const reais = opts.comReais === true;
  const t = (s: string | null) => (reais ? s : ocultarReais(s));
  const fin = d.financeiro;
  const partes: string[] = [];

  partes.push(
    bloco('Identificação', [
      `Projeto: ${d.nome} (id ${d.id})`,
      `Área: ${d.area ?? '—'}`,
      `Autor: ${d.autor.nome ?? '—'} <${d.autor.email ?? '—'}> · cargo: ${d.autor.cargo ?? '—'}`,
      `Submetido em ${d.submissao.data ?? '—'} · versão ${d.submissao.versao} (${d.submissao.reenvios} reenvio(s)) · atualizado ${d.submissao.atualizado_em ?? '—'}${d.submissao.descontinuado ? ' · DESCONTINUADO' : ''}`,
      `Especial: ${d.classificacao.especial ? 'sim' : 'não'} · tipos: ${d.classificacao.tipos.join(', ') || '—'} · complexidade: ${d.classificacao.complexidade ?? '—'} · ferramenta: ${d.classificacao.ferramenta ?? '—'} · escopo: ${d.classificacao.escopo ?? '—'}`,
      d.contexto.contexto_especial ? `Por que é especial: ${t(d.contexto.contexto_especial)}` : null,
      d.contexto.contrafactual_afetados.length ? `Quem sentiria falta: ${d.contexto.contrafactual_afetados.join(', ')}` : null,
      d.contexto.membros.length ? `Equipe: ${d.contexto.membros.join(', ')}` : null,
      d.contexto.anexos_links.length ? `Anexos (links): ${d.contexto.anexos_links.join(' ')}` : null,
    ]),
  );
  partes.push(bloco('Descrição', [t(d.descricao)]));
  partes.push(
    bloco('Documentação', d.documentacao.presente
      ? [
          `O que faz: ${t(d.documentacao.o_que_faz) ?? '—'}`,
          `Execução: ${t(d.documentacao.execucao) ?? '—'}`,
          d.documentacao.fluxo.length ? `Fluxo:\n${d.documentacao.fluxo.map((x) => `- ${t(x)}`).join('\n')}` : null,
          d.documentacao.dependencias.length ? `Dependências:\n${d.documentacao.dependencias.map((x) => `- ${t(x)}`).join('\n')}` : null,
          d.documentacao.atencao.length ? `Atenção:\n${d.documentacao.atencao.map((x) => `- ${t(x)}`).join('\n')}` : null,
          d.documentacao.configurar_antes.length ? `Configurar antes:\n${d.documentacao.configurar_antes.map((x) => `- ${t(x)}`).join('\n')}` : null,
        ]
      : ['(documentação compilada ausente)']),
  );

  const linhasFin: (string | null)[] = [
    `Saving em horas: ${fmt(fin.saving_horas, 'h')} (${fin.tipo_saving ?? 'cadência não informada'}) · alguém fazia: ${fin.alguem_fazia ?? '—'}`,
    fin.linhas.length
      ? `Linhas de horas:\n${fin.linhas.map((l) => `- ${l.cargo}: ${fmt(l.horas_antes, 'h')} antes → ${fmt(l.horas_depois, 'h')} depois`).join('\n')}`
      : null,
    fin.horas_carga_real !== null || fin.horas_escala !== null
      ? `Carga real ${fmt(fin.horas_carga_real, 'h')} · escala ${fmt(fin.horas_escala, 'h')}${fin.justificativa_carga_escala ? ` — ${t(fin.justificativa_carga_escala)}` : ''}`
      : null,
    fin.alocacao_ganhos ? `Alocação dos ganhos: ${t(fin.alocacao_ganhos)}` : null,
    reais ? `Saving em R$: ${fmt(fin.saving_reais)} · ganho total mensal: ${fmt(fin.ganho_total_mensal)}` : null,
    fin.custo_evitado_reais !== null ? `Custo evitado: ${fmt(fin.custo_evitado_reais)}` : null,
    fin.custo_evitado_itens.length ? `Itens de custo evitado: ${t(JSON.stringify(fin.custo_evitado_itens))}` : null,
    fin.custo_externo_mensal !== null ? `Custo externo mensal: ${fmt(fin.custo_externo_mensal)}` : null,
    fin.custo_projeto_itens.length ? `Itens de custo do projeto: ${t(JSON.stringify(fin.custo_projeto_itens))}` : null,
    fin.receita_mensal !== null ? `Receita mensal: ${fmt(fin.receita_mensal)} (${fin.tipo_receita ?? '—'})` : null,
    fin.memorial_saving ? (reais ? `Memorial de saving:\n${fin.memorial_saving}` : '[memorial com valores omitidos]') : null,
    fin.memorial_receita ? `Memorial de receita:\n${t(fin.memorial_receita)}` : null,
    fin.observacoes_analisador ? `Parecer do analisador:\n${t(fin.observacoes_analisador)}` : null,
  ];
  if (d.v2) {
    linhasFin.push(
      `v2 — saving efetivado: ${fmt(d.v2.saving_efetivado_antes)} → ${fmt(d.v2.saving_efetivado_agora)} (${d.v2.saving_efetivado_frequencia ?? '—'})${d.v2.saving_efetivado_evidencia ? ` · evidência: ${t(d.v2.saving_efetivado_evidencia)}` : ''}`,
      d.v2.custo_evitado_nao_contratado !== null ? `v2 — custo evitado não contratado: ${fmt(d.v2.custo_evitado_nao_contratado)}` : null,
      d.v2.ganho_imensuravel_racional ? `v2 — ganho imensurável: ${t(d.v2.ganho_imensuravel_racional)}` : null,
      d.v2.custo_rodar_itens.length ? `v2 — custo para rodar: ${t(JSON.stringify(d.v2.custo_rodar_itens))}` : null,
    );
  }
  partes.push(bloco('Financeiro', linhasFin));

  partes.push(
    bloco('Triagem', [
      `Status: ${d.triagem.status ?? '—'} · estrelas: ${d.triagem.estrelas ?? '—'} · classificação: ${d.triagem.classificacao ?? '—'}`,
      d.triagem.motivo_reprovado ? `Motivo reprovado: ${t(d.triagem.motivo_reprovado)}` : null,
      d.triagem.motivo_reenvio ? `Motivo reenvio: ${t(d.triagem.motivo_reenvio)}` : null,
      `Pré-aprovação do líder: ${d.triagem.aprovacao_lider ?? '—'}${d.triagem.justificativa_lider ? ` — ${t(d.triagem.justificativa_lider)}` : ''}`,
    ]),
  );
  partes.push(
    bloco('Histórico', [
      d.historico.versoes.length
        ? `Versões: ${d.historico.versoes.map((v) => `v${v.versao_num} ${v.acao} (${v.created_at ?? '—'})`).join(' · ')}`
        : null,
      d.historico.mudancas_ultimo_reenvio
        ? d.historico.mudancas_ultimo_reenvio.length
          ? `Mudou no último reenvio:\n${d.historico.mudancas_ultimo_reenvio.map((m) => `- ${m.campo}: ${t(JSON.stringify(m.antes))} → ${t(JSON.stringify(m.depois))}`).join('\n')}`
          : 'Último reenvio sem mudança nos campos comparáveis.'
        : null,
      d.historico.eventos.length
        ? `Eventos de formulário: ${d.historico.eventos.map((e) => `${e.tipo}${e.fase ? `/${e.fase}` : ''} (${e.created_at ?? '—'})`).join(' · ')}`
        : null,
    ]),
  );
  partes.push(
    bloco('Fontes ausentes', d.lacunas.length ? d.lacunas.map((l) => `- ${l}: ${DESCRICAO_LACUNA[l]}`) : ['nenhuma']),
  );
  return partes.join('\n');
}

export function resumoDossie(d: Dossie): { chars: number; secoes_presentes: string[]; lacunas: Lacuna[] } {
  const fin = d.financeiro;
  const secoes: string[] = ['identificacao'];
  if (d.descricao) secoes.push('descricao');
  if (d.documentacao.presente) secoes.push('documentacao');
  if (
    fin.saving_horas !== null ||
    fin.saving_reais !== null ||
    fin.receita_mensal !== null ||
    fin.custo_evitado_reais !== null ||
    fin.memorial_saving ||
    fin.memorial_receita
  ) {
    secoes.push('financeiro');
  }
  if (d.v2) secoes.push('v2');
  if (Object.values(d.triagem).some((v) => v !== null)) secoes.push('triagem');
  if (d.historico.versoes.length || d.historico.eventos.length) secoes.push('historico');
  if (d.contexto.membros.length || d.contexto.anexos_links.length || d.contexto.contrafactual_afetados.length || d.contexto.contexto_especial) {
    secoes.push('contexto');
  }
  return { chars: dossieParaTexto(d).length, secoes_presentes: secoes, lacunas: d.lacunas };
}
