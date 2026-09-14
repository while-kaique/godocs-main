/**
 * Quadro da triagem — agrupamento por EIXO (módulo PURO).
 *
 * ## Por que este módulo existe
 * A triagem tinha TRÊS telas que faziam a mesma coisa com eixos diferentes: o `/dashboard`
 * (lista), a `/especiais` (quadro por NOTA) e a `/aprovacoes-pendentes` (quadro por AUTOR).
 * As três liam o MESMO espelho da planilha, com o MESMO mapeamento (`mapResumo`), a MESMA
 * escrita de status (`POST /api/admin/dashboard/status`) e a MESMA ficha — o que mudava era
 * só por qual chave os cartões eram empilhados. Três telas para uma diferença de `groupBy`
 * significava três lugares para consertar cada bug e três filtros para manter em dia.
 *
 * Aqui a diferença vira DADO: um eixo é uma entrada desta tabela, e a tela desenha colunas
 * sem saber qual delas escolheu. Acrescentar "por ferramenta" amanhã é uma entrada, não uma
 * rota.
 *
 * ## O que NÃO mudou de propósito
 * A régua de fila, espera e urgência continua em `especiais-view.ts` e o agrupamento por
 * autor em `aprovacao-pendentes-view.ts`: os dois módulos já eram puros e testados, e
 * reescrevê-los aqui criaria duas verdades sobre "de quem é a bola".
 */
import type { ProjetoDashboardResumo } from "@/lib/dashboard-resumo";
import { STATUS_TRIAGEM, pilulaDe, metaStatus } from "@/components/dashboard/status-triagem";
import { NOTAS_BASE, SEM_NOTA, chaveArea, rotuloNota } from "@/lib/especiais-view";
import { agruparPorAutor } from "@/lib/aprovacao-pendentes-view";

/** Por qual chave os cartões são empilhados. */
export type EixoKanban = "status" | "nota" | "autor" | "area";

export type MetaEixo = {
  eixo: EixoKanban;
  /** O que aparece no seletor. */
  rotulo: string;
  /** A pergunta que este eixo responde — vira o `title` da opção. */
  pergunta: string;
};

/**
 * Os eixos, na ordem em que aparecem no seletor: do mais geral (em que pé está) ao mais
 * específico (quem submeteu). "Nota" e "Autor" são, respectivamente, a `/especiais` e a
 * `/aprovacoes-pendentes` de antes.
 */
/**
 * ⚠️ **O eixo "Fila" SAIU em 14/09/2026** (decisão do Luis). Ele agrupava por `filaDe`, que
 * respondia "com quem está a bola" cruzando `Status` + `Aprovação do Líder` + `Especial?` —
 * uma derivação que existia porque o estado do projeto morava em duas colunas. Com a coluna
 * ÚNICA de status (`status-funil.ts`), o eixo "Status" já responde isso: `Pendente` é o
 * líder, `Pré-aprovado` é a validação, `Ajuste pedido` é o autor. Dois eixos para a mesma
 * pergunta faziam o seletor parecer ter mais opções do que tem.
 *
 * A régua `filaDe` continua viva em `especiais-view.ts`: ela serve a `/especiais` e a
 * `/aprovacoes-pendentes`, que seguem no ar.
 */
export const EIXOS: readonly MetaEixo[] = [
  { eixo: "status", rotulo: "Status", pergunta: "Em que pé está cada projeto" },
  { eixo: "nota", rotulo: "Nota", pergunta: "Quanto a triagem já pontuou" },
  { eixo: "autor", rotulo: "Autor", pergunta: "Quem submeteu, para falar uma vez só" },
  { eixo: "area", rotulo: "Área", pergunta: "De onde vêm os projetos" },
] as const;

export type ColunaKanban = {
  /** Identidade da coluna: `key` de render e alvo de teste. */
  chave: string;
  rotulo: string;
  /** Linha de apoio abaixo do título. `null` quando o título já basta. */
  apoio: string | null;
  /** Acento da coluna. `null` = neutro (a tela escolhe o cinza do tema). */
  cor: string | null;
  projetos: ProjetoDashboardResumo[];
  total: number;
};

/**
 * Quantos cartões uma coluna mostra de cara, e quantos entram a cada "Ver mais".
 *
 * ⚠️ Estes números são o que torna o quadro utilizável com a base inteira: sem teto, a
 * coluna "Aprovado" sozinha desenha 500 cartões e o navegador engasga antes de a pessoa
 * ler o primeiro. O incremento é menor que o inicial porque quem clica está procurando UM
 * projeto, não lendo a coluna toda (mesma régua da `/especiais`).
 */
export const CARTOES_INICIAIS = 8;
export const CARTOES_INCREMENTO = 8;

/**
 * As colunas do funil que aparecem MESMO VAZIAS.
 *
 * São os três status que o funil decide (a régua da v2: `Aprovado` · `Pendente` ·
 * `Reprovado`). Coluna vazia que some faz "não há reprovado hoje" ser lido como "reprovar
 * não existe" — e o quadro deixa de mostrar a forma do funil, que é o motivo de ser quadro.
 * Os demais status (reenvio, descontinuado, sem status) só ganham coluna quando têm alguém.
 */
const STATUS_SEMPRE_VISIVEIS = ["pendente", "aprovado", "reprovado"] as const;

function chaveAutorOuArea(valor: string): string {
  return valor.toLowerCase();
}

/**
 * Monta as colunas do quadro para o eixo escolhido.
 *
 * `maisAntigos` inverte a ordem DENTRO de cada coluna (o mesmo toggle do "Período" da
 * lista): validar a fila do começo é o pedido de quem está limpando atraso.
 */
export function agruparKanban(
  projetos: ProjetoDashboardResumo[],
  eixo: EixoKanban,
  maisAntigos = false,
): ColunaKanban[] {
  switch (eixo) {
    case "status":
      return porStatus(projetos, maisAntigos);
    case "nota":
      return porNota(projetos, maisAntigos);
    case "autor":
      return porAutor(projetos, maisAntigos);
    case "area":
      return porArea(projetos, maisAntigos);
  }
}

/**
 * Ordena dentro da coluna. Sem data vai SEMPRE para o fim — falta de data não é "mais
 * antigo" (a mesma regra da listagem e das duas telas de origem).
 */
function porData(
  a: ProjetoDashboardResumo,
  b: ProjetoDashboardResumo,
  maisAntigos: boolean,
): number {
  if (a.dataOrdenacao == null && b.dataOrdenacao == null) {
    return (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR");
  }
  if (a.dataOrdenacao == null) return 1;
  if (b.dataOrdenacao == null) return -1;
  return maisAntigos ? a.dataOrdenacao - b.dataOrdenacao : b.dataOrdenacao - a.dataOrdenacao;
}

function ordenar(lista: ProjetoDashboardResumo[], maisAntigos: boolean) {
  return [...lista].sort((a, b) => porData(a, b, maisAntigos));
}

function porStatus(projetos: ProjetoDashboardResumo[], maisAntigos: boolean): ColunaKanban[] {
  const grupos = new Map<string, ProjetoDashboardResumo[]>();
  for (const p of projetos) {
    const k = pilulaDe(p.statusChave);
    const lista = grupos.get(k);
    if (lista) lista.push(p);
    else grupos.set(k, [p]);
  }
  return STATUS_TRIAGEM.filter(
    (s) =>
      (grupos.get(s.chave)?.length ?? 0) > 0 ||
      (STATUS_SEMPRE_VISIVEIS as readonly string[]).includes(s.chave),
  ).map((s) => {
    const lista = ordenar(grupos.get(s.chave) ?? [], maisAntigos);
    return {
      chave: s.chave,
      rotulo: s.label,
      apoio: null,
      cor: s.cor,
      projetos: lista,
      total: lista.length,
    };
  });
}

/**
 * Colunas por NOTA da triagem — o que a `/especiais` fazia.
 *
 * ⚠️ Os níveis 0 a 5 aparecem SEMPRE, mesmo vazios: a escala é a régua, e uma régua com
 * buraco no 4 é lida como "4 não existe". Acima de 5 a escala é ABERTA (há 7, 8 e 10 na
 * planilha), então esses níveis só ganham coluna quando têm projeto.
 *
 * ⚠️ `null` (célula vazia, ninguém avaliou) é uma coluna PRÓPRIA e vem primeiro — não é o
 * mesmo que `0`, que é a caixa «Experimenta» e significa que o time olhou.
 */
function porNota(projetos: ProjetoDashboardResumo[], maisAntigos: boolean): ColunaKanban[] {
  const niveis = new Set<number>(NOTAS_BASE);
  for (const p of projetos) if (p.estrelas != null && p.estrelas > 0) niveis.add(p.estrelas);

  const chaves: (number | null)[] = [null, ...[...niveis].sort((a, b) => a - b)];
  return chaves.map((nota) => {
    const lista = ordenar(
      projetos.filter((p) => (nota == null ? p.estrelas == null : p.estrelas === nota)),
      maisAntigos,
    );
    return {
      chave: nota == null ? SEM_NOTA : String(nota),
      rotulo: rotuloNota(nota),
      apoio: nota == null ? "Ninguém pontuou ainda" : nota === 0 ? "A caixa Experimenta" : null,
      cor: nota == null ? null : "#e0a800",
      projetos: lista,
      total: lista.length,
    };
  });
}

/** Colunas por AUTOR — o que a `/aprovacoes-pendentes` fazia. Quem tem mais vem primeiro. */
function porAutor(projetos: ProjetoDashboardResumo[], maisAntigos: boolean): ColunaKanban[] {
  return agruparPorAutor(projetos, maisAntigos).map((c) => ({
    chave: c.chave,
    rotulo: c.nome,
    apoio: c.email,
    cor: "var(--go-blue)",
    projetos: c.projetos,
    total: c.total,
  }));
}

/** Colunas por ÁREA. Maior primeiro, porque é onde a fila engrossa. */
function porArea(projetos: ProjetoDashboardResumo[], maisAntigos: boolean): ColunaKanban[] {
  const grupos = new Map<string, ProjetoDashboardResumo[]>();
  for (const p of projetos) {
    const k = chaveArea(p.area) || "SEM ÁREA";
    const lista = grupos.get(k);
    if (lista) lista.push(p);
    else grupos.set(k, [p]);
  }
  return [...grupos.entries()]
    .map(([area, lista]) => {
      const ordenados = ordenar(lista, maisAntigos);
      return {
        chave: chaveAutorOuArea(area),
        rotulo: area,
        apoio: null,
        cor: "var(--go-blue)",
        projetos: ordenados,
        total: ordenados.length,
      };
    })
    .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

/**
 * Cor da coluna de status, para a tela não reimportar `status-triagem` só por isso.
 * Status desconhecido fica neutro em vez de invisível.
 */
export function corDoStatus(chave: string): string | null {
  return metaStatus(chave)?.cor ?? null;
}

// ─── Vista escolhida (lista × quadro) ────────────────────────────────────────

/** Como a triagem está olhando a esteira agora. */
export type VistaTriagem = "lista" | "quadro";

/** Chave da preferência. Versionada como as demais chaves de cliente do repo. */
export const CHAVE_VISTA = "godocs:triagem-vista-v1";

/**
 * Lê a vista preferida.
 *
 * ⚠️ Nunca lança: aba anônima, armazenamento bloqueado e captura de miniatura fazem o
 * acessor jogar, e a tela tem de abrir do mesmo jeito. O padrão é **lista** — é a vista que
 * responde "cadê aquele projeto", que é o uso mais frequente; o quadro responde "como está
 * a esteira", e quem quer isso escolhe uma vez e a escolha fica.
 */
export function lerVistaTriagem(): VistaTriagem {
  try {
    return globalThis.localStorage?.getItem(CHAVE_VISTA) === "quadro" ? "quadro" : "lista";
  } catch {
    return "lista";
  }
}

export function gravarVistaTriagem(vista: VistaTriagem): void {
  try {
    globalThis.localStorage?.setItem(CHAVE_VISTA, vista);
  } catch {
    /* preferência de conveniência: perder não quebra nada */
  }
}
