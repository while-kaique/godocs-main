import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(72),
  nome: z.string().min(1).max(120),
  role: z.enum(["admin_master", "leader"]),
  areaIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

const deleteUserSchema = z.object({ userId: z.string().uuid() });

const updateUserAreasSchema = z.object({
  userId: z.string().uuid(),
  areaIds: z.array(z.string().uuid()).max(50),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin_master")
    .maybeSingle();
  if (error || !data) throw new Error("Acesso negado.");
}

export const createUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createUserSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "Falha ao criar usuário.");
    }

    const newUserId = created.user.id;

    // garante profile (trigger pode ter criado, mas atualizamos o nome)
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: newUserId, nome: data.nome, email: data.email });

    // role
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: data.role });
    if (roleErr) throw new Error(roleErr.message);

    if (data.role === "leader" && data.areaIds.length > 0) {
      const rows = data.areaIds.map((area_id) => ({ user_id: newUserId, area_id }));
      const { error: laErr } = await supabaseAdmin.from("leader_areas").insert(rows);
      if (laErr) throw new Error(laErr.message);
    }

    return { ok: true, userId: newUserId };
  });

export const deleteUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => deleteUserSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    if (data.userId === context.userId) {
      throw new Error("Você não pode remover a si mesmo.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateUserAreasFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateUserAreasSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("leader_areas").delete().eq("user_id", data.userId);
    if (data.areaIds.length > 0) {
      const rows = data.areaIds.map((area_id) => ({ user_id: data.userId, area_id }));
      const { error } = await supabaseAdmin.from("leader_areas").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
