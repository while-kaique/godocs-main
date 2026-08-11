/**
 * Gate determinístico — CUSTO EVITADO DECLARADO NO CHAT.
 *
 * Origem (projeto `dba1cc1c23eb…` / "Plataforma SmartOnline — Captura de XMLs e
 * Recolhimento de DIFAL", Stefany Costa, 10/08/2026): no meio da fase de saving a autora
 * escreveu *"além dos analistas, quero incluir o saving de quanto **iríamos pagar** de
 * multa e juros de difal, por não recolher no vencimento"* e, no turno seguinte,
 * **R$ 324.005,09/mês** (média de DIFAL do grupo × 14,5% de multa + SELIC).
 *
 * O agente respondeu APENAS *"me informe o valor médio pago e a periodicidade"*, recebeu o
 * número e no turno seguinte **já devolveu o preview do memorial** — sem uma única pergunta
 * sobre o valor. Duas falhas distintas, as duas cobertas aqui:
 *
 *   1. **Ninguém confirmou se o gasto é REAL.** A multa de DIFAL é de fato paga todo mês
 *      pelo financeiro (confirmado com o autor do projeto), então a resposta certa era
 *      "sim, é real" — mas o sistema não podia saber disso: para ele, o número tinha a
 *      mesma cara de uma projeção ("iríamos pagar"). A validação de realidade/atribuição/
 *      escopo que existe (`buildSavingCustoEvitadoPrompt` + backstop de `iniciarSaving`) só
 *      roda no custo evitado **PURO** (`alguem_fazia === 'externo'`); aqui havia 60h de
 *      analistas junto, então o prompt caiu no bloco de anti-dupla-contagem — que trata de
 *      *sobreposição*, não de *veracidade*. E o gate de ganho real × projetado não armou:
 *      "iríamos pagar"/"seria pago" não estão em `PISTAS_PROJECAO`.
 *   2. **O valor não tinha para onde ir.** No submit, `custo_evitado_reais` é re-derivado
 *      dos ITENS do formulário (`custoEvitadoMensalFromItens`) — a fonte da verdade. Com o
 *      formulário vazio, o R$ 324 mil citado no chat virou `null` e o memorial saiu com
 *      "Custo evitado: N/A". A pessoa digitou o maior ganho do projeto e o sistema nem
 *      questionou, nem gravou.
 *
 * Por isso o gate faz as DUAS coisas numa pergunta só: confirma a natureza do gasto e, se
 * for real, manda a pessoa registrá-lo no FORMULÁRIO (onde o valor conta de verdade).
 *
 * ⚠️ ANTI-LOOP — este repo já queimou duas vezes (o gate [1.4] com 38 perguntas em prod e o
 * forçamento do carga×escala, removido em 03/07/2026 por gerar loop na edição). As mesmas
 * quatro travas do gate de sobreposição, por construção:
 *   (a) NO MÁXIMO 2 perguntas: 'pendente' → ambíguo → 'reperguntado' → qualquer resposta
 *       cai em estado TERMINAL. Nunca uma terceira.
 *   (b) Estados terminais são ABSORVENTES — nenhum ramo volta a null/'pendente'.
 *   (c) A saída é por CLIQUE (opção), não por juízo do LLM sobre texto livre.
 *   (d) Quem consome isto DEVE ler o estado VIVO, nunca o snapshot do topo do turno.
 *
 * ⚠️ NENHUM estado bloqueia para sempre. Diferente do gate de ganho projetado, aqui o
 * desfecho 'estimado' LIBERA o preview — o que ele impede é o valor entrar como custo
 * evitado (o que, sem item no formulário, já era o comportamento real do backend). O
 * projeto segue pelas horas, que são medidas.
 */

/** Estado do gate. `null` = nunca avaliado. Os quatro últimos são TERMINAIS. */
export type EstadoCustoEvitadoChat =
  | "pendente"
  | "reperguntado"
  /**
   * Confirmado: gasto que a empresa paga/pagava de verdade. O backend JÁ entregou o aviso
   * determinístico (`mensagemCustoEvitadoPago`) e ainda precisa injetar o nudge do memorial
   * no próximo turno — daí o estado seguinte.
   */
  | "pago"
  /** O nudge do memorial já foi injetado uma vez. Fim de linha deste gate. */
  | "pago_registrado"
  /** Confirmado: é estimativa do que aconteceria — não entra como custo evitado. */
  | "estimado"
  /** Perguntado 2× sem escolha clara → libera, mas marca o memorial para a triagem. */
  | "nao_respondido";

/** Estados a partir dos quais o gate NUNCA mais pergunta. */
export const ESTADOS_TERMINAIS_CUSTO_EVITADO: readonly EstadoCustoEvitadoChat[] = [
  "pago",
  "pago_registrado",
  "estimado",
  "nao_respondido",
];

export function custoEvitadoChatResolvido(
  estado: EstadoCustoEvitadoChat | null | undefined,
): boolean {
  return estado != null && ESTADOS_TERMINAIS_CUSTO_EVITADO.includes(estado);
}

/** minúsculas + sem acento — as pistas são escritas todas sem acento. */
export function normalizarTexto(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const quaseIgual = (a: number, b: number) => Math.abs(a - b) <= 0.01;

/**
 * Valores monetários escritos em pt-BR ("R$ 324.005,09" → 324005.09).
 *
 * ⚠️ Exige CENTAVOS ou separador de milhar com `R$` — "8%" e "60h" não podem virar valor,
 * senão qualquer conversa de horas armaria o gate. "R$ 3.600" (sem centavos) conta.
 */
export function extrairValoresMonetarios(texto: string): number[] {
  return extrairValoresComPosicao(texto).map((v) => v.valor);
}

/** Mesmo varredor, preservando a POSIÇÃO — é ela que decide qual valor a pergunta cita. */
export function extrairValoresComPosicao(texto: string): { valor: number; indice: number }[] {
  const out: { valor: number; indice: number }[] = [];
  const t = String(texto ?? "");
  const re =
    /(?:r\$\s*)(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)|(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const cru = m[1] ?? m[2] ?? "";
    const v = parseFloat(cru.replace(/\./g, "").replace(",", "."));
    if (isFinite(v) && v > 0) out.push({ valor: round2(v), indice: m.index });
  }
  return out;
}

/**
 * TERMOS DE GASTO — o vocabulário de um dinheiro que sai da empresa. Lista DECLARADA
 * (fonte única): cada entrada tem rótulo para log/teste, então dá para saber QUAL termo
 * armou o gate.
 *
 * `forte: true` = o termo já é, por si, um gasto que se evita (multa, juros, mora, a própria
 * expressão "custo evitado"). Os demais ("contrato", "licença") são ambíguos — um contrato
 * pode ser o CUSTO DO PROJETO — e só contam acompanhados de um VERBO_EVITADO.
 */
export const TERMOS_GASTO: readonly { marca: string; re: RegExp; forte?: boolean }[] = [
  { marca: "multa", re: /\bmultas?\b/, forte: true },
  { marca: "juros", re: /\bjuros\b/, forte: true },
  { marca: "mora", re: /\b(?:mora|juros de mora|correcao monetaria)\b/, forte: true },
  { marca: "custo-evitado", re: /\b(?:custo|gasto|despesa)s? evitad[oa]s?\b/, forte: true },
  { marca: "contrato", re: /\bcontratos?\b/ },
  { marca: "licenca", re: /\b(?:licenca|licencas|mensalidade|assinatura)s?\b/ },
  { marca: "terceiro", re: /\b(?:terceirizad|prestador|fornecedor|honorario|consultoria)/ },
];

/**
 * VERBOS DE EVITAÇÃO — o gasto deixou (ou deixaria) de ser pago. Inclui o CONTRAFACTUAL
 * ("iríamos pagar", "seria pago"), que é exatamente a forma do caso de origem e a que
 * `PISTAS_PROJECAO` (gate de ganho projetado) não cobre.
 */
export const VERBOS_EVITADO: readonly { marca: string; re: RegExp }[] = [
  {
    marca: "deixou-de-pagar",
    re: /\b(?:deixa|deixou|deixamos|deixaria|deixariamos|para|parou|paramos|nao paga|nao pagamos|nao pagaremos)\b[^.;]{0,20}\bde? ?pag/,
  },
  {
    marca: "iriamos-pagar",
    re: /\b(?:iria|iriamos|ira|irao|pagariamos|pagaria|teriamos que pagar|seria pag[oa]|seriam pagos)\b/,
  },
  { marca: "evitar", re: /\b(?:evitad|evitamos|evitar|evita)\b/ },
  { marca: "cancelou", re: /\b(?:cancelad|cancelamos|cancelar|encerrad|encerramos|rescindi)/ },
  {
    marca: "economia-de-gasto",
    re: /\b(?:economia|economizamos|economizar)\b[^.;]{0,24}\b(?:custo|gasto|contrato|multa|juros|licenca|mensalidade)/,
  },
];

export type CustoEvitadoNoChat = {
  /** O maior valor citado que não está no formulário — o que a pergunta cita de volta. */
  valor: number;
  /** Rótulos dos termos/verbos que casaram (log/teste). */
  marcas: string[];
  /** Trecho recortado da fala, para a pessoa se reconhecer na pergunta. */
  trecho: string;
};

/** Recorta ~120 chars ao redor do match, para citar de volta sem despejar o texto todo. */
function recortarTrecho(texto: string, indice: number): string {
  const inicio = Math.max(0, indice - 40);
  const fim = Math.min(texto.length, indice + 90);
  return `${inicio > 0 ? "…" : ""}${texto.slice(inicio, fim).trim()}${fim < texto.length ? "…" : ""}`;
}

/** Valores já cadastrados como item no formulário — esses NÃO armam o gate. */
function valoresDoFormulario(itensRaw: unknown): number[] {
  let arr: unknown = itensRaw;
  if (typeof itensRaw === "string") {
    try {
      arr = JSON.parse(itensRaw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((it) => round2(Number((it as { valor?: unknown })?.valor) || 0))
    .filter((v) => v > 0);
}

/**
 * Detecta um custo evitado declarado SÓ NO CHAT: uma fala do usuário nesta fase que junta
 * (a) um valor em R$, (b) vocabulário de gasto e (c) — quando o termo é ambíguo — um verbo
 * de evitação. Valores que já estão cadastrados como item do formulário são ignorados: ali
 * o caminho é o correto e o valor conta de verdade.
 *
 * Devolve `null` quando não há pista — o gate só arma com evidência textual.
 *
 * ⚠️ Varre fala por fala (não o histórico concatenado): o valor tem de estar na MESMA
 * mensagem que o vocabulário, senão "R$ 500" de um assunto casaria com "multa" de outro.
 */
export function detectarCustoEvitadoNoChat(
  falasUsuario: readonly (string | null | undefined)[],
  itensFormulario: unknown,
): CustoEvitadoNoChat | null {
  const jaNoFormulario = valoresDoFormulario(itensFormulario);
  let melhor: CustoEvitadoNoChat | null = null;

  for (const bruto of falasUsuario) {
    const original = String(bruto ?? "");
    const t = normalizarTexto(original);
    if (!t) continue;

    const valores = extrairValoresComPosicao(t).filter(
      (v) => !jaNoFormulario.some((f) => quaseIgual(f, v.valor)),
    );
    if (valores.length === 0) continue;

    const termos = TERMOS_GASTO.filter((x) => x.re.test(t));
    if (termos.length === 0) continue;
    const verbos = VERBOS_EVITADO.filter((x) => x.re.test(t));
    const temForte = termos.some((x) => x.forte);
    // Termo ambíguo ("contrato") só conta com verbo de evitação; termo forte dispensa.
    if (!temForte && verbos.length === 0) continue;

    const escolhido = escolherValorDoGasto(t, valores, termos);
    const marcas = [...termos.map((x) => x.marca), ...verbos.map((x) => x.marca)];
    const candidato: CustoEvitadoNoChat = {
      valor: escolhido.valor,
      marcas,
      trecho: recortarTrecho(original, escolhido.indice),
    };
    // Entre falas diferentes, mantém a de MAIOR valor — é a que dá a dimensão do que está
    // em jogo (dentro de uma fala, quem decide é a proximidade, não o tamanho).
    if (!melhor || candidato.valor > melhor.valor) melhor = candidato;
  }

  return melhor;
}

/**
 * Qual dos valores citados na fala é o GASTO EVITADO?
 *
 * ⚠️ NÃO é o maior. Achado no staging (11/08/2026), com a fala real do caso de origem:
 * *"com base na média de recolhimento de DIFAL das 7 empresas (R$ 2.234.517,87/mês) e no
 * histórico de multa de 8% mais juros SELIC de 6,5%, o custo evitado é de R$ 324.005,09/mês"*.
 * Pegando o maior, o gate perguntava por **R$ 2.234.517,87 de gasto evitado** — que é a BASE
 * DE CÁLCULO, não o ganho. A pessoa lê um número que ela nunca chamou de gasto evitado.
 *
 * Régua: vence o valor mais PRÓXIMO (em caracteres) de um termo de gasto; empate → o maior.
 * Na fala acima, "custo evitado" fica a ~18 chars de 324.005,09 e "multa" a ~35 de 2.234.517,87.
 */
export function escolherValorDoGasto(
  texto: string,
  valores: readonly { valor: number; indice: number }[],
  termos: readonly { marca: string; re: RegExp }[],
): { valor: number; indice: number } {
  const posicoesTermos: number[] = [];
  for (const termo of termos) {
    const re = new RegExp(termo.re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) {
      posicoesTermos.push(m.index);
      if (m.index === re.lastIndex) re.lastIndex++; // guarda contra match vazio
    }
  }
  if (posicoesTermos.length === 0) {
    return valores.reduce((a, b) => (b.valor > a.valor ? b : a));
  }
  const distancia = (v: { indice: number }) =>
    Math.min(...posicoesTermos.map((p) => Math.abs(p - v.indice)));
  return valores.reduce((a, b) => {
    const da = distancia(a);
    const db = distancia(b);
    if (db < da) return b;
    if (db > da) return a;
    return b.valor > a.valor ? b : a;
  });
}

// ── Pergunta e interpretação ────────────────────────────────────────────────

/** Ordem FIXA: o índice do clique é a interpretação (1 = já pago/medido, 2 = estimativa). */
export const OPCOES_CUSTO_EVITADO_CHAT = [
  "É gasto real — a empresa paga (ou pagava) isso e dá para conferir",
  "É uma estimativa do que aconteceria",
];

export const moedaBR = (n: number) => {
  const [inteiro, centavos] = n.toFixed(2).split(".");
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
};

/**
 * 1ª pergunta. Cita o valor de volta, explica por que a distinção importa e exige uma
 * escolha — não é um aviso que se atravessa repetindo o número (foi assim que o
 * R$ 324.005,09 passou).
 */
export function perguntaCustoEvitadoChat(det: CustoEvitadoNoChat): string {
  return (
    `Antes de eu fechar o memorial, preciso confirmar o valor que você citou — ` +
    `**R$ ${moedaBR(det.valor)}** de gasto evitado.\n\n` +
    `O GoDocs registra só ganho que **já acontece e é medido**, então a diferença aqui é ` +
    `decisiva: gasto que a empresa **de fato paga hoje** (e que dá para conferir num ` +
    `relatório, contas a pagar, guia ou extrato) entra no ganho do projeto; **estimativa do ` +
    `que aconteceria** se o processo continuasse manual, não.\n\n` +
    `Qual dos dois é o seu caso?`
  );
}

/**
 * 2ª e ÚLTIMA pergunta (só quando a 1ª veio ambígua). Depois desta, o gate encerra de
 * qualquer jeito — anti-loop estrutural.
 */
export function perguntaCustoEvitadoChatFirme(det: CustoEvitadoNoChat): string {
  return (
    `Preciso de uma escolha para seguir com os **R$ ${moedaBR(det.valor)}**: esse dinheiro ` +
    `sai do caixa hoje e está registrado em algum lugar (primeira opção), ou é o quanto ` +
    `custaria se ninguém fizesse o processo (segunda opção)?`
  );
}

/**
 * Interpreta a resposta. Clique (índice 1/2) vence; texto cai no fallback por regex.
 * `null` = ambíguo — o chamador re-pergunta UMA vez e depois encerra.
 */
export function interpretarCustoEvitadoChat(
  texto: string | null | undefined,
  selectedOption: number | null,
): "pago" | "estimado" | null {
  if (selectedOption === 1) return "pago";
  if (selectedOption === 2) return "estimado";
  const t = normalizarTexto(texto ?? "");
  if (!t) return null;
  // 'estimado' é checado ANTES: "não é estimativa, é real" cairia no ramo errado se a
  // ordem fosse a inversa — a negação é tratada aqui.
  if (/\bnao (?:e|era|se trata de) (?:uma )?(?:estimativa|projecao|hipotese)\b/.test(t))
    return "pago";
  if (
    /\b(?:estimativa|estimado|projecao|projetado|hipotetico|simulacao|premissa|seria|aconteceria|se ninguem)\b/.test(
      t,
    )
  )
    return "estimado";
  if (
    /\b(?:gasto real|custo real|pagamos|pagava|pagavamos|ja pago|efetivamente pago|sai do caixa|todo mes|mensalmente|real mesmo|e real|dda|contas a pagar|extrato|guia)\b/.test(
      t,
    )
  )
    return "pago";
  return null;
}

/**
 * RESPOSTA DETERMINÍSTICA ao clique em "é gasto real" — o backend fala, SEM chamar o LLM.
 *
 * ⚠️ POR QUE não é só nudge (achado no staging, 11/08/2026): confirmado "gasto real", o
 * agente devolveu o preview no mesmo turno com **"Contratos/Serviços Evitados: N/A"** e SEM
 * o aviso de cadastrar o valor no formulário — ignorou as duas instruções do nudge. É a
 * lição que este repo já pagou três vezes (Gostream, custo evitado puro, ganho projetado):
 * **prompt não segura**. O aviso é a metade ÚTIL do gate — sem ele, a pessoa confirma que o
 * gasto é real e continua sem saber que o número não vai ser gravado. Então quem diz isso é
 * o backend, no texto exato, uma vez.
 *
 * Termina em pergunta (onde se confere) porque a resposta alimenta o nudge do turno
 * seguinte, que é quem manda o LLM escrever a seção do memorial.
 */
export function mensagemCustoEvitadoPago(valor: number): string {
  return (
    `Anotado: os **R$ ${moedaBR(valor)}** são gasto real. Dois pontos antes de eu fechar o memorial:\n\n` +
    `1. ⚠️ Para esse valor entrar no ganho do projeto, ele precisa estar cadastrado no ` +
    `**formulário de dados de impacto desta etapa, no campo de custo evitado** — valor citado ` +
    `só aqui na conversa **não é gravado** e não aparece na planilha.\n` +
    `2. No memorial eu registro o que é esse gasto e onde ele pode ser conferido.\n\n` +
    `Para o item 2: **onde esse número pode ser conferido?** (o nome do relatório, do razão ` +
    `contábil, da guia, do extrato ou do sistema). Se não houver um lugar onde ele é medido, ` +
    `me diga isso mesmo — eu registro a ausência em vez de inventar uma fonte.`
  );
}

// ── Nudges [SISTEMA] — entram UMA vez, só quando o gate dispara ─────────────

/**
 * 'pago' → injetado no turno SEGUINTE ao aviso determinístico (estado 'pago' →
 * 'pago_registrado'), já com a resposta da pessoa sobre onde o número se confere. Cobra só a
 * seção do memorial: o aviso do formulário já foi dado pelo backend, palavra por palavra.
 */
export function nudgeCustoEvitadoPago(valor: number, racional: string): string {
  return (
    `[SISTEMA] O usuário CONFIRMOU que o gasto evitado de R$ ${moedaBR(valor)} é real — a empresa ` +
    `paga (ou pagava) isso de fato. ${racional ? `Sobre onde conferir, ele disse: "${racional.slice(0, 300)}". ` : ""}` +
    `Escreva a seção "### Contratos/Serviços Evitados" do memorial dizendo O QUE é o gasto, desde ` +
    `quando ele parou (ou deixou de crescer) por causa desta automação e ONDE o número se confere ` +
    `— usando o que ele acabou de dizer. Se ele respondeu que não sabe onde conferir, REGISTRE a ` +
    `ausência com essas palavras, em vez de inventar uma fonte. NÃO repita o aviso sobre cadastrar ` +
    `o valor no formulário (o sistema já avisou) e NÃO volte a perguntar se o gasto é real.`
  );
}

export const NUDGE_CUSTO_EVITADO_ESTIMADO =
  "[SISTEMA] O usuário reconheceu que o valor de gasto evitado é uma ESTIMATIVA do que aconteceria, " +
  "não dinheiro que a empresa paga hoje. NÃO inclua esse valor no memorial e NÃO o some ao ganho. " +
  "Explique em 2 frases que o GoDocs documenta só ganho já medido, e siga o memorial com o ganho " +
  "que EXISTE (as horas economizadas). Não repita a pergunta e não negocie o assunto.";

export const NUDGE_CUSTO_EVITADO_SEM_RESPOSTA =
  "[SISTEMA] A natureza do gasto evitado foi perguntada duas vezes e não houve escolha clara. SIGA " +
  "normalmente — não pergunte de novo. NÃO some o valor ao ganho e registre no memorial, na seção " +
  '"### Contratos/Serviços Evitados", a frase exata: "Gasto evitado citado pelo autor sem confirmação ' +
  'de que é valor efetivamente pago — conferir na triagem."';

/**
 * O gate deve BLOQUEAR este resultado do LLM?
 * Só bloqueia preview/complete — pergunta intermediária do agente passa direto.
 *
 * ⚠️ `estado` tem de ser o valor VIVO (já mesclado neste turno). Ler o snapshot do topo do
 * turno é literalmente o loop de 38 perguntas do gate [1.4].
 */
export function deveBloquearPorCustoEvitadoChat(
  estado: EstadoCustoEvitadoChat | null | undefined,
  tipo: string,
): boolean {
  if (tipo !== "preview" && tipo !== "complete") return false;
  return !custoEvitadoChatResolvido(estado);
}

/**
 * Só faz sentido na fase de SAVING (o custo evitado é um tópico do saving; na receita quem
 * cuida da colisão é o gate de sobreposição).
 *
 * ⚠️ Custo evitado PURO (`alguem_fazia === 'externo'`) fica FORA: lá o R$ vem do formulário
 * por construção e a validação de realidade/atribuição/escopo já é cobrada pelo
 * `buildSavingCustoEvitadoPrompt` + o backstop de `iniciarSaving`. Perguntar aqui de novo
 * seria a segunda pergunta sobre o mesmo ponto.
 */
export function aplicaGateCustoEvitadoChat(
  fase: string,
  alguemFazia: string | null | undefined,
): boolean {
  if (fase !== "saving" && fase !== "saving_preview") return false;
  return alguemFazia !== "externo";
}
