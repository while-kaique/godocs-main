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
