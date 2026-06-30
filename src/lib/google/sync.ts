// Orquestrador: sync fire-and-forget para Google Sheets + Chat.
// Chamado por chat.functions.ts após submissão/análise de projetos.
// Nunca propaga erros — tudo é logado via console.error.

import type { ProjetoRow } from '@/integrations/db/client.server';
import { appendRow, updateRowByProjectId, type SheetColumn } from './sheets';
import { sendChatNotification, buildSubmitMessage, buildUpdateMessage, ehProjetoTesteE2E } from './chat';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ouTraco = (v: string | null | undefined): string =>
  v != null && v.trim() !== '' ? v : '—';

// Parse seguro do JSON de links dos arquivos (coluna projetos.arquivos_links).
function parseArquivosLinks(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Colunas NUMÉRICAS da planilha (valores financeiros / horas). Vazio → 0.
// Todas as demais são tratadas como TEXTO: vazio → "—". É a padronização para a
// planilha não ter célula suja/vazia. Mudou alguma regra → ajustar só aqui.
const COLUNAS_NUMERICAS = new Set<SheetColumn>([
  'Saving Horas',
  'Horas em Reais',
  'Custo Evitado',
  'Saving Reais',
  'Custo Externo Mensal',
  'Custo do Projeto',
  'Receita Mensal',
  'Ganho Total',
  // Split do saving (horas) — numéricas: vazio/não-aplicável → 0 (NÃO "—").
  'Saving Horas Real',
  'Saving Horas Escalado',
]);

// Padroniza a linha ANTES de gravar: coluna numérica vazia/inválida → 0; coluna de
// texto vazia (null, "", "-", "—") → "—". Garante que toda submissão siga o padrão.
export function padronizarLinha(
  row: Partial<Record<SheetColumn, string | number | null | undefined>>,
): Partial<Record<SheetColumn, string | number>> {
  const out: Partial<Record<SheetColumn, string | number>> = {};
  for (const [k, v] of Object.entries(row) as [SheetColumn, string | number | null | undefined][]) {
    if (COLUNAS_NUMERICAS.has(k)) {
      let n: number;
      if (typeof v === 'number') {
        n = v;
      } else {
        // pt-BR: se há vírgula, ela é o decimal e o ponto é milhar; senão ponto é decimal.
        let str = String(v ?? '').replace(/[^0-9,.-]/g, '');
        if (str.includes(',')) str = str.replace(/\./g, '').replace(',', '.');
        n = parseFloat(str);
      }
      out[k] = Number.isFinite(n) ? n : 0;
    } else {
      const s = v == null ? '' : String(v).trim();
      out[k] = s === '' || s === '-' || s === '—' ? '—' : (v as string | number);
    }
  }
  return out;
}

// Recorrência do custo evitado = o que a pessoa marcou no formulário ('mensal' ou
// 'pontual'). Deriva dos itens persistidos (cada um com sua recorrência); itens com
// recorrências diferentes → "Misto". Função pura — testável.
export function custoEvitadoRecorrenciaLabel(
  flag: string | null | undefined,
  itensJson: string | null | undefined,
): string {
  if (flag !== 'sim') return '—';
  let itens: { recorrencia?: string }[] = [];
  try {
    const parsed = itensJson ? JSON.parse(itensJson) : [];
    if (Array.isArray(parsed)) itens = parsed;
  } catch {
    return '—';
  }
  const recs = [...new Set(itens.map((i) => (i?.recorrencia === 'pontual' ? 'pontual' : 'mensal')))];
  if (recs.length === 0) return '—';
  if (recs.length > 1) return 'Misto';
  return recs[0] === 'pontual' ? 'Pontual' : 'Mensal';
}

function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function nowFortaleza(): string {
  const now = new Date();
  const utcMs = now.getTime();
  const fortalezaMs = utcMs - 3 * 60 * 60 * 1000;
  const d = new Date(fortalezaMs);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ─── Tipos dos parâmetros de sync ────────────────────────────────────────────

export type SubmitSyncParams = {
  projetoId: string;
  modo: 'novo' | 'edicao';
  projeto: ProjetoRow;
  conteudo: Record<string, unknown>;
  saving: Record<string, unknown> | null | undefined;
  receita: Record<string, unknown> | null | undefined;
  membros: string[];
  tiposProjeto: string[];
  status: 'Aprovado' | 'Pendente';
  area: string;
  memorialLimpo: string;
  receitaMemorialLimpo: string;
  ganhoTotalMensal: number;
  // Justificativa [2.4] "o que mudou após a automação" (gate ≥44h), fatiada do
  // memorial → coluna "Alocação Ganhos". Vazia/null quando o gate não disparou.
  alocacaoGanhos?: string | null;
  // Justificativa [2.5] "carga real e ganho por escala" (cálculo + gatilhos do split),
  // fatiada do memorial → coluna "Justificativa Saving Escalado e Real". Null quando o
  // split não se aplica (ninguém fazia à mão / pontual / receita-pura) → "—".
  justificativaCargaEscala?: string | null;
  // Edição: memorial da ÚLTIMA versão ANTES desta edição → coluna "Memorial anterior".
  // Em submissão nova fica null (não há versão anterior).
  memorialAnterior?: string | null;
};

export type UpdateSyncParams = {
  projetoId: string;
  projectName: string;
  complexidade: string;
  observacoes: string;
  status: string;
};

// ─── Split carga real × escala (derivação das colunas do Sheets) ────────────
// Colunas NUMÉRICAS "Saving Horas Real" / "Saving Horas Escalado" (transparência/
// auditoria — o TOTAL "Saving Horas" NÃO muda). Derivado de "Alguém Fazia?" + total:
//  • 'sim'  (rotina humana real) → usa o split capturado pelo gate (carga real × escala).
//  • 'nao'  (contrafactual — NINGUÉM fazia à mão) → a carga humana real é 0 e TODO o
//    saving é volume que só a automação cobre ⇒ Real=0, Escalado=total. (Decisão de
//    produto 29/06/2026: vale daqui pra frente — submissões novas E edições que
//    re-sincronizam; legados antigos com 0/0 só mudam quando forem editados.)
//  • 'externo' (custo evitado puro, 0h), 'sim' SEM split capturado (legado/pré-feature)
//    e pontual sem split → 0/0 (sem dado medido — não inventa).
export function derivarSplitHorasSheet(
  alguemFazia: string | null | undefined,
  saving: { horas_carga_real?: unknown; horas_escala?: unknown; economia_horas_mes?: unknown } | null | undefined,
): { real: number; escalado: number } {
  const total = Number(saving?.economia_horas_mes) || 0;
  if (alguemFazia === 'sim' && saving?.horas_carga_real != null && saving?.horas_escala != null) {
    return { real: Number(saving.horas_carga_real), escalado: Number(saving.horas_escala) };
  }
  if (alguemFazia === 'nao') {
    return { real: 0, escalado: total };
  }
  return { real: 0, escalado: 0 };
}

// ─── Submit: Sheets → Chat (fire-and-forget) ────────────────────────────────

export async function syncSubmitToGoogle(p: SubmitSyncParams): Promise<void> {
  try {
    const dataSubmissao = nowFortaleza();
    const dataCriacao = formatDateBR(p.projeto.data_criacao_projeto);
    const participantes = p.membros.join(', ') || '—';
    const tiposStr = p.tiposProjeto.join(', ') || '—';

    const savingHoras = (p.saving?.economia_horas_mes as number) ?? 0;
    const savingReais = (p.saving?.economia_reais_mes as number) ?? 0;
    const receitaValor = (p.receita?.valor_ganho_mensal as number) ?? 0;
    const ganhoTotal = p.ganhoTotalMensal > 0 ? Math.round(p.ganhoTotalMensal * 100) / 100 : 0;

    // "Horas em Reais" (bruto): valor das horas de cada pessoa (horas × valor-hora
    // do cargo), ANTES de somar custo evitado e de abater custo externo. O líquido
    // total continua em "Saving Reais".
    const linhasSaving = Array.isArray(p.saving?.linhas)
      ? (p.saving!.linhas as { economia_reais_mes?: number }[])
      : [];
    const horasEmReais =
      Math.round(linhasSaving.reduce((s, l) => s + (Number(l.economia_reais_mes) || 0), 0) * 100) / 100;

    // Custo evitado: valor R$ mensal (já mensalizado; pontual ÷12) que entra no
    // saving — substitui o antigo "sim/não" na coluna. A recorrência marcada pela
    // pessoa no formulário vai em "Custo Mensal ou Pontual".
    const custoEvitadoReais = Math.max(0, Number(p.saving?.custo_evitado_reais) || 0);
    const custoEvitadoRecorrencia = custoEvitadoRecorrenciaLabel(
      p.projeto.custo_evitado as string | null,
      p.projeto.custo_evitado_itens as string | null,
    );

    // Custos do projeto: valor R$ mensal (mensalizado; pontual ÷12) que ABATE o
    // saving. A recorrência marcada vai em "Custo do Projeto Mensal ou Pontual".
    // (custoEvitadoRecorrenciaLabel é genérico: flag 'sim'/'nao' + itens JSON.)
    const custoProjetoReais = Math.max(0, Number(p.saving?.custo_projeto_reais) || 0);
    const custoProjetoRecorrencia = custoEvitadoRecorrenciaLabel(
      p.projeto.custo_projeto as string | null,
      p.projeto.custo_projeto_itens as string | null,
    );

    // Split carga real × ganho por escala → colunas NUMÉRICAS (transparência; o TOTAL
    // "Saving Horas" não muda). Derivado de "Alguém Fazia?" — ver derivarSplitHorasSheet:
    // 'sim' usa o split capturado; 'nao' (contrafactual) é 100% escala (Real=0); o resto 0/0.
    const { real: savingHorasReal, escalado: savingHorasEscalado } = derivarSplitHorasSheet(
      p.projeto.alguem_fazia as string | null,
      p.saving,
    );

    // Link(s) dos documentos no Google Drive → coluna "URL" da planilha.
    const arquivosLinks = parseArquivosLinks(p.projeto.arquivos_links);
    const urlDocs = arquivosLinks.length > 0 ? arquivosLinks.join('\n') : '—';

    // Colunas preenchidas pelo sistema na submissão. As colunas de Diff (manuais)
    // e as do analisador (Complexidade/Observações) são omitidas. "Memorial
    // anterior" é escrita só na edição (logo abaixo), com o memorial pré-edição.
    const row: Partial<Record<SheetColumn, string | number>> = {
      'ID Projeto': p.projetoId,
      'Data Criação': dataCriacao,
      'Área': p.area,
      'Nome Completo': ouTraco(p.projeto.responsavel_nome),
      'Email': ouTraco(p.projeto.responsavel_email),
      'Projeto': ouTraco(p.projeto.nome),
      'Participantes': participantes,
      'Descrição': ouTraco(p.projeto.descricao_breve),
      'URL': urlDocs,
      'Ferramenta': ouTraco(p.projeto.ferramenta),
      'Escopo': ouTraco(p.projeto.escopo),
      'Tipos Projeto': tiposStr,
      'Alguém Fazia?': ouTraco(p.projeto.alguem_fazia),
      'Saving Horas': savingHoras,
      'Horas em Reais': horasEmReais,
      'Custo Evitado': custoEvitadoReais, // numérico: 0 quando não há (padrão)
      'Justificativa Custo Evitado': ouTraco(p.projeto.custo_evitado_justificativa),
      'Custo Mensal ou Pontual': custoEvitadoRecorrencia,
      'Saving Reais': savingReais,
      'Tipo de Saving': ouTraco(p.saving?.tipo_saving as string | undefined),
      'Memorial de Saving': ouTraco(p.memorialLimpo),
      'Custo Externo Mensal': p.projeto.custo_externo_mensal ?? 0,
      'Receita Mensal': receitaValor,
      'Tipo de Receita': ouTraco(p.receita?.tipo_saving as string | undefined),
      'Receita Memorial': ouTraco(p.receitaMemorialLimpo),
      'Status': p.status,
      'Ganho Total': ganhoTotal,
      // Observações vem do analisador (preenchida depois, via syncUpdateToGoogle).
      // No append ainda está vazia → grava "—" (regra: texto vazio → traço) em vez
      // de deixar a célula em branco. O analisador sobrescreve quando concluir.
      'Observações': ouTraco(p.projeto.observacoes as string | null | undefined),
      'Contexto do Projeto Especial': ouTraco(p.projeto.contexto_especial),
      'Especial?': p.projeto.especial === 1 ? 'Sim' : 'Não',
      'Atualizado Em': dataSubmissao,
      // Justificativa do gate ≥44h fatiada do memorial; "—" quando não houve gate.
      'Alocação Ganhos': ouTraco(p.alocacaoGanhos),
      // Governança: 'Sim'/'Não' declarado no formulário; "—" quando não respondido.
      'Usa AI Proxy':
        p.projeto.usa_ai_proxy === 'sim' ? 'Sim'
          : p.projeto.usa_ai_proxy === 'nao' ? 'Não'
            : '—',
      // Custos do projeto (serviços pagos que a solução consome pra rodar — ABATE).
      'Custo do Projeto': custoProjetoReais, // numérico: 0 quando não há (padrão)
      'Justificativa Custo do Projeto': ouTraco(p.projeto.custo_projeto_justificativa),
      'Custo do Projeto Mensal ou Pontual': custoProjetoRecorrencia,
      // Split do saving (transparência): carga humana real × ganho por escala.
      // Numéricas — 0 quando não se aplica (não "—").
      'Saving Horas Real': savingHorasReal,
      'Saving Horas Escalado': savingHorasEscalado,
      // Justificativa do split (cálculo + gatilhos) — TEXTO: "—" quando não se aplica.
      'Justificativa Saving Escalado e Real': ouTraco(p.justificativaCargaEscala),
      // Análise do antiagente (F5) — TEXTO: "—" enquanto não houver análise. Quando o
      // F5 for implementado, escreve o parecer aqui (via syncUpdateToGoogle, como a
      // Complexidade/Observações). Por ora, garante "—" em vez de célula em branco.
      'Análise Antiagente': ouTraco((p.projeto as { analise_antiagente?: string | null }).analise_antiagente),
    };

    // "Memorial anterior": na EDIÇÃO com memorial da versão anterior, grava-o; em
    // submissão nova (ou edição sem anterior) grava "—" (regra: texto vazio → traço),
    // em vez de deixar a célula em branco. (Não confundir com as colunas Diff, que
    // são manuais e o sistema nunca escreve.)
    row['Memorial anterior'] =
      p.modo === 'edicao' && p.memorialAnterior && p.memorialAnterior.trim()
        ? p.memorialAnterior.trim()
        : '—';

    // "Data Submissão" é a data em que a pessoa SUBMETEU — só na submissão nova
    // (append). Na EDIÇÃO, NÃO escrevemos essa coluna (preserva a data original);
    // só "Atualizado Em" reflete a edição.
    if (p.modo !== 'edicao') {
      row['Data Submissão'] = dataSubmissao;
    }

    // Padroniza antes de gravar: numérico vazio → 0; texto vazio → "—".
    const rowPadronizada = padronizarLinha(row);

    // Edição: atualiza a linha existente (match por ID Projeto). Nunca faz append
    // — só dá pra editar um projeto que já está na planilha. Nova: append.
    try {
      if (p.modo === 'edicao') {
        await updateRowByProjectId(p.projetoId, rowPadronizada);
      } else {
        await appendRow(rowPadronizada);
      }
    } catch (sheetsErr) {
      console.error(
        `[google/sync] Falha ao ${p.modo === 'edicao' ? 'atualizar' : 'inserir'} na planilha:`,
        sheetsErr,
      );
    }

    // 2. Notificação Google Chat (mudo para projetos de teste E2E)
    try {
      if (ehProjetoTesteE2E(p.projeto.nome)) {
        console.warn(`[google/sync] Projeto de teste E2E "${p.projeto.nome}" — notificação Google Chat suprimida.`);
        return;
      }
      const message = buildSubmitMessage({
        projeto: ouTraco(p.projeto.nome),
        area: p.area,
        ferramenta: ouTraco(p.projeto.ferramenta),
        escopo: ouTraco(p.projeto.escopo),
        tipos: tiposStr,
        nomeCompleto: ouTraco(p.projeto.responsavel_nome),
        email: ouTraco(p.projeto.responsavel_email),
        participantes,
        descricao: ouTraco(p.projeto.descricao_breve),
        savingHoras,
        savingReais,
        tipoSaving: ouTraco(p.saving?.tipo_saving as string | undefined),
        receitaValor,
        tipoReceita: ouTraco(p.receita?.tipo_saving as string | undefined),
        dataSubmissao,
        modo: p.modo,
      });
      await sendChatNotification(message);
    } catch (chatErr) {
      console.error('[google/sync] Falha ao notificar Google Chat:', chatErr);
    }
  } catch (e) {
    console.error('[google/sync] Erro inesperado no syncSubmitToGoogle:', e);
  }
}

// ─── Update: Sheets + Chat (fire-and-forget) ────────────────────────────────

export async function syncUpdateToGoogle(p: UpdateSyncParams): Promise<void> {
  try {
    // 1. Update na planilha (match por ID Projeto — estável e único)
    try {
      await updateRowByProjectId(p.projetoId, padronizarLinha({
        'Complexidade': p.complexidade,
        'Observações': p.observacoes,
        'Status': p.status,
        'Atualizado Em': nowFortaleza(),
      }));
    } catch (sheetsErr) {
      console.error('[google/sync] Falha ao update na planilha:', sheetsErr);
    }

    // 2. Notificação Google Chat (mudo para projetos de teste E2E)
    try {
      if (ehProjetoTesteE2E(p.projectName)) {
        console.warn(`[google/sync] Projeto de teste E2E "${p.projectName}" — notificação de update Google Chat suprimida.`);
        return;
      }
      const message = buildUpdateMessage({
        projeto: p.projectName,
        status: p.status,
      });
      await sendChatNotification(message);
    } catch (chatErr) {
      console.error('[google/sync] Falha ao notificar Google Chat:', chatErr);
    }
  } catch (e) {
    console.error('[google/sync] Erro inesperado no syncUpdateToGoogle:', e);
  }
}
