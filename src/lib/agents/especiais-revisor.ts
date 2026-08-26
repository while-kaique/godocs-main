/**
 * REVISOR ADVERSARIAL do painel (T5) — o agente que tenta **DERRUBAR** a nota, nunca defendê-la.
 *
 * ## Por que ele existe e por que só sobre nota ≥3
 * ≥3★ é top 4% da base; ≥5★ é top 1%. A força-tarefa do JV passou o revisor sobre toda nota ≥3 e é
 * o que segurou a rodada em 4★. Nota 0–2 não vai ao revisor: refutar 1★ é gastar chamada para nada.
 *
 * ## O prompt é de REFUTAR, não de conferir
 * "Confira se está certo" devolve concordância — é o mesmo defeito das N cópias do avaliador que o
 * T3 evita. Aqui a tarefa é achar o motivo pelo qual a nota **não se sustenta**, e o veredicto de
 * dúvida é **refutar** (segue para outra volta; no teto, `contestada` + olho humano). ⚠️ Ele pode
 * sugerir uma nota MENOR — nunca maior: a máquina de convergência descarta sugestão para cima
 * (decisão 4 do plano, "empate mantém a nota MENOR").
 *
 * ⚠️ Ele não grava nada e não decide quando parar (isso é `especiais-convergencia.ts`).
 */
import { llmChat } from "@/lib/llm";
import { CRITERIOS, DERRUBA, NOTA_MAX, definicaoDe, raridadeDe } from "@/lib/especiais-regua";
import { montarBlocoFewShot, type Vizinho } from "@/lib/especial-corpus";
import { extrairJson, type AlvoClassificacao } from "@/lib/agents/especial-classificador";
import { type AvaliacaoLente } from "@/lib/agents/especiais-lentes";
import { NOTA_REVISAO_ADVERSARIAL, type VeredictoRevisor } from "@/lib/especiais-convergencia";

export type EntradaRevisao = {
  alvo: AlvoClassificacao;
  nota: number;
  avaliacoes: AvaliacaoLente[];
  vizinhos: Vizinho[];
  /** Como a nota saiu do calibrador — o revisor ataca o raciocínio, não um número solto. */
  comoSaiu: string;
  /** Motivos das voltas anteriores, para ele não repetir o mesmo argumento. */
  refutacoesAnteriores?: string[];
};

export function buildSystemPromptRevisor(): string {
  return `Você é o REVISOR ADVERSARIAL do painel de projetos ESPECIAIS do GoDocs. Sua tarefa é TENTAR DERRUBAR a nota proposta — não conferi-la, não elogiá-la.

POR QUE VOCÊ EXISTE:
Nota ${NOTA_REVISAO_ADVERSARIAL}★ ou mais é top 4% da base de 644 projetos; ${NOTA_MAX}★ existe em 1 projeto. Painel com vários avaliadores tende a INFLAR, e você é a última trava antes de a recomendação chegar à triagem humana.

COMO ATACAR (nesta ordem):
1. A prova sustenta o que a nota afirma? Existe relatório, painel, base, sistema ou pessoa NOMEADA onde conferir — ou é afirmação sem endereço?
2. O uso é REAL ou esperado? "Vai reduzir", "deve ser adotado", "resultado projetado" é POC.
3. O entregável está sendo confundido com o ponteiro? Dashboard, CSV ou documento que o projeto GERA não é prova de uso recorrente.
4. O alcance declarado se confirma? "Serve várias áreas" com uma pessoa usando é uma pessoa usando.
5. Cai em algum dos casos que DERRUBAM para 0–1?
${DERRUBA.map((d) => `   - ${d}`).join("\n")}
6. Os vizinhos comparáveis sustentam esta faixa, ou esta nota está fora da vizinhança para cima?

O QUE VALE ESTRELA (a régua que você aplica, sem reescrever):
${CRITERIOS.map((c) => `- ${c.titulo}: ${c.texto}`).join("\n")}

REGRAS DO SEU VEREDICTO:
- Você só pode sugerir nota IGUAL ou MENOR. Sugestão para cima é descartada pelo sistema.
- **Na dúvida, REFUTE** — dúvida aqui custa uma revisão a mais; nota inflada custa a régua inteira.
- Refutar exige um motivo CONCRETO deste projeto. "Falta rigor", "poderia ser melhor documentado" não é motivo.
- Se você tentou e a nota se sustenta, diga isso (refutada: false). Aceitar quando não há o que atacar é resposta correta.
- Não repita um argumento já usado numa volta anterior: se ele não derrubou, procure outro ou aceite.

FORMATO — responda APENAS com JSON válido, sem texto fora do JSON:
{
  "refutada": true | false,
  "nota_sugerida": <inteiro 0 a ${NOTA_MAX}, ou null se você não propõe outra nota>,
  "motivo": "<1 a 3 frases: o ataque concreto, ou por que a nota se sustentou>"
}`;
}

export function buildUserMessageRevisor(e: EntradaRevisao): string {
  const lentes = e.avaliacoes
    .map(
      (a) =>
        `- ${a.lente}: ${a.nota}★ · prova ${a.evidencia} · ${a.justificativa}${
          a.sustentacao ? ` [trecho: ${a.sustentacao}]` : " [sem trecho]"
        }`,
    )
    .join("\n");

  const anteriores = e.refutacoesAnteriores?.length
    ? `\nARGUMENTOS JÁ USADOS EM VOLTAS ANTERIORES (não repita):\n${e.refutacoesAnteriores
        .map((r) => `- ${r}`)
        .join("\n")}\n`
    : "";

  const raridade = raridadeDe(e.nota);
  const dados = {
    nome: e.alvo.nome,
    area: e.alvo.area,
    ferramenta: e.alvo.ferramenta,
    por_que_e_especial: e.alvo.contexto_especial,
    descricao: e.alvo.descricao,
    memorial_ou_doc: e.alvo.memorial || e.alvo.doc || null,
  };

  return `NOTA A DERRUBAR: ${e.nota}★${raridade ? ` (${raridade})` : ""}
DEFINIÇÃO DESTA FAIXA: ${definicaoDe(e.nota) ?? "—"}
COMO A NOTA SAIU: ${e.comoSaiu}

O QUE CADA LENTE DO PAINEL ACHOU:
${lentes || "- nenhuma lente respondeu"}
${anteriores}
PROJETOS PARECIDOS JÁ AVALIADOS (nota GLOBAL):
${montarBlocoFewShot(e.vizinhos)}

O PROJETO:
${JSON.stringify(dados, null, 2)}

Tente derrubar esta nota.`;
}

/**
 * Normaliza o veredicto cru. ⚠️ **Saída ilegível vira REFUTAÇÃO sem sugestão de nota**, não
 * aceitação: aceitar por não entender a resposta seria carimbar nota rara por acidente. O custo é
 * limitado por construção — o teto de voltas é absorvente.
 */
export function normalizarVeredicto(bruto: unknown): VeredictoRevisor {
  const semResposta: VeredictoRevisor = {
    refutada: true,
    nota_sugerida: null,
    motivo: "revisor não devolveu veredicto utilizável — nota mantida e marcada para revisão",
  };
  if (!bruto || typeof bruto !== "object") return semResposta;

  const o = bruto as Record<string, unknown>;
  if (typeof o.refutada !== "boolean") return semResposta;

  const n = Number(o.nota_sugerida);
  const nota_sugerida = Number.isFinite(n) ? Math.max(0, Math.min(NOTA_MAX, Math.round(n))) : null;
  const motivo = typeof o.motivo === "string" ? o.motivo.trim() : "";

  return {
    refutada: o.refutada,
    nota_sugerida,
    motivo: motivo || (o.refutada ? "refutada sem motivo declarado" : "nota sustentada"),
  };
}

/**
 * Roda uma volta do revisor. Erro de rede também vira refutação sem sugestão (mesma razão do
 * parse ilegível) — a função **nunca lança**, porque isto roda em lote de background.
 */
export async function revisarAdversarial(e: EntradaRevisao): Promise<VeredictoRevisor> {
  try {
    const raw = await llmChat(
      [
        { role: "system", content: buildSystemPromptRevisor() },
        { role: "user", content: buildUserMessageRevisor(e) },
      ],
      { jsonMode: true, temperature: 0.1, maxTokens: 700 },
    );
    return normalizarVeredicto(extrairJson(raw));
  } catch (err) {
    return {
      refutada: true,
      nota_sugerida: null,
      motivo: `revisor indisponível (${err instanceof Error ? err.message : "erro"}) — nota mantida e marcada para revisão`,
    };
  }
}
