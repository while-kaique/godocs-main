// Orquestrador: sync fire-and-forget para Google Sheets + Chat.
// Chamado por chat.functions.ts após submissão/análise de projetos.
// Nunca propaga erros — tudo é logado via console.error.

import type { ProjetoRow } from '@/integrations/db/client.server';
import { appendRow, updateRowByProjectId, type SheetColumn } from './sheets';
// ⚠️ `buildUpdateMessage` NÃO entra aqui: o D30 (12/08) removeu o `🚨 … Análise Pendente`
// — era a MESMA notificação por submissão com outra roupa. Agora o grupo é avisado na
// pré-aprovação do líder (`notificacao-chat.ts`). Não reimplementar.
import { sendChatNotification, buildSubmitMessage, ehProjetoTesteE2E } from './chat';
// Espelho da planilha: quem escreve no Sheets remenda o espelho na hora, senão o efeito da
// escrita só apareceria na tela no próximo cron (as telas leem o espelho — `sheet-espelho.ts`).
import { espelharEscrita } from '@/lib/sheet-espelho';
// GoDocs v2 (T6): as células financeiras de um projeto que declarou o ganho pelo
// formulário determinístico saem das colunas da v2, não do `saving`/`receita` do chat.
import {
  desserializarCategorias,
  desserializarCustoRodar,
  desserializarLinhasHoras,
} from '@/lib/ganhos';
import { tituloGanho } from '@/lib/ganhos-rotulos';
import { normalizarTipo, tipoParaSheet } from '@/lib/categoria-projeto';
import { moedaBR } from '@/lib/mensagens-submissao';

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
  'Custo Evitado Horas',
  'Custo Evitado Horas Reais',
  'Saving Efetivado',
  'Impacto Bruto',
  'Custo Externo Mensal',
  'Custo para Rodar',
  'Receita Incremental',
  'Impacto Líquido',
  // Split do saving (horas) — numéricas: vazio/não-aplicável → 0 (NÃO "—").
  'Saving Horas Real',
  'Saving Horas Escalado',
  // ⚠️ As 3 colunas NOVAS da v2 são DINHEIRO e entram na mesma régua. Hoje o ramo v2
  // sempre entrega número (0 explícito), mas deixá-las fora faria um `null` sair como
  // "—" numa coluna que o rollup SOMA — exatamente o defeito que esta lista existe para
  // impedir. As demais colunas financeiras da v2 já estão aqui sob o nome novo (são as
  // mesmas células, renomeadas in-place).
  'Saving Efetivado Agora',
  'Custo Evitado Não Contratado',
  'Impacto Líquido Mensal',
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

export function nowFortaleza(): string {
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
  // Papel de cada membro (e-mail→papel). Distribui os membros nas 4 colunas de papel do
  // Sheets (Participantes=Coautor, Participantes 2=Participante, Idealizador, Referência
  // técnica). Opcional: ausente/vazio → todos entram como coexecutor (retrocompatível).
  membrosPapeis?: Record<string, string>;
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
  // fatiada do memorial → coluna "Racional Custo Evitado". Null quando o
  // split não se aplica (ninguém fazia à mão / pontual / receita-pura) → "—".
  justificativaCargaEscala?: string | null;
  // Edição: memorial da ÚLTIMA versão ANTES desta edição → coluna "Memorial anterior".
  // Em submissão nova fica null (não há versão anterior).
  memorialAnterior?: string | null;
  // Pré-aprovação do líder → coluna "Aprovação do Líder". Só o ESTADO
  // ("Pré-aprovado" / "Pré-pendente" / "Pré-reprovado"); null/vazio → "—".
  // Não bloqueia nada (D3).
  //
  // ⚠️ `undefined` ≠ `null` AQUI (e só nestas 2 colunas): `null` é "não se aplica"
  // e grava "—"; **`undefined` é "não sei, não encoste"** e OMITE a coluna do
  // update — quem não conhece o estado da fila (o `resyncGoogle`) não pode
  // apagar o parecer que o líder já deu. No APPEND a omissão não existe: a linha
  // nasce agora e a célula tem de nascer com "—" (padrão "texto vazio → —").
  aprovacaoLider?: string | null;
  // Detalhe do parecer (quem, quando, checklist, comentário) → coluna
  // "Justificativa Aprovação do Líder". Separada para a planilha poder filtrar
  // pelo estado sem depender de texto livre. Mesma regra de `undefined` acima.
  justificativaAprovacaoLider?: string | null;
  // Se ESTE sync avisa o grupo do Google Chat. OBRIGATÓRIO de propósito (não
  // opcional-com-default): quem decide é o chamador, via `decidirMomentoNotificacao`
  // (`src/lib/notificacao-chat.ts`) — com um default aqui, um terceiro chamador que
  // nascesse amanhã notificaria o grupo por acidente. A gravação na PLANILHA não
  // depende disto; só o Chat. Ver a régua na seção "Sync Google" do CLAUDE.md.
  notificarChat: boolean;
  // Linha explicando por que o projeto não tem parecer de líder (autor é liderança /
  // sem líder / TeamGuide fora). Repassada ao `buildSubmitMessage`; só faz sentido
  // junto de `notificarChat: true`.
  notaPreAprovacao?: string | null;
  // Vínculo de FEATURE → coluna "ID Pai" (linha do FILHO): id do projeto PAI, ou null →
  // "—" (projeto novo). A coluna "ID Feature" (lista no PAI) é escrita à parte (cross-row).
  idPai?: string | null;
};

export type UpdateSyncParams = {
  projetoId: string;
  projectName: string;
  complexidade: string;
  observacoes: string;
  status: string;
  // Eixo TIPO da categorização (item 5.4) → coluna "Tipo de Projeto". Mesma disciplina
  // das colunas do líder: `undefined` = "não sei, não encoste" (a célula é OMITIDA do
  // update); `null` = "não se aplica" → "—". Sem isso, um chamador que não conhece a
  // categorização (o resync) apagaria a classificação já gravada pelo analisador.
  tipoProjeto?: string | null;
  // Classificação de elegibilidade do analisador → coluna "Classificação" (SEMPRE
  // com texto) e "Motivo Reprovado". `undefined` = não escreve a célula (usado pelo
  // resync, onde o append/update anterior já gravou as duas a partir do projeto).
  // ⚠️ "Motivo Reenvio" NUNCA é escrita aqui — é manual (triagem humana).
  classificacao?: string | null;
  classificacaoJustificativa?: string | null;
  motivoReprovacao?: string | null;
  // Pré-aprovação do líder (D29): quando a análise REPROVA por critério, ela dispensa a
  // fila e reflete "Dispensado" + a justificativa do sistema no MESMO update que grava
  // Status/Classificação — senão a planilha seguiria dizendo "Pré-pendente" para um
  // projeto já recusado, e o relatório de espera por líder contaria um projeto morto.
  //
  // ⚠️ Mesma régua do `syncSubmitToGoogle`: `undefined` = "não sei, não encoste" e a
  // coluna é OMITIDA — a análise que NÃO dispensou (o caso comum) não pode zerar o
  // parecer que o líder já deu. `null` = "não se aplica" → "—" (padronizarLinha).
  aprovacaoLider?: string | null;
  justificativaAprovacaoLider?: string | null;
};

// ─── Split carga real × escala (derivação das colunas do Sheets) ────────────
// Colunas NUMÉRICAS "Saving Horas Real" / "Saving Horas Escalado" (transparência/
// auditoria — o TOTAL "Custo Evitado Horas" NÃO muda). Derivado de "Alguém Fazia?" + total:
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

// ─── Classificação de elegibilidade → coluna "Classificação" ────────────────
// Rótulos legíveis dos 3 níveis decididos pelo analisador ("isto é projeto?").
export const CLASSIFICACAO_LABEL: Record<string, string> = {
  claro_sim: 'Claro sim',
  claro_nao: 'Claro não',
  zona_cinzenta: 'Zona cinzenta',
};

// Monta a célula da coluna "Classificação": "<Rótulo> — <justificativa>". A
// justificativa é SEMPRE esperada (o analisador tem fallback determinístico); sem
// ela, grava só o rótulo. Classificação ausente/desconhecida (legado, ou análise
// que ainda não rodou) → "—" (o analisador sobrescreve quando concluir). Pura.
export function derivarClassificacaoSheet(
  classificacao: string | null | undefined,
  justificativa: string | null | undefined,
): string {
  const rotulo = CLASSIFICACAO_LABEL[(classificacao ?? '').trim()];
  if (!rotulo) return '—';
  const just = (justificativa ?? '').trim();
  return just ? `${rotulo} — ${just}` : rotulo;
}

// ─── Decisor da IDA: recuperar linha ausente por append ─────────────────────
// `updateRowByProjectId` devolve `false` SÓ quando o "ID Projeto" não existe na
// planilha (linha ausente, ex.: o append da 1ª submissão morreu por cota). Nesse
// caso a edição cai para append em vez de virar no-op silencioso. Qualquer outro
// retorno (`true`, ou `undefined` de um chamador/mock antigo) → NÃO apenda, para
// não duplicar linha existente. Pura — testável sem tocar o Sheets.
export function deveRecuperarPorAppend(
  modo: 'novo' | 'edicao',
  linhaAtualizada: boolean | undefined,
): boolean {
  return modo === 'edicao' && linhaAtualizada === false;
}

// ─── Papéis dos participantes → 3 colunas do Sheets ─────────────────────────
// Distribui os membros (lista plana) nas colunas por papel. "Coautor" guarda os
// COAUTORES (value interno `coexecutor`); "Participante" os PARTICIPANTES (value
// interno `planejador`); "Contribuidor" os CONTRIBUIDORES (value interno `contribuidor`).
// Cada e-mail entra em exatamente UMA coluna. Coluna sem ninguém → '' (vira "—" no
// padronizarLinha). Lookup tolerante a caixa.
// ⚠️ As CHAVES do bucket são os `value` internos (`coexecutor`/`planejador` mantidos);
// só rótulos e nomes de coluna mudaram. Papel AUSENTE → coexecutor/"Coautor"
// (retrocompatível: legados tinham todos em "Coautor"); papéis LEGADOS
// `idealizador`/`referencia_tecnica` (feature anterior) → "Contribuidor". Pura — testável.
const PAPEIS_COLUNA = ['coexecutor', 'planejador', 'contribuidor'] as const;
export type PapelColuna = (typeof PAPEIS_COLUNA)[number];

// Normaliza um papel bruto (do form ou legado) para uma das 3 colunas atuais.
function normalizarPapelColuna(raw: string | null | undefined): PapelColuna {
  switch ((raw ?? '').toLowerCase()) {
    case 'planejador': return 'planejador';
    case 'contribuidor':
    case 'idealizador':        // legado (feature anterior) → Contribuidor
    case 'referencia_tecnica': // legado (feature anterior) → Contribuidor
      return 'contribuidor';
    case 'coexecutor':
    default:                   // ausente/desconhecido → Coautor (retrocompatível)
      return 'coexecutor';
  }
}

export function derivarColunasPapeis(
  membros: string[],
  papeis: Record<string, string> | null | undefined,
): Record<PapelColuna, string> {
  const buckets: Record<PapelColuna, string[]> = {
    coexecutor: [], planejador: [], contribuidor: [],
  };
  const porCaixaBaixa: Record<string, string> = {};
  for (const [k, v] of Object.entries(papeis ?? {})) porCaixaBaixa[k.toLowerCase()] = v;
  for (const email of membros) {
    const raw = papeis?.[email] ?? porCaixaBaixa[email.toLowerCase()];
    buckets[normalizarPapelColuna(raw)].push(email);
  }
  return {
    coexecutor: buckets.coexecutor.join(', '),
    planejador: buckets.planejador.join(', '),
    contribuidor: buckets.contribuidor.join(', '),
  };
}

// ─── Submit: Sheets → Chat (fire-and-forget) ────────────────────────────────

/**
 * As células da planilha de um projeto do GoDocs **v2** — ou `null` se ele não é v2.
 *
 * O discriminador é `ganho_categorias`: só o formulário determinístico da Etapa 3 a
 * escreve (`salvarGanhos`), então projeto sem ela é v1 e segue pelo caminho de sempre.
 * ⚠️ Não existe migração entre as duas gerações (Fronteira do plano) — o que existe é
 * esta bifurcação, e ela é por PROJETO, não por ambiente.
 *
 * ⚠️ As colunas são as MESMAS células da v1, renomeadas in-place: a régua D1 só trocou os
 * conceitos de nome (o `Custo Evitado` da v1 — a empresa pagava e parou — é o SAVING
 * EFETIVADO da v2; o saving por HORAS da v1 é o CUSTO EVITADO da v2). Por isso as 578
 * linhas antigas continuam legíveis, e por isso um projeto v1 e um v2 convivem na mesma
 * aba sem coluna duplicada.
 *
 * ⚠️ Nenhum número é recalculado aqui: os 3 impactos vêm MATERIALIZADOS de
 * `montarPatchGanhos` (`ganhos.ts` → `impacto.ts`), gravados no mesmo UPDATE do ganho.
 * Recalcular no sync criaria a 2ª cabeça que esta frente existe para desfazer — e um
 * `undefined` num campo numérico vira `0` no `padronizarLinha`, o que passaria por
 * "projeto sem ganho" em vez de acusar erro.
 */
function celulasGanhoV2(
  projeto: ProjetoRow,
): Partial<Record<SheetColumn, string | number>> | null {
  const categorias = desserializarCategorias(projeto.ganho_categorias);
  if (categorias.length === 0) return null;

  // Horas liberadas: o TOTAL das linhas, clampado por linha (par invertido não abate o
  // ganho das outras — mesma régua de `derivarValorHorasCustoEvitado`).
  const linhas = desserializarLinhasHoras(projeto.custo_evitado_horas_linhas);
  const horas =
    Math.round(
      linhas.reduce((soma, l) => soma + Math.max(0, l.horasAntes - l.horasDepois), 0) * 100,
    ) / 100;

  const itensCusto = desserializarCustoRodar(projeto.custo_rodar_itens);
  const custoRodarTotal =
    Math.round(itensCusto.reduce((soma, i) => soma + Math.max(0, i.valor), 0) * 100) / 100;
  // Mesmo formato de item da v1 (`• nome — R$ valor (recorrência). o que é`), para a
  // coluna continuar legível por quem já lê a da v1.
  // ⚠️ O detalhamento usa o MESMO valor clampado do total. Listar o item negativo cru
  // (`R$ -100,00`) ao lado de um total que o ignora faz a coluna contradizer a vizinha, e
  // quem lê a planilha perde a confiança nas duas — a justificativa existe para EXPLICAR
  // o número ao lado, não para divergir dele.
  const custoRodarDescricao = itensCusto
    .map((i) => {
      const oQueE = i.oQueE.trim() ? ` ${i.oQueE.trim()}` : '';
      return `• ${i.nome} — R$ ${moedaBR(Math.max(0, i.valor))} (${i.frequencia}).${oQueE}`;
    })
    .join('\n');
  const freqCustoRodar = [...new Set(itensCusto.map((i) => i.frequencia))];

  const num = (v: number | null | undefined) => (typeof v === 'number' ? v : 0);

  return {
    'Tipos de Ganho': categorias.map((c) => tituloGanho(c)).join(', '),

    // Saving efetivado: as DUAS pontas (o ganho é a diferença, derivada — sem célula).
    'Saving Efetivado': num(projeto.saving_efetivado_valor_antes),
    'Saving Efetivado Agora': num(projeto.saving_efetivado_valor_agora),
    'Evidência Saving Efetivado': ouTraco(projeto.saving_efetivado_evidencia),
    'Freq. Saving Efetivado': ouTraco(projeto.saving_efetivado_frequencia),

    // Custo evitado: os dois braços, com a frequência do BLOCO.
    'Custo Evitado Horas': horas,
    'Custo Evitado Horas Reais': num(projeto.custo_evitado_horas_valor),
    'Custo Evitado Não Contratado': num(projeto.custo_evitado_nao_contratado),
    'Freq. Custo Evitado': ouTraco(projeto.custo_evitado_frequencia),
    'Racional Custo Evitado': ouTraco(projeto.custo_evitado_racional),

    'Receita Incremental': num(projeto.receita_incremental_valor),
    'Freq. Receita': ouTraco(projeto.receita_incremental_frequencia),
    'Racional Receita': ouTraco(projeto.receita_incremental_racional),

    'Ganho Imensurável': ouTraco(projeto.ganho_imensuravel_racional),

    'Custo para Rodar': custoRodarTotal,
    'Justificativa Custo para Rodar': ouTraco(custoRodarDescricao),
    'Freq. Custo para Rodar': ouTraco(freqCustoRodar.join(' + ')),

    // Os 3 impactos, materializados no UPDATE do ganho. Nunca recalculados aqui.
    'Impacto Bruto': num(projeto.impacto_bruto),
    'Impacto Líquido': num(projeto.impacto_liquido),
    'Impacto Líquido Mensal': num(projeto.impacto_liquido_mensal),
  };
}

export async function syncSubmitToGoogle(p: SubmitSyncParams): Promise<void> {
  try {
    const dataSubmissao = nowFortaleza();
    const dataCriacao = formatDateBR(p.projeto.data_criacao_projeto);
    // Chat notification lista TODOS os participantes (independe do papel).
    const participantes = p.membros.join(', ') || '—';
    // Sheets: distribui os participantes nas 4 colunas por papel.
    const colsPapeis = derivarColunasPapeis(p.membros, p.membrosPapeis);
    const tiposStr = p.tiposProjeto.join(', ') || '—';

    const savingHoras = (p.saving?.economia_horas_mes as number) ?? 0;
    const savingReais = (p.saving?.economia_reais_mes as number) ?? 0;
    const receitaValor = (p.receita?.valor_ganho_mensal as number) ?? 0;
    const ganhoTotal = p.ganhoTotalMensal > 0 ? Math.round(p.ganhoTotalMensal * 100) / 100 : 0;

    // "Custo Evitado Horas Reais" (bruto): valor das horas de cada pessoa (horas × valor-hora
    // do cargo), ANTES de somar custo evitado e de abater custo externo. O líquido
    // total continua em "Impacto Bruto".
    const linhasSaving = Array.isArray(p.saving?.linhas)
      ? (p.saving!.linhas as { economia_reais_mes?: number }[])
      : [];
    const horasEmReais =
      Math.round(linhasSaving.reduce((s, l) => s + (Number(l.economia_reais_mes) || 0), 0) * 100) / 100;

    // Custo evitado: valor R$ (pontual e mensal pelo valor cheio, sem ÷12) que entra no
    // saving — substitui o antigo "sim/não" na coluna. A recorrência marcada pela
    // pessoa no formulário vai em "Freq. Saving Efetivado".
    const custoEvitadoReais = Math.max(0, Number(p.saving?.custo_evitado_reais) || 0);
    const custoEvitadoRecorrencia = custoEvitadoRecorrenciaLabel(
      p.projeto.custo_evitado as string | null,
      p.projeto.custo_evitado_itens as string | null,
    );

    // Custos do projeto: valor R$ (pontual e mensal pelo valor cheio, sem ÷12) que ABATE o
    // saving. A recorrência marcada vai em "Freq. Custo para Rodar".
    // (custoEvitadoRecorrenciaLabel é genérico: flag 'sim'/'nao' + itens JSON.)
    const custoProjetoReais = Math.max(0, Number(p.saving?.custo_projeto_reais) || 0);
    const custoProjetoRecorrencia = custoEvitadoRecorrenciaLabel(
      p.projeto.custo_projeto as string | null,
      p.projeto.custo_projeto_itens as string | null,
    );

    // Split carga real × ganho por escala → colunas NUMÉRICAS (transparência; o TOTAL
    // "Custo Evitado Horas" não muda). Derivado de "Alguém Fazia?" — ver derivarSplitHorasSheet:
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
      // "Coautor" = Coautores; "Participante" = Participantes; "Contribuidor"
      // = Contribuidores. Coluna sem ninguém → '' → padronizarLinha "—".
      'Coautor': colsPapeis.coexecutor,
      'Participante': colsPapeis.planejador,
      'Contribuidor': colsPapeis.contribuidor,
      'Descrição': ouTraco(p.projeto.descricao_breve),
      'URL': urlDocs,
      'Ferramenta': ouTraco(p.projeto.ferramenta),
      'Escopo': ouTraco(p.projeto.escopo),
      'Tipos de Ganho': tiposStr,
      'Alguém Fazia?': ouTraco(p.projeto.alguem_fazia),
      'Custo Evitado Horas': savingHoras,
      'Custo Evitado Horas Reais': horasEmReais,
      'Saving Efetivado': custoEvitadoReais, // numérico: 0 quando não há (padrão)
      'Evidência Saving Efetivado': ouTraco(p.projeto.custo_evitado_justificativa),
      'Freq. Saving Efetivado': custoEvitadoRecorrencia,
      'Impacto Bruto': savingReais,
      'Freq. Custo Evitado': ouTraco(p.saving?.tipo_saving as string | undefined),
      'Memorial de Saving': ouTraco(p.memorialLimpo),
      'Custo Externo Mensal': p.projeto.custo_externo_mensal ?? 0,
      'Receita Incremental': receitaValor,
      'Freq. Receita': ouTraco(p.receita?.tipo_saving as string | undefined),
      'Racional Receita': ouTraco(p.receitaMemorialLimpo),
      'Status': p.status,
      'Impacto Líquido': ganhoTotal,
      // Observações vem do analisador (preenchida depois, via syncUpdateToGoogle).
      // No append ainda está vazia → grava "—" (regra: texto vazio → traço) em vez
      // de deixar a célula em branco. O analisador sobrescreve quando concluir.
      'Observações': ouTraco(p.projeto.observacoes as string | null | undefined),
      'Ganho Imensurável': ouTraco(p.projeto.contexto_especial),
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
      'Custo para Rodar': custoProjetoReais, // numérico: 0 quando não há (padrão)
      'Justificativa Custo para Rodar': ouTraco(p.projeto.custo_projeto_justificativa),
      'Freq. Custo para Rodar': custoProjetoRecorrencia,
      // Split do saving (transparência): carga humana real × ganho por escala.
      // Numéricas — 0 quando não se aplica (não "—").
      'Saving Horas Real': savingHorasReal,
      'Saving Horas Escalado': savingHorasEscalado,
      // Justificativa do split (cálculo + gatilhos) — TEXTO: "—" quando não se aplica.
      'Racional Custo Evitado': ouTraco(p.justificativaCargaEscala),
      // Análise do antiagente (F5) — TEXTO: "—" enquanto não houver análise. Quando o
      // F5 for implementado, escreve o parecer aqui (via syncUpdateToGoogle, como a
      // Complexidade/Observações). Por ora, garante "—" em vez de célula em branco.
      'Análise Antiagente': ouTraco((p.projeto as { analise_antiagente?: string | null }).analise_antiagente),
      // Critério de projeto: classificação de elegibilidade + motivo da reprovação.
      // No append a análise ainda não rodou → "—"; o analisador sobrescreve as duas
      // via syncUpdateToGoogle. ⚠️ "Motivo Reenvio" NÃO entra aqui — o CONTEÚDO dela é
      // da triagem humana (/dashboard); só o APPEND a inicializa com "—" (logo abaixo),
      // nunca o update.
      'Classificação': derivarClassificacaoSheet(
        p.projeto.classificacao_avaliacao as string | null | undefined,
        p.projeto.classificacao_justificativa as string | null | undefined,
      ),
      'Motivo Reprovado': ouTraco(p.projeto.motivo_reprovacao as string | null | undefined),
      // Eixo TIPO (item 5.4): no append a análise ainda não rodou → "—"; quem escreve é
      // o analisador, via syncUpdateToGoogle (mesma disciplina de Complexidade/Classificação).
      'Tipo de Projeto': tipoParaSheet(
        normalizarTipo((p.projeto as { categoria_projeto?: string | null }).categoria_projeto),
      ),
      // ⚠️ GoDocs v2, POR ÚLTIMO de propósito: quando o projeto declarou o ganho pelo
      // formulário determinístico, estas células SOBRESCREVEM as derivadas do
      // `saving`/`receita` do chat, que num projeto v2 vêm vazias (não houve chat) e
      // gravariam ZERO em cima do impacto real. Projeto v1 → `null` → spread vazio →
      // a linha sai byte a byte como sempre saiu.
      ...(celulasGanhoV2(p.projeto) ?? {}),
    };

    // Pré-aprovação do líder: "Pré-pendente" na abertura da fila; "Pré-aprovado" /
    // "—" nos casos sem fila (rotuloIsencaoSheet). A DECISÃO do líder é gravada
    // depois, por updateRowByProjectId em aprovacoes.functions.ts.
    //
    // ⚠️ Só entram na linha quando o chamador SABE o estado da fila. O `resyncGoogle`
    // (e qualquer re-sync futuro) roda sem passar por `abrirPreAprovacao`: mandando
    // `undefined`, o `ouTraco` gravava "—" e **apagava o parecer que o líder já tinha
    // dado** — a coluna é espelho do SQLite, não pode ser zerada por um re-sync.
    // No APPEND a linha nasce agora: aí a célula tem de nascer com "—" (nunca vazia).
    if (p.aprovacaoLider !== undefined || p.modo !== 'edicao') {
      row['Aprovação do Líder'] = ouTraco(p.aprovacaoLider);
    }
    if (p.justificativaAprovacaoLider !== undefined || p.modo !== 'edicao') {
      row['Justificativa Aprovação do Líder'] = ouTraco(p.justificativaAprovacaoLider);
    }

    // "ID Pai": vínculo de FEATURE — na linha do FILHO, o id do projeto PAI. Reflete o
    // estado do SQLite (não é editável pela triagem). ⚠️ Mesma régua `undefined` ≠ `null`
    // das 2 colunas do líder acima: `null` = "não se aplica" → grava "—"; **`undefined` =
    // "não sei, não encoste"** e OMITE a coluna. Como a coluna NÃO está em
    // SAFE_UPDATE_FIELDS, nada a restaura pelo sync reverso — um chamador que rode
    // `syncSubmitToGoogle({modo:'edicao'})` sem passar `idPai` (o resyncGoogle antes deste
    // fix) zerava o vínculo do pai a cada resync. O APPEND nasce agora → célula com "—".
    // A coluna "ID Feature" (lista do PAI) é cross-row, escrita à parte (nunca aqui).
    if (p.idPai !== undefined || p.modo !== 'edicao') {
      row['ID Pai'] = ouTraco(p.idPai);
    }

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
    //
    // "Motivo Reenvio" segue a mesma regra de MOMENTO, por outro motivo: o CONTEÚDO é
    // da triagem humana (/dashboard), mas a célula não pode NASCER em branco — o padrão
    // da planilha é "texto vazio → —" (padronizarLinha). Então o APPEND a inicializa
    // com "—" e o UPDATE da edição NUNCA a toca (sobrescrever apagaria o motivo que o
    // admin escreveu). ⚠️ Não confundir com as colunas de Diff, que o sistema nunca
    // escreve em NENHUM momento.
    if (p.modo !== 'edicao') {
      row['Data Submissão'] = dataSubmissao;
      row['Motivo Reenvio'] = '—';
    }

    // Padroniza antes de gravar: numérico vazio → 0; texto vazio → "—".
    const rowPadronizada = padronizarLinha(row);

    // Edição: atualiza a linha existente (match por ID Projeto) — nunca duplica.
    // Nova: append. ⚠️ RECUPERAÇÃO: se a linha não existe mais na planilha (o
    // append da 1ª submissão falhou por cota/transiente), o update não tem onde
    // aterrissar e o projeto desaparecia em silêncio — e a `reconciliarExclusoes`
    // o purgava do SQLite depois da carência de 1h. Nesse caso caímos para append.
    // ⚠️ `etapa` existe para o LOG não mentir: sem ela, uma falha do append de
    // RECUPERAÇÃO era reportada como "Falha ao atualizar" (o rótulo saía do
    // `modo`), apontando o caminho errado num incidente de cota.
    let etapa: 'atualizar' | 'recuperar (append)' | 'inserir' =
      p.modo === 'edicao' ? 'atualizar' : 'inserir';
    try {
      if (p.modo === 'edicao') {
        const linhaAtualizada = await updateRowByProjectId(p.projetoId, rowPadronizada);
        // Espelho: a EDIÇÃO altera células de uma linha que já existe → remendo (as colunas
        // omitidas de propósito, como "Data Submissão" e "Motivo Reenvio", ficam intactas).
        await espelharEscrita(p.projetoId, rowPadronizada);
        if (deveRecuperarPorAppend(p.modo, linhaAtualizada)) {
          etapa = 'recuperar (append)';
          console.warn(
            `[google/sync] RECUPERAÇÃO: linha do projeto "${p.projetoId}" não existe na planilha — criando por append.`,
          );
          // A linha está sendo CRIADA agora, então "Data Submissão" entra (o ramo
          // normal de edição a omite de propósito, para preservar a data original) —
          // e "Motivo Reenvio" nasce com "—" pelo mesmo motivo (a célula da linha
          // antiga já se foi junto com ela; não há motivo de triagem para preservar).
          // As 2 colunas do líder seguem a mesma régua: omitir preserva a célula, mas
          // aqui NÃO HÁ célula a preservar — a linha nasce agora e não pode nascer vazia.
          const recuperada = padronizarLinha({
            ...row,
            'Data Submissão': dataSubmissao,
            'Motivo Reenvio': '—',
            'Aprovação do Líder': ouTraco(p.aprovacaoLider),
            'Justificativa Aprovação do Líder': ouTraco(p.justificativaAprovacaoLider),
          });
          await appendRow(recuperada);
          // A linha NASCEU agora → o espelho recebe a linha inteira (`novaLinha`).
          await espelharEscrita(p.projetoId, recuperada, { novaLinha: true });
        }
      } else {
        await appendRow(rowPadronizada);
        // ⚠️ Sem este remendo, uma submissão NOVA apareceria em "Meus Projetos" sem Status
        // (badge "—") até o próximo cron: a lista lê o espelho, e a linha acabou de nascer.
        await espelharEscrita(p.projetoId, rowPadronizada, { novaLinha: true });
      }
    } catch (sheetsErr) {
      console.error(`[google/sync] Falha ao ${etapa} na planilha:`, sheetsErr);
    }

    // 2. Notificação Google Chat — só quando o CHAMADOR pediu (11/08/2026).
    // O grupo deixou de ser avisado a cada submissão/edição: quem entra na fila do
    // líder só aparece lá quando ele pré-aprova (`notificarChatPreAprovacao`). Aqui
    // notificam apenas os que nunca terão parecer — especial, autor liderança, sem
    // líder, TeamGuide fora. Régua em `src/lib/notificacao-chat.ts`.
    try {
      // ⚠️ `if (...)` e NÃO `if (!...) return`: o `return` encerraria a
      // `syncSubmitToGoogle` INTEIRA, e um "passo 3" futuro seria pulado justamente no
      // caminho que virou MAJORITÁRIO (projeto que entra em fila e não notifica).
      if (!p.notificarChat) {
        // nada a fazer aqui — o alerta deste projeto sai na pré-aprovação do líder.
      } else if (ehProjetoTesteE2E(p.projeto.nome)) {
        console.warn(`[google/sync] Projeto de teste E2E "${p.projeto.nome}" — notificação Google Chat suprimida.`);
      } else {
      const message = buildSubmitMessage({
        projetoId: p.projetoId,
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
        // Projeto especial → alerta enxuto (sem saving/receita/escopo/tipos) + a
        // justificativa do porquê é especial. buildSubmitMessage desvia sozinho.
        especial: p.projeto.especial === 1,
        contextoEspecial: (p.projeto.contexto_especial as string | null) ?? undefined,
        // Por que não há parecer de líder (vazia/null → nenhuma linha na mensagem).
        notaPreAprovacao: p.notaPreAprovacao ?? null,
      });
      await sendChatNotification(message);
      }
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
      const cells: Partial<Record<SheetColumn, string | number>> = {
        'Complexidade': p.complexidade,
        'Observações': p.observacoes,
        'Status': p.status,
        'Atualizado Em': nowFortaleza(),
      };
      // Classificação de elegibilidade: só escreve quando o chamador a informou
      // (o analisador). `undefined` preserva o que já está na planilha — o resync
      // já a regrava pelo append/update. ⚠️ "Motivo Reenvio" nunca entra (manual).
      if (p.classificacao !== undefined) {
        cells['Classificação'] = derivarClassificacaoSheet(p.classificacao, p.classificacaoJustificativa);
      }
      if (p.tipoProjeto !== undefined) {
        cells['Tipo de Projeto'] = tipoParaSheet(normalizarTipo(p.tipoProjeto));
      }
      if (p.motivoReprovacao !== undefined) {
        // Vazio/null → "—" (padronizarLinha): limpa o motivo quando o projeto deixa
        // de ser reprovado num reenvio.
        cells['Motivo Reprovado'] = p.motivoReprovacao ?? '';
      }
      // Colunas do líder: só quando o chamador SABE o estado da fila (D29). Ver o
      // comentário de `UpdateSyncParams` — `undefined` preserva a célula.
      if (p.aprovacaoLider !== undefined) {
        cells['Aprovação do Líder'] = p.aprovacaoLider ?? '';
      }
      if (p.justificativaAprovacaoLider !== undefined) {
        cells['Justificativa Aprovação do Líder'] = p.justificativaAprovacaoLider ?? '';
      }
      const celulasPadronizadas = padronizarLinha(cells);
      await updateRowByProjectId(p.projetoId, celulasPadronizadas);
      // Espelho: Complexidade/Observações/Classificação do analisador aparecem na triagem
      // sem esperar o cron. As colunas OMITIDAS (o `undefined` que preserva o parecer do
      // líder — D29) continuam de fora aqui, porque `espelharEscrita` ignora ausentes.
      await espelharEscrita(p.projetoId, celulasPadronizadas);
    } catch (sheetsErr) {
      console.error(`[google/sync] Falha ao update na planilha (${p.projectName}):`, sheetsErr);
    }

    // ⚠️ Este sync NÃO fala no Google Chat (11/08/2026) — e não pode voltar a falar.
    // Ele disparava o "🚨 Novo fluxo de automação cadastrado – Análise Pendente" logo
    // após a análise: era a MESMA notificação por submissão com outra roupa (a 2ª do
    // mesmo projeto), e mantê-la anularia a regra de o grupo só ser avisado quando o
    // líder pré-aprova. Ver `src/lib/notificacao-chat.ts` e a seção "Sync Google" do
    // CLAUDE.md. Com isso o `projectName` sobrou só para o log acima — mantido porque
    // é o que identifica o projeto quando a escrita falha.
  } catch (e) {
    console.error('[google/sync] Erro inesperado no syncUpdateToGoogle:', e);
  }
}
