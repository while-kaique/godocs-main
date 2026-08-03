// Fila de PRÉ-APROVAÇÃO do líder (F1 da SPEC_APROVACAO_LIDER).
//
// A pessoa que lidera um time vê aqui os projetos do time esperando a leitura dela e
// dá o parecer sem sair da tela: o card já traz dono, participantes, saving e memorial
// (pedido do Lucas, 03/08/2026 — "o mais fácil, rápido e intuitivo possível pro líder").
//
// Antes de decidir, o líder responde 3 perguntas de sim/não (CHECKLIST_APROVACAO) — é
// o que só quem conhece a área sabe responder, e é o que a triagem da equipe RPA lê.
//
// Nomenclatura: é PRÉ-aprovação, nunca "aprovação". O parecer do líder não decide o
// projeto e não trava a triagem da RPA (D3) — a copy repete isso onde o líder decide.
//
// Identidade GoGroup (header azul + onda creme + cards brancos, Poppins). Estado NUNCA
// só por cor: rótulo + ícone sempre.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { fmtDataBR } from "@/lib/format-date";
import { SimpleMarkdown } from "@/lib/submeter/step3-chat";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  CHECKLIST_APROVACAO,
  checklistCompleto,
  type ChaveChecklist,
  type RespostaChecklist,
} from "@/lib/aprovacoes-checklist";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  MessageSquareWarning,
  Sparkles,
  User,
  Users,
} from "lucide-react";

type Participante = { nome: string; email: string; papel: string };

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
  descricao_breve: string | null;
  participantes: Participante[];
  saving_horas: number | null;
  saving_reais: number | null;
  tipo_saving: string | null;
  ganho_total: number | null;
  custo_evitado_reais: number | null;
  custo_externo_mensal: number | null;
  receita_mensal: number | null;
  memorial: string | null;
  resumo_ia: string | null;
};

type Fila = {
  lidera: boolean;
  itens: ItemAprovacao[];
  /** E-mail da fila que estou vendo, quando um admin abre com `?como=` (validação). */
  visualizando_como?: string | null;
};

type Respostas = Partial<Record<ChaveChecklist, RespostaChecklist>>;

const TIPO_LABEL: Record<string, string> = {
  saving: "Saving",
  receita_incremental: "Receita incremental",
  especial: "Especial",
};

// Recorrência do ganho, com o mesmo vocabulário do formulário (Etapa 2).
const TIPO_SAVING_LABEL: Record<string, string> = {
  mensal: "Recorrente (mensal)",
  pontual: "Pontual (uma vez)",
  trimestral: "A cada trimestre",
  semestral: "A cada semestre",
};

// Mesma régua de unidade do saving usada no chat: trimestral/semestral mostram o
// acumulado do período, pontual é total único.
function unidadeHoras(tipo: string | null): string {
  if (tipo === "trimestral") return "h/trimestre";
  if (tipo === "semestral") return "h/semestre";
  if (tipo === "pontual") return "h (total único)";
  return "h/mês";
}

function fmtHoras(h: number | null, tipo: string | null): string | null {
  if (!h || h <= 0) return null;
  const n = h.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `${n} ${unidadeHoras(tipo)}`;
}

function fmtReais(v: number | null): string | null {
  if (!v || v <= 0) return null;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  return iso ? fmtDataBR(iso) : "—";
}

export const Route = createFileRoute("/aprovacoes")({
  component: AprovacoesPage,
});

function AprovacoesPage() {
  const queryClient = useQueryClient();
  // `?como=` só funciona para admin (o servidor ignora para os demais) — é o caminho de
  // validação da tela: abrir a fila do líder sem ser ele.
  const como = new URLSearchParams(window.location.search).get("como")?.trim() ?? "";
  const { data, isLoading, error } = useQuery({
    queryKey: ["aprovacoes-pendentes", como],
    queryFn: () =>
      apiFetch<Fila>(`/api/aprovacoes/pendentes${como ? `?como=${encodeURIComponent(como)}` : ""}`),
    staleTime: 30_000,
  });

  // Estado por projeto: respostas do checklist, caixa de ajuste aberta e envio em curso.
  const [respostas, setRespostas] = useState<Record<string, Respostas>>({});
  const [memorialAberto, setMemorialAberto] = useState<Record<string, boolean>>({});
  const [pedindoAjuste, setPedindoAjuste] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);

  const itens = data?.itens ?? [];
  const erro = error ? (error instanceof Error ? error.message : "Erro ao carregar a fila.") : null;

  function marcar(projetoId: string, chave: ChaveChecklist, valor: RespostaChecklist) {
    setRespostas((prev) => ({ ...prev, [projetoId]: { ...prev[projetoId], [chave]: valor } }));
  }

  function removerDaFila(projetoId: string) {
    queryClient.setQueryData<Fila>(["aprovacoes-pendentes", como], (old) =>
      old ? { ...old, itens: old.itens.filter((i) => i.projeto_id !== projetoId) } : old,
    );
  }

  async function decidir(projetoId: string, veredito: "aprovado" | "reprovado", texto?: string) {
    setEnviando(projetoId);
    try {
      await apiFetch(
        "/api/aprovacoes/decidir",
        {
          projeto_id: projetoId,
          veredito,
          comentario: texto ?? null,
          respostas: respostas[projetoId] ?? {},
          ...(como ? { como } : {}),
        },
        "POST",
      );
      removerDaFila(projetoId);
      setPedindoAjuste(null);
      setComentario("");
      toast.success(
        veredito === "aprovado"
          ? "Projeto pré-aprovado. O autor e a equipe RPA já veem o seu parecer."
          : "Ajuste solicitado. O autor recebe o seu comentário.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar o seu parecer.");
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
        <div className="relative" style={{ background: "var(--go-blue)", minHeight: 108 }}>
          <div className="absolute bottom-0 left-0 right-0">
            <svg
              viewBox="0 0 1440 60"
              preserveAspectRatio="none"
              className="block w-full"
              style={{ height: 26 }}
            >
              <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--go-cream)" />
            </svg>
          </div>
          <div className="relative z-10 mx-auto max-w-4xl px-8 pb-7 pt-5">
            <Link
              to="/"
              className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold opacity-80 transition-opacity hover:opacity-100"
              style={{ color: "var(--go-white)" }}
            >
              ← Início
            </Link>
            {/* O título já explica a página; o "i" carrega o resto (o que é
                pré-aprovação, que a RPA valida em paralelo) sem ocupar a tela. */}
            <div className="flex items-center gap-2">
              <h1
                className="font-extrabold tracking-tight"
                style={{ fontSize: "clamp(1.35rem,3vw,1.7rem)", color: "var(--go-white)" }}
              >
                Pré-aprovações do meu time
              </h1>
              <span style={{ color: "var(--go-white)" }}>
                <InfoTooltip
                  label="O que é esta página"
                  text="Aqui ficam os projetos que pessoas do seu time submeteram e esperam a sua leitura. Você responde 3 perguntas rápidas e dá o parecer: pré-aprovar ou pedir ajuste. É uma pré-aprovação, não a decisão final: a equipe RPA valida cada projeto em paralelo, então nada fica parado esperando você."
                />
              </span>
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-4xl px-8 pb-8 pt-4">
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
                <div className="space-y-4">
                  {itens.map((i) => (
                    <CardAprovacao
                      key={i.projeto_id}
                      item={i}
                      respostas={respostas[i.projeto_id] ?? {}}
                      onResponder={(chave, valor) => marcar(i.projeto_id, chave, valor)}
                      memorialAberto={!!memorialAberto[i.projeto_id]}
                      onToggleMemorial={() =>
                        setMemorialAberto((p) => ({ ...p, [i.projeto_id]: !p[i.projeto_id] }))
                      }
                      ocupado={enviando === i.projeto_id}
                      pedindoAjuste={pedindoAjuste === i.projeto_id}
                      onAbrirAjuste={() => {
                        setPedindoAjuste(pedindoAjuste === i.projeto_id ? null : i.projeto_id);
                        setComentario("");
                      }}
                      comentario={comentario}
                      onComentario={setComentario}
                      onAprovar={() => decidir(i.projeto_id, "aprovado")}
                      onPedirAjuste={() =>
                        decidir(i.projeto_id, "reprovado", comentario.trim())
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Card de um projeto ──────────────────────────────────────────────────────

function CardAprovacao({
  item: i,
  respostas,
  onResponder,
  memorialAberto,
  onToggleMemorial,
  ocupado,
  pedindoAjuste,
  onAbrirAjuste,
  comentario,
  onComentario,
  onAprovar,
  onPedirAjuste,
}: {
  item: ItemAprovacao;
  respostas: Respostas;
  onResponder: (chave: ChaveChecklist, valor: RespostaChecklist) => void;
  memorialAberto: boolean;
  onToggleMemorial: () => void;
  ocupado: boolean;
  pedindoAjuste: boolean;
  onAbrirAjuste: () => void;
  comentario: string;
  onComentario: (v: string) => void;
  onAprovar: () => void;
  onPedirAjuste: () => void;
}) {
  const completo = checklistCompleto(respostas);
  const faltam = CHECKLIST_APROVACAO.filter((p) => !respostas[p.chave]).length;
  const horas = fmtHoras(i.saving_horas, i.tipo_saving);
  const reais = fmtReais(i.saving_reais);

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--go-white)",
        border: "1px solid rgba(0,89,169,0.08)",
        boxShadow: "var(--go-shadow-sm)",
      }}
    >
      {/* ── Zona 1: o que é o projeto ───────────────────────────────────────── */}
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-bold"
            style={{ color: "var(--go-text-heading)", fontSize: 16, lineHeight: 1.3 }}
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
                style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
              >
                {TIPO_LABEL[t] ?? t}
              </span>
            ))}
          <span
            className="ml-auto inline-flex items-center gap-1 text-[11px]"
            style={{ color: "#a5a5b3" }}
          >
            <Clock className="h-3.5 w-3.5" />
            Enviado em {fmtDate(i.submitted_at)}
          </span>
        </div>

        {i.descricao_breve && (
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "#6b6b7a" }}>
            {i.descricao_breve}
          </p>
        )}

        {/* Dono e participantes. Sem participantes, a coluna nem aparece — o projeto é
            só do dono e uma coluna vazia só rouba espaço. */}
        <div
          className={`mt-4 grid gap-3 ${i.participantes.length > 0 ? "sm:grid-cols-2" : ""}`}
        >
          <Bloco icone={<User className="h-3.5 w-3.5" />} titulo="Dono">
            <span className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
              {i.autor_nome || i.autor_email || "—"}
            </span>
            {i.area && (
              <span className="block text-[11px]" style={{ color: "#a5a5b3" }}>
                {i.area}
              </span>
            )}
          </Bloco>

          {i.participantes.length > 0 && (
            <Bloco icone={<Users className="h-3.5 w-3.5" />} titulo="Participantes">
              <ul className="space-y-0.5">
                {i.participantes.map((p) => (
                  <li key={p.email}>
                    <span className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
                      {p.nome}
                    </span>
                    <span className="text-[11px]" style={{ color: "#a5a5b3" }}>
                      {" "}
                      · {p.papel}
                    </span>
                  </li>
                ))}
              </ul>
            </Bloco>
          )}
        </div>

        {/* Um card por número, todos no mesmo nível (o ganho total é o primeiro, com a
            barra lime). O resumo do projeto vem DEPOIS, ocupando o card inteiro, porque é
            texto corrido e não cabe numa coluna estreita. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CardNumero
            rotulo="Ganho total"
            valor={fmtReais(i.ganho_total) ?? fmtReais(i.saving_reais)}
            destaque
            vazio={i.especial ? "Projeto especial" : undefined}
          />
          <CardNumero rotulo="Horas economizadas" valor={horas} />
          <CardNumero rotulo="Recorrência" valor={TIPO_SAVING_LABEL[i.tipo_saving ?? ""] ?? null} />
          <CardNumero rotulo="Saving em R$" valor={reais} />
          <CardNumero rotulo="Custo evitado" valor={fmtReais(i.custo_evitado_reais)} />
          <CardNumero rotulo="Receita mensal" valor={fmtReais(i.receita_mensal)} />
          {/* Custo externo é o que a solução CONSOME para rodar — subtrai do ganho. */}
          <CardNumero rotulo="Custo externo" valor={fmtReais(i.custo_externo_mensal)} negativo />
        </div>

        {i.resumo_ia && (
          <div
            className="mt-2 rounded-lg px-3.5 py-2.5"
            style={{ background: "rgba(0,89,169,0.04)", border: "1px solid rgba(0,89,169,0.1)" }}
          >
            <p
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ color: "#8b8b9a" }}
            >
              <Sparkles className="h-3 w-3" />
              Resumo do projeto
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "#4b4b5a" }}>
              {i.resumo_ia}
            </p>
          </div>
        )}

        {/* Memorial: fica fechado por padrão para o card não virar parede de texto */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {i.memorial && (
            <button
              type="button"
              onClick={onToggleMemorial}
              aria-expanded={memorialAberto}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
              style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
            >
              <FileText className="h-3.5 w-3.5" />
              {memorialAberto ? "Fechar memorial" : "Ver memorial do cálculo"}
              <ChevronDown
                className="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
                style={{ transform: memorialAberto ? "rotate(180deg)" : "none" }}
              />
            </button>
          )}
          {/* Nova aba de propósito: o líder não perde o checklist já marcado no card. */}
          <a
            href={`/projeto/${i.projeto_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
            style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
          >
            <Eye className="h-3.5 w-3.5" />
            Ler a documentação completa
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {memorialAberto && i.memorial && (
          <div
            className="mt-3 max-h-96 overflow-y-auto rounded-lg px-4 py-3 text-[13px]"
            style={{ background: "var(--go-cream)", border: "1px solid rgba(0,89,169,0.1)" }}
          >
            <SimpleMarkdown text={i.memorial} isSaving />
          </div>
        )}
      </div>

      {/* ── Zona 2: o parecer do líder ──────────────────────────────────────── */}
      <div
        className="px-5 py-4"
        style={{ background: "rgba(0,89,169,0.03)", borderTop: "1px solid rgba(0,89,169,0.08)" }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
            Seu parecer
          </p>
          <p className="text-[11px]" style={{ color: completo ? "#15803d" : "#8b8b9a" }}>
            {completo
              ? "3 de 3 respondidas"
              : `Faltam ${faltam} de 3 perguntas`}
          </p>
        </div>

        <div className="mt-2.5 space-y-2">
          {CHECKLIST_APROVACAO.map((p) => {
            const marcada = respostas[p.chave];
            return (
              <div
                key={p.chave}
                className="flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                style={{
                  background: "var(--go-white)",
                  border: marcada
                    ? "1.5px solid rgba(0,89,169,0.25)"
                    : "1.5px solid rgba(0,0,0,0.07)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="flex items-start gap-1.5 text-[13px] font-semibold"
                    style={{ color: "var(--go-text-heading)" }}
                  >
                    {/* Estado por ícone + borda, nunca só por cor */}
                    {marcada && (
                      <Check
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        style={{ color: "var(--go-blue)" }}
                      />
                    )}
                    {p.pergunta}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "#8b8b9a" }}>
                    {p.ajuda}
                  </p>
                </div>
                <div
                  className="flex shrink-0 gap-1 self-start rounded-full p-1 sm:self-auto"
                  style={{ background: "rgba(0,0,0,0.04)" }}
                  role="group"
                  aria-label={p.pergunta}
                >
                  {(["sim", "nao"] as RespostaChecklist[]).map((v) => {
                    const ativo = marcada === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => onResponder(p.chave, v)}
                        aria-pressed={ativo}
                        className="cursor-pointer rounded-full px-4 py-1.5 text-[12px] font-bold transition-all"
                        style={{
                          background: ativo ? "var(--go-blue)" : "transparent",
                          color: ativo ? "var(--go-white)" : "#6b6b7a",
                        }}
                      >
                        {v === "sim" ? "Sim" : "Não"}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Um "Não" é sinal, não veto — o líder precisa saber disso antes de travar. */}
        {completo && Object.values(respostas).some((v) => v === "nao") && (
          <p className="mt-2.5 text-[11px] leading-snug" style={{ color: "#b45309" }}>
            Respondeu "Não" em algo? Pode pré-aprovar do mesmo jeito — a resposta vai junto para a
            triagem da RPA. Se o projeto precisa mudar antes, peça o ajuste.
          </p>
        )}

        <div className="mt-3.5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onAbrirAjuste}
            disabled={ocupado || !completo}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "rgba(180,83,9,0.1)", color: "#b45309" }}
          >
            <MessageSquareWarning className="h-3.5 w-3.5" />
            Pedir ajuste
          </button>
          <button
            type="button"
            onClick={onAprovar}
            disabled={ocupado || !completo}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
          >
            {ocupado ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BadgeCheck className="h-3.5 w-3.5" />
            )}
            Pré-aprovar
          </button>
        </div>
        {!completo && (
          <p className="mt-2 text-right text-[11px]" style={{ color: "#8b8b9a" }}>
            Responda as 3 perguntas para liberar o parecer.
          </p>
        )}

        {/* Caixa de ajuste: comentário obrigatório, é o texto que o autor lê. */}
        {pedindoAjuste && (
          <div
            className="mt-3 rounded-lg p-4"
            style={{ background: "rgba(180,83,9,0.05)", border: "1px solid rgba(180,83,9,0.15)" }}
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
              onChange={(e) => onComentario(e.target.value)}
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
                onClick={onAbrirAjuste}
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
                onClick={onPedirAjuste}
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
    </div>
  );
}

/**
 * Um card por número do ganho. Sem valor mostra "Não declarado" em vez de desaparecer:
 * o líder precisa saber que o campo não foi preenchido (era o pedido do Luis).
 */
function CardNumero({
  rotulo,
  valor,
  negativo,
  destaque,
  vazio,
}: {
  rotulo: string;
  valor: string | null;
  negativo?: boolean;
  /** O número que resume o projeto: fonte maior + barra lime da identidade. */
  destaque?: boolean;
  /** Texto quando não há valor (default "Não declarado"). */
  vazio?: string;
}) {
  return (
    <div
      className="rounded-lg px-2.5 py-2"
      style={{
        background: "var(--go-white)",
        border: "1px solid rgba(0,89,169,0.1)",
        borderLeft: destaque ? "3px solid var(--go-lime)" : undefined,
      }}
    >
      <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "#8b8b9a" }}>
        {rotulo}
      </p>
      <p
        className={destaque ? "mt-0.5 font-extrabold" : "mt-0.5 font-bold"}
        style={{
          fontSize: destaque ? 17 : 13.5,
          color: valor
            ? negativo
              ? "#b45309"
              : destaque
                ? "var(--go-blue)"
                : "var(--go-text-heading)"
            : "#a5a5b3",
        }}
      >
        {valor ? (negativo ? `− ${valor}` : valor) : (vazio ?? "Não declarado")}
      </p>
    </div>
  );
}

/** Bloco de informação do card (rótulo pequeno + conteúdo). */
function Bloco({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(0,89,169,0.04)" }}>
      <p
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: "#8b8b9a" }}
      >
        {icone}
        {titulo}
      </p>
      <div className="mt-0.5 text-[13px]">{children}</div>
    </div>
  );
}
