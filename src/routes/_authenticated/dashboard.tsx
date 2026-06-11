import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { Projeto as ProjetoBase, ProjetoStatus } from "@/integrations/db/types";

type Projeto = ProjetoBase & { areas: { nome: string } | null };
type Status = ProjetoStatus;

const STATUS_LABEL: Record<Status, string> = {
  rascunho: "Rascunho",
  em_validacao: "Em validação",
  validado: "Validado",
  rejeitado: "Em revisão",
  aprovado: "Aprovado",
};

const STATUS_COLOR: Record<Status, string> = {
  rascunho: "bg-muted text-muted-foreground",
  em_validacao: "bg-yellow-100 text-yellow-800",
  validado: "bg-green-100 text-green-800",
  rejeitado: "bg-amber-100 text-amber-800",
  aprovado: "bg-green-100 text-green-800",
};

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · GoDocs Admin" }] }),
  component: Dashboard,
});

function Dashboard() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Projeto[]>("/api/admin/projetos")
      .then((data) => setProjetos(data ?? []))
      .catch(() => setProjetos([]))
      .finally(() => setLoading(false));
  }, []);

  const contagem = (status: Status) =>
    projetos.filter((p) => p.status === status).length;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-muted-foreground">
        Acompanhe os projetos submetidos pelos times.
      </p>

      {/* Contadores por status */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(["rascunho", "em_validacao", "validado", "rejeitado"] as Status[]).map(
          (s) => (
            <div
              key={s}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="text-2xl font-bold">{contagem(s)}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {STATUS_LABEL[s]}
              </div>
            </div>
          )
        )}
      </div>

      {/* Lista de projetos */}
      <div className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Todos os projetos</h2>

        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando...</div>
        ) : projetos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            Nenhum projeto submetido ainda.
          </div>
        ) : (
          <div className="space-y-3">
            {projetos.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4"
              >
                <div>
                  <div className="font-medium">
                    {p.nome ?? "Projeto sem nome"}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {p.responsavel_nome} · {p.areas?.nome ?? "Sem área"} ·{" "}
                    {p.ferramenta}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLOR[p.status ?? "rascunho"]}`}
                  >
                    {STATUS_LABEL[p.status ?? "rascunho"]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(p.created_at ?? "").toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
