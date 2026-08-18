/**
 * Comparador de projetos ESPECIAIS — agrupamento por NÍVEL de estrela (módulo PURO).
 *
 * ## O problema
 * A coluna "Estrelas" é um número sem denominador: 1, 2 e 3 não têm definição escrita e
 * comparar dois especiais exige abrir duas documentações longas. Foi o que apareceu na
 * discussão GoBrands × PIAPP (18/08/2026): um projeto saiu de 8 estrelas para "será que vale
 * alguma?" numa conversa só.
 *
 * ## Quem responde a isso agora
 * A **recomendação da auditoria** (`especiais-regua.ts` + `especial_avaliacao`): cada projeto
 * chega com nota sugerida, confiança e a leitura que diz por que a faixa, por que não sobe e o
 * que faria subir. A tela agrupa por nível e mostra a régua da ESCALA no cabeçalho da coluna
 * (definição da faixa + quão rara ela é na base).
 *
 * ⚠️ A **"régua deste nível"** — prateleira com um projeto-âncora fixado por nível — foi
 * REMOVIDA em 18/08/2026, no mesmo dia em que nasceu: ela existia para dar contra o que
 * comparar enquanto não havia avaliação automática, e o agente ocupou esse lugar com um texto
 * por projeto. Manter as duas deixaria duas réguas concorrentes na mesma tela. A tabela
 * `especial_referencia` fica de pé, sem leitor (remover é arquivar, jamais DROP).
 */
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

/**
 * Colunas que a tela SEMPRE mostra, mesmo vazias — a régua tem de ser visível inteira, senão
 * "não existe projeto de 4" é lido como "4 não existe". Notas acima disso ganham coluna só
 * quando há projeto ou âncora nelas (a escala é aberta: há 7, 8 e 10 na planilha).
 */
export const NOTAS_BASE = [0, 1, 2, 3, 4, 5] as const;

/** Chave da coluna dos que ninguém pontuou ainda — `null` ≠ 0 (ver o resumo da listagem). */
export const SEM_NOTA = 'sem-nota';

/** Teto do modo comparar: 3 cartões lado a lado ainda cabem sem virar carrossel. */
export const MAX_COMPARAR = 3;

export type ColunaEspeciais = {
  /** `'sem-nota'` ou a nota como string — serve de `key` e de alvo do "mover para". */
  chave: string;
  /** `null` = coluna dos sem nota. */
  nota: number | null;
  rotulo: string;
  /** Os projetos do nível, do mais recente para o mais antigo. */
  projetos: ProjetoDashboardResumo[];
  total: number;
};

/** Rótulo curto da coluna. */
export function rotuloNota(nota: number | null): string {
  if (nota == null) return 'Sem nota';
  if (nota === 0) return 'Zero';
  return `${nota} ${nota === 1 ? 'estrela' : 'estrelas'}`;
}

/** Só os especiais entram nesta tela — os financeiros têm o R$ como régua. */
export function apenasEspeciais(projetos: ProjetoDashboardResumo[]): ProjetoDashboardResumo[] {
  return projetos.filter((p) => p.especial);
}

/** Mais recente primeiro; sem data vai para o fim (mesma regra da listagem). */
function porDataDesc(a: ProjetoDashboardResumo, b: ProjetoDashboardResumo): number {
  if (a.dataOrdenacao == null && b.dataOrdenacao == null) {
    return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  }
  if (a.dataOrdenacao == null) return 1;
  if (b.dataOrdenacao == null) return -1;
  return b.dataOrdenacao - a.dataOrdenacao;
}

/** Monta as colunas: uma por nível, com os projetos daquele nível. */
export function agruparEspeciais(projetos: ProjetoDashboardResumo[]): ColunaEspeciais[] {
  const especiais = apenasEspeciais(projetos);

  const notas = new Set<number>(NOTAS_BASE);
  for (const p of especiais) if (p.estrelas != null && p.estrelas > 0) notas.add(p.estrelas);

  const chaves: (number | null)[] = [null, ...[...notas].sort((a, b) => a - b)];

  return chaves.map((nota) => {
    const doNivel = especiais
      .filter((p) => (nota == null ? p.estrelas == null : p.estrelas === nota))
      .sort(porDataDesc);
    return {
      chave: nota == null ? SEM_NOTA : String(nota),
      nota,
      rotulo: rotuloNota(nota),
      projetos: doNivel,
      total: doNivel.length,
    };
  });
}

// ─── Filtros e paginação da coluna ───────────────────────────────────────────

/**
 * Quantos cartões uma coluna mostra de cara, e quantos entram a cada "Carregar mais".
 *
 * Por que 7: a coluna tem de caber na tela sem virar rolagem infinita — com a base inteira,
 * o nível 1 sozinho passa de 40 cartões e a comparação entre colunas (o ponto da tela) some.
 * O incremento é menor que o inicial de propósito: quem clica está procurando UM projeto, não
 * lendo a coluna inteira.
 */
export const CARTOES_INICIAIS = 7;
export const CARTOES_INCREMENTO = 5;

export type FiltrosEspeciais = {
  /** Texto livre — casa nome, autor, e-mail, id, área e ferramenta (índice do resumo). */
  termo: string;
  /** E-mail de quem valida, `'sem-dono'` para as áreas órfãs, ou `null` para todos. */
  dono: string | null;
  /** Fila (quem depende de quem), ou `null` para todas. */
  fila: Fila | null;
  /** Janela de Data Submissão, ou `null` para todas. */
  periodo: { inicio: string; fim: string } | null;
  /** Só onde a auditoria discorda da nota gravada. */
  soDivergentes: boolean;
};

export const FILTROS_ESPECIAIS_VAZIOS: FiltrosEspeciais = {
  termo: '',
  dono: null,
  fila: null,
  periodo: null,
  soDivergentes: false,
};

/** Quantos filtros estão ativos — o número no gatilho do painel. */
export function contarFiltrosEspeciais(f: FiltrosEspeciais): number {
  return (
    (f.termo.trim() ? 1 : 0) +
    (f.periodo ? 1 : 0) +
    (f.soDivergentes ? 1 : 0) +
    (f.dono ? 1 : 0) +
    (f.fila ? 1 : 0)
  );
}

// ─── Divisão da validação por pessoa ─────────────────────────────────────────

/**
 * Quem valida o quê, por ÁREA.
 *
 * A força-tarefa do JV derivava isso por algoritmo (área inteira para quem tem menos carga).
 * Aqui é **definido à mão**: quem coordena a validação sabe coisas que a contagem não sabe —
 * quem conhece Growth, quem está de férias, quem já falou com aquele time. O que herdamos da
 * ideia dele é o que importa: **a unidade é a ÁREA, não o projeto** (contexto não se parte, e
 * projeto novo já nasce com dono sem ninguém redistribuir nada).
 */
export type DonoDeArea = {
  area: string;
  dono_email: string;
  dono_nome: string | null;
};

/** Um admin elegível a receber áreas. */
export type ValidadorEspeciais = { email: string; nome: string | null };

/** Filtro por dono: `null` = todos. */
export const TODOS_OS_DONOS = null;

/**
 * Chave da área: MAIÚSCULA e sem espaço sobrando, sem tirar acento.
 *
 * ⚠️ Acento fica: "OPERAÇÕES GOCASE" e "OPERACOES GOBEAUTE" são áreas DIFERENTES na planilha
 * (uma tem cedilha e til, a outra não) — normalizar acento juntaria as duas num dono só.
 */
export function chaveArea(area: string | null | undefined): string {
  return (area ?? '').trim().toUpperCase();
}

/** As áreas presentes na base, com quantos projetos cada uma tem. Ordem: maior primeiro. */
export function areasDosProjetos(
  projetos: ProjetoDashboardResumo[],
): { area: string; total: number }[] {
  const conta = new Map<string, number>();
  for (const p of projetos) {
    const a = chaveArea(p.area) || 'SEM ÁREA';
    conta.set(a, (conta.get(a) ?? 0) + 1);
  }
  return [...conta.entries()]
    .map(([area, total]) => ({ area, total }))
    .sort((a, b) => b.total - a.total || a.area.localeCompare(b.area, 'pt-BR'));
}

/** O e-mail de quem valida este projeto, ou `null` quando a área não tem dono. */
export function donoDoProjeto(
  projeto: ProjetoDashboardResumo,
  donos: Map<string, DonoDeArea>,
): string | null {
  return donos.get(chaveArea(projeto.area) || 'SEM ÁREA')?.dono_email ?? null;
}

/**
 * Quantos projetos cada pessoa tem na mão. É o número que mostra se a divisão ficou torta —
 * e por isso conta também os **sem dono**, sob a chave `null`: área que ninguém pegou é
 * exatamente o que some de vista numa lista organizada por pessoa.
 */
export function cargaPorDono(
  projetos: ProjetoDashboardResumo[],
  donos: Map<string, DonoDeArea>,
): Map<string | null, number> {
  const carga = new Map<string | null, number>();
  for (const p of projetos) {
    const dono = donoDoProjeto(p, donos);
    carga.set(dono, (carga.get(dono) ?? 0) + 1);
  }
  return carga;
}

/** Nome de exibição de um validador (nunca o e-mail cru quando há nome). */
export function rotuloValidador(
  email: string | null,
  validadores: ValidadorEspeciais[],
): string {
  if (!email) return 'Sem dono';
  const v = validadores.find((x) => x.email.toLowerCase() === email.toLowerCase());
  return v?.nome?.trim() || email;
}

// ─── Filas e tempo de espera (adaptado da força-tarefa do JV) ────────────────

/**
 * Em que fila o projeto está — quem depende de quem para ele andar.
 *
 * ⚠️ **É derivada, não é campo.** Sai de `Status` + `Aprovação do Líder` + `Especial?`, e a
 * ORDEM dos testes é a regra de negócio: reenvio vence tudo (a bola está com o autor), e
 * **especial vence a marcação de líder** — projeto especial não passa por líder (D27), então
 * a coluna do parecer vem vazia nele e isso não é falha de integração.
 *
 * Só `rpa` e `especial` dependem do time de RPA agora; as outras esperam outra pessoa.
 */
export type Fila = 'reenvio' | 'especial' | 'rpa' | 'lider' | 'autor' | 'sem_lider' | 'decidido';

export const ROTULO_FILA: Record<Fila, string> = {
  reenvio: 'Reenvio pendente',
  especial: 'Decisão central',
  rpa: 'Fila do RPA',
  lider: 'Aguardando o líder',
  autor: 'Aguardando o autor',
  sem_lider: 'Sem líder acionado',
  decidido: 'Já decidido',
};

/** As filas que exigem ação de quem valida — as outras esperam outra pessoa. */
export const FILAS_DO_RPA: Fila[] = ['especial', 'rpa'];

export function filaDe(p: ProjetoDashboardResumo): Fila {
  const status = (p.statusChave ?? '').trim();
  const lider = (p.aprovacaoLider ?? '').trim().toLowerCase();

  if (status === 'reenvio pendente') return 'reenvio';
  if (status !== 'pendente' && status !== '') return 'decidido';
  if (p.especial) return 'especial';
  if (lider.startsWith('pré-aprovado') || lider.startsWith('pre-aprovado')) return 'rpa';
  if (lider.startsWith('pré-pendente') || lider.startsWith('pre-pendente')) return 'lider';
  if (lider.startsWith('ajuste')) return 'autor';
  return 'sem_lider';
}

/** Dias desde a submissão. `null` quando não há data — não se inventa espera. */
export function diasDeEspera(p: ProjetoDashboardResumo, agoraMs: number): number | null {
  if (p.dataOrdenacao == null) return null;
  return Math.max(0, Math.round((agoraMs - p.dataOrdenacao) / 86_400_000));
}

/** Faixas de urgência do chip de espera (do painel do JV: 60d vermelho, 30d âmbar). */
export const ESPERA_CRITICA = 60;
export const ESPERA_ATENCAO = 30;

export function urgenciaDaEspera(dias: number | null): 'critica' | 'atencao' | 'normal' {
  if (dias == null) return 'normal';
  if (dias >= ESPERA_CRITICA) return 'critica';
  if (dias >= ESPERA_ATENCAO) return 'atencao';
  return 'normal';
}

/**
 * Teto de 2 estrelas enquanto o projeto está em reenvio (régua do JV): documentação
 * incompleta não sustenta nota alta. Não é trava — é o aviso que aparece quando alguém vai
 * aplicar mais que isso, porque evidência forte pode justificar.
 */
export const TETO_REENVIO = 2;

export function excedeTetoDeReenvio(p: ProjetoDashboardResumo, nota: number): boolean {
  return filaDe(p) === 'reenvio' && nota > TETO_REENVIO;
}
