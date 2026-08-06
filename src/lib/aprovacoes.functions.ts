// Pré-aprovação do LÍDER (integração TeamGuide) — lógica de negócio (server-only).
//
// O liderado submete um projeto; o líder direto dele (derivado de `/teams` + membros
// na TeamGuide) aprova/reprova DENTRO do GoDocs. Ver spec-docs/SPEC_APROVACAO_LIDER.md.
//
// ⚠️ NOTIFICAR o líder NÃO é mais responsabilidade daqui (D17, 05/08/2026): o GoDocs
// não fala com a API do Google Chat. Um cron diário manda a RELAÇÃO líder↔liderados
// pendentes para o Gomoon, que enfileira, monta a mensagem e entrega a DM pelo bot
// dele. Contrato em docs/integracao-gomoon-chat.md. Este arquivo só ABRE a fila.
//
// Decisões que moram aqui:
//  • D3 — NÃO bloqueia a triagem da RPA: a pré-aprovação roda em PARALELO. Nada
//    nesta função pode impedir/atrasar a submissão.
//  • D4 — pessoa em 2+ times: todos os líderes veem na fila, o PRIMEIRO que decidir
//    resolve para os demais.
//  • D6 — autor sem líder (topo da cadeia) → nenhuma fila, sem erro e sem aviso.
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
  detalharChecklist,
  rotuloChecklist,
  type ChaveChecklist,
} from '@/lib/aprovacoes-checklist';
import { derivarNomeDeEmail } from '@/lib/auth.functions';
import {
  extrairResumoMemorial,
  normalizarMarcadoresMemorial,
} from '@/lib/agents/memorial-format';
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
      // D20 (05/08/2026): a isenção é pelo CARGO (coordenador para cima), não por
      // aparecer como líder de um time — o texto diz qual dos dois, senão a triagem
      // lê "liderança" achando que a pessoa tem equipe.
      return 'Autor tem cargo de liderança na TeamGuide (coordenador ou acima), isento de pré-aprovação (ninguém decidiu)';
    case 'sem_lider':
      return 'Sem líder na TeamGuide';
    case 'teamguide_indisponivel':
      return 'Aprovação indisponível (integração)';
    // D27 (06/08/2026): projeto ESPECIAL não é pendência do líder. Ele não tem
    // memorial financeiro, então a 3ª pergunta do checklist ("o saving faz sentido?")
    // não teria o que julgar — e o destino dele sempre foi a validação humana da RPA.
    case 'especial':
      return 'Projeto especial — sem pré-aprovação do líder (vai direto à validação da RPA)';
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
 * Rótulo do texto livre do líder, conforme o que ele escreveu É. Função pura.
 *
 * O campo é UM só (`comentario`), mas serve a 3 propósitos diferentes — sem dizer qual,
 * a triagem recebia um texto solto sem saber se era pedido de ajuste, motivo de recusa
 * ou a explicação de um "não" no checklist (e, com 2 "nãos", nem a qual pergunta ele
 * responde).
 */
export function rotuloComentarioSheet(
  veredito: string,
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): string {
  if (veredito === 'ajuste') return 'O que precisa ser ajustado';
  if (veredito === 'reprovado') return 'Motivo da reprovação';
  const chaves = chavesQueExigemJustificativa(respostas);
  if (chaves.length) {
    const nomes = chaves.map(rotuloChecklist).filter(Boolean).join(' e ');
    return `Justificativa do "não" em ${nomes}`;
  }
  return 'Comentário do líder';
}

/**
 * Texto da coluna "Justificativa Aprovação do Líder": o parecer INTEIRO, em linhas —
 * quem decidiu (nome + e-mail), quando, cada PERGUNTA do checklist com o que o líder
 * respondeu e o texto que ele escreveu, rotulado pelo que ele é. Função PURA — único
 * lugar que redige isso.
 *
 * Decisões:
 *  • 03/08/2026 (Luis) — a coluna de estado guarda SÓ o estado (para filtrar na
 *    planilha) e todo o detalhe vive aqui.
 *  • 05/08/2026 (Luis) — "a justificativa tem que salvar TUDO que vier do usuário, as
 *    respostas (sim, não) e as justificativas, de forma devida". Saiu o resumo de uma
 *    linha em códigos ("Move KPI: sim · …") e entraram as perguntas escritas por
 *    extenso, uma por linha, mais o texto livre rotulado. ⚠️ Os textos das perguntas
 *    vêm da FONTE ÚNICA `aprovacoes-checklist.ts` — não redigitar aqui.
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
  // Quem decidiu pode ser outro líder da mesma fila (D4) — o `decidido_por` manda. Na
  // pré-visualização de admin (`?como=`) o e-mail não é de nenhum líder da fila: cai no
  // nome derivado do e-mail, e o e-mail fica registrado do lado (é a auditoria).
  const email = (decidida.decidido_por || decidida.aprovador_email || '').trim();
  const nome =
    linhas.find((l) => (l.aprovador_email ?? '').toLowerCase() === email.toLowerCase())
      ?.aprovador_nome ||
    decidida.aprovador_nome ||
    (email ? derivarNomeDeEmail(email) : '');
  const assinatura = [nome, email && nome !== email ? `(${email})` : '']
    .filter(Boolean)
    .join(' ');

  const respostas = {
    move_kpi: decidida.resp_move_kpi,
    sente_falta: decidida.resp_sente_falta,
    saving_coerente: decidida.resp_saving_coerente,
  };
  const comentario = (decidida.comentario ?? '').trim();

  const partes = [
    // O estado sai do MESMO lugar que a coluna de estado (não redigitar rótulos).
    `${rotuloAprovacaoSheet([decidida])}${assinatura ? ` por ${assinatura}` : ''} em ${dataBR(decidida.decidido_em)}`,
    // Uma linha por pergunta respondida (parecer antigo, sem checklist → nenhuma).
    ...detalharChecklist(respostas),
    ...(comentario ? [`${rotuloComentarioSheet(decidida.veredito, respostas)}: ${comentario}`] : []),
  ];
  return partes.join('\n');
}

// ─── Abertura da fila (chamada na submissão) ─────────────────────────────────

export type ResultadoAbertura = {
  /** Nenhuma fila aberta porque o autor É liderança (D11) ou não tem líder (D6). */
  isento: boolean;
  motivo: 'lideranca' | 'sem_lider' | 'teamguide_indisponivel' | 'especial' | null;
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

    // D27 — projeto ESPECIAL não abre fila (decisão do Luis, 06/08/2026). Vem ANTES
    // da TeamGuide: é um flag do próprio projeto, não depende de integração externa.
    if (Number(projeto.especial) === 1) {
      console.log(`[aprovacoes] ${projetoId} é ESPECIAL → sem fila de pré-aprovação (D27).`);
      return semFila('especial');
    }

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

    // ⚠️ Nenhum aviso sai daqui (D17, 05/08/2026). A submissão só ABRE a fila; quem
    // avisa o líder é o cron diário que manda a relação de pendências para o Gomoon
    // (docs/integracao-gomoon-chat.md), e a exclusão dos projetos de teste `[E2E-…]`
    // é responsabilidade de QUEM MONTA esse payload — não deste caminho.
    return { isento: false, motivo: null, aprovadores, rotuloSheet, justificativaSheet };
  } catch (e) {
    console.error('[aprovacoes] falha ao abrir a pré-aprovação (não-fatal):', e);
    return semFila('teamguide_indisponivel');
  }
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

// ─── Acesso de LEITURA do aprovador (tela read-only do projeto) ──────────────

export type AcessoAprovador = {
  /** Tem (ou teve) linha na fila deste projeto → pode LER o detalhe. */
  aprovador: boolean;
  /** Ainda há linha `pendente` para este e-mail (o parecer dele falta). */
  pendente: boolean;
};

const SEM_ACESSO: AcessoAprovador = { aprovador: false, pendente: false };

/**
 * Decide o acesso de leitura a partir das linhas da fila. Função PURA.
 *
 * A linha da fila É a prova de autorização — mesma régua do gate de `decidirAprovacao`,
 * que só grava se existir linha para (projeto, e-mail). Aqui a régua é de propósito mais
 * larga que a da decisão: **linha DECIDIDA também dá leitura**. O card da fila continua
 * oferecendo "Ler a documentação completa" depois do parecer registrado (o slider mantém
 * o item em modo leitura — D15), e quem acabou de aprovar não pode levar 403 no próprio
 * projeto que aprovou.
 *
 * ⚠️ NÃO consulta a TeamGuide: além da latência (isto roda ao abrir o detalhe), a
 * liderança ao vivo é a régua de quem ENTRA na fila, não de quem já foi convocado a
 * decidir. Trocar isso por `getLideresDe` faria uma reorganização de time apagar o
 * acesso a um projeto que a pessoa já tinha em mãos.
 */
export function resolverAcessoAprovador(
  linhas: Pick<AprovacaoRow, 'aprovador_email' | 'veredito'>[],
  email: string,
): AcessoAprovador {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return SEM_ACESSO;
  const minhas = linhas.filter((l) => (l.aprovador_email ?? '').trim().toLowerCase() === alvo);
  if (!minhas.length) return SEM_ACESSO;
  return { aprovador: true, pendente: minhas.some((l) => l.veredito === 'pendente') };
}

/** Versão I/O do predicado acima (1 leitura no SQLite, sem rede). */
export async function acessoDeAprovador(
  projetoId: string,
  email: string,
): Promise<AcessoAprovador> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return SEM_ACESSO;
  try {
    return resolverAcessoAprovador(await getAprovacoesDoProjeto(projetoId), alvo);
  } catch (e) {
    // Falha de leitura não pode virar acesso concedido — nem 500 na tela do autor.
    console.error('[aprovacoes] falha ao checar o acesso do aprovador:', e);
    return SEM_ACESSO;
  }
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
