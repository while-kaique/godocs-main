import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatFase, ChatMessage } from "./constants";

/* ──────────────────────────────────────────────
   Simple Markdown Renderer
   ────────────────────────────────────────────── */

function SimpleMarkdown({ text, isSaving }: { text: string; isSaving: boolean }) {
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
        className="space-y-1.5 pl-1"
        style={{ margin: "8px 0" }}
      >
        {listBuffer.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-[13px] leading-relaxed"
            style={{ color: "var(--go-text-primary)" }}
          >
            <span
              className="mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: accentColor, opacity: 0.5 }}
            />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  function renderInline(line: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    let partKey = 0;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      parts.push(
        <strong key={partKey++} style={{ color: accentColor, fontWeight: 700 }}>
          {match[1]}
        </strong>
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return parts.length > 0 ? parts : line;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2
          key={key++}
          className="text-[17px] font-extrabold tracking-tight"
          style={{ color: accentColor, margin: "0 0 4px" }}
        >
          {line.replace(/^# /, "")}
        </h2>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <div key={key++} style={{ margin: elements.length > 0 ? "16px 0 6px" : "0 0 6px" }}>
          <div
            className="flex items-center gap-2"
            style={{ borderBottom: `1.5px solid ${accentBorder}`, paddingBottom: 6 }}
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: accentColor, opacity: 0.6 }}
            />
            <h3
              className="text-[13px] font-bold uppercase tracking-[0.06em]"
              style={{ color: accentColor }}
            >
              {line.replace(/^## /, "")}
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
          style={{ color: accentColor, margin: "10px 0 4px" }}
        >
          {line.replace(/^### /, "")}
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
        className="text-[13px] leading-relaxed"
        style={{ color: "var(--go-text-primary)", margin: "4px 0" }}
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

  const cleanContent = cleanPreviewContent(content);

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
  const cleanContent = cleanPreviewContent(content);

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

function FinalReview({
  approvedDocPreview,
  approvedSavingPreview,
  onSubmitProject,
  submitting,
}: {
  approvedDocPreview: string | null;
  approvedSavingPreview: string | null;
  onSubmitProject: () => void;
  submitting: boolean;
}) {
  const [expandedDoc, setExpandedDoc] = useState(false);
  const [expandedSaving, setExpandedSaving] = useState(false);

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
          title="Memorial de Cálculo"
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

      <button
        type="button"
        onClick={onSubmitProject}
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
   Step 3: Chat com o Agente
   ────────────────────────────────────────────── */

export function Step3Chat({
  messages,
  input,
  setInput,
  onSend,
  loading,
  isComplete,
  onSubmitProject,
  submitting,
  chatBottomRef,
  fase,
  showTransition,
  approvedDocPreview,
  approvedSavingPreview,
}: {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  onSend: (content: string, option?: number) => void;
  loading: boolean;
  isComplete: boolean;
  onSubmitProject: () => void;
  submitting: boolean;
  chatBottomRef: React.RefObject<HTMLDivElement | null>;
  fase: ChatFase;
  showTransition: boolean;
  approvedDocPreview: string | null;
  approvedSavingPreview: string | null;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isSavingFase = fase === "saving" || fase === "saving_preview" || fase === "completo";

  const accentColor = isSavingFase ? "var(--go-lime)" : "var(--go-blue)";
  const accentBg = isSavingFase ? "rgba(215,219,0,0.08)" : "rgba(0,89,169,0.08)";
  const accentBgLight = isSavingFase ? "rgba(215,219,0,0.12)" : "rgba(199,233,253,0.4)";
  const accentBorder = isSavingFase ? "rgba(215,219,0,0.2)" : "rgba(0,89,169,0.1)";
  const userBubbleBg = isSavingFase ? "#7a7d00" : "var(--go-blue)";

  const lastMsg = messages[messages.length - 1];
  const showPreviewActions = lastMsg?.isPreview && !loading;
  const hasOptions = lastMsg?.role === "assistant" && lastMsg.options && !isComplete && !showPreviewActions;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading && !isComplete && !showPreviewActions) {
        onSend(input.trim());
      }
    }
  }

  const agentLabel = isSavingFase ? "Análise de Impacto" : "Documentação Técnica";
  const agentStatus = isComplete
    ? "Submissão completa — pronto para envio"
    : showPreviewActions
      ? "Aguardando sua aprovação..."
      : isSavingFase
        ? "Calculando o ganho financeiro do projeto..."
        : "Analisando e coletando informações...";

  return (
    <div className="flex flex-col" style={{ minHeight: 420 }}>
      {/* Cabeçalho do chat */}
      <div
        className="flex items-center gap-2.5 px-8 pb-4 transition-colors duration-500"
        style={{ borderBottom: `1px solid ${accentBorder}` }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors duration-500"
          style={{ background: accentBg, color: accentColor }}
        >
          {isSavingFase ? "💰" : "🤖"}
        </div>
        <div>
          <div
            className="text-[13px] font-bold transition-colors duration-500"
            style={{ color: isSavingFase ? "#6b6e00" : "var(--go-text-heading)" }}
          >
            {agentLabel}
          </div>
          <div className="text-[11px]" style={{ color: "#8b8b9a" }}>
            {agentStatus}
          </div>
        </div>
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
            Documentação aprovada!
          </h3>
          <p
            className="mb-6 text-[13px] text-center leading-relaxed max-w-[320px]"
            style={{
              color: "var(--go-text-primary)",
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.3s both",
            }}
          >
            Agora vamos calcular o impacto financeiro do seu projeto — quanto tempo e dinheiro ele economiza.
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
              <span className="text-[11px] font-semibold" style={{ color: "#16a34a" }}>Documentação</span>
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
                2
              </div>
              <span className="text-[11px] font-semibold" style={{ color: "#6b6e00" }}>Impacto</span>
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

      {/* Mensagens */}
      {!showTransition && (<div
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
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"
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
                {msg.content}
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
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>
      )}

      {/* Options */}
      {!showTransition && hasOptions && lastMsg.options && (
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
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Revisão final + envio */}
      {!showTransition && isComplete && (
        <FinalReview
          approvedDocPreview={approvedDocPreview}
          approvedSavingPreview={approvedSavingPreview}
          onSubmitProject={onSubmitProject}
          submitting={submitting}
        />
      )}

      {/* Input de mensagem */}
      {!showTransition && !isComplete && (
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
