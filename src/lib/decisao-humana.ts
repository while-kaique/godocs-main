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

/** Um registro de escrita de status, como a auditoria guarda. */
export type EscritaDeStatus = {
  /** Quem escreveu. Vazio/ausente conta como GENTE (default invertido). */
  ator?: string | null;
  /** Carimbo comparável como texto ISO/`YYYY-MM-DD HH:MM:SS` (é o formato do log). */
  quando?: string | null;
};

/**
 * Existe decisão de admin que o agente não pode desfazer? PURA.
 *
 * ⚠️ **Isto fecha o buraco que a 1ª versão da trava deixou** (10/09/2026, pedido do dono do
 * produto: *"travar para que o agente [não] faça mudanças em cima do que nós do admin tenhamos
 * alterado"*). Olhar só **quem escreveu o status ATUAL** protege contra o primeiro atropelo e
 * libera todos os seguintes: depois que o agente escreveu por cima uma vez, o status atual passa a
 * ser dele e a trava se abre — exatamente o que aconteceu no «SendApp», onde ele gravou Pendente
 * **três vezes** (20:00, 20:09, 20:54) depois de o Bruno ter aprovado às 19:57.
 *
 * A régua: havendo decisão humana no histórico, o agente **só volta a agir se o autor reenviou
 * depois dela** — e aí não é sobreposição, é fato novo (o reenvio reabre a avaliação, que é o
 * desenho já aprovado do funil).
 */
export function decisaoDeAdminBloqueia(args: {
  historico?: readonly EscritaDeStatus[] | null;
  /** Carimbo do último reenvio do autor, se houve. */
  ultimoReenvioEm?: string | null;
}): boolean {
  const hist = args.historico ?? [];
  if (!hist.length) return false;
  const humanas = hist
    .filter((h) => ehAtorHumano(h.ator))
    .map((h) => String(h.quando ?? '').trim())
    .filter(Boolean)
    .sort();
  if (!humanas.length) {
    // Há histórico, todo do agente, sem carimbo legível: nada a proteger aqui.
    return hist.some((h) => ehAtorHumano(h.ator));
  }
  const ultimaHumana = humanas[humanas.length - 1];
  const reenvio = String(args.ultimoReenvioEm ?? '').trim();
  // ⚠️ Comparação de STRING é proposital: os dois carimbos vêm do mesmo formato do SQLite
  // (`YYYY-MM-DD HH:MM:SS`), que é ordenável como texto. Converter para Date aqui só criaria uma
  // chance de fuso trocado — e o empate protege a decisão humana.
  if (reenvio && reenvio > ultimaHumana) return false;
  return true;
}

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
  /**
   * O histórico de escritas de status do projeto (qualquer ordem). Com ele, a régua deixa de
   * olhar só a última escrita e passa a respeitar QUALQUER decisão de admin ainda válida — ver
   * `decisaoDeAdminBloqueia`.
   */
  historico?: readonly EscritaDeStatus[] | null;
  /** Carimbo do último reenvio do autor: é o único fato que reabre a avaliação. */
  ultimoReenvioEm?: string | null;
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
  // ⚠️ **O REENVIO do autor reabre a avaliação — inclusive contra a última escrita humana**
  // (11/09/2026, caso «Íris [Analista de review]»/Larissa): o Luis aprovou a v1 em 21/08, a autora
  // reenviou a v2 em 11/09 (Status voltou a Pendente) e o time concluiu Aprovado — mas o último
  // status_log era o do Luis, então esta checagem barrava com "a triagem já decidiu", e a régua do
  // reenvio (`decisaoDeAdminBloqueia`) nunca era consultada. Quando o histórico mostra que houve
  // reenvio DEPOIS da última decisão humana, o ator do status atual deixa de bloquear sozinho.
  const reabertoPorReenvio =
    !!args.historico?.length &&
    !!String(args.ultimoReenvioEm ?? '').trim() &&
    !decisaoDeAdminBloqueia({ historico: args.historico, ultimoReenvioEm: args.ultimoReenvioEm });
  if (
    !reabertoPorReenvio &&
    args.atorDoStatusAtual !== undefined &&
    args.atorDoStatusAtual !== null &&
    ehAtorHumano(args.atorDoStatusAtual)
  ) {
    return { pode: false, motivo: 'decisao_humana' };
  }
  // ⚠️ E a decisão de admin ANTERIOR também vale, mesmo que a última escrita tenha sido do
  // agente: sem isto, o primeiro atropelo autoriza todos os próximos.
  if (decisaoDeAdminBloqueia({ historico: args.historico, ultimoReenvioEm: args.ultimoReenvioEm })) {
    return { pode: false, motivo: 'decisao_humana' };
  }
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
  return `A triagem já decidiu o status deste projeto, então o agente não escreve por cima (concluiu ${alvo}). A avaliação volta a valer quando o autor reenviar.`;
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
