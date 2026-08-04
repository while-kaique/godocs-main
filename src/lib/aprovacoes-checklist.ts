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

export const CHECKLIST_APROVACAO: PerguntaChecklist[] = [
  {
    chave: 'move_kpi',
    pergunta: 'O projeto move algum KPI da sua área?',
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
    ajuda: 'Compare as horas e o valor abaixo com a rotina real do time.',
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
  veredito: 'aprovado' | 'reprovado',
  respostas: Partial<Record<ChaveChecklist, string | null>>,
): boolean {
  return veredito === 'reprovado' || temNaoNoChecklist(respostas);
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
