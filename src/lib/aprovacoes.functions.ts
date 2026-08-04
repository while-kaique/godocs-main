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
import {
  AVISO_SAVING_INCOERENTE,
  bloqueiaPreAprovacao,
  chavesQueExigemJustificativa,
  resumirChecklist,
  type ChaveChecklist,
} from '@/lib/aprovacoes-checklist';
import { derivarNomeDeEmail } from '@/lib/auth.functions';
import {
  extrairResumoMemorial,
  normalizarMarcadoresMemorial,
} from '@/lib/agents/memorial-format';
import { enviarDmChat } from '@/lib/google/chat-dm';
import { ehProjetoTesteE2E } from '@/lib/google/chat';
import { updateRowByProjectId } from '@/lib/google/sheets';
import { runBackground } from '@/lib/background';
import {
  abrirAprovacoesPendentes,
  decidirAprovacoesDoProjeto,
  getAprovacoesDoProjeto,
  getAprovacoesPendentesDe,
  contarAprovacoesPendentesDe,
  getAprovacoesDeProjetos,
  getUltimaVersaoNum,
  getProjetoById,
  getProjetosByOwnerEmail,
  type AprovacaoRow,
} from '@/integrations/db/client.server';

// 3 desfechos (decisão do Lucas, 04/08/2026): 'ajuste' devolve ao autor para corrigir,
// 'reprovado' é recusa. Antes os dois eram 'reprovado' — linhas ANTIGAS com 'reprovado'
// nasceram como "ajuste pedido" e seguem lidas como recusa (nada a migrar: são poucas e
// só na staging).
export type Veredito = 'pendente' | 'aprovado' | 'ajuste' | 'reprovado';

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
  // Liderança é o único caso sem fila que tem ESTADO: do lado do líder está liberado.
  // Os outros 2 não têm parecer nenhum — o porquê vai na justificativa.
  return motivo === 'lideranca' ? 'Pré-aprovado' : '—';
}

/**
 * Texto da coluna "Justificativa Aprovação do Líder" nos 3 casos SEM FILA. Função PURA.
 * É aqui que a auditoria distingue a isenção legítima de uma falha de integração (D12) —
 * antes isso morava no rótulo de estado e poluía o filtro da planilha.
 */
export function justificativaIsencaoSheet(motivo: ResultadoAbertura['motivo']): string {
  switch (motivo) {
    case 'lideranca':
      return 'Autor é liderança na TeamGuide, isento de pré-aprovação (ninguém decidiu)';
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
export function rotuloAprovacaoSheet(linhas: Pick<AprovacaoRow, 'veredito'>[]): string {
  if (!linhas.length) return '—';
  const decidida = linhas.find((l) => l.veredito !== 'pendente');
  if (!decidida) return 'Pré-pendente';
  if (decidida.veredito === 'aprovado') return 'Pré-aprovado';
  return decidida.veredito === 'ajuste' ? 'Ajuste pedido' : 'Pré-reprovado';
}

/**
 * Texto da coluna "Justificativa Aprovação do Líder": quem decidiu, quando, as 3
 * respostas do checklist e o comentário. Função PURA — único lugar que redige isso.
 *
 * Decisão do Luis (03/08/2026): a coluna de estado guarda SÓ o estado (para filtrar na
 * planilha) e todo o detalhe vive aqui.
 */
export function justificativaAprovacaoSheet(
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
  const decidida = linhas.find((l) => l.veredito !== 'pendente');
  if (!decidida) {
    const nomes = linhas.map((l) => l.aprovador_nome || l.aprovador_email).join(', ');
    return `Aguardando ${nomes}`;
  }
  // Quem decidiu pode ser outro líder da mesma fila (D4) — o `decidido_por` manda.
  const quem =
    linhas.find((l) => (l.decidido_por ?? '') === (l.aprovador_email ?? ''))?.aprovador_nome ||
    decidida.decidido_por ||
    decidida.aprovador_nome ||
    decidida.aprovador_email;
  const checklist = resumirChecklist({
    move_kpi: decidida.resp_move_kpi,
    sente_falta: decidida.resp_sente_falta,
    saving_coerente: decidida.resp_saving_coerente,
  });
  const comentario = (decidida.comentario ?? '').trim();
  return (
    `${quem} em ${dataBR(decidida.decidido_em)}` +
    (checklist ? ` · ${checklist}` : '') +
    (comentario ? ` · ${comentario}` : '')
  );
}

// ─── Abertura da fila (chamada na submissão) ─────────────────────────────────

export type ResultadoAbertura = {
  /** Nenhuma fila aberta porque o autor É liderança (D11) ou não tem líder (D6). */
  isento: boolean;
  motivo: 'lideranca' | 'sem_lider' | 'teamguide_indisponivel' | null;
  aprovadores: { email: string; nome: string | null }[];
  /** Estado pronto para a coluna "Aprovação do Líder". */
  rotuloSheet: string;
  /** Detalhe pronto para a coluna "Justificativa Aprovação do Líder". */
  justificativaSheet: string;
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
    justificativaSheet: justificativaIsencaoSheet(motivo),
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

    const pendentes = aprovadores.map((a) => ({
      veredito: 'pendente' as const,
      aprovador_nome: a.nome,
      aprovador_email: a.email,
      comentario: null,
      decidido_por: null,
      decidido_em: null,
      resp_move_kpi: null,
      resp_sente_falta: null,
      resp_saving_coerente: null,
    }));
    const rotuloSheet = rotuloAprovacaoSheet(pendentes);
    const justificativaSheet = justificativaAprovacaoSheet(pendentes);

    // DM em background, best-effort (mudo p/ projetos de teste E2E, como o Chat atual).
    const nome = opts?.nomeProjeto ?? projeto.nome ?? 'Projeto sem nome';
    if (!ehProjetoTesteE2E(nome)) {
      // Tamanho da fila de cada líder (já inclui este projeto — as linhas foram
      // abertas acima). Resolvido ANTES do `runBackground` para o disparo da DM ser
      // síncrono: um `await` antes do `enviarDmChat` deixaria a promise pendurada num
      // caminho fire-and-forget. Contagem é 1 COUNT local; falha → linha omitida.
      const filaPorLider = new Map<string, number | null>();
      for (const a of aprovadores) {
        filaPorLider.set(a.email, await contarAprovacoesPendentesDe(a.email).catch(() => null));
      }
      runBackground(
        Promise.all(
          aprovadores.map((a) =>
            enviarDmChat(
              a.email,
              corpoDmAprovacao({
                nomeProjeto: nome,
                autor: projeto.responsavel_nome ?? autor,
                area: projeto.area ?? null,
                naFila: filaPorLider.get(a.email) ?? null,
              }),
            ),
          ),
        ).then(() => undefined),
      );
    }

    return { isento: false, motivo: null, aprovadores, rotuloSheet, justificativaSheet };
  } catch (e) {
    console.error('[aprovacoes] falha ao abrir a pré-aprovação (não-fatal):', e);
    return semFila('teamguide_indisponivel');
  }
}

/** URL da fila, sem barra dupla. */
function urlDaFila(): string {
  return `${(process.env.APP_BASE_URL ?? 'https://godocs.devgogroup.com').replace(/\/$/, '')}/aprovacoes`;
}

/**
 * Texto puro da DM — é o FALLBACK do cartão (notificação do celular, cliente que não
 * renderiza `cardsV2`) e o que aparece na prévia da conversa. Pura.
 *
 * Enxuto de propósito: quem decide é a tela (D1/D2 — a DM é o carteiro). A mensagem
 * responde "de quem é, o que é, onde clico" e para aí; explicar a mecânica das 3
 * perguntas aqui só roubava a linha de quem lê no celular.
 */
export function mensagemDmAprovacao(nomeProjeto: string, autor: string): string {
  return `Pré-aprovação pendente · ${nomeProjeto} — de ${autor}\n${urlDaFila()}`;
}

/**
 * Corpo da DM como CARTÃO do Chat (`cardsV2`), com o texto acima como fallback.
 *
 * Refatorado a pedido do Luis (04/08/2026): antes era um parágrafo corrido com o link
 * cru na última linha — sem título, sem botão e sem dizer NADA do projeto além do nome.
 * O cartão dá hierarquia (título → o que é → ação) e cabe numa olhada no celular.
 *
 * Regras que valem a pena manter:
 *  - **Nada de R$ aqui.** O ganho vive na tela, atrás do login. A DM pode ser lida por
 *    cima do ombro de alguém e o número de saving é staff-only (mesma régua do
 *    `ocultarReaisSaving`); o cartão diz o que é e chama para a tela.
 *  - **Linhas condicionais:** área/fila só entram quando existem — linha "—" em cartão
 *    de Chat parece erro de sistema.
 *  - **Botão + link no fallback:** o botão só existe no cartão; sem a URL no `text`,
 *    quem lê a notificação do celular fica sem caminho.
 */
export function corpoDmAprovacao(opts: {
  nomeProjeto: string;
  autor: string;
  area?: string | null;
  /** Quantos projetos ficam esperando esta pessoa (inclui este). */
  naFila?: number | null;
}): Record<string, unknown> {
  const url = urlDaFila();
  const linhas: Record<string, unknown>[] = [
    {
      decoratedText: {
        topLabel: 'Quem submeteu',
        text: opts.autor,
        startIcon: { knownIcon: 'PERSON' },
      },
    },
  ];
  if (opts.area?.trim()) {
    linhas.push({
      decoratedText: {
        topLabel: 'Área',
        text: opts.area.trim(),
        startIcon: { knownIcon: 'MEMBERSHIP' },
      },
    });
  }
  if (opts.naFila && opts.naFila > 1) {
    linhas.push({
      decoratedText: {
        topLabel: 'Sua fila',
        text: `${opts.naFila} projetos esperando você`,
        startIcon: { knownIcon: 'CLOCK' },
      },
    });
  }

  return {
    text: mensagemDmAprovacao(opts.nomeProjeto, opts.autor),
    cardsV2: [
      {
        cardId: 'pre-aprovacao',
        card: {
          header: {
            title: 'Pré-aprovação pendente',
            subtitle: opts.nomeProjeto,
            imageUrl: 'https://godocs.devgogroup.com/favicon.svg',
            imageType: 'CIRCLE',
          },
          sections: [
            { widgets: linhas },
            {
              widgets: [
                {
                  textParagraph: {
                    text: 'São 3 perguntas de sim/não e o seu parecer. A equipe RPA valida em paralelo — nada fica parado esperando você.',
                  },
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'Abrir a fila',
                        onClick: { openLink: { url } },
                        color: { red: 0, green: 0.349, blue: 0.663, alpha: 1 },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

// ─── RECUPERAÇÃO: reabrir a fila de projetos já submetidos (admin) ───────────
//
// A fila mora em `projeto_aprovacoes`, tabela INTERNA: o Sheets é só espelho do
// veredito e o sync reverso nunca a escreve. Como `projeto_aprovacoes.projeto_id`
// é `REFERENCES projetos(id) ON DELETE CASCADE`, qualquer coisa que apague o
// projeto apaga a fila junto — e o caminho MAIS FÁCIL de fazer isso sem querer é
// a `reconciliarExclusoes`: sumiu da planilha (ex.: alguém sobrescreveu a aba
// STAGING com uma cópia de prod), passou a carência de 1h, o projeto é removido
// em cascata. Restaurar a aba recria o PROJETO (como legado), mas NUNCA a fila:
// quem abre fila é o `abrirPreAprovacao`, chamado só no fim do
// `submeterParaValidacao`. Sem isto, a única forma de recuperar era reenviar cada
// projeto pelo formulário. (Aconteceu de verdade em 04/08/2026, na staging.)
//
// ⚠️ FAIL-CLOSED de propósito: exige `projetoIds` OU `autorEmail` — não existe
// "reabre tudo". E NUNCA sobrescreve parecer já dado: projeto que já tem linha
// (pendente ou decidida) é ignorado, salvo `forcar: true` — porque
// `abrirAprovacoesPendentes` DELETA as linhas do projeto antes de inserir, e um
// "reabrir" cego apagaria o veredito que o líder já deu.
const reabrirSchema = z
  .object({
    projetoIds: z.array(z.string().min(1)).optional(),
    autorEmail: z.string().min(1).optional(),
    limite: z.number().int().positive().max(50).optional(),
    forcar: z.boolean().optional(),
    dry: z.boolean().optional(),
  })
  .refine((v) => (v.projetoIds?.length ?? 0) > 0 || !!v.autorEmail, {
    message: 'Informe projetoIds ou autorEmail — não existe reabrir tudo.',
  });

export type ResultadoReabertura = {
  ok: true;
  dry: boolean;
  reabertos: { projeto_id: string; nome: string | null; aprovadores: string[] }[];
  isentos: { projeto_id: string; nome: string | null; motivo: string }[];
  ignorados: { projeto_id: string; nome: string | null; motivo: string }[];
};

export async function reabrirPreAprovacoes(body: unknown): Promise<ResultadoReabertura> {
  const { projetoIds, autorEmail, limite, forcar, dry } = reabrirSchema.parse(body);
  const seco = dry !== false; // ⚠️ dry é o DEFAULT: escrever exige `dry:false` explícito.

  const out: ResultadoReabertura = { ok: true, dry: seco, reabertos: [], isentos: [], ignorados: [] };

  // Alvos: lista explícita OU os projetos submetidos de um autor (mais recentes primeiro).
  let ids = projetoIds ?? [];
  if (!ids.length && autorEmail) {
    const alvo = autorEmail.trim().toLowerCase();
    const doAutor = (await getProjetosByOwnerEmail(alvo)).filter(
      (p) =>
        (p.responsavel_email ?? '').trim().toLowerCase() === alvo &&
        (p.status ?? '') !== 'rascunho' &&
        Number(p.descontinuado ?? 0) !== 1,
    );
    ids = doAutor.slice(0, limite ?? 10).map((p) => p.id);
  }

  for (const id of ids) {
    const projeto = await getProjetoById(id);
    if (!projeto) {
      out.ignorados.push({ projeto_id: id, nome: null, motivo: 'projeto não existe no SQLite' });
      continue;
    }
    const nome = projeto.nome ?? null;
    if ((projeto.status ?? '') === 'rascunho') {
      out.ignorados.push({ projeto_id: id, nome, motivo: 'rascunho (nunca entra em fila)' });
      continue;
    }
    if (!forcar) {
      const jaTem = await getAprovacoesDoProjeto(id);
      if (jaTem.length) {
        out.ignorados.push({
          projeto_id: id,
          nome,
          motivo: `já tem fila (${jaTem.map((a) => a.veredito).join(', ')}) — use forcar:true para recriar`,
        });
        continue;
      }
    }

    if (seco) {
      // Sem escrever: só diz quem SERIA o aprovador (mesma régua do abrirPreAprovacao).
      const autor = (projeto.responsavel_email ?? '').trim().toLowerCase();
      if (!autor) {
        out.isentos.push({ projeto_id: id, nome, motivo: 'sem_lider' });
      } else if (await ehLideranca(autor)) {
        out.isentos.push({ projeto_id: id, nome, motivo: 'lideranca' });
      } else {
        const lideres = (await getLideresDe(autor)).filter((l) => !!l.email);
        if (!lideres.length) out.isentos.push({ projeto_id: id, nome, motivo: 'sem_lider' });
        else
          out.reabertos.push({
            projeto_id: id,
            nome,
            aprovadores: lideres.map((l) => l.email!.toLowerCase()),
          });
      }
      continue;
    }

    const r = await abrirPreAprovacao(id, { nomeProjeto: nome });
    if (r.isento) {
      out.isentos.push({ projeto_id: id, nome, motivo: r.motivo ?? 'isento' });
    } else {
      out.reabertos.push({ projeto_id: id, nome, aprovadores: r.aprovadores.map((a) => a.email) });
    }
    // Espelha o estado no Sheets, como o submit faz (best-effort — a fonte é o SQLite).
    runBackground(
      updateRowByProjectId(id, {
        'Aprovação do Líder': r.rotuloSheet,
        'Justificativa Aprovação do Líder': r.justificativaSheet,
      })
        .then(() => undefined)
        .catch((e) => console.error('[aprovacoes/reabrir] falha ao gravar no Sheets:', e)),
    );
  }

  console.log(
    `[aprovacoes/reabrir] dry=${seco} reabertos=${out.reabertos.length} isentos=${out.isentos.length} ignorados=${out.ignorados.length}`,
  );
  return out;
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
  /** Resumo do projeto: a seção [1.2] do memorial (preferida) ou, na falta, o da análise. */
  resumo: string | null;
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
  const itens: ItemAprovacao[] = rows.map((r) => {
    const memorial = r.memorial_calculo?.trim()
      ? normalizarMarcadoresMemorial(r.memorial_calculo)
      : null;
    return {
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
    // O resumo do MEMORIAL ([1.2]) é mais abrangente que o da análise automática — o
    // líder lê aquele; a análise entra só quando o memorial não tem a seção (projeto
    // especial, legado antigo sem o ponto [1.2]).
    resumo: extrairResumoMemorial(memorial) ?? (r.resumo_ia?.trim() || null),
    ...extrairNumeros(r),
    memorial,
    };
  });

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
  veredito: z.enum(['aprovado', 'ajuste', 'reprovado']),
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

  if (veredito !== 'aprovado' && !comentario) {
    throw Object.assign(
      new Error(
        veredito === 'ajuste'
          ? 'Para pedir ajuste, escreva o que precisa mudar — o autor recebe esse texto.'
          : 'Para reprovar, escreva o motivo — o autor recebe esse texto.',
      ),
      { status: 400 },
    );
  }

  // Saving incoerente NÃO se justifica, se corrige (Lucas, 04/08/2026): número errado
  // volta para o autor. A tela já esconde o "Pré-aprovar"; aqui é a garantia.
  if (veredito === 'aprovado' && bloqueiaPreAprovacao(respostas)) {
    throw Object.assign(new Error(AVISO_SAVING_INCOERENTE), { status: 400 });
  }

  // Pré-aprovar COM um "não" no checklist exige a explicação (04/08/2026): a contradição
  // "não move KPI / o saving não é coerente, mas pré-aprovo" é justamente o que a triagem
  // precisa entender. Mesma régua da tela (`exigeJustificativa`), cobrada aqui.
  if (veredito === 'aprovado' && chavesQueExigemJustificativa(respostas).length > 0 && !comentario) {
    throw Object.assign(
      new Error(
        'Você respondeu "não" em alguma pergunta. Explique por que ainda assim pré-aprova — a explicação vai junto para a triagem da RPA.',
      ),
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
  runBackground(
    updateRowByProjectId(projeto_id, {
      'Aprovação do Líder': rotuloAprovacaoSheet(atualizadas),
      'Justificativa Aprovação do Líder': justificativaAprovacaoSheet(atualizadas),
    })
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
