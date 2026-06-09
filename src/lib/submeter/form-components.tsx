import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { EMAIL_RE, ALLOWED_DOMAINS_RE } from "./constants";

export function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div
      className="mb-5 flex items-center gap-2.5 border-b pb-2.5 text-[13px] font-bold uppercase tracking-[0.05em]"
      style={{ color: "var(--go-text-heading)", borderColor: "rgba(0,89,169,0.1)" }}
    >
      <div
        className="flex h-7 w-7 items-center justify-center text-sm"
        style={{ background: "rgba(0,89,169,0.07)", borderRadius: "var(--go-radius-sm)" }}
      >
        {icon}
      </div>
      {children}
    </div>
  );
}

export function FormGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-[18px]", className)}>{children}</div>;
}

export function FormLabel({ children, required, hint }: { children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <label className="mb-1.5 block text-[13px] font-semibold" style={{ color: "var(--go-text-primary)" }}>
      {children}
      {required && <span className="ml-0.5" style={{ color: "#dc2626" }}>*</span>}
      {hint && (
        <span className="mt-0.5 block text-[11px] font-normal" style={{ color: "#8b8b9a" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function FormInput({ error, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <>
      <input className={cn("go-input", error && "go-input-invalid", className)} {...props} />
      <FieldError message={error} />
    </>
  );
}

export function FormSelect({ error, children, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <>
      <select className={cn("go-select", error && "go-input-invalid", className)} {...props}>
        {children}
      </select>
      <FieldError message={error} />
    </>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      className="mt-1 text-[11px] font-semibold"
      style={{ color: "#dc2626", animation: "go-slide-down 0.2s ease" }}
    >
      {message}
    </p>
  );
}

export function RadioGroup({
  name, options, value, onChange, error, vertical,
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
  vertical?: boolean;
}) {
  return (
    <>
      <div className={cn("flex gap-2.5", vertical && "flex-col gap-2")}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "go-radio-label",
              value === opt.value && "go-radio-checked",
              vertical && "justify-start px-3.5 py-3"
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={(e) => onChange(e.target.value)}
              className="absolute opacity-0"
            />
            {opt.label}
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </>
  );
}

export function CheckboxGroup({
  options, value, onChange, error,
}: {
  options: { value: string; label: string; description?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
}) {
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <>
      <div className="flex gap-2.5">
        {options.map((opt) => {
          const checked = value.includes(opt.value);
          return (
            <label
              key={opt.value}
              className={cn("go-radio-label flex-1 cursor-pointer select-none", checked && "go-radio-checked")}
              style={checked ? undefined : undefined}
            >
              <input
                type="checkbox"
                value={opt.value}
                checked={checked}
                onChange={() => toggle(opt.value)}
                className="absolute opacity-0"
              />
              <span>{opt.label}</span>
              {opt.description && (
                <span className="ml-1 text-[10px] font-normal opacity-70">{opt.description}</span>
              )}
            </label>
          );
        })}
      </div>
      <FieldError message={error} />
    </>
  );
}

export function InfoTooltip({ children }: { children: React.ReactNode }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ bottom: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  function show() {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setCoords({
        bottom: window.innerHeight - rect.top + 10,
        left: rect.left + rect.width / 2,
      });
    }
    setVisible(true);
  }

  const tooltip = mounted && visible
    ? createPortal(
        <div
          style={{
            position: "fixed",
            bottom: coords.bottom,
            left: coords.left,
            transform: "translateX(-50%)",
            zIndex: 9999,
            width: 300,
            maxWidth: "90vw",
            padding: "12px 14px",
            background: "var(--go-blue)",
            borderRadius: "var(--go-radius-sm)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 12,
            fontFamily: "'Poppins', sans-serif",
            lineHeight: 1.55,
            textAlign: "left",
            boxShadow: "0 8px 24px rgba(0,89,169,0.3)",
            pointerEvents: "none",
          }}
        >
          {children}
          <span
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              border: "5px solid transparent",
              borderTopColor: "var(--go-blue)",
            }}
          />
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <span
        ref={iconRef}
        className="go-info-icon"
        tabIndex={0}
        role="button"
        aria-label="Mais informações"
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={() => setVisible(false)}
        onBlur={() => setVisible(false)}
      >
        i
      </span>
      {tooltip}
    </>
  );
}

export function ChipsInput({
  chips, onAdd, onRemove, error,
}: {
  chips: string[];
  onAdd: (email: string) => boolean;
  onRemove: (email: string) => void;
  error?: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const [tipMessage, setTipMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function tryAdd(raw: string) {
    const val = raw.trim().replace(/[,;]+$/, "").trim();
    if (!val) return;
    if (!EMAIL_RE.test(val)) {
      setTipMessage("Insira um e-mail válido (ex: nome@gocase.com.br)");
      return;
    }
    if (!ALLOWED_DOMAINS_RE.test(val)) {
      setTipMessage("Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos");
      return;
    }
    setTipMessage(null);
    if (onAdd(val)) setInputValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (["Enter", " ", ",", ";", "Tab"].includes(e.key)) {
      const val = inputValue.trim();
      if (val) { e.preventDefault(); tryAdd(val); }
      else if (e.key === "Enter") e.preventDefault();
    } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
      onRemove(chips[chips.length - 1]);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text");
    if (text && /[,;\s]/.test(text)) {
      e.preventDefault();
      text.split(/[,;\s]+/).forEach((p) => { if (p.trim()) tryAdd(p); });
      setInputValue("");
    }
  }

  return (
    <>
      <div
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1 rounded-lg px-2 py-1 transition-colors cursor-text",
          error && "!border-[#dc2626] shadow-[0_0_0_3px_rgba(220,38,38,0.08)]"
        )}
        style={{ background: "var(--go-white)", border: "1.5px solid rgba(215, 219, 0, 0.35)" }}
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{
              background: "rgba(0,89,169,0.06)",
              border: "1px solid rgba(0,89,169,0.18)",
              color: "var(--go-blue)",
              animation: "go-chip-in 0.15s ease",
            }}
          >
            <span className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap">{chip}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(chip); }}
              className="flex h-[15px] w-[15px] items-center justify-center rounded-full text-xs transition-colors"
              style={{ background: "rgba(0,89,169,0.1)", border: "none", color: "inherit" }}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="min-w-[160px] flex-1 border-none bg-transparent px-1 py-1 text-sm outline-none"
          style={{ fontFamily: "'Poppins', sans-serif", color: "var(--go-text-primary)" }}
          placeholder="exemplo@gocase.com.br"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setTipMessage(null); }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => { if (inputValue.trim()) tryAdd(inputValue.trim()); }}
        />
      </div>
      {tipMessage && (
        <p className="mt-1 text-[11px] font-semibold" style={{ color: "#dc2626", animation: "go-slide-down 0.2s ease" }}>
          {tipMessage}
        </p>
      )}
      <FieldError message={error} />
    </>
  );
}

export function SummaryRow({
  label, value, highlight, badge, last,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  badge?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-2 text-[13px]"
      style={last ? undefined : { borderBottom: "1px solid rgba(0,89,169,0.06)" }}
    >
      <span style={{ color: "var(--go-text-primary)" }}>{label}</span>
      <span
        className="overflow-hidden text-ellipsis whitespace-nowrap text-right font-semibold"
        style={{ color: "var(--go-blue)" }}
      >
        {badge ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{
              background: "rgba(215,219,0,0.12)",
              border: "1px solid rgba(215,219,0,0.3)",
              color: "#8a7d00",
            }}
          >
            {value}
          </span>
        ) : highlight ? (
          <span className="font-bold" style={{ color: "#16a34a" }}>{value}</span>
        ) : (
          value || "—"
        )}
      </span>
    </div>
  );
}
