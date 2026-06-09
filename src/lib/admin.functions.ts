import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Areas
export const getAreasFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin.from("areas").select("*").order("nome");
    if (error) throw new Error(error.message);
    return data;
  });

export const createAreaFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ nome: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { data: area, error } = await supabaseAdmin
      .from("areas").insert({ nome: data.nome }).select().single();
    if (error) throw new Error(error.message);
    return area;
  });

export const deleteAreaFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("areas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Admins
export const getAdminsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin.from("admins").select("*").order("email");
    if (error) throw new Error(error.message);
    return data;
  });

export const addAdminFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), nome: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { data: admin, error } = await supabaseAdmin
      .from("admins").insert({ email: data.email, nome: data.nome }).select().single();
    if (error) throw new Error(error.message);
    return admin;
  });

export const removeAdminFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: admin } = await supabaseAdmin
      .from("admins").select("email").eq("id", data.id).single();
    if (admin?.email === context.email) {
      throw new Error("Você não pode remover a si mesmo.");
    }
    const { error } = await supabaseAdmin.from("admins").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Projetos
export const getProjetosFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("projetos").select("*, areas(nome)").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const getProjetoDetalhesFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: projeto, error } = await supabaseAdmin
      .from("projetos")
      .select("*, areas(nome), chat_messages(*), documentacao(*), validacoes(*)")
      .eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return projeto;
  });

// Usuarios
export const createUserFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({
      nome: z.string().min(1).max(120),
      email: z.string().email(),
      password: z.string().min(6),
      role: z.enum(["admin_master", "leader"]),
      areaIds: z.array(z.string().uuid()).default([]),
    }).parse(d))
  .handler(async ({ data }) => {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error) throw new Error(error.message);
    const userId = created.user.id;
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, nome: data.nome, email: data.email }, { onConflict: "id" });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleError } = await supabaseAdmin
      .from("user_roles").insert({ user_id: userId, role: data.role });
    if (roleError) throw new Error(roleError.message);
    if (data.role === "leader" && data.areaIds.length) {
      const { error: areasError } = await supabaseAdmin
        .from("leader_areas")
        .insert(data.areaIds.map((area_id) => ({ user_id: userId, area_id })));
      if (areasError) throw new Error(areasError.message);
    }
    return { id: userId };
  });

export const deleteUserFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: alvo } = await supabaseAdmin
      .from("profiles").select("email").eq("id", data.userId).maybeSingle();
    if (alvo?.email && alvo.email === context.email) {
      throw new Error("Você não pode remover a si mesmo.");
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateUserAreasFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({
      userId: z.string().uuid(),
      areaIds: z.array(z.string().uuid()).default([]),
    }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("leader_areas").delete().eq("user_id", data.userId);
    if (data.areaIds.length) {
      const { error } = await supabaseAdmin
        .from("leader_areas")
        .insert(data.areaIds.map((area_id) => ({ user_id: data.userId, area_id })));
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// Configuracoes
export const getConfiguracoesFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("configuracoes").select("*").order("chave");
    if (error) throw new Error(error.message);
    return data;
  });

export const updateConfiguracaoFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ chave: z.string(), valor: z.unknown() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("configuracoes")
      .update({ valor: data.valor as never, updated_by: context.email })
      .eq("chave", data.chave);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
