import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { fmtDataBR } from "@/lib/format-date";
import { StatusBadge } from "@/components/status-badge";
import { InfoTooltip } from "@/components/info-tooltip";
import { AvisoPendencia } from "@/components/aviso-pendencia";
import { SimpleMarkdown } from "@/lib/submeter/step3-chat";
import { normalizarMarcadoresMemorial } from "@/lib/agents/memorial-format";
import {
  Loader2,
  FileText,
  PencilLine,
  Eye,
  Stamp,
  CheckCheck,
  CircleSlash,
} from "lucide-react";

const TRANSFERIR_AUTORIA =
  "Só o autor pode editar este projeto. Para transferir a autoria, acione a equipe RPA.";

// O líder abre esta tela pela fila de pré-aprovação, não por "Meus Projetos" — a doc é
// insumo do parecer dele. Ele lê e não edita (o poder de edição é do autor e de quem ele
// delega), então o cabeçalho diz de onde ele veio e o que ainda se espera dele.
const APROVADOR_ORIGEM = { to: "/aprovacoes", label: "← Pré-aprovações" } as const;
const MEUS_PROJETOS_ORIGEM = { to: "/meus-projetos", label: "← Meus Projetos" } as const;

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
  // "aprovador" = líder convocado à pré-aprovação deste projeto (lê, não edita).
  papel: "owner" | "participante" | "aprovador";
  podeEditar: boolean;
  // Resumo da fila do líder — usado só para dizer se o parecer DELE ainda falta.
  aprovacao: { veredito: string; aprovadores: string[]; comentario: string | null } | null;
  responsavel_nome: string;
  responsavel_email: string;
  ferramenta: string;
  escopo: string | null;
  descricao_breve: string | null;
  contexto_especial: string | null;
  documentacao: { saving?: Memorial; receita?: Memorial } | null;
  // Motivo da reprovação (analisador ou triagem) — o autor precisa ver o PORQUÊ, não só
  // o selo "Reprovado". Vem do espelho SQLite nesta tela (que não lê o Sheets): uma
  // sobreposição feita na triagem aparece aqui após o próximo resync.
  motivo_reprovado: string | null;
  motivo_reenvio: string | null;
};

const TIPO_LABEL: Record<string, string> = {
  saving: "Saving",
  receita_incremental: "Receita incremental",
};

// Aceita ISO (app) e pt-BR dd/mm/yyyy (planilha/legados) — ver @/lib/format-date.
const fmtDate = fmtDataBR;

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

  // Quem chega como aprovador volta para a fila; todo mundo mais, para "Meus Projetos".
  // Enquanto carrega, o padrão é "Meus Projetos" (não há papel ainda para decidir).
  const ehAprovador = p?.papel === "aprovador";
  const origem = ehAprovador ? APROVADOR_ORIGEM : MEUS_PROJETOS_ORIGEM;
  // O parecer dele ainda falta? A fila é resolvida pelo PRIMEIRO líder que decide (D4),
  // então "pendente" aqui significa que ninguém decidiu — inclusive ele.
  const parecerPendente = ehAprovador && (p?.aprovacao?.veredito ?? "pendente") === "pendente";
  // D29 — a fila pode ter sido DISPENSADA pelo sistema (o analisador reprovou o projeto
  // por critério). A linha continua dando leitura ao líder (D28), então ele chega aqui;
  // sem este caso, o `else` do selo afirmaria "Parecer registrado" sobre um parecer que
  // ele nunca deu. É a mesma afirmação falsa que a coluna do Sheets evita.
  const parecerDispensado = ehAprovador && p?.aprovacao?.veredito === "dispensado";

  // Cada memorial guarda o tipo (saving/receita) para o acento certo no render.
  // normalizarMarcadoresMemorial troca os códigos [x.x] por títulos legíveis —
  // cobre também memoriais legados gravados antes da mudança nos prompts.
  const memoriais = [
    { texto: p?.documentacao?.saving?.memorial_calculo, isSaving: true },
    { texto: p?.documentacao?.receita?.memorial_calculo, isSaving: false },
  ]
    .filter((m): m is { texto: string; isSaving: boolean } => !!m.texto && m.texto.trim() !== "")
    .map((m) => ({ ...m, texto: normalizarMarcadoresMemorial(m.texto) }));

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
              to={origem.to}
              className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold opacity-80 transition-opacity hover:opacity-100"
              style={{ color: "var(--go-white)" }}
            >
              {origem.label}
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
                    {/* Disclaimer de transferência só p/ participante (redundante no projeto próprio). */}
                    {p.papel === "participante" && (
                      <InfoTooltip text={TRANSFERIR_AUTORIA} label="Sobre a autoria do projeto" />
                    )}
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
                    {/* Aprovador: estado por RÓTULO + ÍCONE (nunca só cor). */}
                    {ehAprovador && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide align-middle"
                        style={
                          parecerPendente
                            ? { background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }
                            : { background: "rgba(71,85,105,0.10)", color: "#475569" }
                        }
                      >
                        {parecerPendente ? (
                          <>
                            <Stamp className="h-3 w-3" aria-hidden="true" />
                            Aguarda seu parecer
                          </>
                        ) : parecerDispensado ? (
                          <>
                            <CircleSlash className="h-3 w-3" aria-hidden="true" />
                            Pré-aprovação dispensada
                          </>
                        ) : (
                          <>
                            <CheckCheck className="h-3 w-3" aria-hidden="true" />
                            Parecer registrado
                          </>
                        )}
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

              {/* Reprovação / pedido de reenvio COM O MOTIVO — reprovar sem explicar
                  deixa o autor sem saída. Estado nunca só por cor: ícone + rótulo. */}
              {(p.motivo_reprovado || p.motivo_reenvio) && (
                <AvisoPendencia
                  tone={p.motivo_reprovado ? "reprovado" : "reenvio"}
                  titulo={p.motivo_reprovado ? "Projeto reprovado" : "Reenvio solicitado"}
                  motivo={p.motivo_reprovado ?? p.motivo_reenvio}
                />
              )}

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
                    <div key={i} className={i > 0 ? "mt-4" : "mt-2"}>
                      <SimpleMarkdown text={m.texto} isSaving={m.isSaving} />
                    </div>
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
