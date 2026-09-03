/**
 * Pool de concorrência ADAPTATIVA para as rodadas contra a API.
 *
 * ⚠️ Por que não um número fixo maior: o gargalo não é o nosso cliente, são os slots de Codex
 * do gateway — e eles são COMPARTILHADOS COM PRODUÇÃO. Um número fixo alto tem os dois defeitos
 * ao mesmo tempo: satura o gateway (502 vira "ninguém perguntou", não "nota baixa") e degrada o
 * produto vivo enquanto a rodada corre. Um número fixo baixo desperdiça a janela quando o
 * gateway está folgado.
 *
 * A régua daqui é o COMPORTAMENTO do gateway, não um palpite: sobe devagar enquanto tudo passa,
 * e CAI PELA METADE no primeiro sinal de saturação, com carência antes de tentar subir de novo.
 * Assim a rodada acha o teto que existe hoje em vez de assumir um, e recua sozinha quando o
 * gateway está ocupado com gente de verdade.
 *
 * ⚠️ Saturação ≠ erro. 502/503/429/timeout são "não deu para perguntar" e voltam para a fila com
 * backoff; 400/404 são resposta do servidor e NÃO derrubam a concorrência (recuar por causa de
 * um payload errado esconderia o bug e faria a rodada rastejar).
 */

export type OpcoesPool<T> = {
  itens: T[];
  /** Faz o trabalho de UM item. Lançar sinaliza falha; ver `ehSaturacao`. */
  tarefa: (item: T) => Promise<void>;
  inicial?: number;
  minimo?: number;
  maximo?: number;
  /** Tentativas por item ANTES de virar falha reportada (só para saturação). */
  tentativas?: number;
  aoProgredir?: (feitos: number, total: number, alvo: number) => void;
};

export type RelatorioPool = {
  /** Onde a concorrência terminou — é o teto que o gateway realmente aceitou hoje. */
  alvoFinal: number;
  alvoMax: number;
  alvoMin: number;
  recuos: number;
  reentradas: number;
};

/** 502/503/504/429 e timeout: o gateway não respondeu. 4xx de verdade não entra aqui. */
export function ehSaturacao(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /HTTP (429|500|502|503|504)|timed out|timeout|aborted|ECONNRESET|fetch failed|socket hang up/i.test(m);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rodarPoolAdaptativo<T>(o: OpcoesPool<T>): Promise<RelatorioPool> {
  const minimo = o.minimo ?? 4;
  const maximo = o.maximo ?? 64;
  const tentativas = o.tentativas ?? 3;
  let alvo = Math.min(maximo, Math.max(minimo, o.inicial ?? 16));

  // Sobe +2 a cada SUBIDA_APOS conclusões limpas, e só depois da carência do último recuo.
  const SUBIDA_APOS = 12;
  const CARENCIA_MS = 8_000;

  const fila = o.itens.map((item) => ({ item, tentativa: 0 }));
  let ativos = 0;
  let feitos = 0;
  let limpasSeguidas = 0;
  let ultimoRecuoMs = 0;
  const rel: RelatorioPool = { alvoFinal: alvo, alvoMax: alvo, alvoMin: alvo, recuos: 0, reentradas: 0 };

  function recuar() {
    const novo = Math.max(minimo, Math.floor(alvo / 2));
    if (novo < alvo) {
      alvo = novo;
      rel.recuos++;
      rel.alvoMin = Math.min(rel.alvoMin, alvo);
    }
    ultimoRecuoMs = Date.now();
    limpasSeguidas = 0;
  }

  function talvezSubir() {
    if (++limpasSeguidas < SUBIDA_APOS) return;
    limpasSeguidas = 0;
    if (Date.now() - ultimoRecuoMs < CARENCIA_MS) return;
    if (alvo >= maximo) return;
    alvo = Math.min(maximo, alvo + 2);
    rel.alvoMax = Math.max(rel.alvoMax, alvo);
  }

  async function trabalhador(): Promise<void> {
    for (;;) {
      // O portão é o `alvo` VIVO: encolher a concorrência não mata quem já está em voo,
      // apenas segura quem ia começar. É o que torna o recuo suave em vez de abortivo.
      while (ativos >= alvo) {
        if (fila.length === 0 && ativos === 0) return;
        await dormir(60);
      }
      const t = fila.shift();
      if (!t) return;
      ativos++;
      try {
        await o.tarefa(t.item);
        feitos++;
        talvezSubir();
      } catch (e) {
        if (ehSaturacao(e) && t.tentativa + 1 < tentativas) {
          recuar();
          rel.reentradas++;
          // Backoff com jitter: sem o jitter, os que caíram juntos voltam juntos e
          // ressaturam o gateway no mesmo instante.
          const espera = 1500 * 2 ** t.tentativa + Math.random() * 1000;
          ativos--;
          await dormir(espera);
          fila.push({ item: t.item, tentativa: t.tentativa + 1 });
          continue;
        }
        if (ehSaturacao(e)) recuar();
        feitos++; // o chamador já registrou a falha dele
      }
      // ⚠️ O caminho de re-tentativa acima decrementa e faz `continue` — se este `ativos--`
      // virasse `finally`, ele contaria duas vezes e a concorrência real cresceria sozinha.
      ativos--;
      o.aoProgredir?.(feitos, o.itens.length, alvo);
    }
  }

  await Promise.all(Array.from({ length: maximo }, () => trabalhador()));
  rel.alvoFinal = alvo;
  return rel;
}
