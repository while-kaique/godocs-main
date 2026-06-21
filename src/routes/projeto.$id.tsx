import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { StatusBadge } from "@/components/status-badge";
import { InfoTooltip } from "@/components/info-tooltip";
import { Loader2, FileText, PencilLine, Eye } from "lucide-react";

const TRANSFERIR_AUTORIA =
  "Só o autor pode editar este projeto. Para transferir a autoria, acione a equipe RPA.";

export const Route = createFileRoute("/projeto/$id")({
  head: () => ({
    meta: [
      { title: "Projeto · GoGroup" },
      { name: "description", content: "Detalhes do projeto de automação." },
    ],
  }),
  component: ProjetoReadOnlyPage,
});

type Memorial = { memorial_calculo?: string | null };
type Detalhes = {
  id: string;
  nome: string | null;
  status: string | null;
  tipos_projeto: string[];
  especial: boolean;
  area_nome: string | null;
  saving_horas: number | null;
  submitted_at: string | null;
  created_at: string | null;
  arquivos_nomes: string[];
  papel: "owner" | "participante";
  podeEditar: boolean;
  responsavel_nome: string;
  responsavel_email: string;
  ferramenta: string;
  escopo: string | null;
  descricao_breve: string | null;
  contexto_especial: string | null;
  documentacao: { saving?: Memorial; receita?: Memorial } | null;
};

const TIPO_LABEL: Record<string, string> = {
  saving: "Saving",
  receita_incremental: "Receita incremental",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px]" style={{ color: "var(--go-text-heading)" }}>
        {children}
      </dd>
    </div>
  );
}

function ProjetoReadOnlyPage() {
  const { id } = Route.useParams();
  const [p, setP] = useState<Detalhes | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Detalhes>(`/api/meus-projetos/${id}`)
      .then(setP)
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro ao carregar o projeto."))
      .finally(() => setLoading(false));
  }, [id]);

  const memoriais = [
    p?.documentacao?.saving?.memorial_calculo,
    p?.documentacao?.receita?.memorial_calculo,
  ].filter((m): m is string => !!m && m.trim() !== "");

  return (
    <div
      className="min-h-screen px-2.5 pb-2.5"
      style={{ background: "var(--go-blue)", fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{ background: "var(--go-bg-page)", borderRadius: "0 0 var(--go-radius-xl) var(--go-radius-xl)" }}
      >
        {/* Header azul com onda */}
        <div className="relative" style={{ background: "var(--go-blue)", minHeight: 170 }}>
          <div className="absolute bottom-0 left-0 right-0">
            <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="block w-full" style={{ height: 40 }}>
              <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--go-cream)" />
            </svg>
          </div>
          <div className="relative z-10 mx-auto max-w-3xl px-8 py-9">
            <Link
              to="/meus-projetos"
              className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold opacity-80 transition-opacity hover:opacity-100"
              style={{ color: "var(--go-white)" }}
            >
              ← Meus Projetos
            </Link>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" style={{ color: "rgba(255,255,255,0.7)" }} />
              <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.7)" }}>
                Somente leitura
              </span>
            </div>
            <h1
              className="mt-1 font-extrabold tracking-tight"
              style={{ fontSize: "clamp(1.4rem,3.5vw,2rem)", color: "var(--go-white)" }}
            >
              {p?.nome ?? (loading ? "Carregando…" : "Projeto")}
            </h1>
          </div>
        </div>

        <main className="mx-auto max-w-3xl px-8 py-8">
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

          {!loading && !erro && p && (
            <div className="space-y-5">
              {/* Autoria + status + ação */}
              <div
                className="flex flex-col gap-3 rounded-xl p-5 sm:flex-row sm:items-center sm:justify-between"
                style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)", boxShadow: "var(--go-shadow-sm)" }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
                      Autoria
                    </span>
                    <InfoTooltip text={TRANSFERIR_AUTORIA} label="Sobre a autoria do projeto" />
                  </div>
                  <p className="mt-0.5 truncate text-[14px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
                    {p.responsavel_nome || p.responsavel_email}
                    {p.papel === "participante" && (
                      <span
                        className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide align-middle"
                        style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                      >
                        Você participa
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={p.status} />
                  {p.podeEditar && (
                    <Link
                      to="/editar/$id"
                      params={{ id: p.id }}
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
                      style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      Editar
                    </Link>
                  )}
                </div>
              </div>

              {/* Metadados */}
              <div
                className="rounded-xl p-5"
                style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)", boxShadow: "var(--go-shadow-sm)" }}
              >
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Campo label="Área">{p.area_nome ?? "—"}</Campo>
                  <Campo label="Ferramenta">{p.ferramenta || "—"}</Campo>
                  <Campo label="Escopo">{p.escopo || "—"}</Campo>
                  <Campo label="Tipo">
                    {p.tipos_projeto.length > 0
                      ? p.tipos_projeto.map((t) => TIPO_LABEL[t] ?? t).join(", ")
                      : "—"}
                    {p.especial && (
                      <span
                        className="ml-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{ background: "var(--go-lime)", color: "var(--go-blue)" }}
                      >
                        Especial
                      </span>
                    )}
                  </Campo>
                  <Campo label="Economia de horas">
                    {p.saving_horas != null && p.saving_horas > 0 ? `${p.saving_horas}h/mês` : "—"}
                  </Campo>
                  <Campo label="Enviado em">
                    {p.submitted_at ? fmtDate(p.submitted_at) : fmtDate(p.created_at)}
                  </Campo>
                </dl>
              </div>

              {/* Descrição */}
              {p.descricao_breve && (
                <section
                  className="rounded-xl p-5"
                  style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)", boxShadow: "var(--go-shadow-sm)" }}
                >
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
                    Descrição
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "var(--go-text-heading)" }}>
                    {p.descricao_breve}
                  </p>
                </section>
              )}

              {/* Contexto especial */}
              {p.contexto_especial && (
                <section
                  className="rounded-xl p-5"
                  style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)", boxShadow: "var(--go-shadow-sm)" }}
                >
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
                    Contexto (projeto especial)
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "var(--go-text-heading)" }}>
                    {p.contexto_especial}
                  </p>
                </section>
              )}

              {/* Memorial (sem valores em R$ — visão do cliente) */}
              {memoriais.length > 0 && (
                <section
                  className="rounded-xl p-5"
                  style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)", boxShadow: "var(--go-shadow-sm)" }}
                >
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
                    Memorial de cálculo
                  </h2>
                  {memoriais.map((m, i) => (
                    <p
                      key={i}
                      className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed"
                      style={{ color: "var(--go-text-heading)" }}
                    >
                      {m}
                    </p>
                  ))}
                </section>
              )}

              {/* Anexos */}
              {p.arquivos_nomes.length > 0 && (
                <section
                  className="rounded-xl p-5"
                  style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)", boxShadow: "var(--go-shadow-sm)" }}
                >
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
                    Anexos
                  </h2>
                  <ul className="mt-2 space-y-1.5">
                    {p.arquivos_nomes.map((nome, i) => (
                      <li key={i} className="flex items-center gap-2 text-[13px]" style={{ color: "var(--go-text-heading)" }}>
                        <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--go-blue)", opacity: 0.6 }} />
                        <span className="truncate">{nome}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
