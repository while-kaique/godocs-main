import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Areas ───────────────────────────────────────────────────────────────────

export const getAreasFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("areas")
      .select("*")
      .order("nome");
    if (error) throw new Error(error.message);
    return data;
  });

export const createAreaFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ nome: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { data: area, error } = await supabaseAdmin
      .from("areas")
      .insert({ nome: data.nome })
      .select()
      .single();
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

// ─── Admins ──────────────────────────────────────────────────────────────────

export const getAdminsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("admins")
      .select("*")
      .order("email");
    if (error) throw new Error(error.message);
    return data;
  });

export const addAdminFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), nome: z.string().optional() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { data: admin, error } = await supabaseAdmin
      .from("admins")
      .insert({ email: data.email, nome: data.nome })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return admin;
  });

export const removeAdminFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: admin } = await supabaseAdmin
      .from("admins")
      .select("email")
      .eq("id", data.id)
      .single();
    if (admin?.email === context.email) {
      throw new Error("Você não pode remover a si mesmo.");
    }
    const { error } = await supabaseAdmin.from("admins").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Projetos ─────────────────────────────────────────────────────────────────

export const getProjetosFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("projetos")
      .select("*, areas(nome)")
      .order("created_at", { ascending: false });
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
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return projeto;
  });

// ─── Configurações ────────────────────────────────────────────────────────────

export const getConfiguracoesFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("configuracoes")
      .select("*")
      .order("chave");
    if (error) throw new Error(error.message);
    return data;
  });

export const updateConfiguracaoFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ chave: z.string(), valor: z.unknown() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("configuracoes")
      .update({ valor: data.valor as never, updated_by: context.email })
      .eq("chave", data.chave);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
