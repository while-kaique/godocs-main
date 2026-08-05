// Checklist do gestor na pré-aprovação — FONTE ÚNICA das 3 perguntas.
//
// Pedido do Lucas (03/08/2026): o líder não deve só carimbar "aprovo". Ele responde 3
// perguntas de sim/não que só quem conhece a área sabe responder, e são elas que dão
// valor ao parecer para a triagem da equipe RPA.
//
// ⚠️ Módulo PURO e sem import de servidor: é consumido pela tela (`routes/aprovacoes.tsx`)
// e pelo rótulo da coluna "Aprovação do Líder" (`aprovacoes.functions.ts`). Ao mexer no
// texto de uma pergunta, altere AQUI — não redigite em outro lugar.

export type ChaveChecklist = 'move_kpi' | 'sente_falta' | 'saving_coerente';

export type RespostaChecklist = 'sim' | 'nao';

export type PerguntaChecklist = {
  chave: ChaveChecklist;
  /** Pergunta como o líder lê na tela. */
  pergunta: string;
  /** Uma linha de contexto — por que estamos perguntando isso. */
  ajuda: string;
  /** Rótulo curto usado no histórico e na planilha. */
  rotulo: string;
};

/**
 * Pergunta da caixa de justificativa, ESPECÍFICA de cada "não" (Lucas reprovou a 1ª
 * versão em 04/08/2026: o título era genérico e o exemplo era SEMPRE o do saving, mesmo
 * quando o "não" era em "move KPI").
 *
 * ⚠️ **SEM exemplo/placeholder** (Lucas, 04/08/2026 — 2ª rodada): o campo entra vazio. A
 * pergunta já diz o que responder; o texto de exemplo virava ruído e arriscava alguém
 * mandar o exemplo como resposta. NÃO reintroduzir.
 */
export type JustificativaChecklist = { pergunta: string };

export const JUSTIFICATIVA_POR_CHAVE: Record<ChaveChecklist, JustificativaChecklist> = {
  move_kpi: {
    pergunta: 'O que este projeto entrega, se não move um indicador da área?',
  },
  sente_falta: {
    pergunta: 'Se desligar o projeto não impactaria a área, justifique a aprovação.',
  },
  // ⚠️ Esta NÃO tem caixa de justificativa: "saving incoerente" bloqueia a
  // pré-aprovação (ver `bloqueiaPreAprovacao`). Fica declarada só para a lista ficar
  // completa; o texto do bloqueio é o AVISO_SAVING_INCOERENTE.
  saving_coerente: {
    pergunta: 'O saving não confere — o projeto precisa voltar para o autor corrigir.',
  },
};

/**
 * "Não" que IMPEDE a pré-aprovação (decisão do Lucas, 04/08/2026): número errado não se
 * justifica, se corrige. Com `saving_coerente = 'nao'` a tela esconde o "Pré-aprovar" e
 * deixa só "Pedir ajuste" / "Reprovar" — e o servidor recusa a aprovação.
 *
 * As outras duas seguem aprovando COM explicação (D16): ali o "não" é contexto que só o
 * gestor tem, não erro de submissão.
 */
export function bloqueiaPreAprovacao(
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): boolean {
  return respostas.saving_coerente === 'nao';
}

/** Texto do bloqueio — FONTE ÚNICA (tela e, se preciso, erro do servidor). */
export const AVISO_SAVING_INCOERENTE =
  'Se o projeto está com erro nos cálculos ou ganhos, pedimos que redirecione ao time para ajustes ou reprove.';

export const CHECKLIST_APROVACAO: PerguntaChecklist[] = [
  {
    chave: 'move_kpi',
    pergunta: 'O projeto move algum KPI da área?',
    ajuda: 'Vale qualquer indicador que vocês acompanham: horas, custo, erro, prazo, risco.',
    rotulo: 'Move KPI',
  },
  {
    chave: 'sente_falta',
    pergunta: 'Se este projeto fosse desligado hoje, a área sentiria falta?',
    ajuda: 'Se ninguém reclamaria, provavelmente o processo já não depende dele.',
    rotulo: 'Sentiria falta',
  },
  {
    chave: 'saving_coerente',
    pergunta: 'O saving declarado é coerente com o impacto que você vê na área?',
    ajuda: 'Compare as horas e o valor com a rotina real do time.',
    rotulo: 'Saving coerente',
  },
];

/** Só as 3 chaves respondidas contam como checklist completo. */
export function checklistCompleto(
  respostas: Partial<Record<ChaveChecklist, RespostaChecklist | null>>,
): boolean {
  return CHECKLIST_APROVACAO.every((p) => respostas[p.chave] === 'sim' || respostas[p.chave] === 'nao');
}

/**
 * Alguma das 3 perguntas foi respondida com "não"?
 *
 * Pedido do Luis (04/08/2026): pré-aprovar com um "não" no checklist passava batido — o
 * líder marcava "o saving não é coerente" e carimbava sem dizer uma palavra, e a triagem
 * recebia a contradição sem explicação. Agora o "não" exige a explicação (que vai para a
 * coluna "Justificativa Aprovação do Líder").
 */
export function temNaoNoChecklist(
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): boolean {
  return CHECKLIST_APROVACAO.some((p) => respostas[p.chave] === 'nao');
}

/**
 * O parecer exige texto escrito? FONTE ÚNICA da regra — a tela usa para abrir a caixa e o
 * servidor usa para cobrar (o frontend nunca é a garantia).
 *
 * - pedir ajuste: sempre (o autor precisa saber o que mudar);
 * - pré-aprovar: só quando há "não" no checklist.
 */
export function exigeJustificativa(
  veredito: 'aprovado' | 'ajuste' | 'reprovado',
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): boolean {
  // Ajuste e reprovação sempre pedem texto (o autor lê). Pré-aprovar pede quando há
  // "não" que ADMITE justificativa — o `saving_coerente` não admite: ele bloqueia.
  if (veredito !== 'aprovado') return true;
  return chavesQueExigemJustificativa(respostas).length > 0;
}

/** Chaves com "não" que pedem explicação para pré-aprovar (exclui o bloqueante). */
export function chavesQueExigemJustificativa(
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): ChaveChecklist[] {
  return CHECKLIST_APROVACAO.filter(
    (p) => p.chave !== 'saving_coerente' && respostas[p.chave] === 'nao',
  ).map((p) => p.chave);
}

/** Rótulo curto de uma pergunta ("Move KPI"). "" quando a chave não existe. */
export function rotuloChecklist(chave: ChaveChecklist): string {
  return CHECKLIST_APROVACAO.find((p) => p.chave === chave)?.rotulo ?? '';
}

/**
 * O checklist inteiro em linhas legíveis — a PERGUNTA como o líder a leu, seguida do
 * que ele respondeu:
 *
 *     O projeto move algum KPI da área? — não
 *
 * Vai para a coluna "Justificativa Aprovação do Líder" (pedido do Luis, 05/08/2026: a
 * planilha precisa guardar TUDO o que o líder respondeu, não um resumo em código). Só
 * entram perguntas respondidas — parecer antigo, sem checklist, devolve lista vazia.
 */
export function detalharChecklist(
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): string[] {
  return CHECKLIST_APROVACAO.filter(
    (p) => respostas[p.chave] === 'sim' || respostas[p.chave] === 'nao',
  ).map((p) => `${p.pergunta} — ${respostas[p.chave] === 'nao' ? 'não' : 'sim'}`);
}

/**
 * Resumo legível do checklist ("Move KPI: sim · Sentiria falta: sim · Saving coerente: não").
 * Devolve "" quando o parecer é antigo (sem checklist), para o rótulo não ganhar sujeira.
 */
export function resumirChecklist(
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): string {
  // A planilha é lida por gente: "não" com acento (regra 4), mesmo o valor gravado
  // sendo 'nao'.
  const partes = CHECKLIST_APROVACAO.filter(
    (p) => respostas[p.chave] === 'sim' || respostas[p.chave] === 'nao',
  ).map((p) => `${p.rotulo}: ${respostas[p.chave] === 'nao' ? 'não' : 'sim'}`);
  return partes.join(' · ');
}
