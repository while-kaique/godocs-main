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

/**
 * Bloqueio do saving sem ganho LÍQUIDO. A mensagem se adapta à causa real:
 *
 *   - **custos comem o ganho** (há horas ou custo evitado, mas os custos declarados são
 *     maiores ou iguais): explica o abatimento e cita os valores que a pessoa digitou;
 *   - **não há ganho nenhum** (0h e nenhum gasto eliminado): o texto antigo, que só estava
 *     certo neste caso.
 */
export function mensagemSavingSemGanho(c: ComposicaoGanho): string {
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
    return (
      `Este projeto não pode ser enviado como saving porque o ganho LÍQUIDO ficou em ` +
      `R$ ${moedaBR(c.liquido)}: ${ganho} não cobrem os custos que você declarou na Etapa 2 — ` +
      `${custos.join(" e ")}. ` +
      `Para corrigir, volte à Etapa 2 e: (1) confira o valor e a periodicidade desses custos — ` +
      `se você informou o total do ANO, marque "anual" em vez de "mensal"; ` +
      `(2) se a automação eliminou algum gasto que a empresa pagava (contrato, licença, serviço, ` +
      `multa, juros), cadastre-o no campo de CUSTO EVITADO — valor citado só na conversa com o ` +
      `agente não é gravado; (3) se o ganho deste projeto não é financeiro, marque-o como ESPECIAL ` +
      `na Etapa 2 e envie assim (a triagem avalia o impacto qualitativo).`
    );
  }

  return (
    `Este projeto não pode ser enviado como saving porque não há ganho financeiro registrado: ` +
    `${c.horas > 0 ? `há ${horasBR(c.horas)}${unidade} de redução, mas o líquido ficou em R$ ${moedaBR(c.liquido)}` : "nenhuma hora economizada"} ` +
    `e nenhum gasto externo eliminado. ` +
    `Para corrigir: (1) volte ao agente e registre quantas horas o processo consumia antes da ` +
    `automação (e quantas consome hoje); (2) ou, se a automação eliminou um gasto que a empresa ` +
    `pagava (contrato, licença, serviço, multa, juros), cadastre-o na Etapa 2 no campo de CUSTO ` +
    `EVITADO — valor citado só na conversa com o agente não é gravado; (3) se o ganho não é ` +
    `financeiro, marque o projeto como ESPECIAL na Etapa 2 e envie assim.`
  );
}

/** Receita marcada, mas com valor zerado. */
export function mensagemReceitaZerada(): string {
  return (
    `Este projeto não pode ser enviado como receita incremental porque o valor da receita está ` +
    `em R$ 0,00. Para corrigir, volte ao agente da receita e conclua o memorial informando o ` +
    `valor mensal e como ele é apurado — ou, se o projeto não gera receita nova, troque o tipo ` +
    `na Etapa 2 (Saving, se o ganho é economia operacional; Especial, se o ganho não é ` +
    `financeiro).`
  );
}

/** Receita marcada e incompleta (sem periodicidade, sem memorial, ou memorial de saving). */
export function mensagemReceitaIncompleta(): string {
  return (
    `Este projeto está marcado como Receita Incremental, mas a receita não está completa — são ` +
    `obrigatórios a periodicidade, o valor e um memorial de RECEITA. Para corrigir: se o que ` +
    `você descreveu é economia operacional (saving), volte à Etapa 2 e troque o tipo do projeto ` +
    `para Saving; se for receita nova de verdade, volte ao agente e conclua o memorial de ` +
    `receita (valor, periodicidade e como o número é apurado) antes de enviar.`
  );
}

/** Submissão sem documentação compilada. */
export function mensagemDocAusente(): string {
  return (
    `Este projeto ainda não tem documentação gerada, então não é possível enviá-lo. Para ` +
    `corrigir, volte ao chat do agente na Etapa 3 e conclua a documentação (responda as ` +
    `perguntas até aprovar o preview) — o envio libera em seguida.`
  );
}

/** Nome de projeto já submetido por outra pessoa/outro registro. */
export function mensagemDuplicata(nome: string): string {
  return (
    `Já existe um projeto submetido com o nome "${nome}". Para corrigir, volte à Etapa 1 e ` +
    `ajuste o nome (por exemplo, acrescentando a versão ou a área) — se este for o MESMO ` +
    `projeto que você já enviou, edite o projeto existente em "Meus Projetos" em vez de ` +
    `submeter de novo.`
  );
}
