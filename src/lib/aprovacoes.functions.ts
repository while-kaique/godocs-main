// Pré-aprovação do LÍDER (integração TeamGuide) — lógica de negócio (server-only).
//
// O liderado submete um projeto; o líder direto dele (derivado de `/teams` + membros
// na TeamGuide) recebe uma DM privada no Google Chat e aprova/reprova DENTRO do
// GoDocs. Ver spec-docs/SPEC_APROVACAO_LIDER.md (D1–D11).
//
// Decisões que moram aqui:
//  • D3 — NÃO bloqueia a triagem da RPA: a pré-aprovação roda em PARALELO. Nada
//    nesta função pode impedir/atrasar a submissão.
//  • D4 — pessoa em 2+ times: todos os líderes veem na fila, o PRIMEIRO que decidir
//    resolve para os demais.
//  • D6 — autor sem líder (topo da cadeia) → nenhuma fila, sem erro e sem DM.
//  • D10 — aprovação é por VERSÃO: reenvio reabre a fila (veredito volta a pendente).
//  • D11 — ISENÇÃO DE LIDERANÇA (decisão do Luis, 03/08/2026): quem JÁ É líder de um
//    time não precisa que o líder dele aprove o projeto dele. Só o liderado "de fato"
//    (quem não lidera ninguém) entra em fila. Ex.: o coordenador de RPA é isento; o
//    analista do time dele não é, e quem aprova é o coordenador — não o líder acima.

import { z } from 'zod';
import { ehLideranca, getLideresDe, getLideradosDe } from '@/lib/areas/teamguide.server';
import { resumirChecklist, type ChaveChecklist } from '@/lib/aprovacoes-checklist';
import { derivarNomeDeEmail } from '@/lib/auth.functions';
import { normalizarMarcadoresMemorial } from '@/lib/agents/memorial-format';
import { enviarDmChat } from '@/lib/google/chat-dm';
import { ehProjetoTesteE2E } from '@/lib/google/chat';
import { updateRowByProjectId } from '@/lib/google/sheets';
import { runBackground } from '@/lib/background';
import {
  abrirAprovacoesPendentes,
  decidirAprovacoesDoProjeto,
  getAprovacoesDoProjeto,
  getAprovacoesPendentesDe,
  getAprovacoesDeProjetos,
  getUltimaVersaoNum,
  getProjetoById,
  type AprovacaoRow,
} from '@/integrations/db/client.server';

export type Veredito = 'pendente' | 'aprovado' | 'reprovado';

// ─── Rótulos (Sheets + UI) ───────────────────────────────────────────────────

function dataBR(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const valida = !Number.isNaN(d.getTime()) ? d : new Date();
  return valida.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Rótulo da coluna "Aprovação do Líder" nos 3 casos SEM FILA. Função PURA.
 *
 * Decisão do Luis (03/08/2026): os 3 casos deixam de compartilhar o mesmo "—" — na
 * auditoria da planilha era impossível distinguir a isenção legítima de uma falha da
 * integração. A liderança sai como "Pré-aprovado (liderança)": ninguém decidiu nada
 * (o líder é o próprio autor), mas o efeito prático é que o projeto está liberado do
 * lado do líder. ⚠️ Isto NÃO toca a coluna `Status` (segue "Pendente" pela regra
 * temporária) e NÃO é parecer humano.
 */
export function rotuloIsencaoSheet(motivo: ResultadoAbertura['motivo']): string {
  switch (motivo) {
    case 'lideranca':
      return 'Pré-aprovado (liderança)';
    case 'sem_lider':
      return 'Sem líder na TeamGuide';
    case 'teamguide_indisponivel':
      return 'Aprovação indisponível (integração)';
    default:
      return '—';
  }
}

/**
 * Texto da coluna "Aprovação do Líder" do Sheets. Função PURA — é o único lugar que
 * redige esses rótulos (não redigitar em outro ponto).
 */
export function rotuloAprovacaoSheet(
  linhas: Pick<
    AprovacaoRow,
    | 'veredito'
    | 'aprovador_nome'
    | 'aprovador_email'
    | 'comentario'
    | 'decidido_por'
    | 'decidido_em'
    | 'resp_move_kpi'
    | 'resp_sente_falta'
    | 'resp_saving_coerente'
  >[],
): string {
  if (!linhas.length) return '—';
  const decidida = linhas.find((l) => l.veredito === 'aprovado' || l.veredito === 'reprovado');
  if (!decidida) {
    const nomes = linhas.map((l) => l.aprovador_nome || l.aprovador_email).join(', ');
    return `Pré-aprovação pendente com ${nomes}`;
  }
  // Quem decidiu pode ser outro líder da mesma fila (D4) — o `decidido_por` manda.
  const quem =
    linhas.find((l) => (l.decidido_por ?? '') === (l.aprovador_email ?? ''))?.aprovador_nome ||
    decidida.decidido_por ||
    decidida.aprovador_nome ||
    decidida.aprovador_email;
  // "Pré-aprovado"/"Ajuste pedido" (não "Aprovado"/"Reprovado"): o parecer do líder é
  // PRÉ-aprovação e nunca substitui a triagem da RPA — a planilha tem que dizer isso.
  const rotulo = decidida.veredito === 'aprovado' ? 'Pré-aprovado' : 'Ajuste pedido';
  const comentario = (decidida.comentario ?? '').trim();
  const checklist = resumirChecklist({
    move_kpi: decidida.resp_move_kpi,
    sente_falta: decidida.resp_sente_falta,
    saving_coerente: decidida.resp_saving_coerente,
  });
  return (
    `${rotulo} por ${quem} em ${dataBR(decidida.decidido_em)}` +
    (checklist ? ` — ${checklist}` : '') +
    (comentario ? ` — ${comentario}` : '')
  );
}

// ─── Abertura da fila (chamada na submissão) ─────────────────────────────────

export type ResultadoAbertura = {
  /** Nenhuma fila aberta porque o autor É liderança (D11) ou não tem líder (D6). */
  isento: boolean;
  motivo: 'lideranca' | 'sem_lider' | 'teamguide_indisponivel' | null;
  aprovadores: { email: string; nome: string | null }[];
  /** Texto pronto para a coluna "Aprovação do Líder". */
  rotuloSheet: string;
};

/**
 * Abre (ou reabre, no reenvio) a fila de pré-aprovação do projeto e dispara a DM.
 *
 * NUNCA lança: qualquer falha (TeamGuide fora, DM fora) devolve `isento` com motivo
 * e o projeto segue seu caminho normal — D3/D8. O chamador usa `rotuloSheet` para a
 * coluna do Sheets.
 */
export async function abrirPreAprovacao(
  projetoId: string,
  opts?: { versao?: number; nomeProjeto?: string | null },
): Promise<ResultadoAbertura> {
  const semFila = (motivo: ResultadoAbertura['motivo']): ResultadoAbertura => ({
    isento: true,
    motivo,
    aprovadores: [],
    rotuloSheet: rotuloIsencaoSheet(motivo),
  });

  try {
    const projeto = await getProjetoById(projetoId);
    if (!projeto) return semFila('sem_lider');
    const autor = (projeto.responsavel_email ?? '').trim().toLowerCase();
    if (!autor) return semFila('sem_lider');

    // D11 — liderança é isenta: não faz sentido o líder do líder aprovar.
    if (await ehLideranca(autor)) {
      console.log(`[aprovacoes] ${autor} é liderança na TeamGuide → isento de pré-aprovação.`);
      return semFila('lideranca');
    }

    // Só líderes COM e-mail cadastrado podem receber a fila (sem e-mail não há login).
    const lideres = (await getLideresDe(autor)).filter((l) => !!l.email);
    if (!lideres.length) {
      console.log(`[aprovacoes] ${autor} sem líder na TeamGuide → sem fila de aprovação (D6).`);
      return semFila('sem_lider');
    }

    const aprovadores = lideres.map((l) => ({ email: l.email!.toLowerCase(), nome: l.nome || null }));
    const versao = opts?.versao ?? (await getUltimaVersaoNum(projetoId));
    await abrirAprovacoesPendentes(projetoId, versao, autor, aprovadores);

    const rotuloSheet = rotuloAprovacaoSheet(
      aprovadores.map((a) => ({
        veredito: 'pendente',
        aprovador_nome: a.nome,
        aprovador_email: a.email,
        comentario: null,
        decidido_por: null,
        decidido_em: null,
        resp_move_kpi: null,
        resp_sente_falta: null,
        resp_saving_coerente: null,
      })),
    );

    // DM em background, best-effort (mudo p/ projetos de teste E2E, como o Chat atual).
    const nome = opts?.nomeProjeto ?? projeto.nome ?? 'Projeto sem nome';
    if (!ehProjetoTesteE2E(nome)) {
      runBackground(
        Promise.all(
          aprovadores.map((a) =>
            enviarDmChat(a.email, mensagemDmAprovacao(nome, projeto.responsavel_nome ?? autor)),
          ),
        ).then(() => undefined),
      );
    }

    return { isento: false, motivo: null, aprovadores, rotuloSheet };
  } catch (e) {
    console.error('[aprovacoes] falha ao abrir a pré-aprovação (não-fatal):', e);
    return semFila('teamguide_indisponivel');
  }
}

/** Texto da DM (1 parágrafo + link da fila). Pura. */
export function mensagemDmAprovacao(nomeProjeto: string, autor: string): string {
  const base = (process.env.APP_BASE_URL ?? 'https://godocs.devgogroup.com').replace(/\/$/, '');
  return (
    `*${autor}* submeteu o projeto *${nomeProjeto}* no GoDocs e a sua pré-aprovação está pendente. ` +
    `São 3 perguntas rápidas de sim/não e o parecer — o card já vem com dono, participantes, ` +
    `os números do ganho e o memorial.\n` +
    `${base}/aprovacoes`
  );
}

// ─── Fila do líder ───────────────────────────────────────────────────────────

export type ParticipanteAprovacao = { nome: string; email: string; papel: string };

export type ItemAprovacao = {
  projeto_id: string;
  projeto_nome: string | null;
  autor_nome: string | null;
  autor_email: string | null;
  area: string | null;
  submitted_at: string | null;
  tipos_projeto: string[];
  especial: boolean;
  criado_em: string | null;
  /** O que o projeto faz, em uma linha (vem do formulário). */
  descricao_breve: string | null;
  /** Participantes com o papel de cada um (o autor NÃO entra — ele é o dono). */
  participantes: ParticipanteAprovacao[];
  /** Números do ganho, para a 3ª pergunta do checklist. Ver `extrairNumeros`. */
  saving_horas: number | null;
  saving_reais: number | null;
  tipo_saving: string | null;
  ganho_total: number | null;
  custo_evitado_reais: number | null;
  custo_externo_mensal: number | null;
  receita_mensal: number | null;
  /** Memorial financeiro pronto para leitura (títulos legíveis, sem marcadores [x.y]). */
  memorial: string | null;
  /** Resumo do projeto escrito pelo analisador (IA) — contexto rápido para o líder. */
  resumo_ia: string | null;
};

/** Rótulo do papel do participante (mesmos 3 papéis da Etapa 1). */
const PAPEL_LABEL: Record<string, string> = {
  coexecutor: 'Coautor',
  planejador: 'Participante',
  contribuidor: 'Contribuidor',
  // Papéis LEGADO de uma feature anterior — a Etapa 1 já não os oferece.
  idealizador: 'Contribuidor',
  referencia_tecnica: 'Contribuidor',
};

/**
 * Monta a lista de participantes do card (nome legível + papel), a partir da lista plana
 * `membros` e do mapa `membros_papeis`. Pura, exportada para teste. Sem papel gravado
 * (projeto legado) o participante entra como "Coautor", igual ao sync do Sheets.
 */
export function montarParticipantes(
  membrosJson: string | null,
  papeisJson: string | null,
  autorEmail: string | null,
): ParticipanteAprovacao[] {
  const lista = parseJson<string[]>(membrosJson, []);
  const papeis = parseJson<Record<string, string>>(papeisJson, {});
  const autor = (autorEmail ?? '').trim().toLowerCase();
  const vistos = new Set<string>();
  const out: ParticipanteAprovacao[] = [];
  for (const bruto of lista) {
    const email = String(bruto ?? '').trim().toLowerCase();
    if (!email || email === autor || vistos.has(email)) continue;
    vistos.add(email);
    out.push({
      nome: derivarNomeDeEmail(email),
      email,
      papel: PAPEL_LABEL[papeis[email] ?? ''] ?? 'Coautor',
    });
  }
  return out;
}

/**
 * Números do card, nas MESMAS fontes que o sync do Sheets usa (para o líder não ver um
 * número diferente do que a planilha mostra). Pura, exportada para teste.
 *
 * • custo evitado e receita vivem no JSON da `documentacao` (`saving`/`receita`) — não há
 *   coluna própria em `projetos`; o custo evitado cai para a SOMA dos itens do formulário
 *   quando o JSON da doc não tem o valor.
 * • custo externo é o custo INCORRIDO (subtrai do ganho), ≠ custo evitado (que soma).
 */
export function extrairNumeros(row: {
  custo_evitado_itens: string | null;
  doc_conteudo: string | null;
}): { custo_evitado_reais: number | null; receita_mensal: number | null } {
  const doc = parseJson<{
    saving?: { custo_evitado_reais?: unknown };
    receita?: { valor_ganho_mensal?: unknown };
  }>(row.doc_conteudo, {});
  const doDoc = Number(doc.saving?.custo_evitado_reais) || 0;
  const itens = parseJson<{ valor?: unknown }[]>(row.custo_evitado_itens, []);
  const somaItens = Array.isArray(itens)
    ? itens.reduce((s, i) => s + (Number(i?.valor) || 0), 0)
    : 0;
  const evitado = doDoc > 0 ? doDoc : somaItens;
  const receita = Number(doc.receita?.valor_ganho_mensal) || 0;
  return {
    custo_evitado_reais: evitado > 0 ? evitado : null,
    receita_mensal: receita > 0 ? receita : null,
  };
}

function parseJson<T>(texto: string | null | undefined, padrao: T): T {
  if (!texto) return padrao;
  try {
    return (JSON.parse(texto) as T) ?? padrao;
  } catch {
    return padrao;
  }
}

/**
 * Fila de pré-aprovação de quem está logado. `lidera` diz se a pessoa lidera alguém
 * na TeamGuide — é o gate de exibição da aba/atalho no frontend (quem não lidera
 * ninguém nunca vê a tela). Falha da TeamGuide não quebra a fila: `lidera` cai para
 * "tem pendência?" (o dado do banco basta para o líder trabalhar).
 */
export async function listarAprovacoesPendentes(
  email: string,
): Promise<{ lidera: boolean; itens: ItemAprovacao[] }> {
  const alvo = (email ?? '').trim().toLowerCase();
  const rows = await getAprovacoesPendentesDe(alvo);
  const itens: ItemAprovacao[] = rows.map((r) => ({
    projeto_id: r.projeto_id,
    projeto_nome: r.projeto_nome,
    autor_nome: r.autor_nome,
    autor_email: r.autor_email,
    area: r.area,
    submitted_at: r.submitted_at,
    tipos_projeto: parseJson<string[]>(r.tipos_projeto, []),
    especial: r.especial === 1,
    criado_em: r.criado_em,
    // Projeto especial não tem memorial financeiro — o contexto ocupa esse lugar.
    descricao_breve: r.descricao_breve?.trim() || r.contexto_especial?.trim() || null,
    participantes: montarParticipantes(r.membros, r.membros_papeis, r.autor_email),
    saving_horas: r.saving_horas ?? null,
    saving_reais: r.saving_reais ?? null,
    tipo_saving: r.tipo_saving ?? null,
    ganho_total: r.ganho_total_mensal ?? null,
    custo_externo_mensal: r.custo_externo_mensal ?? null,
    resumo_ia: r.resumo_ia?.trim() || null,
    ...extrairNumeros(r),
    memorial: r.memorial_calculo?.trim()
      ? normalizarMarcadoresMemorial(r.memorial_calculo)
      : null,
  }));

  let lidera = itens.length > 0;
  try {
    lidera = lidera || (await getLideradosDe(alvo)).length > 0;
  } catch (e) {
    console.error('[aprovacoes] TeamGuide indisponível ao checar liderança:', e);
  }
  return { lidera, itens };
}

// ─── Decisão ─────────────────────────────────────────────────────────────────

const simNao = z.enum(['sim', 'nao']);

const decidirSchema = z.object({
  projeto_id: z.string().min(1),
  veredito: z.enum(['aprovado', 'reprovado']),
  comentario: z.string().trim().max(2000).optional().nullable(),
  // Checklist do gestor — OBRIGATÓRIO nos dois vereditos (pedido do Lucas, 03/08/2026).
  // É o que transforma o parecer em informação para a triagem, então o servidor cobra:
  // o frontend só bloqueia o botão, quem garante é aqui.
  respostas: z.object({
    move_kpi: simNao,
    sente_falta: simNao,
    saving_coerente: simNao,
  }),
});

/**
 * Grava a decisão do líder. GATE SERVER-SIDE: só grava se existir uma linha
 * PENDENTE para (projeto, este e-mail) — a linha foi criada a partir da TeamGuide na
 * submissão, então ela É a prova de que quem decide lidera o autor. O frontend nunca
 * é fonte de autorização.
 *
 * Reprovar exige comentário (o autor precisa saber o que ajustar).
 */
export async function decidirAprovacao(
  email: string,
  body: unknown,
  opts?: { atorReal?: string | null },
): Promise<{ ok: true; veredito: Veredito }> {
  const alvo = (email ?? '').trim().toLowerCase();
  const parsed = decidirSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const doChecklist = issue?.path?.[0] === 'respostas';
    throw Object.assign(
      new Error(
        doChecklist
          ? 'Responda as 3 perguntas do checklist antes de registrar o parecer.'
          : (issue?.message ?? 'Dados inválidos.'),
      ),
      { status: 400 },
    );
  }
  const { projeto_id, veredito, respostas } = parsed.data;
  const comentario = (parsed.data.comentario ?? '').trim() || null;

  if (veredito === 'reprovado' && !comentario) {
    throw Object.assign(
      new Error('Para pedir ajuste, escreva o que precisa mudar — o autor recebe esse texto.'),
      { status: 400 },
    );
  }

  const linhas = await getAprovacoesDoProjeto(projeto_id);
  const minha = linhas.find(
    (l) => (l.aprovador_email ?? '').toLowerCase() === alvo && l.veredito === 'pendente',
  );
  if (!minha) {
    throw Object.assign(
      new Error('Você não tem uma pré-aprovação pendente para este projeto.'),
      { status: 403 },
    );
  }

  // `decidido_por` guarda quem CLICOU. Na pré-visualização de admin (validação da tela)
  // o clique é do admin, não do líder — a auditoria registra o admin, nunca finge que o
  // líder decidiu.
  const quemDecidiu = (opts?.atorReal ?? '').trim().toLowerCase() || alvo;
  await decidirAprovacoesDoProjeto(projeto_id, veredito, comentario, quemDecidiu, respostas);

  // Reflete na planilha (best-effort — a fonte de verdade é o SQLite).
  const atualizadas = await getAprovacoesDoProjeto(projeto_id);
  const rotulo = rotuloAprovacaoSheet(atualizadas);
  runBackground(
    updateRowByProjectId(projeto_id, { 'Aprovação do Líder': rotulo })
      .then(() => undefined)
      .catch((e) => console.error('[aprovacoes] falha ao gravar no Sheets (não-fatal):', e)),
  );

  return { ok: true, veredito };
}

// ─── Visão do autor (cards de "Meus Projetos" / tela read-only) ──────────────

export type ResumoAprovacao = {
  veredito: Veredito;
  aprovadores: string[];
  decidido_por: string | null;
  comentario: string | null;
  decidido_em: string | null;
};

/** Resumo por projeto (1 entrada por id que tem fila). Não chama a TeamGuide. */
export async function resumoAprovacaoPorProjeto(
  ids: string[],
): Promise<Record<string, ResumoAprovacao>> {
  const rows = await getAprovacoesDeProjetos(ids);
  const out: Record<string, ResumoAprovacao> = {};
  for (const r of rows) {
    const atual = out[r.projeto_id];
    const nome = r.aprovador_nome || r.aprovador_email;
    if (!atual) {
      out[r.projeto_id] = {
        veredito: (r.veredito as Veredito) ?? 'pendente',
        aprovadores: [nome],
        decidido_por: r.decidido_por,
        comentario: r.comentario,
        decidido_em: r.decidido_em,
      };
      continue;
    }
    atual.aprovadores.push(nome);
    // Uma linha decidida manda no resumo (D4 — a decisão vale para a fila toda).
    if (r.veredito !== 'pendente') {
      atual.veredito = r.veredito as Veredito;
      atual.decidido_por = r.decidido_por;
      atual.comentario = r.comentario;
      atual.decidido_em = r.decidido_em;
    }
  }
  return out;
}
