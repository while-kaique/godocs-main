import React, { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { CARGOS } from "@/lib/agents/types";
import type { ChatFase, ChatMessage, SavingFormData, SavingLinhaInput, CustoEvitadoItemInput } from "./constants";
import { ocultarReaisSaving, formatMoedaBR, parseMoedaBR } from "./constants";

/* ──────────────────────────────────────────────
   Inline Markdown helper (reutilizável)
   ────────────────────────────────────────────── */

function renderInlineMarkdown(line: string, accentColor: string, isSaving: boolean): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|(?<!\*)\*([^*]+?)\*(?!\*)|\`([^`]+?)\`/g;
  let lastIndex = 0;
  let match;
  let partKey = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={partKey++}>{line.slice(lastIndex, match.index)}</span>);
    }
    if (match[1] !== undefined) {
      parts.push(
        <strong key={partKey++} style={{ color: accentColor, fontWeight: 600 }}>
          {match[1]}
        </strong>
      );
    } else if (match[2] !== undefined) {
      parts.push(
        <em key={partKey++} style={{ fontStyle: "italic", opacity: 0.85 }}>
          {match[2]}
        </em>
      );
    } else if (match[3] !== undefined) {
      parts.push(
        <code
          key={partKey++}
          className="rounded px-1 py-0.5 text-[12px]"
          style={{
            background: isSaving ? "rgba(215,219,0,0.1)" : "rgba(0,89,169,0.06)",
            color: accentColor,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontWeight: 500,
          }}
        >
          {match[3]}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(<span key={partKey++}>{line.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? <>{parts}</> : line;
}

/* ──────────────────────────────────────────────
   Cycling label para operações pesadas
   (mostra "em que passo o agente está" em vez do
   loading genérico de 3 pontinhos)
   ────────────────────────────────────────────── */

export function CyclingText({ steps, intervalMs = 2200 }: { steps: string[]; intervalMs?: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (steps.length <= 1) return;
    // Avança pelos passos estimados e PÁRA no último (a resposta chega a qualquer momento).
    const t = setInterval(() => setIdx((i) => (i + 1 >= steps.length ? i : i + 1)), intervalMs);
    return () => clearInterval(t);
  }, [steps, intervalMs]);
  return <>{steps[Math.min(idx, steps.length - 1)] ?? ""}</>;
}

/* ──────────────────────────────────────────────
   Simple Markdown Renderer
   ────────────────────────────────────────────── */

export function SimpleMarkdown({ text, isSaving }: { text: string; isSaving: boolean }) {
  const accentColor = isSaving ? "#6b6e00" : "var(--go-blue)";
  const accentBorder = isSaving ? "rgba(215,219,0,0.15)" : "rgba(0,89,169,0.08)";

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    elements.push(
      <ul
        key={key++}
        className="space-y-1 pl-1"
        style={{ margin: "6px 0" }}
      >
        {listBuffer.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-[13.5px] leading-[1.6]"
            style={{ color: "var(--go-text-primary)" }}
          >
            <span
              className="mt-[8px] block h-[5px] w-[5px] shrink-0 rounded-full"
              style={{ background: accentColor, opacity: 0.4 }}
            />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  const renderInline = (line: string) => renderInlineMarkdown(line, accentColor, isSaving);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2
          key={key++}
          className="text-[15px] font-bold tracking-tight"
          style={{ color: accentColor, margin: "0 0 4px" }}
        >
          {renderInline(line.replace(/^# /, ""))}
        </h2>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <div key={key++} style={{ margin: elements.length > 0 ? "14px 0 5px" : "0 0 5px" }}>
          <div
            className="flex items-center gap-2"
            style={{ borderBottom: `1.5px solid ${accentBorder}`, paddingBottom: 5 }}
          >
            <div
              className="h-[6px] w-[6px] rounded-full"
              style={{ background: accentColor, opacity: 0.5 }}
            />
            <h3
              className="text-[12.5px] font-semibold uppercase tracking-[0.05em]"
              style={{ color: accentColor }}
            >
              {renderInline(line.replace(/^## /, ""))}
            </h3>
          </div>
        </div>
      );
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h4
          key={key++}
          className="text-[13px] font-semibold"
          style={{ color: accentColor, margin: "8px 0 3px" }}
        >
          {renderInline(line.replace(/^### /, ""))}
        </h4>
      );
      continue;
    }

    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const content = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
      listBuffer.push(content);
      continue;
    }

    if (/^\s+[-*]\s/.test(line)) {
      const content = line.replace(/^\s+[-*]\s+/, "");
      listBuffer.push(content);
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    elements.push(
      <p
        key={key++}
        className="text-[13.5px] leading-[1.65]"
        style={{ color: "var(--go-text-primary)", margin: "3px 0" }}
      >
        {renderInline(line)}
      </p>
    );
  }

  flushList();

  return <>{elements}</>;
}

/* ──────────────────────────────────────────────
   Preview Panel
   ────────────────────────────────────────────── */

function cleanPreviewContent(content: string) {
  return content
    .replace(/\n*Essa documentação está correta\?.*$/s, "")
    .replace(/\n*Está correto\?.*$/s, "")
    .replace(/\n*Pode aprovar.*$/s, "")
    .replace(/\n*Você pode aprovar.*$/s, "")
    .replace(/\n*Fiz os ajustes.*$/s, "")
    .trim();
}

function PreviewPanel({
  content,
  isSaving,
  onApprove,
  onRequestChanges,
  showActions,
  loading,
}: {
  content: string;
  isSaving: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
  showActions: boolean;
  loading: boolean;
}) {
  const accentColor = isSaving ? "#6b6e00" : "var(--go-blue)";
  const cardBg = isSaving ? "rgba(215,219,0,0.03)" : "rgba(0,89,169,0.015)";
  const headerBg = isSaving ? "rgba(215,219,0,0.08)" : "rgba(0,89,169,0.04)";
  const borderColor = isSaving ? "rgba(215,219,0,0.18)" : "rgba(0,89,169,0.1)";
  const label = isSaving ? "Memorial de Cálculo" : "Documentação do Projeto";
  const icon = isSaving ? "📊" : "📄";

  const cleanContent = isSaving
    ? ocultarReaisSaving(cleanPreviewContent(content))
    : cleanPreviewContent(content);

  return (
    <div
      className="w-full"
      style={{
        animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
      }}
    >
      <div
        className="overflow-hidden"
        style={{
          background: "var(--go-white)",
          border: `1.5px solid ${borderColor}`,
          borderRadius: "var(--go-radius-lg)",
          boxShadow: "var(--go-shadow-md)",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{
            background: headerBg,
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-base">{icon}</span>
            <span
              className="text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: accentColor }}
            >
              {label}
            </span>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "rgba(215,219,0,0.1)",
              border: "1px solid rgba(215,219,0,0.2)",
              color: "#8a7d00",
            }}
          >
            Preview
          </span>
        </div>

        <div
          className="overflow-y-auto px-5 py-4"
          style={{
            maxHeight: 300,
            background: cardBg,
          }}
        >
          <SimpleMarkdown text={cleanContent} isSaving={isSaving} />
        </div>

        {showActions && (
          <div
            className="flex items-center gap-3 px-5 py-3.5"
            style={{
              background: "var(--go-white)",
              borderTop: `1px solid ${borderColor}`,
            }}
          >
            <button
              type="button"
              onClick={onApprove}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold transition-all"
              style={{
                background: "var(--go-lime)",
                color: "var(--go-blue)",
                border: "none",
                boxShadow: "0 2px 8px rgba(215, 219, 0, 0.2)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(215, 219, 0, 0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(215, 219, 0, 0.2)";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Aprovar
            </button>
            <button
              type="button"
              onClick={onRequestChanges}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: "transparent",
                color: "#8b8b9a",
                border: "1.5px solid rgba(0,0,0,0.08)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,89,169,0.2)";
                e.currentTarget.style.color = "var(--go-blue)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)";
                e.currentTarget.style.color = "#8b8b9a";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Pedir ajustes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Collapsible Preview Card
   ────────────────────────────────────────────── */

function CollapsiblePreviewCard({
  title,
  icon,
  accentColor,
  accentBg,
  accentBorder,
  content,
  expanded,
  onToggle,
  isSaving,
}: {
  title: string;
  icon: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  content: string;
  expanded: boolean;
  onToggle: () => void;
  isSaving: boolean;
}) {
  const cleanContent = isSaving
    ? ocultarReaisSaving(cleanPreviewContent(content))
    : cleanPreviewContent(content);

  return (
    <div
      className="mb-3 overflow-hidden rounded-xl transition-all"
      style={{
        border: `1.5px solid ${accentBorder}`,
        background: "var(--go-white)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors"
        style={{ background: expanded ? accentBg : "transparent" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">{icon}</span>
          <span
            className="text-[12px] font-bold uppercase tracking-[0.06em]"
            style={{ color: accentColor }}
          >
            {title}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold"
            style={{
              background: "rgba(22,163,74,0.08)",
              border: "1px solid rgba(22,163,74,0.15)",
              color: "#16a34a",
            }}
          >
            Aprovado
          </span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={accentColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div
          className="overflow-y-auto px-5 py-4"
          style={{
            maxHeight: 280,
            borderTop: `1px solid ${accentBorder}`,
            background: accentBg,
            animation: "go-slide-down 0.25s ease",
          }}
        >
          <SimpleMarkdown text={cleanContent} isSaving={isSaving} />
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Final Review
   ────────────────────────────────────────────── */

/* ──────────────────────────────────────────────
   Comparison Panel (antes/depois — só em reenvio)
   ────────────────────────────────────────────── */

type VersaoSnapshot = import("@/lib/meus-projetos.functions").VersaoSnapshot;

function ComparisonValue({
  value,
  markdown,
  isSaving,
}: {
  value: string | null | undefined;
  markdown?: boolean;
  isSaving?: boolean;
}) {
  const text = value?.trim();
  if (!text) return <span style={{ color: "#bbb", fontStyle: "italic" }}>—</span>;
  // Conteúdo de memorial tem markdown (#, -, **) → renderiza formatado, em caixa
  // rolável para não estourar a tela com textos longos. Demais campos: texto simples
  // com clamp de altura (descrição breve pode ser enorme).
  return (
    <div style={{ maxHeight: 150, overflowY: "auto" }}>
      {markdown ? (
        <div style={{ fontSize: 11 }}>
          <SimpleMarkdown text={text} isSaving={!!isSaving} />
        </div>
      ) : (
        <div className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: "inherit" }}>
          {text}
        </div>
      )}
    </div>
  );
}

function ComparisonRow({
  label,
  antes,
  depois,
  markdown,
  isSaving,
}: {
  label: string;
  antes: string | null | undefined;
  depois: string | null | undefined;
  markdown?: boolean;
  isSaving?: boolean;
}) {
  const changed = (antes ?? "").trim() !== (depois ?? "").trim();
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-0 items-start" style={{ borderBottom: "1px solid rgba(0,89,169,0.06)" }}>
      <div className="px-3 py-2 min-w-0" style={{ background: "rgba(239,68,68,0.03)", borderRight: "1px solid rgba(0,89,169,0.06)", color: "#555" }}>
        <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "#9b4040" }}>{label}</div>
        <ComparisonValue value={antes} markdown={markdown} isSaving={isSaving} />
      </div>
      <div
        className="px-3 py-2 min-w-0"
        style={{
          background: changed ? "rgba(22,163,74,0.04)" : undefined,
          borderLeft: changed ? "2px solid rgba(22,163,74,0.35)" : undefined,
          color: "#333",
        }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide mb-1 flex items-center gap-1" style={{ color: changed ? "#166534" : "#8b8b9a" }}>
          {label}
          {changed && (
            <span style={{ background: "rgba(22,163,74,0.12)", color: "#16a34a", borderRadius: 4, padding: "0px 4px", fontSize: 9 }}>
              alterado
            </span>
          )}
        </div>
        <ComparisonValue value={depois} markdown={markdown} isSaving={isSaving} />
      </div>
    </div>
  );
}

function ComparisonPanel({
  versaoAnterior,
  novoResumo,
  approvedSavingPreview,
  approvedReceitaPreview,
}: {
  versaoAnterior: VersaoSnapshot;
  novoResumo: { nome: string; descricaoBreve: string; ferramenta: string; tiposProjeto: string[] };
  approvedSavingPreview: string | null;
  approvedReceitaPreview?: string | null;
}) {
  // Expandido por padrão: este painel só renderiza em reenvio/edição (quando há
  // versão anterior), e nesse fluxo o diff é justamente o ponto central da revisão.
  const [expanded, setExpanded] = useState(true);
  const sp = versaoAnterior.snapshot_projeto;
  const sd = versaoAnterior.snapshot_doc;
  const dataFormatada = versaoAnterior.created_at
    ? new Date(versaoAnterior.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  const tiposLabel = (tipos: string[]) =>
    tipos.map((t) => (t === "saving" ? "Saving" : t === "receita_incremental" ? "Receita" : t)).join(", ") || "—";

  return (
    <div
      className="mb-4 overflow-hidden"
      style={{
        border: "1px solid rgba(0,89,169,0.12)",
        borderRadius: "var(--go-radius-md, 10px)",
        background: "var(--go-white)",
      }}
    >
      {/* Header clicável */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ background: "rgba(0,89,169,0.03)", cursor: "pointer", border: "none" }}
      >
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--go-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-[12px] font-semibold" style={{ color: "var(--go-blue)" }}>
            Comparação com versão anterior
          </span>
          {dataFormatada && (
            <span className="text-[10px]" style={{ color: "#8b8b9a" }}>
              · v{versaoAnterior.versao_num} enviada em {dataFormatada}
            </span>
          )}
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8b9a" strokeWidth="2"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div>
          {/* Cabeçalho colunas */}
          <div className="grid grid-cols-[1fr_1fr] gap-0" style={{ borderBottom: "1px solid rgba(0,89,169,0.1)" }}>
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#9b4040", background: "rgba(239,68,68,0.04)", borderRight: "1px solid rgba(0,89,169,0.06)" }}>
              Versão anterior
            </div>
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#166534", background: "rgba(22,163,74,0.04)" }}>
              Esta versão
            </div>
          </div>

          <ComparisonRow label="Nome do projeto" antes={sp?.nome} depois={novoResumo.nome} />
          <ComparisonRow label="Ferramenta" antes={sp?.ferramenta} depois={novoResumo.ferramenta} />
          <ComparisonRow label="Tipos" antes={tiposLabel(sp?.tipos_projeto ?? [])} depois={tiposLabel(novoResumo.tiposProjeto)} />
          <ComparisonRow label="Descrição breve" antes={sp?.descricao_breve} depois={novoResumo.descricaoBreve} />
          {(sd?.saving?.memorial_calculo || approvedSavingPreview) && (
            <ComparisonRow
              label="Memorial de saving"
              antes={sd?.saving?.memorial_calculo ? ocultarReaisSaving(sd.saving.memorial_calculo) : null}
              depois={approvedSavingPreview ? ocultarReaisSaving(approvedSavingPreview) : null}
              markdown
              isSaving
            />
          )}
          {(sd?.receita?.memorial_calculo || approvedReceitaPreview) && (
            <ComparisonRow label="Memorial de receita" antes={sd?.receita?.memorial_calculo} depois={approvedReceitaPreview} markdown />
          )}
        </div>
      )}
    </div>
  );
}

function FinalReview({
  approvedDocPreview,
  approvedSavingPreview,
  approvedReceitaPreview,
  onSubmit,
  submitting,
  versaoAnterior,
  novoResumo,
}: {
  approvedDocPreview: string | null;
  approvedSavingPreview: string | null;
  approvedReceitaPreview?: string | null;
  onSubmit: () => void;
  submitting: boolean;
  versaoAnterior?: VersaoSnapshot | null;
  novoResumo?: {
    nome: string;
    descricaoBreve: string;
    ferramenta: string;
    tiposProjeto: string[];
  };
}) {
  const [expandedDoc, setExpandedDoc] = useState(false);
  const [expandedSaving, setExpandedSaving] = useState(false);
  const [expandedReceita, setExpandedReceita] = useState(false);

  return (
    <div
      className="px-8 py-6"
      style={{
        borderTop: "1px solid rgba(22,163,74,0.15)",
        animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
      }}
    >
      <div className="mb-4 flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ background: "rgba(22,163,74,0.08)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <div className="text-[14px] font-bold" style={{ color: "var(--go-text-heading)" }}>
            Tudo pronto!
          </div>
          <div className="text-[11px]" style={{ color: "#8b8b9a" }}>
            Revise os documentos abaixo antes de enviar
          </div>
        </div>
      </div>

      {versaoAnterior && novoResumo && (
        <ComparisonPanel
          versaoAnterior={versaoAnterior}
          novoResumo={novoResumo}
          approvedSavingPreview={approvedSavingPreview}
          approvedReceitaPreview={approvedReceitaPreview}
        />
      )}

      {approvedDocPreview && (
        <CollapsiblePreviewCard
          title="Documentação Técnica"
          icon="📄"
          accentColor="var(--go-blue)"
          accentBg="rgba(0,89,169,0.04)"
          accentBorder="rgba(0,89,169,0.1)"
          content={approvedDocPreview}
          expanded={expandedDoc}
          onToggle={() => setExpandedDoc((v) => !v)}
          isSaving={false}
        />
      )}

      {approvedSavingPreview && (
        <CollapsiblePreviewCard
          title="Memorial de Saving"
          icon="📊"
          accentColor="#6b6e00"
          accentBg="rgba(215,219,0,0.04)"
          accentBorder="rgba(215,219,0,0.15)"
          content={approvedSavingPreview}
          expanded={expandedSaving}
          onToggle={() => setExpandedSaving((v) => !v)}
          isSaving={true}
        />
      )}

      {approvedReceitaPreview && (
        <CollapsiblePreviewCard
          title="Memorial de Receita"
          icon="📈"
          accentColor="#6b6e00"
          accentBg="rgba(215,219,0,0.04)"
          accentBorder="rgba(215,219,0,0.15)"
          content={approvedReceitaPreview}
          expanded={expandedReceita}
          onToggle={() => setExpandedReceita((v) => !v)}
          isSaving={true}
        />
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="go-btn-submit w-full mt-4 inline-flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <span>Enviando...</span>
            <div className="go-spinner" />
          </>
        ) : (
          <span>Enviar para Triagem</span>
        )}
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Saving Form (deterministic inputs)
   ────────────────────────────────────────────── */

function SavingForm({
  tipoProjeto,
  escopo,
  onSubmit,
  loading,
  draft,
  onDraftChange,
  onVoltar,
  voltarLabel,
}: {
  tipoProjeto: ("saving" | "receita_incremental")[];
  escopo?: string;
  onSubmit: (data: SavingFormData) => void;
  loading: boolean;
  // Rascunho persistido no componente pai — sobrevive à desmontagem do step 3 na
  // navegação entre etapas (senão o que o usuário preencheu aqui se perderia).
  draft?: SavingFormData;
  onDraftChange?: (d: SavingFormData) => void;
  // Backtracking: volta para a tela anterior do fluxo determinístico (seleção de
  // tipo na etapa 2, ou o formulário de saving quando se está na receita do fluxo
  // "ambos"). Quando ausente, o botão de voltar não é renderizado.
  onVoltar?: () => void;
  voltarLabel?: string;
}) {
  const [linhas, setLinhas] = useState<SavingLinhaInput[]>(
    draft?.linhas ?? [{ cargo: "", horasAntes: "", horasDepois: "" }],
  );
  // Alguém já fazia/mantinha isso manualmente antes? Define se a tabela mostra a
  // coluna "antes" (sim) ou só "depois" (nao — ninguém antes; economia de horas = 0).
  const [alguemFazia, setTinhaAntes] = useState<"sim" | "nao" | "">(draft?.alguemFazia ?? "");
  // Custo evitado: a solução fez a empresa deixar de pagar alguma ferramenta/serviço?
  // 'sim' → lista incremental de ferramentas evitadas (nome/valor/recorrência/justificativa).
  const [temCustoEvitado, setTemCustoEvitado] = useState<"sim" | "nao" | "">(draft?.temCustoEvitado ?? "");
  const [custoEvitadoItens, setCustoEvitadoItens] = useState<CustoEvitadoItemInput[]>(
    draft?.custoEvitadoItens?.length
      ? draft.custoEvitadoItens
      : [{ nome: "", valor: "", recorrencia: "", justificativa: "" }],
  );
  const [tipoSaving, setTipoSaving] = useState<"mensal" | "pontual" | "">(draft?.tipoSaving ?? "");
  const [custoExterno, setCustoExterno] = useState(draft?.custoExterno ?? "");
  const [custoPeriodicidade, setCustoPeriodicidade] = useState<"mensal" | "anual" | "">(
    draft?.custoPeriodicidade ?? "",
  );
  const [valorReceita, setValorReceita] = useState(draft?.valorReceita ?? "");
  const [racionalReceita, setRacionalReceita] = useState(draft?.racionalReceita ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Guarda as horas "antes" digitadas antes de mudar para "não" (que zera o campo),
  // para restaurar caso o usuário volte para "sim" — senão o valor pré-carregado some.
  const horasAntesBackup = useRef<string[] | null>(null);

  // Espelha o rascunho no pai a cada mudança, para persistir entre navegações.
  useEffect(() => {
    onDraftChange?.({ linhas, alguemFazia, temCustoEvitado, custoEvitadoItens, tipoSaving, custoExterno, custoPeriodicidade, valorReceita, racionalReceita });
  }, [linhas, alguemFazia, temCustoEvitado, custoEvitadoItens, tipoSaving, custoExterno, custoPeriodicidade, valorReceita, racionalReceita, onDraftChange]);

  const isSaving = tipoProjeto.includes("saving");
  const isReceita = !isSaving; // este form é renderizado só com tipoProjeto=["receita_incremental"]
  const isExterno = escopo === "externo";
  const icon = isSaving ? "💰" : "📈";
  const title = "Dados para Análise de Impacto";

  // ── Revelação progressiva ──
  // Como todas as informações são obrigatórias, cada tópico só aparece quando o
  // anterior está respondido/completo — guiando o usuário um passo de cada vez.
  const num = (s: string) => parseFloat(s);
  const linhaCompleta = (l: SavingLinhaInput) => {
    const a = num(l.horasAntes);
    const d = num(l.horasDepois);
    const antesOk = alguemFazia === "nao" || (l.horasAntes !== "" && !isNaN(a) && a >= 0);
    const depoisOk = l.horasDepois !== "" && !isNaN(d) && d >= 0;
    return l.cargo !== "" && antesOk && depoisOk;
  };
  const tabelaSavingCompleta = alguemFazia !== "" && linhas.every(linhaCompleta);
  const custoEvitadoItemCompleto = (it: CustoEvitadoItemInput) =>
    it.nome.trim() !== "" && it.valor !== "" && parseMoedaBR(it.valor) > 0 && it.recorrencia !== "" && it.justificativa.trim() !== "";
  const custoEvitadoCompleto =
    temCustoEvitado === "nao" ||
    (temCustoEvitado === "sim" && custoEvitadoItens.length > 0 && custoEvitadoItens.every(custoEvitadoItemCompleto));

  // Gates de exibição (saving). A tabela mantém o gate atual (`alguemFazia`).
  // Custo evitado/externo: no "não" aparece já; no "sim" só após a tabela completa.
  const mostrarSecaoSaving = isSaving && tipoSaving !== "";
  const mostrarCustoEvitado =
    isSaving && (alguemFazia === "nao" || (alguemFazia === "sim" && tabelaSavingCompleta));
  const mostrarCustoFerramentaExterna = isExterno && isSaving && mostrarCustoEvitado && custoEvitadoCompleto;

  // Gate (receita): racional só aparece depois do valor preenchido.
  const mostrarRacionalReceita = isReceita && num(valorReceita) > 0;

  // Botão de envio só aparece quando todo o caminho obrigatório está completo.
  const formCompleto =
    tipoSaving !== "" &&
    (isReceita
      ? num(valorReceita) > 0 && racionalReceita.trim().length >= 10
      : alguemFazia !== "" &&
        tabelaSavingCompleta &&
        custoEvitadoCompleto &&
        (!isExterno || (custoExterno !== "" && num(custoExterno) >= 0 && custoPeriodicidade !== "")));

  // Animação padrão de entrada (slide de baixo pra cima) para cada novo tópico.
  const revelar = { animation: "go-fade-in-up 0.35s ease both" } as const;

  // O cálculo do ganho (horas × taxa do cargo) é uma métrica de gestão e roda no
  // backend — NÃO é exibido ao usuário aqui para não induzir manipulação dos valores.

  function updateLinha(i: number, patch: Partial<SavingLinhaInput>) {
    setLinhas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setErrors((e) => {
      const n = { ...e };
      delete n[`l${i}cargo`];
      delete n[`l${i}antes`];
      delete n[`l${i}depois`];
      return n;
    });
  }
  function addLinha() {
    // No modo "ninguém antes", horas antes é sempre 0 (campo nem aparece).
    setLinhas((ls) => [...ls, { cargo: "", horasAntes: alguemFazia === "nao" ? "0" : "", horasDepois: "" }]);
  }
  function selectTinhaAntes(v: "sim" | "nao") {
    if (v === alguemFazia) return; // já selecionado → não mexe nos valores
    setTinhaAntes(v);
    setLinhas((ls) => {
      if (v === "nao") {
        // ninguém fazia antes → zera o campo, mas guarda o que estava lá para
        // restaurar se o usuário voltar para "sim".
        horasAntesBackup.current = ls.map((l) => l.horasAntes);
        return ls.map((l) => ({ ...l, horasAntes: "0" }));
      }
      // "sim" → restaura o valor guardado (ex: 25h pré-carregadas); na falta de
      // backup, só limpa o "0" herdado do modo "nao" para o usuário digitar.
      const bkp = horasAntesBackup.current;
      return ls.map((l, i) => ({
        ...l,
        horasAntes: bkp && bkp[i] != null && bkp[i] !== "0" ? bkp[i] : (l.horasAntes === "0" ? "" : l.horasAntes),
      }));
    });
    setErrors((e) => {
      const n = { ...e };
      delete n.alguemFazia;
      Object.keys(n).forEach((k) => { if (/^l\d+antes$/.test(k)) delete n[k]; });
      return n;
    });
  }
  function removeLinha(i: number) {
    setLinhas((ls) => ls.filter((_, idx) => idx !== i));
    setErrors({});
  }

  // ── Custo evitado (lista de ferramentas/serviços que deixaram de ser pagos) ──
  function selectTemCustoEvitado(v: "sim" | "nao") {
    setTemCustoEvitado(v);
    if (v === "sim" && custoEvitadoItens.length === 0) {
      setCustoEvitadoItens([{ nome: "", valor: "", recorrencia: "", justificativa: "" }]);
    }
    setErrors((e) => {
      const n = { ...e };
      delete n.temCustoEvitado;
      Object.keys(n).forEach((k) => { if (/^ce\d+/.test(k)) delete n[k]; });
      return n;
    });
  }
  function updateCustoEvitado(i: number, patch: Partial<CustoEvitadoItemInput>) {
    setCustoEvitadoItens((its) => its.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    setErrors((e) => {
      const n = { ...e };
      delete n[`ce${i}nome`];
      delete n[`ce${i}valor`];
      delete n[`ce${i}recorrencia`];
      delete n[`ce${i}justificativa`];
      return n;
    });
  }
  function addCustoEvitado() {
    setCustoEvitadoItens((its) => [...its, { nome: "", valor: "", recorrencia: "", justificativa: "" }]);
  }
  function removeCustoEvitado(i: number) {
    setCustoEvitadoItens((its) => its.filter((_, idx) => idx !== i));
    setErrors({});
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!tipoSaving) errs.tipoSaving = "Selecione a frequência";
    if (isSaving) {
      if (!alguemFazia) errs.alguemFazia = "Selecione uma opção";
      linhas.forEach((l, i) => {
        const a = parseFloat(l.horasAntes);
        const d = parseFloat(l.horasDepois);
        if (!l.cargo) errs[`l${i}cargo`] = "Selecione a função";
        // "antes" só é cobrado no modo "sim" (havia trabalho manual). No modo "nao"
        // o campo nem aparece (horas_antes = 0). Aceita >= 0; o ganho líquido é
        // calculado/clampado no backend.
        if (alguemFazia === "sim" && (l.horasAntes === "" || isNaN(a) || a < 0))
          errs[`l${i}antes`] = "Informe as horas";
        if (l.horasDepois === "" || isNaN(d) || d < 0) errs[`l${i}depois`] = "Informe as horas";
      });
      // Custo evitado: pergunta obrigatória. Se "sim", cada ferramenta precisa estar completa.
      if (!temCustoEvitado) errs.temCustoEvitado = "Selecione uma opção";
      if (temCustoEvitado === "sim") {
        if (custoEvitadoItens.length === 0) errs.temCustoEvitado = "Adicione ao menos uma ferramenta evitada";
        custoEvitadoItens.forEach((it, i) => {
          const v = parseMoedaBR(it.valor);
          if (!it.nome.trim()) errs[`ce${i}nome`] = "Informe o nome";
          if (it.valor === "" || v <= 0) errs[`ce${i}valor`] = "Informe o valor";
          if (!it.recorrencia) errs[`ce${i}recorrencia`] = "Selecione";
          if (!it.justificativa.trim()) errs[`ce${i}justificativa`] = "Informe a justificativa";
        });
      }
    }
    if (isExterno && isSaving) {
      if (!custoExterno || parseFloat(custoExterno) < 0) errs.custoExterno = "Informe o custo da ferramenta";
      if (!custoPeriodicidade) errs.custoPeriodicidade = "Selecione a periodicidade";
    }
    if (isReceita) {
      const v = parseFloat(valorReceita);
      if (valorReceita === "" || isNaN(v) || v <= 0) errs.valorReceita = "Informe o ganho de receita estimado";
      if (!racionalReceita.trim() || racionalReceita.trim().length < 10)
        errs.racionalReceita = "Escreva um racional curto (de onde vem a receita)";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    onSubmit({
      linhas,
      alguemFazia,
      temCustoEvitado,
      custoEvitadoItens,
      tipoSaving: tipoSaving as "mensal" | "pontual",
      custoExterno,
      custoPeriodicidade: custoPeriodicidade as "mensal" | "anual" | "",
      valorReceita,
      racionalReceita,
    });
  }

  return (
    <div
      className="px-8 py-6"
      style={{ animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both" }}
    >
      {/* Header — título à esquerda, atalho de edição (padrão "Editar dados") à direita */}
      <div className="mb-5 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-base"
            style={{ background: "rgba(215,219,0,0.1)", border: "1.5px solid rgba(215,219,0,0.2)" }}
          >
            {icon}
          </div>
          <div>
            <div className="text-[14px] font-bold" style={{ color: "#6b6e00" }}>{title}</div>
            <div className="text-[11px]" style={{ color: "#8b8b9a" }}>
              {isSaving
                ? "Informe os dados abaixo para iniciar a análise de economia"
                : "Selecione a frequência para iniciar a análise de receita"}
            </div>
          </div>
        </div>
        {onVoltar && (
          <button
            type="button"
            onClick={onVoltar}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-all"
            style={{
              background: "rgba(215,219,0,0.08)",
              border: "1.5px solid rgba(215,219,0,0.25)",
              color: "#6b6e00",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.5 : 1,
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (loading) return;
              e.currentTarget.style.background = "rgba(215,219,0,0.16)";
              e.currentTarget.style.borderColor = "rgba(215,219,0,0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(215,219,0,0.08)";
              e.currentTarget.style.borderColor = "rgba(215,219,0,0.25)";
            }}
            title={voltarLabel ?? "Editar"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            {voltarLabel ?? "Editar"}
          </button>
        )}
      </div>

      <div
        className="rounded-xl p-5 space-y-4"
        style={{
          background: "rgba(215,219,0,0.03)",
          border: "1.5px solid rgba(215,219,0,0.15)",
        }}
      >
        {/* Tipo saving: Mensal / Pontual toggle */}
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
            Frequência do {isSaving ? "saving" : "ganho"} <span style={{ color: "#e53e3e" }}>*</span>
          </label>
          <div className="flex gap-0 rounded-xl overflow-hidden" style={{ border: "1.5px solid rgba(215,219,0,0.2)" }}>
            {(["mensal", "pontual"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { setTipoSaving(opt); setErrors(e => { const n = { ...e }; delete n.tipoSaving; return n; }); }}
                className="flex-1 py-2.5 text-[13px] font-semibold transition-all"
                style={{
                  background: tipoSaving === opt ? "#6b6e00" : "transparent",
                  color: tipoSaving === opt ? "#fff" : "#6b6e00",
                  borderRight: opt === "mensal" ? "1px solid rgba(215,219,0,0.2)" : "none",
                }}
              >
                {opt === "mensal" ? "📅 Mensal" : "⚡ Pontual"}
              </button>
            ))}
          </div>
          {errors.tipoSaving && (
            <div className="mt-1 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
              {errors.tipoSaving}
            </div>
          )}
        </div>

        {/* Saving — quem trabalhava/trabalha na tarefa (só após escolher a frequência) */}
        {mostrarSecaoSaving && (
          <>
            {/* Pergunta-chave: havia trabalho manual antes? Define se mostramos a
                coluna "antes" (economia clássica) ou só "depois" (ninguém antes). */}
            <div style={revelar}>
              <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
                Alguém já fazia ou mantinha isso manualmente antes? <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <div className="flex gap-0 rounded-xl overflow-hidden" style={{ border: "1.5px solid rgba(215,219,0,0.2)" }}>
                {([["sim", "Sim, alguém fazia"], ["nao", "Não, ninguém fazia"]] as const).map(([opt, lbl]) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => selectTinhaAntes(opt)}
                    className="flex-1 py-2.5 text-[13px] font-semibold transition-all"
                    style={{
                      background: alguemFazia === opt ? "#6b6e00" : "transparent",
                      color: alguemFazia === opt ? "#fff" : "#6b6e00",
                      borderRight: opt === "sim" ? "1px solid rgba(215,219,0,0.2)" : "none",
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              {errors.alguemFazia && (
                <div className="mt-1 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                  {errors.alguemFazia}
                </div>
              )}
            </div>

            {/* Tabela só aparece depois de responder sim/não */}
            {alguemFazia && (
              <div style={revelar}>
                <label className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
                  {alguemFazia === "sim" ? "Quem trabalhava (ou trabalha) nessa tarefa" : "Quem dedica tempo à automação hoje"} <span style={{ color: "#e53e3e" }}>*</span>
                </label>
                <p className="mb-2.5 text-[11px] leading-snug" style={{ color: "#8b8b9a" }}>
                  {alguemFazia === "sim" ? (
                    <>
                      Uma linha por função. Informe as horas/mês <strong>antes</strong> e <strong>depois</strong> da automação.
                      Se ninguém precisa atuar depois, deixe "horas depois" como <strong>0</strong>.
                    </>
                  ) : (
                    <>
                      Ninguém fazia isso manualmente antes. Informe só as horas/mês que cada função
                      passou a dedicar à automação agora (manutenção, exceções, acompanhamento).
                    </>
                  )}
                </p>

                {/* Cabeçalho das colunas (telas largas) */}
                <div
                  className="mb-1 hidden gap-2.5 px-1 text-[10px] font-semibold uppercase tracking-wide sm:grid"
                  style={{ gridTemplateColumns: alguemFazia === "nao" ? "1fr 76px 28px" : "1fr 76px 76px 28px", color: "#9a9aa8" }}
                >
                  <span>Função</span>
                  {alguemFazia === "sim" && <span className="text-center">Horas antes</span>}
                  <span className="text-center">Horas depois</span>
                  <span />
                </div>

                <div className="space-y-2.5">
                  {linhas.map((l, i) => {
                    const linhaErro = errors[`l${i}cargo`] || errors[`l${i}antes`] || errors[`l${i}depois`];
                    return (
                      <div
                        key={i}
                        className="rounded-xl p-2.5"
                        style={{ background: "var(--go-white)", border: "1.5px solid rgba(215,219,0,0.18)", animation: "go-step-in 0.3s ease" }}
                      >
                        <div className="grid items-start gap-2.5" style={{ gridTemplateColumns: alguemFazia === "nao" ? "1fr 76px 28px" : "1fr 76px 76px 28px" }}>
                          {/* Função */}
                          <div className="min-w-0">
                            <select
                              aria-label="Função"
                              value={l.cargo}
                              onChange={(e) => updateLinha(i, { cargo: e.target.value })}
                              className="go-select w-full"
                              style={{
                                padding: "9px 10px",
                                borderRadius: "var(--go-radius-md)",
                                border: errors[`l${i}cargo`] ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                                background: "var(--go-white)",
                                fontSize: 13,
                                color: l.cargo ? "var(--go-text-primary)" : "#8b8b9a",
                              }}
                            >
                              <option value="">Selecione a função...</option>
                              {CARGOS.map((c) => (
                                <option key={c.label} value={c.label}>{c.label}</option>
                              ))}
                            </select>
                          </div>

                          {/* Horas antes — só no modo "sim" */}
                          {alguemFazia === "sim" && (
                            <input
                              type="number" min="0" step="0.5" placeholder="40"
                              aria-label="Horas por mês antes"
                              value={l.horasAntes}
                              onChange={(e) => updateLinha(i, { horasAntes: e.target.value })}
                              className="go-input w-full"
                              style={{
                                padding: "9px 6px", borderRadius: "var(--go-radius-md)", textAlign: "center",
                                border: errors[`l${i}antes`] ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                                background: "var(--go-white)", fontSize: 13,
                              }}
                            />
                          )}

                          {/* Horas depois */}
                          <input
                            type="number" min="0" step="0.5" placeholder="2"
                            aria-label="Horas por mês depois"
                            value={l.horasDepois}
                            onChange={(e) => updateLinha(i, { horasDepois: e.target.value })}
                            className="go-input w-full"
                            style={{
                              padding: "9px 6px", borderRadius: "var(--go-radius-md)", textAlign: "center",
                              border: errors[`l${i}depois`] ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                              background: "var(--go-white)", fontSize: 13,
                            }}
                          />

                          {/* Remover função */}
                          {linhas.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeLinha(i)}
                              aria-label="Remover função"
                              className="flex h-[38px] w-7 items-center justify-center rounded-lg transition-colors"
                              style={{ color: "#b4313b", background: "transparent" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(180,49,59,0.08)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          ) : <span />}
                        </div>

                        {/* Erro da linha (a economia calculada não é exibida ao usuário) */}
                        {linhaErro ? (
                          <div className="mt-1.5 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                            {linhaErro}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Adicionar função */}
                <button
                  type="button"
                  onClick={addLinha}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-semibold transition-colors"
                  style={{ color: "#6b6e00", background: "transparent", border: "1.5px dashed rgba(215,219,0,0.45)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(215,219,0,0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Adicionar função
                </button>
              </div>
            )}

            {/* Custo evitado — a solução fez a empresa DEIXAR de pagar alguma
                ferramenta/serviço externo? (≠ ferramenta usada pela automação)
                No "não" aparece já; no "sim" só após a tabela estar completa. */}
            {mostrarCustoEvitado && (
            <div style={revelar}>
              <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
                A solução evitou algum custo de ferramenta ou serviço externo? <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <p className="mb-2 text-[11px] leading-snug" style={{ color: "#8b8b9a" }}>
                Ferramentas ou serviços pagos que a empresa <strong>deixou de contratar</strong> por causa desta solução
                (ex: uma licença SaaS cancelada, um serviço terceirizado eliminado).
              </p>
              <div className="flex gap-0 rounded-xl overflow-hidden" style={{ border: "1.5px solid rgba(215,219,0,0.2)" }}>
                {([["sim", "Sim, evitou"], ["nao", "Não evitou"]] as const).map(([opt, lbl]) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => selectTemCustoEvitado(opt)}
                    className="flex-1 py-2.5 text-[13px] font-semibold transition-all"
                    style={{
                      background: temCustoEvitado === opt ? "#6b6e00" : "transparent",
                      color: temCustoEvitado === opt ? "#fff" : "#6b6e00",
                      borderRight: opt === "sim" ? "1px solid rgba(215,219,0,0.2)" : "none",
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              {errors.temCustoEvitado && (
                <div className="mt-1 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                  {errors.temCustoEvitado}
                </div>
              )}

              {/* Lista incremental de ferramentas evitadas */}
              {temCustoEvitado === "sim" && (
                <div className="mt-3">
                  {/* Cabeçalho (telas largas) */}
                  <div
                    className="mb-1 hidden gap-2.5 px-1 text-[10px] font-semibold uppercase tracking-wide sm:grid"
                    style={{ gridTemplateColumns: "1fr 96px 104px 28px", color: "#9a9aa8" }}
                  >
                    <span>Ferramenta / serviço</span>
                    <span className="text-center">Valor (R$)</span>
                    <span className="text-center">Recorrência</span>
                    <span />
                  </div>

                  <div className="space-y-2.5">
                    {custoEvitadoItens.map((it, i) => {
                      const linhaErro =
                        errors[`ce${i}nome`] || errors[`ce${i}valor`] ||
                        errors[`ce${i}recorrencia`] || errors[`ce${i}justificativa`];
                      return (
                        <div
                          key={i}
                          className="rounded-xl p-2.5"
                          style={{ background: "var(--go-white)", border: "1.5px solid rgba(215,219,0,0.18)", animation: "go-step-in 0.3s ease" }}
                        >
                          <div className="grid items-start gap-2.5" style={{ gridTemplateColumns: "1fr 96px 104px 28px" }}>
                            {/* Nome da ferramenta */}
                            <input
                              type="text"
                              placeholder="Ex: Zapier"
                              aria-label="Nome da ferramenta evitada"
                              value={it.nome}
                              onChange={(e) => updateCustoEvitado(i, { nome: e.target.value })}
                              className="go-input w-full"
                              style={{
                                height: 38, padding: "0 10px", borderRadius: "var(--go-radius-md)",
                                border: errors[`ce${i}nome`] ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                                background: "var(--go-white)", fontSize: 13,
                              }}
                            />
                            {/* Valor — máscara de moeda BR (só dígitos → 1.234,56) */}
                            <input
                              type="text" inputMode="numeric" placeholder="299,90"
                              aria-label="Valor evitado"
                              value={it.valor}
                              onChange={(e) => updateCustoEvitado(i, { valor: formatMoedaBR(e.target.value) })}
                              className="go-input w-full"
                              style={{
                                height: 38, padding: "0 6px", borderRadius: "var(--go-radius-md)", textAlign: "center",
                                border: errors[`ce${i}valor`] ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                                background: "var(--go-white)", fontSize: 13,
                              }}
                            />
                            {/* Recorrência */}
                            <select
                              aria-label="Recorrência"
                              value={it.recorrencia}
                              onChange={(e) => updateCustoEvitado(i, { recorrencia: e.target.value as "mensal" | "pontual" | "" })}
                              className="go-select w-full"
                              style={{
                                height: 38, padding: "0 6px", borderRadius: "var(--go-radius-md)",
                                border: errors[`ce${i}recorrencia`] ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                                background: "var(--go-white)", fontSize: 13,
                                color: it.recorrencia ? "var(--go-text-primary)" : "#8b8b9a",
                                textAlign: "center", textAlignLast: "center",
                              }}
                            >
                              <option value="">Selecione...</option>
                              <option value="mensal">Mensal</option>
                              <option value="pontual">Pontual</option>
                            </select>
                            {/* Remover */}
                            {custoEvitadoItens.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => removeCustoEvitado(i)}
                                aria-label="Remover ferramenta evitada"
                                className="flex h-[38px] w-7 items-center justify-center rounded-lg transition-colors"
                                style={{ color: "#b4313b", background: "transparent" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(180,49,59,0.08)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            ) : <span />}
                          </div>

                          {/* Justificativa breve */}
                          <input
                            type="text"
                            placeholder="Justificativa breve (ex: substituída pelo fluxo no n8n)"
                            aria-label="Justificativa do custo evitado"
                            value={it.justificativa}
                            onChange={(e) => updateCustoEvitado(i, { justificativa: e.target.value })}
                            className="go-input mt-2 w-full"
                            style={{
                              padding: "9px 10px", borderRadius: "var(--go-radius-md)",
                              border: errors[`ce${i}justificativa`] ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                              background: "var(--go-white)", fontSize: 13,
                            }}
                          />

                          {linhaErro ? (
                            <div className="mt-1.5 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                              {linhaErro}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {/* Adicionar ferramenta */}
                  <button
                    type="button"
                    onClick={addCustoEvitado}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-semibold transition-colors"
                    style={{ color: "#6b6e00", background: "transparent", border: "1.5px dashed rgba(215,219,0,0.45)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(215,219,0,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Adicionar ferramenta evitada
                  </button>
                </div>
              )}
            </div>
            )}
          </>
        )}

        {/* Ganho de receita estimado (só para projetos de receita incremental) */}
        {isReceita && tipoSaving && (
          <div style={revelar}>
            <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
              Ganho de receita estimado <span style={{ color: "#e53e3e" }}>*</span>
            </label>
            <p className="mb-2 text-[11px] leading-snug" style={{ color: "#8b8b9a" }}>
              Informe quanto de receita nova o projeto gera ({tipoSaving === "pontual" ? "valor total" : "por mês"}).
              O agente vai pedir a base de cálculo para validar esse número.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold" style={{ color: "#6b6e00" }}>R$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={tipoSaving === "pontual" ? "Ex: 50000,00" : "Ex: 8000,00"}
                value={valorReceita}
                onChange={(e) => { setValorReceita(e.target.value); setErrors(er => { const n = { ...er }; delete n.valorReceita; return n; }); }}
                className="go-input flex-1"
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--go-radius-md)",
                  border: errors.valorReceita ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                  background: "var(--go-white)",
                  fontSize: 13,
                }}
              />
            </div>
            {errors.valorReceita && (
              <div className="mt-1 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                {errors.valorReceita}
              </div>
            )}

            {/* Racional curto — de onde vem a receita (só após informar o valor) */}
            {mostrarRacionalReceita && (
            <div className="mt-3.5" style={revelar}>
              <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
                Racional <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <p className="mb-2 text-[11px] leading-snug" style={{ color: "#8b8b9a" }}>
                Em uma frase, de onde vem essa receita. Ex: <em>"as estampas com IA vendem esse valor por mês"</em>.
                O agente vai aprofundar a partir daqui.
              </p>
              <textarea
                rows={2}
                placeholder="Ex: as estampas geradas com IA vendem cerca desse valor por mês"
                value={racionalReceita}
                onChange={(e) => { setRacionalReceita(e.target.value); setErrors(er => { const n = { ...er }; delete n.racionalReceita; return n; }); }}
                className="go-textarea w-full resize-none"
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--go-radius-md)",
                  border: errors.racionalReceita ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                  background: "var(--go-white)",
                  fontSize: 13,
                }}
              />
              {errors.racionalReceita && (
                <div className="mt-1 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                  {errors.racionalReceita}
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Custo da ferramenta externa (só projetos externos; após o custo evitado) */}
        {mostrarCustoFerramentaExterna && (
          <>
            <div style={revelar}>
              <label className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
                Custo da ferramenta externa <span style={{ color: "#e53e3e" }}>*</span>
              </label>
              <div className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Ex: 299,90"
                    value={custoExterno}
                    onChange={(e) => { setCustoExterno(e.target.value); setErrors(er => { const n = { ...er }; delete n.custoExterno; return n; }); }}
                    className="go-input w-full"
                    style={{
                      padding: "10px 12px",
                      borderRadius: "var(--go-radius-md)",
                      border: errors.custoExterno ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
                      background: "var(--go-white)",
                      fontSize: 13,
                    }}
                  />
                  {errors.custoExterno && (
                    <div className="mt-1 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                      {errors.custoExterno}
                    </div>
                  )}
                </div>
                <div className="flex gap-0 rounded-xl overflow-hidden shrink-0" style={{ border: "1.5px solid rgba(215,219,0,0.2)" }}>
                  {(["mensal", "anual"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => { setCustoPeriodicidade(opt); setErrors(er => { const n = { ...er }; delete n.custoPeriodicidade; return n; }); }}
                      className="px-3 py-2.5 text-[12px] font-semibold transition-all"
                      style={{
                        background: custoPeriodicidade === opt ? "#6b6e00" : "transparent",
                        color: custoPeriodicidade === opt ? "#fff" : "#6b6e00",
                        borderRight: opt === "mensal" ? "1px solid rgba(215,219,0,0.2)" : "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {opt === "mensal" ? "R$/mês" : "R$/ano"}
                    </button>
                  ))}
                </div>
              </div>
              {errors.custoPeriodicidade && (
                <div className="mt-1 text-[11px] font-medium" style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}>
                  {errors.custoPeriodicidade}
                </div>
              )}
              <div className="mt-1.5 text-[10px]" style={{ color: "#8b8b9a" }}>
                Será abatido para calcular o ganho líquido da automação.
              </div>
            </div>
          </>
        )}

        {/* Botão iniciar — só aparece quando todo o formulário está completo */}
        {formCompleto && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-bold transition-all"
          style={{
            background: "var(--go-lime)",
            color: "var(--go-blue)",
            border: "none",
            boxShadow: "0 2px 8px rgba(215, 219, 0, 0.2)",
            marginTop: 4,
            ...revelar,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(215, 219, 0, 0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 2px 8px rgba(215, 219, 0, 0.2)";
          }}
        >
          {loading ? (
            <>
              <span>Analisando...</span>
              <div className="go-spinner" />
            </>
          ) : (
            <>
              <span>Iniciar análise</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </>
          )}
        </button>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Step 3: Chat com o Agente
   ────────────────────────────────────────────── */

export function Step3Chat({
  messages,
  input,
  setInput,
  onSend,
  loading,
  loadingSteps,
  isComplete,
  onSubmit,
  submitting,
  chatBottomRef,
  fase,
  showTransition,
  transitionType = "saving",
  approvedDocPreview,
  approvedSavingPreview,
  approvedReceitaPreview,
  tipoProjeto,
  escopo,
  showSavingForm,
  onSavingFormSubmit,
  savingFormLoading,
  showReceitaForm,
  onReceitaFormSubmit,
  receitaFormLoading,
  formDraft,
  onFormDraftChange,
  onEditSaving,
  onEditReceita,
  onSavingFormVoltar,
  savingFormVoltarLabel,
  onReceitaFormVoltar,
  receitaFormVoltarLabel,
  versaoAnterior,
  novoResumo,
}: {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  onSend: (content: string, option?: number) => void;
  loading: boolean;
  // Passos nomeados para operações pesadas (compilar doc, ler arquivos, analisar
  // impacto). Quando presente e `loading` ativo, mostra o passo em vez dos 3 pontos.
  loadingSteps?: string[] | null;
  isComplete: boolean;
  onSubmit: () => void;
  submitting: boolean;
  chatBottomRef: React.RefObject<HTMLDivElement | null>;
  fase: ChatFase;
  showTransition: boolean;
  transitionType?: "saving" | "receita";
  approvedDocPreview: string | null;
  approvedSavingPreview: string | null;
  approvedReceitaPreview?: string | null;
  tipoProjeto?: ("saving" | "receita_incremental")[];
  escopo?: string;
  showSavingForm?: boolean;
  onSavingFormSubmit?: (data: SavingFormData) => void;
  savingFormLoading?: boolean;
  showReceitaForm?: boolean;
  onReceitaFormSubmit?: (data: SavingFormData) => void;
  receitaFormLoading?: boolean;
  formDraft?: SavingFormData;
  onFormDraftChange?: (d: SavingFormData) => void;
  // Reabrem o formulário determinístico para editar. No fluxo "ambos", os dois podem
  // aparecer na fase de receita (editar saving já validado + editar receita).
  onEditSaving?: () => void;
  onEditReceita?: () => void;
  // Backtracking dentro do fluxo determinístico: "voltar" a partir do próprio
  // formulário (saving → seleção de tipo; receita → saving no fluxo "ambos").
  onSavingFormVoltar?: () => void;
  savingFormVoltarLabel?: string;
  onReceitaFormVoltar?: () => void;
  receitaFormVoltarLabel?: string;
  versaoAnterior?: import("@/lib/meus-projetos.functions").VersaoSnapshot | null;
  novoResumo?: {
    nome: string;
    descricaoBreve: string;
    ferramenta: string;
    tiposProjeto: string[];
  };
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isSavingFase = fase === "saving" || fase === "saving_preview";
  const isReceitaFase = fase === "receita" || fase === "receita_preview";
  const isFinancialFase = isSavingFase || isReceitaFase || fase === "completo";

  const accentColor = isFinancialFase ? "var(--go-lime)" : "var(--go-blue)";
  const accentBg = isFinancialFase ? "rgba(215,219,0,0.08)" : "rgba(0,89,169,0.08)";
  const accentBgLight = isFinancialFase ? "rgba(215,219,0,0.12)" : "rgba(199,233,253,0.4)";
  const accentBorder = isFinancialFase ? "rgba(215,219,0,0.2)" : "rgba(0,89,169,0.1)";
  const userBubbleBg = isFinancialFase ? "#7a7d00" : "var(--go-blue)";

  const lastMsg = messages[messages.length - 1];
  const showPreviewActions = lastMsg?.isPreview && !loading;
  // Botões "Editar": só com o chat da fase financeira ativo (não na transição, no
  // próprio formulário ou na revisão final).
  const canEditForms =
    (!!onEditSaving || !!onEditReceita) &&
    isFinancialFase &&
    fase !== "completo" &&
    !isComplete &&
    !showTransition &&
    !showSavingForm &&
    !showReceitaForm;
  const bothEdits = !!onEditSaving && !!onEditReceita;
  const editButtons: { key: string; label: string; onClick: () => void }[] = [];
  if (canEditForms && onEditSaving) editButtons.push({ key: "saving", label: bothEdits ? "Editar saving" : "Editar dados", onClick: onEditSaving });
  if (canEditForms && onEditReceita) editButtons.push({ key: "receita", label: bothEdits ? "Editar receita" : "Editar dados", onClick: onEditReceita });
  const hasOptions = lastMsg?.role === "assistant" && lastMsg.options && !isComplete && !showPreviewActions;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading && !isComplete && !showPreviewActions) {
        onSend(input.trim());
      }
    }
  }

  const agentLabel = isReceitaFase
    ? "Análise de Receita Incremental"
    : isSavingFase
      ? "Análise de Saving"
      : "Documentação Técnica";
  const agentStatus = isComplete
    ? "Submissão completa — pronto para envio"
    : showPreviewActions
      ? "Aguardando sua aprovação..."
      : isReceitaFase
        ? "Calculando a receita incremental do projeto..."
        : isSavingFase
          ? "Calculando a economia de horas do projeto..."
          : "Analisando e coletando informações...";

  return (
    <div className="flex flex-col" style={{ minHeight: 420 }}>
      {/* Cabeçalho do chat */}
      <div
        className="flex items-center justify-between gap-2.5 px-8 pb-4 transition-colors duration-500"
        style={{ borderBottom: `1px solid ${accentBorder}` }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm transition-colors duration-500"
            style={{ background: accentBg, color: accentColor }}
          >
            {isReceitaFase ? "📈" : isSavingFase ? "💰" : "🤖"}
          </div>
          <div className="min-w-0">
            <div
              className="text-[13px] font-bold transition-colors duration-500"
              style={{ color: isFinancialFase ? "#6b6e00" : "var(--go-text-heading)" }}
            >
              {agentLabel}
            </div>
            <div className="truncate text-[11px]" style={{ color: "#8b8b9a" }}>
              {agentStatus}
            </div>
          </div>
        </div>

        {/* Voltar ao(s) formulário(s) determinístico(s) para editar os dados */}
        {editButtons.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            {editButtons.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-all"
                style={{
                  background: "rgba(215,219,0,0.08)",
                  border: "1.5px solid rgba(215,219,0,0.25)",
                  color: "#6b6e00",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (loading) return;
                  e.currentTarget.style.background = "rgba(215,219,0,0.16)";
                  e.currentTarget.style.borderColor = "rgba(215,219,0,0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(215,219,0,0.08)";
                  e.currentTarget.style.borderColor = "rgba(215,219,0,0.25)";
                }}
                title="Voltar ao formulário para editar os dados informados"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tela de transição doc → saving */}
      {showTransition && (
        <div
          className="flex flex-col items-center justify-center px-8 py-12"
          style={{
            minHeight: 420,
            animation: "go-step-in 0.5s cubic-bezier(0.4, 0, 0.2, 1) both",
          }}
        >
          <div
            className="mb-5 flex items-center justify-center"
            style={{
              width: 64,
              height: 64,
              background: "rgba(22,163,74,0.08)",
              border: "2px solid rgba(22,163,74,0.2)",
              borderRadius: "50%",
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.1s both",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h3
            className="mb-2 text-[17px] font-extrabold tracking-tight text-center"
            style={{
              color: "var(--go-text-heading)",
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both",
            }}
          >
            {transitionType === "receita" ? "Saving validado!" : "Documentação aprovada!"}
          </h3>
          <p
            className="mb-6 text-[13px] text-center leading-relaxed max-w-[320px]"
            style={{
              color: "var(--go-text-primary)",
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.3s both",
            }}
          >
            {transitionType === "receita"
              ? "Agora vamos analisar a receita incremental — quanto de receita nova esse projeto gera."
              : "Agora vamos calcular o impacto financeiro do seu projeto — quanto tempo e dinheiro ele economiza."}
          </p>

          <div
            className="flex items-center gap-3"
            style={{
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.5s both",
            }}
          >
            <div className="flex items-center gap-1.5">
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px]"
                style={{ background: "rgba(22,163,74,0.1)", color: "#16a34a" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="text-[11px] font-semibold" style={{ color: "#16a34a" }}>
                {transitionType === "receita" ? "Saving" : "Documentação"}
              </span>
            </div>
            <div
              className="h-[2px] w-8"
              style={{ background: "linear-gradient(90deg, #16a34a, var(--go-lime))" }}
            />
            <div className="flex items-center gap-1.5">
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: "rgba(215,219,0,0.15)", color: "#6b6e00", border: "1.5px solid rgba(215,219,0,0.3)" }}
              >
                {transitionType === "receita" ? "📈" : "2"}
              </div>
              <span className="text-[11px] font-semibold" style={{ color: "#6b6e00" }}>
                {transitionType === "receita" ? "Receita" : "Impacto"}
              </span>
            </div>
          </div>

          <div
            className="mt-6 flex gap-1.5 items-center"
            style={{
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.7s both",
            }}
          >
            {[0, 0.2, 0.4].map((delay) => (
              <span
                key={delay}
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: "#6b6e00",
                  opacity: 0.5,
                  animation: `go-bounce 1.2s ease-in-out ${delay}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Formulário determinístico saving */}
      {!showTransition && showSavingForm && onSavingFormSubmit && tipoProjeto && tipoProjeto.length > 0 && (
        <SavingForm
          tipoProjeto={tipoProjeto}
          escopo={escopo}
          onSubmit={onSavingFormSubmit}
          loading={savingFormLoading ?? false}
          draft={formDraft}
          onDraftChange={onFormDraftChange}
          onVoltar={onSavingFormVoltar}
          voltarLabel={savingFormVoltarLabel}
        />
      )}

      {/* Formulário receita incremental (apenas tipo_saving: mensal/pontual) */}
      {!showTransition && showReceitaForm && onReceitaFormSubmit && (
        <SavingForm
          tipoProjeto={["receita_incremental"]}
          escopo={escopo}
          onSubmit={onReceitaFormSubmit}
          loading={receitaFormLoading ?? false}
          draft={formDraft}
          onDraftChange={onFormDraftChange}
          onVoltar={onReceitaFormVoltar}
          voltarLabel={receitaFormVoltarLabel}
        />
      )}

      {/* Mensagens */}
      {!showTransition && !showSavingForm && !showReceitaForm && (<div
        className="flex-1 overflow-y-auto px-8 py-5 space-y-4 transition-colors duration-500"
        style={{ maxHeight: 420, background: isSavingFase ? "rgba(215,219,0,0.03)" : "transparent" }}
      >
        {messages.map((msg, idx) => {
          const isPreviewMsg = msg.isPreview && msg.role === "assistant";

          if (isPreviewMsg) {
            return (
              <PreviewPanel
                key={idx}
                content={msg.content}
                isSaving={isSavingFase}
                onApprove={() => onSend("Aprovado")}
                onRequestChanges={() => {
                  const textarea = inputRef.current;
                  if (textarea) {
                    textarea.focus();
                    textarea.placeholder = "Descreva o que precisa ser ajustado...";
                  }
                }}
                showActions={idx === messages.length - 1 && !loading}
                loading={loading}
              />
            );
          }

          return (
            <div
              key={idx}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  msg.role === "user" ? "rounded-tr-sm whitespace-pre-wrap" : "rounded-tl-sm"
                )}
                style={
                  msg.role === "user"
                    ? { background: userBubbleBg, color: "#fff" }
                    : {
                        background: accentBgLight,
                        border: `1px solid ${accentBorder}`,
                        color: "var(--go-text-heading)",
                      }
                }
              >
                {msg.role === "assistant" ? (
                  <SimpleMarkdown text={msg.content} isSaving={isSavingFase} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div
              className="rounded-2xl rounded-tl-sm px-4 py-3"
              style={{ background: accentBgLight, border: `1px solid ${accentBorder}` }}
            >
              {loadingSteps && loadingSteps.length > 0 ? (
                // Operação pesada → mostra o passo nomeado (item: loading com etapa).
                <div className="flex items-center gap-2.5 h-5">
                  <span
                    className="text-[12.5px] font-medium"
                    style={{ color: isSavingFase ? "#6b6e00" : "var(--go-blue)" }}
                  >
                    <CyclingText steps={loadingSteps} />
                  </span>
                  <div className="flex gap-1.5 items-center">
                    {[0, 0.2, 0.4].map((delay) => (
                      <span
                        key={delay}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background: accentColor,
                          opacity: 0.5,
                          animation: `go-bounce 1.2s ease-in-out ${delay}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex gap-1.5 items-center h-5">
                  {[0, 0.2, 0.4].map((delay) => (
                    <span
                      key={delay}
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: accentColor,
                        opacity: 0.5,
                        animation: `go-bounce 1.2s ease-in-out ${delay}s infinite`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>
      )}

      {/* Options */}
      {!showTransition && !showSavingForm && !showReceitaForm && hasOptions && lastMsg.options && (
        <div
          className="px-8 pb-3 flex flex-wrap gap-2"
          style={{ borderTop: `1px solid ${accentBorder}` }}
        >
          <div
            className="w-full pt-3 pb-1 text-[11px] font-semibold"
            style={{ color: "#8b8b9a" }}
          >
            Selecione uma opção ou escreva sua resposta:
          </div>
          {lastMsg.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSend(opt, i + 1)}
              disabled={loading}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                background: accentBg,
                border: `1px solid ${accentBorder}`,
                color: isSavingFase ? "#6b6e00" : "var(--go-blue)",
              }}
            >
              {renderInlineMarkdown(opt, isSavingFase ? "#6b6e00" : "var(--go-blue)", isSavingFase)}
            </button>
          ))}
        </div>
      )}

      {/* Revisão final + envio */}
      {!showTransition && !showSavingForm && !showReceitaForm && isComplete && (
        <FinalReview
          approvedDocPreview={approvedDocPreview}
          approvedSavingPreview={approvedSavingPreview}
          approvedReceitaPreview={approvedReceitaPreview}
          onSubmit={onSubmit}
          submitting={submitting}
          versaoAnterior={versaoAnterior}
          novoResumo={novoResumo}
        />
      )}

      {/* Input de mensagem */}
      {!showTransition && !showSavingForm && !showReceitaForm && !isComplete && (
        <div
          className="px-8 py-4"
          style={{ borderTop: `1px solid ${accentBorder}` }}
        >
          <div className="flex gap-2.5 items-end">
            <textarea
              ref={inputRef}
              rows={1}
              className="go-textarea flex-1 resize-none"
              style={{ minHeight: 42, maxHeight: 120 }}
              placeholder="Digite sua resposta..."
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => {
                if (input.trim() && !loading) onSend(input.trim());
              }}
              disabled={!input.trim() || loading}
              className="shrink-0 flex items-center justify-center rounded-xl transition-colors"
              style={{
                width: 42,
                height: 42,
                background: input.trim() && !loading
                  ? (isSavingFase ? "#7a7d00" : "var(--go-blue)")
                  : (isSavingFase ? "rgba(215,219,0,0.15)" : "rgba(0,89,169,0.1)"),
                border: "none",
                color: input.trim() && !loading ? "#fff" : (isSavingFase ? "rgba(215,219,0,0.5)" : "rgba(0,89,169,0.4)"),
                cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="mt-1.5 text-center text-[10px]" style={{ color: "#8b8b9a" }}>
            Enter para enviar · Shift+Enter para nova linha
          </div>
        </div>
      )}
    </div>
  );
}
