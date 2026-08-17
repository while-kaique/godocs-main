/**
 * Abrir a ficha de um projeto no `/dashboard` — prefetch por INTENÇÃO + cache curto.
 *
 * ## Por que existe
 * A listagem já não lê o Google Sheets no request (ela lê o espelho), e a rota do detalhe
 * também não — `getProjetoDashboard` resolve por `lerLinhaEspelho`, um SELECT por PRIMARY KEY.
 * Ainda assim abrir uma linha esperava ~1 s, porque **o clique dispara uma requisição inteira**
 * e neste ambiente uma requisição custa **~750–800 ms de overhead FIXO da plataforma** (o gate
 * de OAuth do edge) antes de o nosso código rodar — o mesmo número medido em `/favicon.svg`,
 * que não faz trabalho nenhum. Ou seja: o que sobrou de lentidão não é a planilha nem o SQLite,
 * é a CONTAGEM de requisições no caminho crítico do clique.
 *
 * A única forma de tirá-la de lá é começar a requisição ANTES do clique — a mesma régua que o
 * router já usa para os chunks (`defaultPreload:'intent'` + `defaultPreloadDelay:150` em
 * `src/router.tsx`).
 *
 * ## O que este módulo garante
 * - **Hover/foco dispara com atraso de 150 ms**, cancelável: atravessar 25 linhas rolando a
 *   tabela não vira 25 requisições (timer ÚNICO — mover para a linha de baixo substitui a
 *   intenção anterior em vez de somar).
 * - **Erro NUNCA fica cacheado** (mesma decisão do `dashboard-prefetch.ts`): 403, rede ou edge
 *   devolvendo HTML soltam a entrada, senão a tela herdaria a falha e não tentaria de novo.
 * - **TTL curto (30 s)** — o cache serve o clique que SEGUE o hover e o reabrir imediato de quem
 *   fechou sem querer, não a sessão inteira. A ficha semeia os campos "Observações" / "Motivo
 *   Reenvio" / "Motivo Reprovado" que a triagem **regrava**, então servir texto velho alargaria
 *   a janela de sobrescrever um valor mais novo da planilha. Daí 30 s — e daí `invalidarDetalhe`
 *   ser chamada assim que a triagem grava.
 *
 * ⚠️ Este prefetch é seguro porque a rota do DETALHE lê **só o espelho** (SQLite local) — nunca
 * o Sheets, cuja cota de 60 leituras/min é compartilhada com prod. Se um dia essa rota voltar a
 * ler a planilha, **o prefetch por hover tem de sair no MESMO commit**: é exatamente a armadilha
 * que o `preload={false}` do link "Dashboard" já documenta (ver o bullet de performance de
 * navegação no `CLAUDE.md`).
 *
 * ⚠️ Cache **em memória, por aba**. A decisão de produto de 28/07/2026 — *"cache da listagem em
 * SQLite/localStorage é FORA"* — segue valendo e não está sendo revisitada: isto não é a
 * listagem e não persiste nada.
 */
import { apiFetch } from "@/lib/api-client";

/** Rota do detalhe — fonte única (a tela e o prefetch não redigitam a URL). */
export function rotaDetalheDashboard(id: string): string {
  return `/api/admin/dashboard/projetos/${encodeURIComponent(id)}`;
}

/** Idade máxima de uma ficha guardada (o porquê do valor curto está no topo). */
export const DETALHE_TTL_MS = 30_000;
/** Atraso do hover/foco, igual ao `defaultPreloadDelay` do router. */
export const DETALHE_INTENCAO_MS = 150;
/** Teto de fichas guardadas (a tabela pagina em 25/50/100; o cache não é depósito). */
export const DETALHE_MAX_ENTRADAS = 40;

type Fetcher<T> = () => Promise<T>;
type Entrada = { p: Promise<unknown>; at: number };

const cache = new Map<string, Entrada>();
let timerIntencao: ReturnType<typeof setTimeout> | null = null;

/** O servidor casa o id sem caixa (`projeto_id` do espelho é minúsculo). */
function chave(id: string | null | undefined): string {
  return String(id ?? "")
    .trim()
    .toLowerCase();
}

function fetcherPadrao<T>(id: string): Fetcher<T> {
  return () => apiFetch<T>(rotaDetalheDashboard(id));
}

/** Descarta as entradas mais antigas (o `Map` preserva a ordem de inserção). */
function podar(): void {
  while (cache.size > DETALHE_MAX_ENTRADAS) {
    const maisVelha = cache.keys().next();
    if (maisVelha.done) return;
    cache.delete(maisVelha.value);
  }
}

/** Rota do LOTE — semeia as fichas da página visível numa requisição só. */
export const ROTA_LOTE_DASHBOARD = "/api/admin/dashboard/projetos/lote";

/**
 * Semeia o cache com as fichas da PÁGINA visível, em UMA requisição.
 *
 * Por que existe, se já há o prefetch por hover: o hover só cobre quem passa o mouse e
 * espera 150 ms — quem clica direto, navega por teclado ou chega por deep link pagava os
 * ~750 ms de overhead fixo do edge a cada ficha aberta. Uma requisição de ~137 KB (25 fichas
 * × 5,5 KB medidos em prod) faz TODAS as linhas da página abrirem sem requisição nenhuma.
 *
 * Invariantes preservados: só semeia id que **não** tem entrada fresca (nunca atropela uma
 * requisição em voo), **falha não vira entrada** (o cache não guarda erro — a abertura cai
 * no caminho individual e mostra o erro real), e o TTL é o mesmo dos demais.
 */
export function semearLote<T>(
  ids: string[],
  fetcher?: (ids: string[]) => Promise<Record<string, T>>,
): void {
  const agora = Date.now();
  const faltando = [...new Set(ids.map(chave).filter(Boolean))].filter((k) => {
    const atual = cache.get(k);
    return !atual || agora - atual.at > DETALHE_TTL_MS;
  });
  if (faltando.length === 0) return;

  const buscar =
    fetcher ??
    ((alvos: string[]) => apiFetch<Record<string, T>>(ROTA_LOTE_DASHBOARD, { ids: alvos }));
  void Promise.resolve()
    .then(() => buscar(faltando))
    .then((fichas) => {
      const at = Date.now();
      for (const [id, ficha] of Object.entries(fichas ?? {})) {
        const k = chave(id);
        const atual = cache.get(k);
        // Quem chegou primeiro manda: uma abertura em voo não pode ser trocada por baixo.
        if (atual && Date.now() - atual.at <= DETALHE_TTL_MS) continue;
        cache.set(k, { p: Promise.resolve(ficha), at });
      }
      podar();
    })
    .catch(() => {
      // Lote é otimização, não caminho crítico: falhou, cada ficha volta a ser buscada
      // individualmente na abertura. Nada de entrada rejeitada no cache.
    });
}

/**
 * A ficha do projeto: devolve a requisição em voo (ou já concluída) quando ela é recente, senão
 * dispara uma nova. A rejeição é propagada ao chamador **e** solta a entrada.
 */
export function obterDetalhe<T>(id: string, fetcher?: Fetcher<T>): Promise<T> {
  const k = chave(id);
  const atual = cache.get(k);
  if (atual && Date.now() - atual.at <= DETALHE_TTL_MS) return atual.p as Promise<T>;
  if (atual) cache.delete(k);

  const f = fetcher ?? fetcherPadrao<T>(id);
  let p: Promise<T>;
  try {
    p = Promise.resolve(f());
  } catch (e) {
    // Fetcher que lança de forma SÍNCRONA: não há o que guardar (e guardar uma entrada
    // rejeitada é justamente o que este módulo promete não fazer).
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
  const entrada: Entrada = { p, at: Date.now() };
  cache.set(k, entrada);
  podar();
  // Falha não fica retida: a abertura seguinte tenta de novo e mostra o erro real.
  void p.catch(() => {
    if (cache.get(k) === entrada) cache.delete(k);
  });
  return p;
}

/**
 * Aquece a ficha sem consumir o resultado. Nunca lança e nunca gera "unhandled rejection" —
 * quem exibe erro é a tela, quando (e se) o clique acontecer.
 */
export function prefetchDetalhe<T>(id: string, fetcher?: Fetcher<T>): void {
  if (!chave(id)) return;
  void obterDetalhe<T>(id, fetcher).catch(() => undefined);
}

/**
 * Prefetch por INTENÇÃO: só dispara se o ponteiro/foco ficar na linha por 150 ms. Timer único
 * para toda a tabela, de propósito (ver o topo).
 */
export function agendarPrefetchDetalhe<T>(id: string, fetcher?: Fetcher<T>): void {
  cancelarPrefetchDetalhe();
  if (!chave(id)) return;
  timerIntencao = setTimeout(() => {
    timerIntencao = null;
    prefetchDetalhe<T>(id, fetcher);
  }, DETALHE_INTENCAO_MS);
}

/** Desiste da intenção pendente (mouse saiu da linha, foco mudou, componente desmontou). */
export function cancelarPrefetchDetalhe(): void {
  if (timerIntencao != null) {
    clearTimeout(timerIntencao);
    timerIntencao = null;
  }
}

/**
 * Esquece a ficha de UM projeto. ⚠️ Obrigatório depois de a triagem GRAVAR: o espelho acabou de
 * ser remendado e a cópia guardada afirmaria o status/motivo anterior.
 */
export function invalidarDetalhe(id: string): void {
  cache.delete(chave(id));
}

/**
 * Esquece TODAS as fichas — para quando o botão "Atualizar" sincroniza de verdade (lê a planilha
 * e regrava o espelho): dali em diante qualquer ficha guardada é anterior à planilha em mãos.
 * Serve também a troca de usuário e aos testes.
 */
export function limparDetalhes(): void {
  cancelarPrefetchDetalhe();
  cache.clear();
}
