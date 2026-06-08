import { createFileRoute, redirect } from "@tanstack/react-router";

// Auth é gerenciado pelo Godeploy edge (Google OAuth).
// Esta rota apenas redireciona para o dashboard — o beforeLoad do /_authenticated
// valida o acesso e redireciona para / se não autorizado.
export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    throw redirect({ to: "/dashboard" });
  },
  component: () => null,
});
