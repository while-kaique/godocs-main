/**
 * Aba TEMPORÁRIA de aprovação de projetos pendentes/pré-aprovados — agrupamento por AUTOR
 * (módulo PURO).
 *
 * ## Por que ela existe
 * A `/especiais` mostra a fila que o time de RPA valida SEM impacto financeiro, agrupada por
 * nível de estrela. Esta aba é a irmã sem estrelas: os projetos do fluxo normal que ainda
 * dependem do RPA para aprovar — **pendentes e pré-aprovados** —, e a pergunta aqui não é
 * "quantas estrelas?", é "de quem é isto e quem valida?". Por isso a coluna passa a ser a
 * PESSOA que submeteu: quem tem vários projetos aparece numa coluna só, e a validação de todos
 * eles acontece de uma vez (pedido do Luis).
 *
 * ## O que NÃO entra
 * - Especiais (têm aba própria, `/especiais`, onde o R$/estrela é a régua).
 * - Descontinuados (automação que não roda mais — nada a aprovar).
 * - Reenvio pendente e já decididos (aprovado/reprovado) — a bola não está com o RPA.
 *
 * Reusa a régua de fila, espera e divisão-por-área de `especiais-view.ts` (fonte única): o
 * que muda aqui é o EIXO da coluna (autor) e o recorte de escopo, não o vocabulário.
 */
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';
import {
  chaveArea,
  donoDoProjeto,
  ehDescontinuado,
  type DonoDeArea,
} from '@/lib/especiais-view';

// Reexporta o que a tela também consome, para o call site importar de um lugar só.
export {
  CARTOES_INICIAIS,
  CARTOES_INCREMENTO,
  areasDosProjetos,
  cargaPorDono,
  chaveArea,
  donoDoProjeto,
  ehDescontinuado,
  rotuloValidador,
  filaDe,
  ROTULO_FILA,
  diasDeEspera,
  aguardaDecisao,
  urgenciaDaEspera,
  type DonoDeArea,
  type ValidadorEspeciais,
  type Fila,
} from '@/lib/especiais-view';

/**
 * Quem cai nesta esteira: pendente/pré-aprovado do fluxo normal.
 *
 * ⚠️ Na planilha o "Status" é sempre "Pendente" enquanto a validação temporária estiver de pé
 * (ver o aviso no topo do `CLAUDE.md`), então tanto o pendente quanto o pré-aprovado têm
 * `statusChave === 'pendente'` — o que os distingue é a coluna "Aprovação do Líder", lida pela
 * `filaDe`. Célula de status vazia (`null`) conta como pendente (ninguém decidiu).
 */
export function ehDaFilaRpa(p: ProjetoDashboardResumo): boolean {
  if (p.especial) return false;
  if (ehDescontinuado(p)) return false;
  const s = (p.statusChave ?? '').trim();
  return s === '' || s === 'pendente';
}

/** Só os pendentes/pré-aprovados do fluxo normal. */
export function apenasFilaRpa(projetos: ProjetoDashboardResumo[]): ProjetoDashboardResumo[] {
  return projetos.filter(ehDaFilaRpa);
}

// ─── Chave e rótulo do autor ─────────────────────────────────────────────────

/**
 * Chave da coluna do autor: o e-mail (identidade estável) em minúsculas; sem e-mail, o nome;
 * sem nada, `'sem-autor'`. É por e-mail e não por nome porque dois "Ana" diferentes não podem
 * cair na mesma coluna, e a mesma pessoa não pode se dividir em duas por causa de acento.
 */
export function chaveAutor(p: ProjetoDashboardResumo): string {
  const email = (p.email ?? '').trim().toLowerCase();
  if (email) return email;
  const nome = (p.autor ?? '').trim().toLowerCase();
  return nome || 'sem-autor';
}

/** Nome legível do autor (nunca o e-mail cru quando há nome). */
export function rotuloAutor(p: ProjetoDashboardResumo): string {
  return (p.autor ?? '').trim() || (p.email ?? '').trim() || 'Sem autor';
}

export type ColunaAutor = {
  /** `chaveAutor` — serve de `key` da coluna. */
  chave: string;
  nome: string;
  email: string | null;
  projetos: ProjetoDashboardResumo[];
  total: number;
};

/** Mais recente primeiro; sem data vai para o fim (mesma regra da listagem). */
function porDataDesc(a: ProjetoDashboardResumo, b: ProjetoDashboardResumo): number {
  if (a.dataOrdenacao == null && b.dataOrdenacao == null) {
    return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  }
  if (a.dataOrdenacao == null) return 1;
  if (b.dataOrdenacao == null) return -1;
  return b.dataOrdenacao - a.dataOrdenacao;
}

/**
 * Uma coluna por autor. Ordem: **quem tem mais projetos primeiro** (é o ponto da tela —
 * achar quem tem vários e validar em bloco), empate desfeito pelo nome.
 */
export function agruparPorAutor(projetos: ProjetoDashboardResumo[]): ColunaAutor[] {
  const grupos = new Map<string, ProjetoDashboardResumo[]>();
  for (const p of projetos) {
    const k = chaveAutor(p);
    const lista = grupos.get(k);
    if (lista) lista.push(p);
    else grupos.set(k, [p]);
  }
  return [...grupos.entries()]
    .map(([chave, lista]) => {
      const ordenados = [...lista].sort(porDataDesc);
      const ref = ordenados[0];
      return {
        chave,
        nome: rotuloAutor(ref),
        email: (ref.email ?? '').trim() || null,
        projetos: ordenados,
        total: ordenados.length,
      };
    })
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

export type FiltrosPendentes = {
  /** Texto livre — casa nome, autor, e-mail, id, área e ferramenta (índice do resumo). */
  termo: string;
  /** E-mail de quem valida, `'sem-dono'` para as áreas órfãs, ou `null` para todos. */
  dono: string | null;
  /** Chave da `Fila` (rpa/lider/autor/sem_lider) ou `'todos'`. */
  fila: string;
  /** Janela de Data Submissão, ou `null` para todas. */
  periodo: { inicio: string; fim: string } | null;
  /**
   * Só autores com 2+ projetos NA VISÃO ATUAL (depois dos outros filtros). É o toggle que
   * revela quem tem mais de um projeto — para chamar a pessoa e validar tudo de uma vez.
   */
  soMultiplos: boolean;
};

export const FILTROS_PENDENTES_VAZIOS: FiltrosPendentes = {
  termo: '',
  dono: null,
  fila: 'todos',
  periodo: null,
  soMultiplos: false,
};

/** Quantos filtros estão ativos — o número no botão de limpar. */
export function contarFiltrosPendentes(f: FiltrosPendentes): number {
  return (
    (f.termo.trim() ? 1 : 0) +
    (f.dono ? 1 : 0) +
    (f.fila !== 'todos' ? 1 : 0) +
    (f.periodo ? 1 : 0) +
    (f.soMultiplos ? 1 : 0)
  );
}

/**
 * Mantém só os projetos cujo AUTOR tem 2+ na lista dada. É o coração do toggle "só quem tem
 * mais de um projeto": conta por `chaveAutor` sobre o conjunto JÁ filtrado, então "quem tem
 * vários" respeita os outros filtros (uma pessoa com 3 projetos e um só na área filtrada
 * deixa de contar como múltipla ali).
 */
export function apenasAutoresComMultiplos(
  projetos: ProjetoDashboardResumo[],
): ProjetoDashboardResumo[] {
  const conta = new Map<string, number>();
  for (const p of projetos) conta.set(chaveAutor(p), (conta.get(chaveAutor(p)) ?? 0) + 1);
  return projetos.filter((p) => (conta.get(chaveAutor(p)) ?? 0) >= 2);
}

/** Quais filas aparecem na base, com contagem — alimenta o seletor de situação. */
export function filasPresentes(
  projetos: ProjetoDashboardResumo[],
  filaDeFn: (p: ProjetoDashboardResumo) => string,
): { chave: string; total: number }[] {
  const conta = new Map<string, number>();
  for (const p of projetos) {
    const f = filaDeFn(p);
    conta.set(f, (conta.get(f) ?? 0) + 1);
  }
  return [...conta.entries()]
    .map(([chave, total]) => ({ chave, total }))
    .sort((a, b) => b.total - a.total);
}

/** Só um `null`-safe do filtro por dono, reusando a régua de área de `especiais-view`. */
export function casaDono(
  p: ProjetoDashboardResumo,
  dono: string | null,
  donoPor: Map<string, DonoDeArea>,
): boolean {
  if (!dono) return true;
  const d = donoDoProjeto(p, donoPor);
  return dono === 'sem-dono' ? d == null : d === dono;
}

