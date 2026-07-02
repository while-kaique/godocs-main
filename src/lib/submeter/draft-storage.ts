// Persistência local do RASCUNHO em andamento (submissão não enviada).
//
// Motivo: o `projetoId` e o estado do wizard viviam só no React. Ao atualizar a
// página ou sair e voltar, perdiam-se — e recomeçar criava um NOVO rascunho no
// servidor (`iniciarSubmissao`), deixando o anterior órfão (aparecia como
// "duplicado" em Meus Projetos). Guardando um snapshot do estado aqui, o refresh
// RETOMA o mesmo rascunho em vez de criar outro. Limpo ao submeter.
//
// Só vale para rascunhos (nunca em modo edição de projeto já submetido).

import type {
  FormData,
  ChatMessage,
  ChatFase,
  SavingFormData,
} from "./constants";

const DRAFT_KEY = "godocs:rascunho-v1";

// Chave do rascunho de EDIÇÃO (um projeto já submetido sendo reeditado), por projeto.
// Antes a edição NÃO persistia nada (o save abortava em modo edição), então recarregar
// a página no meio de uma conversa longa perdia TUDO e a pessoa recomeçava do zero com
// o agente. Persistir por projeto faz o reload retomar o ponto exato.
export function editDraftKey(projetoId: string): string {
  return `godocs:edicao-v1:${projetoId}`;
}

export type DraftSnapshot = {
  projetoId: string;
  step: number;
  form: FormData;
  nomesExistentes: string[];
  completedSteps: number[];
  chatMessages: ChatMessage[];
  chatFase: ChatFase;
  chatComplete: boolean;
  agentTipos: ("saving" | "receita_incremental")[];
  agentMeta: unknown | null;
  agentArquivosSig: string;
  approvedDocPreview: string | null;
  approvedSavingPreview: string | null;
  approvedReceitaPreview: string | null;
  savingSubmitted: SavingFormData | null;
  receitaSubmitted: SavingFormData | null;
  formDraft: SavingFormData;
  respEspecial: "sim" | "nao" | "";
  // Qual sub-tela da etapa 3 estava ativa (formulário determinístico vs. chat).
  // Sem isso, retomar um rascunho na fase de saving/receita caía no chat do agente.
  showSavingForm: boolean;
  showReceitaForm: boolean;
};

// `key` permite separar o rascunho de submissão NOVA (default) do de EDIÇÃO (por
// projeto, via editDraftKey). Default mantém o comportamento antigo.
export function saveDraft(snapshot: DraftSnapshot, key: string = DRAFT_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch (e) {
    // Quota cheia / localStorage indisponível — degrada silenciosamente.
    console.warn("[rascunho] não foi possível salvar o rascunho local:", e);
  }
}

export function loadDraft(key: string = DRAFT_KEY): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftSnapshot;
    if (!parsed?.projetoId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(key: string = DRAFT_KEY): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Guard "servidor manda" para o rascunho de EDIÇÃO. Retorna `true` quando o rascunho
 * local deve ser DESCARTADO em vez de reidratado, porque ele afirma um estágio que o
 * servidor não sustenta: a fase de documentação foi concluída no cliente (preview
 * aprovado ou `chatComplete`) mas o servidor NÃO tem documentação persistida.
 *
 * É um estado impossível — típico de LEGADO que nunca teve o preview de doc aprovado
 * (a linha `documentacao` só é gravada na aprovação). Reidratar aqui ressuscitaria a
 * tela de aprovação final sobre um projeto sem doc: trava a submissão com
 * "Documentação ainda não foi gerada" e impede reauditar do zero (o cliente
 * sobrepunha o servidor incondicionalmente). Descartando, o cliente cai no caminho de
 * re-init (`reset_doc`), que limpa o chat no servidor e recomeça a auditoria limpa.
 *
 * NÃO descarta rascunhos legítimos: quem está no meio da fase de doc (ainda sem
 * preview aprovado, `chatComplete=false`) é preservado, assim como edições de projetos
 * que JÁ têm doc no servidor (fluxo normal de reenvio).
 */
export function deveDescartarDraftEdicao(args: {
  serverTemDoc: boolean;
  draft: Pick<DraftSnapshot, "chatComplete" | "approvedDocPreview">;
}): boolean {
  const draftDocConcluida =
    args.draft.chatComplete === true || args.draft.approvedDocPreview != null;
  return draftDocConcluida && !args.serverTemDoc;
}
