/**
 * Categorização de projetos — módulo PURO e **FONTE ÚNICA** da taxonomia (item 5.4 do backlog do
 * Luis, 02/09/2026). Dois eixos INDEPENDENTES:
 *
 *   • **TIPO** — o que o projeto É (dashboard · app · automação · agente · sistema).
 *   • **NÍVEL** — como ele trabalha (determinístico · inteligente · autônomo · agêntico).
 *
 * ## O nível NÃO é coluna nova: é a `Complexidade` que já existe
 * `Complexidade` (`agents/types.ts`, decidida pelos 2 eixos do `analyzer.ts` — usa IA no runtime? /
 * toma a ação consequente?) já vale `automacao | inteligencia | autonomia`. O nível deste módulo é
 * essa MESMA escala com o nome que o produto usa, mais um degrau novo. ⚠️ **Não criar segunda
 * fonte**: quem classifica continua sendo o `analyzer.ts`; aqui só se traduz e se estende.
 *
 * ## O tipo é INFERIDO, nunca declarado pelo autor
 * Decisão de 02/09/2026: o agente lê nome + descrição + doc e conclui o tipo. Perguntar ao autor
 * numa lista onde uma opção "paga mais" é convite à inflação — e a inferência do agente acertou a
 * separação da base inteira só pelos nomes dos projetos.
 *
 * O tipo sai de uma **cascata de sinais binários com precedência declarada** (`tipoPorSinais`), não
 * de julgamento livre: projeto real é várias coisas ao mesmo tempo (um app com banco e agente
 * dentro), então sem precedência a resposta muda a cada rodada.
 */
import type { Complexidade } from '@/lib/agents/types';

// ─── Eixo TIPO ───────────────────────────────────────────────────────────────

export type TipoProjeto = 'dashboard' | 'app' | 'automacao' | 'agente' | 'sistema';

/**
 * Ordem de PRECEDÊNCIA (a primeira que casa vence). É o que torna a classificação estável quando o
 * projeto tem várias caras.
 */
export const TIPOS_PROJETO: {
  chave: TipoProjeto;
  rotulo: string;
  teste: string;
}[] = [
  {
    chave: 'agente',
    rotulo: 'Agente',
    teste: 'Decide o próprio passo seguinte a partir do contexto, em vez de seguir um roteiro fixo.',
  },
  {
    chave: 'sistema',
    rotulo: 'Sistema',
    teste: 'Mantém uma base própria de registro que outros projetos ou processos consomem.',
  },
  {
    chave: 'app',
    rotulo: 'App',
    teste: 'Tem interface própria onde alguém EXECUTA trabalho — cria, edita, aprova, envia.',
  },
  {
    chave: 'dashboard',
    rotulo: 'Dashboard',
    teste: 'Tem interface própria, mas nela só se OLHA: exibe número, painel, relatório ou alerta.',
  },
  {
    chave: 'automacao',
    rotulo: 'Automação',
    teste: 'Não tem interface própria: roda uma rotina e entrega o resultado em outro lugar.',
  },
];

/** Os sinais que o agente extrai da doc. Cada um é uma pergunta binária, não um adjetivo. */
export type SinaisTipo = {
  /** Escolhe o próprio caminho/ferramenta a cada execução, sem roteiro fixo. */
  decideOProprioPasso: boolean;
  /** Mantém base de registro consumida por outro projeto/processo. */
  mantemBaseParaTerceiros: boolean;
  /** Tem interface própria. */
  temInterface: boolean;
  /** Na interface se executa trabalho (≠ só consultar). */
  naInterfaceSeExecutaTrabalho: boolean;
};

/**
 * Aplica a precedência: agente > sistema > app > dashboard > automação. Sem interface e sem os dois
 * primeiros sinais, é automação — o caso mais comum da base.
 */
export function tipoPorSinais(s: SinaisTipo): TipoProjeto {
  if (s.decideOProprioPasso) return 'agente';
  if (s.mantemBaseParaTerceiros) return 'sistema';
  if (s.temInterface) return s.naInterfaceSeExecutaTrabalho ? 'app' : 'dashboard';
  return 'automacao';
}

export function tipoValido(v: unknown): TipoProjeto | null {
  return TIPOS_PROJETO.some((t) => t.chave === v) ? (v as TipoProjeto) : null;
}

// ─── Eixo NÍVEL ──────────────────────────────────────────────────────────────

export type NivelProjeto = 'deterministico' | 'inteligente' | 'autonomo' | 'agentico';

/**
 * ⚠️ `agentico` está **TBD** (Luis, 02/09/2026): o rótulo foi aprovado, a fronteira não. A proposta
 * registrada aqui é a única diferença observável entre ele e `autonomo` — quem decide o PLANO:
 * autônomo decide e age dentro de um escopo dado; agêntico monta o próprio plano, escolhe as
 * ferramentas e itera até o objetivo. Enquanto o Luis não fechar, **nada classifica como
 * `agentico`** (`NIVEL_TBD`) — o nível não pode nascer com fronteira inventada.
 */
export const NIVEIS_PROJETO: {
  chave: NivelProjeto;
  rotulo: string;
  teste: string;
  /** O valor equivalente na coluna `Complexidade` que já existe. `null` = degrau novo. */
  complexidadeLegado: Complexidade | null;
}[] = [
  {
    chave: 'deterministico',
    rotulo: 'Determinístico',
    teste: 'Executa por regra fixa. Não usa IA no momento em que roda.',
    complexidadeLegado: 'automacao',
  },
  {
    chave: 'inteligente',
    rotulo: 'Inteligente',
    teste: 'Usa IA em algum passo da execução (gera, classifica, extrai, resolve condicional).',
    complexidadeLegado: 'inteligencia',
  },
  {
    chave: 'autonomo',
    rotulo: 'Autônomo',
    teste: 'Toma a ação consequente sozinho, dentro de um escopo dado — com ou sem IA.',
    complexidadeLegado: 'autonomia',
  },
  {
    chave: 'agentico',
    rotulo: 'Agêntico',
    teste:
      'TBD — proposta: monta o próprio plano, escolhe as ferramentas e itera até o objetivo, sem roteiro fixo.',
    complexidadeLegado: null,
  },
];

/** Enquanto a fronteira do `agentico` não for fechada pelo dono do produto, ninguém o atribui. */
export const NIVEL_TBD: NivelProjeto[] = ['agentico'];

export function nivelEstaFechado(n: NivelProjeto): boolean {
  return !NIVEL_TBD.includes(n);
}

/** Tradução do legado → nível. É a ÚNICA ponte; não reimplementar o mapa. */
export function nivelDaComplexidade(c: Complexidade): NivelProjeto {
  const achado = NIVEIS_PROJETO.find((n) => n.complexidadeLegado === c);
  return achado ? achado.chave : 'deterministico';
}

/**
 * Volta do nível para a coluna legada — o Sheets e o dashboard continuam falando `Complexidade`.
 * `agentico` cai em `autonomia`: é o valor mais próximo que a coluna aceita, e inventar valor novo
 * na planilha quebraria o dropdown e o sync reverso.
 */
export function complexidadeDoNivel(n: NivelProjeto): Complexidade {
  const achado = NIVEIS_PROJETO.find((x) => x.chave === n);
  return achado?.complexidadeLegado ?? 'autonomia';
}

export function nivelValido(v: unknown): NivelProjeto | null {
  return NIVEIS_PROJETO.some((n) => n.chave === v) ? (v as NivelProjeto) : null;
}

// ─── Categoria completa ──────────────────────────────────────────────────────

export type CategoriaProjeto = { tipo: TipoProjeto; nivel: NivelProjeto };

/**
 * Normaliza a saída do LLM, fail-closed: tipo inválido → `automacao` (o mais comum, o que menos
 * afirma), nível inválido → o nível derivado da `Complexidade` que o analisador já assentou, e
 * nível ainda TBD é REBAIXADO para `autonomo` (não se atribui degrau sem fronteira fechada).
 */
export function normalizarCategoria(
  bruto: { tipo?: unknown; nivel?: unknown },
  complexidadeAssentada: Complexidade,
): CategoriaProjeto {
  const tipo = tipoValido(bruto.tipo) ?? 'automacao';
  const nivelCru = nivelValido(bruto.nivel);
  const nivel =
    nivelCru && nivelEstaFechado(nivelCru)
      ? nivelCru
      : nivelCru && !nivelEstaFechado(nivelCru)
        ? 'autonomo'
        : nivelDaComplexidade(complexidadeAssentada);
  return { tipo, nivel };
}

export function rotuloCategoria(c: CategoriaProjeto): string {
  const t = TIPOS_PROJETO.find((x) => x.chave === c.tipo)?.rotulo ?? c.tipo;
  const n = NIVEIS_PROJETO.find((x) => x.chave === c.nivel)?.rotulo ?? c.nivel;
  return `${t} · ${n}`;
}

/** Render para o prompt. Fonte única — não redigitar a taxonomia no prompt. */
export function descreverCategorizacao(): string {
  const tipos = TIPOS_PROJETO.map(
    (t, i) => `  ${i + 1}. ${t.rotulo} — ${t.teste}`,
  ).join('\n');
  const niveis = NIVEIS_PROJETO.filter((n) => nivelEstaFechado(n.chave))
    .map((n) => `  - ${n.rotulo} — ${n.teste}`)
    .join('\n');
  return [
    'TIPO DO PROJETO — a PRIMEIRA opção que casar vence (a ordem é a precedência):',
    tipos,
    '',
    'NÍVEL DO PROJETO — como ele trabalha:',
    niveis,
  ].join('\n');
}
