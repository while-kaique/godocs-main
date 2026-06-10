import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
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
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const data = await apiFetch<Area[]>("/api/admin/areas");
      setAreas(data ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar áreas.");
      setAreas([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!novoNome.trim()) return;
    setLoading(true);
    try {
      await apiFetch("/api/admin/areas", { nome: novoNome.trim() });
      setNovoNome("");
      toast.success("Área criada.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar área.");
    } finally {
      setLoading(false);
    }
  }

  async function remove(a: Area) {
    if (!confirm(`Remover área "${a.nome}"? Vínculos com leaders serão removidos.`))
      return;
    try {
      await apiFetch("/api/admin/areas/remove", { id: a.id });
      toast.success("Área removida.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover área.");
    }
  }

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
