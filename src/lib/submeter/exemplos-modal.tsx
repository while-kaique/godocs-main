/* ──────────────────────────────────────────────
   Ajuda por exemplos (campo do formulário)
   ─────────────────────────────────────────────

   Alguns campos do formulário de saving são conceitualmente escorregadios:
   a pessoa acabou de marcar que a automação eliminou um gasto externo e, no
   campo seguinte, é perguntada se AINDA há um trabalho manual adicional que
   o contrato não cobria. Sem exemplos concretos, o "sim" vira dupla contagem.

   `ExemplosCampoAjuda` é o par trigger + popup: um botão discreto abaixo do
   texto de ajuda do campo que abre um modal centralizado (fundo embaçado) com
   casos que VALEM e casos que NÃO VALEM, no mesmo esqueleto de 3 linhas
   (contexto → custo eliminado → veredito), para dar pra comparar.

   Genérico de propósito: outros campos confusos podem reusar passando a
   própria lista de exemplos. */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, HelpCircle, X } from "lucide-react";

const OLIVA = "#6b6e00";
const VERMELHO = "#c53030";

export type ExemploCampo = {
  /** Situação em 1 frase — o que a automação faz. */
  contexto: string;
  /** O gasto externo que deixou de ser pago (com valor, para ancorar). */
  custoEliminado: string;
  /** true = conta como trabalho adicional; false = não conta. */
  vale: boolean;
  /** Por que vale / por que não vale. Veredito sem motivo não ensina nada. */
  motivo: string;
};

/* Exemplos do campo 2c ("há trabalho manual ADICIONAL que o contrato não
   cobria?"). Os 3 que NÃO valem cobrem os 3 erros reais: mesmo escopo do
   contrato (dupla contagem), horas que alguém JÁ fazia (é o outro ramo do
   formulário) e trabalho que nasceu com a automação (custo, não ganho). */
export const EXEMPLOS_TRABALHO_ADICIONAL: ExemploCampo[] = [
  {
    contexto:
      "O robô emite as notas de devolução e ainda cruza nota × pedido, gerando um relatório de divergências.",
    custoEliminado: "Escritório contábil terceirizado que só emitia as notas — R$ 3.200/mês.",
    vale: true,
    motivo:
      "A conferência de divergências nunca esteve no contrato e ninguém fazia. Se alguém fosse fazer à mão, seriam ~20h/mês.",
  },
  {
    contexto:
      "O bot do WhatsApp responde o cliente e também abre o ticket e atualiza o pedido no ERP.",
    custoEliminado: "Licença de chatbot que cobria apenas as perguntas frequentes — R$ 1.500/mês.",
    vale: true,
    motivo:
      "Abrir ticket e mexer no ERP estava fora do escopo da licença e ninguém fazia isso manualmente.",
  },
  {
    contexto:
      "O monitoramento de preço de concorrente passou de 3 para 9 marketplaces.",
    custoEliminado: "Ferramenta de monitoramento que cobria 3 marketplaces — R$ 2.000/mês.",
    vale: true,
    motivo:
      "Os 6 marketplaces novos ninguém acompanhava e a ferramenta não cobria — ~30h/mês se alguém fosse acompanhar.",
  },
  {
    contexto: "O robô emite as mesmas notas fiscais que o escritório emitia.",
    custoEliminado: "Escritório contábil terceirizado — R$ 3.200/mês.",
    vale: false,
    motivo:
      "É o mesmo trabalho que o contrato já fazia. Somar as duas coisas conta o mesmo ganho duas vezes.",
  },
  {
    contexto:
      "A automação monta o relatório mensal que uma analista montava em 5h/mês.",
    custoEliminado: "Licença do BI — R$ 900/mês.",
    vale: false,
    motivo:
      "Alguém fazia essas horas. Volte em “Alguém já fazia ou mantinha isso manualmente antes?” e responda Sim para lançar as horas reais.",
  },
  {
    contexto:
      "Depois do robô, o time passou a gastar 2h/mês olhando o painel e conferindo o log de erros.",
    custoEliminado: "Agência de cobrança — R$ 5.000/mês.",
    vale: false,
    motivo:
      "Trabalho que nasceu com a automação é custo de operação, não trabalho substituído.",
  },
];

/* ──────────────────────────────────────────────
   Trigger + modal
   ────────────────────────────────────────────── */

export function ExemplosCampoAjuda({
  titulo,
  descricao,
  exemplos,
  rotulo = "Em dúvida? Veja exemplos do que vale e do que não vale",
}: {
  titulo: string;
  descricao: string;
  exemplos: ExemploCampo[];
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

      {aberto && <ExemplosModal titulo={titulo} descricao={descricao} exemplos={exemplos} onClose={fechar} />}
    </>
  );
}

function ExemplosModal({
  titulo,
  descricao,
  exemplos,
  onClose,
}: {
  titulo: string;
  descricao: string;
  exemplos: ExemploCampo[];
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

  const valem = exemplos.filter((e) => e.vale);
  const naoValem = exemplos.filter((e) => !e.vale);

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
        aria-labelledby="exemplos-campo-titulo"
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl"
        style={{
          maxWidth: 900,
          background: "var(--go-white)",
          boxShadow: "0 24px 64px rgba(8,20,40,0.35)",
          animation: "go-pop-in 0.22s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(0,89,169,0.1)", color: "var(--go-blue)" }}
            >
              <HelpCircle aria-hidden="true" style={{ width: 18, height: 18 }} />
            </span>
            <div className="min-w-0">
              <h2
                id="exemplos-campo-titulo"
                className="font-extrabold leading-tight"
                style={{ color: "var(--go-text-heading)", fontSize: 15.5 }}
              >
                {titulo}
              </h2>
              <p className="mt-1 text-[12px] leading-snug" style={{ color: "#8b8b9a" }}>
                {descricao}
              </p>
            </div>
          </div>
          <button
            ref={fecharRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar os exemplos"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all hover:opacity-80"
            style={{ background: "rgba(0,0,0,0.05)", color: "#5b5b6a" }}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Corpo — duas colunas lado a lado (vale × não vale) para caber sem rolagem;
            em tela estreita as colunas empilham e o corpo volta a rolar. */}
        <div
          className="grid flex-1 gap-x-5 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2 sm:px-6"
          style={{ background: "var(--go-cream)", borderTop: "1px solid rgba(8,20,40,0.07)" }}
        >
          <GrupoExemplos titulo="Conta como trabalho adicional" vale exemplos={valem} />
          <GrupoExemplos titulo="Não conta" vale={false} exemplos={naoValem} />
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

function GrupoExemplos({
  titulo,
  vale,
  exemplos,
}: {
  titulo: string;
  vale: boolean;
  exemplos: ExemploCampo[];
}) {
  if (exemplos.length === 0) return null;
  const cor = vale ? OLIVA : VERMELHO;

  return (
    <section>
      <h3
        className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider"
        style={{ color: cor }}
      >
        <IconeVeredito vale={vale} />
        {titulo}
      </h3>
      <div className="space-y-2">
        {exemplos.map((ex, i) => (
          <CardExemplo key={i} exemplo={ex} />
        ))}
      </div>
    </section>
  );
}

function CardExemplo({ exemplo }: { exemplo: ExemploCampo }) {
  const cor = exemplo.vale ? OLIVA : VERMELHO;

  return (
    <article
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--go-white)",
        border: "1px solid rgba(8,20,40,0.08)",
        borderLeft: `3px solid ${cor}`,
      }}
    >
      <div className="space-y-1.5 px-3.5 py-2.5">
        <Linha rotulo="Contexto" texto={exemplo.contexto} />
        <Linha rotulo="Custo eliminado" texto={exemplo.custoEliminado} />
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-0.5">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
            style={{ background: exemplo.vale ? "rgba(107,110,0,0.12)" : "rgba(197,48,48,0.1)", color: cor }}
          >
            <IconeVeredito vale={exemplo.vale} />
            {exemplo.vale ? "Válido" : "Não vale"}
          </span>
          <span className="text-[11.5px] leading-snug" style={{ color: "#5b5b6a" }}>
            {exemplo.motivo}
          </span>
        </div>
      </div>
    </article>
  );
}

function Linha({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <div>
      <span
        className="block text-[9.5px] font-bold uppercase tracking-wider"
        style={{ color: "#9a9aa8" }}
      >
        {rotulo}
      </span>
      <span className="block text-[12px] leading-snug" style={{ color: "var(--go-text-heading)" }}>
        {texto}
      </span>
    </div>
  );
}

/* O veredito nunca é só cor: vem sempre com ícone + palavra (piso de a11y). */
function IconeVeredito({ vale }: { vale: boolean }) {
  return vale ? (
    <Check aria-hidden="true" style={{ width: 12, height: 12, strokeWidth: 3 }} />
  ) : (
    <X aria-hidden="true" style={{ width: 12, height: 12, strokeWidth: 3 }} />
  );
}
