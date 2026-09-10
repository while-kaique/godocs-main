// A JUNTA: funde a análise do IMPACTO e a da ESTRELA em UMA decisão de funil. PURO.
//
// ⚠️ **Por que existe** (decisão do dono do produto, 09/09/2026, olhando o grafo): *"Tem que ser um
// grande time que cuida de ambos como um so, aprovar o projeto como um tudo seja nota como seja o
// impacto, e o impacto possui informações importantes para ajudar a definir estrelas tambem"*.
// Até aqui o código rodava **duas avaliações independentes do mesmo projeto** em paralelo
// (`Promise.allSettled([mesa, time])`): o veredito saía da MESA, a nota saía do TIME, e as duas
// nunca se falavam. A ficha mostrava as duas metades lado a lado como se fossem um time; o grafo
// desenhava uma peça de fusão que não existia em lugar nenhum.
//
// ⚠️ **Esta peça é a caixa "Junta as duas análises" do desenho.** Ela não julga nada: não chama
// LLM, não recalcula número, não reabre debate. Ela decide o que fazer quando as duas metades
// concordam e o que fazer quando discordam — e é só isso que faltava para o time ser um.
//
// ⚠️ **A régua da discordância é conservadora por construção:** quando as metades divergem, a
// saída é PENDENTE, nunca a média nem "a que gritou mais alto". Os dois erros não são simétricos —
// aprovar por engano custa uma correção da triagem, reprovar por engano apaga o trabalho de
// alguém — e este repo já pagou o preço de fechar desfecho negativo na dúvida.
import { statusDoFunil, type DecisaoDoFunil, type StatusFunil } from '@/lib/funil-status';

/** O que a metade do IMPACTO (a mesa) concluiu. `null` = não rodou (falhou, ou é especial). */
export type LadoImpacto = { veredito: string } | null;

/** O que a metade da ESTRELA (o time) concluiu. `null` = não rodou. */
export type LadoEstrela = {
  saida: string;
  escape?: boolean | null;
  estrela?: number | null;
  confianca?: 'alta' | 'media' | 'baixa' | null;
} | null;

export type Juncao = DecisaoDoFunil & {
  /** As duas metades apontaram para o mesmo status? */
  concordam: boolean;
  /** A confiança que sobrevive à junção (discordância derruba para baixa). */
  confianca: 'alta' | 'media' | 'baixa';
  /** Uma linha por razão, na ordem em que pesaram. É o que vira parecer legível. */
  porques: string[];
  /** A reprovação veio de "não deu para validar", não de régua de mérito. Muda o TOM do texto. */
  semMaterial?: boolean;
};

/** Veredito da MESA → status do funil. Vocabulário dela, não do time. */
function statusDaMesa(veredito: string): StatusFunil {
  const v = veredito.trim().toLowerCase();
  if (v === 'aprovar' || v === 'aprovado') return 'Aprovado';
  if (v === 'reprovar' || v === 'reprovado') return 'Reprovado';
  // `em_validacao`, `isento`, `ajuste`, desconhecido: tudo que espera gente é Pendente.
  return 'Pendente';
}

/**
 * Funde as duas metades. PURA.
 *
 * As regras, e cada uma responde a um jeito conhecido de errar:
 *
 * 1. **Faixa 6-10 vence tudo** → `Pendente` com flag. O agente aprovaria; quem crava 6..10 é o
 *    comitê, e a régua se recusa a afirmar a posição.
 * 2. **As duas metades concordam** → é a decisão, com a confiança do time.
 * 3. **Discordam** → `Pendente`, com as duas posições nomeadas e confiança `baixa`. Nunca a média.
 * 4. **Falta uma metade** (falhou) → `Pendente`, salvo o caso declarado do especial: a mesa é
 *    NO-OP para especial por decisão antiga (sem memorial financeiro não há o que ela julgue),
 *    então ali o time decide sozinho. Sem essa exceção, todo especial ficaria pendente para sempre.
 * 5. **Nenhuma metade** → `Pendente`. Ausência de julgamento nunca é decisão.
 */
export function juntarAnalises(args: {
  impacto: LadoImpacto;
  estrela: LadoEstrela;
  especial?: boolean;
  /**
   * O funil deixa de aceitar Pendente como desfecho do agente: tudo que não é Aprovado e não é a
   * faixa 6-10 vira **Reprovado com justificativa exortativa**.
   *
   * ⚠️ **É decisão de PRODUTO, não otimização** — e o preço é explícito: o autor recebe uma
   * reprovação em vez de um silêncio. Em troca, o funil esvazia e ninguém fica num limbo que
   * ninguém olha (medido em 10/09/2026: 59 projetos em Pendente, a maioria com pergunta concreta
   * ao autor, e o cron não os busca porque já têm nota).
   * ⚠️ A faixa **6-10 continua Pendente**: ali o agente aprovaria e o que falta é o comitê cravar
   * o número — reprovar seria afirmar o oposto do que o time concluiu.
   */
  fecharPendente?: boolean;
}): Juncao {
  const { impacto, estrela } = args;
  const especial = args.especial === true;
  const porques: string[] = [];

  const doTime = estrela ? statusDoFunil({ saida: estrela.saida, escape: estrela.escape }) : null;
  const daMesa = impacto ? statusDaMesa(impacto.veredito) : null;
  const confTime = estrela?.confianca ?? 'baixa';

  // 1 — a faixa de escape
  if (doTime?.flag6a10) {
    porques.push(doTime.porque);
    if (daMesa && daMesa !== 'Aprovado') {
      porques.push(`A análise do impacto ficou em ${daMesa}, então há o que conferir junto com a estrela.`);
    }
    return { ...doTime, concordam: daMesa === 'Aprovado', confianca: confTime, porques };
  }

  // 5 / 4 — metades ausentes
  if (!doTime && !daMesa) {
    return {
      status: 'Pendente',
      flag6a10: false,
      porque: 'Nenhuma das duas metades do time concluiu: sem julgamento não há decisão.',
      concordam: false,
      confianca: 'baixa',
      porques: ['Nenhuma das duas metades do time concluiu: sem julgamento não há decisão.'],
    };
  }
  if (!daMesa) {
    if (especial && doTime) {
      porques.push('Projeto especial: a análise de impacto não se aplica (não há memorial financeiro), então vale a do time da estrela.');
      porques.push(doTime.porque);
      return { ...doTime, concordam: true, confianca: confTime, porques };
    }
    porques.push('A análise do impacto não concluiu, e uma decisão de funil precisa das duas metades.');
    if (doTime) porques.push(`O time da estrela concluiu: ${doTime.porque}`);
    return { status: 'Pendente', flag6a10: false, porque: porques[0], concordam: false, confianca: 'baixa', porques };
  }
  if (!doTime) {
    porques.push('O time da estrela não concluiu, e uma decisão de funil precisa das duas metades.');
    porques.push(`A análise do impacto concluiu: ${daMesa}.`);
    return { status: 'Pendente', flag6a10: false, porque: porques[0], concordam: false, confianca: 'baixa', porques };
  }

  // 2b — ⚠️ **O MÉRITO TEM UM DONO SÓ: a mesa.** Medido em prod (10/09/2026, 9 projetos do
  // backlog): a mesa aprovou **8 de 9** e a junta mandou **7** para Pendente, porque o time
  // devolvia `ajuste`. Não era divergência de conteúdo: são **duas implementações do MESMO
  // julgamento de mérito** (5 especialistas cada) discordando entre si, e tratar isso como dúvida
  // legítima paralisava o funil inteiro — que é o defeito que este arquivo existe para matar.
  //
  // A mesa é quem tem a régua calibrada (o piso composto, as lições da triagem, as rodadas 9 e 10
  // medidas) e é ela que roda em produção a cada submissão. O time entra com o que só ele produz:
  // a NOTA. Então: mérito da mesa + nota do time = uma análise só.
  //
  // ⚠️ O que o time AINDA veta, e por isso não é "a mesa decide sozinha":
  //   • `reprovar` do time (régua mecânica: piso composto ou invalidez citada) — tratado acima;
  //   • a faixa **6-10** — tratada no passo 1, e ela vence tudo;
  //   • a nota, que a mesa não produz.
  // ⚠️ E `ajuste` do time NÃO é descartado: ele vira a JUSTIFICATIVA que o autor lê, com as
  // perguntas dos especialistas. O que ele deixou de fazer é impedir a decisão.
  if (daMesa === 'Aprovado' && doTime.status === 'Pendente') {
    porques.push('O time do impacto aprovou o projeto.');
    if (doTime.status === 'Pendente') {
      porques.push('A avaliação da estrela levantou pontos a acompanhar, que ficam registrados no parecer, e não impedem a aprovação do mérito.');
    }
    return {
      status: 'Aprovado',
      flag6a10: false,
      porque: 'O time do impacto aprovou o projeto; o mérito é dele.',
      concordam: false,
      confianca: confTime,
      porques,
    };
  }

  // 3b-espelho — ⚠️ **A REPROVAÇÃO MECÂNICA DA MESA também não é divergência.**
  //
  // Eu criei a regra 3b só para o lado do TIME e esqueci o espelho dela: no `GoCaixa` (prod,
  // 10/09/2026) a mesa reprovou por régua — *"impacto declarado de R$ 16,55/mês, abaixo do piso
  // de R$ 100,00, e a nota do projeto é 0"* — o time não reprovou junto, e a junta gravou
  // **Pendente**, jogando fora uma decisão que é aritmética.
  //
  // ⚠️ Mesmo limite do outro lado: só vale quando o TIME não aprovou. Time aprovando contra mesa
  // reprovando é divergência DE VERDADE e cai em Pendente, porque aí duas leituras do mesmo
  // material discordam — não é uma metade sem o número na mão.
  if (daMesa === 'Reprovado' && doTime.status !== 'Aprovado') {
    porques.push('A análise do impacto reprovou o projeto por régua declarada.');
    if (doTime.status === 'Pendente') {
      porques.push('A avaliação da estrela não aprovou o projeto, então não há leitura que sustente mantê-lo.');
    }
    return {
      status: 'Reprovado',
      flag6a10: false,
      porque: 'A análise do impacto reprovou por régua declarada e a estrela não sustenta o contrário.',
      concordam: doTime.status === daMesa,
      confianca: confTime,
      porques,
    };
  }

  // 3c — o funil sem Pendente (opt-in, ver `fecharPendente`)
  // ⚠️ A condição é **só sobre a MESA**, e isso é coerência com a regra 2b: o mérito tem UM dono.
  // Se a aprovação da mesa vale mesmo quando o time não aprova, o inverso também vale — a mesa em
  // `em_validacao` significa mérito não estabelecido, e a aprovação do time não o estabelece.
  // _(medido em prod, 10/09/2026: a 1ª versão exigia que NENHUM dos dois tivesse aprovado, e o
  // primeiro projeto da fila veio com mesa `em_validacao` + time `aprovar` — caiu em "divergiram"
  // e voltou para Pendente, justamente o limbo que esta regra existe para fechar.)_
  if (args.fecharPendente && daMesa !== 'Aprovado') {
    porques.push(
      'O time não conseguiu validar o projeto com o material que existe, então o desfecho é reprovar com o que falta declarado, em vez de deixá-lo esperando sem dono.',
    );
    return {
      status: 'Reprovado',
      flag6a10: false,
      porque: 'O time não fechou com o material que existe: reprovado com o que falta, e o reenvio reabre.',
      concordam: doTime.status === daMesa,
      confianca: confTime,
      porques,
      semMaterial: true,
    };
  }

  // 2 — concordam
  if (doTime.status === daMesa) {
    porques.push(`As duas metades do time chegaram ao mesmo lugar: ${daMesa}.`);
    porques.push(doTime.porque);
    return { ...doTime, concordam: true, confianca: confTime, porques };
  }

  // 3b — ⚠️ **REPROVAÇÃO MECÂNICA não é divergência: é a mesa sem a nota em mãos.**
  //
  // O time só reprova por RÉGUA DECLARADA (piso de impacto composto ou invalidez nomeada e
  // citada), e a régua do piso precisa de DOIS números: o impacto e a nota. O time tem os dois na
  // mesma passada; a MESA lê a nota da coluna `Estrela Agente` da planilha, que está vazia em todo
  // projeto que o time nunca avaliou — ou seja, na primeira passada ela não tem como chegar ao
  // mesmo lugar, e tratar isso como "as metades divergiram" bloquearia a decisão correta e exigiria
  // uma segunda rodada inteira só para a mesa enxergar o que o time acabou de escrever.
  //
  // ⚠️ O limite é estreito e está aqui: só vale quando a mesa **não aprovou**. Mesa aprovando
  // contra time reprovando é divergência DE VERDADE (ela julgou o mérito com o material todo) e cai
  // em Pendente, como qualquer outra.
  if (doTime.status === 'Reprovado' && daMesa !== 'Aprovado') {
    porques.push(doTime.porque);
    porques.push(
      `A análise do impacto ficou em ${daMesa} e não contradiz a reprovação: a régua do piso depende da nota, que o time acabou de avaliar.`,
    );
    return { ...doTime, concordam: false, confianca: confTime, porques };
  }

  // 3 — discordam
  porques.push(
    `As duas metades do time divergiram: a análise do impacto aponta ${daMesa} e a da estrela aponta ${doTime.status}. Fica pendente para gente decidir.`,
  );
  porques.push(`Pela estrela: ${doTime.porque}`);
  return {
    status: 'Pendente',
    flag6a10: false,
    porque: porques[0],
    concordam: false,
    confianca: 'baixa',
    porques,
  };
}
