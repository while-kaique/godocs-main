import { CARGOS, type SavingColetado, type SavingLinha, type ReceitaColetada } from "./types";
import { normalizarMarcadoresMemorial } from "./memorial-format";

const round2 = (n: number) => Math.round(n * 100) / 100;

const normalizarCargo = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

// Piso conservador: menor valor/hora da tabela. Uma hora de trabalho real NUNCA
// vale R$0 — usá-lo como fallback evita o "falso zero" que zera o saving.
const PISO_VALOR_HORA = Math.min(...CARGOS.map((c) => c.valor_hora));

/**
 * Resolve o valor/hora de um cargo contra a tabela CARGOS de forma tolerante às
 * variações de rótulo que o LLM produz.
 *
 * ⚠️ Bug que isto corrige: a resolução era `CARGOS.find(c => c.label === cargo)`
 * (match EXATO). Quando o LLM gravava um cargo genérico como `"Analista"` — que
 * não bate com nenhum label da tabela (`"Analista Júnior/Pleno/Sênior"`) — e a
 * linha vinha sem `valor_hora`, o valor caía silenciosamente para R$0. Aí
 * `economia_reais_mes` zerava e o gate de ganho-zero (`submeterParaValidacao`)
 * BARRAVA a submissão como "saving sem economia mensurável", MESMO havendo
 * economia real de horas. (Caso real: projeto BoniTrack, cargo "Analista" com
 * 2,5h/mês de economia → bloqueado indevidamente.)
 *
 * Ordem de resolução: (1) match exato; (2) match exato normalizado (sem
 * acento/caixa/espaços); (3) match por família — o cargo é prefixo de um label
 * da tabela ou vice-versa (ex.: "Analista" → "Analista *") — escolhendo o MENOR
 * valor/hora entre os candidatos (conservador, nunca superestima); (4) o
 * `valor_hora` já presente na linha, se > 0; (5) piso conservador da tabela.
 *
 * Nunca retorna 0 para um cargo informado: como o gate só barra com economia de
 * HORAS > 0, um cargo com horas reais sempre terá R$ > 0. Tool-swaps de 0h
 * continuam barrados (0h × qualquer valor/hora = R$0).
 */
export function resolverValorHora(cargo: string | undefined, valorHoraLinha?: number | null): number {
  const raw = (cargo ?? '').trim();
  if (raw) {
    const exato = CARGOS.find((c) => c.label === raw);
    if (exato) return exato.valor_hora;

    const alvo = normalizarCargo(raw);
    const normExato = CARGOS.find((c) => normalizarCargo(c.label) === alvo);
    if (normExato) return normExato.valor_hora;

    const familia = CARGOS.filter((c) => {
      const lab = normalizarCargo(c.label);
      return lab.startsWith(alvo) || alvo.startsWith(lab);
    });
    if (familia.length) return Math.min(...familia.map((c) => c.valor_hora));
  }
  const daLinha = Number(valorHoraLinha);
  if (daLinha > 0) return daLinha;
  return raw ? PISO_VALOR_HORA : 0;
}

/**
 * Re-deriva os valores em R$ do saving a partir das HORAS de cada linha × tabela
 * CARGOS. A ÚNICA fonte de verdade do dinheiro é o backend.
 *
 * Durante o chat, o orquestrador pode reajustar `horas_antes`/`horas_depois` de uma
 * linha (ex: "estava 0h, na verdade eram 30h") e é instruído a NUNCA mexer em R$
 * (não expomos cálculo monetário ao usuário) — então `economia_reais_mes` volta
 * zerado/defasado no JSON do LLM. Sem este recálculo, o 0 vaza para a planilha
 * (saving_reais=0 → ganho_total_mensal=null).
 *
 * `valor_hora` por linha vem da tabela CARGOS pelo `cargo`; cai no valor_hora já
 * presente na linha se o cargo não for encontrado. O total líquido soma o custo
 * evitado (valor cheio) e abate o custo externo mensal (mesma fórmula de
 * `iniciarSaving`).
 *
 * CUSTO EVITADO: ganho monetário além das horas (ex: serviço externo/licença que o
 * projeto deixou de pagar). É coletado pelo agente, não derivado de horas — então é
 * PRESERVADO (não recalculado). Entra pelo valor cheio independente de ser pontual
 * ou mensal (pontual NÃO divide por 12).
 */
/**
 * Re-deriva o custo evitado a partir dos ITENS persistidos no projeto
 * (`custo_evitado_itens`, JSON). Fonte da verdade — usado no submit para NÃO
 * depender do `custo_evitado_reais` que vive no estado volátil do chat (o LLM
 * pode "esquecê-lo" em fluxos com muitos turnos, zerando o valor).
 * Item pontual entra pelo valor CHEIO (NÃO divide por 12), igual a mensal — mesma
 * regra de saving/receita pontual e de `iniciarSaving`. _(Antes o pontual era
 * mensalizado ÷12; decisão de produto removeu a divisão em 01/07/2026.)_
 */
export function custoEvitadoMensalFromItens(itensRaw: unknown): number {
  let itens: Array<{ valor?: number; recorrencia?: string }> = [];
  if (typeof itensRaw === 'string') {
    try { itens = JSON.parse(itensRaw) || []; } catch { itens = []; }
  } else if (Array.isArray(itensRaw)) {
    itens = itensRaw as Array<{ valor?: number; recorrencia?: string }>;
  }
  // Pontual e mensal entram pelo valor cheio (sem ÷12).
  const total = itens.reduce((s, it) => s + Math.max(0, Number(it?.valor) || 0), 0);
  return round2(total);
}

/**
 * Re-deriva o CUSTO DO PROJETO a partir dos itens persistidos
 * (`custo_projeto_itens`, JSON). Mesma soma do custo evitado (pontual e mensal pelo
 * valor cheio, sem ÷12), mas o resultado SUBTRAI do líquido (custo incorrido pra operar).
 * Fonte da verdade no submit (não depende do estado volátil do chat).
 */
export function custoProjetoMensalFromItens(itensRaw: unknown): number {
  // A soma é idêntica à do custo evitado (pontual e mensal pelo valor cheio); só
  // muda o SINAL na composição do líquido (este abate, aquele soma).
  return custoEvitadoMensalFromItens(itensRaw);
}

export function recomputarSavingFinanceiro(
  saving: SavingColetado,
  custoExternoMensal = 0,
): SavingColetado {
  const linhasRaw = Array.isArray(saving?.linhas) ? saving.linhas : [];
  const linhas: SavingLinha[] = linhasRaw.map((l) => {
    const valorHora = resolverValorHora(l.cargo, l.valor_hora);
    const economiaHoras = Math.max(0, (Number(l.horas_antes) || 0) - (Number(l.horas_depois) || 0));
    return {
      ...l,
      valor_hora: valorHora,
      economia_horas_mes: economiaHoras,
      economia_reais_mes: round2(economiaHoras * valorHora),
    };
  });
  const totalHoras = round2(linhas.reduce((s, l) => s + l.economia_horas_mes, 0));
  const totalReaisBruto = round2(linhas.reduce((s, l) => s + l.economia_reais_mes, 0));

  // Custo evitado: entra cheio (pontual NÃO divide por 12). Negativos viram 0.
  const evitadoBruto = Math.max(0, Number(saving?.custo_evitado_reais) || 0);
  // Custos do projeto: serviços externos pagos que a solução consome pra rodar.
  // Já somado (pontual e mensal pelo valor cheio) ao ser persistido; SUBTRAI do líquido. Negativos → 0.
  const custoProjetoBruto = Math.max(0, Number(saving?.custo_projeto_reais) || 0);

  return {
    ...saving,
    linhas,
    // Carrega o custo externo adiante no próprio objeto saving. O valor autoritativo
    // vive em projeto.custo_externo_mensal e é passado aqui; sem persistir no saving,
    // enriquecerMemorial (que lê saving.custo_externo_mensal) recalculava a líquida
    // com 0 → memorial mostrava "Custo de ferramenta externa: N/A" e líquida bruta,
    // contradizendo a coluna Saving Reais (que já abate o custo externo).
    custo_externo_mensal: custoExternoMensal,
    custo_projeto_reais: custoProjetoBruto > 0 ? custoProjetoBruto : (saving?.custo_projeto_reais ?? null),
    economia_horas_mes: totalHoras,
    economia_reais_mes: round2(totalReaisBruto + evitadoBruto - (custoExternoMensal || 0) - custoProjetoBruto),
  };
}

/**
 * Gera a versão INTERNA do memorial de cálculo com valores financeiros (R$).
 *
 * O LLM gera o memorial SEM R$ (visível ao usuário). Esta função injeta:
 * - Valor/hora por cargo (tabela CARGOS)
 * - Economia financeira por pessoa
 * - Totais em R$ (bruto, custo evitado, custo externo, líquido)
 * - Memorial de receita (se houver)
 *
 * O resultado vai para `projetos.memorial_calculo` (planilha/dados internos).
 * NUNCA é exibido ao usuário.
 */
export function enriquecerMemorial(
  saving: SavingColetado | undefined,
  receita: ReceitaColetada | undefined,
  tiposProjeto: string[],
): string {
  const partes: string[] = [];

  // ── SAVING ──
  if (tiposProjeto.includes('saving') && saving) {
    const memorialBase = normalizarMarcadoresMemorial(saving.memorial_calculo ?? '');
    partes.push(memorialBase);

    // Recalcular financeiro a partir das horas (fonte de verdade) antes de injetar
    const recomputado = recomputarSavingFinanceiro(saving, saving.custo_externo_mensal ?? 0);

    // Injetar bloco financeiro após o memorial do LLM
    partes.push('\n---\n### Detalhamento Financeiro (interno)\n');

    const linhas = recomputado.linhas ?? [];
    if (linhas.length > 0) {
      partes.push(`**Pessoas (${linhas.length}):**\n`);
      let totalReaisHoras = 0;
      for (const l of linhas) {
        const valorHora = l.valor_hora ?? 0;
        const economiaReais = round2(l.economia_horas_mes * valorHora);
        totalReaisHoras += economiaReais;
        partes.push(
          `- ${l.cargo} (R$ ${valorHora.toFixed(2)}/h): ` +
          `${l.economia_horas_mes}h economia × R$ ${valorHora.toFixed(2)} = **R$ ${economiaReais.toFixed(2)}**`
        );
      }
      partes.push(`\n**Total horas:** ${recomputado.economia_horas_mes ?? 0}h`);
      partes.push(`**Total financeiro (horas):** R$ ${round2(totalReaisHoras).toFixed(2)}`);
    }

    // Custo evitado
    const evitadoReais = Math.max(0, Number(saving.custo_evitado_reais) || 0);
    if (evitadoReais > 0) {
      partes.push(`\n**Custo evitado:** R$ ${evitadoReais.toFixed(2)} (${saving.custo_evitado_tipo ?? 'mensal'})`);
      if (saving.custo_evitado_descricao) {
        partes.push(`  Descrição: ${saving.custo_evitado_descricao}`);
      }
    } else {
      partes.push('\n**Custo evitado:** N/A');
    }

    // Custo externo
    const custoExterno = Math.max(0, Number(saving.custo_externo_mensal) || 0);
    if (custoExterno > 0) {
      partes.push(`**Custo de ferramenta externa:** R$ ${custoExterno.toFixed(2)}/mês`);
    } else {
      partes.push('**Custo de ferramenta externa:** N/A');
    }

    // Custos do projeto (serviços pagos que a solução consome pra rodar — abate)
    const custoProjeto = Math.max(0, Number(saving.custo_projeto_reais) || 0);
    if (custoProjeto > 0) {
      partes.push(`**Custos do projeto:** R$ ${custoProjeto.toFixed(2)}/mês (${saving.custo_projeto_tipo ?? 'mensal'})`);
      if (saving.custo_projeto_descricao) {
        partes.push(`  Descrição: ${saving.custo_projeto_descricao}`);
      }
    } else {
      partes.push('**Custos do projeto:** N/A');
    }

    // Total líquido (já inclui custo evitado e desconta custo externo)
    partes.push(`\n**Economia líquida total:** R$ ${round2(recomputado.economia_reais_mes ?? 0).toFixed(2)}`);
    partes.push(`**Tipo de saving:** ${saving.tipo_saving ?? 'mensal'}`);
  }

  // ── RECEITA ──
  if (tiposProjeto.includes('receita_incremental') && receita) {
    if (partes.length > 0) partes.push('\n---\n');
    const memorialReceita = normalizarMarcadoresMemorial(receita.memorial_calculo ?? '');
    partes.push(memorialReceita);

    partes.push(`\n**Valor da receita incremental:** R$ ${(receita.valor_ganho_mensal ?? 0).toFixed(2)}`);
    partes.push(`**Tipo:** ${receita.tipo_saving ?? 'mensal'}`);
  }

  return partes.join('\n');
}
