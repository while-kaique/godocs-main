// MOTIVOS de reprovação que o AUTOR lê — módulo PURO, FONTE ÚNICA do texto.
//
// Este texto aparece no card de "Meus Projetos" e em `/projeto/$id`, dentro do
// `AvisoPendencia` (estado "Projeto reprovado"). ⚠️ É renderizado como TEXTO PURO: o
// componente não usa `dangerouslySetInnerHTML` (e não deve passar a usar), então nada de
// markdown aqui. `**negrito**` sairia literal na tela.
//
// ⚠️ Regras de copy do repo: PT-BR com acentuação (regra 4) e **sem travessão nem hífen
// decorativo** nas frases visíveis.

/**
 * Reprovação por IMPACTO baixo, dita como "experimentação".
 *
 * Substitui (08/09/2026, decisão do Luis) o motivo que a rodada retroativa de 04/09 gravou
 * em 137 projetos:
 *
 *   "Reprovado em revisão retroativa da base (04/09/2026): impacto financeiro mensal
 *    abaixo de R$ 100 e sem reconhecimento por estrela. Se o ganho deste projeto não está
 *    no valor mensal (por exemplo risco evitado ou qualidade), fale com o time de RPA
 *    para reavaliação."
 *
 * Três coisas erradas naquele texto, e é por elas que este existe:
 *
 *  1. **Expunha a régua como nota de corte.** "Abaixo de R$ 100" e "sem reconhecimento por
 *     estrela" contam o mecanismo interno, e a pessoa não tem como discutir o número do
 *     jeito certo: ou ela aceita calada, ou vai contestar o piso. O veredito que interessa
 *     a ela não é o piso, é a CAIXA em que o projeto caiu.
 *  2. **Abria a porta do RPA para 137 pessoas de uma vez.** Era justamente o ponto que
 *     travou a aprovação do fecho na rodada. O caminho de volta aqui não é uma conversa,
 *     é o próprio produto: crescer o ganho, medir e reenviar.
 *  3. **Não dizia o veredito em palavras que a pessoa reconhece.** "Experimentação" é a
 *     caixa que a régua de estrelas já chama de «Experimenta» (0★, que é VEREDITO e não
 *     "não avaliado"): projeto legítimo, que rodou, cujo resultado medido ainda não
 *     sustenta um número. Nomear a caixa é mais honesto que citar o corte.
 *
 * ⚠️ **Duas frases, por escolha do Luis (08/09/2026).** Uma variante mais calorosa foi
 * oferecida e RECUSADA: ela abria com "ele funciona" e acrescentava "isso não tira o valor
 * do que você construiu". O risco daquela versão é soar paternalista justamente para quem
 * acabou de ser reprovado, e o incentivo já está na 2ª frase. Não reintroduzir sem decisão.
 *
 * ⚠️ **Não citar valor nenhum aqui.** Nem o piso, nem o impacto apurado do projeto. Um
 * número no texto convida a discutir o número, e o motivo é o mesmo para os 137: o que
 * mudou foi a classificação, não a aritmética de cada um.
 */
export const MOTIVO_EXPERIMENTACAO =
  'O time de validação considerou este projeto uma experimentação: o impacto medido até ' +
  'agora ainda é pequeno para entrar como resultado. Experimentar faz parte do processo, ' +
  'então siga investindo em novas soluções: quando o ganho crescer e puder ser medido, ' +
  'é só reenviar.';

/**
 * A ASSINATURA do motivo que a rodada de 04/09 gravou.
 *
 * Serve para o script de reescrita reconhecer a célula que ele pode substituir. ⚠️ É o que
 * impede a reescrita de atropelar reprovação MANUAL da triagem: na base há reprovado com
 * motivo escrito à mão (por exemplo "Godocs não pode ser submetido."), e sobrescrever
 * aquilo apagaria o julgamento de uma pessoa. Alvo = está no snapshot da rodada **E** a
 * célula ainda é a da rodada.
 */
export const ASSINATURA_MOTIVO_RODADA_04_09 = 'revisão retroativa da base (04/09/2026)';

/** TRUE quando a célula de motivo ainda é a que a rodada de 04/09 gravou. */
export function ehMotivoDaRodada0409(motivo: string | null | undefined): boolean {
  return String(motivo ?? '').includes(ASSINATURA_MOTIVO_RODADA_04_09);
}
