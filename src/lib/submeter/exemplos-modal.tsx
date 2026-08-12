/* ──────────────────────────────────────────────
   Ajuda de campo (formulário de saving)
   ─────────────────────────────────────────────

   Alguns campos do formulário são conceitualmente escorregadios: a pessoa acabou de
   cadastrar o gasto que a empresa deixou de pagar e, no campo seguinte, é perguntada se
   AINDA há um trabalho manual adicional que aquele gasto não cobria. Sem ajuda, o "sim"
   vira dupla contagem.

   `ExemplosCampoAjuda` é o par trigger + popup: um botão discreto abaixo do texto de
   ajuda do campo abre um modal centralizado (fundo embaçado) com uma LISTA CURTA de
   sinais — "não é esse caso se…" seguido de "é esse caso se…" —, cada linha marcada com
   ✕ ou ✓. Sem exemplos longos: a pessoa lê 6 frases e sabe responder.

   Genérico de propósito: outros campos confusos podem reusar passando a própria lista. */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, HelpCircle, X } from "lucide-react";

const OLIVA = "#6b6e00";
const VERMELHO = "#c53030";

export type SinalCampo = {
  /** true = é esse caso (responda Sim); false = não é esse caso. */
  vale: boolean;
  /** A frase principal, em linguagem de quem preenche o formulário. */
  texto: string;
  /** Complemento curto: o porquê ou o que fazer em vez disso. */
  detalhe?: string;
};

/* Sinais do campo 2c ("há trabalho manual ADICIONAL que o gasto eliminado não cobria?").
   Os 3 primeiros são os 3 erros reais: mesmo escopo do gasto · horas que ALGUÉM já fazia
   (é o outro ramo do formulário) · trabalho que nasceu com a automação. */
export const SINAIS_TRABALHO_ADICIONAL: SinalCampo[] = [
  {
    vale: false,
    texto: "A automação faz o mesmo trabalho que o serviço cancelado já fazia.",
    detalhe: "Esse ganho já está no valor do gasto que você cadastrou — contar de novo dobraria.",
  },
  {
    vale: false,
    texto: "Alguém da empresa já gastava horas nisso antes da automação.",
    detalhe: "Volte na pergunta “Alguém já fazia ou mantinha isso manualmente antes?” e responda Sim.",
  },
  {
    vale: false,
    texto: "É o tempo que o time passou a gastar acompanhando a automação.",
    detalhe: "Trabalho que nasceu com a automação é custo de operação, não ganho.",
  },
  {
    vale: true,
    texto: "A automação faz algo A MAIS, que o serviço cancelado nunca cobriu.",
  },
  {
    vale: true,
    texto: "Esse algo a mais ninguém fazia — simplesmente ficava sem ser feito.",
  },
  {
    vale: true,
    texto: "Você consegue dizer quantas horas por mês levaria se alguém fosse fazer à mão.",
  },
];

/* ──────────────────────────────────────────────
   Trigger + modal
   ────────────────────────────────────────────── */

export function ExemplosCampoAjuda({
  titulo,
  chamada,
  sinais,
  nota,
  rotulo = "Em dúvida? Veja como saber se é o seu caso",
}: {
  titulo: string;
  chamada: string;
  sinais: SinalCampo[];
  nota?: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function fechar() {
    setAberto(false);
    // Devolve o foco a quem abriu (quem navega por teclado não é jogado ao topo).
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        className="mb-2 inline-flex items-center gap-1.5 rounded-md text-[11.5px] font-semibold transition-opacity hover:opacity-75"
        style={{ color: "var(--go-blue)", textDecoration: "underline", textUnderlineOffset: 3 }}
      >
        <HelpCircle aria-hidden="true" style={{ width: 13, height: 13 }} />
        {rotulo}
      </button>

      {aberto && (
        <AjudaModal titulo={titulo} chamada={chamada} sinais={sinais} nota={nota} onClose={fechar} />
      )}
    </>
  );
}

function AjudaModal({
  titulo,
  chamada,
  sinais,
  nota,
  onClose,
}: {
  titulo: string;
  chamada: string;
  sinais: SinalCampo[];
  nota?: string;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  // Foco inicial no "Fechar" — o modal é só leitura, não há campo para preencher.
  useEffect(() => {
    if (montado) fecharRef.current?.focus();
  }, [montado]);

  // Esc fecha; Tab circula dentro do modal (trava simples de foco).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focaveis = cardRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Trava o scroll do fundo enquanto o modal está aberto.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  const conteudo = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{
        background: "rgba(8,20,40,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        animation: "go-slide-down 0.18s ease",
      }}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ajuda-campo-titulo"
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl"
        style={{
          maxWidth: 580,
          background: "var(--go-white)",
          boxShadow: "0 24px 64px rgba(8,20,40,0.35)",
          animation: "go-pop-in 0.22s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 sm:px-6">
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(0,89,169,0.1)", color: "var(--go-blue)" }}
            >
              <HelpCircle aria-hidden="true" style={{ width: 18, height: 18 }} />
            </span>
            <h2
              id="ajuda-campo-titulo"
              className="min-w-0 font-extrabold leading-tight"
              style={{ color: "var(--go-text-heading)", fontSize: 15.5 }}
            >
              {titulo}
            </h2>
          </div>
          <button
            ref={fecharRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar a ajuda"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all hover:opacity-80"
            style={{ background: "rgba(0,0,0,0.05)", color: "#5b5b6a" }}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Corpo — a chamada + a lista de sinais */}
        <div
          className="flex-1 overflow-y-auto px-5 py-4 sm:px-6"
          style={{ background: "var(--go-cream)", borderTop: "1px solid rgba(8,20,40,0.07)" }}
        >
          <p className="mb-3 text-[12.5px] leading-snug" style={{ color: "#5b5b6a" }}>
            {chamada}
          </p>
          <ul className="space-y-2">
            {sinais.map((s, i) => (
              <LinhaSinal key={i} sinal={s} />
            ))}
          </ul>
          {nota && (
            <p className="mt-3.5 text-[11.5px] leading-snug" style={{ color: "#8b8b9a" }}>
              {nota}
            </p>
          )}
        </div>

        {/* Rodapé */}
        <div
          className="flex justify-end px-5 py-2.5 sm:px-6"
          style={{ borderTop: "1px solid rgba(8,20,40,0.07)", background: "var(--go-white)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-[12.5px] font-semibold transition-all hover:opacity-90"
            style={{ background: "var(--go-blue)", color: "#fff" }}
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );

  return montado ? createPortal(conteudo, document.body) : null;
}

function LinhaSinal({ sinal }: { sinal: SinalCampo }) {
  const cor = sinal.vale ? OLIVA : VERMELHO;

  return (
    <li
      className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--go-white)",
        border: "1px solid rgba(8,20,40,0.08)",
        borderLeft: `3px solid ${cor}`,
      }}
    >
      {/* O sinal nunca é só cor: o ícone diz ✓ ou ✕, e tem rótulo para leitor de tela. */}
      <span
        className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
        style={{ background: sinal.vale ? "rgba(107,110,0,0.12)" : "rgba(197,48,48,0.1)", color: cor }}
      >
        {sinal.vale ? (
          <Check aria-hidden="true" style={{ width: 12, height: 12, strokeWidth: 3 }} />
        ) : (
          <X aria-hidden="true" style={{ width: 12, height: 12, strokeWidth: 3 }} />
        )}
      </span>
      <span className="min-w-0">
        <span className="sr-only">{sinal.vale ? "É esse caso: " : "Não é esse caso: "}</span>
        <span
          className="block text-[12.5px] font-semibold leading-snug"
          style={{ color: "var(--go-text-heading)" }}
        >
          {sinal.texto}
        </span>
        {sinal.detalhe && (
          <span className="mt-0.5 block text-[11.5px] leading-snug" style={{ color: "#6b6b7a" }}>
            {sinal.detalhe}
          </span>
        )}
      </span>
    </li>
  );
}
