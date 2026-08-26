/**
 * Auto-atualização de listagem de admin — o botão "Atualizar" deixa de ser obrigatório.
 *
 * Usado pela aba de aprovação de pendentes (`/aprovacoes-pendentes`), que é uma tela de
 * PLANTÃO: a pessoa deixa aberta enquanto valida, e a fila muda por baixo (submissão nova,
 * parecer de líder, outro admin decidindo). Sem isto, a única forma de ver a fila de verdade
 * era clicar "Atualizar" — e quem esquece decide sobre lista velha.
 *
 * ## Por que 15 s é barato aqui (medido em prod, 26/08/2026)
 * O endpoint (`/api/admin/aprovacao-pendentes`) lê o **espelho da planilha no SQLite**, nunca
 * o Google Sheets em request — então o poll **não consome a cota de 60 leituras/min**, que é
 * compartilhada com produção. Medição: ~1,3 s e ~24 KB por chamada, 4 chamadas/min por aba
 * aberta. É o mesmo tipo de leitura que a triagem já faz a cada load de página.
 *
 * ## As 3 regras que evitam que "atualizar sozinho" quebre a tela
 * 1. **Nunca empilhar requisição** (`emVoo`): a rodada leva ~1,3 s, mas pode levar mais que o
 *    intervalo. Sem o guard as chamadas se acumulam sobre um endpoint já lento — foi o que
 *    derrubou `/investigador` (polling de 8 s, ver `SPEC_CORRECOES.md`).
 * 2. **Nunca atualizar por baixo de quem está decidindo** (`interagindo`): com a ficha ou o
 *    painel de divisão aberto, ou com uma gravação em curso, a lista fica parada. O próximo
 *    tique depois de fechar já traz o dado novo.
 * 3. **Aba em segundo plano não gasta chamada** (`abaVisivel`), e voltar para a aba atualiza
 *    NA HORA — é o momento em que a lista velha engana. Mesmo padrão do `AtualizacaoBanner`.
 */
import { useEffect, useRef } from "react";

/** Cadência do poll. 15 s = pedido do produto ("o botão tem de ser quase desnecessário"). */
export const INTERVALO_AUTO_ATUALIZAR_MS = 15_000;

export type EstadoAutoAtualizar = {
  /** `document.visibilityState === 'visible'`. */
  abaVisivel: boolean;
  /** Já existe uma rodada de atualização correndo. */
  emVoo: boolean;
  /** A primeira carga da tela ainda não terminou (nada a atualizar ainda). */
  carregandoPrimeiraVez: boolean;
  /** Ficha/painel aberto ou gravação em curso — a pessoa está no meio de uma decisão. */
  interagindo: boolean;
};

/**
 * Por que este tique NÃO deve rodar (ou `null` para "pode atualizar").
 *
 * Função PURA de propósito: é a regra que decide se a tela dispara uma requisição, e ela
 * precisa de teste em `environment: 'node'` (o projeto não renderiza React em teste).
 */
export function motivoParaPular(estado: EstadoAutoAtualizar): string | null {
  if (!estado.abaVisivel) return "aba em segundo plano";
  if (estado.carregandoPrimeiraVez) return "primeira carga em andamento";
  if (estado.emVoo) return "atualização anterior ainda em voo";
  if (estado.interagindo) return "ficha/painel aberto ou gravação em curso";
  return null;
}

/** `true` quando o tique pode disparar a atualização. Açúcar sobre `motivoParaPular`. */
export function podeAutoAtualizar(estado: EstadoAutoAtualizar): boolean {
  return motivoParaPular(estado) === null;
}

/**
 * Dispara `atualizar()` a cada `intervaloMs` enquanto a aba estiver visível, e uma vez a mais
 * assim que a pessoa volta para a aba.
 *
 * `estado` é lido por REF dentro do tique: passar as flags como dependência recriaria o
 * intervalo a cada abertura de ficha e o relógio nunca fecharia um ciclo. O `atualizar`
 * também vai por ref, para o hook aceitar uma função nova a cada render sem reiniciar nada.
 */
export function useAutoAtualizar(
  atualizar: () => void | Promise<void>,
  /** Sem `abaVisivel`: quem lê o `document.visibilityState` é o hook, no instante do tique. */
  estado: Omit<EstadoAutoAtualizar, "abaVisivel">,
  intervaloMs: number = INTERVALO_AUTO_ATUALIZAR_MS,
): void {
  const atualizarRef = useRef(atualizar);
  atualizarRef.current = atualizar;
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    const tique = () => {
      const visivel = typeof document === "undefined" || document.visibilityState === "visible";
      if (!podeAutoAtualizar({ ...estadoRef.current, abaVisivel: visivel })) return;
      void atualizarRef.current();
    };
    const id = window.setInterval(tique, intervaloMs);
    // Voltar para a aba é quando a lista velha mais engana — atualiza na hora, sem esperar
    // o tique. O `podeAutoAtualizar` de dentro do `tique` continua valendo aqui.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") tique();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [intervaloMs]);
}
