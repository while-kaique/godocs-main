/**
 * Agente CLASSIFICADOR de projetos ESPECIAIS (a "peça 4") — recomenda a estrela 0–10.
 *
 * O que ele faz e o que NÃO faz:
 * - PROPÕE uma nota + a leitura que a justifica, gravada em `especial_avaliacao` (origem `agente`).
 * - **NUNCA grava a coluna "Estrelas" da planilha** — a nota só muda por clique de gente. Ele é
 *   um segundo par de olhos calibrado, não a decisão.
 *
 * Como ele fica "preciso": recebe os VIZINHOS semânticos (especiais já avaliados parecidos, via
 * embeddings — `especial-corpus.ts`) como exemplos few-shot, e a régua + a curva real da base
 * (`especiais-regua.ts`, FONTE ÚNICA — não redigitar aqui). A curva é dura de propósito: ≥3 é
 * top 4% da base, então uma rodada generosa demais é bug da régua, não mérito dos projetos.
 *
 * ⚠️ Structured Outputs está MORTA no proxy (Codex ignora `response_format`/`json_schema`), então
 * usamos `jsonMode` + parser defensivo por regex, o mesmo padrão do `analyzer.ts`.
 */
import { llmChat } from '@/lib/llm';
import { type Confianca } from '@/lib/especiais-regua';
// ⚠️ **A ESCALA vem de `estrelas-regua.ts` — a MESMA fonte única que o time de avaliação
// (`src/lib/avaliacao/`) usa.** Antes este agente lia `NIVEIS`/`CRITERIOS`/`DERRUBA` da
// `especiais-regua`, uma escala CIRCULAR ("10 = topo absoluto") e sem faixa 6–10: por isso,
// em 734 projetos, NUNCA houve um 6★ nem um 9★ — o escape não existia como coisa alcançável.
// ⚠️ E não criar uma régua "v2 dos especiais": foi tentado em 03/09/2026 e produziu DOIS
// arquivos com a mesma escala. Se a régua mudar, muda em `estrelas-regua.ts` e os dois
// caminhos (este agente e o time) andam juntos.
import {
  NOTA_MAX,
  FAIXA_ESCAPE,
  GATILHOS_ESCAPE,
  descreverReguaAgente,
  descreverEscape,
  escapeValido,
  ehEscape,
  type ChaveGatilhoEscape,
} from '@/lib/estrelas-regua';
// ⚠️ A curva de referência deste agente é a dos ESPECIAIS, não a da base inteira — ver o
// comentário de `descreverCurva`. `CURVA_BASE`/`TOTAL_AUDITADO` saíram do import de
// propósito: enquanto estiverem à mão, alguém as recoloca no prompt sem perceber.
import { CURVA_ESPECIAIS_AUDITADOS } from '@/lib/especiais-calibrador';
import { montarBlocoFewShot, type Vizinho } from '@/lib/especial-corpus';

export type RecomendacaoEspecial = {
  estrelas_recomendada: number;
  confianca: Confianca;
  /** Por que esta faixa · por que não sobe · o que faria subir. */
  leitura: string;
  /**
   * A nota caiu na faixa 6–10 e, por decisão de produto, **quem crava o número é gente**.
   * Não é "suspeita": é o encaminhamento normal do escape.
   */
  contestada: boolean;
  /** Uma citação da doc POR GATILHO do escape. Vazio fora da faixa 6–10. */
  evidencias: Partial<Record<ChaveGatilhoEscape, string>>;
  /** O que o guard determinístico mexeu, se mexeu (só rebaixa, nunca promove). */
  ajuste_guard: string | null;
};

/** O projeto-alvo, já resolvido do banco pelo orquestrador (`.functions.ts`). */
export type AlvoClassificacao = {
  projeto_id: string;
  nome: string | null;
  area: string | null;
  ferramenta: string | null;
  tipos: string | null;
  contexto_especial: string | null;
  descricao: string | null;
  memorial: string | null;
  doc: string | null;
  submetido_em: string | null;
};

// ─── Prompt (montado da régua — fonte única) ───────────────────────────────────

/**
 * ⚠️ **A curva é a dos ESPECIAIS, não a da base inteira** (corrigido 03/09/2026).
 *
 * Este agente só julga projeto ESPECIAL, mas o prompt vinha mostrando a `CURVA_BASE` — a
 * distribuição dos 644 projetos, especiais e normais juntos. As duas populações não se
 * parecem: na base inteira **≥3★ é 6,2%** e **≥5★ é 1,5%**; entre os especiais auditados
 * **≥3★ é 41,7%** e **≥5★ é 12,5%**. Ou seja, o agente recebia uma âncora anti-inflação
 * SETE VEZES mais apertada do que a população que ele avalia, e a instrução "na dúvida fique
 * na faixa MENOR" transformava isso em rebaixamento sistemático — os projetos de 6–10★
 * voltavam como 5★ ou menos.
 *
 * ⚠️ **Este é o MESMO defeito que o painel de agentes já tinha encontrado e corrigido** (o
 * revisor lendo a `CURVA_BASE` refutou 17 de 17); a constante `CURVA_ESPECIAIS_AUDITADOS`
 * nasceu ali, com o aviso de que é ELA a referência de uma rodada de especiais. A correção
 * só nunca tinha chegado a este agente — que é o que roda em produção.
 *
 * ⚠️ Não trocar de volta por "a base é dura": a régua contra inflação continua existindo, só
 * que medida contra quem o agente de fato compara.
 */
function descreverCurva(): string {
  const total = Object.values(CURVA_ESPECIAIS_AUDITADOS).reduce((a, b) => a + b, 0);
  const linhas = Object.entries(CURVA_ESPECIAIS_AUDITADOS)
    .filter(([k]) => k !== 'vazio')
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([nota, qtd]) => `${nota}★: ${qtd} (${((qtd / total) * 100).toFixed(1)}%)`);
  return linhas.join(' · ');
}

/** Percentual acumulado ≥ `nota` na curva DOS ESPECIAIS — a régua que o prompt cita. */
function acimaDe(nota: number): string {
  const total = Object.values(CURVA_ESPECIAIS_AUDITADOS).reduce((a, b) => a + b, 0);
  const n = Object.entries(CURVA_ESPECIAIS_AUDITADOS)
    .filter(([k]) => /^\d+$/.test(k) && Number(k) >= nota)
    .reduce((a, [, q]) => a + q, 0);
  return `${((n / total) * 100).toFixed(0)}%`;
}

export function buildSystemPromptEspecial(): string {
  return `Você é o AUDITOR de projetos ESPECIAIS do GoDocs. Sua função é recomendar uma nota de ESTRELAS de 0 a ${NOTA_MAX} para um projeto especial, comparando-o com a régua abaixo e com os projetos já avaliados.

O QUE A ESTRELA É:
Uma nota QUALITATIVA de valor estratégico. Projetos especiais NÃO têm memorial financeiro — a estrela é o único "pagamento", então o que manda é VALOR ESTRATÉGICO + USO REAL. Nunca premie R$ ou horas com estrela (isso é contar o mesmo ganho duas vezes).

A RÉGUA:
${descreverReguaAgente()}

${descreverEscape()}

⚠️ COMO USAR OS EXEMPLOS: cada nível traz projetos REAIS já classificados. Posicione o projeto ao lado deles — "isto se parece com o Godash" é um argumento melhor do que "isto me parece um 1". Se o projeto faz o mesmo tipo de coisa que um exemplo, a nota é a daquele nível.

A CURVA DOS ESPECIAIS JÁ AUDITADOS (contexto, NÃO cota):
${descreverCurva()}
Entre os especiais, ≥3★ são ${acimaDe(3)}. ⚠️ Não confunda com a base inteira (especiais + normais), onde ≥3★ é 6%: você julga SÓ especiais, e nesta população nota alta é bem menos rara. Esta curva foi medida sob a régua ANTERIOR — use-a para não inflar em bloco, nunca como limite: se o projeto satisfaz a definição de um nível, dê aquele nível, mesmo que a curva tenha poucos ali.

DISCIPLINA:
- Prefira notas INTEIRAS.
- "Uso esperado", "resultado projetado", "vai reduzir" NÃO é uso real — trata como 0★ (Experimenta) até ter ponteiro medido.
- O próprio entregável (o dashboard, o CSV, o documento que o projeto gera) NÃO é ponteiro de uso recorrente.
- Admitir limite no memorial conta A FAVOR (honestidade), não contra.
- ⚠️ Se um VIZINHO quase idêntico (alta similaridade) tem nota bem MAIOR, IGUALE a faixa dele OU justifique a diferença ESPECÍFICA e concreta entre os dois — não desça só porque o memorial DESTE projeto veio magro. Dois projetos que fazem a mesma coisa merecem faixas próximas.

⚠️ NO ESCAPE, preencha "evidencias" com uma citação LITERAL da doc/memorial para CADA gatilho. Sem as duas citações a nota volta automaticamente para 5★ — não parafraseie, cite.

FORMATO DE RESPOSTA:
Responda APENAS com JSON válido, exatamente neste formato, sem texto fora do JSON:
{
  "estrelas_recomendada": <inteiro 0 a ${NOTA_MAX}>,
  "confianca": "alta" | "media" | "baixa",
  "leitura": "<até ~400 caracteres: por que esta faixa · por que não sobe · o que faria subir. Cite o exemplo da régua ou o projeto vizinho que ancora a comparação.>",
  "evidencias": { ${GATILHOS_ESCAPE.map((g) => `"${g.chave}": "<citação literal>"`).join(', ')} }
}
Use confiança BAIXA quando o memorial for ausente/fraco ou o uso não for comprovado (o normal em projeto recém-submetido).`;
}

export function buildUserMessageEspecial(alvo: AlvoClassificacao, vizinhos: Vizinho[]): string {
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
  return `PROJETOS ESPECIAIS PARECIDOS JÁ AVALIADOS (use como âncora — posicione o novo projeto RELATIVO a eles):
${montarBlocoFewShot(vizinhos)}

PROJETO A CLASSIFICAR:
${JSON.stringify(dados, null, 2)}

Recomende a estrela deste projeto, ancorando na régua, na curva e nos vizinhos acima.`;
}

// ─── Chamada + parse defensivo + guard ─────────────────────────────────────────

const CONFIANCAS: Confianca[] = ['alta', 'media', 'baixa'];

/** Extrai o JSON da resposta crua, tolerando cercas ```json ... ```. `null` se não der. */
export function extrairJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1].trim());
      } catch {
        /* cai fora */
      }
    }
    // Última tentativa: o primeiro objeto {...} da string.
    const chave = raw.indexOf('{');
    const fim = raw.lastIndexOf('}');
    if (chave >= 0 && fim > chave) {
      try {
        return JSON.parse(raw.slice(chave, fim + 1));
      } catch {
        /* desiste */
      }
    }
    return null;
  }
}

/**
 * Normaliza + aplica o GUARD determinístico sobre a saída crua do LLM:
 * - clampa a nota em [0, NOTA_MAX] e arredonda para inteiro;
 * - confiança inválida vira 'baixa' (conservador);
 * - **nota ≥3 (top 4%) força confiança no máximo 'media' e marca `contestada`** — nota rara
 *   sempre pede um segundo olhar humano, e o agente nunca grava a estrela mesmo assim.
 * Devolve `null` se não houver nota utilizável (o orquestrador então não grava nada).
 */
export function normalizarRecomendacao(bruto: unknown): RecomendacaoEspecial | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const o = bruto as Record<string, unknown>;
  const notaCrua = Number(o.estrelas_recomendada);
  if (!Number.isFinite(notaCrua)) return null;
  const nota = Math.max(0, Math.min(NOTA_MAX, Math.round(notaCrua)));

  let confianca: Confianca = CONFIANCAS.includes(o.confianca as Confianca)
    ? (o.confianca as Confianca)
    : 'baixa';

  const leituraCrua = typeof o.leitura === 'string' ? o.leitura.trim() : '';
  let leitura = leituraCrua || 'Sem leitura — o modelo não justificou a nota.';

  const brutas = (o.evidencias ?? {}) as Record<string, unknown>;
  const evidencias: Partial<Record<ChaveGatilhoEscape, string>> = {};
  for (const g of GATILHOS_ESCAPE) {
    const v = typeof brutas[g.chave] === 'string' ? String(brutas[g.chave]).trim() : '';
    if (v) evidencias[g.chave] = v;
  }

  // ⚠️ GUARD DO ESCAPE — só REBAIXA, nunca promove. `escapeValido` é a FONTE ÚNICA da regra
  // (a mesma que o time de avaliação aplica): os DOIS gatilhos precisam de citação da doc.
  // Sem elas a nota volta a 5★ — é o que impede o agente de mandar tudo ao comitê por
  // entusiasmo, e o que torna a indicação auditável depois.
  let estrela = nota;
  let ajuste: string | null = null;
  if (ehEscape(nota) && !escapeValido({ sugestao: nota, evidencias })) {
    const faltou = GATILHOS_ESCAPE.find((g) => !evidencias[g.chave]);
    estrela = 5;
    ajuste = `escape sem citação da doc para "${faltou?.texto ?? 'um dos gatilhos'}" — voltou para 5★`;
    leitura = `⚠ ${ajuste}. ${leitura}`;
  }

  // Escape vai SEMPRE ao humano (`deveIrParaHumano`) — então o agente nunca se diz "alta" ali.
  const noEscape = ehEscape(estrela);
  if (noEscape && confianca === 'alta') confianca = 'media';

  return {
    estrelas_recomendada: estrela,
    confianca,
    leitura,
    contestada: noEscape,
    evidencias: noEscape ? evidencias : {},
    ajuste_guard: ajuste,
  };
}

// ─── Guard de divergência contra vizinho forte ─────────────────────────────────

/** Similaridade a partir da qual um vizinho é "quase o mesmo projeto" para efeito do guard. */
export const LIMIAR_SIM_VIZINHO_FORTE = 0.75;
/** Nota do vizinho a partir da qual a divergência para baixo é suspeita (≥3 = top 4%). */
export const NOTA_VIZINHO_FORTE = 3;
/** Nota do alvo até a qual a recomendação conta como "caiu em POC" perto de um vizinho forte. */
export const NOTA_ALVO_BAIXA = 1;

/**
 * Rede determinística: quando um vizinho de ALTA similaridade (≥0.75) vale ≥3★ mas o agente
 * recomendou ≤1★, a diferença é grande demais para gravar calada — é o padrão do GoPrice (0–1)
 * contra o «Agente precificador» (4★), em que o LLM desce para POC só porque o memorial do alvo
 * veio magro. NÃO reescreve a nota (não inventamos número): rebaixa a confiança para `baixa`,
 * marca `contestada` e prefixa a leitura com um aviso para a triagem conferir. Sem vizinho forte
 * divergente, devolve a recomendação intacta.
 */
export function aplicarGuardVizinhoDivergente(
  rec: RecomendacaoEspecial,
  vizinhos: Vizinho[],
): RecomendacaoEspecial {
  if (rec.estrelas_recomendada > NOTA_ALVO_BAIXA) return rec;
  const forte = vizinhos.find(
    (v) => v.similaridade >= LIMIAR_SIM_VIZINHO_FORTE && v.estrela_efetiva >= NOTA_VIZINHO_FORTE,
  );
  if (!forte) return rec;
  const nomeViz = forte.nome ?? forte.projeto_id;
  const aviso = `⚠ Conferir na triagem: «${nomeViz}» (similaridade ${forte.similaridade.toFixed(2)}) é quase idêntico e vale ${forte.estrela_efetiva}★ — a nota ${rec.estrelas_recomendada}★ diverge muito; iguale a faixa ou justifique a diferença. `;
  return {
    ...rec,
    confianca: 'baixa',
    contestada: true,
    leitura: aviso + rec.leitura,
  };
}

/**
 * Roda o classificador: monta o prompt, chama o LLM (jsonMode) e devolve a recomendação
 * normalizada — ou `null` se o modelo não devolveu JSON utilizável. Nunca lança por conta do
 * parse (o orquestrador decide o que fazer com `null`); erros de rede propagam para o
 * `runBackground`, que já engole.
 */
export async function classificarEspecial(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
): Promise<RecomendacaoEspecial | null> {
  const raw = await llmChat(
    [
      { role: 'system', content: buildSystemPromptEspecial() },
      { role: 'user', content: buildUserMessageEspecial(alvo, vizinhos) },
    ],
    { jsonMode: true, temperature: 0.2, maxTokens: 900 },
  );
  const json = extrairJson(raw);
  const rec = normalizarRecomendacao(json);
  return rec ? anexarEvidencia(aplicarGuardVizinhoDivergente(rec, vizinhos)) : null;
}

/**
 * Costura a evidência do escape DENTRO da leitura, que é a única coluna que
 * `especial_avaliacao` guarda e a única que a tela mostra.
 *
 * ⚠️ Sem isto, a citação que SUSTENTA um 6–10 morre no processo: a pessoa que vai cravar a
 * nota final veria "muda o jogo" sem o trecho da doc que autoriza a afirmação — e o guard
 * teria checado uma evidência que ninguém mais consegue ler. Coluna nova exigiria migração;
 * a leitura já viaja inteira até o painel. Fora da faixa 6–10 não mexe em nada.
 */
export function anexarEvidencia(rec: RecomendacaoEspecial): RecomendacaoEspecial {
  const linhas = GATILHOS_ESCAPE.map((g) =>
    rec.evidencias[g.chave] ? `• ${g.texto}\n  "${rec.evidencias[g.chave]}"` : null,
  ).filter(Boolean);
  if (linhas.length === 0) return rec;
  return { ...rec, leitura: `${rec.leitura}\n\nEvidência do escape:\n${linhas.join('\n')}` };
}
