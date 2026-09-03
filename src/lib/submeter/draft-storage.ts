// Persistência local do RASCUNHO em andamento (submissão não enviada).
//
// Motivo: o `projetoId` e o estado do wizard viviam só no React. Ao atualizar a
// página ou sair e voltar, perdiam-se — e recomeçar criava um NOVO rascunho no
// servidor (`iniciarSubmissao`), deixando o anterior órfão (aparecia como
// "duplicado" em Meus Projetos). Guardando um snapshot do estado aqui, o refresh
// RETOMA o mesmo rascunho em vez de criar outro. Limpo ao submeter.
//
// Só vale para rascunhos (nunca em modo edição de projeto já submetido).

import type { FormData } from "./constants";
import type { GanhosFormData } from "./validacao-etapa3";

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
  // O usuário removeu um arquivo já enviado → a doc anterior não pode ser reaproveitada
  // (servidor guarda texto concatenado, não por arquivo). Persistido para o reload manter
  // a exigência de re-upload. Ausente em rascunhos antigos → default false.
  docExistenteInvalidado?: boolean;
  completedSteps: number[];
  agentMeta: unknown | null;
  agentArquivosSig: string;
  // ── v2 ──
  // Os blocos de ganho da Etapa 3. Substituem TODO o estado de conversa que morava aqui
  // (`chatMessages`/`chatFase`/`chatComplete`/`agentTipos`/os 3 previews aprovados/os 2
  // snapshots financeiros/`formDraft`/`respEspecial`/as 2 sub-telas): na v2 não há
  // conversa a retomar (D4), há um formulário a repor.
  //
  // ⚠️ OPCIONAL de propósito. Rascunho salvo pela v1 não tem a chave, e quem o lê tem de
  // sobreviver a isso — o `rehydrateFromLocal` aplica `?? ganhosFormVazio()`. Sem o
  // default, `/submeter` abria em branco com "This page didn't load" (bug real).
  ganhos?: GanhosFormData;
};

// `key` permite separar o rascunho de submissão NOVA (default) do de EDIÇÃO (por
// projeto, via editDraftKey). Default mantém o comportamento antigo.
/**
 * Anexos de evidência NÃO vão para o rascunho: são base64 de até 5 MB cada, serializados a cada
 * tecla da Etapa 3 — um print grande estourava a cota do localStorage e o rascunho INTEIRO
 * (Etapas 1 a 3) deixava de persistir em silêncio (achado ALTO da revisão de qualidade). A v1
 * nunca guardou bytes no draft. Ao retomar, a pessoa reanexa; o que ela DIGITOU está salvo.
 */
export function semAnexosNoRascunho<T extends { savingAnexos?: unknown[]; receitaAnexos?: unknown[]; imensuravelAnexos?: unknown[] }>(
  ganhos: T | undefined,
): T | undefined {
  if (!ganhos) return ganhos;
  return { ...ganhos, savingAnexos: [], receitaAnexos: [], imensuravelAnexos: [] };
}

export function saveDraft(snapshot: DraftSnapshot, key: string = DRAFT_KEY): void {
  try {
    const enxuto = { ...snapshot, ganhos: semAnexosNoRascunho(snapshot.ganhos) as DraftSnapshot['ganhos'] };
    localStorage.setItem(key, JSON.stringify(enxuto));
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
 * Guard "servidor manda" para o rascunho de EDIÇÃO — hoje NEUTRO, e o porquê importa.
 *
 * ⚠️ Na v1 esta função tinha teor: o rascunho local podia afirmar "fase de documentação
 * concluída" (`chatComplete` ou preview aprovado) sobre um projeto que o servidor tinha
 * SEM documentação — estado típico de LEGADO, que nunca passou pela aprovação da doc.
 * Reidratar ali ressuscitava a tela de aprovação final sobre um projeto sem doc e travava
 * a submissão em "Documentação ainda não foi gerada".
 *
 * Na v2 esse estado deixou de existir: a doc é gerada em BACKGROUND, invisível, sem tela
 * de aprovação e sem turno de aceite (D6), e projeto cuja doc não terminou não trava —
 * é reconciliado pelo cron. Não há mais o que o rascunho possa afirmar sobre a doc.
 *
 * Por isso devolve `false` SEMPRE: descartar o rascunho de quem está editando passou a
 * ser puro prejuízo — jogaria fora os blocos de ganho já preenchidos. A função (e o `if`
 * no seed da edição) fica de propósito: se um novo motivo de descarte aparecer, ele entra
 * AQUI, declarado e testável, em vez de virar um `if` solto dentro do `submeter.tsx`.
 */
export function deveDescartarDraftEdicao(_args: {
  serverTemDoc: boolean;
  draft: Pick<DraftSnapshot, "ganhos">;
}): boolean {
  return false;
}
