// Rota-layout do FAQ: busca a árvore UMA vez e desce por contexto para /faq,
// /faq/$categoria e /faq/$categoria/$item. Ver spec-docs/SPEC_FAQ.md (D3).

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
