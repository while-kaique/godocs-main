import { createFileRoute, Link } from '@tanstack/react-router';
import { Play, FlaskConical, Brain } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/testes/')({
  component: TestesIndex,
});

function TestesIndex() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FlaskConical className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold">Console de Testes</h2>
          <p className="text-sm text-muted-foreground">
            Ferramentas para testar e observar o comportamento dos agentes de IA do GoDocs.
          </p>
        </div>

        <div className="grid gap-4">
          <Link
            to="/testes/cenarios"
            className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 transition-colors group-hover:bg-blue-500/20">
              <Play className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">Cenários de Teste</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Simulação completa do fluxo de submissão. Selecione um cenário pré-configurado,
                inicie a conversa com a IA e acompanhe cada fase (documentação, saving, receita)
                com inspeção de estado e chamadas API em tempo real.
              </p>
            </div>
          </Link>

          <Link
            to="/testes/prompts"
            className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 transition-colors group-hover:bg-purple-500/20">
              <Brain className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">Prompts da IA</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Inspetor de todos os system prompts dos agentes. Visualize o texto completo,
                parâmetros LLM e contexto de cada prompt — carregados dinamicamente do código real.
              </p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
