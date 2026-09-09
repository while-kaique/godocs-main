/**
 * Orquestração do TIME AUTÔNOMO DE AVALIAÇÃO de projetos NORMAIS (fatia B) — server-side.
 *
 * Amarra os especialistas do time e o juiz:
 *   • RAG por corpus de APROVADOS (aprende do veredito HUMANO): embeddings (`embeddings.ts`) +
 *     `selecionarVizinhos` (`especial-corpus.ts`) sobre a tabela `projeto_embedding`;
 *   • Plausibilidade/FTE (`avaliarPlausibilidadeFTE`, fatia A);
 *   • Financeiro (`avaliarFinanceiro`);
 *   • Agregador/juiz (`agregarVotos`) → grava a recomendação em `projeto_avaliacao`.
 *
 * ⚠️ **MODO SOMBRA, env-gated DEFAULT OFF** (`AVALIACAO_NORMAIS`): com a flag desligada, TUDO
 * aqui é NO-OP — não gera embedding, não chama a OpenAI, não grava nada (não muda o comportamento
 * de prod). Ligada, calcula e GRAVA a recomendação + confiança, mas **NUNCA muda o status/veredito
 * do projeto** — a decisão segue sendo a de `decidirStatusSubmissao`. Plugar no status é fase
 * posterior, depois de o Luis validar a sombra.
 *
 * ⚠️ Tabelas SEPARADAS das `especial_*` (não atropela a peça do Kaique). NO-OP para especiais.
 * ⚠️ Embeddings SEMPRE direto na OpenAI (o proxy não expõe `/embeddings`) — `embeddings.ts` cuida.
 * ⚠️ Envs lidas LAZY. Nunca lança no caminho de background.
 */
import {
  getProjetoById,
  getDocumentacao,
  getProjetoContextoData,
  getDocumentacaoConteudo,
  getEmbeddingProjeto,
  getEmbeddingsProjetos,
  upsertEmbeddingProjeto,
  getIdsAvaliacoesNormais,
  upsertAvaliacaoNormal,
  upsertDeliberacao,
  getDeliberacoesAbertas,
  parseJson,
  type ProjetoEmbeddingRow,
  type ProjetoRow,
} from '@/integrations/db/client.server';
import { lerResumosEspelho } from '@/lib/sheet-espelho';
import { chaveProjeto } from '@/lib/projeto-chave';
import {
  mapResumo,
  numero,
  texto,
  type ProjetoDashboardResumo,
} from '@/lib/dashboard-resumo';
import type { SheetRow } from '@/lib/google/sheets';
import { ehLideranca } from '@/lib/areas/teamguide.server';
import type { DocumentacaoGerada } from '@/lib/agents/types';
import {
  gerarEmbeddingsLote,
  base64ParaVetor,
  vetorParaBase64,
  embeddingConfig,
} from '@/lib/embeddings';
import {
  textoParaEmbedding,
  hashTexto,
  selecionarVizinhos,
  type EntradaSemantica,
  type ExemplarEspecial,
} from '@/lib/especial-corpus';
import { avaliarPlausibilidadeFTE, fatorFtePlausibilidade, HORAS_BASE_FTE } from '@/lib/agents/analyzer';
import {
  avaliarFinanceiro,
  TETO_MATERIALIDADE_FINANCEIRO,
} from '@/lib/agents/avaliacao-financeira';
import {
  redigirJustificativa,
  redatorJustificativaLigado,
} from '@/lib/agents/redator-justificativa.functions';
import type { FatosJustificativa } from '@/lib/agents/redator-justificativa';
import {
  agregarVotos,
  avaliarSinalRag,
  type VeredictoAgregado,
} from '@/lib/agents/agregador-avaliacao';
import { avaliarCetico } from '@/lib/agents/cetico-avaliacao';
import { conciliarComCetico, avancarDeliberacao } from '@/lib/deliberacao';
import {
  avaliacaoNormaisAtiva,
  selecionarAprovadosNormais,
  montarCorpusNormais,
} from '@/lib/avaliacao-corpus';
import {
  julgarComEspecialista,
  especialistasMesaLlmLigados,
} from '@/lib/agents/especialista-avaliacao.functions';
import {
  montarEntradasEspecialistas,
  conciliarJulgamentos,
  montarPareceresDaMesa,
  type VotosDeterministicos,
} from '@/lib/agents/mesa-especialistas';
import { carregarCorrecoesDaTriagem, licoesParaPrompt } from '@/lib/correcoes.functions';
import { FAIXA_ESCAPE } from '@/lib/estrelas-regua';
import type { Correcao } from '@/lib/correcoes';
import type {
  JulgamentoEspecialista,
  TextoProjeto,
} from '@/lib/agents/especialista-avaliacao';
import { reportarFalhaDeAgente } from '@/lib/agentes-falhas';

/** Carimbo de origem gravado em cada recomendação (distingue do que possa vir depois). */
export const ORIGEM_AGREGADOR = 'agregador-normais';

/** A flag `AVALIACAO_NORMAIS` está ligada? Lida LAZY (nunca em escopo de módulo). Default OFF. */
export function avaliacaoNormaisLigada(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return avaliacaoNormaisAtiva(env?.AVALIACAO_NORMAIS);
}

// ─── Texto semântico do projeto (mesma forma do classificador de especiais) ────
// ⚠️ Espelha os helpers PRIVADOS de `especial-classificador.functions.ts` de propósito: fundi-los
// obrigaria a tocar a peça do Kaique (o plano manda NÃO atropelar). São ~2 helpers curtos.

function oQueFazDoc(conteudoJson: string | null | undefined): string | null {
  if (!conteudoJson) return null;
  const doc = parseJson<DocumentacaoGerada>(conteudoJson);
  const t = doc?.o_que_faz?.trim();
  return t || null;
}

function resumoDocParaTexto(conteudoJson: string | null | undefined): string | null {
  if (!conteudoJson) return null;
  const doc = parseJson<DocumentacaoGerada>(conteudoJson);
  if (!doc) return null;
  const partes: string[] = [];
  if (doc.o_que_faz) partes.push(doc.o_que_faz);
  if (doc.execucao) partes.push(doc.execucao);
  if (Array.isArray(doc.fluxo) && doc.fluxo.length) {
    partes.push(doc.fluxo.map((f) => `${f.etapa}: ${f.descricao}`).join('\n'));
  }
  if (Array.isArray(doc.atencao) && doc.atencao.length) {
    partes.push(doc.atencao.map((a) => `${a.titulo}: ${a.descricao}`).join('\n'));
  }
  const txt = partes.join('\n').trim();
  return txt || null;
}

async function montarEntradaSemanticaNormal(
  projetoId: string,
  resumo?: ProjetoDashboardResumo,
): Promise<EntradaSemantica | null> {
  // Mesma armadilha do classificador de especiais: id de legado vem MAIÚSCULO da planilha e a
  // linha em `projetos` é minúscula — ler cru devolve `ctx` nulo e o dossiê fica só com o resumo.
  const chave = chaveProjeto(projetoId);
  const ctx = await getProjetoContextoData(chave);
  const docRow = await getDocumentacaoConteudo(chave);
  if (!ctx && !resumo) return null;
  return {
    nome: ctx?.nome ?? resumo?.nome ?? null,
    o_que_faz: oQueFazDoc(docRow?.conteudo),
    area: ctx?.area_nome ?? ctx?.area ?? resumo?.area ?? null,
    descricao: ctx?.descricao_breve ?? null,
    memorial: ctx?.memorial_calculo ?? null,
    doc: resumoDocParaTexto(docRow?.conteudo),
  };
}

// ─── Embeddings (mesma disciplina do classificador: gera só o que mudou) ────────

type MapaEmbedding = Map<
  string,
  { vetor: number[]; modelo: string; dim: number; hash: string | null }
>;

function decodificarEmbeddings(rows: ProjetoEmbeddingRow[]): MapaEmbedding {
  const mapa: MapaEmbedding = new Map();
  for (const r of rows) {
    try {
      mapa.set(r.projeto_id, {
        vetor: base64ParaVetor(r.vetor),
        modelo: r.modelo,
        dim: r.dim,
        hash: r.texto_hash,
      });
    } catch {
      // vetor corrompido: ignora (o backfill regrava)
    }
  }
  return mapa;
}

/**
 * Garante embedding FRESCO (hash do texto bate + mesmo modelo) para os `ids`. Gera em lote só o
 * que falta ou mudou, grava em `projeto_embedding` e devolve o mapa atualizado. Bounded por
 * `capGeracao` (custo + tempo do cron). Nunca lança.
 */
async function garantirEmbeddings(
  ids: string[],
  resumoPorId: Map<string, ProjetoDashboardResumo>,
  embeddings: MapaEmbedding,
  opts: { capGeracao?: number } = {},
): Promise<{ mapa: MapaEmbedding; gerados: number }> {
  const cap = opts.capGeracao ?? 40;
  const modeloAlvo = embeddingConfig()?.modelo;
  const pendentes: { id: string; texto: string; hash: string }[] = [];

  for (const id of ids) {
    if (pendentes.length >= cap) break;
    const entrada = await montarEntradaSemanticaNormal(id, resumoPorId.get(id));
    if (!entrada) continue;
    const texto = textoParaEmbedding(entrada);
    if (!texto) continue;
    const hash = hashTexto(texto);
    const atual = embeddings.get(id);
    const frescoTexto = atual != null && atual.hash === hash;
    const frescoModelo = atual != null && (!modeloAlvo || atual.modelo === modeloAlvo);
    if (frescoTexto && frescoModelo) continue;
    pendentes.push({ id, texto, hash });
  }

  let gerados = 0;
  const CHUNK = 64;
  for (let i = 0; i < pendentes.length; i += CHUNK) {
    const lote = pendentes.slice(i, i + CHUNK);
    const vetores = await gerarEmbeddingsLote(lote.map((p) => p.texto));
    for (let j = 0; j < lote.length; j++) {
      const emb = vetores[j];
      const p = lote[j];
      if (!emb) continue;
      await upsertEmbeddingProjeto({
        projeto_id: p.id,
        modelo: emb.modelo,
        dim: emb.dim,
        vetor: vetorParaBase64(emb.vetor),
        texto_hash: p.hash,
      });
      embeddings.set(p.id, { vetor: emb.vetor, modelo: emb.modelo, dim: emb.dim, hash: p.hash });
      gerados++;
    }
  }
  return { mapa: embeddings, gerados };
}

function embMapDe(mapa: MapaEmbedding): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const [id, e] of mapa) m.set(id, e.vetor);
  return m;
}

// ─── Avaliação de UM projeto (dado o contexto já carregado) ────────────────────

export type ResultadoAvaliacaoNormal = {
  ok: boolean;
  projeto_id: string;
  motivo?: string;
  veredito?: VeredictoAgregado;
  confianca?: number;
  aplicar?: boolean;
  divergencia?: boolean;
  vizinhos?: number;
  gravado?: boolean;
};

type ContextoAvaliacao = {
  dry: boolean;
  resumoPorId: Map<string, ProjetoDashboardResumo>;
  /**
   * A LINHA recortada do espelho, por id — de onde a mesa lê o financeiro da **v2**.
   *
   * ⚠️ **Existe porque a mesa estava CEGA ao dinheiro.** Ela lia
   * `documentacao.conteudo.saving` (vocabulário v1, do SQLite): projeto v2 não tem aqueles
   * campos e legado que só vive na planilha não tem `documentacao` nenhuma, então
   * `materialidade` dava 0, o financeiro devolvia "sem dados financeiros" e o piso de impacto
   * nunca disparava. Medido no retroativo de prod (08/09/2026): **41,4% de erro grave** — o
   * agente aprovando o que a triagem reprovou, porque não via número.
   * ⚠️ Vem das MESMAS `linhas` que o `resumoPorId` já consome (`lerResumosEspelho`): **zero I/O
   * novo**. E fica FORA de `ProjetoDashboardResumo` de propósito — campo que a tabela não desenha
   * não viaja no payload da listagem (gotcha 4 do dashboard).
   */
  linhaPorId: Map<string, SheetRow>;
  /** Corpus de aprovados JÁ montado — construído UMA vez pelo chamador (não por candidato). */
  corpus: ExemplarEspecial[];
  embeddings: MapaEmbedding;
  /**
   * As correções que a triagem já fez — carregadas UMA vez, como o corpus.
   *
   * ⚠️ Mora aqui e não dentro de `computarVotos` porque `computarVotos` roda EM LAÇO (por
   * candidato do lote e por deliberação aberta): a consulta ao log seria idêntica em todas as
   * iterações. É a mesma régua do corpus logo acima, e a do gotcha "a listagem não faz I/O por
   * projeto — agregue no SQL".
   *
   * ⚠️ **OBRIGATÓRIO de propósito.** Nasceu opcional e isso escondeu o defeito: o caminho de UM
   * projeto (`avaliarProjetoNormal`, o que roda em TODA submissão real pelo
   * `processarPosSubmissao`) não o preenchia, então a lição chegava ao cron e **nunca** à
   * submissão — sem log, sem campo, sem sinal. Campo obrigatório força cada construtor de
   * contexto a decidir; lista vazia é decisão explícita.
   */
  correcoes: Correcao[];
};

/** Votos crus dos especialistas + juiz + cético (SEM I/O de escrita). Reusado pelo painel, pela
 *  deliberação e pelo retroativo — computar uma vez, gravar onde cada caminho precisa. */
export type VotosPainel = {
  fte: ReturnType<typeof avaliarPlausibilidadeFTE>;
  financeiro: ReturnType<typeof avaliarFinanceiro>;
  rag: ReturnType<typeof avaliarSinalRag>;
  cetico: ReturnType<typeof avaliarCetico>;
  agregado: ReturnType<typeof agregarVotos>;
  /** Conciliação EFETIVA: LLM (`conciliarJulgamentos`) quando `AVALIACAO_MESA_LLM` ligado, senão o
   *  determinístico (`conciliarComCetico`). As duas formas são o mesmo `ResultadoConciliado`. */
  conciliado: ReturnType<typeof conciliarComCetico>;
  vizinhos: number;
  ehLider: boolean;
  /** Pareceres RACIOCINADOS dos especialistas LLM — só quando `AVALIACAO_MESA_LLM` ligado (senão
   *  `undefined`, e a mesa é byte-idêntica à determinística de hoje). */
  julgamentos?: JulgamentoEspecialista[];
  /** O cético EFETIVO refuta? Julgamento LLM do cético (`.preocupa`) quando ligado; senão o voto
   *  determinístico (`cetico.refuta`). É o sinal que a deliberação consome. */
  ceticoRefuta: boolean;
};

/**
 * Materialidade da MESA (sombra): ganho total mensal = saving líquido + receita ÷ 10.
 * Espelha `ganhoTotalMensal` (`chat.functions.ts`): o saving entra CHEIO (`economia_reais_mes`
 * já é líquido — inclui custo evitado e abate custo externo) e a receita bruta
 * (`valor_ganho_mensal`) aplica o ÷10 (fator de equivalência). É a magnitude que o Financeiro
 * pondera contra o teto — ⚠️ SÓ na mesa/sombra: NÃO é o gate REAL do analyzer
 * (`analyzer.ts` / `calcularMaterialidade`), que segue com a receita crua (Decisão 3).
 */
export function materialidadeMesa(
  economiaReaisMes: number | null,
  valorReceita: number | null,
): number {
  return (economiaReaisMes ?? 0) + (valorReceita ?? 0) / 10;
}

/**
 * Indexa as linhas do espelho por id, tolerante a caixa (legado vem em MAIÚSCULA da planilha e o
 * app grava hex minúsculo). PURA.
 */
export function mapaDeLinhas(linhas: SheetRow[]): Map<string, SheetRow> {
  const m = new Map<string, SheetRow>();
  for (const l of linhas) {
    const id = texto((l as Record<string, string>)['ID Projeto']);
    if (id) m.set(id.trim().toLowerCase(), l);
  }
  return m;
}

/**
 * O financeiro do projeto, com a ponte **v1 → v2**. PURA.
 *
 * ⚠️ **É o fix de 08/09/2026.** A mesa lia só `documentacao.conteudo.saving` (v1, do SQLite):
 * projeto v2 não tem aqueles campos, legado que só vive na planilha não tem `documentacao`, e o
 * resultado era `materialidade = 0` → financeiro "sem dados" → **o piso nunca disparava**. No
 * retroativo de prod isso deu **41,4% de erro grave** (12 de 29): o agente aprovando o que a
 * triagem reprovou, porque não via número nenhum.
 *
 * ⚠️ **A ordem é a PLANILHA primeiro, o v1 do SQLite só como rede** (corrigido em 09/09/2026).
 * A 1ª versão deste fix fazia o contrário — "v1 primeiro, quando existe" — e isso mantinha o piso
 * inerte nos projetos que ele existe para pegar: a v2 PONDERA as horas no `Impacto Líquido Mensal`
 * (7,5h liberadas viram R$ 19,96), enquanto o `economia_reais_mes` da v1 conta a hora pelo valor
 * CHEIO (~R$ 200 no mesmo projeto). Ou seja: o número v1 é ~10× o v2 e passava longe do piso de
 * R$ 100. Medido no retroativo de prod: **os 11 `erro_grave` que sobraram eram todos** impacto v2
 * entre R$ 19,96 e R$ 90,61, nota 0 e Status **Reprovado** — a régua composta devia ter reprovado
 * os 11, e não reprovou nenhum. Régua e número tinham de sair da MESMA fonte.
 *
 * ⚠️ A planilha é a fonte da verdade do repo, e as 4 colunas financeiras da v2 estão **100%
 * preenchidas** (745 de 745 linhas de prod em 09/09/2026) — o `?? v1` é rede para a linha que
 * perdesse a coluna, não caminho normal.
 *
 * ⚠️ **`Impacto Líquido Mensal` é a coluna do PISO**, não `Impacto Líquido`: foi ela que a rodada
 * de 04/09 usou (136 dos 137 batem ao centavo), e as duas divergem em projeto que não é mensal.
 */
export function financeiroDoProjeto(
  saving: Record<string, unknown> | undefined,
  receita: Record<string, unknown> | undefined,
  linha: SheetRow | undefined,
): {
  horas: number;
  economiaReaisMes: number | null;
  custoEvitado: number | null;
  valorReceita: number | null;
  temSaving: boolean;
  temReceita: boolean;
} {
  const cel = (nome: string) => (linha as Record<string, string> | undefined)?.[nome];
  const linhasHoras =
    (saving?.linhas as Array<{ economia_horas_mes?: number | null }> | undefined) ?? [];
  const horasV1 =
    typeof saving?.economia_horas_mes === 'number'
      ? (saving.economia_horas_mes as number)
      : linhasHoras.reduce((s, l) => s + (Number(l?.economia_horas_mes) || 0), 0);
  // v2: as horas humanas liberadas vivem em `Custo Evitado Horas` (a v2 chama de "custo evitado"
  // o braço de HORAS; o `Saving Efetivado` é a despesa que parou). Ver `coluna-chave.ts`.
  const horasV2 = numero(cel('Custo Evitado Horas'));
  const horas = horasV2 != null && horasV2 > 0 ? horasV2 : horasV1;

  const economiaV1 =
    typeof saving?.economia_reais_mes === 'number' ? (saving.economia_reais_mes as number) : null;
  const custoV1 =
    typeof saving?.custo_evitado_reais === 'number' ? (saving.custo_evitado_reais as number) : null;
  const receitaV1 =
    typeof receita?.valor_ganho_mensal === 'number' ? (receita.valor_ganho_mensal as number) : null;

  const categorias = (texto(cel('Tipos de Ganho')) ?? '').toLowerCase();
  return {
    horas,
    economiaReaisMes: numero(cel('Impacto Líquido Mensal')) ?? economiaV1,
    custoEvitado: numero(cel('Saving Efetivado')) ?? custoV1,
    valorReceita: numero(cel('Receita Incremental')) ?? receitaV1,
    temSaving: !!saving || /saving|custo evitado/.test(categorias),
    temReceita: !!receita || /receita/.test(categorias),
  };
}

/**
 * Roda a MESA completa sobre um projeto JÁ carregado (não especial): FTE + Financeiro + RAG →
 * Agregador → Cético → conciliação. PURO de efeito colateral (só LÊ doc/TeamGuide); NÃO grava.
 */
async function computarVotos(projeto: ProjetoRow, ctx: ContextoAvaliacao): Promise<VotosPainel> {
  const projetoId = projeto.id;

  // Fluxo direto de liderança → isento (fail-to-false: TeamGuide fora → segue a régua normal).
  let ehLider = false;
  try {
    ehLider = await ehLideranca(projeto.responsavel_email ?? '');
  } catch {
    ehLider = false;
  }

  const docRow = await getDocumentacao(projetoId);
  const conteudo = (parseJson<Record<string, unknown>>(docRow?.conteudo ?? '{}') ?? {}) as Record<
    string,
    unknown
  >;
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  // O financeiro com a ponte v1 → v2 (`financeiroDoProjeto`): sem ela a mesa fica CEGA ao
  // dinheiro em todo projeto da v2 e em todo legado que só vive na planilha.
  const linhaEspelho =
    ctx.linhaPorId.get(projetoId.trim().toLowerCase()) ?? ctx.linhaPorId.get(projetoId);
  const fin = financeiroDoProjeto(saving, receita, linhaEspelho);

  // ⚠️ O SINAL do bug de 08/09/2026, para ele nunca voltar calado: se NADA do financeiro chegou
  // (nem horas, nem impacto, nem despesa que parou, nem receita), o especialista financeiro vai
  // responder "sem dados" e **o piso de impacto não dispara** — foi assim que a mesa aprovou o
  // que a triagem reprovou em 41,4% dos casos. Projeto de ganho IMENSURÁVEL é o caso legítimo
  // disso, e é por isso que a checagem exige a linha do espelho existir: sem linha nenhuma o
  // problema é outro (id que não casa), e ele tem o próprio caminho.
  if (
    linhaEspelho &&
    projeto.especial !== 1 &&
    fin.horas === 0 &&
    fin.economiaReaisMes == null &&
    fin.custoEvitado == null &&
    fin.valorReceita == null
  ) {
    reportarFalhaDeAgente({
      classe: 'dossie_sem_financeiro',
      onde: 'avaliacao-normais.computarVotos',
      projetoId,
      detalhe: 'a linha do espelho existe mas nenhum número financeiro chegou ao especialista',
    });
  }

  // ── Voto FTE (Plausibilidade) ──
  const membros = parseJson<string[]>((projeto.membros as string | null) ?? null) ?? [];
  const horas = fin.horas;
  const fte = avaliarPlausibilidadeFTE({
    horasTotais: horas,
    pessoasDeclaradas: membros.length + 1, // + o autor (não entra em `membros`)
    temMultiplo: saving?.teto_pessoa === 'multiplo',
    especial: projeto.especial === 1,
    fluxoDireto: ehLider,
    fator: fatorFtePlausibilidade(),
  });

  // ── Voto Financeiro ──
  const { economiaReaisMes, custoEvitado, valorReceita } = fin;
  const materialidade = materialidadeMesa(economiaReaisMes, valorReceita);
  // A NOTA entra no financeiro porque a reprovação por impacto é COMPOSTA: só reprova ganho
  // irrelevante quando o projeto também é baixo. Preferimos a nota HUMANA; sem ela, a recomendada
  // pelo agente.
  //
  // ⚠️ `"6-10"` NÃO é número: `Number("6-10")` é NaN, e NaN cairia em "sem nota", que **reprova**.
  // Então a faixa de escape é traduzida para o piso dela (6) — ela é justamente o caso que mais
  // precisa ser poupado.
  const resumoDoProjeto = ctx.resumoPorId.get(projetoId) ?? ctx.resumoPorId.get(projetoId.toLowerCase());
  const estrelaProjeto = ((): number | null => {
    const humana = resumoDoProjeto?.estrelas;
    if (typeof humana === 'number' && Number.isFinite(humana)) return humana;
    const bruta = (resumoDoProjeto?.estrelaAgente ?? '').trim();
    if (!bruta) return null;
    if (bruta.includes('-')) return FAIXA_ESCAPE.min;
    const n = Number(bruta);
    return Number.isFinite(n) ? n : null;
  })();
  const financeiro = avaliarFinanceiro({
    // v2: quem declara as categorias é a coluna "Tipos de Ganho" (o `documentacao.saving` da v1
    // não existe lá) — sem isto, `temDados` era falso e o financeiro nem chegava às checagens.
    temSaving: fin.temSaving,
    temReceita: fin.temReceita,
    economiaReaisMes,
    economiaHorasMes: horas,
    custoEvitadoReais: custoEvitado,
    valorReceitaMensal: valorReceita,
    materialidade,
    estrela: estrelaProjeto,
  });

  // ── Voto RAG (vizinhos aprovados) — corpus JÁ montado no contexto (fora do laço) ──
  const alvo = ctx.embeddings.get(projetoId);
  const vizinhosArr = alvo
    ? selecionarVizinhos(alvo.vetor, ctx.corpus, { excluirId: projetoId })
    : [];
  const rag = avaliarSinalRag(vizinhosArr);

  // ── Juiz preliminar ──
  const agregado = agregarVotos({
    fte,
    financeiro,
    rag,
    especial: projeto.especial === 1,
    fluxoDireto: ehLider,
  });

  // ── Cético (adversarial) + conciliação — a rede anti-bajulação da fatia C ──
  const cetico = avaliarCetico({
    agregadoVeredito: agregado.veredito,
    fte: { implausivel: fte.implausivel, fte: fte.fte, pessoas: fte.pessoas },
    financeiro: { veredito: financeiro.veredito, confianca: financeiro.confianca },
    rag: {
      apoio: rag.apoio,
      confianca: rag.confianca,
      vizinhos: rag.vizinhos,
      topSimilaridade: rag.topSimilaridade,
    },
    fator: fatorFtePlausibilidade(),
  });
  const conciliadoDet = conciliarComCetico(agregado, cetico);

  // ── Especialistas LLM (opt-in `AVALIACAO_MESA_LLM`) — cada voto determinístico vira a ENTRADA de
  // um agente que o ARGUMENTA/contesta com o texto real do projeto (Decisão 2: sinal, não piso). O
  // resultado é conciliado na MESMA forma (`ResultadoConciliado`). ⚠️ DEFAULT OFF → byte-idêntico à
  // sombra determinística que roda em prod hoje (`AVALIACAO_NORMAIS` ligado, mesa LLM desligada).
  let conciliado = conciliadoDet;
  let ceticoRefuta = cetico.refuta;
  let julgamentos: JulgamentoEspecialista[] | undefined;
  if (especialistasMesaLlmLigados()) {
    const entrada = await montarEntradaSemanticaNormal(projetoId, ctx.resumoPorId.get(projetoId));
    // Texto SEM R$ escondido do usuário (o `motivo` do voto é o único que pode citar valor, e ele já
    // fala do ganho TOTAL, não de valor/hora por cargo — ver `serializarVotos`/`montarEntradas`).
    const texto: TextoProjeto = {
      nome: entrada?.nome ?? '',
      area: entrada?.area ?? '',
      descricao: entrada?.descricao ?? '',
      o_que_faz: entrada?.o_que_faz ?? '',
      memorial: entrada?.memorial ?? '',
      doc: entrada?.doc ?? '',
    };
    const vizinhosTexto = vizinhosArr.map((v) => [v.nome, v.area].filter(Boolean).join(', '));
    // As LIÇÕES da triagem — o que gente corrigiu na recomendação do agente, e por quê. Os ids
    // dos vizinhos que o RAG acabou de recuperar entram para a correção de um projeto PARECIDO
    // vir primeiro (é ela que ensina; a mais recente é só a mais recente).
    // ⚠️ Aqui não há I/O: `licoesParaPrompt` é PURA. A rede de falha está em
    // `carregarCorrecoesDaTriagem`, que nunca lança e devolve `[]` — sem lição, a mesa julga como
    // julgava antes. Material didático não pode derrubar um parecer.
    const licoes = licoesParaPrompt(ctx.correcoes, projetoId, vizinhosArr);
    const votosDet: VotosDeterministicos = { fte, financeiro, rag, cetico };
    const entradas = montarEntradasEspecialistas(votosDet, texto, vizinhosTexto, licoes);
    // `julgarComEspecialista` NUNCA lança (fail-safe → voto determinístico daquela dimensão), então
    // um agente que falhe não derruba a mesa nem o lote de background.
    julgamentos = await Promise.all(entradas.map(julgarComEspecialista));
    conciliado = conciliarJulgamentos(julgamentos, {
      especial: projeto.especial === 1,
      fluxoDireto: ehLider,
      // Piso de impacto: mecânico, a MESMA régua da mesa determinística (D4) — a COMPOSTA.
      reprovavel: financeiro.reprovavel,
      motivoPiso: financeiro.motivo,
    });
    // Cético EFETIVO = o parecer do agente cético (preocupou?); sem ele (não deveria faltar), o
    // determinístico. É o sinal `ceticoRefuta` que a deliberação lê.
    ceticoRefuta = julgamentos.find((j) => j.dimensao === 'cetico')?.preocupa ?? cetico.refuta;
  }

  return {
    fte,
    financeiro,
    rag,
    cetico,
    agregado,
    conciliado,
    vizinhos: vizinhosArr.length,
    ehLider,
    julgamentos,
    ceticoRefuta,
  };
}

/**
 * Serializa os votos para a coluna de auditoria `votos` (sem R$ cru — só veredito/confiança).
 *
 * ⚠️ **Byte-idêntico com a mesa LLM OFF**: `julgamentos` só entra quando os especialistas LLM
 * rodaram (`v.julgamentos?.length`); sem eles a chave nem aparece — a auditoria de hoje segue igual.
 * ⚠️ O parecer LLM entra ENXUTO (`dimensao`/`preocupa`/`confianca`/`origem`): o `argumento` já vive
 * no `motivo` da avaliação (que a ficha mostra), e repeti-lo aqui só arriscaria vazar texto; nenhum
 * R$ cru é serializado.
 */
export function serializarVotos(v: VotosPainel): string {
  return JSON.stringify({
    fte: v.fte,
    financeiro: { veredito: v.financeiro.veredito, confianca: v.financeiro.confianca },
    rag: {
      apoio: v.rag.apoio,
      confianca: v.rag.confianca,
      vizinhos: v.rag.vizinhos,
      topSimilaridade: Number(v.rag.topSimilaridade.toFixed(3)),
    },
    cetico: { refuta: v.cetico.refuta, confianca: v.cetico.confianca, sinais: v.cetico.sinais },
    grau: v.conciliado.grau,
    ceticoRefutou: v.conciliado.ceticoRefutou,
    // ⚠️ O parecer dos QUATRO, com o ARGUMENTO de cada um — inclusive dos tranquilos. Sem isto a
    // ficha só conseguia mostrar quem objetou (e só na rodada mais recente), que era a queixa do
    // Luis em 08/09/2026. Ver `montarPareceresDaMesa`. Fica só no `votos` da linha do PROJETO: a
    // listagem não o carrega (teto de 32 MiB de RPC / gotcha 4 do dashboard).
    pareceres: montarPareceresDaMesa(v),
    ...(v.julgamentos?.length
      ? {
          julgamentos: v.julgamentos.map((j) => ({
            dimensao: j.dimensao,
            preocupa: j.preocupa,
            confianca: j.confianca,
            origem: j.origem,
          })),
        }
      : {}),
  });
}

/**
 * Traduz os votos da mesa em FATOS DETERMINÍSTICOS para o REDATOR (Frente 2). Só passa números que
 * a mesa realmente computou; os motivos concretos (com R$) vão nos `apontamentos` — o redator é
 * proibido de inventar qualquer outro valor. Sem materialidade crua aqui (ela vive no motivo do
 * financeiro), então não a repassamos como número solto.
 */
function montarFatosJustificativa(v: VotosPainel): FatosJustificativa {
  const apontamentos: FatosJustificativa['apontamentos'] = [];
  if (v.fte.implausivel && v.fte.motivo) {
    apontamentos.push({ especialista: 'Plausibilidade (FTE)', motivo: v.fte.motivo });
  }
  if (v.financeiro.veredito !== 'ok' && v.financeiro.motivo) {
    apontamentos.push({ especialista: 'Financeiro', motivo: v.financeiro.motivo });
  }
  if (!v.rag.apoio && v.rag.motivo) {
    apontamentos.push({ especialista: 'Semelhança com aprovados', motivo: v.rag.motivo });
  }
  if (v.cetico.refuta && v.cetico.motivo) {
    apontamentos.push({ especialista: 'Revisor cético', motivo: v.cetico.motivo });
  }
  if (apontamentos.length === 0 && v.conciliado.divergencia) {
    apontamentos.push({ especialista: 'Mesa', motivo: 'Sinais divergentes entre os especialistas.' });
  }
  return {
    fte: v.fte.fte > 0 ? v.fte.fte : null,
    horasTotais: v.fte.fte > 0 ? Math.round(v.fte.fte * HORAS_BASE_FTE) : null,
    pessoasDeclaradas: v.fte.pessoas,
    tetoMaterialidade: v.financeiro.veredito !== 'ok' ? TETO_MATERIALIDADE_FINANCEIRO : null,
    apontamentos,
  };
}

/** Núcleo: avalia com o corpus/embeddings JÁ carregados (evita reler a cada candidato no backfill). */
async function avaliarComContexto(
  projetoId: string,
  ctx: ContextoAvaliacao,
): Promise<ResultadoAvaliacaoNormal> {
  const projeto = await getProjetoById(projetoId);
  if (!projeto) return { ok: false, projeto_id: projetoId, motivo: 'projeto não encontrado' };
  if (projeto.especial === 1) {
    return { ok: true, projeto_id: projetoId, motivo: 'especial, NO-OP', gravado: false };
  }

  const votos = await computarVotos(projeto, ctx);
  const { conciliado } = votos;
  // Modo mesa-LLM: os especialistas raciocinaram este turno. `conciliado.motivos` JÁ é o parecer
  // argumentado dos agentes (via `conciliarJulgamentos`), então NÃO passa pelo redator (que
  // reescreveria os FATOS determinísticos por cima do raciocínio). OFF → `undefined` → caminho de
  // sempre.
  const modoLlm = !!votos.julgamentos?.length;

  // Motivo determinístico de sempre (comportamento padrão). Só quando a Frente 2 (redator) está
  // LIGADA, a mesa LLM está DESLIGADA e a mesa manda para conferência humana, humaniza a mensagem
  // com o LLM leve — fail-safe interno cai neste mesmo motivo. DEFAULT OFF = byte-idêntico ao de hoje.
  // Uma linha por especialista (o agregador já marcou cada frase com o autor) — a ficha renderiza
  // como bullets. Parágrafo corrido fazia dois pareceres sobre a MESMA dúvida parecerem repetição.
  let motivoFinal = conciliado.motivos.join('\n');
  if (conciliado.aplicarEmValidacao && redatorJustificativaLigado() && !modoLlm) {
    motivoFinal = await redigirJustificativa(montarFatosJustificativa(votos));
  }

  let gravado = false;
  if (!ctx.dry) {
    const modelo = embeddingConfig()?.modelo ?? 'deterministico';
    await upsertAvaliacaoNormal({
      projeto_id: projetoId,
      veredito: conciliado.veredito,
      confianca: conciliado.confianca,
      aplicar: conciliado.aplicarEmValidacao,
      divergencia: conciliado.divergencia,
      motivo: motivoFinal,
      votos: serializarVotos(votos),
      origem: ORIGEM_AGREGADOR,
      modelo,
    });

    // Abre a DELIBERAÇÃO a partir dos votos deste turno (rodada 1). Consenso encerra na hora;
    // divergência/confiança baixa/refuta do cético deixa `deliberando` para o cron avançar.
    const delib = avancarDeliberacao(
      { estado: null, rodada: 0 },
      {
        agregadoVeredito: conciliado.veredito,
        divergencia: conciliado.divergencia,
        confianca: conciliado.confianca,
        ceticoRefuta: votos.ceticoRefuta,
      },
    );
    await upsertDeliberacao({
      projeto_id: projetoId,
      estado: delib.estado,
      rodada: delib.rodada,
      veredito: delib.veredito,
      confianca: delib.confianca,
      grau: delib.grau,
      encerrada: delib.encerrada,
      motivo: delib.motivo,
      // Rodada 1 ABRE a deliberação: substitui (sem append). Cada entrada carrega a confiança da
      // rodada. Com a mesa LLM ligada, o histórico guarda o PARECER argumentado (`motivoFinal`); sem
      // ela, o motivo determinístico da rodada — como sempre.
      historico: JSON.stringify([
        {
          rodada: delib.rodada,
          estado: delib.estado,
          confianca: delib.confianca,
          motivo: modoLlm ? motivoFinal : delib.motivo,
        },
      ]),
      origem: ORIGEM_AGREGADOR,
    });
    gravado = true;
  }

  return {
    ok: true,
    projeto_id: projetoId,
    veredito: conciliado.veredito,
    confianca: conciliado.confianca,
    aplicar: conciliado.aplicarEmValidacao,
    divergencia: conciliado.divergencia,
    vizinhos: votos.vizinhos,
    motivo: motivoFinal,
    gravado,
  };
}

// ─── Um projeto (rota manual / disparo) ────────────────────────────────────────

/**
 * Avalia UM projeto normal. Carrega o espelho + os embeddings, garante o embedding do alvo e
 * roda os especialistas + juiz. `dry` não grava. Respeita a flag (OFF → NO-OP).
 */
export async function avaliarProjetoNormal(
  projetoIdBruto: string,
  opts: { dry?: boolean } = {},
): Promise<ResultadoAvaliacaoNormal> {
  // ⚠️ **Chave CANÔNICA na entrada (09/09/2026).** A planilha guarda legado em MAIÚSCULA
  // (`LEGADO-057`) e o sync reverso cria a linha do `projetos` em minúscula — e o `=` do SQLite é
  // sensível a caixa. Sem normalizar, `getProjetoById('LEGADO-057')` devolve nada e a mesa
  // responde **"projeto não encontrado"**.
  //
  // Medido em prod: `legado-057` reprovava pelo piso corretamente e `LEGADO-057` dava "não
  // encontrado" — o mesmo projeto. E o id que a TELA manda vem do espelho, ou seja **como está na
  // planilha**: o lote da triagem falharia calado em TODO legado. O classificador da estrela já
  // normalizava (`classificarEspecialProjeto`); a mesa era o leitor que ficou de fora da régua de
  // `projeto-chave.ts`.
  const projetoId = chaveProjeto(projetoIdBruto);
  if (!avaliacaoNormaisLigada()) {
    return { ok: false, projeto_id: projetoId, motivo: 'AVALIACAO_NORMAIS desligado (modo sombra OFF)' };
  }

  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const resumoPorId = new Map(resumos.map((p) => [p.id, p]));

  // Corpus + alvo numa leitura só da tabela de embeddings; garante o alvo fresco (cap 1).
  const embAlvo = await getEmbeddingProjeto(projetoId);
  const embeddings = decodificarEmbeddings(await getEmbeddingsProjetos());
  if (embAlvo && !embeddings.has(projetoId)) {
    for (const [id, e] of decodificarEmbeddings([embAlvo])) embeddings.set(id, e);
  }
  const ger = await garantirEmbeddings([projetoId], resumoPorId, embeddings, { capGeracao: 1 });

  const corpus = montarCorpusNormais(selecionarAprovadosNormais(resumos), embMapDe(ger.mapa));
  // ⚠️ Caminho de UM projeto (pós-submissão): aqui NÃO há laço, então a versão com I/O é a certa.
  // Sem esta linha a submissão real julgaria sem lição enquanto o cron julgava com — foi o defeito
  // que o campo opcional escondia.
  const correcoes = await carregarCorrecoesDaTriagem('avaliacao-normais');
  return avaliarComContexto(projetoId, {
    dry: opts.dry ?? false,
    resumoPorId,
    linhaPorId: mapaDeLinhas(linhas),
    corpus,
    embeddings: ger.mapa,
    correcoes,
  });
}

// ─── Disparo pós-submissão (worker — 3ª promise do processarPosSubmissao) ───────

/**
 * Chamado no worker logo após a submissão, EM PARALELO com a análise e a classificação de
 * especiais. NO-OP se a flag está OFF ou se o projeto é especial. Nunca lança.
 */
export async function avaliarProjetoNormalEmBackground(projetoId: string): Promise<void> {
  if (!avaliacaoNormaisLigada()) return; // gate OFF → NO-OP total (não toca OpenAI nem banco)
  try {
    const p = await getProjetoById(projetoId);
    if (!p || p.especial === 1) return; // NO-OP para especiais
    await avaliarProjetoNormal(projetoId, { dry: false });
  } catch (e) {
    console.error('[avaliacao-normais] falha em background:', e);
  }
}

// ─── Loader de contexto compartilhado (espelho + embeddings + corpus) ──────────

type ContextoCarregado = {
  ctx: ContextoAvaliacao;
  resumos: ProjetoDashboardResumo[];
  aprovados: ReturnType<typeof selecionarAprovadosNormais>;
  gerados: number;
};

/**
 * Lê o espelho, garante os embeddings do corpus (aprovados) + dos `idsAlvo`, e monta o contexto
 * da mesa UMA vez. Reusado pelo backfill, pela deliberação e pelo retroativo (não reler a cada
 * candidato). Bounded por `capGeracao`.
 */
export async function carregarContextoPainel(
  idsAlvo: string[],
  opts: { dry: boolean; capGeracao?: number },
): Promise<ContextoCarregado> {
  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const resumoPorId = new Map(resumos.map((p) => [p.id, p]));
  const linhaPorId = mapaDeLinhas(linhas);
  const aprovados = selecionarAprovadosNormais(resumos);

  let embeddings = decodificarEmbeddings(await getEmbeddingsProjetos());
  const idsEmbeddar = Array.from(new Set([...idsAlvo, ...aprovados.map((a) => a.id)]));
  const ger = await garantirEmbeddings(idsEmbeddar, resumoPorId, embeddings, {
    capGeracao: opts.capGeracao ?? 60,
  });
  embeddings = ger.mapa;
  const corpus = montarCorpusNormais(aprovados, embMapDe(embeddings));
  // As lições da triagem, UMA vez para o lote inteiro (ver o campo no `ContextoAvaliacao`).
  // Nunca lança: sem correções, a mesa julga como julgava.
  const correcoes = await carregarCorrecoesDaTriagem('avaliacao-normais');

  return {
    ctx: { dry: opts.dry, resumoPorId, linhaPorId, corpus, embeddings, correcoes },
    resumos,
    aprovados,
    gerados: ger.gerados,
  };
}

/**
 * Roda a mesa sobre UM projeto (já carregado ou por id) com o contexto dado, SEM gravar. Usado
 * pelo retroativo (compara a recomendação com o humano) e pela deliberação (fresca a cada rodada).
 * Devolve os votos conciliados ou null (projeto ausente/especial).
 */
export async function computarVotosDoProjeto(
  projetoId: string,
  ctx: ContextoAvaliacao,
): Promise<VotosPainel | null> {
  const projeto = await getProjetoById(projetoId);
  if (!projeto || projeto.especial === 1) return null;
  return computarVotos(projeto, ctx);
}

// ─── Backfill / cron irmão (idempotente, bounded) ──────────────────────────────

export type ResultadoBackfillNormais = {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  candidatos: number;
  embeddings_gerados: number;
  avaliados: number;
  resultados: ResultadoAvaliacaoNormal[];
  motivo?: string;
};

/**
 * Rede do disparo pós-submissão: avalia os normais SEM recomendação e (idempotente) mantém os
 * embeddings do corpus de aprovados em dia. Bounded por `limite` (converge em várias corridas).
 * `dry` é o DEFAULT (gravar exige {dry:false}). Respeita a flag (OFF → NO-OP).
 */
export async function avaliarProjetosNormaisPendentes(
  opts: { dry?: boolean; limite?: number } = {},
): Promise<ResultadoBackfillNormais> {
  if (!avaliacaoNormaisLigada()) {
    return {
      ok: true,
      ligado: false,
      dry: true,
      candidatos: 0,
      embeddings_gerados: 0,
      avaliados: 0,
      resultados: [],
      motivo: 'AVALIACAO_NORMAIS desligado (modo sombra OFF)',
    };
  }
  const dry = opts.dry ?? true;
  const limite = opts.limite ?? 15;

  // Uma leitura do espelho só para selecionar os candidatos (sem gerar embedding ainda).
  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const jaAvaliados = new Set(await getIdsAvaliacoesNormais());
  // Candidatos = normais NÃO especiais, já submetidos (têm status na planilha) e sem avaliação.
  const candidatos = resumos
    .filter((p) => !p.especial && p.statusChave != null && !jaAvaliados.has(p.id))
    .slice(0, limite);

  if (candidatos.length === 0) {
    return {
      ok: true,
      ligado: true,
      dry,
      candidatos: 0,
      embeddings_gerados: 0,
      avaliados: 0,
      resultados: [],
      motivo: 'nenhum projeto normal pendente de avaliação',
    };
  }

  const { ctx, gerados } = await carregarContextoPainel(candidatos.map((c) => c.id), {
    dry,
    capGeracao: 60,
  });

  const resultados: ResultadoAvaliacaoNormal[] = [];
  let avaliados = 0;
  for (const cand of candidatos) {
    try {
      const r = await avaliarComContexto(cand.id, ctx);
      resultados.push(r);
      if (r.ok && r.gravado) avaliados++;
    } catch (e) {
      resultados.push({
        ok: false,
        projeto_id: cand.id,
        motivo: e instanceof Error ? e.message : 'erro',
      });
    }
  }

  return {
    ok: true,
    ligado: true,
    dry,
    candidatos: candidatos.length,
    embeddings_gerados: gerados,
    avaliados,
    resultados,
  };
}

// ─── Deliberação: cron que avança as mesas ABERTAS (fatia C, MODO SOMBRA) ───────

export type ResultadoDeliberacaoBackfill = {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  abertas: number;
  avancadas: number;
  encerradas: number;
  resultados: { projeto_id: string; estado: string; rodada: number; encerrada: boolean }[];
  motivo?: string;
};

/**
 * Avança UMA rodada de cada deliberação ABERTA (`estado='deliberando'`). Idempotente e bounded por
 * `limite`. Re-roda a mesa (fresca — o corpus de aprovados pode ter crescido) e aplica o reducer
 * `avancarDeliberacao`. Consenso/nao_consenso encerram. NUNCA muda o status do projeto (sombra).
 */
export async function avancarDeliberacoesPendentes(
  opts: { dry?: boolean; limite?: number } = {},
): Promise<ResultadoDeliberacaoBackfill> {
  if (!avaliacaoNormaisLigada()) {
    return {
      ok: true,
      ligado: false,
      dry: true,
      abertas: 0,
      avancadas: 0,
      encerradas: 0,
      resultados: [],
      motivo: 'AVALIACAO_NORMAIS desligado (modo sombra OFF)',
    };
  }
  const dry = opts.dry ?? true;
  const limite = opts.limite ?? 10;

  const abertas = await getDeliberacoesAbertas(limite);
  if (abertas.length === 0) {
    return {
      ok: true,
      ligado: true,
      dry,
      abertas: 0,
      avancadas: 0,
      encerradas: 0,
      resultados: [],
      motivo: 'nenhuma deliberação aberta',
    };
  }

  // Contexto com os alvos abertos + o corpus de aprovados.
  const { ctx } = await carregarContextoPainel(
    abertas.map((a) => a.projeto_id),
    { dry, capGeracao: 40 },
  );

  const resultados: ResultadoDeliberacaoBackfill['resultados'] = [];
  let avancadas = 0;
  let encerradas = 0;
  for (const aberta of abertas) {
    try {
      const votos = await computarVotosDoProjeto(aberta.projeto_id, ctx);
      // Sinais da rodada: se o projeto sumiu/virou especial, encerra por falta de base.
      const sinais = votos
        ? {
            agregadoVeredito: votos.conciliado.veredito,
            divergencia: votos.conciliado.divergencia,
            confianca: votos.conciliado.confianca,
            ceticoRefuta: votos.ceticoRefuta,
          }
        : {
            agregadoVeredito: 'em_validacao' as const,
            divergencia: false,
            confianca: 0,
            ceticoRefuta: false,
          };
      const delib = avancarDeliberacao(
        { estado: 'deliberando', rodada: aberta.rodada },
        sinais,
      );
      if (!dry) {
        await upsertDeliberacao({
          projeto_id: aberta.projeto_id,
          estado: delib.estado,
          rodada: delib.rodada,
          veredito: delib.veredito,
          confianca: delib.confianca,
          grau: delib.grau,
          encerrada: delib.encerrada,
          motivo: delib.motivo,
          // Cada rodada do cron ANEXA sua entrada ao histórico (preserva as anteriores). Com a mesa
          // LLM ligada, a entrada guarda o PARECER argumentado desta rodada (os agentes re-raciocinam
          // a cada corrida); sem ela, o motivo determinístico — como sempre.
          historico: JSON.stringify([
            {
              rodada: delib.rodada,
              estado: delib.estado,
              confianca: delib.confianca,
              motivo: votos?.julgamentos?.length ? votos.conciliado.motivos.join('\n') : delib.motivo,
            },
          ]),
          origem: ORIGEM_AGREGADOR,
          apendarHistorico: true,
        });
      }
      avancadas++;
      if (delib.encerrada) encerradas++;
      resultados.push({
        projeto_id: aberta.projeto_id,
        estado: delib.estado,
        rodada: delib.rodada,
        encerrada: delib.encerrada,
      });
    } catch (e) {
      resultados.push({
        projeto_id: aberta.projeto_id,
        estado: 'erro',
        rodada: aberta.rodada,
        encerrada: false,
      });
      console.error('[avaliacao-normais] deliberação falhou:', e);
    }
  }

  return { ok: true, ligado: true, dry, abertas: abertas.length, avancadas, encerradas, resultados };
}
