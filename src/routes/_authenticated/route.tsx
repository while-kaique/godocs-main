import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Users, Building2, LogOut, ExternalLink } from "lucide-react";

type Role = "admin_master" | "leader";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [profile, setProfile] = useState<{ nome: string; email: string } | null>(
    null,
  );

  useEffect(() => {
    (async () => {
      const [{ data: roleRows }, { data: profileRow }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("profiles").select("nome,email").eq("id", user.id).maybeSingle(),
      ]);
      setRoles((roleRows ?? []).map((r) => r.role as Role));
      if (profileRow) setProfile(profileRow);
      else setProfile({ nome: user.email ?? "Usuário", email: user.email ?? "" });
    })();
  }, [user.id, user.email]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (roles === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const isAdmin = roles.includes("admin_master");
  const isLeader = roles.includes("leader");

  if (!isAdmin && !isLeader) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-2xl font-bold">Sem permissão</h1>
        <p className="max-w-md text-muted-foreground">
          Sua conta ({profile?.email}) ainda não tem papel atribuído. Solicite
          acesso ao Admin Master.
        </p>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" /> Sair
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            H
          </div>
          <span className="font-semibold tracking-tight">Hub Admin</span>
        </div>
        <nav className="flex-1 space-y-1">
          <NavItem to="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />}>
            Dashboard
          </NavItem>
          {isAdmin && (
            <>
              <NavItem to="/usuarios" icon={<Users className="h-4 w-4" />}>
                Usuários
              </NavItem>
              <NavItem to="/areas" icon={<Building2 className="h-4 w-4" />}>
                Áreas
              </NavItem>
            </>
          )}
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ExternalLink className="h-4 w-4" /> Ir para o site
          </Link>
        </nav>
        <div className="mt-6 border-t border-sidebar-border pt-4">
          <div className="px-2 pb-3">
            <div className="text-sm font-medium text-sidebar-foreground">
              {profile?.nome}
            </div>
            <div className="text-xs text-sidebar-foreground/60">
              {isAdmin ? "Admin Master" : "Leader"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
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
        className:
          "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
      }}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {icon}
      {children}
    </Link>
  );
}
