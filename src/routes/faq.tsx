// Rota-layout do FAQ: busca o conteúdo UMA vez e desce por contexto para /faq e
// /faq/$categoria. Ver spec-docs/SPEC_FAQ.md (D3, D13).

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { FaqProvider } from "@/components/faq/faq-contexto";

export const Route = createFileRoute("/faq")({
  component: FaqLayout,
});

function FaqLayout() {
  return (
    <FaqProvider>
      <Outlet />
    </FaqProvider>
  );
}
