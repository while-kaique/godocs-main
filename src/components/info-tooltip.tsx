import { Info } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BUBBLE_WIDTH = 224; // w-56

/**
 * Tooltip discreto (ícone "i") para disclaimers curtos — ex.: "para transferir a
 * autoria, acione a equipe RPA". Sem dependência externa: abre no hover E no foco
 * (acessível por teclado), fecha no Escape. O balão é renderizado num PORTAL com
 * `position: fixed` para não ser recortado por ancestrais com `overflow: hidden`
 * (os cards de "Meus Projetos" usam overflow-hidden) nem perder em z-index.
 */
export function InfoTooltip({
  text,
  label = "Mais informações",
}: {
  text: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const reposiciona = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const meio = r.left + r.width / 2;
    // Mantém o balão dentro da viewport (margem de 8px).
    const left = Math.min(
      Math.max(meio, 8 + BUBBLE_WIDTH / 2),
      window.innerWidth - 8 - BUBBLE_WIDTH / 2,
    );
    setPos({ top: r.bottom + 6, left });
  }, []);

  const abrir = useCallback(() => {
    reposiciona();
    setOpen(true);
  }, [reposiciona]);
  const fechar = useCallback(() => setOpen(false), []);

  // Recalcula a posição enquanto aberto (scroll/resize) e fecha no scroll de fora.
  useLayoutEffect(() => {
    if (!open) return;
    const onScroll = () => reposiciona();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, reposiciona]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={abrir}
        onMouseLeave={fechar}
        onFocus={abrir}
        onBlur={fechar}
        onClick={() => (open ? fechar() : abrir())}
        onKeyDown={(e) => e.key === "Escape" && fechar()}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors"
        style={{ color: "var(--go-blue)", opacity: 0.55 }}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[9999] -translate-x-1/2 rounded-lg px-3 py-2 text-[11px] font-medium leading-snug shadow-lg"
            style={{
              top: pos.top,
              left: pos.left,
              width: BUBBLE_WIDTH,
              background: "var(--go-text-heading, #1a1a2e)",
              color: "var(--go-white, #fff)",
              fontFamily: "'Poppins', sans-serif",
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
