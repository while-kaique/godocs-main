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
    // ⚠️ O tom aqui é o que decide se isto ajuda ou humilha. O time NÃO disse que o projeto é
    // ruim: disse que não consegue validá-lo com o que está escrito. A frase abre por isso, lista
    // o que os especialistas pediram e fecha em "reenvie", que é o caminho real de volta.
    partes.push(
      'O time avaliou este projeto e não conseguiu validá-lo com o material que existe hoje. Isto não é um juízo sobre o valor do que você fez: é a constatação de que falta informação para sustentar o ganho declarado.',
    );
    const parecer = String(args.parecerDaMesa ?? '').trim();
    if (parecer) partes.push('', 'O que precisa ser respondido:', parecer);
    partes.push(
      '',
      'Para corrigir: edite o projeto respondendo os pontos acima e reenvie. O reenvio reabre a avaliação e a decisão pode mudar.',
    );
  } else {
    partes.push(...args.porques);
    const parecer = String(args.parecerDaMesa ?? '').trim();
    if (parecer) partes.push('', 'O que os especialistas apontaram:', parecer);
  }

  const t = partes.join('\n').trim();
  return t.length > MOTIVO_REPROVADO_MAX ? `${t.slice(0, MOTIVO_REPROVADO_MAX - 1)}…` : t;
}
