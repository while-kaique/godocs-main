// Cérebro C — o CONSENSO (T16). Módulo PURO: concilia mérito (A) × estrela (B) e decide a saída.
//
// D13: aprovação autônoma é o alvo; humano é EXCEÇÃO (escape 6–10, divergência que o debate não
// fechou, confiança baixa). D14: raciocínio livre, fecho MEDIDO — quem autoriza a saída a agir sem
// humano é `politicaDeLiberacao`, lendo a acurácia MEDIDA no retroativo por tipo de veredito; a
// confiança do agente é voto, a do SISTEMA é histórico de acerto. D16: escape sempre humano, com
// dossiê de comitê. Fail-closed herdado do agregador da mesa: o consenso nunca fecha um desfecho
// negativo sozinho.
import { confiancaDe, type Confianca, type Contestacao } from '@/lib/estrelas-regua';
import type { SaidaMerito, AuditoriaValor } from '@/lib/avaliacao/cerebro-merito';
import type { SaidaEstrela } from '@/lib/avaliacao/cerebro-estrela';
import { reprovaPeloPiso, motivoPisoComEstrela, notaParaOPiso } from '@/lib/materialidade-piso';

/**
 * ⚠️ `reprovar` entrou em 08/09/2026 (D4 do plano de calibragem). O time passa a poder reprovar
 * por **RÉGUA DECLARADA**, com DUAS portas e nada de juízo livre:
 *   (i)  **piso de impacto** — mecânica, `materialidade-piso.ts`, nenhum agente opina;
 *   (ii) **projeto inválido** — o agente tem de **NOMEAR** um dos motivos de `ROTULO_DESQ`
 *        (`fora_de_uso`, `ressubmissao`) **e CITAR** o trecho do material que comprova. Sem nome
 *        ou sem citação, **não reprova**.
 * ⚠️ Os outros 5 motivos do `PISO_ZERO` (`apenas_mensuravel`, `so_o_autor`, `simples_local`,
 * `marginal`, `experimentacao`) significam **nota zero**, NÃO reprovação (D4.1): 336 dos 637
 * projetos da run 9 são 0★ e reprová-los seria reprovar metade da base.
 * ⚠️ MODO SOMBRA: `reprovar` NUNCA age sozinho — não existe flag de liberação para ele (RF-246).
 */
export type SaidaConsenso = 'aprovar' | 'ajuste' | 'humano' | 'reprovar';
export type MedicaoVeredito = { acerto: number; erro_grave: number; n: number };
export type AcuraciaMedida = { aprovar?: MedicaoVeredito; ajuste?: MedicaoVeredito };

/** Metas do §11.4 do plano (números propostos; o Luis fixa). */
export const METAS_LIBERACAO = {
  aprovar: { acerto_min: 0.9, erro_grave_max: 0, n_min: 300 },
  ajuste: { acerto_min: 0.85, n_min: 300 },
} as const;

export type Liberacao = { aprovar: boolean; ajuste: boolean; motivos: string[] };

export function politicaDeLiberacao(
  acuracia: AcuraciaMedida | null,
  flags: { liberarAprovar?: boolean; liberarAjuste?: boolean },
): Liberacao {
  const motivos: string[] = [];
  if (!acuracia) {
    return {
      aprovar: false,
      ajuste: false,
      motivos: ['Sem medição de acurácia: nenhum veredito age sozinho até o retroativo medir.'],
    };
  }
  const avalia = (
    chave: 'aprovar' | 'ajuste',
    m: MedicaoVeredito | undefined,
    flag: boolean | undefined,
  ): boolean => {
    if (!m) {
      motivos.push(`${chave}: não medido ainda, segue em sombra.`);
      return false;
    }
    const meta = METAS_LIBERACAO[chave];
    if (m.n < meta.n_min) {
      motivos.push(`${chave}: amostra de ${m.n} abaixo do mínimo de ${meta.n_min}.`);
      return false;
    }
    if (m.acerto < meta.acerto_min) {
      motivos.push(`${chave}: acerto de ${(m.acerto * 100).toFixed(1)}% abaixo da meta de ${meta.acerto_min * 100}%.`);
      return false;
    }
    if (chave === 'aprovar' && m.erro_grave > METAS_LIBERACAO.aprovar.erro_grave_max) {
      motivos.push(`aprovar: ${m.erro_grave} erro grave na amostra, a meta é zero.`);
      return false;
    }
    if (!flag) {
      motivos.push(`${chave}: meta batida, mas a flag de liberação está desligada.`);
      return false;
    }
    motivos.push(`${chave}: liberado (meta batida e flag ligada).`);
    return true;
  };
  const aprovar = avalia('aprovar', acuracia.aprovar, flags.liberarAprovar);
  const ajuste = avalia('ajuste', acuracia.ajuste, flags.liberarAjuste);
  return { aprovar, ajuste, motivos };
}

export type Consenso = {
  saida: SaidaConsenso;
  veredito_merito: 'aprovar' | 'ajuste' | 'humano';
  estrela: number;
  vale_estrela: boolean;
  escape: boolean;
  confianca: Confianca;
  divergencias: string[];
  motivos: string[];
  perguntas_ao_autor: string[];
  valor: AuditoriaValor | null;
  contestacao: Contestacao | null;
  age_sozinho: boolean;
};

/**
 * Os motivos de INVALIDEZ do projeto — lista **FECHADA** e fonte única da porta (ii) da
 * reprovação. ⚠️ Não é a lista do `PISO_ZERO`: aqui só entra o que torna o projeto inválido, não o
 * que o deixa baixo. Ampliar esta lista é ampliar quem o time pode reprovar (D4.1).
 */
export const ROTULO_DESQ: Record<string, string> = {
  fora_de_uso: 'fora de uso (parado, descontinuado ou POC)',
  ressubmissao: 'ressubmissão do mesmo escopo já documentado (duplicado)',
};

/** As chaves de invalidez, derivadas do rótulo — nunca redigitadas. */
export const MOTIVOS_INVALIDEZ: readonly string[] = Object.keys(ROTULO_DESQ);

/**
 * A porta (ii) está aberta? PURA. Exige as DUAS coisas de RF-244: motivo NOMEADO da lista fechada
 * e ao menos uma citação do material. `sem_evidencia` (o agente declarou que não achou nada)
 * fecha a porta mesmo com o motivo nomeado.
 */
export function invalidezComprovada(b: {
  desqualificador?: string | null;
  evidencias?: string[] | null;
  sem_evidencia?: boolean | null;
}): boolean {
  const chave = b.desqualificador ?? '';
  if (!MOTIVOS_INVALIDEZ.includes(chave)) return false;
  if (b.sem_evidencia === true) return false;
  return (b.evidencias ?? []).some((e) => typeof e === 'string' && e.trim().length > 0);
}

function frase(s: string): string {
  const t = s.replace(/—|–/g, ',').replace(/ - /g, ', ').trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function conciliar(
  a: SaidaMerito,
  b: SaidaEstrela,
  ctx: {
    debateFechou: boolean;
    ceticoRefuta: boolean;
    liberacao: Liberacao;
    /**
     * O SEGUNDO cético (o da estrela) sustentou a objeção depois da volta? Campo OPCIONAL de
     * propósito: os chamadores antigos (testes, retroativo) seguem compilando e o comportamento
     * deles não muda — ausente é `false`, que é o que valia antes de o cético da estrela existir.
     */
    ceticoEstrelaRefuta?: boolean;
    /** O que ele disse, para virar divergência legível em vez de um booleano mudo. */
    ceticoEstrelaMotivo?: string | null;
    /**
     * Impacto mensal declarado (R$/mês) — a entrada da porta (i). Campo OPCIONAL: ausente/null
     * significa "não há número declarado", que NÃO é ganho abaixo do piso (ver
     * `materialidade-piso.ts`), então todo chamador antigo segue com o comportamento de antes.
     */
    impactoMensal?: number | null;
    /**
     * A nota HUMANA da coluna "Estrelas", quando existe. Campo OPCIONAL: ausente → só a nota do
     * agente entra na régua composta, que é o comportamento de todo chamador antigo.
     * ⚠️ `notaParaOPiso` é quem decide a precedência (humana ≥ 1 vence e é âncora; o `0` humano
     * é DEFAULT de coluna manual e cai para a do agente). Não reimplementar aqui.
     */
    notaHumana?: number | null;
  },
): Consenso {
  const divergencias: string[] = [];
  const motivos: string[] = [];

  // ⚠️ **O SEGUNDO EIXO tem de aparecer no parecer, em qualquer desfecho** (10/09/2026). Quando o
  // tamanho do impacto ELEVA a nota, o racional do modelo justifica a nota antiga — e uma nota que
  // sobe sem explicação é o jeito mais rápido de uma régua declarada virar mágica na tela. Aqui
  // ela entra como primeiro motivo, porque é o que muda a caixa do projeto.
  if (b.piso_impacto) motivos.push(frase(b.piso_impacto.porque));

  if (ctx.ceticoRefuta && a.veredito === 'aprovar') {
    divergencias.push(frase('O cético refuta a aprovação do mérito'));
  }
  // ⚠️ A objeção do cético da ESTRELA que SOBREVIVE à volta é divergência entre os dois cérebros:
  // ela não muda o mérito (aprovar ou não), muda a confiança na NOTA — e nota é o que o comitê
  // humano usa. Não vira ajuste ao autor: a altura da estrela não é pergunta que o autor responda.
  if (ctx.ceticoEstrelaRefuta) {
    divergencias.push(
      frase(`O cético da estrela sustenta a objeção à nota: ${ctx.ceticoEstrelaMotivo ?? 'sem motivo nomeado'}`),
    );
  }
  if (a.veredito === 'aprovar' && b.nota === 0 && b.desqualificador && ROTULO_DESQ[b.desqualificador]) {
    divergencias.push(frase(`O mérito aprova, mas a estrela desqualifica o projeto por ${ROTULO_DESQ[b.desqualificador]}`));
  }

  const confiancaBruta = confiancaDe({
    cerebrosConcordam: divergencias.length === 0,
    temEvidenciaCitada: a.sinais.temEvidenciaCitada && b.sinais.temEvidenciaCitada,
    temVizinhos: a.sinais.temVizinhos || b.sinais.temVizinhos,
  });
  let confianca: Confianca = confiancaBruta;
  const escape = b.escape.indicado && b.escape.valido;

  // ── As DUAS portas da reprovação (D4), ANTES de todo o resto ────────────────────────────────
  // (i) PISO DE IMPACTO — mecânica. Vem primeiro porque rejeição mecânica sobrepõe a aprovação do
  // LLM, nunca o contrário: nenhum arranjo de pareceres compensa um ganho de R$ 18/mês.
  //
  // ⚠️ **A régua é COMPOSTA, e até 09/09/2026 este ponto usava só o DINHEIRO** (`abaixoDoPisoDeImpacto`
  // sozinho), enquanto a segunda perna (nota) morava apenas na MESA. O time é justamente quem tem a
  // nota em mãos, na MESMA passada, e não a usava: ele recomendaria reprovar um projeto de 2★–4★
  // com impacto pequeno — medido na base de prod, **10 projetos aprovados** de Gente & Gestão e
  // processo, a família em que o valor não está no dinheiro. Régua e número saem agora da mesma
  // fonte (`materialidade-piso.ts`).
  //
  // ⚠️ **Fallback da estrela NÃO é nota** (`b.avaliada`): o fallback devolve `nota: 0`, e somá-lo à
  // régua faria **falha do modelo virar reprovação** de projeto que ninguém julgou. É a família do
  // RAG morto, que achatou 12 notas em 0★ e saiu no relatório como se o defeito fosse a régua.
  const { nota: notaDoPiso, fonte: fonteDaNota } = notaParaOPiso({
    humana: ctx.notaHumana ?? null,
    agente: b.avaliada ? b.nota : null,
  });
  const abaixoDoPiso = reprovaPeloPiso({ impactoMensal: ctx.impactoMensal, estrela: notaDoPiso });
  // (ii) INVALIDEZ nomeada E citada — régua declarada, lista fechada.
  const invalido = invalidezComprovada(b);

  // ⚠️ **O piso NÃO é um curto-circuito** (09/09/2026, correção do dono do produto: *"o piso de 100
  // && estrela = 0 nao é passivel de reprovar instantaneamente, o agente pode defender que aquele
  // projeto nao é um experimentação... É reprovado de fato, mas deve ter a justificativa. Hoje o
  // agente so ve que bateu o piso e esquece de tudo e simplesmente bota confiança 100% só por causa
  // do gate"*).
  //
  // Duas consequências, e as duas estão abaixo:
  //   (a) **zero sem citação não reprova.** A régua composta usa a nota como 2º eixo, e uma nota
  //       zero que o cérebro não sustentou com trecho do material é a MESMA classe de "invalidez
  //       sem citação", que este consenso já se recusa a reprovar. Vai ao humano.
  //   (b) **o parecer carrega o argumento**, inclusive quando o time do impacto NÃO viu problema:
  //       quem lê a reprovação precisa saber que ela veio da régua e não de uma objeção dos
  //       especialistas, senão não há como contestá-la.
  const zeroDefendido = b.avaliada && b.sinais.temEvidenciaCitada;

  let saida: SaidaConsenso;
  if (abaixoDoPiso && !zeroDefendido) {
    saida = 'humano';
    motivos.push(
      frase(
        `O ganho declarado está abaixo do piso e a nota é ${notaDoPiso ?? 'zero'}, mas esse zero não vem com evidência citada do material: reprovar assim não seria defensável, então a decisão é de gente`,
      ),
    );
  } else if (abaixoDoPiso) {
    saida = 'reprovar';
    motivos.push(frase(motivoPisoComEstrela(ctx.impactoMensal as number, notaDoPiso)));
    motivos.push(frase(`A nota usada na régua veio da fonte ${fonteDaNota}`));
    if (b.racional) motivos.push(frase(`Por que a nota é ${notaDoPiso}: ${b.racional}`));
    if (b.evidencias[0]) motivos.push(frase(`Evidência citada para a nota: ${b.evidencias[0]}`));
    if (a.veredito === 'aprovar') {
      motivos.push(
        frase(
          'O time do impacto NÃO levantou problema neste projeto: o que reprova aqui é a régua composta (ganho irrelevante e nenhuma altura em outro eixo), não uma objeção dos especialistas',
        ),
      );
    } else if (a.ressalvas[0]) {
      motivos.push(frase(`O impacto também tem ressalva: ${a.ressalvas[0]}`));
    }
  } else if (invalido) {
    saida = 'reprovar';
    motivos.push(
      frase(
        `Projeto inválido por ${ROTULO_DESQ[b.desqualificador as string]}, com a evidência citada do material: ${b.evidencias[0]}`,
      ),
    );
  } else if (escape) {
    saida = 'humano';
    motivos.push(frase('Escape 6 a 10 indicado com os dois gatilhos citados: a posição na faixa é do comitê humano'));
  } else if (a.veredito === 'humano') {
    saida = 'humano';
    motivos.push(frase('O mérito não conseguiu fechar e pede olhar humano'));
  } else if (!ctx.debateFechou) {
    saida = 'humano';
    motivos.push(frase('O debate entre os especialistas não fechou em duas rodadas'));
  } else if (divergencias.length && a.veredito === 'aprovar') {
    saida = 'humano';
    motivos.push(frase('Mérito e estrela divergem sobre aprovar: vai ao humano'));
  } else if (confianca === 'baixa') {
    saida = 'humano';
    motivos.push(frase('Confiança baixa (falta evidência citada e vizinhos): o consenso não fecha na dúvida'));
  } else if (a.veredito === 'ajuste') {
    saida = 'ajuste';
    motivos.push(frase(`O mérito pede ajuste ao autor com ${a.perguntas_ao_autor.length} pergunta(s)`));
  } else {
    saida = 'aprovar';
    motivos.push(frase(`Mérito aprova e estrela ${b.nota} (${b.criterio_aplicado}) com confiança ${confianca}`));
  }

  // ⚠️ **TETO da confiança na reprovação pelo piso.** `confiancaDe` mede concordância dos dois
  // cérebros, evidência citada e vizinhos — nenhum desses sinais fala do PISO. Então o caso mais
  // constrangedor saía "confiança alta": dois cérebros satisfeitos, o mérito aprovando, e a régua
  // reprovando por cima, com cara de certeza absoluta. A decisão é mecânica sobre UMA nota, e
  // certeza mecânica não é certeza de julgamento.
  const reprovouPeloPiso = saida === 'reprovar' && abaixoDoPiso;
  if (reprovouPeloPiso && confianca === 'alta') {
    confianca = 'media';
    motivos.push(frase('A confiança fica em média: a reprovação vem da régua do piso, não de um julgamento convergente dos dois cérebros'));
  }

  if (b.ancora_congelada) {
    motivos.push(frase('O projeto é âncora congelada com nota humana; a estrela do time fica só como registro e contestação'));
  }
  if (saida !== 'humano' && confianca !== 'alta') {
    motivos.push(frase(`Confiança ${confianca}: ${a.sinais.temEvidenciaCitada && b.sinais.temEvidenciaCitada ? 'com' : 'sem'} evidência citada nos dois cérebros`));
  }

  // ⚠️ `reprovar` NÃO tem flag de liberação (RF-246): não existe caminho em que o time reprove
  // sozinho. Quem reprova em produção continua sendo gente.
  const age_sozinho =
    (saida === 'aprovar' && ctx.liberacao.aprovar) || (saida === 'ajuste' && ctx.liberacao.ajuste);
  if (saida === 'reprovar') {
    motivos.push(frase('A reprovação é recomendação em sombra, quem reprova em produção é a triagem'));
  }
  if (!age_sozinho && saida !== 'humano' && saida !== 'reprovar') {
    motivos.push(frase(`Saída ${saida} fica em sombra: a liberação para agir sozinho não está autorizada`));
  }

  return {
    saida,
    veredito_merito: a.veredito,
    estrela: b.nota,
    vale_estrela: b.nota >= 1,
    escape,
    confianca,
    divergencias,
    motivos,
    perguntas_ao_autor: a.perguntas_ao_autor,
    valor: a.valor,
    contestacao: b.contestacao,
    age_sozinho,
  };
}
