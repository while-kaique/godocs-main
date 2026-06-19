import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import {
  FilePlus2,
  LayoutList,
  ShieldCheck,
  Clock,
  CheckCircle2,
  RotateCcw,
  ArrowRight,
  AlertTriangle,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    acesso_negado: search.acesso_negado === true || search.acesso_negado === "true" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Triagem de Fluxos · GoGroup" },
      {
        name: "description",
        content:
          "Plataforma para submissão e gestão de projetos internos de RPA & IA.",
      },
      { property: "og:title", content: "Triagem de Fluxos · GoGroup" },
      {
        property: "og:description",
        content:
          "Submeta, edite ou reenvie projetos internos da empresa em poucos cliques.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const { acesso_negado } = useSearch({ from: "/" });
  // Projetos legados pendentes de regularização (sem "Atualizado Em" no Sheets).
  // Busca silenciosa: se falhar, o selo simplesmente não aparece.
  const [pendentes, setPendentes] = useState<{ count: number; prazo: string } | null>(null);

  useEffect(() => {
    apiFetch<{ count: number; prazo: string }>("/api/meus-projetos/pendentes")
      .then(setPendentes)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (acesso_negado) {
      toast.warning(
        "Acesso restrito. Somente pessoas autorizadas podem acessar o painel de administração.",
        { duration: 6000 }
      );
      // Limpa o param da URL sem recarregar a página
      window.history.replaceState({}, "", "/");
    }
  }, [acesso_negado]);

  return (
    <div
      className="min-h-screen px-2.5 pb-2.5"
      style={{
        background: "var(--go-blue)",
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{
          background: "var(--go-bg-page)",
          borderRadius: "0 0 var(--go-radius-xl) var(--go-radius-xl)",
        }}
      >
        {/* Header + Hero — unified blue section */}
        <div className="relative overflow-hidden" style={{ background: "var(--go-blue)", minHeight: "420px" }}>
          {/* Decorative automation background */}
          <div className="pointer-events-none absolute inset-0" style={{ opacity: 0.4 }} aria-hidden="true">
            <svg
              className="absolute inset-0 h-full w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern id="go-dots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
                  <circle cx="16" cy="16" r="1" fill="white" opacity="0.5" />
                </pattern>
                <radialGradient id="go-node-glow">
                  <stop offset="0%" stopColor="white" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="white" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Base dot grid */}
              <rect width="100%" height="100%" fill="url(#go-dots)" />

              {/* ── Workflow pipeline: top-left cluster ── */}
              <line x1="8%" y1="18%" x2="18%" y2="18%" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <line x1="18%" y1="18%" x2="28%" y2="28%" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <line x1="28%" y1="28%" x2="18%" y2="40%" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
              <circle cx="8%" cy="18%" r="14" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="1.5" />
              <circle cx="8%" cy="18%" r="5" fill="white" fillOpacity="0.3" />
              <circle cx="18%" cy="18%" r="10" fill="none" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <circle cx="18%" cy="18%" r="4" fill="white" fillOpacity="0.3" />
              <circle cx="28%" cy="28%" r="12" fill="none" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <circle cx="28%" cy="28%" r="4" fill="white" fillOpacity="0.3" />
              <circle cx="18%" cy="40%" r="8" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1" />

              {/* ── Workflow pipeline: top-right cluster ── */}
              <line x1="75%" y1="12%" x2="85%" y2="12%" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <line x1="85%" y1="12%" x2="92%" y2="22%" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
              <line x1="85%" y1="12%" x2="85%" y2="28%" stroke="white" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="4 3" />
              <circle cx="75%" cy="12%" r="12" fill="none" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <circle cx="75%" cy="12%" r="4" fill="white" fillOpacity="0.35" />
              <circle cx="85%" cy="12%" r="16" fill="none" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <circle cx="85%" cy="12%" r="6" fill="white" fillOpacity="0.25" />
              <circle cx="92%" cy="22%" r="10" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
              <circle cx="85%" cy="28%" r="6" fill="none" stroke="white" strokeOpacity="0.25" strokeWidth="1" />

              {/* ── Bottom-left: code brackets & gear ── */}
              <text x="5%" y="75%" fill="white" fillOpacity="0.3" fontSize="42" fontFamily="monospace" fontWeight="300">{"{"}</text>
              <text x="12%" y="75%" fill="white" fillOpacity="0.25" fontSize="42" fontFamily="monospace" fontWeight="300">{"}"}</text>
              <circle cx="9%" cy="88%" r="12" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
              <circle cx="9%" cy="88%" r="6" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
              <line x1="9%" y1="74%" x2="9%" y2="78%" stroke="white" strokeOpacity="0.3" strokeWidth="2" />
              <line x1="9%" y1="98%" x2="9%" y2="94%" stroke="white" strokeOpacity="0.3" strokeWidth="2" />

              {/* ── Bottom-right: flow arrows & loop ── */}
              <line x1="78%" y1="80%" x2="88%" y2="80%" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
              <polyline points="86%,78% 89%,80% 86%,82%" fill="none" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx="95%" cy="75%" r="14" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="6 4" />
              <polyline points="95%,61% 97%,64% 93%,64%" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />

              {/* ── Center-left: vertical data stream ── */}
              <line x1="4%" y1="45%" x2="4%" y2="65%" stroke="white" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 4" />
              <circle cx="4%" cy="45%" r="3" fill="white" fillOpacity="0.3" />
              <circle cx="4%" cy="55%" r="2" fill="white" fillOpacity="0.25" />
              <circle cx="4%" cy="65%" r="3" fill="white" fillOpacity="0.3" />

              {/* ── Center-right: diagonal connector ── */}
              <line x1="96%" y1="40%" x2="88%" y2="55%" stroke="white" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx="96%" cy="40%" r="5" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1" />
              <circle cx="88%" cy="55%" r="7" fill="none" stroke="white" strokeOpacity="0.25" strokeWidth="1" />

              {/* ── Scattered micro-nodes ── */}
              <circle cx="40%" cy="8%" r="3" fill="white" fillOpacity="0.25" />
              <circle cx="55%" cy="90%" r="4" fill="white" fillOpacity="0.25" />
              <circle cx="65%" cy="5%" r="2" fill="white" fillOpacity="0.3" />
              <circle cx="35%" cy="92%" r="3" fill="white" fillOpacity="0.25" />
              <circle cx="50%" cy="15%" r="2" fill="white" fillOpacity="0.2" />

              {/* ── Node glows ── */}
              <circle cx="18%" cy="18%" r="30" fill="url(#go-node-glow)" />
              <circle cx="85%" cy="12%" r="35" fill="url(#go-node-glow)" />
            </svg>
          </div>

          {/* Nav bar */}
          <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-8 py-5">
            <span
              className="font-extrabold tracking-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 1.75rem)",
                color: "var(--go-white)",
                letterSpacing: "-0.01em",
                lineHeight: 1,
              }}
            >
              gogroup
            </span>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-semibold transition-all duration-200"
              style={{
                color: "var(--go-white)",
                border: "2px solid rgba(255,255,255,0.4)",
                background: "var(--go-blue)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--go-white)";
                e.currentTarget.style.color = "var(--go-blue)";
                e.currentTarget.style.borderColor = "var(--go-white)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--go-blue)";
                e.currentTarget.style.color = "var(--go-white)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)";
              }}
            >
              <ShieldCheck className="h-4 w-4" />
              Área Admin
            </Link>
          </nav>

          {/* Hero content — centered in the full blue section, overlapping nav area */}
          <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center pb-10 text-center">
            <div className="mb-4 inline-flex items-center justify-center">
              <span
                className="font-semibold uppercase"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  color: "var(--go-blue)",
                  background: "var(--go-lime)",
                  padding: "5px 16px",
                  borderRadius: "var(--go-radius-pill)",
                }}
              >
                RPA & IA
              </span>
            </div>
            <h1
              className="mx-auto max-w-2xl font-extrabold leading-tight tracking-tight"
              style={{
                fontSize: "clamp(2rem, 5vw, 3rem)",
                color: "var(--go-white)",
              }}
            >
              Triagem de Fluxos
            </h1>
            <p
              className="mx-auto mt-4 max-w-lg text-[length:var(--fs-body,1rem)] leading-relaxed"
              style={{ color: "rgba(255,255,255,0.75)" }}
            >
              Submeta seus projetos de automação ou gerencie os já enviados.
              <br />
              Escolha uma ação abaixo para começar.
            </p>
          </div>

          {/* Curved transition to cream */}
          <div className="absolute bottom-0 left-0 right-0">
            <svg
              viewBox="0 0 1440 60"
              preserveAspectRatio="none"
              className="block w-full"
              style={{ height: "40px" }}
            >
              <path
                d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z"
                fill="var(--go-cream)"
              />
            </svg>
          </div>
        </div>

        <main className="mx-auto max-w-6xl px-8 pt-8">
          {/* Action Cards */}
          <section className="grid grid-cols-1 gap-6 pb-12 md:grid-cols-2">
            <ActionCard
              to="/submeter"
              icon={<FilePlus2 className="h-6 w-6" />}
              title="Submeter projeto"
              description="Cadastre um novo projeto com descrição, área, savings e documentação."
              badge="Novo cadastro"
              accent
            />
            <ActionCard
              to="/meus-projetos"
              icon={<LayoutList className="h-6 w-6" />}
              title="Meus Projetos"
              description={
                pendentes && pendentes.count > 0
                  ? `Você tem ${pendentes.count} projeto${pendentes.count > 1 ? "s" : ""} pendente${pendentes.count > 1 ? "s" : ""} — edite e reenvie até ${pendentes.prazo} para regularizar.`
                  : "Visualize, edite ou reenvie seus projetos submetidos."
              }
              badge="Editar e reenviar"
              pendingCount={pendentes?.count ?? 0}
            />
          </section>

          {/* Status section */}
          <section
            className="relative mx-auto mb-14 max-w-2xl overflow-hidden"
            style={{
              background: "var(--go-white)",
              border: "1px solid rgba(0,89,169,0.08)",
              borderRadius: "var(--go-radius-xl)",
              boxShadow: "var(--go-shadow-sm)",
            }}
          >
            {/* Gradient accent bar */}
            <div
              className="absolute top-0 left-0 right-0 h-[3px]"
              style={{
                background:
                  "linear-gradient(90deg, var(--go-blue) 0%, var(--go-blue) 60%, var(--go-lime) 100%)",
              }}
            />

            <div className="px-8 pb-6 pt-7">
              <div className="mb-5 flex items-center gap-2">
                <Zap
                  className="h-4 w-4"
                  style={{ color: "var(--go-blue)" }}
                />
                <span
                  className="text-[11px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: "var(--go-blue)" }}
                >
                  Ciclo de vida do projeto
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <StatusPill
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="Em análise"
                  bg="rgba(0,89,169,0.06)"
                  border="rgba(0,89,169,0.15)"
                  color="var(--go-blue)"
                />
                <StepArrow />
                <StatusPill
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  label="Aprovado"
                  bg="rgba(34,197,94,0.06)"
                  border="rgba(34,197,94,0.18)"
                  color="#16a34a"
                />
                <span
                  className="hidden text-[10px] font-semibold sm:block"
                  style={{ color: "#8b8b9a" }}
                >
                  ou
                </span>
                <StatusPill
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  label="Reenvio Pendente"
                  bg="rgba(215,219,0,0.08)"
                  border="rgba(215,219,0,0.25)"
                  color="#8a7d00"
                />
              </div>

              <p
                className="mt-5 text-center text-[12px] leading-relaxed"
                style={{ color: "#8b8b9a" }}
              >
                Líderes e administradores acompanham todas as submissões
                na{" "}
                <Link
                  to="/auth"
                  className="font-semibold underline decoration-1 underline-offset-2 transition-colors"
                  style={{ color: "var(--go-blue)" }}
                >
                  área administrativa
                </Link>
                .
              </p>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer
          className="pb-6 text-center text-[11px]"
          style={{ color: "var(--go-text-primary)", opacity: 0.6 }}
        >
          Desenvolvido pela equipe de{" "}
          <span
            className="font-semibold"
            style={{ color: "var(--go-blue)" }}
          >
            RPA & IA
          </span>{" "}
          &middot; GoGroup &copy; {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}

/* ── Action Card ── */

function ActionCard({
  href,
  to,
  icon,
  title,
  description,
  badge,
  accent,
  disabled,
  pendingCount = 0,
}: {
  href?: string;
  to?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
  accent?: boolean;
  disabled?: boolean;
  pendingCount?: number;
}) {
  const inner = (
    <div
      className="group relative flex h-full flex-col overflow-hidden transition-all duration-300"
      style={{
        background: "var(--go-white)",
        border: accent
          ? "2px solid var(--go-lime)"
          : "1px solid rgba(0,89,169,0.08)",
        borderRadius: "var(--go-radius-xl)",
        padding: "28px 24px 24px",
        boxShadow: "var(--go-shadow-sm)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        pointerEvents: disabled ? "none" : undefined,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = "var(--go-shadow-lg)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "var(--go-shadow-sm)";
      }}
    >
      {/* Selo de pendentes — só aparece quando há legados por regularizar */}
      {pendingCount > 0 && (
        <span
          className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-bold shadow-sm"
          style={{ background: "#dc2626", color: "#fff" }}
        >
          <AlertTriangle className="h-3 w-3" />
          {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
        </span>
      )}

      {/* Browser dots */}
      <div className="mb-5 flex gap-[6px]">
        <span
          className="block h-[9px] w-[9px] rounded-full"
          style={{ background: "var(--go-blue)", opacity: 0.2 }}
        />
        <span
          className="block h-[9px] w-[9px] rounded-full"
          style={{ background: "var(--go-blue)", opacity: 0.12 }}
        />
        <span
          className="block h-[9px] w-[9px] rounded-full"
          style={{ background: "var(--go-lime)" }}
        />
      </div>

      {/* Icon */}
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center"
        style={{
          background: accent
            ? "rgba(215,219,0,0.15)"
            : "rgba(0,89,169,0.07)",
          borderRadius: "var(--go-radius-md)",
          color: accent ? "#8a7d00" : "var(--go-blue)",
        }}
      >
        {icon}
      </div>

      {/* Badge */}
      <span
        className="mb-3 inline-block self-start rounded-full px-3 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em]"
        style={{
          background: accent
            ? "rgba(215,219,0,0.15)"
            : "rgba(0,89,169,0.06)",
          color: accent ? "#8a7d00" : "var(--go-blue)",
          border: accent
            ? "1px solid rgba(215,219,0,0.3)"
            : "1px solid rgba(0,89,169,0.12)",
        }}
      >
        {badge}
      </span>

      {/* Title */}
      <h3
        className="mb-2 text-[17px] font-bold"
        style={{ color: "var(--go-text-heading)" }}
      >
        {title}
      </h3>

      {/* Description */}
      <p
        className="mb-5 flex-1 text-[13px] leading-relaxed"
        style={{ color: "var(--go-text-primary)", opacity: 0.8 }}
      >
        {description}
      </p>

      {/* CTA */}
      <div
        className="inline-flex items-center gap-2 self-start rounded-full px-5 py-2.5 text-[13px] font-semibold transition-all duration-200 group-hover:shadow-[var(--go-shadow-lime-glow)] group-hover:-translate-y-0.5"
        style={{
          background: accent ? "var(--go-lime)" : "var(--go-blue)",
          color: accent ? "var(--go-blue)" : "var(--go-white)",
          borderRadius: "var(--go-radius-pill)",
        }}
      >
        Abrir formulário
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </div>
  );

  if (disabled) return <div>{inner}</div>;
  if (to) return <Link to={to}>{inner}</Link>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  );
}

/* ── Status Pill ── */

function StatusPill({
  icon,
  label,
  bg,
  border,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  bg: string;
  border: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-full px-3.5 py-[6px] text-[12px] font-semibold"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        color,
      }}
    >
      {icon}
      {label}
    </span>
  );
}

/* ── Step Arrow ── */

function StepArrow() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8b8b9a"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="hidden shrink-0 sm:block"
      style={{ opacity: 0.5 }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
