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
import {
  CRITERIOS,
  DERRUBA,
  NOTA_MAX,
  definicaoDe,
  percentilNaCurva,
  raridadeNaCurva,
} from "@/lib/especiais-regua";
import { CURVA_ESPECIAIS_AUDITADOS } from "@/lib/especiais-calibrador";
import { montarBlocoFewShot, type Vizinho } from "@/lib/especial-corpus";
import { extrairJson, type AlvoClassificacao } from "@/lib/agents/especial-classificador";
import { LENTE_GATE, lentePorChave, type AvaliacaoLente } from "@/lib/agents/especiais-lentes";
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
Painel com vários avaliadores tende a INFLAR, e você é a última trava antes de a recomendação chegar à triagem humana.

A POPULAÇÃO QUE VOCÊ JULGA (leia com atenção — é o que calibra o seu rigor):
Você NÃO está julgando a base inteira do GoDocs, e sim projetos ESPECIAIS, que já passaram por um filtro. Entre os especiais que a triagem humana auditou, **${Math.round(percentilNaCurva(CURVA_ESPECIAIS_AUDITADOS, NOTA_REVISAO_ADVERSARIAL))}% recebem ${NOTA_REVISAO_ADVERSARIAL}★ ou mais** e ${Math.round(percentilNaCurva(CURVA_ESPECIAIS_AUDITADOS, 5))}% recebem 5★ ou mais. Ou seja: ${NOTA_REVISAO_ADVERSARIAL}★ aqui é uma nota COMUM, não uma exceção — e refutar toda nota ${NOTA_REVISAO_ADVERSARIAL}★ por ela ser "alta" é errar a régua na direção oposta à inflação.

COMO A NOTA QUE VOCÊ ATACA FOI CONSTRUÍDA (é isto que define o que conta como refutação):
O painel não deu uma nota "geral". Quatro lentes olharam EIXOS separados — estrutura (recorrência, rastro, contrafactual) · complexidade · alcance · risco — e cada uma respondeu "a nota mais alta que o MEU eixo sustenta". A nota é o **eixo mais alto sustentado**, limitado pelo eixo estrutural. Ela é DISJUNTIVA para cima: um eixo forte basta.

⚠️ Por isso, **cobrar a condição de OUTRO eixo não é refutação**. "A faixa 3 exige inteligência no fluxo" não derruba uma nota que veio do ALCANCE ou do RISCO — a régua global descreve o projeto típico daquela faixa, não uma lista de requisitos que todo projeto tem de cumprir inteira. Se você atacar por aí, você refuta 100% das notas, e um revisor que refuta tudo não revisa nada.

**Ataque O EIXO QUE SUSTENTA a nota** (ele vem nomeado na mensagem): a prova DELE não existe, não é nomeada, não é real, ou não sustenta a altura declarada.

COMO ATACAR (nesta ordem, sempre sobre o eixo que sustenta):
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
- **\`nota_sugerida\` é a nota que o eixo AINDA sustenta**, não o chão da escala. Se o eixo não prova a altura declarada mas prova a de baixo, sugira a de baixo. Só use 0 ou 1 quando o projeto cair num dos casos que DERRUBAM (listados acima) — "não provou que é 4★" não significa "não é projeto".
- **Aceitar é um desfecho FREQUENTE aqui, não uma falha sua.** Nesta população cerca de metade das notas que chegam até você estão certas. Um revisor que refuta tudo não está revisando: está subtraindo.
- Refutar exige **NOMEAR a condição da régua que este projeto NÃO cumpre**, com o trecho (ou a ausência dele) que prova isso. "Falta rigor", "poderia ser melhor documentado", "não há métricas de adoção" sem dizer qual condição falha NÃO é motivo — é a nota que se sustenta.
- **Dúvida não é refutação.** Se você não consegue apontar a condição que falha, a nota se sustenta (refutada: false). Refutar por precaução, em população onde esta nota é comum, é tão errado quanto inflar.
- Se você tentou e a nota se sustenta, diga isso (refutada: false). Aceitar quando não há o que atacar é resposta correta.
- Não repita um argumento já usado numa volta anterior: se ele não derrubou, procure outro ou aceite.

DUAS REFUTAÇÕES DIFERENTES — e é o campo "derruba" que as separa:
- **ALTURA** ("isto não é 4★, mas é um projeto") → "derruba": false. Sugira a faixa que o eixo sustenta. O sistema NÃO deixa a nota cair abaixo do que o eixo estrutural já provou com nome próprio: refutar o alcance não apaga a recorrência provada.
- **DERRUBA** ("isto não é projeto") → "derruba": true, e SÓ quando cai num dos casos listados acima (peça única, POC abandonada, sem ponteiro E sem contrafactual, tarefa de baixa frequência do próprio autor, duplicata). Aí a sua nota_sugerida vale integralmente, inclusive 0 — é a única forma de zerar um projeto cujo eixo estrutural trouxe prova nomeada.
⚠️ "derruba": true não é para dizer que o projeto é fraco. É para dizer que ele não é um projeto.

FORMATO — responda APENAS com JSON válido, sem texto fora do JSON:
{
  "refutada": true | false,
  "derruba": true | false,
  "nota_sugerida": <inteiro 0 a ${NOTA_MAX}, ou null se você não propõe outra nota>,
  "motivo": "<1 a 3 frases: o ataque concreto, ou por que a nota se sustentou>"
}`;
}

/**
 * Qual eixo sustenta a nota que o revisor vai atacar — e o que aquela nota significa NAQUELE eixo.
 *
 * ⚠️ Existe porque o revisor recebia só a `definicaoDe(nota)` GLOBAL, que é conjuntiva
 * ("inteligência no fluxo **+** recorrência **+** evidência **+** adoção"). Bastava faltar uma das
 * partes para ele refutar — e sempre falta alguma, porque a nota do painel é DISJUNTIVA (vem de UM
 * eixo). Resultado medido em 28/08/2026: refutou **17 de 17** notas ≥3, tornando o corte absorvente
 * e deixando o painel em 0% de ≥3★. Ver `docs/plans/painel-agentes-especiais.md`.
 */
export function eixoQueSustenta(avaliacoes: AvaliacaoLente[], nota: number): string {
  if (!avaliacoes.length) return "nenhuma lente respondeu — ataque a ausência de prova";
  const candidatas = avaliacoes.filter((a) => a.nota >= nota);
  const alvo = (candidatas.length ? candidatas : avaliacoes).reduce((a, b) =>
    b.nota > a.nota ? b : a,
  );
  const lente = lentePorChave(alvo.lente);
  const ancora = lente?.ancoras.find((x) => x.nota === alvo.nota)?.definicao;
  const papel = alvo.lente === LENTE_GATE ? " (é também o eixo ESTRUTURAL, que limita os outros)" : "";
  return `«${lente?.rotulo ?? alvo.lente}»${papel} — ${alvo.nota}★ com prova ${alvo.evidencia}. ${
    ancora ? `Neste eixo, ${alvo.nota} significa: ${ancora}` : ""
  } Justificativa da lente: ${alvo.justificativa}${
    alvo.sustentacao ? ` [trecho: ${alvo.sustentacao}]` : " [sem trecho copiado]"
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

  const raridade = raridadeNaCurva(CURVA_ESPECIAIS_AUDITADOS, e.nota, "dos especiais auditados");
  const sustenta = eixoQueSustenta(e.avaliacoes, e.nota);
  const dados = {
    nome: e.alvo.nome,
    area: e.alvo.area,
    ferramenta: e.alvo.ferramenta,
    por_que_e_especial: e.alvo.contexto_especial,
    descricao: e.alvo.descricao,
    memorial_ou_doc: e.alvo.memorial || e.alvo.doc || null,
  };

  return `NOTA A DERRUBAR: ${e.nota}★${raridade ? ` (${raridade})` : ""}
O EIXO QUE SUSTENTA ESTA NOTA (é ele que você tem de derrubar): ${sustenta}
COMO A NOTA SAIU: ${e.comoSaiu}
REFERÊNCIA DA ESCALA INTEIRA (o projeto TÍPICO desta faixa — NÃO é uma lista de requisitos a cobrar): ${definicaoDe(e.nota) ?? "—"}

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
    // ⚠️ resposta ilegível NUNCA vira `derruba`: ela ignoraria o piso estrutural.
    derruba: false,
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
    // ⚠️ só o `true` explícito conta — qualquer outra coisa respeita o piso estrutural.
    derruba: o.derruba === true,
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
