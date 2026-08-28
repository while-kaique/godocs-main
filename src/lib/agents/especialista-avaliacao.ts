/**
 * ESPECIALISTA da MESA de avaliação (T1) — o agente LLM crítico de UMA dimensão.
 *
 * ## Por que ele existe
 * A mesa de avaliação em sombra hoje é 100% determinística: cada "voto" (FTE, financeiro, RAG) é um
 * número calculado, e a mesa só ECOA o gate. O dono do produto (Luis, 28/08/2026) pediu um TIME de
 * auditoria de verdade — agentes que RACIOCINAM sobre o projeto e ajudam a decidir na divergência.
 * Este módulo é a peça-base: um especialista por DIMENSÃO, que recebe o voto determinístico como
 * INPUT (não como veredito) e o argumenta/contesta com o texto real do projeto.
 *
 * ## Fronteiras (as mesmas do resto da mesa)
 * - **SOMBRA**: nada aqui muda status. Quem grava é `avaliacao-normais.functions.ts`.
 * - **O determinístico vira VOTO, não piso**: o cálculo (FTE/materialidade/RAG) entra como sinal;
 *   o LLM pode discordar dele. Se o LLM falha, o voto determinístico é o `fallback` (fail-closed).
 * - **Sem R$ cru em prompt**: o `motivo` do voto já vem redigido pelo lado determinístico (que
 *   pode citar valores) — este módulo não injeta valor/hora por cargo nem outro R$ escondido.
 *
 * Este arquivo é PURO (sem I/O). Quem chama o LLM é o `.functions.ts` irmão. Espelha o padrão de
 * `especiais-revisor.ts` (`buildPrompt*` puro → `normalizar*` fail-closed → `.functions` que nunca
 * lança).
 */
import type { LLMMessage } from "@/lib/llm";

/** As quatro dimensões da mesa. O `cetico` é ADVERSARIAL: existe para derrubar uma aprovação. */
export type DimensaoAvaliacao = "fte" | "financeiro" | "rag" | "cetico";

/** O texto do projeto que o especialista lê — sem nenhum R$ escondido do usuário. */
export type TextoProjeto = {
  nome: string;
  area: string;
  descricao: string;
  o_que_faz: string;
  memorial: string;
  doc: string;
};

/**
 * O voto determinístico da dimensão (o cálculo de hoje), passado ao especialista como INPUT e usado
 * como `fallback` quando o LLM falha. `motivo` pode ser `null` (voto sem preocupação declarada).
 */
export type VotoDeterministico = {
  preocupa: boolean;
  confianca: number;
  motivo: string | null;
  sinais: string[];
};

/** O voto (resumido) de OUTRA dimensão — o especialista vê a mesa, não só o próprio eixo. */
export type VotoResumido = {
  dimensao: DimensaoAvaliacao;
  preocupa: boolean;
  argumento: string;
};

/** Tudo o que o especialista precisa para julgar. */
export type EntradaEspecialista = {
  dimensao: DimensaoAvaliacao;
  texto: TextoProjeto;
  voto: VotoDeterministico;
  /** Vizinhos aprovados do corpus (texto pronto), como precedente. */
  vizinhos: string[];
  /** Os votos das outras dimensões, para o especialista situar o dele na mesa. */
  outrosVotos: VotoResumido[];
};

/**
 * O parecer de UM especialista. `origem` distingue o raciocínio do LLM do fallback determinístico —
 * é o que a mesa mostra na ficha e o que o retroativo mede.
 */
export type JulgamentoEspecialista = {
  dimensao: DimensaoAvaliacao;
  /** Este eixo vê motivo de preocupação (enviar à triagem humana)? */
  preocupa: boolean;
  /** O parecer raciocinado — nunca vazio. */
  argumento: string;
  /** 0..1 (clampado) — quão seguro o especialista está do próprio parecer. */
  confianca: number;
  /** Sinais/pistas que sustentam o parecer. */
  sinais: string[];
  origem: "llm" | "deterministico";
};

/** Personas — o QUÊ de cada especialista. O cético é o único ADVERSARIAL (derruba, não confere). */
const PERSONA: Record<DimensaoAvaliacao, string> = {
  fte: `Você é o especialista em PLAUSIBILIDADE DE HORAS (FTE) da mesa de avaliação do GoDocs. Você julga se o saving declarado (horas/mês) é crível para o número de pessoas que realmente faziam o trabalho. 220h/mês ≈ 1 pessoa em tempo integral (1 FTE). Total alto só se sustenta se atribuído a várias pessoas de verdade — um número que exige mais FTE do que a equipe declarada é implausível e pede olho humano.`,
  financeiro: `Você é o especialista FINANCEIRO da mesa de avaliação do GoDocs. Você julga a COERÊNCIA do impacto: o ganho total é material demais para aprovar sem conferência humana? o valor bate com o que o projeto descreve? há dupla contagem (o mesmo dinheiro contado como saving E como receita, ou como horas E como contrato)?`,
  rag: `Você é o especialista em PRECEDENTE da mesa de avaliação do GoDocs. Você compara este projeto com os projetos JÁ APROVADOS pela triagem humana (os vizinhos abaixo). Ele se parece com o que a empresa já aprovou, ou é um caso fora da vizinhança que merece conferência?`,
  cetico: `Você é o CÉTICO ADVERSARIAL da mesa de avaliação do GoDocs. Sua tarefa é TENTAR DERRUBAR uma aprovação — não conferi-la, não elogiá-la. Um time que só concorda infla; você é a última trava crítica antes de o projeto ser aprovado em sombra. Procure o motivo pelo qual este projeto NÃO deveria ser aprovado sem olho humano: número implausível que "fechou" na conversa, impacto projetado vendido como realizado, dupla contagem, ausência de rastro. Se, tentando derrubar, você não achar do que reclamar, diga isso — refutar por precaução também é errar.`,
};

const ROTULO_DIMENSAO: Record<DimensaoAvaliacao, string> = {
  fte: "Plausibilidade de horas (FTE)",
  financeiro: "Financeiro",
  rag: "Precedente (projetos aprovados)",
  cetico: "Cético adversarial",
};

/**
 * O parecer determinístico — usado quando o LLM está desligado ou falha. Espelha o voto calculado
 * (preocupa/confianca/sinais) e usa o `motivo` do voto como argumento; sem motivo, um texto padrão
 * (o argumento NUNCA é vazio). `origem: 'deterministico'` é o que o retroativo/ficha reconhecem.
 */
export function fallbackDeterministico(entrada: EntradaEspecialista): JulgamentoEspecialista {
  const { dimensao, voto } = entrada;
  const argumento =
    (voto.motivo && voto.motivo.trim()) ||
    (voto.preocupa
      ? `${ROTULO_DIMENSAO[dimensao]}: sinal de preocupação neste eixo — recomendo conferência humana.`
      : `${ROTULO_DIMENSAO[dimensao]}: sem sinal de preocupação neste eixo.`);
  return {
    dimensao,
    preocupa: voto.preocupa,
    argumento,
    confianca: voto.confianca,
    sinais: [...voto.sinais],
    origem: "deterministico",
  };
}

/** Monta o bloco dos vizinhos aprovados (precedente) para o prompt. */
function blocoVizinhos(vizinhos: string[]): string {
  if (!vizinhos.length) return "(nenhum projeto aprovado semelhante encontrado)";
  return vizinhos.map((v, i) => `${i + 1}. ${v}`).join("\n");
}

/** Monta o bloco dos votos das outras dimensões. */
function blocoOutrosVotos(outros: VotoResumido[]): string {
  if (!outros.length) return "(nenhum outro voto ainda)";
  return outros
    .map(
      (o) =>
        `- ${ROTULO_DIMENSAO[o.dimensao]}: ${o.preocupa ? "PREOCUPA" : "sem preocupação"} — ${o.argumento}`,
    )
    .join("\n");
}

/**
 * Constrói as mensagens do especialista. Persona por dimensão (system) + os dados do projeto, o voto
 * determinístico do eixo, os votos dos outros e os vizinhos (user). ⚠️ Structured Outputs está morta
 * no proxy — pedimos JSON puro e o `.functions` parseia por `extrairJson`.
 */
export function buildPromptEspecialista(entrada: EntradaEspecialista): LLMMessage[] {
  const { dimensao, texto, voto, vizinhos, outrosVotos } = entrada;
  const system = `${PERSONA[dimensao]}

Você recebe: o texto do projeto, o CÁLCULO determinístico do seu eixo (um SINAL, não um veredito — você pode discordar dele com argumento), o que os outros especialistas acharam, e projetos parecidos já aprovados. Raciocine sobre os dados; não repita o cálculo, INTERPRETE-o.

FORMATO — responda APENAS com JSON válido, sem texto fora do JSON:
{
  "preocupa": true | false,
  "argumento": "<1 a 3 frases: por que este eixo preocupa (ou não), com base no texto do projeto>",
  "confianca": <número 0 a 1: quão seguro você está do seu parecer>,
  "sinais": ["<pista curta>", "..."]
}`;

  const user = `PROJETO:
- Nome: ${texto.nome}
- Área: ${texto.area}
- Descrição: ${texto.descricao}
- O que faz: ${texto.o_que_faz}
- Memorial: ${texto.memorial}
- Documentação: ${texto.doc}

CÁLCULO DETERMINÍSTICO DO SEU EIXO (${ROTULO_DIMENSAO[dimensao]}):
- Preocupa: ${voto.preocupa ? "sim" : "não"} · confiança ${voto.confianca}
- Motivo: ${voto.motivo ?? "(sem motivo declarado)"}
- Sinais: ${voto.sinais.length ? voto.sinais.join("; ") : "(nenhum)"}

O QUE OS OUTROS ESPECIALISTAS ACHARAM:
${blocoOutrosVotos(outrosVotos)}

PROJETOS PARECIDOS JÁ APROVADOS (precedente):
${blocoVizinhos(vizinhos)}

Dê o seu parecer sobre o eixo «${ROTULO_DIMENSAO[dimensao]}».`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Interpreta a confiança crua do LLM: número finito clampado a [0,1]; caso contrário, o voto. */
function confiancaClampada(bruto: unknown, votoConfianca: number): number {
  const n = Number(bruto);
  if (!Number.isFinite(n)) return votoConfianca;
  return Math.max(0, Math.min(1, n));
}

/**
 * Normaliza a resposta crua do LLM. **FAIL-CLOSED**: sem um `argumento` textual utilizável, cai no
 * `fallbackDeterministico` — aceitar uma resposta ilegível seria inventar um parecer. Um objeto
 * válido vira `origem: 'llm'` com a dimensão da entrada (o LLM não escolhe a própria dimensão).
 */
export function normalizarJulgamento(
  bruto: unknown,
  entrada: EntradaEspecialista,
): JulgamentoEspecialista {
  if (!bruto || typeof bruto !== "object") return fallbackDeterministico(entrada);

  const o = bruto as Record<string, unknown>;
  const argumento = typeof o.argumento === "string" ? o.argumento.trim() : "";
  if (!argumento) return fallbackDeterministico(entrada);

  const sinais = Array.isArray(o.sinais)
    ? o.sinais.filter((s): s is string => typeof s === "string")
    : [];

  return {
    dimensao: entrada.dimensao,
    preocupa: o.preocupa === true,
    argumento,
    confianca: confiancaClampada(o.confianca, entrada.voto.confianca),
    sinais,
    origem: "llm",
  };
}
