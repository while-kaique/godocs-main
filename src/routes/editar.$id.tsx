import { createFileRoute } from "@tanstack/react-router";
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
  return <SubmeterPageContent editProjetoId={id} />;
}
