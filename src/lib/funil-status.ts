// O FUNIL do GoDocs tem TRÊS status, e este módulo é a fonte única do mapa
// "desfecho do time de agentes → status da planilha". PURO.
//
// ⚠️ **Decisão do dono do produto (09/09/2026):** *"O godocs nao vai ter mais no funil outro
// status senao aprovado, pendente ou reprovado"*. Antes eram seis na lista gravável
// (`STATUS_GRAVAVEIS`), e três deles diziam a mesma coisa com nomes diferentes: `Em validação` é
// "esperando", que é `Pendente`; `Reenvio Pendente` é "esperando o autor"; `Descontinuado` não é
// etapa de funil nenhuma, é arquivo.
//
// ⚠️ **`Descontinuado` fica FORA do funil, de propósito** — não é um 4º status, é o dono dizendo
// que a automação não roda mais (`projetos.descontinuado` é a fonte da verdade, e o Status da
// planilha só reflete). Projeto descontinuado **não é julgado pelo time**: julgar mérito de algo
// que foi desligado gasta chamada e produz um veredito que ninguém vai aplicar.

/** Os três, e só estes três. */
export const STATUS_FUNIL = ['Aprovado', 'Pendente', 'Reprovado'] as const;
export type StatusFunil = (typeof STATUS_FUNIL)[number];

/** Fora do funil: existe na coluna, não é etapa. */
export const STATUS_FORA_DO_FUNIL = ['Descontinuado'] as const;

/** O que o time conclui, como chega aqui. */
export type DesfechoDoTime = {
  /** `aprovar` · `reprovar` · `humano` · `ajuste` (a 4ª saída interna, ver abaixo). */
  saida: string;
  /** O time pôs o projeto na faixa 6-10 com os dois gatilhos citados? */
  escape?: boolean | null;
};

export type DecisaoDoFunil = {
  status: StatusFunil;
  /**
   * A flag 6-10. ⚠️ Ela NÃO é um status: é um aviso de que **o agente aprovaria** e o projeto só
   * não está aprovado porque a posição na faixa (6, 7, 8, 9 ou 10) é do comitê humano. Palavras do
   * dono do produto: *"se é 6-10 é passivel de approve do agente, so n é aprovado pq vai precisar
   * do humano definir o 6 a 10"*.
   */
  flag6a10: boolean;
  /** A frase que vai para a coluna de observação, para o status nunca aparecer sem porquê. */
  porque: string;
};

/**
 * Desfecho do time → status do funil. PURA.
 *
 * ⚠️ **A 4ª saída interna (`ajuste`) NÃO virou um 4º status.** Ela existe no consenso porque
 * carrega as PERGUNTAS ao autor, e isso é informação boa; o que ela não pode é abrir uma fila
 * própria na planilha. No funil ela é `Pendente`, como todo desfecho que espera gente.
 * ⚠️ **Desfecho desconhecido → `Pendente`**, nunca `Aprovado` nem `Reprovado`: ampliar o enum do
 * consenso sem passar por aqui não pode aprovar nem reprovar projeto por acidente (é a lição do
 * `Dispensado` que virava `Pré-reprovado` num fall-through e afirmava que o líder reprovou).
 */
export function statusDoFunil(d: DesfechoDoTime): DecisaoDoFunil {
  if (d.escape === true) {
    return {
      status: 'Pendente',
      flag6a10: true,
      porque:
        'O time avaliou e o projeto se sustenta, mas caiu na faixa 6 a 10: fica pendente até o comitê humano cravar a estrela (6, 7, 8, 9 ou 10) e aprovar.',
    };
  }
  if (d.saida === 'aprovar') {
    return { status: 'Aprovado', flag6a10: false, porque: 'O time de agentes aprovou o projeto.' };
  }
  if (d.saida === 'reprovar') {
    return { status: 'Reprovado', flag6a10: false, porque: 'O time de agentes reprovou o projeto por régua declarada.' };
  }
  if (d.saida === 'ajuste') {
    return { status: 'Pendente', flag6a10: false, porque: 'O time pede ajuste ao autor antes de decidir.' };
  }
  if (d.saida === 'humano') {
    return { status: 'Pendente', flag6a10: false, porque: 'O time não fechou sozinho e a decisão é de gente.' };
  }
  return { status: 'Pendente', flag6a10: false, porque: `Desfecho não reconhecido (${d.saida}): fica pendente para conferência humana.` };
}

/**
 * Status LEGADO da planilha → status do funil. PURA.
 *
 * Devolve `null` para quem **não é etapa de funil** (hoje só `Descontinuado`): `null` significa
 * "não encoste nesta célula", que é diferente de "vira Pendente".
 *
 * ⚠️ **`Reenvio Pendente` colapsa em `Pendente`, e isso tem UM efeito colateral a resolver antes
 * de aplicar em massa:** o disparo de e-mails tem um segmento (`reenvio`) que lê exatamente esse
 * texto na coluna Status para montar a audiência. Colapsar os 21 projetos que estão nesse estado
 * **esvazia esse segmento**. Quem manda o e-mail é gente, então isto é decisão de produto, não
 * detalhe de implementação: a lista dos 21 vai no relatório antes de qualquer escrita.
 */
export function statusFunilDeLegado(bruto: string | null | undefined): StatusFunil | null {
  const t = String(bruto ?? '').trim().toLowerCase();
  if (!t) return 'Pendente';
  if (t === 'aprovado') return 'Aprovado';
  if (t === 'reprovado' || t === 'rejeitado') return 'Reprovado';
  if (t === 'descontinuado') return null;
  // 'pendente' · 'em validação' · 'reenvio pendente' · qualquer coisa nova
  return 'Pendente';
}

/** O projeto entra na fila do time? PURA. Descontinuado não entra (ver o topo do arquivo). */
export function entraNaFilaDoTime(statusBruto: string | null | undefined): boolean {
  return statusFunilDeLegado(statusBruto) !== null;
}

// ─── A justificativa que o AUTOR lê ──────────────────────────────────────────────────────────────

/** Teto da coluna `Motivo Reprovado` no schema. O corte é no fim, com reticência. */
export const MOTIVO_REPROVADO_MAX = 4000;

/**
 * O texto da reprovação, montado pela CAUSA REAL. PURO.
 *
 * ⚠️ **Não é um carimbo.** Pedido do dono do produto (10/09/2026): *"é pra garantir que nem todo
 * projeto reprovado vai receber a mensagem de experimentação. Se um projeto por exemplo que tem
 * reenvio pendente e nao foi enviado pelo autor o reenvio, deve ser esclarecido pelo agente o
 * motivo pelo qual ele ta sendo reprovado e aguarda resubmissao do autor"*.
 *
 * O caso do REENVIO é o que mais precisa disso, e é detectável sem LLM: o Status ainda é
 * `Reenvio Pendente`, ou seja a triagem devolveu o projeto e **nenhum reenvio chegou** (um reenvio
 * reescreve o Status). Dizer a esse autor que o projeto "é experimentação" ou que "o ganho é
 * pequeno" é responder outra pergunta: o que aconteceu foi que o ajuste pedido nunca voltou.
 *
 * ⚠️ A justificativa do reenvio é **exortativa, não anuladora**: ela termina em "reenvie e o time
 * reavalia", porque é literalmente o que acontece (o reenvio reabre a avaliação). As outras causas
 * seguem levando os porquês da junta, que já vêm com o eixo nomeado.
 */
export function justificativaDaReprovacao(args: {
  porques: readonly string[];
  /** O parecer dos especialistas, quando houver. */
  parecerDaMesa?: string | null;
  /** O Status que a linha tinha ANTES desta decisão. */
  statusAnterior?: string | null;
  /** O que a triagem pediu na coluna `Motivo Reenvio`, quando pediu algo. */
  motivoReenvio?: string | null;
  /**
   * A reprovação veio de "o time não fechou com o material que existe" (o Pendente que o funil
   * deixou de aceitar), e não de uma régua de mérito. Muda o TOM: aqui a justificativa é
   * EXORTATIVA — ela diz o que falta e que reenviar reabre a avaliação.
   */
  semMaterial?: boolean;
}): string {
  const partes: string[] = [];
  const anterior = String(args.statusAnterior ?? '').trim().toLowerCase();
  const pedido = String(args.motivoReenvio ?? '').trim();
  const temPedido = pedido !== '' && pedido !== '—' && pedido !== '-';

  if (anterior === 'reenvio pendente' || anterior === 'rejeitado') {
    partes.push(
      'Este projeto foi devolvido pela triagem para ajuste e o reenvio não chegou. A reprovação é por isso, não por um julgamento do mérito do que você fez.',
    );
    if (temPedido) partes.push(`O que a triagem pediu: ${pedido}`);
    partes.push(
      'Para corrigir: edite o projeto com o ajuste e reenvie. O time reavalia o projeto no reenvio e a decisão pode mudar.',
    );
  } else if (args.semMaterial) {
    // ⚠️ **CONCISA por pedido do dono do produto** (10/09/2026): *"reprovar com justificativa
    // concisa"*. O parecer da mesa vem com uma linha por especialista e frases longas; despejá-lo
    // inteiro produz parede de texto, e parede de texto não é lida — foi a lição do aviso de
    // reprovação em "Meus Projetos", que precisou virar uma tira de uma linha.
    // A forma: UMA frase de veredito, UMA linha por ponto (cortada), UMA de saída.
    // ⚠️ O tom importa tanto quanto o tamanho: o time não disse que o projeto é ruim, disse que
    // não consegue validá-lo com o que está escrito — e a primeira frase diz isso.
    // ⚠️ **O PREÂMBULO CARIMBADO SAIU** (10/09/2026, dono do produto olhando 9 reprovações
    // seguidas): *"parece padornizado o motivo de reprovação, pelo amor de Deus, nao faz sentido
    // isso"*. A frase de abertura era literalmente a MESMA em todas — *"Reprovado por faltar
    // informação que sustente o ganho declarado. Não é um juízo sobre o valor do trabalho."* —,
    // então o autor lia primeiro um jargão institucional e só depois o que era dele. Pior: em
    // projeto de ganho imensurável ela AFIRMAVA um ganho declarado que não existia, e em projeto
    // com estrela ela contradizia a nota que o mesmo time acabara de dar (as duas coisas agora têm
    // trava própria na junta, e este ramo ficou raro — mas o texto que sobrou tem de ser honesto).
    //
    // A forma nova: o texto ABRE pelo ponto concreto do projeto e a régua vem depois, em uma linha.
    // Sem ponto concreto não há reprovação por material a redigir, e a frase diz só o que houve.
    const falta = resumirEmUmaFrase(args.parecerDaMesa);
    if (falta) {
      partes.push(`O que ficou sem resposta neste projeto: ${falta}`);
      partes.push(
        'O time não consegue confirmar o ganho com o que está escrito hoje. Isso não é um juízo sobre o valor do trabalho.',
      );
    } else {
      partes.push(
        'O time não conseguiu confirmar o ganho deste projeto com o material que existe hoje, e não há um ponto único a apontar.',
      );
    }
    partes.push('Responda esse ponto e reenvie: o reenvio reabre a avaliação.');
  } else {
    partes.push(...args.porques);
    const parecer = String(args.parecerDaMesa ?? '').trim();
    if (parecer) partes.push('', 'O que os especialistas apontaram:', parecer);
  }

  const t = partes.join('\n').trim();
  // ⚠️ **Nunca vazio.** Medido em prod: o «Feel Nutrition» apareceu Reprovado com `Motivo
  // Reprovado` em branco — o autor vê o card cinza e não tem o que responder. Sem causa
  // conhecida, o texto diz isso e manda para a triagem, que é a verdade.
  const texto =
    t ||
    'Reprovado sem uma causa registrada pelo time. Procure a triagem: este caso precisa de conferência humana.';
  return texto.length > MOTIVO_REPROVADO_MAX ? `${texto.slice(0, MOTIVO_REPROVADO_MAX - 1)}…` : texto;
}

/** Teto de cada ponto na justificativa concisa. Linha que não cabe na tela não é lida. */
export const PONTO_MAX = 190;
/** Quantos pontos entram. Acima disso deixa de ser "o que falta" e vira relatório. */
export const PONTOS_MAX = 3;

/**
 * O parecer da mesa reduzido a poucos pontos curtos. PURO.
 *
 * ⚠️ **Recorta, não reescreve** (a mesma disciplina do resumo do card do Chat): o texto é o do
 * especialista, com o rótulo dele preservado, cortado na primeira frase. Reescrever criaria uma
 * segunda voz dizendo por que o projeto foi reprovado.
 * ⚠️ Descarta a linha de fechamento do agregador ("Os especialistas divergiram…", "Só um
 * especialista objetou…"), que fala do PROCESSO e não do que o autor tem de fazer.
 */
export function resumirPontos(parecer?: string | null): string[] {
  const cru = String(parecer ?? '').trim();
  if (!cru) return [];
  const out: string[] = [];
  for (const linha of cru.split(/\r?\n/)) {
    const t = linha.trim();
    if (!t) continue;
    if (/^(os especialistas|só um especialista|nenhum especialista|o time)/i.test(t)) continue;
    const m = t.match(/^([^:]{3,24}:)?\s*(.*)$/);
    const rotulo = (m?.[1] ?? '').trim();
    const corpo = (m?.[2] ?? t).split(/(?<=[.!?])\s+/)[0].trim();
    const frase = `${rotulo ? rotulo + ' ' : ''}${corpo}`.replace(/\s{2,}/g, ' ');
    out.push(frase.length > PONTO_MAX ? `${frase.slice(0, PONTO_MAX - 1)}…` : frase);
    if (out.length >= PONTOS_MAX) break;
  }
  return out;
}

/** Teto do resumo do que falta. Curto por decisão: parede de texto não é lida. */
export const RESUMO_FALTA_MAX = 320;

/**
 * O que falta, em UMA frase, SEM dizer qual agente falou. PURO.
 *
 * ⚠️ **Pedido do dono do produto** (10/09/2026): *"n precisa deixar claro agente por agente para o
 * leitor. Quero ainda mais conciso"*. O autor não precisa saber que o Financeiro disse X e o Cético
 * disse Y — isso é organização INTERNA do time e só empurra o texto para longe de ser lido. Quem
 * quiser a atribuição por agente tem o painel da ficha, que mostra os quatro pareceres.
 * ⚠️ Continua **recortando, não reescrevendo**: pega a 1ª frase de cada ponto, tira o rótulo do
 * agente e emenda. Sem LLM — o texto sai igual todas as vezes e não custa chamada.
 */
export function resumirEmUmaFrase(parecer?: string | null): string {
  const pontos = resumirPontos(parecer).map((p) => {
    const semRotulo = p.replace(/^[^:]{3,24}:\s*/, '').trim();
    // minúscula na emenda, para virar uma frase só em vez de um bloco de sentenças soltas
    return semRotulo.charAt(0).toLowerCase() + semRotulo.slice(1).replace(/\.$/, '');
  });
  if (!pontos.length) return '';
  const t = pontos.join('; ') + '.';
  return t.length > RESUMO_FALTA_MAX ? `${t.slice(0, RESUMO_FALTA_MAX - 1)}…` : t;
}
