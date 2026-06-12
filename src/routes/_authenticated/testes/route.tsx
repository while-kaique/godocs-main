import { createFileRoute, Outlet, Link } from '@tanstack/react-router';
import { FlaskConical, Play, LayoutGrid, Brain } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/testes')({
  head: () => ({
    meta: [{ title: 'Testes · GoDocs Admin' }],
  }),
  component: TestesLayout,
});

const tabs = [
  { to: '/testes', label: 'Visão Geral', icon: LayoutGrid, exact: true },
  { to: '/testes/cenarios', label: 'Cenários de Teste', icon: Play },
  { to: '/testes/prompts', label: 'Prompts da IA', icon: Brain },
] as const;

function TestesLayout() {
  return (
    <div className="flex h-full flex-col">
      {/* Header + tabs */}
      <div className="border-b border-border bg-background">
        <div className="flex items-center gap-3 px-6 pt-6 pb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FlaskConical className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Testes & Simulação</h1>
            <p className="text-xs text-muted-foreground">Ferramentas de teste para observar o comportamento da IA</p>
          </div>
        </div>

        <nav className="flex gap-1 px-6">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: 'exact' in tab ? tab.exact : false }}
              className="flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground [&.active]:border-primary [&.active]:text-foreground [&.active]:font-medium"
              activeProps={{ className: 'active' }}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
