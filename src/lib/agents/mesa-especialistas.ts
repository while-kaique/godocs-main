/**
 * BRIDGE PURO entre a mesa DETERMINÍSTICA e os especialistas LLM (T5) — sem I/O.
 *
 * O orquestrador (`avaliacao-normais.functions.ts`) já computa os 4 votos determinísticos (FTE,
 * Financeiro, RAG, Cético). Quando os especialistas LLM estão ligados (`AVALIACAO_MESA_LLM`), cada
 * voto vira a ENTRADA de um especialista que o argumenta/contesta com o texto real do projeto; os
 * pareceres voltam e são conciliados aqui num `ResultadoConciliado` (mesma forma da mesa
 * determinística, para o resto do fluxo — deliberação, persistência, ficha — não precisar saber se
 * o parecer veio do LLM ou do cálculo).
 *
 * Este módulo é a parte SEM I/O e TESTÁVEL da ligação: montar as entradas e conciliar os
 * julgamentos. Quem chama o LLM (`julgarComEspecialista`) é o `.functions` do orquestrador.
 *
 * ## Fronteiras (as mesmas da mesa)
 * - **SOMBRA**: nada aqui muda status.
 * - **O determinístico vira VOTO, não piso**: cada especialista recebe o cálculo como INPUT e pode
 *   discordar; se o LLM falha, o `fallbackDeterministico` do próprio especialista devolve o voto.
 * - **Sem R$ cru**: só repassamos o `motivo` que o lado determinístico já redige (materialidade =
 *   ganho TOTAL, não valor/hora por cargo) — nenhum valor escondido do usuário é injetado aqui.
 */
import type { ResultadoPlausibilidadeFTE } from './analyzer';
import type { ResultadoFinanceiro } from './avaliacao-financeira';
import type { ResultadoCetico } from './cetico-avaliacao';
import { agregarJulgamentos, type SinalRag } from './agregador-avaliacao';
import { grauConfianca, type ResultadoConciliado } from '@/lib/deliberacao';
import type {
  DimensaoAvaliacao,
  EntradaEspecialista,
  JulgamentoEspecialista,
  TextoProjeto,
  VotoDeterministico,
  VotoResumido,
} from './especialista-avaliacao';

/** Os 4 votos determinísticos da mesa, na forma que o orquestrador já produz. */
export type VotosDeterministicos = {
  fte: ResultadoPlausibilidadeFTE;
  financeiro: ResultadoFinanceiro;
  rag: SinalRag;
  cetico: ResultadoCetico;
};

/**
 * Confiança do voto FTE — espelha o degrau do agregador determinístico (`agregarVotos`):
 * implausível derruba forte (0.2), plausível é seguro (0.9). O FTE não carrega confiança própria.
 */
function confiancaFte(fte: ResultadoPlausibilidadeFTE): number {
  return fte.implausivel ? 0.2 : 0.9;
}

/** Argumento curto de um voto quando ele não traz `motivo` — nunca vazio (o prompt precisa de texto). */
function argumentoFallback(preocupa: boolean): string {
  return preocupa ? 'sinal de preocupação neste eixo' : 'sem sinal de preocupação neste eixo';
}

/** Traduz cada voto determinístico no `VotoDeterministico` que o especialista recebe como input. */
function votoDeDimensao(dim: DimensaoAvaliacao, v: VotosDeterministicos): VotoDeterministico {
  switch (dim) {
    case 'fte':
      return {
        preocupa: v.fte.implausivel,
        confianca: confiancaFte(v.fte),
        motivo: v.fte.motivo,
        sinais: [],
      };
    case 'financeiro':
      return {
        preocupa: v.financeiro.veredito !== 'ok',
        confianca: v.financeiro.confianca,
        motivo: v.financeiro.motivo,
        sinais: [...v.financeiro.sinais],
      };
    case 'rag':
      return {
        preocupa: !v.rag.apoio,
        confianca: v.rag.confianca,
        motivo: v.rag.motivo,
        sinais: [],
      };
    case 'cetico':
      return {
        preocupa: v.cetico.refuta,
        confianca: v.cetico.confianca,
        motivo: v.cetico.motivo,
        sinais: [...v.cetico.sinais],
      };
  }
}

/** As 4 dimensões, na ordem canônica da mesa. */
const DIMENSOES: DimensaoAvaliacao[] = ['fte', 'financeiro', 'rag', 'cetico'];

/**
 * Resumo de um voto para os `outrosVotos` do contrato.
 *
 * ⚠️ **O especialista NÃO vê isto no 1º parecer** (RF-231) — `buildPromptEspecialista` ignora
 * `outrosVotos` de propósito, para o julgamento de cada eixo ser independente. Quem lê a mesa
 * inteira é a conciliação (`agregarJulgamentos`), depois de todos escreverem.
 */
function resumoVoto(dim: DimensaoAvaliacao, voto: VotoDeterministico): VotoResumido {
  return {
    dimensao: dim,
    preocupa: voto.preocupa,
    argumento: (voto.motivo && voto.motivo.trim()) || argumentoFallback(voto.preocupa),
  };
}

/**
 * Monta uma `EntradaEspecialista` por dimensão a partir dos votos determinísticos: cada especialista
 * recebe o PRÓPRIO voto como input (Decisão 2 do plano: sinal, não trava), o texto do projeto e os
 * vizinhos aprovados (precedente). PURA.
 *
 * ⚠️ Os votos das OUTRAS três dimensões continuam sendo montados em `outrosVotos`, mas **não vão
 * ao prompt do 1º parecer** desde a RF-231 (ver `resumoVoto` acima e o campo em
 * `EntradaEspecialista`). Eles seguem no contrato porque a conciliação é que lê a mesa inteira.
 */
export function montarEntradasEspecialistas(
  votos: VotosDeterministicos,
  texto: TextoProjeto,
  vizinhosTexto: string[],
  /**
   * As lições da triagem, já renderizadas (`blocoCorrecoes`). A MESMA para as 4 dimensões: a
   * correção é do PROJETO, não de um eixo — e quem decide se ela fala com o seu eixo é o
   * especialista, lendo o par argumento/réplica.
   *
   * ⚠️ **OBRIGATÓRIO**, não opcional-com-default. Nasceu `licoes = ''` e isso repetia, uma camada
   * abaixo, o mesmo defeito que o `correcoes` obrigatório do `ContextoAvaliacao` fechou: quem
   * esquecesse o argumento produziria prompt sem lição, sem erro de compilação e sem sinal em log.
   * String vazia é decisão explícita de quem chama.
   */
  licoes: string,
): EntradaEspecialista[] {
  const votoPorDim = new Map<DimensaoAvaliacao, VotoDeterministico>(
    DIMENSOES.map((d) => [d, votoDeDimensao(d, votos)]),
  );
  return DIMENSOES.map((dim) => ({
    dimensao: dim,
    texto,
    voto: votoPorDim.get(dim)!,
    vizinhos: vizinhosTexto,
    licoes,
    outrosVotos: DIMENSOES.filter((d) => d !== dim).map((d) => resumoVoto(d, votoPorDim.get(d)!)),
  }));
}

/**
 * Concilia os pareceres RACIOCINADOS dos especialistas num `ResultadoConciliado` — a mesma forma que
 * a mesa determinística entrega (via `conciliarComCetico`), para o resto do fluxo ser agnóstico à
 * origem. Delega a confiança/veredito ao `agregarJulgamentos` (T2, confiança = concordância real) e
 * acrescenta o `grau` e o `ceticoRefutou` (o cético LLM preocupou?). PURA.
 */
export function conciliarJulgamentos(
  julgamentos: JulgamentoEspecialista[],
  // ⚠️ `fluxoDireto` continua no contrato (os chamadores o passam e o analisador REAL ainda o usa),
  // mas desde 01/09/2026 ele NÃO isenta na mesa — só `especial` isenta. Ver `agregarJulgamentos`.
  opts: {
    especial?: boolean | null;
    fluxoDireto?: boolean | null;
    limiarConfianca?: number | null;
    /**
     * O piso de impacto MECÂNICO (`avaliarFinanceiro.abaixoDoPiso`), repassado ao agregador. ⚠️ Os
     * especialistas não votam sobre o piso: ele é régua e sobrepõe o painel inteiro. Sem este
     * repasse a mesa LLM APROVARIA o que a mesa determinística reprova — as duas passariam a ter
     * réguas diferentes, que é o que este arquivo existe para evitar.
     */
    abaixoDoPiso?: boolean | null;
    motivoPiso?: string | null;
  },
): ResultadoConciliado {
  const agregado = agregarJulgamentos({ julgamentos, ...opts });
  const cetico = julgamentos.find((j) => j.dimensao === 'cetico');
  return {
    ...agregado,
    grau: grauConfianca(agregado.confianca),
    ceticoRefutou: !!cetico?.preocupa,
  };
}

// ─── O parecer dos QUATRO, para a tela ───────────────────────────────────────

/** Teto do argumento guardado por agente. 400 chars cabem a frase inteira do parecer real. */
export const ARGUMENTO_GRAVADO_MAX = 400;

export type ParecerDeAgente = {
  dimensao: DimensaoAvaliacao;
  /** O agente vê problema? É o que separa "Preocupa" de "Sem ressalva" na tela. */
  preocupa: boolean;
  /** O PORQUÊ, dele. Vazio só quando o voto não tem motivo (tranquilo determinístico). */
  argumento: string;
  confianca: number | null;
};

function cortar400(s: string): string {
  const t = (s ?? '').trim();
  return t.length > ARGUMENTO_GRAVADO_MAX ? `${t.slice(0, ARGUMENTO_GRAVADO_MAX - 1)}…` : t;
}

/**
 * O parecer dos **QUATRO** agentes, na ordem canônica da mesa — PURA.
 *
 * ⚠️ **Por que existe.** O que a ficha mostrava era `projeto_avaliacao.motivo`, e esse campo é
 * `conciliado.motivos.join('\n')`, que só carrega o argumento de **quem PREOCUPOU**. Efeitos, os
 * dois relatados pelo Luis em 08/09/2026: (1) o veredito de cada agente era invisível — só se via
 * a objeção de alguns; (2) o número de linhas MUDAVA entre uma abertura e outra da ficha, porque
 * cada corrida do cron sobrescreve o campo com os preocupados DAQUELA rodada ("vi vários porquês,
 * depois só 2"). E o `votos` gravado guardava `{dimensao, preocupa, confianca}` **sem o
 * argumento**, então o porquê dos tranquilos era descartado na gravação: não havia como mostrar os
 * 4 sem mudar a persistência. É esta função que passa a ser gravada.
 *
 * Funciona nos DOIS modos: com a mesa LLM ligada usa o argumento raciocinado de cada especialista;
 * sem ela, o `motivo` que o voto determinístico já redige.
 */
export function montarPareceresDaMesa(v: {
  fte: { implausivel: boolean; motivo: string | null };
  financeiro: { veredito: string; motivo: string | null; confianca: number };
  rag: { apoio: boolean; motivo: string | null; confianca: number };
  cetico: { refuta: boolean; motivo: string | null; confianca: number };
  julgamentos?: JulgamentoEspecialista[] | null;
}): ParecerDeAgente[] {
  const porDim = new Map((v.julgamentos ?? []).map((j) => [j.dimensao, j]));
  const det: Record<DimensaoAvaliacao, { preocupa: boolean; motivo: string | null; confianca: number | null }> = {
    fte: { preocupa: v.fte.implausivel, motivo: v.fte.motivo, confianca: null },
    financeiro: { preocupa: v.financeiro.veredito !== 'ok', motivo: v.financeiro.motivo, confianca: v.financeiro.confianca },
    rag: { preocupa: !v.rag.apoio, motivo: v.rag.motivo, confianca: v.rag.confianca },
    cetico: { preocupa: v.cetico.refuta, motivo: v.cetico.motivo, confianca: v.cetico.confianca },
  };
  return DIMENSOES.map((dim) => {
    const llm = porDim.get(dim);
    if (llm) {
      return {
        dimensao: dim,
        preocupa: llm.preocupa,
        argumento: cortar400(llm.argumento ?? ''),
        confianca: typeof llm.confianca === 'number' ? llm.confianca : null,
      };
    }
    const d = det[dim];
    return { dimensao: dim, preocupa: d.preocupa, argumento: cortar400(d.motivo ?? ''), confianca: d.confianca };
  });
}
