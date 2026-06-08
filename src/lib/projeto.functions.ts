import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server functions públicas (sem auth de admin) para o fluxo de submissão

const step1Schema = z.object({
  responsavel_nome: z.string().min(1).max(120),
  responsavel_email: z.string().email().max(255),
  area_id: z.string().uuid().optional(),
  ferramenta: z.string().min(1).max(100),
  membros: z.array(z.string()).default([]),
});

export const criarProjetoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => step1Schema.parse(d))
  .handler(async ({ data }) => {
    const { data: projeto, error } = await supabaseAdmin
      .from("projetos")
      .insert({
        responsavel_nome: data.responsavel_nome,
        responsavel_email: data.responsavel_email,
        area_id: data.area_id,
        ferramenta: data.ferramenta,
        membros: data.membros,
        status: "rascunho",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return projeto;
  });

export const salvarMensagemFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      projeto_id: z.string().uuid(),
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1),
      options: z.array(z.string()).optional(),
      selected_option: z.number().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { data: msg, error } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        projeto_id: data.projeto_id,
        role: data.role,
        content: data.content,
        options: data.options ?? null,
        selected_option: data.selected_option ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return msg;
  });

export const getChatHistoricoFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ projeto_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: msgs, error } = await supabaseAdmin
      .from("chat_messages")
      .select("*")
      .eq("projeto_id", data.projeto_id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return msgs;
  });

export const salvarDocumentacaoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      projeto_id: z.string().uuid(),
      conteudo: z.record(z.unknown()),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("documentacao")
      .upsert({
        projeto_id: data.projeto_id,
        conteudo: data.conteudo as never,
      });
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("projetos")
      .update({ chat_completo: true })
      .eq("id", data.projeto_id);

    return { ok: true };
  });

export const submeterProjetoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ projeto_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("projetos")
      .update({ status: "em_validacao", submitted_at: new Date().toISOString() })
      .eq("id", data.projeto_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
