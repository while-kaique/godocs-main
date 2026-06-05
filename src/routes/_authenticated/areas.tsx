import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";

type Area = { id: string; nome: string };

export const Route = createFileRoute("/_authenticated/areas")({
  head: () => ({ meta: [{ title: "Áreas · Hub Admin" }] }),
  component: AreasPage,
});

function AreasPage() {
  const { user } = Route.useRouteContext();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const { data } = await supabase.from("areas").select("id,nome").order("nome");
    setAreas(data ?? []);
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin_master")
        .maybeSingle();
      setIsAdmin(!!data);
      if (data) await load();
    })();
  }, [user.id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!novoNome.trim()) return;
    setLoading(true);
    const { error } = await supabase
      .from("areas")
      .insert({ nome: novoNome.trim() });
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      setNovoNome("");
      toast.success("Área criada.");
      load();
    }
  }

  async function remove(a: Area) {
    if (!confirm(`Remover área "${a.nome}"? Vínculos com leaders serão removidos.`))
      return;
    const { error } = await supabase.from("areas").delete().eq("id", a.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Área removida.");
      load();
    }
  }

  if (isAdmin === null)
    return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!isAdmin)
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Sem permissão</h1>
        <p className="text-muted-foreground">Apenas Admin Master pode gerenciar áreas.</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold tracking-tight">Áreas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Cadastre as áreas/departamentos da empresa. Leaders são vinculados às áreas que acompanham.
      </p>

      <form onSubmit={create} className="mt-6 flex gap-2">
        <Input
          placeholder="Nome da área (ex.: TI, RH, Operações)"
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
        />
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        {areas === null ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : areas.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma área cadastrada.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {areas.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{a.nome}</span>
                <Button variant="ghost" size="sm" onClick={() => remove(a)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
