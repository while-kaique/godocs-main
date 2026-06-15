import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import type { CurrentUser } from "@/lib/auth.functions";
import { LayoutDashboard, Building2, Settings, ExternalLink, FlaskConical, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    console.log("[_authenticated] beforeLoad — chamando /api/auth/me...");
    const response = await fetch("/api/auth/me");
    console.log("[_authenticated] /api/auth/me status:", response.status);
    const user: CurrentUser | null = response.ok ? ((await response.json()) as CurrentUser | null) : null;
    console.log("[_authenticated] user:", JSON.stringify(user));
    if (!user) {
      console.log("[_authenticated] user=null → redirecionando para /");
      throw redirect({ to: "/", search: { acesso_negado: true } });
    }
    if (!user.isAdmin) {
      console.log("[_authenticated] user.isAdmin=false → redirecionando para /");
      throw redirect({ to: "/", search: { acesso_negado: true } });
    }
    console.log("[_authenticated] Auth OK — admin:", user.email);
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            G
          </div>
          <span className="font-semibold tracking-tight">GoDocs Admin</span>
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem to="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />}>
            Dashboard
          </NavItem>
          <NavItem to="/areas" icon={<Building2 className="h-4 w-4" />}>
            Áreas
          </NavItem>
          <NavItem to="/configuracoes" icon={<Settings className="h-4 w-4" />}>
            Configurações
          </NavItem>
          <NavItem to="/investigador" icon={<Search className="h-4 w-4" />}>
            Investigador
          </NavItem>
          <NavItem to="/testes" icon={<FlaskConical className="h-4 w-4" />}>
            Testes
          </NavItem>
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ExternalLink className="h-4 w-4" /> Ver plataforma
          </Link>
        </nav>

        <div className="mt-6 border-t border-sidebar-border pt-4 px-2">
          <div className="text-sm font-medium text-sidebar-foreground truncate">
            {user.email}
          </div>
          <div className="text-xs text-sidebar-foreground/60 mt-0.5">
            Admin
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      activeProps={{
        className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
      }}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {icon}
      {children}
    </Link>
  );
}
