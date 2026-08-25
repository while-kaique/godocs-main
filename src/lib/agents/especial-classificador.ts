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
import {
  NIVEIS,
  CRITERIOS,
  DERRUBA,
  NOTA_MAX,
  CURVA_BASE,
  TOTAL_AUDITADO,
  type Confianca,
} from '@/lib/especiais-regua';
import { montarBlocoFewShot, type Vizinho } from '@/lib/especial-corpus';

export type RecomendacaoEspecial = {
  estrelas_recomendada: number;
  confianca: Confianca;
  /** Por que esta faixa · por que não sobe · o que faria subir. */
  leitura: string;
  /** A nota é alta (≥3) e mereceria um segundo olhar humano — sinal, não veredito. */
  contestada: boolean;
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

function descreverNiveis(): string {
  return NIVEIS.map((n) => `${n.nota} — ${n.titulo}: ${n.definicao}`).join('\n');
}

function descreverCriterios(): string {
  return CRITERIOS.map((c) => `- ${c.titulo}: ${c.texto}`).join('\n');
}

function descreverDerruba(): string {
  return DERRUBA.map((d) => `- ${d}`).join('\n');
}

function descreverCurva(): string {
  const linhas = Object.entries(CURVA_BASE)
    .filter(([k]) => k !== 'vazio')
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([nota, qtd]) => {
      const pct = ((qtd / TOTAL_AUDITADO) * 100).toFixed(1);
      return `${nota}★: ${qtd} projetos (${pct}%)`;
    });
  return linhas.join(' · ');
}

export function buildSystemPromptEspecial(): string {
  return `Você é o AUDITOR de projetos ESPECIAIS do GoDocs. Sua função é recomendar uma nota de ESTRELAS de 0 a ${NOTA_MAX} para um projeto especial, comparando-o com projetos já avaliados e com a régua abaixo.

O QUE A ESTRELA É:
Uma nota QUALITATIVA de valor estratégico. Projetos especiais NÃO têm memorial financeiro — a estrela é o único "pagamento", então o que manda é VALOR ESTRATÉGICO + USO REAL. Nunca premie R$ ou horas com estrela (isso é contar o mesmo ganho duas vezes).

A ESCALA (âncoras de cada nível):
${descreverNiveis()}

O QUE VALE ESTRELA (ordem em que você olha):
${descreverCriterios()}

O QUE DERRUBA para 0–1, por melhor que o memorial esteja:
${descreverDerruba()}

A CURVA REAL DA BASE (644 projetos) — sua régua contra inflação:
${descreverCurva()}
≥3★ é top 4% da base; ≥5★ é top 1%. Se você se pegar recomendando ≥3, tenha uma razão forte e concreta: inteligência real no fluxo, reuso multi-área, risco material evitado ou adoção comprovada por outras pessoas. Na dúvida entre duas faixas, fique na MENOR.

DISCIPLINA:
- Prefira notas INTEIRAS.
- "Uso esperado", "resultado projetado", "vai reduzir" NÃO é uso real — trata como POC até ter ponteiro medido.
- O próprio entregável (o dashboard, o CSV, o documento que o projeto gera) NÃO é ponteiro de uso recorrente.
- Admitir limite no memorial conta A FAVOR (honestidade), não contra.

FORMATO DE RESPOSTA:
Responda APENAS com JSON válido, exatamente neste formato, sem texto fora do JSON:
{
  "estrelas_recomendada": <inteiro 0 a ${NOTA_MAX}>,
  "confianca": "alta" | "media" | "baixa",
  "leitura": "<até ~400 caracteres: por que esta faixa · por que não sobe · o que faria subir. Cite o projeto vizinho que ancora a comparação quando houver.>"
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
  const leitura = leituraCrua || 'Sem leitura — o modelo não justificou a nota.';

  const alta = nota >= 3;
  if (alta && confianca === 'alta') confianca = 'media';

  return { estrelas_recomendada: nota, confianca, leitura, contestada: alta };
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
  return normalizarRecomendacao(json);
}
