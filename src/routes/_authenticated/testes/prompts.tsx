import { createFileRoute } from '@tanstack/react-router';
import { PromptInspector } from '@/lib/testes/prompt-inspector';

export const Route = createFileRoute('/_authenticated/testes/prompts')({
  head: () => ({
    meta: [{ title: 'Prompts da IA · GoDocs Admin' }],
  }),
  component: PromptInspector,
});
