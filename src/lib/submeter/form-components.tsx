import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { EMAIL_RE, ALLOWED_DOMAINS_RE, PAPEIS_PARTICIPANTE } from "./constants";
import type { PapelParticipante } from "./constants";
import { filtrarSugestoes, type SugestaoParticipante } from "./participantes-sugestoes";

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
            >
              <input
                type="checkbox"
                value={opt.value}
                checked={checked}
                onChange={() => toggle(opt.value)}
                className="absolute opacity-0"
              />
              {checked && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    right: 8,
                    display: "inline-flex",
                    alignItems: "center",
                    color: "var(--go-blue)",
                    animation: "go-step-in 0.2s ease",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
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

// Realce do trecho buscado dentro de nome/e-mail da sugestão. Compara sem
// acento/caixa; se a normalização mudar o tamanho da string (caso raro), volta
// ao texto puro em vez de marcar no lugar errado.
function Realce({ texto, termos }: { texto: string; termos: string[] }) {
  const nbase = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (nbase.length !== texto.length || termos.length === 0) return <>{texto}</>;
  const marcado = new Array<boolean>(texto.length).fill(false);
  for (const t of termos) {
    if (!t) continue;
    let i = 0;
    while ((i = nbase.indexOf(t, i)) !== -1) {
      for (let k = i; k < i + t.length; k++) marcado[k] = true;
      i += t.length;
    }
  }
  const partes: React.ReactNode[] = [];
  let inicio = 0;
  for (let i = 1; i <= texto.length; i++) {
    if (i === texto.length || marcado[i] !== marcado[inicio]) {
      const trecho = texto.slice(inicio, i);
      partes.push(marcado[inicio] ? <strong key={inicio} className="font-bold">{trecho}</strong> : trecho);
      inicio = i;
    }
  }
  return <>{partes}</>;
}

// Máximo de sugestões renderizadas de uma vez (a lista rola; o resto refina digitando).
const MAX_SUGESTOES = 80;

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

// Cor suplementar por papel. a11y: o RÓTULO em texto é sempre o sinal primário do
// estado; a cor apenas reforça — nunca é o único indicador.
const COR_PAPEL: Record<PapelParticipante, string> = {
  coexecutor: "#0059A9",        // --go-blue (executor "mão na massa")
  planejador: "#0E7490",        // cyan-700
  idealizador: "#8A7D00",       // âmbar (mesma família do lime já usado no form)
  referencia_tecnica: "#6D28D9", // violet-700
};

// Participantes do time + o PAPEL obrigatório de cada um. Uma linha por pessoa:
// e-mail à esquerda, seletor de papel à direita. O papel começa vazio e é
// obrigatório — o gate de avançar da Etapa 1 bloqueia enquanto faltar. O autor/
// submissor NÃO entra aqui: ele é o dono, só o time adicionado ganha papel.
export function ParticipantesPapeisInput({
  participantes, papeis, onAdd, onRemove, onSetPapel, error, suggestions,
}: {
  participantes: string[];
  papeis: Record<string, PapelParticipante | "">;
  onAdd: (email: string) => boolean;
  onRemove: (email: string) => void;
  onSetPapel: (email: string, papel: PapelParticipante) => void;
  error?: string;
  suggestions?: SugestaoParticipante[];
}) {
  const [inputValue, setInputValue] = useState("");
  const [tipMessage, setTipMessage] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false); // Esc fecha até a próxima digitação
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Autocomplete: filtra a lista da TeamGuide a cada letra (nome ou e-mail,
  // sem acento/caixa); sem lista carregada, o campo funciona como sempre.
  const termos = inputValue.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
  const filtradas = filtrarSugestoes(suggestions ?? [], inputValue, participantes);
  const visiveis = filtradas.slice(0, MAX_SUGESTOES);
  const open = focused && !dismissed && inputValue.trim().length > 0 && (suggestions?.length ?? 0) > 0;

  // Mantém a opção ativa à vista quando a navegação por teclado rola a lista.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-ativa="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

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

  function escolherSugestao(email: string) {
    setTipMessage(null);
    if (onAdd(email)) {
      setInputValue("");
      setActiveIndex(0);
    }
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (open && visiveis.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % visiveis.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + visiveis.length) % visiveis.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        escolherSugestao(visiveis[Math.min(activeIndex, visiveis.length - 1)].email);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    // Espaço só separa quando o texto já é um e-mail completo — digitar um NOME
    // ("maria souza") precisa do espaço para continuar filtrando as sugestões.
    const separadores = EMAIL_RE.test(inputValue.trim())
      ? ["Enter", " ", ",", ";", "Tab"]
      : ["Enter", ",", ";", "Tab"];
    if (separadores.includes(e.key)) {
      const val = inputValue.trim();
      if (val) { e.preventDefault(); tryAdd(val); }
      else if (e.key === "Enter") e.preventDefault();
    } else if (e.key === "Backspace" && inputValue === "" && participantes.length > 0) {
      onRemove(participantes[participantes.length - 1]);
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

  const semPapel = participantes.filter((p) => !papeis[p]).length;

  return (
    <>
      {/* Adicionar e-mail (mesmo visual do ChipsInput) + autocomplete da TeamGuide */}
      <div className="relative">
        <div
          className="flex min-h-[42px] items-center rounded-lg px-2 py-1 transition-colors cursor-text"
          style={{ background: "var(--go-white)", border: "1.5px solid rgba(215, 219, 0, 0.35)" }}
          onClick={() => inputRef.current?.focus()}
        >
          <input
            ref={inputRef}
            type="text"
            // O autofill do navegador (sugestões de e-mail do Chrome) abre por cima
            // do nosso dropdown de sugestões — desligado; a lista vem da TeamGuide.
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-controls="participantes-sugestoes"
            aria-autocomplete="list"
            aria-activedescendant={open && visiveis.length > 0 ? `participante-sugestao-${activeIndex}` : undefined}
            className="min-w-[160px] flex-1 border-none bg-transparent px-1 py-1 text-sm outline-none"
            style={{ fontFamily: "'Poppins', sans-serif", color: "var(--go-text-primary)" }}
            placeholder="Digite um nome ou e-mail…"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setTipMessage(null);
              setDismissed(false);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (inputValue.trim()) tryAdd(inputValue.trim());
            }}
            aria-label="E-mail do participante"
          />
        </div>

        {open && (
          <div
            className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg"
            style={{
              background: "var(--go-white)",
              border: "1.5px solid rgba(0,89,169,0.15)",
              boxShadow: "0 8px 24px rgba(0,89,169,0.12)",
              animation: "go-slide-down 0.15s ease",
            }}
          >
            {visiveis.length > 0 ? (
              <>
                <ul
                  ref={listRef}
                  id="participantes-sugestoes"
                  role="listbox"
                  aria-label="Sugestões de participantes"
                  className="max-h-60 overflow-y-auto py-1"
                >
                  {visiveis.map((p, i) => {
                    const ativa = i === activeIndex;
                    return (
                      <li
                        key={p.email}
                        id={`participante-sugestao-${i}`}
                        role="option"
                        aria-selected={ativa}
                        data-ativa={ativa || undefined}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5"
                        style={{
                          background: ativa ? "rgba(0,89,169,0.08)" : "transparent",
                          borderLeft: ativa ? "3px solid var(--go-lime)" : "3px solid transparent",
                        }}
                        // onMouseDown (não onClick): dispara ANTES do blur do input,
                        // senão o blur tenta adicionar o texto parcial digitado.
                        onMouseDown={(e) => { e.preventDefault(); escolherSugestao(p.email); }}
                        onMouseMove={() => { if (!ativa) setActiveIndex(i); }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold" style={{ color: "var(--go-text-primary)" }}>
                            <Realce texto={p.nome} termos={termos} />
                            {p.cargo && (
                              <span className="ml-1.5 text-[11px] font-normal" style={{ color: "#8b8b9a" }}>
                                · {p.cargo}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[11px]" style={{ color: "var(--go-blue)" }}>
                            <Realce texto={p.email} termos={termos} />
                          </span>
                        </span>
                        {ativa && (
                          <span
                            aria-hidden="true"
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                          >
                            ↵ Enter
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {filtradas.length > MAX_SUGESTOES && (
                  <p className="border-t px-3 py-1.5 text-[10px]" style={{ color: "#8b8b9a", borderColor: "rgba(0,89,169,0.08)" }}>
                    Mostrando {MAX_SUGESTOES} de {filtradas.length} — continue digitando para refinar.
                  </p>
                )}
              </>
            ) : (
              <p className="px-3 py-2.5 text-[11px]" style={{ color: "#8b8b9a" }}>
                Ninguém encontrado na Team Guide — digite o e-mail completo e pressione Enter para adicionar.
              </p>
            )}
          </div>
        )}
      </div>

      {tipMessage && (
        <p className="mt-1 text-[11px] font-semibold" style={{ color: "#dc2626", animation: "go-slide-down 0.2s ease" }}>
          {tipMessage}
        </p>
      )}

      {/* Uma linha por participante = e-mail + papel obrigatório */}
      {participantes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {participantes.map((email) => {
            const papel = papeis[email] || "";
            const faltando = !papel && !!error; // realça só depois de validar (avançar)
            return (
              <li
                key={email}
                className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg px-2.5 py-2"
                style={{
                  background: "rgba(0,89,169,0.03)",
                  border: `1px solid ${faltando ? "rgba(220,38,38,0.4)" : "rgba(0,89,169,0.1)"}`,
                  animation: "go-chip-in 0.15s ease",
                }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]"
                  style={{ background: "rgba(0,89,169,0.08)" }}
                >
                  👤
                </span>
                <span
                  className="min-w-[120px] flex-1 truncate text-[12.5px] font-medium"
                  style={{ color: "var(--go-text-heading)" }}
                  title={email}
                >
                  {email}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {papel && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: COR_PAPEL[papel as PapelParticipante] }}
                    />
                  )}
                  <select
                    aria-label={`Papel de ${email}`}
                    value={papel}
                    onChange={(e) => onSetPapel(email, e.target.value as PapelParticipante)}
                    className="go-select !mt-0 !w-auto !max-w-[190px] !rounded-md !py-1.5 !pl-2.5 !pr-8 !text-[12px]"
                    style={faltando ? { borderColor: "#dc2626" } : undefined}
                  >
                    <option value="" disabled>Selecione o papel</option>
                    {PAPEIS_PARTICIPANTE.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemove(email)}
                    aria-label={`Remover ${email}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0059A9]"
                    style={{ background: "rgba(0,89,169,0.06)", color: "var(--go-blue)" }}
                  >
                    &times;
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Direção quando falta papel (âmbar). Some quando o erro vermelho aparece
          (avançar bloqueado) para não duplicar mensagem. */}
      {participantes.length > 0 && semPapel > 0 && !error && (
        <p className="mt-1.5 text-[11px] font-semibold" style={{ color: "#8a7d00" }}>
          {semPapel === 1 ? "1 participante sem papel" : `${semPapel} participantes sem papel`} — escolha o papel de cada pessoa.
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
