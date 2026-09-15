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
  /**
   * Quando este rascunho foi salvo (epoch ms). É o que permite saber se ele ficou para trás
   * do servidor — ver `deveDescartarDraftEdicao`.
   *
   * ⚠️ OPCIONAL porque rascunho gravado antes de 15/09/2026 não tem a chave. Ausência é
   * tratada como "velho", não como "agora": ver a régua na função.
   */
  salvoEm?: number;
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
export function semAnexosNoRascunho<
  T extends { savingAnexos?: unknown[]; receitaAnexos?: unknown[]; imensuravelAnexos?: unknown[] },
>(ganhos: T | undefined): T | undefined {
  if (!ganhos) return ganhos;
  return { ...ganhos, savingAnexos: [], receitaAnexos: [], imensuravelAnexos: [] };
}

export function saveDraft(snapshot: DraftSnapshot, key: string = DRAFT_KEY): void {
  try {
    const enxuto = {
      ...snapshot,
      // Carimba SEMPRE, sobrescrevendo o que veio no snapshot: o valor que importa é o do
      // momento da gravação.
      salvoEm: Date.now(),
      ganhos: semAnexosNoRascunho(snapshot.ganhos) as DraftSnapshot["ganhos"],
    };
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
 * ⚠️ **15/09/2026 — voltou a existir um motivo de descarte, e ele é o do INCIDENTE:** o
 * rascunho local vencia o servidor SEMPRE, inclusive quando estava velho. No «Proxy AI», o
 * autor adicionou um Coautor, reenviou (o servidor gravou os dois participantes) e, ao abrir
 * a edição de novo, um rascunho salvo ANTES daquela adição foi aplicado por cima do seed —
 * a lista voltou a UMA pessoa e a sincronização seguinte **apagou o Coautor no servidor**,
 * em silêncio. Medido no `form_events`: 17:08 grava `[rafael, joao.gabriel]`, 17:14 grava
 * `[rafael]`.
 *
 * A régua agora é a do resto do repo: **quem tem o dado mais novo manda**.
 */
export function deveDescartarDraftEdicao(args: {
  /** `projetos.updated_at` do seed — `YYYY-MM-DD HH:MM:SS` em UTC, ou ISO. */
  servidorAtualizadoEm: string | null | undefined;
  draft: Pick<DraftSnapshot, "salvoEm">;
}): boolean {
  const servidorMs = msDoCarimboDoServidor(args.servidorAtualizadoEm);
  // Sem carimbo do servidor não há com o que comparar, e o rascunho é a melhor fonte que
  // existe: mantém. (É o caso do projeto que nunca foi atualizado depois de criado.)
  if (servidorMs == null) return false;
  // ⚠️ Rascunho SEM `salvoEm` é anterior a 15/09/2026 e não dá para datar. Conta como VELHO:
  // o preço de manter é o do incidente (apagar participante em silêncio, sem ninguém ver);
  // o preço de descartar é a pessoa reabrir a edição com o que o SERVIDOR tem, que é o
  // estado do último reenvio dela. Perde-se o que foi digitado e nunca sincronizado, uma
  // única vez, na primeira abertura após o deploy.
  if (args.draft.salvoEm == null) return true;
  return servidorMs > args.draft.salvoEm;
}

/**
 * Converte o carimbo do servidor em epoch ms. PURA.
 *
 * ⚠️ O `updated_at` do SQLite é `YYYY-MM-DD HH:MM:SS` **em UTC e sem sufixo**, e o JS lê isso
 * como hora LOCAL — daí o `+ "Z"`. Sem ele, um rascunho salvo há 2 horas pareceria mais novo
 * que um servidor atualizado agora, e o descarte nunca aconteceria no fuso de Brasília. É a
 * mesma armadilha do `diaDaDecisao` em `agentes-atividade.ts`.
 */
export function msDoCarimboDoServidor(bruto: string | null | undefined): number | null {
  const txt = String(bruto ?? "").trim();
  if (!txt) return null;
  const ms = Date.parse(txt.includes("T") ? txt : txt.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? ms : null;
}
