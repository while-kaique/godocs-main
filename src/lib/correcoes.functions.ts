/**
 * As LIÇÕES da triagem, prontas para entrar num prompt — o lado com I/O do `correcoes.ts`.
 *
 * ## Por que este arquivo existe
 * A leitura é a MESMA para todo agente que aprende com a triagem: ler o log de atividade,
 * traduzir as linhas em `Correcao`, ordenar pelas dos VIZINHOS que o RAG recuperou e renderizar
 * o bloco. Isso nasceu privado dentro do classificador de especiais e, quando a MESA de
 * avaliação passou a consumir lição também (T9 da calibragem), copiar as 15 linhas seria criar
 * duas leituras que divergem no primeiro ajuste — a janela de 200 linhas, o tratamento de falha
 * e o teto de 6 lições têm de ser os mesmos nos dois lados, senão "o agente aprendeu" passa a
 * depender de QUAL agente.
 *
 * ⚠️ A régua de o que ENSINA continua no módulo puro (`correcoes.ts`): aqui só se lê o banco.
 */
import { queryAdminActivitiesPorAcao } from "@/integrations/db/client.server";
import {
  ACOES_COM_CORRECAO,
  blocoCorrecoes,
  correcoesDoLog,
  licoesPara,
  type Correcao,
} from "@/lib/correcoes";

/**
 * Quantas CORREÇÕES são varridas — não quantas ações.
 *
 * ⚠️ É uma JANELA, não a tabela inteira: o log é append-only e cresce com toda ação de painel, e
 * o que ensina é o que a triagem corrigiu recentemente. Puxar tudo seria o caminho do teto de
 * 32 MiB de RPC que já derrubou 3 consultas nesta vizinhança.
 *
 * ⚠️ E o filtro por ação vai no SQL, não em memória: com a janela genérica das últimas 200
 * ACÕES, `status` (a mais frequente do painel) empurrava as lições para fora dela sem sinal
 * nenhum — o bloco simplesmente voltava vazio.
 */
const JANELA_CORRECOES = 200;

/**
 * O bloco de lições para o prompt de UM projeto — `''` quando não há nada que ensine.
 *
 * As correções dos `vizinhos` vêm primeiro (é a correção de um projeto PARECIDO que ensina, não
 * a mais recente), a do próprio projeto é excluída (seria entregar a resposta) e só entram as
 * que têm motivo escrito — `ensinaAlgo` descarta o resto, porque correção sem porquê ensina
 * "concorde com o humano", que é exatamente o viés vetado.
 *
 * ⚠️ **NUNCA lança.** Falha de leitura devolve `''`: um agente sem lição julga como julgava
 * antes, e derrubar a avaliação por causa do bloco de exemplos seria trocar um parecer bom por
 * nenhum parecer.
 *
 * ⚠️ O teto de 6 lições é do `blocoCorrecoes` e não é economia de token: o prompt tem um punhado
 * de linhas de atenção, e enchê-lo de exemplos dilui a régua, que é o que manda.
 */
export async function carregarCorrecoesDaTriagem(contexto = "correcoes"): Promise<Correcao[]> {
  try {
    const linhas = await queryAdminActivitiesPorAcao(ACOES_COM_CORRECAO, JANELA_CORRECOES);
    return correcoesDoLog(
      linhas.map((l) => ({
        acao: String(l.acao ?? ""),
        projeto_id: l.projeto_id ?? null,
        projeto_nome: l.projeto_nome ?? null,
        meta_json: l.meta_json ?? null,
        created_at: l.created_at ?? null,
      })),
    );
  } catch (e) {
    console.error(`[${contexto}] falha ao ler as correções da triagem:`, e);
    return [];
  }
}

/**
 * O bloco de lições a partir de correções JÁ CARREGADAS — puro, sem I/O.
 *
 * ⚠️ Existe separado de propósito: quem avalia em LOTE (o cron da mesa) carrega as correções UMA
 * vez no contexto do lote e chama só isto por projeto. A versão com I/O abaixo é para o caminho
 * de UM projeto, onde não há laço em que a consulta se repetiria.
 */
export function licoesParaPrompt(
  correcoes: Correcao[],
  projetoId: string,
  vizinhos: readonly { projeto_id?: string; id?: string }[] = [],
): string {
  const ids = vizinhos.map((v) => String(v.projeto_id ?? v.id ?? "")).filter(Boolean);
  return blocoCorrecoes(licoesPara(correcoes, projetoId, ids));
}

export async function licoesDaTriagemParaPrompt(
  projetoId: string,
  vizinhos: readonly { projeto_id?: string; id?: string }[] = [],
  contexto = "correcoes",
): Promise<string> {
  return licoesParaPrompt(await carregarCorrecoesDaTriagem(contexto), projetoId, vizinhos);
}
