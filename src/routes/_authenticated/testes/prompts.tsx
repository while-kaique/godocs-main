import { createFileRoute } from '@tanstack/react-router';
import { PromptInspector } from '@/lib/testes/prompt-inspector';
import { useTituloPagina } from '@/lib/use-titulo-pagina';
import { SECAO } from '@/lib/titulo-pagina';

export const Route = createFileRoute('/_authenticated/testes/prompts')({
  component: PromptsPage,
});

// Wrapper só para o título — o `PromptInspector` mora em `lib/` e é reaproveitado, então
// não é ele quem decide o nome da aba.
function PromptsPage() {
  useTituloPagina(SECAO.prompts);
  return <PromptInspector />;
}
