/**
 * Auditoria do VALOR declarado de um projeto — a dimensão `financeiro` da mesa, sozinha.
 *
 * ## Por que existe separada
 * O especialista financeiro já existe e é exatamente o que se quer: ele audita o ganho
 * declarado contra horas, cargos, custo evitado e receita, e devolve `{absurdo, valor_sugerido,
 * justificativa}` com a CONTA que chega no número. Só que ele vive dentro de
 * `avaliarProjetoComTime`, que roda a mesa inteira e chega a ~30 chamadas de LLM por projeto:
 * numa rodada de calibragem sobre a base toda isso não termina.
 *
 * ⚠️ **Nada aqui é régua nova.** O prompt é `buildPromptMerito({dimensao:'financeiro'})` e a
 * saída passa por `normalizarJulgamentoMerito`, os mesmos da mesa. Escrever um segundo auditor
 * financeiro seria criar a terceira régua de dinheiro do repo.
 *
 * ## O que ele NÃO faz
 * ⚠️ **Não escreve nada.** Nem no SQLite, nem na planilha, nem em `especial_avaliacao`. A
 * sugestão é insumo para gente decidir, e a regra do próprio prompt é que ela só **desce ou
 * confirma**: se o valor declarado parece BAIXO, ele registra no argumento e não sugere número,
 * porque quem aumenta o ganho de um projeto é gente.
 * ⚠️ **Sem ferramentas.** A mesa dá tool-calling ao especialista; aqui a chamada é seca, o que
 * torna a auditoria mais barata e mais conservadora. Sem certeza do número, `valor_sugerido`
 * vem `null` e a justificativa diz o que falta.
 */
import { llmChat } from '@/lib/llm';
import { carregarDossie } from '@/lib/avaliacao/dossie.functions';
import { dossieParaTexto, type Dossie } from '@/lib/avaliacao/dossie';
import { buildPromptMerito, normalizarJulgamentoMerito, type JulgamentoMerito } from '@/lib/avaliacao/cerebro-merito';
import { extrairJson } from '@/lib/agents/especial-classificador';
import { chaveProjeto } from '@/lib/projeto-chave';
import { lerLinhaEspelho } from '@/lib/sheet-espelho';

export type ResultadoAuditoriaValor = {
  ok: boolean;
  projeto_id: string;
  motivo?: string;
  /** `true` quando o auditor propõe mexer no número declarado. */
  ajustaria?: boolean;
  valor_declarado?: number | null;
  valor_sugerido?: number | null;
  justificativa?: string;
  julgamento?: JulgamentoMerito;
};

/** Número em pt-BR da planilha ("R$ 14.593,00", "1.952,77") ou já numérico. */
function numeroPtBR(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * O ganho que o projeto declara, que é o número sob auditoria.
 *
 * ⚠️ A PLANILHA vem primeiro, e isso levou duas tentativas para acertar. Ler só a célula crua do
 * espelho falhou (o `Dossie` não expõe a linha); ler só o bloco `financeiro` do dossiê também
 * falhou, porque em legado o `ganho_total_mensal` fica nulo no SQLite (o campo é `soV1` no sync
 * reverso, então não acompanha quem já existia). O agente enxergava o número — a auditoria dele
 * cita "do total declarado de R$ 14.593" — e nós é que ficávamos sem ele.
 *
 * Com `null` aqui, `ajustaria` fica sempre falso e a auditoria vira decorativa: calcula o valor,
 * escreve a conta, e nunca marca ninguém para revisão. É o defeito mais caro possível numa
 * ferramenta cujo trabalho é apontar quem revisar.
 */
async function ganhoDeclarado(projetoId: string, dossie: Dossie): Promise<number | null> {
  try {
    const linha = await lerLinhaEspelho(projetoId);
    const daPlanilha =
      numeroPtBR(linha?.['Impacto Líquido Mensal']) ?? numeroPtBR(linha?.['Impacto Líquido']);
    if (daPlanilha != null) return daPlanilha;
  } catch {
    /* cai no dossiê */
  }
  const f = dossie.financeiro;
  return f.ganho_total_mensal ?? f.saving_reais ?? null;
}

export async function auditarValorProjeto(projetoIdBruto: string): Promise<ResultadoAuditoriaValor> {
  const projetoId = chaveProjeto(projetoIdBruto);
  const dossie = await carregarDossie(projetoId);
  if (!dossie) return { ok: false, projeto_id: projetoId, motivo: 'projeto sem dossiê para auditar' };

  // `comReais: true` porque é justamente o número que está sob auditoria. ⚠️ Isto é texto para o
  // AGENTE, não para o autor: a regra de nunca mostrar R$/hora ao autor vale na saída ao autor.
  const dossieTexto = dossieParaTexto(dossie, { comReais: true });
  const prompt = buildPromptMerito({ dimensao: 'financeiro', dossieTexto, vizinhos: [] });

  const raw = await llmChat(prompt, { jsonMode: true, temperature: 0.2, maxTokens: 900 });
  const julgamento = normalizarJulgamentoMerito(extrairJson(raw), 'financeiro');
  if (!julgamento) {
    return { ok: false, projeto_id: projetoId, motivo: 'LLM não devolveu auditoria utilizável' };
  }

  const declarado = await ganhoDeclarado(projetoId, dossie);
  const sugerido = julgamento.valor?.valor_sugerido ?? null;
  // "Ajustaria" é quando há NÚMERO proposto e ele difere do declarado. Repetir o declarado é
  // resposta válida e esperada: quer dizer "auditei e o número se sustenta".
  const ajustaria = sugerido != null && declarado != null && Math.abs(sugerido - declarado) > 0.01;

  return {
    ok: true,
    projeto_id: projetoId,
    ajustaria,
    valor_declarado: declarado,
    valor_sugerido: sugerido,
    justificativa: julgamento.valor?.justificativa ?? julgamento.argumento,
    julgamento,
  };
}
