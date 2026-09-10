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
