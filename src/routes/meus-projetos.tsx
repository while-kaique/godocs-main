import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { fmtDataBR } from "@/lib/format-date";
import { StatusBadge } from "@/components/status-badge";
import { InfoTooltip } from "@/components/info-tooltip";
import { FileText, PencilLine, Eye, Trash2, Loader2, Info, ChevronLeft, ChevronRight, CalendarClock, RotateCcw, Users, X, Archive } from "lucide-react";

// Itens por página em cada filtro de "Meus Projetos".
const PER_PAGE = 10;

// Prazo para regularizar legados (editar/salvar até deixar de constar como legado).
const PRAZO_LEGADO = "30/06/2026";

// Status (espelhado do Sheets) que significa "reprovado — precisa reenviar".
function ehReenvioSolicitado(status: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "reenvio pendente" || s === "rejeitado";
}

// Replica no cliente a regra de pendência do servidor (legado sem "Atualizado Em") —
// usada para restaurar o aviso âmbar ao REATIVAR um projeto, sem precisar refetch.
function ehLegadoPendente(p: { id: string; atualizado_em: string | null }): boolean {
  return p.id.toLowerCase().includes("legado") && !p.atualizado_em;
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
  // Projeto descontinuado (a automação não roda mais) — badge "Descontinuado", sem aviso.
  descontinuado: boolean;
  papel: "owner" | "participante";
  // true = owner OU editor delegado. Decide o botão "Editar" × "Visualizar" e a
  // exibição do botão de distribuição do poder de edição.
  podeEditar: boolean;
  // Participantes do projeto (emails) e quais deles têm o poder de edição delegado.
  membros: string[];
  editores_delegados: string[];
  responsavel_nome: string | null;
  responsavel_email: string | null;
};

type Filtro = "todos" | "meus" | "participo" | "rascunhos";

// Aceita ISO (app) e pt-BR dd/mm/yyyy (planilha/legados) — ver @/lib/format-date.
const fmtDate = fmtDataBR;

function fmtGanho(v: number | null): string {
  if (!v) return "";
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/mês`;
}

// Popup (overlay com fundo embaçado) para o dono — ou um editor já delegado (cascata)
// — distribuir o poder de edição entre os participantes do projeto. Cada participante
// marcado passa a poder editar/reenviar "como se fosse o dono". Fecha no "x", no
// backdrop e no Esc. Salva via POST /api/meus-projetos/:id/editores.
function DistribuirEdicaoModal({
  projeto,
  onClose,
  onSaved,
}: {
  projeto: Projeto;
  onClose: () => void;
  onSaved: (editores: string[]) => void;
}) {
  const participantes = useMemo(
    () => projeto.membros.map((m) => m.trim()).filter(Boolean),
    [projeto.membros],
  );
  // Conjunto de emails (lowercase) atualmente marcados como editores.
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(projeto.editores_delegados.map((e) => e.trim().toLowerCase())),
  );
  const [salvando, setSalvando] = useState(false);

  // Fecha no Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(email: string) {
    const lower = email.trim().toLowerCase();
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(lower)) next.delete(lower);
      else next.add(lower);
      return next;
    });
  }

  async function salvar() {
    setSalvando(true);
    try {
      // Reenvia os emails ORIGINAIS (preservando o caso) que estão marcados.
      const editores = participantes.filter((m) => marcados.has(m.toLowerCase()));
      const res = await apiFetch<{ editores_delegados: string[] }>(
        `/api/meus-projetos/${projeto.id}/editores`,
        { editores },
        "POST",
      );
      onSaved(res.editores_delegados);
      toast.success("Permissões de edição atualizadas.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar as permissões.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(8,20,40,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Distribuir o poder de edição"
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl"
        style={{ background: "var(--go-white)", boxShadow: "0 24px 64px rgba(8,20,40,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(0,89,169,0.1)", color: "var(--go-blue)" }}
            >
              <Users style={{ width: 18, height: 18 }} />
            </span>
            <div className="min-w-0">
              <h2 className="font-extrabold leading-tight" style={{ color: "var(--go-text-heading)", fontSize: 16 }}>
                Quem pode editar
              </h2>
              <p className="mt-0.5 truncate text-[12px]" style={{ color: "#8b8b9a" }}>
                {projeto.nome ?? "(sem nome)"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all hover:opacity-80"
            style={{ background: "rgba(0,0,0,0.05)", color: "#5b5b6a" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-[12.5px] leading-snug" style={{ color: "#6b6b7a" }}>
            Escolha quais participantes podem <span className="font-semibold">editar e reenviar</span> este
            projeto como se fossem você. Como autor, você sempre pode editar.
          </p>

          {participantes.length === 0 ? (
            <div
              className="mt-4 rounded-xl px-4 py-6 text-center text-[12.5px] leading-snug"
              style={{ background: "var(--go-cream)", color: "#8b8b9a" }}
            >
              Este projeto ainda não tem participantes. Adicione participantes ao editar o projeto
              (ou na planilha) para poder distribuir o poder de edição.
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {participantes.map((m) => {
                const checked = marcados.has(m.toLowerCase());
                return (
                  <li key={m}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      onClick={() => toggle(m)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition-all"
                      style={{
                        background: checked ? "rgba(0,89,169,0.06)" : "var(--go-white)",
                        border: `1px solid ${checked ? "rgba(0,89,169,0.25)" : "rgba(0,0,0,0.1)"}`,
                      }}
                    >
                      <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: "var(--go-text-heading)" }}>
                        {m}
                      </span>
                      {/* Switch visual */}
                      <span
                        aria-hidden
                        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-all"
                        style={{ background: checked ? "var(--go-blue)" : "rgba(0,0,0,0.18)" }}
                      >
                        <span
                          className="absolute h-4 w-4 rounded-full bg-white transition-all"
                          style={{ left: checked ? 18 : 2, top: 2 }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t px-6 py-4" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
            style={{ background: "transparent", color: "#8b8b9a", border: "1px solid rgba(0,0,0,0.12)" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || participantes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all disabled:opacity-50"
            style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
          >
            {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
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
  // Id do projeto cuja ação de descontinuar/reativar está em andamento (spinner no botão).
  const [descontinuando, setDescontinuando] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  // Projeto cujo popup de "distribuir poder de edição" está aberto (null = fechado).
  const [delegando, setDelegando] = useState<Projeto | null>(null);

  // Reflete a nova lista de editores delegados no cache da listagem (sem refetch).
  function aplicarDelegacao(projetoId: string, editores: string[]) {
    queryClient.setQueryData<Projeto[]>(["meus-projetos"], (old) =>
      (old ?? []).map((p) => (p.id === projetoId ? { ...p, editores_delegados: editores } : p)),
    );
  }

  // Reflete no cache o novo estado de "descontinuado" (sem refetch — a lista lê o
  // Sheets, ~9s). Descontinuar zera a pendência e vira badge "Descontinuado"; reativar
  // volta a "Pendente" e restaura o aviso de legado quando for o caso.
  function aplicarDescontinuado(id: string, desc: boolean) {
    queryClient.setQueryData<Projeto[]>(["meus-projetos"], (old) =>
      (old ?? []).map((p) =>
        p.id === id
          ? {
              ...p,
              descontinuado: desc,
              status: desc ? "descontinuado" : "pendente",
              pendente: desc ? false : ehLegadoPendente(p),
            }
          : p,
      ),
    );
  }

  async function enviarDescontinuar(id: string, desc: boolean) {
    setDescontinuando(id);
    try {
      await apiFetch(`/api/meus-projetos/${id}/descontinuar`, { descontinuar: desc }, "POST");
      aplicarDescontinuado(id, desc);
      toast.success(desc ? "Projeto marcado como descontinuado." : "Projeto reativado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar o projeto.");
    } finally {
      setDescontinuando(null);
    }
  }

  // Confirmação no próprio toast antes de descontinuar (reativar é direto).
  function pedirDescontinuar(id: string, nome: string | null) {
    toast(`Marcar "${nome ?? "sem nome"}" como descontinuado?`, {
      description:
        "A automação deixa de contar como pendência e o projeto aparece como Descontinuado. Você pode reativar depois.",
      action: { label: "Descontinuar", onClick: () => enviarDescontinuar(id, true) },
      cancel: { label: "Cancelar", onClick: () => {} },
    });
  }

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

              {/* Aviso "só o autor edita" — em "Participo" e em "Todos", apenas quando há
                  participação SEM edição delegada (se o autor já delegou a edição a você,
                  o card mostra "Editar" e o aviso não se aplica àquele projeto). */}
              {(filtro === "participo" || filtro === "todos") && grupos.participo.some((p) => !p.podeEditar) && (
                <div
                  className="mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3 text-[12px] leading-snug"
                  style={{ background: "rgba(0,89,169,0.05)", border: "1px solid rgba(0,89,169,0.12)", color: "var(--go-blue)" }}
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {filtro === "participo"
                      ? "Você participa destes projetos. Em alguns, só o autor edita — você apenas visualiza, a menos que o autor delegue a edição a você. Para transferir a autoria, acione a equipe RPA."
                      : "Alguns projetos abaixo são de outra pessoa (você participa). Sem a edição delegada pelo autor, você só visualiza. Para transferir a autoria, acione a equipe RPA."}
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
                    // Pode editar = owner ou editor delegado (na lista nunca há admin-override).
                    // Quem pode editar também pode gerenciar a delegação (dono ou cascata).
                    const podeEditar = p.podeEditar;
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
                              {/* Disclaimer de transferência só p/ participante SEM edição
                                  (no projeto próprio ou com edição delegada, é redundante). */}
                              {!ehOwner && !podeEditar && (
                                <InfoTooltip text={TRANSFERIR_AUTORIA} label="Sobre a autoria do projeto" />
                              )}
                              {/* Participante com edição delegada pelo dono. */}
                              {!ehOwner && podeEditar && (
                                <span
                                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                                >
                                  Edição delegada
                                </span>
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
                                podeEditar
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
                                podeEditar
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
                          ) : (
                            <>
                              {/* Distribuir o poder de edição — quem pode editar (dono ou editor
                                  já delegado) gerencia quais participantes editam o projeto. */}
                              {podeEditar && (
                                <button
                                  type="button"
                                  onClick={() => setDelegando(p)}
                                  title="Distribuir o poder de edição"
                                  aria-label="Distribuir o poder de edição"
                                  className="inline-flex items-center justify-center rounded-full p-2 transition-all"
                                  style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                                >
                                  <Users className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {/* Descontinuar / Reativar — quem pode editar arquiva o projeto
                                  (para de contar como pendência) ou o traz de volta. */}
                              {podeEditar &&
                                (p.descontinuado ? (
                                  <button
                                    type="button"
                                    onClick={() => enviarDescontinuar(p.id, false)}
                                    disabled={descontinuando === p.id}
                                    title="Reativar projeto"
                                    aria-label="Reativar projeto"
                                    className="inline-flex items-center justify-center rounded-full p-2 transition-all disabled:opacity-50"
                                    style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                                  >
                                    {descontinuando === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => pedirDescontinuar(p.id, p.nome)}
                                    disabled={descontinuando === p.id}
                                    title="Descontinuar projeto"
                                    aria-label="Descontinuar projeto"
                                    className="inline-flex items-center justify-center rounded-full p-2 transition-all disabled:opacity-50"
                                    style={{ background: "rgba(100,116,139,0.1)", color: "#475569" }}
                                  >
                                    {descontinuando === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                                  </button>
                                ))}
                              {podeEditar ? (
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
                            </>
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

      {/* Popup de distribuição do poder de edição (overlay com fundo embaçado). */}
      {delegando && (
        <DistribuirEdicaoModal
          projeto={delegando}
          onClose={() => setDelegando(null)}
          onSaved={(editores) => aplicarDelegacao(delegando.id, editores)}
        />
      )}
    </div>
  );
}
