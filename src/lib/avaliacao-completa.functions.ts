/**
 * O TIME agindo JUNTO: uma passada que avalia **se há impacto** e **quanto o projeto vale**.
 *
 * ⚠️ **Por que existe** (decisão do Luis, 08/09/2026): *"é um TIME agindo JUNTO e classificando
 * JUNTO"*. Até aqui eram dois caminhos separados — a MESA (veredito: aprovar/validar/reprovar) e o
 * CLASSIFICADOR (a nota) —, disparados em pontos diferentes, com dois botões diferentes na ficha.
 * Isso descrevia uma divisão que não existe no produto: quem decide se o projeto tem impacto e
 * quem diz quanto ele vale são o mesmo time, na mesma passada.
 *
 * ⚠️ **E a nota deixou de ser privilégio de especial.** O classificador tinha um gate
 * `especial !== 1` no caminho de submissão, então projeto padrão nunca ganhava nota: *"todo projeto
 * pode ter nota ou não agora"*. O gate saiu daqui; o que sobrou é o que a régua já dizia — projeto
 * com nota humana não é reclassificado (é âncora), e `forcar` reabre.
 *
 * ⚠️ **As duas metades são INDEPENDENTES no erro.** `Promise.allSettled`, e cada uma já é fail-safe
 * por dentro: a mesa pode falhar (flag OFF, projeto especial) sem levar a nota, e vice-versa. Quem
 * chama isto — submissão, botão da ficha, lote — nunca recebe exceção.
 */
import { avaliarProjetoNormal } from '@/lib/avaliacao-normais.functions';
import { classificarEspecialProjeto } from '@/lib/especial-classificador.functions';

export type ResultadoTimeCompleto = {
  ok: boolean;
  projeto_id: string;
  /** O veredito da mesa (impacto): `{ok, veredito, ...}` ou o motivo do NO-OP. */
  mesa: { ok: boolean; motivo?: string; veredito?: string | null };
  /** A nota: `{ok, estrelas}` ou o motivo (já tem nota humana, sem vizinhos…). */
  estrela: { ok: boolean; motivo?: string; estrelas?: number | null };
};

function resumoMesa(r: unknown): ResultadoTimeCompleto['mesa'] {
  const o = (r ?? {}) as Record<string, unknown>;
  return {
    ok: o.ok === true,
    motivo: typeof o.motivo === 'string' ? o.motivo : undefined,
    veredito: typeof o.veredito === 'string' ? o.veredito : null,
  };
}

function resumoEstrela(r: unknown): ResultadoTimeCompleto['estrela'] {
  const o = (r ?? {}) as Record<string, unknown>;
  const rec = (o.recomendacao ?? {}) as Record<string, unknown>;
  return {
    ok: o.ok === true,
    motivo: typeof o.motivo === 'string' ? o.motivo : undefined,
    estrelas: typeof rec.estrelas_recomendada === 'number' ? rec.estrelas_recomendada : null,
  };
}

/**
 * Roda as duas metades num projeto. `forcar` reabre a nota de quem já tem nota humana (é o que
 * "rerodar" quer dizer quando o pedido é explícito). NUNCA lança.
 */
export async function avaliarProjetoComTimeCompleto(
  projetoId: string,
  opts: { dry?: boolean; forcar?: boolean } = {},
): Promise<ResultadoTimeCompleto> {
  const dry = opts.dry ?? false;
  const [mesa, estrela] = await Promise.allSettled([
    avaliarProjetoNormal(projetoId, { dry }),
    classificarEspecialProjeto(projetoId, { dry, forcar: opts.forcar }),
  ]);
  const m = mesa.status === 'fulfilled' ? resumoMesa(mesa.value) : { ok: false, motivo: String(mesa.reason) };
  const e =
    estrela.status === 'fulfilled'
      ? resumoEstrela(estrela.value)
      : { ok: false, motivo: String(estrela.reason) };
  // `ok` é OU, não E: uma metade que funcionou já é resultado — e o caso mais comum de "falha" da
  // nota é legítimo (o projeto tem nota humana e é âncora), não erro.
  return { ok: m.ok || e.ok, projeto_id: projetoId, mesa: m, estrela: e };
}

/**
 * Chamado no fan-out da submissão. NO-OP silencioso e sem exceção — as duas metades já são
 * fail-safe. ⚠️ Substitui as DUAS entradas separadas que havia ali (`classificarEspecialEmBackground`
 * e `avaliarProjetoNormalEmBackground`): cada submissão roda o time inteiro.
 */
export async function avaliarComTimeCompletoEmBackground(projetoId: string): Promise<void> {
  try {
    const r = await avaliarProjetoComTimeCompleto(projetoId);
    console.log(
      `[time-completo] ${projetoId} · mesa=${r.mesa.ok ? (r.mesa.veredito ?? 'ok') : `no-op (${r.mesa.motivo ?? '?'})`}` +
        ` · estrela=${r.estrela.ok ? r.estrela.estrelas : `no-op (${r.estrela.motivo ?? '?'})`}`,
    );
  } catch (e) {
    console.error('[time-completo] falha em background:', e);
  }
}

/** Teto de projetos por chamada do LOTE. */
export const LOTE_MAX_PROJETOS = 8;

export type ResultadoLote = {
  ok: boolean;
  pedidos: number;
  rodados: number;
  itens: ResultadoTimeCompleto[];
  motivo?: string;
};

/**
 * Roda o time num LOTE de projetos escolhidos na tela.
 *
 * ⚠️ **Bounded em `LOTE_MAX_PROJETOS` e dirigido pelo FRONT**, que é o padrão deste repo para
 * trabalho longo (o disparo de e-mails faz igual). O motivo é medido: cada projeto são ~5 chamadas
 * de LLM, e o `waitUntil` do Godeploy **cancela** tarefa longa depois da resposta — foi assim que
 * o botão do time de 30 chamadas prometeu uma estrela que nunca chegou (08/09/2026). Aqui cada
 * chamada é SÍNCRONA e pequena; quem itera é a tela, que mostra o progresso.
 * ⚠️ Um projeto que falha não derruba o lote (cada item já é fail-safe).
 */
export async function avaliarLoteComTime(
  projetoIds: string[],
  opts: { dry?: boolean; forcar?: boolean } = {},
): Promise<ResultadoLote> {
  const ids = [...new Set((projetoIds ?? []).map((i) => String(i ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, pedidos: 0, rodados: 0, itens: [], motivo: 'nenhum projeto informado' };
  if (ids.length > LOTE_MAX_PROJETOS) {
    return {
      ok: false,
      pedidos: ids.length,
      rodados: 0,
      itens: [],
      motivo: `no máximo ${LOTE_MAX_PROJETOS} projetos por chamada (a tela itera em lotes desse tamanho)`,
    };
  }
  const itens: ResultadoTimeCompleto[] = [];
  // EM SÉRIE de propósito: o gateway de LLM tem poucos slots e disparar 8 projetos × 5 chamadas
  // em paralelo satura o proxy — o que este repo já mediu como causa de timeout em cascata.
  for (const id of ids) {
    itens.push(await avaliarProjetoComTimeCompleto(id, opts));
  }
  return { ok: true, pedidos: ids.length, rodados: itens.filter((i) => i.ok).length, itens };
}
