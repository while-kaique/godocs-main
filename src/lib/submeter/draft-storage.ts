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

export function saveDraft(snapshot: DraftSnapshot): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // Quota cheia / localStorage indisponível — degrada silenciosamente.
    console.warn("[rascunho] não foi possível salvar o rascunho local:", e);
  }
}

export function loadDraft(): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftSnapshot;
    if (!parsed?.projetoId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}
