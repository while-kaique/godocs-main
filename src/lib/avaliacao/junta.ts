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
  /**
   * O cérebro da estrela JULGOU, ou a nota é o fallback dele?
   *
   * ⚠️ Sem este campo, `nota 0` significa duas coisas opostas — "o time olhou e é a caixa
   * «Experimenta»" e "o modelo não respondeu" — e a régua da nota abaixo trataria uma falha de
   * infraestrutura como julgamento. É o mesmo motivo pelo qual `SaidaEstrela.avaliada` existe.
   * `undefined` (chamador antigo) é lido como avaliada: quem passa nota sem dizer o contrário
   * está afirmando um julgamento.
   */
  avaliada?: boolean | null;
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

/**
 * A partir de quantas estrelas a NOTA sustenta o projeto no funil.
 *
 * ⚠️ **Por que existe (10/09/2026, dono do produto).** A regra 3c abaixo olhava só a mesa e
 * fechava em Reprovado tudo que ela não aprovava — **sem nunca olhar a nota**. Resultado medido em
 * prod: 9 projetos reprovados com estrela do time entre 1★ e 5★, inclusive a «Plataforma
 * Smartonline - Pagamento de DIFAL» (5★, R$ 117 mil/mês) e o «Painel de descritivos de cargo»
 * (2★). Palavras dele: *"Como pode um projeto valer estrelas e ser reprovado?"* e *"É
 * contraditorio demais… Nao era pra ser reprovado"*.
 *
 * A contradição é real e é de RÉGUA, não de afinação: a estrela ≥ 1★ afirma que o projeto está
 * numa das caixas da régua — informa, executa, garante, decide ou assume —, e essa é a mesma
 * pergunta que o funil faz ("isto é um projeto?"). Reprovar por falta de comprovação do NÚMERO,
 * depois de dizer que o projeto executa uma rotina recorrente, é responder as duas coisas ao
 * contrário no mesmo parecer.
 *
 * ⚠️ **O que a nota NÃO derruba:** a régua mecânica continua acima dela — piso composto (impacto
 * < R$ 100 **e** nota zero, onde 1★ nunca chega) e invalidez nomeada e citada (fora de uso,
 * ressubmissão), que são as duas portas do `reprovar` do time e a reprovação da mesa (3b/3b-espelho).
 * O que a nota fecha é só a porta do "não deu para validar o número".
 */
export const NOTA_SUSTENTA_APROVACAO = 1;

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
  /**
   * O projeto foi submetido SEM valor financeiro de ganho (ganho imensurável ou especial).
   *
   * ⚠️ É o discriminador da TRAVA 2 do passo 3c. Vem das categorias de ganho declaradas pelo
   * autor, não de `impacto === 0`: impacto zero também acontece em projeto que declarou número e
   * teve o número zerado por custo, e esse caso continua sendo "número a conferir".
   */
  semNumeroDeGanho?: boolean;
}): Juncao {
  const { impacto, estrela } = args;
  const especial = args.especial === true;
  const porques: string[] = [];

  const doTime = estrela ? statusDoFunil({ saida: estrela.saida, escape: estrela.escape }) : null;
  const daMesa = impacto ? statusDaMesa(impacto.veredito) : null;
  const confTime = estrela?.confianca ?? 'baixa';
  // A nota, e se ela é julgamento de fato (ver `LadoEstrela.avaliada` e `NOTA_SUSTENTA_APROVACAO`).
  const nota = typeof estrela?.estrela === 'number' && Number.isFinite(estrela.estrela) ? estrela.estrela : null;
  const notaSustenta = estrela?.avaliada !== false && nota !== null && nota >= NOTA_SUSTENTA_APROVACAO;

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
    // ⚠️ **TRAVA 1 — a NOTA sustenta o projeto.** Ver `NOTA_SUSTENTA_APROVACAO`: se o time
    // posicionou o projeto em 1★ ou mais, ele já respondeu "isto é um projeto" com a régua na mão.
    // Fechar em Reprovado por não confirmar o NÚMERO seria dizer o contrário no mesmo parecer.
    if (notaSustenta) {
      porques.push(
        `A avaliação da estrela colocou o projeto em ${nota}★, então ele está numa das caixas da régua: o projeto existe e faz o que descreve.`,
      );
      porques.push(
        'A análise do impacto não conseguiu confirmar o número do ganho com o material que existe. Isso fica registrado no parecer como ponto a acompanhar e não derruba o projeto.',
      );
      return {
        status: 'Aprovado',
        flag6a10: false,
        porque: `O projeto vale ${nota}★ pela régua; o que falta é confirmar o número, e isso fica como ressalva.`,
        concordam: false,
        confianca: confTime === 'alta' ? 'media' : confTime,
        porques,
      };
    }
    // ⚠️ **TRAVA 2 — sem número declarado não há "número não comprovado".** Ganho imensurável e
    // especial entram no GoDocs sem valor financeiro por decisão de produto, e a justificativa
    // deste ramo fala de "ganho declarado que não se sustenta": aplicá-la aqui é responder outra
    // pergunta. Medido em prod: «Acompanhamento de Despesa com Frete Real» (Ganho imensurável,
    // 2★) reprovado por *"faltar informação que sustente o ganho declarado"* — não havia ganho
    // declarado em número nenhum. Dono do produto: *"Tem que haver calibre devido para os que sao
    // subidos como ganho imensuravel"*.
    if (args.semNumeroDeGanho) {
      porques.push(
        'O projeto foi submetido como ganho sem valor financeiro, então não há número de ganho a confirmar: a régua do material não se aplica a ele.',
      );
      porques.push('Sem um número para conferir, quem decide o mérito é a triagem humana.');
      return {
        status: 'Pendente',
        flag6a10: false,
        porque: 'Ganho sem valor financeiro: não há número a comprovar, então a decisão é humana.',
        concordam: false,
        confianca: 'baixa',
        porques,
      };
    }
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
