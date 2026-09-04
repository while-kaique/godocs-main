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

/**
 * O ganho que o projeto declara, que é o número sob auditoria.
 *
 * ⚠️ Vem do bloco `financeiro` do próprio dossiê, JÁ NORMALIZADO. A primeira versão foi ler a
 * célula crua do espelho, e voltou `null` nos quatro projetos do primeiro teste: `Dossie` não
 * expõe a linha da planilha, ele expõe os números já tratados. Com `null` ali, `ajustaria`
 * ficava sempre falso e a auditoria inteira virava decorativa — dizia o valor sugerido e nunca
 * marcava ninguém para revisão.
 */
function ganhoDeclarado(dossie: Dossie): number | null {
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

  const declarado = ganhoDeclarado(dossie);
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
