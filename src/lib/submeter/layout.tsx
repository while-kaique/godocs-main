import React from "react";
import { cn } from "@/lib/utils";
import { STEPS } from "./constants";

export function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen p-2.5"
      style={{ background: "var(--go-blue)", fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{
          background: "var(--go-bg-page)",
          borderRadius: "var(--go-radius-xl)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="mb-8 text-center">
      <h1
        className="mb-2 font-extrabold leading-tight tracking-tight"
        style={{
          fontSize: "clamp(1.5rem, 3.5vw, 1.75rem)",
          color: "var(--go-text-heading)",
        }}
      >
        Triagem de Fluxos
      </h1>
      <div className="mb-4 inline-flex items-center justify-center">
        <span
          className="font-semibold uppercase"
          style={{
            fontSize: 11,
            letterSpacing: "0.15em",
            color: "var(--go-blue)",
            background: "var(--go-lime)",
            padding: "4px 14px",
            borderRadius: "var(--go-radius-pill)",
          }}
        >
          RPA & IA
        </span>
      </div>
      {subtitle && (
        <p
          className="mx-auto max-w-[440px] text-[length:var(--fs-body,1rem)] font-normal"
          style={{ color: "var(--go-text-primary)" }}
        >
          Submeta projetos e automações que{" "}
          <strong style={{ color: "var(--go-blue)", fontWeight: 600 }}>
            já estão em produção
          </strong>{" "}
          para avaliação da equipe de RPA & IA
        </p>
      )}
    </header>
  );
}

export function PageFooter() {
  return (
    <footer
      className="mt-6 text-center text-[11px] opacity-70"
      style={{ color: "var(--go-text-primary)" }}
    >
      Desenvolvido pela equipe de{" "}
      <span className="font-semibold" style={{ color: "var(--go-blue)" }}>
        RPA & IA
      </span>{" "}
      &middot; GoGroup &copy; {new Date().getFullYear()}
    </footer>
  );
}

export function BrowserDots({ centered }: { centered?: boolean }) {
  return (
    <div className={cn("mb-6 flex gap-[7px] pt-3", centered && "justify-center")}>
      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: "var(--go-blue)", opacity: 0.25 }} />
      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: "var(--go-blue)", opacity: 0.15 }} />
      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: "var(--go-lime)" }} />
    </div>
  );
}

export function WizardProgress({
  current,
  completed,
  onStepClick,
  editMode,
}: {
  current: number;
  completed: Set<number>;
  onStepClick: (n: number) => void;
  editMode?: boolean;
}) {
  const visibleSteps = editMode ? STEPS.filter((s) => s.id !== 1) : STEPS;
  return (
    <div className="mb-8 flex items-start justify-center px-2">
      {visibleSteps.map((s, idx) => {
        const isActive = current === s.id;
        const isDone = completed.has(s.id) && !isActive;
        return (
          <div key={s.id} className="contents">
            <div
              className={cn(
                "flex min-w-16 flex-col items-center gap-1.5 cursor-default",
                isDone && "cursor-pointer"
              )}
              onClick={() => onStepClick(s.id)}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-300",
                  isActive && "bg-[var(--go-blue)] text-white shadow-[0_0_0_4px_rgba(0,89,169,0.1)]",
                  isDone && "bg-[var(--go-blue)] text-white",
                  !isActive && !isDone && "border-[2.5px] border-[rgba(0,89,169,0.18)] bg-white text-[rgba(0,89,169,0.35)]"
                )}
                style={isActive || isDone ? { borderWidth: "2.5px", borderColor: "var(--go-blue)" } : undefined}
              >
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  s.id
                )}
              </div>
              <span
                className={cn(
                  "hidden text-center text-[10px] font-semibold uppercase tracking-[0.05em] transition-colors duration-300 sm:block",
                  isActive && "text-[var(--go-blue)]",
                  isDone && "text-[var(--go-text-primary)]",
                  !isActive && !isDone && "text-[rgba(0,89,169,0.4)]"
                )}
              >
                {s.label}
              </span>
            </div>
            {idx < visibleSteps.length - 1 && (
              <div
                className="relative mt-[17px] min-w-8 flex-1 self-start"
                style={{ height: "2.5px", background: "rgba(0,89,169,0.1)", borderRadius: 2 }}
              >
                <div
                  className="absolute top-0 left-0 bottom-0 w-full"
                  style={{
                    background: "var(--go-blue)",
                    borderRadius: 2,
                    transformOrigin: "left",
                    transform: current > s.id || completed.has(s.id) ? "scaleX(1)" : "scaleX(0)",
                    transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StepAnimation({ direction, children }: { direction: "forward" | "back"; children: React.ReactNode }) {
  return (
    <div
      style={{
        animation: `${direction === "forward" ? "go-step-in" : "go-step-in-back"} 0.35s cubic-bezier(0.4, 0, 0.2, 1) both`,
      }}
    >
      {children}
    </div>
  );
}
