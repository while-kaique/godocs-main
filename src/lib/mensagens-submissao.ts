/**
 * MENSAGENS DE BLOQUEIO DA SUBMISSÃO — fonte única, PURA.
 *
 * Todo erro que impede o envio de um projeto tem de dizer TRÊS coisas: o que aconteceu, por
 * que (com os números reais do projeto) e **o que fazer para corrigir**. Sem a terceira, a
 * pessoa fica presa na tela — foi o que aconteceu no caso SmartOnline/DIFAL (10/08/2026):
 *
 *   > "Não é possível submeter este projeto como saving sem ganho mensurável. O ganho precisa
 *   > vir de uma redução concreta de horas OU de um custo externo evitado…"
 *
 * A submissão tinha **60h/mês** de redução de horas declaradas e validadas no memorial. A
 * mensagem afirmava exatamente o contrário do que estava na tela, porque o gate real é sobre
 * o ganho **LÍQUIDO** (horas + custo evitado − custo externo − custo do projeto ≤ 0) e o
 * texto nunca mencionava o abatimento. A autora tentou enviar 6 vezes em 25 minutos.
 *
 * ⚠️ NÃO expor o R$ das HORAS. O valor/hora por cargo é métrica de gestão e é escondido do
 * usuário de propósito (ver `step3-chat.tsx`: "o cálculo do ganho não é exibido ao usuário
 * para não induzir manipulação dos valores"). Os CUSTOS, sim, podem ser citados — foi a
 * própria pessoa que os digitou no formulário. Daí a explicação ser qualitativa de um lado
 * ("as 60h economizadas não cobrem…") e numérica do outro ("R$ 3.600,00/mês de ferramenta").
 *
 * ─── FORMATO ESTRUTURADO (12/08/2026) ────────────────────────────────────────────────────
 * O bloqueio deixou de ser só uma string: cada um é um `BloqueioSubmissao` com **veredito
 * curto** (`titulo`), **por que com os números** (`resumo`) e **caminhos de correção**
 * (`caminhos`, que são ALTERNATIVAS — nunca numerar, ver D2 da SPEC). Motivo: o texto vivia
 * num toast vermelho de 20s, ou seja, o bloqueio mais importante do produto no canal mais
 * frágil, lido como "o sistema quebrou". Hoje ele vai estruturado até a tela (painel âmbar
 * `AvisoBloqueio`, ancorado no botão que falhou) e `formatarBloqueio()` segue produzindo o
 * texto plano que vai na `Error.message` / `api_logs` / cliente desatualizado.
 *
 * ⚠️ Este módulo é a FONTE ÚNICA dos textos. Componente NENHUM redigita frase de bloqueio.
 * ⚠️ Onde cada coisa é preenchida na tela (a pessoa precisa ACHAR o campo):
 *    - custo da ferramenta, custos do projeto e CUSTO EVITADO → formulário
 *      **"Dados para Análise de Impacto"**, na etapa do Agente (NÃO na Etapa 2 — a mensagem
 *      antiga mandava para a Etapa 2 e o campo não está lá);
 *    - nome do projeto → **Etapa 2** (a mensagem antiga mandava para a Etapa 1);
 *    - marcar ESPECIAL → fim da **Etapa 2** (tela de tipo do projeto).
 */

/** "324005.09" → "324.005,09". Formatação local (o mesmo helper existe em outros módulos). */
export function moedaBR(n: number): string {
  const [inteiro, centavos] = (Number(n) || 0).toFixed(2).split(".");
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

/** "60" → "60h"; "33.5" → "33,5h" (sem casa decimal inútil). */
function horasBR(n: number): string {
  const v = Number(n) || 0;
  const txt = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
  return `${txt}h`;
}

/** Nome do formulário como a pessoa o VÊ na tela (`SavingForm`, etapa do Agente). */
const FORM_IMPACTO = 'formulário "Dados para Análise de Impacto"';

/**
 * Um caminho de correção. `rotulo` é a ação em uma linha (o que a pessoa escaneia);
 * `detalhe` diz onde e como. São ALTERNATIVAS entre si — a tela usa marcadores, nunca
 * "(1) (2) (3)", que fazia parecer obrigatório cumprir os três.
 */
export type CaminhoCorrecao = {
  rotulo: string;
  detalhe: string;
};

/** Identifica o bloqueio para a tela (e para logs) sem depender do texto. */
export type CodigoBloqueio =
  | "saving_sem_ganho"
  | "receita_zerada"
  | "receita_incompleta"
  | "doc_ausente"
  | "nome_duplicado";

export type BloqueioSubmissao = {
  codigo: CodigoBloqueio;
  /** Veredito em uma linha, sem "Erro"/"Falha" — o que aconteceu. */
  titulo: string;
  /** Por que, com os números do projeto. 1–3 frases. */
  resumo: string;
  /** Alternativas de correção (≥1). */
  caminhos: CaminhoCorrecao[];
};

/**
 * Serializa o bloqueio no texto plano que viaja na `Error.message`. É o que o Investigador
 * grava em `api_logs` e o que um cliente desatualizado ainda mostra num toast — por isso
 * carrega TODO o conteúdo, inclusive o "Para corrigir".
 */
export function formatarBloqueio(b: BloqueioSubmissao): string {
  const caminhos = b.caminhos.map((c) => `• ${c.rotulo} — ${c.detalhe}`).join("\n");
  return `${b.titulo}. ${b.resumo}\n\nPara corrigir:\n${caminhos}`;
}

/**
 * Erro pronto para `throw` no servidor: mensagem plana + o bloqueio ESTRUTURADO anexado
 * (`worker.ts` o repassa no corpo `{ error, bloqueio }`) + **status 400**.
 *
 * ⚠️ 400, não 500: é preenchimento, não falha nossa. Além do tom no cliente, um 5xx aqui
 * poluía a leitura de saúde no Investigador.
 */
export function erroDeBloqueio(b: BloqueioSubmissao): Error {
  return Object.assign(new Error(formatarBloqueio(b)), { status: 400, bloqueio: b });
}

export type ComposicaoGanho = {
  /** Horas economizadas no período declarado (economia_horas_mes). */
  horas: number;
  /** Unidade a exibir junto das horas ("/mês", "/trimestre", " no total"…). */
  unidade?: string;
  /** Custo evitado já cadastrado como ITEM no formulário (soma). */
  custoEvitado: number;
  /** Custo da ferramenta externa (escopo externo), mensal. */
  custoExterno: number;
  /** Custos do projeto (itens do formulário), somados. */
  custoProjeto: number;
  /** O líquido calculado pelo backend (economia_reais_mes) — ≤ 0 quando esta mensagem sai. */
  liquido: number;
};

/** Cadastrar o gasto eliminado — caminho comum aos dois desfechos do saving sem ganho. */
const CAMINHO_CUSTO_EVITADO: CaminhoCorrecao = {
  rotulo: "Cadastre o gasto que a automação eliminou",
  detalhe:
    `Contrato, licença, serviço, multa ou juros que a empresa pagava e parou de pagar entram ` +
    `no campo de CUSTO EVITADO do ${FORM_IMPACTO}. Valor citado só na conversa com o agente ` +
    `não é gravado.`,
};

/** Marcar especial — última alternativa dos dois desfechos do saving sem ganho. */
const CAMINHO_ESPECIAL: CaminhoCorrecao = {
  rotulo: "Marque o projeto como ESPECIAL",
  detalhe:
    `Se o ganho deste projeto não é financeiro, volte à Etapa 2, marque especial e envie ` +
    `assim — a triagem avalia o impacto qualitativo.`,
};

/**
 * Bloqueio do saving sem ganho LÍQUIDO. Adapta-se à causa real:
 *
 *   - **custos comem o ganho** (há horas ou custo evitado, mas os custos declarados são
 *     maiores ou iguais): explica o abatimento e cita os valores que a pessoa digitou;
 *   - **não há ganho nenhum** (0h e nenhum gasto eliminado): o desfecho que a mensagem
 *     antiga descrevia — e que era o único em que ela estava certa.
 */
export function bloqueioSavingSemGanho(c: ComposicaoGanho): BloqueioSubmissao {
  const unidade = c.unidade ?? "/mês";
  const custos: string[] = [];
  if (c.custoExterno > 0) custos.push(`ferramenta externa (R$ ${moedaBR(c.custoExterno)}/mês)`);
  if (c.custoProjeto > 0) custos.push(`custo do projeto (R$ ${moedaBR(c.custoProjeto)}/mês)`);
  const temCustos = custos.length > 0;
  const temGanho = c.horas > 0 || c.custoEvitado > 0;

  if (temCustos && temGanho) {
    const ganho =
      c.horas > 0 && c.custoEvitado > 0
        ? `as ${horasBR(c.horas)}${unidade} economizadas e o custo evitado de R$ ${moedaBR(c.custoEvitado)}`
        : c.horas > 0
          ? `as ${horasBR(c.horas)}${unidade} economizadas`
          : `o custo evitado de R$ ${moedaBR(c.custoEvitado)}`;
    return {
      codigo: "saving_sem_ganho",
      titulo: "Os custos declarados anulam o ganho deste saving",
      resumo:
        `O ganho LÍQUIDO ficou em R$ ${moedaBR(c.liquido)}: ${ganho} não cobrem os custos que ` +
        `você declarou — ${custos.join(" e ")}.`,
      caminhos: [
        {
          rotulo: "Confira o valor e a periodicidade desses custos",
          detalhe:
            `No ${FORM_IMPACTO}, releia o custo da ferramenta e os custos do projeto. Se você ` +
            `informou o total do ANO num campo mensal, marque "anual" — é a troca mais comum.`,
        },
        CAMINHO_CUSTO_EVITADO,
        CAMINHO_ESPECIAL,
      ],
    };
  }

  return {
    codigo: "saving_sem_ganho",
    titulo: "Este saving ainda não tem ganho registrado",
    resumo:
      c.horas > 0
        ? `Há ${horasBR(c.horas)}${unidade} de redução, mas o líquido ficou em R$ ${moedaBR(c.liquido)} ` +
          `e nenhum gasto externo eliminado foi cadastrado.`
        : `Não há nenhuma hora economizada e nenhum gasto externo eliminado registrados.`,
    caminhos: [
      {
        rotulo: "Registre as horas do processo",
        detalhe:
          `Volte ao agente e diga quantas horas o processo consumia antes da automação e ` +
          `quantas consome hoje.`,
      },
      CAMINHO_CUSTO_EVITADO,
      CAMINHO_ESPECIAL,
    ],
  };
}

/** Receita marcada, mas com valor zerado. */
export function bloqueioReceitaZerada(): BloqueioSubmissao {
  return {
    codigo: "receita_zerada",
    titulo: "A receita deste projeto está em R$ 0,00",
    resumo:
      `Receita incremental só é enviada com o valor e o memorial que mostra como esse número ` +
      `é apurado.`,
    caminhos: [
      {
        rotulo: "Conclua o memorial de receita",
        detalhe:
          `Volte ao agente da receita e informe o valor, a periodicidade e onde o número é ` +
          `apurado, até o memorial aparecer.`,
      },
      {
        rotulo: "Ou troque o tipo do projeto",
        detalhe:
          `Se não há receita nova: Saving quando o ganho é economia operacional, Especial ` +
          `quando o ganho não é financeiro. O tipo se muda na Etapa 2.`,
      },
    ],
  };
}

/** Receita marcada e incompleta (sem periodicidade, sem memorial, ou memorial de saving). */
export function bloqueioReceitaIncompleta(): BloqueioSubmissao {
  return {
    codigo: "receita_incompleta",
    titulo: "O memorial de receita está incompleto",
    resumo:
      `Receita incremental exige três coisas: periodicidade, valor e um memorial de RECEITA. ` +
      `Falta uma delas — ou o que está gravado descreve economia operacional (saving), não ` +
      `receita nova.`,
    caminhos: [
      {
        rotulo: "Conclua o memorial de receita",
        detalhe:
          `Volte ao agente e feche o valor, a periodicidade e como o número é apurado antes ` +
          `de enviar.`,
      },
      {
        rotulo: "Ou reclassifique como Saving",
        detalhe:
          `Se o que você descreveu é economia operacional, troque o tipo do projeto para ` +
          `Saving na Etapa 2.`,
      },
    ],
  };
}

/** Submissão sem documentação compilada. */
export function bloqueioDocAusente(): BloqueioSubmissao {
  return {
    codigo: "doc_ausente",
    titulo: "A documentação deste projeto ainda não foi gerada",
    resumo:
      `O envio precisa da documentação técnica compilada pelo agente, e ela não existe neste ` +
      `projeto.`,
    caminhos: [
      {
        rotulo: "Conclua a documentação no agente",
        detalhe:
          `Volte ao chat da Etapa 3 e responda as perguntas até aprovar o preview da ` +
          `documentação. O envio libera em seguida.`,
      },
    ],
  };
}

/** Nome de projeto já submetido por outra pessoa/outro registro. */
export function bloqueioDuplicata(nome: string): BloqueioSubmissao {
  return {
    codigo: "nome_duplicado",
    titulo: `Já existe um projeto submetido com o nome "${nome}"`,
    resumo: `Dois registros com o mesmo nome não podem ser distinguidos na triagem nem na planilha.`,
    caminhos: [
      {
        rotulo: "Ajuste o nome na Etapa 2",
        detalhe: `Acrescente a versão ou a área — por exemplo "${nome} v2" ou "${nome} (Fiscal)".`,
      },
      {
        rotulo: "Ou edite o projeto que já existe",
        detalhe:
          `Se for o MESMO projeto que você já enviou, abra-o em "Meus Projetos" e edite, em ` +
          `vez de submeter de novo.`,
      },
    ],
  };
}

// ─── Serialização em texto plano ────────────────────────────────────────────────────────
// Mantidas porque são o que vai na `Error.message` (e nos `api_logs`). Um cliente antigo,
// que não conhece o campo `bloqueio` do corpo do erro, ainda mostra a orientação inteira.

export function mensagemSavingSemGanho(c: ComposicaoGanho): string {
  return formatarBloqueio(bloqueioSavingSemGanho(c));
}

export function mensagemReceitaZerada(): string {
  return formatarBloqueio(bloqueioReceitaZerada());
}

export function mensagemReceitaIncompleta(): string {
  return formatarBloqueio(bloqueioReceitaIncompleta());
}

export function mensagemDocAusente(): string {
  return formatarBloqueio(bloqueioDocAusente());
}

export function mensagemDuplicata(nome: string): string {
  return formatarBloqueio(bloqueioDuplicata(nome));
}
