/**
 * Avaliadores por LENTE (T3 do painel de agentes) — parte PURA separada da chamada de LLM.
 *
 * ## Por que lentes DISTINTAS e não N cópias do mesmo prompt
 * N cópias do mesmo juiz concordam por construção: a "convergência" mede o prompt, não o projeto.
 * Aqui cada lente recebe **só os critérios do seu eixo** (importados da régua, `CRITERIOS` —
 * ⚠️ **não redigitar a régua aqui**) e uma lista explícita do que ela **NÃO** julga. Duas lentes
 * discordando é informação; duas cópias concordando é teatro.
 *
 * ## Por que a nota de cada lente é um TETO, não um voto
 * Cada lente responde uma pergunta só: **"qual a nota mais alta da régua que ESTE eixo sustenta?"**
 * Isso é o que permite consolidar sem MÉDIA — e a média é justamente o defeito medido do juiz de
 * hoje: no T1 o viés agregado deu −0,06 (leria como calibrado) escondendo **COMPRESSÃO PARA O
 * MEIO** (0★ humano → +1,94; 7★ humano → −7). Média de N lentes FABRICA essa compressão: lente 0
 * + lente 4 = 2, exatamente o erro que se quer matar. Ver `consolidarLentes`.
 *
 * ## O eixo estrutural é GATE, não mais uma opinião
 * A régua é conjuntiva no topo (3★ = "inteligência no fluxo **+** recorrência **+** evidência **+**
 * adoção") e a `DERRUBA` é toda ela sobre o eixo estrutural (peça única, POC, sem ponteiro nem
 * contrafactual → 0–1). Então `recorrencia_rastro` é **teto** das outras: sem recorrência com
 * ponteiro nomeado, complexidade técnica não compra nota. Isso ataca o achado 3 do T1 — **12 dos
 * 17 zeros humanos saíram do zero** com o agente único.
 *
 * ⚠️ Este módulo **não grava nada** e **não reescala a rodada** (isso é o T4, que é cross-projeto).
 * ⚠️ Nada aqui toca a coluna "Estrelas" — invariante do projeto inteiro.
 */
import { llmChat } from "@/lib/llm";
import {
  NIVEIS,
  CRITERIOS,
  DERRUBA,
  NOTA_MAX,
  CURVA_BASE,
  TOTAL_AUDITADO,
  type Confianca,
} from "@/lib/especiais-regua";
import { montarBlocoFewShot, type Vizinho } from "@/lib/especial-corpus";
import { definicaoFuncao, rotuloFuncao } from "@/lib/especiais-funcao";
import { extrairJson, type AlvoClassificacao } from "@/lib/agents/especial-classificador";

// ─── As lentes (declaradas; os critérios vêm da régua por TÍTULO) ──────────────

/**
 * Critérios que TODA lente vê: eles não são um eixo de valor, são o modo de LER o memorial
 * (honestidade conta a favor; sem R$ a estrela é o único pagamento). Numa lente só, as outras
 * três julgariam um especial como se fosse um projeto financeiro.
 */
export const CRITERIOS_GLOBAIS = ["Qualidade de execução", "Especiais"] as const;

export type Lente = {
  chave: string;
  rotulo: string;
  /** A pergunta ÚNICA da lente — é ela que a torna diferente das outras. */
  pergunta: string;
  /** Títulos de `CRITERIOS` (régua) que esta lente julga. */
  criterios: string[];
};

/** A lente estrutural: teto das outras (ver o cabeçalho e `consolidarLentes`). */
export const LENTE_GATE = "recorrencia_rastro";

export const LENTES: Lente[] = [
  {
    chave: LENTE_GATE,
    rotulo: "Recorrência, rastro e contrafactual",
    pergunta:
      "Isto roda de novo sozinho, existe um lugar NOMEADO onde conferir o ponteiro, e alguém nomeado sente falta se desligar?",
    criterios: ["Recorrência real", "Rastreabilidade", "Contrafactual"],
  },
  {
    chave: "complexidade_autonomia",
    rotulo: "Complexidade e autonomia",
    pergunta:
      "O quanto o sistema DECIDE? Onde ele cai na escada automação < inteligência (IA no fluxo) < autonomia (decide e age sozinho)?",
    criterios: ["Complexidade técnica"],
  },
  {
    chave: "alcance_reuso",
    rotulo: "Alcance e reuso",
    pergunta:
      "Quantas pessoas de fora do autor usam isto de fato, e o quanto ele foi reusado em outro time, área, marca ou no grupo?",
    criterios: ["Alcance e reuso"],
  },
  {
    chave: "risco_evitado",
    rotulo: "Risco evitado",
    pergunta:
      "Que risco fiscal, jurídico, financeiro ou de segurança deixou de existir, e o quanto ele era material?",
    criterios: ["Risco evitado"],
  },
];

/** O que uma lente NÃO julga — os eixos das OUTRAS lentes, derivados, nunca redigitados. */
export function outrosEixos(chave: string): string[] {
  return LENTES.filter((l) => l.chave !== chave).map((l) => l.rotulo);
}

export function lentePorChave(chave: string): Lente | null {
  return LENTES.find((l) => l.chave === chave) ?? null;
}

// ─── Saída de uma lente ────────────────────────────────────────────────────────

/**
 * O quanto o eixo está PROVADO no material — não é a confiança do modelo, é a qualidade da prova:
 * `nomeada` (dá para ir conferir, com nome próprio) · `vaga` (afirmado sem onde) · `ausente`.
 */
export type Evidencia = "nomeada" | "vaga" | "ausente";

export type AvaliacaoLente = {
  lente: string;
  /** A nota mais alta da régua que ESTE eixo sustenta (0..NOTA_MAX). */
  nota: number;
  evidencia: Evidencia;
  confianca: Confianca;
  /** Por que este eixo para nesta nota — 1 a 3 frases. */
  justificativa: string;
  /** O trecho do material que sustenta a nota. Vazio = alegação sem prova (ver o guard). */
  sustentacao: string;
};

// ─── Prompt (montado da régua — fonte única) ───────────────────────────────────

function textoDosCriterios(titulos: readonly string[]): string {
  return CRITERIOS.filter((c) => titulos.includes(c.titulo))
    .map((c) => `- ${c.titulo}: ${c.texto}`)
    .join("\n");
}

function descreverNiveis(): string {
  return NIVEIS.map((n) => `${n.nota} — ${n.titulo}: ${n.definicao}`).join("\n");
}

function descreverCurva(): string {
  return Object.entries(CURVA_BASE)
    .filter(([k]) => k !== "vazio")
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([nota, qtd]) => `${nota}★: ${qtd} (${((qtd / TOTAL_AUDITADO) * 100).toFixed(1)}%)`)
    .join(" · ");
}

export function buildSystemPromptLente(lente: Lente): string {
  return `Você é UM avaliador de um painel que julga projetos ESPECIAIS do GoDocs. Você olha UM eixo só — «${lente.rotulo}» — e mais nada.

SUA PERGUNTA ÚNICA:
${lente.pergunta}

SEUS CRITÉRIOS (só estes):
${textoDosCriterios(lente.criterios)}

COMO LER QUALQUER MEMORIAL (vale para todas as lentes):
${textoDosCriterios(CRITERIOS_GLOBAIS)}

VOCÊ NÃO JULGA (outra lente do painel cuida, e opinar aqui atrapalha a consolidação):
${outrosEixos(lente.chave)
  .map((r) => `- ${r}`)
  .join("\n")}

O QUE VOCÊ DEVOLVE:
A nota MAIS ALTA da régua 0–${NOTA_MAX} que o SEU eixo sustenta — um TETO vindo do seu eixo, não um voto médio. Se o seu eixo sustenta 2, diga 2 mesmo que o projeto pareça impressionante por outro motivo: o outro motivo não é seu.

A RÉGUA (âncoras de cada nível):
${descreverNiveis()}

O QUE DERRUBA para 0–1, por melhor que o memorial esteja:
${DERRUBA.map((d) => `- ${d}`).join("\n")}

A CURVA REAL DA BASE (644 projetos) — sua régua contra inflação:
${descreverCurva()}
≥3★ é top 4% da base; ≥5★ é top 1%. Na dúvida entre duas faixas, fique na MENOR.

DISCIPLINA:
- Notas INTEIRAS.
- "Vai reduzir", "uso esperado", "resultado projetado" NÃO é uso real — trate como POC.
- O próprio entregável (o dashboard, o CSV, o documento que o projeto gera) NÃO é ponteiro de uso recorrente nem prova de alcance.
- Admitir limite no memorial conta A FAVOR.
- Se o seu eixo simplesmente NÃO se aplica a este projeto (ex.: não há risco nenhum a evitar), devolva nota 0 com evidencia "ausente" e diga isso na justificativa. Isso é resposta CORRETA, não falha — outra lente sustenta o projeto.
- Os projetos vizinhos vêm com a nota GLOBAL deles (todos os eixos juntos). Use como âncora de MAGNITUDE — "um projeto assim vale 4 na base inteira" — nunca como a resposta do seu eixo.

FORMATO — responda APENAS com JSON válido, sem texto fora do JSON:
{
  "nota": <inteiro 0 a ${NOTA_MAX}>,
  "evidencia": "nomeada" | "vaga" | "ausente",
  "confianca": "alta" | "media" | "baixa",
  "justificativa": "<1 a 3 frases: por que o seu eixo para nesta nota>",
  "sustentacao": "<o trecho do material que sustenta a nota, copiado. Vazio se não houver trecho nenhum.>"
}
"evidencia": use "nomeada" SÓ quando houver nome próprio de relatório, painel, base, sistema, time ou pessoa em que se possa ir conferir — e copie esse trecho em "sustentacao". Sem trecho, é "vaga" ou "ausente".`;
}

export function buildUserMessageLente(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  funcaoChave?: string | null,
): string {
  const dados = {
    projeto: {
      nome: alvo.nome,
      area: alvo.area,
      ferramenta: alvo.ferramenta,
      tipos: alvo.tipos,
      por_que_e_especial: alvo.contexto_especial,
      descricao: alvo.descricao,
      submetido_em: alvo.submetido_em,
      memorial_ou_doc: alvo.memorial || alvo.doc || null,
    },
  };
  // A FUNÇÃO (T2) entra como "o que este grupo faz" — contexto, nunca mérito. ⚠️ Dentro de uma
  // mesma função as notas humanas vão de 0 a 10 (medido no T2): função NÃO prevê nota, e dizer
  // isso no prompt evita que a lente leia o grupo como pedigree.
  const funcao = funcaoChave
    ? `GRUPO DE FUNÇÃO DESTE PROJETO: ${rotuloFuncao(funcaoChave)} — ${definicaoFuncao(funcaoChave) ?? ""}
(⚠️ o grupo diz o que o projeto FAZ, não o quanto ele vale: dentro do mesmo grupo há projetos de 0 e de 10 estrelas.)

`
    : "";

  return `${funcao}PROJETOS ESPECIAIS PARECIDOS JÁ AVALIADOS (a nota deles é GLOBAL — âncora de magnitude):
${montarBlocoFewShot(vizinhos)}

PROJETO A AVALIAR:
${JSON.stringify(dados, null, 2)}

Responda pela SUA lente apenas.`;
}

// ─── Normalização + guards determinísticos ─────────────────────────────────────

const CONFIANCAS: Confianca[] = ["alta", "media", "baixa"];
const EVIDENCIAS: Evidencia[] = ["nomeada", "vaga", "ausente"];

/** Piso de tamanho para um trecho contar como trecho, e não como um "sim" solto. */
export const MIN_SUSTENTACAO = 12;

/**
 * Normaliza a saída crua de uma lente. Dois guards que não são cosméticos:
 * - **`nomeada` sem trecho copiado vira `vaga`**: alegar fonte é grátis, copiar o trecho não é —
 *   é a mesma régua do `[1.4]` (substantivo de fonte, não verbo de verificação);
 * - evidência/confiança inválidas caem no valor CONSERVADOR (`ausente`/`baixa`), nunca no otimista.
 *
 * `null` quando não há nota utilizável — o painel trata como lente FALTANDO, nunca como nota 0.
 */
export function normalizarAvaliacaoLente(bruto: unknown, lente: string): AvaliacaoLente | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const notaCrua = Number(o.nota);
  if (!Number.isFinite(notaCrua)) return null;
  const nota = Math.max(0, Math.min(NOTA_MAX, Math.round(notaCrua)));

  const sustentacao = typeof o.sustentacao === "string" ? o.sustentacao.trim() : "";
  let evidencia: Evidencia = EVIDENCIAS.includes(o.evidencia as Evidencia)
    ? (o.evidencia as Evidencia)
    : "ausente";
  if (evidencia === "nomeada" && sustentacao.length < MIN_SUSTENTACAO) evidencia = "vaga";

  const confianca: Confianca = CONFIANCAS.includes(o.confianca as Confianca)
    ? (o.confianca as Confianca)
    : "baixa";

  const justCrua = typeof o.justificativa === "string" ? o.justificativa.trim() : "";

  return {
    lente,
    nota,
    evidencia,
    confianca,
    justificativa: justCrua || "Sem justificativa — a lente não explicou a nota.",
    sustentacao,
  };
}

/** Teto de uma lente que não achou prova nenhuma do próprio eixo. */
export const TETO_SEM_EVIDENCIA = 1;

/**
 * Eixo sem prova não sustenta nota: `evidencia: 'ausente'` limita a nota da própria lente a
 * `TETO_SEM_EVIDENCIA`. Sem isso, "provavelmente roda todo mês" compra 3★ — e foi assim que o
 * agente único promoveu 12 dos 17 zeros humanos (achado 3 do T1).
 */
export function aplicarTetoSemEvidencia(av: AvaliacaoLente): AvaliacaoLente {
  if (av.evidencia !== "ausente" || av.nota <= TETO_SEM_EVIDENCIA) return av;
  return { ...av, nota: TETO_SEM_EVIDENCIA, confianca: "baixa" };
}

// ─── Consolidação PURA (sem média, de propósito) ───────────────────────────────

/**
 * Quanto uma lente de VALOR pode passar do teto estrutural — e só quando o gate tem prova
 * NOMEADA. Gate sem prova nomeada não empresta margem nenhuma (a `DERRUBA` diz 0–1 nesse caso).
 */
export const MARGEM_ACIMA_DO_GATE = 1;

export type Consolidado = {
  nota_preliminar: number;
  /** A nota da lente estrutural (`null` se ela falhou — aí não há teto). */
  gate: number | null;
  gate_evidencia: Evidencia | null;
  /** Teto imposto pelo gate (`null` quando o gate não respondeu). */
  teto: number | null;
  /** A maior nota entre as lentes de VALOR (não-gate). */
  valor_max: number;
  /** Lentes declaradas que não responderam nesta rodada. */
  faltando: string[];
  /** Como a nota saiu, em uma linha — vai para a leitura e para o revisor do T5. */
  explicacao: string;
};

/**
 * Consolida as lentes de UM projeto **sem média**:
 * 1. cada lente já passou por `aplicarTetoSemEvidencia`;
 * 2. `teto` = nota do gate + (`MARGEM_ACIMA_DO_GATE`, só se o gate tem prova nomeada);
 * 3. `nota_preliminar` = min(teto, max(gate, maior nota das lentes de valor)).
 *
 * O passo 3 é DISJUNTIVO para cima (a régua diz que 4★ = "reuso multi-área **OU** risco material
 * **OU** ganho estrutural" — um eixo forte basta) e CONJUNTIVO no gate (nada sobe sem recorrência
 * com ponteiro). ⚠️ **Não trocar por média/mediana**: média de lente 0 com lente 4 devolve 2, que
 * é exatamente a compressão para o meio medida no T1 (viés −0,06 escondendo 0★→+1,94 e 7★→−7).
 *
 * Gate ausente (a lente falhou) → sem teto: usa o max das que responderam e diz isso na
 * `explicacao`. Nenhuma lente → nota 0, com a explicação de que ninguém julgou. Nunca lança.
 */
export function consolidarLentes(avaliacoes: AvaliacaoLente[]): Consolidado {
  const porChave = new Map(avaliacoes.map((a) => [a.lente, a]));
  const faltando = LENTES.filter((l) => !porChave.has(l.chave)).map((l) => l.chave);

  const gateAv = porChave.get(LENTE_GATE) ?? null;
  const valor = avaliacoes.filter((a) => a.lente !== LENTE_GATE);
  const valor_max = valor.length ? Math.max(...valor.map((a) => a.nota)) : 0;

  if (!gateAv) {
    const nota = avaliacoes.length ? Math.max(...avaliacoes.map((a) => a.nota)) : 0;
    return {
      nota_preliminar: nota,
      gate: null,
      gate_evidencia: null,
      teto: null,
      valor_max,
      faltando,
      explicacao: avaliacoes.length
        ? `lente estrutural não respondeu — sem teto; nota = maior lente (${nota})`
        : "nenhuma lente respondeu — nota 0 por ausência de julgamento, não por demérito",
    };
  }

  const margem = gateAv.evidencia === "nomeada" ? MARGEM_ACIMA_DO_GATE : 0;
  const teto = Math.min(NOTA_MAX, gateAv.nota + margem);
  const bruta = Math.max(gateAv.nota, valor_max);
  const nota_preliminar = Math.min(teto, bruta);

  const explicacao =
    nota_preliminar < bruta
      ? `eixo de valor sustentava ${bruta}, mas o estrutural para em ${gateAv.nota} (prova ${gateAv.evidencia}) → teto ${teto}`
      : `estrutural ${gateAv.nota} (prova ${gateAv.evidencia}) e maior eixo de valor ${valor_max} → ${nota_preliminar}`;

  return {
    nota_preliminar,
    gate: gateAv.nota,
    gate_evidencia: gateAv.evidencia,
    teto,
    valor_max,
    faltando,
    explicacao,
  };
}

// ─── Chamada de LLM (uma por lente) ────────────────────────────────────────────

export type OpcoesLente = {
  funcao?: string | null;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Roda UMA lente. Devolve `null` se o modelo não deu JSON utilizável — o painel trata como lente
 * faltando (`Consolidado.faltando`), nunca como nota 0.
 */
export async function avaliarPorLente(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  lente: Lente,
  opts: OpcoesLente = {},
): Promise<AvaliacaoLente | null> {
  const raw = await llmChat(
    [
      { role: "system", content: buildSystemPromptLente(lente) },
      { role: "user", content: buildUserMessageLente(alvo, vizinhos, opts.funcao) },
    ],
    { jsonMode: true, temperature: opts.temperature ?? 0.1, maxTokens: opts.maxTokens ?? 700 },
  );
  const av = normalizarAvaliacaoLente(extrairJson(raw), lente.chave);
  return av ? aplicarTetoSemEvidencia(av) : null;
}

export type ResultadoLentes = {
  avaliacoes: AvaliacaoLente[];
  falhas: { lente: string; motivo: string }[];
  consolidado: Consolidado;
};

/**
 * Roda as lentes escolhidas em PARALELO e consolida. ⚠️ Lente que falha (rede, JSON ilegível) não
 * derruba as outras e não vira nota 0 — vira `falhas` + `Consolidado.faltando`, para o T7 poder
 * distinguir "o painel julgou baixo" de "o painel não julgou".
 *
 * `opts.lentes` permite medir com 2, 3 ou 4 lentes sem tocar no código — é a decisão que o plano
 * deixou para a medição ("se 2 lentes já batem o baseline, 4 é dinheiro fora").
 */
export async function avaliarComLentes(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  opts: OpcoesLente & { lentes?: string[] } = {},
): Promise<ResultadoLentes> {
  const escolhidas = opts.lentes?.length
    ? LENTES.filter((l) => opts.lentes!.includes(l.chave))
    : LENTES;

  const saidas = await Promise.all(
    escolhidas.map(async (l) => {
      try {
        const av = await avaliarPorLente(alvo, vizinhos, l, opts);
        return av
          ? { av, falha: null }
          : { av: null, falha: { lente: l.chave, motivo: "sem JSON utilizável" } };
      } catch (e) {
        return {
          av: null,
          falha: { lente: l.chave, motivo: e instanceof Error ? e.message : "erro" },
        };
      }
    }),
  );

  const avaliacoes = saidas.map((s) => s.av).filter((a): a is AvaliacaoLente => a != null);
  const falhas = saidas
    .map((s) => s.falha)
    .filter((f): f is { lente: string; motivo: string } => f != null);

  return { avaliacoes, falhas, consolidado: consolidarLentes(avaliacoes) };
}
