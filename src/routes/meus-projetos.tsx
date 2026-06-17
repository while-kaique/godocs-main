import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  Clock,
  CheckCircle2,
  RotateCcw,
  XCircle,
  FileText,
  PencilLine,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/meus-projetos")({
  head: () => ({
    meta: [
      { title: "Meus Projetos · GoGroup" },
      { name: "description", content: "Seus projetos de automação submetidos." },
    ],
  }),
  component: MeusProjetosPage,
});

type Projeto = {
  id: string;
  nome: string | null;
  status: string | null;
  tipos_projeto: string[];
  especial: boolean;
  area_nome: string | null;
  ganho_total_mensal: number | null;
  created_at: string | null;
  submitted_at: string | null;
  arquivos_nomes: string[];
};

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; border: string; color: string; icon: React.ReactNode }
> = {
  rascunho: {
    label: "Rascunho",
    bg: "rgba(0,0,0,0.03)",
    border: "rgba(0,0,0,0.1)",
    color: "#6b7280",
    icon: <FileText className="h-3.5 w-3.5" />,
  },
  em_validacao: {
    label: "Em análise",
    bg: "rgba(0,89,169,0.06)",
    border: "rgba(0,89,169,0.15)",
    color: "var(--go-blue)",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  aprovado: {
    label: "Aprovado",
    bg: "rgba(34,197,94,0.06)",
    border: "rgba(34,197,94,0.18)",
    color: "#16a34a",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  validado: {
    label: "Validado",
    bg: "rgba(34,197,94,0.06)",
    border: "rgba(34,197,94,0.18)",
    color: "#16a34a",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  rejeitado: {
    label: "Reenvio Pendente",
    bg: "rgba(215,219,0,0.08)",
    border: "rgba(215,219,0,0.25)",
    color: "#8a7d00",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
  },
};

function StatusBadge({ status }: { status: string | null }) {
  const cfg = STATUS_CONFIG[status ?? ""] ?? {
    label: status ?? "—",
    bg: "rgba(0,0,0,0.03)",
    border: "rgba(0,0,0,0.1)",
    color: "#6b7280",
    icon: <XCircle className="h-3.5 w-3.5" />,
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function fmtGanho(v: number | null): string {
  if (!v) return "";
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/mês`;
}

function MeusProjetosPage() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Projeto[]>("/api/meus-projetos")
      .then(setProjetos)
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro ao carregar projetos."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="min-h-screen px-2.5 pb-2.5"
      style={{ background: "var(--go-blue)", fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{ background: "var(--go-bg-page)", borderRadius: "0 0 var(--go-radius-xl) var(--go-radius-xl)" }}
      >
        {/* Header azul */}
        <div
          className="relative"
          style={{ background: "var(--go-blue)", minHeight: 180 }}
        >
          <div className="absolute bottom-0 left-0 right-0">
            <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="block w-full" style={{ height: 40 }}>
              <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--go-cream)" />
            </svg>
          </div>
          <div className="relative z-10 mx-auto max-w-4xl px-8 py-10">
            <Link
              to="/"
              className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold opacity-80 transition-opacity hover:opacity-100"
              style={{ color: "var(--go-white)" }}
            >
              ← Início
            </Link>
            <h1
              className="font-extrabold tracking-tight"
              style={{ fontSize: "clamp(1.6rem,4vw,2.2rem)", color: "var(--go-white)" }}
            >
              Meus Projetos
            </h1>
            <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
              Projetos que você submeteu ou nos quais participa.
            </p>
          </div>
        </div>

        {/* Conteúdo */}
        <main className="mx-auto max-w-4xl px-8 py-8">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-blue)" }} />
            </div>
          )}

          {!loading && erro && (
            <div
              className="rounded-xl p-6 text-center text-sm"
              style={{ background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.15)", color: "#dc2626" }}
            >
              {erro}
            </div>
          )}

          {!loading && !erro && projetos.length === 0 && (
            <div
              className="rounded-xl p-10 text-center"
              style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)" }}
            >
              <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" style={{ color: "var(--go-blue)" }} />
              <p className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
                Nenhum projeto encontrado
              </p>
              <p className="mt-1 text-sm" style={{ color: "#8b8b9a" }}>
                Você ainda não submeteu nenhum projeto.
              </p>
              <Link
                to="/submeter"
                className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all"
                style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
              >
                Submeter projeto
              </Link>
            </div>
          )}

          {!loading && !erro && projetos.length > 0 && (
            <div className="space-y-3">
              {projetos.map((p) => (
                <div
                  key={p.id}
                  className="group flex flex-col gap-3 overflow-hidden rounded-xl p-5 sm:flex-row sm:items-center sm:justify-between"
                  style={{
                    background: "var(--go-white)",
                    border: "1px solid rgba(0,89,169,0.08)",
                    boxShadow: "var(--go-shadow-sm)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="truncate font-semibold"
                        style={{ color: "var(--go-text-heading)", fontSize: 15 }}
                      >
                        {p.nome ?? "(sem nome)"}
                      </span>
                      {p.especial && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={{ background: "var(--go-lime)", color: "var(--go-blue)" }}
                        >
                          Especial
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: "#8b8b9a" }}>
                      {p.area_nome && <span>{p.area_nome}</span>}
                      {p.ganho_total_mensal != null && p.ganho_total_mensal > 0 && (
                        <span className="font-semibold" style={{ color: "#16a34a" }}>
                          {fmtGanho(p.ganho_total_mensal)}
                        </span>
                      )}
                      <span>{p.submitted_at ? `Enviado em ${fmtDate(p.submitted_at)}` : `Criado em ${fmtDate(p.created_at)}`}</span>
                    </div>
                    {p.status === "aprovado" && (
                      <p className="mt-1.5 text-[11px]" style={{ color: "#dc9900" }}>
                        ⚠️ Reenviar um projeto aprovado o devolve para análise.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge status={p.status} />
                    <Link
                      to="/editar/$id"
                      params={{ id: p.id }}
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
                      style={{
                        background: "var(--go-blue)",
                        color: "var(--go-white)",
                      }}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      Editar
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
