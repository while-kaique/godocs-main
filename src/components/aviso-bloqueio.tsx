import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { BloqueioSubmissao } from "@/lib/mensagens-submissao";

/**
 * Painel de BLOQUEIO DE ENVIO — irmão do `AvisoPendencia`, mesmo grammar visual (barra de
 * acento de 3px, tinta suave, placa branca para o conteúdo, medida travada em `ch`), com três
 * divergências deliberadas:
 *
 * 1. **Âmbar, não vermelho.** O que barra aqui é o preenchimento da própria pessoa (custo
 *    digitado como mensal em vez de anual, memorial não concluído, nome repetido). Vermelho
 *    dizia "o sistema quebrou" e a pessoa reenviava igual — o caso SmartOnline/DIFAL foram 6
 *    tentativas em 25 minutos. Vermelho fica reservado para falha de verdade (rede, 5xx, LLM).
 * 2. **Painel PERSISTENTE, não toast.** O texto vivia num toast de 20s de ~360px de largura:
 *    o bloqueio mais importante do produto no canal mais frágil. Aqui ele fica ancorado ao
 *    botão que falhou, e pode ser reconsultado enquanto a pessoa corrige.
 * 3. **Nasce ABERTO.** O `AvisoPendencia` nasce fechado porque é uma lista para escanear; este
 *    é a resposta a um clique que a pessoa acabou de dar — esconder a correção atrás de um
 *    "ver mais" seria devolver o problema. O botão serve para RECOLHER depois de ler.
 *
 * ⚠️ Os caminhos são ALTERNATIVAS — marcador, nunca "(1) (2) (3)" (o texto antigo numerava e
 * fazia parecer que era preciso cumprir os três). ⚠️ Texto NENHUM mora aqui: tudo vem do
 * `BloqueioSubmissao` (fonte única `src/lib/mensagens-submissao.ts`).
 */

// Medida legível: o painel ocupa a largura do card em desktop e o texto corrido passaria de
// 120 caracteres por linha.
const MEDIDA = "72ch";

const TINTA = {
  bar: "#f59e0b",
  bg: "rgba(245,158,11,0.08)",
  titulo: "#78350f",
  rotulo: "#b45309",
  corpo: "#78350f",
  secundario: "#92400e",
  placaBorda: "rgba(180,83,9,0.18)",
};

export function AvisoBloqueio({ bloqueio }: { bloqueio: BloqueioSubmissao }) {
  const [aberto, setAberto] = useState(true);
  const varios = bloqueio.caminhos.length > 1;

  return (
    <section
      // `alert` + `assertive`: o painel aparece em resposta a um clique e é a única explicação
      // de por que o envio não aconteceu — leitor de tela não pode perdê-lo.
      role="alert"
      aria-live="assertive"
      className="mt-4 overflow-hidden rounded-lg"
      style={{ background: TINTA.bg, borderLeft: `3px solid ${TINTA.bar}` }}
    >
      <div className="px-3.5 pt-2.5 pb-1" style={{ maxWidth: MEDIDA }}>
        {/* Estado nunca só por cor: ícone + rótulo escrito do que aconteceu. */}
        <p
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase"
          style={{ color: TINTA.rotulo, letterSpacing: "0.08em" }}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Envio pausado
        </p>
        <h3
          className="mt-1 text-[13.5px] font-bold"
          style={{ color: TINTA.titulo, lineHeight: 1.35 }}
        >
          {bloqueio.titulo}
        </h3>
        <p className="mt-1 text-[12.5px]" style={{ color: TINTA.corpo, lineHeight: 1.55 }}>
          {bloqueio.resumo}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-1.5 px-3.5 pb-2 pt-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)] focus-visible:ring-inset"
      >
        <span
          className="text-[11px] font-semibold underline decoration-dotted underline-offset-2"
          style={{ color: TINTA.rotulo }}
        >
          {aberto
            ? "Ocultar o que corrigir"
            : varios
              ? `Ver os ${bloqueio.caminhos.length} caminhos para corrigir`
              : "Ver o que corrigir"}
        </span>
        <ChevronDown
          className="h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none"
          style={{ color: TINTA.rotulo, transform: aberto ? "rotate(180deg)" : undefined }}
          aria-hidden
        />
      </button>

      {aberto && (
        <div className="px-3.5 pb-3" style={{ maxWidth: MEDIDA }}>
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: "var(--go-white)", border: `1px solid ${TINTA.placaBorda}` }}
          >
            <p
              className="text-[10px] font-bold uppercase"
              style={{ color: TINTA.rotulo, letterSpacing: "0.08em" }}
            >
              {/* Nomeia a natureza da lista: são alternativas, e a pessoa escolhe UMA. */}
              {varios ? "Escolha um caminho" : "Para corrigir"}
            </p>
            <ul className="mt-1.5 space-y-2">
              {bloqueio.caminhos.map((c) => (
                <li key={c.rotulo} className="flex gap-2">
                  <span
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: TINTA.bar }}
                    aria-hidden
                  />
                  <div>
                    <p
                      className="text-[12.5px] font-bold"
                      style={{ color: TINTA.titulo, lineHeight: 1.4 }}
                    >
                      {c.rotulo}
                    </p>
                    <p
                      className="mt-0.5 text-[12px]"
                      style={{ color: TINTA.secundario, lineHeight: 1.55 }}
                    >
                      {c.detalhe}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
