import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { StatusBadge } from "@/components/status-badge";
import { InfoTooltip } from "@/components/info-tooltip";
import { FileText, PencilLine, Eye, Trash2, Loader2, Info, ChevronLeft, ChevronRight, CalendarClock, RotateCcw } from "lucide-react";

// Itens por página em cada filtro de "Meus Projetos".
const PER_PAGE = 10;

// Prazo para regularizar legados (editar/salvar até deixar de constar como legado).
const PRAZO_LEGADO = "30/06/2026";

// Status (espelhado do Sheets) que significa "reprovado — precisa reenviar".
function ehReenvioSolicitado(status: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "reenvio pendente" || s === "rejeitado";
}

// Aviso de pendência com barra de acento à esquerda. Dois tons distintos:
// "legado" (âmbar, regularização com prazo) e "reenvio" (vermelho, ação corretiva).
function AvisoPendencia({
  tone,
  icon,
  titulo,
  texto,
}: {
  tone: "legado" | "reenvio";
  icon: React.ReactNode;
  titulo: string;
  texto: string;
}) {
  const c =
    tone === "legado"
      ? { bg: "rgba(245,158,11,0.08)", bar: "#f59e0b", fg: "#b45309" }
      : { bg: "rgba(220,38,38,0.06)", bar: "#dc2626", fg: "#b91c1c" };
  return (
    <div
      className="mt-2 flex items-start gap-2 rounded-md py-1.5 pl-2.5 pr-3 text-[11px] leading-snug"
      style={{ background: c.bg, borderLeft: `3px solid ${c.bar}`, color: c.fg }}
    >
      <span className="mt-px shrink-0" aria-hidden>{icon}</span>
      <span>
        <span className="font-bold">{titulo}</span> — {texto}
      </span>
    </div>
  );
}

const TRANSFERIR_AUTORIA =
  "Só o autor pode editar este projeto. Para transferir a autoria, acione a equipe RPA.";

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
  atualizado_em: string | null;
  pendente: boolean;
  papel: "owner" | "participante";
  responsavel_nome: string | null;
  responsavel_email: string | null;
};

type Filtro = "todos" | "meus" | "participo" | "rascunhos";

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
  const queryClient = useQueryClient();
  // React Query cacheia a lista (que lê o Sheets, ~9s). staleTime de 60s: voltar da
  // tela de visualização para cá dentro desse intervalo serve do cache — sem spinner
  // nem nova leitura da planilha. O QueryClient é estável entre navegações SPA.
  const { data: projetos = [], isLoading: loading, error } = useQuery({
    queryKey: ["meus-projetos"],
    queryFn: () => apiFetch<Projeto[]>("/api/meus-projetos"),
    staleTime: 60_000,
  });
  const erro = error
    ? (error instanceof Error ? error.message : "Erro ao carregar projetos.")
    : null;
  // Abre em "Todos" (tudo que você submeteu ou participa). "Meus", "Participo" e
  // "Rascunhos" recortam essa lista por papel/estado.
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);

  // Trocar de filtro volta para a primeira página.
  useEffect(() => {
    setPagina(1);
  }, [filtro]);

  const grupos = useMemo(() => {
    const submetidos = projetos.filter((p) => p.status !== "rascunho");
    return {
      todos: submetidos,
      meus: submetidos.filter((p) => p.papel === "owner"),
      participo: submetidos.filter((p) => p.papel === "participante"),
      rascunhos: projetos.filter((p) => p.status === "rascunho"),
    };
  }, [projetos]);

  const visiveis = grupos[filtro];

  // Paginação: 10 itens por página no filtro atual.
  const totalPaginas = Math.max(1, Math.ceil(visiveis.length / PER_PAGE));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const pageItems = visiveis.slice((paginaSegura - 1) * PER_PAGE, paginaSegura * PER_PAGE);

  // Exclusão de rascunho com confirmação no próprio toast (sonner).
  function pedirExclusaoRascunho(id: string, nome: string | null) {
    toast(`Excluir o rascunho "${nome ?? "sem nome"}"?`, {
      description: "Esta ação não pode ser desfeita.",
      action: {
        label: "Excluir",
        onClick: async () => {
          setExcluindo(id);
          try {
            await apiFetch(`/api/meus-projetos/${id}`, undefined, "DELETE");
            queryClient.setQueryData<Projeto[]>(["meus-projetos"], (old) =>
              (old ?? []).filter((p) => p.id !== id),
            );
            toast.success("Rascunho excluído.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao excluir o rascunho.");
          } finally {
            setExcluindo(null);
          }
        },
      },
      cancel: { label: "Cancelar", onClick: () => {} },
    });
  }

  const FILTROS: { key: Filtro; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "meus", label: "Meus" },
    { key: "participo", label: "Participo" },
    { key: "rascunhos", label: "Rascunhos" },
  ];

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
        <div className="relative" style={{ background: "var(--go-blue)", minHeight: 180 }}>
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
            <>
              {/* Filtros: Todos (padrão) · Meus · Participo · Rascunhos */}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                {FILTROS.map((f) => {
                  const ativo = filtro === f.key;
                  const n = grupos[f.key].length;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFiltro(f.key)}
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all"
                      style={
                        ativo
                          ? { background: "var(--go-blue)", color: "var(--go-white)" }
                          : { background: "transparent", color: "#8b8b9a", border: "1px solid rgba(0,0,0,0.1)" }
                      }
                    >
                      {f.label}
                      <span
                        className="rounded-full px-1.5 text-[11px] font-bold"
                        style={ativo ? { background: "rgba(255,255,255,0.2)" } : { background: "rgba(0,0,0,0.05)" }}
                      >
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Aviso "só o autor edita" — em "Participo" e em "Todos" (quando há ao menos
                  um projeto de participação na lista; nos demais você só visualiza). */}
              {(filtro === "participo" || filtro === "todos") && grupos.participo.length > 0 && (
                <div
                  className="mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3 text-[12px] leading-snug"
                  style={{ background: "rgba(0,89,169,0.05)", border: "1px solid rgba(0,89,169,0.12)", color: "var(--go-blue)" }}
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {filtro === "participo"
                      ? "Você participa destes projetos, mas só o autor pode editá-los. Para transferir a autoria de um projeto, acione a equipe RPA."
                      : "Alguns projetos abaixo são de outra pessoa (você participa) — só o autor pode editá-los; você apenas visualiza. Para transferir a autoria, acione a equipe RPA."}
                  </p>
                </div>
              )}

              {visiveis.length === 0 && (
                <div
                  className="rounded-xl p-10 text-center"
                  style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)" }}
                >
                  <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" style={{ color: "var(--go-blue)" }} />
                  <p className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
                    {filtro === "rascunhos"
                      ? "Nenhum rascunho em andamento"
                      : filtro === "participo"
                        ? "Você não participa de nenhum projeto"
                        : "Nenhum projeto por aqui"}
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "#8b8b9a" }}>
                    {filtro === "rascunhos"
                      ? "Rascunhos aparecem aqui enquanto você preenche uma submissão."
                      : filtro === "participo"
                        ? "Projetos em que outra pessoa te incluiu como participante aparecem aqui."
                        : "Você ainda não tem projetos neste filtro."}
                  </p>
                </div>
              )}

              {visiveis.length > 0 && (
                <div className="space-y-3">
                  {pageItems.map((p) => {
                    const ehRascunho = p.status === "rascunho";
                    const ehOwner = p.papel === "owner";
                    return (
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
                            <span className="truncate font-semibold" style={{ color: "var(--go-text-heading)", fontSize: 15 }}>
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
                          {/* Autoria + tooltip de transferência (não em rascunho — é seu) */}
                          {!ehRascunho && (
                            <div className="mt-1.5 flex items-center gap-1 text-[11px]" style={{ color: "#a5a5b3" }}>
                              <span>
                                Autoria:{" "}
                                <span style={{ color: "#8b8b9a", fontWeight: 600 }}>
                                  {ehOwner ? "você" : p.responsavel_nome || p.responsavel_email || "—"}
                                </span>
                              </span>
                              {/* Disclaimer de transferência só faz sentido p/ participante
                                  (no projeto próprio, "só o autor edita" é redundante). */}
                              {!ehOwner && (
                                <InfoTooltip text={TRANSFERIR_AUTORIA} label="Sobre a autoria do projeto" />
                              )}
                            </div>
                          )}
                          {/* Pendência de REGULARIZAÇÃO (legado, com prazo) — âmbar */}
                          {p.pendente && (
                            <AvisoPendencia
                              tone="legado"
                              icon={<CalendarClock className="h-3.5 w-3.5" />}
                              titulo="Regularização de legado"
                              texto={
                                ehOwner
                                  ? `atualize este projeto até ${PRAZO_LEGADO} para regularizar o cadastro — basta editar e salvar.`
                                  : `pendente de regularização até ${PRAZO_LEGADO}. Só o autor pode atualizar — acione o autor ou a equipe RPA.`
                              }
                            />
                          )}
                          {/* Pendência de REENVIO (reprovado na análise) — vermelho */}
                          {ehReenvioSolicitado(p.status) && (
                            <AvisoPendencia
                              tone="reenvio"
                              icon={<RotateCcw className="h-3.5 w-3.5" />}
                              titulo="Reenvio solicitado"
                              texto={
                                ehOwner
                                  ? "a análise apontou um ponto a ajustar. Corrija e reenvie para nova validação."
                                  : "a análise apontou um ponto a ajustar. Só o autor pode reenviar — acione o autor ou a equipe RPA."
                              }
                            />
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                          <StatusBadge status={p.status} />
                          {ehRascunho ? (
                            <>
                              <Link
                                to="/submeter"
                                search={{ retomar: p.id }}
                                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
                                style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
                              >
                                <PencilLine className="h-3.5 w-3.5" />
                                Continuar
                              </Link>
                              <button
                                type="button"
                                onClick={() => pedirExclusaoRascunho(p.id, p.nome)}
                                disabled={excluindo === p.id}
                                title="Excluir rascunho"
                                aria-label="Excluir rascunho"
                                className="inline-flex items-center justify-center rounded-full p-2 transition-all disabled:opacity-50"
                                style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}
                              >
                                {excluindo === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </>
                          ) : ehOwner ? (
                            <Link
                              to="/editar/$id"
                              params={{ id: p.id }}
                              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
                              style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                              Editar
                            </Link>
                          ) : (
                            <Link
                              to="/projeto/$id"
                              params={{ id: p.id }}
                              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
                              style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Visualizar
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Paginação — só quando o filtro tem mais de uma página */}
              {totalPaginas > 1 && (
                <nav className="mt-6 flex items-center justify-center gap-1.5" aria-label="Paginação">
                  <button
                    type="button"
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    disabled={paginaSegura <= 1}
                    aria-label="Página anterior"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:opacity-40"
                    style={{ background: "transparent", color: "var(--go-blue)", border: "1px solid rgba(0,89,169,0.15)" }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => {
                    const ativo = n === paginaSegura;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPagina(n)}
                        aria-label={`Página ${n}`}
                        aria-current={ativo ? "page" : undefined}
                        className="inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[13px] font-semibold transition-all"
                        style={
                          ativo
                            ? { background: "var(--go-blue)", color: "var(--go-white)" }
                            : { background: "transparent", color: "#8b8b9a", border: "1px solid rgba(0,0,0,0.1)" }
                        }
                      >
                        {n}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                    disabled={paginaSegura >= totalPaginas}
                    aria-label="Próxima página"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:opacity-40"
                    style={{ background: "transparent", color: "var(--go-blue)", border: "1px solid rgba(0,89,169,0.15)" }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </nav>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
