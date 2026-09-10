// ⚠️ **A DECISÃO DE GENTE VENCE O AGENTE. Sempre.** Módulo PURO.
//
// Pedido do dono do produto em 10/09/2026, depois de ver acontecer na base:
// *"O bruno esta alterando estrelas que ele n concorda e que o agente deu… mas nosso agente esta
// mudando essas estrelas (vi acontecer com sendapp, bruno classificou como 7 e o agente tava
// botando 2)"* e *"vi o time de agente mudando status de projeto ja aprovado para
// reprovado/pendente. Tb nao deve acontecer"*.
//
// Os três casos MEDIDOS no `admin_activity_log` de produção, e cada um é uma linha desta régua:
//   • «SendApp» — Bruno confirmou **Aprovado às 19:57:15**; o agente gravou **Pendente às
//     20:00:44**, 3 minutos depois;
//   • «GoDocs» — o dono reprovou em 26/08; o agente **aprovou** hoje;
//   • «Plataforma SmartOnline - Captura de XMLs» — o dono marcou **Descontinuado** em 08/09; o
//     agente gravou **Reprovado** hoje.
//
// ⚠️ **Por que virou régua declarada e não um `if` no fluxo:** as duas proteções que existiam
// falhavam por motivos diferentes e nenhuma era visível de fora. A nota tinha âncora, mas
// **atrás de `if (!opts.forcar)`** — e `forcar` é o que toda rerodada manual usa, então a âncora
// era exatamente o que se perdia quando alguém pedia para reavaliar. O status não tinha proteção
// nenhuma: `Descontinuado` deveria significar "não encoste" e o agente escreveu por cima.
//
// A assimetria dos erros é o argumento: o agente errando para menos custa uma rodada; o agente
// apagando a decisão de um gestor custa a confiança na ferramenta inteira — e é irrecuperável sem
// alguém notar por acaso, como aconteceu.

/** O ator que o time de agentes usa nas duas auditorias. Fonte única. */
export const ATOR_AGENTE = 'time-de-agentes@godocs';

/** Quem gravou isto foi gente? (`null`/vazio = origem desconhecida → tratado como GENTE) */
export function ehAtorHumano(ator: string | null | undefined): boolean {
  const a = String(ator ?? '').trim().toLowerCase();
  // ⚠️ **Default invertido de propósito:** ausência de ator é lida como HUMANO. Os dois erros não
  // são simétricos — tratar o desconhecido como agente autorizaria sobrescrever justamente as
  // linhas antigas, cuja origem não se sabe.
  if (!a) return true;
  return a !== ATOR_AGENTE;
}

/**
 * Status que o agente **nunca** rebaixa nem reescreve, aconteça o que acontecer na avaliação.
 *
 * ⚠️ `Aprovado` está aqui por decisão direta do dono do produto. Um projeto aprovado já passou
 * por gente; reabri-lo é trabalho de gente também (a triagem muda na tela quando quiser). E
 * `Descontinuado` é flag do DONO do projeto ("a automação não roda mais"), não um veredito de
 * mérito — reprová-la responde outra pergunta.
 */
export const STATUS_INTOCAVEIS_PELO_AGENTE = ['Aprovado', 'Descontinuado'] as const;

export type MotivoDeNaoEncostar = 'aprovado' | 'descontinuado' | 'decisao_humana' | null;

/**
 * O agente pode gravar `alvo` neste projeto? PURA.
 *
 * Régua, em ordem:
 *  1. **manter o mesmo status é sempre permitido** (idempotência não é sobrescrita);
 *  2. status **intocável** (`Aprovado`, `Descontinuado`) → não encosta;
 *  3. o status atual foi escrito por **gente** → não encosta.
 *
 * ⚠️ A regra 3 é a geral e as outras duas são cinto de segurança: elas valem mesmo quando o log
 * não chegou (falha de leitura, projeto legado sem auditoria), e é por isso que não são derivadas.
 */
export function podeAgenteGravarStatus(args: {
  statusAtual: string | null | undefined;
  alvo: string;
  /**
   * Quem gravou o status ATUAL. `undefined` = a auditoria não respondeu · `null` = não há registro
   * (ninguém decidiu) · string = o ator.
   */
  atorDoStatusAtual?: string | null;
}): { pode: boolean; motivo: MotivoDeNaoEncostar } {
  const atual = String(args.statusAtual ?? '').trim();
  const alvo = String(args.alvo ?? '').trim();
  if (!atual) return { pode: true, motivo: null };
  if (atual.toLowerCase() === alvo.toLowerCase()) return { pode: true, motivo: null };

  const chave = atual.toLowerCase();
  if (chave === 'aprovado') return { pode: false, motivo: 'aprovado' };
  if (chave === 'descontinuado') return { pode: false, motivo: 'descontinuado' };

  // ⚠️ **TRÊS estados, e confundi-los foi meu erro na primeira versão:**
  //   • `undefined` = a auditoria não respondeu (falha de leitura) → só valem as travas duras
  //     acima, senão uma falha de log paralisaria o funil inteiro;
  //   • `null` = **não há histórico**, ninguém decidiu este status → o agente pode agir;
  //   • string = ator conhecido; se for gente, o agente não encosta (e origem em branco dentro de
  //     um registro que EXISTE conta como gente, pelo default invertido de `ehAtorHumano`).
  if (args.atorDoStatusAtual === undefined || args.atorDoStatusAtual === null) {
    return { pode: true, motivo: null };
  }
  if (ehAtorHumano(args.atorDoStatusAtual)) return { pode: false, motivo: 'decisao_humana' };
  return { pode: true, motivo: null };
}

/** A frase que vai para o log quando o agente se recusa a encostar. Fonte única. */
export function porqueNaoEncostou(motivo: Exclude<MotivoDeNaoEncostar, null>, alvo: string): string {
  if (motivo === 'aprovado') {
    return `O projeto já está Aprovado e o agente não rebaixa aprovação de ninguém: a avaliação concluiu ${alvo} e fica registrada como recomendação.`;
  }
  if (motivo === 'descontinuado') {
    return `O projeto está marcado como Descontinuado pelo dono dele, o que não é um veredito de mérito: o agente não escreve por cima (concluiu ${alvo}).`;
  }
  return `O status atual foi decidido por uma pessoa, então o agente não escreve por cima (concluiu ${alvo}).`;
}

/**
 * O agente pode ESCREVER a nota deste projeto? PURA.
 *
 * ⚠️ **`forcar` NÃO fura esta régua** — é a correção do defeito. `forcar` quer dizer "rode a
 * avaliação de novo", nunca "sobrescreva a nota que uma pessoa deu": o «SendApp» tinha **7★ do
 * Bruno** e voltou a **2★** por causa de uma rerodada.
 *
 * A nota na célula é do AGENTE quando bate com o que ele recomendou em `Estrela Agente` — e só
 * nesse caso ele pode reescrever. Qualquer outro número é de gente, inclusive (e sobretudo) um
 * número da faixa 6–10, que a régua do agente se recusa a afirmar.
 */
export function podeAgenteEscreverNota(args: {
  /** O que está na coluna `Estrelas` hoje. */
  naCelula: number | null;
  /** O que o agente recomendou em `Estrela Agente` (texto cru: pode ser "6-10"). */
  recomendadaPeloAgente: string | null | undefined;
  /** Houve registro de alteração HUMANA de estrelas na auditoria deste projeto? */
  humanoMexeu?: boolean;
}): { pode: boolean; ancora: number | null } {
  const naCelula = typeof args.naCelula === 'number' && Number.isFinite(args.naCelula) ? args.naCelula : null;
  if (naCelula === null) return { pode: true, ancora: null };
  if (args.humanoMexeu) return { pode: false, ancora: naCelula };
  const rec = String(args.recomendadaPeloAgente ?? '').trim();
  const foiOAgente = rec !== '' && String(naCelula) === rec;
  if (foiOAgente) return { pode: true, ancora: null };
  // ⚠️ Célula com número e sem recomendação que bata = alguém digitou. Inclui o `0`, que é
  // veredito («Experimenta») desde 05/09 e não pode ser tratado como célula vazia.
  return { pode: false, ancora: naCelula };
}
