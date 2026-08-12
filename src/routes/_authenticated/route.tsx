import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import type { CurrentUser } from "@/lib/auth.functions";
import { lerAuthCache, gravarAuthCache, limparAuthCache, AUTH_CACHE_MS } from "@/lib/auth-cache";
import { iniciarPrefetchDashboard } from "@/lib/dashboard-prefetch";
import { LayoutDashboard, Building2, Settings, ExternalLink, FlaskConical, Search, Loader2, Mail } from "lucide-react";

// Cache do auth no cliente — evita fetch repetido a cada navegação dentro do admin.
// Dois níveis: memória (mais rápido, morre no reload) e `sessionStorage` (sobrevive ao
// reload e à navegação, morre ao fechar o navegador — ver `lib/auth-cache.ts`). Sem o 2º
// nível, todo F5 numa tela admin voltava para "Verificando permissões...".
// O gate real é server-side (`requireAdmin` em toda `/api/admin/*`); aqui só se decide o
// que a SPA pinta enquanto revalida.
let cachedUser: CurrentUser | null = null;
let cachedAt = 0;

/** Revalida o auth em segundo plano para o cache não fixar permissão revogada. */
function revalidarAuth() {
  void (async () => {
    try {
      const r = await fetch("/api/auth/me");
      const u: CurrentUser | null = r.ok ? ((await r.json()) as CurrentUser | null) : null;
      if (u?.isAdmin) {
        cachedUser = u;
        cachedAt = Date.now();
        gravarAuthCache(u);
      } else {
        cachedUser = null;
        cachedAt = 0;
        limparAuthCache();
      }
    } catch {
      // Rede instável não deve derrubar quem já está com a tela aberta.
    }
  })();
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location, preload }) => {
    // A leitura da planilha do dashboard não depende do veredito do auth (o servidor
    // exige admin de qualquer jeito), então começa AGORA, em paralelo — era fila indiana:
    // esperava o auth e só então pedia os ~2 s de planilha.
    // ⚠️ `preload` (hover) NÃO dispara isto: com `defaultPreload: 'intent'` no router,
    // passar o mouse pelo item "Dashboard" da sidebar viraria uma LEITURA DA PLANILHA,
    // e a cota do Sheets é de 60 leituras/min COMPARTILHADA com produção. O preload
    // serve para baixar o CHUNK da rota; I/O de verdade fica para a navegação real.
    if (!preload && location.pathname.startsWith("/dashboard")) iniciarPrefetchDashboard();

    // Se já autenticou recentemente, usa o cache (memória → sessionStorage)
    const doCache = cachedUser && Date.now() - cachedAt < AUTH_CACHE_MS ? cachedUser : null;
    const daSessao = doCache ?? lerAuthCache<CurrentUser>();
    if (daSessao?.isAdmin) {
      if (!doCache) {
        cachedUser = daSessao;
        cachedAt = Date.now();
      }
      revalidarAuth();
      return { user: daSessao };
    }

    console.log("[_authenticated] beforeLoad — chamando /api/auth/me...");
    const response = await fetch("/api/auth/me");
    console.log("[_authenticated] /api/auth/me status:", response.status);
    const user: CurrentUser | null = response.ok ? ((await response.json()) as CurrentUser | null) : null;
    console.log("[_authenticated] user:", JSON.stringify(user));
    if (!user) {
      console.log("[_authenticated] user=null → redirecionando para /");
      cachedUser = null;
      limparAuthCache();
      throw redirect({ to: "/", search: { acesso_negado: true } });
    }
    if (!user.isAdmin) {
      console.log("[_authenticated] user.isAdmin=false → redirecionando para /");
      cachedUser = null;
      limparAuthCache();
      throw redirect({ to: "/", search: { acesso_negado: true } });
    }
    console.log("[_authenticated] Auth OK — admin:", user.email);
    cachedUser = user;
    cachedAt = Date.now();
    gravarAuthCache(user);
    return { user };
  },
  pendingComponent: AuthLoadingScreen,
  component: AuthenticatedLayout,
});

function AuthLoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
      <Loader2
        className="h-8 w-8 animate-spin"
        style={{ color: "var(--go-blue)" }}
      />
      <p className="text-sm font-medium text-muted-foreground">
        Verificando permissões...
      </p>
    </div>
  );
}

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
          <NavItem to="/email-legados" icon={<Mail className="h-4 w-4" />}>
            Disparo de e-mails
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
