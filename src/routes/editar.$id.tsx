import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { SubmeterPageContent } from "./submeter";

export const Route = createFileRoute("/editar/$id")({
  head: () => ({
    meta: [
      { title: "Editar Projeto · GoGroup" },
      { name: "description", content: "Edite ou reenvie seu projeto de automação." },
    ],
  }),
  component: EditarPage,
});

function EditarPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  // Só o autor (owner) ou admin RPA edita. Confere antes de abrir o editor; quem só
  // participa é levado à visualização. O gate definitivo é server-side no submit —
  // isto evita carregar o editor à toa e dá o feedback certo.
  const [estado, setEstado] = useState<"checando" | "ok">("checando");

  useEffect(() => {
    let ativo = true;
    apiFetch<{ podeEditar: boolean }>(`/api/meus-projetos/${id}`)
      .then((p) => {
        if (!ativo) return;
        if (p.podeEditar) setEstado("ok");
        else navigate({ to: "/projeto/$id", params: { id }, replace: true });
      })
      .catch(() => {
        // Sem acesso/erro → manda para a visualização (que mostra o erro apropriado).
        if (ativo) navigate({ to: "/projeto/$id", params: { id }, replace: true });
      });
    return () => {
      ativo = false;
    };
  }, [id, navigate]);

  if (estado === "checando") {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--go-blue)" }}
      >
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-white)" }} />
      </div>
    );
  }

  return <SubmeterPageContent editProjetoId={id} />;
}
