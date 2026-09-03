/**
 * Servidor da AGLUTINAÇÃO (item 5.3) — varre, sugere e registra a decisão humana.
 *
 * Roda DENTRO do app de propósito: a documentação (`o_que_faz`) mora no SQLite, não na
 * planilha, e é ela que reconhece a feature REBATIZADA — a que casamento de nome nunca veria.
 *
 * ⚠️ A varredura NÃO escreve na planilha. O que escreve `ID Pai`/`ID Feature` é o ACEITE
 * humano (`decidirSugestao`), e só ele. Ver a régua em `src/lib/aglutinacao.ts`.
 */
import { z } from 'zod';
import {
  getProjetosParaAglutinacao,
  getAglutinacoes,
  upsertAglutinacao,
  decidirAglutinacao,
  getEmbeddingsProjetos,
} from '@/integrations/db/client.server';
import { base64ParaVetor, cosseno } from '@/lib/embeddings';
import { updateRowByProjectId } from '@/lib/google/sheets';
import { espelharEscrita } from '@/lib/sheet-espelho';
import { registrarAtividade } from '@/lib/atividades.functions';
import { ehProjetoTesteE2E } from '@/lib/google/chat';
import { parseDataFlexivel } from '@/lib/format-date';
import {
  calcularIdf,
  tokenizar,
  tokensPesados,
  similaridade,
  similaridadeFinal,
  tokensEmComum,
  nomeContido,
  prefixoDeFamilia,
} from '@/lib/similaridade-lexical';
import {
  candidatosDe,
  consolidarSugestoes,
  PISO_SIMILARIDADE_AGLUTINACAO,
  type ProjetoAglutinavel,
  type Sugestao,
} from '@/lib/aglutinacao';
import { julgarAglutinacao } from '@/lib/agents/aglutinador';

const varreduraSchema = z.object({
  /** `dry` é o DEFAULT: sem ele a varredura NÃO grava sugestão nenhuma. */
  dry: z.boolean().optional(),
  piso: z.number().min(0).max(1).optional(),
  /** Teto de projetos julgados NESTA passada (o LLM é o caro). */
  max: z.number().int().positive().optional(),
  /**
   * Quantos projetos com candidato PULAR antes de começar a julgar.
   *
   * ⚠️ É o que torna a varredura RESUMÍVEL, e ela precisa ser: ~100 pares × ~2s de LLM são
   * minutos numa requisição só, e requisição longa morre no Godeploy — a mesma razão de o
   * disparo de e-mails ser dirigido em lotes pelo FRONT. A lista de candidatos é
   * DETERMINÍSTICA (TF-IDF + vetores gravados, sem LLM), então recomputá-la a cada lote dá
   * exatamente a mesma ordem e o `pular` cai sempre no mesmo lugar.
   */
  pular: z.number().int().min(0).optional(),
  /** Pula o LLM: devolve só os pares candidatos, para calibrar a régua. */
  somente_pares: z.boolean().optional(),
  /** Desliga a fonte vetorial (só léxico). Útil para medir quanto cada fonte contribui. */
  sem_vetor: z.boolean().optional(),
  /** Piso do cosseno para um vizinho VETORIAL virar candidato. */
  piso_vetor: z.number().min(0).max(1).optional(),
  /**
   * Pares JÁ escolhidos, para julgar sem refazer a recuperação.
   *
   * ⚠️ Existe por PESO, não por elegância. Montar os candidatos lê a tabela de vetores
   * inteira — ~700 vetores de 3072 floats são **~11 MB por chamada** —, e a varredura roda
   * em ~30 lotes: refazer isso a cada lote é 11 MB × 30 de I/O puro, que é a maior parte da
   * espera. Com os pares em mãos, o lote só carrega os projetos e chama o LLM.
   *
   * Quem os obtém é a fase `somente_pares`, que roda UMA vez e é determinística.
   */
  julgar_pares: z
    .array(z.object({ filhoId: z.string().min(1), paiIds: z.array(z.string().min(1)).min(1) }))
    .optional(),
});

/**
 * Piso do cosseno. Mais alto que o piso léxico porque o embedding aproxima por TEMA, e tema
 * puxa irmão (dois dashboards de margem de marcas diferentes ficam muito próximos). Aqui ele
 * é a SEGUNDA fonte: entra para achar a feature REBATIZADA, que não divide vocabulário com o
 * pai — e quem separa "parecido" de "parte de" continua sendo o juiz, que lê a documentação.
 */
export const PISO_VETOR_AGLUTINACAO = 0.62;

export type ParaPainel = {
  filhoId: string;
  filhoNome: string;
  paiId: string;
  paiNome: string;
  similaridade: number;
  confianca: number | null;
  justificativa: string | null;
  porque: string;
  estado: string;
  decididoPor: string | null;
};

/** Junta as 3 fontes de texto de um projeto no formato que a régua consome. */
function paraAglutinavel(p: {
  id: string;
  nome: string | null;
  descricao_breve: string | null;
  submitted_at: string | null;
  o_que_faz: string | null;
}): ProjetoAglutinavel | null {
  const nome = (p.nome ?? '').trim();
  if (!nome || ehProjetoTesteE2E(nome)) return null;
  const d = parseDataFlexivel(p.submitted_at);
  return {
    id: p.id,
    nome,
    descricao: p.descricao_breve,
    documentacao: p.o_que_faz,
    dataMs: d ? d.getTime() : null,
  };
}

export async function varrerAglutinacao(body: unknown) {
  const { dry, piso, max, pular, somente_pares, sem_vetor, piso_vetor, julgar_pares } =
    varreduraSchema.parse(body ?? {});
  const gravar = dry === false;
  const limiar = piso ?? PISO_SIMILARIDADE_AGLUTINACAO;

  const brutos = await getProjetosParaAglutinacao();
  const projetos = brutos
    .map(paraAglutinavel)
    .filter((p): p is ProjetoAglutinavel => p !== null);
  const universo = new Map(projetos.map((p) => [p.id, p]));

  const textos = projetos.map((p) => ({
    nome: p.nome,
    descricao: p.descricao,
    documentacao: p.documentacao,
  }));
  const idf = calcularIdf(
    textos.map((t) => [
      ...tokenizar(t.nome),
      ...tokenizar(t.descricao ?? ''),
      ...tokenizar(t.documentacao ?? ''),
    ]),
  );
  const pesos = textos.map(tokensPesados);

  /**
   * ⚠️ **Fonte VETORIAL sem chave nenhuma.** Os vetores da base inteira JÁ estão gravados em
   * `projeto_embedding` (a memória do time de avaliação dos normais) — a chave da OpenAI só
   * faz falta para embeddar projeto NOVO. Para varrer o que já existe, basta ler a tabela e
   * fazer cosseno em JS, que é o mesmo caminho degradado que o classificador de especiais já
   * usa quando o Pinecone está fora.
   *
   * Falha ou tabela vazia → segue só com o léxico (a varredura nunca depende disto).
   */
  const vetores = new Map<string, number[]>();
  // Pares prontos → nada de vetores nem de TF-IDF: só julgar.
  if (!sem_vetor && !julgar_pares) {
    try {
      for (const row of await getEmbeddingsProjetos()) {
        if (!universo.has(row.projeto_id)) continue;
        const v = base64ParaVetor(row.vetor);
        if (v.length) vetores.set(row.projeto_id, v);
      }
    } catch (e) {
      console.error('[aglutinacao] sem fonte vetorial (segue só com o léxico):', e);
    }
  }
  const pisoVetor = piso_vetor ?? PISO_VETOR_AGLUTINACAO;

  const porque = new Map<string, string>();
  const comCandidatos: Array<{ p: ProjetoAglutinavel; cands: ReturnType<typeof candidatosDe> }> = [];
  if (julgar_pares) {
    for (const { filhoId, paiIds } of julgar_pares) {
      const filho = universo.get(filhoId);
      if (!filho) continue;
      const cands = paiIds
        .filter((id) => universo.has(id))
        .map((paiId) => ({ filhoId, paiId, similaridade: 0 }));
      if (cands.length) comCandidatos.push({ p: filho, cands });
    }
  } else
  projetos.forEach((p, i) => {
    const viz = projetos
      .map((o, j) => {
        if (o.id === p.id) return null;
        const contido = nomeContido(textos[i], textos[j], idf);
        const pre = prefixoDeFamilia(textos[i], textos[j], idf);
        const lexica = similaridadeFinal(similaridade(pesos[i], pesos[j], idf), {
          contido,
          prefixo: pre.length > 0,
        });
        // ⚠️ As duas fontes SOMAM candidatos, não médias: um par que só o vetor vê (feature
        // rebatizada) e um que só o léxico vê (namespace no nome) são ambos legítimos, e
        // tirar a média de um zero afundaria os dois. Vence a fonte que viu melhor.
        const va = vetores.get(p.id);
        const vb = vetores.get(o.id);
        const cos = va && vb ? cosseno(va, vb) : 0;
        const porVetor = cos >= pisoVetor;
        const sim = porVetor ? Math.max(lexica, cos) : lexica;
        if (sim >= limiar) {
          porque.set(
            `${p.id}|${o.id}`,
            [
              pre.length ? `família "${pre.join(' ')}"` : '',
              contido ? 'nome contido' : '',
              porVetor ? `semelhança de conteúdo ${cos.toFixed(2)}` : '',
              tokensEmComum(pesos[i], pesos[j], idf).join(', '),
            ]
              .filter(Boolean)
              .join(' · '),
          );
        }
        return { id: o.id, similaridade: sim };
      })
      .filter((x): x is { id: string; similaridade: number } => x !== null);
    const cands = candidatosDe(p, viz, universo, { piso: limiar });
    if (cands.length) comCandidatos.push({ p, cands });
  });

  const paresUnicos = new Set(
    comCandidatos.flatMap(({ cands }) => cands.map((c) => `${c.filhoId}>${c.paiId}`)),
  );

  if (somente_pares) {
    return {
      ok: true,
      projetos: projetos.length,
      com_documentacao: projetos.filter((p) => (p.documentacao ?? '').trim()).length,
      com_vetor: vetores.size,
      com_candidatos: comCandidatos.length,
      pares_unicos: paresUnicos.size,
      piso: limiar,
      // O que o lote consome depois — na MESMA ordem, que é o que torna a corrida resumível.
      julgar_pares: comCandidatos.map(({ p, cands }) => ({
        filhoId: p.id,
        paiIds: cands.map((c) => c.paiId),
      })),
      pares: [...paresUnicos].slice(0, 100).map((k) => {
        const [filhoId, paiId] = k.split('>');
        return {
          filhoId,
          filhoNome: universo.get(filhoId)?.nome ?? '',
          paiId,
          paiNome: universo.get(paiId)?.nome ?? '',
          porque: porque.get(`${filhoId}|${paiId}`) ?? porque.get(`${paiId}|${filhoId}`) ?? '',
        };
      }),
    };
  }

  const inicio = pular ?? 0;
  const aJulgar =
    typeof max === 'number'
      ? comCandidatos.slice(inicio, inicio + max)
      : comCandidatos.slice(inicio);
  const brutas: Sugestao[] = [];
  const falhas: string[] = [];
  /**
   * O que ACONTECEU com cada par deste lote — é o que a tela mostra enquanto roda.
   * ⚠️ Sem isto o painel só sabe contar: a pessoa vê "Procurando…" por minutos e não tem
   * como saber se está funcionando, o que está sendo comparado, nem quanto falta. Cada
   * julgamento vira uma linha, inclusive o "não é feature" — que é a maioria, e é
   * justamente o que prova que o agente está trabalhando.
   */
  const detalhe: Array<{
    filho: string;
    pai: string;
    desfecho: 'sugerido' | 'descartado' | 'falhou';
    confianca?: number;
  }> = [];
  for (const { p, cands } of aJulgar) {
    const { sugestao, erro } = await julgarAglutinacao(p, cands, universo);
    const paiNome = universo.get(sugestao?.paiId ?? cands[0]?.paiId ?? '')?.nome ?? '';
    if (sugestao) brutas.push(sugestao);
    if (erro) falhas.push(`${p.id}: ${erro}`);
    detalhe.push({
      filho: p.nome,
      pai: paiNome,
      desfecho: erro ? 'falhou' : sugestao ? 'sugerido' : 'descartado',
      ...(sugestao ? { confianca: sugestao.confianca } : {}),
    });
  }
  const sugestoes = consolidarSugestoes(brutas);

  if (gravar) {
    for (const s of sugestoes) {
      await upsertAglutinacao({
        filho_id: s.filhoId,
        pai_id: s.paiId,
        similaridade: s.similaridade,
        confianca: s.confianca,
        justificativa: s.justificativa,
        origem: 'varredura',
      });
    }
  }

  return {
    ok: true,
    dry: !gravar,
    projetos: projetos.length,
    com_documentacao: projetos.filter((p) => (p.documentacao ?? '').trim()).length,
    com_vetor: vetores.size,
    julgados: aJulgar.length,
    // Quanto falta para o chamador saber se pede outro lote. `0` = acabou.
    total_com_candidatos: comCandidatos.length,
    restantes: Math.max(0, comCandidatos.length - (inicio + aJulgar.length)),
    proximo_pular: inicio + aJulgar.length,
    // ⚠️ Falha de chamada NÃO é "não é feature": sem este número, uma rajada de 502 do
    // proxy faria a rota responder "0 sugestões" sobre uma base que ninguém analisou.
    falhas: falhas.length,
    falhas_exemplos: falhas.slice(0, 5),
    detalhe,
    sugestoes: sugestoes.map((s) => ({
      ...s,
      filhoNome: universo.get(s.filhoId)?.nome ?? '',
      paiNome: universo.get(s.paiId)?.nome ?? '',
    })),
  };
}

/** O que o painel lê: as sugestões com os nomes resolvidos. */
export async function listarAglutinacoes(estado?: string): Promise<{ itens: ParaPainel[] }> {
  const [linhas, brutos] = await Promise.all([
    getAglutinacoes(estado),
    getProjetosParaAglutinacao(),
  ]);
  const nome = new Map(brutos.map((p) => [p.id, (p.nome ?? '').trim()]));
  return {
    itens: linhas.map((l) => ({
      filhoId: l.filho_id,
      filhoNome: nome.get(l.filho_id) ?? l.filho_id,
      paiId: l.pai_id,
      paiNome: nome.get(l.pai_id) ?? l.pai_id,
      similaridade: l.similaridade ?? 0,
      confianca: l.confianca,
      justificativa: l.justificativa,
      porque: l.origem ?? '',
      estado: l.estado,
      decididoPor: l.decidido_por,
    })),
  };
}

const decisaoSchema = z.object({
  filhoId: z.string().min(1),
  paiId: z.string().min(1),
  aceitar: z.boolean(),
});

/**
 * A decisão humana. **Só o ACEITE escreve na planilha** — e escreve apenas as 2 colunas do
 * vínculo (`ID Pai` na linha do filho, `ID Feature` na do pai). Nunca "Status", nunca
 * "Atualizado Em" (carimbo do sistema, que regulariza legado), nunca coluna financeira:
 * declarar um vínculo não é reprocessar o projeto.
 *
 * ⚠️ Rejeitar é decisão tão registrada quanto aceitar — é o que impede a próxima varredura
 * de ressuscitar o par (o UPSERT só toca linha ainda 'sugerido') e é o dado que mede se o
 * agente acerta.
 */
export async function decidirSugestaoAglutinacao(body: unknown, adminEmail: string) {
  const { filhoId, paiId, aceitar } = decisaoSchema.parse(body);
  await decidirAglutinacao(filhoId, paiId, aceitar ? 'aceito' : 'rejeitado', adminEmail);

  let planilha: 'ok' | 'falhou' | 'nao_se_aplica' = 'nao_se_aplica';
  if (aceitar) {
    try {
      await updateRowByProjectId(filhoId, { 'ID Pai': paiId });
      await espelharEscrita(filhoId, { 'ID Pai': paiId });
      await updateRowByProjectId(paiId, { 'ID Feature': filhoId });
      await espelharEscrita(paiId, { 'ID Feature': filhoId });
      planilha = 'ok';
    } catch (e) {
      // A decisão JÁ está no banco; falhar aqui não pode desfazê-la (mesma disciplina do
      // admin_status_log). O painel mostra o estado e a planilha se reconcilia no reenvio.
      console.error('[aglutinacao] falha ao gravar o vínculo na planilha:', e);
      planilha = 'falhou';
    }
  }

  await registrarAtividade({
    ator_email: adminEmail,
    acao: 'aglutinacao',
    projeto_id: filhoId,
    detalhe: aceitar
      ? `vínculo aceito: é feature de ${paiId}`
      : `sugestão rejeitada: NÃO é feature de ${paiId}`,
    meta: { pai_id: paiId, planilha },
  });

  return { ok: true, estado: aceitar ? 'aceito' : 'rejeitado', planilha };
}
