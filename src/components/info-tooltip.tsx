import { Info } from "lucide-react";
import { useId, useState } from "react";

/**
 * Tooltip discreto (ícone "i") para disclaimers curtos — ex.: "para transferir a
 * autoria, acione a equipe RPA". Sem dependência externa: abre no hover E no foco
 * (acessível por teclado), fecha no Escape. O texto é lido por leitores de tela via
 * aria-describedby. Mantém a tela limpa — só aparece sob demanda.
 */
export function InfoTooltip({
  text,
  label = "Mais informações",
}: {
  text: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors"
        style={{ color: "var(--go-blue)", opacity: 0.55 }}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-[calc(100%+6px)] z-20 w-56 -translate-x-1/2 rounded-lg px-3 py-2 text-[11px] font-medium leading-snug shadow-lg"
          style={{
            background: "var(--go-text-heading, #1a1a2e)",
            color: "var(--go-white, #fff)",
            fontFamily: "'Poppins', sans-serif",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
