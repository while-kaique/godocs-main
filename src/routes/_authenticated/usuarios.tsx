import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Loader2 } from "lucide-react";

type Role = "admin_master" | "leader";
type Area = { id: string; nome: string };
type Row = {
  id: string;
  nome: string;
  email: string;
  role: Role | null;
  areaIds: string[];
};

export const Route = createFileRoute("/_authenticated/usuarios")({
  component: UsuariosPage,
});

function UsuariosPage() {
  const { user } = Route.useRouteContext();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);

  async function load() {
    const [{ data: profiles }, { data: roles }, { data: la }, { data: ars }] =
      await Promise.all([
        supabase.from("profiles").select("id,nome,email").order("nome"),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("leader_areas").select("user_id,area_id"),
        supabase.from("areas").select("id,nome").order("nome"),
      ]);
    setAreas(ars ?? []);
    const roleMap = new Map<string, Role>();
    (roles ?? []).forEach((r) => roleMap.set(r.user_id, r.role as Role));
    const areaMap = new Map<string, string[]>();
    (la ?? []).forEach((r) => {
      const arr = areaMap.get(r.user_id) ?? [];
      arr.push(r.area_id);
      areaMap.set(r.user_id, arr);
    });
    setRows(
      (profiles ?? []).map((p) => ({
        id: p.id,
        nome: p.nome,
        email: p.email,
        role: roleMap.get(p.id) ?? null,
        areaIds: areaMap.get(p.id) ?? [],
      })),
    );
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Usuários</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre Admins Masters e Leaders. Defina as áreas que cada Leader acompanha.
          </p>
        </div>
        <CreateUserDialog areas={areas} onCreated={load} />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr className="text-left">
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Papel</th>
              <th className="px-4 py-3 font-medium">Áreas</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum usuário ainda.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <UserRow
                  key={r.id}
                  row={r}
                  areas={areas}
                  isSelf={r.email === user.email}
                  onChanged={load}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({
  row,
  areas,
  isSelf,
  onChanged,
}: {
  row: Row;
  areas: Area[];
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(`Remover ${row.nome}?`)) return;
    setLoading(true);
    try {
      await apiFetch("/api/admin/users/delete", { userId: row.id });
      toast.success("Usuário removido.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const areaNames = row.areaIds
    .map((id) => areas.find((a) => a.id === id)?.nome)
    .filter(Boolean) as string[];

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 font-medium">{row.nome}</td>
      <td className="px-4 py-3 text-muted-foreground">{row.email}</td>
      <td className="px-4 py-3">
        {row.role === "admin_master" ? (
          <Badge>Admin Master</Badge>
        ) : row.role === "leader" ? (
          <Badge variant="secondary">Leader</Badge>
        ) : (
          <Badge variant="outline">—</Badge>
        )}
      </td>
      <td className="px-4 py-3">
        {row.role === "leader" ? (
          areaNames.length ? (
            <div className="flex flex-wrap gap-1">
              {areaNames.map((n) => (
                <span key={n} className="rounded bg-muted px-2 py-0.5 text-xs">
                  {n}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">nenhuma</span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1">
          {row.role === "leader" && (
            <EditAreasDialog row={row} areas={areas} onChanged={onChanged} />
          )}
          {!isSelf && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function CreateUserDialog({ areas, onCreated }: { areas: Area[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    email: "",
    password: "",
    role: "leader" as Role,
    areaIds: [] as string[],
  });

  function reset() {
    setForm({ nome: "", email: "", password: "", role: "leader", areaIds: [] });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/api/admin/users", form);
      toast.success("Usuário criado.");
      setOpen(false);
      reset();
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo usuário
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar usuário</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              required
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Senha inicial</Label>
            <Input
              type="text"
              required
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Papel</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v as Role })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="leader">Leader</SelectItem>
                <SelectItem value="admin_master">Admin Master</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.role === "leader" && (
            <div className="space-y-2">
              <Label>Áreas que lidera</Label>
              <AreasPicker
                areas={areas}
                selected={form.areaIds}
                onChange={(ids) => setForm({ ...form, areaIds: ids })}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAreasDialog({
  row,
  areas,
  onChanged,
}: {
  row: Row;
  areas: Area[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(row.areaIds);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setSelected(row.areaIds);
  }, [open, row.areaIds]);

  async function save() {
    setLoading(true);
    try {
      await apiFetch("/api/admin/users/update-areas", { userId: row.id, areaIds: selected });
      toast.success("Áreas atualizadas.");
      setOpen(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Áreas de {row.nome}</DialogTitle>
        </DialogHeader>
        <AreasPicker areas={areas} selected={selected} onChange={setSelected} />
        <DialogFooter>
          <Button onClick={save} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AreasPicker({
  areas,
  selected,
  onChange,
}: {
  areas: Area[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (areas.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma área cadastrada. Crie áreas em &quot;Áreas&quot;.
      </p>
    );
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto rounded-md border border-border p-3">
      {areas.map((a) => (
        <label key={a.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selected.includes(a.id)}
            onCheckedChange={() => toggle(a.id)}
          />
          {a.nome}
        </label>
      ))}
    </div>
  );
}
