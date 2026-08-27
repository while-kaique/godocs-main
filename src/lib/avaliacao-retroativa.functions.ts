/**
 * RETROATIVO do time autônomo de avaliação (fatia C) — orquestração server-side, MODO SOMBRA.
 *
 * Roda a MESA nos projetos que a triagem HUMANA já assentou (Status `Aprovado`/`Reprovado` no
 * espelho) e compara a recomendação da mesa com o veredito humano, medindo acerto/erro. É o que
 * permite, ANTES de confiar na mesa para decidir sozinha, saber "quão bem ela teria batido com o
 * humano" — em especial a `taxa_erro_grave` (auto-aprovaria o que o humano REPROVOU: as 500h).
 *
 * ⚠️ **SEM tocar status nenhum.** Não grava em `projeto_avaliacao` nem abre deliberação — só mede e
 * grava em `avaliacao_retroativa`. Respeita a flag master `AVALIACAO_NORMAIS` (OFF → NO-OP total).
 * ⚠️ Reusa o painel da fatia B/C (`computarVotosDoProjeto` + `carregarContextoPainel`) — a régua da
 * mesa é EXATAMENTE a mesma do fluxo ao vivo, senão a medição não valeria.
 */
import {
  getIdsRetroativos,
  upsertAvaliacaoRetroativa,
} from '@/integrations/db/client.server';
import { lerResumosEspelho } from '@/lib/sheet-espelho';
import { mapResumo, type ProjetoDashboardResumo } from '@/lib/dashboard-resumo';
import {
  avaliacaoNormaisLigada,
  carregarContextoPainel,
  computarVotosDoProjeto,
} from '@/lib/avaliacao-normais.functions';
import {
  compararComHumano,
  agregarAcuracia,
  type ResultadoComparacao,
  type Acuracia,
} from '@/lib/avaliacao-retroativa';

/** Carimbo de origem das medições retroativas. */
export const ORIGEM_RETROATIVO = 'retroativo-normais';

/** Só estes Status são veredito HUMANO assentado (o resto → sem_base no comparador). */
const STATUS_ASSENTADOS = new Set(['aprovado', 'reprovado']);

export type ItemRetroativo = {
  projeto_id: string;
  veredito_agregado: string | null;
  veredito_humano: string | null;
  resultado: ResultadoComparacao;
  confianca: number | null;
  grau: string | null;
};

export type ResultadoRetroativo = {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  candidatos: number;
  medidos: number;
  acuracia: Acuracia;
  itens: ItemRetroativo[];
  motivo?: string;
};

function acuraciaVazia(): Acuracia {
  return {
    total: 0,
    acerto: 0,
    conservador: 0,
    erro_grave: 0,
    sem_base: 0,
    comparaveis: 0,
    taxa_acerto: 0,
    taxa_erro_grave: 0,
  };
}

/**
 * Mede a mesa contra o gabarito humano. Bounded por `limite` (converge em várias corridas — só
 * pega quem ainda não foi medido). `dry` (DEFAULT) calcula e devolve a acurácia sem gravar.
 * Respeita a flag master; OFF → NO-OP.
 */
export async function avaliarRetroativo(
  opts: { dry?: boolean; limite?: number } = {},
): Promise<ResultadoRetroativo> {
  if (!avaliacaoNormaisLigada()) {
    return {
      ok: true,
      ligado: false,
      dry: true,
      candidatos: 0,
      medidos: 0,
      acuracia: acuraciaVazia(),
      itens: [],
      motivo: 'AVALIACAO_NORMAIS desligado (modo sombra OFF)',
    };
  }
  const dry = opts.dry ?? true;
  const limite = opts.limite ?? 20;

  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const jaMedidos = new Set(await getIdsRetroativos());

  // Candidatos = NÃO especiais, com veredito humano assentado (aprovado/reprovado), ainda não medidos.
  const candidatos = resumos
    .filter(
      (p) =>
        !p.especial &&
        p.statusChave != null &&
        STATUS_ASSENTADOS.has(p.statusChave) &&
        !jaMedidos.has(p.id),
    )
    .slice(0, limite);

  if (candidatos.length === 0) {
    return {
      ok: true,
      ligado: true,
      dry,
      candidatos: 0,
      medidos: 0,
      acuracia: acuraciaVazia(),
      itens: [],
      motivo: 'nenhum projeto com veredito humano pendente de medição',
    };
  }

  // dry:true no contexto — o retroativo NUNCA grava projeto_avaliacao nem abre deliberação.
  const { ctx } = await carregarContextoPainel(candidatos.map((c) => c.id), {
    dry: true,
    capGeracao: 60,
  });

  const itens: ItemRetroativo[] = [];
  let medidos = 0;
  for (const cand of candidatos) {
    try {
      const votos = await computarVotosDoProjeto(cand.id, ctx);
      const veredito = votos?.conciliado.veredito ?? null;
      const resultado = compararComHumano(veredito, cand.statusChave);
      const item: ItemRetroativo = {
        projeto_id: cand.id,
        veredito_agregado: veredito,
        veredito_humano: cand.statusChave,
        resultado,
        confianca: votos?.conciliado.confianca ?? null,
        grau: votos?.conciliado.grau ?? null,
      };
      itens.push(item);
      if (!dry) {
        await upsertAvaliacaoRetroativa({
          projeto_id: item.projeto_id,
          veredito_agregado: item.veredito_agregado,
          veredito_humano: item.veredito_humano,
          resultado: item.resultado,
          confianca: item.confianca,
          grau: item.grau,
          motivo: (votos?.conciliado.motivos ?? []).join(' ') || null,
          origem: ORIGEM_RETROATIVO,
        });
        medidos++;
      }
    } catch (e) {
      console.error('[retroativo] falha ao medir', cand.id, e);
    }
  }

  const acuracia = agregarAcuracia(itens.map((i) => i.resultado));

  return { ok: true, ligado: true, dry, candidatos: candidatos.length, medidos, acuracia, itens };
}
