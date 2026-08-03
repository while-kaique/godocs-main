// Fila de pré-aprovação do líder (F1 da SPEC_APROVACAO_LIDER).
//
// A pessoa que lidera um time vê aqui os projetos do time esperando o parecer dela,
// lê a documentação em /projeto/$id (read-only, memorial SEM R$) e aprova ou pede
// ajuste — com o comentário obrigatório na reprovação, porque é o texto que o autor lê.
//
// Identidade GoGroup, mesma linguagem visual de /meus-projetos (header azul + onda
// creme + cards brancos, Poppins). Estado NUNCA só por cor: rótulo + ícone sempre.
// A triagem da equipe RPA segue em paralelo (D3) — a copy diz isso, para o líder não
// achar que o projeto está travado esperando por ele.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { fmtDataBR } from "@/lib/format-date";
import {
  BadgeCheck,
  CheckCircle2,
  Eye,
  Loader2,
  MessageSquareWarning,
  ShieldCheck,
  Users,
} from "lucide-react";

type ItemAprovacao = {
  projeto_id: string;
  projeto_nome: string | null;
  autor_nome: string | null;
  autor_email: string | null;
  area: string | null;
  submitted_at: string | null;
  tipos_projeto: string[];
  especial: boolean;
  criado_em: string | null;
};

type Fila = { lidera: boolean; itens: ItemAprovacao[] };

const TIPO_LABEL: Record<string, string> = {
  saving: "Saving",
  receita_incremental: "Receita incremental",
  especial: "Especial",
};

function fmtDate(iso: string | null): string {
  return iso ? fmtDataBR(iso) : "—";
}

export const Route = createFileRoute("/aprovacoes")({
  component: AprovacoesPage,
});

function AprovacoesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["aprovacoes-pendentes"],
    queryFn: () => apiFetch<Fila>("/api/aprovacoes/pendentes"),
    staleTime: 30_000,
  });
  // Projeto cuja caixa de comentário está aberta (só na reprovação).
  const [reprovando, setReprovando] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);

  const itens = data?.itens ?? [];
  const erro = error ? (error instanceof Error ? error.message : "Erro ao carregar a fila.") : null;

  function removerDaFila(projetoId: string) {
    queryClient.setQueryData<Fila>(["aprovacoes-pendentes"], (old) =>
      old ? { ...old, itens: old.itens.filter((i) => i.projeto_id !== projetoId) } : old,
    );
  }

  async function decidir(projetoId: string, veredito: "aprovado" | "reprovado", texto?: string) {
    setEnviando(projetoId);
    try {
      await apiFetch(
        "/api/aprovacoes/decidir",
        { projeto_id: projetoId, veredito, comentario: texto ?? null },
        "POST",
      );
      removerDaFila(projetoId);
      setReprovando(null);
      setComentario("");
      toast.success(
        veredito === "aprovado"
          ? "Projeto aprovado. O autor e a equipe RPA já veem seu parecer."
          : "Ajuste solicitado. O autor recebe o seu comentário.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar sua decisão.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div
      className="min-h-screen px-2.5 pb-2.5"
      style={{ background: "var(--go-blue)", fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{
          background: "var(--go-bg-page)",
          borderRadius: "0 0 var(--go-radius-xl) var(--go-radius-xl)",
        }}
      >
        {/* Header azul + onda creme (mesma assinatura das telas internas) */}
        <div className="relative" style={{ background: "var(--go-blue)", minHeight: 180 }}>
          <div className="absolute bottom-0 left-0 right-0">
            <svg
              viewBox="0 0 1440 60"
              preserveAspectRatio="none"
              className="block w-full"
              style={{ height: 40 }}
            >
              <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--go-cream)" />
            </svg>
          </div>
          <div className="relative z-10 mx-auto max-w-4xl px-8 py-10">
            <Link
              to="/"
              className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold opacity-80 transition-opacity hover:opacity-100"
              style={{ color: "var(--go-white)" }}
            >
              ← Início
            </Link>
            <h1
              className="font-extrabold tracking-tight"
              style={{ fontSize: "clamp(1.6rem,4vw,2.2rem)", color: "var(--go-white)" }}
            >
              Aprovações do meu time
            </h1>
            <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
              Projetos que pessoas do seu time submeteram e esperam o seu parecer.
            </p>
          </div>
        </div>

        <main className="mx-auto max-w-4xl px-8 py-8">
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-blue)" }} />
            </div>
          )}

          {!isLoading && erro && (
            <div
              className="rounded-xl p-6 text-center text-sm"
              style={{
                background: "rgba(220,38,38,0.05)",
                border: "1px solid rgba(220,38,38,0.15)",
                color: "#dc2626",
              }}
            >
              {erro}
            </div>
          )}

          {!isLoading && !erro && (
            <>
              {/* Como funciona: a pré-aprovação não trava a triagem da RPA (D3). */}
              <div
                className="mb-6 flex items-start gap-2.5 rounded-xl px-4 py-3 text-[12px] leading-snug"
                style={{
                  background: "rgba(0,89,169,0.05)",
                  border: "1px solid rgba(0,89,169,0.12)",
                  color: "var(--go-blue)",
                }}
              >
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Seu parecer é a leitura de quem conhece o time — a validação da equipe RPA
                  corre em paralelo, então nada fica parado esperando você. Abra a documentação
                  antes de decidir; ao pedir ajuste, escreva o que precisa mudar (o autor lê
                  esse texto).
                </p>
              </div>

              {itens.length === 0 && (
                <div
                  className="rounded-xl p-10 text-center"
                  style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)" }}
                >
                  <BadgeCheck
                    className="mx-auto mb-3 h-10 w-10 opacity-30"
                    style={{ color: "var(--go-blue)" }}
                  />
                  <p className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
                    Nada esperando você
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "#8b8b9a" }}>
                    {data?.lidera
                      ? "Quando alguém do seu time submeter um projeto, ele aparece aqui e você recebe um aviso no Chat."
                      : "Esta fila é de quem lidera um time na TeamGuide. Se você lidera e não vê seus liderados aqui, fale com a equipe RPA."}
                  </p>
                  <Link
                    to="/meus-projetos"
                    className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all"
                    style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                  >
                    Ver meus projetos
                  </Link>
                </div>
              )}

              {itens.length > 0 && (
                <div className="space-y-3">
                  {itens.map((i) => {
                    const ocupado = enviando === i.projeto_id;
                    const pedindoAjuste = reprovando === i.projeto_id;
                    return (
                      <div
                        key={i.projeto_id}
                        className="overflow-hidden rounded-xl p-5"
                        style={{
                          background: "var(--go-white)",
                          border: "1px solid rgba(0,89,169,0.08)",
                          boxShadow: "var(--go-shadow-sm)",
                        }}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="truncate font-semibold"
                                style={{ color: "var(--go-text-heading)", fontSize: 15 }}
                              >
                                {i.projeto_nome ?? "(sem nome)"}
                              </span>
                              {i.especial && (
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                                  style={{ background: "var(--go-lime)", color: "var(--go-blue)" }}
                                >
                                  Especial
                                </span>
                              )}
                              {i.tipos_projeto
                                .filter((t) => t !== "especial")
                                .map((t) => (
                                  <span
                                    key={t}
                                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                    style={{
                                      background: "rgba(0,89,169,0.08)",
                                      color: "var(--go-blue)",
                                    }}
                                  >
                                    {TIPO_LABEL[t] ?? t}
                                  </span>
                                ))}
                            </div>
                            <div
                              className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
                              style={{ color: "#8b8b9a" }}
                            >
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3.5 w-3.5" />
                                {i.autor_nome || i.autor_email || "—"}
                              </span>
                              {i.area && <span>{i.area}</span>}
                              <span>Enviado em {fmtDate(i.submitted_at)}</span>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                            <Link
                              to="/projeto/$id"
                              params={{ id: i.projeto_id }}
                              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
                              style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Ler documentação
                            </Link>
                            <button
                              type="button"
                              onClick={() => {
                                setReprovando(pedindoAjuste ? null : i.projeto_id);
                                setComentario("");
                              }}
                              disabled={ocupado}
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all disabled:opacity-50"
                              style={{ background: "rgba(180,83,9,0.1)", color: "#b45309" }}
                            >
                              <MessageSquareWarning className="h-3.5 w-3.5" />
                              Pedir ajuste
                            </button>
                            <button
                              type="button"
                              onClick={() => decidir(i.projeto_id, "aprovado")}
                              disabled={ocupado}
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all disabled:opacity-50"
                              style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
                            >
                              {ocupado ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Aprovar
                            </button>
                          </div>
                        </div>

                        {/* Caixa de ajuste: abre no próprio card, comentário obrigatório. */}
                        {pedindoAjuste && (
                          <div
                            className="mt-4 rounded-lg p-4"
                            style={{
                              background: "rgba(180,83,9,0.05)",
                              border: "1px solid rgba(180,83,9,0.15)",
                            }}
                          >
                            <label
                              htmlFor={`ajuste-${i.projeto_id}`}
                              className="mb-1.5 block text-[12px] font-semibold"
                              style={{ color: "#b45309" }}
                            >
                              O que precisa ser ajustado?
                            </label>
                            <textarea
                              id={`ajuste-${i.projeto_id}`}
                              value={comentario}
                              onChange={(e) => setComentario(e.target.value)}
                              rows={3}
                              maxLength={2000}
                              placeholder="Ex.: as horas do time fiscal estão altas para o volume atual — confira a frequência antes de reenviar."
                              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                              style={{
                                background: "var(--go-white)",
                                border: "1.5px solid rgba(180,83,9,0.25)",
                                color: "var(--go-text-heading)",
                              }}
                            />
                            <div className="mt-2.5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setReprovando(null);
                                  setComentario("");
                                }}
                                className="cursor-pointer rounded-lg px-4 py-2 text-[12px] font-bold transition-colors"
                                style={{
                                  background: "transparent",
                                  color: "#6b6b7a",
                                  border: "1.5px solid rgba(0,0,0,0.12)",
                                }}
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => decidir(i.projeto_id, "reprovado", comentario.trim())}
                                disabled={ocupado || comentario.trim().length === 0}
                                className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold text-white transition-colors disabled:opacity-50"
                                style={{ background: "#b45309", border: "1.5px solid #b45309" }}
                              >
                                {ocupado ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <MessageSquareWarning className="h-3.5 w-3.5" />
                                )}
                                Enviar pedido de ajuste
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
