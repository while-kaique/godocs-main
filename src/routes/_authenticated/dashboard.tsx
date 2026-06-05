import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Hub Admin" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const [roles, setRoles] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      setRoles((roleRows ?? []).map((r) => r.role));

      const { data: la } = await supabase
        .from("leader_areas")
        .select("areas(nome)")
        .eq("user_id", user.id);
      setAreas(
        ((la ?? []) as unknown as Array<{ areas: { nome: string } | null }>)
          .map((r) => r.areas?.nome)
          .filter((n): n is string => !!n),
      );
    })();
  }, [user.id]);

  const isAdmin = roles.includes("admin_master");

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-muted-foreground">
        {isAdmin
          ? "Visão geral da plataforma. Em breve aqui aparecerá a listagem de projetos."
          : "Seus projetos aparecerão aqui assim que a integração com a base de submissões for ativada."}
      </p>

      {!isAdmin && (
        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">Áreas que você lidera</h2>
          {areas.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhuma área vinculada ainda. Solicite ao Admin Master.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {areas.map((a) => (
                <li
                  key={a}
                  className="rounded-full bg-accent px-3 py-1 text-sm text-accent-foreground"
                >
                  {a}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-muted-foreground">
        <p className="text-sm">
          📊 Listagem de projetos (em análise · aprovados · reenvio pendente)
          será habilitada na próxima iteração, quando a leitura dos dados do
          fluxo de submissão estiver conectada.
        </p>
      </div>
    </div>
  );
}
