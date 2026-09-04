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
  /** Re-tentativas por ESPERA (fila), que não mexem na concorrência. */
  esperas: number;
  /** Por que cada recuo aconteceu — sem isto, "recuei 23 vezes" é dedução, não medida. */
  motivos: string[];
};

/** 502/503/504/429 e timeout: o gateway não respondeu. 4xx de verdade não entra aqui. */
/**
 * Erro de CREDENCIAL disfarçado de erro de servidor.
 *
 * ⚠️ Medido na run 7: o proxy devolve `HTTP 500 {"error":"OpenAI error 401: Incorrect API key"}`
 * para uma fração das chamadas. Isso é chave quebrada, não gateway cheio — vai acontecer de
 * novo em qualquer concorrência, e recuar não ajuda em NADA. Como o meu classificador via só o
 * "500", cada uma dessas cortava a concorrência pela metade: eu caía de 16 para 4 nos primeiros
 * minutos e passava a rodada inteira lá embaixo, com 64 slots livres do outro lado.
 */
export function ehCredencial(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /401|Incorrect API key|invalid_api_key|Unauthorized/i.test(m);
}

export function ehSaturacao(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  if (ehCredencial(e)) return false; // credencial não é fila cheia
  return /HTTP (429|500|502|503|504)|ECONNRESET|fetch failed|socket hang up/i.test(m);
}

/**
 * ⚠️ TIMEOUT NÃO É SATURAÇÃO, e confundir os dois me fez rodar a noite inteira estrangulado.
 *
 * O ai-proxy aceita **concorrência 32 com fila de 150**. Numa fila, mandar mais requisições não
 * devolve 502: devolve ESPERA. Essa espera estourava o meu limite de 180s, o pool lia "o gateway
 * está saturado" e cortava a concorrência pela metade. Repetidamente — a run 5 teve 23 recuos e
 * terminou em 6; a run 6 passou 109 medições em 4. Com 32 disponíveis.
 *
 * Timeout agora só re-tenta o item, sem mexer na concorrência. Quem manda recuar é o gateway
 * dizendo não (502/503/429), não o relógio dizendo que a fila está andando devagar.
 */
export function ehEspera(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /timed out|timeout|aborted|AbortError/i.test(m);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rodarPoolAdaptativo<T>(o: OpcoesPool<T>): Promise<RelatorioPool> {
  const minimo = o.minimo ?? 4;
  const maximo = o.maximo ?? 64;
  const tentativas = o.tentativas ?? 3;
  let alvo = Math.min(maximo, Math.max(minimo, o.inicial ?? 16));

  // Sobe +2 a cada SUBIDA_APOS conclusões limpas, e só depois da carência do último recuo.
  // ⚠️ Sobe rápido, recua devagar. Chegar de 16 a 32 a +2 a cada 12 conclusões levava 96
  // conclusões — numa rodada de 648 isso é um sexto dela rodando abaixo do teto à toa. O risco
  // de subir rápido é baixo porque o recuo continua sendo pela metade, imediato.
  const SUBIDA_APOS = 5;
  const PASSO_SUBIDA = 4;
  const CARENCIA_MS = 8_000;

  const fila = o.itens.map((item) => ({ item, tentativa: 0 }));
  let ativos = 0;
  let feitos = 0;
  let limpasSeguidas = 0;
  let ultimoRecuoMs = 0;
  const rel: RelatorioPool = { alvoFinal: alvo, alvoMax: alvo, alvoMin: alvo, recuos: 0, reentradas: 0, esperas: 0, motivos: [] };

  function recuar(motivo?: string) {
    if (motivo && rel.motivos.length < 20) rel.motivos.push(motivo.slice(0, 90));
    const novo = Math.max(minimo, Math.floor(alvo / 2));
    if (novo < alvo) {
      // ⚠️ O motivo vai para o TERMINAL na hora, não só para o relatório do fim.
      //
      // Na run 8 a concorrência caiu de 32 para 4 no meio e não havia como saber por quê sem
      // esperar a rodada inteira terminar — uma hora de espera para descobrir se o gateway estava
      // saturado ou se era credencial. Já custou um diagnóstico errado nesta calibragem (um 401 do
      // fallback foi lido como saturação e derrubou a concorrência pela metade). Uma linha por
      // recuo é barato: são poucos, e é justamente quando algo está errado que se quer olhar.
      process.stderr.write(`\n   ↓ recuo ${alvo} -> ${novo}${motivo ? ` · ${motivo.slice(0, 90)}` : ""}\n`);
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
    alvo = Math.min(maximo, alvo + PASSO_SUBIDA);
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
        // Espera na fila re-tenta SEM recuar: encolher a concorrência por causa de fila só faz
        // a fila andar mais devagar.
        // Credencial entra junto da espera: re-tenta o item, não mexe na concorrência.
        const foiEspera = ehEspera(e) || ehCredencial(e);
        if ((ehSaturacao(e) || foiEspera) && t.tentativa + 1 < tentativas) {
          if (!foiEspera) recuar(e instanceof Error ? e.message : String(e));
          else rel.esperas++;
          rel.reentradas++;
          // Backoff com jitter: sem o jitter, os que caíram juntos voltam juntos e
          // ressaturam o gateway no mesmo instante.
          const espera = 1500 * 2 ** t.tentativa + Math.random() * 1000;
          ativos--;
          await dormir(espera);
          fila.push({ item: t.item, tentativa: t.tentativa + 1 });
          continue;
        }
        if (ehSaturacao(e)) recuar(e instanceof Error ? e.message : String(e));
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
