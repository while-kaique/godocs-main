/**
 * O STATUS do projeto — coluna ÚNICA, fonte única, módulo PURO.
 *
 * ## O que mudou (14/09/2026)
 * O GoDocs tinha **duas** colunas de estado dizendo coisas que se sobrepunham: `Status`
 * (Pendente · Em validação · Aprovado · Reenvio Pendente · Reprovado · Descontinuado) e
 * `Aprovação do Líder` (Pré-pendente · Pré-aprovado · Ajuste pedido · Pré-reprovado ·
 * Dispensado). Elas eram ORTOGONAIS no dado e contraditórias na prática: medido em prod,
 * **36 projetos Reprovados tinham "Pré-aprovado"** na coluna ao lado e 14 Aprovados estavam
 * "Pré-pendentes".
 *
 * Decisão do dono do produto: *"Pendente, pré-aprovado, aprovado, ajuste pedido e reprovado
 * são os únicos status possíveis agora. Depois que o ajuste pedido tiver tido seu ajuste
 * feito, ele volta para pendente com flag de ajuste realizado."*
 *
 * ## A régua do funil
 * ```
 *   Pendente ──(líder pré-aprova, ou é isento)──▶ Pré-aprovado ──(agente/triagem)──▶ Aprovado
 *      ▲                                                          └────────────────▶ Reprovado
 *      │                                                                                  ▲
 *      └──(autor reenvia, com marca de ajuste feito)── Ajuste pedido ◀──(líder ou triagem)─┘
 * ```
 *
 * ⚠️ **O AGENTE só decide em `Pré-aprovado`.** Em `Pendente` ninguém pré-aprovou ainda, e
 * decidir ali é passar na frente do líder. É por isso que `podeAgenteDecidir` existe, e é
 * a razão de o status ter virado um só: antes essa pergunta exigia cruzar duas colunas.
 *
 * ⚠️ **`Descontinuado` NÃO é status do funil e continua existindo.** Ele é o dono dizendo
 * que a automação não roda mais (`projetos.descontinuado` é a fonte da verdade, a coluna só
 * reflete) — não é uma etapa entre submissão e decisão. Tirá-lo da coluna apagaria a marca
 * de 19 projetos em produção, então ele fica FORA da lista do funil e DENTRO do que se pode
 * gravar. Mesma decisão que já valia em `funil-status.ts`.
 */

/** Os cinco, e só estes cinco. Na ordem da esteira. */
export const STATUS_PROJETO = [
  "Pendente",
  "Pré-aprovado",
  "Ajuste pedido",
  "Aprovado",
  "Reprovado",
] as const;

export type StatusProjeto = (typeof STATUS_PROJETO)[number];

/**
 * Fora do funil, mas gravável: o arquivo do dono. Ver o aviso no topo.
 */
export const STATUS_ARQUIVO = "Descontinuado";

/** Tudo que a triagem pode gravar na coluna. */
export const STATUS_GRAVAVEIS_PROJETO = [...STATUS_PROJETO, STATUS_ARQUIVO] as const;

/** Os que encerram o projeto: ninguém depois deles muda o funil por conta própria. */
export const STATUS_FINAIS: readonly StatusProjeto[] = ["Aprovado", "Reprovado"];

/**
 * Vocabulário ANTIGO → novo. Um mapa declarado, não uma cadeia de `if`.
 *
 * ⚠️ Cobre as DUAS colunas de origem: os textos da antiga `Status` e os da antiga
 * `Aprovação do Líder`. É isso que torna a leitura tolerante — a base tem as duas gerações
 * convivendo e nenhuma linha pode virar `null` só por estar escrita no idioma velho.
 */
const LEGADO: Record<string, StatusProjeto> = {
  // da coluna Status
  pendente: "Pendente",
  "em validação": "Pendente",
  "em validacao": "Pendente",
  "reenvio pendente": "Ajuste pedido",
  rejeitado: "Ajuste pedido",
  aprovado: "Aprovado",
  validado: "Aprovado",
  reprovado: "Reprovado",
  // da coluna Aprovação do Líder
  "pré-pendente": "Pendente",
  "pre-pendente": "Pendente",
  "pré-aprovado": "Pré-aprovado",
  "pre-aprovado": "Pré-aprovado",
  "ajuste pedido": "Ajuste pedido",
  "pré-reprovado": "Reprovado",
  "pre-reprovado": "Reprovado",
};

/** Minúsculas, sem espaço sobrando; vazio e travessão contam como ausência. */
export function chaveStatus(bruto: string | null | undefined): string {
  const t = String(bruto ?? "")
    .trim()
    .toLowerCase();
  return t === "—" || t === "-" ? "" : t;
}

/**
 * Texto cru da planilha → status do funil. PURA.
 *
 * Devolve `null` para o que **não é etapa** (`Descontinuado`) e para célula vazia — `null`
 * significa "não sei", que é diferente de "é Pendente". Quem quer o default explícito usa
 * `?? "Pendente"`.
 *
 * ⚠️ Texto DESCONHECIDO também devolve `null`, nunca um palpite: um status novo aparecendo
 * na planilha não pode virar `Aprovado` por acidente de fall-through (é a lição do
 * `Dispensado` que virava `Pré-reprovado`).
 */
export function statusDoTexto(bruto: string | null | undefined): StatusProjeto | null {
  const t = chaveStatus(bruto);
  if (!t) return null;
  // ⚠️ A isenção vem com o porquê colado ("Pré-aprovado (liderança)"), então o casamento
  // do prefixo é intencional aqui — e SÓ aqui, onde o vocabulário é conhecido.
  if (t.startsWith("pré-aprovado") || t.startsWith("pre-aprovado")) return "Pré-aprovado";
  return LEGADO[t] ?? null;
}

/** O projeto está arquivado pelo dono? PURA. */
export function ehArquivado(bruto: string | null | undefined): boolean {
  return chaveStatus(bruto) === "descontinuado";
}

/**
 * O status ÚNICO a partir do par antigo (`Status`, `Aprovação do Líder`). PURA.
 *
 * É a régua da migração E da leitura tolerante enquanto a base tiver as duas colunas.
 * A ordem dos testes é a regra de negócio:
 *
 *   1. **Arquivo vence tudo** — descontinuado não é etapa e não se deixa reescrever.
 *   2. **Decisão FINAL vence o parecer do líder.** Medido em prod: 36 Reprovados tinham
 *      "Pré-aprovado" ao lado, e 14 Aprovados estavam "Pré-pendentes". Quem já foi decidido
 *      foi decidido; o parecer do líder é uma etapa ANTERIOR e não ressuscita o projeto.
 *   3. **O pedido de ajuste, de qualquer uma das duas colunas**, vence o "esperando".
 *   4. **Senão, vale o parecer do líder** (é o que a coluna nova precisa absorver).
 *   5. **Senão, Pendente** — ninguém olhou ainda.
 */
export function unificarStatus(
  statusBruto: string | null | undefined,
  preStatusBruto: string | null | undefined,
): StatusProjeto | typeof STATUS_ARQUIVO {
  if (ehArquivado(statusBruto)) return STATUS_ARQUIVO;

  const doStatus = statusDoTexto(statusBruto);
  if (doStatus && STATUS_FINAIS.includes(doStatus)) return doStatus;
  if (doStatus === "Ajuste pedido") return "Ajuste pedido";

  const doLider = statusDoTexto(preStatusBruto);
  // ⚠️ `Dispensado` cai aqui como `null` de propósito: a dispensa fecha a FILA, não decide
  // o projeto — ele continua esperando quem decide de verdade.
  if (doLider) return doLider;

  return doStatus ?? "Pendente";
}

/**
 * O agente pode aprovar ou reprovar este projeto? PURA.
 *
 * ⚠️ **Só em `Pré-aprovado`.** É a regra que o dono do produto pediu com estas palavras: *"O
 * agente só vai aprovar/reprovar quando status for pré-aprovado, que indica que o líder pré
 * aprovou. Se for pendente não teve pré-aprovação."* Em `Pendente` o agente esperaria estar
 * decidindo antes do líder; em `Ajuste pedido` a bola é do autor; nos finais já há decisão.
 */
export function podeAgenteDecidir(statusBruto: string | null | undefined): boolean {
  return statusDoTexto(statusBruto) === "Pré-aprovado";
}

/** O veredito do líder vira qual status? PURA. */
export function statusDoParecerDoLider(veredito: string): StatusProjeto | null {
  if (veredito === "aprovado") return "Pré-aprovado";
  if (veredito === "ajuste") return "Ajuste pedido";
  if (veredito === "reprovado") return "Reprovado";
  // `pendente` (fila aberta) e `dispensado` (fila fechada pelo sistema) não movem o funil.
  return null;
}

/**
 * O reenvio do autor devolve o projeto a `Pendente`? PURA.
 *
 * Sim — e é o pedido literal: *"Depois que o ajuste pedido tiver tido seu ajuste feito, ele
 * volta para pendente com flag de ajuste realizado."*
 *
 * ⚠️ Só quando ele estava em `Ajuste pedido`. Reenvio de um projeto já `Aprovado` não o
 * rebaixa (a triagem decidiu; mexer nisso é decisão de gente), e reenvio de um `Pendente`
 * continua `Pendente`.
 */
export function ehReenvioDeAjuste(statusAnterior: string | null | undefined): boolean {
  return statusDoTexto(statusAnterior) === "Ajuste pedido";
}

/**
 * O Status com que uma SUBMISSÃO nasce, a partir do rótulo do parecer. PURA.
 *
 * ⚠️ Projeto que **não entra em fila de líder** nasce `Pré-aprovado`. São 71% da base
 * (coordenador para cima submetendo, projeto especial, pessoa sem líder na TeamGuide, e o
 * caso de integração fora), e o rótulo deles já é `Pré-aprovado (liderança)` e afins — o
 * que muda é o Status passar a dizer o mesmo. Sem isto, a régua *"o agente só decide em
 * Pré-aprovado"* pararia o funil para a maioria dos projetos, esperando um líder que não
 * existe.
 *
 * ⚠️ Quem ENTRA em fila nasce `Pendente`: o rótulo dele é `Pré-pendente`, e é literalmente
 * "o líder ainda não olhou".
 */
export function statusDeSubmissao(rotuloDoParecer: string | null | undefined): StatusProjeto {
  return statusDoTexto(rotuloDoParecer) === "Pré-aprovado" ? "Pré-aprovado" : "Pendente";
}
