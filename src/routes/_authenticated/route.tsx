import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { CurrentUser } from "@/lib/auth.functions";
import { lerAuthCache, gravarAuthCache, limparAuthCache, AUTH_CACHE_MS } from "@/lib/auth-cache";
import { iniciarPrefetchDashboard } from "@/lib/dashboard-prefetch";
import {
  LayoutDashboard,
  Building2,
  ExternalLink,
  FlaskConical,
  Search,
  Loader2,
  Mail,
  Star,
  ClipboardList,
  Workflow,
  GitMerge,
} from "lucide-react";

// Cache do auth no cliente — evita fetch repetido a cada navegação dentro do admin.
// Dois níveis: memória (mais rápido, morre no reload) e `sessionStorage` (sobrevive ao
// reload e à navegação, morre ao fechar o navegador — ver `lib/auth-cache.ts`). Sem o 2º
// nível, todo F5 numa tela admin voltava para "Verificando permissões...".
// O gate real é server-side (`requireAdmin` em toda `/api/admin/*`); aqui só se decide o
// que a SPA pinta enquanto revalida.
let cachedUser: CurrentUser | null = null;
let cachedAt = 0;
/** Verificação em voo — uma só por aba, compartilhada entre navegações. */
let verificacaoEmVoo: Promise<CurrentUser | null> | null = null;

/**
 * Busca o auth e atualiza os dois níveis de cache. Devolve `null` para "não é admin" —
 * quem decide o que fazer com isso é a tela (redirecionar), não esta função.
 */
function buscarAuth(): Promise<CurrentUser | null> {
  verificacaoEmVoo ??= (async () => {
    try {
      const r = await fetch("/api/auth/me");
      const u: CurrentUser | null = r.ok ? ((await r.json()) as CurrentUser | null) : null;
      if (u?.isAdmin) {
        cachedUser = u;
        cachedAt = Date.now();
        gravarAuthCache(u);
        return u;
      }
      cachedUser = null;
      cachedAt = 0;
      limparAuthCache();
      return null;
    } finally {
      verificacaoEmVoo = null;
    }
  })();
  return verificacaoEmVoo;
}

/** Revalida o auth em segundo plano para o cache não fixar permissão revogada. */
function revalidarAuth() {
  // Rede instável não deve derrubar quem já está com a tela aberta.
  void buscarAuth().catch(() => {});
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location, preload }) => {
    // A leitura da planilha do dashboard não depende do veredito do auth (o servidor
    // exige admin de qualquer jeito), então começa AGORA, em paralelo — era fila indiana:
    // esperava o auth e só então pedia os ~2 s de planilha.
    // ⚠️ `preload` (hover) NÃO dispara isto: com `defaultPreload: 'intent'` no router,
    // passar o mouse por um link viraria uma LEITURA DA PLANILHA, e a cota do Sheets é de
    // 60 leituras/min COMPARTILHADA com produção. O preload serve para baixar o CHUNK da
    // rota; I/O de verdade fica para a navegação real.
    //
    // ⚠️ Este guard cobre SÓ quem entra na área admin vindo de FORA (hover no "Área Admin"
    // da home): `preload` é `!!(preload && !matchStores.has(matchId))` no router-core, ou
    // seja, ele só vale `true` para um match NOVO. Quem já está numa tela admin tem este
    // layout montado, então o `beforeLoad` do PAI roda com `preload: false` mesmo no hover
    // e o guard não pega nada. Por isso o link "Dashboard" da sidebar leva `preload={false}`
    // logo abaixo — as duas travas juntas é que fecham o caso. (Medido no staging: só com o
    // guard, passar o mouse pelo item da sidebar disparava `/api/admin/dashboard/projetos`.)
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

    // ⚠️ SEM cache, a tela NÃO espera o veredito para pintar (17/08/2026).
    //
    // Antes, este `beforeLoad` dava `await` no `/api/auth/me` e a rota inteira ficava em
    // "Verificando permissões..." por uma requisição que, neste ambiente, custa ~750 ms de
    // overhead FIXO do edge — e só DEPOIS o dashboard montava e começava o próprio
    // carregamento. Eram duas esperas em fila para o mesmo clique.
    //
    // Agora o veredito viaja como PROMESSA no contexto: o layout pinta na hora (com o
    // esqueleto da tela filha) e o `GuardaAcesso` redireciona se a resposta for negativa.
    //
    // Por que isto é seguro: o gate REAL é server-side (`requireAdmin` em TODA `/api/admin/*`)
    // e sempre foi — este `beforeLoad` nunca protegeu dado nenhum, só decidia o que pintar
    // (é o que o cabeçalho de `auth-cache.ts` já dizia). Quem não é admin vê o esqueleto do
    // layout por instantes, recebe 403 em qualquer chamada de dados e é redirecionado.
    //
    // ⚠️ Só o caminho `/dashboard` ganha o prefetch da listagem acima; aqui não se dispara
    // I/O novo — `buscarAuth` é a MESMA requisição que já seria feita, sem o `await`.
    return { user: null, verificacao: buscarAuth() };
  },
  pendingComponent: AuthLoadingScreen,
  component: AuthenticatedLayout,
});

function AuthLoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
      <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--go-blue)" }} />
      <p className="text-sm font-medium text-muted-foreground">Verificando permissões...</p>
    </div>
  );
}

/**
 * Espera o veredito do auth sem segurar a pintura. Não renderiza nada: existe só para
 * redirecionar quem não é admin. (O gate de verdade é o `requireAdmin` do servidor.)
 */
function GuardaAcesso({
  verificacao,
  aoConfirmar,
}: {
  verificacao: Promise<CurrentUser | null>;
  aoConfirmar: (u: CurrentUser) => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    let vivo = true;
    void verificacao
      .then((u) => {
        if (!vivo) return;
        if (u?.isAdmin) aoConfirmar(u);
        else void navigate({ to: "/", search: { acesso_negado: true }, replace: true });
      })
      // Falha de rede não expulsa quem está com a tela aberta: as chamadas de dados
      // devolverão 403 e a tela mostra o erro real.
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [verificacao, aoConfirmar, navigate]);
  return null;
}

function AuthenticatedLayout() {
  const { user, verificacao } = Route.useRouteContext();
  const [confirmado, setConfirmado] = useState<CurrentUser | null>(user);

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
          {/*
            ⚠️ Único item da sidebar SEM preload no hover. Navegar para `/dashboard` dispara
            `iniciarPrefetchDashboard()` no `beforeLoad` do layout, e ali não há como
            distinguir hover de clique (ver a nota no `beforeLoad`): o mouse passando pelo
            item viraria uma leitura da planilha, cuja cota é COMPARTILHADA com produção.
            O chunk volta a carregar no clique — o que não custa quase nada aqui, porque o
            tempo do `/dashboard` é dominado pelos ~2 s da planilha, não pelo JS.
          */}
          <NavItem to="/dashboard" preload={false} icon={<LayoutDashboard className="h-4 w-4" />}>
            Dashboard
          </NavItem>
          <NavItem to="/especiais" icon={<Star className="h-4 w-4" />}>
            Especiais
          </NavItem>
          <NavItem
            to="/aprovacoes-pendentes"
            icon={<ClipboardList className="h-4 w-4" />}
          >
            Aprovação de pendentes
          </NavItem>
          {/* Vizinho das outras duas telas de decisão (Especiais, Aprovação de pendentes):
              as três são filas onde um admin julga projeto a projeto. */}
          <NavItem to="/aglutinacao" icon={<GitMerge className="h-4 w-4" />}>
            Aglutinação
          </NavItem>
          <NavItem to="/areas" icon={<Building2 className="h-4 w-4" />}>
            Áreas
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
          <NavItem to="/fluxos" icon={<Workflow className="h-4 w-4" />}>
            Fluxos
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
            {/* Enquanto o veredito não chega, o rodapé fica discreto em vez de vazio —
                a identidade não é o que a pessoa veio ver. */}
            {confirmado?.email ?? "Verificando acesso…"}
          </div>
          <div className="text-xs text-sidebar-foreground/60 mt-0.5">Admin</div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
      {verificacao && !confirmado && (
        <GuardaAcesso verificacao={verificacao} aoConfirmar={setConfirmado} />
      )}
    </div>
  );
}

function NavItem({
  to,
  icon,
  children,
  preload,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  /** `false` desliga o preload no hover deste item (ver o "Dashboard" acima). */
  preload?: false;
}) {
  return (
    <Link
      to={to}
      preload={preload}
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
