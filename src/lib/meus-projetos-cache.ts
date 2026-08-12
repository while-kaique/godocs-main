// Cache curto, EM MEMÓRIA, das linhas do Sheets de um dono — o que tira a leitura da
// planilha do caminho crítico de `GET /api/meus-projetos`.
//
// Por que existe
// --------------
// `listarMeusProjetos` chamava `syncOwnerRowsFromSheet(email)` e só DEPOIS lia o SQLite.
// A leitura da planilha custa ~2 s, e as colunas Status / Motivo Reprovado / Motivo
// Reenvio / Atualizado Em saem justamente dessas linhas — então não dava para simplesmente
// jogar o sync para o background: a tela abriria com Status "—" e sem o aviso de reenvio.
// Medido em prod (12/08/2026): `/api/meus-projetos` levava ~3 s, e o edge do Godeploy ainda
// cobra ~750 ms fixos por requisição.
//
// A solução é a MESMA já usada e aprovada no `/dashboard` (`dashboard-admin.functions.ts`,
// PR #215): TTL curto + *single-flight* + *stale-while-revalidate*. Servir dado de até
// ~1 min de idade é aceitável aqui (Status na planilha muda por ação humana de triagem,
// não a cada segundo), e quem acabou de submeter invalida o próprio cache (ver
// `invalidarLinhasDoDono`).
//
// ⚠️ O cache é em MEMÓRIA do isolate, de propósito. A decisão de produto de 28/07/2026
// (registrada no CLAUDE.md, seção "Dashboard do admin") é que cache da listagem em
// **SQLite/localStorage está FORA** — a planilha segue fonte única. Isto aqui não é
// persistência: é uma janela de 60 s dentro do mesmo isolate, que some sozinha.
//
// ⚠️ Leitura que FALHOU nunca entra no cache. `syncOwnerRowsFromSheet` devolve
// `rows: []` tanto para "a planilha não respondeu" quanto para "este usuário não tem
// projeto" — cachear o primeiro caso apagaria o Status de todo mundo por um minuto. Por
// isso o sync devolve `leituraOk` e só o `true` é instalado.

import { syncOwnerRowsFromSheet } from '@/lib/google/sync-reverse';
import type { SheetRow } from '@/lib/google/sheets';
import { runBackground } from '@/lib/background';

/** Idade a partir da qual o dado é revalidado (servindo o velho enquanto isso). */
export const CACHE_TTL_MS = 60_000;
/**
 * Teto de idade do dado velho. Enquanto o Sheets falha, a revalidação não repõe nada e o
 * cache continuaria servindo para sempre — passado o teto é melhor voltar a BLOQUEAR e
 * pagar a leitura do que afirmar um Status de horas atrás.
 */
export const STALE_MAX_MS = 10 * CACHE_TTL_MS;

type Entrada = { rows: SheetRow[]; lidoEm: number };

const cache = new Map<string, Entrada>();
const leituraEmCurso = new Map<string, Promise<Entrada>>();
/** Bump por dono: uma leitura em voo de era anterior não instala (ver `invalidarLinhasDoDono`). */
const epoca = new Map<string, number>();

function chave(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Dispara (ou reaproveita) o sync real. *Single-flight* por dono: dois carregamentos
 * simultâneos da mesma pessoa geram UMA leitura da planilha, não duas.
 *
 * Falha não envenena o cache — a entrada anterior fica intacta e a próxima chamada tenta
 * de novo. É o que mantém a tela viva quando o Sheets dá 429/503.
 */
function iniciarSync(email: string): Promise<Entrada> {
  const k = chave(email);
  const emCurso = leituraEmCurso.get(k);
  if (emCurso) return emCurso;

  const epocaInicio = epoca.get(k) ?? 0;
  const promessa = (async () => {
    const { rows, leituraOk } = await syncOwnerRowsFromSheet(email);
    const nova: Entrada = { rows, lidoEm: Date.now() };
    // Não instala leitura falha (ver nota do topo) nem leitura de uma era invalidada.
    if (leituraOk && (epoca.get(k) ?? 0) === epocaInicio) cache.set(k, nova);
    return nova;
  })();

  leituraEmCurso.set(k, promessa);
  // O `catch` vazio evita "unhandled rejection" quando ninguém aguarda esta promise
  // (caminho de revalidação em background).
  void promessa
    .catch(() => undefined)
    .finally(() => {
      if (leituraEmCurso.get(k) === promessa) leituraEmCurso.delete(k);
    });
  return promessa;
}

/**
 * Linhas do Sheets deste dono, em modo **stale-while-revalidate**:
 * - cache **fresco** (< 60 s) → devolve na hora, zero I/O;
 * - cache **vencido** (< 10 min) → devolve o VELHO na hora e revalida em background
 *   (`runBackground` → `ctx.waitUntil`, obrigatório no Godeploy senão a promise é
 *   cancelada quando a Response retorna);
 * - **sem cache** (isolate frio), velho demais, ou `refresh` explícito → bloqueia.
 *
 * Nunca lança: o sync já engole os próprios erros e devolve `rows: []`, e o chamador
 * trata lista vazia como "não sei o Status" (cai para "—"), exatamente como antes.
 */
export async function lerLinhasDoDono(
  email: string,
  opts?: { refresh?: boolean },
): Promise<{ rows: SheetRow[]; doCache: boolean; revalidando: boolean }> {
  const k = chave(email);
  if (!k) return { rows: [], doCache: false, revalidando: false };

  if (opts?.refresh) {
    invalidarLinhasDoDono(email);
    const nova = await iniciarSync(email);
    return { rows: nova.rows, doCache: false, revalidando: false };
  }

  const atual = cache.get(k);
  if (atual) {
    const idade = Date.now() - atual.lidoEm;
    if (idade < CACHE_TTL_MS) {
      return { rows: atual.rows, doCache: true, revalidando: leituraEmCurso.has(k) };
    }
    if (idade < STALE_MAX_MS) {
      const jaEmCurso = leituraEmCurso.has(k);
      const promessa = iniciarSync(email);
      if (!jaEmCurso) runBackground(promessa);
      return { rows: atual.rows, doCache: true, revalidando: true };
    }
    // Velho demais (revalidação falhando há muito) → volta a bloquear.
  }

  const nova = await iniciarSync(email);
  return { rows: nova.rows, doCache: false, revalidando: false };
}

/**
 * Descarta o cache deste dono. Chamado por quem ESCREVE na planilha em nome dele
 * (submissão/reenvio, descontinuar), senão o projeto recém-submetido apareceria com
 * Status "—" por até 60 s — ele existe no SQLite na hora, mas o Status vem da linha
 * do Sheets, que o cache velho não tem.
 *
 * O bump de época também impede que um sync JÁ EM VOO (iniciado antes da escrita)
 * instale um snapshot anterior a ela.
 */
export function invalidarLinhasDoDono(email: string): void {
  const k = chave(email);
  if (!k) return;
  cache.delete(k);
  epoca.set(k, (epoca.get(k) ?? 0) + 1);
}

/** Só para teste: zera o estado global entre casos. */
export function _resetCacheMeusProjetos(): void {
  cache.clear();
  leituraEmCurso.clear();
  epoca.clear();
}
