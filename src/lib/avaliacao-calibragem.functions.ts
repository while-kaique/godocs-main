/**
 * Lado SERVER da calibragem (T10/T13) — lê `avaliacao_retroativa` e devolve a medição pronta.
 *
 * Duas leituras, as duas AGREGADAS no SQL e as duas **fail-safe** (nunca lançam): a calibragem
 * que a tela exibe e a acurácia que a política de liberação consulta. ⚠️ Falhar aqui não pode
 * derrubar nem a listagem do `/dashboard` nem uma corrida do time — sem medição, a tela diz
 * "ainda sem medição" e a política mantém tudo em sombra, que é o default seguro dos dois lados.
 */
import {
  getCalibragemRetroativa,
  getMedicoesRetroativas,
} from '@/integrations/db/client.server';
import {
  agruparCalibragem,
  calibragemVazia,
  type Calibragem,
} from '@/lib/avaliacao-calibragem';
import type { AcuraciaMedida } from '@/lib/avaliacao/consenso';

/** A calibragem por faixa. Falha de leitura → todas as faixas zeradas (= "sem medição"). */
export async function carregarCalibragem(): Promise<Calibragem> {
  try {
    return agruparCalibragem(await getCalibragemRetroativa());
  } catch (e) {
    console.error('[calibragem] falha ao ler a calibragem (servindo vazia):', e);
    return calibragemVazia();
  }
}

/**
 * A acurácia MEDIDA por veredito, no formato que `politicaDeLiberacao` consome (T13/RF-242).
 *
 * ⚠️ `null` quando **não há nenhuma medição** — e é isso que faz a política dizer "sem medição"
 * em vez de mentir uma taxa. Antes, `time.functions.ts` passava `null` **literal**: a política que
 * decide se o time age sozinho lia acurácia medida e nunca recebia nenhuma, então o time estava em
 * sombra por argumento hardcoded, não por medição (achado A3.1).
 *
 * ⚠️ O mapeamento é honesto sobre o que existe: o retroativo da MESA mede o veredito `aprovar`, e
 * é essa a única chave que se pode preencher. `ajuste` fica **ausente** — a mesa não tem esse
 * desfecho —, e ausente a política já responde "não medido ainda, segue em sombra". Preencher
 * `ajuste` com o número do `aprovar` seria inventar medição.
 */
export async function carregarAcuraciaMedida(): Promise<AcuraciaMedida | null> {
  try {
    const medicoes = await getMedicoesRetroativas();
    if (medicoes.length === 0) return null;
    const cal = await carregarCalibragem();
    // Soma as faixas: a política pergunta pelo veredito, não pela faixa de confiança.
    let acerto = 0;
    let comparaveis = 0;
    let erro_grave = 0;
    for (const faixa of Object.values(cal)) {
      acerto += faixa.acerto;
      comparaveis += faixa.comparaveis;
      erro_grave += faixa.erro_grave;
    }
    if (comparaveis === 0) return null;
    return { aprovar: { acerto: acerto / comparaveis, erro_grave, n: comparaveis } };
  } catch (e) {
    console.error('[calibragem] falha ao ler a acurácia medida (segue em sombra):', e);
    return null;
  }
}
